import type { WorkspaceBrandTheme } from "../contracts/index.js";
import type { JobEngineRuntime } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BOOTSTRAP_DEPTH = 5;
const DEFAULT_NODE_BATCH_SIZE = 6;
const DEFAULT_NODE_FETCH_CONCURRENCY = 3;
const DEFAULT_ADAPTIVE_BATCHING_ENABLED = true;
const DEFAULT_MAX_SCREEN_CANDIDATES = 40;
const DEFAULT_FIGMA_CACHE_ENABLED = true;
const DEFAULT_FIGMA_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;
const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH = 14;
const DEFAULT_BRAND_THEME: WorkspaceBrandTheme = "derived";
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_ENABLE_UI_VALIDATION = false;
const DEFAULT_INSTALL_PREFER_OFFLINE = true;
const DEFAULT_SKIP_INSTALL = false;

const normalizeBrandTheme = (value: string | undefined): WorkspaceBrandTheme | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "derived" || normalized === "sparkasse") {
    return normalized;
  }
  return undefined;
};

export const resolveRuntimeSettings = ({
  figmaRequestTimeoutMs,
  figmaMaxRetries,
  figmaBootstrapDepth,
  figmaNodeBatchSize,
  figmaNodeFetchConcurrency,
  figmaAdaptiveBatchingEnabled,
  figmaMaxScreenCandidates,
  figmaScreenNamePattern,
  figmaCacheEnabled,
  figmaCacheTtlMs,
  iconMapFilePath,
  figmaScreenElementBudget,
  figmaScreenElementMaxDepth,
  brandTheme,
  commandTimeoutMs,
  enableUiValidation,
  installPreferOffline,
  skipInstall,
  enablePreview,
  fetchImpl
}: {
  figmaRequestTimeoutMs?: number;
  figmaMaxRetries?: number;
  figmaBootstrapDepth?: number;
  figmaNodeBatchSize?: number;
  figmaNodeFetchConcurrency?: number;
  figmaAdaptiveBatchingEnabled?: boolean;
  figmaMaxScreenCandidates?: number;
  figmaScreenNamePattern?: string;
  figmaCacheEnabled?: boolean;
  figmaCacheTtlMs?: number;
  iconMapFilePath?: string;
  figmaScreenElementBudget?: number;
  figmaScreenElementMaxDepth?: number;
  brandTheme?: string;
  commandTimeoutMs?: number;
  enableUiValidation?: boolean;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  enablePreview?: boolean;
  fetchImpl?: typeof fetch;
}): JobEngineRuntime => {
  return {
    figmaTimeoutMs:
      typeof figmaRequestTimeoutMs === "number" && Number.isFinite(figmaRequestTimeoutMs)
        ? Math.max(1_000, Math.trunc(figmaRequestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
    figmaMaxRetries:
      typeof figmaMaxRetries === "number" && Number.isFinite(figmaMaxRetries)
        ? Math.max(1, Math.min(10, Math.trunc(figmaMaxRetries)))
        : DEFAULT_MAX_RETRIES,
    figmaBootstrapDepth:
      typeof figmaBootstrapDepth === "number" && Number.isFinite(figmaBootstrapDepth)
        ? Math.max(1, Math.min(10, Math.trunc(figmaBootstrapDepth)))
        : DEFAULT_BOOTSTRAP_DEPTH,
    figmaNodeBatchSize:
      typeof figmaNodeBatchSize === "number" && Number.isFinite(figmaNodeBatchSize)
        ? Math.max(1, Math.min(20, Math.trunc(figmaNodeBatchSize)))
        : DEFAULT_NODE_BATCH_SIZE,
    figmaNodeFetchConcurrency:
      typeof figmaNodeFetchConcurrency === "number" && Number.isFinite(figmaNodeFetchConcurrency)
        ? Math.max(1, Math.min(10, Math.trunc(figmaNodeFetchConcurrency)))
        : DEFAULT_NODE_FETCH_CONCURRENCY,
    figmaAdaptiveBatchingEnabled:
      typeof figmaAdaptiveBatchingEnabled === "boolean"
        ? figmaAdaptiveBatchingEnabled
        : DEFAULT_ADAPTIVE_BATCHING_ENABLED,
    figmaMaxScreenCandidates:
      typeof figmaMaxScreenCandidates === "number" && Number.isFinite(figmaMaxScreenCandidates)
        ? Math.max(1, Math.min(200, Math.trunc(figmaMaxScreenCandidates)))
        : DEFAULT_MAX_SCREEN_CANDIDATES,
    figmaScreenNamePattern:
      typeof figmaScreenNamePattern === "string" && figmaScreenNamePattern.trim().length > 0
        ? figmaScreenNamePattern.trim()
        : undefined,
    figmaCacheEnabled: typeof figmaCacheEnabled === "boolean" ? figmaCacheEnabled : DEFAULT_FIGMA_CACHE_ENABLED,
    figmaCacheTtlMs:
      typeof figmaCacheTtlMs === "number" && Number.isFinite(figmaCacheTtlMs)
        ? Math.max(1_000, Math.min(24 * 60 * 60_000, Math.trunc(figmaCacheTtlMs)))
        : DEFAULT_FIGMA_CACHE_TTL_MS,
    iconMapFilePath: typeof iconMapFilePath === "string" && iconMapFilePath.trim().length > 0 ? iconMapFilePath.trim() : undefined,
    figmaScreenElementBudget:
      typeof figmaScreenElementBudget === "number" && Number.isFinite(figmaScreenElementBudget)
        ? Math.max(100, Math.min(10_000, Math.trunc(figmaScreenElementBudget)))
        : DEFAULT_SCREEN_ELEMENT_BUDGET,
    figmaScreenElementMaxDepth:
      typeof figmaScreenElementMaxDepth === "number" && Number.isFinite(figmaScreenElementMaxDepth)
        ? Math.max(1, Math.min(64, Math.trunc(figmaScreenElementMaxDepth)))
        : DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
    brandTheme:
      typeof brandTheme === "string" ? (normalizeBrandTheme(brandTheme) ?? DEFAULT_BRAND_THEME) : DEFAULT_BRAND_THEME,
    commandTimeoutMs:
      typeof commandTimeoutMs === "number" && Number.isFinite(commandTimeoutMs)
        ? Math.max(5_000, Math.min(60 * 60_000, Math.trunc(commandTimeoutMs)))
        : DEFAULT_COMMAND_TIMEOUT_MS,
    enableUiValidation:
      typeof enableUiValidation === "boolean" ? enableUiValidation : DEFAULT_ENABLE_UI_VALIDATION,
    installPreferOffline:
      typeof installPreferOffline === "boolean" ? installPreferOffline : DEFAULT_INSTALL_PREFER_OFFLINE,
    skipInstall: typeof skipInstall === "boolean" ? skipInstall : DEFAULT_SKIP_INSTALL,
    previewEnabled: enablePreview !== false,
    fetchImpl: fetchImpl ?? fetch
  };
};
