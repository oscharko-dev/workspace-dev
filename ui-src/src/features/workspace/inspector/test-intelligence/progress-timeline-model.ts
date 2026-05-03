/**
 * Pure logic for the production-runner progress timeline (#1738).
 *
 * The model is intentionally separated from the React component so it
 * can be unit-tested without DOM/JSX overhead and so the same reducer
 * powers test fixtures + the live SSE consumer.
 *
 * Phase taxonomy mirrors `production-runner-events.ts` on the server.
 * Adding a new phase here is a server contract change — the bus
 * snapshot test exercises the closed set.
 */

export type ProductionRunnerEventPhase =
  | "intent_derivation_started"
  | "intent_derivation_complete"
  | "visual_sidecar_started"
  | "visual_sidecar_skipped"
  | "visual_sidecar_complete"
  | "prompt_compiled"
  | "llm_gateway_request"
  | "llm_gateway_response"
  | "validation_started"
  | "validation_complete"
  | "policy_decision"
  | "export_started"
  | "export_complete"
  | "evidence_sealed"
  | "finops_recorded"
  | "cache_break";

export interface ProductionRunnerEvent {
  phase: ProductionRunnerEventPhase;
  timestamp: number;
  details?: { readonly [key: string]: unknown };
}

/**
 * The visible row identifiers in the timeline. Multiple events may map
 * to the same row (e.g. `intent_derivation_started` and
 * `intent_derivation_complete` both update the "intent" row).
 */
export type TimelineRowPhase =
  | "intent"
  | "visual_sidecar"
  | "prompt"
  | "llm_gateway"
  | "validation"
  | "policy"
  | "export"
  | "evidence"
  | "finops";

export type TimelineRowStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export interface TimelineRow {
  phase: TimelineRowPhase;
  status: TimelineRowStatus;
  /** Most recent event timestamp on this row (start or complete). */
  timestamp: number | null;
  /** Optional inline detail string parsed from event payload. */
  detail: string | null;
}

export const TIMELINE_PHASES: readonly TimelineRowPhase[] = [
  "intent",
  "visual_sidecar",
  "prompt",
  "llm_gateway",
  "validation",
  "policy",
  "export",
  "evidence",
  "finops",
];

export const PHASE_LABELS: Readonly<Record<TimelineRowPhase, string>> = {
  intent: "Derive business intent",
  visual_sidecar: "Visual sidecar",
  prompt: "Compile prompt",
  llm_gateway: "LLM gateway",
  validation: "Validate test cases",
  policy: "Policy decision",
  export: "Export artifacts",
  evidence: "Seal evidence manifest",
  finops: "Record FinOps usage",
};

const PHASE_ROUTING: Readonly<
  Record<
    ProductionRunnerEventPhase,
    {
      row: TimelineRowPhase;
      transition: "start" | "complete" | "skip";
    }
  >
> = {
  intent_derivation_started: { row: "intent", transition: "start" },
  intent_derivation_complete: { row: "intent", transition: "complete" },
  visual_sidecar_started: { row: "visual_sidecar", transition: "start" },
  visual_sidecar_skipped: { row: "visual_sidecar", transition: "skip" },
  visual_sidecar_complete: { row: "visual_sidecar", transition: "complete" },
  prompt_compiled: { row: "prompt", transition: "complete" },
  llm_gateway_request: { row: "llm_gateway", transition: "start" },
  llm_gateway_response: { row: "llm_gateway", transition: "complete" },
  validation_started: { row: "validation", transition: "start" },
  validation_complete: { row: "validation", transition: "complete" },
  policy_decision: { row: "policy", transition: "complete" },
  export_started: { row: "export", transition: "start" },
  export_complete: { row: "export", transition: "complete" },
  evidence_sealed: { row: "evidence", transition: "complete" },
  finops_recorded: { row: "finops", transition: "complete" },
  cache_break: { row: "llm_gateway", transition: "complete" },
};

export const buildInitialTimelineRows = (): readonly TimelineRow[] =>
  TIMELINE_PHASES.map((phase) => ({
    phase,
    status: "pending",
    timestamp: null,
    detail: null,
  }));

/**
 * Apply one event to the row set, returning a new array (immutable
 * update — safe to use as React state). Unknown phases are ignored
 * defensively so a server contract bump does not crash older UIs.
 */
export const applyEventToRows = (
  rows: readonly TimelineRow[],
  event: ProductionRunnerEvent,
): readonly TimelineRow[] => {
  const routing = PHASE_ROUTING[event.phase];
  if (routing === undefined) return rows;
  return rows.map((row) => {
    if (row.phase !== routing.row) return row;
    const detail = extractDetail(event);
    if (routing.transition === "skip") {
      return {
        ...row,
        status: "skipped",
        timestamp: event.timestamp,
        ...(detail !== null ? { detail } : { detail: row.detail }),
      };
    }
    if (routing.transition === "start") {
      // A re-start (e.g. retry) overrides a previous complete.
      return {
        ...row,
        status: "running",
        timestamp: event.timestamp,
        ...(detail !== null ? { detail } : { detail: row.detail }),
      };
    }
    // complete: failure is signalled by an `error` field on the event detail.
    const failed =
      event.details !== undefined &&
      typeof (event.details as { error?: unknown }).error === "string";
    return {
      ...row,
      status: failed ? "failed" : "complete",
      timestamp: event.timestamp,
      ...(detail !== null ? { detail } : { detail: row.detail }),
    };
  });
};

const extractDetail = (event: ProductionRunnerEvent): string | null => {
  if (event.details === undefined) return null;
  const d = event.details as Record<string, unknown>;
  if (typeof d.message === "string") return d.message;
  if (typeof d.querySource === "string") return `cache break: ${d.querySource}`;
  if (typeof d.deployment === "string") return d.deployment;
  if (typeof d.tokens === "number") return `${d.tokens} tokens`;
  if (typeof d.error === "string") return d.error;
  return null;
};

/** Format an elapsed millisecond duration as `s.s` (1-decimal seconds). */
export const formatElapsed = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  const seconds = ms / 1000;
  return `${seconds.toFixed(1)}s`;
};
