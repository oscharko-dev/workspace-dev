/**
 * Evidence verification orchestrator (Issue #1380).
 *
 * Wraps the existing on-disk verifiers (`verifyWave1PocEvidenceFromDisk`
 * and `verifyWave1PocAttestationFromDisk`) into a single read-only
 * response surface so an HTTP route can return a deterministic
 * `EvidenceVerifyResponse` body.
 *
 * Hard invariants:
 *
 *   - The orchestrator never throws on a missing/mutated artifact —
 *     the underlying primitives don't, and this layer surfaces every
 *     failure as a structured `EvidenceVerifyFailure`.
 *   - The orchestrator catches the only documented throw path
 *     (manifest unparseable / contract-version mismatch) and turns it
 *     into a 200 response body with `ok: false` + a single
 *     `manifest_unparseable` failure. Per the AC: 200 means
 *     "verification completed", regardless of outcome.
 *   - The response body never contains absolute paths, bearer tokens,
 *     prompt bodies, raw test-case payloads, env values, or signer
 *     secret material. Only safe manifest-relative filenames, SHA-256
 *     digests, and identity stamps appear.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
  WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_SIGNATURES_DIRECTORY,
  type EvidenceVerifyCheck,
  type EvidenceVerifyFailure,
  type EvidenceVerifyFailureCode,
  type EvidenceVerifyResponse,
  type Wave1PocAttestationSigningMode,
  type Wave1PocAttestationVerificationFailure,
  type Wave1PocEvidenceManifest,
} from "../contracts/index.js";
import {
  computeWave1PocEvidenceManifestDigest,
  validateWave1PocEvidenceManifestMetadata,
  Wave1PocEvidenceManifestLoadError,
  verifyWave1PocEvidenceFromDisk,
} from "./evidence-manifest.js";
import { verifyWave1PocAttestationFromDisk } from "./evidence-attestation.js";

export {
  EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
  type EvidenceVerifyCheck,
  type EvidenceVerifyCheckKind,
  type EvidenceVerifyFailure,
  type EvidenceVerifyFailureCode,
  type EvidenceVerifyResponse,
} from "../contracts/index.js";

/** Discriminated result returned by `verifyJobEvidence`. */
export type EvidenceVerifyResult =
  | { status: "ok"; body: EvidenceVerifyResponse }
  | { status: "job_not_found" }
  | { status: "no_evidence" };

export interface VerifyJobEvidenceInput {
  /** Absolute path of the test-intelligence artifact root. */
  artifactsRoot: string;
  /** Already-validated jobId (the parser enforces `isSafeJobId`). */
  jobId: string;
  /** ISO-8601 timestamp stamped onto the response. */
  verifiedAt: string;
}

const isENOENT = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

const sortChecks = (
  checks: ReadonlyArray<EvidenceVerifyCheck>,
): EvidenceVerifyCheck[] => {
  return [...checks].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.reference !== b.reference) {
      return a.reference < b.reference ? -1 : 1;
    }
    return 0;
  });
};

const sortFailures = (
  failures: ReadonlyArray<EvidenceVerifyFailure>,
): EvidenceVerifyFailure[] => {
  return [...failures].sort((a, b) => {
    if (a.reference !== b.reference) {
      return a.reference < b.reference ? -1 : 1;
    }
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return 0;
  });
};

/**
 * Keep verifier references safe for the HTTP response. Manifest
 * artifacts may use POSIX relative paths (`lbom/ai-bom.cdx.json`);
 * those are useful audit identifiers and are not host path leakage.
 * Absolute or malformed references are collapsed to their leaf name.
 */
const safeReference = (value: string): string => {
  if (value.length === 0) return value;
  if (isAbsolute(value)) return basename(value);
  if (value.includes("\\") || value.includes("\0")) return basename(value);
  const parts = value.split("/");
  if (
    parts.some(
      (part) => part.length === 0 || part === "." || part === "..",
    )
  ) {
    return parts[parts.length - 1] ?? value;
  }
  return value;
};

const failureMessageFor = (
  code: EvidenceVerifyFailureCode,
  reference: string,
): string => {
  switch (code) {
    case "manifest_unparseable":
      return `Evidence manifest '${reference}' is missing, malformed, or carries a mismatched schema/contract version.`;
    case "manifest_metadata_invalid":
      return `Manifest metadata fields fail invariant validation.`;
    case "manifest_digest_witness_invalid":
      return `Manifest digest witness '${reference}' does not match the canonical manifest digest.`;
    case "artifact_missing":
      return `Attested artifact '${reference}' is missing on disk.`;
    case "artifact_mutated":
      return `Artifact '${reference}' SHA-256 differs from the manifest.`;
    case "artifact_resized":
      return `Artifact '${reference}' byte length differs from the manifest.`;
    case "unexpected_artifact":
      return `File '${reference}' is present in the run dir but is not attested by the manifest.`;
    case "visual_sidecar_evidence_missing":
      return `Visual-sidecar evidence for '${reference}' is missing or inconsistent with the manifest.`;
    default:
      return `Attestation verification failed for '${reference}'.`;
  }
};

const pushIfAbsent = (
  failures: EvidenceVerifyFailure[],
  failure: EvidenceVerifyFailure,
): void => {
  if (
    failures.some(
      (existing) =>
        existing.code === failure.code &&
        existing.reference === failure.reference,
    )
  ) {
    return;
  }
  failures.push(failure);
};

const tryReadJson = async (
  path: string,
): Promise<{ ok: true; value: unknown } | { ok: false }> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (isENOENT(err)) return { ok: false };
    throw err;
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
};

const sha256OfVisualEvidenceRecord = (
  record: Record<string, unknown>,
): string | undefined => {
  const screenId = record["screenId"];
  const deployment = record["deployment"];
  const meanConfidence = record["meanConfidence"];
  const outcomes = record["outcomes"];
  if (
    typeof screenId !== "string" ||
    typeof deployment !== "string" ||
    typeof meanConfidence !== "number" ||
    !Array.isArray(outcomes) ||
    outcomes.some((outcome) => typeof outcome !== "string")
  ) {
    return undefined;
  }
  const roundedConfidence = Math.round(meanConfidence * 10_000) / 10_000;
  return createHash("sha256")
    .update(
      `${screenId}|${deployment}|${[...outcomes].sort().join(",")}|${roundedConfidence}`,
      "utf8",
    )
    .digest("hex");
};

const compareVisualEvidenceRefs = (
  sidecarArtifact: Record<string, unknown>,
): boolean => {
  const result = sidecarArtifact["result"];
  const visualEvidenceRefs = sidecarArtifact["visualEvidenceRefs"];
  if (!isRecord(result) || result["outcome"] !== "success") return true;
  const validationReport = result["validationReport"];
  if (!isRecord(validationReport)) return false;
  const records = validationReport["records"];
  if (!Array.isArray(records)) return false;
  const expected = records
    .map((record) => {
      if (!isRecord(record)) return undefined;
      const evidenceHash = sha256OfVisualEvidenceRecord(record);
      const screenId = record["screenId"];
      const deployment = record["deployment"];
      if (
        evidenceHash === undefined ||
        typeof screenId !== "string" ||
        typeof deployment !== "string"
      ) {
        return undefined;
      }
      return {
        screenId,
        modelDeployment: deployment,
        evidenceHash,
      };
    })
    .filter((record): record is NonNullable<typeof record> => record !== undefined)
    .sort(
      (left, right) =>
        left.screenId.localeCompare(right.screenId) ||
        left.modelDeployment.localeCompare(right.modelDeployment) ||
        left.evidenceHash.localeCompare(right.evidenceHash),
    );
  if (
    !Array.isArray(visualEvidenceRefs) ||
    visualEvidenceRefs.length !== expected.length
  ) {
    return false;
  }
  return visualEvidenceRefs.every((entry, index) => {
    if (!isRecord(entry)) return false;
    const expectedEntry = expected[index];
    return (
      expectedEntry !== undefined &&
      entry["screenId"] === expectedEntry.screenId &&
      entry["modelDeployment"] === expectedEntry.modelDeployment &&
      entry["evidenceHash"] === expectedEntry.evidenceHash
    );
  });
};

const compareManifestCaptureIdentities = (
  manifest: Wave1PocEvidenceManifest,
  sidecarArtifact: Record<string, unknown>,
): boolean => {
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const manifestIdentities = manifestRecord["visualSidecarCaptureIdentities"];
  const result = sidecarArtifact["result"];
  if (!Array.isArray(manifestIdentities)) return result === undefined;
  if (!isRecord(result)) return false;
  const artifactIdentities = result["captureIdentities"];
  if (
    !Array.isArray(artifactIdentities) ||
    artifactIdentities.length !== manifestIdentities.length
  ) {
    return false;
  }
  return manifestIdentities.every((identity, index) => {
    const artifactIdentity = artifactIdentities[index];
    return (
      isRecord(identity) &&
      isRecord(artifactIdentity) &&
      identity["screenId"] === artifactIdentity["screenId"] &&
      identity["mimeType"] === artifactIdentity["mimeType"] &&
      identity["byteLength"] === artifactIdentity["byteLength"] &&
      identity["sha256"] === artifactIdentity["sha256"]
    );
  });
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (isENOENT(err)) return false;
    throw err;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isManifestReadOrParseError = (err: unknown): boolean => {
  return err instanceof Wave1PocEvidenceManifestLoadError;
};

const readManifestDigestWitness = async (
  artifactsDir: string,
): Promise<string | undefined> => {
  const digestPath = join(
    artifactsDir,
    WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  );
  try {
    return (await readFile(digestPath, "utf8")).trim();
  } catch (err) {
    if (isENOENT(err)) return undefined;
    throw err;
  }
};

/**
 * Detect "missing or inconsistent visual-sidecar evidence" by checking
 * the manifest's stamped visual-sidecar identity against the on-disk
 * artifact set and the persisted result file.
 *
 * The detection is intentionally conservative — it only flags when the
 * manifest itself signals a visual-sidecar contract that the on-disk
 * artifact set fails to honor. Concretely, a failure is raised when:
 *
 *   - the manifest carries a `visualSidecar` block (the harness only
 *     populates it when the multimodal sidecar ran) but the on-disk
 *     `visual-sidecar-result.json` is missing, malformed, or is a
 *     failure outcome; OR
 *   - the manifest attests the visual-sidecar result artifact in
 *     `artifacts[]` but never wires the `visualSidecar` summary block
 *     (i.e., the persisted artifact and the audit-timeline summary
 *     are out of sync); OR
 *   - the on-disk `generated-testcases.json` carries case-level
 *     `visualEvidenceRefs` that name screens with no corresponding
 *     `visualSidecar` summary in the manifest.
 *
 * The default fixture-only POC path (no opt-in `visualCaptures`)
 * intentionally has no `manifest.visualSidecar` block AND no attested
 * result artifact, so the detector returns `undefined` — visual
 * evidence is simply not part of that run's contract.
 */
const detectVisualSidecarEvidenceMissing = async (
  artifactsDir: string,
  manifest: Wave1PocEvidenceManifest,
): Promise<string | undefined> => {
  const manifestVisualSidecar = manifest.visualSidecar;
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const rawArtifacts = manifestRecord["artifacts"];
  const manifestCaptureIdentities =
    manifestRecord["visualSidecarCaptureIdentities"];
  const manifestHasCaptureIdentities = Array.isArray(manifestCaptureIdentities);
  const attestedVisualResult = Array.isArray(rawArtifacts)
    ? rawArtifacts.some(
        (artifact: unknown) =>
          isRecord(artifact) &&
          artifact["filename"] === VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
      )
    : false;

  // Case A: manifest claims a sidecar summary — the on-disk artifact
  // must exist AND the result must be a success outcome.
  if (manifestVisualSidecar !== undefined) {
    const sidecarPath = join(
      artifactsDir,
      VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    const sidecarRead = await tryReadJson(sidecarPath);
    if (!sidecarRead.ok) {
      return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
    }
    const sidecarValue = sidecarRead.value;
    if (isRecord(sidecarValue)) {
      const result = sidecarValue["result"];
      if (
        isRecord(result) &&
        typeof result["outcome"] === "string" &&
        result["outcome"] === "failure"
      ) {
        return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
      }
      if (
        !compareVisualEvidenceRefs(sidecarValue) ||
        !compareManifestCaptureIdentities(manifest, sidecarValue)
      ) {
        return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
      }
    }
  }

  if (manifestHasCaptureIdentities) {
    const sidecarPath = join(
      artifactsDir,
      VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    );
    const sidecarRead = await tryReadJson(sidecarPath);
    if (!sidecarRead.ok) {
      return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
    }
    if (
      !isRecord(sidecarRead.value) ||
      !compareManifestCaptureIdentities(manifest, sidecarRead.value)
    ) {
      return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
    }
  }

  // Case B: manifest attests the result artifact but leaves the
  // `visualSidecar` summary block unset.
  if (
    attestedVisualResult &&
    manifestVisualSidecar === undefined &&
    !manifestHasCaptureIdentities
  ) {
    return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
  }

  // Case C: any test case carries an explicit `visualEvidenceRefs`
  // array referencing screen-only observations — the manifest must
  // expose a visualSidecar summary backed by a result artifact.
  const generatedRead = await tryReadJson(
    join(artifactsDir, "generated-testcases.json"),
  );
  if (!generatedRead.ok) return undefined;
  const generated = generatedRead.value;
  if (!isRecord(generated)) return undefined;
  const cases = generated["testCases"];
  if (!Array.isArray(cases)) return undefined;
  const visualOnlyReferenced = cases.some((entry) => {
    if (!isRecord(entry)) return false;
    const refs = entry["visualEvidenceRefs"];
    return Array.isArray(refs) && refs.length > 0;
  });
  if (
    visualOnlyReferenced &&
    (manifestVisualSidecar === undefined || !attestedVisualResult)
  ) {
    return VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME;
  }

  return undefined;
};

const buildEmptyManifestResponse = (
  input: VerifyJobEvidenceInput,
): EvidenceVerifyResponse => {
  const failure: EvidenceVerifyFailure = {
    code: "manifest_unparseable",
    reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    message: failureMessageFor(
      "manifest_unparseable",
      WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
    ),
  };
  return {
    schemaVersion: EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
    verifiedAt: input.verifiedAt,
    jobId: input.jobId,
    ok: false,
    manifestSha256: "",
    checks: [
      {
        kind: "manifest_metadata",
        reference: WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
        ok: false,
        failureCode: "manifest_unparseable",
      },
    ],
    failures: [failure],
  };
};

const detectAttestationSigningMode = async (
  artifactsDir: string,
): Promise<Wave1PocAttestationSigningMode> => {
  const bundlePath = join(
    artifactsDir,
    WAVE1_POC_SIGNATURES_DIRECTORY,
    WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  );
  return (await fileExists(bundlePath)) ? "sigstore" : "unsigned";
};

const ensureExpectedDir = (artifactsRoot: string, jobId: string): string => {
  const root = resolve(artifactsRoot);
  const candidate = resolve(join(root, jobId));
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    // The parser already enforces `isSafeJobId`, but this is defense
    // in depth — a jobId that resolves outside the root is treated as
    // unknown.
    throw new RangeError(
      `verifyJobEvidence: jobId '${jobId}' escapes artifactsRoot`,
    );
  }
  return candidate;
};

const resolveArtifactsDir = async (
  artifactsRoot: string,
  jobId: string,
): Promise<{ status: "job_not_found" } | { status: "ok"; path: string }> => {
  const direct = ensureExpectedDir(artifactsRoot, jobId);
  try {
    const stats = await stat(direct);
    if (stats.isDirectory()) return { status: "ok", path: direct };
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
  const nested = resolve(join(artifactsRoot, "jobs", jobId, "test-intelligence"));
  try {
    const stats = await stat(nested);
    if (stats.isDirectory()) return { status: "ok", path: nested };
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }
  return { status: "job_not_found" };
};

const safeReadDirNames = async (path: string): Promise<string[]> => {
  try {
    return await readdir(path);
  } catch (err) {
    if (isENOENT(err)) return [];
    throw err;
  }
};

const isAttestationFailureCode = (
  code: Wave1PocAttestationVerificationFailure["code"],
): EvidenceVerifyFailureCode => code;

/**
 * Verify all on-disk evidence for the job. Returns a discriminated
 * union: `job_not_found` (no job dir at all), `no_evidence` (job dir
 * exists but no manifest), or `ok` with the deterministic response
 * body.
 *
 * Never throws on a missing/mutated artifact — every such condition is
 * surfaced inside the `failures` list.
 */
export const verifyJobEvidence = async (
  input: VerifyJobEvidenceInput,
): Promise<EvidenceVerifyResult> => {
  const resolvedDir = await resolveArtifactsDir(
    input.artifactsRoot,
    input.jobId,
  );
  if (resolvedDir.status !== "ok") {
    return { status: "job_not_found" };
  }
  const artifactsDir = resolvedDir.path;

  const manifestPath = join(
    artifactsDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  if (!(await fileExists(manifestPath))) {
    return { status: "no_evidence" };
  }

  // Try to verify; only manifest read/parse/schema failures are
  // converted into a completed verification response. Operational
  // filesystem errors still bubble to the HTTP layer as server errors.
  let manifest: Wave1PocEvidenceManifest;
  let missing: string[] = [];
  let mutated: string[] = [];
  let resized: string[] = [];
  let unexpected: string[] = [];
  try {
    const verifyResult = await verifyWave1PocEvidenceFromDisk(artifactsDir, {
      rejectUnexpected: false,
    });
    manifest = verifyResult.manifest;
    missing = verifyResult.result.missing;
    mutated = verifyResult.result.mutated;
    resized = verifyResult.result.resized;
    unexpected = verifyResult.result.unexpected;
  } catch (err) {
    if (!isManifestReadOrParseError(err)) throw err;
    return {
      status: "ok",
      body: buildEmptyManifestResponse(input),
    };
  }

  const manifestSha256 = computeWave1PocEvidenceManifestDigest(manifest);
  const checks: EvidenceVerifyCheck[] = [];
  const failures: EvidenceVerifyFailure[] = [];
  const manifestMetadataIssues =
    validateWave1PocEvidenceManifestMetadata(manifest);
  const manifestMetadataOk = manifestMetadataIssues.length === 0;
  const manifestDigestWitness = await readManifestDigestWitness(artifactsDir);
  const manifestDigestWitnessOk = manifestDigestWitness === manifestSha256;
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const artifacts = Array.isArray(manifestRecord["artifacts"])
    ? manifest.artifacts
    : [];

  // Per-artifact SHA-256 checks. Sorted by filename below.
  for (const artifact of artifacts) {
    if (!isRecord(artifact)) continue;
    const rawRef = artifact["filename"];
    if (typeof rawRef !== "string") continue;
    const ref = safeReference(rawRef);
    let ok = true;
    let failureCode: EvidenceVerifyFailureCode | undefined;
    if (missing.includes(rawRef)) {
      ok = false;
      failureCode = "artifact_missing";
      pushIfAbsent(failures, {
        code: "artifact_missing",
        reference: ref,
        message: failureMessageFor("artifact_missing", ref),
      });
    } else if (mutated.includes(rawRef)) {
      ok = false;
      failureCode = "artifact_mutated";
      pushIfAbsent(failures, {
        code: "artifact_mutated",
        reference: ref,
        message: failureMessageFor("artifact_mutated", ref),
      });
    } else if (resized.includes(rawRef)) {
      ok = false;
      failureCode = "artifact_resized";
      pushIfAbsent(failures, {
        code: "artifact_resized",
        reference: ref,
        message: failureMessageFor("artifact_resized", ref),
      });
    }
    const check: EvidenceVerifyCheck = failureCode
      ? { kind: "artifact_sha256", reference: ref, ok, failureCode }
      : { kind: "artifact_sha256", reference: ref, ok };
    checks.push(check);
  }

  // Independently mark resized+mutated artifacts. The per-artifact
  // check row carries one primary failure code, while failures[] keeps
  // both signals visible to auditors.
  for (const filename of resized) {
    if (mutated.includes(filename)) {
      const ref = safeReference(filename);
      pushIfAbsent(failures, {
        code: "artifact_resized",
        reference: ref,
        message: failureMessageFor("artifact_resized", ref),
      });
    }
  }

  // Manifest-level checks are classified independently: metadata
  // invariants come from the manifest verifier, while the digest
  // witness is compared against the canonical manifest digest.
  const manifestRef = WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME;
  checks.push({
    kind: "manifest_metadata",
    reference: manifestRef,
    ok: manifestMetadataOk,
    ...(manifestMetadataOk
      ? {}
      : { failureCode: "manifest_metadata_invalid" as const }),
  });
  if (!manifestMetadataOk) {
    pushIfAbsent(failures, {
      code: "manifest_metadata_invalid",
      reference: manifestRef,
      message: failureMessageFor("manifest_metadata_invalid", manifestRef),
    });
  }

  checks.push({
    kind: "manifest_digest_witness",
    reference: manifestRef,
    ok: manifestDigestWitnessOk,
    ...(manifestDigestWitnessOk
      ? {}
      : { failureCode: "manifest_digest_witness_invalid" as const }),
  });
  if (!manifestDigestWitnessOk) {
    pushIfAbsent(failures, {
      code: "manifest_digest_witness_invalid",
      reference: manifestRef,
      message: failureMessageFor(
        "manifest_digest_witness_invalid",
        manifestRef,
      ),
    });
  }

  // Visual-sidecar evidence presence check.
  const visualSidecarMissingFor = await detectVisualSidecarEvidenceMissing(
    artifactsDir,
    manifest,
  );
  checks.push({
    kind: "visual_sidecar_evidence",
    reference:
      visualSidecarMissingFor ?? VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
    ok: visualSidecarMissingFor === undefined,
    ...(visualSidecarMissingFor !== undefined
      ? { failureCode: "visual_sidecar_evidence_missing" as const }
      : {}),
  });
  if (visualSidecarMissingFor !== undefined) {
    pushIfAbsent(failures, {
      code: "visual_sidecar_evidence_missing",
      reference: visualSidecarMissingFor,
      message: failureMessageFor(
        "visual_sidecar_evidence_missing",
        visualSidecarMissingFor,
      ),
    });
  }

  // Unexpected files (only when the underlying verifier emits them; we
  // pass `rejectUnexpected: false` so this list stays empty for normal
  // runs).
  for (const filename of unexpected) {
    const ref = safeReference(filename);
    pushIfAbsent(failures, {
      code: "unexpected_artifact",
      reference: ref,
      message: failureMessageFor("unexpected_artifact", ref),
    });
  }

  // Optional in-toto attestation block.
  let attestationSummary: EvidenceVerifyResponse["attestation"];
  const attestationPath = join(
    artifactsDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  );
  if ((await fileExists(attestationPath)) && manifestMetadataOk) {
    const expectedSigningMode =
      await detectAttestationSigningMode(artifactsDir);
    const attestationResult = await verifyWave1PocAttestationFromDisk(
      artifactsDir,
      manifest,
      manifestSha256,
      { expectedSigningMode },
    );
    attestationSummary = {
      present: true,
      signingMode: attestationResult.signingMode,
      signatureCount: attestationResult.signatureCount,
      signaturesVerified: attestationResult.signaturesVerified,
    };
    checks.push({
      kind: "attestation_envelope",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      ok: attestationResult.failures.every(
        (failure) =>
          failure.code !== "envelope_unparseable" &&
          failure.code !== "envelope_payload_type_mismatch" &&
          failure.code !== "envelope_payload_decode_failed" &&
          failure.code !== "statement_unparseable" &&
          failure.code !== "statement_type_mismatch" &&
          failure.code !== "statement_predicate_type_mismatch" &&
          failure.code !== "statement_predicate_invalid" &&
          failure.code !== "subject_missing_artifact" &&
          failure.code !== "subject_digest_mismatch" &&
          failure.code !== "subject_unattested_artifact" &&
          failure.code !== "manifest_sha256_mismatch",
      ),
      signingMode: expectedSigningMode,
    });
    checks.push({
      kind: "attestation_signatures",
      reference: WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
      ok:
        attestationResult.signaturesVerified ||
        expectedSigningMode === "unsigned"
          ? attestationResult.failures.every(
              (failure) =>
                failure.code !== "signing_mode_mismatch" &&
                failure.code !== "signature_required" &&
                failure.code !==
                  "signature_unsigned_envelope_carries_signatures" &&
                failure.code !== "signature_invalid_keyid" &&
                failure.code !== "signature_invalid_encoding" &&
                failure.code !== "signature_unverified" &&
                failure.code !== "bundle_missing" &&
                failure.code !== "bundle_envelope_mismatch" &&
                failure.code !== "bundle_public_key_missing",
            )
          : false,
      signingMode: expectedSigningMode,
    });
    for (const attestationFailure of attestationResult.failures) {
      pushIfAbsent(failures, {
        code: isAttestationFailureCode(attestationFailure.code),
        reference: safeReference(attestationFailure.reference),
        message: failureMessageFor(
          isAttestationFailureCode(attestationFailure.code),
          safeReference(attestationFailure.reference),
        ),
      });
    }
  }

  // Defensive read: confirm the artifacts dir is still readable. We
  // do not surface its content; this catches catastrophic permission
  // failures that the underlying verifiers would otherwise hide.
  await safeReadDirNames(artifactsDir);

  const sortedChecks = sortChecks(checks);
  const sortedFailures = sortFailures(failures);
  const ok = sortedFailures.length === 0;

  const visualSidecar = manifestRecord["visualSidecar"];
  const visualSidecarCaptureIdentities =
    manifestRecord["visualSidecarCaptureIdentities"];
  const visualSidecarSummary = isRecord(visualSidecar)
    ? {
        ...(typeof visualSidecar["selectedDeployment"] === "string"
          ? { selectedDeployment: visualSidecar["selectedDeployment"] }
          : {}),
        fallbackUsed: visualSidecar["fallbackReason"] !== "none",
        ...(typeof visualSidecar["resultArtifactSha256"] === "string"
          ? { resultArtifactSha256: visualSidecar["resultArtifactSha256"] }
          : {}),
        ...(Array.isArray(visualSidecarCaptureIdentities)
          ? { captureIdentityCount: visualSidecarCaptureIdentities.length }
          : {}),
      }
    : undefined;
  const modelDeployments = manifestRecord["modelDeployments"];
  let modelDeploymentSummary: EvidenceVerifyResponse["modelDeployments"];
  if (
    isRecord(modelDeployments) &&
    typeof modelDeployments["testGeneration"] === "string"
  ) {
    modelDeploymentSummary = {
      testGeneration: modelDeployments["testGeneration"],
      ...(typeof modelDeployments["visualPrimary"] === "string"
        ? { visualPrimary: modelDeployments["visualPrimary"] }
        : {}),
      ...(typeof modelDeployments["visualFallback"] === "string"
        ? { visualFallback: modelDeployments["visualFallback"] }
        : {}),
    };
  }

  const body: EvidenceVerifyResponse = {
    schemaVersion: EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
    verifiedAt: input.verifiedAt,
    jobId: input.jobId,
    ok,
    manifestSha256,
    manifestSchemaVersion: manifest.schemaVersion,
    testIntelligenceContractVersion: manifest.testIntelligenceContractVersion,
    ...(modelDeploymentSummary !== undefined
      ? { modelDeployments: modelDeploymentSummary }
      : {}),
    ...(visualSidecarSummary !== undefined
      ? { visualSidecar: visualSidecarSummary }
      : {}),
    ...(attestationSummary !== undefined
      ? { attestation: attestationSummary }
      : {}),
    checks: sortedChecks,
    failures: sortedFailures,
  };
  return { status: "ok", body };
};
