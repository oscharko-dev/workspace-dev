import assert from "node:assert/strict";
import test from "node:test";
import { createStageRuntimeContext, type PipelineExecutionContext } from "./context.js";
import type { JobRecord } from "../types.js";
import type { PipelineDiagnosticInput } from "../errors.js";

const PIPELINE_METADATA = {
  pipelineId: "rocket",
  pipelineDisplayName: "Rocket",
  templateBundleId: "react-mui-app",
  buildProfile: "rocket",
  deterministic: true,
} as const;

const createJob = (jobId: string): JobRecord => ({
  jobId,
  status: "queued",
  submittedAt: new Date().toISOString(),
  request: {
    enableVisualQualityValidation: false,
    enableGitPr: false,
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
    brandTheme: "derived",
    generationLocale: "en-US",
    formHandlingMode: "react_hook_form",
  },
  stages: [],
  logs: [],
  artifacts: {
    outputRoot: "/tmp/output",
    jobDir: "/tmp/job",
  },
  preview: { enabled: false },
  queue: {
    runningCount: 0,
    queuedCount: 0,
    maxConcurrentJobs: 1,
    maxQueuedJobs: 1,
  },
});

const createExecutionContext = (
  overrides: Partial<PipelineExecutionContext> = {},
): {
  executionContext: PipelineExecutionContext;
  logEntries: Array<{ level: string; message: string; stage?: string }>;
  diagnosticsCalls: Array<{ stage: string; diagnostics: PipelineDiagnosticInput[] }>;
} => {
  const job = createJob("job-123");
  const sourceJob = createJob("job-source");
  const logEntries: Array<{ level: string; message: string; stage?: string }> = [];
  const diagnosticsCalls: Array<{ stage: string; diagnostics: PipelineDiagnosticInput[] }> = [];
  const executionContext: PipelineExecutionContext = {
    mode: "submission",
    job,
    input: {
      enableVisualQualityValidation: false,
      enableGitPr: false,
      figmaSourceMode: "hybrid",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "legacy_use_state",
      projectName: "demo",
    },
    sourceJob,
    pipelineMetadata: PIPELINE_METADATA,
    runtime: {
      logLimit: 50,
      logger: {
        log: (entry) => {
          logEntries.push({
            level: entry.level,
            message: entry.message,
            ...(entry.stage ? { stage: entry.stage } : {}),
          });
        },
      },
    } as PipelineExecutionContext["runtime"],
    resolvedPaths: {
      outputRoot: "/tmp/output",
      jobsRoot: "/tmp/jobs",
      reprosRoot: "/tmp/repros",
    },
    resolvedWorkspaceRoot: "/workspace",
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: fetch,
    paths: {
      jobDir: "/tmp/job",
      generatedProjectDir: "/tmp/generated",
      figmaRawJsonFile: "/tmp/figma.raw.json",
      figmaJsonFile: "/tmp/figma.json",
      designIrFile: "/tmp/design-ir.json",
      figmaAnalysisFile: "/tmp/figma-analysis.json",
      stageTimingsFile: "/tmp/stage-timings.json",
      reproDir: "/tmp/repro",
      iconMapFilePath: "/tmp/icon-map.json",
      designSystemFilePath: "/tmp/design-system.json",
      irCacheDir: "/tmp/ir-cache",
      templateRoot: "/tmp/template",
      templateCopyFilter: () => true,
    },
    artifactStore: {} as PipelineExecutionContext["artifactStore"],
    diskTracker: {} as PipelineExecutionContext["diskTracker"],
    resolvedBrandTheme: "derived",
    resolvedCustomerBrandId: "brand-123",
    resolvedFigmaSourceMode: "hybrid",
    resolvedFormHandlingMode: "legacy_use_state",
    requestedStorybookStaticDir: "/requested/storybook",
    resolvedStorybookStaticDir: "/resolved/storybook",
    generationLocaleResolution: {
      locale: "de-DE",
      warningMessage: "locale fallback",
    },
    resolvedGenerationLocale: "de-DE",
    figmaFileKeyForDiagnostics: "figma-file-key",
    appendDiagnostics: ({ stage, diagnostics }) => {
      diagnosticsCalls.push({ stage, diagnostics });
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => undefined,
    ...overrides,
  };

  return { executionContext, logEntries, diagnosticsCalls };
};

test("createStageRuntimeContext propagates execution fields and omits unset optionals", () => {
  const { executionContext } = createExecutionContext({
    input: undefined,
    sourceJob: undefined,
    resolvedCustomerBrandId: undefined,
    requestedStorybookStaticDir: undefined,
    resolvedStorybookStaticDir: undefined,
    figmaFileKeyForDiagnostics: undefined,
  });

  const context = createStageRuntimeContext({
    executionContext,
    stage: "ir.derive",
  });

  assert.equal(context.mode, "submission");
  assert.equal(context.jobId, executionContext.job.jobId);
  assert.equal(context.job, executionContext.job);
  assert.deepEqual(context.pipelineMetadata, PIPELINE_METADATA);
  assert.equal(context.runtime, executionContext.runtime);
  assert.equal(context.paths, executionContext.paths);
  assert.equal(context.resolvedPaths, executionContext.resolvedPaths);
  assert.equal(context.resolvedWorkspaceRoot, "/workspace");
  assert.equal(context.abortSignal, executionContext.jobAbortController.signal);
  assert.equal(context.fetchWithCancellation, fetch);
  assert.equal(context.resolvedBrandTheme, "derived");
  assert.equal(context.resolvedFigmaSourceMode, "hybrid");
  assert.equal(context.resolvedFormHandlingMode, "legacy_use_state");
  assert.equal(context.resolvedGenerationLocale, "de-DE");
  assert.deepEqual(context.generationLocaleResolution, {
    locale: "de-DE",
    warningMessage: "locale fallback",
  });

  assert.equal("input" in context, false);
  assert.equal("sourceJob" in context, false);
  assert.equal("resolvedCustomerBrandId" in context, false);
  assert.equal("requestedStorybookStaticDir" in context, false);
  assert.equal("resolvedStorybookStaticDir" in context, false);
  assert.equal("figmaFileKeyForDiagnostics" in context, false);
});

test("createStageRuntimeContext applies stage overrides for logging and diagnostics", () => {
  const { executionContext, logEntries, diagnosticsCalls } = createExecutionContext();
  const context = createStageRuntimeContext({
    executionContext,
    stage: "figma.source",
  });

  context.log({
    level: "warn",
    message: "stage override log",
    stage: "codegen.generate",
  });

  context.appendDiagnostics({
    stage: "template.prepare",
    diagnostics: [
      {
        code: "A",
        message: "needs a stage",
        suggestion: "add one",
        severity: "info",
      },
      {
        code: "B",
        message: "keeps explicit stage",
        suggestion: "leave it",
        severity: "warning",
        stage: "validate.project",
      },
    ],
  });

  assert.deepEqual(logEntries, [
    {
      level: "warn",
      message: "stage override log",
      stage: "codegen.generate",
    },
  ]);
  assert.deepEqual(diagnosticsCalls, [
    {
      stage: "template.prepare",
      diagnostics: [
        {
          code: "A",
          message: "needs a stage",
          suggestion: "add one",
          severity: "info",
          stage: "template.prepare",
        },
        {
          code: "B",
          message: "keeps explicit stage",
          suggestion: "leave it",
          severity: "warning",
          stage: "validate.project",
        },
      ],
    },
  ]);
});
