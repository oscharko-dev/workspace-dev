import { useMemo, useState } from "react";
import type { ImportIntent } from "./paste-input-classifier";
import {
  classifyPasteIntent,
  isSecureContextAvailable,
} from "./paste-input-classifier";
import {
  usePastePipeline,
  type PipelineError,
  type PipelineStage,
} from "./paste-pipeline";
import type { PastePipelineState } from "./paste-pipeline";
import type { InspectorBootstrapState } from "./inspector-bootstrap-state";
import { isFigmaClipboard } from "./figma-clipboard-parser";

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

export type PasteSource = "clipboard-api" | "paste-event" | "drop" | "upload";

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

export interface UseInspectorBootstrapResult {
  state: InspectorBootstrapState;
  submit(input: { figmaJsonPayload: string }): void;
  submitPaste(
    text: string,
    options?: { source?: PasteSource; clipboardHtml?: string },
  ): void;
  submitUrl(fileKey: string, nodeId: string | null): void;
  confirmIntent(intent: ImportIntent): void;
  dismissIntent(): void;
  retry(): void;
  reset(): void;
  reportInputError(code: string): void;
  jobId: string | null;
  previewUrl: string | null;
  screenshot: string | null;
  pipelineStage: PipelineStage;
  pipelineState: PastePipelineState;
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
  detectedPaste,
  jobId,
  jobStatus,
  previewUrl,
  localFailure,
}: {
  pipelineStage: ReturnType<typeof usePastePipeline>["state"]["stage"];
  pipelineError: PipelineError | null;
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

  const failure = localFailure ?? toBootstrapFailure(pipelineError);
  if (failure !== null) {
    return {
      kind: "failed",
      reason: failure.reason,
      retryable: failure.retryable,
    };
  }

  if (pipelineStage === "ready" && jobId && previewUrl) {
    return { kind: "ready", jobId, previewUrl };
  }

  if (pipelineStage === "partial" && jobId !== null) {
    return { kind: "ready", jobId, previewUrl: previewUrl ?? "" };
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

export function useInspectorBootstrap(
  options?: UseInspectorBootstrapOptions,
): UseInspectorBootstrapResult {
  void options;

  const pipeline = usePastePipeline();
  const [detectedPaste, setDetectedPaste] = useState<DetectedPaste | null>(
    null,
  );
  const [localFailure, setLocalFailure] = useState<FailedState | null>(null);

  const pipelineError =
    pipeline.state.stage === "error"
      ? (pipeline.state.errors[pipeline.state.errors.length - 1] ?? null)
      : null;

  const jobId = pipeline.state.jobId ?? null;
  const previewUrl = pipeline.state.previewUrl ?? null;

  const state = useMemo(
    () =>
      deriveBootstrapState({
        pipelineStage: pipeline.state.stage,
        pipelineError,
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

    submit({ figmaJsonPayload }) {
      setDetectedPaste(null);
      setLocalFailure(null);
      pipeline.start(figmaJsonPayload, { sourceMode: "figma_paste" });
    },

    submitUrl(fileKey: string, nodeId: string | null): void {
      setDetectedPaste(null);
      setLocalFailure(null);
      pipeline.start(JSON.stringify({ figmaFileKey: fileKey, nodeId }), {
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

      const unsupportedReason = toUnsupportedIntentReason({
        detectedIntent: detectedPaste.intent,
        confirmedIntent: intent,
        suggestedJobSource: detectedPaste.suggestedJobSource,
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
      pipeline.start(detectedPaste.rawText, {
        sourceMode:
          intent === "FIGMA_PLUGIN_ENVELOPE" ? "figma_plugin" : "figma_paste",
      });
    },

    dismissIntent(): void {
      setDetectedPaste(null);
    },

    retry(): void {
      if (pipeline.state.canRetry) {
        setDetectedPaste(null);
        setLocalFailure(null);
        pipeline.retry();
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

    jobId,
    previewUrl,
    detectedIntent,
    pipelineState: pipeline.state,
  };
}
