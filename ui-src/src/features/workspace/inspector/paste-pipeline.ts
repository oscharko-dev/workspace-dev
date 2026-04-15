import { useEffect, useReducer, useRef, useState } from "react";
import { fetchJson } from "../../../lib/http";
import {
  isJobPayload,
  isRecord,
  type JobInspectorPayload,
  type JobPayload,
  type JobStagePayload,
} from "../workspace-page.helpers";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";
import { getPasteErrorMessage } from "./paste-error-catalog";
import {
  createPipelineExecutionLog,
  type PipelineExecutionLog,
} from "./pipeline-execution-log";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "idle"
  | "parsing"
  | "resolving"
  | "transforming"
  | "mapping"
  | "generating"
  | "ready"
  | "partial"
  | "error";

export type PipelineOutcome = "success" | "partial" | "failed";
export type PipelineFallbackMode =
  | "rest"
  | "mcp"
  | "hybrid"
  | "local_json"
  | (string & {});

/**
 * Mirror of contract `WorkspacePasteDeltaSummary` (contracts 3.12.0).
 * Returned on a Figma paste submit-accepted response.
 */
export interface PipelinePasteDeltaSummary {
  mode: "full" | "delta" | "auto_resolved_to_full" | "auto_resolved_to_delta";
  strategy: "baseline_created" | "no_changes" | "delta" | "structural_break";
  totalNodes: number;
  nodesReused: number;
  nodesReprocessed: number;
  structuralChangeRatio: number;
  pasteIdentityKey: string;
  priorManifestMissing: boolean;
}

export type PipelineImportMode = "full" | "delta" | "auto";

type SubmitSourceMode = "figma_paste" | "figma_plugin" | "figma_url";
type JobRuntimeStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "canceled";

export interface StageStatus {
  state: "pending" | "running" | "done" | "failed";
  duration?: number | undefined;
  message?: string | undefined;
  code?: string | undefined;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  retryAvailableAtMs?: number | undefined;
  fallbackMode?: PipelineFallbackMode | undefined;
  error?: PipelineError | undefined;
}

export interface PipelineRetryTarget {
  id: string;
  label: string;
  filePath?: string;
  stage?: PipelineStage;
}

export interface PipelineRetryRequest {
  stage: PipelineStage;
  targetIds?: string[];
}

export interface PipelineError {
  stage: PipelineStage;
  code: string;
  message: string;
  retryable: boolean;
  /** For rate-limited errors: milliseconds until retry is allowed. */
  retryAfterMs?: number | undefined;
  retryAvailableAtMs?: number | undefined;
  fallbackMode?: PipelineFallbackMode | undefined;
  retryTargets?: PipelineRetryTarget[] | undefined;
  details?: Record<string, unknown> | undefined;
}

interface DesignIrElementNode {
  id: string;
  name: string;
  type: string;
  children?: DesignIrElementNode[];
  [key: string]: unknown;
}

interface DesignIrScreen {
  id: string;
  name: string;
  generatedFile?: string;
  children: DesignIrElementNode[];
}

interface DesignIrPayload {
  jobId: string;
  screens: DesignIrScreen[];
}

interface ComponentManifestEntry {
  irNodeId: string;
  irNodeName: string;
  irNodeType: string;
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

interface ComponentManifestScreen {
  screenId: string;
  screenName: string;
  file: string;
  components: ComponentManifestEntry[];
}

interface ComponentManifestPayload {
  jobId: string;
  screens: ComponentManifestScreen[];
}

export interface GeneratedFileEntry {
  path: string;
  sizeBytes: number;
}

export interface SourceScreenHint {
  id: string;
  name: string;
  nodeType: string;
}

export interface FigmaAnalysisDiagnosticEntry {
  severity?: string;
  sourceNodeId?: string;
}

export interface TokenIntelligenceConflict {
  name: string;
  figmaValue: string;
  existingValue: string;
  resolution: "figma" | "existing";
}

export interface TokenIntelligenceCodeConnectMapping {
  nodeId: string;
  componentName: string;
  source: string;
  label?: string;
}

export interface TokenIntelligencePayload {
  jobId: string;
  conflicts: TokenIntelligenceConflict[];
  unmappedVariables: string[];
  libraryKeys: string[];
  cssCustomProperties: string | null;
  codeConnectMappings: TokenIntelligenceCodeConnectMapping[];
  designSystemMappings: TokenIntelligenceCodeConnectMapping[];
  heuristicComponentMappings: TokenIntelligenceCodeConnectMapping[];
}

export interface FigmaAnalysisPayload {
  jobId: string;
  layoutGraph?: {
    pages?: Array<{
      id: string;
      name: string;
      frameIds: string[];
    }>;
    frames?: Array<{
      id: string;
      name: string;
      pageId: string;
      parentSectionId?: string;
    }>;
  };
  diagnostics?: FigmaAnalysisDiagnosticEntry[];
}

export interface PartialImportStats {
  /** Number of pipeline stages that completed successfully. */
  resolvedStages: number;
  /** Total number of active pipeline stages. */
  totalStages: number;
  /** Number of stages that failed. */
  errorCount: number;
}

export interface PastePipelineState {
  stage: PipelineStage;
  outcome?: PipelineOutcome | undefined;
  progress: number;
  stageProgress: Record<PipelineStage, StageStatus>;
  jobId?: string;
  jobStatus?: JobRuntimeStatus;
  previewUrl?: string;
  sourceScreens?: SourceScreenHint[];
  designIR?: DesignIrPayload;
  figmaAnalysis?: FigmaAnalysisPayload;
  componentManifest?: ComponentManifestPayload;
  generatedFiles?: GeneratedFileEntry[];
  tokenIntelligence?: TokenIntelligencePayload;
  screenshot?: string;
  errors: PipelineError[];
  canRetry: boolean;
  canCancel: boolean;
  fallbackMode?: PipelineFallbackMode | undefined;
  retryRequest?: PipelineRetryRequest | undefined;
  /** Set when at least one stage succeeded but at least one failed. */
  partialStats?: PartialImportStats;
  /** Per-paste delta summary surfaced on the submit-accepted response. */
  pasteDeltaSummary?: PipelinePasteDeltaSummary | undefined;
  /** Mirrors pasteDeltaSummary.pasteIdentityKey when delta info is available; cleared on `start`. */
  pasteIdentityKey?: string | undefined;
  /** Echo of the selectedNodeIds the most recent submit was sent with (omitted when unscoped). */
  selectedNodeIds?: readonly string[] | undefined;
}

export interface PastePipelineController {
  cancel(): void;
  retry(request?: PipelineRetryRequest): void;
  getState(): PastePipelineState;
}

export interface PipelineOptions {
  signal?: AbortSignal;
  skipScreenshot?: boolean;
  sourceMode?: SubmitSourceMode;
  /** Whitelist of node ids to keep in the generation scope. Empty/undefined = no filtering. */
  selectedNodeIds?: readonly string[];
  /** Hint to the backend delta engine. Defaults to "auto" on the server when omitted. */
  importMode?: PipelineImportMode;
}

interface PipelineRequest {
  payload: string;
  sourceMode: SubmitSourceMode;
  skipScreenshot: boolean;
  selectedNodeIds?: readonly string[];
  importMode?: PipelineImportMode;
}

export type PipelineAction =
  | { type: "start" }
  | { type: "start_resolving" }
  | { type: "parsing_done" }
  | { type: "source_screens_ready"; screens: SourceScreenHint[] }
  | {
      type: "job_created";
      jobId: string;
      pasteDeltaSummary?: PipelinePasteDeltaSummary;
      selectedNodeIds?: readonly string[];
    }
  | {
      type: "job_status_updated";
      status: JobRuntimeStatus;
      previewUrl?: string;
    }
  | { type: "stage_start"; stage: PipelineStage; message: string }
  | { type: "stage_message"; stage: PipelineStage; message: string }
  | { type: "stage_done"; stage: PipelineStage; durationMs: number }
  | { type: "stage_failed"; stage: PipelineStage; error: PipelineError }
  | { type: "retry_stage"; stage: PipelineStage; targetIds?: string[] }
  | { type: "design_ir_ready"; designIR: DesignIrPayload }
  | { type: "figma_analysis_ready"; figmaAnalysis: FigmaAnalysisPayload }
  | { type: "manifest_ready"; manifest: ComponentManifestPayload }
  | { type: "files_ready"; files: GeneratedFileEntry[] }
  | {
      type: "token_intelligence_ready";
      tokenIntelligence: TokenIntelligencePayload;
    }
  | { type: "screenshot_ready"; screenshotUrl: string }
  | { type: "cancel_complete" }
  | {
      type: "complete";
      previewUrl?: string;
      outcome?: PipelineOutcome;
      fallbackMode?: PipelineFallbackMode;
    };

// ---------------------------------------------------------------------------
// Stage ordering + backend mapping
// ---------------------------------------------------------------------------

const ACTIVE_STAGES: readonly PipelineStage[] = [
  "parsing",
  "resolving",
  "transforming",
  "mapping",
  "generating",
] as const;

/** Backend-only stages used to determine "partial" success. Excludes "parsing" which is always trivial client-side JSON validation. */
export const BACKEND_STAGES: readonly PipelineStage[] = [
  "resolving",
  "transforming",
  "mapping",
  "generating",
] as const;

const ALL_STAGES: readonly PipelineStage[] = [
  "idle",
  "parsing",
  "resolving",
  "transforming",
  "mapping",
  "generating",
  "ready",
  "partial",
  "error",
] as const;

const BACKEND_TO_PIPELINE_STAGE: Record<string, PipelineStage> = {
  "figma.source": "resolving",
  "ir.derive": "transforming",
  "template.prepare": "mapping",
  "codegen.generate": "generating",
  "validate.project": "generating",
  "repro.export": "generating",
  "git.pr": "generating",
};

const POLL_INTERVAL_MS = 1_500;
const CANCEL_REASON = "Cancellation requested from inspector paste pipeline.";

const endpoints = {
  submit: "/workspace/submit",
  job: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}`,
  retryStage: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/retry-stage`,
  cancel: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/cancel`,
  designIr: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/design-ir`,
  figmaAnalysis: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/figma-analysis`,
  manifest: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/component-manifest`,
  files: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/files`,
  screenshot: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/screenshot`,
  tokenIntelligence: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/token-intelligence`,
  tokenDecisions: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/token-decisions`,
};

const RETRYABLE_STAGE_SET = new Set<PipelineStage>([
  "resolving",
  "transforming",
  "mapping",
  "generating",
]);

// ---------------------------------------------------------------------------
// Initial state + reducer helpers
// ---------------------------------------------------------------------------

export function createInitialPipelineState(): PastePipelineState {
  const stageProgress = {} as Record<PipelineStage, StageStatus>;
  for (const stage of ALL_STAGES) {
    stageProgress[stage] = { state: "pending" };
  }

  return {
    stage: "idle",
    progress: 0,
    stageProgress,
    errors: [],
    canRetry: false,
    canCancel: false,
  };
}

function setStatus(
  state: PastePipelineState,
  stage: PipelineStage,
  status: StageStatus,
): Record<PipelineStage, StageStatus> {
  return { ...state.stageProgress, [stage]: status };
}

function nextActiveStage(stage: PipelineStage): PipelineStage {
  const index = ACTIVE_STAGES.indexOf(stage);
  if (index === -1 || index === ACTIVE_STAGES.length - 1) {
    return "ready";
  }
  return ACTIVE_STAGES[index + 1] ?? "ready";
}

function countDoneStages(
  stageProgress: Record<PipelineStage, StageStatus>,
): number {
  return ACTIVE_STAGES.reduce((count, stage) => {
    return count + (stageProgress[stage].state === "done" ? 1 : 0);
  }, 0);
}

function toProgress(stageProgress: Record<PipelineStage, StageStatus>): number {
  if (stageProgress.generating.state === "done") {
    return 100;
  }
  return Math.round(
    (countDoneStages(stageProgress) / ACTIVE_STAGES.length) * 100,
  );
}

function derivePartialStats(
  stageProgress: Record<PipelineStage, StageStatus>,
): PartialImportStats | undefined {
  let resolvedStages = 0;
  let errorCount = 0;
  for (const stage of BACKEND_STAGES) {
    const status = stageProgress[stage].state;
    if (status === "done") resolvedStages += 1;
    if (status === "failed") errorCount += 1;
  }
  if (errorCount === 0 || resolvedStages === 0) return undefined;
  return {
    resolvedStages,
    totalStages: BACKEND_STAGES.length,
    errorCount,
  };
}

function withRetryAvailability(error: PipelineError): PipelineError {
  if (
    error.retryAfterMs === undefined ||
    error.retryAvailableAtMs !== undefined
  ) {
    return error;
  }
  return {
    ...error,
    retryAvailableAtMs: Date.now() + error.retryAfterMs,
  };
}

function stageStatusFromError(error: PipelineError): StageStatus {
  return {
    state: "failed",
    message: error.message,
    code: error.code,
    retryable: error.retryable,
    retryAfterMs: error.retryAfterMs,
    retryAvailableAtMs: error.retryAvailableAtMs,
    fallbackMode: error.fallbackMode,
    error,
  };
}

function toRetryRequest(
  error: PipelineError,
): PipelineRetryRequest | undefined {
  if (!error.retryable || !RETRYABLE_STAGE_SET.has(error.stage)) {
    return undefined;
  }
  const targetIds = error.retryTargets
    ?.map((target) => target.id)
    .filter((id) => id.length > 0);
  return {
    stage: error.stage,
    ...(targetIds !== undefined && targetIds.length > 0 ? { targetIds } : {}),
  };
}

function markStageDone(
  state: PastePipelineState,
  stage: PipelineStage,
  durationMs: number,
): PastePipelineState {
  const stageProgress = setStatus(state, stage, {
    state: "done",
    duration: durationMs,
  });
  const nextStage = nextActiveStage(stage);
  const advancedStageProgress =
    nextStage === "ready"
      ? stageProgress
      : {
          ...stageProgress,
          [nextStage]: {
            ...stageProgress[nextStage],
            state: "running",
          },
        };

  return {
    ...state,
    stage: nextStage,
    stageProgress: advancedStageProgress,
    progress: toProgress(advancedStageProgress),
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function pastePipelineReducer(
  state: PastePipelineState,
  action: PipelineAction,
): PastePipelineState {
  switch (action.type) {
    case "start": {
      const nextState = createInitialPipelineState();
      return {
        ...nextState,
        stage: "parsing",
        stageProgress: {
          ...nextState.stageProgress,
          parsing: { state: "running" },
        },
        canCancel: true,
      };
    }

    case "start_resolving": {
      const nextState = createInitialPipelineState();
      return {
        ...nextState,
        stage: "resolving",
        stageProgress: {
          ...nextState.stageProgress,
          parsing: { state: "done", duration: 0 },
          resolving: { state: "running" },
        },
        canCancel: true,
      };
    }

    case "parsing_done": {
      return markStageDone(state, "parsing", 0);
    }

    case "source_screens_ready": {
      return { ...state, sourceScreens: action.screens };
    }

    case "job_created": {
      return {
        ...state,
        jobId: action.jobId,
        jobStatus: "queued",
        ...(action.pasteDeltaSummary !== undefined
          ? { pasteDeltaSummary: action.pasteDeltaSummary }
          : {}),
        pasteIdentityKey: action.pasteDeltaSummary?.pasteIdentityKey,
        selectedNodeIds:
          action.selectedNodeIds && action.selectedNodeIds.length > 0
            ? action.selectedNodeIds
            : undefined,
      };
    }

    case "job_status_updated": {
      return {
        ...state,
        jobStatus: action.status,
        ...(action.previewUrl !== undefined
          ? { previewUrl: action.previewUrl }
          : {}),
      };
    }

    case "stage_start": {
      const stageProgress = setStatus(state, action.stage, {
        state: "running",
        message: action.message,
      });
      return {
        ...state,
        stage: action.stage,
        stageProgress,
      };
    }

    case "stage_message": {
      const previous = state.stageProgress[action.stage];
      return {
        ...state,
        stageProgress: setStatus(state, action.stage, {
          ...previous,
          message: action.message,
        }),
      };
    }

    case "stage_done": {
      return markStageDone(state, action.stage, action.durationMs);
    }

    case "stage_failed": {
      const error = withRetryAvailability(action.error);
      const stageProgress = setStatus(
        state,
        action.stage,
        stageStatusFromError(error),
      );
      const partialStats = derivePartialStats(stageProgress);
      const nextErrors = [...state.errors, error];
      const nextRetryRequest = toRetryRequest(error);
      return {
        ...state,
        stage: partialStats !== undefined ? "partial" : "error",
        outcome: partialStats !== undefined ? "partial" : "failed",
        stageProgress,
        errors: nextErrors,
        canRetry: nextErrors.some((entry) => entry.retryable),
        canCancel: false,
        ...(error.fallbackMode !== undefined
          ? { fallbackMode: error.fallbackMode }
          : {}),
        ...(nextRetryRequest !== undefined
          ? { retryRequest: nextRetryRequest }
          : {}),
        ...(partialStats !== undefined ? { partialStats } : {}),
      };
    }

    case "design_ir_ready": {
      return { ...state, designIR: action.designIR };
    }

    case "figma_analysis_ready": {
      return { ...state, figmaAnalysis: action.figmaAnalysis };
    }

    case "manifest_ready": {
      return { ...state, componentManifest: action.manifest };
    }

    case "files_ready": {
      return { ...state, generatedFiles: action.files };
    }

    case "token_intelligence_ready": {
      return { ...state, tokenIntelligence: action.tokenIntelligence };
    }

    case "screenshot_ready": {
      return { ...state, screenshot: action.screenshotUrl };
    }

    case "cancel_complete": {
      return createInitialPipelineState();
    }

    case "complete": {
      const stageProgress = {
        ...state.stageProgress,
        generating:
          state.stageProgress.generating.state === "failed"
            ? state.stageProgress.generating
            : ({ state: "done" } as const),
      };
      const outcome = action.outcome ?? "success";
      return {
        ...state,
        stage: outcome === "partial" ? "partial" : "ready",
        outcome,
        stageProgress,
        progress: 100,
        jobStatus: "completed",
        ...(action.previewUrl !== undefined
          ? { previewUrl: action.previewUrl }
          : {}),
        canRetry:
          outcome === "partial" && state.errors.some((e) => e.retryable),
        canCancel: false,
        ...(action.fallbackMode !== undefined
          ? { fallbackMode: action.fallbackMode }
          : {}),
        ...(outcome === "partial"
          ? {
              partialStats:
                derivePartialStats(stageProgress) ?? state.partialStats,
            }
          : {}),
      };
    }

    case "retry_stage": {
      const previous = state.stageProgress[action.stage];
      if (previous.state !== "failed") {
        return state;
      }
      const stageProgress = { ...state.stageProgress };
      stageProgress[action.stage] = {
        state: "running",
        message:
          action.targetIds !== undefined && action.targetIds.length > 0
            ? `Retrying ${String(action.targetIds.length)} failed target${action.targetIds.length === 1 ? "" : "s"}`
            : "Retrying stage",
      };
      let resetDownstream = false;
      for (const stage of ACTIVE_STAGES) {
        if (stage === action.stage) {
          resetDownstream = true;
          continue;
        }
        if (resetDownstream && stageProgress[stage].state !== "done") {
          stageProgress[stage] = { state: "pending" };
        }
      }
      return {
        ...state,
        stage: action.stage,
        outcome: undefined,
        stageProgress,
        errors: state.errors.filter((e) => e.stage !== action.stage),
        canRetry: false,
        canCancel: true,
        retryRequest: {
          stage: action.stage,
          ...(action.targetIds !== undefined && action.targetIds.length > 0
            ? { targetIds: action.targetIds }
            : {}),
        },
      };
    }

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Submit + cancel payload helpers
// ---------------------------------------------------------------------------

interface SubmitBody {
  figmaSourceMode: SubmitSourceMode;
  figmaJsonPayload: string;
  enableGitPr: false;
  llmCodegenMode: "deterministic";
  importMode?: PipelineImportMode;
  /** Server enforcement tracked under issue #1010. */
  selectedNodeIds?: readonly string[];
}

interface RetryStageBody {
  stage: PipelineStage;
  targetIds?: string[];
}

interface RetryStageAcceptedPayload {
  jobId?: string;
  sourceJobId?: string;
  status?: string;
  pasteDeltaSummary?: unknown;
}

function isPasteDeltaMode(
  value: unknown,
): value is PipelinePasteDeltaSummary["mode"] {
  return (
    value === "full" ||
    value === "delta" ||
    value === "auto_resolved_to_full" ||
    value === "auto_resolved_to_delta"
  );
}

function isPasteDeltaStrategy(
  value: unknown,
): value is PipelinePasteDeltaSummary["strategy"] {
  return (
    value === "baseline_created" ||
    value === "no_changes" ||
    value === "delta" ||
    value === "structural_break"
  );
}

export function isPasteDeltaSummary(
  input: unknown,
): input is PipelinePasteDeltaSummary {
  return (
    isRecord(input) &&
    isPasteDeltaMode(input.mode) &&
    isPasteDeltaStrategy(input.strategy) &&
    typeof input.totalNodes === "number" &&
    typeof input.nodesReused === "number" &&
    typeof input.nodesReprocessed === "number" &&
    typeof input.structuralChangeRatio === "number" &&
    typeof input.pasteIdentityKey === "string" &&
    typeof input.priorManifestMissing === "boolean"
  );
}

function buildSubmitBody(request: PipelineRequest): SubmitBody {
  const body: SubmitBody = {
    figmaSourceMode: request.sourceMode,
    figmaJsonPayload: request.payload,
    enableGitPr: false,
    llmCodegenMode: "deterministic",
  };
  if (request.importMode !== undefined) {
    body.importMode = request.importMode;
  }
  if (
    request.selectedNodeIds !== undefined &&
    request.selectedNodeIds.length > 0
  ) {
    body.selectedNodeIds = request.selectedNodeIds;
  }
  return body;
}

class SubmitError extends Error {
  readonly retryable: boolean;
  readonly retryAfterMs?: number | undefined;
  readonly fallbackMode?: PipelineFallbackMode | undefined;
  readonly targetIds?: string[] | undefined;
  readonly details?: Record<string, unknown> | undefined;

  constructor({
    message,
    retryable,
    retryAfterMs,
    fallbackMode,
    targetIds,
    details,
  }: {
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    fallbackMode?: PipelineFallbackMode;
    targetIds?: string[];
    details?: Record<string, unknown>;
  }) {
    super(message);
    this.name = "SubmitError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.fallbackMode = fallbackMode;
    this.targetIds = targetIds;
    this.details = details;
  }
}

function toPipelineStage(value: unknown): PipelineStage | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value in BACKEND_TO_PIPELINE_STAGE) {
    return BACKEND_TO_PIPELINE_STAGE[value];
  }
  if (
    value === "parsing" ||
    value === "resolving" ||
    value === "transforming" ||
    value === "mapping" ||
    value === "generating"
  ) {
    return value;
  }
  return undefined;
}

function toRetryTargets(
  value: unknown,
  stage: PipelineStage,
): PipelineRetryTarget[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const targets: PipelineRetryTarget[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id =
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.targetId === "string"
          ? entry.targetId
          : typeof entry.file === "string"
            ? entry.file
            : typeof entry.path === "string"
              ? entry.path
              : undefined;
    if (id === undefined || id.length === 0) {
      continue;
    }
    const filePath =
      typeof entry.file === "string"
        ? entry.file
        : typeof entry.path === "string"
          ? entry.path
          : undefined;
    const label =
      typeof entry.label === "string"
        ? entry.label
        : typeof entry.name === "string"
          ? entry.name
          : (filePath ?? id);
    targets.push({
      id,
      label,
      ...(filePath !== undefined ? { filePath } : {}),
      stage,
    });
  }
  return targets.length > 0 ? targets : undefined;
}

function toTargetIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const ids = value.filter((entry): entry is string => {
    return typeof entry === "string" && entry.length > 0;
  });
  return ids.length > 0 ? ids : undefined;
}

function parsePipelineErrorPayload({
  fallbackStage,
  payload,
  fallbackCode,
  fallbackMessage,
  fallbackRetryable,
}: {
  fallbackStage: PipelineStage;
  payload: unknown;
  fallbackCode: string;
  fallbackMessage: string;
  fallbackRetryable: boolean;
}): PipelineError {
  if (!isRecord(payload)) {
    return {
      stage: fallbackStage,
      code: fallbackCode,
      message: fallbackMessage,
      retryable: fallbackRetryable,
    };
  }

  const stage = toPipelineStage(payload.stage) ?? fallbackStage;
  const code =
    typeof payload.code === "string" && payload.code.length > 0
      ? payload.code
      : typeof payload.error === "string" && payload.error.length > 0
        ? payload.error
        : fallbackCode;
  const message =
    typeof payload.message === "string" && payload.message.length > 0
      ? payload.message
      : fallbackMessage;
  const retryable =
    typeof payload.retryable === "boolean"
      ? payload.retryable
      : fallbackRetryable;
  const retryAfterMs =
    typeof payload.retryAfterMs === "number" &&
    Number.isFinite(payload.retryAfterMs)
      ? payload.retryAfterMs
      : undefined;
  const fallbackMode =
    typeof payload.fallbackMode === "string" && payload.fallbackMode.length > 0
      ? (payload.fallbackMode as PipelineFallbackMode)
      : undefined;
  const retryTargets =
    toRetryTargets(payload.retryTargets, stage) ??
    (() => {
      const targetIds = toTargetIds(payload.targetIds);
      if (targetIds === undefined) {
        return undefined;
      }
      return targetIds.map((targetId) => ({
        id: targetId,
        label: targetId,
        stage,
      }));
    })();
  const details =
    isRecord(payload.details) && !Array.isArray(payload.details)
      ? payload.details
      : undefined;

  return {
    stage,
    code,
    message,
    retryable,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(fallbackMode !== undefined ? { fallbackMode } : {}),
    ...(retryTargets !== undefined ? { retryTargets } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

async function postSubmit({
  request,
  signal,
}: {
  request: PipelineRequest;
  signal: AbortSignal;
}): Promise<{
  jobId: string;
  pasteDeltaSummary?: PipelinePasteDeltaSummary;
}> {
  const response = await fetchJson<RetryStageAcceptedPayload>({
    url: endpoints.submit,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSubmitBody(request)),
      signal,
    },
  });

  if (response.status === 202 && isRecord(response.payload)) {
    const jobId = response.payload.jobId;
    if (typeof jobId === "string" && jobId.length > 0) {
      const pasteDeltaSummary = isPasteDeltaSummary(
        response.payload.pasteDeltaSummary,
      )
        ? response.payload.pasteDeltaSummary
        : undefined;
      return {
        jobId,
        ...(pasteDeltaSummary !== undefined ? { pasteDeltaSummary } : {}),
      };
    }
  }

  if (
    response.status >= 400 &&
    response.status < 500 &&
    isRecord(response.payload)
  ) {
    const error = parsePipelineErrorPayload({
      fallbackStage: "resolving",
      payload: response.payload,
      fallbackCode: "SUBMIT_FAILED",
      fallbackMessage: "Could not start import.",
      fallbackRetryable: false,
    });
    throw new SubmitError({
      message: error.code,
      retryable: error.retryable,
      ...(error.retryAfterMs !== undefined
        ? { retryAfterMs: error.retryAfterMs }
        : {}),
      ...(error.fallbackMode !== undefined
        ? { fallbackMode: error.fallbackMode }
        : {}),
      ...(error.retryTargets !== undefined
        ? { targetIds: error.retryTargets.map((target) => target.id) }
        : {}),
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }

  throw new SubmitError({
    message: "SUBMIT_FAILED",
    retryable: true,
  });
}

async function postRetryStage({
  jobId,
  request,
  signal,
}: {
  jobId: string;
  request: PipelineRetryRequest;
  signal: AbortSignal;
}): Promise<string> {
  const body: RetryStageBody = {
    stage: request.stage,
    ...(request.targetIds !== undefined && request.targetIds.length > 0
      ? { targetIds: request.targetIds }
      : {}),
  };
  const response = await fetchJson<RetryStageAcceptedPayload>({
    url: endpoints.retryStage({ jobId }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  });

  if (response.status === 202 && isRecord(response.payload)) {
    const nextJobId = response.payload.jobId;
    if (typeof nextJobId === "string" && nextJobId.length > 0) {
      return nextJobId;
    }
  }

  const error = parsePipelineErrorPayload({
    fallbackStage: request.stage,
    payload: response.payload,
    fallbackCode: "SUBMIT_FAILED",
    fallbackMessage: "Could not start retry.",
    fallbackRetryable: response.status >= 500 || response.status === 429,
  });
  throw new SubmitError({
    message: error.code,
    retryable: error.retryable,
    ...(error.retryAfterMs !== undefined
      ? { retryAfterMs: error.retryAfterMs }
      : {}),
    ...(error.fallbackMode !== undefined
      ? { fallbackMode: error.fallbackMode }
      : {}),
    ...(error.retryTargets !== undefined
      ? { targetIds: error.retryTargets.map((target) => target.id) }
      : {}),
    ...(error.details !== undefined ? { details: error.details } : {}),
  });
}

async function postCancel({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<JobPayload | null> {
  const response = await fetchJson<JobPayload>({
    url: endpoints.cancel({ jobId }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: CANCEL_REASON }),
      signal,
    },
  });

  if (response.ok && isJobPayload(response.payload)) {
    return response.payload;
  }

  return null;
}

function validatePipelineRequest(
  request: PipelineRequest,
): PipelineError | null {
  const byteLength = new TextEncoder().encode(request.payload).length;
  if (byteLength > FIGMA_PASTE_MAX_BYTES) {
    const catalogEntry = getPasteErrorMessage("PAYLOAD_TOO_LARGE");
    return {
      stage: "parsing",
      code: "PAYLOAD_TOO_LARGE",
      message: catalogEntry.description,
      retryable: catalogEntry.retryable,
    };
  }

  try {
    JSON.parse(request.payload);
  } catch {
    const catalogEntry = getPasteErrorMessage("SCHEMA_MISMATCH");
    return {
      stage: "parsing",
      code: "SCHEMA_MISMATCH",
      message: catalogEntry.description,
      retryable: catalogEntry.retryable,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Stage event derivation from backend payload
// ---------------------------------------------------------------------------

type StageEvent =
  | { kind: "start"; stage: PipelineStage; message: string }
  | { kind: "message"; stage: PipelineStage; message: string }
  | { kind: "done"; stage: PipelineStage }
  | { kind: "failed"; stage: PipelineStage; error: PipelineError };

interface RuntimeStagePayload extends JobStagePayload {
  fallbackMode?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  targetIds?: string[];
  retryTargets?: unknown;
  error?: unknown;
}

function describeStage(name: string, status: string): string {
  return `${name}: ${status}`;
}

function inferFailureStage(knownStatuses: Map<string, string>): PipelineStage {
  if (
    knownStatuses.has("codegen.generate") ||
    knownStatuses.has("validate.project") ||
    knownStatuses.has("repro.export") ||
    knownStatuses.has("git.pr")
  ) {
    return "generating";
  }
  if (knownStatuses.has("template.prepare")) {
    return "mapping";
  }
  if (knownStatuses.has("ir.derive")) {
    return "transforming";
  }
  return "resolving";
}

function collectRuntimeStages(payload: JobPayload): RuntimeStagePayload[] {
  const merged = new Map<string, RuntimeStagePayload>();

  for (const stage of payload.stages ?? []) {
    if (typeof stage.name !== "string" || stage.name.length === 0) {
      continue;
    }
    merged.set(stage.name, {
      ...stage,
      name: stage.name,
      status: stage.status,
    });
  }

  const upsertRuntimeStage = (name: string, value: unknown): void => {
    if (!isRecord(value)) {
      return;
    }
    const existing = merged.get(name);
    merged.set(name, {
      ...(existing ?? { name, status: "pending" }),
      ...value,
      name,
      status:
        typeof value.status === "string"
          ? value.status
          : (existing?.status ?? "pending"),
    });
  };

  const stageResults = payload.stageResults;
  if (Array.isArray(stageResults)) {
    for (const value of stageResults) {
      if (!isRecord(value) || typeof value.name !== "string") {
        continue;
      }
      upsertRuntimeStage(value.name, value);
    }
  } else if (isRecord(stageResults)) {
    for (const [name, value] of Object.entries(stageResults)) {
      upsertRuntimeStage(name, value);
    }
  }

  const inspector = payload.inspector;
  if (isRecord(inspector) && Array.isArray(inspector.stages)) {
    for (const value of inspector.stages) {
      if (!isRecord(value) || typeof value.stage !== "string") {
        continue;
      }
      upsertRuntimeStage(value.stage, {
        name: value.stage,
        status: value.status,
        ...(typeof value.code === "string" ? { code: value.code } : {}),
        ...(typeof value.message === "string"
          ? { message: value.message }
          : {}),
        ...(typeof value.retryable === "boolean"
          ? { retryable: value.retryable }
          : {}),
        ...(typeof value.retryAfterMs === "number"
          ? { retryAfterMs: value.retryAfterMs }
          : {}),
        ...(typeof value.fallbackMode === "string"
          ? { fallbackMode: value.fallbackMode }
          : {}),
        ...(value.retryTargets !== undefined
          ? { retryTargets: value.retryTargets }
          : {}),
      });
    }
  }

  return [...merged.values()];
}

function getInspectorOutcome(
  payload: JobPayload,
): JobInspectorPayload["outcome"] | undefined {
  return isRecord(payload.inspector) &&
    typeof payload.inspector.outcome === "string"
    ? payload.inspector.outcome
    : undefined;
}

function getJobFallbackMode(
  payload: JobPayload,
): PipelineFallbackMode | undefined {
  if (
    typeof payload.fallbackMode === "string" &&
    payload.fallbackMode.length > 0
  ) {
    return payload.fallbackMode as PipelineFallbackMode;
  }
  if (
    isRecord(payload.inspector) &&
    typeof payload.inspector.fallbackMode === "string" &&
    payload.inspector.fallbackMode.length > 0
  ) {
    return payload.inspector.fallbackMode as PipelineFallbackMode;
  }
  if (
    isRecord(payload.error) &&
    typeof payload.error.fallbackMode === "string" &&
    payload.error.fallbackMode.length > 0
  ) {
    return payload.error.fallbackMode as PipelineFallbackMode;
  }
  return undefined;
}

function stateLikePayloadHasPartialOutcome(payload: JobPayload): boolean {
  if (
    payload.outcome === "partial" ||
    getInspectorOutcome(payload) === "partial"
  ) {
    return true;
  }
  if (
    collectRuntimeStages(payload).some((stage) => stage.status === "failed")
  ) {
    return true;
  }
  return (
    isRecord(payload.error) &&
    typeof payload.error.code === "string" &&
    payload.error.code.length > 0 &&
    payload.status === "completed"
  );
}

function stageTransitionEvents(
  stage: RuntimeStagePayload,
  knownStatuses: Map<string, string>,
  jobPayload: JobPayload,
): StageEvent[] {
  const mappedStage = BACKEND_TO_PIPELINE_STAGE[stage.name];
  if (mappedStage === undefined) {
    return [];
  }

  const previousStatus = knownStatuses.get(stage.name);
  if (previousStatus === stage.status) {
    return [];
  }
  knownStatuses.set(stage.name, stage.status);

  if (stage.status === "running") {
    return [
      {
        kind: "start",
        stage: mappedStage,
        message: describeStage(stage.name, stage.status),
      },
    ];
  }

  if (stage.status === "completed") {
    if (
      stage.name === "figma.source" ||
      stage.name === "ir.derive" ||
      stage.name === "template.prepare"
    ) {
      return [{ kind: "done", stage: mappedStage }];
    }

    return [
      {
        kind: "message",
        stage: mappedStage,
        message: describeStage(stage.name, stage.status),
      },
    ];
  }

  if (stage.status === "failed") {
    const catalogEntry = getPasteErrorMessage("STAGE_FAILED");
    const error = parsePipelineErrorPayload({
      fallbackStage: mappedStage,
      payload:
        isRecord(stage.error) || isRecord(stage)
          ? {
              ...((isRecord(stage.error) ? stage.error : {}) as Record<
                string,
                unknown
              >),
              ...stage,
            }
          : jobPayload.error,
      fallbackCode:
        typeof stage.code === "string" && stage.code.length > 0
          ? stage.code
          : "STAGE_FAILED",
      fallbackMessage:
        typeof stage.message === "string" && stage.message.length > 0
          ? stage.message
          : (jobPayload.error?.message ?? catalogEntry.description),
      fallbackRetryable:
        typeof stage.retryable === "boolean"
          ? stage.retryable
          : catalogEntry.retryable,
    });
    return [
      {
        kind: "failed",
        stage: mappedStage,
        error,
      },
    ];
  }

  return [
    {
      kind: "message",
      stage: mappedStage,
      message: describeStage(stage.name, stage.status),
    },
  ];
}

function applyJobPayload({
  payload,
  knownStatuses,
  apply,
}: {
  payload: JobPayload;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
}): void {
  const previewUrl =
    typeof payload.preview?.url === "string" ? payload.preview.url : undefined;
  const status = payload.status;
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "partial" ||
    status === "failed" ||
    status === "canceled"
  ) {
    apply({
      type: "job_status_updated",
      status,
      ...(previewUrl !== undefined ? { previewUrl } : {}),
    });
  }

  const runtimeStages = collectRuntimeStages(payload);
  let emittedFailedEvent = false;
  for (const stage of runtimeStages) {
    const events = stageTransitionEvents(stage, knownStatuses, payload);
    for (const event of events) {
      if (event.kind === "start") {
        apply({
          type: "stage_start",
          stage: event.stage,
          message: event.message,
        });
      } else if (event.kind === "message") {
        apply({
          type: "stage_message",
          stage: event.stage,
          message: event.message,
        });
      } else if (event.kind === "done") {
        apply({ type: "stage_done", stage: event.stage, durationMs: 0 });
      } else {
        emittedFailedEvent = true;
        apply({
          type: "stage_failed",
          stage: event.stage,
          error: event.error,
        });
      }
    }
  }

  const terminalErrorKey = "__terminal_error__";
  if (
    !emittedFailedEvent &&
    (payload.status === "failed" || payload.outcome === "partial") &&
    isRecord(payload.error)
  ) {
    const errorCode =
      typeof payload.error.code === "string" ? payload.error.code : undefined;
    const errorStage = toPipelineStage(payload.error.stage);
    if (
      (errorCode !== undefined || errorStage !== undefined) &&
      knownStatuses.get(terminalErrorKey) !==
        `${errorStage ?? "unknown"}:${errorCode ?? "unknown"}`
    ) {
      const stage = errorStage ?? inferFailureStage(knownStatuses);
      knownStatuses.set(
        terminalErrorKey,
        `${errorStage ?? "unknown"}:${errorCode ?? "unknown"}`,
      );
      apply({
        type: "stage_failed",
        stage,
        error: parsePipelineErrorPayload({
          fallbackStage: stage,
          payload: payload.error,
          fallbackCode:
            payload.status === "failed" ? "JOB_FAILED" : "STAGE_FAILED",
          fallbackMessage:
            typeof payload.error.message === "string"
              ? payload.error.message
              : payload.status === "failed"
                ? "Import failed."
                : "Import completed with partial results.",
          fallbackRetryable: payload.status !== "failed",
        }),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Artifact fetchers
// ---------------------------------------------------------------------------

function isDesignIrPayload(value: unknown): value is DesignIrPayload {
  return (
    isRecord(value) &&
    typeof value.jobId === "string" &&
    Array.isArray(value.screens)
  );
}

function isFigmaAnalysisPayload(value: unknown): value is FigmaAnalysisPayload {
  return isRecord(value) && typeof value.jobId === "string";
}

function isComponentManifestPayload(
  value: unknown,
): value is ComponentManifestPayload {
  return (
    isRecord(value) &&
    typeof value.jobId === "string" &&
    Array.isArray(value.screens)
  );
}

async function fetchDesignIr({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<DesignIrPayload | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.designIr({ jobId }),
    init: { signal },
  });
  return response.ok && isDesignIrPayload(response.payload)
    ? response.payload
    : null;
}

async function fetchManifest({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<ComponentManifestPayload | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.manifest({ jobId }),
    init: { signal },
  });
  return response.ok && isComponentManifestPayload(response.payload)
    ? response.payload
    : null;
}

async function fetchFigmaAnalysis({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<FigmaAnalysisPayload | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.figmaAnalysis({ jobId }),
    init: { signal },
  });
  return response.ok && isFigmaAnalysisPayload(response.payload)
    ? response.payload
    : null;
}

async function fetchFiles({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<GeneratedFileEntry[] | null> {
  const response = await fetchJson<{ files?: unknown }>({
    url: endpoints.files({ jobId }),
    init: { signal },
  });
  if (
    !response.ok ||
    !isRecord(response.payload) ||
    !Array.isArray(response.payload.files)
  ) {
    return null;
  }

  const files: GeneratedFileEntry[] = [];
  for (const entry of response.payload.files) {
    if (
      isRecord(entry) &&
      typeof entry.path === "string" &&
      typeof entry.sizeBytes === "number"
    ) {
      files.push({ path: entry.path, sizeBytes: entry.sizeBytes });
    }
  }
  return files;
}

function isTokenIntelligenceConflictArray(
  value: unknown,
): value is TokenIntelligenceConflict[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.name === "string" &&
      typeof entry.figmaValue === "string" &&
      typeof entry.existingValue === "string" &&
      (entry.resolution === "figma" || entry.resolution === "existing"),
  );
}

function isTokenIntelligenceMappingArray(
  value: unknown,
): value is TokenIntelligenceCodeConnectMapping[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.nodeId === "string" &&
      typeof entry.componentName === "string" &&
      typeof entry.source === "string",
  );
}

export interface TokenDecisionsPayload {
  jobId: string;
  updatedAt: string | null;
  acceptedTokenNames: string[];
  rejectedTokenNames: string[];
}

/**
 * Persist token accept/reject decisions for a paste job. Returns the
 * server-confirmed snapshot, or throws on validation / network failure so
 * callers can surface an error.
 */
export async function postTokenDecisions({
  jobId,
  acceptedTokenNames,
  rejectedTokenNames,
  signal,
}: {
  jobId: string;
  acceptedTokenNames: readonly string[];
  rejectedTokenNames: readonly string[];
  signal?: AbortSignal;
}): Promise<TokenDecisionsPayload> {
  const response = await fetchJson<unknown>({
    url: endpoints.tokenDecisions({ jobId }),
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        acceptedTokenNames: [...acceptedTokenNames],
        rejectedTokenNames: [...rejectedTokenNames],
      }),
      ...(signal ? { signal } : {}),
    },
  });

  if (!response.ok || !isRecord(response.payload)) {
    throw new Error(
      `Failed to persist token decisions (status ${String(response.status)}).`,
    );
  }

  const payload = response.payload;
  const updatedAt =
    typeof payload.updatedAt === "string" ? payload.updatedAt : null;
  const accepted = Array.isArray(payload.acceptedTokenNames)
    ? payload.acceptedTokenNames.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const rejected = Array.isArray(payload.rejectedTokenNames)
    ? payload.rejectedTokenNames.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  return {
    jobId,
    updatedAt,
    acceptedTokenNames: accepted,
    rejectedTokenNames: rejected,
  };
}

async function fetchTokenIntelligence({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<TokenIntelligencePayload | null> {
  let response: Awaited<ReturnType<typeof fetchJson<unknown>>>;
  try {
    response = await fetchJson<unknown>({
      url: endpoints.tokenIntelligence({ jobId }),
      init: { signal },
    });
  } catch {
    return null;
  }
  if (!response.ok || !isRecord(response.payload)) return null;
  const payload = response.payload;

  const conflicts = isTokenIntelligenceConflictArray(payload.conflicts)
    ? payload.conflicts
    : [];
  const unmappedVariables = Array.isArray(payload.unmappedVariables)
    ? payload.unmappedVariables.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const libraryKeys = Array.isArray(payload.libraryKeys)
    ? payload.libraryKeys.filter(
        (entry): entry is string => typeof entry === "string",
      )
    : [];
  const cssCustomProperties =
    typeof payload.cssCustomProperties === "string"
      ? payload.cssCustomProperties
      : null;
  const codeConnectMappings = isTokenIntelligenceMappingArray(
    payload.codeConnectMappings,
  )
    ? payload.codeConnectMappings
    : [];
  const designSystemMappings = isTokenIntelligenceMappingArray(
    payload.designSystemMappings,
  )
    ? payload.designSystemMappings
    : [];
  const heuristicComponentMappings = isTokenIntelligenceMappingArray(
    payload.heuristicComponentMappings,
  )
    ? payload.heuristicComponentMappings
    : [];

  return {
    jobId,
    conflicts,
    unmappedVariables,
    libraryKeys,
    cssCustomProperties,
    codeConnectMappings,
    designSystemMappings,
    heuristicComponentMappings,
  };
}

async function fetchScreenshot({
  jobId,
  signal,
}: {
  jobId: string;
  signal: AbortSignal;
}): Promise<string | null> {
  let response: Awaited<ReturnType<typeof fetchJson<unknown>>>;
  try {
    response = await fetchJson<unknown>({
      url: endpoints.screenshot({ jobId }),
      init: { signal },
    });
  } catch {
    return null;
  }
  if (!response.ok || !isRecord(response.payload)) {
    return null;
  }
  const url =
    typeof response.payload.url === "string" ? response.payload.url : null;
  const screenshotUrl =
    typeof response.payload.screenshotUrl === "string"
      ? response.payload.screenshotUrl
      : null;
  return url ?? screenshotUrl;
}

async function fetchFinalArtifacts({
  jobId,
  signal,
  apply,
}: {
  jobId: string;
  signal: AbortSignal;
  apply: (action: PipelineAction) => void;
}): Promise<void> {
  const [designIR, figmaAnalysis, manifest, files, tokenIntelligence] =
    await Promise.all([
      fetchDesignIr({ jobId, signal }).catch(() => null),
      fetchFigmaAnalysis({ jobId, signal }).catch(() => null),
      fetchManifest({ jobId, signal }).catch(() => null),
      fetchFiles({ jobId, signal }).catch(() => null),
      fetchTokenIntelligence({ jobId, signal }).catch(() => null),
    ]);

  if (designIR !== null) {
    apply({ type: "design_ir_ready", designIR });
  }
  if (figmaAnalysis !== null) {
    apply({ type: "figma_analysis_ready", figmaAnalysis });
  }
  if (manifest !== null) {
    apply({ type: "manifest_ready", manifest });
  }
  if (files !== null) {
    apply({ type: "files_ready", files });
  }
  if (tokenIntelligence !== null) {
    apply({ type: "token_intelligence_ready", tokenIntelligence });
  }
}

function looksLikeFigmaNode(value: unknown): value is {
  id: string;
  name?: string;
  type: string;
  children?: unknown[];
} {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string"
  );
}

function extractSourceScreensFromPayload(payload: string): SourceScreenHint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return [];
  }

  const screens: SourceScreenHint[] = [];
  const seenIds = new Set<string>();

  const pushScreen = (node: {
    id: string;
    name?: string;
    type: string;
  }): void => {
    if (seenIds.has(node.id)) {
      return;
    }
    seenIds.add(node.id);
    screens.push({
      id: node.id,
      name:
        typeof node.name === "string" && node.name.trim().length > 0
          ? node.name.trim()
          : node.id,
      nodeType: node.type.toLowerCase(),
    });
  };

  const collectFromNode = (node: unknown): void => {
    if (!looksLikeFigmaNode(node)) {
      return;
    }

    if (
      node.type === "DOCUMENT" ||
      node.type === "CANVAS" ||
      node.type === "PAGE" ||
      node.type === "SECTION"
    ) {
      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          collectFromNode(child);
        }
      }
      return;
    }

    pushScreen(node);
  };

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        collect(entry);
      }
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    if (Array.isArray(value.selections)) {
      for (const selection of value.selections) {
        if (isRecord(selection) && "document" in selection) {
          collectFromNode(selection.document);
        }
      }
      return;
    }

    if ("document" in value) {
      collectFromNode(value.document);
      return;
    }

    if ("data" in value) {
      collect(value.data);
      return;
    }

    collectFromNode(value);
  };

  collect(parsed);
  return screens;
}

// ---------------------------------------------------------------------------
// Shared runtime helpers
// ---------------------------------------------------------------------------

async function waitForNextPoll({
  signal,
}: {
  signal: AbortSignal;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, POLL_INTERVAL_MS);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function hasActiveOrCompletedStage(
  payload: JobPayload,
  stageNames: readonly string[],
): boolean {
  return collectRuntimeStages(payload).some((stage) => {
    return (
      stageNames.includes(stage.name) &&
      (stage.status === "running" || stage.status === "completed")
    );
  });
}

async function pollUntilTerminal({
  jobId,
  signal,
  knownStatuses,
  apply,
  onPayload,
}: {
  jobId: string;
  signal: AbortSignal;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
  onPayload?: (payload: JobPayload) => Promise<void> | void;
}): Promise<JobPayload> {
  for (;;) {
    const response = await fetchJson<JobPayload>({
      url: endpoints.job({ jobId }),
      init: { signal },
    });

    if (!response.ok || !isJobPayload(response.payload)) {
      throw new SubmitError({
        message: "POLL_FAILED",
        retryable: true,
      });
    }

    const payload = response.payload;
    applyJobPayload({ payload, knownStatuses, apply });
    if (onPayload) {
      await onPayload(payload);
    }

    if (
      payload.status === "completed" ||
      payload.status === "partial" ||
      payload.status === "failed" ||
      payload.status === "canceled"
    ) {
      return payload;
    }

    await waitForNextPoll({ signal });
  }
}

async function executePipelineRun({
  request,
  retryRequest,
  sourceJobId,
  signal,
  knownStatuses,
  apply,
}: {
  request: PipelineRequest;
  retryRequest?: PipelineRetryRequest | undefined;
  sourceJobId?: string | undefined;
  signal: AbortSignal;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
}): Promise<{ jobId?: string }> {
  if (retryRequest === undefined) {
    const startsResolving = request.sourceMode === "figma_url";
    apply({ type: startsResolving ? "start_resolving" : "start" });

    const requestError = validatePipelineRequest(request);
    if (requestError !== null) {
      apply({
        type: "stage_failed",
        stage: "parsing",
        error: requestError,
      });
      return {};
    }

    if (!startsResolving) {
      apply({ type: "parsing_done" });
      const sourceScreens = extractSourceScreensFromPayload(request.payload);
      if (sourceScreens.length > 0) {
        apply({ type: "source_screens_ready", screens: sourceScreens });
      }
    }
  }

  let jobId: string;
  let pasteDeltaSummary: PipelinePasteDeltaSummary | undefined;
  try {
    if (retryRequest !== undefined && sourceJobId !== undefined) {
      apply({
        type: "retry_stage",
        stage: retryRequest.stage,
        ...(retryRequest.targetIds !== undefined
          ? { targetIds: retryRequest.targetIds }
          : {}),
      });
      jobId = await postRetryStage({
        jobId: sourceJobId,
        request: retryRequest,
        signal,
      });
    } else {
      const submitted = await postSubmit({ request, signal });
      jobId = submitted.jobId;
      pasteDeltaSummary = submitted.pasteDeltaSummary;
    }
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    const message = error instanceof Error ? error.message : "SUBMIT_FAILED";
    const retryable = error instanceof SubmitError ? error.retryable : true;
    const retryAfterMs =
      error instanceof SubmitError ? error.retryAfterMs : undefined;
    const fallbackMode =
      error instanceof SubmitError ? error.fallbackMode : undefined;
    const targetIds =
      error instanceof SubmitError ? error.targetIds : undefined;
    const stage = retryRequest?.stage ?? "resolving";
    apply({
      type: "stage_failed",
      stage,
      error: {
        stage,
        code: message,
        message,
        retryable,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        ...(fallbackMode !== undefined ? { fallbackMode } : {}),
        ...(targetIds !== undefined
          ? {
              retryTargets: targetIds.map((targetId) => ({
                id: targetId,
                label: targetId,
                stage,
              })),
            }
          : {}),
      },
    });
    return {};
  }

  apply({
    type: "job_created",
    jobId,
    ...(pasteDeltaSummary !== undefined ? { pasteDeltaSummary } : {}),
    ...(request.selectedNodeIds !== undefined &&
    request.selectedNodeIds.length > 0
      ? { selectedNodeIds: request.selectedNodeIds }
      : {}),
  });

  let screenshotFetched = false;
  const maybeFetchRunningArtifacts = async (
    payload: JobPayload,
  ): Promise<void> => {
    if (payload.status !== "running") {
      return;
    }

    const tasks: Array<Promise<void>> = [];

    if (hasActiveOrCompletedStage(payload, ["figma.source", "ir.derive"])) {
      tasks.push(
        fetchFigmaAnalysis({ jobId, signal })
          .then((figmaAnalysis) => {
            if (figmaAnalysis !== null) {
              apply({ type: "figma_analysis_ready", figmaAnalysis });
            }
          })
          .catch(() => {
            // Artifact is still pending; keep polling.
          }),
      );
    }

    if (hasActiveOrCompletedStage(payload, ["ir.derive"])) {
      tasks.push(
        fetchDesignIr({ jobId, signal })
          .then((designIR) => {
            if (designIR !== null) {
              apply({ type: "design_ir_ready", designIR });
            }
          })
          .catch(() => {
            // Artifact is still pending; keep polling.
          }),
      );
    }

    if (
      hasActiveOrCompletedStage(payload, [
        "codegen.generate",
        "validate.project",
        "repro.export",
        "git.pr",
      ])
    ) {
      tasks.push(
        fetchManifest({ jobId, signal })
          .then((manifest) => {
            if (manifest !== null) {
              apply({ type: "manifest_ready", manifest });
            }
          })
          .catch(() => {
            // Artifact is still pending; keep polling.
          }),
      );
      tasks.push(
        fetchFiles({ jobId, signal })
          .then((files) => {
            if (files !== null) {
              apply({ type: "files_ready", files });
            }
          })
          .catch(() => {
            // Artifact is still pending; keep polling.
          }),
      );
    }

    if (hasActiveOrCompletedStage(payload, ["figma.source", "ir.derive"])) {
      tasks.push(
        fetchTokenIntelligence({ jobId, signal })
          .then((tokenIntelligence) => {
            if (tokenIntelligence !== null) {
              apply({ type: "token_intelligence_ready", tokenIntelligence });
            }
          })
          .catch(() => {
            // Enrichment artifact may not exist yet; keep polling.
          }),
      );
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  };

  const applyMaybeScreenshot = (action: PipelineAction): void => {
    apply(action);
    if (
      !screenshotFetched &&
      action.type === "stage_done" &&
      action.stage === "resolving"
    ) {
      screenshotFetched = true;
      void fetchScreenshot({ jobId, signal }).then((screenshotUrl) => {
        if (screenshotUrl !== null) {
          apply({ type: "screenshot_ready", screenshotUrl });
        }
      });
    }
  };

  let payload: JobPayload;
  try {
    payload = await pollUntilTerminal({
      jobId,
      signal,
      knownStatuses,
      apply: applyMaybeScreenshot,
      onPayload: maybeFetchRunningArtifacts,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return { jobId };
    }

    apply({
      type: "stage_failed",
      stage: inferFailureStage(knownStatuses),
      error: {
        stage: inferFailureStage(knownStatuses),
        code: error instanceof Error ? error.message : "POLL_FAILED",
        message: error instanceof Error ? error.message : "POLL_FAILED",
        retryable: true,
      },
    });
    return { jobId };
  }

  if (payload.status === "failed") {
    const stage = inferFailureStage(knownStatuses);
    apply({
      type: "stage_failed",
      stage,
      error: parsePipelineErrorPayload({
        fallbackStage: stage,
        payload: payload.error,
        fallbackCode: "JOB_FAILED",
        fallbackMessage: payload.error?.message ?? "JOB_FAILED",
        fallbackRetryable: false,
      }),
    });
    return { jobId };
  }

  if (payload.status === "canceled") {
    apply({ type: "cancel_complete" });
    return { jobId };
  }

  const previewUrl =
    typeof payload.preview?.url === "string" ? payload.preview.url : undefined;
  const outcome =
    payload.outcome === "partial" || getInspectorOutcome(payload) === "partial"
      ? "partial"
      : payload.outcome === "failed" ||
          getInspectorOutcome(payload) === "failed"
        ? "failed"
        : stateLikePayloadHasPartialOutcome(payload)
          ? "partial"
          : "success";
  if (!previewUrl && outcome !== "partial") {
    apply({
      type: "stage_failed",
      stage: "generating",
      error: {
        stage: "generating",
        code: "MISSING_PREVIEW_URL",
        message: "Completed job is missing preview URL.",
        retryable: true,
      },
    });
    return { jobId };
  }

  try {
    await fetchFinalArtifacts({ jobId, signal, apply });
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }
  }
  const fallbackMode = getJobFallbackMode(payload);
  apply({
    type: "complete",
    ...(previewUrl !== undefined ? { previewUrl } : {}),
    outcome,
    ...(fallbackMode !== undefined ? { fallbackMode } : {}),
  });
  return { jobId };
}

async function executeCancellation({
  jobId,
  signal,
  knownStatuses,
  apply,
}: {
  jobId: string;
  signal: AbortSignal;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
}): Promise<void> {
  let payload: JobPayload | null;
  try {
    payload = await postCancel({ jobId, signal });
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    payload = null;
  }
  if (payload === null) {
    apply({
      type: "stage_failed",
      stage: inferFailureStage(knownStatuses),
      error: {
        stage: inferFailureStage(knownStatuses),
        code: "CANCEL_FAILED",
        message: "Cancellation request failed.",
        retryable: true,
      },
    });
    return;
  }

  applyJobPayload({ payload, knownStatuses, apply });
  if (payload.status === "canceled") {
    apply({ type: "cancel_complete" });
  }
}

// ---------------------------------------------------------------------------
// Imperative controller
// ---------------------------------------------------------------------------

interface ControllerRuntime {
  state: PastePipelineState;
  activeRunId: number;
  activeRunController?: AbortController;
  activeJobId: string | undefined;
  knownStatuses: Map<string, string>;
  lastRequest?: PipelineRequest;
}

export function startPastePipeline(
  payload: string,
  options?: PipelineOptions,
): PastePipelineController {
  const runtime: ControllerRuntime = {
    state: createInitialPipelineState(),
    activeRunId: 0,
    activeJobId: undefined,
    knownStatuses: new Map(),
  };

  const startRun = ({
    request,
    retryRequest,
    sourceJobId,
  }: {
    request: PipelineRequest;
    retryRequest?: PipelineRetryRequest;
    sourceJobId?: string;
  }): void => {
    runtime.activeRunId += 1;
    const runId = runtime.activeRunId;
    runtime.activeRunController?.abort();
    runtime.knownStatuses = new Map();
    runtime.activeJobId = undefined;
    runtime.lastRequest = request;

    const controller = new AbortController();
    runtime.activeRunController = controller;

    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
    }

    const apply = (action: PipelineAction): void => {
      if (runtime.activeRunId !== runId) {
        return;
      }
      if (action.type === "job_created") {
        runtime.activeJobId = action.jobId;
      }
      if (action.type === "cancel_complete") {
        runtime.activeJobId = undefined;
      }
      runtime.state = pastePipelineReducer(runtime.state, action);
    };

    void executePipelineRun({
      request,
      retryRequest,
      sourceJobId,
      signal: controller.signal,
      knownStatuses: runtime.knownStatuses,
      apply,
    }).then(({ jobId }) => {
      if (runtime.activeRunId === runId) {
        runtime.activeJobId = jobId;
      }
    });
  };

  startRun({
    request: {
      payload,
      sourceMode: options?.sourceMode ?? "figma_paste",
      skipScreenshot: options?.skipScreenshot === true,
      ...(options?.selectedNodeIds !== undefined
        ? { selectedNodeIds: options.selectedNodeIds }
        : {}),
      ...(options?.importMode !== undefined
        ? { importMode: options.importMode }
        : {}),
    },
  });

  return {
    cancel(): void {
      const activeJobId = runtime.activeJobId;
      runtime.activeRunId += 1;
      const runId = runtime.activeRunId;
      runtime.activeRunController?.abort();
      runtime.activeJobId = undefined;
      if (!activeJobId) {
        runtime.state = pastePipelineReducer(runtime.state, {
          type: "cancel_complete",
        });
        return;
      }

      const cancelController = new AbortController();
      runtime.activeRunController = cancelController;
      const apply = (action: PipelineAction): void => {
        if (runtime.activeRunId !== runId) {
          return;
        }
        if (action.type === "job_created") {
          runtime.activeJobId = action.jobId;
        }
        if (action.type === "cancel_complete") {
          runtime.activeJobId = undefined;
        }
        runtime.state = pastePipelineReducer(runtime.state, action);
      };
      void executeCancellation({
        jobId: activeJobId,
        signal: cancelController.signal,
        knownStatuses: runtime.knownStatuses,
        apply,
      });
    },

    retry(requestOverride?: PipelineRetryRequest): void {
      const lastRequest = runtime.lastRequest;
      if (!lastRequest) {
        return;
      }
      const retryRequest = requestOverride ?? runtime.state.retryRequest;
      const sourceJobId = runtime.state.jobId;
      if (retryRequest !== undefined && sourceJobId !== undefined) {
        startRun({
          request: lastRequest,
          retryRequest,
          sourceJobId,
        });
        return;
      }
      startRun({ request: lastRequest });
    },

    getState(): PastePipelineState {
      return runtime.state;
    },
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UsePastePipelineResult {
  state: PastePipelineState;
  start(payload: string, options?: Omit<PipelineOptions, "signal">): void;
  cancel(): void;
  retry(request?: PipelineRetryRequest): void;
  executionLog: PipelineExecutionLog;
}

interface HookRuntime {
  activeRunId: number;
  activeRunController?: AbortController;
  activeJobId: string | undefined;
  knownStatuses: Map<string, string>;
  lastRequest?: PipelineRequest;
}

export function usePastePipeline(): UsePastePipelineResult {
  const [state, dispatch] = useReducer(
    pastePipelineReducer,
    undefined,
    createInitialPipelineState,
  );

  const runtimeRef = useRef<HookRuntime>({
    activeRunId: 0,
    activeJobId: undefined,
    knownStatuses: new Map(),
  });
  const [executionLog] = useState(() => createPipelineExecutionLog());

  const startRun = ({
    request,
    retryRequest,
    sourceJobId,
  }: {
    request: PipelineRequest;
    retryRequest?: PipelineRetryRequest;
    sourceJobId?: string;
  }): void => {
    const runtime = runtimeRef.current;
    runtime.activeRunId += 1;
    executionLog.clear();
    const runId = runtime.activeRunId;
    runtime.activeRunController?.abort();
    runtime.activeRunController = new AbortController();
    runtime.activeJobId = undefined;
    runtime.knownStatuses = new Map();
    runtime.lastRequest = request;

    const apply = (action: PipelineAction): void => {
      if (runtimeRef.current.activeRunId !== runId) {
        return;
      }
      if (action.type === "job_created") {
        runtimeRef.current.activeJobId = action.jobId;
      }
      if (action.type === "cancel_complete") {
        runtimeRef.current.activeJobId = undefined;
      }
      dispatch(action);
    };

    const loggedApply = (action: PipelineAction): void => {
      apply(action);
      const timestamp = new Date().toISOString();
      if (action.type === "parsing_done") {
        executionLog.addEntry({ timestamp, stage: "parsing", success: true });
      } else if (action.type === "stage_done") {
        executionLog.addEntry({
          timestamp,
          stage: action.stage,
          durationMs: action.durationMs,
          success: true,
        });
      } else if (action.type === "stage_failed") {
        executionLog.addEntry({
          timestamp,
          stage: action.error.stage,
          success: false,
          errorCode: action.error.code,
          errorMessage: action.error.message,
        });
      }
    };

    void executePipelineRun({
      request,
      retryRequest,
      sourceJobId,
      signal: runtime.activeRunController.signal,
      knownStatuses: runtime.knownStatuses,
      apply: loggedApply,
    }).then(({ jobId }) => {
      if (runtimeRef.current.activeRunId === runId) {
        runtimeRef.current.activeJobId = jobId;
      }
    });
  };

  useEffect(() => {
    const runtime = runtimeRef.current;
    return () => {
      runtime.activeRunController?.abort();
    };
  }, []);

  return {
    state,

    start(payload: string, options?: Omit<PipelineOptions, "signal">): void {
      startRun({
        request: {
          payload,
          sourceMode: options?.sourceMode ?? "figma_paste",
          skipScreenshot: options?.skipScreenshot === true,
          ...(options?.selectedNodeIds !== undefined
            ? { selectedNodeIds: options.selectedNodeIds }
            : {}),
          ...(options?.importMode !== undefined
            ? { importMode: options.importMode }
            : {}),
        },
      });
    },

    cancel(): void {
      const runtime = runtimeRef.current;
      const activeJobId = runtime.activeJobId;
      runtime.activeRunId += 1;
      const runId = runtime.activeRunId;
      runtime.activeRunController?.abort();
      runtime.activeJobId = undefined;
      if (!activeJobId) {
        dispatch({ type: "cancel_complete" });
        return;
      }

      const cancelController = new AbortController();
      runtime.activeRunController = cancelController;
      void executeCancellation({
        jobId: activeJobId,
        signal: cancelController.signal,
        knownStatuses: runtime.knownStatuses,
        apply: (action) => {
          if (runtimeRef.current.activeRunId === runId) {
            if (action.type === "cancel_complete") {
              runtimeRef.current.activeJobId = undefined;
            }
            dispatch(action);
          }
        },
      });
    },

    retry(requestOverride?: PipelineRetryRequest): void {
      const request = runtimeRef.current.lastRequest;
      if (!request) {
        return;
      }
      const retryRequest = requestOverride ?? state.retryRequest;
      const sourceJobId = state.jobId;
      if (retryRequest !== undefined && sourceJobId !== undefined) {
        startRun({
          request,
          retryRequest,
          sourceJobId,
        });
        return;
      }
      startRun({ request });
    },

    executionLog,
  };
}
