import assert from "node:assert/strict";
import test from "node:test";

import {
  ROUTING_QUALITY_DEFAULT_THRESHOLD,
  ROUTING_QUALITY_DEFAULT_TOLERANCE,
  ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION,
  assertRoutingQualityNotRegressed,
  evaluateTierLowRegression,
  sampleTierLowDecisions,
} from "./cost-routing-quality-sampler.js";
import {
  classifyTask,
  classifyTaskBatch,
  type TaskClassificationDecision,
} from "./task-classifier-agent.js";

const tierLowDecisions = (count: number): readonly TaskClassificationDecision[] =>
  classifyTaskBatch(
    Array.from({ length: count }, (_, i) => ({
      taskId: `t-${i.toString().padStart(3, "0")}`,
      taskKind: "simple_ui_validation",
      estimatedInputTokens: 200,
    })),
  );

test("constants: defaults are 0.05 / 0.05", () => {
  assert.equal(ROUTING_QUALITY_DEFAULT_TOLERANCE, 0.05);
  assert.equal(ROUTING_QUALITY_DEFAULT_THRESHOLD, 0.05);
});

test("sampleTierLowDecisions: rejects out-of-range sample rate", () => {
  assert.throws(
    () =>
      sampleTierLowDecisions({
        decisions: tierLowDecisions(10),
        sampleRate: 1.5,
      }),
    /sampleRate must be in/,
  );
});

test("sampleTierLowDecisions: returns empty when no tier-low decisions", () => {
  const non = classifyTaskBatch([
    { taskId: "t-h", taskKind: "regulatory_inference" },
    { taskId: "t-m", taskKind: "standard_business_logic" },
  ]);
  const sample = sampleTierLowDecisions({
    decisions: non,
    sampleRate: 1,
  });
  assert.equal(sample.length, 0);
});

test("sampleTierLowDecisions: deterministic for the same seed", () => {
  const decisions = tierLowDecisions(50);
  const a = sampleTierLowDecisions({ decisions, sampleRate: 0.2, seed: 42 });
  const b = sampleTierLowDecisions({ decisions, sampleRate: 0.2, seed: 42 });
  assert.deepEqual(
    a.map((d) => d.taskId),
    b.map((d) => d.taskId),
  );
  assert.equal(a.length, 10);
});

test("sampleTierLowDecisions: different seeds give different orderings", () => {
  const decisions = tierLowDecisions(50);
  const a = sampleTierLowDecisions({ decisions, sampleRate: 0.2, seed: 1 });
  const b = sampleTierLowDecisions({ decisions, sampleRate: 0.2, seed: 99 });
  // The sample sets may differ; if equal lengths, the sets should
  // differ at least once for these seeds on a 50-element source.
  const aIds = new Set(a.map((d) => d.taskId));
  const bIds = new Set(b.map((d) => d.taskId));
  assert.notDeepEqual(aIds, bIds);
});

test("sampleTierLowDecisions: respects minimum sample size floor", () => {
  const decisions = tierLowDecisions(20);
  const sample = sampleTierLowDecisions({
    decisions,
    sampleRate: 0.01,
    minimumSampleSize: 5,
  });
  assert.equal(sample.length, 5);
});

test("sampleTierLowDecisions: ceil ensures non-empty when rate * count is small", () => {
  const decisions = tierLowDecisions(11);
  const sample = sampleTierLowDecisions({
    decisions,
    sampleRate: 0.05,
  });
  assert.equal(sample.length, 1);
});

test("sampleTierLowDecisions: filters out non-tier-low decisions", () => {
  const mixed = classifyTaskBatch([
    { taskId: "low-1", taskKind: "simple_ui_validation", estimatedInputTokens: 100 },
    { taskId: "high-1", taskKind: "regulatory_inference" },
    { taskId: "low-2", taskKind: "simple_ui_validation", estimatedInputTokens: 100 },
    { taskId: "mid-1", taskKind: "standard_business_logic" },
  ]);
  const sample = sampleTierLowDecisions({
    decisions: mixed,
    sampleRate: 1,
  });
  assert.equal(sample.length, 2);
  for (const d of sample) {
    assert.equal(d.tier, "tier-low");
  }
});

test("evaluateTierLowRegression: clean run reports no regression", () => {
  const verdicts = Array.from({ length: 10 }, (_, i) => ({
    taskId: `t-${i}`,
    baselineScore: 0.9,
    routedScore: 0.88,
  }));
  const report = evaluateTierLowRegression({
    jobId: "job-clean",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
  });
  assert.equal(report.schemaVersion, ROUTING_QUALITY_REGRESSION_REPORT_SCHEMA_VERSION);
  assert.equal(report.regressionCount, 0);
  assert.equal(report.passed, true);
  assert.equal(report.tier, "tier-low");
});

test("evaluateTierLowRegression: regression rate past threshold fails the gate", () => {
  const verdicts = [
    { taskId: "t-1", baselineScore: 0.9, routedScore: 0.5 },
    { taskId: "t-2", baselineScore: 0.9, routedScore: 0.5 },
    { taskId: "t-3", baselineScore: 0.9, routedScore: 0.5 },
    { taskId: "t-4", baselineScore: 0.9, routedScore: 0.88 },
  ];
  const report = evaluateTierLowRegression({
    jobId: "job-bad",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
  });
  assert.equal(report.regressionCount, 3);
  assert.equal(report.passed, false);
  assert.throws(
    () => assertRoutingQualityNotRegressed(report),
    /routing quality regression rate/,
  );
});

test("evaluateTierLowRegression: tolerance hides small drift", () => {
  const verdicts = Array.from({ length: 10 }, (_, i) => ({
    taskId: `t-${i}`,
    baselineScore: 0.9,
    routedScore: 0.87,
  }));
  const tight = evaluateTierLowRegression({
    jobId: "job-tight",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
    tolerance: 0.01,
    threshold: 0,
  });
  assert.equal(tight.regressionCount, 10);
  assert.equal(tight.passed, false);

  const lenient = evaluateTierLowRegression({
    jobId: "job-lenient",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
    tolerance: 0.05,
  });
  assert.equal(lenient.regressionCount, 0);
  assert.equal(lenient.passed, true);
});

test("evaluateTierLowRegression: clamps scores to [0,1] and entries are sorted", () => {
  const verdicts = [
    { taskId: "z", baselineScore: 1.5, routedScore: -0.2 },
    { taskId: "a", baselineScore: 0.9, routedScore: 0.85 },
  ];
  const report = evaluateTierLowRegression({
    jobId: "job-clamp",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
  });
  assert.equal(report.entries[0]!.taskId, "a");
  assert.equal(report.entries[1]!.taskId, "z");
  assert.equal(report.entries[1]!.baselineScore, 1);
  assert.equal(report.entries[1]!.routedScore, 0);
});

test("evaluateTierLowRegression: empty sample is a passing report", () => {
  const report = evaluateTierLowRegression({
    jobId: "job-empty",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts: [],
  });
  assert.equal(report.sampleSize, 0);
  assert.equal(report.regressionCount, 0);
  assert.equal(report.regressionRate, 0);
  assert.equal(report.passed, true);
});

test("evaluateTierLowRegression: rejects empty jobId", () => {
  assert.throws(
    () =>
      evaluateTierLowRegression({
        jobId: "",
        generatedAt: "2026-05-08T00:00:00Z",
        verdicts: [],
      }),
    /jobId must be non-empty/,
  );
});

test("evaluateTierLowRegression: end-to-end with the sampler", () => {
  const decisions = tierLowDecisions(20);
  const sampled = sampleTierLowDecisions({
    decisions,
    sampleRate: 0.5,
    seed: 7,
  });
  // Simulate a small but acceptable drift on the sample.
  const verdicts = sampled.map((d, i) => ({
    taskId: d.taskId,
    baselineScore: 0.9,
    routedScore: i % 5 === 0 ? 0.83 : 0.88,
  }));
  const report = evaluateTierLowRegression({
    jobId: "job-e2e",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts,
    tolerance: 0.05,
    threshold: 0.5,
  });
  assert.equal(report.sampleSize, sampled.length);
  assert.equal(report.passed, true);
});

test("assertRoutingQualityNotRegressed: noop on a passing report", () => {
  const report = evaluateTierLowRegression({
    jobId: "job-ok",
    generatedAt: "2026-05-08T00:00:00Z",
    verdicts: [{ taskId: "t-1", baselineScore: 0.9, routedScore: 0.88 }],
  });
  // Should not throw.
  assertRoutingQualityNotRegressed(report);
});

test("classifyTask integration: tier-low decisions propagate through the sampler unchanged", () => {
  const d = classifyTask({
    taskId: "single-low",
    taskKind: "simple_ui_validation",
    estimatedInputTokens: 200,
  });
  const sample = sampleTierLowDecisions({
    decisions: [d],
    sampleRate: 1,
  });
  assert.equal(sample.length, 1);
  assert.equal(sample[0]!.taskId, "single-low");
});
