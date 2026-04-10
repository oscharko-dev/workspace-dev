import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceJobInput } from "../src/contracts/index.js";
import type { WorkspaceJobStageName } from "../src/contracts/index.js";
import { createInitialStages, nowIso } from "../src/job-engine/stage-state.js";
import { resolveRuntimeSettings } from "../src/job-engine/runtime.js";
import { createTemplateCopyFilter } from "../src/job-engine/template-copy-filter.js";
import { StageArtifactStore } from "../src/job-engine/pipeline/artifact-store.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
  type StageRuntimeContext,
} from "../src/job-engine/pipeline/context.js";
import { FigmaSourceService } from "../src/job-engine/services/figma-source-service.js";
import { IrDeriveService } from "../src/job-engine/services/ir-derive-service.js";
import { TemplatePrepareService } from "../src/job-engine/services/template-prepare-service.js";
import { createCodegenGenerateService } from "../src/job-engine/services/codegen-generate-service.js";
import { createValidateProjectService } from "../src/job-engine/services/validate-project-service.js";
import type { JobRecord } from "../src/job-engine/types.js";
import { ensureTemplateValidationSeedNodeModules } from "../src/job-engine/test-validation-seed.js";
import {
  computeVisualBenchmarkAggregateScore,
  enumerateFixtureScreens,
  enumerateFixtureScreenViewports,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkFixturePaths,
  resolveVisualBenchmarkScreenViewportPaths,
  toScreenIdToken,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
  type VisualBenchmarkViewportSpec,
} from "./visual-benchmark.helpers.js";
import {
  applyVisualQualityConfigToReport,
  normalizeVisualQualityViewportWeights,
  resolveVisualQualityViewports,
  type VisualQualityConfig,
} from "./visual-quality-config.js";
import type { WorkspaceVisualQualityReport } from "../src/contracts/index.js";

const DEFAULT_WORKSPACE_ROOT = process.cwd();
export interface VisualBenchmarkExecutionOptions extends VisualBenchmarkFixtureOptions {
  allowIncompleteVisualQuality?: boolean;
  qualityConfig?: VisualQualityConfig;
  viewportId?: string;
  workspaceRoot?: string;
}

export interface VisualBenchmarkFixtureExecutionResult {
  fixtureId: string;
  score: number;
}

export interface VisualBenchmarkFixtureExecutionArtifacts extends VisualBenchmarkFixtureExecutionResult {
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
  };
}

export interface VisualBenchmarkScreenViewportArtifact {
  viewportId: string;
  viewportLabel?: string;
  score: number;
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
  };
}

export interface VisualBenchmarkFixtureScreenArtifact {
  screenId: string;
  screenName: string;
  nodeId: string;
  score: number;
  weight?: number;
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
  viewport: {
    width: number;
    height: number;
  };
  viewports?: VisualBenchmarkScreenViewportArtifact[];
}

export interface VisualBenchmarkFixtureRunResult {
  fixtureId: string;
  aggregateScore: number;
  screens: VisualBenchmarkFixtureScreenArtifact[];
}

interface VisualQualityFrozenReferenceOverride {
  imagePath: string;
  metadataPath: string;
}

const DEFAULT_MOBILE_DEVICE_SCALE_FACTOR = 3;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const cloneJsonValue = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const isWorkspaceVisualQualityReport = (
  value: unknown,
): value is WorkspaceVisualQualityReport => {
  return typeof value === "object" && value !== null && "status" in value;
};

const mergeOptionalRecords = (
  ...values: unknown[]
): Record<string, unknown> | undefined => {
  const merged: Record<string, unknown> = {};
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }
    Object.assign(merged, cloneJsonValue(value));
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const normalizeBenchmarkFigmaInput = ({
  fixtureId,
  figmaInput,
  metadata,
}: {
  fixtureId: string;
  figmaInput: unknown;
  metadata: VisualBenchmarkFixtureMetadata;
}): Record<string, unknown> => {
  if (!isRecord(figmaInput)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json must be an object.`,
    );
  }

  if (isRecord(figmaInput.document)) {
    return cloneJsonValue(figmaInput);
  }

  if (!isRecord(figmaInput.nodes)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json must expose either a top-level document or a nodes map.`,
    );
  }

  const nodeEntry = figmaInput.nodes[metadata.source.nodeId];
  if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json is missing node '${metadata.source.nodeId}' in nodes payload.`,
    );
  }

  const document = cloneJsonValue(nodeEntry.document);
  const components = mergeOptionalRecords(
    figmaInput.components,
    nodeEntry.components,
  );
  const componentSets = mergeOptionalRecords(
    figmaInput.componentSets,
    nodeEntry.componentSets,
  );
  const styles = mergeOptionalRecords(figmaInput.styles, nodeEntry.styles);

  return {
    ...(typeof figmaInput.editorType === "string"
      ? { editorType: figmaInput.editorType }
      : {}),
    ...(typeof figmaInput.lastModified === "string"
      ? { lastModified: figmaInput.lastModified }
      : {}),
    ...(typeof figmaInput.linkAccess === "string"
      ? { linkAccess: figmaInput.linkAccess }
      : {}),
    name: typeof figmaInput.name === "string" ? figmaInput.name : fixtureId,
    document: {
      id: `visual-benchmark-document-${fixtureId}`,
      type: "DOCUMENT",
      children: [
        {
          id: `visual-benchmark-canvas-${fixtureId}`,
          name: metadata.source.nodeName,
          type: "CANVAS",
          children: [document],
        },
      ],
    },
    ...(components ? { components } : {}),
    ...(componentSets ? { componentSets } : {}),
    ...(styles ? { styles } : {}),
  };
};

const createJobRecord = ({
  fixtureId,
  runtime,
  jobDir,
  figmaJsonPath,
  visualQualityViewportWidth,
  visualQualityViewportHeight,
  visualQualityDeviceScaleFactor,
}: {
  fixtureId: string;
  runtime: ReturnType<typeof resolveRuntimeSettings>;
  jobDir: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
  visualQualityViewportHeight: number;
  visualQualityDeviceScaleFactor: number;
}): JobRecord => {
  return {
    jobId: `visual-benchmark-${fixtureId}`,
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
      enableUiValidation: false,
      enableUnitTestValidation: false,
      installPreferOffline: true,
      skipInstall: false,
      enableGitPr: false,
      figmaSourceMode: "local_json",
      figmaJsonPath,
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: path.dirname(path.dirname(jobDir)),
      jobDir,
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
    },
  };
};

const createExecutionContext = async ({
  fixtureId,
  figmaJsonPath,
  visualQualityViewportWidth,
  visualQualityViewportHeight,
  visualQualityDeviceScaleFactor,
  workspaceRoot,
}: {
  fixtureId: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
  visualQualityViewportHeight: number;
  visualQualityDeviceScaleFactor: number;
  workspaceRoot: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  rootDir: string;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}> => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-visual-benchmark-${fixtureId}-`),
  );
  const jobsRoot = path.join(rootDir, "jobs");
  const jobDir = path.join(jobsRoot, fixtureId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });
  const templateRoot = path.join(workspaceRoot, "template", "react-mui-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    exportImages: false,
    installPreferOffline: true,
    skipInstall: false,
    enableUiValidation: false,
    enableVisualQualityValidation: true,
    visualQualityReferenceMode: "frozen_fixture",
    visualQualityViewportWidth,
    visualQualityViewportHeight,
    visualQualityDeviceScaleFactor,
    enableUnitTestValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
  });

  const artifactStore = new StageArtifactStore({ jobDir });
  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job: createJobRecord({
      fixtureId,
      runtime,
      jobDir,
      figmaJsonPath,
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
    }),
    input: {
      figmaSourceMode: "local_json",
      figmaJsonPath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
      visualQualityViewportHeight,
      visualQualityDeviceScaleFactor,
    },
    runtime,
    resolvedPaths: {
      workspaceRoot,
      outputRoot: rootDir,
      jobsRoot,
      reprosRoot: path.join(rootDir, "repros"),
    },
    resolvedWorkspaceRoot: workspaceRoot,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: runtime.fetchImpl,
    paths: {
      jobDir,
      generatedProjectDir,
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir: path.join(rootDir, "repros", fixtureId),
      iconMapFilePath: path.join(rootDir, "icon-map.json"),
      designSystemFilePath: path.join(rootDir, "design-system.json"),
      irCacheDir: path.join(rootDir, "cache", "ir"),
      templateRoot,
      templateCopyFilter: createTemplateCopyFilter({ templateRoot }),
    },
    artifactStore,
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // Benchmark execution does not persist diagnostics outside the temp job.
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // Benchmark execution stays local to the runner.
    },
  };

  return {
    executionContext,
    rootDir,
    stageContextFor: (stage) =>
      createStageRuntimeContext({ executionContext, stage }),
  };
};

const resolveViewportDeviceScaleFactor = (
  viewport: VisualBenchmarkViewportSpec,
): number => {
  if (viewport.deviceScaleFactor !== undefined) {
    return viewport.deviceScaleFactor;
  }
  return viewport.id === "mobile" ? DEFAULT_MOBILE_DEVICE_SCALE_FACTOR : 1;
};

const selectScreenViewports = ({
  fixtureId,
  screen,
  resolvedViewports,
  selectedViewportId,
}: {
  fixtureId: string;
  screen: VisualBenchmarkFixtureScreenMetadata;
  resolvedViewports: readonly VisualBenchmarkViewportSpec[];
  selectedViewportId: string | undefined;
}): VisualBenchmarkViewportSpec[] => {
  if (selectedViewportId === undefined) {
    return [...resolvedViewports];
  }
  const selectedViewport = resolvedViewports.find(
    (viewport) => viewport.id === selectedViewportId,
  );
  if (selectedViewport === undefined) {
    const availableViewportIds = resolvedViewports.map((viewport) => viewport.id);
    throw new Error(
      `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' does not define viewport '${selectedViewportId}'. Available viewports: ${availableViewportIds.join(", ")}.`,
    );
  }
  return [selectedViewport];
};

const computeAggregateFromViewportArtifacts = ({
  viewportSpecs,
  viewportArtifacts,
}: {
  viewportSpecs: readonly VisualBenchmarkViewportSpec[];
  viewportArtifacts: readonly VisualBenchmarkScreenViewportArtifact[];
}): number => {
  if (viewportArtifacts.length === 0) {
    throw new Error(
      "computeAggregateFromViewportArtifacts requires at least one viewport result.",
    );
  }
  if (viewportArtifacts.length === 1) {
    return viewportArtifacts[0]!.score;
  }

  const normalizedViewports = normalizeVisualQualityViewportWeights(viewportSpecs);
  let weightedScore = 0;
  for (let index = 0; index < viewportArtifacts.length; index += 1) {
    const viewportArtifact = viewportArtifacts[index]!;
    const viewportSpec = normalizedViewports[index];
    if (viewportSpec === undefined) {
      throw new Error(
        "Viewport scoring configuration does not align with executed viewport artifacts.",
      );
    }
    weightedScore += viewportArtifact.score * (viewportSpec.weight ?? 0);
  }
  return Math.round(weightedScore * 100) / 100;
};

const executeVisualBenchmarkViewport = async ({
  fixtureId,
  metadata,
  figmaInput,
  screen,
  activeViewport,
  figmaJsonPath,
  workspaceRoot,
  options,
}: {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  figmaInput: unknown;
  screen: VisualBenchmarkFixtureScreenMetadata;
  activeViewport: VisualBenchmarkViewportSpec;
  figmaJsonPath: string;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
}): Promise<VisualBenchmarkScreenViewportArtifact> => {
  const activeDeviceScaleFactor = resolveViewportDeviceScaleFactor(activeViewport);

  const perScreenMetadata: VisualBenchmarkFixtureMetadata = {
    ...metadata,
    viewport: {
      width: activeViewport.width,
      height: activeViewport.height,
    },
    source: {
      ...metadata.source,
      nodeId: screen.nodeId,
      nodeName: screen.screenName,
    },
  };

  const { executionContext, rootDir, stageContextFor } =
    await createExecutionContext({
      fixtureId,
      figmaJsonPath,
      visualQualityViewportWidth: activeViewport.width,
      visualQualityViewportHeight: activeViewport.height,
      visualQualityDeviceScaleFactor: activeDeviceScaleFactor,
      workspaceRoot,
    });
  const fixturePaths = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const screenViewportPaths = resolveVisualBenchmarkScreenViewportPaths(
    fixtureId,
    screen.screenId,
    activeViewport.id,
    options,
  );
  const metadataPath = path.join(
    fixturePaths.fixtureDir,
    ".benchmark-runtime",
    `reference-${toScreenIdToken(screen.screenId)}-${activeViewport.id}.metadata.json`,
  );

  try {
    const localFigmaJsonPath = path.join(
      executionContext.paths.jobDir,
      "benchmark-local-figma.json",
    );
    await writeFile(
      localFigmaJsonPath,
      toStableJsonString(
        normalizeBenchmarkFigmaInput({
          fixtureId,
          figmaInput,
          metadata: perScreenMetadata,
        }),
      ),
      "utf8",
    );
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(
      metadataPath,
      toStableJsonString(perScreenMetadata),
      "utf8",
    );
    const visualQualityFrozenReference: VisualQualityFrozenReferenceOverride = {
      imagePath: screenViewportPaths.referencePngPath,
      metadataPath,
    };
    (
      executionContext.input as WorkspaceJobInput & {
        visualQualityFrozenReference?: VisualQualityFrozenReferenceOverride;
      }
    ).visualQualityFrozenReference = visualQualityFrozenReference;
    (
      executionContext.job.request as typeof executionContext.job.request & {
        visualQualityFrozenReference?: VisualQualityFrozenReferenceOverride;
      }
    ).visualQualityFrozenReference = visualQualityFrozenReference;
    await FigmaSourceService.execute(
      {
        figmaJsonPath: localFigmaJsonPath,
      },
      stageContextFor("figma.source"),
    );
    await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    await TemplatePrepareService.execute(
      undefined,
      stageContextFor("template.prepare"),
    );
    await createCodegenGenerateService().execute(
      {
        boardKeySeed: fixtureId,
      },
      stageContextFor("codegen.generate"),
    );
    await createValidateProjectService().execute(
      undefined,
      stageContextFor("validate.project"),
    );

    const visualQuality = executionContext.job.visualQuality;
    const screenshotBuffer = await readFile(
      path.join(executionContext.paths.jobDir, "visual-quality", "actual.png"),
    );
    let diffBuffer: Buffer | null = null;
    let report: unknown | null = null;
    try {
      diffBuffer = await readFile(
        path.join(executionContext.paths.jobDir, "visual-quality", "diff.png"),
      );
      report = JSON.parse(
        await readFile(
          path.join(
            executionContext.paths.jobDir,
            "visual-quality",
            "report.json",
          ),
          "utf8",
        ),
      ) as unknown;
    } catch (error: unknown) {
      if (options?.allowIncompleteVisualQuality !== true) {
        throw error;
      }
    }
    if (isWorkspaceVisualQualityReport(report)) {
      report = applyVisualQualityConfigToReport(report, options?.qualityConfig);
    }
    const effectiveVisualQuality = isWorkspaceVisualQualityReport(report)
      ? report
      : visualQuality !== undefined
        ? applyVisualQualityConfigToReport(
            visualQuality,
            options?.qualityConfig,
          )
        : visualQuality;
    if (
      effectiveVisualQuality?.status !== "completed" ||
      typeof effectiveVisualQuality.overallScore !== "number"
    ) {
      if (options?.allowIncompleteVisualQuality !== true) {
        throw new Error(
          `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' viewport '${activeViewport.id}' did not produce a completed visual quality score.`,
        );
      }
    }

    const viewport = effectiveVisualQuality?.metadata?.viewport ?? {
      width: activeViewport.width,
      height: activeViewport.height,
      deviceScaleFactor: activeDeviceScaleFactor,
    };

    return {
      viewportId: activeViewport.id,
      viewportLabel: activeViewport.label ?? activeViewport.id,
      score:
        typeof effectiveVisualQuality?.overallScore === "number"
          ? effectiveVisualQuality.overallScore
          : 100,
      screenshotBuffer,
      diffBuffer,
      report,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    };
  } finally {
    await rm(metadataPath, { force: true });
    await rm(path.dirname(metadataPath), {
      recursive: true,
      force: true,
    });
    await rm(rootDir, { recursive: true, force: true });
  }
};

const executeVisualBenchmarkScreen = async ({
  fixtureId,
  metadata,
  figmaInput,
  screen,
  figmaJsonPath,
  workspaceRoot,
  options,
}: {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  figmaInput: unknown;
  screen: VisualBenchmarkFixtureScreenMetadata;
  figmaJsonPath: string;
  workspaceRoot: string;
  options?: VisualBenchmarkExecutionOptions;
}): Promise<VisualBenchmarkFixtureScreenArtifact> => {
  const userConfiguredViewports = resolveVisualQualityViewports(
    options?.qualityConfig,
    fixtureId,
    { screenId: screen.screenId, screenName: screen.screenName },
  );
  const resolvedViewports = enumerateFixtureScreenViewports(
    screen,
    userConfiguredViewports ?? [],
  );
  const selectedViewports = selectScreenViewports({
    fixtureId,
    screen,
    resolvedViewports,
    selectedViewportId: options?.viewportId,
  });

  const viewports = await Promise.all(
    selectedViewports.map((activeViewport) =>
      executeVisualBenchmarkViewport({
        fixtureId,
        metadata,
        figmaInput,
        screen,
        activeViewport,
        figmaJsonPath,
        workspaceRoot,
        options,
      }),
    ),
  );

  const representativeViewport = viewports[0];
  if (representativeViewport === undefined) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' screen '${screen.screenId}' did not produce any viewport artifacts.`,
    );
  }

  return {
    screenId: screen.screenId,
    screenName: screen.screenName,
    nodeId: screen.nodeId,
    score: computeAggregateFromViewportArtifacts({
      viewportSpecs: selectedViewports,
      viewportArtifacts: viewports,
    }),
    ...(screen.weight !== undefined ? { weight: screen.weight } : {}),
    screenshotBuffer: representativeViewport.screenshotBuffer,
    diffBuffer: representativeViewport.diffBuffer,
    report: representativeViewport.report,
    viewport: representativeViewport.viewport,
    viewports,
  };
};

const computeAggregateFromScreens = (
  screens: readonly VisualBenchmarkFixtureScreenArtifact[],
): number => {
  try {
    return computeVisualBenchmarkAggregateScore(screens);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `executeVisualBenchmarkFixture requires at least one screen to aggregate: ${detail}`,
    );
  }
};

export const executeVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureRunResult> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(
    fixtureId,
    options,
  );
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId, options);
  const workspaceRoot = options?.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;

  await ensureTemplateValidationSeedNodeModules();

  const screens = enumerateFixtureScreens(metadata);
  const screenArtifacts: VisualBenchmarkFixtureScreenArtifact[] = [];
  try {
    for (const screen of screens) {
      const artifact = await executeVisualBenchmarkScreen({
        fixtureId,
        metadata,
        figmaInput,
        screen,
        figmaJsonPath,
        workspaceRoot,
        options,
      });
      screenArtifacts.push(artifact);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Benchmark fixture '${fixtureId}' failed: ${detail}`);
  }

  const aggregateScore = computeAggregateFromScreens(screenArtifacts);

  return {
    fixtureId,
    aggregateScore,
    screens: screenArtifacts,
  };
};

export const runVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionResult> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, options);
  return {
    fixtureId: result.fixtureId,
    score: result.aggregateScore,
  };
};

/**
 * Legacy single-screen execution wrapper used by visual-baseline.ts which
 * still consumes per-fixture (not per-screen) artifacts. This fans out to the
 * multi-screen executor and collapses to the first screen. Single-screen
 * fixtures (v1 metadata) produce byte-identical output to the pre-multi-screen
 * behaviour.
 */
export const executeVisualBenchmarkFixtureLegacy = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionArtifacts> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, options);
  const first = result.screens[0];
  if (first === undefined) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' produced no screens in legacy execution.`,
    );
  }
  return {
    fixtureId: result.fixtureId,
    score: result.aggregateScore,
    screenshotBuffer: first.screenshotBuffer,
    diffBuffer: first.diffBuffer,
    report: first.report,
    viewport: first.viewport,
  };
};
