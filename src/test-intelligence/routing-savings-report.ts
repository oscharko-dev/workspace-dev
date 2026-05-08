/**
 * Cost-aware routing savings report (Issue #2043).
 *
 * Builds a deterministic, byte-stable artifact that pairs every
 * {@link TaskClassificationDecision} with the cost the run would have
 * incurred under the **pre-routing baseline** (every task on the
 * `tier-high` flagship binding) versus the cost actually incurred
 * under the routed binding. The report is the audit trail behind the
 * issue's headline goal: ">= 50% reduction in LLM cost without
 * quality regression".
 *
 * Persistence layout follows the rest of `test-intelligence/`:
 *
 *   <runDir>/finops/routing-savings-report.json
 *
 * Atomic write (`tmp` then `rename`). The artifact embeds the
 * classifier version + table profile so an auditor can reproduce the
 * decisions without reading any other file.
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { canonicalJson } from "./content-hash.js";
import { FINOPS_ARTIFACT_DIRECTORY } from "../contracts/index.js";
import {
  TASK_COMPLEXITY_TIERS,
  type TaskClassificationDecision,
  type TaskComplexityTier,
} from "./task-classifier-agent.js";
import type {
  RoutingTable,
  RoutingTableEnvironment,
  RoutingTableProfile,
} from "./routing-table.js";

/** Schema version literal stamped on every persisted savings report. */
export const ROUTING_SAVINGS_REPORT_SCHEMA_VERSION = "1.0.0" as const;

/** Stable artifact filename; lives under `<runDir>/finops/`. */
export const ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME =
  "routing-savings-report.json" as const;

/**
 * Per-tier cost rate used to estimate per-decision spend. The rates
 * mirror the FinOps `FinOpsCostRate` shape (cost-per-1k for input and
 * output tokens, plus an optional fixed per-attempt fee), but live in
 * a separate type because the routing layer cares about
 * tier-granularity, not role-granularity.
 */
export interface RoutingTierCostRate {
  /** Input-token cost per 1k tokens, in `currencyLabel`. Non-negative. */
  readonly inputTokenCostPer1k: number;
  /** Output-token cost per 1k tokens, in `currencyLabel`. Non-negative. */
  readonly outputTokenCostPer1k: number;
  /** Fixed per-attempt cost. Non-negative. Optional; defaults to 0. */
  readonly fixedCostPerAttempt?: number;
}

/**
 * Cost rate map keyed by tier. The baseline (pre-routing) rate is the
 * `tier-high` rate by convention — that mirrors the cost of running
 * every task on the flagship deployment.
 */
export interface RoutingTierCostRateMap {
  readonly currencyLabel: string;
  readonly rates: Readonly<Record<TaskComplexityTier, RoutingTierCostRate>>;
}

/**
 * Per-decision usage observation. The savings calculation uses
 * `inputTokens + outputTokens + attempts` — every other gateway field
 * is intentionally out of scope (the savings report focuses on the
 * pre/post comparison, not on the full FinOps usage block).
 */
export interface RoutingDecisionUsage {
  readonly taskId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Defaults to 1 when omitted. */
  readonly attempts?: number;
}

/** Per-tier rollup carried by the report. */
export interface RoutingSavingsTierBreakdown {
  readonly tier: TaskComplexityTier;
  readonly decisionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly attempts: number;
  readonly preRoutingCost: number;
  readonly postRoutingCost: number;
  readonly absoluteSavings: number;
  /**
   * Savings as a fraction in `[0, 1]`. Returns 0 when the pre-routing
   * cost is 0 (no work done; the savings ratio is meaningless).
   */
  readonly savingsRatio: number;
}

/** Top-level totals. */
export interface RoutingSavingsTotals {
  readonly decisionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly attempts: number;
  readonly preRoutingCost: number;
  readonly postRoutingCost: number;
  readonly absoluteSavings: number;
  readonly savingsRatio: number;
}

/** Persisted report shape. */
export interface RoutingSavingsReport {
  readonly schemaVersion: typeof ROUTING_SAVINGS_REPORT_SCHEMA_VERSION;
  readonly jobId: string;
  readonly generatedAt: string;
  readonly profile: RoutingTableProfile;
  readonly environment: RoutingTableEnvironment;
  readonly currencyLabel: string;
  /** Per-tier rollup, sorted by `tier` ascending (low→mid→high). */
  readonly perTier: readonly RoutingSavingsTierBreakdown[];
  /** Job-wide totals. */
  readonly totals: RoutingSavingsTotals;
  /** Hard invariant: the report never embeds raw prompts or screenshots. */
  readonly secretsIncluded: false;
  readonly rawPromptsIncluded: false;
}

/** Input to {@link buildRoutingSavingsReport}. */
export interface BuildRoutingSavingsReportInput {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly table: RoutingTable;
  readonly environment: RoutingTableEnvironment;
  readonly costRates: RoutingTierCostRateMap;
  readonly decisions: readonly TaskClassificationDecision[];
  readonly usages: readonly RoutingDecisionUsage[];
}

const TIER_RANK: Readonly<Record<TaskComplexityTier, number>> = Object.freeze({
  "tier-low": 0,
  "tier-mid": 1,
  "tier-high": 2,
});

const round6 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

const positiveOrZero = (value: number | undefined): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
};

const safeIntPositiveOrZero = (value: number | undefined): number =>
  Math.floor(positiveOrZero(value));

const decisionCost = (
  rate: RoutingTierCostRate,
  usage: { inputTokens: number; outputTokens: number; attempts: number },
): number => {
  const inputRate = positiveOrZero(rate.inputTokenCostPer1k);
  const outputRate = positiveOrZero(rate.outputTokenCostPer1k);
  const fixed = positiveOrZero(rate.fixedCostPerAttempt);
  return (
    (usage.inputTokens / 1000) * inputRate +
    (usage.outputTokens / 1000) * outputRate +
    usage.attempts * fixed
  );
};

const sortByTier = <T extends { tier: TaskComplexityTier }>(
  items: readonly T[],
): T[] =>
  [...items].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);

/**
 * Build a deterministic routing-savings report. Pure: the same
 * `(decisions, usages, rates)` input always produces a byte-stable
 * artifact. Throws when input is malformed (empty jobId, missing
 * usage for a decision, …) so misconfigurations surface immediately.
 */
export const buildRoutingSavingsReport = (
  input: BuildRoutingSavingsReportInput,
): RoutingSavingsReport => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError("buildRoutingSavingsReport: jobId must be non-empty");
  }
  if (
    typeof input.generatedAt !== "string" ||
    input.generatedAt.length === 0
  ) {
    throw new TypeError(
      "buildRoutingSavingsReport: generatedAt must be non-empty",
    );
  }
  if (
    typeof input.costRates.currencyLabel !== "string" ||
    input.costRates.currencyLabel.length === 0
  ) {
    throw new TypeError(
      "buildRoutingSavingsReport: costRates.currencyLabel must be non-empty",
    );
  }
  const ratesPartial = input.costRates.rates as Partial<
    Record<TaskComplexityTier, RoutingTierCostRate>
  >;
  for (const tier of TASK_COMPLEXITY_TIERS) {
    if (ratesPartial[tier] === undefined) {
      throw new TypeError(
        `buildRoutingSavingsReport: costRates.rates is missing tier "${tier}"`,
      );
    }
  }

  const usageByTaskId = new Map<string, RoutingDecisionUsage>();
  for (const usage of input.usages) {
    usageByTaskId.set(usage.taskId, usage);
  }

  // Baseline = every task on tier-high.
  const baselineRate = input.costRates.rates["tier-high"];

  const perTierAcc: Record<
    TaskComplexityTier,
    {
      decisionCount: number;
      inputTokens: number;
      outputTokens: number;
      attempts: number;
      preRoutingCost: number;
      postRoutingCost: number;
    }
  > = {
    "tier-low": {
      decisionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      attempts: 0,
      preRoutingCost: 0,
      postRoutingCost: 0,
    },
    "tier-mid": {
      decisionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      attempts: 0,
      preRoutingCost: 0,
      postRoutingCost: 0,
    },
    "tier-high": {
      decisionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      attempts: 0,
      preRoutingCost: 0,
      postRoutingCost: 0,
    },
  };

  for (const decision of input.decisions) {
    const usage = usageByTaskId.get(decision.taskId);
    if (usage === undefined) {
      throw new RangeError(
        `buildRoutingSavingsReport: no usage observation for task "${decision.taskId}"`,
      );
    }
    const acc = perTierAcc[decision.tier];
    const inputTokens = safeIntPositiveOrZero(usage.inputTokens);
    const outputTokens = safeIntPositiveOrZero(usage.outputTokens);
    const attempts = Math.max(1, safeIntPositiveOrZero(usage.attempts ?? 1));
    acc.decisionCount += 1;
    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.attempts += attempts;
    const routedRate = input.costRates.rates[decision.tier];
    acc.postRoutingCost += decisionCost(routedRate, {
      inputTokens,
      outputTokens,
      attempts,
    });
    acc.preRoutingCost += decisionCost(baselineRate, {
      inputTokens,
      outputTokens,
      attempts,
    });
  }

  const perTier: RoutingSavingsTierBreakdown[] = [];
  for (const tier of TASK_COMPLEXITY_TIERS) {
    const acc = perTierAcc[tier];
    const absolute = acc.preRoutingCost - acc.postRoutingCost;
    const ratio =
      acc.preRoutingCost === 0
        ? 0
        : Math.max(0, Math.min(1, absolute / acc.preRoutingCost));
    perTier.push({
      tier,
      decisionCount: acc.decisionCount,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      attempts: acc.attempts,
      preRoutingCost: round6(acc.preRoutingCost),
      postRoutingCost: round6(acc.postRoutingCost),
      absoluteSavings: round6(absolute),
      savingsRatio: round6(ratio),
    });
  }

  const totals = sortByTier(perTier).reduce<{
    decisionCount: number;
    inputTokens: number;
    outputTokens: number;
    attempts: number;
    preRoutingCost: number;
    postRoutingCost: number;
  }>(
    (out, b) => ({
      decisionCount: out.decisionCount + b.decisionCount,
      inputTokens: out.inputTokens + b.inputTokens,
      outputTokens: out.outputTokens + b.outputTokens,
      attempts: out.attempts + b.attempts,
      preRoutingCost: out.preRoutingCost + b.preRoutingCost,
      postRoutingCost: out.postRoutingCost + b.postRoutingCost,
    }),
    {
      decisionCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      attempts: 0,
      preRoutingCost: 0,
      postRoutingCost: 0,
    },
  );
  const totalAbsolute = totals.preRoutingCost - totals.postRoutingCost;
  const totalRatio =
    totals.preRoutingCost === 0
      ? 0
      : Math.max(0, Math.min(1, totalAbsolute / totals.preRoutingCost));

  return {
    schemaVersion: ROUTING_SAVINGS_REPORT_SCHEMA_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    profile: input.table.profile,
    environment: input.environment,
    currencyLabel: input.costRates.currencyLabel,
    perTier: sortByTier(perTier),
    totals: {
      decisionCount: totals.decisionCount,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      attempts: totals.attempts,
      preRoutingCost: round6(totals.preRoutingCost),
      postRoutingCost: round6(totals.postRoutingCost),
      absoluteSavings: round6(totalAbsolute),
      savingsRatio: round6(totalRatio),
    },
    secretsIncluded: false,
    rawPromptsIncluded: false,
  };
};

/**
 * Persist the routing-savings report under
 * `<runDir>/finops/routing-savings-report.json`. Atomic write.
 */
export interface WriteRoutingSavingsReportInput {
  readonly report: RoutingSavingsReport;
  readonly runDir: string;
}

export interface WriteRoutingSavingsReportResult {
  readonly artifactPath: string;
  readonly filename: typeof ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME;
  readonly bytes: Uint8Array;
}

export const writeRoutingSavingsReport = async (
  input: WriteRoutingSavingsReportInput,
): Promise<WriteRoutingSavingsReportResult> => {
  const finopsDir = join(input.runDir, FINOPS_ARTIFACT_DIRECTORY);
  await mkdir(finopsDir, { recursive: true });
  const artifactPath = join(
    finopsDir,
    ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME,
  );
  const serialized = `${canonicalJson(input.report)}\n`;
  const bytes = new TextEncoder().encode(serialized);
  const tmp = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, artifactPath);
  return {
    artifactPath,
    filename: ROUTING_SAVINGS_REPORT_ARTIFACT_FILENAME,
    bytes,
  };
};

/**
 * Convenience: assert that the totals.savingsRatio meets a minimum
 * target. Throws when the realised savings fall below the target so
 * a CI gate can wire the assertion to its quality bar.
 */
export const assertRoutingSavingsAtLeast = (
  report: RoutingSavingsReport,
  minimumSavingsRatio: number,
): void => {
  if (
    !Number.isFinite(minimumSavingsRatio) ||
    minimumSavingsRatio < 0 ||
    minimumSavingsRatio > 1
  ) {
    throw new RangeError(
      "assertRoutingSavingsAtLeast: minimumSavingsRatio must be in [0, 1]",
    );
  }
  if (report.totals.savingsRatio + 1e-9 < minimumSavingsRatio) {
    throw new Error(
      `routing savings ${report.totals.savingsRatio.toFixed(4)} below required minimum ${minimumSavingsRatio.toFixed(4)}`,
    );
  }
};
