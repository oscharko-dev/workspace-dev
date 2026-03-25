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
        generationMetricsFile: path.join(jobDir, "stale-generation-metrics.json"),
        componentManifestFile: path.join(jobDir, "stale-component-manifest.json"),
        generationDiffFile: path.join(jobDir, "stale-generation-diff.json")
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
  const figmaJsonFile = path.join(jobDir, "figma.json");
  const reproDir = path.join(jobDir, "repro");

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
    key: STAGE_ARTIFACT_KEYS.generatedProject,
    stage: "template.prepare",
    absolutePath: generatedProjectDir
  });
  await artifactStore.setPath({
    key: STAGE_ARTIFACT_KEYS.reproPath,
    stage: "repro.export",
    absolutePath: reproDir
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
  assert.equal(job.artifacts.generatedProjectDir, generatedProjectDir);
  assert.equal(job.artifacts.reproDir, reproDir);
  assert.equal(job.artifacts.generationMetricsFile, undefined);
  assert.equal(job.artifacts.componentManifestFile, undefined);
  assert.equal(job.artifacts.generationDiffFile, undefined);
  assert.deepEqual(job.generationDiff, { summary: "fresh diff" });
  assert.deepEqual(job.gitPr, {
    status: "executed",
    branchName: "feature/public-projection",
    scopePath: "src",
    changedFiles: 3
  });
});
