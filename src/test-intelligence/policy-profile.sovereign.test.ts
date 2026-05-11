import assert from "node:assert/strict";
import test from "node:test";

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID,
  EU_BANKING_SOVEREIGN_POLICY_PROFILE_VERSION,
} from "../contracts/index.js";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE,
  EU_BANKING_SOVEREIGN_POLICY_PROFILE,
  cloneEuBankingSovereignProfile,
} from "./policy-profile.js";

test("sovereign profile carries its own canonical id distinct from the default", () => {
  assert.equal(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.id,
    EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID,
  );
  assert.equal(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.version,
    EU_BANKING_SOVEREIGN_POLICY_PROFILE_VERSION,
  );
  assert.notEqual(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.id,
    EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  );
});

test("sovereign profile inherits the default rule set byte-for-byte", () => {
  // The sovereign profile is a topology overlay, not a policy weakening:
  // every hard gate, threshold, and tier-elastic coefficient must be
  // identical to the default profile so audit dossiers from sovereign
  // and standard runs are policy-comparable.
  assert.equal(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.rules.minConfidence,
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.minConfidence,
  );
  assert.deepEqual(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.rules.reviewOnlyRiskCategories,
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories,
  );
  assert.deepEqual(
    EU_BANKING_SOVEREIGN_POLICY_PROFILE.rules.strictRiskCategories,
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.strictRiskCategories,
  );
});

test("sovereign profile is deep-frozen", () => {
  assert.ok(Object.isFrozen(EU_BANKING_SOVEREIGN_POLICY_PROFILE));
});

test("clone is mutable and isolated from both frozen profiles", () => {
  const a = cloneEuBankingSovereignProfile();
  const b = cloneEuBankingSovereignProfile();
  assert.equal(a.id, EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID);
  assert.equal(a.version, EU_BANKING_SOVEREIGN_POLICY_PROFILE_VERSION);
  a.rules.minConfidence = 0.95;
  assert.equal(b.rules.minConfidence, 0.6);
  assert.equal(EU_BANKING_SOVEREIGN_POLICY_PROFILE.rules.minConfidence, 0.6);
  assert.equal(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.minConfidence, 0.6);
});

test("clone honours allowedHostingRegions override and rejects empty list", () => {
  const narrowed = cloneEuBankingSovereignProfile({
    allowedHostingRegions: ["eu-de-1"],
  });
  assert.deepEqual(narrowed.rules.allowedHostingRegions, ["eu-de-1"]);
  // The clone produces a writable copy — overriding the override is fine.
  narrowed.rules.allowedHostingRegions = ["eu-de-1", "eu-fr-1"];
  assert.deepEqual(narrowed.rules.allowedHostingRegions, [
    "eu-de-1",
    "eu-fr-1",
  ]);
  assert.throws(
    () => cloneEuBankingSovereignProfile({ allowedHostingRegions: [] }),
    /non-empty/u,
  );
});

test("clone preserves the default allow-list when no override is supplied", () => {
  const cloned = cloneEuBankingSovereignProfile();
  assert.deepEqual(
    cloned.rules.allowedHostingRegions,
    [...(EU_BANKING_DEFAULT_POLICY_PROFILE.rules.allowedHostingRegions ?? [])],
  );
});
