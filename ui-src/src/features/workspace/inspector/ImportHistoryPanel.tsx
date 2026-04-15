// ---------------------------------------------------------------------------
// Import History Panel (Issue #1010)
//
// Pure presentational popover listing prior paste-pipeline imports. The parent
// owns positioning (absolute, relative to the Inspector toolbar button) and
// lifecycle; this component only renders rows + forwards intent via callbacks.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type JSX } from "react";
import type { PasteImportSession } from "./paste-import-history";
import type { WorkspaceImportSessionEvent } from "./import-review-state";

export interface ImportHistoryPanelProps {
  /** Sorted-newest-first list of sessions to render. */
  sessions: readonly PasteImportSession[];
  /** Callback when the user clicks "Re-import" on a row. */
  onReImport: (session: PasteImportSession) => void;
  /** Callback when the user clicks "Delete import" on a row. Should remove from history. */
  onDelete: (session: PasteImportSession) => void;
  /** Callback when the user clicks the close button or hits Escape. */
  onClose: () => void;
  /** Currently expanded session id, or null when none is expanded. Optional — when absent, rows are not expandable. */
  expandedSessionId?: string | null;
  /** Toggles expansion for a row. Called with the same session that was clicked to expand or collapse. */
  onRowToggle?: (session: PasteImportSession) => void;
  /** Supplies the audit trail for the expanded session. Called only when a row is expanded. */
  getTrail?: (sessionId: string) => readonly WorkspaceImportSessionEvent[];
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Formats `then` relative to `now` using `Intl.RelativeTimeFormat` for the
 * thresholded ranges (minutes, hours, days), "just now" under 60s, and a
 * locale date string for timestamps >= 7 days old.
 */
function formatRelativeTime(now: Date, then: Date): string {
  const diffMs = now.getTime() - then.getTime();
  const absMs = Math.abs(diffMs);
  const sign = diffMs >= 0 ? -1 : 1; // RelativeTimeFormat: negative => past

  if (absMs < MINUTE_MS) {
    return "just now";
  }

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absMs < HOUR_MS) {
    const minutes = Math.round(absMs / MINUTE_MS);
    return rtf.format(sign * minutes, "minute");
  }

  if (absMs < DAY_MS) {
    const hours = Math.round(absMs / HOUR_MS);
    return rtf.format(sign * hours, "hour");
  }

  if (absMs < WEEK_MS) {
    const days = Math.round(absMs / DAY_MS);
    return rtf.format(sign * days, "day");
  }

  return then.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function resolvePrimaryLabel(session: PasteImportSession): string {
  return session.nodeName.length > 0 ? session.nodeName : session.fileKey;
}

export function ImportHistoryPanel({
  sessions,
  onReImport,
  onDelete,
  onClose,
  expandedSessionId,
  onRowToggle,
  getTrail,
}: ImportHistoryPanelProps): JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const handlePointerDown = (event: MouseEvent): void => {
      const node = containerRef.current;
      if (
        node &&
        event.target instanceof Node &&
        !node.contains(event.target)
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onClose]);

  const now = new Date();

  return (
    <section
      ref={containerRef}
      data-testid="import-history-panel"
      role="region"
      aria-label="Import history"
      className="flex w-80 flex-col overflow-hidden rounded border border-[#333333] bg-[#1d1d1d] text-white/65 shadow-xl"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[#333333] bg-[#1d1d1d] px-3 py-1.5">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-white/65">
          Import History
        </h3>
        <button
          type="button"
          data-testid="import-history-close"
          onClick={onClose}
          aria-label="Close import history"
          className="cursor-pointer rounded border border-[#333333] bg-transparent px-1.5 py-0.5 text-[11px] font-medium text-white/45 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87]"
        >
          ✕
        </button>
      </div>

      {sessions.length === 0 ? (
        <div
          data-testid="import-history-empty"
          className="px-3 py-4 text-center text-[11px] text-white/45"
        >
          No imports yet. Pasted designs will appear here.
        </div>
      ) : (
        <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0">
          {sessions.map((session) => {
            const importedAt = new Date(session.importedAt);
            const relative = formatRelativeTime(now, importedAt);
            const showMetrics = session.nodeCount > 0 || session.fileCount > 0;
            const replayable = session.replayable !== false;
            return (
              <li
                key={session.id}
                data-testid={`import-history-row-${session.id}`}
                className="flex flex-col gap-1 border-b border-[#333333] px-3 py-2 last:border-b-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12px] font-semibold text-white">
                      {resolvePrimaryLabel(session)}
                    </span>
                    <span className="text-[10px] text-white/45">
                      {relative}
                    </span>
                    {showMetrics ? (
                      <span className="text-[10px] text-white/35">
                        {session.nodeCount} nodes, {session.fileCount} files
                      </span>
                    ) : null}
                    {!replayable && session.replayDisabledReason ? (
                      <span className="text-[10px] text-amber-300/70">
                        {session.replayDisabledReason}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid={`import-history-reimport-${session.id}`}
                    disabled={!replayable}
                    onClick={() => {
                      onReImport(session);
                    }}
                    title={
                      replayable
                        ? "Re-import this session"
                        : (session.replayDisabledReason ??
                          "This import cannot be replayed from history.")
                    }
                    className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[10px] font-medium text-white/65 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87] disabled:cursor-default disabled:opacity-30"
                  >
                    Re-import
                  </button>
                  <button
                    type="button"
                    data-testid={`import-history-delete-${session.id}`}
                    onClick={() => {
                      onDelete(session);
                    }}
                    className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[10px] font-medium text-white/45 transition hover:border-rose-400/40 hover:bg-[#000000] hover:text-rose-400"
                  >
                    Delete
                  </button>
                  {onRowToggle ? (
                    <button
                      type="button"
                      data-testid={`import-history-toggle-${session.id}`}
                      aria-expanded={expandedSessionId === session.id}
                      onClick={() => {
                        onRowToggle(session);
                      }}
                      className="cursor-pointer rounded border border-[#333333] bg-transparent px-2 py-0.5 text-[10px] font-medium text-white/45 transition hover:border-[#4eba87]/40 hover:bg-[#000000] hover:text-[#4eba87]"
                    >
                      {expandedSessionId === session.id ? "Hide log" : "Log"}
                    </button>
                  ) : null}
                </div>
                {expandedSessionId === session.id && getTrail ? (
                  <AuditTrail
                    sessionId={session.id}
                    events={getTrail(session.id)}
                    now={now}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface AuditTrailProps {
  readonly sessionId: string;
  readonly events: readonly WorkspaceImportSessionEvent[];
  readonly now: Date;
}

function AuditTrail({ sessionId, events, now }: AuditTrailProps): JSX.Element {
  if (events.length === 0) {
    return (
      <div
        data-testid={`import-history-trail-empty-${sessionId}`}
        className="mt-1 rounded border border-[#333333]/60 px-2 py-1 text-[10px] text-white/35"
      >
        No audit events recorded yet.
      </div>
    );
  }
  return (
    <ul
      data-testid={`import-history-trail-${sessionId}`}
      className="mt-1 flex list-none flex-col gap-0.5 rounded border border-[#333333]/60 px-2 py-1"
    >
      {events.map((event) => {
        const at = new Date(event.at);
        const relative = Number.isNaN(at.getTime())
          ? event.at
          : formatRelativeTime(now, at);
        const note =
          typeof event.note === "string" && event.note.length > 0
            ? truncate(event.note, 120)
            : null;
        return (
          <li
            key={event.id}
            data-testid={`import-history-trail-entry-${event.id}`}
            className="flex flex-col gap-0.5 text-[10px] text-white/45"
          >
            <span className="text-white/65">
              <span className="font-semibold text-white/75">{event.kind}</span>
              <span className="ml-1 text-white/35">·</span>
              <span className="ml-1">{relative}</span>
              <span className="ml-1 text-white/35">·</span>
              <span className="ml-1">
                {typeof event.actor === "string" && event.actor.length > 0
                  ? event.actor
                  : "—"}
              </span>
            </span>
            {note ? <span className="text-white/35">{note}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
