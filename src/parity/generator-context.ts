import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type {
  ComponentMappingRule,
  DesignIR,
  GeneratedFile,
  GenerationMetrics,
  LlmCodegenMode,
  ScreenElementIR,
  SimplificationMetrics,
  ScreenSimplificationMetric
} from "./types.js";
import type { WorkspaceFormHandlingMode, WorkspaceRouterMode } from "../contracts/index.js";
import { resolveGenerationLocale } from "../generation-locale.js";
import {
  applyDesignSystemMappingsToGeneratedTsx,
  getDefaultDesignSystemConfigPath,
  loadDesignSystemConfigFile
} from "../design-system.js";
import type { ResolvedCustomerProfile } from "../customer-profile.js";
import type { ThemeComponentDefaults } from "./generator-design-system.js";
import type { AccessibilityWarning } from "./generator-a11y.js";
import type { ScreenArtifactIdentity } from "./generator-artifacts.js";
import { resolveFormHandlingMode } from "./generator-templates.js";
import { loadIconFallbackResolver, ICON_FALLBACK_FILE_NAME } from "./generator-core.js";
import type { IconFallbackResolver } from "./generator-core.js";

// ---------------------------------------------------------------------------
// Runtime adapters – injectable I/O boundaries
// ---------------------------------------------------------------------------

type LoadedDesignSystemConfig = Awaited<ReturnType<typeof loadDesignSystemConfigFile>>;
type ApplyDesignSystemMappingsInput = Parameters<typeof applyDesignSystemMappingsToGeneratedTsx>[0];

export interface GenerateArtifactsRuntimeAdapters {
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

// ---------------------------------------------------------------------------
// Generator configuration — immutable for a single generation run
// ---------------------------------------------------------------------------

export interface GeneratorConfig {
  readonly projectDir: string;
  readonly ir: DesignIR;
  readonly componentMappings: ComponentMappingRule[];
  readonly customerProfile: ResolvedCustomerProfile | undefined;
  readonly iconMapFilePath: string;
  readonly designSystemFilePath: string;
  readonly imageAssetMap: Record<string, string>;
  readonly generationLocale: string;
  readonly routerMode: WorkspaceRouterMode | undefined;
  readonly formHandlingMode: WorkspaceFormHandlingMode;
  readonly llmModelName: string;
  readonly llmCodegenMode: LlmCodegenMode;
  readonly onLog: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Metrics & warning accumulators — mutable across phases
// ---------------------------------------------------------------------------

export interface MetricsAccumulator {
  generationMetrics: GenerationMetrics;
  simplificationByScreen: ScreenSimplificationMetric[];
  aggregatedSimplificationStats: SimplificationMetrics;
  prototypeNavigationRenderedCount: number;
}

export interface WarningCollector {
  mappingWarnings: Array<{
    code: "W_COMPONENT_MAPPING_MISSING" | "W_COMPONENT_MAPPING_CONTRACT_MISMATCH" | "W_COMPONENT_MAPPING_DISABLED";
    message: string;
  }>;
  accessibilityWarnings: AccessibilityWarning[];
}

// ---------------------------------------------------------------------------
// GeneratorContext — unified context for a single generation run
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  /** Immutable configuration resolved at the start of a run. */
  readonly config: GeneratorConfig;

  /** Injectable I/O adapters (file system, design system, icon resolver). */
  readonly runtimeAdapters: GenerateArtifactsRuntimeAdapters;

  /** Resolved form handling mode. */
  readonly resolvedFormHandlingMode: WorkspaceFormHandlingMode;

  /** Design system file transformer. */
  readonly transformGeneratedFileWithDesignSystem: (file: GeneratedFile) => GeneratedFile;

  /** Component mapping index, keyed by node ID. */
  readonly mappingByNodeId: Map<string, ComponentMappingRule>;

  /** All IR node IDs (for mapping coverage analysis). */
  readonly allIrNodeIds: Set<string>;

  /** Set of generated file paths — grows across phases. */
  readonly generatedPaths: Set<string>;

  /** Loaded icon fallback resolver (populated after base phase). */
  iconResolver: IconFallbackResolver | undefined;

  /** Derived theme component defaults (populated after base phase). */
  themeComponentDefaults: ThemeComponentDefaults | undefined;

  /** Screen artifact identities (populated after screen phase). */
  identitiesByScreenId: Map<string, ScreenArtifactIdentity> | undefined;

  /** Used mapping node IDs (populated during screen phase). */
  readonly usedMappingNodeIds: Set<string>;

  /** Metrics accumulator — grows across phases. */
  readonly metrics: MetricsAccumulator;

  /** Warning collector — grows across phases. */
  readonly warnings: WarningCollector;
}

// ---------------------------------------------------------------------------
// Input type for createGeneratorContext
// ---------------------------------------------------------------------------

export interface CreateGeneratorContextInput {
  projectDir: string;
  ir: DesignIR;
  componentMappings?: ComponentMappingRule[];
  customerProfile?: ResolvedCustomerProfile;
  iconMapFilePath?: string;
  designSystemFilePath?: string;
  imageAssetMap?: Record<string, string>;
  generationLocale?: string;
  routerMode?: WorkspaceRouterMode;
  formHandlingMode?: WorkspaceFormHandlingMode;
  llmModelName: string;
  llmCodegenMode: LlmCodegenMode;
  onLog: (message: string) => void;
  runtimeAdapters?: Partial<GenerateArtifactsRuntimeAdapters>;
}

// ---------------------------------------------------------------------------
// Default runtime adapters
// ---------------------------------------------------------------------------

const writeGeneratedFileDefault = async (rootDir: string, file: GeneratedFile): Promise<void> => {
  const absolutePath = path.resolve(rootDir, file.path);
  const dir = path.dirname(absolutePath);
  await mkdir(dir, { recursive: true });
  await writeFile(absolutePath, file.content, "utf-8");
};

const DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS: GenerateArtifactsRuntimeAdapters = {
  mkdirRecursive: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  writeTextFile: async ({ filePath, content }) => {
    await writeFile(filePath, content, "utf-8");
  },
  writeGeneratedFile: async (rootDir, file) => {
    await writeGeneratedFileDefault(rootDir, file);
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

const resolveRuntimeAdapters = (
  partial: Partial<GenerateArtifactsRuntimeAdapters> | undefined
): GenerateArtifactsRuntimeAdapters => {
  if (!partial) {
    return DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS;
  }
  return {
    mkdirRecursive: partial.mkdirRecursive ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.mkdirRecursive,
    writeTextFile: partial.writeTextFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeTextFile,
    writeGeneratedFile: partial.writeGeneratedFile ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.writeGeneratedFile,
    loadDesignSystemConfig:
      partial.loadDesignSystemConfig ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadDesignSystemConfig,
    applyDesignSystemMappings:
      partial.applyDesignSystemMappings ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.applyDesignSystemMappings,
    loadIconResolver: partial.loadIconResolver ?? DEFAULT_GENERATE_ARTIFACTS_RUNTIME_ADAPTERS.loadIconResolver
  };
};

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export const createGeneratorContext = (input: CreateGeneratorContextInput): GeneratorContext => {
  const {
    projectDir,
    ir,
    componentMappings = [],
    customerProfile,
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

  const runtimeAdapters = resolveRuntimeAdapters(input.runtimeAdapters);

  const resolvedLocale = resolveGenerationLocale({
    requestedLocale: generationLocale
  });
  const resolvedFormHandlingMode = resolveFormHandlingMode({
    requestedMode: formHandlingMode
  });

  const config: GeneratorConfig = {
    projectDir,
    ir,
    componentMappings,
    customerProfile,
    iconMapFilePath,
    designSystemFilePath,
    imageAssetMap,
    generationLocale: resolvedLocale.locale,
    routerMode,
    formHandlingMode: resolvedFormHandlingMode,
    llmModelName,
    llmCodegenMode,
    onLog
  };

  // Build mapping index with priority-based deduplication
  const mappingByNodeId = new Map<string, ComponentMappingRule>();
  const sortedMappings = [...componentMappings].sort((left, right) => {
    const leftPriority = left.priority;
    const rightPriority = right.priority;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    const sourceOrder = (source: string | undefined): number =>
      source === "local_override" ? 0 : 1;
    const leftSourceOrder = sourceOrder(left.source);
    const rightSourceOrder = sourceOrder(right.source);
    if (leftSourceOrder !== rightSourceOrder) {
      return leftSourceOrder - rightSourceOrder;
    }
    return left.nodeId.localeCompare(right.nodeId);
  });
  for (const mapping of sortedMappings) {
    if (!mappingByNodeId.has(mapping.nodeId)) {
      mappingByNodeId.set(mapping.nodeId, mapping);
    }
  }

  // Collect all IR node IDs for mapping coverage analysis
  const allIrNodeIds = new Set<string>();
  const flattenNodeIds = (elements: ScreenElementIR[]): void => {
    for (const el of elements) {
      allIrNodeIds.add(el.id);
      if (el.children) {
        flattenNodeIds(el.children);
      }
    }
  };
  for (const screen of ir.screens) {
    flattenNodeIds(screen.children);
  }

  return {
    config,
    runtimeAdapters,
    resolvedFormHandlingMode,
    transformGeneratedFileWithDesignSystem: (file) => file,
    mappingByNodeId,
    allIrNodeIds,
    generatedPaths: new Set<string>(),
    iconResolver: undefined,
    themeComponentDefaults: undefined,
    identitiesByScreenId: undefined,
    usedMappingNodeIds: new Set<string>(),
    metrics: {
      generationMetrics: {
        fetchedNodes: ir.metrics?.fetchedNodes ?? 0,
        skippedHidden: ir.metrics?.skippedHidden ?? 0,
        skippedPlaceholders: ir.metrics?.skippedPlaceholders ?? 0,
        screenElementCounts: [...(ir.metrics?.screenElementCounts ?? [])],
        truncatedScreens: [...(ir.metrics?.truncatedScreens ?? [])],
        degradedGeometryNodes: [...(ir.metrics?.degradedGeometryNodes ?? [])],
        prototypeNavigationDetected: ir.metrics?.prototypeNavigationDetected ?? 0,
        prototypeNavigationResolved: ir.metrics?.prototypeNavigationResolved ?? 0,
        prototypeNavigationUnresolved: ir.metrics?.prototypeNavigationUnresolved ?? 0,
        prototypeNavigationRendered: 0,
        ...(ir.metrics?.nodeDiagnostics ? { nodeDiagnostics: [...ir.metrics.nodeDiagnostics] } : {}),
        ...(ir.metrics?.mcpCoverage ? { mcpCoverage: { ...ir.metrics.mcpCoverage } } : {})
      },
      simplificationByScreen: [],
      aggregatedSimplificationStats: {
        removedEmptyNodes: 0,
        promotedSingleChild: 0,
        promotedGroupMultiChild: 0,
        spacingMerges: 0,
        guardedSkips: 0
      },
      prototypeNavigationRenderedCount: 0
    },
    warnings: {
      mappingWarnings: [],
      accessibilityWarnings: []
    }
  };
};
