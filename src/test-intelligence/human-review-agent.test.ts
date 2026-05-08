/**
 * Human-review agent tests (Issue #2038).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertHumanReviewDecisionInvariants,
  buildDryRunHumanReviewMarker,
  buildHumanReviewDecision,
  hashPrincipalId,
} from "./human-review-agent.js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

test("buildDryRunHumanReviewMarker emits a deterministic offline envelope", () => {
  const marker = buildDryRunHumanReviewMarker({
    rationale: "Split decision (1:1:1) on screen S-101",
    decidedAt: "2026-05-08T12:00:00Z",
    triggeredBy: "split_decision",
  });
  assert.equal(marker.reviewerKind, "dry_run_marker");
  assert.equal(marker.verdict, "deferred");
  assert.equal(marker.principalHash, sha256Hex("dry-run-marker"));
  assert.equal(marker.triggeredBy, "split_decision");
  assert.equal(marker.schemaVersion, "1.0.0");
});

test("buildHumanReviewDecision hashes principalId with sha256", () => {
  const decision = buildHumanReviewDecision({
    reviewerKind: "principal",
    principalId: "operator-42",
    verdict: "repair",
    rationale: "Lone dissenter from most-trusted family overruled",
    decidedAt: "2026-05-08T12:00:00Z",
    triggeredBy: "majority_decision",
  });
  assert.equal(decision.principalHash, sha256Hex("operator-42"));
  assert.equal(decision.verdict, "repair");
});

test("buildHumanReviewDecision accepts a pre-computed principalHash", () => {
  const hash = sha256Hex("test-principal");
  const decision = buildHumanReviewDecision({
    reviewerKind: "principal",
    principalHash: hash,
    verdict: "accept",
    rationale: "External review approved the verdict",
    decidedAt: "2026-05-08T12:00:00Z",
    triggeredBy: "majority_decision",
  });
  assert.equal(decision.principalHash, hash);
});

test("buildHumanReviewDecision rejects bad principalHash", () => {
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "principal",
        principalHash: "not-hex",
        verdict: "accept",
        rationale: "ok",
        decidedAt: "2026-05-08T12:00:00Z",
        triggeredBy: "split_decision",
      }),
    /principalHash must be 64 lowercase hex chars/u,
  );
});

test("buildHumanReviewDecision rejects rationale with line endings", () => {
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "dry_run_marker",
        verdict: "deferred",
        rationale: "line\nbreak smuggled",
        decidedAt: "2026-05-08T12:00:00Z",
        triggeredBy: "split_decision",
      }),
    /forbidden control \/ line-separator codepoint/u,
  );
});

test("buildHumanReviewDecision rejects U+2028 / U+2029 line separators", () => {
  for (const sep of ["\u2028", "\u2029"]) {
    assert.throws(
      () =>
        buildHumanReviewDecision({
          reviewerKind: "dry_run_marker",
          verdict: "deferred",
          rationale: `bad${sep}rationale`,
          decidedAt: "2026-05-08T12:00:00Z",
          triggeredBy: "split_decision",
        }),
      /forbidden control \/ line-separator codepoint/u,
    );
  }
});

test("buildHumanReviewDecision rejects empty rationale", () => {
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "dry_run_marker",
        verdict: "deferred",
        rationale: "",
        decidedAt: "2026-05-08T12:00:00Z",
        triggeredBy: "split_decision",
      }),
    /rationale must be a non-empty string/u,
  );
});

test("buildHumanReviewDecision caps rationale length at HUMAN_REVIEW_RATIONALE_MAX_CHARS", () => {
  const overlong = "a".repeat(1025);
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "dry_run_marker",
        verdict: "deferred",
        rationale: overlong,
        decidedAt: "2026-05-08T12:00:00Z",
        triggeredBy: "split_decision",
      }),
    /exceeds HUMAN_REVIEW_RATIONALE_MAX_CHARS/u,
  );
});

test("buildHumanReviewDecision rejects non-ISO-8601 decidedAt", () => {
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "dry_run_marker",
        verdict: "deferred",
        rationale: "ok",
        decidedAt: "Tuesday at noon",
        triggeredBy: "split_decision",
      }),
    /strict ISO-8601 timestamp/u,
  );
});

test("buildHumanReviewDecision refuses principal without id or hash", () => {
  assert.throws(
    () =>
      buildHumanReviewDecision({
        reviewerKind: "principal",
        verdict: "repair",
        rationale: "ok",
        decidedAt: "2026-05-08T12:00:00Z",
        triggeredBy: "majority_decision",
      }),
    /requires a non-empty principalId or pre-computed principalHash/u,
  );
});

test("assertHumanReviewDecisionInvariants validates a reloaded record", () => {
  const decision = buildHumanReviewDecision({
    reviewerKind: "dry_run_marker",
    verdict: "deferred",
    rationale: "valid",
    decidedAt: "2026-05-08T12:00:00Z",
    triggeredBy: "split_decision",
  });
  assert.doesNotThrow(() => assertHumanReviewDecisionInvariants(decision));
});

test("hashPrincipalId yields a stable sha256", () => {
  assert.equal(hashPrincipalId("foo"), sha256Hex("foo"));
});
