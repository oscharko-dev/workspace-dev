/**
 * Gateway-side idempotency keys (HMAC + TTL) for the LLM gateway client
 * (Issue #1784, Story MA-3 #1758).
 *
 * Goals enforced here:
 *   - HMAC-SHA256 of `{jobId, roleStepId, attempt, promptVersion,
 *     schemaHash, inputHash}` keyed by an operator-configured secret.
 *   - TTL-bounded in-memory cache; optional content-addressable disk
 *     cache rooted at `<runDir>/agent/idempotency-cache/<hmac>.json`.
 *   - A second call with the same HMAC inside the TTL window returns
 *     the cached structured success without making a second LLM call
 *     and increments a `gateway_idempotent_replay` counter, distinct
 *     from the existing `replay-cache` per-job hit counter.
 *   - The HMAC secret is supplied through a callback and **never**
 *     persisted in any artifact, log, or error message. Persisted cache
 *     files carry the redacted structured envelope only — no
 *     `rawTextContent`, no chain-of-thought, no secrets.
 *   - Per-role TTL: a cache instance is constructed per role with its
 *     own `ttlMs`, so the harness can pin a tight TTL for cheap roles
 *     and a longer TTL for expensive ones.
 *   - Worker-crash-mid-call replay: because a successful result is
 *     stored on disk before `generate()` returns, a worker that crashes
 *     after the gateway responded but before the orchestrator
 *     persisted downstream state can resume by replaying the same
 *     `LlmGenerationRequest` and pull the result from disk on the
 *     next process.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
  type GatewayIdempotencyInputs,
  type GatewayIdempotencyKey,
  type LlmFinishReason,
  type LlmGenerationSuccess,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/** Canonical sub-directory (relative to `<runDir>`) for cache files. */
export const GATEWAY_IDEMPOTENCY_CACHE_DIRNAME =
  "agent/idempotency-cache" as const;

/**
 * Default TTL for cache entries — 24h. Operators override per role via
 * `createLlmGatewayIdempotencyCache({ ttlMs })`.
 */
export const DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS: number = 24 * 60 * 60 * 1000;

/**
 * Default in-memory entry ceiling per cache instance. Each entry stores
 * a single redacted structured success envelope; the cap exists only to
 * stop a long-running worker from accumulating unbounded memory under
 * pathological churn. Operators override via `maxEntries`.
 */
export const DEFAULT_GATEWAY_IDEMPOTENCY_MAX_ENTRIES: number = 1024;

/**
 * Operator-configured HMAC secret. Either a literal string or a
 * callback invoked once per HMAC computation. The callback shape lets
 * operators source the secret from an in-memory secret manager without
 * the cache itself ever holding the literal value.
 */
export type GatewayIdempotencySecretProvider =
  | string
  | (() => string | Promise<string>);

export interface CreateLlmGatewayIdempotencyCacheOptions {
  /** Operator-configured HMAC secret. Mandatory. */
  readonly hmacSecret: GatewayIdempotencySecretProvider;
  /** Per-role TTL window. Defaults to {@link DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS}. */
  readonly ttlMs?: number;
  /**
   * Optional disk root. When supplied, successful results are
   * persisted to `<diskRoot>/<GATEWAY_IDEMPOTENCY_CACHE_DIRNAME>/<hmac>.json`
   * with the body redacted (no raw text, no secrets). Looking up a
   * miss after a worker restart will read the file and rehydrate the
   * in-memory entry.
   */
  readonly diskRoot?: string;
  /** Wall-clock provider. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /** In-memory entry cap. Defaults to {@link DEFAULT_GATEWAY_IDEMPOTENCY_MAX_ENTRIES}. */
  readonly maxEntries?: number;
}

export interface GatewayIdempotencyMetrics {
  /** Cache hits (cached result returned without dispatching to gateway). */
  readonly replays: number;
  /** Stores (fresh successful results admitted to the cache). */
  readonly stores: number;
  /** Lookups that missed the cache and required a fresh dispatch. */
  readonly misses: number;
  /** Disk reads that successfully rehydrated an in-memory entry. */
  readonly diskReads: number;
  /** Disk reads that failed (missing, malformed, expired). */
  readonly diskReadFailures: number;
  /** Disk writes that succeeded. */
  readonly diskWrites: number;
  /** Disk writes that failed. */
  readonly diskWriteFailures: number;
  /** In-memory entries evicted because the entry cap was reached. */
  readonly memoryEvictions: number;
  /** Cache entries refused because the entry was past TTL. */
  readonly ttlExpirations: number;
}

export type GatewayIdempotencyLookupResult =
  | { readonly hit: true; readonly key: GatewayIdempotencyKey; readonly result: LlmGenerationSuccess }
  | { readonly hit: false; readonly key: GatewayIdempotencyKey };

export interface LlmGatewayIdempotencyCache {
  /** Compute the {@link GatewayIdempotencyKey} for a set of inputs. */
  computeKey(inputs: GatewayIdempotencyInputs): Promise<GatewayIdempotencyKey>;
  /**
   * Lookup a cached result. On miss, returns the computed key so the
   * caller can pass it back to `store` after a successful dispatch.
   */
  lookup(
    inputs: GatewayIdempotencyInputs,
  ): Promise<GatewayIdempotencyLookupResult>;
  /** Admit a fresh successful result keyed by `key.hmac`. */
  store(
    key: GatewayIdempotencyKey,
    result: LlmGenerationSuccess,
  ): Promise<void>;
  /** Snapshot of the cache's running counters. */
  getMetrics(): GatewayIdempotencyMetrics;
  /** Disk root configured for this cache, or `undefined` when memory-only. */
  readonly diskRoot: string | undefined;
  /** Effective TTL window (ms) for entries admitted to this cache. */
  readonly ttlMs: number;
}

/**
 * Compute the HMAC-SHA256 of the canonical-JSON of an inputs envelope.
 * Exported for the gateway test harness; production callers should use
 * `createLlmGatewayIdempotencyCache(...).computeKey()` so the secret
 * stays inside the cache instance.
 */
export const computeGatewayIdempotencyHmac = async (
  inputs: GatewayIdempotencyInputs,
  secret: GatewayIdempotencySecretProvider,
): Promise<string> => {
  const resolvedSecret = await resolveSecret(secret);
  if (resolvedSecret.length === 0) {
    throw new RangeError(
      "GatewayIdempotencyCache: hmac secret must be a non-empty string",
    );
  }
  const payload = canonicalJson(toCanonicalInputs(inputs));
  return createHmac("sha256", resolvedSecret).update(payload).digest("hex");
};

const resolveSecret = async (
  secret: GatewayIdempotencySecretProvider,
): Promise<string> => {
  if (typeof secret === "string") return secret;
  const provided = await secret();
  if (typeof provided !== "string") {
    throw new RangeError(
      "GatewayIdempotencyCache: hmac secret provider returned a non-string value",
    );
  }
  return provided;
};

interface MemoryEntry {
  readonly key: GatewayIdempotencyKey;
  readonly result: LlmGenerationSuccess;
  readonly storedAtMs: number;
}

/** Build a `LlmGatewayIdempotencyCache` instance scoped to a single role. */
export const createLlmGatewayIdempotencyCache = (
  options: CreateLlmGatewayIdempotencyCacheOptions,
): LlmGatewayIdempotencyCache => {
  validateOptions(options);
  const ttlMs = options.ttlMs ?? DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS;
  const clock = options.clock ?? Date.now;
  const maxEntries =
    options.maxEntries ?? DEFAULT_GATEWAY_IDEMPOTENCY_MAX_ENTRIES;
  const diskRoot = options.diskRoot;

  const memory = new Map<string, MemoryEntry>();
  const counters = {
    replays: 0,
    stores: 0,
    misses: 0,
    diskReads: 0,
    diskReadFailures: 0,
    diskWrites: 0,
    diskWriteFailures: 0,
    memoryEvictions: 0,
    ttlExpirations: 0,
  };

  const isFresh = (storedAtMs: number, nowMs: number): boolean =>
    nowMs - storedAtMs < ttlMs;

  const computeKey = async (
    inputs: GatewayIdempotencyInputs,
  ): Promise<GatewayIdempotencyKey> => {
    validateInputs(inputs);
    const hmac = await computeGatewayIdempotencyHmac(
      inputs,
      options.hmacSecret,
    );
    return Object.freeze({
      schemaVersion: GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
      jobId: inputs.jobId,
      roleStepId: inputs.roleStepId,
      attempt: inputs.attempt,
      promptVersion: inputs.promptVersion,
      schemaHash: inputs.schemaHash,
      inputHash: inputs.inputHash,
      hmac,
    });
  };

  const evictOldest = (): void => {
    // Maps preserve insertion order in v8; the first iterator key is the
    // oldest store. This is sufficient for a bounded LRU because every
    // store is a fresh insert (lookups do not refresh the position).
    const oldest = memory.keys().next();
    if (!oldest.done) {
      memory.delete(oldest.value);
      counters.memoryEvictions += 1;
    }
  };

  const tryDiskRead = async (
    key: GatewayIdempotencyKey,
  ): Promise<MemoryEntry | undefined> => {
    if (diskRoot === undefined) return undefined;
    const filePath = resolveCachePath(diskRoot, key.hmac);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      counters.diskReadFailures += 1;
      return undefined;
    }
    const parsed = parseDiskEntry(raw, key);
    if (parsed === undefined) {
      counters.diskReadFailures += 1;
      return undefined;
    }
    counters.diskReads += 1;
    return parsed;
  };

  const persistDiskEntry = async (entry: MemoryEntry): Promise<void> => {
    if (diskRoot === undefined) return;
    const filePath = resolveCachePath(diskRoot, entry.key.hmac);
    const serialised = serialiseDiskEntry(entry);
    const tmpPath = `${filePath}.${process.pid}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(tmpPath, serialised, "utf8");
      await rename(tmpPath, filePath);
      counters.diskWrites += 1;
    } catch {
      counters.diskWriteFailures += 1;
    }
  };

  const lookup = async (
    inputs: GatewayIdempotencyInputs,
  ): Promise<GatewayIdempotencyLookupResult> => {
    const key = await computeKey(inputs);
    const nowMs = clock();
    const inMemory = memory.get(key.hmac);
    if (inMemory !== undefined) {
      if (!isFresh(inMemory.storedAtMs, nowMs)) {
        memory.delete(key.hmac);
        counters.ttlExpirations += 1;
      } else if (hmacMatches(inMemory.key.hmac, key.hmac)) {
        counters.replays += 1;
        return { hit: true, key, result: inMemory.result };
      }
    }
    const fromDisk = await tryDiskRead(key);
    if (fromDisk !== undefined) {
      if (!isFresh(fromDisk.storedAtMs, nowMs)) {
        counters.ttlExpirations += 1;
      } else if (hmacMatches(fromDisk.key.hmac, key.hmac)) {
        memory.set(key.hmac, fromDisk);
        counters.replays += 1;
        return { hit: true, key, result: fromDisk.result };
      }
    }
    counters.misses += 1;
    return { hit: false, key };
  };

  const store = async (
    key: GatewayIdempotencyKey,
    result: LlmGenerationSuccess,
  ): Promise<void> => {
    if (memory.size >= maxEntries && !memory.has(key.hmac)) {
      evictOldest();
    }
    const sanitised = sanitiseResultForStorage(result);
    const entry: MemoryEntry = {
      key,
      result: sanitised,
      storedAtMs: clock(),
    };
    memory.set(key.hmac, entry);
    counters.stores += 1;
    await persistDiskEntry(entry);
  };

  const getMetrics = (): GatewayIdempotencyMetrics =>
    Object.freeze({ ...counters });

  return Object.freeze({
    computeKey,
    lookup,
    store,
    getMetrics,
    diskRoot,
    ttlMs,
  });
};

const validateOptions = (
  options: CreateLlmGatewayIdempotencyCacheOptions,
): void => {
  if (typeof options.hmacSecret === "string" && options.hmacSecret.length === 0) {
    throw new RangeError(
      "GatewayIdempotencyCache: hmacSecret must be a non-empty string",
    );
  }
  if (
    options.ttlMs !== undefined &&
    (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0)
  ) {
    throw new RangeError(
      "GatewayIdempotencyCache: ttlMs must be a positive number",
    );
  }
  if (
    options.maxEntries !== undefined &&
    (!Number.isInteger(options.maxEntries) || options.maxEntries < 1)
  ) {
    throw new RangeError(
      "GatewayIdempotencyCache: maxEntries must be a positive integer",
    );
  }
  if (options.diskRoot !== undefined) {
    if (typeof options.diskRoot !== "string" || options.diskRoot.length === 0) {
      throw new RangeError(
        "GatewayIdempotencyCache: diskRoot must be a non-empty string",
      );
    }
  }
};

const validateInputs = (inputs: GatewayIdempotencyInputs): void => {
  assertNonEmptyString(inputs.jobId, "jobId");
  assertNonEmptyString(inputs.roleStepId, "roleStepId");
  assertNonEmptyString(inputs.promptVersion, "promptVersion");
  assertHexDigest(inputs.schemaHash, "schemaHash");
  assertHexDigest(inputs.inputHash, "inputHash");
  if (!Number.isInteger(inputs.attempt) || inputs.attempt < 1) {
    throw new RangeError(
      "GatewayIdempotencyCache: attempt must be a positive integer",
    );
  }
};

const assertNonEmptyString = (value: unknown, field: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(
      `GatewayIdempotencyCache: ${field} must be a non-empty string`,
    );
  }
};

const assertHexDigest = (value: unknown, field: string): void => {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new RangeError(
      `GatewayIdempotencyCache: ${field} must be a 64-char lowercase sha256 hex digest`,
    );
  }
};

const toCanonicalInputs = (
  inputs: GatewayIdempotencyInputs,
): GatewayIdempotencyInputs => ({
  attempt: inputs.attempt,
  inputHash: inputs.inputHash,
  jobId: inputs.jobId,
  promptVersion: inputs.promptVersion,
  roleStepId: inputs.roleStepId,
  schemaHash: inputs.schemaHash,
});

/**
 * Constant-time HMAC comparison. Both inputs are 64-char lowercase hex
 * digests, so length always matches; this still routes through
 * `timingSafeEqual` to keep the surface free of timing-derived
 * disclosure under unit tests that exercise long-running caches.
 */
const hmacMatches = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
};

/**
 * Cache filename resolution. The `hmac` is a 64-char lowercase hex
 * string with no path metacharacters, so a shape check is sufficient
 * defence-in-depth against a malformed key. We additionally re-anchor
 * `resolve(...)` and verify the resolved path is below the cache root
 * to refuse traversal regressions, even though the regex already
 * forbids `/` and `\`.
 */
const resolveCachePath = (diskRoot: string, hmac: string): string => {
  if (!/^[0-9a-f]{64}$/.test(hmac)) {
    throw new RangeError(
      "GatewayIdempotencyCache: refusing to resolve cache path for non-hex hmac",
    );
  }
  const cacheRoot = resolve(diskRoot, GATEWAY_IDEMPOTENCY_CACHE_DIRNAME);
  const filePath = resolve(cacheRoot, `${hmac}.json`);
  if (!filePath.startsWith(cacheRoot + sep) && filePath !== cacheRoot) {
    throw new RangeError(
      "GatewayIdempotencyCache: resolved cache path escaped diskRoot",
    );
  }
  return filePath;
};

interface DiskEntryEnvelope {
  readonly schemaVersion: typeof GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION;
  readonly storedAtMs: number;
  readonly key: GatewayIdempotencyKey;
  readonly result: LlmGenerationSuccess;
}

const serialiseDiskEntry = (entry: MemoryEntry): string => {
  const envelope: DiskEntryEnvelope = {
    schemaVersion: GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
    storedAtMs: entry.storedAtMs,
    key: entry.key,
    result: entry.result,
  };
  return canonicalJson(envelope);
};

const parseDiskEntry = (
  raw: string,
  expectedKey: GatewayIdempotencyKey,
): MemoryEntry | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const envelope = parsed as Record<string, unknown>;
  if (envelope["schemaVersion"] !== GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION) {
    return undefined;
  }
  const storedAtMs = envelope["storedAtMs"];
  if (typeof storedAtMs !== "number" || !Number.isFinite(storedAtMs)) {
    return undefined;
  }
  const key = parseKey(envelope["key"]);
  if (key === undefined) return undefined;
  if (!hmacMatches(key.hmac, expectedKey.hmac)) return undefined;
  const result = parseSuccess(envelope["result"]);
  if (result === undefined) return undefined;
  return { key, result, storedAtMs };
};

const parseKey = (value: unknown): GatewayIdempotencyKey | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const k = value as Record<string, unknown>;
  if (k["schemaVersion"] !== GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION) {
    return undefined;
  }
  if (
    typeof k["jobId"] !== "string" ||
    typeof k["roleStepId"] !== "string" ||
    typeof k["promptVersion"] !== "string" ||
    typeof k["schemaHash"] !== "string" ||
    typeof k["inputHash"] !== "string" ||
    typeof k["hmac"] !== "string" ||
    typeof k["attempt"] !== "number" ||
    !Number.isInteger(k["attempt"])
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
    jobId: k["jobId"],
    roleStepId: k["roleStepId"],
    promptVersion: k["promptVersion"],
    schemaHash: k["schemaHash"],
    inputHash: k["inputHash"],
    hmac: k["hmac"],
    attempt: k["attempt"],
  });
};

const parseSuccess = (value: unknown): LlmGenerationSuccess | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (r["outcome"] !== "success") return undefined;
  if (
    typeof r["modelDeployment"] !== "string" ||
    typeof r["modelRevision"] !== "string" ||
    typeof r["gatewayRelease"] !== "string" ||
    typeof r["finishReason"] !== "string" ||
    typeof r["attempt"] !== "number" ||
    !Number.isInteger(r["attempt"])
  ) {
    return undefined;
  }
  if (!isFinishReason(r["finishReason"])) return undefined;
  const usage = r["usage"];
  if (typeof usage !== "object" || usage === null) return undefined;
  const usageRecord = usage as Record<string, unknown>;
  const success: LlmGenerationSuccess = {
    outcome: "success",
    content: r["content"],
    finishReason: r["finishReason"],
    usage: {
      ...(typeof usageRecord["inputTokens"] === "number"
        ? { inputTokens: usageRecord["inputTokens"] }
        : {}),
      ...(typeof usageRecord["outputTokens"] === "number"
        ? { outputTokens: usageRecord["outputTokens"] }
        : {}),
    },
    modelDeployment: r["modelDeployment"],
    modelRevision: r["modelRevision"],
    gatewayRelease: r["gatewayRelease"],
    attempt: r["attempt"],
  };
  return success;
};

const ALLOWED_FINISH_REASONS: ReadonlyArray<LlmFinishReason> = [
  "stop",
  "length",
  "content_filter",
  "tool_calls",
  "other",
];

const isFinishReason = (value: string): value is LlmFinishReason =>
  (ALLOWED_FINISH_REASONS as ReadonlyArray<string>).includes(value);

/**
 * Strip fields that must never be persisted alongside an idempotency
 * cache entry (raw text bodies, any future side-channel field). The
 * structured `content` is retained because that is the contract — a
 * cached replay must return the same structured result a fresh dispatch
 * would have returned.
 */
const sanitiseResultForStorage = (
  result: LlmGenerationSuccess,
): LlmGenerationSuccess => {
  const sanitised: LlmGenerationSuccess = {
    outcome: "success",
    content: result.content,
    finishReason: result.finishReason,
    usage: {
      ...(typeof result.usage.inputTokens === "number"
        ? { inputTokens: result.usage.inputTokens }
        : {}),
      ...(typeof result.usage.outputTokens === "number"
        ? { outputTokens: result.usage.outputTokens }
        : {}),
    },
    modelDeployment: result.modelDeployment,
    modelRevision: result.modelRevision,
    gatewayRelease: result.gatewayRelease,
    attempt: result.attempt,
  };
  return sanitised;
};

/** Resolve the on-disk cache path for a given disk root and hmac. */
export const gatewayIdempotencyCachePath = (
  diskRoot: string,
  hmac: string,
): string => resolveCachePath(diskRoot, hmac);

/** Compose a cache directory path under `runDir`. */
export const gatewayIdempotencyCacheDir = (runDir: string): string =>
  join(runDir, GATEWAY_IDEMPOTENCY_CACHE_DIRNAME);
