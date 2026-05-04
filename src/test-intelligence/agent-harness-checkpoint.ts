/**
 * Merkle-chained agent harness checkpoints (Issue #1785, Story MA-3 #1758).
 *
 * Each per-step harness attempt persists a small JSON checkpoint. The
 * checkpoints form a hash-chain per `jobId`: every checkpoint stores
 * the sha256 of the canonical-JSON serialisation of its predecessor,
 * so any byte-level mutation of a middle checkpoint propagates a
 * `chain_break` at the first affected `chainIndex`.
 *
 * Schema 1.1.0 (Issue #1758, LangSmith-adapter compatibility) adds
 * five fields per checkpoint:
 *
 *   - `runId`         — stable UUID per role-step execution; multiple
 *                       checkpoints sharing one execution (e.g. the
 *                       `started` and `completed` snapshot pair) carry
 *                       the same `runId`. Different attempts get
 *                       different `runId`s.
 *   - `parentRunId`   — `null` for the root checkpoint of a job; for
 *                       every other checkpoint, the `runId` of an
 *                       earlier checkpoint in the same chain (the
 *                       calling step in the agent execution graph).
 *   - `completedAt`   — ISO-8601 timestamp of the step's terminal
 *                       state, or `startedAt` for `status === "started"`
 *                       snapshots (the snapshot itself has zero
 *                       duration, but every checkpoint must carry a
 *                       finite `completedAt` so a downstream LangSmith
 *                       adapter can render a per-step latency band).
 *   - `promptTokens`  — non-negative integer count of input tokens
 *                       attributed to this role-step's LLM call. `0`
 *                       for non-LLM steps.
 *   - `completionTokens` — non-negative integer count of output tokens
 *                       attributed to this role-step's LLM call. `0`
 *                       for non-LLM steps.
 *
 * `runId` and `parentRunId` are pure ID fields — they do *not* replace
 * `parentHash` (the Merkle invariant is unaffected); they sit alongside
 * the hash chain to make the trace tree reconstructible without a
 * synthetic UUID derivation step.
 *
 * Hard invariants enforced by this module:
 *
 *   - Schema is fixed at v1.1.0; the field set is closed.
 *   - All hashes are 64-char lowercase hex (sha256). The root
 *     checkpoint's `parentHash` is the zero-hash sentinel
 *     ({@link AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH}).
 *   - `chainIndex` is monotonic and strictly equals the (0-based)
 *     position of the checkpoint within the chain.
 *   - `runId` is a lowercase RFC-4122 UUID (any version).
 *   - `parentRunId` is `null` exactly at `chainIndex === 0`; for every
 *     subsequent checkpoint it must equal the `runId` of an earlier
 *     checkpoint in the same chain.
 *   - `promptTokens` and `completionTokens` are non-negative integers.
 *   - Persistence uses canonical-JSON so byte-identical input always
 *     produces byte-identical files (and therefore byte-identical
 *     `headOfChainHash` values).
 *   - On-disk writes are atomic via `${pid}.${randomUUID()}.tmp`
 *     rename, so a crash mid-write never produces a half-written
 *     checkpoint that would corrupt the chain.
 *   - No raw prompts, no chain-of-thought, no model output bytes,
 *     no secrets are ever persisted — only hashes and lightweight
 *     status / timing / token-count metadata.
 *
 * The module is purely local: there is no external DB, no network
 * I/O, no telemetry. Verification is fully offline.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Hex } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

/** Schema version for {@link AgentHarnessCheckpoint}. */
export const AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION = "1.1.0" as const;

/** Filename of the per-job checkpoint directory under `<runDir>`. */
export const AGENT_HARNESS_CHECKPOINT_DIRECTORY =
  "agent-harness-checkpoints" as const;

/**
 * 64-char lowercase hex zero hash used as the `parentHash` of the
 * root checkpoint. Picking a literal sentinel (rather than the empty
 * string) keeps the verification rule uniform: every checkpoint's
 * `parentHash` is a 64-char lowercase hex digest.
 */
export const AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH: string = "0".repeat(64);

/**
 * Marker substring embedded in the error message thrown by the
 * asserter when one of the LangSmith-adapter-required fields is
 * missing or malformed. The verifier inspects this marker to map a
 * structural-invariant failure into the dedicated
 * `checkpoint_schema_violation` break reason (vs. the generic
 * `schema_invalid` reason used for other structural issues).
 */
const CHECKPOINT_SCHEMA_VIOLATION_MARKER = "checkpoint_schema_violation:";

/**
 * Closed list of allowed checkpoint statuses. Order is alphabetical so
 * the canonical-JSON serialisation of any structure embedding this
 * constant is byte-stable.
 */
export const AGENT_HARNESS_CHECKPOINT_STATUSES = [
  "canceled",
  "completed",
  "failed",
  "skipped",
  "started",
] as const;

export type AgentHarnessCheckpointStatus =
  (typeof AGENT_HARNESS_CHECKPOINT_STATUSES)[number];

/** Type guard for {@link AgentHarnessCheckpointStatus}. */
export const isAgentHarnessCheckpointStatus = (
  value: unknown,
): value is AgentHarnessCheckpointStatus =>
  typeof value === "string" &&
  (AGENT_HARNESS_CHECKPOINT_STATUSES as readonly string[]).includes(value);

// ---------------------------------------------------------------------------
// Checkpoint shape
// ---------------------------------------------------------------------------

export interface AgentHarnessCheckpoint {
  readonly schemaVersion: typeof AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION;
  readonly jobId: string;
  readonly roleStepId: string;
  readonly attempt: number;
  readonly status: AgentHarnessCheckpointStatus;
  readonly inputHash: string;
  readonly outputHash?: string;
  readonly nextRoleStepIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly errorClass?: string;
  /** sha256 of canonical-JSON of previous checkpoint; root uses zero-hash sentinel. */
  readonly parentHash: string;
  /** Monotonic, 0-based position within the per-`jobId` chain. */
  readonly chainIndex: number;
  /** Stable UUID identifying one role-step execution. */
  readonly runId: string;
  /** `runId` of the calling step; `null` for the root of a job. */
  readonly parentRunId: string | null;
  /** Non-negative input-token count attributed to this step's LLM call (0 for non-LLM steps). */
  readonly promptTokens: number;
  /** Non-negative output-token count attributed to this step's LLM call (0 for non-LLM steps). */
  readonly completionTokens: number;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const HEX_64 = /^[0-9a-f]{64}$/u;
const ISO_8601_BASIC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;
const UUID_RFC_4122 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const isHex64 = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RFC_4122.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_8601_BASIC.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const dedupSortedStrings = (
  values: readonly string[],
  where: string,
  field: string,
): readonly string[] => {
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(
        `${where}: ${field} entries must be non-empty strings`,
      );
    }
  }
  const sorted = [...values].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      throw new RangeError(
        `${where}: duplicate ${field} entry "${sorted[i] ?? ""}"`,
      );
    }
  }
  return Object.freeze(sorted);
};

/**
 * Throws {@link TypeError} or {@link RangeError} if `checkpoint` does
 * not satisfy every structural invariant of the schema. Callers in
 * the read path use this defensively before trusting any on-disk
 * checkpoint bytes.
 *
 * Failures involving the LangSmith-adapter-required fields (`runId`,
 * `parentRunId`, `completedAt`, `promptTokens`, `completionTokens`)
 * carry the {@link CHECKPOINT_SCHEMA_VIOLATION_MARKER} prefix in their
 * message so the verifier can route them to the dedicated
 * `checkpoint_schema_violation` break reason.
 */
export const assertAgentHarnessCheckpointInvariants = (
  checkpoint: AgentHarnessCheckpoint,
  where = "assertAgentHarnessCheckpointInvariants",
): void => {
  // Defensive: callers may hand us untrusted JSON. The literal type
  // would normally fold this comparison, so we widen for the runtime
  // check.
  if (
    (checkpoint.schemaVersion as string) !==
    (AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION as string)
  ) {
    throw new TypeError(
      `${where}: schemaVersion must equal "${AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION}"`,
    );
  }
  if (!isNonEmptyString(checkpoint.jobId)) {
    throw new TypeError(`${where}: jobId must be a non-empty string`);
  }
  if (!isNonEmptyString(checkpoint.roleStepId)) {
    throw new TypeError(`${where}: roleStepId must be a non-empty string`);
  }
  if (
    !Number.isInteger(checkpoint.attempt) ||
    checkpoint.attempt < 1
  ) {
    throw new RangeError(
      `${where}: attempt must be a positive integer (>= 1)`,
    );
  }
  if (!isAgentHarnessCheckpointStatus(checkpoint.status)) {
    throw new TypeError(
      `${where}: status must be one of [${AGENT_HARNESS_CHECKPOINT_STATUSES.join(", ")}]`,
    );
  }
  if (!isHex64(checkpoint.inputHash)) {
    throw new TypeError(
      `${where}: inputHash must be a 64-char lowercase hex digest`,
    );
  }
  if (checkpoint.outputHash !== undefined && !isHex64(checkpoint.outputHash)) {
    throw new TypeError(
      `${where}: outputHash must be a 64-char lowercase hex digest when present`,
    );
  }
  if (!Array.isArray(checkpoint.nextRoleStepIds)) {
    throw new TypeError(`${where}: nextRoleStepIds must be an array`);
  }
  const dedupedNextRoleStepIds = dedupSortedStrings(
    checkpoint.nextRoleStepIds,
    where,
    "nextRoleStepIds",
  );
  // The stored array must already be sorted alphabetically. Compare
  // pairwise against the canonicalised copy returned by the dedup
  // helper rather than re-indexing — keeps the type-checker happy
  // and surfaces a clear error.
  for (let i = 0; i < checkpoint.nextRoleStepIds.length; i++) {
    if (checkpoint.nextRoleStepIds[i] !== dedupedNextRoleStepIds[i]) {
      throw new RangeError(
        `${where}: nextRoleStepIds must be sorted alphabetically`,
      );
    }
  }
  if (!isIsoTimestamp(checkpoint.startedAt)) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} startedAt must be an ISO-8601 timestamp`,
    );
  }
  if (!isIsoTimestamp(checkpoint.completedAt)) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} completedAt must be an ISO-8601 timestamp`,
    );
  }
  // completedAt must not predate startedAt — a negative duration is
  // semantically meaningless and would corrupt LangSmith latency
  // breakdowns.
  if (Date.parse(checkpoint.completedAt) < Date.parse(checkpoint.startedAt)) {
    throw new RangeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} completedAt must be greater than or equal to startedAt`,
    );
  }
  if (
    checkpoint.errorClass !== undefined &&
    !isNonEmptyString(checkpoint.errorClass)
  ) {
    throw new TypeError(
      `${where}: errorClass must be a non-empty string when present`,
    );
  }
  if (!isHex64(checkpoint.parentHash)) {
    throw new TypeError(
      `${where}: parentHash must be a 64-char lowercase hex digest`,
    );
  }
  if (!isNonNegativeInteger(checkpoint.chainIndex)) {
    throw new RangeError(
      `${where}: chainIndex must be a non-negative integer`,
    );
  }
  if (
    checkpoint.chainIndex === 0 &&
    checkpoint.parentHash !== AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH
  ) {
    throw new RangeError(
      `${where}: root checkpoint (chainIndex 0) must use the zero-hash sentinel as parentHash`,
    );
  }
  if (!isUuid(checkpoint.runId)) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} runId must be a lowercase RFC-4122 UUID`,
    );
  }
  if (
    checkpoint.parentRunId !== null &&
    !isUuid(checkpoint.parentRunId)
  ) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} parentRunId must be a lowercase RFC-4122 UUID or null`,
    );
  }
  if (
    checkpoint.chainIndex === 0 &&
    checkpoint.parentRunId !== null
  ) {
    throw new RangeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} root checkpoint (chainIndex 0) must have parentRunId === null`,
    );
  }
  // Self-reference is meaningless and would create a degenerate trace
  // tree edge in any LangSmith export.
  if (
    checkpoint.parentRunId !== null &&
    checkpoint.parentRunId === checkpoint.runId
  ) {
    throw new RangeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} parentRunId must not equal runId (self-reference forbidden)`,
    );
  }
  if (!isNonNegativeInteger(checkpoint.promptTokens)) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} promptTokens must be a non-negative integer`,
    );
  }
  if (!isNonNegativeInteger(checkpoint.completionTokens)) {
    throw new TypeError(
      `${where}: ${CHECKPOINT_SCHEMA_VIOLATION_MARKER} completionTokens must be a non-negative integer`,
    );
  }
};

// ---------------------------------------------------------------------------
// Hashing + builder
// ---------------------------------------------------------------------------

/**
 * Returns the sha256 hex digest of the canonical-JSON serialisation
 * of `checkpoint`. Used both as the predecessor's `parentHash` for
 * the next checkpoint, and as the chain's `headOfChainHash` once the
 * tail checkpoint is appended.
 */
export const computeAgentHarnessCheckpointHash = (
  checkpoint: AgentHarnessCheckpoint,
): string => sha256Hex(checkpoint);

/** Inputs accepted by {@link appendAgentHarnessCheckpoint}. */
export interface AppendAgentHarnessCheckpointInput {
  readonly jobId: string;
  readonly roleStepId: string;
  readonly attempt: number;
  readonly status: AgentHarnessCheckpointStatus;
  readonly inputHash: string;
  readonly outputHash?: string;
  readonly nextRoleStepIds?: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly errorClass?: string;
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Build the next {@link AgentHarnessCheckpoint} given the predecessor
 * (or `null` for the root). Derives `parentHash` and `chainIndex`
 * deterministically from the predecessor.
 *
 * The returned object is already canonicalised (alphabetised
 * `nextRoleStepIds`, no surplus optional fields) so that two callers
 * passing byte-identical inputs always produce byte-identical
 * checkpoints — the prerequisite for chain byte-stability.
 */
export const appendAgentHarnessCheckpoint = (
  previous: AgentHarnessCheckpoint | null,
  input: AppendAgentHarnessCheckpointInput,
): AgentHarnessCheckpoint => {
  const where = "appendAgentHarnessCheckpoint";

  if (previous !== null) {
    assertAgentHarnessCheckpointInvariants(previous, `${where}: previous`);
    if (previous.jobId !== input.jobId) {
      throw new RangeError(
        `${where}: jobId mismatch (previous=${previous.jobId}, next=${input.jobId})`,
      );
    }
  }

  const nextRoleStepIds = dedupSortedStrings(
    input.nextRoleStepIds ?? [],
    where,
    "nextRoleStepIds",
  );

  const parentHash =
    previous === null
      ? AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH
      : computeAgentHarnessCheckpointHash(previous);
  const chainIndex = previous === null ? 0 : previous.chainIndex + 1;

  const checkpoint: AgentHarnessCheckpoint = {
    schemaVersion: AGENT_HARNESS_CHECKPOINT_SCHEMA_VERSION,
    jobId: input.jobId,
    roleStepId: input.roleStepId,
    attempt: input.attempt,
    status: input.status,
    inputHash: input.inputHash,
    ...(input.outputHash !== undefined ? { outputHash: input.outputHash } : {}),
    nextRoleStepIds,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.errorClass !== undefined ? { errorClass: input.errorClass } : {}),
    parentHash,
    chainIndex,
    runId: input.runId,
    parentRunId: input.parentRunId,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
  };

  assertAgentHarnessCheckpointInvariants(checkpoint, where);
  return checkpoint;
};

// ---------------------------------------------------------------------------
// On-disk persistence
// ---------------------------------------------------------------------------

/**
 * Width of the zero-padded chainIndex used as the on-disk filename
 * prefix. Eight digits comfortably exceeds any plausible
 * per-job step count and keeps lexicographic ordering consistent
 * with numeric ordering when callers list the directory.
 */
const CHAIN_INDEX_FILENAME_WIDTH = 8;

/**
 * Sanitises a `jobId` for use as a directory segment. Only allows
 * characters that are stable across filesystems: alphanumerics, `-`,
 * `_`, and `.`. Anything else is rejected outright; we intentionally
 * do not silently rewrite the id, because that would let two distinct
 * jobIds collide on disk.
 */
const SAFE_JOB_ID = /^[A-Za-z0-9._-]+$/u;

const checkpointDir = (runDir: string, jobId: string): string => {
  if (!SAFE_JOB_ID.test(jobId)) {
    throw new TypeError(
      `agent-harness-checkpoint: jobId "${jobId}" contains unsafe characters; only [A-Za-z0-9._-] are allowed`,
    );
  }
  return join(runDir, AGENT_HARNESS_CHECKPOINT_DIRECTORY, jobId);
};

const checkpointFilename = (chainIndex: number): string => {
  return `${String(chainIndex).padStart(CHAIN_INDEX_FILENAME_WIDTH, "0")}.json`;
};

export interface WriteAgentHarnessCheckpointInput {
  readonly runDir: string;
  readonly checkpoint: AgentHarnessCheckpoint;
}

export interface WriteAgentHarnessCheckpointResult {
  readonly checkpointPath: string;
  readonly bytes: Uint8Array;
}

/**
 * Write `checkpoint` atomically under
 * `<runDir>/agent-harness-checkpoints/<jobId>/<paddedChainIndex>.json`.
 * The temporary filename includes the writer pid and a fresh UUID so
 * concurrent writers never collide on the same temp path; the final
 * rename is atomic on POSIX filesystems.
 */
export const writeAgentHarnessCheckpoint = async (
  input: WriteAgentHarnessCheckpointInput,
): Promise<WriteAgentHarnessCheckpointResult> => {
  if (!isNonEmptyString(input.runDir)) {
    throw new TypeError(
      "writeAgentHarnessCheckpoint: runDir must be a non-empty string",
    );
  }
  assertAgentHarnessCheckpointInvariants(
    input.checkpoint,
    "writeAgentHarnessCheckpoint",
  );

  const dir = checkpointDir(input.runDir, input.checkpoint.jobId);
  await mkdir(dir, { recursive: true });

  const checkpointPath = join(
    dir,
    checkpointFilename(input.checkpoint.chainIndex),
  );
  const tmpPath = `${checkpointPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(input.checkpoint)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, checkpointPath);

  return { checkpointPath, bytes };
};

export interface ReadAgentHarnessCheckpointChainInput {
  readonly runDir: string;
  readonly jobId: string;
}

const isENOENT = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

/**
 * Read every checkpoint for `jobId` from disk and return them in
 * `chainIndex` order. Returns an empty array when the directory does
 * not exist.
 *
 * Each file's parsed contents are validated against the schema; any
 * deviation throws so the caller never observes a half-typed
 * checkpoint. Verification of the chain itself (parent-hash
 * propagation) happens in {@link verifyAgentHarnessCheckpointChain}.
 */
export const readAgentHarnessCheckpointChain = async (
  input: ReadAgentHarnessCheckpointChainInput,
): Promise<readonly AgentHarnessCheckpoint[]> => {
  const dir = checkpointDir(input.runDir, input.jobId);
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (isENOENT(err)) return Object.freeze([]);
    throw err;
  }

  const jsonFiles = entries
    .filter((name) => name.endsWith(".json"))
    .sort();

  const checkpoints: AgentHarnessCheckpoint[] = [];
  for (const name of jsonFiles) {
    const raw = await readFile(join(dir, name), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError(
        `readAgentHarnessCheckpointChain: ${name} did not parse to an object`,
      );
    }
    const candidate = parsed as AgentHarnessCheckpoint;
    assertAgentHarnessCheckpointInvariants(
      candidate,
      `readAgentHarnessCheckpointChain: ${name}`,
    );
    if (candidate.jobId !== input.jobId) {
      throw new RangeError(
        `readAgentHarnessCheckpointChain: ${name} jobId "${candidate.jobId}" does not match expected "${input.jobId}"`,
      );
    }
    checkpoints.push(candidate);
  }

  checkpoints.sort((a, b) => a.chainIndex - b.chainIndex);
  return Object.freeze(checkpoints);
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Diagnostic taxonomy for chain-break reasons. */
export const AGENT_HARNESS_CHECKPOINT_BREAK_REASONS = [
  "chain_index_mismatch",
  "checkpoint_schema_violation",
  "duplicate_chain_index",
  "missing_root",
  "parent_hash_mismatch",
  "schema_invalid",
] as const;

export type AgentHarnessCheckpointBreakReason =
  (typeof AGENT_HARNESS_CHECKPOINT_BREAK_REASONS)[number];

/** Verifier helper return shape. */
export type VerifyAgentHarnessCheckpointChainResult =
  | {
      readonly ok: true;
      readonly headOfChainHash: string;
      readonly chainLength: number;
    }
  | {
      readonly ok: false;
      readonly code: "chain_break";
      readonly firstBreakIndex: number;
      readonly reason: AgentHarnessCheckpointBreakReason;
      readonly detail: string;
    };

/**
 * Recompute the chain offline. Any mutation to a middle checkpoint —
 * field flip, hash flip, status flip, even reordering — is reported
 * as `chain_break` at the first affected `chainIndex`.
 *
 * Verification rules (in order of evaluation, per `chainIndex`):
 *
 *   1. The checkpoint at position `i` has `chainIndex === i`. (Catches
 *      reordering, gaps, duplicates.)
 *   2. The checkpoint passes structural invariants. Failures involving
 *      LangSmith-adapter-required fields surface as
 *      `checkpoint_schema_violation`; other structural failures keep
 *      the existing `schema_invalid` reason.
 *   3. The root (`i === 0`) has `parentHash` equal to the zero-hash
 *      sentinel.
 *   4. For `i > 0`, `parentHash` equals
 *      sha256(canonicalJson(chain[i - 1])).
 *   5. `parentRunId` is `null` at `i === 0`; for `i > 0`, it must
 *      equal the `runId` of an earlier checkpoint in the same chain.
 *      Violations also surface as `checkpoint_schema_violation`.
 */
export const verifyAgentHarnessCheckpointChain = (
  checkpoints: readonly AgentHarnessCheckpoint[],
): VerifyAgentHarnessCheckpointChainResult => {
  if (checkpoints.length === 0) {
    return {
      ok: true,
      headOfChainHash: AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH,
      chainLength: 0,
    };
  }

  const seenIndexes = new Set<number>();
  // Map from runId to the parentRunId that runId was first registered
  // with. A checkpoint that re-uses an existing runId (snapshot pair
  // for the same role-step execution) must declare the same parent —
  // otherwise the chain disagrees on its own trace tree.
  const runIdToParent = new Map<string, string | null>();
  let previousHash = AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH;

  for (let i = 0; i < checkpoints.length; i++) {
    const current = checkpoints[i];
    if (current === undefined) {
      // Defensive: arrays from disk go through Object.freeze and
      // never contain holes, but the type checker treats indexed
      // access as `T | undefined`. We surface this as the same
      // chain_break code the caller already handles.
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "schema_invalid",
        detail: `checkpoint at position ${i} is undefined`,
      };
    }

    if (seenIndexes.has(current.chainIndex)) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: current.chainIndex,
        reason: "duplicate_chain_index",
        detail: `chainIndex ${current.chainIndex} appears more than once`,
      };
    }
    seenIndexes.add(current.chainIndex);

    if (current.chainIndex !== i) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "chain_index_mismatch",
        detail: `expected chainIndex ${i}, found ${current.chainIndex}`,
      };
    }

    try {
      assertAgentHarnessCheckpointInvariants(
        current,
        `verifyAgentHarnessCheckpointChain[${i}]`,
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: detail.includes(CHECKPOINT_SCHEMA_VIOLATION_MARKER)
          ? "checkpoint_schema_violation"
          : "schema_invalid",
        detail,
      };
    }

    if (i === 0) {
      if (current.parentHash !== AGENT_HARNESS_CHECKPOINT_ROOT_PARENT_HASH) {
        return {
          ok: false,
          code: "chain_break",
          firstBreakIndex: 0,
          reason: "missing_root",
          detail:
            "root checkpoint must reference the zero-hash sentinel as parentHash",
        };
      }
    } else if (current.parentHash !== previousHash) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "parent_hash_mismatch",
        detail: `parentHash mismatch at chainIndex ${i}: expected ${previousHash}, found ${current.parentHash}`,
      };
    }

    // parentRunId chain-level rule. The model: each unique `runId`
    // identifies one role-step execution; multiple checkpoints can
    // share a runId (snapshot pair: `started` and `completed` for
    // one attempt). Within one runId all checkpoints must declare
    // the same `parentRunId`. The first runId in the chain (root
    // step) carries `parentRunId === null`; every subsequent unique
    // runId must reference a runId observed earlier (the calling
    // step in the agent execution graph).
    const existingParent = runIdToParent.get(current.runId);
    if (existingParent === undefined) {
      // First time we see this runId.
      if (i === 0) {
        // Root step. Structural assertion already enforced
        // parentRunId === null at chainIndex 0.
        runIdToParent.set(current.runId, current.parentRunId);
      } else {
        // Non-root step → must reference an earlier closed runId.
        const parentRunId = current.parentRunId;
        if (parentRunId === null) {
          return {
            ok: false,
            code: "chain_break",
            firstBreakIndex: i,
            reason: "checkpoint_schema_violation",
            detail: `${CHECKPOINT_SCHEMA_VIOLATION_MARKER} new runId at chainIndex ${i} must reference a parent runId observed earlier (parentRunId may not be null)`,
          };
        }
        if (!runIdToParent.has(parentRunId)) {
          return {
            ok: false,
            code: "chain_break",
            firstBreakIndex: i,
            reason: "checkpoint_schema_violation",
            detail: `${CHECKPOINT_SCHEMA_VIOLATION_MARKER} parentRunId "${parentRunId}" at chainIndex ${i} does not reference any earlier runId in the chain`,
          };
        }
        runIdToParent.set(current.runId, parentRunId);
      }
    } else if (existingParent !== current.parentRunId) {
      // Continuation of an existing runId — parentRunId must match
      // what the first checkpoint of this execution declared.
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "checkpoint_schema_violation",
        detail: `${CHECKPOINT_SCHEMA_VIOLATION_MARKER} runId "${current.runId}" at chainIndex ${i} declares parentRunId "${current.parentRunId ?? "null"}" but earlier checkpoint of the same runId declared "${existingParent ?? "null"}"`,
      };
    }

    previousHash = computeAgentHarnessCheckpointHash(current);
  }

  return {
    ok: true,
    headOfChainHash: previousHash,
    chainLength: checkpoints.length,
  };
};

// ---------------------------------------------------------------------------
// Manifest summary
// ---------------------------------------------------------------------------

/** Anchor used by the final evidence manifest. */
export interface AgentHarnessCheckpointChainSummary {
  readonly headOfChainHash: string;
  readonly chainLength: number;
}

/**
 * Convenience wrapper that returns `{ headOfChainHash, chainLength }`
 * for a verified chain, ready to embed in the evidence manifest.
 * Throws if the chain fails verification — callers that want a
 * structured failure should use {@link verifyAgentHarnessCheckpointChain}
 * directly.
 */
export const summarizeAgentHarnessCheckpointChain = (
  checkpoints: readonly AgentHarnessCheckpoint[],
): AgentHarnessCheckpointChainSummary => {
  const result = verifyAgentHarnessCheckpointChain(checkpoints);
  if (!result.ok) {
    throw new Error(
      `summarizeAgentHarnessCheckpointChain: chain_break at ${result.firstBreakIndex} (${result.reason}): ${result.detail}`,
    );
  }
  return {
    headOfChainHash: result.headOfChainHash,
    chainLength: result.chainLength,
  };
};

/**
 * Read the on-disk chain for `jobId` and verify it offline. Returns
 * the same discriminated result as
 * {@link verifyAgentHarnessCheckpointChain}; this is the entry point
 * the verifier CLI / evidence-manifest builder should call.
 */
export const verifyAgentHarnessCheckpointChainFromDisk = async (
  input: ReadAgentHarnessCheckpointChainInput,
): Promise<VerifyAgentHarnessCheckpointChainResult> => {
  const chain = await readAgentHarnessCheckpointChain(input);
  return verifyAgentHarnessCheckpointChain(chain);
};
