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
 *     secret material. Only filenames (basenames), SHA-256 digests,
 *     and identity stamps appear.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

import {
  EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  WAVE1_POC_ATTESTATION_BUNDLE_FILENAME,
  WAVE1_POC_ATTESTATIONS_DIRECTORY,
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
 * Pull the (basename) reference from a verification failure produced
 * by `verifyWave1PocAttestation`. The upstream `reference` field may
 * already be a basename, but a manifest-relative path could include
 * directory segments, so we normalize to the leaf name to keep the
 * response body free of any path information.
 */
const safeReference = (value: string): string => {
  if (value.length === 0) return value;
  if (isAbsolute(value)) return basename(value);
  if (value.includes("/")) {
    const parts = value.split("/");
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
  const attestedVisualResult = manifest.artifacts.find(
    (artifact) => artifact.filename === VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME,
  );

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
    }
  }

  // Case B: manifest attests the result artifact but leaves the
  // `visualSidecar` summary block unset.
  if (
    attestedVisualResult !== undefined &&
    manifestVisualSidecar === undefined
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
    (manifestVisualSidecar === undefined || attestedVisualResult === undefined)
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
  const artifactsDir = ensureExpectedDir(input.artifactsRoot, input.jobId);

  let dirExists = false;
  try {
    const stats = await stat(artifactsDir);
    dirExists = stats.isDirectory();
  } catch (err) {
    if (isENOENT(err)) {
      return { status: "job_not_found" };
    }
    throw err;
  }
  if (!dirExists) {
    return { status: "job_not_found" };
  }

  const manifestPath = join(
    artifactsDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  if (!(await fileExists(manifestPath))) {
    return { status: "no_evidence" };
  }

  // Try to verify; the only documented throw path is an
  // unparseable / contract-mismatched manifest. Surface that as a
  // 200 body with `manifest_unparseable`.
  let manifest: Wave1PocEvidenceManifest;
  let verificationOk: boolean;
  let missing: string[] = [];
  let mutated: string[] = [];
  let resized: string[] = [];
  let unexpected: string[] = [];
  try {
    const verifyResult = await verifyWave1PocEvidenceFromDisk(artifactsDir, {
      rejectUnexpected: false,
    });
    manifest = verifyResult.manifest;
    verificationOk = verifyResult.result.ok;
    missing = verifyResult.result.missing;
    mutated = verifyResult.result.mutated;
    resized = verifyResult.result.resized;
    unexpected = verifyResult.result.unexpected;
  } catch {
    return {
      status: "ok",
      body: buildEmptyManifestResponse(input),
    };
  }

  const manifestSha256 = computeWave1PocEvidenceManifestDigest(manifest);
  const checks: EvidenceVerifyCheck[] = [];
  const failures: EvidenceVerifyFailure[] = [];

  // Per-artifact SHA-256 checks. Sorted by filename below.
  for (const artifact of manifest.artifacts) {
    const ref = artifact.filename;
    let ok = true;
    let failureCode: EvidenceVerifyFailureCode | undefined;
    if (missing.includes(ref)) {
      ok = false;
      failureCode = "artifact_missing";
      pushIfAbsent(failures, {
        code: "artifact_missing",
        reference: ref,
        message: failureMessageFor("artifact_missing", ref),
      });
    } else if (mutated.includes(ref)) {
      ok = false;
      failureCode = "artifact_mutated";
      pushIfAbsent(failures, {
        code: "artifact_mutated",
        reference: ref,
        message: failureMessageFor("artifact_mutated", ref),
      });
    } else if (resized.includes(ref)) {
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

  // Independently mark resized artifacts that did not also mutate
  // (the underlying verifier reports both lists, but the per-artifact
  // loop above only emits one failure per filename — record the second
  // failure so auditors see both signals).
  for (const filename of resized) {
    if (mutated.includes(filename)) {
      pushIfAbsent(failures, {
        code: "artifact_resized",
        reference: filename,
        message: failureMessageFor("artifact_resized", filename),
      });
    }
  }
  for (const filename of mutated) {
    if (resized.includes(filename)) {
      pushIfAbsent(failures, {
        code: "artifact_mutated",
        reference: filename,
        message: failureMessageFor("artifact_mutated", filename),
      });
    }
  }

  // Manifest-level checks. The underlying verifier signals a manifest
  // metadata or digest-witness failure by adding the manifest filename
  // to `mutated`.
  const manifestRef = WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME;
  const manifestFailureSignaled = mutated.includes(manifestRef);
  // Heuristic split: the static `Wave1PocEvidenceManifest` type narrows
  // these fields to literal `"1.0.0"` / `false` values, but at runtime
  // the manifest came from `JSON.parse` and may carry anything — so
  // treat the loaded manifest as `Record<string, unknown>` for the
  // invariant probe. When any of the literal invariants is runtime-
  // violated, surface as `manifest_metadata_invalid`; otherwise the
  // upstream signal is a digest-witness mismatch.
  const manifestRecord = manifest as unknown as Record<string, unknown>;
  const metadataInvariantsLook =
    manifestRecord["testIntelligenceContractVersion"] ===
      TEST_INTELLIGENCE_CONTRACT_VERSION &&
    manifestRecord["rawScreenshotsIncluded"] === false &&
    manifestRecord["imagePayloadSentToTestGeneration"] === false;
  if (manifestFailureSignaled && !metadataInvariantsLook) {
    checks.push({
      kind: "manifest_metadata",
      reference: manifestRef,
      ok: false,
      failureCode: "manifest_metadata_invalid",
    });
    pushIfAbsent(failures, {
      code: "manifest_metadata_invalid",
      reference: manifestRef,
      message: failureMessageFor("manifest_metadata_invalid", manifestRef),
    });
  } else {
    checks.push({
      kind: "manifest_metadata",
      reference: manifestRef,
      ok: !manifestFailureSignaled,
      ...(manifestFailureSignaled
        ? { failureCode: "manifest_digest_witness_invalid" as const }
        : {}),
    });
    if (manifestFailureSignaled) {
      pushIfAbsent(failures, {
        code: "manifest_digest_witness_invalid",
        reference: manifestRef,
        message: failureMessageFor(
          "manifest_digest_witness_invalid",
          manifestRef,
        ),
      });
    }
  }

  // Manifest digest witness — emit a stable check row regardless of
  // outcome. The underlying verifier folded the witness check into
  // `mutated`; the manifest-metadata branch above already emitted a
  // failure for either case, so this row mirrors that ok-state.
  checks.push({
    kind: "manifest_digest_witness",
    reference: manifestRef,
    ok: !manifestFailureSignaled,
    ...(manifestFailureSignaled
      ? { failureCode: "manifest_digest_witness_invalid" as const }
      : {}),
  });

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
    pushIfAbsent(failures, {
      code: "unexpected_artifact",
      reference: filename,
      message: failureMessageFor("unexpected_artifact", filename),
    });
  }

  // Optional in-toto attestation block.
  let attestationSummary: EvidenceVerifyResponse["attestation"];
  const attestationPath = join(
    artifactsDir,
    WAVE1_POC_ATTESTATIONS_DIRECTORY,
    WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME,
  );
  if (await fileExists(attestationPath)) {
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

  // Determine the manifest's known artifact set; when `verifyResult`
  // signaled `ok: true`, the upstream verification passed clean — the
  // manifest filenames must all appear as `ok: true` artifact_sha256
  // rows. (Defensive: if the on-disk run dir contains files unrelated
  // to the attested set we leave them alone unless rejectUnexpected
  // surfaces them.)
  void verificationOk;
  // Defensive read: confirm the artifacts dir is still readable. We
  // do not surface its content; this catches catastrophic permission
  // failures that the underlying verifiers would otherwise hide.
  await safeReadDirNames(artifactsDir);

  const sortedChecks = sortChecks(checks);
  const sortedFailures = sortFailures(failures);
  const ok = sortedFailures.length === 0;

  const visualSidecarSummary = manifest.visualSidecar
    ? {
        selectedDeployment: manifest.visualSidecar.selectedDeployment,
        fallbackUsed: manifest.visualSidecar.fallbackReason !== "none",
        resultArtifactSha256: manifest.visualSidecar.resultArtifactSha256,
      }
    : undefined;

  const body: EvidenceVerifyResponse = {
    schemaVersion: EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION,
    verifiedAt: input.verifiedAt,
    jobId: input.jobId,
    ok,
    manifestSha256,
    manifestSchemaVersion: manifest.schemaVersion,
    testIntelligenceContractVersion: manifest.testIntelligenceContractVersion,
    modelDeployments: {
      testGeneration: manifest.modelDeployments.testGeneration,
      ...(manifest.modelDeployments.visualPrimary !== undefined
        ? { visualPrimary: manifest.modelDeployments.visualPrimary }
        : {}),
      ...(manifest.modelDeployments.visualFallback !== undefined
        ? { visualFallback: manifest.modelDeployments.visualFallback }
        : {}),
    },
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
