import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseEvidenceVerifyRoute } from "./evidence-verify-route.js";

describe("parseEvidenceVerifyRoute", () => {
  test("parses /workspace/jobs/<jobId>/evidence/verify", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-abc-123/evidence/verify",
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.route.kind, "verify_evidence");
      assert.equal(result.route.jobId, "job-abc-123");
    }
  });

  test("rejects a prefix outside /workspace/jobs", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/test-intelligence/evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "prefix_mismatch");
    }
  });

  test("rejects a path with no jobId", () => {
    const result = parseEvidenceVerifyRoute("/workspace/jobs/");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });

  test("rejects a path missing the verify suffix", () => {
    const result = parseEvidenceVerifyRoute("/workspace/jobs/job-1/evidence");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });

  test("rejects a path with a trailing extra segment", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-1/evidence/verify/extra",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });

  test("rejects a wrong middle segment (not 'evidence')", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-1/audit/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unknown_subroute");
    }
  });

  test("rejects a wrong final segment (not 'verify')", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-1/evidence/check",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unknown_subroute");
    }
  });

  test("rejects path-traversal jobId", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/../evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("rejects single-dot jobId", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/./evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("rejects a jobId with disallowed characters", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/bad job/evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      // A space is not in the SAFE_JOB_ID character class, so the
      // jobId is rejected by `isSafeJobId`.
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("rejects a jobId with shell metacharacters", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/$(whoami)/evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("rejects a jobId longer than the safe limit", () => {
    const longId = "a".repeat(200);
    const result = parseEvidenceVerifyRoute(
      `/workspace/jobs/${longId}/evidence/verify`,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "unsafe_job_id");
    }
  });

  test("accepts allowed punctuation in jobId", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job_1.run-2025/evidence/verify",
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.route.jobId, "job_1.run-2025");
    }
  });

  test("accepts a path with a trailing slash", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-1/evidence/verify/",
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.route.jobId, "job-1");
    }
  });

  test("rejects an empty jobId between two slashes", () => {
    const result = parseEvidenceVerifyRoute("/workspace/jobs//evidence/verify");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "empty_segment");
    }
  });

  test("rejects an empty middle segment", () => {
    const result = parseEvidenceVerifyRoute(
      "/workspace/jobs/job-1//evidence/verify",
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "segment_count_invalid");
    }
  });

  test("rejects an unrelated /workspace path", () => {
    const result = parseEvidenceVerifyRoute("/healthz");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reason, "prefix_mismatch");
    }
  });
});
