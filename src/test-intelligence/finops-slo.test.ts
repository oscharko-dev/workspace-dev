import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FinOpsBudgetReport } from "../contracts/index.js";
import {
  appendFinOpsTimeSeriesRecord,
  appendFinOpsTimeSeriesRecordOnDisk,
  buildFinOpsTimeSeriesRecord,
  createFinOpsSloFileAlertSink,
  defaultFinOpsTimeSeriesStorePath,
  evaluateFinOpsSlo,
  FINOPS_SLO_REPORT_ARTIFACT_FILENAME,
  FINOPS_TIME_SERIES_STORE_FILENAME,
  loadFinOpsTimeSeriesStore,
  publishFinOpsSloAlerts,
  writeFinOpsSloReport,
  writeFinOpsTimeSeriesStore,
  resolveFinOpsFixtureId,
} from "./finops-slo.js";

const GENERATED_AT = "2026-05-10T12:00:00.000Z";

const baseReport = (): FinOpsBudgetReport => ({
  schemaVersion: "1.0.0",
  contractVersion: "1.39.0",
  jobId: "job-1",
  generatedAt: GENERATED_AT,
  budget: {
    budgetId: "production-default",
    budgetVersion: "1.0.0",
    roles: {},
  },
  roles: [],
  bySource: {
    generator: {
      costMinorUnits: 0,
      tokensIn: 8000,
      tokensOut: 2000,
      callCount: 1,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    },
    judge_primary: {
      costMinorUnits: 0,
      tokensIn: 2000,
      tokensOut: 1000,
      callCount: 1,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    },
    judge_secondary: {
      costMinorUnits: 0,
      tokensIn: 1000,
      tokensOut: 500,
      callCount: 1,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    },
    visual_primary: {
      costMinorUnits: 0,
      tokensIn: 600,
      tokensOut: 200,
      callCount: 1,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    },
    visual_fallback: {
      costMinorUnits: 0,
      tokensIn: 0,
      tokensOut: 0,
      callCount: 0,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    },
  },
  bySourceTotal: {
    costMinorUnits: 0,
    callCount: 4,
  },
  bySourceSealedAt: GENERATED_AT,
  totals: {
    inputTokens: 11600,
    outputTokens: 3700,
    attempts: 4,
    successes: 4,
    failures: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fallbackAttempts: 0,
    liveSmokeCalls: 0,
    durationMs: 920,
    imageBytes: 0,
    estimatedCost: 0.12,
    replayCacheHitRate: 0,
    replayCacheMissRate: 0,
    promptCacheHitRate: 0,
    promptCacheMissRate: 0,
  },
  breaches: [],
  outcome: "completed",
  secretsIncluded: false,
  rawPromptsIncluded: false,
  rawScreenshotsIncluded: false,
});

test("buildFinOpsTimeSeriesRecord groups generator, judge, and visual tokens", () => {
  const record = buildFinOpsTimeSeriesRecord({
    report: baseReport(),
    fixtureId: "baseline-simple-form",
  });
  assert.equal(record.roles.generator.tokens, 10000);
  assert.equal(record.roles.judge.tokens, 4500);
  assert.equal(record.roles.visual_sidecar.tokens, 800);
  assert.equal(record.fixtureId, "baseline-simple-form");
});

test("resolveFinOpsFixtureId namespaces runner file keys for latency tracking", () => {
  assert.equal(resolveFinOpsFixtureId({ fileKey: "ABC" }), "figma:ABC");
});

test("appendFinOpsTimeSeriesRecord deduplicates by jobId and retains only recent records", () => {
  const older = {
    ...buildFinOpsTimeSeriesRecord({ report: baseReport() }),
    jobId: "job-old",
    generatedAt: "2026-04-01T12:00:00.000Z",
  };
  const current = {
    ...buildFinOpsTimeSeriesRecord({ report: baseReport() }),
    jobId: "job-current",
  };
  const updated = appendFinOpsTimeSeriesRecord({
    store: {
      schemaVersion: "1.0.0",
      records: [older],
    },
    record: current,
    retentionDays: 30,
  });
  assert.deepEqual(updated.records.map((record) => record.jobId), [
    "job-current",
  ]);
});

test("evaluateFinOpsSlo passes for in-budget token and latency history", () => {
  const store = {
    schemaVersion: "1.0.0" as const,
    records: [
      {
        ...buildFinOpsTimeSeriesRecord({ report: baseReport() }),
        fixtureId: "baseline-simple-form",
      },
      {
        ...buildFinOpsTimeSeriesRecord({
          report: {
            ...baseReport(),
            jobId: "job-2",
            generatedAt: "2026-05-09T12:00:00.000Z",
            totals: {
              ...baseReport().totals,
              durationMs: 980,
            },
          },
        }),
        fixtureId: "baseline-simple-form",
      },
    ],
  };
  const report = evaluateFinOpsSlo({
    generatedAt: GENERATED_AT,
    policy: {
      rollingWindowDays: 7,
      latencyBudgetOverageFraction: 0.15,
      tokenBudgets: {
        generator: 12000,
        judge: 6000,
        visual_sidecar: 1000,
      },
      latencyBudgetsMs: {
        default: 1000,
      },
      minimumRoutingSavingsRatio: 0.5,
    },
    store,
    routingSavingsRatio: 0.61,
  });
  assert.equal(report.passed, true);
  assert.equal(report.violations.length, 0);
  assert.equal(report.latencyTrends[0]?.fixtureId, "baseline-simple-form");
});

test("evaluateFinOpsSlo fails when role tokens, fixture latency, and savings regress", () => {
  const store = {
    schemaVersion: "1.0.0" as const,
    records: [
      {
        ...buildFinOpsTimeSeriesRecord({
          report: {
            ...baseReport(),
            totals: {
              ...baseReport().totals,
              durationMs: 1400,
            },
          },
        }),
        fixtureId: "baseline-simple-form",
      },
    ],
  };
  const report = evaluateFinOpsSlo({
    generatedAt: GENERATED_AT,
    policy: {
      rollingWindowDays: 7,
      latencyBudgetOverageFraction: 0.15,
      tokenBudgets: {
        generator: 9000,
        judge: 4000,
        visual_sidecar: 700,
      },
      latencyBudgetsMs: {
        default: 1000,
      },
      minimumRoutingSavingsRatio: 0.5,
    },
    store,
    routingSavingsRatio: 0.41,
  });
  assert.equal(report.passed, false);
  assert.deepEqual(
    new Set(report.violations.map((violation) => violation.kind)),
    new Set([
      "role_token_budget",
      "fixture_latency_p95",
      "routing_cost_target",
    ]),
  );
});

test("time-series store and SLO report persist canonically and alerts reuse the drift sink", async () => {
  const root = await mkdtemp(join(tmpdir(), "finops-slo-"));
  try {
    const storePath = defaultFinOpsTimeSeriesStorePath(root);
    const store = appendFinOpsTimeSeriesRecord({
      store: { schemaVersion: "1.0.0", records: [] },
      record: {
        ...buildFinOpsTimeSeriesRecord({ report: baseReport() }),
        fixtureId: "baseline-simple-form",
      },
    });
    await writeFinOpsTimeSeriesStore({ store, storePath });
    const loaded = await loadFinOpsTimeSeriesStore(storePath);
    assert.equal(loaded.records.length, 1);
    assert.equal(storePath.endsWith(FINOPS_TIME_SERIES_STORE_FILENAME), true);

    const report = evaluateFinOpsSlo({
      generatedAt: GENERATED_AT,
      policy: {
        rollingWindowDays: 7,
        latencyBudgetOverageFraction: 0.15,
        tokenBudgets: {
          generator: 9000,
          judge: 4000,
          visual_sidecar: 700,
        },
        latencyBudgetsMs: {
          default: 1000,
        },
        minimumRoutingSavingsRatio: 0.5,
      },
      store: loaded,
      routingSavingsRatio: 0.41,
    });
    const outputDir = join(root, "artifacts", "finops");
    const reportPath = await writeFinOpsSloReport({ report, outputDir });
    assert.equal(reportPath.endsWith(FINOPS_SLO_REPORT_ARTIFACT_FILENAME), true);
    const sink = createFinOpsSloFileAlertSink(outputDir);
    const alertPath = await publishFinOpsSloAlerts({ report, sink });
    assert.ok(alertPath);
    const onDisk = await readFile(reportPath, "utf8");
    assert.match(onDisk, /"violations":/u);
    const alerts = await readFile(alertPath ?? "", "utf8");
    assert.match(alerts, /"alerts":/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("appendFinOpsTimeSeriesRecordOnDisk preserves concurrent writers", async () => {
  const root = await mkdtemp(join(tmpdir(), "finops-slo-concurrency-"));
  try {
    const storePath = defaultFinOpsTimeSeriesStorePath(root);
    const firstReport = baseReport();
    const secondReport = {
      ...baseReport(),
      jobId: "job-2",
      generatedAt: "2026-05-10T12:00:01.000Z",
    };
    await Promise.all([
      appendFinOpsTimeSeriesRecordOnDisk({
        storePath,
        record: buildFinOpsTimeSeriesRecord({
          report: firstReport,
          fixtureId: "baseline-simple-form",
        }),
      }),
      appendFinOpsTimeSeriesRecordOnDisk({
        storePath,
        record: buildFinOpsTimeSeriesRecord({
          report: secondReport,
          fixtureId: "baseline-calculation",
        }),
      }),
    ]);
    const loaded = await loadFinOpsTimeSeriesStore(storePath);
    assert.deepEqual(
      loaded.records.map((record) => record.jobId).sort(),
      ["job-1", "job-2"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
