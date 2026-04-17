import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RateLimitBucket, RateLimitStore } from "./rate-limit.js";

interface PersistedRateLimitBucket {
  key: string;
  timestamps: number[];
  lastSeenAt: number;
}

interface PersistedRateLimitEnvelope {
  schemaVersion: number;
  buckets: PersistedRateLimitBucket[];
}

const RATE_LIMIT_STORE_CORRUPT = "E_RATE_LIMIT_STORE_CORRUPT";
const RATE_LIMIT_STORE_SCHEMA_VERSION = 1;
const fileMutexes = new Map<string, Promise<void>>();

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumberArray = (value: unknown): value is number[] => {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
};

const isPersistedRateLimitBucket = (
  value: unknown
): value is PersistedRateLimitBucket => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.key === "string" &&
    isFiniteNumberArray(value.timestamps) &&
    typeof value.lastSeenAt === "number" &&
    Number.isFinite(value.lastSeenAt)
  );
};

const createRateLimitStoreCorruptError = ({
  filePath,
  reason
}: {
  filePath: string;
  reason: string;
}): Error & { code: string } => {
  return Object.assign(
    new Error(`Rate limit store '${filePath}' is unreadable or incompatible: ${reason}`),
    { code: RATE_LIMIT_STORE_CORRUPT }
  );
};

const readBucketsFile = async ({
  filePath
}: {
  filePath: string;
}): Promise<Map<string, RateLimitBucket>> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return new Map<string, RateLimitBucket>();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createRateLimitStoreCorruptError({
      filePath,
      reason: "JSON parse failed"
    });
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.buckets)) {
    throw createRateLimitStoreCorruptError({
      filePath,
      reason: "persisted envelope shape is invalid"
    });
  }
  if (parsed.schemaVersion !== RATE_LIMIT_STORE_SCHEMA_VERSION) {
    return new Map<string, RateLimitBucket>();
  }

  const buckets = new Map<string, RateLimitBucket>();
  for (const [index, entry] of parsed.buckets.entries()) {
    if (!isPersistedRateLimitBucket(entry)) {
      throw createRateLimitStoreCorruptError({
        filePath,
        reason: `bucket entry at index ${String(index)} is invalid`
      });
    }
    buckets.set(entry.key, {
      timestamps: [...entry.timestamps],
      lastSeenAt: entry.lastSeenAt
    });
  }
  return buckets;
};

const writeBucketsFile = async ({
  filePath,
  buckets
}: {
  filePath: string;
  buckets: Map<string, RateLimitBucket>;
}): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const envelope: PersistedRateLimitEnvelope = {
    schemaVersion: RATE_LIMIT_STORE_SCHEMA_VERSION,
    buckets: [...buckets.entries()]
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, bucket]) => ({
        key,
        timestamps: [...bucket.timestamps],
        lastSeenAt: bucket.lastSeenAt
      }))
  };
  await writeFile(temporaryPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
};

const runSerialized = async <T>(filePath: string, task: () => Promise<T>): Promise<T> => {
  const previous = fileMutexes.get(filePath) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tracked = next.then(
    () => undefined,
    () => undefined
  );
  fileMutexes.set(filePath, tracked);
  try {
    return await next;
  } finally {
    if (fileMutexes.get(filePath) === tracked) {
      fileMutexes.delete(filePath);
    }
  }
};

export const createFileBackedRateLimitStore = ({
  filePath
}: {
  filePath: string;
}): RateLimitStore => {
  return {
    update: async <T>(
      task: (buckets: Map<string, RateLimitBucket>) => T | Promise<T>
    ): Promise<T> => {
      return await runSerialized(filePath, async () => {
        const buckets = await readBucketsFile({ filePath });
        const result = await task(buckets);
        await writeBucketsFile({ filePath, buckets });
        return result;
      });
    }
  };
};
