import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceFigmaSourceMode } from "../contracts/index.js";
import type {
  FigmaAnalysis,
  FigmaAnalysisComponentFamily,
  FigmaAnalysisVariantProperty
} from "../parity/figma-analysis.js";
import { extractVariantNameProperties, normalizeVariantKey, normalizeVariantValue } from "../parity/ir-variants.js";
import { getErrorMessage } from "./errors.js";
import { computeContentHash } from "./ir-cache.js";
import type {
  FigmaComponentCatalogEntry,
  FigmaComponentSetCatalogEntry,
  FigmaFileResponse
} from "./types.js";

const LIBRARY_RESOLUTION_CACHE_VERSION = 1;
const LIBRARY_RESOLUTION_CACHE_PREFIX = "figma-library-resolution-";
const LIBRARY_RESOLUTION_ASSET_CACHE_PREFIX = "figma-library-resolution-asset-";
const MAX_LIBRARY_RESOLUTION_CACHE_ENTRIES = 50;
const FIGMA_API_BASE_URL = "https://api.figma.com/v1";
const LIBRARY_RESOLUTION_FETCH_CONCURRENCY = 6;

export interface FigmaPublishedLibraryAsset {
  key: string;
  fileKey: string;
  nodeId: string;
  name: string;
  thumbnailUrl?: string;
  description?: string;
  updatedAt?: string;
  createdAt?: string;
  containingFrameName?: string;
}

export interface FigmaLibraryResolutionIssue {
  code: string;
  message: string;
  scope: "component" | "component_set" | "cache";
  retriable?: boolean;
}

interface FigmaLibraryLookupSuccess {
  status: "ok";
  meta: FigmaPublishedLibraryAsset;
}

interface FigmaLibraryLookupError {
  status: "error";
  issue: FigmaLibraryResolutionIssue;
}

type FigmaLibraryLookupResult = FigmaLibraryLookupSuccess | FigmaLibraryLookupError;

type FigmaLibraryResolutionStatus = "resolved" | "partial" | "error";
type FigmaLibraryResolutionSource = "live" | "cache" | "local_catalog";
type FigmaLibraryFamilyNameSource = "published_component_set" | "published_component" | "analysis";
type FigmaLibraryResolutionAssetKind = "component" | "component_set";

export interface FigmaLibraryResolutionEntry {
  status: FigmaLibraryResolutionStatus;
  resolutionSource: FigmaLibraryResolutionSource;
  componentId: string;
  componentKey?: string;
  componentSetId?: string;
  componentSetKey?: string;
  familyKey: string;
  heuristicFamilyName: string;
  canonicalFamilyName: string;
  canonicalFamilyNameSource: FigmaLibraryFamilyNameSource;
  referringNodeIds: string[];
  variantProperties: FigmaAnalysisVariantProperty[];
  originFileKey?: string;
  publishedComponent?: FigmaPublishedLibraryAsset;
  publishedComponentSet?: FigmaPublishedLibraryAsset;
  localComponent?: FigmaComponentCatalogEntry;
  localComponentSet?: FigmaComponentSetCatalogEntry;
  issues?: FigmaLibraryResolutionIssue[];
}

export interface FigmaLibraryResolutionArtifact {
  artifact: "figma.library_resolution";
  version: 1;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  fingerprint: string;
  fileKey?: string;
  lastModified?: string;
  summary: {
    total: number;
    resolved: number;
    partial: number;
    error: number;
    cacheHit: number;
    offlineReused: number;
  };
  entries: FigmaLibraryResolutionEntry[];
}

interface FigmaLibraryResolutionCacheEntry {
  version: number;
  fingerprint: string;
  cachedAt: number;
  fileKey?: string;
  lastModified?: string;
  componentKeys: string[];
  componentSetKeys: string[];
  componentResults: Record<string, FigmaLibraryLookupResult>;
  componentSetResults: Record<string, FigmaLibraryLookupResult>;
}

interface FigmaLibraryResolutionAssetCacheEntry {
  version: number;
  cachedAt: number;
  assetKind: FigmaLibraryResolutionAssetKind;
  key: string;
  result: FigmaLibraryLookupSuccess;
}

interface ResolveFigmaLibraryResolutionArtifactInput {
  analysis: FigmaAnalysis;
  file: FigmaFileResponse;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  cacheDir: string;
  fileKey?: string;
  accessToken?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  abortSignal?: AbortSignal;
  onLog?: (message: string) => void;
}

interface ResolvedExternalComponentCatalogEntry {
  componentId: string;
  componentKey?: string;
  componentSetId?: string;
  componentSetKey?: string;
  familyKey: string;
  familyName: string;
  referringNodeIds: string[];
  variantProperties: FigmaAnalysisVariantProperty[];
  localComponent?: FigmaComponentCatalogEntry;
  localComponentSet?: FigmaComponentSetCatalogEntry;
}

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError" || error.name === "TimeoutError") {
    return true;
  }
  const normalized = error.message.toLowerCase();
  return normalized.includes("aborted") || normalized.includes("timeout");
};

const waitFor = async (delayMs: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
};

const toRetryDelay = ({ attempt }: { attempt: number }): number => {
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

const cloneIssue = (issue: FigmaLibraryResolutionIssue): FigmaLibraryResolutionIssue => {
  return {
    code: issue.code,
    message: issue.message,
    scope: issue.scope,
    ...(issue.retriable !== undefined ? { retriable: issue.retriable } : {})
  };
};

const clonePublishedAsset = (asset: FigmaPublishedLibraryAsset): FigmaPublishedLibraryAsset => {
  return {
    key: asset.key,
    fileKey: asset.fileKey,
    nodeId: asset.nodeId,
    name: asset.name,
    ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : {}),
    ...(asset.description ? { description: asset.description } : {}),
    ...(asset.updatedAt ? { updatedAt: asset.updatedAt } : {}),
    ...(asset.createdAt ? { createdAt: asset.createdAt } : {}),
    ...(asset.containingFrameName ? { containingFrameName: asset.containingFrameName } : {})
  };
};

const cloneLookupResult = (value: FigmaLibraryLookupResult): FigmaLibraryLookupResult => {
  if (value.status === "ok") {
    return {
      status: "ok",
      meta: clonePublishedAsset(value.meta)
    };
  }
  return {
    status: "error",
    issue: cloneIssue(value.issue)
  };
};

const isLookupSuccess = (value: FigmaLibraryLookupResult): value is FigmaLibraryLookupSuccess => {
  return value.status === "ok";
};

const cloneLookupResultMap = (
  value: Record<string, FigmaLibraryLookupResult>
): Record<string, FigmaLibraryLookupResult> => {
  const output: Record<string, FigmaLibraryLookupResult> = {};
  for (const key of Object.keys(value).sort(compareStrings)) {
    output[key] = cloneLookupResult(value[key]!);
  }
  return output;
};

const toLegacyCacheFilePath = ({
  cacheDir,
  fingerprint
}: {
  cacheDir: string;
  fingerprint: string;
}): string => {
  return path.join(cacheDir, `${LIBRARY_RESOLUTION_CACHE_PREFIX}${fingerprint}.json`);
};

const toAssetCacheFingerprint = ({
  assetKind,
  key
}: {
  assetKind: FigmaLibraryResolutionAssetKind;
  key: string;
}): string => {
  return computeContentHash({
    assetKind,
    key
  });
};

const toAssetCacheFilePath = ({
  cacheDir,
  assetKind,
  key
}: {
  cacheDir: string;
  assetKind: FigmaLibraryResolutionAssetKind;
  key: string;
}): string => {
  return path.join(cacheDir, `${LIBRARY_RESOLUTION_ASSET_CACHE_PREFIX}${assetKind}-${toAssetCacheFingerprint({ assetKind, key })}.json`);
};

const toLookupIssue = ({
  scope,
  code,
  message,
  retriable
}: {
  scope: FigmaLibraryResolutionIssue["scope"];
  code: string;
  message: string;
  retriable?: boolean;
}): FigmaLibraryLookupError => {
  return {
    status: "error",
    issue: {
      code,
      message,
      scope,
      ...(retriable !== undefined ? { retriable } : {})
    }
  };
};

const normalizeLookupResult = (value: unknown): FigmaLibraryLookupResult | undefined => {
  if (!isRecord(value) || typeof value.status !== "string") {
    return undefined;
  }
  if (value.status === "ok") {
    if (!isRecord(value.meta)) {
      return undefined;
    }
    const meta = toPublishedAsset(value.meta);
    if (!meta) {
      return undefined;
    }
    return {
      status: "ok",
      meta
    };
  }
  if (value.status === "error") {
    if (!isRecord(value.issue) || typeof value.issue.code !== "string" || typeof value.issue.message !== "string") {
      return undefined;
    }
    if (value.issue.scope !== "component" && value.issue.scope !== "component_set" && value.issue.scope !== "cache") {
      return undefined;
    }
    return {
      status: "error",
      issue: {
        code: value.issue.code,
        message: value.issue.message,
        scope: value.issue.scope,
        ...(typeof value.issue.retriable === "boolean" ? { retriable: value.issue.retriable } : {})
      }
    };
  }
  return undefined;
};

const normalizeAssetCacheEntry = (value: unknown): FigmaLibraryResolutionAssetCacheEntry | undefined => {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.version) ||
    !isFiniteNumber(value.cachedAt) ||
    typeof value.assetKind !== "string" ||
    (value.assetKind !== "component" && value.assetKind !== "component_set") ||
    typeof value.key !== "string" ||
    value.key.trim().length === 0 ||
    !isRecord(value.result)
  ) {
    return undefined;
  }
  const result = normalizeLookupResult(value.result);
  if (!result || result.status !== "ok") {
    return undefined;
  }
  return {
    version: value.version,
    cachedAt: value.cachedAt,
    assetKind: value.assetKind,
    key: value.key,
    result
  };
};

const toLookupResultMap = (value: unknown): Record<string, FigmaLibraryLookupResult> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const output: Record<string, FigmaLibraryLookupResult> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeLookupResult(entry);
    if (!normalized) {
      return undefined;
    }
    output[key] = normalized;
  }
  return output;
};

const toPublishedAsset = (value: unknown): FigmaPublishedLibraryAsset | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.key !== "string" ||
    value.key.trim().length === 0 ||
    typeof value.fileKey !== "string" ||
    value.fileKey.trim().length === 0 ||
    typeof value.nodeId !== "string" ||
    value.nodeId.trim().length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0
  ) {
    return undefined;
  }
  return {
    key: value.key,
    fileKey: value.fileKey,
    nodeId: value.nodeId,
    name: value.name,
    ...(typeof value.thumbnailUrl === "string" && value.thumbnailUrl.trim().length > 0
      ? { thumbnailUrl: value.thumbnailUrl }
      : {}),
    ...(typeof value.description === "string" && value.description.trim().length > 0
      ? { description: value.description }
      : {}),
    ...(typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(typeof value.createdAt === "string" && value.createdAt.trim().length > 0
      ? { createdAt: value.createdAt }
      : {}),
    ...(typeof value.containingFrameName === "string" && value.containingFrameName.trim().length > 0
      ? { containingFrameName: value.containingFrameName }
      : {})
  };
};

const toCacheEntry = (value: unknown): FigmaLibraryResolutionCacheEntry | undefined => {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.version) ||
    typeof value.fingerprint !== "string" ||
    !isFiniteNumber(value.cachedAt) ||
    !Array.isArray(value.componentKeys) ||
    !Array.isArray(value.componentSetKeys)
  ) {
    return undefined;
  }
  if (
    !value.componentKeys.every((entry) => typeof entry === "string") ||
    !value.componentSetKeys.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }
  const componentResults = toLookupResultMap(value.componentResults);
  const componentSetResults = toLookupResultMap(value.componentSetResults);
  if (!componentResults || !componentSetResults) {
    return undefined;
  }
  return {
    version: value.version,
    fingerprint: value.fingerprint,
    cachedAt: value.cachedAt,
    ...(typeof value.fileKey === "string" && value.fileKey.trim().length > 0 ? { fileKey: value.fileKey } : {}),
    ...(typeof value.lastModified === "string" && value.lastModified.trim().length > 0
      ? { lastModified: value.lastModified }
      : {}),
    componentKeys: [...value.componentKeys].sort(compareStrings),
    componentSetKeys: [...value.componentSetKeys].sort(compareStrings),
    componentResults,
    componentSetResults
  };
};

const loadLegacyCachedFigmaLibraryResolution = async ({
  cacheDir,
  fingerprint,
  onLog
}: {
  cacheDir: string;
  fingerprint: string;
  onLog?: (message: string) => void;
}): Promise<FigmaLibraryResolutionCacheEntry | undefined> => {
  const cacheFilePath = toLegacyCacheFilePath({ cacheDir, fingerprint });
  let raw: string;
  try {
    raw = await readFile(cacheFilePath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onLog?.("Figma library resolution cache: corrupt entry ignored.");
    return undefined;
  }

  const entry = toCacheEntry(parsed);
  if (!entry) {
    onLog?.("Figma library resolution cache: invalid entry ignored.");
    return undefined;
  }
  if (entry.version !== LIBRARY_RESOLUTION_CACHE_VERSION) {
    onLog?.("Figma library resolution cache: version mismatch ignored.");
    return undefined;
  }
  if (entry.fingerprint !== fingerprint) {
    onLog?.("Figma library resolution cache: fingerprint mismatch ignored.");
    return undefined;
  }
  onLog?.(
    `Figma library resolution cache hit (components=${entry.componentKeys.length}, componentSets=${entry.componentSetKeys.length}).`
  );
  return {
    version: entry.version,
    fingerprint: entry.fingerprint,
    cachedAt: entry.cachedAt,
    ...(entry.fileKey ? { fileKey: entry.fileKey } : {}),
    ...(entry.lastModified ? { lastModified: entry.lastModified } : {}),
    componentKeys: [...entry.componentKeys],
    componentSetKeys: [...entry.componentSetKeys],
    componentResults: cloneLookupResultMap(entry.componentResults),
    componentSetResults: cloneLookupResultMap(entry.componentSetResults)
  };
};

const loadCachedFigmaLibraryAsset = async ({
  cacheDir,
  assetKind,
  key,
  onLog
}: {
  cacheDir: string;
  assetKind: FigmaLibraryResolutionAssetKind;
  key: string;
  onLog?: (message: string) => void;
}): Promise<FigmaLibraryResolutionAssetCacheEntry | undefined> => {
  const cacheFilePath = toAssetCacheFilePath({
    cacheDir,
    assetKind,
    key
  });
  let raw: string;
  try {
    raw = await readFile(cacheFilePath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onLog?.(`Figma library resolution asset cache: corrupt entry ignored for ${assetKind} '${key}'.`);
    return undefined;
  }

  const entry = normalizeAssetCacheEntry(parsed);
  if (!entry) {
    onLog?.(`Figma library resolution asset cache: invalid entry ignored for ${assetKind} '${key}'.`);
    return undefined;
  }
  if (entry.assetKind !== assetKind || entry.key !== key || entry.version !== LIBRARY_RESOLUTION_CACHE_VERSION) {
    onLog?.(`Figma library resolution asset cache: mismatched entry ignored for ${assetKind} '${key}'.`);
    return undefined;
  }
  onLog?.(`Figma library resolution asset cache hit for ${assetKind} '${key}'.`);
  return entry;
};

const evictLibraryResolutionCacheEntries = async ({
  cacheDir,
  onLog
}: {
  cacheDir: string;
  onLog?: (message: string) => void;
}): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return;
  }
  const candidateNames = entries.filter(
    (name) => name.startsWith(LIBRARY_RESOLUTION_ASSET_CACHE_PREFIX) && name.endsWith(".json")
  );
  if (candidateNames.length <= MAX_LIBRARY_RESOLUTION_CACHE_ENTRIES) {
    return;
  }
  const withStats = await Promise.all(
    candidateNames.map(async (name) => {
      const filePath = path.join(cacheDir, name);
      try {
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      } catch {
        return { filePath, mtimeMs: 0 };
      }
    })
  );
  withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const staleEntries = withStats.slice(MAX_LIBRARY_RESOLUTION_CACHE_ENTRIES);
  let removedCount = 0;
  for (const entry of staleEntries) {
    try {
      await unlink(entry.filePath);
      removedCount += 1;
    } catch {
      // best effort eviction
    }
  }
  if (removedCount > 0) {
    onLog?.(`Figma library resolution cache eviction removed ${removedCount} stale entr${removedCount === 1 ? "y" : "ies"}.`);
  }
};

const saveCachedFigmaLibraryAsset = async ({
  cacheDir,
  entry,
  onLog
}: {
  cacheDir: string;
  entry: FigmaLibraryResolutionAssetCacheEntry;
  onLog?: (message: string) => void;
}): Promise<void> => {
  const cacheFilePath = toAssetCacheFilePath({
    cacheDir,
    assetKind: entry.assetKind,
    key: entry.key
  });
  const serialized: FigmaLibraryResolutionAssetCacheEntry = {
    version: LIBRARY_RESOLUTION_CACHE_VERSION,
    cachedAt: Date.now(),
    assetKind: entry.assetKind,
    key: entry.key,
    result: cloneLookupResult(entry.result) as FigmaLibraryLookupSuccess
  };
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFilePath, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
    onLog?.(`Figma library resolution asset cache write completed for ${entry.assetKind} '${entry.key}'.`);
  } catch (error) {
    onLog?.(`Figma library resolution asset cache write failed for ${entry.assetKind} '${entry.key}': ${getErrorMessage(error)}.`);
    return;
  }
  try {
    await evictLibraryResolutionCacheEntries({
      cacheDir,
      ...(onLog ? { onLog } : {})
    });
  } catch {
    // best effort eviction
  }
};

const loadLegacyCacheLookupResults = async ({
  cacheDir,
  fingerprint,
  onLog
}: {
  cacheDir: string;
  fingerprint: string;
  onLog?: (message: string) => void;
}): Promise<
  | {
      componentResults: Record<string, FigmaLibraryLookupResult>;
      componentSetResults: Record<string, FigmaLibraryLookupResult>;
    }
  | undefined
> => {
  const legacyEntry = await loadLegacyCachedFigmaLibraryResolution({
    cacheDir,
    fingerprint,
    ...(onLog ? { onLog } : {})
  });
  if (!legacyEntry) {
    return undefined;
  }
  return {
    componentResults: Object.fromEntries(
      Object.entries(legacyEntry.componentResults).filter(([, result]) => result.status === "ok")
    ),
    componentSetResults: Object.fromEntries(
      Object.entries(legacyEntry.componentSetResults).filter(([, result]) => result.status === "ok")
    )
  };
};

const mapWithConcurrency = async <TValue, TResult>({
  values,
  limit,
  mapper
}: {
  values: TValue[];
  limit: number;
  mapper: (value: TValue) => Promise<TResult>;
}): Promise<TResult[]> => {
  if (values.length === 0) {
    return [];
  }
  const normalizedLimit = Math.max(1, Math.min(limit, values.length));
  const results = new Array<TResult>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: normalizedLimit }, async () => {
      while (cursor < values.length) {
        const currentIndex = cursor;
        cursor += 1;
        results[currentIndex] = await mapper(values[currentIndex]!);
      }
    })
  );
  return results;
};

const toCacheFingerprint = ({
  componentKeys,
  componentSetKeys
}: {
  componentKeys: string[];
  componentSetKeys: string[];
}): string => {
  return computeContentHash({
    componentKeys: [...componentKeys].sort(compareStrings),
    componentSetKeys: [...componentSetKeys].sort(compareStrings)
  });
};

const mergeVariantProperties = ({
  publishedComponentName,
  publishedComponentSetName,
  analysisVariantProperties,
  localComponentName,
  localComponentSetName
}: {
  publishedComponentName?: string | undefined;
  publishedComponentSetName?: string | undefined;
  analysisVariantProperties: FigmaAnalysisVariantProperty[];
  localComponentName?: string | undefined;
  localComponentSetName?: string | undefined;
}): FigmaAnalysisVariantProperty[] => {
  const variantsByProperty = new Map<string, Set<string>>();

  const addProperty = (property: string | undefined, value: string | undefined): void => {
    if (!property || !value) {
      return;
    }
    const propertyName = normalizeVariantKey(property)?.trim();
    const propertyValue = normalizeVariantValue(value).trim();
    if (!propertyName || !propertyValue) {
      return;
    }
    const values = variantsByProperty.get(propertyName) ?? new Set<string>();
    values.add(propertyValue);
    variantsByProperty.set(propertyName, values);
  };

  const addPropertyRecord = (property: string | undefined, value: string | undefined): void => {
    if (!property || !value) {
      return;
    }
    const normalizedProperty = normalizeVariantKey(property)?.trim();
    const normalizedValue = normalizeVariantValue(value).trim();
    if (!normalizedProperty || !normalizedValue) {
      return;
    }
    const values = variantsByProperty.get(normalizedProperty) ?? new Set<string>();
    values.add(normalizedValue);
    variantsByProperty.set(normalizedProperty, values);
  };

  const addVariantRecord = (value: Record<string, string> | undefined): void => {
    if (!value) {
      return;
    }
    for (const [property, propertyValue] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
      addPropertyRecord(property, propertyValue);
    }
  };

  const addVariantArray = (value: FigmaAnalysisVariantProperty[] | undefined): void => {
    if (!value) {
      return;
    }
    for (const entry of [...value].sort((left, right) => left.property.localeCompare(right.property))) {
      const values = [...entry.values].sort(compareStrings);
      for (const variantValue of values) {
        addProperty(entry.property, variantValue);
      }
    }
  };

  addVariantRecord(publishedComponentSetName ? extractVariantNameProperties(publishedComponentSetName) : undefined);
  addVariantRecord(publishedComponentName ? extractVariantNameProperties(publishedComponentName) : undefined);
  addVariantArray(analysisVariantProperties);
  addVariantRecord(localComponentSetName ? extractVariantNameProperties(localComponentSetName) : undefined);
  addVariantRecord(localComponentName ? extractVariantNameProperties(localComponentName) : undefined);

  return [...variantsByProperty.entries()]
    .map(([property, values]) => ({
      property,
      values: [...values].sort(compareStrings)
    }))
    .sort((left, right) => left.property.localeCompare(right.property));
};

const buildResolvedExternalComponents = ({
  analysis,
  file
}: {
  analysis: FigmaAnalysis;
  file: FigmaFileResponse;
}): ResolvedExternalComponentCatalogEntry[] => {
  const familyMap = new Map<string, FigmaAnalysisComponentFamily>(
    analysis.componentFamilies.map((family) => [family.familyKey, family])
  );
  const componentCatalog = file.components ?? {};
  const componentSetCatalog = file.componentSets ?? {};
  return [...analysis.externalComponents]
    .map((entry) => {
      const family = familyMap.get(entry.familyKey);
      const localComponent = componentCatalog[entry.componentId];
      const localComponentSet =
        typeof entry.componentSetId === "string" ? componentSetCatalog[entry.componentSetId] : undefined;
      return {
        componentId: entry.componentId,
        ...(localComponent?.key ? { componentKey: localComponent.key } : {}),
        ...(entry.componentSetId ? { componentSetId: entry.componentSetId } : {}),
        ...(localComponentSet?.key ? { componentSetKey: localComponentSet.key } : {}),
        familyKey: entry.familyKey,
        familyName: entry.familyName,
        referringNodeIds: [...entry.referringNodeIds].sort(compareStrings),
        variantProperties: [...(family?.variantProperties ?? [])]
          .map((property) => ({
            property: property.property,
            values: [...property.values].sort(compareStrings)
          }))
          .sort((left, right) => compareStrings(left.property, right.property)),
        ...(localComponent ? { localComponent } : {}),
        ...(localComponentSet ? { localComponentSet } : {})
      };
    })
    .sort((left, right) => {
      if (left.componentId !== right.componentId) {
        return compareStrings(left.componentId, right.componentId);
      }
      return compareStrings(left.componentSetId ?? "", right.componentSetId ?? "");
    });
};

const toPublishedAssetMeta = (value: unknown): FigmaPublishedLibraryAsset | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const containingFrameName =
    isRecord(value.containing_frame) && typeof value.containing_frame.name === "string" && value.containing_frame.name.trim().length > 0
      ? value.containing_frame.name
      : undefined;
  if (
    typeof value.key !== "string" ||
    value.key.trim().length === 0 ||
    typeof value.file_key !== "string" ||
    value.file_key.trim().length === 0 ||
    typeof value.node_id !== "string" ||
    value.node_id.trim().length === 0 ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0
  ) {
    return undefined;
  }
  return {
    key: value.key,
    fileKey: value.file_key,
    nodeId: value.node_id,
    name: value.name,
    ...(typeof value.thumbnail_url === "string" && value.thumbnail_url.trim().length > 0
      ? { thumbnailUrl: value.thumbnail_url }
      : {}),
    ...(typeof value.description === "string" && value.description.trim().length > 0
      ? { description: value.description }
      : {}),
    ...(typeof value.updated_at === "string" && value.updated_at.trim().length > 0
      ? { updatedAt: value.updated_at }
      : {}),
    ...(typeof value.created_at === "string" && value.created_at.trim().length > 0
      ? { createdAt: value.created_at }
      : {}),
    ...(containingFrameName ? { containingFrameName } : {})
  };
};

const extractErrorMessage = ({ parsedBody, rawBody }: { parsedBody: unknown; rawBody: string }): string => {
  if (isRecord(parsedBody) && typeof parsedBody.message === "string" && parsedBody.message.trim().length > 0) {
    return parsedBody.message;
  }
  return rawBody.trim().slice(0, 240) || "Unknown Figma API error.";
};

const fetchPublishedLibraryAsset = async ({
  accessToken,
  assetKind,
  key,
  fetchImpl,
  timeoutMs,
  maxRetries,
  abortSignal,
  onLog
}: {
  accessToken: string;
  assetKind: "component" | "component_set";
  key: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  abortSignal?: AbortSignal;
  onLog?: (message: string) => void;
}): Promise<FigmaLibraryLookupResult> => {
  const scope = assetKind;
  const endpointPath = assetKind === "component" ? "components" : "component_sets";
  const url = `${FIGMA_API_BASE_URL}/${endpointPath}/${encodeURIComponent(key)}`;
  const readResponse = async (headers: Record<string, string>): Promise<Response> => {
    const timeoutSignal = AbortSignal.timeout(Math.max(1, timeoutMs));
    const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;
    return await fetchImpl(url, {
      method: "GET",
      headers,
      signal
    });
  };

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    try {
      let response = await readResponse({
        "X-Figma-Token": accessToken,
        Accept: "application/json"
      });

      if (response.status === 403) {
        const bodyText = (await response.clone().text()).toLowerCase();
        if (bodyText.includes("invalid token")) {
          onLog?.(`Figma ${assetKind} PAT rejected; retrying ${assetKind} lookup with Bearer token.`);
          response = await readResponse({
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          });
        }
      }

      if (response.ok) {
        let parsedBody: unknown;
        try {
          parsedBody = await response.json();
        } catch (error) {
          return toLookupIssue({
            scope,
            code: "E_LIBRARY_ASSET_PARSE",
            message: `Failed to parse published ${assetKind} metadata for '${key}': ${getErrorMessage(error)}`,
            retriable: false
          });
        }
        if (!isRecord(parsedBody) || !isRecord(parsedBody.meta)) {
          return toLookupIssue({
            scope,
            code: "E_LIBRARY_ASSET_INVALID",
            message: `Published ${assetKind} metadata for '${key}' returned an invalid payload.`,
            retriable: false
          });
        }
        const meta = toPublishedAssetMeta(parsedBody.meta);
        if (!meta) {
          return toLookupIssue({
            scope,
            code: "E_LIBRARY_ASSET_INVALID",
            message: `Published ${assetKind} metadata for '${key}' was missing required fields.`,
            retriable: false
          });
        }
        return {
          status: "ok",
          meta
        };
      }

      const rawBody = await response.text();
      let parsedBody: unknown;
      try {
        parsedBody = rawBody.length > 0 ? (JSON.parse(rawBody) as unknown) : undefined;
      } catch {
        parsedBody = undefined;
      }
      const responseMessage = extractErrorMessage({ parsedBody, rawBody });
      const retriable = response.status === 429 || response.status >= 500;
      if (retriable && attempt < Math.max(1, maxRetries)) {
        const delayMs = toRetryDelay({ attempt });
        onLog?.(
          `Figma ${assetKind} lookup for '${key}' failed with status ${response.status}; retrying in ${delayMs}ms (${attempt}/${Math.max(
            1,
            maxRetries
          )}).`
        );
        await waitFor(delayMs, abortSignal);
        continue;
      }
      if (response.status === 403) {
        return toLookupIssue({
          scope,
          code: "E_LIBRARY_ASSET_FORBIDDEN",
          message:
            `Published ${assetKind} metadata for '${key}' is not accessible. ` +
            `The Figma token may be missing the library_assets:read scope. ${responseMessage}`,
          retriable
        });
      }
      if (response.status === 404) {
        return toLookupIssue({
          scope,
          code: "E_LIBRARY_ASSET_NOT_FOUND",
          message: `Published ${assetKind} metadata for '${key}' was not found. ${responseMessage}`,
          retriable
        });
      }
      return toLookupIssue({
        scope,
        code: "E_LIBRARY_ASSET_HTTP",
        message: `Published ${assetKind} metadata for '${key}' failed with HTTP ${response.status}. ${responseMessage}`,
        retriable
      });
    } catch (error) {
      const retriable = isTimeoutError(error);
      if (attempt < Math.max(1, maxRetries)) {
        const delayMs = toRetryDelay({ attempt });
        onLog?.(
          `Figma ${assetKind} lookup for '${key}' failed (${retriable ? "timeout" : "network"}); retrying in ${delayMs}ms (${attempt}/${Math.max(
            1,
            maxRetries
          )}).`
        );
        await waitFor(delayMs, abortSignal);
        continue;
      }
      return toLookupIssue({
        scope,
        code: retriable ? "E_LIBRARY_ASSET_TIMEOUT" : "E_LIBRARY_ASSET_NETWORK",
        message: `Published ${assetKind} metadata for '${key}' failed: ${getErrorMessage(error)}`,
        retriable
      });
    }
  }

  return toLookupIssue({
    scope,
    code: "E_LIBRARY_ASSET_NETWORK",
    message: `Published ${assetKind} metadata for '${key}' failed unexpectedly.`,
    retriable: false
  });
};

const resolveLiveLookupResults = async ({
  componentKeys,
  componentSetKeys,
  accessToken,
  fetchImpl,
  timeoutMs,
  maxRetries,
  abortSignal,
  onLog
}: {
  componentKeys: string[];
  componentSetKeys: string[];
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  abortSignal?: AbortSignal;
  onLog?: (message: string) => void;
}): Promise<{
  componentResults: Record<string, FigmaLibraryLookupResult>;
  componentSetResults: Record<string, FigmaLibraryLookupResult>;
}> => {
  const componentResults = new Map<string, FigmaLibraryLookupResult>();
  const componentSetResults = new Map<string, FigmaLibraryLookupResult>();

  const [componentEntries, componentSetEntries] = await Promise.all([
    mapWithConcurrency({
      values: componentKeys,
      limit: LIBRARY_RESOLUTION_FETCH_CONCURRENCY,
      mapper: async (componentKey) => {
        const result = await fetchPublishedLibraryAsset({
          accessToken,
          assetKind: "component",
          key: componentKey,
          fetchImpl,
          timeoutMs,
          maxRetries,
          ...(abortSignal ? { abortSignal } : {}),
          ...(onLog ? { onLog } : {})
        });
        return { key: componentKey, result };
      }
    }),
    mapWithConcurrency({
      values: componentSetKeys,
      limit: LIBRARY_RESOLUTION_FETCH_CONCURRENCY,
      mapper: async (componentSetKey) => {
        const result = await fetchPublishedLibraryAsset({
          accessToken,
          assetKind: "component_set",
          key: componentSetKey,
          fetchImpl,
          timeoutMs,
          maxRetries,
          ...(abortSignal ? { abortSignal } : {}),
          ...(onLog ? { onLog } : {})
        });
        return { key: componentSetKey, result };
      }
    })
  ]);

  for (const entry of componentEntries) {
    componentResults.set(entry.key, entry.result);
  }
  for (const entry of componentSetEntries) {
    componentSetResults.set(entry.key, entry.result);
  }

  return {
    componentResults: Object.fromEntries(
      [...componentResults.entries()].sort((left, right) => compareStrings(left[0], right[0]))
    ),
    componentSetResults: Object.fromEntries(
      [...componentSetResults.entries()].sort((left, right) => compareStrings(left[0], right[0]))
    )
  };
};

const buildLibraryResolutionEntry = ({
  externalComponent,
  figmaSourceMode,
  componentResult,
  componentResultSource,
  componentSetResult,
  componentSetResultSource
}: {
  externalComponent: ResolvedExternalComponentCatalogEntry;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  componentResult?: FigmaLibraryLookupResult;
  componentResultSource?: FigmaLibraryResolutionSource;
  componentSetResult?: FigmaLibraryLookupResult;
  componentSetResultSource?: FigmaLibraryResolutionSource;
}): FigmaLibraryResolutionEntry => {
  const issues: FigmaLibraryResolutionIssue[] = [];

  if (!externalComponent.componentKey) {
    issues.push({
      code: "E_LIBRARY_COMPONENT_KEY_MISSING",
      message: `External component '${externalComponent.componentId}' has no component key in the sanitized Figma catalog.`,
      scope: "component"
    });
  }

  if (externalComponent.componentSetId && !externalComponent.componentSetKey) {
    issues.push({
      code: "E_LIBRARY_COMPONENT_SET_KEY_MISSING",
      message:
        `External component set '${externalComponent.componentSetId}' for component '${externalComponent.componentId}' ` +
        "has no component set key in the sanitized Figma catalog.",
      scope: "component_set"
    });
  }

  if (componentResult?.status === "error") {
    issues.push(cloneIssue(componentResult.issue));
  }
  if (componentSetResult?.status === "error") {
    issues.push(cloneIssue(componentSetResult.issue));
  }
  if (figmaSourceMode === "local_json" && externalComponent.componentKey && !componentResult) {
    issues.push({
      code: "E_LIBRARY_CACHE_ENTRY_MISSING",
      message:
        `Cached published component metadata for '${externalComponent.componentKey}' was missing from the library-resolution cache entry.`,
      scope: "cache"
    });
  }
  if (figmaSourceMode === "local_json" && externalComponent.componentSetKey && !componentSetResult) {
    issues.push({
      code: "E_LIBRARY_COMPONENT_SET_CACHE_ENTRY_MISSING",
      message:
        `Cached published component-set metadata for '${externalComponent.componentSetKey}' was missing from the library-resolution cache entry.`,
      scope: "cache"
    });
  }

  if (figmaSourceMode === "local_json" && externalComponent.componentKey && !componentResult) {
    issues.push({
      code: "E_LIBRARY_OFFLINE_CACHE_MISS",
      message:
        `No cached published component metadata is available for '${externalComponent.componentKey}' in local_json mode.`,
      scope: "cache"
    });
  }
  if (figmaSourceMode === "local_json" && externalComponent.componentSetKey && !componentSetResult) {
    issues.push({
      code: "E_LIBRARY_OFFLINE_COMPONENT_SET_CACHE_MISS",
      message:
        `No cached published component-set metadata is available for '${externalComponent.componentSetKey}' in local_json mode.`,
      scope: "cache"
    });
  }

  const publishedComponent = componentResult?.status === "ok" ? componentResult.meta : undefined;
  const publishedComponentSet = componentSetResult?.status === "ok" ? componentSetResult.meta : undefined;
  const canonicalFamilyName = publishedComponentSet?.name ?? publishedComponent?.name ?? externalComponent.familyName;
  const canonicalFamilyNameSource: FigmaLibraryFamilyNameSource = publishedComponentSet?.name
    ? "published_component_set"
    : publishedComponent?.name
      ? "published_component"
      : "analysis";

  const hasCacheHit = componentResultSource === "cache" || componentSetResultSource === "cache";
  const resolutionSource: FigmaLibraryResolutionSource = hasCacheHit
    ? "cache"
    : figmaSourceMode === "local_json"
      ? "local_catalog"
      : "live";

  let status: FigmaLibraryResolutionStatus;
  if (figmaSourceMode === "local_json") {
    if (!externalComponent.componentKey) {
      status = "error";
    } else if (!componentResult || (externalComponent.componentSetKey && !componentSetResult)) {
      status = "partial";
    } else {
      status = "resolved";
    }
  } else if (!externalComponent.componentKey || !publishedComponent) {
    status = "error";
  } else if (
    (externalComponent.componentSetId || externalComponent.componentSetKey) &&
    (!externalComponent.componentSetKey || !publishedComponentSet)
  ) {
    status = "partial";
  } else {
    status = "resolved";
  }

  const originFileKey = publishedComponentSet?.fileKey ?? publishedComponent?.fileKey;
  const variantProperties = mergeVariantProperties({
    analysisVariantProperties: externalComponent.variantProperties,
    ...(publishedComponent?.name ? { publishedComponentName: publishedComponent.name } : {}),
    ...(publishedComponentSet?.name ? { publishedComponentSetName: publishedComponentSet.name } : {}),
    ...(externalComponent.localComponent?.name ? { localComponentName: externalComponent.localComponent.name } : {}),
    ...(externalComponent.localComponentSet?.name ? { localComponentSetName: externalComponent.localComponentSet.name } : {})
  });

  return {
    status,
    resolutionSource,
    componentId: externalComponent.componentId,
    ...(externalComponent.componentKey ? { componentKey: externalComponent.componentKey } : {}),
    ...(externalComponent.componentSetId ? { componentSetId: externalComponent.componentSetId } : {}),
    ...(externalComponent.componentSetKey ? { componentSetKey: externalComponent.componentSetKey } : {}),
    familyKey: externalComponent.familyKey,
    heuristicFamilyName: externalComponent.familyName,
    canonicalFamilyName,
    canonicalFamilyNameSource,
    referringNodeIds: [...externalComponent.referringNodeIds],
    variantProperties,
    ...(originFileKey ? { originFileKey } : {}),
    ...(publishedComponent ? { publishedComponent: clonePublishedAsset(publishedComponent) } : {}),
    ...(publishedComponentSet ? { publishedComponentSet: clonePublishedAsset(publishedComponentSet) } : {}),
    ...(externalComponent.localComponent ? { localComponent: { ...externalComponent.localComponent } } : {}),
    ...(externalComponent.localComponentSet ? { localComponentSet: { ...externalComponent.localComponentSet } } : {}),
    ...(issues.length > 0 ? { issues } : {})
  };
};

export const resolveFigmaLibraryResolutionArtifact = async ({
  analysis,
  file,
  figmaSourceMode,
  cacheDir,
  fileKey,
  accessToken,
  fetchImpl,
  timeoutMs,
  maxRetries,
  abortSignal,
  onLog
}: ResolveFigmaLibraryResolutionArtifactInput): Promise<FigmaLibraryResolutionArtifact | undefined> => {
  const externalComponents = buildResolvedExternalComponents({
    analysis,
    file
  });
  if (externalComponents.length === 0) {
    return undefined;
  }

  const componentKeys = [...new Set(externalComponents.map((entry) => entry.componentKey).filter((entry): entry is string => Boolean(entry)))].sort(
    compareStrings
  );
  const componentSetKeys = [
    ...new Set(externalComponents.map((entry) => entry.componentSetKey).filter((entry): entry is string => Boolean(entry)))
  ].sort(compareStrings);
  const fingerprint = toCacheFingerprint({
    componentKeys: componentKeys.map((entry) => `component:${entry}`),
    componentSetKeys: componentSetKeys.map((entry) => `componentSet:${entry}`)
  });

  let componentResults: Record<string, FigmaLibraryLookupResult> = {};
  let componentSetResults: Record<string, FigmaLibraryLookupResult> = {};
  let componentResultSources: Record<string, FigmaLibraryResolutionSource> = {};
  let componentSetResultSources: Record<string, FigmaLibraryResolutionSource> = {};

  if (figmaSourceMode === "local_json") {
    const componentCacheEntries = await Promise.all(
      componentKeys.map(async (componentKey) => {
        const cacheEntry = await loadCachedFigmaLibraryAsset({
          cacheDir,
          assetKind: "component",
          key: componentKey,
          ...(onLog ? { onLog } : {})
        });
        return cacheEntry ? ([componentKey, cacheEntry.result] as const) : undefined;
      })
    );
    const componentSetCacheEntries = await Promise.all(
      componentSetKeys.map(async (componentSetKey) => {
        const cacheEntry = await loadCachedFigmaLibraryAsset({
          cacheDir,
          assetKind: "component_set",
          key: componentSetKey,
          ...(onLog ? { onLog } : {})
        });
        return cacheEntry ? ([componentSetKey, cacheEntry.result] as const) : undefined;
      })
    );
    componentResults = {};
    for (const entry of componentCacheEntries) {
      if (entry) {
        componentResults[entry[0]] = entry[1];
      }
    }
    componentSetResults = {};
    for (const entry of componentSetCacheEntries) {
      if (entry) {
        componentSetResults[entry[0]] = entry[1];
      }
    }

    const legacyCache = await loadLegacyCacheLookupResults({
      cacheDir,
      fingerprint,
      ...(onLog ? { onLog } : {})
    });
    if (legacyCache) {
      for (const [key, result] of Object.entries(legacyCache.componentResults)) {
        if (!componentResults[key]) {
          componentResults[key] = result;
        }
      }
      for (const [key, result] of Object.entries(legacyCache.componentSetResults)) {
        if (!componentSetResults[key]) {
          componentSetResults[key] = result;
        }
      }
    }
    componentResultSources = Object.fromEntries(
      componentKeys.map((componentKey) => [componentKey, componentResults[componentKey] ? "cache" : "local_catalog"] as const)
    ) as Record<string, FigmaLibraryResolutionSource>;
    componentSetResultSources = Object.fromEntries(
      componentSetKeys.map((componentSetKey) => [componentSetKey, componentSetResults[componentSetKey] ? "cache" : "local_catalog"] as const)
    ) as Record<string, FigmaLibraryResolutionSource>;
  } else if (!accessToken?.trim()) {
    onLog?.("Figma library resolution skipped live lookup because no Figma access token was available.");
    componentResults = Object.fromEntries(
      componentKeys.map((componentKey) => [
        componentKey,
        toLookupIssue({
          scope: "component",
          code: "E_LIBRARY_ACCESS_TOKEN_MISSING",
          message: `Published component metadata for '${componentKey}' could not be resolved because no Figma access token was available.`,
          retriable: false
        })
      ])
    );
    componentSetResults = Object.fromEntries(
      componentSetKeys.map((componentSetKey) => [
        componentSetKey,
        toLookupIssue({
          scope: "component_set",
          code: "E_LIBRARY_ACCESS_TOKEN_MISSING",
          message:
            `Published component-set metadata for '${componentSetKey}' could not be resolved because no Figma access token was available.`,
          retriable: false
        })
      ])
    );
  } else {
    const liveResults = await resolveLiveLookupResults({
      componentKeys,
      componentSetKeys,
      accessToken,
      fetchImpl,
      timeoutMs,
      maxRetries,
      ...(abortSignal ? { abortSignal } : {}),
      ...(onLog ? { onLog } : {})
    });
    componentResults = liveResults.componentResults;
    componentSetResults = liveResults.componentSetResults;
    const cacheWrites: Array<Promise<void>> = [];
    for (const [key, result] of Object.entries(componentResults)) {
      if (!isLookupSuccess(result)) {
        continue;
      }
      cacheWrites.push(
        saveCachedFigmaLibraryAsset({
          cacheDir,
          entry: {
            version: LIBRARY_RESOLUTION_CACHE_VERSION,
            cachedAt: Date.now(),
            assetKind: "component",
            key,
            result
          },
          ...(onLog ? { onLog } : {})
        })
      );
    }
    for (const [key, result] of Object.entries(componentSetResults)) {
      if (!isLookupSuccess(result)) {
        continue;
      }
      cacheWrites.push(
        saveCachedFigmaLibraryAsset({
          cacheDir,
          entry: {
            version: LIBRARY_RESOLUTION_CACHE_VERSION,
            cachedAt: Date.now(),
            assetKind: "component_set",
            key,
            result
          },
          ...(onLog ? { onLog } : {})
        })
      );
    }
    await Promise.all(cacheWrites);
    componentResultSources = Object.fromEntries(componentKeys.map((componentKey) => [componentKey, "live"] as const)) as Record<
      string,
      FigmaLibraryResolutionSource
    >;
    componentSetResultSources = Object.fromEntries(componentSetKeys.map((componentSetKey) => [componentSetKey, "live"] as const)) as Record<
      string,
      FigmaLibraryResolutionSource
    >;
  }

  const entries = externalComponents
    .map((externalComponent) =>
      buildLibraryResolutionEntry({
        externalComponent,
        figmaSourceMode,
        ...(externalComponent.componentKey
          ? {
              componentResult: componentResults[externalComponent.componentKey],
              componentResultSource: componentResultSources[externalComponent.componentKey]
            }
          : {}),
        ...(externalComponent.componentSetKey
          ? {
              componentSetResult: componentSetResults[externalComponent.componentSetKey],
              componentSetResultSource: componentSetResultSources[externalComponent.componentSetKey]
            }
          : {})
      })
    )
    .sort((left, right) => {
      if (left.componentId !== right.componentId) {
        return compareStrings(left.componentId, right.componentId);
      }
      return compareStrings(left.componentSetId ?? "", right.componentSetId ?? "");
    });

  const summary = entries.reduce(
    (accumulator, entry) => {
      accumulator.total += 1;
      accumulator[entry.status] += 1;
      if (entry.resolutionSource === "cache") {
        accumulator.cacheHit += 1;
        if (figmaSourceMode === "local_json") {
          accumulator.offlineReused += 1;
        }
      }
      return accumulator;
    },
    {
      total: 0,
      resolved: 0,
      partial: 0,
      error: 0,
      cacheHit: 0,
      offlineReused: 0
    }
  );

  return {
    artifact: "figma.library_resolution",
    version: 1,
    figmaSourceMode,
    fingerprint,
    ...(fileKey ? { fileKey } : {}),
    ...(file.lastModified ? { lastModified: file.lastModified } : {}),
    summary,
    entries
  };
};
