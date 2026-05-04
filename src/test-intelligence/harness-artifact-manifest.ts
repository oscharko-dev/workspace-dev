/**
 * Per-job harness artifact manifest (Issue #1795).
 *
 * Walks a per-job runDir, reads each canonical-JSON harness artifact
 * named in {@link ALLOWED_HARNESS_ARTIFACT_FILENAMES}, and produces a
 * sorted, byte-stable manifest pinning each artifact's
 * `{filename, schemaVersion, sha256, sizeBytes}`. The manifest is
 * persisted as `<runDir>/harness-artifact-manifest.json`.
 *
 * The evidence verify route uses {@link verifyHarnessArtifactManifest}
 * to reproduce every hash offline: it re-reads each artifact from disk,
 * recomputes the sha256, and reports a per-artifact mismatch list. No
 * harness re-run is required.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_HARNESS_ARTIFACT_FILENAMES,
  HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME,
  HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type HarnessArtifactFilename,
  type HarnessArtifactManifest,
  type HarnessArtifactManifestEntry,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHarnessArtifactFilename = (
  value: unknown,
): value is HarnessArtifactFilename =>
  typeof value === "string" &&
  (ALLOWED_HARNESS_ARTIFACT_FILENAMES as readonly string[]).includes(value);

const isHarnessArtifactManifestEntry = (
  value: unknown,
): value is HarnessArtifactManifestEntry => {
  if (!isRecord(value)) return false;
  return (
    isHarnessArtifactFilename(value["filename"]) &&
    typeof value["schemaVersion"] === "string" &&
    SEMVER_PATTERN.test(value["schemaVersion"]) &&
    typeof value["sha256"] === "string" &&
    HEX_64_PATTERN.test(value["sha256"]) &&
    Number.isInteger(value["sizeBytes"]) &&
    (value["sizeBytes"] as number) >= 0
  );
};

/** Hand-rolled validator for {@link HarnessArtifactManifest}. */
export const isHarnessArtifactManifest = (
  value: unknown,
): value is HarnessArtifactManifest => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["jobId"] !== "string" ||
    (value["jobId"]).length === 0 ||
    typeof value["generatedAt"] !== "string" ||
    !ISO_8601_PATTERN.test(value["generatedAt"]) ||
    typeof value["digest"] !== "string" ||
    !HEX_64_PATTERN.test(value["digest"]) ||
    !Array.isArray(value["entries"])
  ) {
    return false;
  }
  if (
    !(value["entries"] as readonly unknown[]).every(
      isHarnessArtifactManifestEntry,
    )
  ) {
    return false;
  }
  // Verify the digest is consistent with the entries — the manifest is
  // self-describing.
  const expected = sha256Hex([...(value["entries"] as readonly HarnessArtifactManifestEntry[])]);
  return expected === value["digest"];
};

const compareEntries = (
  left: HarnessArtifactManifestEntry,
  right: HarnessArtifactManifestEntry,
): number => left.filename.localeCompare(right.filename);

const SCHEMA_VERSION_FIELD_PATTERN =
  /"schemaVersion"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/;

/**
 * Extract the first `schemaVersion` literal from a canonical-JSON
 * payload. Tolerant of both single-document JSON files (canonical
 * output) and newline-delimited JSON logs (one entry per line). Returns
 * `undefined` when no `schemaVersion` field is present.
 */
const extractSchemaVersion = (payload: string): string | undefined => {
  if (payload.length === 0) return undefined;
  const firstLine = payload.includes("\n")
    ? payload.split("\n", 1)[0] ?? ""
    : payload;
  const match = SCHEMA_VERSION_FIELD_PATTERN.exec(firstLine);
  return match?.[1];
};

const isEnoent = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

const readArtifactBytes = async (
  artifactPath: string,
): Promise<Uint8Array | undefined> => {
  try {
    return await readFile(artifactPath);
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
};

export interface BuildHarnessArtifactManifestInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly runDir: string;
  /**
   * Optional restricted set of filenames to include. Defaults to every
   * member of {@link ALLOWED_HARNESS_ARTIFACT_FILENAMES}. The builder
   * skips any filename whose file does not exist on disk so an empty
   * harness run still produces a valid (entries-empty) manifest.
   */
  readonly include?: readonly HarnessArtifactFilename[];
}

export interface BuildHarnessArtifactManifestResult {
  readonly manifest: HarnessArtifactManifest;
  readonly serialized: string;
}

/**
 * Read each candidate artifact, compute its sha256, and build a sorted,
 * byte-stable manifest. The returned `serialized` payload ends in a
 * trailing newline — the convention every harness artifact in this
 * codebase shares.
 */
export const buildHarnessArtifactManifest = async (
  input: BuildHarnessArtifactManifestInput,
): Promise<BuildHarnessArtifactManifestResult> => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildHarnessArtifactManifest: jobId must be a non-empty string",
    );
  }
  if (
    typeof input.generatedAt !== "string" ||
    !ISO_8601_PATTERN.test(input.generatedAt)
  ) {
    throw new TypeError(
      "buildHarnessArtifactManifest: generatedAt must be ISO-8601",
    );
  }
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "buildHarnessArtifactManifest: runDir must be a non-empty string",
    );
  }
  const candidates = input.include ?? ALLOWED_HARNESS_ARTIFACT_FILENAMES;
  const seen = new Set<HarnessArtifactFilename>();
  const entries: HarnessArtifactManifestEntry[] = [];
  for (const filename of candidates) {
    if (!isHarnessArtifactFilename(filename)) {
      throw new TypeError(
        `buildHarnessArtifactManifest: unknown harness artifact filename "${String(filename)}"`,
      );
    }
    if (seen.has(filename)) continue;
    seen.add(filename);
    const artifactPath = join(input.runDir, filename);
    const bytes = await readArtifactBytes(artifactPath);
    if (bytes === undefined) continue;
    const text = new TextDecoder().decode(bytes);
    const schemaVersion = extractSchemaVersion(text) ?? "0.0.0";
    entries.push({
      filename,
      schemaVersion,
      sha256: sha256Hex(text),
      sizeBytes: bytes.byteLength,
    });
  }
  entries.sort(compareEntries);
  const digest = sha256Hex([...entries]);
  const manifest: HarnessArtifactManifest = {
    schemaVersion: HARNESS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    entries,
    digest,
  };
  const serialized = `${canonicalJson(manifest)}\n`;
  return { manifest, serialized };
};

export type WriteHarnessArtifactManifestInput =
  BuildHarnessArtifactManifestInput;

export interface WriteHarnessArtifactManifestResult
  extends BuildHarnessArtifactManifestResult {
  readonly artifactPath: string;
}

/** Atomically write `<runDir>/harness-artifact-manifest.json`. */
export const writeHarnessArtifactManifest = async (
  input: WriteHarnessArtifactManifestInput,
): Promise<WriteHarnessArtifactManifestResult> => {
  const built = await buildHarnessArtifactManifest(input);
  const artifactPath = join(
    input.runDir,
    HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, built.serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, ...built };
};

/** One mismatch surfaced by {@link verifyHarnessArtifactManifest}. */
export interface HarnessArtifactManifestMismatch {
  readonly filename: HarnessArtifactFilename;
  readonly reason: "missing" | "size_mismatch" | "sha256_mismatch";
  readonly expected?: { sha256: string; sizeBytes: number };
  readonly actual?: { sha256: string; sizeBytes: number };
}

/** Result of an offline manifest verification. */
export interface VerifyHarnessArtifactManifestResult {
  readonly ok: boolean;
  readonly mismatches: readonly HarnessArtifactManifestMismatch[];
  /** Recomputed digest over the on-disk artifacts. */
  readonly recomputedDigest: string;
  /** `true` when the recomputed digest matches the manifest's digest. */
  readonly digestMatches: boolean;
}

/**
 * Re-read every artifact named in `manifest.entries`, recompute the
 * sha256, and report any deviation from the manifest. Pure offline
 * operation — no harness re-run, no network. Used by the evidence
 * verify route to reproduce all hashes.
 */
export const verifyHarnessArtifactManifest = async (input: {
  readonly runDir: string;
  readonly manifest: HarnessArtifactManifest;
}): Promise<VerifyHarnessArtifactManifestResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "verifyHarnessArtifactManifest: runDir must be a non-empty string",
    );
  }
  if (!isHarnessArtifactManifest(input.manifest)) {
    throw new TypeError(
      "verifyHarnessArtifactManifest: manifest failed structural validation",
    );
  }
  const mismatches: HarnessArtifactManifestMismatch[] = [];
  const recomputed: HarnessArtifactManifestEntry[] = [];
  for (const entry of input.manifest.entries) {
    const artifactPath = join(input.runDir, entry.filename);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(artifactPath);
    } catch (err) {
      if (isEnoent(err)) {
        mismatches.push({
          filename: entry.filename,
          reason: "missing",
          expected: { sha256: entry.sha256, sizeBytes: entry.sizeBytes },
        });
        continue;
      }
      throw err;
    }
    const sizeBytes = bytes.byteLength;
    const text = new TextDecoder().decode(bytes);
    const sha256 = sha256Hex(text);
    if (sizeBytes !== entry.sizeBytes) {
      mismatches.push({
        filename: entry.filename,
        reason: "size_mismatch",
        expected: { sha256: entry.sha256, sizeBytes: entry.sizeBytes },
        actual: { sha256, sizeBytes },
      });
    } else if (sha256 !== entry.sha256) {
      mismatches.push({
        filename: entry.filename,
        reason: "sha256_mismatch",
        expected: { sha256: entry.sha256, sizeBytes: entry.sizeBytes },
        actual: { sha256, sizeBytes },
      });
    }
    recomputed.push({
      filename: entry.filename,
      schemaVersion: entry.schemaVersion,
      sha256,
      sizeBytes,
    });
  }
  recomputed.sort(compareEntries);
  const recomputedDigest = sha256Hex(recomputed);
  return {
    ok: mismatches.length === 0 && recomputedDigest === input.manifest.digest,
    mismatches,
    recomputedDigest,
    digestMatches: recomputedDigest === input.manifest.digest,
  };
};

/**
 * Read and validate a manifest from disk. Returns `undefined` when the
 * file is missing or malformed; the evidence verify route surfaces
 * either as a verification failure.
 */
export const readHarnessArtifactManifest = async (
  runDir: string,
): Promise<HarnessArtifactManifest | undefined> => {
  if (typeof runDir !== "string" || runDir.length === 0) {
    throw new TypeError(
      "readHarnessArtifactManifest: runDir must be a non-empty string",
    );
  }
  const artifactPath = join(
    runDir,
    HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME,
  );
  let raw: string;
  try {
    raw = await readFile(artifactPath, "utf8");
  } catch (err) {
    if (isEnoent(err)) return undefined;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isHarnessArtifactManifest(parsed) ? parsed : undefined;
};

/** Convenience: returns whether `<runDir>` contains a manifest at all. */
export const hasHarnessArtifactManifest = async (
  runDir: string,
): Promise<boolean> => {
  try {
    await stat(join(runDir, HARNESS_ARTIFACT_MANIFEST_ARTIFACT_FILENAME));
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    throw err;
  }
};
