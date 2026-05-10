/**
 * FinOps usage recorder + report builder tests (Issue #1371).
 *
 * Covers:
 *   - Recorder aggregates gateway successes and failures by role.
 *   - Cache-hit jobs report zero token usage and zero attempts.
 *   - Per-role budget breaches (token totals, wall-clock, attempts, fallback).
 *   - Job-level budgets (wall-clock total, replay-cache miss rate, cost).
 *   - Report carries the negative invariants (`secretsIncluded: false`,
 *     `rawPromptsIncluded: false`, `rawScreenshotsIncluded: false`).
 *   - Persisted artifact contains no secrets / prompt text / image bytes.
 *   - Report is byte-stable across two builds with identical input.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ALLOWED_FINOPS_ROLES,
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  FINOPS_BUDGET_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FinOpsBudgetEnvelope,
  type FinOpsCostRateMap,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
  writeFinOpsBudgetReport,
} from "./finops-report.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const JOB_ID = "job-1371";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const successResult = (
  inputTokens: number,
  outputTokens: number,
): LlmGenerationResult => ({
  outcome: "success",
  content: null,
  finishReason: "stop",
  usage: { inputTokens, outputTokens },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "rev-1",
  gatewayRelease: "wave1",
  attempt: 1,
});

const failureResult = (): LlmGenerationResult => ({
  outcome: "error",
  errorClass: "transport",
  message: "boom",
  retryable: true,
  attempt: 1,
});

const permissive: FinOpsBudgetEnvelope = {
  budgetId: "test-permissive",
  budgetVersion: "1.0.0",
  roles: {},
};

const tightBudget: FinOpsBudgetEnvelope = {
  budgetId: "test-tight",
  budgetVersion: "1.0.0",
  maxJobWallClockMs: 1000,
  maxReplayCacheMissRate: 0.5,
  maxEstimatedCost: 0.01,
  roles: {
    test_generation: {
      maxTotalInputTokens: 100,
      maxTotalOutputTokens: 100,
      maxTotalWallClockMs: 500,
      maxAttempts: 1,
    },
    visual_primary: {
      maxTotalWallClockMs: 100,
      maxAttempts: 1,
    },
    visual_fallback: {
      maxFallbackAttempts: 0,
      maxAttempts: 1,
    },
  },
};

// ---------------------------------------------------------------------------
// Recorder semantics
// ---------------------------------------------------------------------------

test("recorder: empty snapshot lists every role with zero counters", () => {
  const recorder = createFinOpsUsageRecorder();
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.length, ALLOWED_FINOPS_ROLES.length);
  for (const usage of snapshot) {
    assert.equal(usage.attempts, 0);
    assert.equal(usage.successes, 0);
    assert.equal(usage.failures, 0);
    assert.equal(usage.inputTokens, 0);
    assert.equal(usage.outputTokens, 0);
    assert.equal(usage.cacheHits, 0);
    assert.equal(usage.cacheMisses, 0);
    assert.equal(usage.fallbackAttempts, 0);
    assert.equal(usage.liveSmokeCalls, 0);
    assert.equal(usage.durationMs, 0);
    assert.equal(usage.imageBytes, 0);
    assert.equal(usage.estimatedCost, 0);
    assert.equal(usage.deployment, "");
  }
});

test("recorder: aggregates success and failure observations per role", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 12,
    result: successResult(100, 50),
  });
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 8,
    result: failureResult(),
  });
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 25,
    imageBytes: 1024,
    liveSmoke: true,
    result: successResult(0, 0),
  });
  const snapshot = recorder.snapshot();
  const tg = snapshot.find((u) => u.role === "test_generation");
  assert.ok(tg);
  if (tg) {
    assert.equal(tg.attempts, 2);
    assert.equal(tg.successes, 1);
    assert.equal(tg.failures, 1);
    assert.equal(tg.inputTokens, 100);
    assert.equal(tg.outputTokens, 50);
    assert.equal(tg.durationMs, 20);
  }
  const vp = snapshot.find((u) => u.role === "visual_primary");
  assert.ok(vp);
  if (vp) {
    assert.equal(vp.attempts, 1);
    assert.equal(vp.imageBytes, 1024);
    assert.equal(vp.liveSmokeCalls, 1);
    assert.equal(vp.deployment, "llama-4-maverick-vision");
  }
});

test("recorder: failed visual sidecar attempts are counted in FinOps totals", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 17,
    result: failureResult(),
  });

  const snapshot = recorder.snapshot();
  const visualPrimary = snapshot.find((u) => u.role === "visual_primary");
  assert.ok(visualPrimary);
  if (visualPrimary) {
    assert.equal(visualPrimary.attempts, 1);
    assert.equal(visualPrimary.failures, 1);
    assert.equal(visualPrimary.successes, 0);
    assert.equal(visualPrimary.deployment, "llama-4-maverick-vision");
  }

  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.outcome, "completed");
  assert.equal(report.totals.attempts, 1);
  assert.equal(report.rawScreenshotsIncluded, false);
});

test("recorder: per-source entries retain circuit-breaker states in call order", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "visual_primary",
    source: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 17,
    circuitBreakerState: "closed",
    result: failureResult(),
  });
  recorder.recordAttempt({
    role: "visual_fallback",
    source: "visual_fallback",
    deployment: "phi-4-multimodal-poc",
    durationMs: 19,
    fallback: true,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.deepEqual(report.bySource.visual_primary.circuitBreakerStates, [
    "closed",
  ]);
  assert.equal(report.bySource.visual_fallback.circuitBreakerStates, undefined);
});

test("recorder: breaker-open skips preserve state without adding source calls", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordCircuitBreakerDecision({
    source: "visual_primary",
    circuitBreakerState: "open",
    deployment: "llama-4-maverick-vision",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.bySource.visual_primary.callCount, 0);
  assert.equal(report.bySource.visual_primary.costMinorUnits, 0);
  assert.deepEqual(report.bySource.visual_primary.circuitBreakerStates, [
    "open",
  ]);
});

test("recorder: rejects unknown roles", () => {
  const recorder = createFinOpsUsageRecorder();
  assert.throws(() => {
    recorder.recordAttempt({
      // @ts-expect-error — testing the runtime guard
      role: "unknown",
      deployment: "x",
      durationMs: 0,
      result: successResult(0, 0),
    });
  }, /unknown role/);
});

test("recorder: rejects unknown cache and budget breach dimensions", () => {
  const recorder = createFinOpsUsageRecorder();
  assert.throws(() => {
    recorder.recordCacheMiss({
      // @ts-expect-error — testing the runtime guard
      role: "unknown",
    });
  }, /unknown role/);
  assert.throws(() => {
    recorder.recordBudgetBreach({
      // @ts-expect-error — testing the runtime guard
      rule: "unknown_rule",
      observed: 1,
      threshold: 0,
      message: "x",
    });
  }, /unknown rule/);
  assert.throws(() => {
    recorder.recordBudgetBreach({
      rule: "max_attempts",
      // @ts-expect-error — testing the runtime guard
      role: "unknown",
      observed: 1,
      threshold: 0,
      message: "x",
    });
  }, /unknown role/);
});

test("recorder: explicit budget breaches are copied into the report", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordBudgetBreach({
    rule: "max_input_tokens",
    role: "test_generation",
    observed: 200,
    threshold: 100,
    message: "estimated input tokens 200 exceeds maxInputTokens 100",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.outcome, "budget_exceeded");
  assert.deepEqual(report.breaches, [
    {
      rule: "max_input_tokens",
      role: "test_generation",
      observed: 200,
      threshold: 100,
      message: "estimated input tokens 200 exceeds maxInputTokens 100",
    },
  ]);
});

test("recorder: cache hits do NOT increment any token or attempt counter", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordCacheHit({
    role: "test_generation",
    deployment: "gpt-oss-120b",
  });
  recorder.recordCacheHit({ role: "test_generation" });
  const snapshot = recorder.snapshot();
  const tg = snapshot.find((u) => u.role === "test_generation");
  assert.ok(tg);
  if (tg) {
    assert.equal(tg.cacheHits, 2);
    assert.equal(tg.attempts, 0);
    assert.equal(tg.inputTokens, 0);
    assert.equal(tg.outputTokens, 0);
    assert.equal(tg.successes, 0);
    assert.equal(tg.failures, 0);
    assert.equal(tg.durationMs, 0);
    assert.equal(tg.deployment, "gpt-oss-120b");
  }
});

// ---------------------------------------------------------------------------
// Cost calculation
// ---------------------------------------------------------------------------

test("recorder: estimatedCost combines token rates + per-attempt fixed cost", () => {
  const costRates: FinOpsCostRateMap = {
    currencyLabel: "USD",
    rates: {
      test_generation: {
        inputTokenCostPer1k: 0.5,
        outputTokenCostPer1k: 1,
        fixedCostPerAttempt: 0.01,
      },
    },
  };
  const recorder = createFinOpsUsageRecorder(costRates);
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(2000, 1000),
  });
  const snapshot = recorder.snapshot();
  const tg = snapshot.find((u) => u.role === "test_generation");
  assert.ok(tg);
  if (tg) {
    // 2000/1000*0.5 + 1000/1000*1 + 1*0.01 = 1 + 1 + 0.01 = 2.01
    assert.equal(tg.estimatedCost, 2.01);
  }
});

test("buildFinOpsBudgetReport: bySource.judge_primary records the judge deployment, not the generator deployment, when they differ (Issue #1932)", () => {
  const recorder = createFinOpsUsageRecorder();
  // Generator attempt — same role bucket, different agent source.
  recorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    deployment: "mistral-large-3",
    durationMs: 5,
    result: successResult(100, 50),
  });
  // Judge attempt — same role bucket, but different deployment (cross-model).
  recorder.recordAttempt({
    role: "test_generation",
    source: "judge_primary",
    deployment: "gpt-oss-120b",
    durationMs: 7,
    result: successResult(40, 20),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.bySource.generator.deployment, "mistral-large-3");
  assert.equal(report.bySource.judge_primary.deployment, "gpt-oss-120b");
  assert.notEqual(
    report.bySource.judge_primary.deployment,
    report.bySource.generator.deployment,
    "cross-model attribution requires distinct judge deployment label",
  );
});

test("buildFinOpsBudgetReport: bySource entries omit deployment when no source label was supplied (Issue #1932 — backwards compat)", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 5,
    result: successResult(100, 50),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  // No source on the attempt → no per-source accumulation, deployment field
  // is absent from the canonical-JSON wire payload (preserves the legacy hash).
  assert.equal(report.bySource.generator.deployment, undefined);
  assert.equal(report.bySource.judge_primary.deployment, undefined);
});

test("buildFinOpsBudgetReport: includes deterministic bySource attribution", () => {
  const costRates: FinOpsCostRateMap = {
    currencyLabel: "USD",
    rates: {
      test_generation: {
        inputTokenCostPer1k: 0.5,
        outputTokenCostPer1k: 1,
        fixedCostPerAttempt: 0.01,
      },
    },
  };
  const recorder = createFinOpsUsageRecorder(costRates);
  recorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(2000, 1000),
  });
  recorder.recordCacheHit({
    role: "test_generation",
    source: "generator",
  });
  recorder.recordInFlightDedupHit("generator");

  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
    costRates,
  });

  assert.equal(report.bySourceSealedAt, GENERATED_AT);
  assert.equal(report.bySource.generator.costMinorUnits, 201);
  assert.equal(report.bySource.generator.tokensIn, 2000);
  assert.equal(report.bySource.generator.tokensOut, 1000);
  assert.equal(report.bySource.generator.callCount, 1);
  assert.equal(report.bySource.generator.inFlightDedupHits, 1);
  assert.equal(report.bySource.generator.idempotentReplayHits, 1);
  assert.equal(report.bySource.manager.callCount, 0);
  assert.deepEqual(report.bySourceTotal, {
    costMinorUnits: 201,
    callCount: 1,
  });
});

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

test("buildFinOpsBudgetReport: stamps schema/contract versions and negative invariants", () => {
  const recorder = createFinOpsUsageRecorder();
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.schemaVersion, FINOPS_BUDGET_REPORT_SCHEMA_VERSION);
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.secretsIncluded, false);
  assert.equal(report.rawPromptsIncluded, false);
  assert.equal(report.rawScreenshotsIncluded, false);
  assert.equal(report.outcome, "completed");
});

test("buildFinOpsBudgetReport: outcome=completed_cache_hit when only cache hits, no attempts", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordCacheHit({ role: "test_generation" });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.outcome, "completed_cache_hit");
  assert.equal(report.totals.attempts, 0);
  assert.equal(report.totals.inputTokens, 0);
  assert.equal(report.totals.outputTokens, 0);
});

test("buildFinOpsBudgetReport: detects per-role token budget breach", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(500, 200),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: tightBudget,
    recorder,
  });
  assert.equal(report.outcome, "budget_exceeded");
  const ruleCodes = report.breaches.map((b) => b.rule);
  assert.ok(ruleCodes.includes("max_total_input_tokens"));
  assert.ok(ruleCodes.includes("max_total_output_tokens"));
});

test("buildFinOpsBudgetReport: detects job-level wall-clock breach", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 600,
    result: successResult(0, 0),
  });
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 700,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: tightBudget,
    recorder,
  });
  assert.ok(report.breaches.some((b) => b.rule === "max_total_wall_clock_ms"));
});

test("buildFinOpsBudgetReport: detects replay-cache miss-rate breach", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordCacheMiss({ role: "test_generation" });
  recorder.recordCacheMiss({ role: "test_generation" });
  recorder.recordCacheHit({ role: "test_generation" });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: tightBudget,
    recorder,
  });
  // 2 miss / 3 lookups = 0.6667 > 0.5
  assert.ok(
    report.breaches.some((b) => b.rule === "max_replay_cache_miss_rate"),
  );
});

test("buildFinOpsBudgetReport: detects fallback-attempt breach on visual_fallback", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "visual_fallback",
    deployment: "phi-4-multimodal-poc",
    durationMs: 100,
    fallback: true,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: tightBudget,
    recorder,
  });
  assert.ok(
    report.breaches.some(
      (b) => b.rule === "max_fallback_attempts" && b.role === "visual_fallback",
    ),
  );
});

test("buildFinOpsBudgetReport: detects estimated-cost cap breach", () => {
  const costRates: FinOpsCostRateMap = {
    currencyLabel: "USD",
    rates: {
      test_generation: {
        inputTokenCostPer1k: 1,
        outputTokenCostPer1k: 1,
      },
    },
  };
  const recorder = createFinOpsUsageRecorder(costRates);
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(50_000, 50_000),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: { ...tightBudget, maxEstimatedCost: 1 },
    recorder,
    costRates,
  });
  assert.ok(report.breaches.some((b) => b.rule === "max_estimated_cost"));
  assert.equal(report.currencyLabel, "USD");
});

test("buildFinOpsBudgetReport: detects missing operational rules in deterministic order", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 10,
    imageBytes: 20,
    liveSmoke: true,
    result: successResult(0, 0),
  });
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 10,
    imageBytes: 20,
    liveSmoke: true,
    result: successResult(0, 0),
  });
  recorder.recordAttempt({
    role: "visual_fallback",
    deployment: "phi-4-multimodal-poc",
    durationMs: 10,
    imageBytes: 30,
    result: successResult(0, 0),
  });
  recorder.recordAttempt({
    role: "visual_fallback",
    deployment: "phi-4-multimodal-poc",
    durationMs: 10,
    imageBytes: 30,
    result: successResult(0, 0),
  });

  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: {
      budgetId: "test-operational-order",
      budgetVersion: "1.0.0",
      roles: {
        visual_primary: {
          maxAttempts: 1,
          maxLiveSmokeCalls: 1,
        },
        visual_fallback: {
          maxAttempts: 1,
        },
      },
    },
    recorder,
  });

  assert.deepEqual(
    report.breaches.map((b) => `${b.rule}:${b.role ?? "job"}`),
    [
      "max_attempts:visual_fallback",
      "max_attempts:visual_primary",
      "max_live_smoke_calls:visual_primary",
    ],
  );
  assert.equal(report.outcome, "budget_exceeded");
});

test("buildFinOpsBudgetReport: sorts equal-rule breaches by role and observed value", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordBudgetBreach({
    rule: "max_attempts",
    role: "visual_primary",
    observed: 3,
    threshold: 1,
    message: "visual attempts high",
  });
  recorder.recordBudgetBreach({
    rule: "max_attempts",
    role: "test_generation",
    observed: 4,
    threshold: 1,
    message: "test attempts high",
  });
  recorder.recordBudgetBreach({
    rule: "max_attempts",
    role: "test_generation",
    observed: 2,
    threshold: 1,
    message: "test attempts lower",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.deepEqual(
    report.breaches.map((breach) => [
      breach.rule,
      breach.role,
      breach.observed,
    ]),
    [
      ["max_attempts", "test_generation", 2],
      ["max_attempts", "test_generation", 4],
      ["max_attempts", "visual_primary", 3],
    ],
  );
});

test("buildFinOpsBudgetReport: outcomeOverride takes precedence over auto-derived outcome", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
    outcomeOverride: "policy_blocked",
  });
  assert.equal(report.outcome, "policy_blocked");
});

test("buildFinOpsBudgetReport: outcomeOverride beats live-smoke budget breaches", () => {
  for (const outcome of ["policy_blocked", "validation_blocked"] as const) {
    const recorder = createFinOpsUsageRecorder();
    recorder.recordAttempt({
      role: "test_generation",
      deployment: "gpt-oss-120b",
      durationMs: 10,
      liveSmoke: true,
      result: successResult(0, 0),
    });
    const report = buildFinOpsBudgetReport({
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      budget: {
        budgetId: "test-live-smoke-override",
        budgetVersion: "1.0.0",
        roles: {
          test_generation: {
            maxLiveSmokeCalls: 0,
          },
        },
      },
      recorder,
      outcomeOverride: outcome,
    });
    assert.equal(report.outcome, outcome);
    assert.ok(
      report.breaches.some((breach) => breach.rule === "max_live_smoke_calls"),
    );
  }
});

test("buildFinOpsBudgetReport: byte-stable for identical input", () => {
  const buildOnce = () => {
    const recorder = createFinOpsUsageRecorder();
    recorder.recordAttempt({
      role: "test_generation",
      deployment: "gpt-oss-120b",
      durationMs: 0,
      result: successResult(100, 50),
    });
    recorder.recordCacheHit({ role: "visual_primary" });
    return buildFinOpsBudgetReport({
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      budget: permissive,
      recorder,
    });
  };
  const a = canonicalJson(buildOnce());
  const b = canonicalJson(buildOnce());
  assert.equal(a, b);
});

test("buildFinOpsBudgetReport: roles array is sorted alphabetically", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    durationMs: 10,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  const roleNames = report.roles.map((u) => u.role);
  assert.deepEqual(roleNames, [...roleNames].sort());
});

test("buildFinOpsBudgetReport: throws on empty jobId or generatedAt", () => {
  const recorder = createFinOpsUsageRecorder();
  assert.throws(
    () =>
      buildFinOpsBudgetReport({
        jobId: "",
        generatedAt: GENERATED_AT,
        budget: permissive,
        recorder,
      }),
    /jobId/,
  );
  assert.throws(
    () =>
      buildFinOpsBudgetReport({
        jobId: JOB_ID,
        generatedAt: "",
        budget: permissive,
        recorder,
      }),
    /generatedAt/,
  );
});

// ---------------------------------------------------------------------------
// Persistence: artifact lives under finops/budget-report.json
// ---------------------------------------------------------------------------

test("writeFinOpsBudgetReport: persists under finops/ subdirectory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "finops-report-"));
  try {
    const recorder = createFinOpsUsageRecorder();
    recorder.recordAttempt({
      role: "test_generation",
      deployment: "gpt-oss-120b",
      durationMs: 0,
      result: successResult(10, 20),
    });
    const report = buildFinOpsBudgetReport({
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      budget: {
        ...permissive,
        roles: {
          test_generation: {
            maxTotalWallClockMs: 123_456,
          },
        },
      },
      recorder,
      resolvedBudget: {
        testGenerationWallClock: {
          mode: "elastic",
          role: "test_generation",
          resolvedMs: 123_456,
          formulaMs: 123_456,
          caseCount: 9,
          judgePanelSize: 2,
          adversarialRounds: 2,
          visualSidecarEnabled: true,
          coefficients: {
            baseMs: 90_000,
            perCaseMs: 1_800,
            perAdditionalJudgeMs: 12_000,
            perAdversarialRoundMs: 18_000,
            visualSidecarMs: 15_000,
            hardCeilingMs: 360_000,
          },
          breakdown: {
            baseMs: 90_000,
            caseMs: 16_200,
            additionalJudgeMs: 12_000,
            adversarialRoundMs: 36_000,
            visualSidecarMs: 15_000,
            unclampedMs: 169_200,
            hardCeilingMs: 360_000,
          },
        },
      },
    });
    const written = await writeFinOpsBudgetReport({
      report,
      runDir: dir,
    });
    assert.equal(
      written.artifactPath,
      join(
        dir,
        FINOPS_ARTIFACT_DIRECTORY,
        FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
      ),
    );
    const onDisk = await readFile(written.artifactPath, "utf8");
    const parsed = JSON.parse(onDisk) as Record<string, unknown>;
    assert.equal(parsed["jobId"], JOB_ID);
    assert.equal(
      (
        (
          parsed["budget"] as {
            roles?: { test_generation?: { maxTotalWallClockMs?: number } };
          }
        ).roles?.test_generation?.maxTotalWallClockMs
      ),
      123_456,
    );
    assert.equal(
      (
        (
          parsed["resolvedBudget"] as {
            testGenerationWallClock?: { resolvedMs?: number };
          }
        ).testGenerationWallClock?.resolvedMs
      ),
      123_456,
    );
    assert.equal(parsed["secretsIncluded"], false);
    assert.equal(parsed["rawPromptsIncluded"], false);
    assert.equal(parsed["rawScreenshotsIncluded"], false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFinOpsBudgetReport: artifact never embeds prompt text or image bytes", async () => {
  // Smoke test: assert the on-disk artifact body does not contain
  // any field name that could carry raw prompt or image content.
  const dir = await mkdtemp(join(tmpdir(), "finops-report-redaction-"));
  try {
    const recorder = createFinOpsUsageRecorder();
    recorder.recordAttempt({
      role: "test_generation",
      deployment: "gpt-oss-120b",
      durationMs: 0,
      result: successResult(10, 20),
    });
    const report = buildFinOpsBudgetReport({
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      budget: permissive,
      recorder,
    });
    const written = await writeFinOpsBudgetReport({
      report,
      runDir: dir,
    });
    const onDisk = await readFile(written.artifactPath, "utf8");
    for (const forbidden of [
      "Bearer ",
      "api-key",
      "apikey",
      "systemPrompt",
      "userPrompt",
      "rawTextContent",
      "base64",
    ]) {
      assert.equal(
        onDisk.includes(forbidden),
        false,
        `artifact must not contain "${forbidden}"`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildFinOpsBudgetReport: redacts token-shaped report labels", () => {
  const secret = "Token: abcdefghijklmnop";
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    deployment: `gpt ${secret}`,
    durationMs: 0,
    result: successResult(0, 0),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: {
      budgetId: `budget ${secret}`,
      budgetVersion: "v1",
      roles: {},
    },
    costRates: {
      currencyLabel: `USD ${secret}`,
      rates: {},
    },
    recorder,
  });
  const raw = canonicalJson(report);
  assert.equal(raw.includes("abcdefghijklmnop"), false);
  assert.ok(raw.includes("[REDACTED]"));
});

test("buildFinOpsBudgetReport: cache-hit job exposes zero LLM call usage and outcome=completed_cache_hit", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordCacheHit({
    role: "test_generation",
    deployment: "gpt-oss-120b",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  assert.equal(report.outcome, "completed_cache_hit");
  assert.equal(report.totals.attempts, 0);
  assert.equal(report.totals.inputTokens, 0);
  assert.equal(report.totals.outputTokens, 0);
  assert.equal(report.totals.cacheHits, 1);
  assert.equal(report.totals.cacheMisses, 0);
  assert.equal(report.totals.replayCacheHitRate, 1);
  assert.equal(report.totals.replayCacheMissRate, 0);
  assert.equal(report.totals.promptCacheHitRate, 1);
  assert.equal(report.totals.promptCacheMissRate, 0);
});

// ---------------------------------------------------------------------------
// Issue #2016: attributionMode = "audit" decouples judge / planner traffic
// from the role's primary attempt + token counters.
// ---------------------------------------------------------------------------

test("Issue #2016: attributionMode='audit' attempts do not count toward role-level attempts/tokens", () => {
  const recorder = createFinOpsUsageRecorder();
  // Primary generator attempt — this is the role's actual work.
  recorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(7000, 5000),
  });
  // Audit-mode judge attempts on the same FinOps lane — they share the
  // budget envelope but are not part of the role's primary work and so
  // must not bump role-level counters.
  recorder.recordAttempt({
    role: "test_generation",
    source: "judge_primary",
    deployment: "gpt-oss-120b",
    durationMs: 5,
    result: successResult(2000, 800),
    attributionMode: "audit",
  });
  recorder.recordAttempt({
    role: "test_generation",
    source: "coverage_planner",
    deployment: "gpt-oss-120b",
    durationMs: 6,
    result: successResult(900, 400),
    attributionMode: "audit",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  const tg = report.roles.find((r) => r.role === "test_generation");
  assert.ok(tg !== undefined);
  // Role-level: only the primary attempt counts.
  assert.equal(tg.attempts, 1);
  assert.equal(tg.successes, 1);
  assert.equal(tg.inputTokens, 7000);
  assert.equal(tg.outputTokens, 5000);
  assert.equal(tg.durationMs, 10);
  // Per-source still records every observation independently.
  assert.equal(report.bySource.generator.callCount, 1);
  assert.equal(report.bySource.judge_primary.callCount, 1);
  assert.equal(report.bySource.coverage_planner.callCount, 1);
  assert.equal(report.bySource.judge_primary.tokensOut, 800);
  assert.equal(report.bySource.coverage_planner.tokensOut, 400);
});

test("Issue #2016: attributionMode='audit' alone produces no role-level attempts even with success result", () => {
  const recorder = createFinOpsUsageRecorder();
  recorder.recordAttempt({
    role: "test_generation",
    source: "judge_primary",
    deployment: "gpt-oss-120b",
    durationMs: 5,
    result: successResult(1000, 400),
    attributionMode: "audit",
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  const tg = report.roles.find((r) => r.role === "test_generation");
  assert.ok(tg !== undefined);
  assert.equal(tg.attempts, 0);
  assert.equal(tg.successes, 0);
  assert.equal(tg.inputTokens, 0);
  assert.equal(tg.outputTokens, 0);
  // The deployment label still propagates so reports surface the active
  // judge model even when no primary work happened.
  assert.equal(tg.deployment, "gpt-oss-120b");
  assert.equal(report.bySource.judge_primary.callCount, 1);
});

test("Issue #2016: attributionMode='audit' does not inflate max_attempts / max_total_output_tokens breaches", () => {
  const recorder = createFinOpsUsageRecorder();
  // 1 primary generator attempt at 5000 tokens, then 5 audit judge
  // attempts at 1000 tokens each. With the old (count-everything)
  // semantics the role would show 6 attempts and 10000 tokens, which
  // would breach a 3-attempt / 8000-token cap. With audit mode the
  // role shows 1 attempt and 5000 tokens — within budget.
  recorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(8000, 5000),
  });
  for (let i = 0; i < 5; i += 1) {
    recorder.recordAttempt({
      role: "test_generation",
      source: "judge_primary",
      deployment: "gpt-oss-120b",
      durationMs: 5,
      result: successResult(2000, 1000),
      attributionMode: "audit",
    });
  }
  const budget: FinOpsBudgetEnvelope = {
    budgetId: "tight",
    budgetVersion: "v1",
    roles: {
      test_generation: {
        maxAttempts: 3,
        maxTotalInputTokens: 80_000,
        maxTotalOutputTokens: 8_000,
      },
    },
  };
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget,
    recorder,
  });
  assert.deepEqual(report.breaches, [], JSON.stringify(report.breaches));
});

test("Issue #2016: attributionMode default of 'primary' preserves legacy accounting (backwards compat)", () => {
  const recorder = createFinOpsUsageRecorder();
  // No `attributionMode` field — must behave exactly as before Issue
  // #2016, i.e. judge calls under role test_generation count toward
  // the role-level attempts and token counters.
  recorder.recordAttempt({
    role: "test_generation",
    source: "generator",
    deployment: "gpt-oss-120b",
    durationMs: 10,
    result: successResult(100, 50),
  });
  recorder.recordAttempt({
    role: "test_generation",
    source: "judge_primary",
    deployment: "gpt-oss-120b",
    durationMs: 5,
    result: successResult(40, 20),
  });
  const report = buildFinOpsBudgetReport({
    jobId: JOB_ID,
    generatedAt: GENERATED_AT,
    budget: permissive,
    recorder,
  });
  const tg = report.roles.find((r) => r.role === "test_generation");
  assert.ok(tg !== undefined);
  assert.equal(tg.attempts, 2);
  assert.equal(tg.inputTokens, 140);
  assert.equal(tg.outputTokens, 70);
});
