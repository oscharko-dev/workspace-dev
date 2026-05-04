/**
 * File-based consolidation mutex for the Memdir-style agent-lessons
 * directory (Issue #1789, Story MA-3 #1758).
 *
 * The mutex lives at `<lessonsDir>/.consolidate-lock`. Its mtime
 * doubles as `lastConsolidatedAt` — successful release stamps the
 * mtime to the completion time; rollback restores it to the prior
 * value so a failed run cannot advance the consolidation cursor.
 *
 * A stale holder (age > {@link CONSOLIDATION_LOCK_HOLDER_TIMEOUT_MS}
 * or PID no longer alive on this host) can be taken over. Every
 * takeover appends a Merkle-chained `lock_takeover` event under
 * `<lessonsDir>/.lock-events/` recording the displaced holder's PID
 * and host, so audit reconstruction sees an unbroken chain of who
 * held the lock when.
 *
 * Hard invariants:
 *
 *   - Acquire is `O_EXCL`; we never silently overwrite a lock file.
 *   - The lock body is canonical JSON. Crashed writers leave either
 *     a complete file (we can read it) or no file (`O_EXCL` lets the
 *     next caller proceed) — never a half-written body.
 *   - `releaseConsolidationLock` only succeeds when the on-disk
 *     `holderId` matches; stale callers never accidentally release
 *     someone else's lock.
 *   - The lock-events log is append-only and Merkle-chained: any
 *     mutation of a middle event is detected as `chain_break` at the
 *     first affected `chainIndex`.
 */

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Hex } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

/** Schema version of the consolidate-lock file body. */
export const CONSOLIDATION_LOCK_SCHEMA_VERSION = "1.0.0" as const;

/** Filename of the lock under `<lessonsDir>/`. */
export const CONSOLIDATION_LOCK_FILENAME = ".consolidate-lock" as const;

/** Subdirectory under `<lessonsDir>/` for the chained lock-events log. */
export const CONSOLIDATION_LOCK_EVENTS_DIRECTORY = ".lock-events" as const;

/**
 * Maximum acceptable age of a held lock (1h). Beyond this, the next
 * acquirer takes the lock over and audits the displacement.
 */
export const CONSOLIDATION_LOCK_HOLDER_TIMEOUT_MS: number = 60 * 60 * 1000;

/** Closed list of recognized lock-event kinds. */
export const CONSOLIDATION_LOCK_EVENT_TYPES = [
  "lock_acquired",
  "lock_released",
  "lock_rolled_back",
  "lock_takeover",
] as const;

export type ConsolidationLockEventType =
  (typeof CONSOLIDATION_LOCK_EVENT_TYPES)[number];

/** Type guard for {@link ConsolidationLockEventType}. */
export const isConsolidationLockEventType = (
  value: unknown,
): value is ConsolidationLockEventType =>
  typeof value === "string" &&
  (CONSOLIDATION_LOCK_EVENT_TYPES as readonly string[]).includes(value);

/** Refusal codes for {@link tryAcquireConsolidationLock}. */
export const CONSOLIDATION_LOCK_REFUSAL_CODES = [
  "lock_held_by_other",
] as const;

export type ConsolidationLockRefusalCode =
  (typeof CONSOLIDATION_LOCK_REFUSAL_CODES)[number];

/** Closed list of chain-break reasons emitted by the verifier. */
export const CONSOLIDATION_LOCK_CHAIN_BREAK_REASONS = [
  "chain_index_mismatch",
  "duplicate_chain_index",
  "missing_root",
  "parent_hash_mismatch",
  "schema_invalid",
] as const;

export type ConsolidationLockChainBreakReason =
  (typeof CONSOLIDATION_LOCK_CHAIN_BREAK_REASONS)[number];

const HEX_64 = /^[0-9a-f]{64}$/u;
/** Sentinel parentHash for the root lock event. */
export const CONSOLIDATION_LOCK_ROOT_PARENT_HASH: string = "0".repeat(64);

// ---------------------------------------------------------------------------
// Lock body
// ---------------------------------------------------------------------------

/** Lifecycle states recorded in the lock file body. */
export const CONSOLIDATION_LOCK_STATES = ["held", "released"] as const;

export type ConsolidationLockState = (typeof CONSOLIDATION_LOCK_STATES)[number];

export interface ConsolidationLockBody {
  readonly schemaVersion: typeof CONSOLIDATION_LOCK_SCHEMA_VERSION;
  readonly state: ConsolidationLockState;
  readonly holderId: string;
  readonly holderPid: number;
  readonly holderHost: string;
  readonly acquiredAtMs: number;
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

const assertLockBody = (
  body: ConsolidationLockBody,
  where: string,
): void => {
  if ((body.schemaVersion as string) !== CONSOLIDATION_LOCK_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must equal "${CONSOLIDATION_LOCK_SCHEMA_VERSION}"`,
    );
  }
  if (
    typeof body.state !== "string" ||
    !(CONSOLIDATION_LOCK_STATES as readonly string[]).includes(body.state)
  ) {
    throw new TypeError(
      `${where}: state must be one of [${CONSOLIDATION_LOCK_STATES.join(", ")}]`,
    );
  }
  if (typeof body.holderId !== "string" || body.holderId.length === 0) {
    throw new TypeError(`${where}: holderId must be a non-empty string`);
  }
  if (!isPositiveInteger(body.holderPid)) {
    throw new RangeError(`${where}: holderPid must be a positive integer`);
  }
  if (typeof body.holderHost !== "string" || body.holderHost.length === 0) {
    throw new TypeError(`${where}: holderHost must be a non-empty string`);
  }
  if (
    typeof body.acquiredAtMs !== "number" ||
    !Number.isFinite(body.acquiredAtMs) ||
    body.acquiredAtMs < 0
  ) {
    throw new RangeError(`${where}: acquiredAtMs must be a finite non-negative number`);
  }
};

// ---------------------------------------------------------------------------
// Lock-event chain
// ---------------------------------------------------------------------------

export interface ConsolidationLockEvent {
  readonly schemaVersion: typeof CONSOLIDATION_LOCK_SCHEMA_VERSION;
  readonly eventType: ConsolidationLockEventType;
  readonly holderId: string;
  readonly holderPid: number;
  readonly holderHost: string;
  readonly priorHolderId?: string;
  readonly priorHolderPid?: number;
  readonly priorHolderHost?: string;
  readonly priorAcquiredAtMs?: number;
  readonly occurredAtMs: number;
  readonly parentHash: string;
  readonly chainIndex: number;
}

const assertLockEvent = (
  event: ConsolidationLockEvent,
  where: string,
): void => {
  if ((event.schemaVersion as string) !== CONSOLIDATION_LOCK_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must equal "${CONSOLIDATION_LOCK_SCHEMA_VERSION}"`,
    );
  }
  if (!isConsolidationLockEventType(event.eventType)) {
    throw new TypeError(
      `${where}: eventType must be one of [${CONSOLIDATION_LOCK_EVENT_TYPES.join(", ")}]`,
    );
  }
  if (typeof event.holderId !== "string" || event.holderId.length === 0) {
    throw new TypeError(`${where}: holderId must be a non-empty string`);
  }
  if (!isPositiveInteger(event.holderPid)) {
    throw new RangeError(`${where}: holderPid must be a positive integer`);
  }
  if (typeof event.holderHost !== "string" || event.holderHost.length === 0) {
    throw new TypeError(`${where}: holderHost must be a non-empty string`);
  }
  if (
    typeof event.occurredAtMs !== "number" ||
    !Number.isFinite(event.occurredAtMs) ||
    event.occurredAtMs < 0
  ) {
    throw new RangeError(
      `${where}: occurredAtMs must be a finite non-negative number`,
    );
  }
  if (
    typeof event.parentHash !== "string" ||
    !HEX_64.test(event.parentHash)
  ) {
    throw new TypeError(
      `${where}: parentHash must be a 64-char lowercase hex digest`,
    );
  }
  if (
    !Number.isInteger(event.chainIndex) ||
    event.chainIndex < 0
  ) {
    throw new RangeError(`${where}: chainIndex must be a non-negative integer`);
  }
  if (event.chainIndex === 0 && event.parentHash !== CONSOLIDATION_LOCK_ROOT_PARENT_HASH) {
    throw new RangeError(
      `${where}: root event (chainIndex 0) must use the zero-hash sentinel as parentHash`,
    );
  }
  if (event.eventType === "lock_takeover") {
    if (
      typeof event.priorHolderId !== "string" ||
      event.priorHolderId.length === 0
    ) {
      throw new TypeError(
        `${where}: lock_takeover events must include priorHolderId`,
      );
    }
    if (event.priorHolderPid !== undefined && !isPositiveInteger(event.priorHolderPid)) {
      throw new RangeError(
        `${where}: priorHolderPid must be a positive integer when present`,
      );
    }
    if (
      event.priorHolderHost !== undefined &&
      (typeof event.priorHolderHost !== "string" ||
        event.priorHolderHost.length === 0)
    ) {
      throw new TypeError(
        `${where}: priorHolderHost must be a non-empty string when present`,
      );
    }
  }
};

const eventsDirPath = (lessonsDir: string): string =>
  join(lessonsDir, CONSOLIDATION_LOCK_EVENTS_DIRECTORY);

const EVENT_FILENAME_WIDTH = 8;

const eventFilename = (chainIndex: number): string =>
  `${String(chainIndex).padStart(EVENT_FILENAME_WIDTH, "0")}.json`;

const readEventChain = async (
  lessonsDir: string,
): Promise<readonly ConsolidationLockEvent[]> => {
  const dir = eventsDirPath(lessonsDir);
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return Object.freeze([]);
    }
    throw err;
  }
  const jsonFiles = entries.filter((name) => name.endsWith(".json")).sort();
  const events: ConsolidationLockEvent[] = [];
  for (const name of jsonFiles) {
    const raw = await readFile(join(dir, name), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      throw new TypeError(
        `readEventChain: ${name} did not parse to an object`,
      );
    }
    events.push(parsed as ConsolidationLockEvent);
  }
  events.sort((a, b) => a.chainIndex - b.chainIndex);
  return Object.freeze(events);
};

/**
 * Read every chained lock event for `lessonsDir`, in `chainIndex`
 * order. Returns an empty array when no events have been recorded.
 */
export const readConsolidationLockEventChain = async (
  lessonsDir: string,
): Promise<readonly ConsolidationLockEvent[]> => readEventChain(lessonsDir);

const computeEventHash = (event: ConsolidationLockEvent): string =>
  sha256Hex(event);

/** Append a single chain-stamped event under `<lessonsDir>/.lock-events/`. */
const appendLockEvent = async (input: {
  readonly lessonsDir: string;
  readonly seed: Omit<ConsolidationLockEvent, "parentHash" | "chainIndex" | "schemaVersion">;
}): Promise<ConsolidationLockEvent> => {
  await mkdir(eventsDirPath(input.lessonsDir), { recursive: true });
  const previous = await readEventChain(input.lessonsDir);
  const last = previous[previous.length - 1];
  const parentHash =
    last === undefined ? CONSOLIDATION_LOCK_ROOT_PARENT_HASH : computeEventHash(last);
  const chainIndex = last === undefined ? 0 : last.chainIndex + 1;
  const event: ConsolidationLockEvent = {
    schemaVersion: CONSOLIDATION_LOCK_SCHEMA_VERSION,
    ...input.seed,
    parentHash,
    chainIndex,
  };
  assertLockEvent(event, "appendLockEvent");
  const dir = eventsDirPath(input.lessonsDir);
  const finalPath = join(dir, eventFilename(chainIndex));
  const tempPath = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  const serialized = `${canonicalJson(event)}\n`;
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, finalPath);
  return event;
};

/** Verifier diagnostic shape. */
export type VerifyConsolidationLockEventChainResult =
  | {
      readonly ok: true;
      readonly headOfChainHash: string;
      readonly chainLength: number;
    }
  | {
      readonly ok: false;
      readonly code: "chain_break";
      readonly firstBreakIndex: number;
      readonly reason: ConsolidationLockChainBreakReason;
      readonly detail: string;
    };

/**
 * Recompute the lock-events chain offline. Any byte-level mutation of
 * a middle event is reported as `chain_break` at the first affected
 * `chainIndex`. The rules mirror
 * `verifyAgentHarnessCheckpointChain`: monotonic chainIndex, schema
 * invariants, parent-hash propagation.
 */
export const verifyConsolidationLockEventChain = (
  events: readonly ConsolidationLockEvent[],
): VerifyConsolidationLockEventChainResult => {
  if (events.length === 0) {
    return {
      ok: true,
      headOfChainHash: CONSOLIDATION_LOCK_ROOT_PARENT_HASH,
      chainLength: 0,
    };
  }
  const seen = new Set<number>();
  let previousHash = CONSOLIDATION_LOCK_ROOT_PARENT_HASH;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event === undefined) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "schema_invalid",
        detail: `event at position ${i} is undefined`,
      };
    }
    if (seen.has(event.chainIndex)) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: event.chainIndex,
        reason: "duplicate_chain_index",
        detail: `chainIndex ${event.chainIndex} appears more than once`,
      };
    }
    seen.add(event.chainIndex);
    if (event.chainIndex !== i) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "chain_index_mismatch",
        detail: `expected chainIndex ${i}, found ${event.chainIndex}`,
      };
    }
    try {
      assertLockEvent(event, `verifyConsolidationLockEventChain[${i}]`);
    } catch (err) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "schema_invalid",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    if (i === 0) {
      if (event.parentHash !== CONSOLIDATION_LOCK_ROOT_PARENT_HASH) {
        return {
          ok: false,
          code: "chain_break",
          firstBreakIndex: 0,
          reason: "missing_root",
          detail: "root event must reference the zero-hash sentinel",
        };
      }
    } else if (event.parentHash !== previousHash) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "parent_hash_mismatch",
        detail: `parentHash mismatch at chainIndex ${i}: expected ${previousHash}, found ${event.parentHash}`,
      };
    }
    previousHash = computeEventHash(event);
  }
  return {
    ok: true,
    headOfChainHash: previousHash,
    chainLength: events.length,
  };
};

// ---------------------------------------------------------------------------
// Liveness check
// ---------------------------------------------------------------------------

/**
 * Default PID-liveness probe. Cross-host detection is impossible from
 * inside Node.js with no privileges, so we only treat a PID as alive
 * when it is on the same host. PIDs from a different host are treated
 * as alive (conservative — we will not steal a lock cross-host
 * unless the holder-age timeout fires).
 */
export const defaultIsHolderProcessAlive = (input: {
  readonly holderPid: number;
  readonly holderHost: string;
}): boolean => {
  if (input.holderHost !== hostname()) return true;
  try {
    process.kill(input.holderPid, 0);
    return true;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ESRCH"
    ) {
      return false;
    }
    // EPERM means the process exists but we cannot signal it; the
    // safe interpretation is "alive".
    return true;
  }
};

// ---------------------------------------------------------------------------
// Acquire / release / rollback
// ---------------------------------------------------------------------------

const lockPath = (lessonsDir: string): string =>
  join(lessonsDir, CONSOLIDATION_LOCK_FILENAME);

const readLockBody = async (
  path: string,
): Promise<{ readonly body: ConsolidationLockBody; readonly mtimeMs: number } | null> => {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
  const parsed = JSON.parse(raw) as ConsolidationLockBody;
  assertLockBody(parsed, "readLockBody");
  const s = await stat(path);
  return { body: parsed, mtimeMs: s.mtimeMs };
};

/** Successful acquire result. */
export interface TryAcquireConsolidationLockOk {
  readonly ok: true;
  readonly lockPath: string;
  readonly priorMtimeMs: number;
  readonly tookOver: boolean;
  readonly holderId: string;
  readonly holderPid: number;
  readonly holderHost: string;
  readonly acquiredAtMs: number;
  readonly takeoverEvent?: ConsolidationLockEvent;
  readonly acquireEvent: ConsolidationLockEvent;
}

/** Refusal acquire result. */
export interface TryAcquireConsolidationLockRefusal {
  readonly ok: false;
  readonly code: ConsolidationLockRefusalCode;
  readonly holderId: string;
  readonly holderPid: number;
  readonly holderHost: string;
  readonly holderAgeMs: number;
}

export type TryAcquireConsolidationLockResult =
  | TryAcquireConsolidationLockOk
  | TryAcquireConsolidationLockRefusal;

/** Inputs for {@link tryAcquireConsolidationLock}. */
export interface TryAcquireConsolidationLockInput {
  readonly lessonsDir: string;
  readonly holderId: string;
  readonly nowMs: number;
  /** Override for tests; defaults to {@link defaultIsHolderProcessAlive}. */
  readonly isHolderProcessAlive?: (input: {
    readonly holderPid: number;
    readonly holderHost: string;
  }) => boolean;
  /** Override for tests; defaults to `process.pid`. */
  readonly holderPid?: number;
  /** Override for tests; defaults to `os.hostname()`. */
  readonly holderHost?: string;
}

const writeLockBodyAtomic = async (
  path: string,
  body: ConsolidationLockBody,
): Promise<void> => {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(body), "utf8");
  await rename(tempPath, path);
};

const restoreMtime = async (path: string, mtimeMs: number): Promise<void> => {
  const seconds = mtimeMs / 1000;
  await utimes(path, seconds, seconds);
};

/**
 * Attempt to acquire the consolidation lock. Returns a successful
 * envelope on acquisition (including a possible `takeoverEvent` when
 * a stale holder was displaced) or a refusal envelope when the lock
 * is held by a live, recent holder.
 *
 * The mtime of the lock file is *not* touched on acquire — it
 * continues to reflect the last successful consolidation. Only
 * `releaseConsolidationLock` advances the mtime.
 */
export const tryAcquireConsolidationLock = async (
  input: TryAcquireConsolidationLockInput,
): Promise<TryAcquireConsolidationLockResult> => {
  if (typeof input.lessonsDir !== "string" || input.lessonsDir.length === 0) {
    throw new TypeError(
      "tryAcquireConsolidationLock: lessonsDir must be a non-empty string",
    );
  }
  if (typeof input.holderId !== "string" || input.holderId.length === 0) {
    throw new TypeError(
      "tryAcquireConsolidationLock: holderId must be a non-empty string",
    );
  }
  await mkdir(input.lessonsDir, { recursive: true });
  const path = lockPath(input.lessonsDir);
  const isAlive = input.isHolderProcessAlive ?? defaultIsHolderProcessAlive;
  const holderPid = input.holderPid ?? process.pid;
  const holderHost = input.holderHost ?? hostname();

  const heldBody: ConsolidationLockBody = {
    schemaVersion: CONSOLIDATION_LOCK_SCHEMA_VERSION,
    state: "held",
    holderId: input.holderId,
    holderPid,
    holderHost,
    acquiredAtMs: input.nowMs,
  };

  const existing = await readLockBody(path);
  let priorMtimeMs = 0;
  let tookOver = false;
  let takeoverSeed:
    | Omit<
        ConsolidationLockEvent,
        "parentHash" | "chainIndex" | "schemaVersion"
      >
    | null = null;

  if (existing === null) {
    // First-ever acquire: create the lock body. The mtime now
    // reflects the moment of first acquisition; subsequent releases
    // will advance it as the consolidation cursor.
    await writeLockBodyAtomic(path, heldBody);
  } else if (existing.body.state === "released") {
    // Re-acquire: rewrite body to held, preserve mtime so
    // lastConsolidatedAt is unchanged.
    priorMtimeMs = existing.mtimeMs;
    await writeLockBodyAtomic(path, heldBody);
    await restoreMtime(path, priorMtimeMs);
  } else {
    // Held: decide whether to take over.
    const ageMs = input.nowMs - existing.body.acquiredAtMs;
    const stale =
      ageMs > CONSOLIDATION_LOCK_HOLDER_TIMEOUT_MS ||
      !isAlive({
        holderPid: existing.body.holderPid,
        holderHost: existing.body.holderHost,
      });
    if (!stale) {
      return {
        ok: false,
        code: "lock_held_by_other",
        holderId: existing.body.holderId,
        holderPid: existing.body.holderPid,
        holderHost: existing.body.holderHost,
        holderAgeMs: ageMs,
      };
    }
    priorMtimeMs = existing.mtimeMs;
    await writeLockBodyAtomic(path, heldBody);
    await restoreMtime(path, priorMtimeMs);
    tookOver = true;
    takeoverSeed = {
      eventType: "lock_takeover",
      holderId: input.holderId,
      holderPid,
      holderHost,
      priorHolderId: existing.body.holderId,
      priorHolderPid: existing.body.holderPid,
      priorHolderHost: existing.body.holderHost,
      priorAcquiredAtMs: existing.body.acquiredAtMs,
      occurredAtMs: input.nowMs,
    };
  }

  let takeoverEvent: ConsolidationLockEvent | undefined;
  if (takeoverSeed !== null) {
    takeoverEvent = await appendLockEvent({
      lessonsDir: input.lessonsDir,
      seed: takeoverSeed,
    });
  }
  const acquireEvent = await appendLockEvent({
    lessonsDir: input.lessonsDir,
    seed: {
      eventType: "lock_acquired",
      holderId: input.holderId,
      holderPid,
      holderHost,
      occurredAtMs: input.nowMs,
    },
  });

  return {
    ok: true,
    lockPath: path,
    priorMtimeMs,
    tookOver,
    holderId: input.holderId,
    holderPid,
    holderHost,
    acquiredAtMs: input.nowMs,
    ...(takeoverEvent !== undefined ? { takeoverEvent } : {}),
    acquireEvent,
  };
};

/** Inputs for {@link releaseConsolidationLock}. */
export interface ReleaseConsolidationLockInput {
  readonly lessonsDir: string;
  readonly holderId: string;
  readonly nowMs: number;
}

/** Inputs for {@link rollbackConsolidationLock}. */
export interface RollbackConsolidationLockInput {
  readonly lessonsDir: string;
  readonly holderId: string;
  readonly priorMtimeMs: number;
  readonly nowMs: number;
}

/**
 * Release the lock and stamp the lock file's mtime to `nowMs`,
 * which becomes the new `lastConsolidatedAt`. Refuses to release a
 * lock held by a different `holderId`.
 *
 * The file persists in the released state so the mtime cursor
 * survives across runs.
 */
export const releaseConsolidationLock = async (
  input: ReleaseConsolidationLockInput,
): Promise<{ readonly released: boolean; readonly event?: ConsolidationLockEvent }> => {
  const path = lockPath(input.lessonsDir);
  const existing = await readLockBody(path);
  if (existing === null) {
    return { released: false };
  }
  if (existing.body.holderId !== input.holderId) {
    return { released: false };
  }
  if (existing.body.state !== "held") {
    return { released: false };
  }
  const releasedBody: ConsolidationLockBody = {
    ...existing.body,
    state: "released",
  };
  await writeLockBodyAtomic(path, releasedBody);
  await restoreMtime(path, input.nowMs);
  const event = await appendLockEvent({
    lessonsDir: input.lessonsDir,
    seed: {
      eventType: "lock_released",
      holderId: existing.body.holderId,
      holderPid: existing.body.holderPid,
      holderHost: existing.body.holderHost,
      occurredAtMs: input.nowMs,
    },
  });
  return { released: true, event };
};

/**
 * Roll back a partially-completed consolidation. The lock file is
 * marked as released, but the file's mtime is reset to
 * `priorMtimeMs` so `lastConsolidatedAt` does not advance — a
 * failed run must not move the consolidation cursor forward.
 */
export const rollbackConsolidationLock = async (
  input: RollbackConsolidationLockInput,
): Promise<{ readonly rolledBack: boolean; readonly event?: ConsolidationLockEvent }> => {
  const path = lockPath(input.lessonsDir);
  const existing = await readLockBody(path);
  if (existing === null) {
    return { rolledBack: false };
  }
  if (existing.body.holderId !== input.holderId) {
    return { rolledBack: false };
  }
  const releasedBody: ConsolidationLockBody = {
    ...existing.body,
    state: "released",
  };
  await writeLockBodyAtomic(path, releasedBody);
  await restoreMtime(path, input.priorMtimeMs);
  const event = await appendLockEvent({
    lessonsDir: input.lessonsDir,
    seed: {
      eventType: "lock_rolled_back",
      holderId: existing.body.holderId,
      holderPid: existing.body.holderPid,
      holderHost: existing.body.holderHost,
      occurredAtMs: input.nowMs,
    },
  });
  return { rolledBack: true, event };
};

/**
 * Inspect the on-disk lock without acquiring or releasing it.
 * Returns `null` if no lock file exists.
 */
export const inspectConsolidationLock = async (
  lessonsDir: string,
): Promise<
  | (ConsolidationLockBody & { readonly lastConsolidatedAtMs: number })
  | null
> => {
  const path = lockPath(lessonsDir);
  const existing = await readLockBody(path);
  if (existing === null) return null;
  return { ...existing.body, lastConsolidatedAtMs: existing.mtimeMs };
};

/**
 * Read the `lastConsolidatedAt` timestamp recorded as the lock
 * file's mtime, or `null` when the lock has never been held.
 */
export const readLastConsolidatedAtMs = async (
  lessonsDir: string,
): Promise<number | null> => {
  try {
    const s = await stat(lockPath(lessonsDir));
    return s.mtimeMs;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
};
