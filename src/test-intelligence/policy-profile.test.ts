import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  TIER_ELASTIC_EP_TIERS,
} from "../contracts/index.js";
import { ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD } from "./adversarial-critic-agent.js";
import {
  EU_BANKING_DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY,
  EU_BANKING_DEFAULT_JUDGE_REFUSAL_POLICY,
  cloneEuBankingDefaultProfile,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
  EU_BANKING_DEFAULT_POLICY_PROFILE,
  EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS,
  EU_BANKING_DEFAULT_SELF_CONSISTENCY_SAMPLE_COUNT,
} from "./policy-profile.js";

test("default profile carries the canonical id and version", () => {
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.id,
    EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  );
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.version,
    EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  );
});

test("regulated_data and financial_transaction are review-only", () => {
  assert.ok(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories.includes(
      "regulated_data",
    ),
  );
  assert.ok(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories.includes(
      "financial_transaction",
    ),
  );
});

test("clone is mutable and isolated from the frozen default", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  a.rules.minConfidence = 0.95;
  assert.equal(b.rules.minConfidence, 0.6);
  assert.equal(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.minConfidence, 0.6);
});

test("default profile enables risk-tag downgrade detection (Issue #1412)", () => {
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.enforceRiskTagDowngradeDetection,
    true,
  );
  const cloned = cloneEuBankingDefaultProfile();
  assert.equal(cloned.rules.enforceRiskTagDowngradeDetection, true);
});

test("default profile is deep-frozen", () => {
  assert.ok(Object.isFrozen(EU_BANKING_DEFAULT_POLICY_PROFILE));
  assert.ok(Object.isFrozen(EU_BANKING_DEFAULT_POLICY_PROFILE.rules));
  assert.ok(
    Object.isFrozen(
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories,
    ),
  );
});

test("Issue #2053: default profile enforces G-NEG-CASE at 0.30 with deep-frozen config", () => {
  const config = EU_BANKING_DEFAULT_POLICY_PROFILE.rules.negativeCaseLift;
  assert.ok(
    config !== undefined,
    "expected default profile to expose the gate config",
  );
  assert.equal(config.gateMode, "enforce");
  assert.equal(config.thresholdRatio, 0.3);
  assert.ok(
    Object.isFrozen(config),
    "negativeCaseLift block must be deep-frozen",
  );
});

test("Issue #2053: clone round-trips negativeCaseLift and isolates it from the frozen default", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.negativeCaseLift, {
    gateMode: "enforce",
    thresholdRatio: 0.3,
  });
  a.rules.negativeCaseLift = { gateMode: "advisory", thresholdRatio: 0.5 };
  assert.deepEqual(b.rules.negativeCaseLift, {
    gateMode: "enforce",
    thresholdRatio: 0.3,
  });
  assert.deepEqual(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.negativeCaseLift, {
    gateMode: "enforce",
    thresholdRatio: 0.3,
  });
});

test("Issue #2068: default profile selects tier-elastic technique-coverage minimum", () => {
  const config =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.techniqueCoverageMinimum;
  assert.ok(
    config !== undefined,
    "expected the default profile to expose the knob",
  );
  assert.equal(config.mode, "tier-elastic");
  assert.deepEqual(config.tiers, TIER_ELASTIC_EP_TIERS);
  assert.ok(
    Object.isFrozen(config),
    "techniqueCoverageMinimum block must be deep-frozen",
  );
  assert.ok(Object.isFrozen(config.tiers), "tier table must be frozen");
  assert.ok(
    Object.isFrozen(config.tiers?.[0]),
    "individual tier records must be frozen",
  );
});

test("Issue #2171: clone round-trips techniqueCoverageMinimum tiers and isolates the override", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.techniqueCoverageMinimum, {
    mode: "tier-elastic",
    tiers: TIER_ELASTIC_EP_TIERS,
  });
  assert.ok(
    a.rules.techniqueCoverageMinimum?.tiers !== undefined,
    "expected clone to expose mutable tiers",
  );
  const clonedTechniqueCoverageMinimum = a.rules
    .techniqueCoverageMinimum as NonNullable<
    typeof a.rules.techniqueCoverageMinimum
  > & { tiers: Array<(typeof TIER_ELASTIC_EP_TIERS)[number]> };
  clonedTechniqueCoverageMinimum.tiers[0] = {
    ...clonedTechniqueCoverageMinimum.tiers[0],
    label: "mutated-clone-tier",
  };
  assert.deepEqual(b.rules.techniqueCoverageMinimum, {
    mode: "tier-elastic",
    tiers: TIER_ELASTIC_EP_TIERS,
  });
  assert.deepEqual(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.techniqueCoverageMinimum,
    {
      mode: "tier-elastic",
      tiers: TIER_ELASTIC_EP_TIERS,
    },
  );
});

test("Issue #2053: default threshold matches the in-module agent constant", () => {
  // The policy-profile constant and the adversarial-critic-agent
  // constant document the same threshold from two angles. Drift between
  // them would cause the gate's behaviour to silently diverge from the
  // accounting metric persisted in the trace artifact.
  assert.equal(
    EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
    ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD,
  );
  assert.equal(EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE, "enforce");
});

test("Issue #2070: default profile enables 3-sample self-consistency voting", () => {
  assert.deepEqual(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.selfConsistency, {
    sampleCount: 3,
  });
  assert.equal(EU_BANKING_DEFAULT_SELF_CONSISTENCY_SAMPLE_COUNT, 3);
});

test("Issue #2101: default profile routes faithfulness and a11y judge refusals to needs_review", () => {
  assert.deepEqual(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.judgeRefusalPolicy,
    EU_BANKING_DEFAULT_JUDGE_REFUSAL_POLICY,
  );
});

test("Issue #2101: clone round-trips judgeRefusalPolicy and isolates overrides", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.judgeRefusalPolicy, {
    faithfulness: "needs_review",
    a11y: "needs_review",
  });
  a.rules.judgeRefusalPolicy = {
    faithfulness: "fail_closed",
    a11y: "fail_open",
  };
  assert.deepEqual(b.rules.judgeRefusalPolicy, {
    faithfulness: "needs_review",
    a11y: "needs_review",
  });
  assert.deepEqual(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.judgeRefusalPolicy, {
    faithfulness: "needs_review",
    a11y: "needs_review",
  });
});

test("Issue #2070: clone round-trips selfConsistency and isolates overrides", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.selfConsistency, { sampleCount: 3 });
  a.rules.selfConsistency = { sampleCount: 1 };
  assert.deepEqual(b.rules.selfConsistency, { sampleCount: 3 });
  assert.deepEqual(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.selfConsistency, {
    sampleCount: 3,
  });
});

test("Issue #2116: secure default keeps requirePerStepFaithfulness off (warn-only)", () => {
  // Pinning the default at false is a deliberate governance choice — see the
  // 2026-05-10 ADR. Flipping the secure default must be reviewed alongside
  // the ADR, and this assertion makes the diff visible in the PR.
  assert.equal(EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS, false);
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.requirePerStepFaithfulness,
    false,
  );
});

test("Issue #2116: clone round-trips requirePerStepFaithfulness and isolates overrides", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.equal(a.rules.requirePerStepFaithfulness, false);
  a.rules.requirePerStepFaithfulness = true;
  assert.equal(b.rules.requirePerStepFaithfulness, false);
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.requirePerStepFaithfulness,
    false,
  );
});

test("Issue #2169: default profile exposes the elastic FinOps wall-clock coefficients", () => {
  assert.deepEqual(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.finopsWallClockBudget,
    EU_BANKING_DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY,
  );
});

test("Issue #2169: clone round-trips finopsWallClockBudget and isolates overrides", () => {
  // Wave-5 W5-2 follow-up (2026-05-11): coefficients re-calibrated for
  // live `gpt-oss-120b` latency profile (was 90s base / 1.8s/case / 360s
  // ceiling — too tight; P0 multi-dataset 2 of 4 visible runs breached).
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.finopsWallClockBudget, {
    baseMs: 150_000,
    perCaseMs: 4_000,
    perAdditionalJudgeMs: 20_000,
    perAdversarialRoundMs: 30_000,
    visualSidecarMs: 30_000,
    hardCeilingMs: 1_800_000,
  });
  a.rules.finopsWallClockBudget = {
    baseMs: 80_000,
    perCaseMs: 1_500,
    perAdditionalJudgeMs: 10_000,
    perAdversarialRoundMs: 20_000,
    visualSidecarMs: 12_000,
    hardCeilingMs: 300_000,
  };
  assert.equal(b.rules.finopsWallClockBudget?.baseMs, 150_000);
  assert.equal(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.finopsWallClockBudget?.baseMs,
    150_000,
  );
});
