import type { ImportIntent } from "./paste-input-classifier";

export type InspectorBootstrapState =
  | { kind: "idle" }
  | { kind: "focused" }
  | {
      kind: "detected";
      intent: ImportIntent;
      confidence: number;
      rawText: string;
      suggestedJobSource: string;
    }
  | { kind: "pasting" }
  | { kind: "queued"; jobId: string }
  | { kind: "processing"; jobId: string }
  | { kind: "ready"; jobId: string; previewUrl: string }
  | {
      kind: "partial";
      jobId: string;
      previewUrl: string;
      fallbackMode?: string;
    }
  | { kind: "failed"; reason: string; retryable: boolean };

export type InspectorBootstrapEvent =
  | { type: "focus" }
  | { type: "blur" }
  | { type: "paste_started" }
  | {
      type: "intent_detected";
      intent: ImportIntent;
      confidence: number;
      rawText: string;
      suggestedJobSource: string;
    }
  | { type: "intent_confirmed"; intent: ImportIntent }
  | { type: "intent_dismissed" }
  | { type: "submit_accepted"; jobId: string }
  | { type: "submit_failed"; reason: string; retryable: boolean }
  | { type: "poll_failed"; reason: string; retryable: boolean }
  | {
      type: "poll_updated";
      status: "queued" | "running" | "completed" | "failed" | "canceled";
      jobId: string;
      previewUrl?: string;
    }
  | { type: "reset" };

export function initialBootstrapState(): InspectorBootstrapState {
  return { kind: "idle" };
}

export function bootstrapReducer(
  state: InspectorBootstrapState,
  event: InspectorBootstrapEvent,
): InspectorBootstrapState {
  if (event.type === "reset") {
    return { kind: "idle" };
  }

  switch (state.kind) {
    case "idle": {
      if (event.type === "focus") {
        return { kind: "focused" };
      }
      if (event.type === "intent_detected") {
        return {
          kind: "detected",
          intent: event.intent,
          confidence: event.confidence,
          rawText: event.rawText,
          suggestedJobSource: event.suggestedJobSource,
        };
      }
      if (event.type === "paste_started") {
        return { kind: "pasting" };
      }
      if (event.type === "submit_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      return state;
    }

    case "focused": {
      if (event.type === "blur") {
        return { kind: "idle" };
      }
      if (event.type === "intent_detected") {
        return {
          kind: "detected",
          intent: event.intent,
          confidence: event.confidence,
          rawText: event.rawText,
          suggestedJobSource: event.suggestedJobSource,
        };
      }
      if (event.type === "paste_started") {
        return { kind: "pasting" };
      }
      if (event.type === "submit_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      return state;
    }

    case "detected": {
      if (event.type === "intent_detected") {
        return {
          kind: "detected",
          intent: event.intent,
          confidence: event.confidence,
          rawText: event.rawText,
          suggestedJobSource: event.suggestedJobSource,
        };
      }
      if (event.type === "submit_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      if (event.type === "intent_confirmed") {
        return { kind: "pasting" };
      }
      if (event.type === "intent_dismissed") {
        return { kind: "idle" };
      }
      if (event.type === "paste_started") {
        return { kind: "pasting" };
      }
      return state;
    }

    case "pasting": {
      if (event.type === "submit_accepted") {
        return { kind: "queued", jobId: event.jobId };
      }
      if (event.type === "submit_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      return state;
    }

    case "queued": {
      if (event.type === "poll_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      if (event.type === "poll_updated") {
        if (event.status === "running") {
          return { kind: "processing", jobId: event.jobId };
        }
        if (event.status === "completed") {
          if (!event.previewUrl) {
            return {
              kind: "failed",
              reason: "missing preview url",
              retryable: true,
            };
          }
          return {
            kind: "ready",
            jobId: event.jobId,
            previewUrl: event.previewUrl,
          };
        }
        if (event.status === "failed" || event.status === "canceled") {
          return { kind: "failed", reason: event.status, retryable: false };
        }
      }
      return state;
    }

    case "processing": {
      if (event.type === "poll_failed") {
        return {
          kind: "failed",
          reason: event.reason,
          retryable: event.retryable,
        };
      }
      if (event.type === "poll_updated") {
        if (event.status === "completed") {
          if (!event.previewUrl) {
            return {
              kind: "failed",
              reason: "missing preview url",
              retryable: true,
            };
          }
          return {
            kind: "ready",
            jobId: event.jobId,
            previewUrl: event.previewUrl,
          };
        }
        if (event.status === "failed" || event.status === "canceled") {
          return { kind: "failed", reason: event.status, retryable: false };
        }
      }
      return state;
    }

    case "ready":
    case "partial":
      return state;
    case "failed": {
      if (event.type === "intent_detected") {
        return {
          kind: "detected",
          intent: event.intent,
          confidence: event.confidence,
          rawText: event.rawText,
          suggestedJobSource: event.suggestedJobSource,
        };
      }
      if (event.type === "paste_started") {
        return { kind: "pasting" };
      }
      return state;
    }

    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
