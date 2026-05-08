import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
} from "../contracts/index.js";
import { ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD } from "./adversarial-critic-agent.js";
import {
  cloneEuBankingDefaultProfile,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
  EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
  EU_BANKING_DEFAULT_POLICY_PROFILE,
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
  assert.ok(config !== undefined, "expected default profile to expose the gate config");
  assert.equal(config.gateMode, "enforce");
  assert.equal(config.thresholdRatio, 0.3);
  assert.ok(Object.isFrozen(config), "negativeCaseLift block must be deep-frozen");
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
  assert.ok(config !== undefined, "expected the default profile to expose the knob");
  assert.equal(config.mode, "tier-elastic");
  assert.ok(
    Object.isFrozen(config),
    "techniqueCoverageMinimum block must be deep-frozen",
  );
});

test("Issue #2068: clone round-trips techniqueCoverageMinimum and isolates the override", () => {
  const a = cloneEuBankingDefaultProfile();
  const b = cloneEuBankingDefaultProfile();
  assert.deepEqual(a.rules.techniqueCoverageMinimum, { mode: "tier-elastic" });
  a.rules.techniqueCoverageMinimum = { mode: "fixed" };
  assert.deepEqual(b.rules.techniqueCoverageMinimum, { mode: "tier-elastic" });
  assert.deepEqual(
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.techniqueCoverageMinimum,
    { mode: "tier-elastic" },
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
