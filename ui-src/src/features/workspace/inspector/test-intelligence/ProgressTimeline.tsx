/**
 * Real-time production-runner progress timeline (Issue #1738).
 *
 * Subscribes to the per-job SSE stream at
 * `GET /workspace/test-intelligence/jobs/<jobId>/events` and renders a
 * vertical phase list with status icon, elapsed seconds, and inline
 * detail. Each known phase is rendered as either pending (waiting),
 * running (current phase, spinner), complete (check), or failed (X).
 *
 * The timeline is resilient to:
 *   - the job already being finished (snapshot replay then auto-close)
 *   - a phase emitting both a `_started` and `_complete` event
 *   - a phase being skipped (visual_sidecar_skipped)
 *   - the user navigating away mid-stream (EventSource is cleaned up)
 *
 * WCAG 2.2 AA:
 *   - aria-live="polite" announces phase changes
 *   - icons carry text fall-back via aria-label
 *   - prefers-reduced-motion suppresses the spinner animation
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import type {
  ProductionRunnerEvent,
  ProductionRunnerEventPhase,
  TimelineRow,
  TimelineRowStatus,
} from "./progress-timeline-model";
import {
  TIMELINE_PHASES,
  applyEventToRows,
  buildInitialTimelineRows,
  formatElapsed,
  PHASE_LABELS,
} from "./progress-timeline-model";

export interface ProgressTimelineProps {
  jobId: string;
  /** Optional injection point for tests — defaults to window.EventSource. */
  eventSourceFactory?: (url: string) => EventSource;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

export function ProgressTimeline({
  jobId,
  eventSourceFactory,
}: ProgressTimelineProps): JSX.Element {
  const [rows, setRows] = useState<readonly TimelineRow[]>(() =>
    buildInitialTimelineRows(),
  );
  const [streamError, setStreamError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const factoryRef = useRef(eventSourceFactory);
  factoryRef.current = eventSourceFactory;

  useEffect(() => {
    const url = `/workspace/test-intelligence/jobs/${encodeURIComponent(jobId)}/events`;
    const factory =
      factoryRef.current ?? ((src: string) => new EventSource(src));
    let source: EventSource;
    try {
      source = factory(url);
    } catch {
      setStreamError("Unable to open progress stream.");
      return undefined;
    }
    const handleMessage = (event: MessageEvent<string>): void => {
      const parsed = safeParseEvent(event.data);
      if (parsed === null) return;
      setStartedAt((current) => current ?? parsed.timestamp);
      setRows((current) => applyEventToRows(current, parsed));
    };
    const handleError = (): void => {
      setStreamError("Progress stream interrupted.");
    };
    source.addEventListener("message", handleMessage);
    source.addEventListener("error", handleError);
    return () => {
      source.removeEventListener("message", handleMessage);
      source.removeEventListener("error", handleError);
      source.close();
    };
  }, [jobId]);

  const announcement = useMemo(() => describeAnnouncement(rows), [rows]);

  return (
    <section
      data-testid="ti-progress-timeline"
      aria-labelledby="ti-progress-timeline-heading"
      className="flex flex-col gap-2 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between">
        <h3
          id="ti-progress-timeline-heading"
          className="m-0 text-sm font-semibold text-white"
        >
          Pipeline progress
        </h3>
        {streamError !== null ? (
          <span
            data-testid="ti-progress-timeline-error"
            role="status"
            className="rounded border border-amber-500/30 bg-amber-950/20 px-1.5 py-[1px] text-[10px] text-amber-200"
          >
            {streamError}
          </span>
        ) : null}
      </header>
      <p
        data-testid="ti-progress-timeline-live"
        aria-live="polite"
        className="sr-only"
      >
        {announcement}
      </p>
      <ol
        data-testid="ti-progress-timeline-list"
        className={`flex flex-col gap-1 ${FOCUS_RING_CLASS}`}
      >
        {rows.map((row) => (
          <TimelineEntry key={row.phase} row={row} startedAt={startedAt} />
        ))}
      </ol>
    </section>
  );
}

function TimelineEntry({
  row,
  startedAt,
}: {
  row: TimelineRow;
  startedAt: number | null;
}): JSX.Element {
  const elapsed =
    row.timestamp !== null && startedAt !== null
      ? formatElapsed(row.timestamp - startedAt)
      : null;
  return (
    <li
      data-testid={`ti-progress-timeline-row-${row.phase}`}
      data-status={row.status}
      className="flex items-center gap-2 rounded px-2 py-1 text-[12px]"
    >
      <StatusIcon status={row.status} />
      <span className="flex-1 text-white/85">{PHASE_LABELS[row.phase]}</span>
      {elapsed !== null ? (
        <span className="font-mono text-[11px] text-white/45">{elapsed}</span>
      ) : null}
      {row.detail !== null ? (
        <span className="text-[11px] text-white/55">{row.detail}</span>
      ) : null}
    </li>
  );
}

function StatusIcon({ status }: { status: TimelineRowStatus }): JSX.Element {
  if (status === "complete") {
    return (
      <span aria-label="complete" className="text-[#4eba87]">
        ✓
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span aria-label="failed" className="text-rose-300">
        ✕
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span aria-label="skipped" className="text-white/45">
        ⊖
      </span>
    );
  }
  if (status === "running") {
    return (
      <span
        aria-label="in progress"
        className="text-amber-300 motion-reduce:animate-none"
      >
        ◌
      </span>
    );
  }
  return (
    <span aria-label="pending" className="text-white/30">
      ○
    </span>
  );
}

const safeParseEvent = (raw: string): ProductionRunnerEvent | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { phase?: unknown }).phase === "string" &&
      typeof (parsed as { timestamp?: unknown }).timestamp === "number"
    ) {
      const obj = parsed as {
        phase: ProductionRunnerEventPhase;
        timestamp: number;
        details?: { readonly [k: string]: unknown };
      };
      return {
        phase: obj.phase,
        timestamp: obj.timestamp,
        ...(obj.details !== undefined ? { details: obj.details } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
};

const describeAnnouncement = (rows: readonly TimelineRow[]): string => {
  const running = rows.find((r) => r.status === "running");
  if (running !== undefined) return `Running: ${PHASE_LABELS[running.phase]}.`;
  const failed = rows.find((r) => r.status === "failed");
  if (failed !== undefined) return `Failed: ${PHASE_LABELS[failed.phase]}.`;
  const completedCount = rows.filter((r) => r.status === "complete").length;
  if (completedCount === TIMELINE_PHASES.length) return "All phases complete.";
  return `${completedCount} of ${TIMELINE_PHASES.length} phases complete.`;
};
