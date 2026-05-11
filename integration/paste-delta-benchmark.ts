import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type {
  WorkspaceJobInput,
  WorkspaceJobStage,
  WorkspaceJobStageName,
} from "../src/contracts/index.js";
import { CONTRACT_VERSION } from "../src/contracts/index.js";
import type { WorkspaceRuntimeLogger } from "../src/logging.js";
import { createCodegenGenerateService } from "../src/job-engine/services/codegen-generate-service.js";
import { FigmaSourceService } from "../src/job-engine/services/figma-source-service.js";
import { IrDeriveService } from "../src/job-engine/services/ir-derive-service.js";
import { TemplatePrepareService } from "../src/job-engine/services/template-prepare-service.js";
import type {
  JobEngineRuntime,
  JobRecord,
  SubmissionJobInput,
} from "../src/job-engine/types.js";
import {
  createStageRuntimeContext,
  type PipelineExecutionContext,
  type StageRuntimeContext,
} from "../src/job-engine/pipeline/context.js";
import { JobDiskTracker } from "../src/job-engine/disk-tracker.js";
import { StageArtifactStore } from "../src/job-engine/pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../src/job-engine/pipeline/artifact-keys.js";
import { createPasteFingerprintStore } from "../src/job-engine/paste-fingerprint-store.js";
import { buildFingerprintNodes } from "../src/job-engine/paste-tree-diff.js";
import { extractDiffablePasteRoots } from "../src/job-engine/paste-delta-roots.js";
import { computePasteIdentityKey } from "../src/job-engine/paste-fingerprint-store.js";
import { resolveRuntimeSettings } from "../src/job-engine/runtime.js";
import { createInitialStages, nowIso } from "../src/job-engine/stage-state.js";

const ARTIFACT_VERSION = 1;
const DEFAULT_ITERATIONS = 5;
const DEFAULT_WARMUP_ITERATIONS = 1;
const DEFAULT_MAX_P80_RATIO = 0.7;
const DEFAULT_FIGMA_FILE_KEY = "paste-delta-benchmark-file";
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "artifacts/testing/paste-delta-benchmark.json",
);
const DEFAULT_PAYLOAD_SCREEN_COUNT = 6;
const DEFAULT_PAYLOAD_TEXT_NODES_PER_SCREEN = 12;

const ROCKET_PIPELINE_METADATA = {
  pipelineId: "rocket",
  pipelineDisplayName: "Rocket",
  templateBundleId: "react-mui-app",
  buildProfile: "default-rocket",
  deterministic: true,
} as const;

export interface BenchmarkSample {
  iteration: number;
  order: readonly ["full", "delta"] | readonly ["delta", "full"];
  fullMs: number;
  deltaMs: number;
  ratio: number;
  deltaSummaryMode?: string;
  deltaSummaryStrategy?: string;
  deltaFallbackReason?: string;
}

export interface BenchmarkSummaryStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p80: number;
}

export interface BenchmarkScenarioReport {
  id: string;
  title: string;
  description: string;
  sampleCount: number;
  fullMs: BenchmarkSummaryStats;
  deltaMs: BenchmarkSummaryStats;
  ratio: BenchmarkSummaryStats;
  samples: BenchmarkSample[];
}

export interface PasteDeltaBenchmarkReport {
  artifact: "paste.delta.benchmark";
  artifactVersion: number;
  generatedAt: string;
  config: {
    iterations: number;
    warmupIterations: number;
    maxP80Ratio: number;
    measuredStages: readonly WorkspaceJobStageName[];
    templateRoot: string;
  };
  summary: {
    scenarioCount: number;
    sampleCount: number;
    fullMs: BenchmarkSummaryStats;
    deltaMs: BenchmarkSummaryStats;
    ratio: BenchmarkSummaryStats;
  };
  threshold: {
    metric: "ratio.p80";
    maxP80Ratio: number;
    actualP80Ratio: number;
    passed: boolean;
  };
  scenarios: BenchmarkScenarioReport[];
}

export interface BenchmarkCliOptions {
  iterations: number;
  warmupIterations: number;
  outputPath: string;
  maxP80Ratio: number;
  check: boolean;
}

export interface BenchmarkScenarioDefinition {
  id: string;
  title: string;
  description: string;
  screenCount: number;
  textNodesPerScreen: number;
  buildChangedPayload: (baseline: BenchmarkFigmaPayload) => BenchmarkFigmaPayload;
}

interface TextNode {
  id: string;
  type: "TEXT";
  name: string;
  characters: string;
  absoluteBoundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface FrameNode {
  id: string;
  type: "FRAME";
  name: string;
  absoluteBoundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children: TextNode[];
}

interface CanvasNode {
  id: string;
  type: "CANVAS";
  name: string;
  children: FrameNode[];
}

interface BenchmarkFigmaPayload {
  name: string;
  lastModified: string;
  document: {
    id: string;
    type: "DOCUMENT";
    children: [CanvasNode];
  };
}

interface BenchmarkExecutionContextResult {
  executionContext: PipelineExecutionContext;
  stageContextFor: (stage: WorkspaceJobStageName) => StageRuntimeContext;
}

interface BenchmarkRunResult {
  durationMs: number;
  deltaSummaryMode?: string;
  deltaSummaryStrategy?: string;
  deltaFallbackReason?: string;
}

const BENCHMARK_STAGES: readonly WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "codegen.generate",
];

const NOOP_LOGGER: WorkspaceRuntimeLogger = {
  log: () => {
    // Benchmark output should stay readable; stage logs do not help here.
  },
};

const createJobRecord = ({
  runtime,
  jobDir,
  jobId,
  requestOverrides,
}: {
  runtime: JobEngineRuntime;
  jobDir: string;
  jobId: string;
  requestOverrides?: Partial<JobRecord["request"]>;
}): JobRecord => {
  return {
    jobId,
    status: "queued",
    submittedAt: nowIso(),
    request: {
      pipelineId: ROCKET_PIPELINE_METADATA.pipelineId,
      pipelineMetadata: ROCKET_PIPELINE_METADATA,
      enableVisualQualityValidation: false,
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form",
      ...requestOverrides,
    },
    pipelineMetadata: ROCKET_PIPELINE_METADATA,
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

const createBenchmarkExecutionContext = async ({
  rootDir,
  jobId,
  templateRoot,
  input,
  requestOverrides,
}: {
  rootDir: string;
  jobId: string;
  templateRoot: string;
  input: SubmissionJobInput;
  requestOverrides?: Partial<JobRecord["request"]>;
}): Promise<BenchmarkExecutionContextResult> => {
  const jobsRoot = path.join(rootDir, "jobs");
  const jobDir = path.join(jobsRoot, jobId);
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const runtime = resolveRuntimeSettings({
    enablePreview: false,
    skipInstall: true,
    enableUiValidation: false,
    enableUnitTestValidation: false,
    enablePerfValidation: false,
    enableVisualQualityValidation: false,
    figmaMaxRetries: 1,
    figmaRequestTimeoutMs: 1_000,
    logger: NOOP_LOGGER,
  });
  await mkdir(jobDir, { recursive: true });
  await mkdir(generatedProjectDir, { recursive: true });
  const artifactStore = new StageArtifactStore({ jobDir });
  const diskTracker = new JobDiskTracker({
    roots: [jobDir, path.join(rootDir, "repros", jobId)],
    limitBytes: runtime.maxJobDiskBytes,
    limits: runtime.pipelineDiagnosticLimits,
  });
  await diskTracker.sync();

  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job: createJobRecord({
      runtime,
      jobDir,
      jobId,
      requestOverrides,
    }),
    pipelineMetadata: ROCKET_PIPELINE_METADATA,
    input,
    runtime,
    resolvedPaths: {
      outputRoot: rootDir,
      jobsRoot,
      reprosRoot: path.join(rootDir, "repros"),
    },
    resolvedWorkspaceRoot: rootDir,
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
      reproDir: path.join(rootDir, "repros", jobId),
      iconMapFilePath: path.join(rootDir, "icon-map.json"),
      designSystemFilePath: path.join(rootDir, "design-system.json"),
      irCacheDir: path.join(rootDir, "cache", "ir"),
      templateRoot,
      templateCopyFilter: () => true,
    },
    artifactStore,
    diskTracker,
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // The benchmark only measures runtime. Diagnostics are not surfaced.
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // No-op; benchmark harness does not project public job state.
    },
  };

  return {
    executionContext,
    stageContextFor: (stage) =>
      createStageRuntimeContext({ executionContext, stage }),
  };
};

const calculateMean = (values: readonly number[]): number => {
  if (values.length === 0) {
    throw new Error("Cannot calculate mean of an empty list.");
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
};

const round = (value: number): number => {
  return Math.round(value * 1_000) / 1_000;
};

export const calculatePercentile = (
  values: readonly number[],
  percentile: number,
): number => {
  if (values.length === 0) {
    throw new Error("Cannot calculate a percentile of an empty list.");
  }
  if (percentile < 0 || percentile > 1) {
    throw new Error("Percentile must be within 0..1.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index] ?? sorted[sorted.length - 1]!;
};

export const summarizeDurations = (
  values: readonly number[],
): BenchmarkSummaryStats => {
  if (values.length === 0) {
    throw new Error("Cannot summarize an empty duration list.");
  }
  return {
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    mean: round(calculateMean(values)),
    p50: round(calculatePercentile(values, 0.5)),
    p80: round(calculatePercentile(values, 0.8)),
  };
};

export const assertP80RatioThreshold = ({
  report,
}: {
  report: PasteDeltaBenchmarkReport;
}): void => {
  if (!report.threshold.passed) {
    throw new Error(
      `Paste delta benchmark failed: p80 ratio ${report.threshold.actualP80Ratio.toFixed(3)} exceeds max ${report.threshold.maxP80Ratio.toFixed(3)}.`,
    );
  }
};

const parseCliInteger = ({
  args,
  index,
  flag,
}: {
  args: readonly string[];
  index: number;
  flag: string;
}): number => {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a numeric value.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return parsed;
};

const parseCliFloat = ({
  args,
  index,
  flag,
}: {
  args: readonly string[];
  index: number;
  flag: string;
}): number => {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a numeric value.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number.`);
  }
  return parsed;
};

export const parseBenchmarkCliArgs = (
  args: readonly string[],
): BenchmarkCliOptions => {
  let iterations = DEFAULT_ITERATIONS;
  let warmupIterations = DEFAULT_WARMUP_ITERATIONS;
  let outputPath = DEFAULT_OUTPUT_PATH;
  let maxP80Ratio = DEFAULT_MAX_P80_RATIO;
  let check = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag) {
      continue;
    }
    switch (flag) {
      case "--":
        break;
      case "--iterations":
        iterations = parseCliInteger({ args, index, flag });
        index += 1;
        break;
      case "--warmup-iterations":
        warmupIterations = parseCliInteger({ args, index, flag });
        index += 1;
        break;
      case "--output":
        outputPath = path.resolve(process.cwd(), args[index + 1] ?? "");
        if (outputPath.length === 0 || args[index + 1] === undefined) {
          throw new Error("--output requires a file path.");
        }
        index += 1;
        break;
      case "--max-p80-ratio":
        maxP80Ratio = parseCliFloat({ args, index, flag });
        index += 1;
        break;
      case "--check":
        check = true;
        break;
      case "--help":
      case "-h":
        throw new Error(
          "Usage: pnpm benchmark:paste-delta [--iterations <n>] [--warmup-iterations <n>] [--output <path>] [--max-p80-ratio <ratio>] [--check]",
        );
      default:
        throw new Error(`Unknown flag '${flag}'.`);
    }
  }

  return {
    iterations,
    warmupIterations,
    outputPath,
    maxP80Ratio,
    check,
  };
};

const createTextNode = ({
  screenIndex,
  textIndex,
}: {
  screenIndex: number;
  textIndex: number;
}): TextNode => {
  const isTitle = textIndex === 0;
  const label = isTitle ? "Title" : `Body ${textIndex}`;
  return {
    id: isTitle
      ? `screen-${screenIndex}-title`
      : `screen-${screenIndex}-text-${textIndex}`,
    type: "TEXT",
    name: label,
    characters: isTitle
      ? `Screen ${screenIndex} headline`
      : `Screen ${screenIndex} content line ${textIndex}`,
    absoluteBoundingBox: {
      x: 32,
      y: 32 + textIndex * 32,
      width: 480,
      height: 24,
    },
  };
};

const createBenchmarkPayload = ({
  screenCount,
  textNodesPerScreen,
}: {
  screenCount: number;
  textNodesPerScreen: number;
}): BenchmarkFigmaPayload => {
  const screens: FrameNode[] = Array.from({ length: screenCount }, (_, index) => {
    const screenIndex = index + 1;
    return {
      id: `screen-${screenIndex}`,
      type: "FRAME",
      name: `Screen ${screenIndex}`,
      absoluteBoundingBox: {
        x: 0,
        y: index * 880,
        width: 1440,
        height: 800,
      },
      children: Array.from({ length: textNodesPerScreen + 1 }, (_, textIndex) =>
        createTextNode({ screenIndex, textIndex }),
      ),
    };
  });

  return {
    name: "Paste Delta Benchmark Board",
    lastModified: "2026-04-19T00:00:00.000Z",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Benchmark Canvas",
          children: screens,
        },
      ],
    },
  };
};

const createBenchmarkTemplateRoot = async ({
  rootDir,
}: {
  rootDir: string;
}): Promise<string> => {
  const templateRoot = path.join(rootDir, "benchmark-template");
  await mkdir(path.join(templateRoot, "src"), { recursive: true });
  await writeFile(
    path.join(templateRoot, "package.json"),
    `${JSON.stringify({ name: "paste-delta-benchmark-template", private: true }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(templateRoot, "src", "index.tsx"),
    "export default function App() { return null; }\n",
    "utf8",
  );
  return templateRoot;
};

const updateTextCharacters = ({
  payload,
  nodeId,
  characters,
}: {
  payload: BenchmarkFigmaPayload;
  nodeId: string;
  characters: string;
}): BenchmarkFigmaPayload => {
  const next = structuredClone(payload) as BenchmarkFigmaPayload;
  for (const screen of next.document.children[0].children) {
    for (const child of screen.children) {
      if (child.id === nodeId) {
        child.characters = characters;
        return next;
      }
    }
  }
  throw new Error(`Could not locate TEXT node '${nodeId}'.`);
};

const updateScreenCopy = ({
  payload,
  screenId,
  suffix,
}: {
  payload: BenchmarkFigmaPayload;
  screenId: string;
  suffix: string;
}): BenchmarkFigmaPayload => {
  const next = structuredClone(payload) as BenchmarkFigmaPayload;
  const screen = next.document.children[0].children.find(
    (candidate) => candidate.id === screenId,
  );
  if (!screen) {
    throw new Error(`Could not locate screen '${screenId}'.`);
  }
  screen.name = `${screen.name} ${suffix}`;
  for (const child of screen.children) {
    child.characters = `${child.characters} ${suffix}`;
  }
  return next;
};

export const DEFAULT_SCENARIOS: BenchmarkScenarioDefinition[] = [
  {
    id: "single-text-edit",
    title: "Single Text Edit",
    description:
      "One body copy change on the first screen while the rest of the board stays stable.",
    screenCount: DEFAULT_PAYLOAD_SCREEN_COUNT,
    textNodesPerScreen: DEFAULT_PAYLOAD_TEXT_NODES_PER_SCREEN,
    buildChangedPayload: (baseline) =>
      updateTextCharacters({
        payload: baseline,
        nodeId: "screen-1-text-4",
        characters: "Screen 1 content line 4 updated for a small iteration",
      }),
  },
  {
    id: "single-screen-copy-edit",
    title: "Single Screen Copy Edit",
    description:
      "All copy on one screen changes, but the screen structure and sibling screens stay identical.",
    screenCount: DEFAULT_PAYLOAD_SCREEN_COUNT,
    textNodesPerScreen: DEFAULT_PAYLOAD_TEXT_NODES_PER_SCREEN,
    buildChangedPayload: (baseline) =>
      updateScreenCopy({
        payload: baseline,
        screenId: "screen-3",
        suffix: "rev-b",
      }),
  },
  {
    id: "late-screen-heading-edit",
    title: "Late Screen Heading Edit",
    description:
      "A title edit near the end of the board to avoid a best-case first-screen-only bias.",
    screenCount: DEFAULT_PAYLOAD_SCREEN_COUNT,
    textNodesPerScreen: DEFAULT_PAYLOAD_TEXT_NODES_PER_SCREEN,
    buildChangedPayload: (baseline) =>
      updateTextCharacters({
        payload: baseline,
        nodeId: "screen-6-title",
        characters: "Screen 6 headline tuned for a final small iteration",
      }),
  },
];

const writePayloadToContext = async ({
  executionContext,
  payload,
}: {
  executionContext: PipelineExecutionContext;
  payload: BenchmarkFigmaPayload;
}): Promise<string> => {
  const payloadPath = path.join(executionContext.paths.jobDir, "payload.json");
  await writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payloadPath;
};

const markCompletedSourceJob = ({
  executionContext,
  jobId,
}: {
  executionContext: PipelineExecutionContext;
  jobId: string;
}): JobRecord => {
  const completedStages: WorkspaceJobStage[] = executionContext.job.stages.map(
    (stage) => ({
      ...stage,
      status:
        stage.name === "figma.source" ||
        stage.name === "ir.derive" ||
        stage.name === "template.prepare" ||
        stage.name === "codegen.generate"
          ? "completed"
          : stage.status,
    }),
  );
  return {
    ...executionContext.job,
    jobId,
    status: "completed",
    finishedAt: nowIso(),
    stages: completedStages,
    artifacts: {
      ...executionContext.job.artifacts,
      generatedProjectDir: executionContext.paths.generatedProjectDir,
      designIrFile: executionContext.paths.designIrFile,
      jobDir: executionContext.paths.jobDir,
    },
  };
};

const seedPasteFingerprintManifest = async ({
  rootDir,
  payload,
  figmaFileKey,
  sourceJobId,
}: {
  rootDir: string;
  payload: BenchmarkFigmaPayload;
  figmaFileKey: string;
  sourceJobId: string;
}): Promise<string> => {
  const roots = extractDiffablePasteRoots(payload);
  const fingerprints = buildFingerprintNodes(roots);
  const pasteIdentityKey = computePasteIdentityKey({
    figmaFileKey,
    rootNodeIds: fingerprints.rootNodeIds,
  });
  const store = createPasteFingerprintStore({
    rootDir: path.join(rootDir, "paste-fingerprints"),
  });
  await store.save({
    contractVersion: CONTRACT_VERSION,
    pasteIdentityKey,
    createdAt: nowIso(),
    rootNodeIds: fingerprints.rootNodeIds,
    nodes: fingerprints.nodes,
    figmaFileKey,
    sourceJobId,
  });
  return pasteIdentityKey;
};

const runPipeline = async ({
  rootDir,
  templateRoot,
  jobId,
  payload,
  sourceJob,
  pasteIdentityKey,
  figmaFileKey,
}: {
  rootDir: string;
  templateRoot: string;
  jobId: string;
  payload: BenchmarkFigmaPayload;
  sourceJob?: JobRecord;
  pasteIdentityKey?: string;
  figmaFileKey: string;
}): Promise<BenchmarkRunResult> => {
  const input: SubmissionJobInput = {
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
    figmaJsonPath: "",
    ...(pasteIdentityKey && sourceJob
      ? {
          pasteDeltaSeed: {
            pasteIdentityKey,
            requestedMode: "auto",
            sourceJobId: sourceJob.jobId,
            figmaFileKey,
          },
        }
      : {}),
  };
  const { executionContext, stageContextFor } =
    await createBenchmarkExecutionContext({
      rootDir,
      jobId,
      templateRoot,
      input,
      requestOverrides: {
        figmaFileKey,
      } satisfies Partial<WorkspaceJobInput>,
    });
  if (sourceJob) {
    executionContext.sourceJob = sourceJob;
  }

  const payloadPath = await writePayloadToContext({
    executionContext,
    payload,
  });
  const stageInput = { figmaJsonPath: payloadPath };
  const measure = async (fn: () => Promise<void>): Promise<number> => {
    const start = performance.now();
    await fn();
    return performance.now() - start;
  };
  let durationMs = 0;
  durationMs += await measure(async () => {
    await FigmaSourceService.execute(stageInput, stageContextFor("figma.source"));
  });
  durationMs += await measure(async () => {
    await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
  });
  await TemplatePrepareService.execute(
    undefined,
    stageContextFor("template.prepare"),
  );
  durationMs += await measure(async () => {
    await createCodegenGenerateService().execute(
      {
        boardKeySeed: figmaFileKey,
      },
      stageContextFor("codegen.generate"),
    );
  });

  const deltaExecution =
    await executionContext.artifactStore.getValue<Record<string, unknown>>(
      STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
    );
  const summary = deltaExecution?.summary as
    | { mode?: string; strategy?: string }
    | undefined;
  const fallbackReason =
    typeof deltaExecution?.fallbackReason === "string"
      ? deltaExecution.fallbackReason
      : undefined;

  return {
    durationMs,
    deltaSummaryMode: summary?.mode,
    deltaSummaryStrategy: summary?.strategy,
    ...(fallbackReason ? { deltaFallbackReason: fallbackReason } : {}),
  };
};

const prepareSourceJob = async ({
  rootDir,
  templateRoot,
  scenario,
  figmaFileKey,
}: {
  rootDir: string;
  templateRoot: string;
  scenario: BenchmarkScenarioDefinition;
  figmaFileKey: string;
}): Promise<{ sourceJob: JobRecord; pasteIdentityKey: string; baseline: BenchmarkFigmaPayload; changed: BenchmarkFigmaPayload }> => {
  const baseline = createBenchmarkPayload({
    screenCount: scenario.screenCount,
    textNodesPerScreen: scenario.textNodesPerScreen,
  });
  const changed = scenario.buildChangedPayload(baseline);
  const sourceJobId = `source-${scenario.id}`;
  const { executionContext, stageContextFor } =
    await createBenchmarkExecutionContext({
      rootDir,
      jobId: sourceJobId,
      templateRoot,
      input: {
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
        figmaJsonPath: "",
      },
      requestOverrides: {
        figmaFileKey,
      } satisfies Partial<WorkspaceJobInput>,
    });
  const payloadPath = await writePayloadToContext({
    executionContext,
    payload: baseline,
  });

  await FigmaSourceService.execute(
    { figmaJsonPath: payloadPath },
    stageContextFor("figma.source"),
  );
  await IrDeriveService.execute(undefined, stageContextFor("ir.derive"));
  await TemplatePrepareService.execute(
    undefined,
    stageContextFor("template.prepare"),
  );
  await createCodegenGenerateService().execute(
    {
      boardKeySeed: figmaFileKey,
    },
    stageContextFor("codegen.generate"),
  );

  const sourceJob = markCompletedSourceJob({
    executionContext,
    jobId: sourceJobId,
  });
  const pasteIdentityKey = await seedPasteFingerprintManifest({
    rootDir,
    payload: baseline,
    figmaFileKey,
    sourceJobId,
  });
  return {
    sourceJob,
    pasteIdentityKey,
    baseline,
    changed,
  };
};

const benchmarkScenario = async ({
  scenario,
  iterations,
  warmupIterations,
  templateRoot,
}: {
  scenario: BenchmarkScenarioDefinition;
  iterations: number;
  warmupIterations: number;
  templateRoot: string;
}): Promise<BenchmarkScenarioReport> => {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `workspace-dev-paste-delta-benchmark-${scenario.id}-`),
  );
  try {
    const resolvedTemplateRoot =
      templateRoot ?? (await createBenchmarkTemplateRoot({ rootDir }));
    const figmaFileKey = `${DEFAULT_FIGMA_FILE_KEY}-${scenario.id}`;
    const { sourceJob, pasteIdentityKey, changed } = await prepareSourceJob({
      rootDir,
      templateRoot: resolvedTemplateRoot,
      scenario,
      figmaFileKey,
    });
    const samples: BenchmarkSample[] = [];

    for (
      let iterationIndex = 0;
      iterationIndex < warmupIterations + iterations;
      iterationIndex += 1
    ) {
      const order =
        iterationIndex % 2 === 0
          ? (["full", "delta"] as const)
          : (["delta", "full"] as const);
      let fullMs = 0;
      let deltaMs = 0;
      let deltaSummaryMode: string | undefined;
      let deltaSummaryStrategy: string | undefined;
      let deltaFallbackReason: string | undefined;

      for (const mode of order) {
        if (mode === "full") {
          const result = await runPipeline({
            rootDir,
            templateRoot: resolvedTemplateRoot,
            jobId: `full-${scenario.id}-${iterationIndex + 1}`,
            payload: changed,
            figmaFileKey,
          });
          fullMs = result.durationMs;
        } else {
          const result = await runPipeline({
            rootDir,
            templateRoot: resolvedTemplateRoot,
            jobId: `delta-${scenario.id}-${iterationIndex + 1}`,
            payload: changed,
            sourceJob,
            pasteIdentityKey,
            figmaFileKey,
          });
          deltaMs = result.durationMs;
          deltaSummaryMode = result.deltaSummaryMode;
          deltaSummaryStrategy = result.deltaSummaryStrategy;
          deltaFallbackReason = result.deltaFallbackReason;
        }
      }

      if (iterationIndex < warmupIterations) {
        continue;
      }

      samples.push({
        iteration: samples.length + 1,
        order,
        fullMs: round(fullMs),
        deltaMs: round(deltaMs),
        ratio: round(deltaMs / fullMs),
        ...(deltaSummaryMode ? { deltaSummaryMode } : {}),
        ...(deltaSummaryStrategy ? { deltaSummaryStrategy } : {}),
        ...(deltaFallbackReason ? { deltaFallbackReason } : {}),
      });
    }

    return {
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
      sampleCount: samples.length,
      fullMs: summarizeDurations(samples.map((sample) => sample.fullMs)),
      deltaMs: summarizeDurations(samples.map((sample) => sample.deltaMs)),
      ratio: summarizeDurations(samples.map((sample) => sample.ratio)),
      samples,
    };
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
};

export const runPasteDeltaBenchmark = async ({
  iterations = DEFAULT_ITERATIONS,
  warmupIterations = DEFAULT_WARMUP_ITERATIONS,
  outputPath = DEFAULT_OUTPUT_PATH,
  maxP80Ratio = DEFAULT_MAX_P80_RATIO,
  scenarios = DEFAULT_SCENARIOS,
  templateRoot,
}: Partial<BenchmarkCliOptions> & {
  scenarios?: readonly BenchmarkScenarioDefinition[];
  templateRoot?: string;
} = {}): Promise<PasteDeltaBenchmarkReport> => {
  const reports: BenchmarkScenarioReport[] = [];
  for (const scenario of scenarios) {
    reports.push(
      await benchmarkScenario({
      scenario,
      iterations,
      warmupIterations,
      ...(templateRoot ? { templateRoot } : {}),
      }),
    );
  }

  const fullSamples = reports.flatMap((report) =>
    report.samples.map((sample) => sample.fullMs),
  );
  const deltaSamples = reports.flatMap((report) =>
    report.samples.map((sample) => sample.deltaMs),
  );
  const ratioSamples = reports.flatMap((report) =>
    report.samples.map((sample) => sample.ratio),
  );
  const ratioSummary = summarizeDurations(ratioSamples);
  const report: PasteDeltaBenchmarkReport = {
    artifact: "paste.delta.benchmark",
    artifactVersion: ARTIFACT_VERSION,
    generatedAt: nowIso(),
    config: {
      iterations,
      warmupIterations,
      maxP80Ratio,
      measuredStages: BENCHMARK_STAGES,
      templateRoot: templateRoot ?? "__generated_benchmark_template__",
    },
    summary: {
      scenarioCount: reports.length,
      sampleCount: ratioSamples.length,
      fullMs: summarizeDurations(fullSamples),
      deltaMs: summarizeDurations(deltaSamples),
      ratio: ratioSummary,
    },
    threshold: {
      metric: "ratio.p80",
      maxP80Ratio,
      actualP80Ratio: ratioSummary.p80,
      passed: ratioSummary.p80 <= maxP80Ratio,
    },
    scenarios: reports,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
};

export const formatBenchmarkSummary = (
  report: PasteDeltaBenchmarkReport,
): string => {
  return [
    `Paste delta benchmark: ${report.summary.sampleCount} samples across ${report.summary.scenarioCount} scenario(s).`,
    `Full mean=${report.summary.fullMs.mean.toFixed(3)}ms, delta mean=${report.summary.deltaMs.mean.toFixed(3)}ms.`,
    `Delta/full ratio p80=${report.threshold.actualP80Ratio.toFixed(3)} (threshold <= ${report.threshold.maxP80Ratio.toFixed(3)}) => ${report.threshold.passed ? "PASS" : "FAIL"}.`,
  ].join("\n");
};

const runCli = async (): Promise<void> => {
  const options = parseBenchmarkCliArgs(process.argv.slice(2));
  const report = await runPasteDeltaBenchmark(options);
  process.stdout.write(`${formatBenchmarkSummary(report)}\n`);
  if (options.check) {
    assertP80RatioThreshold({ report });
  }
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli().catch((error) => {
    const message =
      error instanceof Error ? error.message : "Unknown benchmark failure.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
