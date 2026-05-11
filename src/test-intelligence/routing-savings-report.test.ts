import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME,
  ROUTING_SAVINGS_REPORT_SCHEMA_VERSION,
  assertRoutingSavingsAtLeast,
  buildRoutingSavingsReport,
  writeRoutingSavingsReport,
  type RoutingTierCostRateMap,
} from "./routing-savings-report.js";
import { EU_BANKING_DEFAULT_ROUTING_TABLE } from "./routing-table.js";
import { classifyTaskBatch } from "./task-classifier-agent.js";

const RATES: RoutingTierCostRateMap = {
  currencyLabel: "USD",
  rates: {
    "tier-low": { inputTokenCostPer1k: 0.0001, outputTokenCostPer1k: 0.0005 },
    "tier-mid": { inputTokenCostPer1k: 0.003, outputTokenCostPer1k: 0.015 },
    "tier-high": { inputTokenCostPer1k: 0.015, outputTokenCostPer1k: 0.075 },
  },
};

const sampleDecisions = () =>
  classifyTaskBatch([
    { taskId: "t-1", taskKind: "simple_ui_validation", estimatedInputTokens: 200 },
    { taskId: "t-2", taskKind: "simple_ui_validation", estimatedInputTokens: 300 },
    { taskId: "t-3", taskKind: "standard_business_logic" },
    { taskId: "t-4", taskKind: "regulatory_inference" },
  ]);

const sampleUsages = () => [
  { taskId: "t-1", inputTokens: 1_000, outputTokens: 500, attempts: 1 },
  { taskId: "t-2", inputTokens: 800, outputTokens: 400, attempts: 1 },
  { taskId: "t-3", inputTokens: 5_000, outputTokens: 2_000, attempts: 2 },
  { taskId: "t-4", inputTokens: 6_000, outputTokens: 2_500, attempts: 1 },
];

test("buildRoutingSavingsReport: produces a deterministic, byte-stable report", () => {
  const decisions = sampleDecisions();
  const usages = sampleUsages();
  const a = buildRoutingSavingsReport({
    jobId: "job-1",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages,
  });
  const b = buildRoutingSavingsReport({
    jobId: "job-1",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages,
  });
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(a.schemaVersion, ROUTING_SAVINGS_REPORT_SCHEMA_VERSION);
  assert.equal(a.profile, "eu-banking-default");
  assert.equal(a.environment, "prod");
  assert.equal(a.currencyLabel, "USD");
  assert.equal(a.secretsIncluded, false);
  assert.equal(a.rawPromptsIncluded, false);
});

test("buildRoutingSavingsReport: per-tier breakdown sums match totals", () => {
  const report = buildRoutingSavingsReport({
    jobId: "job-2",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions: sampleDecisions(),
    usages: sampleUsages(),
  });
  const sumDecisions = report.perTier.reduce(
    (acc, t) => acc + t.decisionCount,
    0,
  );
  assert.equal(sumDecisions, report.totals.decisionCount);
  const sumPre = report.perTier.reduce((acc, t) => acc + t.preRoutingCost, 0);
  // Allow tiny floating drift after the round6 step.
  assert.ok(Math.abs(sumPre - report.totals.preRoutingCost) < 1e-5);
});

test("buildRoutingSavingsReport: tier-low tasks save vs tier-high baseline", () => {
  const report = buildRoutingSavingsReport({
    jobId: "job-3",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions: sampleDecisions(),
    usages: sampleUsages(),
  });
  const tierLow = report.perTier.find((t) => t.tier === "tier-low");
  assert.ok(tierLow);
  assert.ok(tierLow!.decisionCount >= 1);
  assert.ok(tierLow!.savingsRatio > 0.9);
});

test("buildRoutingSavingsReport: tier-high tasks save nothing vs baseline", () => {
  const report = buildRoutingSavingsReport({
    jobId: "job-4",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions: sampleDecisions(),
    usages: sampleUsages(),
  });
  const tierHigh = report.perTier.find((t) => t.tier === "tier-high");
  assert.ok(tierHigh);
  if (tierHigh!.decisionCount > 0) {
    assert.equal(tierHigh!.absoluteSavings, 0);
    assert.equal(tierHigh!.savingsRatio, 0);
  }
});

test("buildRoutingSavingsReport: large workload meets >=50% savings target", () => {
  const decisions = classifyTaskBatch(
    Array.from({ length: 100 }, (_, i) => ({
      taskId: `t-${i}`,
      // 80% small UI checks (tier-low), 15% standard business logic
      // (tier-mid), 5% regulatory (tier-high).
      taskKind:
        i < 80
          ? "simple_ui_validation"
          : i < 95
            ? "standard_business_logic"
            : "regulatory_inference",
      estimatedInputTokens: 200,
    })),
  );
  const usages = decisions.map((d) => ({
    taskId: d.taskId,
    inputTokens: 1_000,
    outputTokens: 500,
    attempts: 1,
  }));
  const report = buildRoutingSavingsReport({
    jobId: "job-bulk",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages,
  });
  assert.ok(
    report.totals.savingsRatio >= 0.5,
    `savings ratio ${report.totals.savingsRatio} should be >= 0.5`,
  );
});

test("buildRoutingSavingsReport: throws on missing usage", () => {
  assert.throws(
    () =>
      buildRoutingSavingsReport({
        jobId: "job-bad",
        generatedAt: "2026-05-08T00:00:00Z",
        table: EU_BANKING_DEFAULT_ROUTING_TABLE,
        environment: "prod",
        costRates: RATES,
        decisions: sampleDecisions(),
        usages: [],
      }),
    /no usage observation for task/,
  );
});

test("buildRoutingSavingsReport: rejects empty jobId", () => {
  assert.throws(
    () =>
      buildRoutingSavingsReport({
        jobId: "",
        generatedAt: "2026-05-08T00:00:00Z",
        table: EU_BANKING_DEFAULT_ROUTING_TABLE,
        environment: "prod",
        costRates: RATES,
        decisions: sampleDecisions(),
        usages: sampleUsages(),
      }),
    /jobId must be non-empty/,
  );
});

test("buildRoutingSavingsReport: rejects rates missing a tier", () => {
  const broken: RoutingTierCostRateMap = {
    currencyLabel: "USD",
    rates: {
      "tier-low": { inputTokenCostPer1k: 0.0001, outputTokenCostPer1k: 0.0005 },
      "tier-mid": { inputTokenCostPer1k: 0.003, outputTokenCostPer1k: 0.015 },
    } as unknown as RoutingTierCostRateMap["rates"],
  };
  assert.throws(
    () =>
      buildRoutingSavingsReport({
        jobId: "job-bad",
        generatedAt: "2026-05-08T00:00:00Z",
        table: EU_BANKING_DEFAULT_ROUTING_TABLE,
        environment: "prod",
        costRates: broken,
        decisions: sampleDecisions(),
        usages: sampleUsages(),
      }),
    /missing tier "tier-high"/,
  );
});

test("assertRoutingSavingsAtLeast: passes when savings meet target", () => {
  const decisions = classifyTaskBatch([
    { taskId: "x-1", taskKind: "simple_ui_validation", estimatedInputTokens: 200 },
  ]);
  const report = buildRoutingSavingsReport({
    jobId: "job-assert",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages: [{ taskId: "x-1", inputTokens: 1000, outputTokens: 500 }],
  });
  // Tier-low only — easily >= 50% savings.
  assertRoutingSavingsAtLeast(report, 0.5);
});

test("assertRoutingSavingsAtLeast: throws when savings fall short", () => {
  const decisions = classifyTaskBatch([
    { taskId: "y-1", taskKind: "regulatory_inference" },
  ]);
  const report = buildRoutingSavingsReport({
    jobId: "job-assert-fail",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages: [{ taskId: "y-1", inputTokens: 1000, outputTokens: 500 }],
  });
  assert.throws(
    () => assertRoutingSavingsAtLeast(report, 0.5),
    /below required minimum/,
  );
});

test("assertRoutingSavingsAtLeast: rejects out-of-range minimum", () => {
  const decisions = classifyTaskBatch([
    { taskId: "z-1", taskKind: "simple_ui_validation" },
  ]);
  const report = buildRoutingSavingsReport({
    jobId: "job-range",
    generatedAt: "2026-05-08T00:00:00Z",
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    costRates: RATES,
    decisions,
    usages: [{ taskId: "z-1", inputTokens: 100, outputTokens: 100 }],
  });
  assert.throws(
    () => assertRoutingSavingsAtLeast(report, 1.5),
    /minimumSavingsRatio must be in/,
  );
});

test("writeRoutingSavingsReport: persists the artifact atomically with canonical JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "routing-savings-"));
  try {
    const report = buildRoutingSavingsReport({
      jobId: "job-write",
      generatedAt: "2026-05-08T00:00:00Z",
      table: EU_BANKING_DEFAULT_ROUTING_TABLE,
      environment: "prod",
      costRates: RATES,
      decisions: sampleDecisions(),
      usages: sampleUsages(),
    });
    const result = await writeRoutingSavingsReport({ report, runDir: dir });
    assert.equal(result.filename, ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME);
    const persisted = await readFile(result.artifactPath, "utf8");
    assert.equal(persisted, `${canonicalJson(report)}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
