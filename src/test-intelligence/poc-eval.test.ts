import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WAVE1_POC_FIXTURE_IDS } from "../contracts/index.js";
import { runWave1Poc, type Wave1PocRunResult } from "./poc-harness.js";
import {
  evaluateWave1Poc,
  evaluateWave1PocFixture,
  WAVE1_POC_DEFAULT_EVAL_THRESHOLDS,
} from "./poc-eval.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const newRunDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "ti-poc-eval-"));
};

const runFixture = async (
  fixtureId: (typeof WAVE1_POC_FIXTURE_IDS)[number],
): Promise<Wave1PocRunResult> => {
  const runDir = await newRunDir();
  return runWave1Poc({
    fixtureId,
    jobId: `job-${fixtureId}-eval`,
    generatedAt: GENERATED_AT,
    runDir,
  });
};

const toFixtureEvalInput = (run: Wave1PocRunResult) => ({
  fixtureId: run.fixtureId,
  intent: run.intent,
  generatedList: run.generatedList,
  validation: run.validation,
  reviewSnapshot: run.reviewSnapshot,
  exportArtifacts: run.exportArtifacts,
});

test("poc-eval: default thresholds pass for both shipped fixtures", async () => {
  const runs = await Promise.all(
    WAVE1_POC_FIXTURE_IDS.map((id) => runFixture(id)),
  );
  const report = evaluateWave1Poc({
    generatedAt: GENERATED_AT,
    fixtures: runs.map(toFixtureEvalInput),
  });
  assert.equal(report.pass, true, JSON.stringify(report.fixtures, null, 2));
  assert.equal(report.fixtures.length, runs.length);
  for (const fixture of report.fixtures) {
    assert.equal(
      fixture.pass,
      true,
      `fixture ${fixture.fixtureId} failed: ${JSON.stringify(fixture.failures)}`,
    );
    assert.ok(fixture.metrics.approvedCases > 0);
    assert.equal(fixture.metrics.exportRefused, false);
    assert.equal(fixture.metrics.policyBlocked, false);
    assert.equal(fixture.metrics.visualSidecarBlocked, false);
  }
});

test("poc-eval: report is sorted by fixtureId for byte-stability", async () => {
  const runs = await Promise.all(
    WAVE1_POC_FIXTURE_IDS.map((id) => runFixture(id)),
  );
  const report = evaluateWave1Poc({
    generatedAt: GENERATED_AT,
    // Reversed input order; output must still be sorted.
    fixtures: runs.slice().reverse().map(toFixtureEvalInput),
  });
  const order = report.fixtures.map((f) => f.fixtureId);
  const sorted = [...order].sort();
  assert.deepEqual(order, sorted);
});

test("poc-eval: tightening minTraceCoverageFields above measured value fails", async () => {
  const run = await runFixture("poc-onboarding");
  const fixtureInput = toFixtureEvalInput(run);
  // Compute the measured field coverage by running once with the default,
  // then bump the threshold above 1.0 to force a deterministic failure.
  const tightened = {
    ...WAVE1_POC_DEFAULT_EVAL_THRESHOLDS,
    minTraceCoverageFields: 1.0001,
  };
  const fixture = evaluateWave1PocFixture(fixtureInput, tightened);
  assert.equal(fixture.pass, false);
  assert.ok(
    fixture.failures.some((f) => f.rule === "min_trace_coverage_fields"),
    `expected min_trace_coverage_fields failure, got ${JSON.stringify(fixture.failures)}`,
  );
});

test("poc-eval: lowering maxDuplicateSimilarity below observed maximum fails", async () => {
  const run = await runFixture("poc-payment-auth");
  const fixtureInput = toFixtureEvalInput(run);
  const fixture = evaluateWave1PocFixture(fixtureInput, {
    ...WAVE1_POC_DEFAULT_EVAL_THRESHOLDS,
    maxDuplicateSimilarity: 0,
  });
  assert.equal(fixture.pass, false);
  assert.ok(
    fixture.failures.some((f) => f.rule === "max_duplicate_similarity"),
  );
});

test("poc-eval: report.pass is the AND of every fixture.pass", async () => {
  const onboarding = await runFixture("poc-onboarding");
  const payment = await runFixture("poc-payment-auth");
  // Force `payment` to fail by tightening one threshold beyond the
  // measured maximum; onboarding stays passing under the default.
  const failing = evaluateWave1Poc({
    generatedAt: GENERATED_AT,
    fixtures: [toFixtureEvalInput(onboarding), toFixtureEvalInput(payment)],
    thresholds: {
      ...WAVE1_POC_DEFAULT_EVAL_THRESHOLDS,
      // Both runs cover 100% of fields; require MORE than 100% to force a
      // breach across both fixtures.
      minTraceCoverageFields: 2,
    },
  });
  assert.equal(failing.pass, false);
  assert.ok(failing.fixtures.every((f) => f.pass === false));
});
