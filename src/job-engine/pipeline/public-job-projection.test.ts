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
        enableVisualQualityValidation: false,
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
        componentVisualCatalogFile: path.join(jobDir, "stale-component-visual-catalog.json"),
        figmaLibraryResolutionFile: path.join(jobDir, "stale-figma-library-resolution.json"),
        componentMatchReportFile: path.join(jobDir, "stale-component-match-report.json"),
        validationSummaryFile: path.join(jobDir, "stale-validation-summary.json"),
        visualAuditReferenceImageFile: path.join(jobDir, "stale-visual-reference.png"),
        visualAuditActualImageFile: path.join(jobDir, "stale-visual-actual.png"),
        visualAuditDiffImageFile: path.join(jobDir, "stale-visual-diff.png"),
        visualAuditReportFile: path.join(jobDir, "stale-visual-report.json"),
        visualQualityReportFile: path.join(jobDir, "stale-visual-quality-report.json")
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
      visualAudit: {
        status: "failed",
        warnings: ["stale visual audit"]
      },
      visualQuality: {
        status: "completed",
        referenceSource: "frozen_fixture",
        capturedAt: "2026-01-01T00:00:00.000Z",
        overallScore: 0,
        interpretation: "stale",
        dimensions: [],
        diffImagePath: "stale-diff.png",
        hotspots: [],
        metadata: {
          comparedAt: "2026-01-01T00:00:00.000Z",
          imageWidth: 1,
          imageHeight: 1,
          totalPixels: 1,
          diffPixelCount: 0,
          configuredWeights: { layoutAccuracy: 0.3, colorFidelity: 0.25, typography: 0.2, componentStructure: 0.15, spacingAlignment: 0.1 },
          viewport: { width: 1, height: 1, deviceScaleFactor: 1 },
          versions: { packageVersion: "0.0.0", contractVersion: "0.0.0" }
        }
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
  const componentVisualCatalogFile = path.join(jobDir, "storybook", "public", "storybook.component-visual-catalog.json");
  const figmaLibraryResolutionFile = path.join(jobDir, "storybook", "public", "figma-library-resolution.json");
  const componentMatchReportFile = path.join(jobDir, "storybook", "public", "component-match-report.json");
  const validationSummaryFile = path.join(jobDir, "validation-summary.json");
  const visualAuditReferenceImageFile = path.join(jobDir, "visual-audit", "reference.png");
  const visualAuditActualImageFile = path.join(jobDir, "visual-audit", "actual.png");
  const visualAuditDiffImageFile = path.join(jobDir, "visual-audit", "diff.png");
  const visualAuditReportFile = path.join(jobDir, "visual-audit", "report.json");
  const visualQualityReportFile = path.join(jobDir, "visual-quality", "report.json");

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
    key: STAGE_ARTIFACT_KEYS.componentVisualCatalog,
    stage: "ir.derive",
    absolutePath: componentVisualCatalogFile
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
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
    stage: "validate.project",
    absolutePath: visualAuditReferenceImageFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditActualImage,
    stage: "validate.project",
    absolutePath: visualAuditActualImageFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
    stage: "validate.project",
    absolutePath: visualAuditDiffImageFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditReport,
    stage: "validate.project",
    absolutePath: visualAuditReportFile
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.visualQualityReport,
    stage: "validate.project",
    absolutePath: visualQualityReportFile
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.generationDiff,
    stage: "codegen.generate",
    value: {
      summary: "fresh diff"
    }
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.visualAuditResult,
    stage: "validate.project",
    value: {
      status: "warn",
      baselineImagePath: "fixtures/visual-baseline.png",
      actualImagePath: visualAuditActualImageFile,
      diffImagePath: visualAuditDiffImageFile,
      reportPath: visualAuditReportFile,
      diffPixelCount: 3,
      totalPixels: 16,
      warnings: ["visual differences detected"]
    }
  });
  await artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.visualQualityResult,
    stage: "validate.project",
    value: {
      status: "completed",
      referenceSource: "frozen_fixture",
      capturedAt: "2026-04-08T00:00:00.000Z",
      overallScore: 87.5,
      componentAggregateScore: 81.25,
      componentCoverage: {
        comparedCount: 2,
        skippedCount: 1,
        coveragePercent: 66.7,
        bySkipReason: {
          ambiguous: 1
        }
      },
      components: [
        {
          componentId: "button::button--primary",
          componentName: "Primary Button",
          status: "compared",
          score: 84,
          storyEntryId: "button--primary",
          referenceNodeId: "1:2",
          warnings: ["minor spacing drift"]
        },
        {
          componentId: "input::input--docs",
          componentName: "Input Docs",
          status: "skipped",
          skipReason: "docs_only"
        }
      ],
      interpretation: "Good",
      dimensions: [],
      diffImagePath: visualAuditDiffImageFile,
      hotspots: [],
      metadata: {
        comparedAt: "2026-04-08T00:00:00.000Z",
        imageWidth: 4,
        imageHeight: 4,
        totalPixels: 16,
        diffPixelCount: 2,
        configuredWeights: { layoutAccuracy: 0.3, colorFidelity: 0.25, typography: 0.2, componentStructure: 0.15, spacingAlignment: 0.1 },
        viewport: { width: 4, height: 4, deviceScaleFactor: 1 },
        versions: { packageVersion: "1.0.0", contractVersion: "3.8.0" }
      }
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
  assert.equal(job.artifacts.componentVisualCatalogFile, componentVisualCatalogFile);
  assert.equal(job.artifacts.figmaLibraryResolutionFile, figmaLibraryResolutionFile);
  assert.equal(job.artifacts.componentMatchReportFile, componentMatchReportFile);
  assert.equal(job.artifacts.validationSummaryFile, validationSummaryFile);
  assert.equal(job.artifacts.visualAuditReferenceImageFile, visualAuditReferenceImageFile);
  assert.equal(job.artifacts.visualAuditActualImageFile, visualAuditActualImageFile);
  assert.equal(job.artifacts.visualAuditDiffImageFile, visualAuditDiffImageFile);
  assert.equal(job.artifacts.visualAuditReportFile, visualAuditReportFile);
  assert.equal(job.artifacts.visualQualityReportFile, visualQualityReportFile);
  assert.deepEqual(job.generationDiff, { summary: "fresh diff" });
  assert.deepEqual(job.visualAudit, {
    status: "warn",
    baselineImagePath: "fixtures/visual-baseline.png",
    actualImagePath: visualAuditActualImageFile,
    diffImagePath: visualAuditDiffImageFile,
    reportPath: visualAuditReportFile,
    diffPixelCount: 3,
    totalPixels: 16,
    warnings: ["visual differences detected"]
  });
  assert.equal(job.visualQuality?.status, "completed");
  assert.equal(job.visualQuality?.referenceSource, "frozen_fixture");
  assert.equal(job.visualQuality?.capturedAt, "2026-04-08T00:00:00.000Z");
  assert.equal(job.visualQuality?.overallScore, 87.5);
  assert.equal(job.visualQuality?.componentAggregateScore, 81.25);
  assert.deepEqual(job.visualQuality?.componentCoverage, {
    comparedCount: 2,
    skippedCount: 1,
    coveragePercent: 66.7,
    bySkipReason: {
      ambiguous: 1
    }
  });
  assert.deepEqual(job.visualQuality?.components, [
    {
      componentId: "button::button--primary",
      componentName: "Primary Button",
      status: "compared",
      score: 84,
      storyEntryId: "button--primary",
      referenceNodeId: "1:2",
      warnings: ["minor spacing drift"]
    },
    {
      componentId: "input::input--docs",
      componentName: "Input Docs",
      status: "skipped",
      skipReason: "docs_only"
    }
  ]);
  assert.equal(job.visualQuality?.interpretation, "Good");
  assert.equal(job.visualQuality?.diffImagePath, visualAuditDiffImageFile);
  assert.deepEqual(job.gitPr, {
    status: "executed",
    branchName: "feature/public-projection",
    scopePath: "src",
    changedFiles: 3
  });
});

test("syncPublicJobProjection clears stale visualQuality when no artifact is stored", async () => {
  const { job, artifactStore } = await createJob();

  await syncPublicJobProjection({ job, artifactStore });

  assert.equal(job.visualQuality, undefined);
});
