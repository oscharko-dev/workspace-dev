import type { JsonResponse } from "../../lib/http";
import type { WorkspaceFigmaSourceMode } from "./submit-schema";

export type BadgeVariant = "default" | "ok" | "warn" | "error";
export type JobLifecycleStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "canceled";

export interface RuntimeStatusPayload {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: "deterministic";
  uptimeMs: number;
  outputRoot: string;
  previewEnabled: boolean;
  availablePipelines?: Array<{ id: string; displayName: string }> | undefined;
  defaultPipelineId?: string | undefined;
}

export interface WorkspaceJobPipelineMetadataPayload {
  pipelineId: string;
  pipelineDisplayName: string;
  templateBundleId: string;
  buildProfile: string;
  deterministic: true;
}

export interface JobQualityCoveragePayload {
  status: "not_run" | "passed" | "warning" | "failed";
  covered: number;
  total: number;
  ratio: number;
}

export interface JobQualityPassportPayload {
  artifactFile?: string;
  schemaVersion: string;
  pipelineId: string;
  templateBundleId: string;
  buildProfile: string;
  sourceMode: WorkspaceFigmaSourceMode;
  scope: string;
  selectedNodeCount: number;
  validationStatus: "not_run" | "passed" | "warning" | "failed";
  generatedFileCount: number;
  warningCount: number;
  tokenCoverage: JobQualityCoveragePayload;
  semanticCoverage: JobQualityCoveragePayload;
}

export interface JobStagePayload {
  name: string;
  status: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: string;
  targetIds?: string[];
  retryTargets?: unknown;
  error?: unknown;
}

export interface JobInspectorStagePayload {
  stage: string;
  status: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: string;
  retryTargets?: unknown;
}

export interface JobInspectorPayload {
  pipelineId?: string;
  pipelineMetadata?: WorkspaceJobPipelineMetadataPayload;
  qualityPassport?: JobQualityPassportPayload;
  outcome?: string;
  fallbackMode?: string;
  mcpCallsConsumed?: number;
  retryableStages?: string[];
  retryTargets?: unknown;
  stages?: JobInspectorStagePayload[];
}

export interface JobErrorPayload {
  code?: string;
  message?: string;
  stage?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: string;
  targetIds?: string[];
  retryTargets?: unknown;
  details?: unknown;
}

export interface JobPreviewPayload {
  enabled?: boolean;
  url?: string;
}

export interface JobQueuePayload {
  runningCount?: number;
  queuedCount?: number;
  maxConcurrentJobs?: number;
  maxQueuedJobs?: number;
  position?: number;
}

export interface JobCancellationPayload {
  requestedAt?: string;
  reason?: string;
  completedAt?: string;
}

export interface JobGenerationDiffPayload {
  summary?: string;
  added?: string[];
  modified?: { file: string }[];
  removed?: string[];
  unchanged?: string[];
  previousJobId?: string | null;
}

export interface JobLineagePayload {
  sourceJobId?: string;
}

export interface JobPayload {
  jobId: string;
  pipelineId?: string;
  pipelineMetadata?: WorkspaceJobPipelineMetadataPayload;
  status: string;
  stages?: JobStagePayload[];
  outcome?: string;
  fallbackMode?: string;
  stageResults?: Record<string, unknown> | unknown[];
  inspector?: JobInspectorPayload;
  preview?: JobPreviewPayload;
  queue?: JobQueuePayload;
  cancellation?: JobCancellationPayload;
  generationDiff?: JobGenerationDiffPayload;
  lineage?: JobLineagePayload;
  error?: JobErrorPayload;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isQualityCoveragePayload(
  value: unknown,
): value is JobQualityCoveragePayload {
  return (
    isRecord(value) &&
    (value.status === "not_run" ||
      value.status === "passed" ||
      value.status === "warning" ||
      value.status === "failed") &&
    typeof value.covered === "number" &&
    Number.isFinite(value.covered) &&
    typeof value.total === "number" &&
    Number.isFinite(value.total) &&
    typeof value.ratio === "number" &&
    Number.isFinite(value.ratio)
  );
}

export function isJobQualityPassportPayload(
  value: unknown,
): value is JobQualityPassportPayload {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "string" &&
    typeof value.pipelineId === "string" &&
    typeof value.templateBundleId === "string" &&
    typeof value.buildProfile === "string" &&
    typeof value.sourceMode === "string" &&
    typeof value.scope === "string" &&
    typeof value.selectedNodeCount === "number" &&
    Number.isFinite(value.selectedNodeCount) &&
    (value.validationStatus === "not_run" ||
      value.validationStatus === "passed" ||
      value.validationStatus === "warning" ||
      value.validationStatus === "failed") &&
    typeof value.generatedFileCount === "number" &&
    Number.isFinite(value.generatedFileCount) &&
    typeof value.warningCount === "number" &&
    Number.isFinite(value.warningCount) &&
    isQualityCoveragePayload(value.tokenCoverage) &&
    isQualityCoveragePayload(value.semanticCoverage) &&
    (value.artifactFile === undefined || typeof value.artifactFile === "string")
  );
}

export function getJobQualityPassportPayload(
  payload: JobPayload,
): JobQualityPassportPayload | undefined {
  const inspector = isRecord(payload.inspector) ? payload.inspector : undefined;
  return isJobQualityPassportPayload(inspector?.qualityPassport)
    ? inspector.qualityPassport
    : undefined;
}

export function isJobPayload(value: unknown): value is JobPayload {
  return (
    isRecord(value) &&
    typeof value.jobId === "string" &&
    typeof value.status === "string"
  );
}

export function getRouteFigmaKey(
  routeFigmaKey?: string,
): string | undefined {
  if (!routeFigmaKey || routeFigmaKey === "ui") {
    return undefined;
  }

  try {
    return decodeURIComponent(routeFigmaKey);
  } catch {
    return undefined;
  }
}

export function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function getJobLifecycleStatus(
  payload?: JobPayload,
): JobLifecycleStatus | undefined {
  if (!payload) {
    return undefined;
  }

  if (payload.status === "queued") {
    return "queued";
  }
  if (payload.status === "running") {
    return "running";
  }
  if (payload.status === "completed") {
    return "completed";
  }
  if (payload.status === "partial") {
    return "partial";
  }
  if (payload.status === "failed") {
    return "failed";
  }
  if (payload.status === "canceled") {
    return "canceled";
  }

  return undefined;
}

export function getSubmitBadge({
  isSubmitting,
  status,
  isCanceling,
}: {
  isSubmitting: boolean;
  status: JobLifecycleStatus | undefined;
  isCanceling: boolean;
}): { text: string; variant: BadgeVariant } {
  if (isSubmitting) {
    return { text: "SUBMITTING", variant: "warn" };
  }
  if (isCanceling) {
    return { text: "CANCELING", variant: "warn" };
  }

  if (status === "queued") {
    return { text: "QUEUED", variant: "warn" };
  }
  if (status === "running") {
    return { text: "RUNNING", variant: "warn" };
  }
  if (status === "completed") {
    return { text: "COMPLETED", variant: "ok" };
  }
  if (status === "partial") {
    return { text: "PARTIAL", variant: "warn" };
  }
  if (status === "failed") {
    return { text: "FAILED", variant: "error" };
  }
  if (status === "canceled") {
    return { text: "CANCELED", variant: "warn" };
  }

  return { text: "IDLE", variant: "default" };
}

export function toStageBadgeVariant(stageStatus: string): BadgeVariant {
  if (stageStatus === "completed") {
    return "ok";
  }
  if (stageStatus === "failed") {
    return "error";
  }
  if (stageStatus === "running") {
    return "warn";
  }
  return "default";
}

export function getHealthBadge(
  response: JsonResponse<Record<string, unknown>> | undefined,
): {
  text: string;
  variant: BadgeVariant;
} {
  if (!response) {
    return { text: "UNKNOWN", variant: "default" };
  }

  if (response.ok) {
    return { text: "READY", variant: "ok" };
  }

  return { text: `ERROR ${response.status}`, variant: "error" };
}

export function getWorkspaceBadge(
  response: JsonResponse<RuntimeStatusPayload> | undefined,
): {
  text: string;
  variant: BadgeVariant;
} {
  if (!response) {
    return { text: "UNKNOWN", variant: "default" };
  }

  if (response.ok) {
    return { text: "ONLINE", variant: "ok" };
  }

  return { text: `ERROR ${response.status}`, variant: "error" };
}

export function getJobSummary({
  status,
  payload,
  activeJobId,
}: {
  status: JobLifecycleStatus | undefined;
  payload: JobPayload | undefined;
  activeJobId: string | null;
}): string {
  if (!activeJobId) {
    return "No job started yet.";
  }

  if (!payload) {
    return `Job ${activeJobId} accepted.`;
  }

  if (status === "queued" || status === "running") {
    if (payload.cancellation && !payload.cancellation.completedAt) {
      return `Job ${payload.jobId} cancellation requested.`;
    }
    const queuePosition = payload.queue?.position;
    if (
      typeof queuePosition === "number" &&
      queuePosition > 0 &&
      status === "queued"
    ) {
      return `Job ${payload.jobId} is queued (position ${queuePosition}).`;
    }
    return `Job ${payload.jobId} is ${status}.`;
  }

  if (status === "completed") {
    return `Job ${payload.jobId} completed successfully.`;
  }

  if (status === "failed") {
    return `Job ${payload.jobId} failed.`;
  }
  if (status === "canceled") {
    return `Job ${payload.jobId} canceled.`;
  }

  return `Job ${payload.jobId} status is ${payload.status}.`;
}

export function canCancelJob({
  status,
  payload,
}: {
  status: JobLifecycleStatus | undefined;
  payload: JobPayload | undefined;
}): boolean {
  if (!payload || !status) {
    return false;
  }
  if (status !== "queued" && status !== "running") {
    return false;
  }
  if (payload.cancellation && !payload.cancellation.completedAt) {
    return false;
  }
  return true;
}

export function getBadgeClasses(variant: BadgeVariant): string {
  if (variant === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-600";
  }
  if (variant === "warn") {
    return "border-slate-400 bg-slate-200 text-slate-900";
  }
  if (variant === "error") {
    return "border-black bg-white text-black";
  }
  return "border-slate-300 bg-slate-100 text-slate-900";
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m ${seconds % 60}s`;
}

export function getModeChipClasses({
  isActive,
}: {
  isActive: boolean;
}): string {
  return `rounded-md px-3 py-1 text-sm font-medium ${
    isActive
      ? "border border-[#4eba87] bg-emerald-500/5 text-[#4eba87]"
      : "text-[#333]"
  }`;
}

export function hasMultipleAvailablePipelines(
  availablePipelines?: RuntimeStatusPayload["availablePipelines"],
): boolean {
  return (availablePipelines?.length ?? 0) > 1;
}

export function getSelectedPipelineId({
  availablePipelines,
  defaultPipelineId,
  currentPipelineId,
}: {
  availablePipelines?: RuntimeStatusPayload["availablePipelines"];
  defaultPipelineId?: string | undefined;
  currentPipelineId?: string | undefined;
}): string | undefined {
  const normalizedCurrentPipelineId = currentPipelineId?.trim();
  const normalizedDefaultPipelineId = defaultPipelineId?.trim();

  if (availablePipelines === undefined) {
    return normalizedCurrentPipelineId || undefined;
  }

  if (availablePipelines.length === 0) {
    return undefined;
  }

  const availablePipelineIds = new Set(
    availablePipelines
      .map((pipeline) => pipeline.id.trim())
      .filter((pipelineId) => pipelineId.length > 0),
  );

  if (availablePipelineIds.size === 0) {
    return undefined;
  }

  if (
    normalizedCurrentPipelineId !== undefined &&
    availablePipelineIds.has(normalizedCurrentPipelineId)
  ) {
    return normalizedCurrentPipelineId;
  }

  if (
    normalizedDefaultPipelineId !== undefined &&
    availablePipelineIds.has(normalizedDefaultPipelineId)
  ) {
    return normalizedDefaultPipelineId;
  }

  return availablePipelineIds.values().next().value;
}
