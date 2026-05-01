import type {
  WorkspaceBrandTheme,
  WorkspaceCompositeQualityWeightsInput,
  WorkspaceRouterMode,
  WorkspaceVisualQualityReferenceMode,
} from "../contracts/index.js";
import {
  DEFAULT_GENERATION_LOCALE,
  resolveGenerationLocale,
} from "../generation-locale.js";
import {
  createWorkspaceLogger,
  DEFAULT_WORKSPACE_LOG_FORMAT,
  resolveWorkspaceLogFormat,
  type WorkspaceRuntimeLogger,
} from "../logging.js";
import type { FigmaMcpEnrichment } from "../parity/types.js";
import {
  DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS,
  type PipelineDiagnosticLimits,
} from "./errors.js";
import {
  createFigmaRestCircuitBreaker,
  type FigmaRestCircuitBreakerClock,
  type FigmaRestCircuitTransitionEvent,
} from "./figma-rest-circuit-breaker.js";
import type {
  FigmaMcpEnrichmentLoaderInput,
  JobEngineRuntime,
} from "./types.js";
import type { ResolvedCustomerProfile } from "../customer-profile.js";
import { normalizeVisualBrowserNames } from "./visual-browser-matrix.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_FIGMA_CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const DEFAULT_FIGMA_CIRCUIT_BREAKER_RESET_TIMEOUT_MS = 30_000;
const DEFAULT_BOOTSTRAP_DEPTH = 5;
const DEFAULT_NODE_BATCH_SIZE = 6;
const DEFAULT_NODE_FETCH_CONCURRENCY = 3;
const DEFAULT_ADAPTIVE_BATCHING_ENABLED = true;
const DEFAULT_MAX_SCREEN_CANDIDATES = 40;
const DEFAULT_FIGMA_CACHE_ENABLED = true;
const DEFAULT_FIGMA_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_IR_CACHE_ENABLED = true;
const DEFAULT_IR_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_MAX_IR_CACHE_ENTRIES = 50;
const DEFAULT_MAX_IR_CACHE_BYTES = 128 * 1024 * 1024;
const DEFAULT_EXPORT_IMAGES = true;
const DEFAULT_SCREEN_ELEMENT_BUDGET = 1_200;
const DEFAULT_SCREEN_ELEMENT_MAX_DEPTH = 14;
const DEFAULT_BRAND_THEME: WorkspaceBrandTheme = "derived";
const DEFAULT_ROUTER_MODE: WorkspaceRouterMode = "browser";
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_COMMAND_STDOUT_MAX_BYTES = 1_048_576;
const DEFAULT_COMMAND_STDERR_MAX_BYTES = 1_048_576;
const DEFAULT_ENABLE_VISUAL_QUALITY_VALIDATION = false;
const DEFAULT_ENABLE_LINT_AUTOFIX = true;
const DEFAULT_VISUAL_QUALITY_REFERENCE_MODE: WorkspaceVisualQualityReferenceMode =
  "figma_api";
const DEFAULT_VISUAL_QUALITY_VIEWPORT_WIDTH = 1280;
const DEFAULT_VISUAL_QUALITY_VIEWPORT_HEIGHT = 800;
const DEFAULT_VISUAL_QUALITY_DEVICE_SCALE_FACTOR = 1;
const DEFAULT_COMPOSITE_QUALITY_WEIGHTS_INPUT: WorkspaceCompositeQualityWeightsInput =
  {
    visual: 0.6,
    performance: 0.4,
  };
const DEFAULT_INSTALL_PREFER_OFFLINE = true;
const DEFAULT_SKIP_INSTALL = false;
const DEFAULT_MAX_CONCURRENT_JOBS = 1;
const DEFAULT_MAX_QUEUED_JOBS = 20;
const DEFAULT_MAX_VALIDATION_ATTEMPTS = 3;
const DEFAULT_LOG_LIMIT = 300;
const DEFAULT_MAX_JOB_DISK_BYTES = 512 * 1024 * 1024;
const DEFAULT_JOB_RETENTION_MAX_COUNT = 200;
const DEFAULT_JOB_RETENTION_MAX_AGE_MS = 24 * 60 * 60_000;
const DEFAULT_LOCAL_SYNC_CONFIRMATION_SWEEP_INTERVAL_MS = 60_000;

const clampInteger = ({
  value,
  min,
  max,
  fallback,
}: {
  value: number | undefined;
  min: number;
  max: number;
  fallback: number;
}): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
};

const resolveIntegerInRange = ({
  value,
  min,
  max,
  fallback,
}: {
  value: number | undefined;
  min: number;
  max: number;
  fallback: number;
}): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.trunc(value);
  if (normalized < min) {
    return fallback;
  }
  return Math.min(max, normalized);
};

const resolveFiniteNumberInRange = ({
  value,
  min,
  max,
  fallback,
}: {
  value: number | undefined;
  min: number;
  max: number;
  fallback: number;
}): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  if (value < min) {
    return fallback;
  }
  return Math.min(max, value);
};

const normalizeBrandTheme = (
  value: string | undefined,
): WorkspaceBrandTheme | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "derived" || normalized === "sparkasse") {
    return normalized;
  }
  return undefined;
};

const normalizeRouterMode = (
  value: string | undefined,
): WorkspaceRouterMode | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "browser" || normalized === "hash") {
    return normalized;
  }
  return undefined;
};

const normalizeVisualQualityReferenceMode = (
  value: string | undefined,
): WorkspaceVisualQualityReferenceMode | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "figma_api" || normalized === "frozen_fixture") {
    return normalized;
  }
  return undefined;
};

const parseCompositeQualityWeight = (
  value: string | undefined,
): number | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseBooleanLike = (value: string | undefined): boolean | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return undefined;
};

const resolvePerfValidationPolicy = (
  value: boolean | undefined,
): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  return parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION ??
      process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION,
  );
};

const resolveLintAutofixPolicy = (value: boolean | undefined): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  return (
    parseBooleanLike(process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX) ??
    DEFAULT_ENABLE_LINT_AUTOFIX
  );
};

const resolveCompositeQualityWeightInput = (
  input: WorkspaceCompositeQualityWeightsInput | undefined,
): WorkspaceCompositeQualityWeightsInput => {
  if (input?.visual !== undefined || input?.performance !== undefined) {
    return {
      ...(input.visual !== undefined ? { visual: input.visual } : {}),
      ...(input.performance !== undefined
        ? { performance: input.performance }
        : {}),
    };
  }
  const visualFromEnv = parseCompositeQualityWeight(
    process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_VISUAL_WEIGHT,
  );
  const performanceFromEnv = parseCompositeQualityWeight(
    process.env.FIGMAPIPE_WORKSPACE_COMPOSITE_QUALITY_PERFORMANCE_WEIGHT,
  );
  if (visualFromEnv !== undefined || performanceFromEnv !== undefined) {
    return {
      ...(visualFromEnv !== undefined ? { visual: visualFromEnv } : {}),
      ...(performanceFromEnv !== undefined
        ? { performance: performanceFromEnv }
        : {}),
    };
  }
  return { ...DEFAULT_COMPOSITE_QUALITY_WEIGHTS_INPUT };
};

const resolveNormalizedCompositeQualityWeights = (
  input: WorkspaceCompositeQualityWeightsInput | undefined,
): { visual: number; performance: number } => {
  const visual = input?.visual;
  const performance = input?.performance;
  const validate = (value: number | undefined, label: string): void => {
    if (value === undefined) {
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(
        `runtime: ${label} composite quality weight must be within 0..1.`,
      );
    }
  };
  validate(visual, "visual");
  validate(performance, "performance");
  if (visual === undefined && performance === undefined) {
    return {
      visual: DEFAULT_COMPOSITE_QUALITY_WEIGHTS_INPUT.visual ?? 0.6,
      performance: DEFAULT_COMPOSITE_QUALITY_WEIGHTS_INPUT.performance ?? 0.4,
    };
  }
  let resolvedVisual = visual;
  let resolvedPerformance = performance;
  if (resolvedVisual === undefined && resolvedPerformance !== undefined) {
    resolvedVisual = 1 - resolvedPerformance;
  } else if (
    resolvedPerformance === undefined &&
    resolvedVisual !== undefined
  ) {
    resolvedPerformance = 1 - resolvedVisual;
  }
  const total = (resolvedVisual ?? 0) + (resolvedPerformance ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(
      "runtime: composite quality weights must sum to a positive value.",
    );
  }
  return {
    visual: Math.round(((resolvedVisual ?? 0) / total) * 10_000) / 10_000,
    performance:
      Math.round(((resolvedPerformance ?? 0) / total) * 10_000) / 10_000,
  };
};

const toFigmaRestCircuitTransitionLogMessage = ({
  fromState,
  toState,
  trigger,
  snapshot,
}: FigmaRestCircuitTransitionEvent): string => {
  const details = [
    `trigger=${trigger}`,
    `consecutiveFailures=${snapshot.consecutiveFailures}`,
    `probeInFlight=${snapshot.probeInFlight}`,
  ];
  if (snapshot.nextProbeAt !== undefined) {
    details.push(`nextProbeAt=${snapshot.nextProbeAt}`);
  }
  return `Figma REST circuit breaker transitioned ${fromState} -> ${toState} (${details.join(", ")}).`;
};

export const resolveRuntimeSettings = ({
  figmaRequestTimeoutMs,
  figmaMaxRetries,
  figmaCircuitBreakerFailureThreshold,
  figmaCircuitBreakerResetTimeoutMs,
  figmaBootstrapDepth,
  figmaNodeBatchSize,
  figmaNodeFetchConcurrency,
  figmaAdaptiveBatchingEnabled,
  figmaMaxScreenCandidates,
  figmaScreenNamePattern,
  figmaCacheEnabled,
  figmaCacheTtlMs,
  maxJsonResponseBytes,
  irCacheEnabled,
  irCacheTtlMs,
  maxIrCacheEntries,
  maxIrCacheBytes,
  iconMapFilePath,
  designSystemFilePath,
  exportImages,
  figmaScreenElementBudget,
  figmaScreenElementMaxDepth,
  brandTheme,
  sparkasseTokensFilePath,
  generationLocale,
  routerMode,
  commandTimeoutMs,
  commandStdoutMaxBytes,
  commandStderrMaxBytes,
  pipelineDiagnosticMaxCount,
  pipelineDiagnosticTextMaxLength,
  pipelineDiagnosticDetailsMaxKeys,
  pipelineDiagnosticDetailsMaxItems,
  pipelineDiagnosticDetailsMaxDepth,
  enableLintAutofix,
  enablePerfValidation,
  enableUiValidation,
  enableVisualQualityValidation,
  visualQualityReferenceMode,
  visualQualityViewportWidth,
  visualQualityViewportHeight,
  visualQualityDeviceScaleFactor,
  visualQualityBrowsers,
  compositeQualityWeights,
  enableUnitTestValidation,
  unitTestIgnoreFailure,
  installPreferOffline,
  skipInstall,
  maxConcurrentJobs,
  maxQueuedJobs,
  maxValidationAttempts,
  logLimit,
  maxJobDiskBytes,
  jobRetentionMaxCount,
  jobRetentionMaxAgeMs,
  localSyncConfirmationSweepIntervalMs,
  logFormat,
  logger,
  enablePreview,
  fetchImpl,
  customerProfile,
  figmaMcpEnrichmentLoader,
  figmaCircuitBreakerClock,
}: {
  figmaRequestTimeoutMs?: number;
  figmaMaxRetries?: number;
  figmaCircuitBreakerFailureThreshold?: number;
  figmaCircuitBreakerResetTimeoutMs?: number;
  figmaBootstrapDepth?: number;
  figmaNodeBatchSize?: number;
  figmaNodeFetchConcurrency?: number;
  figmaAdaptiveBatchingEnabled?: boolean;
  figmaMaxScreenCandidates?: number;
  figmaScreenNamePattern?: string;
  figmaCacheEnabled?: boolean;
  figmaCacheTtlMs?: number;
  maxJsonResponseBytes?: number;
  irCacheEnabled?: boolean;
  irCacheTtlMs?: number;
  maxIrCacheEntries?: number;
  maxIrCacheBytes?: number;
  iconMapFilePath?: string;
  designSystemFilePath?: string;
  exportImages?: boolean;
  figmaScreenElementBudget?: number;
  figmaScreenElementMaxDepth?: number;
  brandTheme?: string;
  sparkasseTokensFilePath?: string;
  generationLocale?: string;
  routerMode?: string;
  commandTimeoutMs?: number;
  commandStdoutMaxBytes?: number;
  commandStderrMaxBytes?: number;
  pipelineDiagnosticMaxCount?: number;
  pipelineDiagnosticTextMaxLength?: number;
  pipelineDiagnosticDetailsMaxKeys?: number;
  pipelineDiagnosticDetailsMaxItems?: number;
  pipelineDiagnosticDetailsMaxDepth?: number;
  enableLintAutofix?: boolean;
  enablePerfValidation?: boolean;
  enableUiValidation?: boolean;
  enableVisualQualityValidation?: boolean;
  visualQualityReferenceMode?: string;
  visualQualityViewportWidth?: number;
  visualQualityViewportHeight?: number;
  visualQualityDeviceScaleFactor?: number;
  visualQualityBrowsers?: string[];
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  enableUnitTestValidation?: boolean;
  unitTestIgnoreFailure?: boolean;
  installPreferOffline?: boolean;
  skipInstall?: boolean;
  maxConcurrentJobs?: number;
  maxQueuedJobs?: number;
  maxValidationAttempts?: number;
  logLimit?: number;
  maxJobDiskBytes?: number;
  jobRetentionMaxCount?: number;
  jobRetentionMaxAgeMs?: number;
  localSyncConfirmationSweepIntervalMs?: number;
  logFormat?: string;
  logger?: WorkspaceRuntimeLogger;
  enablePreview?: boolean;
  fetchImpl?: typeof fetch;
  customerProfile?: ResolvedCustomerProfile;
  figmaMcpEnrichmentLoader?: (
    input: FigmaMcpEnrichmentLoaderInput,
  ) => Promise<FigmaMcpEnrichment | undefined>;
  figmaCircuitBreakerClock?: FigmaRestCircuitBreakerClock;
}): JobEngineRuntime => {
  const resolvedFigmaCircuitBreakerFailureThreshold =
    typeof figmaCircuitBreakerFailureThreshold === "number" &&
    Number.isFinite(figmaCircuitBreakerFailureThreshold)
      ? Math.max(
          1,
          Math.min(20, Math.trunc(figmaCircuitBreakerFailureThreshold)),
        )
      : DEFAULT_FIGMA_CIRCUIT_BREAKER_FAILURE_THRESHOLD;
  const resolvedFigmaCircuitBreakerResetTimeoutMs =
    typeof figmaCircuitBreakerResetTimeoutMs === "number" &&
    Number.isFinite(figmaCircuitBreakerResetTimeoutMs)
      ? Math.max(
          1_000,
          Math.min(60 * 60_000, Math.trunc(figmaCircuitBreakerResetTimeoutMs)),
        )
      : DEFAULT_FIGMA_CIRCUIT_BREAKER_RESET_TIMEOUT_MS;
  const resolvedLogFormat = resolveWorkspaceLogFormat({
    value: logFormat,
    fallback: DEFAULT_WORKSPACE_LOG_FORMAT,
  });
  const resolvedLogger =
    logger ?? createWorkspaceLogger({ format: resolvedLogFormat });
  const resolvedPipelineDiagnosticLimits: PipelineDiagnosticLimits = {
    maxDiagnostics: clampInteger({
      value: pipelineDiagnosticMaxCount,
      min: 1,
      max: 500,
      fallback: DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.maxDiagnostics,
    }),
    textMaxLength: clampInteger({
      value: pipelineDiagnosticTextMaxLength,
      min: 16,
      max: 4_000,
      fallback: DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.textMaxLength,
    }),
    detailsMaxKeys: clampInteger({
      value: pipelineDiagnosticDetailsMaxKeys,
      min: 1,
      max: 200,
      fallback: DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.detailsMaxKeys,
    }),
    detailsMaxItems: clampInteger({
      value: pipelineDiagnosticDetailsMaxItems,
      min: 1,
      max: 200,
      fallback: DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.detailsMaxItems,
    }),
    detailsMaxDepth: clampInteger({
      value: pipelineDiagnosticDetailsMaxDepth,
      min: 1,
      max: 10,
      fallback: DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.detailsMaxDepth,
    }),
  };

  return {
    figmaTimeoutMs:
      typeof figmaRequestTimeoutMs === "number" &&
      Number.isFinite(figmaRequestTimeoutMs)
        ? Math.max(1_000, Math.trunc(figmaRequestTimeoutMs))
        : DEFAULT_TIMEOUT_MS,
    figmaMaxRetries:
      typeof figmaMaxRetries === "number" && Number.isFinite(figmaMaxRetries)
        ? Math.max(1, Math.min(10, Math.trunc(figmaMaxRetries)))
        : DEFAULT_MAX_RETRIES,
    figmaCircuitBreakerFailureThreshold:
      resolvedFigmaCircuitBreakerFailureThreshold,
    figmaCircuitBreakerResetTimeoutMs:
      resolvedFigmaCircuitBreakerResetTimeoutMs,
    figmaRestCircuitBreaker: createFigmaRestCircuitBreaker({
      failureThreshold: resolvedFigmaCircuitBreakerFailureThreshold,
      resetTimeoutMs: resolvedFigmaCircuitBreakerResetTimeoutMs,
      ...(figmaCircuitBreakerClock ? { clock: figmaCircuitBreakerClock } : {}),
      onStateTransition: (event) => {
        resolvedLogger.log({
          level: "info",
          stage: "figma.source",
          message: toFigmaRestCircuitTransitionLogMessage(event),
        });
      },
    }),
    figmaBootstrapDepth:
      typeof figmaBootstrapDepth === "number" &&
      Number.isFinite(figmaBootstrapDepth)
        ? Math.max(1, Math.min(10, Math.trunc(figmaBootstrapDepth)))
        : DEFAULT_BOOTSTRAP_DEPTH,
    figmaNodeBatchSize:
      typeof figmaNodeBatchSize === "number" &&
      Number.isFinite(figmaNodeBatchSize)
        ? Math.max(1, Math.min(20, Math.trunc(figmaNodeBatchSize)))
        : DEFAULT_NODE_BATCH_SIZE,
    figmaNodeFetchConcurrency:
      typeof figmaNodeFetchConcurrency === "number" &&
      Number.isFinite(figmaNodeFetchConcurrency)
        ? Math.max(1, Math.min(10, Math.trunc(figmaNodeFetchConcurrency)))
        : DEFAULT_NODE_FETCH_CONCURRENCY,
    figmaAdaptiveBatchingEnabled:
      typeof figmaAdaptiveBatchingEnabled === "boolean"
        ? figmaAdaptiveBatchingEnabled
        : DEFAULT_ADAPTIVE_BATCHING_ENABLED,
    figmaMaxScreenCandidates:
      typeof figmaMaxScreenCandidates === "number" &&
      Number.isFinite(figmaMaxScreenCandidates)
        ? Math.max(1, Math.min(200, Math.trunc(figmaMaxScreenCandidates)))
        : DEFAULT_MAX_SCREEN_CANDIDATES,
    figmaScreenNamePattern:
      typeof figmaScreenNamePattern === "string" &&
      figmaScreenNamePattern.trim().length > 0
        ? figmaScreenNamePattern.trim()
        : undefined,
    figmaCacheEnabled:
      typeof figmaCacheEnabled === "boolean"
        ? figmaCacheEnabled
        : DEFAULT_FIGMA_CACHE_ENABLED,
    figmaCacheTtlMs:
      typeof figmaCacheTtlMs === "number" && Number.isFinite(figmaCacheTtlMs)
        ? Math.max(
            1_000,
            Math.min(24 * 60 * 60_000, Math.trunc(figmaCacheTtlMs)),
          )
        : DEFAULT_FIGMA_CACHE_TTL_MS,
    maxJsonResponseBytes: clampInteger({
      value: maxJsonResponseBytes,
      min: 1_024,
      max: 256 * 1024 * 1024,
      fallback: DEFAULT_MAX_JSON_RESPONSE_BYTES,
    }),
    irCacheEnabled:
      typeof irCacheEnabled === "boolean"
        ? irCacheEnabled
        : DEFAULT_IR_CACHE_ENABLED,
    irCacheTtlMs:
      typeof irCacheTtlMs === "number" && Number.isFinite(irCacheTtlMs)
        ? Math.max(1_000, Math.min(24 * 60 * 60_000, Math.trunc(irCacheTtlMs)))
        : DEFAULT_IR_CACHE_TTL_MS,
    maxIrCacheEntries: clampInteger({
      value: maxIrCacheEntries,
      min: 1,
      max: 500,
      fallback: DEFAULT_MAX_IR_CACHE_ENTRIES,
    }),
    maxIrCacheBytes: clampInteger({
      value: maxIrCacheBytes,
      min: 1_024,
      max: 512 * 1024 * 1024,
      fallback: DEFAULT_MAX_IR_CACHE_BYTES,
    }),
    iconMapFilePath:
      typeof iconMapFilePath === "string" && iconMapFilePath.trim().length > 0
        ? iconMapFilePath.trim()
        : undefined,
    designSystemFilePath:
      typeof designSystemFilePath === "string" &&
      designSystemFilePath.trim().length > 0
        ? designSystemFilePath.trim()
        : undefined,
    exportImages:
      typeof exportImages === "boolean" ? exportImages : DEFAULT_EXPORT_IMAGES,
    figmaScreenElementBudget:
      typeof figmaScreenElementBudget === "number" &&
      Number.isFinite(figmaScreenElementBudget)
        ? Math.max(100, Math.min(10_000, Math.trunc(figmaScreenElementBudget)))
        : DEFAULT_SCREEN_ELEMENT_BUDGET,
    figmaScreenElementMaxDepth:
      typeof figmaScreenElementMaxDepth === "number" &&
      Number.isFinite(figmaScreenElementMaxDepth)
        ? Math.max(1, Math.min(64, Math.trunc(figmaScreenElementMaxDepth)))
        : DEFAULT_SCREEN_ELEMENT_MAX_DEPTH,
    brandTheme:
      typeof brandTheme === "string"
        ? (normalizeBrandTheme(brandTheme) ?? DEFAULT_BRAND_THEME)
        : DEFAULT_BRAND_THEME,
    ...(typeof sparkasseTokensFilePath === "string" &&
    sparkasseTokensFilePath.trim().length > 0
      ? { sparkasseTokensFilePath: sparkasseTokensFilePath.trim() }
      : {}),
    generationLocale: resolveGenerationLocale({
      requestedLocale: generationLocale,
      fallbackLocale: DEFAULT_GENERATION_LOCALE,
    }).locale,
    routerMode:
      typeof routerMode === "string"
        ? (normalizeRouterMode(routerMode) ?? DEFAULT_ROUTER_MODE)
        : DEFAULT_ROUTER_MODE,
    commandTimeoutMs:
      typeof commandTimeoutMs === "number" && Number.isFinite(commandTimeoutMs)
        ? Math.max(5_000, Math.min(60 * 60_000, Math.trunc(commandTimeoutMs)))
        : DEFAULT_COMMAND_TIMEOUT_MS,
    commandStdoutMaxBytes:
      typeof commandStdoutMaxBytes === "number" &&
      Number.isFinite(commandStdoutMaxBytes)
        ? Math.max(
            4_096,
            Math.min(16_777_216, Math.trunc(commandStdoutMaxBytes)),
          )
        : DEFAULT_COMMAND_STDOUT_MAX_BYTES,
    commandStderrMaxBytes:
      typeof commandStderrMaxBytes === "number" &&
      Number.isFinite(commandStderrMaxBytes)
        ? Math.max(
            4_096,
            Math.min(16_777_216, Math.trunc(commandStderrMaxBytes)),
          )
        : DEFAULT_COMMAND_STDERR_MAX_BYTES,
    pipelineDiagnosticLimits: resolvedPipelineDiagnosticLimits,
    enableLintAutofix: resolveLintAutofixPolicy(enableLintAutofix),
    enablePerfValidation: resolvePerfValidationPolicy(enablePerfValidation),
    enableUiValidation:
      typeof enableUiValidation === "boolean" ? enableUiValidation : undefined,
    enableVisualQualityValidation:
      typeof enableVisualQualityValidation === "boolean"
        ? enableVisualQualityValidation
        : DEFAULT_ENABLE_VISUAL_QUALITY_VALIDATION,
    visualQualityReferenceMode:
      normalizeVisualQualityReferenceMode(visualQualityReferenceMode) ??
      DEFAULT_VISUAL_QUALITY_REFERENCE_MODE,
    visualQualityViewportWidth: resolveIntegerInRange({
      value: visualQualityViewportWidth,
      min: 320,
      max: 4_096,
      fallback: DEFAULT_VISUAL_QUALITY_VIEWPORT_WIDTH,
    }),
    visualQualityViewportHeight: resolveIntegerInRange({
      value: visualQualityViewportHeight,
      min: 200,
      max: 4_096,
      fallback: DEFAULT_VISUAL_QUALITY_VIEWPORT_HEIGHT,
    }),
    visualQualityDeviceScaleFactor: resolveFiniteNumberInRange({
      value: visualQualityDeviceScaleFactor,
      min: 0.5,
      max: 4,
      fallback: DEFAULT_VISUAL_QUALITY_DEVICE_SCALE_FACTOR,
    }),
    visualQualityBrowsers: normalizeVisualBrowserNames(visualQualityBrowsers),
    compositeQualityWeights: resolveNormalizedCompositeQualityWeights(
      resolveCompositeQualityWeightInput(compositeQualityWeights),
    ),
    enableUnitTestValidation:
      typeof enableUnitTestValidation === "boolean"
        ? enableUnitTestValidation
        : undefined,
    unitTestIgnoreFailure:
      typeof unitTestIgnoreFailure === "boolean"
        ? unitTestIgnoreFailure
        : false,
    installPreferOffline:
      typeof installPreferOffline === "boolean"
        ? installPreferOffline
        : DEFAULT_INSTALL_PREFER_OFFLINE,
    skipInstall:
      typeof skipInstall === "boolean" ? skipInstall : DEFAULT_SKIP_INSTALL,
    maxConcurrentJobs:
      typeof maxConcurrentJobs === "number" &&
      Number.isFinite(maxConcurrentJobs)
        ? Math.max(1, Math.min(16, Math.trunc(maxConcurrentJobs)))
        : DEFAULT_MAX_CONCURRENT_JOBS,
    maxQueuedJobs:
      typeof maxQueuedJobs === "number" && Number.isFinite(maxQueuedJobs)
        ? Math.max(0, Math.min(1000, Math.trunc(maxQueuedJobs)))
        : DEFAULT_MAX_QUEUED_JOBS,
    maxValidationAttempts: clampInteger({
      value: maxValidationAttempts,
      min: 1,
      max: 10,
      fallback: DEFAULT_MAX_VALIDATION_ATTEMPTS,
    }),
    logLimit: clampInteger({
      value: logLimit,
      min: 1,
      max: 1000,
      fallback: DEFAULT_LOG_LIMIT,
    }),
    maxJobDiskBytes: clampInteger({
      value: maxJobDiskBytes,
      min: 1_024,
      max: 10 * 1024 * 1024 * 1024,
      fallback: DEFAULT_MAX_JOB_DISK_BYTES,
    }),
    jobRetentionMaxCount: clampInteger({
      value: jobRetentionMaxCount,
      min: 0,
      max: 10_000,
      fallback: DEFAULT_JOB_RETENTION_MAX_COUNT,
    }),
    jobRetentionMaxAgeMs: clampInteger({
      value: jobRetentionMaxAgeMs,
      min: 0,
      max: 7 * 24 * 60 * 60_000,
      fallback: DEFAULT_JOB_RETENTION_MAX_AGE_MS,
    }),
    localSyncConfirmationSweepIntervalMs: clampInteger({
      value: localSyncConfirmationSweepIntervalMs,
      min: 0,
      max: 60 * 60_000,
      fallback: DEFAULT_LOCAL_SYNC_CONFIRMATION_SWEEP_INTERVAL_MS,
    }),
    logFormat: resolvedLogFormat,
    logger: resolvedLogger,
    previewEnabled: enablePreview !== false,
    fetchImpl: fetchImpl ?? fetch,
    ...(customerProfile ? { customerProfile } : {}),
    ...(figmaMcpEnrichmentLoader ? { figmaMcpEnrichmentLoader } : {}),
  };
};
