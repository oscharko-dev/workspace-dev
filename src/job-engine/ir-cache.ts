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
const MAX_IR_CACHE_ENTRIES = 50;

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

export const loadCachedIr = async ({
  cacheDir,
  contentHash,
  optionsHash,
  ttlMs,
  onLog
}: {
  cacheDir: string;
  contentHash: string;
  optionsHash: string;
  ttlMs: number;
  onLog: (message: string) => void;
}): Promise<DesignIR | undefined> => {
  const cacheFilePath = toCacheFilePath({ cacheDir, contentHash, optionsHash });

  let raw: string;
  try {
    raw = await readFile(cacheFilePath, "utf8");
  } catch {
    return undefined;
  }

  let entry: unknown;
  try {
    entry = JSON.parse(raw);
  } catch {
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
  onLog
}: {
  cacheDir: string;
  contentHash: string;
  optionsHash: string;
  ttlMs: number;
  ir: DesignIR;
  onLog: (message: string) => void;
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
    await evictStaleCacheEntries({ cacheDir, ttlMs, onLog });
  } catch {
    // Eviction is best-effort; do not block the pipeline.
  }
};

const evictStaleCacheEntries = async ({
  cacheDir,
  ttlMs,
  onLog
}: {
  cacheDir: string;
  ttlMs: number;
  onLog: (message: string) => void;
}): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return;
  }

  const irEntries = entries.filter((name) => name.startsWith("ir-") && name.endsWith(".json"));
  if (irEntries.length <= MAX_IR_CACHE_ENTRIES) {
    return;
  }

  const withStats = await Promise.all(
    irEntries.map(async (name) => {
      const filePath = path.join(cacheDir, name);
      try {
        const fileStat = await stat(filePath);
        return { name, filePath, mtimeMs: fileStat.mtimeMs };
      } catch {
        return { name, filePath, mtimeMs: 0 };
      }
    })
  );

  withStats.sort((left, right) => left.mtimeMs - right.mtimeMs);

  const now = Date.now();
  let evictedCount = 0;
  for (const entry of withStats) {
    if (irEntries.length - evictedCount <= MAX_IR_CACHE_ENTRIES) {
      break;
    }
    const age = now - entry.mtimeMs;
    if (age > ttlMs || irEntries.length - evictedCount > MAX_IR_CACHE_ENTRIES) {
      try {
        await unlink(entry.filePath);
        evictedCount++;
      } catch {
        // Best-effort eviction.
      }
    }
  }

  if (evictedCount > 0) {
    onLog(`IR cache eviction: removed ${evictedCount} stale entries.`);
  }
};
