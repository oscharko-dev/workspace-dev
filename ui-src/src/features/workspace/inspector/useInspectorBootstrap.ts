import { useEffect, useReducer, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/http";
import { toInspectorBootstrapPayload } from "../submit-schema";
import {
  bootstrapReducer,
  initialBootstrapState,
  type InspectorBootstrapState,
} from "./inspector-bootstrap-state";
import { isJobPayload, isRecord } from "../workspace-page.helpers";
import {
  classifyPasteIntent,
  isSecureContextAvailable,
  type ImportIntent,
} from "./paste-input-classifier";
import type { JsonResponse } from "../../../lib/http";

const DEFAULT_POLL_INTERVAL_MS = 1_500;

const endpoints = {
  submit: "/workspace/submit",
  job: ({ jobId }: { jobId: string }) =>
    `/workspace/jobs/${encodeURIComponent(jobId)}`,
};

function toUnsupportedIntentReason({
  detectedIntent,
  confirmedIntent,
  suggestedJobSource,
}: {
  detectedIntent: ImportIntent;
  confirmedIntent: ImportIntent;
  suggestedJobSource: string;
}): string | null {
  if (confirmedIntent === "RAW_CODE_OR_TEXT") {
    return "UNSUPPORTED_TEXT_PASTE";
  }
  if (confirmedIntent === "UNKNOWN") {
    return "UNSUPPORTED_UNKNOWN_PASTE";
  }
  // Plugin envelope is always supported — it's the primary plugin handoff path.
  if (confirmedIntent === "FIGMA_PLUGIN_ENVELOPE") {
    return null;
  }
  if (
    suggestedJobSource === "figma_plugin" &&
    confirmedIntent === detectedIntent &&
    detectedIntent === "FIGMA_JSON_NODE_BATCH"
  ) {
    return "UNSUPPORTED_PLUGIN_EXPORT";
  }
  return null;
}

export type PasteSource = "clipboard-api" | "paste-event" | "drop";

export interface UseInspectorBootstrapOptions {
  pollIntervalMs?: number;
}

export interface UseInspectorBootstrapResult {
  state: InspectorBootstrapState;
  submit(input: { figmaJsonPayload: string }): void;
  submitPaste(
    text: string,
    options?: { source?: PasteSource; clipboardHtml?: string },
  ): void;
  confirmIntent(intent: ImportIntent): void;
  dismissIntent(): void;
  retry(): void;
  reset(): void;
  reportInputError(code: string): void;
  jobId: string | null;
  previewUrl: string | null;
  detectedIntent: { intent: ImportIntent; confidence: number } | null;
}

function extractJobId(state: InspectorBootstrapState): string | null {
  if (
    state.kind === "queued" ||
    state.kind === "processing" ||
    state.kind === "ready"
  ) {
    return state.jobId;
  }
  return null;
}

function extractPreviewUrl(state: InspectorBootstrapState): string | null {
  if (state.kind === "ready") {
    return state.previewUrl;
  }
  return null;
}

function toFailureReason(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (
    error === "INVALID_PAYLOAD" ||
    error === "TOO_LARGE" ||
    error === "SCHEMA_MISMATCH"
  ) {
    return error;
  }
  return "SUBMIT_FAILED";
}

function toPollingFailureReason(payload: Record<string, unknown>): string {
  return typeof payload.error === "string" && payload.error.length > 0
    ? payload.error
    : "POLL_FAILED";
}

export function useInspectorBootstrap(
  options?: UseInspectorBootstrapOptions,
): UseInspectorBootstrapResult {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const [state, dispatch] = useReducer(
    bootstrapReducer,
    undefined,
    initialBootstrapState,
  );

  const jobId = extractJobId(state);
  const previewUrl = extractPreviewUrl(state);

  const submitMutation = useMutation<
    { jobId: string },
    Error,
    {
      figmaJsonPayload: string;
      importIntent?: ImportIntent;
      originalIntent?: ImportIntent;
      intentCorrected?: boolean;
    }
  >({
    mutationFn: async ({
      figmaJsonPayload,
      importIntent,
      originalIntent,
      intentCorrected,
    }) => {
      const payload = toInspectorBootstrapPayload(
        importIntent !== undefined
          ? {
              figmaJsonPayload,
              importIntent,
              ...(originalIntent !== undefined ? { originalIntent } : {}),
              ...(intentCorrected !== undefined ? { intentCorrected } : {}),
            }
          : { figmaJsonPayload },
      );
      const response = await fetchJson<{ jobId?: string; error?: string }>({
        url: endpoints.submit,
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      });

      if (response.status === 202 && isRecord(response.payload)) {
        const id = response.payload.jobId;
        if (typeof id === "string") {
          return { jobId: id };
        }
      }

      if (
        response.status >= 400 &&
        response.status < 500 &&
        isRecord(response.payload)
      ) {
        const reason = toFailureReason(response.payload);
        throw Object.assign(new Error(reason), { retryable: false });
      }

      throw Object.assign(new Error("SUBMIT_FAILED"), { retryable: true });
    },
    onSuccess: ({ jobId: acceptedJobId }) => {
      dispatch({ type: "submit_accepted", jobId: acceptedJobId });
    },
    onError: (error) => {
      const retryable =
        (error as Error & { retryable?: boolean }).retryable !== false;
      dispatch({
        type: "submit_failed",
        reason: error.message,
        retryable,
      });
    },
  });

  const polling = state.kind === "queued" || state.kind === "processing";

  const jobQuery = useQuery({
    queryKey: ["inspector-bootstrap-job", jobId],
    enabled: polling,
    queryFn: async () => {
      if (!jobId) {
        throw new Error("Missing job id");
      }
      return await fetchJson({ url: endpoints.job({ jobId }) });
    },
    refetchInterval: (query) => {
      const response = query.state.data as JsonResponse<unknown> | undefined;
      if (!response?.ok || !isJobPayload(response.payload)) {
        return false;
      }
      return response.payload.status === "queued" ||
        response.payload.status === "running"
        ? pollIntervalMs
        : false;
    },
  });

  // Track which query data we've already dispatched so we don't double-fire.
  const lastDispatchedDataRef = useRef<JsonResponse<unknown> | undefined>(
    undefined,
  );

  useEffect(() => {
    const response = jobQuery.data as JsonResponse<unknown> | undefined;
    if (!response || response === lastDispatchedDataRef.current) {
      return;
    }
    if (!response.ok) {
      lastDispatchedDataRef.current = response;
      const reason = isRecord(response.payload)
        ? toPollingFailureReason(response.payload)
        : "POLL_FAILED";
      dispatch({ type: "poll_failed", reason, retryable: true });
      return;
    }
    if (!isJobPayload(response.payload)) {
      lastDispatchedDataRef.current = response;
      dispatch({
        type: "poll_failed",
        reason: "POLL_FAILED",
        retryable: true,
      });
      return;
    }

    lastDispatchedDataRef.current = response;
    const { payload } = response;
    const status = payload.status;

    if (
      status === "queued" ||
      status === "running" ||
      status === "completed" ||
      status === "failed" ||
      status === "canceled"
    ) {
      const previewUrlValue =
        typeof payload.preview?.url === "string"
          ? payload.preview.url
          : undefined;
      dispatch(
        previewUrlValue !== undefined
          ? {
              type: "poll_updated",
              status,
              jobId: payload.jobId,
              previewUrl: previewUrlValue,
            }
          : { type: "poll_updated", status, jobId: payload.jobId },
      );
    }
  }, [jobQuery.data]);

  useEffect(() => {
    if (!jobQuery.isError) {
      return;
    }

    dispatch({
      type: "poll_failed",
      reason: "POLL_FAILED",
      retryable: true,
    });
  }, [jobQuery.errorUpdatedAt, jobQuery.isError]);

  function submitPaste(
    text: string,
    options?: { source?: PasteSource; clipboardHtml?: string },
  ): void {
    const source = options?.source ?? "paste-event";
    if (source === "clipboard-api" && !isSecureContextAvailable()) {
      dispatch({
        type: "submit_failed",
        reason: "SECURE_CONTEXT_MISSING",
        retryable: false,
      });
      return;
    }

    const intentClassification = classifyPasteIntent(
      text,
      options?.clipboardHtml,
    );

    if (intentClassification.intent === "UNKNOWN") {
      dispatch({
        type: "submit_failed",
        reason: "EMPTY_INPUT",
        retryable: true,
      });
      return;
    }

    dispatch({
      type: "intent_detected",
      intent: intentClassification.intent,
      confidence: intentClassification.confidence,
      rawText: text,
      suggestedJobSource: intentClassification.suggestedJobSource,
    });
  }

  function confirmIntent(intent: ImportIntent): void {
    if (state.kind !== "detected") {
      return;
    }
    const unsupportedReason = toUnsupportedIntentReason({
      detectedIntent: state.intent,
      confirmedIntent: intent,
      suggestedJobSource: state.suggestedJobSource,
    });
    if (unsupportedReason !== null) {
      dispatch({
        type: "submit_failed",
        reason: unsupportedReason,
        retryable: false,
      });
      return;
    }
    const rawText = state.rawText;
    const corrected = intent !== state.intent;
    dispatch({ type: "intent_confirmed", intent });
    dispatch({ type: "paste_started" });
    submitMutation.mutate({
      figmaJsonPayload: rawText,
      importIntent: intent,
      originalIntent: state.intent,
      intentCorrected: corrected,
    });
  }

  function dismissIntent(): void {
    dispatch({ type: "intent_dismissed" });
  }

  function reportInputError(code: string): void {
    dispatch({ type: "submit_failed", reason: code, retryable: true });
  }

  const detectedIntent =
    state.kind === "detected"
      ? { intent: state.intent, confidence: state.confidence }
      : null;

  return {
    state,
    submit({ figmaJsonPayload }) {
      dispatch({ type: "paste_started" });
      submitMutation.mutate({ figmaJsonPayload });
    },
    submitPaste,
    confirmIntent,
    dismissIntent,
    retry() {
      if (state.kind === "failed" && state.retryable) {
        dispatch({ type: "reset" });
      }
    },
    reset() {
      dispatch({ type: "reset" });
    },
    reportInputError,
    jobId,
    previewUrl,
    detectedIntent,
  };
}
