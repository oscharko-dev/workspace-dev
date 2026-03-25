import type { WorkspaceGenerationDiffReport, WorkspaceGitPrStatus } from "../../contracts/index.js";
import type { JobRecord } from "../types.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import type { StageArtifactStore } from "./artifact-store.js";

export const syncPublicJobProjection = async ({
  job,
  artifactStore
}: {
  job: JobRecord;
  artifactStore: StageArtifactStore;
}): Promise<void> => {
  const figmaJsonFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaCleaned);
  if (figmaJsonFile) {
    job.artifacts.figmaJsonFile = figmaJsonFile;
  }

  const designIrFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr);
  if (designIrFile) {
    job.artifacts.designIrFile = designIrFile;
  }

  const generatedProjectDir = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject);
  if (generatedProjectDir) {
    job.artifacts.generatedProjectDir = generatedProjectDir;
  }

  const generationMetricsFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationMetrics);
  if (generationMetricsFile) {
    job.artifacts.generationMetricsFile = generationMetricsFile;
  } else {
    delete job.artifacts.generationMetricsFile;
  }

  const componentManifestFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentManifest);
  if (componentManifestFile) {
    job.artifacts.componentManifestFile = componentManifestFile;
  } else {
    delete job.artifacts.componentManifestFile;
  }

  const generationDiffFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generationDiffFile);
  if (generationDiffFile) {
    job.artifacts.generationDiffFile = generationDiffFile;
  } else {
    delete job.artifacts.generationDiffFile;
  }

  const reproDir = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.reproPath);
  if (reproDir) {
    job.artifacts.reproDir = reproDir;
  }

  const generationDiff = await artifactStore.getValue<WorkspaceGenerationDiffReport>(
    STAGE_ARTIFACT_KEYS.generationDiff
  );
  if (generationDiff) {
    job.generationDiff = generationDiff;
  } else {
    delete job.generationDiff;
  }

  const gitPrStatus = await artifactStore.getValue<WorkspaceGitPrStatus>(STAGE_ARTIFACT_KEYS.gitPrStatus);
  if (gitPrStatus) {
    job.gitPr = gitPrStatus;
  } else {
    delete job.gitPr;
  }
};
