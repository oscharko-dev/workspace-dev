// ---------------------------------------------------------------------------
// generator-core.ts — Slim orchestrator for artifact generation
// Sub-modules: render, patterns, forms, interactive, sx, navigation
// See issue #297 for the decomposition rationale.
// ---------------------------------------------------------------------------
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AppShellIR,
  ComponentMappingRule,
  DesignIR,
  GenerationMetrics,
  GeneratedFile,
  LlmCodegenMode,
  ScreenSimplificationMetric,
  SimplificationMetrics
} from "./types.js";
import { validateDesignIR } from "./types.js";
import type { ComponentMappingWarning } from "./types-mapping.js";
import { WorkflowError } from "./workflow-error.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import {
  applyDesignSystemMappingsToGeneratedTsx,
  type DesignSystemConfig,
  getDefaultDesignSystemConfigPath,
  loadDesignSystemConfigFile
} from "../design-system.js";
import {
  collectCustomerProfileImportIssuesFromSource,
  isCustomerProfileMuiFallbackAllowed,
  resolveCustomerProfileDatePickerProvider,
  toCustomerProfileDesignSystemConfig,
  type ResolvedCustomerProfile
} from "../customer-profile.js";
import type { ComponentMatchReportIconResolutionRecord } from "../storybook/types.js";
import type { ResolvedStorybookTheme } from "../storybook/theme-resolver.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import type { IconRenderWarning } from "./generator-render.js";
import { resolveEmittedScreenTargets } from "./emitted-screen-targets.js";
import { deriveThemeComponentDefaultsFromIr } from "./generator-design-system.js";
import type { ThemeComponentDefaults, ThemeSxStyleValue } from "./generator-design-system.js";
import {
  resolveFormHandlingMode,
  appShellFile,
  fallbackThemeFile,
  storybookThemeFile,
  fallbackScreenFile,
  statefulVariantScreenFile,
  wrappedFallbackScreenFile,
  makeErrorBoundaryFile,
  makeScreenSkeletonFile,
  makeAppFile
} from "./generator-templates.js";

// ── Re-exports from sub-modules (backward compatibility) ──────────────────

// generator-render.ts
export {
  hasVisualStyle,
  createEmptySimplificationStats,
  isIconLikeNode,
  isVectorGraphicNode,
  isSemanticIconWrapper,
  simplifyElements,
  sortChildren,
  approximatelyEqualNumber,
  resolveTypographyVariantByNodeId,
  hasMeaningfulTextDescendants,
  resolveImageSource,
  pickBestIconNode,
  findFirstByName,
  registerMappedImport,
  registerMuiImports,
  registerNamedMappedImport,
  renderMappedElement,
  toStateKey,
  normalizeIconImports,
  isDeepIconImport,
  registerIconImport,
  resolveIconColor,
  ICON_FALLBACK_FILE_NAME,
  ICON_FALLBACK_BUILTIN_RESOLVER,
  loadIconFallbackResolver,
  resolveFallbackIconComponent,
  detectGridLikeContainerLayout,
  detectCssGridLayout,
  createDeterministicScreenFile,
  createDeterministicAppFile,
  flattenElements,
  normalizeInputSemanticText,
  hasSubtreeName,
  collectSubtreeNames,
  collectIconNodes,
  toDeterministicImagePlaceholderSrc,
  isPlainRecord,
  clusterAxisValues,
  toNearestClusterIndex,
  RTL_LANGUAGE_CODES,
  DIRECTIONAL_ICON_NAMES,
  isRtlLocale
} from "./generator-render.js";
export type {
  VirtualParent,
  ButtonVariant,
  ButtonSize,
  DatePickerProviderConfig,
  HeadingComponent,
  LandmarkRole,
  RgbaColor,
  SemanticIconModel,
  IconImportSpec,
  IconFallbackResolver,
  MappedImportSpec,
  PrimitiveJsxPropValue,
  SpecializedComponentMapping,
  ExtractedComponentImportSpec,
  IconRenderWarning,
  RenderContext,
  RenderedButtonModel
} from "./generator-render.js";

// generator-sx.ts
export { extractSharedSxConstantsFromScreenContent } from "./generator-sx.js";

// generator-patterns.ts
export {
  buildPatternExtractionPlan,
  toPatternContextProviderName,
  toPatternContextHookName
} from "./generator-patterns.js";
export type {
  PatternExtractionInvocation,
  PatternContextFileSpec,
  PatternExtractionPlan
} from "./generator-patterns.js";

// generator-forms.ts
export {
  deriveSelectOptions,
  inferRequiredFromLabel,
  sanitizeRequiredLabel,
  inferVisualErrorFromOutline,
  isLikelyInputContainer,
  registerInteractiveField,
  detectFormGroups,
  detectCrossFieldRules,
  inferValidationMode,
  buildSemanticInputModel,
  toFormContextProviderName,
  toFormContextHookName
} from "./generator-forms.js";
export type {
  ValidationFieldType,
  ValidationRuleType,
  ValidationRule,
  CrossFieldRuleType,
  CrossFieldRule,
  RhfValidationMode,
  ResolvedFormHandlingMode,
  InteractiveFieldModel,
  FormGroupAssignment,
  FormContextFileSpec
} from "./generator-forms.js";

// generator-interactive.ts
export {
  ensureTabsStateModel,
  ensureDialogStateModel,
  isLikelyAccordionContainer,
  registerInteractiveAccordion,
  detectTabInterfacePattern,
  detectDialogOverlayPattern,
  detectNavigationBarPattern,
  NAVIGATION_BAR_TOP_LEVEL_DEPTH,
  analyzeListRow,
  collectListRows,
  detectRepeatedListPattern,
  isRenderableTabAction,
  toListSecondaryActionExpression
} from "./generator-interactive.js";
export type {
  ListRowAnalysis
} from "./generator-interactive.js";

// generator-navigation.ts
export {
  resolvePrototypeNavigationBinding,
  toRouterLinkProps,
  toNavigateHandlerProps
} from "./generator-navigation.js";

// Re-exports from other existing modules (preserving backward compat)
export { buildScreenArtifactIdentities, toComponentName, toDeterministicScreenPath } from "./generator-artifacts.js";
export type { ScreenArtifactIdentity } from "./generator-artifacts.js";
export {
  THEME_COMPONENT_ORDER,
  roundStableSxNumericValue,
  normalizeThemeSxValueForKey,
  collectThemeSxSampleFromEntries,
  collectThemeDefaultMatchedSxKeys,
  createDeterministicThemeFile,
  deriveThemeComponentDefaultsFromIr
} from "./generator-design-system.js";
export type {
  ThemeComponentDefaults,
  ThemeSxStyleValue,
  ThemeSxComponentStyleOverrides,
  ThemeSxSample,
  ThemeSxSampleCollector
} from "./generator-design-system.js";
export { createGeneratorContext } from "./generator-context.js";
export type {
  GeneratorContext,
  GeneratorConfig,
  GenerateArtifactsRuntimeAdapters as GeneratorRuntimeAdapters,
  MetricsAccumulator,
  WarningCollector,
  CreateGeneratorContextInput
} from "./generator-context.js";
export {
  resolveElementA11yLabel,
  resolveIconButtonAriaLabel,
  hasInteractiveDescendants,
  inferLandmarkRole,
  resolveSemanticContainerDescriptor,
  isDecorativeImageElement,
  isDecorativeElement,
  inferHeadingComponentByNodeId,
  resolveBackgroundHexForText,
  pushLowContrastWarning,
  inferAriaLiveRegion,
  shouldAddFocusTrap,
  hasAppBarAndMainContent,
  buildTabA11yId,
  buildTabPanelA11yId,
  buildAccordionHeaderA11yId,
  buildAccordionPanelA11yId
} from "./generator-a11y.js";
export type { AccessibilityWarning, SemanticContainerDescriptor } from "./generator-a11y.js";

// ── Internal imports from sub-modules used by the orchestrator ────────────
import {
  createEmptySimplificationStats,
  flattenElements,
  ICON_FALLBACK_FILE_NAME,
  loadIconFallbackResolver,
  isPlainRecord
} from "./generator-render.js";
import type {
  DatePickerProviderConfig,
  IconFallbackResolver,
  PrimitiveJsxPropValue,
  ResolvedFormHandlingMode,
  SpecializedComponentMapping
} from "./generator-render.js";
import type { GeneratorContext } from "./generator-context.js";
import type { AccessibilityWarning } from "./generator-a11y.js";

// ── Orchestrator code ─────────────────────────────────────────────────────

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  initialMappingWarnings?: ComponentMappingWarning[];
  customerProfile?: ResolvedCustomerProfile;
  customerProfileDesignSystemConfig?: DesignSystemConfig;
  customerProfileDesignSystemConfigSource?: "storybook_first";
  storybookFirstIconLookup?: ReadonlyMap<string, ComponentMatchReportIconResolutionRecord>;
  resolvedStorybookTheme?: ResolvedStorybookTheme;
  iconMapFilePath?: string;
  designSystemFilePath?: string;
  imageAssetMap?: Record<string, string>;
  /** Optional pre-built GeneratorContext for dependency injection in tests. */
  context?: GeneratorContext;
  generationLocale?: string;
  routerMode?: WorkspaceRouterMode;
  formHandlingMode?: WorkspaceFormHandlingMode;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  onLog: (message: string) => void;
}

type GenerateArtifactsInputWithRuntimeAdapters = GenerateArtifactsInput & {
  [GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL]?: Partial<GenerateArtifactsRuntimeAdapters>;
};

interface RejectedScreenEnhancement {
  screenName: string;
  reason: string;
}

// ── Streaming artifact types (issue #312) ────────────────────────────────

/** A single file yielded by the streaming generator. */
export interface StreamingArtifactFile {
  path: string;
  content: string;
}

/** Progress event emitted per completed screen. */
export interface StreamingProgressEvent {
  type: "progress";
  screenIndex: number;
  screenCount: number;
  screenName: string;
}

/** Discriminated union for all streaming artifact events. */
export type StreamingArtifactEvent =
  | { type: "theme"; files: StreamingArtifactFile[] }
  | { type: "screen"; screenName: string; files: StreamingArtifactFile[] }
  | { type: "app"; file: StreamingArtifactFile }
  | { type: "metrics"; file: StreamingArtifactFile }
  | StreamingProgressEvent;

/** Default batch size for parallel screen generation. */
const STREAMING_SCREEN_BATCH_SIZE = 4;

/** Split an array into chunks of the given size. */
const chunk = <T>(array: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

interface GenerateArtifactsResult {
  generatedPaths: string[];
  generationMetrics: GenerationMetrics;
  themeApplied: boolean;
  screenApplied: number;
  screenTotal: number;
  screenRejected: RejectedScreenEnhancement[];
  llmWarnings: Array<{
    code: "W_LLM_RESPONSES_INCOMPLETE";
    message: string;
  }>;
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  mappingDiagnostics: {
    missingMappingCount: number;
    contractMismatchCount: number;
    disabledMappingCount: number;
    broadPatternCount: number;
  };
  mappingWarnings: ComponentMappingWarning[];
  iconWarnings: IconRenderWarning[];
}


const accumulateSimplificationStats = ({
  target,
  source
}: {
  target: SimplificationMetrics;
  source: SimplificationMetrics;
}): void => {
  target.removedEmptyNodes += source.removedEmptyNodes;
  target.promotedSingleChild += source.promotedSingleChild;
  target.promotedGroupMultiChild += source.promotedGroupMultiChild;
  target.spacingMerges += source.spacingMerges;
  target.guardedSkips += source.guardedSkips;
};

const dedupeMappingWarnings = (
  warnings: ComponentMappingWarning[]
): ComponentMappingWarning[] => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const dedupeIconWarnings = (
  warnings: IconRenderWarning[]
): IconRenderWarning[] => {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.nodeId}:${warning.iconKey ?? "unknown"}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const writeGeneratedFile = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  if (!absolutePath.startsWith(path.resolve(rootDir) + path.sep)) {
    throw new Error(`LLM attempted path traversal: ${file.path}`);
  }
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

const GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL = Symbol.for(
  "workspace-dev.parity.generateArtifacts.runtimeAdapters"
);

type LoadedDesignSystemConfig = Awaited<ReturnType<typeof loadDesignSystemConfigFile>>;
type ApplyDesignSystemMappingsInput = Parameters<typeof applyDesignSystemMappingsToGeneratedTsx>[0];

interface GenerateArtifactsRuntimeAdapters {
  mkdirRecursive: (directory: string) => Promise<void>;
  writeTextFile: ({ filePath, content }: { filePath: string; content: string }) => Promise<void>;
  writeGeneratedFile: (rootDir: string, file: GeneratedFile) => Promise<void>;
  loadDesignSystemConfig: ({
    designSystemFilePath,
    onLog
  }: {
    designSystemFilePath: string;
    onLog: (message: string) => void;
  }) => Promise<LoadedDesignSystemConfig>;
  applyDesignSystemMappings: (input: ApplyDesignSystemMappingsInput) => string;
  loadIconResolver: ({
    iconMapFilePath,
    onLog
  }: {
    iconMapFilePath: string;
    onLog: (message: string) => void;
  }) => Promise<IconFallbackResolver>;
}

const DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS: GenerateArtifactsRuntimeAdapters = {
  mkdirRecursive: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  writeTextFile: async ({ filePath, content }) => {
    await writeFile(filePath, content, "utf-8");
  },
  writeGeneratedFile: async (rootDir, file) => {
    await writeGeneratedFile(rootDir, file);
  },
  loadDesignSystemConfig: async ({ designSystemFilePath, onLog }) => {
    return loadDesignSystemConfigFile({
      designSystemFilePath,
      onLog
    });
  },
  applyDesignSystemMappings: (input) => {
    return applyDesignSystemMappingsToGeneratedTsx(input);
  },
  loadIconResolver: async ({ iconMapFilePath, onLog }) => {
    return loadIconFallbackResolver({
      iconMapFilePath,
      onLog
    });
  }
};

const resolveGenerateArtifactsRuntimeAdapters = (input: GenerateArtifactsInput): GenerateArtifactsRuntimeAdapters => {
  if (input.context) {
    return input.context.runtimeAdapters;
  }
  const runtimeAdapterCarrier = input as GenerateArtifactsInputWithRuntimeAdapters;
  const candidate = runtimeAdapterCarrier[GENERATE_ARTIFACTS_RUNTIME_ADAPTERS_SYMBOL];
  if (!candidate) {
    return DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS;
  }
  return {
    mkdirRecursive: candidate.mkdirRecursive ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.mkdirRecursive,
    writeTextFile: candidate.writeTextFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeTextFile,
    writeGeneratedFile: candidate.writeGeneratedFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeGeneratedFile,
    loadDesignSystemConfig:
      candidate.loadDesignSystemConfig ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadDesignSystemConfig,
    applyDesignSystemMappings:
      candidate.applyDesignSystemMappings ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.applyDesignSystemMappings,
    loadIconResolver: candidate.loadIconResolver ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadIconResolver
  };
};

interface GenerateArtifactsResolvedPhase {
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  resolvedFormHandlingMode: ResolvedFormHandlingMode;
  transformGeneratedFileWithDesignSystem: (file: GeneratedFile) => GeneratedFile;
  effectiveCustomerProfileDesignSystemConfig?: DesignSystemConfig;
  customerProfile?: ResolvedCustomerProfile;
  designSystemConfig?: LoadedDesignSystemConfig;
}

const resolveGenerateArtifactsPhase = async ({
  input,
  generationLocale,
  formHandlingMode,
  llmModelName,
  llmCodegenMode,
  designSystemFilePath,
  customerProfile,
  customerProfileDesignSystemConfig,
  customerProfileDesignSystemConfigSource,
  onLog
}: {
  input: GenerateArtifactsInput;
  generationLocale: string | undefined;
  formHandlingMode: WorkspaceFormHandlingMode | undefined;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  designSystemFilePath: string;
  customerProfile: ResolvedCustomerProfile | undefined;
  customerProfileDesignSystemConfig: DesignSystemConfig | undefined;
  customerProfileDesignSystemConfigSource?: "storybook_first";
  onLog: (message: string) => void;
}): Promise<GenerateArtifactsResolvedPhase> => {
  void llmModelName;
  if (llmCodegenMode !== "deterministic") {
    throw new WorkflowError({
      code: "E_LLM_RUNTIME_UNAVAILABLE",
      stage: "codegen.generate",
      retryable: false,
      message: "Only deterministic code generation is supported in workspace-dev."
    });
  }
  const runtimeAdapters = resolveGenerateArtifactsRuntimeAdapters(input);
  const resolvedGenerationLocale = resolveGenerationLocale({
    requestedLocale: generationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  });
  if (resolvedGenerationLocale.usedFallback && typeof generationLocale === "string") {
    onLog(
      `Warning: Invalid generationLocale '${generationLocale}' configured for deterministic generation. ` +
        `Falling back to '${resolvedGenerationLocale.locale}'.`
    );
  }
  const resolvedFormHandlingMode = resolveFormHandlingMode({
    requestedMode: formHandlingMode
  });
  // Prefer the pre-derived design-system config passed from the Storybook-first
  // codegen path (derived from the component match report, which incorporates
  // catalog-aware resolution). Fall back to deriving directly from the profile
  // for non-Storybook-first runs. Both derivations must produce compatible
  // configs for the same profile.
  const customerProfileConfig =
    customerProfileDesignSystemConfig ??
    (customerProfileDesignSystemConfigSource === "storybook_first"
      ? {
          library: "__customer_profile__",
          mappings: {}
        }
      : customerProfile
        ? toCustomerProfileDesignSystemConfig({ profile: customerProfile })
        : undefined);
  const designSystemConfig = await runtimeAdapters.loadDesignSystemConfig({
    designSystemFilePath,
    onLog
  });
  const transformGeneratedFileWithDesignSystem = (file: GeneratedFile): GeneratedFile => {
    let transformedContent = file.content;
    if (customerProfileConfig) {
      transformedContent = runtimeAdapters.applyDesignSystemMappings({
        filePath: file.path,
        content: transformedContent,
        config: customerProfileConfig
      });
    }
    if (designSystemConfig) {
      transformedContent = runtimeAdapters.applyDesignSystemMappings({
        filePath: file.path,
        content: transformedContent,
        config: designSystemConfig
      });
    }
    if (customerProfile) {
      for (const issue of collectCustomerProfileImportIssuesFromSource({
        content: transformedContent,
        filePath: file.path,
        profile: customerProfile
      })) {
        onLog(`Customer profile import policy warning in ${file.path}: ${issue.message}`);
      }
    }
    return transformedContent === file.content
      ? file
      : {
          ...file,
          content: transformedContent
        };
  };
  return {
    runtimeAdapters,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    transformGeneratedFileWithDesignSystem,
    ...(customerProfileConfig ? { effectiveCustomerProfileDesignSystemConfig: customerProfileConfig } : {}),
    ...(customerProfile ? { customerProfile } : {}),
    ...(designSystemConfig ? { designSystemConfig } : {})
  };
};

interface GenerateArtifactsStatePhase {
  generatedPaths: Set<string>;
  generationMetrics: GenerationMetrics;
  truncationByScreenId: Map<string, {
    screenId: string;
    screenName: string;
    originalElements: number;
    retainedElements: number;
    budget: number;
  }>;
  allIrNodeIds: Set<string>;
  mappingByNodeId: Map<string, ComponentMappingRule>;
  mappingWarnings: ComponentMappingWarning[];
}

const initializeGenerateArtifactsStatePhase = ({
  ir,
  componentMappings,
  initialMappingWarnings = []
}: {
  ir: DesignIR;
  componentMappings: ComponentMappingRule[] | undefined;
  initialMappingWarnings?: ComponentMappingWarning[];
}): GenerateArtifactsStatePhase => {
  const generatedPaths = new Set<string>();
  const generationMetrics: GenerationMetrics = {
    fetchedNodes: ir.metrics?.fetchedNodes ?? 0,
    skippedHidden: ir.metrics?.skippedHidden ?? 0,
    skippedPlaceholders: ir.metrics?.skippedPlaceholders ?? 0,
    screenElementCounts: [...(ir.metrics?.screenElementCounts ?? [])],
    truncatedScreens: [...(ir.metrics?.truncatedScreens ?? [])],
    ...(ir.metrics?.classificationFallbacks ? { classificationFallbacks: [...ir.metrics.classificationFallbacks] } : {}),
    degradedGeometryNodes: [...(ir.metrics?.degradedGeometryNodes ?? [])],
    prototypeNavigationDetected: ir.metrics?.prototypeNavigationDetected ?? 0,
    prototypeNavigationResolved: ir.metrics?.prototypeNavigationResolved ?? 0,
    prototypeNavigationUnresolved: ir.metrics?.prototypeNavigationUnresolved ?? 0,
    prototypeNavigationRendered: 0,
    ...(ir.metrics?.nodeDiagnostics ? { nodeDiagnostics: [...ir.metrics.nodeDiagnostics] } : {}),
    ...(ir.metrics?.mcpCoverage ? { mcpCoverage: { ...ir.metrics.mcpCoverage } } : {})
  };
  const truncationByScreenId = new Map(
    generationMetrics.truncatedScreens.map((entry) => [entry.screenId, entry] as const)
  );
  const allIrNodeIds = new Set<string>(
    ir.screens.flatMap((screen) => flattenElements(screen.children).map((node) => node.id))
  );
  const prioritizedMappings = [...(componentMappings ?? [])]
    .filter((mapping) => typeof mapping.nodeId === "string" && mapping.nodeId.trim().length > 0)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "local_override" ? -1 : 1;
      }
      return (left.nodeId ?? "").localeCompare(right.nodeId ?? "");
    });
  const mappingByNodeId = new Map<string, ComponentMappingRule>();
  for (const mapping of prioritizedMappings) {
    const nodeId = mapping.nodeId;
    if (!nodeId || mappingByNodeId.has(nodeId)) {
      continue;
    }
    mappingByNodeId.set(nodeId, mapping);
  }
  const mappingWarnings: ComponentMappingWarning[] = [...initialMappingWarnings];
  for (const [nodeId] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Mapping for node '${nodeId}' has no matching node in current IR`
      });
    }
  }
  return {
    generatedPaths,
    generationMetrics,
    truncationByScreenId,
    allIrNodeIds,
    mappingByNodeId,
    mappingWarnings
  };
};

interface GenerateArtifactsBasePhase {
  iconResolver: IconFallbackResolver;
  themeComponentDefaults: ThemeComponentDefaults | undefined;
  themeFiles: StreamingArtifactFile[];
}

const parsePixelValue = (value: string | number | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized.endsWith("px")) {
    return undefined;
  }
  const numeric = Number(normalized.slice(0, -2));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
};

const toThemeSxRecord = (
  input: Record<string, boolean | number | string> | undefined
): Record<string, ThemeSxStyleValue> | undefined => {
  if (!input) {
    return undefined;
  }
  const normalized: Record<string, ThemeSxStyleValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number") {
      normalized[key] = value;
    }
  }
  if (Object.keys(normalized).length === 0) {
    return undefined;
  }
  return normalized;
};

const toThemeComponentDefaultsFromResolvedStorybookTheme = ({
  resolvedStorybookTheme
}: {
  resolvedStorybookTheme: ResolvedStorybookTheme;
}): ThemeComponentDefaults | undefined => {
  const defaults: ThemeComponentDefaults = {};
  const c1StyleOverrides: NonNullable<ThemeComponentDefaults["c1StyleOverrides"]> = {};

  for (const [componentName, component] of Object.entries(resolvedStorybookTheme.light.components)) {
    const normalizedRootStyleOverrides = toThemeSxRecord(component.rootStyleOverrides);
    if (normalizedRootStyleOverrides) {
      c1StyleOverrides[componentName] = normalizedRootStyleOverrides;
    }
    if (componentName === "MuiCard") {
      const elevation = typeof component.defaultProps?.elevation === "number" ? component.defaultProps.elevation : undefined;
      const borderRadiusPx = parsePixelValue(
        typeof component.rootStyleOverrides?.borderRadius === "string" || typeof component.rootStyleOverrides?.borderRadius === "number"
          ? component.rootStyleOverrides.borderRadius
          : undefined
      );
      if (elevation !== undefined || borderRadiusPx !== undefined) {
        defaults.MuiCard = {
          ...(elevation !== undefined ? { elevation } : {}),
          ...(borderRadiusPx !== undefined ? { borderRadiusPx } : {})
        };
      }
      continue;
    }
    if (componentName === "MuiTextField") {
      const outlinedInputBorderRadiusPx = parsePixelValue(
        typeof component.rootStyleOverrides?.borderRadius === "string" || typeof component.rootStyleOverrides?.borderRadius === "number"
          ? component.rootStyleOverrides.borderRadius
          : undefined
      );
      if (outlinedInputBorderRadiusPx !== undefined) {
        defaults.MuiTextField = {
          outlinedInputBorderRadiusPx
        };
      }
      continue;
    }
    if (componentName === "MuiChip") {
      const borderRadiusPx = parsePixelValue(
        typeof component.rootStyleOverrides?.borderRadius === "string" || typeof component.rootStyleOverrides?.borderRadius === "number"
          ? component.rootStyleOverrides.borderRadius
          : undefined
      );
      const size =
        component.defaultProps?.size === "small" || component.defaultProps?.size === "medium"
          ? component.defaultProps.size
          : undefined;
      if (borderRadiusPx !== undefined || size !== undefined) {
        defaults.MuiChip = {
          ...(borderRadiusPx !== undefined ? { borderRadiusPx } : {}),
          ...(size !== undefined ? { size } : {})
        };
      }
      continue;
    }
    if (componentName === "MuiPaper") {
      const elevation = typeof component.defaultProps?.elevation === "number" ? component.defaultProps.elevation : undefined;
      if (elevation !== undefined) {
        defaults.MuiPaper = { elevation };
      }
      continue;
    }
    if (componentName === "MuiAppBar") {
      const backgroundColor = typeof component.rootStyleOverrides?.backgroundColor === "string" ? component.rootStyleOverrides.backgroundColor : undefined;
      if (backgroundColor) {
        defaults.MuiAppBar = { backgroundColor };
      }
      continue;
    }
    if (componentName === "MuiDivider") {
      const borderColor = typeof component.rootStyleOverrides?.borderColor === "string" ? component.rootStyleOverrides.borderColor : undefined;
      if (borderColor) {
        defaults.MuiDivider = { borderColor };
      }
      continue;
    }
    if (componentName === "MuiAvatar") {
      const widthPx = parsePixelValue(
        typeof component.rootStyleOverrides?.width === "string" || typeof component.rootStyleOverrides?.width === "number"
          ? component.rootStyleOverrides.width
          : undefined
      );
      const heightPx = parsePixelValue(
        typeof component.rootStyleOverrides?.height === "string" || typeof component.rootStyleOverrides?.height === "number"
          ? component.rootStyleOverrides.height
          : undefined
      );
      const borderRadiusPx = parsePixelValue(
        typeof component.rootStyleOverrides?.borderRadius === "string" || typeof component.rootStyleOverrides?.borderRadius === "number"
          ? component.rootStyleOverrides.borderRadius
          : undefined
      );
      if (widthPx !== undefined || heightPx !== undefined || borderRadiusPx !== undefined) {
        defaults.MuiAvatar = {
          ...(widthPx !== undefined ? { widthPx } : {}),
          ...(heightPx !== undefined ? { heightPx } : {}),
          ...(borderRadiusPx !== undefined ? { borderRadiusPx } : {})
        };
      }
      continue;
    }
  }

  if (Object.keys(c1StyleOverrides).length > 0) {
    defaults.c1StyleOverrides = c1StyleOverrides;
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
};

const ISSUE_693_SPECIALIZED_COMPONENT_KEYS = [
  "Alert",
  "DatePicker",
  "InputCurrency",
  "InputIBAN",
  "InputTAN",
  "DynamicTypography",
  "Typography"
] as const;

const toSpecializedComponentMapping = ({
  componentKey,
  mapping
}: {
  componentKey: string;
  mapping: DesignSystemConfig["mappings"][string] | undefined;
}): SpecializedComponentMapping | undefined => {
  if (!mapping?.import || !mapping.component.trim()) {
    return undefined;
  }

  const localName = mapping.component.trim();
  return {
    componentKey,
    modulePath: mapping.import,
    localName,
    ...(mapping.export ? { importedName: mapping.export } : {}),
    propMappings: { ...(mapping.propMappings ?? {}) },
    omittedProps: new Set(mapping.omittedProps ?? []),
    defaultProps: { ...(mapping.defaultProps ?? {}) }
  };
};

const toIssue693SpecializedComponentMappings = ({
  designSystemConfig
}: {
  designSystemConfig: DesignSystemConfig | undefined;
}): Partial<Record<(typeof ISSUE_693_SPECIALIZED_COMPONENT_KEYS)[number], SpecializedComponentMapping>> => {
  if (!designSystemConfig) {
    return {};
  }

  const entries = ISSUE_693_SPECIALIZED_COMPONENT_KEYS
    .map((componentKey) => {
      const mapping = toSpecializedComponentMapping({
        componentKey,
        mapping: designSystemConfig.mappings[componentKey]
      });
      return mapping ? ([componentKey, mapping] as const) : undefined;
    })
    .filter(
      (
        entry
      ): entry is readonly [
        (typeof ISSUE_693_SPECIALIZED_COMPONENT_KEYS)[number],
        SpecializedComponentMapping
      ] => entry !== undefined
    );

  return Object.fromEntries(entries);
};

const toDatePickerProviderConfig = ({
  customerProfile
}: {
  customerProfile: ResolvedCustomerProfile | undefined;
}): DatePickerProviderConfig | undefined => {
  if (!customerProfile) {
    return undefined;
  }
  const provider = resolveCustomerProfileDatePickerProvider({
    profile: customerProfile
  });
  if (!provider) {
    return undefined;
  }
  return {
    modulePath: provider.package,
    importedName: provider.exportName,
    localName: provider.localName,
    props: { ...provider.props } as Record<string, PrimitiveJsxPropValue>,
    ...(provider.adapter
      ? {
          adapter: {
            modulePath: provider.adapter.package,
            importedName: provider.adapter.exportName,
            localName: provider.adapter.localName,
            propName: provider.adapter.propName
          }
        }
      : {})
  };
};

const runGenerateArtifactsBasePhase = async ({
  projectDir,
  ir,
  resolvedStorybookTheme,
  iconMapFilePath,
  resolvedGenerationLocale,
  runtimeAdapters,
  generatedPaths,
  onLog
}: {
  projectDir: string;
  ir: DesignIR;
  resolvedStorybookTheme?: ResolvedStorybookTheme;
  iconMapFilePath: string;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  generatedPaths: Set<string>;
  onLog: (message: string) => void;
}): Promise<GenerateArtifactsBasePhase> => {
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "screens"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "components"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "context"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "theme"));
  const iconResolver = await runtimeAdapters.loadIconResolver({
    iconMapFilePath,
    onLog
  });
  const themeComponentDefaults = resolvedStorybookTheme
    ? toThemeComponentDefaultsFromResolvedStorybookTheme({
        resolvedStorybookTheme
      })
    : deriveThemeComponentDefaultsFromIr({
        ir,
        generationLocale: resolvedGenerationLocale.locale
      });
  const tokensContent = JSON.stringify(resolvedStorybookTheme?.tokensDocument ?? ir.tokens, null, 2);
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "src", "theme", "tokens.json"),
    content: tokensContent
  });
  generatedPaths.add("src/theme/tokens.json");
  const deterministicTheme = resolvedStorybookTheme
    ? storybookThemeFile({
        resolvedTheme: resolvedStorybookTheme,
        generationLocale: resolvedGenerationLocale.locale
      })
    : fallbackThemeFile(ir, themeComponentDefaults, resolvedGenerationLocale.locale);
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicTheme);
  generatedPaths.add(deterministicTheme.path);
  const deterministicErrorBoundary = makeErrorBoundaryFile();
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicErrorBoundary);
  generatedPaths.add(deterministicErrorBoundary.path);
  const deterministicScreenSkeleton = makeScreenSkeletonFile();
  await runtimeAdapters.writeGeneratedFile(projectDir, deterministicScreenSkeleton);
  generatedPaths.add(deterministicScreenSkeleton.path);
  const themeFiles: StreamingArtifactFile[] = [
    { path: "src/theme/tokens.json", content: tokensContent },
    { path: deterministicTheme.path, content: deterministicTheme.content },
    { path: deterministicErrorBoundary.path, content: deterministicErrorBoundary.content },
    { path: deterministicScreenSkeleton.path, content: deterministicScreenSkeleton.content }
  ];
  return {
    iconResolver,
    themeComponentDefaults,
    themeFiles
  };
};

interface AppShellArtifactIdentity {
  appShellId: string;
  componentName: string;
  filePath: string;
}

const normalizeRelativeImportPath = ({ fromFilePath, toFilePath }: { fromFilePath: string; toFilePath: string }): string => {
  const relativePath = path.relative(path.dirname(fromFilePath), toFilePath).replace(/\\/g, "/");
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  return withoutExtension.startsWith(".") ? withoutExtension : `./${withoutExtension}`;
};

/**
 * Assigns deterministic `AppShell1`, `AppShell2`, ... component names based on
 * the sorted appShell ids. Names are stable for a fixed input set but are NOT
 * stable across additions — inserting a new shell whose id sorts before an
 * existing shell will renumber subsequent shells. Consumers MUST re-import via
 * the generated manifest; do not hard-code `AppShellN` names in downstream code.
 */
const buildAppShellArtifactIdentities = (appShells: readonly AppShellIR[] | undefined): Map<string, AppShellArtifactIdentity> => {
  if (!appShells || appShells.length === 0) {
    return new Map<string, AppShellArtifactIdentity>();
  }

  return new Map(
    [...appShells]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((appShell, index) => {
        const componentName = `AppShell${index + 1}`;
        return [
          appShell.id,
          {
            appShellId: appShell.id,
            componentName,
            filePath: `src/components/${componentName}.tsx`
          } satisfies AppShellArtifactIdentity
        ] as const;
      })
  );
};

// NOTE: runGenerateArtifactsScreenPhase and persistGenerateArtifactsScreenPhase
// were removed in issue #312 — their logic is now inlined inside the streaming
// generator (generateArtifactsStreaming) to enable per-screen file writes.

const appendGenerateArtifactsMappingWarnings = ({
  mappingByNodeId,
  allIrNodeIds,
  usedMappingNodeIds,
  mappingWarnings
}: {
  mappingByNodeId: Map<string, ComponentMappingRule>;
  allIrNodeIds: Set<string>;
  usedMappingNodeIds: Set<string>;
  mappingWarnings: ComponentMappingWarning[];
}): void => {
  for (const [nodeId, mapping] of mappingByNodeId.entries()) {
    if (!allIrNodeIds.has(nodeId)) {
      continue;
    }
    if (!mapping.enabled) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_DISABLED",
        message: `Component mapping disabled for node '${nodeId}', deterministic fallback used`
      });
      continue;
    }
    if (!mapping.componentName.trim() || !mapping.importPath.trim()) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping for node '${nodeId}' is missing componentName/importPath, deterministic fallback used`
      });
      continue;
    }
    if (mapping.propContract !== undefined && !isPlainRecord(mapping.propContract)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_CONTRACT_MISMATCH",
        message: `Component mapping contract for node '${nodeId}' is not an object, deterministic fallback used`
      });
      continue;
    }
    if (!usedMappingNodeIds.has(nodeId)) {
      mappingWarnings.push({
        code: "W_COMPONENT_MAPPING_MISSING",
        message: `Component mapping for node '${nodeId}' was not applied; deterministic fallback used`
      });
    }
  }
};

// ---------------------------------------------------------------------------
// generateArtifactsStreaming — async generator that yields files as they're
// completed, enabling O(1)-per-screen memory and real-time progress feedback.
// See issue #312 for the design rationale.
// ---------------------------------------------------------------------------

export async function* generateArtifactsStreaming(
  input: GenerateArtifactsInput
): AsyncGenerator<StreamingArtifactEvent, GenerateArtifactsResult> {
  const irValidation = validateDesignIR(input.ir);
  if (!irValidation.valid) {
    throw new WorkflowError({
      code: "E_IR_VALIDATION",
      message: `IR validation failed: ${irValidation.errors.map((e) => e.message).join("; ")}`
    });
  }
  const {
    projectDir,
    ir,
    componentMappings,
    initialMappingWarnings,
    customerProfile,
    customerProfileDesignSystemConfig,
    customerProfileDesignSystemConfigSource,
    storybookFirstIconLookup,
    resolvedStorybookTheme,
    iconMapFilePath = path.join(projectDir, ICON_FALLBACK_FILE_NAME),
    designSystemFilePath = getDefaultDesignSystemConfigPath({ outputRoot: projectDir }),
    imageAssetMap = {},
    generationLocale,
    routerMode,
    formHandlingMode,
    llmModelName,
    llmCodegenMode,
    onLog
  } = input;
  const {
    runtimeAdapters,
    resolvedGenerationLocale,
    resolvedFormHandlingMode,
    transformGeneratedFileWithDesignSystem,
    effectiveCustomerProfileDesignSystemConfig,
    designSystemConfig
  } = await resolveGenerateArtifactsPhase({
    input,
    generationLocale,
    formHandlingMode,
    llmModelName,
    llmCodegenMode,
    designSystemFilePath,
    customerProfile: customerProfile ?? input.context?.config.customerProfile,
    customerProfileDesignSystemConfig,
    ...(customerProfileDesignSystemConfigSource ? { customerProfileDesignSystemConfigSource } : {}),
    onLog
  });
  const {
    generatedPaths,
    generationMetrics,
    truncationByScreenId,
    allIrNodeIds,
    mappingByNodeId,
    mappingWarnings
  } = initializeGenerateArtifactsStatePhase({
    ir,
    componentMappings,
    ...(initialMappingWarnings ? { initialMappingWarnings } : {})
  });

  // ── Phase 1: Theme & shared base files (yield immediately) ────────────
  const { iconResolver, themeComponentDefaults, themeFiles } = await runGenerateArtifactsBasePhase({
    projectDir,
    ir,
    ...(resolvedStorybookTheme ? { resolvedStorybookTheme } : {}),
    iconMapFilePath,
    resolvedGenerationLocale,
    runtimeAdapters,
    generatedPaths,
    onLog
  });

  yield { type: "theme", files: themeFiles };

  // ── Phase 2: Per-screen generation in parallel batches ────────────────
  const emittedScreenResolution = resolveEmittedScreenTargets({ ir });
  const identitiesByScreenId = emittedScreenResolution.emittedIdentitiesByScreenId;
  const screenById = new Map(ir.screens.map((screen) => [screen.id, screen] as const));
  const routePathByScreenId = new Map(
    Array.from(emittedScreenResolution.rawIdentitiesByScreenId.entries()).map(([screenId, identity]) => [screenId, identity.routePath] as const)
  );
  const appShellIdentities = buildAppShellArtifactIdentities(ir.appShells);
  const appShellById = new Map((ir.appShells ?? []).map((appShell) => [appShell.id, appShell] as const));
  const usedMappingNodeIds = new Set<string>();
  const screenMappingWarnings: ComponentMappingWarning[] = [];
  const iconWarnings: IconRenderWarning[] = [];
  const accessibilityWarnings: AccessibilityWarning[] = [];
  const simplificationByScreen: ScreenSimplificationMetric[] = [];
  const aggregatedSimplificationStats = createEmptySimplificationStats();
  let prototypeNavigationRenderedCount = 0;
  const designSystemMappedMuiComponents = new Set(Object.keys(designSystemConfig?.mappings ?? {}));
  const specializedComponentMappings = toIssue693SpecializedComponentMappings({
    designSystemConfig: effectiveCustomerProfileDesignSystemConfig
  });
  const datePickerProvider = toDatePickerProviderConfig({
    customerProfile
  });
  const muiFallbackDeniedSemanticKeys = (() => {
    if (!customerProfile) {
      return undefined;
    }
    const denied = new Set<string>();
    for (const semanticKey of ["DatePicker", "InputCurrency", "InputIBAN", "InputTAN"] as const) {
      if (!isCustomerProfileMuiFallbackAllowed({ profile: customerProfile, componentKey: semanticKey })) {
        denied.add(semanticKey);
      }
    }
    return denied.size > 0 ? denied : undefined;
  })();
  const storybookTypographyVariants = resolvedStorybookTheme?.light.typography.variants;

  for (const [appShellId, identity] of appShellIdentities) {
    const appShell = appShellById.get(appShellId);
    const sourceScreen = appShell ? screenById.get(appShell.sourceScreenId) : undefined;
    if (!appShell || !sourceScreen) {
      continue;
    }

    const shellNodeIds = new Set(appShell.shellNodeIds);
    const shellScreen = {
      ...sourceScreen,
      children: sourceScreen.children.filter((child) => shellNodeIds.has(child.id))
    };
    const deterministicAppShell = appShellFile({
      screen: shellScreen,
      mappingByNodeId,
      spacingBase: ir.tokens.spacingBase,
      tokens: ir.tokens,
      iconResolver,
      imageAssetMap,
      routePathByScreenId,
      ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
      generationLocale: resolvedGenerationLocale.locale,
      formHandlingMode: resolvedFormHandlingMode,
      ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
      ...(datePickerProvider ? { datePickerProvider } : {}),
      ...(muiFallbackDeniedSemanticKeys ? { muiFallbackDeniedSemanticKeys } : {}),
      ...(Object.keys(specializedComponentMappings).length > 0
        ? { specializedComponentMappings }
        : {}),
      ...(storybookTypographyVariants && Object.keys(storybookTypographyVariants).length > 0
        ? { storybookTypographyVariants }
        : {}),
      ...(designSystemMappedMuiComponents.size > 0
        ? { disallowedStyledRootMuiComponents: designSystemMappedMuiComponents }
        : {}),
      componentNameOverride: identity.componentName,
      filePathOverride: identity.filePath,
      enablePatternExtraction: false
    });

    for (const nodeId of deterministicAppShell.usedMappingNodeIds.values()) {
      usedMappingNodeIds.add(nodeId);
    }
    for (const warning of deterministicAppShell.mappingWarnings) {
      screenMappingWarnings.push({ code: warning.code, message: warning.message });
    }
    iconWarnings.push(...deterministicAppShell.iconWarnings);
    accessibilityWarnings.push(...deterministicAppShell.accessibilityWarnings);

    const appShellFileArtifact = transformGeneratedFileWithDesignSystem(deterministicAppShell.file);
    const componentFiles = deterministicAppShell.componentFiles.map((file) =>
      transformGeneratedFileWithDesignSystem(file)
    );
    const allAppShellFiles = [appShellFileArtifact, ...componentFiles, ...deterministicAppShell.contextFiles];

    await Promise.all(
      allAppShellFiles.map(async (file) => {
        await runtimeAdapters.writeGeneratedFile(projectDir, file);
        generatedPaths.add(file.path);
      })
    );
  }

  const screenBatches = chunk(emittedScreenResolution.emittedTargets, STREAMING_SCREEN_BATCH_SIZE);
  let screenIndex = 0;

  for (const batch of screenBatches) {
    const batchResults = batch.map((target) => {
      const screen = target.screen;
      const identity = identitiesByScreenId.get(screen.id);
      const screenAppShell = screen.appShell;
      const appShellIdentity = screenAppShell ? appShellIdentities.get(screenAppShell.id) : undefined;
      const truncationMetric = truncationByScreenId.get(screen.id);
      if (truncationMetric) {
        onLog(
          `Screen '${screen.name}' truncated from ${truncationMetric.originalElements} to ${truncationMetric.retainedElements} elements (budget=${truncationMetric.budget}).`
        );
      }
      const baseScreenFileInput = {
        mappingByNodeId,
        spacingBase: ir.tokens.spacingBase,
        tokens: ir.tokens,
        iconResolver,
        imageAssetMap,
        routePathByScreenId,
        ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
        generationLocale: resolvedGenerationLocale.locale,
        formHandlingMode: resolvedFormHandlingMode,
        ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
        ...(datePickerProvider ? { datePickerProvider } : {}),
        ...(muiFallbackDeniedSemanticKeys ? { muiFallbackDeniedSemanticKeys } : {}),
        ...(Object.keys(specializedComponentMappings).length > 0
          ? { specializedComponentMappings }
          : {}),
        ...(storybookTypographyVariants && Object.keys(storybookTypographyVariants).length > 0
          ? { storybookTypographyVariants }
          : {}),
        ...(designSystemMappedMuiComponents.size > 0
          ? { disallowedStyledRootMuiComponents: designSystemMappedMuiComponents }
          : {}),
        ...(identity?.componentName ? { componentNameOverride: identity.componentName } : {}),
        ...(identity?.filePath ? { filePathOverride: identity.filePath } : {}),
        ...(truncationMetric ? { truncationMetric } : {})
      };
      const deterministicScreen =
        target.family && identity?.filePath
          ? statefulVariantScreenFile({
              screen,
              family: target.family,
              scenarioScreensById: screenById,
              ...baseScreenFileInput,
              ...(appShellIdentity && identity.filePath
                ? {
                    appShellComponentName: appShellIdentity.componentName,
                    appShellImportPath: normalizeRelativeImportPath({
                      fromFilePath: identity.filePath,
                      toFilePath: appShellIdentity.filePath
                    })
                  }
                : {})
            })
          : screenAppShell && appShellIdentity && identity?.filePath
          ? wrappedFallbackScreenFile({
              screen: {
                ...screen,
                children: screen.children.filter((child) => screenAppShell.contentNodeIds.includes(child.id))
              },
              ...baseScreenFileInput,
              appShellComponentName: appShellIdentity.componentName,
              appShellImportPath: normalizeRelativeImportPath({
                fromFilePath: identity.filePath,
                toFilePath: appShellIdentity.filePath
              })
            })
          : fallbackScreenFile({
              screen,
              ...baseScreenFileInput
            });
      return { screen, deterministicScreen };
    });

    for (const { screen, deterministicScreen } of batchResults) {
      accumulateSimplificationStats({
        target: aggregatedSimplificationStats,
        source: deterministicScreen.simplificationStats
      });
      simplificationByScreen.push({
        screenId: screen.id,
        screenName: screen.name,
        ...deterministicScreen.simplificationStats
      });
      prototypeNavigationRenderedCount += deterministicScreen.prototypeNavigationRenderedCount;
      for (const nodeId of deterministicScreen.usedMappingNodeIds.values()) {
        usedMappingNodeIds.add(nodeId);
      }
      for (const warning of deterministicScreen.mappingWarnings) {
        screenMappingWarnings.push({ code: warning.code, message: warning.message });
      }
      iconWarnings.push(...deterministicScreen.iconWarnings);
      accessibilityWarnings.push(...deterministicScreen.accessibilityWarnings);

      const screenFile = transformGeneratedFileWithDesignSystem(deterministicScreen.file);
      const componentFiles = deterministicScreen.componentFiles.map((file) =>
        transformGeneratedFileWithDesignSystem(file)
      );
      const allScreenFiles = [screenFile, ...componentFiles, ...deterministicScreen.contextFiles, ...deterministicScreen.testFiles];

      // Write files for this screen immediately
      await Promise.all(
        allScreenFiles.map(async (file) => {
          await runtimeAdapters.writeGeneratedFile(projectDir, file);
          generatedPaths.add(file.path);
        })
      );

      yield {
        type: "screen",
        screenName: screen.name,
        files: allScreenFiles.map((f) => ({ path: f.path, content: f.content }))
      };

      screenIndex++;
      yield {
        type: "progress",
        screenIndex,
        screenCount: emittedScreenResolution.emittedTargets.length,
        screenName: screen.name
      };
    }
  }

  mappingWarnings.push(...screenMappingWarnings);
  appendGenerateArtifactsMappingWarnings({
    mappingByNodeId,
    allIrNodeIds,
    usedMappingNodeIds,
    mappingWarnings
  });

  // ── Phase 3: App.tsx (depends on all screen routes) ───────────────────
  const appContent = makeAppFile({
    screens: emittedScreenResolution.emittedScreens,
    identitiesByScreenId,
    routeEntries: emittedScreenResolution.routeEntries,
    ...(routerMode !== undefined ? { routerMode } : {}),
    includeThemeModeToggle: resolvedStorybookTheme?.includeThemeModeToggle ?? (ir.themeAnalysis?.darkModeDetected ?? true)
  });
  const appFile = transformGeneratedFileWithDesignSystem({
    path: "src/App.tsx",
    content: appContent
  });
  await runtimeAdapters.writeGeneratedFile(projectDir, appFile);
  generatedPaths.add(appFile.path);
  yield { type: "app", file: appFile };

  // ── Phase 4: Metrics ──────────────────────────────────────────────────
  generationMetrics.prototypeNavigationRendered = prototypeNavigationRenderedCount;
  generationMetrics.simplification = {
    aggregate: aggregatedSimplificationStats,
    screens: simplificationByScreen
  };
  const generationMetricsPayload = {
    ...generationMetrics,
    accessibilityWarnings
  };
  const metricsContent = `${JSON.stringify(generationMetricsPayload, null, 2)}\n`;
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "generation-metrics.json"),
    content: metricsContent
  });
  generatedPaths.add("generation-metrics.json");
  yield { type: "metrics", file: { path: "generation-metrics.json", content: metricsContent } };

  // ── Log summary ───────────────────────────────────────────────────────
  if (generationMetrics.degradedGeometryNodes.length > 0) {
    onLog(`Geometry degraded for ${generationMetrics.degradedGeometryNodes.length} node(s) during staged fetch.`);
  }
  if ((generationMetrics.prototypeNavigationDetected ?? 0) > 0 || (generationMetrics.prototypeNavigationRendered ?? 0) > 0) {
    onLog(
      `Prototype navigation: detected=${generationMetrics.prototypeNavigationDetected ?? 0}, resolved=${
        generationMetrics.prototypeNavigationResolved ?? 0
      }, unresolved=${generationMetrics.prototypeNavigationUnresolved ?? 0}, rendered=${generationMetrics.prototypeNavigationRendered ?? 0}`
    );
  }
  if ((generationMetrics.prototypeNavigationUnresolved ?? 0) > 0) {
    onLog(
      `Warning: ${generationMetrics.prototypeNavigationUnresolved} prototype navigation target(s) were unresolved and ignored.`
    );
  }
  onLog(
    `Simplify stats: removedEmptyNodes=${aggregatedSimplificationStats.removedEmptyNodes}, promotedSingleChild=${aggregatedSimplificationStats.promotedSingleChild}, promotedGroupMultiChild=${aggregatedSimplificationStats.promotedGroupMultiChild}, spacingMerges=${aggregatedSimplificationStats.spacingMerges}, guardedSkips=${aggregatedSimplificationStats.guardedSkips}`
  );
  if (accessibilityWarnings.length > 0) {
    for (const warning of accessibilityWarnings) {
      onLog(`[a11y] ${warning.message}`);
    }
    onLog(`Accessibility warnings: ${accessibilityWarnings.length} potential contrast issue(s).`);
  }
  if (iconWarnings.length > 0) {
    for (const warning of iconWarnings) {
      onLog(`[icon] ${warning.message}`);
    }
  }

  onLog("Generated deterministic baseline artifacts (streaming)");

  const dedupedMappingWarnings = dedupeMappingWarnings(mappingWarnings);
  const dedupedIconWarnings = dedupeIconWarnings(iconWarnings);
  onLog("LLM enhancement disabled in deterministic mode; deterministic output retained");
  return {
    generatedPaths: Array.from(generatedPaths),
    generationMetrics,
    themeApplied: false,
    screenApplied: 0,
    screenTotal: emittedScreenResolution.emittedTargets.length,
    screenRejected: [],
    llmWarnings: [],
    mappingCoverage: {
      usedMappings: usedMappingNodeIds.size,
      fallbackNodes: Math.max(0, mappingByNodeId.size - usedMappingNodeIds.size),
      totalCandidateNodes: mappingByNodeId.size
    },
    mappingDiagnostics: {
      missingMappingCount: dedupedMappingWarnings.filter((w) => w.code === "W_COMPONENT_MAPPING_MISSING").length,
      contractMismatchCount: dedupedMappingWarnings.filter((w) => w.code === "W_COMPONENT_MAPPING_CONTRACT_MISMATCH").length,
      disabledMappingCount: dedupedMappingWarnings.filter((w) => w.code === "W_COMPONENT_MAPPING_DISABLED").length,
      broadPatternCount: dedupedMappingWarnings.filter((w) => w.code === "W_COMPONENT_MAPPING_BROAD_PATTERN").length
    },
    mappingWarnings: dedupedMappingWarnings,
    iconWarnings: dedupedIconWarnings
  };
}

// ---------------------------------------------------------------------------
// generateArtifacts — backward-compatible batch wrapper that consumes the
// streaming generator and returns the final result.
// ---------------------------------------------------------------------------

export const generateArtifacts = async (input: GenerateArtifactsInput): Promise<GenerateArtifactsResult> => {
  const generator = generateArtifactsStreaming(input);
  let iterResult = await generator.next();
  while (!iterResult.done) {
    iterResult = await generator.next();
  }
  return iterResult.value;
};
