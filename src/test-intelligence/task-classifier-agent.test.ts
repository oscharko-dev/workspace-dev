import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TIER_LOW_QUALITY_REGRESSION_THRESHOLD,
  DEFAULT_TIER_LOW_QUALITY_SAMPLE_RATE,
  TASK_CLASSIFIER_ROLE_ID,
  TASK_CLASSIFIER_TASK_KINDS,
  TASK_CLASSIFIER_VERSION,
  TASK_COMPLEXITY_TIERS,
  classifyTask,
  classifyTaskBatch,
  compareTaskComplexityTier,
  isTaskClassifierTaskKind,
  isTaskComplexityTier,
  maxTaskComplexityTier,
  taskClassificationGroupKey,
} from "./task-classifier-agent.js";

test("constants: TASK_COMPLEXITY_TIERS is the closed low/mid/high vocabulary", () => {
  assert.deepEqual(
    [...TASK_COMPLEXITY_TIERS],
    ["tier-low", "tier-mid", "tier-high"],
  );
});

test("constants: classifier identity is stable", () => {
  assert.equal(TASK_CLASSIFIER_ROLE_ID, "task_classifier");
  assert.equal(TASK_CLASSIFIER_VERSION, "1.0.0");
});

test("constants: default sampling + regression threshold are sane", () => {
  assert.equal(DEFAULT_TIER_LOW_QUALITY_SAMPLE_RATE, 0.1);
  assert.equal(DEFAULT_TIER_LOW_QUALITY_REGRESSION_THRESHOLD, 0.05);
});

test("type guards: accept registered values, reject others", () => {
  assert.equal(isTaskComplexityTier("tier-low"), true);
  assert.equal(isTaskComplexityTier("tier-mega"), false);
  assert.equal(isTaskComplexityTier(42), false);
  assert.equal(isTaskClassifierTaskKind("vision"), true);
  assert.equal(isTaskClassifierTaskKind("rocket-science"), false);
});

test("ordering: compareTaskComplexityTier ranks tiers low<mid<high", () => {
  assert.ok(compareTaskComplexityTier("tier-low", "tier-mid") < 0);
  assert.ok(compareTaskComplexityTier("tier-mid", "tier-high") < 0);
  assert.equal(compareTaskComplexityTier("tier-mid", "tier-mid"), 0);
});

test("ordering: maxTaskComplexityTier returns the more capable tier", () => {
  assert.equal(maxTaskComplexityTier("tier-low", "tier-mid"), "tier-mid");
  assert.equal(maxTaskComplexityTier("tier-high", "tier-low"), "tier-high");
  assert.equal(maxTaskComplexityTier("tier-mid", "tier-mid"), "tier-mid");
});

test("classifyTask: rejects empty taskId", () => {
  assert.throws(
    () => classifyTask({ taskId: "" }),
    /taskId must be a non-empty string/,
  );
});

test("classifyTask: simple_ui_validation routes to tier-low when small", () => {
  const decision = classifyTask({
    taskId: "task-1",
    taskKind: "simple_ui_validation",
    estimatedInputTokens: 200,
  });
  assert.equal(decision.tier, "tier-low");
  assert.equal(decision.resolvedTaskKind, "simple_ui_validation");
  assert.match(decision.rationale, /tier-low/);
});

test("classifyTask: standard_business_logic defaults to tier-mid", () => {
  const decision = classifyTask({
    taskId: "task-2",
    taskKind: "standard_business_logic",
  });
  assert.equal(decision.tier, "tier-mid");
});

test("classifyTask: complex_calculation forces tier-high", () => {
  const decision = classifyTask({
    taskId: "task-3",
    taskKind: "complex_calculation",
  });
  assert.equal(decision.tier, "tier-high");
});

test("classifyTask: regulatory_inference forces tier-high", () => {
  const decision = classifyTask({
    taskId: "task-4",
    taskKind: "standard_business_logic",
    isRegulatoryInference: true,
  });
  assert.equal(decision.tier, "tier-high");
  assert.ok(decision.signals.some((s) => s.includes("regulatoryInference")));
});

test("classifyTask: vision routes to at least tier-mid", () => {
  const decision = classifyTask({ taskId: "task-5", taskKind: "vision" });
  assert.equal(decision.tier, "tier-mid");
});

test("classifyTask: large input/output tokens escalate from low to mid", () => {
  const decision = classifyTask({
    taskId: "task-6",
    taskKind: "simple_ui_validation",
    estimatedInputTokens: 50_000,
  });
  assert.notEqual(decision.tier, "tier-low");
  assert.ok(
    decision.signals.some((s) => s.includes("largeInput")),
    `expected largeInput signal, got ${decision.signals.join(",")}`,
  );
});

test("classifyTask: missing constrained decoding never picks tier-low", () => {
  const decision = classifyTask({
    taskId: "task-7",
    taskKind: "simple_ui_validation",
    estimatedInputTokens: 100,
    constrainedDecodingAvailable: false,
  });
  assert.notEqual(decision.tier, "tier-low");
});

test("classifyTask: role-based fallback maps generator → standard_business_logic → tier-mid", () => {
  const decision = classifyTask({ taskId: "task-8", role: "generator" });
  assert.equal(decision.resolvedTaskKind, "standard_business_logic");
  assert.equal(decision.tier, "tier-mid");
  assert.equal(decision.role, "generator");
});

test("classifyTask: role-based fallback maps adversarial_critic → tier-mid", () => {
  const decision = classifyTask({
    taskId: "task-9",
    role: "adversarial_critic",
  });
  assert.equal(decision.resolvedTaskKind, "adversarial_critique");
  assert.equal(decision.tier, "tier-mid");
});

test("classifyTask: same input always yields the same decision (determinism)", () => {
  const input = {
    taskId: "task-stable",
    taskKind: "standard_business_logic" as const,
    estimatedInputTokens: 4_000,
  };
  const a = classifyTask(input);
  const b = classifyTask(input);
  assert.deepEqual(a, b);
});

test("classifyTask: outputs are deeply frozen", () => {
  const decision = classifyTask({
    taskId: "task-10",
    taskKind: "simple_ui_validation",
  });
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.signals), true);
});

test("classifyTaskBatch: preserves input order and produces a frozen array", () => {
  const out = classifyTaskBatch([
    { taskId: "a", taskKind: "simple_ui_validation" },
    { taskId: "b", taskKind: "regulatory_inference" },
    { taskId: "c", taskKind: "vision" },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[0]!.taskId, "a");
  assert.equal(out[1]!.tier, "tier-high");
  assert.equal(out[2]!.tier, "tier-mid");
  assert.equal(Object.isFrozen(out), true);
});

test("taskClassificationGroupKey: stable kind::tier key", () => {
  const decision = classifyTask({
    taskId: "task-11",
    taskKind: "vision",
  });
  assert.equal(taskClassificationGroupKey(decision), "vision::tier-mid");
});

test("vocabulary: every TASK_CLASSIFIER_TASK_KIND can be classified", () => {
  for (const kind of TASK_CLASSIFIER_TASK_KINDS) {
    const decision = classifyTask({
      taskId: `task-${kind}`,
      taskKind: kind,
    });
    assert.equal(decision.resolvedTaskKind, kind);
    assert.ok(
      (TASK_COMPLEXITY_TIERS as readonly string[]).includes(decision.tier),
    );
  }
});
