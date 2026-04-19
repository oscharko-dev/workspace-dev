import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImportIntent } from "./paste-input-classifier";
import {
  classifyPasteIntent,
  isSecureContextAvailable,
} from "./paste-input-classifier";
import {
  usePastePipeline,
  type PipelineError,
  type PipelineImportMode,
  type PipelineRetryRequest,
  type PipelineStage,
} from "./paste-pipeline";
import type { PastePipelineState } from "./paste-pipeline";
import type { PipelineExecutionLog } from "./pipeline-execution-log";
import type { InspectorBootstrapState } from "./inspector-bootstrap-state";
import { isFigmaClipboard } from "./figma-clipboard-parser";
import {
  recordClassification,
  recordCorrection,
} from "./intent-classification-metrics";
import { recordMcpCall } from "./figma-mcp-call-counter";

function toUnsupportedIntentReason({
  confirmedIntent,
}: {
  confirmedIntent: ImportIntent;
}): string | null {
  if (confirmedIntent === "RAW_CODE_OR_TEXT") {
    return "UNSUPPORTED_TEXT_PASTE";
  }
  if (confirmedIntent === "UNKNOWN") {
    return "UNSUPPORTED_UNKNOWN_PASTE";
  }
  return null;
}

export type PasteSource = "clipboard-api" | "paste-event" | "drop" | "upload";
export type ProgrammaticSubmitSourceMode = "figma_paste" | "figma_plugin";

export interface UseInspectorBootstrapOptions {
  pollIntervalMs?: number;
}

interface FailedState {
  reason: string;
  retryable: boolean;
}

interface DetectedPaste {
  intent: ImportIntent;
  confidence: number;
  rawText: string;
  suggestedJobSource: string;
  clipboardHtml?: string;
}

export interface RegenerateScopedOptions {
  selectedNodeIds: readonly string[];
  importMode?: PipelineImportMode;
}

export interface UseInspectorBootstrapResult {
  state: InspectorBootstrapState;
  submit(input: {
    figmaJsonPayload: string;
    sourceMode?: ProgrammaticSubmitSourceMode;
  }): void;
  submitPaste(
    text: string,
    options?: { source?: PasteSource; clipboardHtml?: string },
  ): void;
  submitUrl(fileKey: string, nodeId: string | null): void;
  confirmIntent(intent: ImportIntent): void;
  dismissIntent(): void;
  retry(stage?: PipelineStage, targetIds?: string[]): void;
  /**
   * Re-run the most recent submit with a scope filter. Used by Generate Selected
   * and the re-import "Update existing" flow. No-op when nothing has been submitted yet.
   */
  regenerateScoped(options: RegenerateScopedOptions): void;
  /**
   * Re-run the most recent submit forcing `importMode: "full"`. Used by the
   * re-import "Create new" flow.
   */
  resubmitFresh(): void;
  /** Url-context for the most recent submit, or null when not from a URL. */
  lastUrlContext: { fileKey: string; nodeId: string | null } | null;
  reset(): void;
  reportInputError(code: string): void;
  jobId: string | null;
  previewUrl: string | null;
  screenshot: string | null;
  pipelineStage: PipelineStage;
  pipelineState: PastePipelineState;
  executionLog: PipelineExecutionLog;
  detectedIntent: { intent: ImportIntent; confidence: number } | null;
}

function isJsonPayload(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function toBootstrapFailure(
  error: PipelineError | FailedState | null,
): FailedState | null {
  if (error === null) {
    return null;
  }

  if ("code" in error) {
    return {
      reason: error.code,
      retryable: error.retryable,
    };
  }

  return error;
}

function deriveBootstrapState({
  pipelineStage,
  pipelineError,
  pipelineFallbackMode,
  detectedPaste,
  jobId,
  jobStatus,
  previewUrl,
  localFailure,
}: {
  pipelineStage: ReturnType<typeof usePastePipeline>["state"]["stage"];
  pipelineError: PipelineError | null;
  pipelineFallbackMode: PastePipelineState["fallbackMode"];
  detectedPaste: DetectedPaste | null;
  jobId: string | null;
  jobStatus: ReturnType<typeof usePastePipeline>["state"]["jobStatus"];
  previewUrl: string | null;
  localFailure: FailedState | null;
}): InspectorBootstrapState {
  if (detectedPaste !== null) {
    return {
      kind: "detected",
      intent: detectedPaste.intent,
      confidence: detectedPaste.confidence,
      rawText: detectedPaste.rawText,
      suggestedJobSource: detectedPaste.suggestedJobSource,
    };
  }

  if (pipelineStage === "ready" && jobId && previewUrl) {
    return { kind: "ready", jobId, previewUrl };
  }

  if (pipelineStage === "partial" && jobId !== null) {
    return {
      kind: "partial",
      jobId,
      previewUrl: previewUrl ?? "",
      ...(pipelineFallbackMode !== undefined
        ? { fallbackMode: pipelineFallbackMode }
        : {}),
    };
  }

  const failure =
    pipelineStage === "partial"
      ? localFailure
      : (localFailure ?? toBootstrapFailure(pipelineError));
  if (failure !== null) {
    return {
      kind: "failed",
      reason: failure.reason,
      retryable: failure.retryable,
    };
  }

  if (jobId && jobStatus === "queued") {
    return { kind: "queued", jobId };
  }

  if (jobId && jobStatus === "running") {
    return { kind: "processing", jobId };
  }

  if (pipelineStage !== "idle") {
    return { kind: "pasting" };
  }

  return { kind: "idle" };
}

interface LastSubmitRef {
  payload: string;
  sourceMode: "figma_paste" | "figma_plugin" | "figma_url";
  urlContext: { fileKey: string; nodeId: string | null } | null;
}

export function useInspectorBootstrap(
  options?: UseInspectorBootstrapOptions,
): UseInspectorBootstrapResult {
  void options;

  const pipeline = usePastePipeline();
  const [detectedPaste, setDetectedPaste] = useState<DetectedPaste | null>(
    null,
  );
  const [localFailure, setLocalFailure] = useState<FailedState | null>(null);
  const lastSubmitRef = useRef<LastSubmitRef | null>(null);
  const [lastUrlContext, setLastUrlContext] = useState<{
    fileKey: string;
    nodeId: string | null;
  } | null>(null);

  const recordSubmit = useCallback((entry: LastSubmitRef): void => {
    lastSubmitRef.current = entry;
    setLastUrlContext(entry.urlContext);
  }, []);

  const regenerateScoped = useCallback(
    (regenerateOptions: RegenerateScopedOptions): void => {
      const last = lastSubmitRef.current;
      if (last === null) {
        return;
      }
      setDetectedPaste(null);
      setLocalFailure(null);
      pipeline.start(last.payload, {
        sourceMode: last.sourceMode,
        selectedNodeIds: regenerateOptions.selectedNodeIds,
        ...(regenerateOptions.importMode !== undefined
          ? { importMode: regenerateOptions.importMode }
          : {}),
      });
    },
    [pipeline],
  );

  const resubmitFresh = useCallback((): void => {
    const last = lastSubmitRef.current;
    if (last === null) {
      return;
    }
    setDetectedPaste(null);
    setLocalFailure(null);
    pipeline.start(last.payload, {
      sourceMode: last.sourceMode,
      importMode: "full",
    });
  }, [pipeline]);

  const pipelineError =
    pipeline.state.stage === "error" || pipeline.state.stage === "partial"
      ? (pipeline.state.errors[pipeline.state.errors.length - 1] ?? null)
      : null;

  const jobId = pipeline.state.jobId ?? null;
  const previewUrl = pipeline.state.previewUrl ?? null;

  // Issue #1093: Count server-reported MCP read-tool usage once per jobId.
  // The backend projects `mcpCallsConsumed` only for terminal job payloads, so
  // client-only failures (for example polling errors) do not inflate the local
  // warning counter.
  const countedMcpJobIdRef = useRef<string | null>(null);
  useEffect(() => {
    const mcpCallsConsumed = pipeline.state.mcpCallsConsumed;
    if (jobId === null) {
      return;
    }
    if (mcpCallsConsumed === undefined || mcpCallsConsumed <= 0) {
      return;
    }
    if (countedMcpJobIdRef.current === jobId) {
      return;
    }
    countedMcpJobIdRef.current = jobId;
    recordMcpCall({ jobId, count: mcpCallsConsumed });
  }, [pipeline.state.mcpCallsConsumed, jobId]);

  const state = useMemo(
    () =>
      deriveBootstrapState({
        pipelineStage: pipeline.state.stage,
        pipelineError,
        pipelineFallbackMode: pipeline.state.fallbackMode,
        detectedPaste,
        jobId,
        jobStatus: pipeline.state.jobStatus,
        previewUrl,
        localFailure,
      }),
    [
      detectedPaste,
      jobId,
      localFailure,
      pipeline.state.fallbackMode,
      pipeline.state.jobStatus,
      pipeline.state.stage,
      pipelineError,
      previewUrl,
    ],
  );

  const detectedIntent =
    detectedPaste !== null
      ? { intent: detectedPaste.intent, confidence: detectedPaste.confidence }
      : null;

  return {
    state,
    screenshot: pipeline.state.screenshot ?? null,
    pipelineStage: pipeline.state.stage,

    // Programmatic / offline / CLI handoff path. The caller already knows its
    // source mode and provides pre-validated Figma JSON, so intent
    // classification is intentionally not wired here: classifyPasteIntent
    // expects free-form strings, and SmartBanner is an interactive modal that
    // would block headless or server-to-server callers with no user to
    // confirm. For the interactive paste path that runs classification and
    // shows SmartBanner, use submitPaste(). See Issue #1022 for the decision.
    submit({ figmaJsonPayload, sourceMode = "figma_paste" }) {
      setDetectedPaste(null);
      setLocalFailure(null);
      recordSubmit({
        payload: figmaJsonPayload,
        sourceMode,
        urlContext: null,
      });
      pipeline.start(figmaJsonPayload, { sourceMode });
    },

    submitUrl(fileKey: string, nodeId: string | null): void {
      setDetectedPaste(null);
      setLocalFailure(null);
      const payload = JSON.stringify({ figmaFileKey: fileKey, nodeId });
      recordSubmit({
        payload,
        sourceMode: "figma_url",
        urlContext: { fileKey, nodeId },
      });
      pipeline.start(payload, {
        sourceMode: "figma_url",
      });
    },

    submitPaste(
      text: string,
      options?: { source?: PasteSource; clipboardHtml?: string },
    ): void {
      const source = options?.source ?? "paste-event";
      if (source === "clipboard-api" && !isSecureContextAvailable()) {
        setDetectedPaste(null);
        setLocalFailure({
          reason: "SECURE_CONTEXT_MISSING",
          retryable: false,
        });
        return;
      }

      const rawText = text.trim();
      if (
        rawText.length === 0 &&
        options?.clipboardHtml !== undefined &&
        isFigmaClipboard(options.clipboardHtml)
      ) {
        setDetectedPaste(null);
        setLocalFailure({
          reason: "UNSUPPORTED_FIGMA_CLIPBOARD_HTML",
          retryable: false,
        });
        return;
      }

      const intentClassification = classifyPasteIntent(
        text,
        options?.clipboardHtml,
      );

      if (intentClassification.intent === "UNKNOWN") {
        setDetectedPaste(null);
        setLocalFailure({
          reason: "EMPTY_INPUT",
          retryable: true,
        });
        return;
      }

      recordClassification({
        intent: intentClassification.intent,
        confidence: intentClassification.confidence,
      });

      setLocalFailure(null);
      setDetectedPaste({
        intent: intentClassification.intent,
        confidence: intentClassification.confidence,
        rawText: intentClassification.rawText,
        suggestedJobSource: intentClassification.suggestedJobSource,
        ...(options?.clipboardHtml !== undefined
          ? { clipboardHtml: options.clipboardHtml }
          : {}),
      });
    },

    confirmIntent(intent: ImportIntent): void {
      if (detectedPaste === null) {
        return;
      }

      if (
        intent !== detectedPaste.intent &&
        detectedPaste.intent !== "UNKNOWN"
      ) {
        recordCorrection({ from: detectedPaste.intent, to: intent });
      }

      const unsupportedReason = toUnsupportedIntentReason({
        confirmedIntent: intent,
      });
      if (unsupportedReason !== null) {
        setDetectedPaste(null);
        setLocalFailure({
          reason: unsupportedReason,
          retryable: false,
        });
        return;
      }

      if (!isJsonPayload(detectedPaste.rawText)) {
        setDetectedPaste(null);
        setLocalFailure({
          reason:
            detectedPaste.clipboardHtml !== undefined &&
            isFigmaClipboard(detectedPaste.clipboardHtml)
              ? "UNSUPPORTED_FIGMA_CLIPBOARD_HTML"
              : "SCHEMA_MISMATCH",
          retryable: false,
        });
        return;
      }

      setDetectedPaste(null);
      setLocalFailure(null);
      const sourceMode =
        intent === "FIGMA_PLUGIN_ENVELOPE" ? "figma_plugin" : "figma_paste";
      recordSubmit({
        payload: detectedPaste.rawText,
        sourceMode,
        urlContext: null,
      });
      pipeline.start(detectedPaste.rawText, { sourceMode });
    },

    dismissIntent(): void {
      setDetectedPaste(null);
    },

    retry(stage?: PipelineStage, targetIds?: string[]): void {
      const retryRequest: PipelineRetryRequest | undefined =
        stage !== undefined
          ? {
              stage,
              ...(targetIds !== undefined && targetIds.length > 0
                ? { targetIds }
                : {}),
            }
          : undefined;
      if (pipeline.state.canRetry) {
        setDetectedPaste(null);
        setLocalFailure(null);
        pipeline.retry(retryRequest);
        return;
      }

      if (localFailure?.retryable) {
        setLocalFailure(null);
      }
    },

    reset(): void {
      setDetectedPaste(null);
      setLocalFailure(null);
      pipeline.cancel();
    },

    reportInputError(code: string): void {
      setDetectedPaste(null);
      setLocalFailure({ reason: code, retryable: true });
    },

    regenerateScoped,
    resubmitFresh,
    lastUrlContext,

    jobId,
    previewUrl,
    detectedIntent,
    pipelineState: pipeline.state,
    executionLog: pipeline.executionLog,
  };
}
