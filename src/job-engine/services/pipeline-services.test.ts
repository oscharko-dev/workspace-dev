import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PipelineExecutionContext } from "../pipeline/context.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { buildRegenerationPipelinePlan, buildSubmissionPipelinePlan } from "./pipeline-services.js";

const toStageNames = (plan: ReturnType<typeof buildSubmissionPipelinePlan>): string[] => {
  return plan.map((entry) => entry.service.stageName);
};

const createPlanContext = async (
  overrides: Partial<PipelineExecutionContext> = {}
): Promise<PipelineExecutionContext> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-pipeline-plan-"));
  const jobDir = path.join(root, "jobs", "job-1");
  await mkdir(jobDir, { recursive: true });

  return {
    mode: "submission",
    job: {
      jobId: "job-1",
      status: "queued",
      submittedAt: new Date().toISOString(),
      request: {
        enableGitPr: false,
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
        brandTheme: "derived",
        generationLocale: "en-US",
        formHandlingMode: "react_hook_form"
      },
      stages: [],
      logs: [],
      artifacts: {
        outputRoot: root,
        jobDir
      },
      preview: { enabled: false },
      queue: {
        runningCount: 0,
        queuedCount: 0,
        maxConcurrentJobs: 1,
        maxQueuedJobs: 1
      }
    },
    input: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      figmaJsonPath: "/tmp/local.json"
    },
    runtime: {
      previewEnabled: false
    } as PipelineExecutionContext["runtime"],
    resolvedPaths: {
      outputRoot: root,
      jobsRoot: path.join(root, "jobs"),
      reprosRoot: path.join(root, "repros")
    } as PipelineExecutionContext["resolvedPaths"],
    resolvedWorkspaceRoot: root,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: fetch,
    paths: {
      jobDir,
      generatedProjectDir: path.join(jobDir, "generated-app"),
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir: path.join(root, "repros", "job-1"),
      iconMapFilePath: path.join(root, "icon-map.json"),
      designSystemFilePath: path.join(root, "design-system.json"),
      irCacheDir: path.join(root, "cache", "ir"),
      templateRoot: path.join(root, "template"),
      templateCopyFilter: () => true
    },
    artifactStore: new StageArtifactStore({ jobDir }),
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: { locale: "en-US" },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op for plan tests
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      // no-op for plan tests
    },
    ...overrides
  } as PipelineExecutionContext;
};

test("submission pipeline plan keeps all seven stages in canonical order", () => {
  const plan = buildSubmissionPipelinePlan();
  assert.deepEqual(toStageNames(plan), [
    "figma.source",
    "ir.derive",
    "template.prepare",
    "codegen.generate",
    "validate.project",
    "repro.export",
    "git.pr"
  ]);
});

test("submission pipeline plan declares store contracts for codegen and git.pr", async () => {
  const plan = buildSubmissionPipelinePlan();
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");
  const gitPrEntry = plan.find((entry) => entry.service.stageName === "git.pr");
  const context = await createPlanContext({
    input: {
      enableGitPr: false,
      figmaFileKey: "abc123",
      figmaAccessToken: "token"
    }
  });

  assert.deepEqual(codegenEntry?.artifacts?.reads, [STAGE_ARTIFACT_KEYS.designIr]);
  assert.deepEqual(codegenEntry?.artifacts?.writes, [
    STAGE_ARTIFACT_KEYS.generatedProject,
    STAGE_ARTIFACT_KEYS.codegenSummary
  ]);
  assert.equal(
    gitPrEntry?.shouldSkip?.(context),
    "Git/PR flow disabled by request."
  );
  await gitPrEntry?.onSkipped?.(context, "Git/PR flow disabled by request.");
  assert.deepEqual(await context.artifactStore.getValue(STAGE_ARTIFACT_KEYS.gitPrStatus), {
    status: "skipped",
    reason: "Git/PR flow disabled by request."
  });
});

test("regeneration pipeline plan keeps order and encodes seeded artifact contracts", async () => {
  const plan = buildRegenerationPipelinePlan();
  const context = await createPlanContext({
    mode: "regeneration",
    regenerationInput: { sourceJobId: "source-1", overrides: [] },
    sourceJob: {
      jobId: "source-1",
      status: "completed",
      submittedAt: new Date().toISOString(),
      request: {
        enableGitPr: false,
        figmaSourceMode: "rest",
        llmCodegenMode: "deterministic",
        brandTheme: "derived",
        generationLocale: "en-US",
        formHandlingMode: "react_hook_form",
        figmaFileKey: "source-file-key"
      },
      stages: [],
      logs: [],
      artifacts: {
        outputRoot: "/tmp",
        jobDir: "/tmp/source-job"
      },
      preview: { enabled: false },
      queue: {
        runningCount: 0,
        queuedCount: 0,
        maxConcurrentJobs: 1,
        maxQueuedJobs: 1
      }
    } as PipelineExecutionContext["sourceJob"]
  });
  const figmaEntry = plan.find((entry) => entry.service.stageName === "figma.source");
  const irEntry = plan.find((entry) => entry.service.stageName === "ir.derive");
  const gitPrEntry = plan.find((entry) => entry.service.stageName === "git.pr");
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");

  assert.deepEqual(toStageNames(plan), [
    "figma.source",
    "ir.derive",
    "template.prepare",
    "codegen.generate",
    "validate.project",
    "repro.export",
    "git.pr"
  ]);
  assert.equal(
    figmaEntry?.shouldSkip?.(context),
    "Reusing source from job 'source-1'."
  );
  assert.deepEqual(irEntry?.artifacts?.reads, [
    STAGE_ARTIFACT_KEYS.regenerationSourceIr,
    STAGE_ARTIFACT_KEYS.regenerationOverrides
  ]);
  assert.equal(
    codegenEntry?.resolveInput?.(context as PipelineExecutionContext) instanceof Promise,
    false
  );
  assert.equal(
    gitPrEntry?.shouldSkip?.(context),
    "Git/PR flow not applicable for regeneration jobs."
  );
});
