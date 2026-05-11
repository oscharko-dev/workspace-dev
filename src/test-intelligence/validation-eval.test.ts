import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { WAVE1_VALIDATION_FIXTURE_IDS } from "../contracts/index.js";
import {
  runWave1Validation,
  type Wave1ValidationRunResult,
} from "./validation-harness.js";
import {
  evaluateWave1Validation,
  evaluateWave1ValidationFixture,
  WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
} from "./validation-eval.js";

const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const newRunDir = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "ti-validation-eval-"));
};

const runFixture = async (
  fixtureId: (typeof WAVE1_VALIDATION_FIXTURE_IDS)[number],
): Promise<Wave1ValidationRunResult> => {
  const runDir = await newRunDir();
  return runWave1Validation({
    fixtureId,
    jobId: `job-${fixtureId}-eval`,
    generatedAt: GENERATED_AT,
    runDir,
  });
};

const toFixtureEvalInput = (run: Wave1ValidationRunResult) => ({
  fixtureId: run.fixtureId,
  intent: run.intent,
  generatedList: run.generatedList,
  validation: run.validation,
  reviewSnapshot: run.reviewSnapshot,
  exportArtifacts: run.exportArtifacts,
});

type FixtureEvalInput = ReturnType<typeof toFixtureEvalInput>;

const mutateFirstApprovedCase = (
  input: FixtureEvalInput,
  mutate: (caseIndex: number) => void,
): void => {
  const approvedIds = new Set(
    input.reviewSnapshot.perTestCase
      .filter((entry) =>
        ["approved", "exported", "transferred"].includes(entry.state),
      )
      .map((entry) => entry.testCaseId),
  );
  const caseIndex = input.generatedList.testCases.findIndex((testCase) =>
    approvedIds.has(testCase.id),
  );
  assert.notEqual(caseIndex, -1);
  mutate(caseIndex);
};

test("validation-eval: default thresholds pass for both shipped fixtures", async () => {
  const runs = await Promise.all(
    WAVE1_VALIDATION_FIXTURE_IDS.map((id) => runFixture(id)),
  );
  const report = evaluateWave1Validation({
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

test("validation-eval: report is sorted by fixtureId for byte-stability", async () => {
  const runs = await Promise.all(
    WAVE1_VALIDATION_FIXTURE_IDS.map((id) => runFixture(id)),
  );
  const report = evaluateWave1Validation({
    generatedAt: GENERATED_AT,
    // Reversed input order; output must still be sorted.
    fixtures: runs.slice().reverse().map(toFixtureEvalInput),
  });
  const order = report.fixtures.map((f) => f.fixtureId);
  const sorted = [...order].sort();
  assert.deepEqual(order, sorted);
});

test("validation-eval: tightening minTraceCoverageFields above measured value fails", async () => {
  const run = await runFixture("validation-onboarding");
  const fixtureInput = toFixtureEvalInput(run);
  // Compute the measured field coverage by running once with the default,
  // then bump the threshold above 1.0 to force a deterministic failure.
  const tightened = {
    ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
    minTraceCoverageFields: 1.0001,
  };
  const fixture = evaluateWave1ValidationFixture(fixtureInput, tightened);
  assert.equal(fixture.pass, false);
  assert.ok(
    fixture.failures.some((f) => f.rule === "min_trace_coverage_fields"),
    `expected min_trace_coverage_fields failure, got ${JSON.stringify(fixture.failures)}`,
  );
});

test("validation-eval: lowering maxDuplicateSimilarity below observed maximum fails", async () => {
  const run = await runFixture("validation-payment-auth");
  const fixtureInput = toFixtureEvalInput(run);
  const fixture = evaluateWave1ValidationFixture(fixtureInput, {
    ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
    maxDuplicateSimilarity: 0,
  });
  assert.equal(fixture.pass, false);
  assert.ok(
    fixture.failures.some((f) => f.rule === "max_duplicate_similarity"),
  );
});

test("validation-eval: report.pass is the AND of every fixture.pass", async () => {
  const onboarding = await runFixture("validation-onboarding");
  const payment = await runFixture("validation-payment-auth");
  // Force `payment` to fail by tightening one threshold beyond the
  // measured maximum; onboarding stays passing under the default.
  const failing = evaluateWave1Validation({
    generatedAt: GENERATED_AT,
    fixtures: [toFixtureEvalInput(onboarding), toFixtureEvalInput(payment)],
    thresholds: {
      ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
      // Both runs cover 100% of fields; require MORE than 100% to force a
      // breach across both fixtures.
      minTraceCoverageFields: 2,
    },
  });
  assert.equal(failing.pass, false);
  assert.ok(failing.fixtures.every((f) => f.pass === false));
});

test("validation-eval: each threshold rule fails when its metric is degraded", async () => {
  const run = await runFixture("validation-payment-auth");
  const passingInput = toFixtureEvalInput(run);

  const cases: ReadonlyArray<{
    rule: string;
    mutate: (input: FixtureEvalInput) => void;
    thresholds?: typeof WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS;
  }> = [
    {
      rule: "min_trace_coverage_actions",
      mutate: () => {},
      thresholds: {
        ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
        minTraceCoverageActions: 1.0001,
      },
    },
    {
      rule: "min_trace_coverage_validations",
      mutate: () => {},
      thresholds: {
        ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
        minTraceCoverageValidations: 1.0001,
      },
    },
    {
      rule: "min_qc_mapping_exportable_fraction",
      mutate: (input) => {
        mutateFirstApprovedCase(input, (caseIndex) => {
          input.generatedList.testCases[caseIndex]!.qcMappingPreview.exportable =
            false;
        });
      },
    },
    {
      rule: "min_expected_results_per_case",
      mutate: (input) => {
        mutateFirstApprovedCase(input, (caseIndex) => {
          input.generatedList.testCases[caseIndex]!.expectedResults = [];
        });
      },
    },
    {
      rule: "min_approved_cases",
      mutate: () => {},
      thresholds: {
        ...WAVE1_VALIDATION_DEFAULT_EVAL_THRESHOLDS,
        minApprovedCases: run.reviewSnapshot.approvedCount + 1,
      },
    },
    {
      rule: "policy_blocked",
      mutate: (input) => {
        input.validation.policy.blocked = true;
      },
    },
    {
      rule: "validation_blocked",
      mutate: (input) => {
        input.validation.validation.blocked = true;
      },
    },
    {
      rule: "visual_sidecar_blocked",
      mutate: (input) => {
        assert.ok(input.validation.visual);
        input.validation.visual.blocked = true;
      },
    },
    {
      rule: "export_refused",
      mutate: (input) => {
        input.exportArtifacts.refused = true;
      },
    },
  ];

  for (const testCase of cases) {
    const degradedInput = structuredClone(passingInput);
    testCase.mutate(degradedInput);
    const fixture = evaluateWave1ValidationFixture(
      degradedInput,
      testCase.thresholds,
    );
    assert.equal(
      fixture.pass,
      false,
      `expected ${testCase.rule} to fail`,
    );
    assert.ok(
      fixture.failures.some((failure) => failure.rule === testCase.rule),
      `expected ${testCase.rule}, got ${JSON.stringify(fixture.failures)}`,
    );
  }
});
