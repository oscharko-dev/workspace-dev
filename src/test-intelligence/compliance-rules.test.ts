import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLIANCE_FRAMEWORK_IDS,
  COMPLIANCE_RULE_PACK_REGISTRY,
  COMPLIANCE_RULE_PACK_SCHEMA_VERSION,
  DEFAULT_FRAMEWORKS_FOR_POLICY_PROFILE,
  getComplianceRulePack,
  isComplianceFrameworkId,
  listComplianceRulePacks,
  parseComplianceFrameworksFlag,
  resolveActiveFrameworks,
  validateComplianceRulePack,
} from "./compliance-rules.js";

test("registry covers every framework id exactly once", () => {
  const keys = Object.keys(COMPLIANCE_RULE_PACK_REGISTRY).sort();
  const expected = [...COMPLIANCE_FRAMEWORK_IDS].sort();
  assert.deepEqual(keys, expected);
});

test("each shipped pack passes schema validation and is deep-frozen", () => {
  for (const pack of listComplianceRulePacks()) {
    assert.equal(pack.schemaVersion, COMPLIANCE_RULE_PACK_SCHEMA_VERSION);
    assert.ok(Object.isFrozen(pack), `pack ${pack.framework} not frozen`);
    assert.ok(Object.isFrozen(pack.rules), `${pack.framework} rules not frozen`);
    for (const rule of pack.rules) {
      assert.ok(Object.isFrozen(rule), `${rule.id} not frozen`);
      assert.ok(rule.id.startsWith(`${pack.framework}-`));
      assert.ok(rule.mandatoryTestClasses.length > 0);
      assert.ok(rule.keywords.length > 0);
    }
  }
});

test("validateComplianceRulePack rejects malformed inputs", () => {
  assert.throws(
    () =>
      validateComplianceRulePack({
        schemaVersion: COMPLIANCE_RULE_PACK_SCHEMA_VERSION,
        framework: "PSD2",
        title: "x",
        citationRoot: "y",
        description: "short",
        rules: [],
      }),
    /invalid compliance rule pack/u,
  );

  assert.throws(
    () =>
      validateComplianceRulePack({
        schemaVersion: COMPLIANCE_RULE_PACK_SCHEMA_VERSION,
        framework: "PSD2",
        title: "PSD2 sample",
        citationRoot: "Directive (EU) 2015/2366",
        description: "Sample pack with prefix mismatch",
        rules: [
          {
            id: "GDPR-mistaken-prefix",
            citation: "ref",
            description: "this rule belongs to a different framework",
            domain: "banking",
            mandatoryTestClasses: ["functional"],
            severity: "warning",
            keywords: ["xyz"],
          },
        ],
      }),
    /must start with framework prefix "PSD2-"/u,
  );

  assert.throws(
    () =>
      validateComplianceRulePack({
        schemaVersion: COMPLIANCE_RULE_PACK_SCHEMA_VERSION,
        framework: "PSD2",
        title: "PSD2 sample",
        citationRoot: "Directive (EU) 2015/2366",
        description: "Duplicate rule ids must be rejected",
        rules: [
          {
            id: "PSD2-Sample-Art-1",
            citation: "ref",
            description: "first rule",
            domain: "banking",
            mandatoryTestClasses: ["functional"],
            severity: "warning",
            keywords: ["alpha"],
          },
          {
            id: "PSD2-Sample-Art-1",
            citation: "ref",
            description: "duplicate rule id",
            domain: "banking",
            mandatoryTestClasses: ["functional"],
            severity: "warning",
            keywords: ["beta"],
          },
        ],
      }),
    /duplicate rule id/u,
  );
});

test("isComplianceFrameworkId is a strict guard", () => {
  assert.equal(isComplianceFrameworkId("PSD2"), true);
  assert.equal(isComplianceFrameworkId("UNKNOWN"), false);
  assert.equal(isComplianceFrameworkId(undefined), false);
  assert.equal(isComplianceFrameworkId(123), false);
});

test("parseComplianceFrameworksFlag accepts both kebab- and snake-case", () => {
  assert.deepEqual(parseComplianceFrameworksFlag("PSD2,GDPR"), ["PSD2", "GDPR"]);
  assert.deepEqual(parseComplianceFrameworksFlag("mifid-ii,IDD"), [
    "MIFID_II",
    "IDD",
  ]);
  // Deduplicates; preserves first-seen order.
  assert.deepEqual(parseComplianceFrameworksFlag("PSD2,psd2,GDPR"), [
    "PSD2",
    "GDPR",
  ]);
});

test("parseComplianceFrameworksFlag rejects empty / unknown tokens", () => {
  assert.throws(
    () => parseComplianceFrameworksFlag(""),
    /requires a non-empty/u,
  );
  assert.throws(
    () => parseComplianceFrameworksFlag("BOGUS"),
    /unknown framework "BOGUS"/u,
  );
});

test("resolveActiveFrameworks defaults from the eu-banking-default profile", () => {
  const active = resolveActiveFrameworks(undefined, "eu-banking-default");
  assert.deepEqual(
    [...active],
    [...DEFAULT_FRAMEWORKS_FOR_POLICY_PROFILE["eu-banking-default"]!],
  );
});

test("resolveActiveFrameworks honours an explicit selection", () => {
  const active = resolveActiveFrameworks(["PSD2", "GDPR"], "eu-banking-default");
  assert.deepEqual([...active], ["PSD2", "GDPR"]);
});

test("resolveActiveFrameworks returns the full registry on unknown profile", () => {
  const active = resolveActiveFrameworks(undefined, "unknown-profile");
  assert.deepEqual([...active], [...COMPLIANCE_FRAMEWORK_IDS]);
});

test("resolveActiveFrameworks rejects an empty explicit selection", () => {
  assert.throws(
    () => resolveActiveFrameworks([], "eu-banking-default"),
    /must include at least one framework/u,
  );
});

test("getComplianceRulePack returns the same instance for the same id", () => {
  const a = getComplianceRulePack("PSD2");
  const b = getComplianceRulePack("PSD2");
  assert.equal(a, b);
  assert.equal(a.framework, "PSD2");
});

test("PSD2 SCA Article 97 is shipped as an error-severity rule", () => {
  const pack = getComplianceRulePack("PSD2");
  const rule = pack.rules.find((r) => r.id === "PSD2-SCA-Art-97");
  assert.ok(rule);
  assert.equal(rule!.severity, "error");
  assert.ok(rule!.mandatoryTestClasses.includes("functional"));
  assert.ok(rule!.mandatoryTestClasses.includes("negative"));
});
