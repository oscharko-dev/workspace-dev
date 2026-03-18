import type {
  WorkspaceFigmaSourceMode,
  WorkspaceJobLog,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStageStatus,
  WorkspaceJobStatus,
  WorkspaceLlmCodegenMode
} from "../contracts/index.js";
import type { JobRecord } from "./types.js";

const LOG_LIMIT = 300;

export const STAGE_ORDER: WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr"
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
    status: "queued"
  }));
};

export const toAcceptedModes = ({
  figmaSourceMode
}: {
  figmaSourceMode?: string;
} = {}): {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
} => {
  const normalizedFigmaSourceMode = figmaSourceMode?.trim().toLowerCase();
  return {
    figmaSourceMode: normalizedFigmaSourceMode === "local_json" ? "local_json" : "rest",
    llmCodegenMode: "deterministic"
  };
};

export const updateStage = ({
  job,
  stage,
  status,
  message
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
  stage
}: {
  job: JobRecord;
  level: WorkspaceJobLog["level"];
  message: string;
  stage?: WorkspaceJobStageName;
}): void => {
  const redactedMessage = message
    .replace(/(token\s*=\s*)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(authorization\s*:\s*bearer\s+)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(x-access-token:)([^@\s]+)/gi, "$1[REDACTED]");

  const entry: WorkspaceJobLog = {
    at: nowIso(),
    level,
    message: redactedMessage
  };
  if (stage) {
    entry.stage = stage;
  }

  job.logs.push(entry);
  if (job.logs.length > LOG_LIMIT) {
    job.logs.splice(0, job.logs.length - LOG_LIMIT);
  }
};

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
    queue: { ...job.queue }
  };
  if (job.currentStage) {
    status.currentStage = job.currentStage;
  }
  if (job.startedAt) {
    status.startedAt = job.startedAt;
  }
  if (job.finishedAt) {
    status.finishedAt = job.finishedAt;
  }
  if (job.cancellation) {
    status.cancellation = { ...job.cancellation };
  }
  if (job.gitPr) {
    status.gitPr = { ...job.gitPr };
  }
  if (job.error) {
    status.error = { ...job.error };
  }

  return status;
};

export const toJobSummary = (job: JobRecord): string => {
  if (job.status === "completed") {
    const count = job.stages.filter((stage) => stage.status === "completed").length;
    return `Job completed successfully. ${count}/${job.stages.length} stages completed.`;
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
