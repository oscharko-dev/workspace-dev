import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso } from "../stage-state.js";
import type { JobRecord } from "../types.js";
import { StageArtifactStore } from "./artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import { syncPublicJobProjection } from "./public-job-projection.js";

const createJob = async (): Promise<{ job: JobRecord; artifactStore: StageArtifactStore; jobDir: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-public-projection-"));
  const runtime = resolveRuntimeSettings({ enablePreview: false });
  const jobDir = path.join(root, "jobs", "job-1");
  await mkdir(jobDir, { recursive: true });

  return {
    job: {
      jobId: "job-1",
      status: "queued",
      submittedAt: nowIso(),
      request: {
        enableGitPr: false,
        figmaSourceMode: "local_json",
        llmCodegenMode: "deterministic",
        brandTheme: "derived",
        generationLocale: "en-US",
        formHandlingMode: "react_hook_form"
      },
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: root,
        jobDir,
        figmaAnalysisFile: path.join(jobDir, "stale-figma-analysis.json"),
        generationMetricsFile: path.join(jobDir, "stale-generation-metrics.json"),
        componentManifestFile: path.join(jobDir, "stale-component-manifest.json"),
        generationDiffFile: path.join(jobDir, "stale-generation-diff.json"),
        storybookTokensFile: path.join(jobDir, "stale-storybook-tokens.json"),
        storybookThemesFile: path.join(jobDir, "stale-storybook-themes.json"),
        storybookComponentsFile: path.join(jobDir, "stale-storybook-components.json"),
        figmaLibraryResolutionFile: path.join(jobDir, "stale-figma-library-resolution.json"),
        componentMatchReportFile: path.join(jobDir, "stale-component-match-report.json"),
        validationSummaryFile: path.join(jobDir, "stale-validation-summary.json")
      },
      preview: { enabled: false },
      queue: {
        runningCount: 0,
        queuedCount: 0,
        maxConcurrentJobs: runtime.maxConcurrentJobs,
        maxQueuedJobs: runtime.maxQueuedJobs
      },
      generationDiff: {
        summary: "stale diff"
      },
      gitPr: {
        status: "skipped",
        reason: "stale"
      }
    },
    artifactStore: new StageArtifactStore({ jobDir }),
    jobDir
  };
};

test("syncPublicJobProjection maps stage artifacts back into public job fields and clears stale optional fields", async () => {
  const { job, artifactStore, jobDir } = await createJob();
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const designIrFile = path.join(jobDir, "design-ir.json");
  const figmaAnalysisFile = path.join(jobDir, "figma-analysis.json");
  const figmaJsonFile = path.join(jobDir, "figma.json");
  const reproDir = path.join(jobDir, "repro");
  const storybookTokensFile = path.join(jobDir, "storybook", "public", "tokens.json");
  const storybookThemesFile = path.join(jobDir, "storybook", "public", "themes.json");
  const storybookComponentsFile = path.join(jobDir, "storybook", "public", "components.json");
  const figmaLibraryResolutionFile = path.join(jobDir, "storybook", "public", "figma-library-resolution.json");
  const componentMatchReportFile = path.join(jobDir, "storybook", "public", "component-match-report.json");
  const validationSummaryFile = path.join(jobDir, "validation-summary.json");

  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaCleaned,
    stage: "figma.source",
    absolutePath: figmaJsonFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    absolutePath: designIrFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
    stage: "ir.derive",
    absolutePath: figmaAnalysisFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: generatedProjectDir
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.reproPath,
    stage: "repro.export",
    absolutePath: reproDir
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    stage: "ir.derive",
    absolutePath: storybookTokensFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    stage: "ir.derive",
    absolutePath: storybookThemesFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    stage: "ir.derive",
    absolutePath: storybookComponentsFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    stage: "ir.derive",
    absolutePath: figmaLibraryResolutionFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    stage: "ir.derive",
    absolutePath: componentMatchReportFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.validationSummaryFile,
    stage: "validate.project",
    absolutePath: validationSummaryFile
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiff,
    stage: "codegen.generate",
    value: {
      summary: "fresh diff"
    }
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.gitPrStatus,
    stage: "git.pr",
    value: {
      status: "executed",
      branchName: "feature/public-projection",
      scopePath: "src",
      changedFiles: 3
    }
  });

  await syncPublicJobProjection({ job, artifactStore });

  assert.equal(job.artifacts.figmaJsonFile, figmaJsonFile);
  assert.equal(job.artifacts.designIrFile, designIrFile);
  assert.equal(job.artifacts.figmaAnalysisFile, figmaAnalysisFile);
  assert.equal(job.artifacts.generatedProjectDir, generatedProjectDir);
  assert.equal(job.artifacts.reproDir, reproDir);
  assert.equal(job.artifacts.generationMetricsFile, undefined);
  assert.equal(job.artifacts.componentManifestFile, undefined);
  assert.equal(job.artifacts.generationDiffFile, undefined);
  assert.equal(job.artifacts.storybookTokensFile, storybookTokensFile);
  assert.equal(job.artifacts.storybookThemesFile, storybookThemesFile);
  assert.equal(job.artifacts.storybookComponentsFile, storybookComponentsFile);
  assert.equal(job.artifacts.figmaLibraryResolutionFile, figmaLibraryResolutionFile);
  assert.equal(job.artifacts.componentMatchReportFile, componentMatchReportFile);
  assert.equal(job.artifacts.validationSummaryFile, validationSummaryFile);
  assert.deepEqual(job.generationDiff, { summary: "fresh diff" });
  assert.deepEqual(job.gitPr, {
    status: "executed",
    branchName: "feature/public-projection",
    scopePath: "src",
    changedFiles: 3
  });
});
