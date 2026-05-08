import { createHash } from "node:crypto";

import { canonicalJson } from "./content-hash.js";
import type {
  FinOpsBudgetReport,
  FinOpsCostRate,
  LlmCircuitState,
  LlmConstrainedDecodingAdapterId,
  LlmConstrainedDecodingEnforcement,
  LlmConstrainedDecodingMetadata,
} from "../contracts/index.js";

export const PER_SOURCE_COST_BREAKDOWN_SCHEMA_VERSION = "1.0.0" as const;

export const STATIC_AGENT_SOURCE_LABELS = [
  "manager",
  "judge_primary",
  "judge_secondary",
  "visual_primary",
  "visual_fallback",
  "generator",
  "coverage_planner",
  "risk_ranker",
  "adversarial_critic",
  "gap_finder",
  "repair_planner",
  "ir_mutation_oracle",
] as const;

export type StaticAgentSourceLabel =
  (typeof STATIC_AGENT_SOURCE_LABELS)[number];

export type AgentSourceLabel = StaticAgentSourceLabel | `hook:${string}`;

export interface PerSourceCostEntry {
  readonly costMinorUnits: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly callCount: number;
  readonly inFlightDedupHits: number;
  readonly idempotentReplayHits: number;
  /**
   * Optional per-attempt identifiers surfaced when one source label
   * fan-outs into multiple generator attempts (Issue #1936).
   */
  readonly attemptIds?: readonly string[];
  /** Optional circuit-breaker states captured in dispatch order. */
  readonly circuitBreakerStates?: readonly LlmCircuitState[];
  /**
   * Optional deployment label this source ran against (Issue #1932).
   * Surfaces the **judge** deployment for `judge_primary` /
   * `judge_secondary` when the operator wired a cross-model bundle so
   * FinOps attribution distinguishes the judge family from the
   * generator family. Omitted (canonical-JSON-stable: not present in
   * the wire payload) when the source recorded no deployment.
   */
  readonly deployment?: string;
  readonly constrainedDecoding?: {
    adapterId: LlmConstrainedDecodingAdapterId;
    enforcement: LlmConstrainedDecodingEnforcement;
    activeCallCount: number;
    fallbackCallCount: number;
    fallbackReasons?: readonly string[];
    adapterVersion?: string;
  };
}

export interface PerSourceCostBreakdown {
  readonly schemaVersion: typeof PER_SOURCE_COST_BREAKDOWN_SCHEMA_VERSION;
  readonly jobId: string;
  readonly bySource: Readonly<Record<AgentSourceLabel, PerSourceCostEntry>>;
  readonly total: {
    readonly costMinorUnits: number;
    readonly callCount: number;
  };
  readonly sealedAt: string;
}

export interface MutablePerSourceCostEntry {
  costMinorUnits: number;
  tokensIn: number;
  tokensOut: number;
  callCount: number;
  inFlightDedupHits: number;
  idempotentReplayHits: number;
  attemptIds?: string[];
  circuitBreakerStates?: LlmCircuitState[];
  /**
   * Last deployment label observed for this source (Issue #1932).
   * `undefined` until the first attempt records one. The accumulator
   * is per-source (not per-deployment), so cross-deployment runs on
   * the same source label collapse to the most recently observed
   * deployment — which is the meaningful one for FinOps attribution.
   */
  deployment?: string;
  constrainedDecoding?: {
    adapterId: LlmConstrainedDecodingAdapterId;
    enforcement: LlmConstrainedDecodingEnforcement;
    activeCallCount: number;
    fallbackCallCount: number;
    fallbackReasons?: string[];
    adapterVersion?: string;
  };
}

export const isAgentSourceLabel = (
  value: string,
): value is AgentSourceLabel => {
  if ((STATIC_AGENT_SOURCE_LABELS as readonly string[]).includes(value)) {
    return true;
  }
  return value.startsWith("hook:") && value.length > "hook:".length;
};

export const createEmptyPerSourceCostEntry = (): MutablePerSourceCostEntry => ({
  costMinorUnits: 0,
  tokensIn: 0,
  tokensOut: 0,
  callCount: 0,
  inFlightDedupHits: 0,
  idempotentReplayHits: 0,
});

const positiveOrZero = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return value;
};

const safeIntPositiveOrZero = (value: number | undefined): number =>
  Math.floor(positiveOrZero(value));

const round6 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

export const estimatedCostToMinorUnits = (estimatedCost: number): number =>
  Math.round(round6(estimatedCost) * 100);

export const computePerSourceCostMinorUnits = (input: {
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  rate?: FinOpsCostRate;
}): number => {
  if (input.rate === undefined) return 0;
  const inputRate = positiveOrZero(input.rate.inputTokenCostPer1k);
  const outputRate = positiveOrZero(input.rate.outputTokenCostPer1k);
  const fixed = positiveOrZero(input.rate.fixedCostPerAttempt);
  const estimatedCost =
    (input.inputTokens / 1000) * inputRate +
    (input.outputTokens / 1000) * outputRate +
    input.callCount * fixed;
  return estimatedCostToMinorUnits(estimatedCost);
};

export const recordPerSourceAttempt = (input: {
  accumulator: MutablePerSourceCostEntry;
  rate?: FinOpsCostRate;
  inputTokens?: number;
  outputTokens?: number;
  attemptId?: string;
  circuitBreakerState?: LlmCircuitState;
  /**
   * Optional deployment label associated with this attempt (Issue
   * #1932). When supplied, it is stamped on the accumulator so the
   * finalised entry surfaces the deployment that ran. Empty strings
   * are ignored so the accumulator never advertises a blank
   * deployment label.
   */
  deployment?: string;
  constrainedDecoding?: LlmConstrainedDecodingMetadata;
}): void => {
  input.accumulator.callCount += 1;
  input.accumulator.tokensIn += safeIntPositiveOrZero(input.inputTokens);
  input.accumulator.tokensOut += safeIntPositiveOrZero(input.outputTokens);
  input.accumulator.costMinorUnits = computePerSourceCostMinorUnits({
    inputTokens: input.accumulator.tokensIn,
    outputTokens: input.accumulator.tokensOut,
    callCount: input.accumulator.callCount,
    ...(input.rate !== undefined ? { rate: input.rate } : {}),
  });
  if (typeof input.attemptId === "string" && input.attemptId.length > 0) {
    const ids = input.accumulator.attemptIds ?? [];
    if (!ids.includes(input.attemptId)) {
      ids.push(input.attemptId);
      ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    }
    input.accumulator.attemptIds = ids;
  }
  if (input.circuitBreakerState !== undefined) {
    const states = input.accumulator.circuitBreakerStates ?? [];
    states.push(input.circuitBreakerState);
    input.accumulator.circuitBreakerStates = states;
  }
  if (typeof input.deployment === "string" && input.deployment.length > 0) {
    input.accumulator.deployment = input.deployment;
  }
  if (input.constrainedDecoding !== undefined) {
    const current =
      input.accumulator.constrainedDecoding ?? {
        adapterId: input.constrainedDecoding.adapterId,
        enforcement: input.constrainedDecoding.enforcement,
        activeCallCount: 0,
        fallbackCallCount: 0,
      };
    current.adapterId = input.constrainedDecoding.adapterId;
    current.enforcement = input.constrainedDecoding.enforcement;
    if (input.constrainedDecoding.fallback) {
      current.fallbackCallCount += 1;
      if (
        typeof input.constrainedDecoding.fallbackReason === "string" &&
        input.constrainedDecoding.fallbackReason.length > 0
      ) {
        const reasons = current.fallbackReasons ?? [];
        if (!reasons.includes(input.constrainedDecoding.fallbackReason)) {
          reasons.push(input.constrainedDecoding.fallbackReason);
          reasons.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        }
        current.fallbackReasons = reasons;
      }
    } else {
      current.activeCallCount += 1;
    }
    if (
      typeof input.constrainedDecoding.adapterVersion === "string" &&
      input.constrainedDecoding.adapterVersion.length > 0
    ) {
      current.adapterVersion = input.constrainedDecoding.adapterVersion;
    }
    input.accumulator.constrainedDecoding = current;
  }
};

export const recordPerSourceReplayHit = (
  accumulator: MutablePerSourceCostEntry,
): void => {
  accumulator.idempotentReplayHits += 1;
};

export const recordPerSourceInFlightDedupHit = (
  accumulator: MutablePerSourceCostEntry,
): void => {
  accumulator.inFlightDedupHits += 1;
};

export const finalizePerSourceCostBreakdown = (input: {
  jobId: string;
  sealedAt: string;
  entries: ReadonlyMap<AgentSourceLabel, MutablePerSourceCostEntry>;
}): PerSourceCostBreakdown => {
  const labels = new Set<AgentSourceLabel>(STATIC_AGENT_SOURCE_LABELS);
  for (const label of input.entries.keys()) {
    labels.add(label);
  }
  const orderedLabels = Array.from(labels).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  let totalCostMinorUnits = 0;
  let totalCallCount = 0;
  const bySource = Object.fromEntries(
    orderedLabels.map((label) => {
      const entry = input.entries.get(label) ?? createEmptyPerSourceCostEntry();
      totalCostMinorUnits += entry.costMinorUnits;
      totalCallCount += entry.callCount;
      return [
        label,
        {
          costMinorUnits: entry.costMinorUnits,
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          callCount: entry.callCount,
          inFlightDedupHits: entry.inFlightDedupHits,
          idempotentReplayHits: entry.idempotentReplayHits,
          ...(entry.attemptIds !== undefined && entry.attemptIds.length > 0
            ? { attemptIds: entry.attemptIds }
            : {}),
          ...(entry.circuitBreakerStates !== undefined &&
          entry.circuitBreakerStates.length > 0
            ? { circuitBreakerStates: entry.circuitBreakerStates }
            : {}),
          ...(entry.deployment !== undefined && entry.deployment.length > 0
            ? { deployment: entry.deployment }
            : {}),
          ...(entry.constrainedDecoding !== undefined
            ? {
                constrainedDecoding: {
                  adapterId: entry.constrainedDecoding.adapterId,
                  enforcement: entry.constrainedDecoding.enforcement,
                  activeCallCount:
                    entry.constrainedDecoding.activeCallCount,
                  fallbackCallCount:
                    entry.constrainedDecoding.fallbackCallCount,
                  ...(entry.constrainedDecoding.fallbackReasons !== undefined &&
                  entry.constrainedDecoding.fallbackReasons.length > 0
                    ? {
                        fallbackReasons:
                          entry.constrainedDecoding.fallbackReasons,
                      }
                    : {}),
                  ...(entry.constrainedDecoding.adapterVersion !== undefined
                    ? {
                        adapterVersion:
                          entry.constrainedDecoding.adapterVersion,
                      }
                    : {}),
                },
              }
            : {}),
        } satisfies PerSourceCostEntry,
      ];
    }),
  ) as unknown as Record<AgentSourceLabel, PerSourceCostEntry>;

  return {
    schemaVersion: PER_SOURCE_COST_BREAKDOWN_SCHEMA_VERSION,
    jobId: input.jobId,
    bySource,
    total: {
      costMinorUnits: totalCostMinorUnits,
      callCount: totalCallCount,
    },
    sealedAt: input.sealedAt,
  };
};

export const computePerSourceCostBreakdownHash = (
  breakdown: PerSourceCostBreakdown,
): string => {
  return createHash("sha256")
    .update(canonicalJson(breakdown), "utf8")
    .digest("hex");
};

export const computePerSourceCostBreakdownHashFromReport = (
  report: Pick<
    FinOpsBudgetReport,
    "jobId" | "bySource" | "bySourceTotal" | "bySourceSealedAt"
  >,
): string =>
  computePerSourceCostBreakdownHash({
    schemaVersion: PER_SOURCE_COST_BREAKDOWN_SCHEMA_VERSION,
    jobId: report.jobId,
    bySource: report.bySource,
    total: report.bySourceTotal,
    sealedAt: report.bySourceSealedAt,
  });
