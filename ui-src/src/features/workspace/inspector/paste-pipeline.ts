import { useEffect, useReducer, useRef } from "react";
import { fetchJson } from "../../../lib/http";
import { isJobPayload, isRecord, type JobPayload, type JobStagePayload } from "../workspace-page.helpers";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";

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
  | "error";

type SubmitSourceMode = "figma_paste" | "figma_plugin";
type JobRuntimeStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled";

export interface StageStatus {
  state: "pending" | "running" | "done" | "failed";
  duration?: number;
  message?: string;
  error?: PipelineError;
}

export interface PipelineError {
  stage: PipelineStage;
  code: string;
  message: string;
  retryable: boolean;
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

export interface PastePipelineState {
  stage: PipelineStage;
  progress: number;
  stageProgress: Record<PipelineStage, StageStatus>;
  jobId?: string;
  jobStatus?: JobRuntimeStatus;
  previewUrl?: string;
  designIR?: DesignIrPayload;
  componentManifest?: ComponentManifestPayload;
  generatedFiles?: GeneratedFileEntry[];
  screenshot?: string;
  errors: PipelineError[];
  canRetry: boolean;
  canCancel: boolean;
}

export interface PastePipelineController {
  cancel(): void;
  retry(): void;
  getState(): PastePipelineState;
}

export interface PipelineOptions {
  signal?: AbortSignal;
  skipScreenshot?: boolean;
  sourceMode?: SubmitSourceMode;
}

interface PipelineRequest {
  payload: string;
  sourceMode: SubmitSourceMode;
  skipScreenshot: boolean;
}

export type PipelineAction =
  | { type: "start" }
  | { type: "parsing_done" }
  | { type: "job_created"; jobId: string }
  | {
      type: "job_status_updated";
      status: JobRuntimeStatus;
      previewUrl?: string;
    }
  | { type: "stage_start"; stage: PipelineStage; message: string }
  | { type: "stage_message"; stage: PipelineStage; message: string }
  | { type: "stage_done"; stage: PipelineStage; durationMs: number }
  | { type: "stage_failed"; stage: PipelineStage; error: PipelineError }
  | { type: "design_ir_ready"; designIR: DesignIrPayload }
  | { type: "manifest_ready"; manifest: ComponentManifestPayload }
  | { type: "files_ready"; files: GeneratedFileEntry[] }
  | { type: "cancel_complete" }
  | { type: "complete"; previewUrl: string };

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

const ALL_STAGES: readonly PipelineStage[] = [
  "idle",
  "parsing",
  "resolving",
  "transforming",
  "mapping",
  "generating",
  "ready",
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
  cancel: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/cancel`,
  designIr: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/design-ir`,
  manifest: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/component-manifest`,
  files: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/files`,
};

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
  return Math.round((countDoneStages(stageProgress) / ACTIVE_STAGES.length) * 100);
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

    case "parsing_done": {
      return markStageDone(state, "parsing", 0);
    }

    case "job_created": {
      return {
        ...state,
        jobId: action.jobId,
        jobStatus: "queued",
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
      return {
        ...state,
        stage: "error",
        stageProgress: setStatus(state, action.stage, {
          state: "failed",
          error: action.error,
        }),
        errors: [...state.errors, action.error],
        canRetry: action.error.retryable,
        canCancel: false,
      };
    }

    case "design_ir_ready": {
      return { ...state, designIR: action.designIR };
    }

    case "manifest_ready": {
      return { ...state, componentManifest: action.manifest };
    }

    case "files_ready": {
      return { ...state, generatedFiles: action.files };
    }

    case "cancel_complete": {
      return createInitialPipelineState();
    }

    case "complete": {
      const stageProgress = {
        ...state.stageProgress,
        generating: { state: "done" as const },
      };
      return {
        ...state,
        stage: "ready",
        stageProgress,
        progress: 100,
        jobStatus: "completed",
        previewUrl: action.previewUrl,
        canRetry: false,
        canCancel: false,
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
}

function buildSubmitBody(request: PipelineRequest): SubmitBody {
  return {
    figmaSourceMode: request.sourceMode,
    figmaJsonPayload: request.payload,
    enableGitPr: false,
    llmCodegenMode: "deterministic",
  };
}

class SubmitError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "SubmitError";
    this.retryable = retryable;
  }
}

async function postSubmit({
  request,
  signal,
}: {
  request: PipelineRequest;
  signal: AbortSignal;
}): Promise<string> {
  const response = await fetchJson<{ jobId?: string; error?: string }>({
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
      return jobId;
    }
  }

  if (
    response.status >= 400 &&
    response.status < 500 &&
    isRecord(response.payload)
  ) {
    const code =
      typeof response.payload.error === "string"
        ? response.payload.error
        : "SUBMIT_FAILED";
    throw new SubmitError(code, false);
  }

  throw new SubmitError("SUBMIT_FAILED", true);
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

function validatePipelineRequest(request: PipelineRequest): PipelineError | null {
  const byteLength = new TextEncoder().encode(request.payload).length;
  if (byteLength > FIGMA_PASTE_MAX_BYTES) {
    return {
      stage: "parsing",
      code: "PAYLOAD_TOO_LARGE",
      message: `Payload exceeds the ${String(FIGMA_PASTE_MAX_BYTES / (1024 * 1024))} MiB limit.`,
      retryable: false,
    };
  }

  try {
    JSON.parse(request.payload);
  } catch {
    return {
      stage: "parsing",
      code: "SCHEMA_MISMATCH",
      message: "Payload must be valid JSON.",
      retryable: false,
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

function stageTransitionEvents(
  stage: JobStagePayload,
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
    return [
      {
        kind: "failed",
        stage: mappedStage,
        error: {
          stage: mappedStage,
          code: "STAGE_FAILED",
          message: jobPayload.error?.message ?? stage.name,
          retryable: true,
        },
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
    status === "failed" ||
    status === "canceled"
  ) {
    apply({
      type: "job_status_updated",
      status,
      ...(previewUrl !== undefined ? { previewUrl } : {}),
    });
  }

  for (const stage of payload.stages ?? []) {
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
        apply({
          type: "stage_failed",
          stage: event.stage,
          error: event.error,
        });
      }
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
  if (!response.ok || !isRecord(response.payload) || !Array.isArray(response.payload.files)) {
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

async function fetchFinalArtifacts({
  jobId,
  signal,
  apply,
}: {
  jobId: string;
  signal: AbortSignal;
  apply: (action: PipelineAction) => void;
}): Promise<void> {
  const [designIR, manifest, files] = await Promise.all([
    fetchDesignIr({ jobId, signal }).catch(() => null),
    fetchManifest({ jobId, signal }).catch(() => null),
    fetchFiles({ jobId, signal }).catch(() => null),
  ]);

  if (designIR !== null) {
    apply({ type: "design_ir_ready", designIR });
  }
  if (manifest !== null) {
    apply({ type: "manifest_ready", manifest });
  }
  if (files !== null) {
    apply({ type: "files_ready", files });
  }
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

async function pollUntilTerminal({
  jobId,
  signal,
  knownStatuses,
  apply,
}: {
  jobId: string;
  signal: AbortSignal;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
}): Promise<JobPayload> {
  for (;;) {
    const response = await fetchJson<JobPayload>({
      url: endpoints.job({ jobId }),
      init: { signal },
    });

    if (!response.ok || !isJobPayload(response.payload)) {
      throw new SubmitError("POLL_FAILED", true);
    }

    const payload = response.payload;
    applyJobPayload({ payload, knownStatuses, apply });

    if (
      payload.status === "completed" ||
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
  signal,
  knownStatuses,
  apply,
}: {
  request: PipelineRequest;
  signal: AbortSignal;
  knownStatuses: Map<string, string>;
  apply: (action: PipelineAction) => void;
}): Promise<{ jobId?: string }> {
  apply({ type: "start" });

  const requestError = validatePipelineRequest(request);
  if (requestError !== null) {
    apply({
      type: "stage_failed",
      stage: "parsing",
      error: requestError,
    });
    return {};
  }

  apply({ type: "parsing_done" });

  let jobId: string;
  try {
    jobId = await postSubmit({ request, signal });
  } catch (error) {
    if (isAbortError(error)) {
      return {};
    }
    const message = error instanceof Error ? error.message : "SUBMIT_FAILED";
    const retryable = error instanceof SubmitError ? error.retryable : true;
    apply({
      type: "stage_failed",
      stage: "resolving",
      error: {
        stage: "resolving",
        code: message,
        message,
        retryable,
      },
    });
    return {};
  }

  apply({ type: "job_created", jobId });

  let payload: JobPayload;
  try {
    payload = await pollUntilTerminal({
      jobId,
      signal,
      knownStatuses,
      apply,
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
      error: {
        stage,
        code: "JOB_FAILED",
        message: payload.error?.message ?? "JOB_FAILED",
        retryable: false,
      },
    });
    return { jobId };
  }

  if (payload.status === "canceled") {
    apply({ type: "cancel_complete" });
    return { jobId };
  }

  const previewUrl =
    typeof payload.preview?.url === "string" ? payload.preview.url : undefined;
  if (!previewUrl) {
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
  apply({ type: "complete", previewUrl });
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

  const startRun = (request: PipelineRequest): void => {
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
    payload,
    sourceMode: options?.sourceMode ?? "figma_paste",
    skipScreenshot: options?.skipScreenshot === true,
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

    retry(): void {
      const lastRequest = runtime.lastRequest;
      if (!lastRequest) {
        return;
      }
      startRun(lastRequest);
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
  retry(): void;
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

  const startRun = (request: PipelineRequest): void => {
    const runtime = runtimeRef.current;
    runtime.activeRunId += 1;
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

    void executePipelineRun({
      request,
      signal: runtime.activeRunController.signal,
      knownStatuses: runtime.knownStatuses,
      apply,
    }).then(({ jobId }) => {
      if (runtimeRef.current.activeRunId === runId) {
        runtimeRef.current.activeJobId = jobId;
      }
    });
  };

  useEffect(() => {
    return () => {
      runtimeRef.current.activeRunController?.abort();
    };
  }, []);

  return {
    state,

    start(payload: string, options?: Omit<PipelineOptions, "signal">): void {
      startRun({
        payload,
        sourceMode: options?.sourceMode ?? "figma_paste",
        skipScreenshot: options?.skipScreenshot === true,
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

    retry(): void {
      const request = runtimeRef.current.lastRequest;
      if (!request) {
        return;
      }
      startRun(request);
    },
  };
}
