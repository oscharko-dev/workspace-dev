// ---------------------------------------------------------------------------
// generator-core.ts — Slim orchestrator for artifact generation
// Sub-modules: render, patterns, forms, interactive, sx, navigation
// See issue #297 for the decomposition rationale.
// ---------------------------------------------------------------------------
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComponentMappingRule,
  DesignIR,
  GenerationMetrics,
  GeneratedFile,
  LlmCodegenMode,
  ScreenSimplificationMetric,
  SimplificationMetrics
} from "./types.js";
import { validateDesignIR } from "./types.js";
import { WorkflowError } from "./workflow-error.js";
import { DEFAULT_GENERATION_LOCALE, resolveGenerationLocale } from "../generation-locale.js";
import {
  applyDesignSystemMappingsToGeneratedTsx,
  getDefaultDesignSystemConfigPath,
  loadDesignSystemConfigFile
} from "../design-system.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import { buildScreenArtifactIdentities } from "./generator-artifacts.js";
import { deriveThemeComponentDefaultsFromIr } from "./generator-design-system.js";
import type { ThemeComponentDefaults } from "./generator-design-system.js";
import {
  resolveFormHandlingMode,
  fallbackThemeFile,
  fallbackScreenFile,
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
  registerMuiImports,
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
  HeadingComponent,
  LandmarkRole,
  RgbaColor,
  SemanticIconModel,
  IconImportSpec,
  IconFallbackResolver,
  MappedImportSpec,
  ExtractedComponentImportSpec,
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
import type { IconFallbackResolver, ResolvedFormHandlingMode } from "./generator-render.js";
import type { GeneratorContext } from "./generator-context.js";
import type { AccessibilityWarning } from "./generator-a11y.js";

// ── Orchestrator code ─────────────────────────────────────────────────────

interface GenerateArtifactsInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
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
  };
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
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
  warnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>
): Array<{
  code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
  message: string;
}> => {
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
  designSystemConfig?: LoadedDesignSystemConfig;
}

const resolveGenerateArtifactsPhase = async ({
  input,
  generationLocale,
  formHandlingMode,
  llmModelName,
  llmCodegenMode,
  designSystemFilePath,
  onLog
}: {
  input: GenerateArtifactsInput;
  generationLocale: string | undefined;
  formHandlingMode: WorkspaceFormHandlingMode | undefined;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  designSystemFilePath: string;
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
  const designSystemConfig = await runtimeAdapters.loadDesignSystemConfig({
    designSystemFilePath,
    onLog
  });
  const transformGeneratedFileWithDesignSystem = (file: GeneratedFile): GeneratedFile => {
    if (!designSystemConfig) {
      return file;
    }
    const transformedContent = runtimeAdapters.applyDesignSystemMappings({
      filePath: file.path,
      content: file.content,
      config: designSystemConfig
    });
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
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
}

const initializeGenerateArtifactsStatePhase = ({
  ir,
  componentMappings
}: {
  ir: DesignIR;
  componentMappings: ComponentMappingRule[] | undefined;
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
    .filter((mapping) => mapping.nodeId.trim().length > 0)
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      if (left.source !== right.source) {
        return left.source === "local_override" ? -1 : 1;
      }
      return left.nodeId.localeCompare(right.nodeId);
    });
  const mappingByNodeId = new Map<string, ComponentMappingRule>();
  for (const mapping of prioritizedMappings) {
    if (!mappingByNodeId.has(mapping.nodeId)) {
      mappingByNodeId.set(mapping.nodeId, mapping);
    }
  }
  const mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }> = [];
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

const runGenerateArtifactsBasePhase = async ({
  projectDir,
  ir,
  iconMapFilePath,
  resolvedGenerationLocale,
  runtimeAdapters,
  generatedPaths,
  onLog
}: {
  projectDir: string;
  ir: DesignIR;
  iconMapFilePath: string;
  resolvedGenerationLocale: ReturnType<typeof resolveGenerationLocale>;
  runtimeAdapters: GenerateArtifactsRuntimeAdapters;
  generatedPaths: Set<string>;
  onLog: (message: string) => void;
}): Promise<GenerateArtifactsBasePhase> => {
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "screens"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "context"));
  await runtimeAdapters.mkdirRecursive(path.join(projectDir, "src", "theme"));
  const iconResolver = await runtimeAdapters.loadIconResolver({
    iconMapFilePath,
    onLog
  });
  const themeComponentDefaults = deriveThemeComponentDefaultsFromIr({
    ir,
    generationLocale: resolvedGenerationLocale.locale
  });
  const tokensContent = JSON.stringify(ir.tokens, null, 2);
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "src", "theme", "tokens.json"),
    content: tokensContent
  });
  generatedPaths.add("src/theme/tokens.json");
  const deterministicTheme = fallbackThemeFile(ir, themeComponentDefaults, resolvedGenerationLocale.locale);
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
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
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
    designSystemConfig
  } = await resolveGenerateArtifactsPhase({
    input,
    generationLocale,
    formHandlingMode,
    llmModelName,
    llmCodegenMode,
    designSystemFilePath,
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
    componentMappings
  });

  // ── Phase 1: Theme & shared base files (yield immediately) ────────────
  const { iconResolver, themeComponentDefaults, themeFiles } = await runGenerateArtifactsBasePhase({
    projectDir,
    ir,
    iconMapFilePath,
    resolvedGenerationLocale,
    runtimeAdapters,
    generatedPaths,
    onLog
  });

  yield { type: "theme", files: themeFiles };

  // ── Phase 2: Per-screen generation in parallel batches ────────────────
  const identitiesByScreenId = buildScreenArtifactIdentities(ir.screens);
  const routePathByScreenId = new Map(
    Array.from(identitiesByScreenId.entries()).map(([screenId, identity]) => [screenId, identity.routePath] as const)
  );
  const usedMappingNodeIds = new Set<string>();
  const screenMappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }> = [];
  const accessibilityWarnings: AccessibilityWarning[] = [];
  const simplificationByScreen: ScreenSimplificationMetric[] = [];
  const aggregatedSimplificationStats = createEmptySimplificationStats();
  let prototypeNavigationRenderedCount = 0;
  const designSystemMappedMuiComponents = new Set(Object.keys(designSystemConfig?.mappings ?? {}));

  const screenBatches = chunk(ir.screens, STREAMING_SCREEN_BATCH_SIZE);
  let screenIndex = 0;

  for (const batch of screenBatches) {
    const batchResults = batch.map((screen) => {
      const identity = identitiesByScreenId.get(screen.id);
      const truncationMetric = truncationByScreenId.get(screen.id);
      if (truncationMetric) {
        onLog(
          `Screen '${screen.name}' truncated from ${truncationMetric.originalElements} to ${truncationMetric.retainedElements} elements (budget=${truncationMetric.budget}).`
        );
      }
      const deterministicScreen = fallbackScreenFile({
        screen,
        mappingByNodeId,
        spacingBase: ir.tokens.spacingBase,
        tokens: ir.tokens,
        iconResolver,
        imageAssetMap,
        routePathByScreenId,
        generationLocale: resolvedGenerationLocale.locale,
        formHandlingMode: resolvedFormHandlingMode,
        ...(themeComponentDefaults ? { themeComponentDefaults } : {}),
        ...(designSystemMappedMuiComponents.size > 0
          ? { disallowedStyledRootMuiComponents: designSystemMappedMuiComponents }
          : {}),
        ...(identity?.componentName ? { componentNameOverride: identity.componentName } : {}),
        ...(identity?.filePath ? { filePathOverride: identity.filePath } : {}),
        ...(truncationMetric ? { truncationMetric } : {})
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
        screenCount: ir.screens.length,
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
    screens: ir.screens,
    identitiesByScreenId,
    ...(routerMode !== undefined ? { routerMode } : {}),
    includeThemeModeToggle: ir.themeAnalysis?.darkModeDetected ?? true
  });
  await runtimeAdapters.writeTextFile({
    filePath: path.join(projectDir, "src", "App.tsx"),
    content: appContent
  });
  generatedPaths.add("src/App.tsx");
  yield { type: "app", file: { path: "src/App.tsx", content: appContent } };

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

  onLog("Generated deterministic baseline artifacts (streaming)");

  const dedupedMappingWarnings = dedupeMappingWarnings(mappingWarnings);
  onLog("LLM enhancement disabled in deterministic mode; deterministic output retained");
  return {
    generatedPaths: Array.from(generatedPaths),
    generationMetrics,
    themeApplied: false,
    screenApplied: 0,
    screenTotal: ir.screens.length,
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
      disabledMappingCount: dedupedMappingWarnings.filter((w) => w.code === "W_COMPONENT_MAPPING_DISABLED").length
    },
    mappingWarnings: dedupedMappingWarnings
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
