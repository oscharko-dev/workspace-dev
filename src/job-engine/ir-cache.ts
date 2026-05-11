// ---------------------------------------------------------------------------
// ir-cache.ts — Content-addressed cache for IR derivation results
// Hashes the cleaned Figma JSON to skip re-derivation when unchanged.
// See issue #315.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesignIR } from "../parity/types.js";
import { getErrorMessage } from "./errors.js";

const IR_CACHE_ENTRY_VERSION = 1;
const DEFAULT_MAX_IR_CACHE_ENTRIES = 50;
// Keep the shared IR cache bounded even when individual entries are unusually large.
const DEFAULT_MAX_IR_CACHE_BYTES = 128 * 1024 * 1024;

export interface IrCacheEntry {
  version: number;
  contentHash: string;
  cachedAt: number;
  ttlMs: number;
  optionsHash: string;
  ir: DesignIR;
}

interface IrCacheDerivationOptions {
  screenElementBudget?: number;
  screenElementMaxDepth?: number;
  brandTheme?: string;
  sparkasseTokensFilePath?: string;
  figmaSourceMode?: string;
  mcpEnrichmentFingerprint?: string;
}

const toCanonicalJsonString = (value: unknown): string => {
  return JSON.stringify(toCanonicalJsonValue(value));
};

const toCanonicalJsonValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort((left, right) => left.localeCompare(right))) {
      output[key] = toCanonicalJsonValue(record[key]);
    }
    return output;
  }
  return value;
};

export const computeContentHash = (cleanedFigmaJson: unknown): string => {
  const canonical = toCanonicalJsonString(cleanedFigmaJson);
  return createHash("sha256").update(canonical).digest("hex");
};

export const computeOptionsHash = (options: IrCacheDerivationOptions): string => {
  const canonical = toCanonicalJsonString({
    screenElementBudget: options.screenElementBudget,
    screenElementMaxDepth: options.screenElementMaxDepth,
    brandTheme: options.brandTheme,
    sparkasseTokensFilePath: options.sparkasseTokensFilePath,
    figmaSourceMode: options.figmaSourceMode,
    mcpEnrichmentFingerprint: options.mcpEnrichmentFingerprint
  });
  return createHash("sha256").update(canonical).digest("hex");
};

const toCacheFilePath = ({ cacheDir, contentHash, optionsHash }: { cacheDir: string; contentHash: string; optionsHash: string }): string => {
  return path.join(cacheDir, `ir-${contentHash.slice(0, 16)}-${optionsHash.slice(0, 8)}.json`);
};

const emitIrCacheDebugLog = ({
  onDebugLog,
  operation,
  error,
  details
}: {
  onDebugLog?: (message: string) => void;
  operation: string;
  error: unknown;
  details: string;
}): void => {
  onDebugLog?.(`IR cache debug: operation=${operation}; ${details}; error=${getErrorMessage(error)}.`);
};

export const loadCachedIr = async ({
  cacheDir,
  contentHash,
  optionsHash,
  ttlMs,
  onLog,
  onDebugLog
}: {
  cacheDir: string;
  contentHash: string;
  optionsHash: string;
  ttlMs: number;
  onLog: (message: string) => void;
  onDebugLog?: (message: string) => void;
}): Promise<DesignIR | undefined> => {
  const cacheFilePath = toCacheFilePath({ cacheDir, contentHash, optionsHash });

  let raw: string;
  try {
    raw = await readFile(cacheFilePath, "utf8");
  } catch (error) {
    emitIrCacheDebugLog({
      operation: "loadCachedIr.read",
      error,
      details: `cacheFilePath='${cacheFilePath}'; contentHash=${contentHash.slice(0, 12)}; optionsHash=${optionsHash.slice(0, 8)}`,
      ...(onDebugLog ? { onDebugLog } : {})
    });
    return undefined;
  }

  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch (error) {
    emitIrCacheDebugLog({
      operation: "loadCachedIr.parse",
      error,
      details: `cacheFilePath='${cacheFilePath}'; contentHash=${contentHash.slice(0, 12)}; optionsHash=${optionsHash.slice(0, 8)}`,
      ...(onDebugLog ? { onDebugLog } : {})
    });
    onLog("IR cache: corrupt entry, ignoring.");
    return undefined;
  }

  if (
    typeof entry !== "object" ||
    entry === null ||
    !("version" in entry) ||
    !("contentHash" in entry) ||
    !("cachedAt" in entry) ||
    !("ttlMs" in entry) ||
    !("optionsHash" in entry) ||
    !("ir" in entry)
  ) {
    onLog("IR cache: invalid entry structure, ignoring.");
    return undefined;
  }

  const typed = entry as IrCacheEntry;

  if (typed.version !== IR_CACHE_ENTRY_VERSION) {
    onLog(`IR cache: version mismatch (found=${typed.version}, expected=${IR_CACHE_ENTRY_VERSION}), ignoring.`);
    return undefined;
  }

  if (typed.contentHash !== contentHash) {
    onLog("IR cache: content hash mismatch, ignoring.");
    return undefined;
  }

  if (typed.optionsHash !== optionsHash) {
    onLog("IR cache: options hash mismatch, ignoring.");
    return undefined;
  }

  const age = Date.now() - typed.cachedAt;
  if (age > ttlMs) {
    onLog(`IR cache: entry expired (age=${Math.round(age / 1000)}s, ttl=${Math.round(ttlMs / 1000)}s), ignoring.`);
    return undefined;
  }

  const ir = typed.ir;
  if (!Array.isArray(ir.screens) || ir.screens.length === 0) {
    onLog("IR cache: cached IR has invalid structure, ignoring.");
    return undefined;
  }

  onLog(`IR cache hit: reusing cached IR (age=${Math.round(age / 1000)}s, screens=${ir.screens.length}).`);
  return ir;
};

export const saveCachedIr = async ({
  cacheDir,
  contentHash,
  optionsHash,
  ttlMs,
  ir,
  maxEntries = DEFAULT_MAX_IR_CACHE_ENTRIES,
  maxBytes = DEFAULT_MAX_IR_CACHE_BYTES,
  onLog,
  onDebugLog
}: {
  cacheDir: string;
  contentHash: string;
  optionsHash: string;
  ttlMs: number;
  ir: DesignIR;
  maxEntries?: number;
  maxBytes?: number;
  onLog: (message: string) => void;
  onDebugLog?: (message: string) => void;
}): Promise<void> => {
  const cacheFilePath = toCacheFilePath({ cacheDir, contentHash, optionsHash });

  const entry: IrCacheEntry = {
    version: IR_CACHE_ENTRY_VERSION,
    contentHash,
    cachedAt: Date.now(),
    ttlMs,
    optionsHash,
    ir
  };

  try {
    await mkdir(cacheDir, { recursive: true });
    const tmpPath = `${cacheFilePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    await rename(tmpPath, cacheFilePath);
    onLog(`IR cache write completed (hash=${contentHash.slice(0, 12)}…, screens=${ir.screens.length}).`);
  } catch (error) {
    onLog(`IR cache write failed: ${getErrorMessage(error)}.`);
  }

  try {
    await evictStaleCacheEntries({
      cacheDir,
      ttlMs,
      maxEntries,
      maxBytes,
      onLog,
      ...(onDebugLog ? { onDebugLog } : {})
    });
  } catch (error) {
    emitIrCacheDebugLog({
      operation: "saveCachedIr.evictStaleCacheEntries",
      error,
      details: `cacheDir='${cacheDir}'; ttlMs=${ttlMs}`,
      ...(onDebugLog ? { onDebugLog } : {})
    });
  }
};

const evictStaleCacheEntries = async ({
  cacheDir,
  ttlMs,
  maxEntries,
  maxBytes,
  onLog,
  onDebugLog
}: {
  cacheDir: string;
  ttlMs: number;
  maxEntries: number;
  maxBytes: number;
  onLog: (message: string) => void;
  onDebugLog?: (message: string) => void;
}): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch (error) {
    emitIrCacheDebugLog({
      operation: "evictStaleCacheEntries.readdir",
      error,
      details: `cacheDir='${cacheDir}'`,
      ...(onDebugLog ? { onDebugLog } : {})
    });
    return;
  }

  const irEntries = entries.filter((name) => name.startsWith("ir-") && name.endsWith(".json"));

  const withStats = await Promise.all(
    irEntries.map(async (name) => {
      const filePath = path.join(cacheDir, name);
      try {
        const fileStat = await stat(filePath);
        return { name, filePath, mtimeMs: fileStat.mtimeMs, size: fileStat.size };
      } catch (error) {
        emitIrCacheDebugLog({
          operation: "evictStaleCacheEntries.stat",
          error,
          details: `cacheDir='${cacheDir}'; filePath='${filePath}'`,
          ...(onDebugLog ? { onDebugLog } : {})
        });
        return { name, filePath, mtimeMs: 0, size: 0 };
      }
    })
  );

  withStats.sort((left, right) => left.mtimeMs - right.mtimeMs);

  const now = Date.now();
  let evictedCount = 0;
  let totalBytes = withStats.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of withStats) {
    const remainingEntries = irEntries.length - evictedCount;
    const overEntryLimit = remainingEntries > maxEntries;
    const overByteLimit = totalBytes > maxBytes;
    if (!overEntryLimit && !overByteLimit) {
      break;
    }
    const age = now - entry.mtimeMs;
    if (age > ttlMs || overEntryLimit || overByteLimit) {
      try {
        await unlink(entry.filePath);
        evictedCount++;
        totalBytes = Math.max(0, totalBytes - entry.size);
      } catch (error) {
        emitIrCacheDebugLog({
          operation: "evictStaleCacheEntries.unlink",
          error,
          details: `cacheDir='${cacheDir}'; filePath='${entry.filePath}'`,
          ...(onDebugLog ? { onDebugLog } : {})
        });
      }
    }
  }

  if (evictedCount > 0) {
    onLog(`IR cache eviction: removed ${evictedCount} stale entries.`);
  }
};
