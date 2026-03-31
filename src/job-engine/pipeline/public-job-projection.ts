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
  const syncOptionalArtifactPath = async ({
    key,
    assign,
    clear
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

  const figmaJsonFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaCleaned);
  if (figmaJsonFile) {
    job.artifacts.figmaJsonFile = figmaJsonFile;
  }

  const designIrFile = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr);
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
    }
  });

  const generatedProjectDir = await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject);
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
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.componentManifest,
    assign: (value) => {
      job.artifacts.componentManifestFile = value;
    },
    clear: () => {
      delete job.artifacts.componentManifestFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookTokens,
    assign: (value) => {
      job.artifacts.storybookTokensFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookTokensFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookThemes,
    assign: (value) => {
      job.artifacts.storybookThemesFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookThemesFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.storybookComponents,
    assign: (value) => {
      job.artifacts.storybookComponentsFile = value;
    },
    clear: () => {
      delete job.artifacts.storybookComponentsFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
    assign: (value) => {
      job.artifacts.figmaLibraryResolutionFile = value;
    },
    clear: () => {
      delete job.artifacts.figmaLibraryResolutionFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.componentMatchReport,
    assign: (value) => {
      job.artifacts.componentMatchReportFile = value;
    },
    clear: () => {
      delete job.artifacts.componentMatchReportFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.generationDiffFile,
    assign: (value) => {
      job.artifacts.generationDiffFile = value;
    },
    clear: () => {
      delete job.artifacts.generationDiffFile;
    }
  });
  await syncOptionalArtifactPath({
    key: STAGE_ARTIFACT_KEYS.validationSummaryFile,
    assign: (value) => {
      job.artifacts.validationSummaryFile = value;
    },
    clear: () => {
      delete job.artifacts.validationSummaryFile;
    }
  });

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
