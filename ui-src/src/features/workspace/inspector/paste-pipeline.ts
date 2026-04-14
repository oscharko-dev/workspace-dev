import { useEffect, useReducer, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchJson, type JsonResponse } from "../../../lib/http";
import { isJobPayload, isRecord } from "../workspace-page.helpers";
import type { JobPayload, JobStagePayload } from "../workspace-page.helpers";
import {
  isFigmaClipboard,
  parseFigmaClipboard,
  type FigmaMeta,
} from "./figma-clipboard-parser";
import { FIGMA_PASTE_MAX_BYTES } from "../submit-schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "idle"
  | "parsing"
  | "resolving"
  | "extracting"
  | "transforming"
  | "mapping"
  | "generating"
  | "ready"
  | "error"
  | "partial";

export interface StageStatus {
  state: "pending" | "running" | "done" | "failed" | "skipped";
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
  retry(fromStage?: PipelineStage): void;
  getState(): PastePipelineState;
}

export interface PipelineOptions {
  signal?: AbortSignal;
  skipScreenshot?: boolean;
}

export type PipelineAction =
  | { type: "start"; clipboardHtml: string }
  | { type: "parsing_done"; figmeta: FigmaMeta }
  | { type: "parsing_failed"; error: PipelineError }
  | { type: "job_created"; jobId: string }
  | { type: "stage_start"; stage: PipelineStage; message: string }
  | { type: "stage_message"; stage: PipelineStage; message: string }
  | { type: "stage_done"; stage: PipelineStage; durationMs: number }
  | { type: "stage_failed"; stage: PipelineStage; error: PipelineError }
  | { type: "screenshot_ready"; screenshot: string }
  | { type: "design_ir_ready"; designIR: DesignIrPayload }
  | { type: "manifest_ready"; manifest: ComponentManifestPayload }
  | { type: "files_ready"; files: GeneratedFileEntry[] }
  | { type: "cancel" }
  | { type: "retry"; fromStage?: PipelineStage }
  | { type: "complete" };

// ---------------------------------------------------------------------------
// Stage ordering + backend mapping
// ---------------------------------------------------------------------------

const ACTIVE_STAGES: readonly PipelineStage[] = [
  "parsing",
  "resolving",
  "extracting",
  "transforming",
  "mapping",
  "generating",
];

const ALL_STAGES: readonly PipelineStage[] = [
  "idle",
  "parsing",
  "resolving",
  "extracting",
  "transforming",
  "mapping",
  "generating",
  "ready",
  "error",
  "partial",
];

const PROGRESS_INCREMENT = Math.floor(100 / ACTIVE_STAGES.length);

const BACKEND_TO_PIPELINE_STAGE: Record<string, PipelineStage> = {
  "figma.source": "resolving",
  "ir.derive": "transforming",
  "figma.enrich": "mapping",
  codegen: "generating",
};

const POLL_INTERVAL_MS = 1_500;

const endpoints = {
  submit: "/workspace/submit",
  job: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}`,
  designIr: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/design-ir`,
  manifest: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/component-manifest`,
  files: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}/files`,
};

// ---------------------------------------------------------------------------
// Initial state
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

// ---------------------------------------------------------------------------
// Reducer helpers
// ---------------------------------------------------------------------------

function setStatus(
  state: PastePipelineState,
  stage: PipelineStage,
  status: StageStatus,
): Record<PipelineStage, StageStatus> {
  return { ...state.stageProgress, [stage]: status };
}

function nextActiveStage(stage: PipelineStage): PipelineStage {
  const idx = ACTIVE_STAGES.indexOf(stage);
  if (idx === -1 || idx === ACTIVE_STAGES.length - 1) {
    return "ready";
  }
  const next = ACTIVE_STAGES[idx + 1];
  return next ?? "ready";
}

function countDoneActiveStages(
  stageProgress: Record<PipelineStage, StageStatus>,
): number {
  let count = 0;
  for (const stage of ACTIVE_STAGES) {
    if (stageProgress[stage].state === "done") {
      count += 1;
    }
  }
  return count;
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
  const advanceTo = nextActiveStage(stage);
  const advancedProgress =
    advanceTo === "ready" || advanceTo === state.stage
      ? stageProgress
      : {
          ...stageProgress,
          [advanceTo]: { ...stageProgress[advanceTo], state: "running" },
        };
  const doneCount = countDoneActiveStages(advancedProgress);
  return {
    ...state,
    stage: advanceTo,
    stageProgress: advancedProgress,
    progress: Math.min(100, doneCount * PROGRESS_INCREMENT),
  };
}

function markStageFailed(
  state: PastePipelineState,
  stage: PipelineStage,
  error: PipelineError,
): PastePipelineState {
  const stageProgress = setStatus(state, stage, { state: "failed", error });
  return {
    ...state,
    stage: "error",
    stageProgress,
    errors: [...state.errors, error],
    canRetry: true,
    canCancel: false,
  };
}

function lastFailedStage(state: PastePipelineState): PipelineStage | null {
  for (let i = state.errors.length - 1; i >= 0; i -= 1) {
    const stage = state.errors[i]?.stage;
    if (stage !== undefined) {
      return stage;
    }
  }
  return null;
}

function resetStagesFrom(
  state: PastePipelineState,
  fromStage: PipelineStage,
): Record<PipelineStage, StageStatus> {
  const idx = ACTIVE_STAGES.indexOf(fromStage);
  if (idx === -1) {
    return state.stageProgress;
  }
  const next = { ...state.stageProgress };
  for (let i = idx; i < ACTIVE_STAGES.length; i += 1) {
    const stage = ACTIVE_STAGES[i];
    if (stage !== undefined) {
      next[stage] = { state: "pending" };
    }
  }
  next[fromStage] = { state: "running" };
  return next;
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
      const stageProgress = setStatus(state, "parsing", { state: "running" });
      return {
        ...state,
        stage: "parsing",
        stageProgress,
        canCancel: true,
        canRetry: false,
      };
    }

    case "parsing_done": {
      return markStageDone(state, "parsing", 0);
    }

    case "parsing_failed": {
      return markStageFailed(state, "parsing", action.error);
    }

    case "job_created": {
      return { ...state, jobId: action.jobId };
    }

    case "stage_start": {
      const stageProgress = setStatus(state, action.stage, {
        state: "running",
        message: action.message,
      });
      return { ...state, stageProgress };
    }

    case "stage_message": {
      const prev = state.stageProgress[action.stage];
      const stageProgress = setStatus(state, action.stage, {
        ...prev,
        message: action.message,
      });
      return { ...state, stageProgress };
    }

    case "stage_done": {
      return markStageDone(state, action.stage, action.durationMs);
    }

    case "stage_failed": {
      return markStageFailed(state, action.stage, action.error);
    }

    case "screenshot_ready": {
      return { ...state, screenshot: action.screenshot };
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

    case "cancel": {
      return createInitialPipelineState();
    }

    case "retry": {
      const fromStage = action.fromStage ?? lastFailedStage(state) ?? "parsing";
      const stageProgress = resetStagesFrom(state, fromStage);
      return {
        ...state,
        stage: fromStage,
        stageProgress,
        errors: [],
        canRetry: false,
        canCancel: true,
      };
    }

    case "complete": {
      return {
        ...state,
        stage: "ready",
        progress: 100,
        canRetry: false,
        canCancel: false,
      };
    }

    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Submit payload helpers
// ---------------------------------------------------------------------------

interface ClipboardSubmitBody {
  figmaSourceMode: "figma_clipboard";
  figmaClipboardHtml: string;
  enableGitPr: false;
}

function buildSubmitBody(clipboardHtml: string): ClipboardSubmitBody {
  return {
    figmaSourceMode: "figma_clipboard",
    figmaClipboardHtml: clipboardHtml,
    enableGitPr: false,
  };
}

async function postSubmit(
  clipboardHtml: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const response = await fetchJson<{ jobId?: string; error?: string }>({
    url: endpoints.submit,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSubmitBody(clipboardHtml)),
      ...(signal !== undefined ? { signal } : {}),
    },
  });

  if (response.status === 202 && isRecord(response.payload)) {
    const id = response.payload.jobId;
    if (typeof id === "string" && id.length > 0) {
      return id;
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
    throw Object.assign(new Error(code), { retryable: false });
  }

  throw Object.assign(new Error("SUBMIT_FAILED"), { retryable: true });
}

// ---------------------------------------------------------------------------
// Stage event derivation from backend payload
// ---------------------------------------------------------------------------

type StageEvent =
  | { kind: "start"; stage: PipelineStage; message: string }
  | { kind: "done"; stage: PipelineStage; extraDone?: PipelineStage }
  | { kind: "failed"; stage: PipelineStage; error: PipelineError };

function describeStage(name: string, status: string): string {
  return `${name}: ${status}`;
}

function toStageEvents(
  payload: JobPayload,
  knownStatuses: Map<string, string>,
): StageEvent[] {
  const events: StageEvent[] = [];
  const stages = payload.stages ?? [];
  for (const stage of stages) {
    const mapped = BACKEND_TO_PIPELINE_STAGE[stage.name];
    if (mapped === undefined) {
      continue;
    }
    const previous = knownStatuses.get(stage.name);
    if (previous === stage.status) {
      continue;
    }
    knownStatuses.set(stage.name, stage.status);
    events.push(...stageTransitionEvents(stage, mapped, payload));
  }
  return events;
}

function stageTransitionEvents(
  stage: JobStagePayload,
  mapped: PipelineStage,
  payload: JobPayload,
): StageEvent[] {
  if (stage.status === "running") {
    return [
      {
        kind: "start",
        stage: mapped,
        message: describeStage(stage.name, stage.status),
      },
    ];
  }
  if (stage.status === "completed") {
    if (stage.name === "figma.source") {
      return [{ kind: "done", stage: mapped, extraDone: "extracting" }];
    }
    return [{ kind: "done", stage: mapped }];
  }
  if (stage.status === "failed") {
    return [
      {
        kind: "failed",
        stage: mapped,
        error: {
          stage: mapped,
          code: "STAGE_FAILED",
          message: payload.error?.message ?? stage.name,
          retryable: true,
        },
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Artifact type guards
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

// ---------------------------------------------------------------------------
// Artifact fetchers
// ---------------------------------------------------------------------------

interface ArtifactFetchers {
  signal: AbortSignal;
  jobId: string;
}

async function fetchDesignIr({
  jobId,
  signal,
}: ArtifactFetchers): Promise<DesignIrPayload | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.designIr({ jobId }),
    init: { signal },
  });
  if (!response.ok || !isDesignIrPayload(response.payload)) {
    return null;
  }
  return response.payload;
}

async function fetchScreenshot({
  jobId,
  signal,
}: ArtifactFetchers): Promise<string | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.designIr({ jobId }),
    init: { signal },
  });
  if (!response.ok || !isRecord(response.payload)) {
    return null;
  }
  const screenshot = response.payload.screenshot;
  return typeof screenshot === "string" ? screenshot : null;
}

async function fetchManifest({
  jobId,
  signal,
}: ArtifactFetchers): Promise<ComponentManifestPayload | null> {
  const response = await fetchJson<unknown>({
    url: endpoints.manifest({ jobId }),
    init: { signal },
  });
  if (!response.ok || !isComponentManifestPayload(response.payload)) {
    return null;
  }
  return response.payload;
}

async function fetchFiles({
  jobId,
  signal,
}: ArtifactFetchers): Promise<GeneratedFileEntry[] | null> {
  const response = await fetchJson<{ files?: unknown }>({
    url: endpoints.files({ jobId }),
    init: { signal },
  });
  if (!response.ok || !isRecord(response.payload)) {
    return null;
  }
  const files = response.payload.files;
  if (!Array.isArray(files)) {
    return null;
  }
  const entries: GeneratedFileEntry[] = [];
  for (const item of files) {
    if (
      isRecord(item) &&
      typeof item.path === "string" &&
      typeof item.sizeBytes === "number"
    ) {
      entries.push({ path: item.path, sizeBytes: item.sizeBytes });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// startPastePipeline — imperative controller
// ---------------------------------------------------------------------------

interface PipelineRuntime {
  state: PastePipelineState;
  knownStatuses: Map<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
  finalized: boolean;
}

function submitFailureError(error: unknown): PipelineError {
  const message = error instanceof Error ? error.message : "SUBMIT_FAILED";
  const retryable =
    error instanceof Error
      ? (error as Error & { retryable?: boolean }).retryable !== false
      : true;
  return {
    stage: "resolving",
    code: message,
    message,
    retryable,
  };
}

export function startPastePipeline(
  clipboardHtml: string,
  options?: PipelineOptions,
): PastePipelineController {
  const abortController = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort();
    } else {
      options.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }
  }

  const runtime: PipelineRuntime = {
    state: createInitialPipelineState(),
    knownStatuses: new Map(),
    timer: null,
    finalized: false,
  };

  const apply = (action: PipelineAction): void => {
    runtime.state = pastePipelineReducer(runtime.state, action);
  };

  const finalize = (): void => {
    runtime.finalized = true;
    if (runtime.timer !== null) {
      clearTimeout(runtime.timer);
      runtime.timer = null;
    }
  };

  const handleArtifacts = async (
    event: StageEvent,
    jobId: string,
  ): Promise<void> => {
    if (event.kind !== "done") {
      return;
    }
    const fetchers: ArtifactFetchers = {
      jobId,
      signal: abortController.signal,
    };
    if (event.stage === "resolving" && options?.skipScreenshot !== true) {
      const screenshot = await fetchScreenshot(fetchers);
      if (screenshot !== null) {
        apply({ type: "screenshot_ready", screenshot });
      }
    }
    if (event.stage === "transforming") {
      const ir = await fetchDesignIr(fetchers);
      if (ir !== null) {
        apply({ type: "design_ir_ready", designIR: ir });
      }
    }
    if (event.stage === "generating") {
      const [manifest, files] = await Promise.all([
        fetchManifest(fetchers),
        fetchFiles(fetchers),
      ]);
      if (manifest !== null) {
        apply({ type: "manifest_ready", manifest });
      }
      if (files !== null) {
        apply({ type: "files_ready", files });
      }
    }
  };

  const applyEvent = (event: StageEvent): void => {
    if (event.kind === "start") {
      apply({
        type: "stage_start",
        stage: event.stage,
        message: event.message,
      });
      return;
    }
    if (event.kind === "done") {
      apply({ type: "stage_done", stage: event.stage, durationMs: 0 });
      if (event.extraDone !== undefined) {
        apply({
          type: "stage_done",
          stage: event.extraDone,
          durationMs: 0,
        });
      }
      return;
    }
    apply({ type: "stage_failed", stage: event.stage, error: event.error });
  };

  const pollOnce = async (jobId: string): Promise<void> => {
    if (abortController.signal.aborted || runtime.finalized) {
      return;
    }
    const response = await fetchJson<JobPayload>({
      url: endpoints.job({ jobId }),
      init: { signal: abortController.signal },
    });
    if (!response.ok || !isJobPayload(response.payload)) {
      apply({
        type: "stage_failed",
        stage: "resolving",
        error: {
          stage: "resolving",
          code: "POLL_FAILED",
          message: "POLL_FAILED",
          retryable: true,
        },
      });
      finalize();
      return;
    }

    const events = toStageEvents(response.payload, runtime.knownStatuses);
    for (const event of events) {
      applyEvent(event);
      await handleArtifacts(event, jobId);
    }

    const status = response.payload.status;
    if (status === "completed") {
      apply({ type: "complete" });
      finalize();
      return;
    }
    if (status === "failed") {
      apply({
        type: "stage_failed",
        stage:
          runtime.state.stage === "error" ? "generating" : runtime.state.stage,
        error: {
          stage: runtime.state.stage,
          code: "JOB_FAILED",
          message: response.payload.error?.message ?? "JOB_FAILED",
          retryable: false,
        },
      });
      finalize();
      return;
    }
    if (status === "canceled") {
      apply({ type: "cancel" });
      finalize();
      return;
    }

    runtime.timer = setTimeout(() => {
      void pollOnce(jobId);
    }, POLL_INTERVAL_MS);
  };

  const run = async (): Promise<void> => {
    apply({ type: "start", clipboardHtml });

    if (!isFigmaClipboard(clipboardHtml)) {
      apply({ type: "cancel" });
      finalize();
      return;
    }
    const figmeta = parseFigmaClipboard(clipboardHtml);
    if (figmeta === null) {
      apply({ type: "cancel" });
      finalize();
      return;
    }
    apply({ type: "parsing_done", figmeta: figmeta.meta });

    let jobId: string;
    try {
      jobId = await postSubmit(clipboardHtml, abortController.signal);
    } catch (error) {
      apply({
        type: "stage_failed",
        stage: "resolving",
        error: submitFailureError(error),
      });
      finalize();
      return;
    }

    apply({ type: "job_created", jobId });
    await pollOnce(jobId);
  };

  void run();

  return {
    cancel(): void {
      abortController.abort();
      apply({ type: "cancel" });
      finalize();
    },
    retry(fromStage?: PipelineStage): void {
      apply(
        fromStage !== undefined
          ? { type: "retry", fromStage }
          : { type: "retry" },
      );
    },
    getState(): PastePipelineState {
      return runtime.state;
    },
  };
}

// ---------------------------------------------------------------------------
// usePastePipeline — React hook
// ---------------------------------------------------------------------------

export interface UsePastePipelineResult {
  state: PastePipelineState;
  start(clipboardHtml: string, options?: PipelineOptions): void;
  cancel(): void;
  retry(fromStage?: PipelineStage): void;
}

function toStageFailedAction(
  stage: PipelineStage,
  code: string,
  message: string,
  retryable: boolean,
): PipelineAction {
  return {
    type: "stage_failed",
    stage,
    error: { stage, code, message, retryable },
  };
}

export function usePastePipeline(): UsePastePipelineResult {
  const [state, dispatch] = useReducer(
    pastePipelineReducer,
    undefined,
    createInitialPipelineState,
  );

  const clipboardHtmlRef = useRef<string | null>(null);
  const knownStatusesRef = useRef<Map<string, string>>(new Map());
  const lastDispatchedDataRef = useRef<JsonResponse<unknown> | undefined>(
    undefined,
  );
  const skipScreenshotRef = useRef<boolean>(false);

  const submitMutation = useMutation<
    { jobId: string },
    Error,
    { clipboardHtml: string }
  >({
    mutationFn: async ({ clipboardHtml }) => {
      const jobId = await postSubmit(clipboardHtml, undefined);
      return { jobId };
    },
    onSuccess: ({ jobId }) => {
      dispatch({ type: "job_created", jobId });
    },
    onError: (error) => {
      const retryable =
        (error as Error & { retryable?: boolean }).retryable !== false;
      dispatch(
        toStageFailedAction(
          "resolving",
          error.message,
          error.message,
          retryable,
        ),
      );
    },
  });

  const polling =
    state.jobId !== undefined &&
    state.stage !== "ready" &&
    state.stage !== "error";

  const jobQuery = useQuery({
    queryKey: ["paste-pipeline-job", state.jobId],
    enabled: polling,
    queryFn: async () => {
      if (state.jobId === undefined) {
        throw new Error("Missing job id");
      }
      return await fetchJson<JobPayload>({
        url: endpoints.job({ jobId: state.jobId }),
      });
    },
    refetchInterval: (query) => {
      const response = query.state.data as JsonResponse<unknown> | undefined;
      if (!response?.ok || !isJobPayload(response.payload)) {
        return false;
      }
      const status = response.payload.status;
      return status === "queued" || status === "running"
        ? POLL_INTERVAL_MS
        : false;
    },
  });

  useEffect(() => {
    const response = jobQuery.data as JsonResponse<JobPayload> | undefined;
    if (!response || response === lastDispatchedDataRef.current) {
      return;
    }
    lastDispatchedDataRef.current = response;

    if (!response.ok || !isJobPayload(response.payload)) {
      dispatch(
        toStageFailedAction("resolving", "POLL_FAILED", "POLL_FAILED", true),
      );
      return;
    }

    const payload = response.payload;
    const events = toStageEvents(payload, knownStatusesRef.current);
    for (const event of events) {
      if (event.kind === "start") {
        dispatch({
          type: "stage_start",
          stage: event.stage,
          message: event.message,
        });
      } else if (event.kind === "done") {
        dispatch({
          type: "stage_done",
          stage: event.stage,
          durationMs: 0,
        });
        if (event.extraDone !== undefined) {
          dispatch({
            type: "stage_done",
            stage: event.extraDone,
            durationMs: 0,
          });
        }
      } else {
        dispatch({
          type: "stage_failed",
          stage: event.stage,
          error: event.error,
        });
      }
    }

    if (payload.status === "completed") {
      dispatch({ type: "complete" });
      return;
    }
    if (payload.status === "failed") {
      dispatch(
        toStageFailedAction(
          "generating",
          "JOB_FAILED",
          payload.error?.message ?? "JOB_FAILED",
          false,
        ),
      );
      return;
    }
    if (payload.status === "canceled") {
      dispatch({ type: "cancel" });
    }
  }, [jobQuery.data]);

  useEffect(() => {
    if (!jobQuery.isError) {
      return;
    }
    dispatch(
      toStageFailedAction("resolving", "POLL_FAILED", "POLL_FAILED", true),
    );
  }, [jobQuery.errorUpdatedAt, jobQuery.isError]);

  useEffect(() => {
    if (!polling || state.jobId === undefined || skipScreenshotRef.current) {
      return;
    }
    const ac = new AbortController();
    const jobId = state.jobId;
    void (async () => {
      const signal = ac.signal;
      if (
        state.stageProgress.resolving.state === "done" &&
        state.screenshot === undefined
      ) {
        const shot = await fetchScreenshot({ jobId, signal });
        if (!ac.signal.aborted && shot !== null) {
          dispatch({ type: "screenshot_ready", screenshot: shot });
        }
      }
      if (
        state.stageProgress.transforming.state === "done" &&
        state.designIR === undefined
      ) {
        const ir = await fetchDesignIr({ jobId, signal });
        if (!ac.signal.aborted && ir !== null) {
          dispatch({ type: "design_ir_ready", designIR: ir });
        }
      }
      if (
        state.stageProgress.generating.state === "done" &&
        (state.componentManifest === undefined ||
          state.generatedFiles === undefined)
      ) {
        const [manifest, files] = await Promise.all([
          fetchManifest({ jobId, signal }),
          fetchFiles({ jobId, signal }),
        ]);
        if (!ac.signal.aborted) {
          if (manifest !== null) {
            dispatch({ type: "manifest_ready", manifest });
          }
          if (files !== null) {
            dispatch({ type: "files_ready", files });
          }
        }
      }
    })();
    return () => {
      ac.abort();
    };
  }, [
    polling,
    state.jobId,
    state.stageProgress.resolving.state,
    state.stageProgress.transforming.state,
    state.stageProgress.generating.state,
    state.screenshot,
    state.designIR,
    state.componentManifest,
    state.generatedFiles,
  ]);

  function start(clipboardHtml: string, options?: PipelineOptions): void {
    clipboardHtmlRef.current = clipboardHtml;
    knownStatusesRef.current = new Map();
    lastDispatchedDataRef.current = undefined;
    skipScreenshotRef.current = options?.skipScreenshot === true;

    dispatch({ type: "start", clipboardHtml });

    if (!isFigmaClipboard(clipboardHtml)) {
      dispatch({ type: "cancel" });
      return;
    }
    if (
      new TextEncoder().encode(clipboardHtml).length > FIGMA_PASTE_MAX_BYTES
    ) {
      dispatch({
        type: "parsing_failed",
        error: {
          stage: "parsing",
          code: "PAYLOAD_TOO_LARGE",
          message: `Clipboard HTML exceeds the ${String(FIGMA_PASTE_MAX_BYTES / (1024 * 1024))} MiB limit.`,
          retryable: false,
        },
      });
      return;
    }
    const parsed = parseFigmaClipboard(clipboardHtml);
    if (parsed === null) {
      dispatch({ type: "cancel" });
      return;
    }
    dispatch({ type: "parsing_done", figmeta: parsed.meta });
    submitMutation.mutate({ clipboardHtml });
  }

  function cancel(): void {
    dispatch({ type: "cancel" });
  }

  function retry(fromStage?: PipelineStage): void {
    if (fromStage !== undefined) {
      dispatch({ type: "retry", fromStage });
    } else {
      dispatch({ type: "retry" });
    }
    if (clipboardHtmlRef.current !== null) {
      knownStatusesRef.current = new Map();
      lastDispatchedDataRef.current = undefined;
      submitMutation.mutate({ clipboardHtml: clipboardHtmlRef.current });
    }
  }

  return { state, start, cancel, retry };
}
