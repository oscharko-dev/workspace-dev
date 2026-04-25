import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type GeneratedTestCaseList,
  type ReplayCacheEntry,
  type ReplayCacheKey,
  type ReplayCacheLookupResult,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { validateGeneratedTestCaseList } from "./generated-test-case-schema.js";

/**
 * Replay cache for test-intelligence generation jobs.
 *
 * The cache is the only path that guarantees bit-identical replay for an
 * LLM job: a hit returns the previously generated `GeneratedTestCaseList`
 * verbatim and the orchestrator must skip the gateway call entirely.
 *
 * Two implementations are provided:
 *   - `createMemoryReplayCache`: in-process map, useful for tests and for
 *     dry-run mode evaluation pipelines.
 *   - `createFileSystemReplayCache`: JSON-on-disk store rooted at a
 *     caller-controlled directory. Files are written atomically (write to
 *     a tmp file, then rename) so a crashed write never publishes a
 *     half-flushed entry.
 */
export interface ReplayCache {
  readonly kind: "memory" | "filesystem";
  /** Compute the deterministic digest used as the on-disk filename / map key. */
  computeKey(key: ReplayCacheKey): string;
  /** Look up an entry. Hits return a fully-validated `GeneratedTestCaseList`. */
  lookup(key: ReplayCacheKey): Promise<ReplayCacheLookupResult>;
  /** Store an entry. Idempotent: re-storing the same key overwrites. */
  store(key: ReplayCacheKey, testCases: GeneratedTestCaseList): Promise<void>;
}

/** Compute the canonical sha256 digest for a `ReplayCacheKey`. */
export const computeReplayCacheKeyDigest = (key: ReplayCacheKey): string => {
  return sha256Hex(key);
};

/** In-memory replay cache. Returned entries are deep-cloned to avoid aliasing. */
export const createMemoryReplayCache = (): ReplayCache => {
  const store = new Map<string, ReplayCacheEntry>();
  return {
    kind: "memory",
    computeKey: computeReplayCacheKeyDigest,
    lookup: (key) => {
      const digest = computeReplayCacheKeyDigest(key);
      const found = store.get(digest);
      if (!found) {
        return Promise.resolve({ hit: false, key: digest });
      }
      return Promise.resolve({
        hit: true,
        entry: cloneEntry(found),
      });
    },
    store: (key, testCases) => {
      const digest = computeReplayCacheKeyDigest(key);
      const validation = validateGeneratedTestCaseList(testCases);
      if (!validation.valid) {
        return Promise.reject(
          new ReplayCacheValidationError(
            "refusing to store invalid GeneratedTestCaseList",
            validation.errors.map((error) => ({
              path: error.path,
              message: error.message,
            })),
          ),
        );
      }
      const entry: ReplayCacheEntry = {
        key: digest,
        storedAt: new Date(0).toISOString(),
        testCases,
      };
      // Use a stable "storedAt" so cache entries themselves remain
      // deterministic when serialized; callers that need wall-clock time
      // should look at the GeneratedTestCase audit metadata.
      store.set(digest, cloneEntry(entry));
      return Promise.resolve();
    },
  };
};

/** Filesystem replay cache. Writes one JSON file per cache key. */
export const createFileSystemReplayCache = (rootDir: string): ReplayCache => {
  const fileFor = (digest: string): string => join(rootDir, `${digest}.json`);

  return {
    kind: "filesystem",
    computeKey: computeReplayCacheKeyDigest,
    lookup: async (key) => {
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
      const parsed = JSON.parse(raw) as unknown;
      const entry = decodeEntry(digest, parsed);
      const validation = validateGeneratedTestCaseList(entry.testCases);
      if (!validation.valid) {
        throw new ReplayCacheValidationError(
          `replay cache entry ${digest} failed schema validation`,
          validation.errors.map((error) => ({
            path: error.path,
            message: error.message,
          })),
        );
      }
      return { hit: true, entry };
    },
    store: async (key, testCases) => {
      const digest = computeReplayCacheKeyDigest(key);
      const validation = validateGeneratedTestCaseList(testCases);
      if (!validation.valid) {
        throw new ReplayCacheValidationError(
          "refusing to store invalid GeneratedTestCaseList",
          validation.errors.map((error) => ({
            path: error.path,
            message: error.message,
          })),
        );
      }
      const entry: ReplayCacheEntry = {
        key: digest,
        storedAt: new Date(0).toISOString(),
        testCases,
      };
      const path = fileFor(digest);
      await mkdir(dirname(path), { recursive: true });
      const tmpPath = `${path}.${digest.slice(0, 12)}.tmp`;
      await writeFile(tmpPath, canonicalJson(entry), "utf8");
      // Atomic publish: rename never partially writes the destination.
      const { rename } = await import("node:fs/promises");
      await rename(tmpPath, path);
    },
  };
};

/** Error raised when a cache entry fails the structural schema check. */
export class ReplayCacheValidationError extends Error {
  readonly errors: ReadonlyArray<{ path: string; message: string }>;
  constructor(
    message: string,
    errors: ReadonlyArray<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = "ReplayCacheValidationError";
    this.errors = errors;
  }
}

const cloneEntry = (entry: ReplayCacheEntry): ReplayCacheEntry => {
  return JSON.parse(JSON.stringify(entry)) as ReplayCacheEntry;
};

const decodeEntry = (digest: string, parsed: unknown): ReplayCacheEntry => {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ReplayCacheValidationError(
      `replay cache entry ${digest} is not an object`,
      [{ path: "$", message: "expected object" }],
    );
  }
  const candidate = parsed as Record<string, unknown>;
  if (candidate["key"] !== digest) {
    throw new ReplayCacheValidationError(
      `replay cache entry ${digest} key mismatch`,
      [{ path: "$.key", message: `expected "${digest}"` }],
    );
  }
  if (typeof candidate["storedAt"] !== "string") {
    throw new ReplayCacheValidationError(
      `replay cache entry ${digest} missing storedAt`,
      [{ path: "$.storedAt", message: "expected ISO string" }],
    );
  }
  if (
    typeof candidate["testCases"] !== "object" ||
    candidate["testCases"] === null
  ) {
    throw new ReplayCacheValidationError(
      `replay cache entry ${digest} missing testCases`,
      [{ path: "$.testCases", message: "expected object" }],
    );
  }
  return {
    key: candidate["key"],
    storedAt: candidate["storedAt"],
    testCases: candidate["testCases"] as GeneratedTestCaseList,
  };
};

const isNotFoundError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "ENOENT";
};
