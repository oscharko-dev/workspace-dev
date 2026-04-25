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
  assert.equal(snapshot.length, 3);
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
      budget: permissive,
      recorder,
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
});
