import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceJobDiagnostic,
  WorkspaceJobPipelineMetadata,
  WorkspaceJobRuntimeStatus,
  WorkspaceJobStatus,
} from "../contracts/index.js";
import {
  cloneQualityPassportSummary,
  cloneCompositeQuality,
  cloneJobConfidence,
  nowIso,
  toPublicJob,
} from "./stage-state.js";
import type { JobRecord } from "./types.js";

const TERMINAL_SNAPSHOT_VERSION = 1 as const;
const TERMINAL_STATUSES = new Set<WorkspaceJobRuntimeStatus>([
  "completed",
  "partial",
  "failed",
  "canceled",
]);

interface PersistedTerminalJobSnapshot extends WorkspaceJobStatus {
  snapshotVersion: typeof TERMINAL_SNAPSHOT_VERSION;
  generatedAt: string;
  diagnostics?: WorkspaceJobDiagnostic[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isTerminalStatus = (
  value: unknown,
): value is WorkspaceJobRuntimeStatus => {
  return (
    typeof value === "string" &&
    TERMINAL_STATUSES.has(value as WorkspaceJobRuntimeStatus)
  );
};

const isWorkspaceJobPipelineMetadata = (
  value: unknown,
): value is WorkspaceJobPipelineMetadata => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.pipelineId) &&
    isNonEmptyString(value.pipelineDisplayName) &&
    isNonEmptyString(value.templateBundleId) &&
    isNonEmptyString(value.buildProfile) &&
    value.deterministic === true
  );
};

const cloneSnapshotPipelineMetadata = (
  value: unknown,
): WorkspaceJobPipelineMetadata | undefined => {
  if (!isWorkspaceJobPipelineMetadata(value)) {
    return undefined;
  }
  return { ...value };
};

const isPersistedTerminalJobSnapshot = (
  value: unknown,
): value is PersistedTerminalJobSnapshot => {
  if (!isRecord(value)) {
    return false;
  }
  if (value.snapshotVersion !== TERMINAL_SNAPSHOT_VERSION) {
    return false;
  }
  if (
    typeof value.jobId !== "string" ||
    !isTerminalStatus(value.status) ||
    typeof value.submittedAt !== "string"
  ) {
    return false;
  }
  if (
    !isRecord(value.request) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.logs)
  ) {
    return false;
  }
  if (
    !isRecord(value.artifacts) ||
    !isRecord(value.preview) ||
    !isRecord(value.queue)
  ) {
    return false;
  }
  return true;
};

const resolveStageTimingsFile = ({ job }: { job: JobRecord }): string => {
  const stageTimingsFile =
    job.artifacts.stageTimingsFile ??
    path.join(job.artifacts.jobDir, "stage-timings.json");
  job.artifacts.stageTimingsFile = stageTimingsFile;
  return stageTimingsFile;
};

const buildTerminalJobSnapshot = ({
  job,
  diagnostics,
}: {
  job: JobRecord;
  diagnostics?: WorkspaceJobDiagnostic[] | undefined;
}): PersistedTerminalJobSnapshot => {
  const publicJob = toPublicJob(job);
  return {
    snapshotVersion: TERMINAL_SNAPSHOT_VERSION,
    generatedAt: nowIso(),
    ...publicJob,
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  };
};

export const writeTerminalJobSnapshot = async ({
  job,
  diagnostics,
}: {
  job: JobRecord;
  diagnostics?: WorkspaceJobDiagnostic[] | undefined;
}): Promise<PersistedTerminalJobSnapshot> => {
  const stageTimingsFile = resolveStageTimingsFile({ job });
  const snapshot = buildTerminalJobSnapshot({ job, diagnostics });
  await mkdir(path.dirname(stageTimingsFile), { recursive: true });
  await writeFile(
    stageTimingsFile,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  return snapshot;
};

export const writeTerminalJobSnapshotSync = ({
  job,
  diagnostics,
}: {
  job: JobRecord;
  diagnostics?: WorkspaceJobDiagnostic[] | undefined;
}): PersistedTerminalJobSnapshot => {
  const stageTimingsFile = resolveStageTimingsFile({ job });
  const snapshot = buildTerminalJobSnapshot({ job, diagnostics });
  mkdirSync(path.dirname(stageTimingsFile), { recursive: true });
  writeFileSync(
    stageTimingsFile,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  return snapshot;
};

const restorePreview = ({
  job,
  resolveBaseUrl,
}: {
  job: JobRecord;
  resolveBaseUrl: () => string;
}): void => {
  if (job.preview.enabled && job.artifacts.reproDir) {
    job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    return;
  }
  delete job.preview.url;
};

const toRehydratedJobRecord = ({
  snapshot,
  jobDir,
  stageTimingsFile,
  resolveBaseUrl,
}: {
  snapshot: PersistedTerminalJobSnapshot;
  jobDir: string;
  stageTimingsFile: string;
  resolveBaseUrl: () => string;
}): JobRecord => {
  const pipelineMetadata = cloneSnapshotPipelineMetadata(
    snapshot.pipelineMetadata,
  );
  const request = { ...snapshot.request };
  if (!isNonEmptyString(request.pipelineId)) {
    delete request.pipelineId;
  }
  const requestPipelineMetadata = cloneSnapshotPipelineMetadata(
    snapshot.request.pipelineMetadata,
  );
  if (requestPipelineMetadata) {
    request.pipelineMetadata = requestPipelineMetadata;
  } else {
    delete request.pipelineMetadata;
  }

  const job: JobRecord = {
    jobId: snapshot.jobId,
    status: snapshot.status,
    submittedAt: snapshot.submittedAt,
    request,
    stages: snapshot.stages.map((stage) => ({ ...stage })),
    logs: snapshot.logs.map((entry) => ({ ...entry })),
    artifacts: {
      ...snapshot.artifacts,
      jobDir,
      stageTimingsFile,
    },
    preview: { ...snapshot.preview },
    queue: { ...snapshot.queue },
    ...(pipelineMetadata ? { pipelineMetadata } : {}),
  };
  if (snapshot.currentStage) {
    job.currentStage = snapshot.currentStage;
  }
  if (snapshot.outcome) {
    job.outcome = snapshot.outcome;
  }
  if (snapshot.startedAt) {
    job.startedAt = snapshot.startedAt;
  }
  if (snapshot.finishedAt) {
    job.finishedAt = snapshot.finishedAt;
  }
  if (snapshot.lineage) {
    const lineagePipelineMetadata = cloneSnapshotPipelineMetadata(
      snapshot.lineage.pipelineMetadata,
    );
    job.lineage = {
      ...snapshot.lineage,
      ...(lineagePipelineMetadata
        ? { pipelineMetadata: lineagePipelineMetadata }
        : {}),
    };
    if (!lineagePipelineMetadata) {
      delete job.lineage.pipelineMetadata;
    }
  }
  if (snapshot.cancellation) {
    job.cancellation = { ...snapshot.cancellation };
  }
  if (snapshot.generationDiff) {
    job.generationDiff = { ...snapshot.generationDiff };
  }
  if (snapshot.visualAudit) {
    job.visualAudit = {
      ...snapshot.visualAudit,
      ...(snapshot.visualAudit.regions
        ? {
            regions: snapshot.visualAudit.regions.map((region) => ({
              ...region,
            })),
          }
        : {}),
    };
  }
  if (snapshot.visualQuality) {
    job.visualQuality = { ...snapshot.visualQuality };
  }
  if (snapshot.gitPr) {
    job.gitPr = { ...snapshot.gitPr };
  }
  if (snapshot.inspector) {
    job.inspector = {
      ...snapshot.inspector,
      ...(snapshot.inspector.retryableStages
        ? { retryableStages: [...snapshot.inspector.retryableStages] }
        : {}),
      ...(snapshot.inspector.retryTargets
        ? {
            retryTargets: snapshot.inspector.retryTargets.map((target) => ({
              ...target,
            })),
          }
        : {}),
      ...(snapshot.inspector.qualityPassport
        ? {
            qualityPassport: cloneQualityPassportSummary(
              snapshot.inspector.qualityPassport,
            ),
          }
        : {}),
      stages: snapshot.inspector.stages.map((stage) => ({
        ...stage,
        ...(stage.retryTargets
          ? {
              retryTargets: stage.retryTargets.map((target) => ({ ...target })),
            }
          : {}),
      })),
    };
  }
  if (snapshot.error) {
    job.error = {
      ...snapshot.error,
      ...(snapshot.error.retryTargets
        ? {
            retryTargets: snapshot.error.retryTargets.map((target) => ({
              ...target,
            })),
          }
        : {}),
    };
  }
  if (snapshot.pasteDeltaSummary) {
    job.pasteDeltaSummary = { ...snapshot.pasteDeltaSummary };
  }
  if (snapshot.compositeQuality) {
    job.compositeQuality = cloneCompositeQuality(snapshot.compositeQuality);
  }
  if (snapshot.confidence) {
    job.confidence = cloneJobConfidence(snapshot.confidence);
  }
  restorePreview({ job, resolveBaseUrl });
  return job;
};

export const loadRehydratedJobs = ({
  jobsRoot,
  resolveBaseUrl,
}: {
  jobsRoot: string;
  resolveBaseUrl: () => string;
}): JobRecord[] => {
  const entries = (() => {
    try {
      return readdirSync(jobsRoot, { withFileTypes: true }) as Array<{
        isDirectory: () => boolean;
        name: string;
      }>;
    } catch {
      return [];
    }
  })();

  const jobs: JobRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const jobDir = path.join(jobsRoot, entry.name);
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(stageTimingsFile, "utf8")) as unknown;
    } catch {
      continue;
    }
    if (!isPersistedTerminalJobSnapshot(parsed)) {
      continue;
    }
    jobs.push(
      toRehydratedJobRecord({
        snapshot: parsed,
        jobDir,
        stageTimingsFile,
        resolveBaseUrl,
      }),
    );
  }

  jobs.sort((left, right) => {
    const leftStamp = left.finishedAt ?? left.submittedAt;
    const rightStamp = right.finishedAt ?? right.submittedAt;
    return leftStamp.localeCompare(rightStamp);
  });
  return jobs;
};
