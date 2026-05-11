/**
 * Consolidated compaction-boundary log artifact (Issue #1795).
 *
 * Aggregates the in-memory CompactBoundary records the harness collects
 * during a job into a single newline-delimited JSON file at
 * `<runDir>/compact-boundary-log.jsonl`. Each line is a self-contained
 * canonical-JSON object so the file is byte-stable for byte-identical
 * inputs once entries are sorted by `(ts, jobId, summarySha256)`.
 *
 * The log only persists non-sensitive identifiers (sha256 of the
 * canonical-JSON summary, byte-counts of cleared tool result blocks)
 * — never raw conversation text. The summary itself lives in the
 * existing CompactBoundary marker artifact persisted by the production
 * runner.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_COMPACT_BOUNDARY_LOG_TIERS,
  COMPACT_BOUNDARY_LOG_ARTIFACT_FILENAME,
  COMPACT_BOUNDARY_LOG_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CompactBoundaryLogEntry,
  type CompactBoundaryLogTier,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCompactBoundaryLogTier = (
  value: unknown,
): value is CompactBoundaryLogTier =>
  typeof value === "string" &&
  (ALLOWED_COMPACT_BOUNDARY_LOG_TIERS as readonly string[]).includes(value);

/** Hand-rolled validator for {@link CompactBoundaryLogEntry}. */
export const isCompactBoundaryLogEntry = (
  value: unknown,
): value is CompactBoundaryLogEntry => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== COMPACT_BOUNDARY_LOG_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    typeof value["jobId"] !== "string" ||
    (value["jobId"]).length === 0 ||
    typeof value["ts"] !== "string" ||
    !ISO_8601_PATTERN.test(value["ts"]) ||
    !isCompactBoundaryLogTier(value["tier"]) ||
    typeof value["summarySha256"] !== "string" ||
    !HEX_64_PATTERN.test(value["summarySha256"]) ||
    !Number.isInteger(value["clearedToolResultBytes"]) ||
    (value["clearedToolResultBytes"] as number) < 0 ||
    typeof value["parentHash"] !== "string" ||
    !HEX_64_PATTERN.test(value["parentHash"])
  ) {
    return false;
  }
  return true;
};

const compareEntries = (
  left: CompactBoundaryLogEntry,
  right: CompactBoundaryLogEntry,
): number =>
  left.ts.localeCompare(right.ts) ||
  left.jobId.localeCompare(right.jobId) ||
  left.summarySha256.localeCompare(right.summarySha256) ||
  left.parentHash.localeCompare(right.parentHash);

const normalizeEntry = (
  entry: CompactBoundaryLogEntry,
): CompactBoundaryLogEntry => {
  if (!isCompactBoundaryLogEntry(entry)) {
    throw new TypeError(
      "buildCompactBoundaryLog: invalid CompactBoundaryLogEntry",
    );
  }
  return {
    schemaVersion: COMPACT_BOUNDARY_LOG_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: entry.jobId,
    ts: entry.ts,
    tier: entry.tier,
    summarySha256: entry.summarySha256,
    clearedToolResultBytes: entry.clearedToolResultBytes,
    parentHash: entry.parentHash,
  };
};

export interface BuildCompactBoundaryLogInput {
  readonly entries: readonly CompactBoundaryLogEntry[];
}

export interface BuildCompactBoundaryLogResult {
  readonly entries: readonly CompactBoundaryLogEntry[];
  readonly serialized: string;
}

/**
 * Build the in-memory log payload. Entries are deduplicated by
 * `(ts, jobId, summarySha256, parentHash)` and sorted in the same
 * order before serialization, so the resulting byte payload is stable.
 */
export const buildCompactBoundaryLog = (
  input: BuildCompactBoundaryLogInput,
): BuildCompactBoundaryLogResult => {
  const seen = new Map<string, CompactBoundaryLogEntry>();
  for (const entry of input.entries) {
    const normalized = normalizeEntry(entry);
    const key = [
      normalized.ts,
      normalized.jobId,
      normalized.summarySha256,
      normalized.parentHash,
    ].join(" ");
    if (seen.has(key)) continue;
    seen.set(key, normalized);
  }
  const entries = [...seen.values()].sort(compareEntries);
  const serialized =
    entries.length === 0
      ? ""
      : `${entries.map((entry) => canonicalJson(entry)).join("\n")}\n`;
  return { entries, serialized };
};

export interface WriteCompactBoundaryLogInput
  extends BuildCompactBoundaryLogInput {
  readonly runDir: string;
}

export interface WriteCompactBoundaryLogResult
  extends BuildCompactBoundaryLogResult {
  readonly artifactPath: string;
}

/** Atomically write `<runDir>/compact-boundary-log.jsonl`. */
export const writeCompactBoundaryLog = async (
  input: WriteCompactBoundaryLogInput,
): Promise<WriteCompactBoundaryLogResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeCompactBoundaryLog: runDir must be a non-empty string",
    );
  }
  const built = buildCompactBoundaryLog({ entries: input.entries });
  const artifactPath = join(
    input.runDir,
    COMPACT_BOUNDARY_LOG_ARTIFACT_FILENAME,
  );
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(input.runDir, { recursive: true });
  await writeFile(tmpPath, built.serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, ...built };
};

/**
 * Strict parser for a `compact-boundary-log.jsonl` payload. Returns
 * `undefined` on any malformed input.
 */
export const parseCompactBoundaryLog = (
  payload: string,
): readonly CompactBoundaryLogEntry[] | undefined => {
  if (payload.length === 0) return [];
  if (!payload.endsWith("\n")) return undefined;
  const lines = payload.slice(0, -1).split("\n");
  const result: CompactBoundaryLogEntry[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return undefined;
    }
    if (!isCompactBoundaryLogEntry(parsed)) return undefined;
    result.push(parsed);
  }
  return result;
};
