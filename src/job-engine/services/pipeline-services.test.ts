import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PipelineExecutionContext } from "../pipeline/context.js";
import { StageArtifactStore } from "../pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { STAGE_ORDER } from "../stage-state.js";
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
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
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
  assert.deepEqual(toStageNames(plan), STAGE_ORDER);
});

test("submission pipeline plan declares diff ownership across codegen, validate, and git.pr", async () => {
  const plan = buildSubmissionPipelinePlan();
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");
  const validateEntry = plan.find((entry) => entry.service.stageName === "validate.project");
  const reproExportEntry = plan.find((entry) => entry.service.stageName === "repro.export");
  const gitPrEntry = plan.find((entry) => entry.service.stageName === "git.pr");
  const context = await createPlanContext({
    input: {
      enableGitPr: false,
      figmaFileKey: "abc123",
      figmaAccessToken: "token"
    }
  });

  assert.deepEqual(codegenEntry?.artifacts?.reads, [STAGE_ARTIFACT_KEYS.designIr]);
  assert.deepEqual(await codegenEntry?.resolveArtifacts?.(context), {
    reads: [],
    optionalReads: [STAGE_ARTIFACT_KEYS.figmaLibraryResolution]
  });
  assert.deepEqual(
    plan.find((entry) => entry.service.stageName === "ir.derive")?.artifacts?.writes,
    [
      STAGE_ARTIFACT_KEYS.designIr,
      STAGE_ARTIFACT_KEYS.figmaAnalysis,
      STAGE_ARTIFACT_KEYS.businessTestIntentIr
    ]
  );
  assert.deepEqual(
    plan.find((entry) => entry.service.stageName === "ir.derive")?.artifacts?.optionalWrites,
    [
      STAGE_ARTIFACT_KEYS.llmCapabilitiesEvidence,
      STAGE_ARTIFACT_KEYS.storybookCatalog,
      STAGE_ARTIFACT_KEYS.storybookEvidence,
      STAGE_ARTIFACT_KEYS.storybookTokens,
      STAGE_ARTIFACT_KEYS.storybookThemes,
      STAGE_ARTIFACT_KEYS.storybookComponents,
      STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
      STAGE_ARTIFACT_KEYS.componentMatchReport,
      STAGE_ARTIFACT_KEYS.figmaScreenshotReferences,
      STAGE_ARTIFACT_KEYS.figmaScreenshotPipelineReport
    ]
  );
  assert.deepEqual(codegenEntry?.artifacts?.writes, [
    STAGE_ARTIFACT_KEYS.generatedProject,
    STAGE_ARTIFACT_KEYS.codegenSummary
  ]);
  assert.deepEqual(codegenEntry?.artifacts?.optionalWrites, [
    STAGE_ARTIFACT_KEYS.generationMetrics,
    STAGE_ARTIFACT_KEYS.componentManifest,
    STAGE_ARTIFACT_KEYS.generationDiffContext
  ]);
  assert.deepEqual(validateEntry?.artifacts?.reads, [
    STAGE_ARTIFACT_KEYS.generatedProject,
    STAGE_ARTIFACT_KEYS.generationDiffContext
  ]);
  assert.deepEqual(validateEntry?.artifacts?.optionalReads, [
    STAGE_ARTIFACT_KEYS.storybookCatalog,
    STAGE_ARTIFACT_KEYS.storybookEvidence,
    STAGE_ARTIFACT_KEYS.storybookTokens,
      STAGE_ARTIFACT_KEYS.storybookThemes,
      STAGE_ARTIFACT_KEYS.storybookComponents,
      STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
      STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
      STAGE_ARTIFACT_KEYS.componentMatchReport,
      STAGE_ARTIFACT_KEYS.figmaScreenshotReferences
  ]);
  assert.deepEqual(validateEntry?.artifacts?.writes, [
    STAGE_ARTIFACT_KEYS.validationSummary,
    STAGE_ARTIFACT_KEYS.validationSummaryFile
  ]);
  assert.deepEqual(validateEntry?.artifacts?.optionalWrites, [
    STAGE_ARTIFACT_KEYS.generationDiff,
    STAGE_ARTIFACT_KEYS.generationDiffFile,
    STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
    STAGE_ARTIFACT_KEYS.visualAuditActualImage,
    STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
    STAGE_ARTIFACT_KEYS.visualAuditReport,
    STAGE_ARTIFACT_KEYS.visualAuditResult,
    STAGE_ARTIFACT_KEYS.visualQualityResult
  ]);
  assert.deepEqual(gitPrEntry?.artifacts?.reads, [
    STAGE_ARTIFACT_KEYS.generatedProject,
    STAGE_ARTIFACT_KEYS.generationDiff
  ]);
  assert.deepEqual(gitPrEntry?.artifacts?.skipWrites, [STAGE_ARTIFACT_KEYS.gitPrStatus]);
  assert.equal(reproExportEntry?.artifacts?.skipWrites, undefined);
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

test("submission figma.source contract requires figma.raw only for local_json mode", async () => {
  const plan = buildSubmissionPipelinePlan();
  const figmaEntry = plan.find((entry) => entry.service.stageName === "figma.source");
  const localContext = await createPlanContext({
    input: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      figmaJsonPath: "/tmp/local.json"
    },
    resolvedFigmaSourceMode: "local_json"
  });
  const restContext = await createPlanContext({
    input: {
      enableGitPr: false,
      figmaSourceMode: "rest",
      figmaFileKey: "abc123",
      figmaAccessToken: "token"
    },
    resolvedFigmaSourceMode: "rest"
  });

  assert.deepEqual((await figmaEntry?.resolveArtifacts?.(localContext))?.writes, [
    STAGE_ARTIFACT_KEYS.figmaCleaned,
    STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
    STAGE_ARTIFACT_KEYS.figmaCleanedReport,
    STAGE_ARTIFACT_KEYS.figmaRaw
  ]);
  assert.deepEqual((await figmaEntry?.resolveArtifacts?.(restContext))?.writes, [
    STAGE_ARTIFACT_KEYS.figmaCleaned,
    STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
    STAGE_ARTIFACT_KEYS.figmaCleanedReport
  ]);
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
  const reproExportEntry = plan.find((entry) => entry.service.stageName === "repro.export");
  const gitPrEntry = plan.find((entry) => entry.service.stageName === "git.pr");
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");
  const validateEntry = plan.find((entry) => entry.service.stageName === "validate.project");

  assert.deepEqual(toStageNames(plan), STAGE_ORDER);
  assert.equal(
    figmaEntry?.shouldSkip?.(context),
    "Reusing source from job 'source-1'."
  );
  assert.deepEqual(irEntry?.artifacts?.reads, [
    STAGE_ARTIFACT_KEYS.regenerationSourceIr,
    STAGE_ARTIFACT_KEYS.regenerationOverrides
  ]);
  assert.deepEqual(irEntry?.artifacts?.writes, [
    STAGE_ARTIFACT_KEYS.designIr,
    STAGE_ARTIFACT_KEYS.figmaAnalysis,
    STAGE_ARTIFACT_KEYS.businessTestIntentIr
  ]);
  assert.deepEqual(irEntry?.artifacts?.optionalWrites, [
    STAGE_ARTIFACT_KEYS.storybookCatalog,
    STAGE_ARTIFACT_KEYS.storybookEvidence,
    STAGE_ARTIFACT_KEYS.storybookTokens,
    STAGE_ARTIFACT_KEYS.storybookThemes,
    STAGE_ARTIFACT_KEYS.storybookComponents,
    STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    STAGE_ARTIFACT_KEYS.componentMatchReport
  ]);
  assert.equal(
    codegenEntry?.resolveInput?.(context as PipelineExecutionContext) instanceof Promise,
    false
  );
  assert.deepEqual(codegenEntry?.artifacts?.optionalWrites, [
    STAGE_ARTIFACT_KEYS.generationMetrics,
    STAGE_ARTIFACT_KEYS.componentManifest,
    STAGE_ARTIFACT_KEYS.generationDiffContext
  ]);
  assert.deepEqual(validateEntry?.artifacts?.reads, [
    STAGE_ARTIFACT_KEYS.generatedProject,
    STAGE_ARTIFACT_KEYS.generationDiffContext
  ]);
  assert.deepEqual(validateEntry?.artifacts?.optionalReads, [
    STAGE_ARTIFACT_KEYS.storybookCatalog,
    STAGE_ARTIFACT_KEYS.storybookEvidence,
    STAGE_ARTIFACT_KEYS.storybookTokens,
    STAGE_ARTIFACT_KEYS.storybookThemes,
    STAGE_ARTIFACT_KEYS.storybookComponents,
    STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    STAGE_ARTIFACT_KEYS.componentMatchReport
  ]);
  assert.deepEqual(validateEntry?.artifacts?.writes, [
    STAGE_ARTIFACT_KEYS.validationSummary,
    STAGE_ARTIFACT_KEYS.validationSummaryFile
  ]);
  assert.deepEqual(validateEntry?.artifacts?.optionalWrites, [
    STAGE_ARTIFACT_KEYS.generationDiff,
    STAGE_ARTIFACT_KEYS.generationDiffFile,
    STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
    STAGE_ARTIFACT_KEYS.visualAuditActualImage,
    STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
    STAGE_ARTIFACT_KEYS.visualAuditReport,
    STAGE_ARTIFACT_KEYS.visualAuditResult,
    STAGE_ARTIFACT_KEYS.visualQualityResult
  ]);
  assert.equal(
    gitPrEntry?.shouldSkip?.(context),
    "Git/PR flow not applicable for regeneration jobs."
  );
  assert.deepEqual(gitPrEntry?.artifacts?.skipWrites, [STAGE_ARTIFACT_KEYS.gitPrStatus]);
  assert.equal(reproExportEntry?.artifacts?.skipWrites, undefined);
});

test("submission pipeline codegen contract requires storybook-first artifacts when Storybook input is active", async () => {
  const plan = buildSubmissionPipelinePlan();
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");
  const context = await createPlanContext({
    requestedStorybookStaticDir: "storybook-static/customer",
    resolvedStorybookStaticDir: "/tmp/storybook-static/customer"
  });

  assert.deepEqual(await codegenEntry?.resolveArtifacts?.(context), {
    reads: [
      STAGE_ARTIFACT_KEYS.storybookTokens,
      STAGE_ARTIFACT_KEYS.storybookThemes,
      STAGE_ARTIFACT_KEYS.componentMatchReport
    ],
    optionalReads: [STAGE_ARTIFACT_KEYS.figmaLibraryResolution]
  });
});

test("submission pipeline codegen contract requires figma.analysis for pattern component mappings", async () => {
  const plan = buildSubmissionPipelinePlan();
  const codegenEntry = plan.find((entry) => entry.service.stageName === "codegen.generate");
  const context = await createPlanContext({
    input: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      figmaJsonPath: "/tmp/local.json",
      componentMappings: [
        {
          boardKey: "board-key",
          nodeNamePattern: "Primary Button",
          componentName: "CustomerButton",
          importPath: "@customer/components",
          priority: 1,
          source: "local_override",
          enabled: true
        }
      ]
    }
  });

  assert.deepEqual(await codegenEntry?.resolveArtifacts?.(context), {
    reads: [STAGE_ARTIFACT_KEYS.figmaAnalysis],
    optionalReads: [STAGE_ARTIFACT_KEYS.figmaLibraryResolution]
  });
});

test("pipeline plans keep the canonical seven stages without introducing a customer_storybook plan", () => {
  const submissionStageNames = toStageNames(buildSubmissionPipelinePlan());
  const regenerationStageNames = toStageNames(buildRegenerationPipelinePlan());

  assert.deepEqual(submissionStageNames, STAGE_ORDER);
  assert.deepEqual(regenerationStageNames, STAGE_ORDER);
  assert.equal(submissionStageNames.includes("customer_storybook"), false);
  assert.equal(regenerationStageNames.includes("customer_storybook"), false);
});
