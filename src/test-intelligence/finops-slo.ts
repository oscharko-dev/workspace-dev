/**
 * FinOps SLO history, dashboard, and CI gate helpers (Issue #2121).
 *
 * This module layers a lightweight historical store above the existing
 * per-job `finops/budget-report.json` artifact:
 *
 *   1. Extract a compact per-job time-series record from a FinOps report.
 *   2. Persist the record into a deterministic store under `<outputRoot>/finops/`.
 *   3. Evaluate a rolling-window SLO report for CI and operator dashboards.
 *   4. Reuse the existing `DriftAlertSink` interface for alert fan-out.
 *
 * The history store intentionally carries only compact metrics and never
 * raw prompts, screenshots, or secret material.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalJson } from "./content-hash.js";
import {
  FINOPS_ARTIFACT_DIRECTORY,
  type FinOpsBudgetReport,
} from "../contracts/index.js";
import {
  createFileDriftAlertSink,
  type DriftAlertSink,
  type DriftFinding,
} from "./drift-canary.js";

export const FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION = "1.0.0" as const;
export const FINOPS_TIME_SERIES_STORE_FILENAME =
  "time-series-store.json" as const;
export const FINOPS_SLO_REPORT_SCHEMA_VERSION = "1.0.0" as const;
export const FINOPS_SLO_REPORT_ARTIFACT_FILENAME =
  "finops-slo-report.json" as const;
export const FINOPS_SLO_ALERT_SET_ID = "finops-slo-v1" as const;
export const FINOPS_SLO_DEFAULT_HISTORY_RETENTION_DAYS = 30 as const;

export const FINOPS_SLO_ROLES = [
  "generator",
  "judge",
  "visual_sidecar",
] as const;

export type FinOpsSloRole = (typeof FINOPS_SLO_ROLES)[number];

export interface FinOpsTimeSeriesRoleSnapshot {
  readonly tokens: number;
}

export interface FinOpsTimeSeriesRecord {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly outcome: FinOpsBudgetReport["outcome"];
  readonly fixtureId?: string;
  readonly totals: {
    readonly durationMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCost: number;
  };
  readonly roles: Readonly<Record<FinOpsSloRole, FinOpsTimeSeriesRoleSnapshot>>;
}

export interface FinOpsTimeSeriesStore {
  readonly schemaVersion: typeof FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION;
  readonly records: readonly FinOpsTimeSeriesRecord[];
}

export interface FinOpsSloPolicy {
  readonly rollingWindowDays: number;
  readonly historyRetentionDays?: number;
  readonly latencyBudgetOverageFraction: number;
  readonly tokenBudgets: Readonly<Record<FinOpsSloRole, number>>;
  readonly latencyBudgetsMs: {
    readonly default: number;
    readonly byFixture?: Readonly<Record<string, number>>;
  };
  readonly minimumRoutingSavingsRatio?: number;
}

export interface FinOpsSloRoleBudgetResult {
  readonly role: FinOpsSloRole;
  readonly budgetTokens: number;
  readonly sampleCount: number;
  readonly latestTokens: number;
  readonly rollingP95Tokens: number;
  readonly passed: boolean;
}

export interface FinOpsSloLatencyTrend {
  readonly fixtureId: string;
  readonly budgetMs: number;
  readonly sampleCount: number;
  readonly latestLatencyMs: number;
  readonly rollingP50LatencyMs: number;
  readonly rollingP95LatencyMs: number;
  readonly overBudgetFraction: number;
  readonly passed: boolean;
}

export type FinOpsSloViolationKind =
  | "role_token_budget"
  | "fixture_latency_p95"
  | "routing_cost_target";

export interface FinOpsSloViolation {
  readonly kind: FinOpsSloViolationKind;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly role?: FinOpsSloRole;
  readonly fixtureId?: string;
  readonly observed: number;
  readonly threshold: number;
}

export interface FinOpsSloReport {
  readonly schemaVersion: typeof FINOPS_SLO_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly rollingWindowDays: number;
  readonly recordsConsidered: number;
  readonly roleBudgets: readonly FinOpsSloRoleBudgetResult[];
  readonly latencyTrends: readonly FinOpsSloLatencyTrend[];
  readonly costDashboard?: {
    readonly observedSavingsRatio: number;
    readonly minimumSavingsRatio: number;
    readonly passed: boolean;
  };
  readonly violations: readonly FinOpsSloViolation[];
  readonly passed: boolean;
}

export interface FinOpsSloEvalInput {
  readonly generatedAt: string;
  readonly policy: FinOpsSloPolicy;
  readonly store: FinOpsTimeSeriesStore;
  readonly routingSavingsRatio?: number;
}

const round6 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

const positiveOrZero = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return value;
};

const safeIntPositiveOrZero = (value: number | undefined): number =>
  Math.floor(positiveOrZero(value));

const quantile = (values: readonly number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const clamped = Math.min(1, Math.max(0, ratio));
  const index = Math.max(0, Math.ceil(sorted.length * clamped) - 1);
  return sorted[index] ?? 0;
};

const sourceTokens = (
  report: FinOpsBudgetReport,
  sources: readonly string[],
): number => {
  let total = 0;
  for (const source of sources) {
    const entry = report.bySource[source as keyof typeof report.bySource];
    if (entry === undefined) continue;
    total += safeIntPositiveOrZero(entry.tokensIn);
    total += safeIntPositiveOrZero(entry.tokensOut);
  }
  return total;
};

const parseIsoMillis = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid ISO timestamp: ${value}`);
  }
  return parsed;
};

const emptyStore = (): FinOpsTimeSeriesStore => ({
  schemaVersion: FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION,
  records: [],
});

export const buildFinOpsTimeSeriesRecord = (input: {
  report: FinOpsBudgetReport;
  fixtureId?: string;
}): FinOpsTimeSeriesRecord => ({
  jobId: input.report.jobId,
  generatedAt: input.report.generatedAt,
  outcome: input.report.outcome,
  ...(input.fixtureId !== undefined ? { fixtureId: input.fixtureId } : {}),
  totals: {
    durationMs: safeIntPositiveOrZero(input.report.totals.durationMs),
    inputTokens: safeIntPositiveOrZero(input.report.totals.inputTokens),
    outputTokens: safeIntPositiveOrZero(input.report.totals.outputTokens),
    estimatedCost: round6(input.report.totals.estimatedCost),
  },
  roles: Object.freeze({
    generator: Object.freeze({
      tokens: sourceTokens(input.report, ["generator"]),
    }),
    judge: Object.freeze({
      tokens: sourceTokens(input.report, ["judge_primary", "judge_secondary"]),
    }),
    visual_sidecar: Object.freeze({
      tokens: sourceTokens(input.report, ["visual_primary", "visual_fallback"]),
    }),
  }),
});

export const appendFinOpsTimeSeriesRecord = (input: {
  store: FinOpsTimeSeriesStore;
  record: FinOpsTimeSeriesRecord;
  retentionDays?: number;
}): FinOpsTimeSeriesStore => {
  const retentionDays = Math.max(
    1,
    safeIntPositiveOrZero(
      input.retentionDays ?? FINOPS_SLO_DEFAULT_HISTORY_RETENTION_DAYS,
    ),
  );
  const horizonMs = retentionDays * 24 * 60 * 60 * 1000;
  const newestTimestamp = parseIsoMillis(input.record.generatedAt);
  const cutoff = newestTimestamp - horizonMs;
  const byJobId = new Map<string, FinOpsTimeSeriesRecord>();
  for (const record of input.store.records) {
    if (parseIsoMillis(record.generatedAt) < cutoff) continue;
    byJobId.set(record.jobId, record);
  }
  byJobId.set(input.record.jobId, input.record);
  const records = [...byJobId.values()].sort((left, right) => {
    const tsDelta = parseIsoMillis(left.generatedAt) - parseIsoMillis(right.generatedAt);
    if (tsDelta !== 0) return tsDelta;
    return left.jobId.localeCompare(right.jobId);
  });
  return {
    schemaVersion: FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION,
    records,
  };
};

export const loadFinOpsTimeSeriesStore = async (
  storePath: string,
): Promise<FinOpsTimeSeriesStore> => {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FinOpsTimeSeriesStore>;
    if (parsed.schemaVersion !== FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION) {
      throw new Error(
        `finops-slo: store at ${storePath} has schemaVersion ${String(parsed.schemaVersion)}`,
      );
    }
    if (!Array.isArray(parsed.records)) {
      throw new Error(`finops-slo: store at ${storePath} has invalid records`);
    }
    return {
      schemaVersion: FINOPS_TIME_SERIES_STORE_SCHEMA_VERSION,
      records: parsed.records as readonly FinOpsTimeSeriesRecord[],
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return emptyStore();
    }
    throw error;
  }
};

export const writeFinOpsTimeSeriesStore = async (input: {
  store: FinOpsTimeSeriesStore;
  storePath: string;
}): Promise<string> => {
  const serialized = `${canonicalJson(input.store)}\n`;
  await mkdir(dirname(input.storePath), { recursive: true });
  const tmpPath = `${input.storePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, input.storePath);
  return input.storePath;
};

export const defaultFinOpsTimeSeriesStorePath = (outputRoot: string): string =>
  join(outputRoot, FINOPS_ARTIFACT_DIRECTORY, FINOPS_TIME_SERIES_STORE_FILENAME);

const recordsWithinRollingWindow = (
  records: readonly FinOpsTimeSeriesRecord[],
  generatedAt: string,
  rollingWindowDays: number,
): readonly FinOpsTimeSeriesRecord[] => {
  const windowDays = Math.max(1, safeIntPositiveOrZero(rollingWindowDays));
  const cutoff = parseIsoMillis(generatedAt) - windowDays * 24 * 60 * 60 * 1000;
  return records.filter((record) => parseIsoMillis(record.generatedAt) >= cutoff);
};

export const evaluateFinOpsSlo = (input: FinOpsSloEvalInput): FinOpsSloReport => {
  const rollingRecords = recordsWithinRollingWindow(
    input.store.records,
    input.generatedAt,
    input.policy.rollingWindowDays,
  );
  const violations: FinOpsSloViolation[] = [];

  const roleBudgets = FINOPS_SLO_ROLES.map((role) => {
    const samples = rollingRecords.map((record) => record.roles[role].tokens);
    const rollingP95Tokens = quantile(samples, 0.95);
    const latestTokens =
      rollingRecords.length === 0
        ? 0
        : rollingRecords[rollingRecords.length - 1]?.roles[role].tokens ?? 0;
    const budgetTokens = safeIntPositiveOrZero(input.policy.tokenBudgets[role]);
    const passed = rollingP95Tokens <= budgetTokens;
    if (!passed) {
      violations.push({
        kind: "role_token_budget",
        severity: "error",
        role,
        observed: rollingP95Tokens,
        threshold: budgetTokens,
        message: `rolling p95 tokens for ${role} (${rollingP95Tokens}) exceed budget ${budgetTokens}`,
      });
    }
    return {
      role,
      budgetTokens,
      sampleCount: samples.length,
      latestTokens,
      rollingP95Tokens,
      passed,
    } satisfies FinOpsSloRoleBudgetResult;
  });

  const latencyByFixture = new Map<string, number[]>();
  for (const record of rollingRecords) {
    if (record.fixtureId === undefined) continue;
    const bucket = latencyByFixture.get(record.fixtureId) ?? [];
    bucket.push(record.totals.durationMs);
    latencyByFixture.set(record.fixtureId, bucket);
  }
  const latencyTrends = [...latencyByFixture.entries()]
    .map(([fixtureId, samples]) => {
      const budgetMs =
        safeIntPositiveOrZero(
          input.policy.latencyBudgetsMs.byFixture?.[fixtureId],
        ) || safeIntPositiveOrZero(input.policy.latencyBudgetsMs.default);
      const rollingP50LatencyMs = quantile(samples, 0.5);
      const rollingP95LatencyMs = quantile(samples, 0.95);
      const latestLatencyMs = samples[samples.length - 1] ?? 0;
      const threshold = Math.round(
        budgetMs * (1 + positiveOrZero(input.policy.latencyBudgetOverageFraction)),
      );
      const overBudgetFraction =
        budgetMs === 0 ? 0 : round6((rollingP95LatencyMs - budgetMs) / budgetMs);
      const passed = rollingP95LatencyMs < threshold;
      if (!passed) {
        violations.push({
          kind: "fixture_latency_p95",
          severity: "error",
          fixtureId,
          observed: rollingP95LatencyMs,
          threshold,
          message: `rolling p95 latency for fixture ${fixtureId} (${rollingP95LatencyMs}ms) exceeds threshold ${threshold}ms`,
        });
      }
      return {
        fixtureId,
        budgetMs,
        sampleCount: samples.length,
        latestLatencyMs,
        rollingP50LatencyMs,
        rollingP95LatencyMs,
        overBudgetFraction,
        passed,
      } satisfies FinOpsSloLatencyTrend;
    })
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));

  const costDashboard =
    input.routingSavingsRatio === undefined ||
    input.policy.minimumRoutingSavingsRatio === undefined
      ? undefined
      : (() => {
          const observedSavingsRatio = round6(input.routingSavingsRatio);
          const minimumSavingsRatio = round6(
            input.policy.minimumRoutingSavingsRatio,
          );
          const passed = observedSavingsRatio >= minimumSavingsRatio;
          if (!passed) {
            violations.push({
              kind: "routing_cost_target",
              severity: "error",
              observed: observedSavingsRatio,
              threshold: minimumSavingsRatio,
              message: `routing savings ${observedSavingsRatio.toFixed(4)} below required minimum ${minimumSavingsRatio.toFixed(4)}`,
            });
          }
          return {
            observedSavingsRatio,
            minimumSavingsRatio,
            passed,
          };
        })();

  const report: FinOpsSloReport = {
    schemaVersion: FINOPS_SLO_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    rollingWindowDays: Math.max(
      1,
      safeIntPositiveOrZero(input.policy.rollingWindowDays),
    ),
    recordsConsidered: rollingRecords.length,
    roleBudgets,
    latencyTrends,
    ...(costDashboard !== undefined ? { costDashboard } : {}),
    violations,
    passed: violations.length === 0,
  };
  return report;
};

export const writeFinOpsSloReport = async (input: {
  report: FinOpsSloReport;
  outputDir: string;
}): Promise<string> => {
  const artifactPath = join(
    input.outputDir,
    FINOPS_SLO_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = `${canonicalJson(input.report)}\n`;
  await mkdir(dirname(artifactPath), { recursive: true });
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return artifactPath;
};

export const createFinOpsSloFileAlertSink = (outputDir: string): DriftAlertSink =>
  createFileDriftAlertSink(outputDir);

const violationToDriftFinding = (
  violation: FinOpsSloViolation,
): DriftFinding => ({
  kind: "metric_shift",
  severity: violation.severity,
  message: violation.message,
  currentValue: violation.observed,
  threshold: violation.threshold,
});

export const publishFinOpsSloAlerts = async (input: {
  report: FinOpsSloReport;
  sink: DriftAlertSink;
}): Promise<string | undefined> => {
  if (input.report.violations.length === 0) return undefined;
  return input.sink.publish({
    schemaVersion: "1.0.0",
    generatedAt: input.report.generatedAt,
    canarySetId: FINOPS_SLO_ALERT_SET_ID,
    alerts: input.report.violations.map(violationToDriftFinding),
  });
};
