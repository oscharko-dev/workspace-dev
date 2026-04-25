/**
 * Wave 1 POC evidence manifest builder + verifier (Issue #1366).
 *
 * The manifest is an attestation of the artifacts a POC run produced:
 * for each artifact it stores the SHA-256 of the on-disk byte stream and
 * the byte length, plus the contract / template / schema / policy / model
 * identities that were active during the run. The manifest is itself
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
import { basename, join } from "node:path";

import {
  CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  type Wave1PocEvidenceArtifact,
  type Wave1PocEvidenceArtifactCategory,
  type Wave1PocEvidenceManifest,
  type Wave1PocEvidenceVerificationResult,
  type Wave1PocFixtureId,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const HEX64 = /^[0-9a-f]{64}$/;

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

  const seen = new Map<string, Wave1PocEvidenceArtifact>();
  for (const record of input.artifacts) {
    const filename = basename(record.filename);
    if (filename !== record.filename) {
      throw new RangeError(
        `buildWave1PocEvidenceManifest: artifact filename must be a basename, got "${record.filename}"`,
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
    artifacts,
    rawScreenshotsIncluded: false,
    imagePayloadSentToTestGeneration: false,
  };
  return manifest;
};

export interface WriteWave1PocEvidenceManifestInput {
  manifest: Wave1PocEvidenceManifest;
  destinationDir: string;
}

/**
 * Persist the evidence manifest under
 * `<destinationDir>/wave1-poc-evidence-manifest.json` atomically using a
 * `${path}.${pid}.tmp` rename.
 */
export const writeWave1PocEvidenceManifest = async (
  input: WriteWave1PocEvidenceManifestInput,
): Promise<string> => {
  await mkdir(input.destinationDir, { recursive: true });
  const path = join(
    input.destinationDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  const serialized = canonicalJson(input.manifest);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, path);
  return path;
};

export interface VerifyWave1PocEvidenceManifestInput {
  /** The manifest payload (typically the in-memory copy or a re-parsed file). */
  manifest: Wave1PocEvidenceManifest;
  /** The directory containing the artifacts the manifest attests. */
  artifactsDir: string;
  /**
   * When true, files in `artifactsDir` that are NOT attested by the
   * manifest are reported under `unexpected`. Defaults to `false` so a
   * job directory can carry sibling files (logs, transient snapshots)
   * without breaking verification.
   */
  rejectUnexpected?: boolean;
}

const isENOENT = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

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

  for (const artifact of input.manifest.artifacts) {
    const path = join(input.artifactsDir, artifact.filename);
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
    const attested = new Set(input.manifest.artifacts.map((a) => a.filename));
    let entries: string[] = [];
    try {
      entries = await readdir(input.artifactsDir);
    } catch (err) {
      if (!isENOENT(err)) throw err;
    }
    unexpected = entries
      .filter((name) => name !== WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME)
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
  };
};

/**
 * Convenience: read a manifest JSON file from disk and verify against the
 * surrounding directory. Throws if the manifest file is missing or
 * unparseable; for those cases there is nothing useful to verify.
 */
export const verifyWave1PocEvidenceFromDisk = async (
  artifactsDir: string,
  options: { rejectUnexpected?: boolean } = {},
): Promise<{
  manifest: Wave1PocEvidenceManifest;
  result: Wave1PocEvidenceVerificationResult;
}> => {
  const manifestPath = join(
    artifactsDir,
    WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME,
  );
  const raw = await readFile(manifestPath, "utf8");
  const parsedRaw = JSON.parse(raw) as Record<string, unknown>;
  if (
    parsedRaw["schemaVersion"] !== WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION ||
    parsedRaw["testIntelligenceContractVersion"] !==
      TEST_INTELLIGENCE_CONTRACT_VERSION
  ) {
    throw new Error(
      `verifyWave1PocEvidenceFromDisk: manifest schema/contract mismatch in ${manifestPath}`,
    );
  }
  const parsed = parsedRaw as unknown as Wave1PocEvidenceManifest;
  const result = await verifyWave1PocEvidenceManifest({
    manifest: parsed,
    artifactsDir,
    ...(options.rejectUnexpected !== undefined
      ? { rejectUnexpected: options.rejectUnexpected }
      : {}),
  });
  return { manifest: parsed, result };
};
