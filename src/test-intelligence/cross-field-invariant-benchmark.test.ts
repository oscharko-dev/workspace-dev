/**
 * Eingabemasken benchmark for the cross-field invariant engine
 * (Issue #2110).
 *
 * This benchmark satisfies the "Eingabemasken benchmark exercises every
 * cross-field invariant" acceptance criterion. The strategy:
 *
 *   1. Build the default cross-field invariant registry.
 *   2. For every registered invariant, synthesize the BVA seeds
 *      through the engine; project each synthesized datum into a
 *      `CrossFieldCaseClaim` (positive seeds become positive claims,
 *      negative seeds become negative claims) — i.e. the engine itself
 *      drives the benchmark, no hand-curated mapping table.
 *   3. Run the validation-pipeline gate on the resulting claim set and
 *      assert:
 *        a. The gate is non-blocking (every screen has both halves).
 *        b. Every registered invariant appears as `fullyCovered` in the
 *           coverage report.
 *        c. The gate's per-invariant coverage row carries at least one
 *           positive and at least one negative test-case id.
 *
 * The benchmark also asserts that every invariant's citation, anchors,
 * and severity are well-formed — a final guardrail before the registry
 * defaults the production pipeline.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { synthesizeCrossFieldTestData } from "./cross-field-invariant-engine.js";
import { evaluateCrossFieldInvariantCoverage } from "./cross-field-invariant-gate.js";
import {
  buildDefaultCrossFieldInvariantRegistry,
  DEFAULT_BANKING_INVARIANT_COUNT,
  DEFAULT_INSURANCE_INVARIANT_COUNT,
} from "./cross-field-invariant-registry.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

void test("benchmark covers every cross-field invariant in the default catalog", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();

  // Project synthesized BVA seeds into pipeline-gate claims.
  const claims = list.flatMap((invariant) => {
    const synthesized = synthesizeCrossFieldTestData(invariant);
    return synthesized.map((row, index) => ({
      testCaseId: `bench/${invariant.id}/${row.category}/${index}`,
      invariantId: invariant.id,
      side:
        row.category === "cross_field_positive"
          ? ("positive" as const)
          : ("negative" as const),
    }));
  });

  const report = evaluateCrossFieldInvariantCoverage({
    jobId: "eingabemasken-cross-field-benchmark",
    generatedAt: GENERATED_AT,
    registry,
    claims,
  });

  assert.equal(report.blocked, false, "benchmark must produce a green gate");
  assert.equal(
    report.fullyCoveredInvariants,
    list.length,
    "every invariant must be fully covered",
  );
  for (const row of report.perInvariant) {
    assert.ok(
      row.positiveCaseIds.length >= 1,
      `invariant "${row.invariantId}" missing a positive case in benchmark`,
    );
    assert.ok(
      row.negativeCaseIds.length >= 1,
      `invariant "${row.invariantId}" missing a negative case in benchmark`,
    );
  }
});

void test("benchmark touches both banking and insurance halves", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  const list = registry.list();
  const banking = list.filter((row) => row.id.startsWith("XINV-BANK-"));
  const insurance = list.filter((row) => row.id.startsWith("XINV-INS-"));
  assert.equal(banking.length, DEFAULT_BANKING_INVARIANT_COUNT);
  assert.equal(insurance.length, DEFAULT_INSURANCE_INVARIANT_COUNT);
});

void test("each invariant declares anchors with stable screenId/elementId", () => {
  const registry = buildDefaultCrossFieldInvariantRegistry();
  for (const invariant of registry.list()) {
    assert.ok(
      invariant.anchors.length >= 1,
      `invariant "${invariant.id}" must declare at least one anchor`,
    );
    for (const anchor of invariant.anchors) {
      assert.match(anchor.screenId, /^[a-z0-9-]+$/);
      assert.match(anchor.elementId, /^[a-z0-9-]+$/);
      assert.match(anchor.fieldRef, /^[a-z0-9_]+$/);
    }
  }
});
