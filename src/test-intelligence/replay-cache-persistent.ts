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
import { join } from "node:path";
import type {
  GeneratedTestCaseList,
  ReplayCacheEntry,
  ReplayCacheKey,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { validateGeneratedTestCaseList } from "./generated-test-case-schema.js";
import {
  computeReplayCacheKeyDigest,
  ReplayCacheValidationError,
  type ReplayCache,
} from "./replay-cache.js";

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
   * A short, non-reversible token identifier (e.g. `sha256(apiToken).slice(0, 16)`)
   * used to partition the cache into per-token subdirectories.  Two callers
   * with different `tokenScope` values cannot share cache entries even when
   * the deterministic key digest is identical (issue #1739 / analogous to
   * #1669).
   */
  tokenScope: string;
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

/**
 * Disk-backed, token-scoped, LRU-bounded replay cache (Issue #1739).
 *
 * Files are stored under `<rootDir>/<tokenScope>/<sha256-digest>.json`.
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
  const {
    tokenScope,
    byteBudget = DEFAULT_PERSISTENT_REPLAY_CACHE_BYTE_BUDGET,
    staleThresholdMs = DEFAULT_PERSISTENT_REPLAY_CACHE_STALE_THRESHOLD_MS,
  } = options;

  if (tokenScope.length === 0) {
    throw new RangeError("PersistentReplayCacheOptions.tokenScope must not be empty");
  }

  const scopeDir = join(rootDir, tokenScope);
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
      } catch (err) {
        if (err instanceof ReplayCacheValidationError) throw err;
        throw new ReplayCacheValidationError(
          `persistent replay cache entry ${digest} is not valid JSON`,
          [{ path: "$", message: "invalid JSON" }],
        );
      }

      const validation = validateGeneratedTestCaseList(entry.testCases);
      if (!validation.valid) {
        throw new ReplayCacheValidationError(
          `persistent replay cache entry ${digest} failed schema validation`,
          validation.errors.map((e) => ({ path: e.path, message: e.message })),
        );
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
