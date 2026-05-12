import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  GeneratedTestCaseList,
  ReplayCacheEntry,
  ReplayCacheKey,
  TenantScope,
} from "../contracts/index.js";
import { assertLocalFilesystemPath } from "./air-gap-guard.js";
import { canonicalJson } from "./content-hash.js";
import { validateGeneratedTestCaseList } from "./generated-test-case-schema.js";
import type { LlmCircuitPersistentState } from "./llm-circuit-breaker.js";
import {
  computeReplayCacheKeyDigest,
  ReplayCacheValidationError,
  resolveTenantScopeSegments,
  type ReplayCache,
} from "./replay-cache.js";
import { recordPersistentStoreRead } from "./tenant-isolation-guard.js";

/** Default maximum disk budget for the persistent replay cache (100 MiB). */
export const DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET: number =
  100 * 1024 * 1024;

/**
 * Age threshold for stale temp files (10 minutes). A `.tmp` file older than
 * this threshold is considered orphaned by a crashed writer and may be removed
 * before a new write begins.
 */
export const DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS: number =
  10 * 60 * 1000;

export interface PersistentReplayCacheOptions {
  /**
   * Multi-tenant scope (Issue #1944) that partitions the cache directory.
   * The cache is bound to exactly this scope at construction time: paths
   * outside `<rootDir>/<tenantId>/<environmentId>/<projectId>/…` are
   * unaddressable, so cross-tenant reads are denied at the loader level.
   * Single-tenant callers should pass `DEFAULT_TENANT_SCOPE`.
   */
  tenantScope: TenantScope;
  /**
   * Maximum total byte size of `.json` cache files allowed on disk before
   * LRU eviction kicks in.  Defaults to
   * {@link DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET} (100 MiB).
   */
  byteBudget?: number;
  /**
   * Age in milliseconds after which a `.tmp` file is considered stale
   * (orphaned by a crashed writer) and may be cleaned up before a new write.
   * Defaults to {@link DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS}
   * (10 minutes).
   */
  staleThresholdMs?: number;
}

export const PERSISTENT_CIRCUIT_BREAKER_STATE_SCHEMA_VERSION =
  "1.0.0" as const;

export interface PersistentCircuitBreakerStateEntry {
  updatedAt: string;
  snapshot: LlmCircuitPersistentState;
}

interface PersistentCircuitBreakerStateFile {
  schemaVersion: typeof PERSISTENT_CIRCUIT_BREAKER_STATE_SCHEMA_VERSION;
  entries: Record<string, PersistentCircuitBreakerStateEntry>;
}

/**
 * Disk-backed, tenant-scoped, LRU-bounded replay cache (Issues #1739, #1944).
 *
 * Files are stored under
 * `<rootDir>/<tenantId>/<environmentId>/<projectId>/<sha256-digest>.json`.
 * Writes are atomic (temp-file rename); concurrent writers for the same key
 * produce identical, deterministic content so the last rename always wins
 * without corruption.  After each write the LRU eviction pass removes the
 * least-recently-used entries until the directory is within `byteBudget`.
 * On read, the file's mtime is refreshed so recently-used entries survive
 * longer than cold entries.
 */
export const createPersistentReplayCache = (
  rootDir: string,
  options: PersistentReplayCacheOptions,
): ReplayCache => {
  // Issue #2187 — fail-closed guard for sovereign-cloud / air-gap
  // deployments. Under `WORKSPACE_TEST_SPACE_AIR_GAP_MODE=1`, a cache
  // root that points at a remote scheme (`s3://`, `https://`, `gs://`,
  // …) is rejected at construction time so a misconfigured operator
  // cannot silently exfiltrate replay-cache content out of the
  // air-gapped boundary. Outside air-gap mode the assertion is a
  // no-op so existing call sites are unaffected.
  assertLocalFilesystemPath(rootDir, { subsystem: "persistent replay cache" });
  const {
    tenantScope,
    byteBudget = DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET,
    staleThresholdMs = DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS,
  } = options;

  const segments = resolveTenantScopeSegments(tenantScope);
  const scopeDir = join(rootDir, ...segments);
  const fileFor = (digest: string): string => join(scopeDir, `${digest}.json`);
  // Include process.pid AND a per-call random suffix so concurrent in-process
  // stores for the same key don't collide on the same temp file.
  const tmpFileFor = (digest: string): string =>
    join(
      scopeDir,
      `${digest}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
    );

  return {
    kind: "filesystem",
    computeKey: computeReplayCacheKeyDigest,

    lookup: async (key: ReplayCacheKey) => {
      const digest = computeReplayCacheKeyDigest(key);
      // Issue #2176 — runtime tenant-isolation guard. Asserts that the
      // active AsyncLocalStorage scope (if any) matches the cache's
      // construction-time scope before we even touch the disk; a
      // mismatch throws TenantIsolationViolation and aborts the run.
      recordPersistentStoreRead("replay-cache.lookup", tenantScope);
      const path = fileFor(digest);
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch (err) {
        if (isNotFoundError(err)) {
          return { hit: false, key: digest };
        }
        throw err;
      }

      let entry: ReplayCacheEntry;
      try {
        const parsed = JSON.parse(raw) as unknown;
        entry = decodeEntry(digest, parsed);
        const validation = validateGeneratedTestCaseList(entry.testCases);
        if (!validation.valid) {
          throw new ReplayCacheValidationError(
            `persistent replay cache entry ${digest} failed schema validation`,
            validation.errors.map((e) => ({
              path: e.path,
              message: e.message,
            })),
          );
        }
      } catch (err) {
        await quarantineCorruptCacheEntry(path, digest);
        return { hit: false, key: digest };
      }

      // Refresh mtime so this entry is treated as recently-used by LRU eviction.
      const now = new Date();
      await utimes(path, now, now).catch(() => {
        // Non-fatal: eviction uses mtime, so a missed refresh just means this
        // entry may be evicted earlier than optimal — not a correctness issue.
      });

      return { hit: true, entry };
    },

    store: async (key: ReplayCacheKey, testCases: GeneratedTestCaseList) => {
      const digest = computeReplayCacheKeyDigest(key);
      recordPersistentStoreRead("replay-cache.store", tenantScope);
      const validation = validateGeneratedTestCaseList(testCases);
      if (!validation.valid) {
        throw new ReplayCacheValidationError(
          "refusing to store invalid GeneratedTestCaseList",
          validation.errors.map((e) => ({ path: e.path, message: e.message })),
        );
      }

      await mkdir(scopeDir, { recursive: true });

      // Clean up stale .tmp files before writing (orphaned by crashed writers).
      await cleanStaleTmpFiles(scopeDir, staleThresholdMs);

      const entry: ReplayCacheEntry = {
        key: digest,
        storedAt: new Date().toISOString(),
        testCases,
      };
      const path = fileFor(digest);
      const tmpPath = tmpFileFor(digest);
      await writeFile(tmpPath, canonicalJson(entry), "utf8");
      // Atomic publish: rename never partially writes the destination.
      await rename(tmpPath, path);

      // LRU eviction: remove the oldest entries until total size ≤ byteBudget.
      await evictLru(scopeDir, byteBudget);
    },
  };
};

export const loadPersistentCircuitBreakerState = async (input: {
  path: string;
  key: string;
}): Promise<PersistentCircuitBreakerStateEntry | undefined> => {
  let raw: string;
  try {
    raw = await readFile(input.path, "utf8");
  } catch (err) {
    if (isNotFoundError(err)) return undefined;
    throw err;
  }
  const file = decodePersistentCircuitBreakerStateFile(
    JSON.parse(raw) as unknown,
  );
  return file.entries[input.key];
};

export const writePersistentCircuitBreakerState = async (input: {
  path: string;
  key: string;
  entry: PersistentCircuitBreakerStateEntry;
}): Promise<void> => {
  let file: PersistentCircuitBreakerStateFile = {
    schemaVersion: PERSISTENT_CIRCUIT_BREAKER_STATE_SCHEMA_VERSION,
    entries: {},
  };
  try {
    const raw = await readFile(input.path, "utf8");
    file = decodePersistentCircuitBreakerStateFile(JSON.parse(raw) as unknown);
  } catch (err) {
    if (!(err instanceof SyntaxError) && !isNotFoundError(err)) {
      throw err;
    }
  }
  file.entries[input.key] = input.entry;
  await writeAtomicJson(input.path, file);
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const decodeEntry = (digest: string, parsed: unknown): ReplayCacheEntry => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ReplayCacheValidationError(
      `persistent replay cache entry ${digest} is not an object`,
      [{ path: "$", message: "expected object" }],
    );
  }
  const c = parsed as Record<string, unknown>;
  if (c["key"] !== digest) {
    throw new ReplayCacheValidationError(
      `persistent replay cache entry ${digest} key mismatch`,
      [{ path: "$.key", message: `expected "${digest}"` }],
    );
  }
  if (typeof c["storedAt"] !== "string") {
    throw new ReplayCacheValidationError(
      `persistent replay cache entry ${digest} missing storedAt`,
      [{ path: "$.storedAt", message: "expected ISO string" }],
    );
  }
  if (typeof c["testCases"] !== "object" || c["testCases"] === null) {
    throw new ReplayCacheValidationError(
      `persistent replay cache entry ${digest} missing testCases`,
      [{ path: "$.testCases", message: "expected object" }],
    );
  }
  return {
    key: c["key"],
    storedAt: c["storedAt"],
    testCases: c["testCases"] as GeneratedTestCaseList,
  };
};

const isNotFoundError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "ENOENT";
};

const decodePersistentCircuitBreakerStateFile = (
  parsed: unknown,
): PersistentCircuitBreakerStateFile => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(
      "persistent circuit breaker state file must be an object",
    );
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate["entries"] !== "object" ||
    candidate["entries"] === null ||
    Array.isArray(candidate["entries"])
  ) {
    throw new TypeError(
      "persistent circuit breaker state file entries must be an object",
    );
  }
  return {
    schemaVersion: PERSISTENT_CIRCUIT_BREAKER_STATE_SCHEMA_VERSION,
    entries: candidate["entries"] as Record<
      string,
      PersistentCircuitBreakerStateEntry
    >,
  };
};

const writeAtomicJson = async (path: string, value: unknown): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, canonicalJson(value), "utf8");
  await rename(tmpPath, path);
};

const quarantineCorruptCacheEntry = async (
  path: string,
  _digest: string,
): Promise<void> => {
  const quarantinePath = `${path}.corrupt-${Date.now().toString(36)}`;
  try {
    await rename(path, quarantinePath);
  } catch {
    await rm(path, { force: true }).catch(() => {});
  }
};

/**
 * Delete `.tmp` files in `dir` that are older than `thresholdMs`.
 * Failures are silently swallowed — a stale .tmp file is benign.
 */
const cleanStaleTmpFiles = async (
  dir: string,
  thresholdMs: number,
): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".tmp"))
      .map(async (name) => {
        const path = join(dir, name);
        try {
          const s = await stat(path);
          if (now - s.mtimeMs > thresholdMs) {
            await rm(path, { force: true });
          }
        } catch {
          // Non-fatal.
        }
      }),
  );
};

interface CacheFileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

/**
 * Remove the least-recently-used `.json` files from `dir` until the total
 * size of all `.json` files is at or below `byteBudget`.
 */
const evictLru = async (dir: string, byteBudget: number): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  const jsonNames = entries.filter((name) => name.endsWith(".json"));
  if (jsonNames.length === 0) return;

  const infos: CacheFileInfo[] = (
    await Promise.all(
      jsonNames.map(async (name): Promise<CacheFileInfo | null> => {
        const path = join(dir, name);
        try {
          const s = await stat(path);
          return { path, size: s.size, mtimeMs: s.mtimeMs };
        } catch {
          return null;
        }
      }),
    )
  ).filter((info): info is CacheFileInfo => info !== null);

  const totalBytes = infos.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes <= byteBudget) return;

  // Sort ascending by mtime: oldest (LRU) entries come first.
  infos.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let remaining = totalBytes;
  for (const info of infos) {
    if (remaining <= byteBudget) break;
    try {
      await rm(info.path, { force: true });
      remaining -= info.size;
    } catch {
      // Non-fatal: concurrent eviction from another process is fine.
    }
  }
};
