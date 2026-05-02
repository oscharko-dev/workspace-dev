/**
 * Inspector test-intelligence route bridge (Issue #1367).
 *
 * Path conventions:
 *
 *   GET  /workspace/test-intelligence/jobs                                  → list jobs
 *   GET  /workspace/test-intelligence/jobs/<jobId>                          → bundle (read)
 *   GET  /workspace/test-intelligence/jobs/<jobId>/sources                  → source refs
 *   GET  /workspace/test-intelligence/jobs/<jobId>/customer-markdown        → combined customer Markdown export (#1733)
 *   POST /workspace/test-intelligence/jobs/<jobId>/sources/jira-fetch       → Jira REST ingest
 *   POST /workspace/test-intelligence/jobs/<jobId>/conflicts/<conflictId>/resolve
 *                                                                        → reviewer conflict action
 *   GET  /workspace/test-intelligence/review/<jobId>/state                  → review snapshot + events
 *   POST /workspace/test-intelligence/review/<jobId>/<action>               → job-level write
 *   POST /workspace/test-intelligence/review/<jobId>/<action>/<testCaseId>  → per-case write
 *   POST /workspace/test-intelligence/sources/<jobId>/jira-paste            → Jira paste source ingest
 *   POST /workspace/test-intelligence/sources/<jobId>/custom-context        → custom context source ingest
 *   POST /workspace/test-intelligence/write/<jobId>/jira-subtasks           → start a Jira sub-task write run (#1482)
 *   GET  /workspace/test-intelligence/write/config                          → read user-scoped Jira write config
 *   PUT  /workspace/test-intelligence/write/config                          → persist user-scoped Jira write config
 *
 * Reads are unauthenticated (artifact JSON contains no secrets — the
 * test-intelligence pipeline already redacts PII before persistence).
 * Writes are bearer-protected fail-closed: missing/blank token → 503.
 *
 * The parser is path-only — method dispatch and authorization happen at
 * the request-handler layer.
 */

import { isSafeJobId } from "./inspector-bundle.js";

const ROOT = "/workspace/test-intelligence";

export type InspectorTestIntelligenceRoute =
  | { kind: "list_jobs" }
  | { kind: "read_bundle"; jobId: string }
  | { kind: "list_sources"; jobId: string }
  | { kind: "customer_markdown_export"; jobId: string }
  | { kind: "jira_fetch_source"; jobId: string }
  | { kind: "remove_source"; jobId: string; sourceId: string }
  | { kind: "resolve_conflict"; jobId: string; conflictId: string }
  | { kind: "review_state"; jobId: string }
  | { kind: "jira_paste_source"; jobId: string }
  | { kind: "custom_context_source"; jobId: string }
  | { kind: "jira_write_start"; jobId: string }
  | { kind: "jira_write_config" }
  | {
      kind: "review_action";
      jobId: string;
      action: string;
      testCaseId?: string;
    };

export interface InspectorTestIntelligenceParseError {
  kind: "parse_error";
  reason:
    | "prefix_mismatch"
    | "segment_count_invalid"
    | "empty_segment"
    | "unsafe_job_id"
    | "unsafe_test_case_id"
    | "unknown_subroute";
}

export type InspectorTestIntelligenceParseResult =
  | { ok: true; route: InspectorTestIntelligenceRoute }
  | { ok: false; error: InspectorTestIntelligenceParseError };

const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

const isSafeId = (value: string): boolean =>
  SAFE_ID.test(value) && value !== "." && value !== "..";

/**
 * Parse an Inspector test-intelligence request path. Returns an error
 * object instead of throwing so the request handler can map to a 4xx
 * status without try/catch noise.
 */
export const parseInspectorTestIntelligenceRoute = (
  pathname: string,
): InspectorTestIntelligenceParseResult => {
  if (!pathname.startsWith(ROOT)) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "prefix_mismatch" },
    };
  }
  const remainder = pathname.slice(ROOT.length);
  const segments = remainder.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    return {
      ok: false,
      error: { kind: "parse_error", reason: "unknown_subroute" },
    };
  }
  const head = segments[0];

  if (head === "jobs") {
    if (segments.length === 1) {
      return { ok: true, route: { kind: "list_jobs" } };
    }
    const jobId = segments[1];
    if (jobId === undefined || jobId.length === 0) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "empty_segment" },
      };
    }
    if (!isSafeJobId(jobId)) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "unsafe_job_id" },
      };
    }
    if (segments.length === 3 && segments[2] === "sources") {
      return { ok: true, route: { kind: "list_sources", jobId } };
    }
    if (segments.length === 3 && segments[2] === "customer-markdown") {
      return { ok: true, route: { kind: "customer_markdown_export", jobId } };
    }
    if (
      segments.length === 4 &&
      segments[2] === "sources" &&
      segments[3] === "jira-fetch"
    ) {
      return { ok: true, route: { kind: "jira_fetch_source", jobId } };
    }
    if (segments.length === 4 && segments[2] === "sources") {
      const sourceId = segments[3];
      if (sourceId === undefined || !isSafeId(sourceId)) {
        return {
          ok: false,
          error: { kind: "parse_error", reason: "unsafe_test_case_id" },
        };
      }
      return { ok: true, route: { kind: "remove_source", jobId, sourceId } };
    }
    if (
      segments.length === 5 &&
      segments[2] === "conflicts" &&
      segments[4] === "resolve"
    ) {
      const conflictId = segments[3];
      if (conflictId === undefined || !isSafeId(conflictId)) {
        return {
          ok: false,
          error: { kind: "parse_error", reason: "unsafe_test_case_id" },
        };
      }
      return {
        ok: true,
        route: { kind: "resolve_conflict", jobId, conflictId },
      };
    }
    if (segments.length !== 2) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "segment_count_invalid" },
      };
    }
    return { ok: true, route: { kind: "read_bundle", jobId } };
  }

  if (head === "review") {
    if (segments.length < 3 || segments.length > 4) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "segment_count_invalid" },
      };
    }
    const jobId = segments[1];
    const action = segments[2];
    if (
      jobId === undefined ||
      jobId.length === 0 ||
      action === undefined ||
      action.length === 0
    ) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "empty_segment" },
      };
    }
    if (!isSafeJobId(jobId)) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "unsafe_job_id" },
      };
    }
    if (action === "state" && segments.length === 3) {
      return { ok: true, route: { kind: "review_state", jobId } };
    }
    if (segments.length === 4) {
      const testCaseId = segments[3];
      if (testCaseId === undefined || testCaseId.length === 0) {
        return {
          ok: false,
          error: { kind: "parse_error", reason: "empty_segment" },
        };
      }
      if (!isSafeId(testCaseId)) {
        return {
          ok: false,
          error: { kind: "parse_error", reason: "unsafe_test_case_id" },
        };
      }
      return {
        ok: true,
        route: { kind: "review_action", jobId, action, testCaseId },
      };
    }
    return {
      ok: true,
      route: { kind: "review_action", jobId, action },
    };
  }

  if (head === "sources") {
    if (segments.length !== 3) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "segment_count_invalid" },
      };
    }
    const jobId = segments[1];
    const sourceKind = segments[2];
    if (
      jobId === undefined ||
      jobId.length === 0 ||
      sourceKind === undefined ||
      sourceKind.length === 0
    ) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "empty_segment" },
      };
    }
    if (!isSafeJobId(jobId)) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "unsafe_job_id" },
      };
    }
    if (sourceKind === "jira-paste") {
      return { ok: true, route: { kind: "jira_paste_source", jobId } };
    }
    if (sourceKind === "custom-context") {
      return { ok: true, route: { kind: "custom_context_source", jobId } };
    }
    {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "unknown_subroute" },
      };
    }
  }

  if (head === "write") {
    if (segments.length === 2 && segments[1] === "config") {
      return { ok: true, route: { kind: "jira_write_config" } };
    }
    if (segments.length !== 3) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "segment_count_invalid" },
      };
    }
    const jobId = segments[1];
    const writeKind = segments[2];
    if (
      jobId === undefined ||
      jobId.length === 0 ||
      writeKind === undefined ||
      writeKind.length === 0
    ) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "empty_segment" },
      };
    }
    if (!isSafeJobId(jobId)) {
      return {
        ok: false,
        error: { kind: "parse_error", reason: "unsafe_job_id" },
      };
    }
    if (writeKind === "jira-subtasks") {
      return { ok: true, route: { kind: "jira_write_start", jobId } };
    }
    return {
      ok: false,
      error: { kind: "parse_error", reason: "unknown_subroute" },
    };
  }

  return {
    ok: false,
    error: { kind: "parse_error", reason: "unknown_subroute" },
  };
};

/** Whether the parsed action requires bearer authentication (writes only). */
export const isInspectorTestIntelligenceWriteAction = (
  route: InspectorTestIntelligenceRoute,
): boolean => {
  if (route.kind === "jira_fetch_source") return true;
  if (route.kind === "remove_source") return true;
  if (route.kind === "resolve_conflict") return true;
  if (route.kind === "jira_paste_source") return true;
  if (route.kind === "custom_context_source") return true;
  if (route.kind === "jira_write_start") return true;
  if (route.kind === "jira_write_config") return true;
  if (route.kind !== "review_action") return false;
  return route.action !== "state";
};
