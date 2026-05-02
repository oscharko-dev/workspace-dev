/**
 * Right-rail job history strip (Issue #1735 polish).
 *
 * Renders the last N test-intelligence jobs as a compact vertical list.
 * Each row shows:
 *   - the truncated 8-char job id
 *   - a status icon (green check when generated-test-cases is on disk,
 *     amber dot otherwise)
 *   - artifact-completeness badge (e.g. "7/10")
 * Click loads that job into the main panel by calling `onSelect(jobId)`.
 *
 * WCAG 2.2 AA:
 *   - Rows are real `<button>` elements (keyboard-focusable, role-correct)
 *   - Visible focus ring with brand color
 *   - Status icon is aria-hidden; the textual jobId is the accessible
 *     name; an additional aria-describedby explains readiness for SR users
 */

import { useMemo, type JSX } from "react";

import {
  JOB_HISTORY_STRIP_DEFAULT_LIMIT,
  buildJobHistoryRows,
} from "./job-history-strip-model";
import type { TestIntelligenceJobSummary } from "./types";

export interface JobHistoryStripProps {
  jobs: readonly TestIntelligenceJobSummary[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  /** Override the default of 10 rows. */
  limit?: number;
}

const FOCUS_RING_CLASS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4eba87] focus-visible:outline-offset-1";

export function JobHistoryStrip({
  jobs,
  selectedJobId,
  onSelect,
  limit = JOB_HISTORY_STRIP_DEFAULT_LIMIT,
}: JobHistoryStripProps): JSX.Element {
  const rows = useMemo(() => buildJobHistoryRows(jobs, limit), [jobs, limit]);

  return (
    <section
      data-testid="ti-job-history-strip"
      aria-labelledby="ti-job-history-strip-heading"
      className="flex flex-col gap-2 rounded border border-white/10 bg-[#0a0a0a] p-3"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h3
          id="ti-job-history-strip-heading"
          className="m-0 text-sm font-semibold text-white"
        >
          Recent jobs
        </h3>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/45">
          last {rows.length} of {jobs.length}
        </span>
      </header>
      {rows.length === 0 ? (
        <p
          data-testid="ti-job-history-strip-empty"
          role="status"
          className="m-0 px-1 py-2 text-[12px] text-white/55"
        >
          No prior jobs.
        </p>
      ) : (
        <ul
          data-testid="ti-job-history-strip-list"
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {rows.map((row) => (
            <li key={row.jobId} className="m-0">
              <button
                type="button"
                data-testid={`ti-job-history-strip-row-${row.jobId}`}
                data-selected={row.jobId === selectedJobId ? "true" : "false"}
                aria-pressed={row.jobId === selectedJobId}
                onClick={() => onSelect(row.jobId)}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${
                  row.jobId === selectedJobId
                    ? "border-[#4eba87]/50 bg-emerald-950/20"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                } ${FOCUS_RING_CLASS}`}
              >
                <StatusIcon ready={row.ready} />
                <span
                  className="flex-1 truncate font-mono text-[11px] text-white/85"
                  title={row.jobId}
                >
                  {row.shortId}
                </span>
                <span
                  data-testid={`ti-job-history-strip-row-${row.jobId}-artifacts`}
                  aria-label={`${row.artifactCount} of ${row.artifactTotal} artifacts present`}
                  className="rounded border border-white/10 bg-white/5 px-1.5 py-[1px] text-[10px] uppercase tracking-[0.14em] text-white/65"
                >
                  {row.artifactCount}/{row.artifactTotal}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusIcon({ ready }: { ready: boolean }): JSX.Element {
  if (ready) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="size-3 shrink-0 text-[#4eba87]"
        aria-hidden="true"
        data-testid="ti-job-history-strip-status-ready"
      >
        <path
          fillRule="evenodd"
          d="M13.78 4.97a.75.75 0 0 1 0 1.06l-7 7a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06L6.25 11.44l6.47-6.47a.75.75 0 0 1 1.06 0Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full bg-amber-400"
      aria-hidden="true"
      data-testid="ti-job-history-strip-status-pending"
    />
  );
}
