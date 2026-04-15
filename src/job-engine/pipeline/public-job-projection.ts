import type {
  WorkspaceCompositeQualityReport,
  WorkspaceGenerationDiffReport,
  WorkspaceGitPrStatus,
  WorkspaceJobConfidence,
  WorkspaceJobFallbackMode,
  WorkspaceJobInspector,
  WorkspaceJobOutcome,
  WorkspaceJobRetryStage,
  WorkspaceJobRetryTarget,
  WorkspaceVisualAuditResult,
  WorkspaceVisualQualityReport,
} from "../../contracts/index.js";
import type { JobRecord } from "../types.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import type { StageArtifactStore } from "./artifact-store.js";
import {
  isPasteDeltaExecutionState,
  type PasteDeltaExecutionState,
} from "../paste-delta-execution.js";

interface CodegenSummaryLike {
  generatedPaths?: string[];
  failedTargets?: WorkspaceJobRetryTarget[];
}

interface HybridEnrichmentLike {
  sourceMode?: string;
  diagnostics?: Array<{ code?: string }>;
}

const RETRYABLE_STAGE_SET = new Set<WorkspaceJobRetryStage>([
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
]);

const isWorkspaceJobRetryStage = (
  value: unknown,
): value is WorkspaceJobRetryStage => {
  return (
    typeof value === "string" &&
    RETRYABLE_STAGE_SET.has(value as WorkspaceJobRetryStage)
  );
};

const inferOutcome = ({
  job,
}: {
  job: JobRecord;
}): WorkspaceJobOutcome | undefined => {
  if (job.outcome) {
    return job.outcome;
  }
  if (job.status === "completed") {
    return "success";
  }
  if (job.status === "partial") {
    return "partial";
  }
  if (job.status === "failed") {
    return "failed";
  }
  return undefined;
};

const inferFallbackMode = ({
  job,
  hybridEnrichment,
}: {
  job: JobRecord;
  hybridEnrichment: HybridEnrichmentLike | undefined;
}): WorkspaceJobFallbackMode | undefined => {
  if (job.error?.fallbackMode) {
    return job.error.fallbackMode;
  }
  if (!hybridEnrichment) {
    return undefined;
  }
  const diagnosticCodes = new Set(
    (hybridEnrichment.diagnostics ?? [])
      .map((entry) => entry.code?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  if (
    diagnosticCodes.has("W_MCP_ENRICHMENT_SKIPPED") ||
    diagnosticCodes.has("W_MCP_FALLBACK_REST")
  ) {
    return hybridEnrichment.sourceMode === "hybrid" ? "hybrid_rest" : "rest";
  }
  return undefined;
};

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

  const pasteDeltaExecution =
    await artifactStore.getValue<PasteDeltaExecutionState>(
      STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
      isPasteDeltaExecutionState,
    );
  if (pasteDeltaExecution) {
    job.pasteDeltaSummary = { ...pasteDeltaExecution.summary };
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

  const codegenSummary = await artifactStore.getValue<CodegenSummaryLike>(
    STAGE_ARTIFACT_KEYS.codegenSummary,
  );
  const hybridEnrichment = await artifactStore.getValue<HybridEnrichmentLike>(
    STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
  );
  const inspectorOutcome = inferOutcome({ job });
  const fallbackMode = inferFallbackMode({ job, hybridEnrichment });
  const retryTargets =
    job.error?.retryTargets ?? codegenSummary?.failedTargets ?? [];
  const retryableStages = [
    ...new Set(
      retryTargets
        .map((target) => target.stage)
        .filter(isWorkspaceJobRetryStage),
    ),
  ];
  const jobError = job.error;
  const inspector: WorkspaceJobInspector = {
    ...(inspectorOutcome ? { outcome: inspectorOutcome } : {}),
    ...(fallbackMode ? { fallbackMode } : {}),
    ...(retryTargets.length > 0
      ? {
          retryTargets: retryTargets.map((target) => ({
            ...target,
          })),
        }
      : {}),
    ...(retryableStages.length > 0
      ? {
          retryableStages,
        }
      : {}),
    stages: job.stages.map((stage) => {
      if (!jobError || stage.name !== jobError.stage) {
        return {
          stage: stage.name,
          status: stage.status,
        };
      }
      const error = jobError;
      return {
        stage: stage.name,
        status: stage.status,
        ...(error.retryable !== undefined
          ? { retryable: error.retryable }
          : {}),
        ...(error.code ? { code: error.code } : {}),
        ...(error.message ? { message: error.message } : {}),
        ...(error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
        ...(error.fallbackMode ? { fallbackMode: error.fallbackMode } : {}),
        ...(retryTargets.length > 0
          ? {
              retryTargets: retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
      };
    }),
  };
  if (inspectorOutcome) {
    job.outcome = inspectorOutcome;
  } else {
    delete job.outcome;
  }
  job.inspector = inspector;
};
