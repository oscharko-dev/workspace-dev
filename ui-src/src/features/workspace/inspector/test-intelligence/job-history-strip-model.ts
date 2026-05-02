/**
 * Pure model for the right-rail job history strip (Issue #1735).
 *
 * Lives apart from the React component so truncation, ordering, and
 * artifact-summary computation can be unit-tested without DOM overhead.
 *
 * The server-side `TestIntelligenceJobSummary` is intentionally minimal
 * (jobId + per-artifact presence map). This model derives a friendlier
 * row shape for the UI: a truncated id, the count of present artifacts,
 * and a "ready" flag (true when the generated-test-cases artifact is on
 * disk — the minimum needed to render the inspector for the job).
 */

import type { TestIntelligenceJobSummary } from "./types";

export interface JobHistoryRow {
  jobId: string;
  /** First 8 chars of the job id, suitable for compact display. */
  shortId: string;
  /** Count of artifact slots that have content on disk. */
  artifactCount: number;
  /** Total artifact slots known to the server (denominator). */
  artifactTotal: number;
  /** True when the generated-test-cases artifact is present. */
  ready: boolean;
}

/** Default cap on the strip — last 10 jobs as the spec asks for. */
export const JOB_HISTORY_STRIP_DEFAULT_LIMIT = 10;

/** First 8 chars of a job id, fallback to the whole id if shorter. */
export const truncateJobId = (jobId: string, maxLength = 8): string => {
  if (jobId.length <= maxLength) return jobId;
  return jobId.slice(0, maxLength);
};

/** Build a row from a server summary. */
export const buildJobHistoryRow = (
  summary: TestIntelligenceJobSummary,
): JobHistoryRow => {
  const slots = Object.values(summary.hasArtifacts);
  return {
    jobId: summary.jobId,
    shortId: truncateJobId(summary.jobId),
    artifactCount: slots.filter((present) => present === true).length,
    artifactTotal: slots.length,
    ready: summary.hasArtifacts["generatedTestCases"] === true,
  };
};

/**
 * Map a list of server summaries into the last `limit` rows ordered with
 * the most recent first. The server returns summaries sorted by jobId
 * ascending (lexicographic); we reverse to put newer ids at the top
 * since job ids are timestamp-prefixed in production runners.
 */
export const buildJobHistoryRows = (
  summaries: readonly TestIntelligenceJobSummary[],
  limit: number = JOB_HISTORY_STRIP_DEFAULT_LIMIT,
): readonly JobHistoryRow[] => {
  if (limit <= 0) return [];
  const reversed = [...summaries].reverse();
  return reversed.slice(0, limit).map(buildJobHistoryRow);
};
