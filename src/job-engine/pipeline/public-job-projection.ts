import type {
  WorkspaceCompositeQualityReport,
  WorkspaceGenerationDiffReport,
  WorkspaceGitPrStatus,
  WorkspaceJobConfidence,
  WorkspaceVisualAuditResult,
  WorkspaceVisualQualityReport,
} from "../../contracts/index.js";
import type { JobRecord } from "../types.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import type { StageArtifactStore } from "./artifact-store.js";

export const syncPublicJobProjection = async ({
  job,
  artifactStore,
}: {
  job: JobRecord;
  artifactStore: StageArtifactStore;
}): Promise<void> => {
  const jobWithVisualAudit = job as JobRecord & {
    visualAudit?: WorkspaceVisualAuditResult;
  };

  const syncOptionalArtifactPath = async ({
    key,
    assign,
    clear,
  }: {
    key: string;
    assign: (value: string) => void;
    clear: () => void;
  }): Promise<void> => {
    const artifactPath = await artifactStore.getPath(key);
    if (artifactPath) {
      assign(artifactPath);
      return;
    }
    clear();
  };

  const figmaJsonFile = await artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.figmaCleaned,
  );
  if (figmaJsonFile) {
    job.artifacts.figmaJsonFile = figmaJsonFile;
  }

  const designIrFile = await artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.designIr,
  );
  if (designIrFile) {
    job.artifacts.designIrFile = designIrFile;
  }

  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
    assign: (value) => {
      job.artifacts.figmaAnalysisFile = value;
    },
    clear: () => {
      delete job.artifacts.figmaAnalysisFile;
    },
  });

  const generatedProjectDir = await artifactStore.getPath(
    STAGE_ARTIFACT_KEYS.generatedProject,
  );
  if (generatedProjectDir) {
    job.artifacts.generatedProjectDir = generatedProjectDir;
  }

  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.generationMetrics,
    assign: (value) => {
      job.artifacts.generationMetricsFile = value;
    },
    clear: () => {
      delete job.artifacts.generationMetricsFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.componentManifest,
    assign: (value) => {
      job.artifacts.componentManifestFile = value;
    },
    clear: () => {
      delete job.artifacts.componentManifestFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    assign: (value) => {
      job.artifacts.storybookTokensFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookTokensFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    assign: (value) => {
      job.artifacts.storybookThemesFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookThemesFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    assign: (value) => {
      job.artifacts.storybookComponentsFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookComponentsFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.componentVisualCatalog,
    assign: (value) => {
      job.artifacts.componentVisualCatalogFile = value;
    },
    clear: () => {
      delete job.artifacts.componentVisualCatalogFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    assign: (value) => {
      job.artifacts.figmaLibraryResolutionFile = value;
    },
    clear: () => {
      delete job.artifacts.figmaLibraryResolutionFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    assign: (value) => {
      job.artifacts.componentMatchReportFile = value;
    },
    clear: () => {
      delete job.artifacts.componentMatchReportFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.generationDiffFile,
    assign: (value) => {
      job.artifacts.generationDiffFile = value;
    },
    clear: () => {
      delete job.artifacts.generationDiffFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
    assign: (value) => {
      job.artifacts.visualAuditReferenceImageFile = value;
    },
    clear: () => {
      delete job.artifacts.visualAuditReferenceImageFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditActualImage,
    assign: (value) => {
      job.artifacts.visualAuditActualImageFile = value;
    },
    clear: () => {
      delete job.artifacts.visualAuditActualImageFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
    assign: (value) => {
      job.artifacts.visualAuditDiffImageFile = value;
    },
    clear: () => {
      delete job.artifacts.visualAuditDiffImageFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.visualAuditReport,
    assign: (value) => {
      job.artifacts.visualAuditReportFile = value;
    },
    clear: () => {
      delete job.artifacts.visualAuditReportFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.visualQualityReport,
    assign: (value) => {
      job.artifacts.visualQualityReportFile = value;
    },
    clear: () => {
      delete job.artifacts.visualQualityReportFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.compositeQualityReport,
    assign: (value) => {
      job.artifacts.compositeQualityReportFile = value;
    },
    clear: () => {
      delete job.artifacts.compositeQualityReportFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.confidenceReport,
    assign: (value) => {
      job.artifacts.confidenceReportFile = value;
    },
    clear: () => {
      delete job.artifacts.confidenceReportFile;
    },
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.validationSummaryFile,
    assign: (value) => {
      job.artifacts.validationSummaryFile = value;
    },
    clear: () => {
      delete job.artifacts.validationSummaryFile;
    },
  });

  const reproDir = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.reproPath);
  if (reproDir) {
    job.artifacts.reproDir = reproDir;
  }

  const generationDiff =
    await artifactStore.getValue<WorkspaceGenerationDiffReport>(
      STAGE_ARTIFACT_KEYS.generationDiff,
    );
  if (generationDiff) {
    job.generationDiff = generationDiff;
  } else {
    delete job.generationDiff;
  }

  const visualAudit = await artifactStore.getValue<WorkspaceVisualAuditResult>(
    STAGE_ARTIFACT_KEYS.visualAuditResult,
  );
  if (visualAudit) {
    jobWithVisualAudit.visualAudit = visualAudit;
  } else {
    delete jobWithVisualAudit.visualAudit;
  }

  const visualQuality =
    await artifactStore.getValue<WorkspaceVisualQualityReport>(
      STAGE_ARTIFACT_KEYS.visualQualityResult,
    );
  if (visualQuality !== undefined) {
    job.visualQuality = visualQuality;
  } else {
    delete job.visualQuality;
  }

  const compositeQuality =
    await artifactStore.getValue<WorkspaceCompositeQualityReport>(
      STAGE_ARTIFACT_KEYS.compositeQualityResult,
    );
  if (compositeQuality !== undefined) {
    job.compositeQuality = compositeQuality;
  } else {
    delete job.compositeQuality;
  }

  const confidence = await artifactStore.getValue<WorkspaceJobConfidence>(
    STAGE_ARTIFACT_KEYS.confidenceResult,
  );
  if (confidence !== undefined) {
    job.confidence = confidence;
  } else {
    delete job.confidence;
  }

  const gitPrStatus = await artifactStore.getValue<WorkspaceGitPrStatus>(
    STAGE_ARTIFACT_KEYS.gitPrStatus,
  );
  if (gitPrStatus) {
    job.gitPr = gitPrStatus;
  } else {
    delete job.gitPr;
  }
};
