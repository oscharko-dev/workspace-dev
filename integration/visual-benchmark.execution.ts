import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WorkspaceJobStageName } from "../src/contracts/index.js";
import { createInitialStages, nowIso } from "../src/job-engine/stage-state.js";
import { resolveRuntimeSettings } from "../src/job-engine/runtime.js";
import { createTemplateCopyFilter } from "../src/job-engine/template-copy-filter.js";
import { StageArtifactStore } from "../src/job-engine/pipeline/artifact-store.js";
import { createStageRuntimeContext, type PipelineExecutionContext, type StageRuntimeContext } from "../src/job-engine/pipeline/context.js";
import { FigmaSourceService } from "../src/job-engine/services/figma-source-service.js";
import { IrDeriveService } from "../src/job-engine/services/ir-derive-service.js";
import { TemplatePrepareService } from "../src/job-engine/services/template-prepare-service.js";
import { createCodegenGenerateService } from "../src/job-engine/services/codegen-generate-service.js";
import { createValidateProjectService } from "../src/job-engine/services/validate-project-service.js";
import type { JobRecord } from "../src/job-engine/types.js";
import { ensureTemplateValidationSeedNodeModules } from "../src/job-engine/test-validation-seed.js";
import {
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkFixturePaths,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";

const DEFAULT_WORKSPACE_ROOT = process.cwd();
export interface VisualBenchmarkExecutionOptions extends VisualBenchmarkFixtureOptions {
  allowIncompleteVisualQuality?: boolean;
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const cloneJsonValue = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const mergeOptionalRecords = (...values: unknown[]): Record<string, unknown> | undefined => {
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
    throw new Error(`Benchmark fixture '${fixtureId}' figma.json must be an object.`);
  }

  if (isRecord(figmaInput.document)) {
    return cloneJsonValue(figmaInput);
  }

  if (!isRecord(figmaInput.nodes)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json must expose either a top-level document or a nodes map.`
    );
  }

  const nodeEntry = figmaInput.nodes[metadata.source.nodeId];
  if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' figma.json is missing node '${metadata.source.nodeId}' in nodes payload.`
    );
  }

  const document = cloneJsonValue(nodeEntry.document);
  const components = mergeOptionalRecords(figmaInput.components, nodeEntry.components);
  const componentSets = mergeOptionalRecords(figmaInput.componentSets, nodeEntry.componentSets);
  const styles = mergeOptionalRecords(figmaInput.styles, nodeEntry.styles);

  return {
    ...(typeof figmaInput.editorType === "string" ? { editorType: figmaInput.editorType } : {}),
    ...(typeof figmaInput.lastModified === "string" ? { lastModified: figmaInput.lastModified } : {}),
    ...(typeof figmaInput.linkAccess === "string" ? { linkAccess: figmaInput.linkAccess } : {}),
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
}: {
  fixtureId: string;
  runtime: ReturnType<typeof resolveRuntimeSettings>;
  jobDir: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
}): JobRecord => {
  return {
    jobId: `visual-benchmark-${fixtureId}`,
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
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
  workspaceRoot,
}: {
  fixtureId: string;
  figmaJsonPath: string;
  visualQualityViewportWidth: number;
  workspaceRoot: string;
}): Promise<{
  executionContext: PipelineExecutionContext;
  rootDir: string;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}> => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), `workspace-dev-visual-benchmark-${fixtureId}-`));
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
    }),
    input: {
      figmaSourceMode: "local_json",
      figmaJsonPath,
      enableVisualQualityValidation: true,
      visualQualityReferenceMode: "frozen_fixture",
      visualQualityViewportWidth,
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
    stageContextFor: (stage) => createStageRuntimeContext({ executionContext, stage }),
  };
};

export const executeVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionArtifacts> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const { figmaJsonPath } = resolveVisualBenchmarkFixturePaths(fixtureId, options);
  const figmaInput = await loadVisualBenchmarkFixtureInputs(fixtureId, options);
  const workspaceRoot = options?.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT;

  await ensureTemplateValidationSeedNodeModules();

  const { executionContext, rootDir, stageContextFor } = await createExecutionContext({
    fixtureId,
    figmaJsonPath,
    visualQualityViewportWidth: metadata.viewport.width,
    workspaceRoot,
  });

  try {
    const localFigmaJsonPath = path.join(executionContext.paths.jobDir, "benchmark-local-figma.json");
    await writeFile(
      localFigmaJsonPath,
      toStableJsonString(
        normalizeBenchmarkFigmaInput({
          fixtureId,
          figmaInput,
          metadata,
        }),
      ),
      "utf8",
    );
    await FigmaSourceService.execute(
      {
        figmaJsonPath: localFigmaJsonPath,
      },
      stageContextFor("figma.source"),
    );
    await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
    await TemplatePrepareService.execute(undefined, stageContextFor("template.prepare"));
    await createCodegenGenerateService().execute(
      {
        boardKeySeed: fixtureId,
      },
      stageContextFor("codegen.generate"),
    );
    await createValidateProjectService().execute(undefined, stageContextFor("validate.project"));

    const visualQuality = executionContext.job.visualQuality;
    const screenshotBuffer = await readFile(path.join(executionContext.paths.jobDir, "visual-quality", "actual.png"));
    let diffBuffer: Buffer | null = null;
    let report: unknown | null = null;
    try {
      diffBuffer = await readFile(path.join(executionContext.paths.jobDir, "visual-quality", "diff.png"));
      report = JSON.parse(
        await readFile(path.join(executionContext.paths.jobDir, "visual-quality", "report.json"), "utf8"),
      ) as unknown;
    } catch (error: unknown) {
      if (options?.allowIncompleteVisualQuality !== true) {
        throw error;
      }
    }
    if (
      visualQuality?.status !== "completed" ||
      typeof visualQuality.overallScore !== "number"
    ) {
      if (options?.allowIncompleteVisualQuality !== true) {
        throw new Error(
          `Benchmark fixture '${fixtureId}' did not produce a completed visual quality score.`
        );
      }
    }

    const viewport = visualQuality?.metadata?.viewport ?? {
      width: metadata.viewport.width,
      height: metadata.viewport.height,
      deviceScaleFactor: 1,
    };

    return {
      fixtureId,
      score: typeof visualQuality?.overallScore === "number" ? visualQuality.overallScore : 100,
      screenshotBuffer,
      diffBuffer,
      report,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Benchmark fixture '${fixtureId}' failed: ${detail}`);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
};

export const runVisualBenchmarkFixture = async (
  fixtureId: string,
  options?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureExecutionResult> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, options);
  return {
    fixtureId: result.fixtureId,
    score: result.score,
  };
};
