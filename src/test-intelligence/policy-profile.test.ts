import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
} from "../contracts/index.js";
import {
  cloneEuBankingDefaultProfile,
  EU_BANKING_DEFAULT_POLICY_PROFILE,
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

test("default profile is deep-frozen", () => {
  assert.ok(Object.isFrozen(EU_BANKING_DEFAULT_POLICY_PROFILE));
  assert.ok(Object.isFrozen(EU_BANKING_DEFAULT_POLICY_PROFILE.rules));
  assert.ok(
    Object.isFrozen(
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories,
    ),
  );
});
