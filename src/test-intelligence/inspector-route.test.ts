import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isInspectorTestIntelligenceWriteAction,
  parseInspectorTestIntelligenceRoute,
} from "./inspector-route.js";

describe("parseInspectorTestIntelligenceRoute", () => {
  test("rejects paths outside the inspector test-intelligence prefix", () => {
    const result = parseInspectorTestIntelligenceRoute("/workspace/jobs/abc");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "prefix_mismatch");
    }
  });

  test("rejects an empty subroute", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unknown_subroute");
    }
  });

  test("rejects unknown top-level segments", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/foo/bar",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unknown_subroute");
    }
  });

  test("parses /jobs as list_jobs", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/jobs",
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.route.kind, "list_jobs");
    }
  });

  test("parses /jobs/<jobId> as read_bundle", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/jobs/job-abc-123",
    );
    assert.equal(result.ok, true);
    if (result.ok && result.route.kind === "read_bundle") {
      assert.equal(result.route.jobId, "job-abc-123");
    } else {
      assert.fail("expected read_bundle route");
    }
  });

  test("rejects path traversal in jobId", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/jobs/..",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("rejects slashes inside jobId", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/jobs/a/b",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });

  test("parses /review/<jobId>/state", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/review/job-1/state",
    );
    assert.equal(result.ok, true);
    if (result.ok && result.route.kind === "review_state") {
      assert.equal(result.route.jobId, "job-1");
    } else {
      assert.fail("expected review_state");
    }
  });

  test("parses /review/<jobId>/<action> as job-level review_action", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/review/job-1/note",
    );
    assert.equal(result.ok, true);
    if (result.ok && result.route.kind === "review_action") {
      assert.equal(result.route.jobId, "job-1");
      assert.equal(result.route.action, "note");
      assert.equal(result.route.testCaseId, undefined);
    } else {
      assert.fail("expected review_action");
    }
  });

  test("parses /review/<jobId>/<action>/<testCaseId> as per-case review_action", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/review/job-1/approve/tc-42",
    );
    assert.equal(result.ok, true);
    if (result.ok && result.route.kind === "review_action") {
      assert.equal(result.route.jobId, "job-1");
      assert.equal(result.route.action, "approve");
      assert.equal(result.route.testCaseId, "tc-42");
    } else {
      assert.fail("expected review_action with testCaseId");
    }
  });

  test("parses /sources/<jobId>/jira-paste as jira_paste_source", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/sources/job-1/jira-paste",
    );
    assert.equal(result.ok, true);
    if (result.ok && result.route.kind === "jira_paste_source") {
      assert.equal(result.route.jobId, "job-1");
    } else {
      assert.fail("expected jira_paste_source");
    }
  });

  test("rejects unknown source ingestion subroutes", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/sources/job-1/unknown",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unknown_subroute");
    }
  });

  test("rejects path traversal inside testCaseId", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/review/job-1/approve/..",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_test_case_id");
    }
  });

  test("rejects too many path segments", () => {
    const result = parseInspectorTestIntelligenceRoute(
      "/workspace/test-intelligence/review/job-1/approve/tc-1/extra",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });
});

describe("isInspectorTestIntelligenceWriteAction", () => {
  test("returns false for list_jobs and read_bundle", () => {
    assert.equal(
      isInspectorTestIntelligenceWriteAction({ kind: "list_jobs" }),
      false,
    );
    assert.equal(
      isInspectorTestIntelligenceWriteAction({
        kind: "read_bundle",
        jobId: "job-1",
      }),
      false,
    );
  });

  test("returns false for review_state", () => {
    assert.equal(
      isInspectorTestIntelligenceWriteAction({
        kind: "review_state",
        jobId: "job-1",
      }),
      false,
    );
  });

  test("returns true for any review_action", () => {
    assert.equal(
      isInspectorTestIntelligenceWriteAction({
        kind: "review_action",
        jobId: "job-1",
        action: "approve",
        testCaseId: "tc-1",
      }),
      true,
    );
    assert.equal(
      isInspectorTestIntelligenceWriteAction({
        kind: "review_action",
        jobId: "job-1",
        action: "note",
      }),
      true,
    );
  });

  test("returns true for jira_paste_source", () => {
    assert.equal(
      isInspectorTestIntelligenceWriteAction({
        kind: "jira_paste_source",
        jobId: "job-1",
      }),
      true,
    );
  });
});
