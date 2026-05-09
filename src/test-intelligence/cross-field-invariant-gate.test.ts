/**
 * Tests for the cross-field invariant validation-pipeline gate
 * (Issue #2110).
 *
 * The gate enforces "every screen with ≥ 1 cross-field invariant has at
 * least one positive + one negative test case". Tests cover:
 *
 *   - blocking when claims are missing on either side
 *   - non-blocking when both sides are claimed
 *   - tolerance of unknown invariant ids (warning, not error)
 *   - deterministic per-screen + per-invariant ordering
 *   - degenerate empty registry / empty claims input
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultCrossFieldInvariantRegistry,
} from "./cross-field-invariant-registry.js";
import { createCrossFieldInvariantRegistry } from "./cross-field-invariant-engine.js";
import {
  CROSS_FIELD_INVARIANT_COVERAGE_ARTIFACT_FILENAME,
  evaluateCrossFieldInvariantCoverage,
  type CrossFieldCaseClaim,
} from "./cross-field-invariant-gate.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

void test("artifact filename is canonical", () => {
  assert.equal(
    CROSS_FIELD_INVARIANT_COVERAGE_ARTIFACT_FILENAME,
    "cross-field-invariant-coverage-report.json",
  );
});

void test("empty registry yields a non-blocking empty report", () => {
  const registry = createCrossFieldInvariantRegistry();
  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    registry,
    claims: [],
  });
  assert.equal(report.blocked, false);
  assert.equal(report.totalInvariants, 0);
  assert.equal(report.fullyCoveredInvariants, 0);
  assert.deepEqual(report.perScreen, []);
  assert.deepEqual(report.perInvariant, []);
  assert.deepEqual(report.issues, []);
});

void test("missing positive AND negative produces two errors per screen", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-empty",
    generatedAt: GENERATED_AT,
    registry,
    claims: [],
  });
  assert.equal(report.blocked, true);
  // Every screen surfaced an error of each kind.
  const positives = report.issues.filter(
    (issue) => issue.code === "screen_missing_positive_case",
  );
  const negatives = report.issues.filter(
    (issue) => issue.code === "screen_missing_negative_case",
  );
  assert.equal(positives.length, report.perScreen.length);
  assert.equal(negatives.length, report.perScreen.length);
});

void test("balanced claims clear both gate halves", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();

  // Build claims: every invariant gets one positive case (`pos-<id>`) and
  // one negative case (`neg-<id>`).
  const claims: CrossFieldCaseClaim[] = [];
  for (const invariant of list) {
    claims.push({
      testCaseId: `pos-${invariant.id}`,
      invariantId: invariant.id,
      side: "positive",
    });
    claims.push({
      testCaseId: `neg-${invariant.id}`,
      invariantId: invariant.id,
      side: "negative",
    });
  }

  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-full",
    generatedAt: GENERATED_AT,
    registry,
    claims,
  });
  assert.equal(report.blocked, false);
  assert.deepEqual(
    report.issues.filter((issue) => issue.severity === "error"),
    [],
  );
  assert.equal(report.fullyCoveredInvariants, list.length);
});

void test("only-positive coverage blocks for missing-negative side", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();
  const claims: CrossFieldCaseClaim[] = list.map((invariant) => ({
    testCaseId: `pos-${invariant.id}`,
    invariantId: invariant.id,
    side: "positive",
  }));
  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-only-positive",
    generatedAt: GENERATED_AT,
    registry,
    claims,
  });
  assert.equal(report.blocked, true);
  const negativeIssues = report.issues.filter(
    (issue) => issue.code === "screen_missing_negative_case",
  );
  assert.ok(negativeIssues.length > 0);
  // No positive-side complaints — every screen has a positive claim.
  assert.deepEqual(
    report.issues.filter(
      (issue) => issue.code === "screen_missing_positive_case",
    ),
    [],
  );
});

void test("unknown invariant id surfaces warning but does not block", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();
  const claims: CrossFieldCaseClaim[] = [];
  for (const invariant of list) {
    claims.push({
      testCaseId: `pos-${invariant.id}`,
      invariantId: invariant.id,
      side: "positive",
    });
    claims.push({
      testCaseId: `neg-${invariant.id}`,
      invariantId: invariant.id,
      side: "negative",
    });
  }
  // Inject a claim for a bogus invariant id.
  claims.push({
    testCaseId: "bogus-tc",
    invariantId: "XINV-NOT-IN-REGISTRY-99",
    side: "positive",
  });
  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-unknown",
    generatedAt: GENERATED_AT,
    registry,
    claims,
  });
  assert.equal(report.blocked, false);
  const unknownIssues = report.issues.filter(
    (issue) => issue.code === "invariant_unknown",
  );
  assert.equal(unknownIssues.length, 1);
  assert.equal(unknownIssues[0]?.severity, "warning");
  assert.equal(unknownIssues[0]?.invariantId, "XINV-NOT-IN-REGISTRY-99");
});

void test("perScreen rows are sorted by screenId and per-invariant rows by id", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "job-order",
    generatedAt: GENERATED_AT,
    registry,
    claims: [],
  });
  for (let i = 1; i < report.perScreen.length; i += 1) {
    assert.ok(
      report.perScreen[i - 1]!.screenId < report.perScreen[i]!.screenId,
      "perScreen rows must be sorted ascending by screenId",
    );
  }
  for (let i = 1; i < report.perInvariant.length; i += 1) {
    assert.ok(
      report.perInvariant[i - 1]!.invariantId <
        report.perInvariant[i]!.invariantId,
      "perInvariant rows must be sorted ascending by invariantId",
    );
  }
});
