/**
 * Cross-family judge policy tests (Issue #2038).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCrossFamilyInvariant,
  assertEuResidency,
  assessCrossFamilyPanel,
  classifyDecision,
  isJudgeModelFamily,
  isJudgeModelRegion,
  resolveQuorumVerdict,
  type JudgeFamilyBinding,
} from "./cross-family-judge-policy.js";

const baseBinding = (
  judgeId: string,
  family: JudgeFamilyBinding["family"],
  verdict: JudgeFamilyBinding["verdict"],
  region: JudgeFamilyBinding["region"] = "eu",
): JudgeFamilyBinding => ({
  judgeId,
  family,
  modelId: `${family}-test-model`,
  promptVersion: `${judgeId}.v1`,
  region,
  verdict,
});

test("isJudgeModelFamily refuses unknown families", () => {
  assert.equal(isJudgeModelFamily("anthropic"), true);
  assert.equal(isJudgeModelFamily("openai"), true);
  assert.equal(isJudgeModelFamily("unknown"), false);
  assert.equal(isJudgeModelFamily(undefined), false);
  assert.equal(isJudgeModelFamily(42), false);
});

test("isJudgeModelRegion refuses unknown regions", () => {
  assert.equal(isJudgeModelRegion("eu"), true);
  assert.equal(isJudgeModelRegion("apac"), false);
});

test("assertCrossFamilyInvariant accepts a panel of distinct families", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "openai", "accept"),
    baseBinding("a11y_judge", "google", "accept"),
  ];
  assert.doesNotThrow(() => assertCrossFamilyInvariant(panel));
});

test("assertCrossFamilyInvariant refuses two roles backed by the same family", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "anthropic", "repair"),
    baseBinding("a11y_judge", "google", "accept"),
  ];
  assert.throws(
    () => assertCrossFamilyInvariant(panel),
    /family "anthropic" is bound by both/u,
  );
});

test("assertCrossFamilyInvariant honors the allowSharedFamily override", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "anthropic", "repair"),
  ];
  assert.doesNotThrow(() =>
    assertCrossFamilyInvariant(panel, { allowSharedFamily: true }),
  );
});

test("assertEuResidency accepts EU-region bindings", () => {
  const panel = [baseBinding("logic_judge", "anthropic", "accept", "eu")];
  assert.doesNotThrow(() => assertEuResidency(panel));
});

test("assertEuResidency refuses any non-EU region binding", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept", "eu"),
    baseBinding("faithfulness_judge", "openai", "accept", "us"),
  ];
  assert.throws(
    () => assertEuResidency(panel),
    /faithfulness_judge.*region "us"/u,
  );
});

test("classifyDecision: unanimous_accept", () => {
  assert.equal(
    classifyDecision([
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "accept"),
      baseBinding("a11y_judge", "google", "accept"),
    ]),
    "unanimous_accept",
  );
});

test("classifyDecision: unanimous_reject", () => {
  assert.equal(
    classifyDecision([
      baseBinding("logic_judge", "anthropic", "reject"),
      baseBinding("faithfulness_judge", "openai", "reject"),
      baseBinding("a11y_judge", "google", "reject"),
    ]),
    "unanimous_reject",
  );
});

test("classifyDecision: 2:1 majority is majority_decision", () => {
  assert.equal(
    classifyDecision([
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "accept"),
      baseBinding("a11y_judge", "google", "reject"),
    ]),
    "majority_decision",
  );
});

test("classifyDecision: 1:1:1 is split_decision", () => {
  assert.equal(
    classifyDecision([
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "repair"),
      baseBinding("a11y_judge", "google", "reject"),
    ]),
    "split_decision",
  );
});

test("resolveQuorumVerdict: tie containing repair downgrades to repair", () => {
  assert.equal(
    resolveQuorumVerdict([
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "repair"),
    ]),
    "repair",
  );
});

test("resolveQuorumVerdict: tie of accept and reject only downgrades to repair", () => {
  assert.equal(
    resolveQuorumVerdict([
      baseBinding("logic_judge", "anthropic", "accept"),
      baseBinding("faithfulness_judge", "openai", "reject"),
    ]),
    "repair",
  );
});

test("assessCrossFamilyPanel escalates 1:1:1 splits to human_review_required", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "openai", "repair"),
    baseBinding("a11y_judge", "google", "reject"),
  ];
  const result = assessCrossFamilyPanel(panel);
  assert.equal(result.decision, "split_decision");
  assert.equal(result.escalation, "human_review_required");
  assert.equal(result.escalationRate, 1);
  assert.deepEqual([...result.families].sort(), [
    "anthropic",
    "google",
    "openai",
  ]);
});

test("assessCrossFamilyPanel escalates lone-dissenter from most-trusted family", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "reject"),
    baseBinding("faithfulness_judge", "openai", "accept"),
    baseBinding("a11y_judge", "google", "accept"),
  ];
  const result = assessCrossFamilyPanel(panel, {
    mostTrustedFamily: "anthropic",
  });
  assert.equal(result.decision, "majority_decision");
  assert.equal(result.escalation, "human_review_required");
});

test("assessCrossFamilyPanel does not escalate a 2:1 majority when dissenter is not most trusted", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "openai", "accept"),
    baseBinding("a11y_judge", "google", "reject"),
  ];
  const result = assessCrossFamilyPanel(panel, {
    mostTrustedFamily: "anthropic",
  });
  assert.equal(result.decision, "majority_decision");
  assert.equal(result.escalation, "none");
  assert.equal(result.resolvedVerdict, "accept");
});

test("assessCrossFamilyPanel is unanimous-friendly: no escalation, zero rates", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept"),
    baseBinding("faithfulness_judge", "openai", "accept"),
    baseBinding("a11y_judge", "google", "accept"),
  ];
  const result = assessCrossFamilyPanel(panel);
  assert.equal(result.decision, "unanimous_accept");
  assert.equal(result.escalation, "none");
  assert.equal(result.disagreementRate, 0);
  assert.equal(result.escalationRate, 0);
});

test("assessCrossFamilyPanel propagates the EU residency refusal", () => {
  const panel = [
    baseBinding("logic_judge", "anthropic", "accept", "eu"),
    baseBinding("faithfulness_judge", "openai", "accept", "us"),
    baseBinding("a11y_judge", "google", "accept", "eu"),
  ];
  assert.throws(
    () => assessCrossFamilyPanel(panel, { requireEuRegion: true }),
    /region "us"/u,
  );
});

test("assessCrossFamilyPanel refuses an empty panel", () => {
  assert.throws(
    () => assessCrossFamilyPanel([]),
    /bindings must be a non-empty array/u,
  );
});
