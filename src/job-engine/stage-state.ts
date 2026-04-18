import type {
  WorkspaceCompositeQualityReport,
  WorkspaceFigmaSourceMode,
  WorkspaceJobConfidence,
  WorkspaceJobLog,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStageStatus,
  WorkspaceJobStatus,
  WorkspaceLlmCodegenMode,
} from "../contracts/index.js";
import { redactLogMessage, type WorkspaceRuntimeLogger } from "../logging.js";
import type { JobRecord } from "./types.js";

export const STAGE_ORDER: WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr",
];

export const toFileSystemSafe = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "generated";
};

export const nowIso = (): string => new Date().toISOString();

export const createInitialStages = (): WorkspaceJobStage[] => {
  return STAGE_ORDER.map((name) => ({
    name,
    status: "queued",
  }));
};

export const toAcceptedModes = ({
  figmaSourceMode,
}: {
  figmaSourceMode?: string;
} = {}): {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
} => {
  const normalizedFigmaSourceMode = figmaSourceMode?.trim().toLowerCase();
  return {
    figmaSourceMode:
      normalizedFigmaSourceMode === "local_json"
        ? "local_json"
        : normalizedFigmaSourceMode === "hybrid"
          ? "hybrid"
          : "rest",
    llmCodegenMode: "deterministic",
  };
};

export const updateStage = ({
  job,
  stage,
  status,
  message,
}: {
  job: JobRecord;
  stage: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  message?: string;
}): void => {
  const stageEntry = job.stages.find((entry) => entry.name === stage);
  if (!stageEntry) {
    return;
  }

  if (status === "running") {
    stageEntry.startedAt = nowIso();
  }

  if (status === "completed" || status === "failed" || status === "skipped") {
    stageEntry.completedAt = nowIso();
    if (stageEntry.startedAt) {
      const startedAtMs = Date.parse(stageEntry.startedAt);
      const completedAtMs = Date.parse(stageEntry.completedAt);
      if (Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)) {
        stageEntry.durationMs = Math.max(0, completedAtMs - startedAtMs);
      }
    }
  }

  stageEntry.status = status;
  if (message === undefined) {
    delete stageEntry.message;
  } else {
    stageEntry.message = message;
  }
};

export const pushLog = ({
  job,
  level,
  message,
  stage,
  logLimit = job.logLimit ?? 300,
}: {
  job: JobRecord;
  level: WorkspaceJobLog["level"];
  message: string;
  stage?: WorkspaceJobStageName;
  logLimit?: number;
}): WorkspaceJobLog => {
  const entry: WorkspaceJobLog = {
    at: nowIso(),
    level,
    message: redactLogMessage(message),
  };
  if (stage) {
    entry.stage = stage;
  }

  job.logs.push(entry);
  if (job.logs.length > logLimit) {
    job.logs.splice(0, job.logs.length - logLimit);
  }
  return entry;
};

export const pushRuntimeLog = ({
  job,
  logger,
  level,
  message,
  stage,
  logLimit = job.logLimit ?? 300,
}: {
  job: JobRecord;
  logger: WorkspaceRuntimeLogger;
  level: WorkspaceJobLog["level"];
  message: string;
  stage?: WorkspaceJobStageName;
  logLimit?: number;
}): WorkspaceJobLog => {
  const entry = pushLog({
    job,
    level,
    message,
    ...(stage ? { stage } : {}),
    logLimit,
  });
  logger.log({
    level,
    message: entry.message,
    jobId: job.jobId,
    ...(entry.stage ? { stage: entry.stage } : {}),
  });
  return entry;
};

export const cloneCompositeQuality = (
  report: WorkspaceCompositeQualityReport,
): WorkspaceCompositeQualityReport => ({
  ...report,
  ...(report.performance
    ? {
        performance: {
          ...report.performance,
          samples: report.performance.samples.map((sample) => ({ ...sample })),
          aggregateMetrics: { ...report.performance.aggregateMetrics },
          warnings: [...report.performance.warnings],
        },
      }
    : {}),
  ...(report.composite
    ? {
        composite: {
          ...report.composite,
          includedDimensions: [...report.composite.includedDimensions],
        },
      }
    : {}),
  ...(report.warnings ? { warnings: [...report.warnings] } : {}),
});

export const cloneJobConfidence = (
  confidence: WorkspaceJobConfidence,
): WorkspaceJobConfidence => ({
  ...confidence,
  ...(confidence.contributors
    ? { contributors: confidence.contributors.map((entry) => ({ ...entry })) }
    : {}),
  ...(confidence.screens
    ? {
        screens: confidence.screens.map((screen) => ({
          ...screen,
          contributors: screen.contributors.map((entry) => ({ ...entry })),
          components: screen.components.map((component) => ({
            ...component,
            contributors: component.contributors.map((entry) => ({ ...entry })),
          })),
        })),
      }
    : {}),
  ...(confidence.lowConfidenceSummary
    ? { lowConfidenceSummary: [...confidence.lowConfidenceSummary] }
    : {}),
});

export const toPublicJob = (job: JobRecord): WorkspaceJobStatus => {
  const status: WorkspaceJobStatus = {
    jobId: job.jobId,
    status: job.status,
    submittedAt: job.submittedAt,
    request: { ...job.request },
    stages: job.stages.map((stage) => ({ ...stage })),
    logs: job.logs.map((entry) => ({ ...entry })),
    artifacts: { ...job.artifacts },
    preview: { ...job.preview },
    queue: { ...job.queue },
  };
  if (job.pasteDeltaSummary) {
    status.pasteDeltaSummary = { ...job.pasteDeltaSummary };
  }
  if (job.currentStage) {
    status.currentStage = job.currentStage;
  }
  if (job.outcome) {
    status.outcome = job.outcome;
  }
  if (job.startedAt) {
    status.startedAt = job.startedAt;
  }
  if (job.finishedAt) {
    status.finishedAt = job.finishedAt;
  }
  if (job.lineage) {
    status.lineage = { ...job.lineage };
  }
  if (job.cancellation) {
    status.cancellation = { ...job.cancellation };
  }
  if (job.generationDiff) {
    status.generationDiff = { ...job.generationDiff };
  }
  if (job.visualAudit) {
    status.visualAudit = {
      ...job.visualAudit,
      ...(job.visualAudit.regions
        ? {
            regions: job.visualAudit.regions.map((region) => ({ ...region })),
          }
        : {}),
    };
  }
  if (job.visualQuality) {
    status.visualQuality = { ...job.visualQuality };
  }
  if (job.compositeQuality) {
    status.compositeQuality = cloneCompositeQuality(job.compositeQuality);
  }
  if (job.confidence) {
    status.confidence = cloneJobConfidence(job.confidence);
  }
  if (job.gitPr) {
    status.gitPr = { ...job.gitPr };
  }
  if (job.inspector) {
    status.inspector = {
      ...job.inspector,
      ...(job.inspector.retryableStages
        ? { retryableStages: [...job.inspector.retryableStages] }
        : {}),
      ...(job.inspector.retryTargets
        ? {
            retryTargets: job.inspector.retryTargets.map((target) => ({
              ...target,
            })),
          }
        : {}),
      stages: job.inspector.stages.map((stage) => ({
        ...stage,
        ...(stage.retryTargets
          ? {
              retryTargets: stage.retryTargets.map((target) => ({ ...target })),
            }
          : {}),
      })),
    };
  }
  if (job.error) {
    status.error = {
      ...job.error,
      ...(job.error.retryTargets
        ? {
            retryTargets: job.error.retryTargets.map((target) => ({
              ...target,
            })),
          }
        : {}),
    };
  }

  return status;
};

export const toJobSummary = (job: JobRecord): string => {
  if (job.status === "completed") {
    const count = job.stages.filter(
      (stage) => stage.status === "completed",
    ).length;
    return `Job completed successfully. ${count}/${job.stages.length} stages completed.`;
  }
  if (job.status === "partial") {
    const stage = job.error?.stage ?? job.currentStage ?? "unknown";
    return `Job partially completed. Recovery is available from stage '${stage}'.`;
  }
  if (job.status === "canceled") {
    const reason = job.cancellation?.reason ?? "Cancellation requested.";
    return `Job canceled. ${reason}`;
  }
  if (job.status === "failed") {
    const stage = job.error?.stage ?? job.currentStage ?? "unknown";
    return `Job failed during stage '${stage}'.`;
  }
  return `Job is currently ${job.status}.`;
};
