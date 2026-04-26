/**
 * Wave 1 POC evidence manifest builder + verifier (Issue #1366).
 *
 * The manifest is an attestation of the artifacts a POC run produced:
 * for each artifact it stores the SHA-256 of the on-disk byte stream and
 * the byte length, plus the contract / template / schema / policy / model
 * identities that were active during the run. The manifest carries a
 * self-attestation hash over its own metadata and artifact list, and is
 * persisted alongside the artifacts so a future verifier can detect
 * tampering by re-hashing each file and comparing against the manifest.
 *
 * Two negative invariants are stamped explicitly:
 *
 *   - `rawScreenshotsIncluded: false`
 *   - `imagePayloadSentToTestGeneration: false`
 *
 * Both are TYPE-LEVEL `false` literals on the manifest interface so they
 * cannot be silently flipped — any caller that tries to assemble a
 * manifest with `true` must change the type, which the contract review
 * gate would catch.
 */

import { createHash } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  type Wave1PocEvidenceArtifact,
  type Wave1PocEvidenceArtifactCategory,
  type Wave1PocEvidenceManifest,
  type Wave1PocEvidenceVerificationResult,
  type Wave1PocFixtureId,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const HEX64 = /^[0-9a-f]{64}$/;
const VISUAL_DEPLOYMENTS = new Set([
  "llama-4-maverick-vision",
  "phi-4-multimodal-poc",
  "mock",
  "none",
]);
const TEST_GENERATION_DEPLOYMENTS = new Set([
  "gpt-oss-120b",
  "gpt-oss-120b-mock",
  "mock",
]);

const hasControlCharacter = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

/**
 * Why-detail-bearing filename validator. Returns a discriminated result
 * so callers can render a specific diagnostic instead of a generic
 * "invalid filename" string. The boolean form `isSafeArtifactPath` is
 * preserved for the verifier hot path where the reason is irrelevant.
 */
const validateArtifactPath = (
  value: string,
):
  | { ok: true }
  | {
      ok: false;
      reason:
        | "empty"
        | "absolute"
        | "backslash"
        | "control_characters"
        | "exceeds_total_byte_length"
        | "path_traversal"
        | "segment_exceeds_byte_length";
    } => {
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (isAbsolute(value)) return { ok: false, reason: "absolute" };
  if (value.includes("\\")) return { ok: false, reason: "backslash" };
  if (hasControlCharacter(value)) {
    return { ok: false, reason: "control_characters" };
  }
  if (new TextEncoder().encode(value).byteLength > 512) {
    return { ok: false, reason: "exceeds_total_byte_length" };
  }
  const parts = value.split("/");
  if (
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    return { ok: false, reason: "path_traversal" };
  }
  if (parts.some((part) => new TextEncoder().encode(part).byteLength > 255)) {
    return { ok: false, reason: "segment_exceeds_byte_length" };
  }
  return { ok: true };
};

const REASON_DIAGNOSTIC: Record<
  Exclude<ReturnType<typeof validateArtifactPath>, { ok: true }>["reason"],
  string
> = {
  empty: "filename must not be empty",
  absolute: "filename must be a relative path, not absolute",
  backslash: "filename contains backslash (must be POSIX-style)",
  control_characters: "filename contains control characters",
  exceeds_total_byte_length: "filename exceeds 512 bytes",
  path_traversal:
    "filename contains path traversal segment (`.`, `..`, or empty)",
  segment_exceeds_byte_length: "filename segment exceeds 255 bytes",
};

const isSafeArtifactPath = (value: string): boolean =>
  validateArtifactPath(value).ok;

const resolveArtifactPath = (rootDir: string, filename: string): string => {
  const check = validateArtifactPath(filename);
  if (!check.ok) {
    throw new RangeError(
      `invalid artifact filename "${filename}": ${REASON_DIAGNOSTIC[check.reason]}`,
    );
  }
  const root = resolve(rootDir);
  const resolved = resolve(root, filename);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new RangeError(`artifact filename escapes run dir "${filename}"`);
  }
  return resolved;
};

/** Input record describing a single artifact attested by the manifest. */
export interface BuildEvidenceArtifactRecord {
  filename: string;
  /** Raw bytes that were/will be persisted. */
  bytes: Uint8Array | Buffer;
  category: Wave1PocEvidenceArtifactCategory;
}

export interface BuildWave1PocEvidenceManifestInput {
  fixtureId: Wave1PocFixtureId;
  jobId: string;
  generatedAt: string;
  /** Identities of the deployments behind the run. */
  modelDeployments: Wave1PocEvidenceManifest["modelDeployments"];
  policyProfileId: string;
  policyProfileVersion: string;
  exportProfileId: string;
  exportProfileVersion: string;
  /** Replay-cache identity hashes (mirrors the compiled prompt). */
  promptHash: string;
  schemaHash: string;
  inputHash: string;
  cacheKeyDigest: string;
  /** Each artifact byte stream attested by this manifest. */
  artifacts: ReadonlyArray<BuildEvidenceArtifactRecord>;
  /** Direct visual-sidecar summary when the opt-in sidecar path ran. */
  visualSidecar?: Wave1PocEvidenceManifest["visualSidecar"];
  /**
   * Hard invariant flag — must be `false` (the contract requires it).
   * Defaulted to `false` so most callers can omit it.
   */
  rawScreenshotsIncluded?: false;
  /** Hard invariant flag — must be `false`. Defaulted to `false`. */
  imagePayloadSentToTestGeneration?: false;
}

const toBytes = (value: Uint8Array | Buffer): Uint8Array => {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return value;
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

const sha256OfBytes = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex");
};

export const computeWave1PocEvidenceManifestDigest = (
  manifest: Wave1PocEvidenceManifest,
): string => sha256OfBytes(new TextEncoder().encode(canonicalJson(manifest)));

const omitManifestIntegrity = (
  manifest: Wave1PocEvidenceManifest,
): Omit<Wave1PocEvidenceManifest, "manifestIntegrity"> => {
  const unsignedManifest = { ...manifest };
  delete unsignedManifest.manifestIntegrity;
  return unsignedManifest;
};

const computeWave1PocEvidenceManifestIntegrityHash = (
  manifest: Wave1PocEvidenceManifest,
): string =>
  sha256OfBytes(
    new TextEncoder().encode(canonicalJson(omitManifestIntegrity(manifest))),
  );

const withWave1PocEvidenceManifestIntegrity = (
  manifest: Wave1PocEvidenceManifest,
): Wave1PocEvidenceManifest => {
  const unsignedManifest = omitManifestIntegrity(manifest);
  const hash = computeWave1PocEvidenceManifestIntegrityHash(manifest);
  return {
    ...unsignedManifest,
    manifestIntegrity: { algorithm: "sha256", hash },
  };
};

/**
 * Build a deterministic evidence manifest from the input bundle. The
 * artifact list is sorted by filename and de-duplicated; later
 * occurrences of the same filename overwrite earlier ones so callers may
 * "stamp" a final value (e.g. when the manifest itself appears in the
 * list as the last record).
 */
export const buildWave1PocEvidenceManifest = (
  input: BuildWave1PocEvidenceManifestInput,
): Wave1PocEvidenceManifest => {
  for (const hashField of [
    "promptHash",
    "schemaHash",
    "inputHash",
    "cacheKeyDigest",
  ] as const) {
    if (!HEX64.test(input[hashField])) {
      throw new RangeError(
        `buildWave1PocEvidenceManifest: ${hashField} must be a sha256 hex string`,
      );
    }
  }
  if (
    input.visualSidecar !== undefined &&
    !HEX64.test(input.visualSidecar.resultArtifactSha256)
  ) {
    throw new RangeError(
      "buildWave1PocEvidenceManifest: visualSidecar.resultArtifactSha256 must be a sha256 hex string",
    );
  }

  const seen = new Map<string, Wave1PocEvidenceArtifact>();
  for (const record of input.artifacts) {
    const filename = record.filename;
    const check = validateArtifactPath(filename);
    if (!check.ok) {
      throw new RangeError(
        `buildWave1PocEvidenceManifest: invalid artifact filename "${record.filename}" — ${REASON_DIAGNOSTIC[check.reason]}`,
      );
    }
    const bytes = toBytes(record.bytes);
    seen.set(filename, {
      filename,
      sha256: sha256OfBytes(bytes),
      bytes: bytes.byteLength,
      category: record.category,
    });
  }
  const artifacts = Array.from(seen.values()).sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  );

  const manifest: Wave1PocEvidenceManifest = {
    schemaVersion: WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    testIntelligenceContractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    fixtureId: input.fixtureId,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedTestCaseSchemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    policyProfileId: input.policyProfileId,
    policyProfileVersion: input.policyProfileVersion,
    exportProfileId: input.exportProfileId,
    exportProfileVersion: input.exportProfileVersion,
    modelDeployments: { ...input.modelDeployments },
    promptHash: input.promptHash,
    schemaHash: input.schemaHash,
    inputHash: input.inputHash,
    cacheKeyDigest: input.cacheKeyDigest,
    ...(input.visualSidecar !== undefined
      ? { visualSidecar: input.visualSidecar }
      : {}),
    artifacts,
    rawScreenshotsIncluded: false,
    imagePayloadSentToTestGeneration: false,
  };
  return withWave1PocEvidenceManifestIntegrity(manifest);
};

export interface WriteWave1PocEvidenceManifestInput {
  manifest: Wave1PocEvidenceManifest;
  destinationDir: string;
}

/**
 * Persist the evidence manifest and its digest witness atomically using
 * `${path}.${pid}.tmp` renames.
 */
export const writeWave1PocEvidenceManifest = async (
  input: WriteWave1PocEvidenceManifestInput,
): Promise<string> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  const manifest = withWave1PocEvidenceManifestIntegrity(input.manifest);
  const serialized = canonicalJson(manifest);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  const digestPath = join(
    input.destinationDir,
    WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME,
  );
  const digestTmp = `${digestPath}.${process.pid}.tmp`;
  await writeFile(
    digestTmp,
    `${computeWave1PocEvidenceManifestDigest(manifest)}\n`,
    "utf8",
  );
  await rename(digestTmp, digestPath);
  return path;
};

export interface VerifyWave1PocEvidenceManifestInput {
  /** The manifest payload (typically the in-memory copy or a re-parsed file). */
  manifest: Wave1PocEvidenceManifest;
  /** The directory containing the artifacts the manifest attests. */
  artifactsDir: string;
  /**
   * Trusted digest of the canonical manifest from immutable run metadata or an
   * in-memory pre-write copy. When supplied, valid-looking metadata rewrites
   * fail closed instead of being treated as authoritative.
   */
  expectedManifestSha256?: string;
  /**
   * When true, files in `artifactsDir` that are NOT attested by the
   * manifest are reported under `unexpected`. Defaults to `false` so a
   * job directory can carry sibling files (logs, transient snapshots)
   * without breaking verification.
   */
  rejectUnexpected?: boolean;
}

export class Wave1PocEvidenceManifestLoadError extends Error {
  readonly reason:
    | "manifest_missing"
    | "manifest_unparseable"
    | "manifest_schema_mismatch";

  constructor(
    reason: Wave1PocEvidenceManifestLoadError["reason"],
    manifestPath: string,
  ) {
    super(`verifyWave1PocEvidenceFromDisk: ${reason} in ${manifestPath}`);
    this.name = "Wave1PocEvidenceManifestLoadError";
    this.reason = reason;
  }
}

const isENOENT = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

const markManifestMutated = (
  result: Wave1PocEvidenceVerificationResult,
): Wave1PocEvidenceVerificationResult => {
  const mutated = new Set(result.mutated);
  mutated.add(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME);
  return {
    ...result,
    ok: false,
    mutated: Array.from(mutated).sort(),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isVerifiableArtifact = (
  artifact: unknown,
): artifact is Wave1PocEvidenceArtifact => {
  if (!isRecord(artifact)) return false;
  return (
    typeof artifact["filename"] === "string" &&
    isSafeArtifactPath(artifact["filename"]) &&
    typeof artifact["sha256"] === "string" &&
    HEX64.test(artifact["sha256"]) &&
    typeof artifact["bytes"] === "number" &&
    Number.isSafeInteger(artifact["bytes"]) &&
    artifact["bytes"] >= 0
  );
};

const hasOnlyKnownKeys = (
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean => Object.keys(value).every((key) => allowed.has(key));

export const validateWave1PocEvidenceManifestMetadata = (
  manifest: Wave1PocEvidenceManifest,
): string[] => {
  const issues: string[] = [];
  const raw = manifest as unknown as Record<string, unknown>;

  if (raw["rawScreenshotsIncluded"] !== false) {
    issues.push("rawScreenshotsIncluded must be false");
  }
  if (raw["imagePayloadSentToTestGeneration"] !== false) {
    issues.push("imagePayloadSentToTestGeneration must be false");
  }
  for (const hashField of [
    "promptHash",
    "schemaHash",
    "inputHash",
    "cacheKeyDigest",
  ] as const) {
    if (typeof raw[hashField] !== "string" || !HEX64.test(raw[hashField])) {
      issues.push(`${hashField} must be a sha256 hex string`);
    }
  }

  const deployments = raw["modelDeployments"];
  if (!isRecord(deployments)) {
    issues.push("modelDeployments must be an object");
  } else {
    const allowedKeys = new Set([
      "testGeneration",
      "visualPrimary",
      "visualFallback",
    ]);
    if (!hasOnlyKnownKeys(deployments, allowedKeys)) {
      issues.push("modelDeployments contains unknown keys");
    }
    if (
      typeof deployments["testGeneration"] !== "string" ||
      deployments["testGeneration"].length === 0
    ) {
      issues.push("modelDeployments.testGeneration must be a non-empty string");
    } else if (
      !TEST_GENERATION_DEPLOYMENTS.has(deployments["testGeneration"])
    ) {
      issues.push("modelDeployments.testGeneration has an unknown deployment");
    }
    for (const key of ["visualPrimary", "visualFallback"] as const) {
      const deployment = deployments[key];
      if (
        deployment !== undefined &&
        (typeof deployment !== "string" || !VISUAL_DEPLOYMENTS.has(deployment))
      ) {
        issues.push(`modelDeployments.${key} has an unknown deployment`);
      }
    }
  }

  if (manifest.visualSidecar !== undefined) {
    const visualSidecar = manifest.visualSidecar as unknown;
    if (!isRecord(visualSidecar)) {
      issues.push("visualSidecar must be an object");
      return issues;
    }
    if (
      typeof visualSidecar["resultArtifactSha256"] !== "string" ||
      !HEX64.test(visualSidecar["resultArtifactSha256"])
    ) {
      issues.push(
        "visualSidecar.resultArtifactSha256 must be a sha256 hex string",
      );
    }
    const deployment = visualSidecar["selectedDeployment"];
    if (typeof deployment !== "string" || !VISUAL_DEPLOYMENTS.has(deployment)) {
      issues.push("visualSidecar.selectedDeployment has an unknown deployment");
    }
  }

  if (!Array.isArray(manifest.artifacts)) {
    issues.push("artifacts must be an array");
    return issues;
  }
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact)) {
      issues.push("artifact entry must be an object");
      continue;
    }
    const record = artifact;
    const filename = record["filename"];
    if (typeof filename !== "string" || !isSafeArtifactPath(filename)) {
      issues.push("artifact filename is invalid");
    }
    if (typeof record["sha256"] !== "string" || !HEX64.test(record["sha256"])) {
      issues.push(`artifact ${filename} has an invalid sha256`);
    }
    if (
      typeof record["bytes"] !== "number" ||
      !Number.isSafeInteger(record["bytes"]) ||
      record["bytes"] < 0
    ) {
      issues.push(`artifact ${filename} has an invalid byte length`);
    }
  }

  return issues;
};

const evaluateManifestIntegrity = (
  manifest: Wave1PocEvidenceManifest,
):
  | {
      algorithm: "sha256";
      actualHash: string;
      expectedHash?: string;
      ok: boolean;
    }
  | undefined => {
  const actualHash = computeWave1PocEvidenceManifestIntegrityHash(manifest);
  const raw = manifest as unknown as Record<string, unknown>;
  const integrity = raw["manifestIntegrity"];

  if (integrity === undefined) {
    if (manifest.contractVersion === CONTRACT_VERSION) {
      return { algorithm: "sha256", actualHash, ok: false };
    }
    return undefined;
  }

  if (!isRecord(integrity)) {
    return { algorithm: "sha256", actualHash, ok: false };
  }

  if (!hasOnlyKnownKeys(integrity, new Set(["algorithm", "hash"]))) {
    return { algorithm: "sha256", actualHash, ok: false };
  }

  const algorithm = integrity["algorithm"];
  const expectedHash = integrity["hash"];
  if (algorithm !== "sha256" || typeof expectedHash !== "string") {
    return { algorithm: "sha256", actualHash, ok: false };
  }
  if (!HEX64.test(expectedHash)) {
    return {
      algorithm: "sha256",
      actualHash,
      expectedHash,
      ok: false,
    };
  }

  return {
    algorithm: "sha256",
    actualHash,
    expectedHash,
    ok: expectedHash === actualHash,
  };
};

/**
 * Verify on-disk artifacts against the attested manifest. Returns a
 * structured result documenting any mismatches; the function NEVER
 * throws on a missing or mutated artifact — verification is fail-closed
 * but observability-rich, so callers can log the precise failure mode.
 */
export const verifyWave1PocEvidenceManifest = async (
  input: VerifyWave1PocEvidenceManifestInput,
): Promise<Wave1PocEvidenceVerificationResult> => {
  const missing: string[] = [];
  const mutated: string[] = [];
  const resized: string[] = [];
  const metadataIssues = validateWave1PocEvidenceManifestMetadata(
    input.manifest,
  );
  const manifestIntegrity = evaluateManifestIntegrity(input.manifest);
  if (metadataIssues.length > 0) {
    mutated.push(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME);
  }
  if (
    manifestIntegrity !== undefined &&
    !manifestIntegrity.ok &&
    !mutated.includes(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME)
  ) {
    mutated.push(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME);
  }
  if (
    input.expectedManifestSha256 !== undefined &&
    computeWave1PocEvidenceManifestDigest(input.manifest) !==
      input.expectedManifestSha256 &&
    !mutated.includes(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME)
  ) {
    mutated.push(WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME);
  }

  const artifacts = Array.isArray(input.manifest.artifacts)
    ? input.manifest.artifacts.filter(isVerifiableArtifact)
    : [];

  for (const artifact of artifacts) {
    const path = resolveArtifactPath(input.artifactsDir, artifact.filename);
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      if (isENOENT(err)) {
        missing.push(artifact.filename);
        continue;
      }
      throw err;
    }
    const stats = await stat(path);
    if (stats.size !== artifact.bytes) {
      resized.push(artifact.filename);
    }
    const actualSha = sha256OfBytes(toBytes(bytes));
    if (actualSha !== artifact.sha256) {
      mutated.push(artifact.filename);
    }
  }

  let unexpected: string[] = [];
  if (input.rejectUnexpected === true) {
    const attested = new Set(artifacts.map((a) => a.filename));
    let entries: string[] = [];
    try {
      entries = await readdir(input.artifactsDir);
    } catch (err) {
      if (!isENOENT(err)) throw err;
    }
    unexpected = entries
      .filter((name) => name !== WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME)
      .filter((name) => name !== WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME)
      .filter((name) => !attested.has(name))
      .sort();
  }

  const ok =
    missing.length === 0 &&
    mutated.length === 0 &&
    resized.length === 0 &&
    unexpected.length === 0;

  return {
    ok,
    missing: missing.sort(),
    mutated: mutated.sort(),
    resized: resized.sort(),
    unexpected,
    ...(manifestIntegrity !== undefined ? { manifestIntegrity } : {}),
  };
};

/**
 * Convenience: read a manifest JSON file from disk and verify against the
 * surrounding directory. Throws if the manifest file is missing or
 * unparseable; for those cases there is nothing useful to verify.
 */
export const verifyWave1PocEvidenceFromDisk = async (
  artifactsDir: string,
  options: { rejectUnexpected?: boolean; expectedManifestSha256?: string } = {},
): Promise<{
  manifest: Wave1PocEvidenceManifest;
  result: Wave1PocEvidenceVerificationResult;
}> => {
  const manifestPath = join(
    artifactsDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    if (isENOENT(err)) {
      throw new Wave1PocEvidenceManifestLoadError(
        "manifest_missing",
        manifestPath,
      );
    }
    throw err;
  }
  let parsedRaw: Record<string, unknown>;
  try {
    parsedRaw = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Wave1PocEvidenceManifestLoadError(
      "manifest_unparseable",
      manifestPath,
    );
  }
  if (
    parsedRaw["schemaVersion"] !== WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION ||
    parsedRaw["testIntelligenceContractVersion"] !==
      TEST_INTELLIGENCE_CONTRACT_VERSION
  ) {
    throw new Wave1PocEvidenceManifestLoadError(
      "manifest_schema_mismatch",
      manifestPath,
    );
  }
  const parsed = parsedRaw as unknown as Wave1PocEvidenceManifest;
  let expectedManifestSha256 = options.expectedManifestSha256;
  let digestWitnessInvalid = false;
  if (expectedManifestSha256 === undefined) {
    try {
      const rawDigest = await readFile(
        join(artifactsDir, WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME),
        "utf8",
      );
      const digest = rawDigest.trim();
      if (HEX64.test(digest)) {
        expectedManifestSha256 = digest;
      } else {
        digestWitnessInvalid = true;
      }
    } catch (err) {
      if (isENOENT(err)) {
        digestWitnessInvalid = true;
      } else {
        throw err;
      }
    }
  }
  const result = await verifyWave1PocEvidenceManifest({
    manifest: parsed,
    artifactsDir,
    ...(options.rejectUnexpected !== undefined
      ? { rejectUnexpected: options.rejectUnexpected }
      : {}),
    ...(options.expectedManifestSha256 !== undefined
      ? { expectedManifestSha256: options.expectedManifestSha256 }
      : expectedManifestSha256 !== undefined
        ? { expectedManifestSha256 }
        : {}),
  });
  return {
    manifest: parsed,
    result: digestWitnessInvalid ? markManifestMutated(result) : result,
  };
};
