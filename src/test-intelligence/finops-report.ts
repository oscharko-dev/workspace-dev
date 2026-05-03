/**
 * FinOps usage recorder + budget report builder + persistence (Issue #1371).
 *
 * The recorder is the only path that promotes per-attempt gateway results
 * into the per-role usage struct attested by the FinOps report. Cache hits
 * never invoke the gateway; the recorder must therefore see them through
 * `recordCacheHit(role)` so the report correctly stamps zero token usage.
 *
 * The builder produces a deterministic, byte-stable report:
 *
 *   - Roles are sorted alphabetically.
 *   - Breaches are sorted by `(rule, role, observed)`.
 *   - Counters are integers (no NaN / no negative zero).
 *   - Cost = inputTokens / 1000 * inputRate + outputTokens / 1000 * outputRate
 *           + attempts * fixedCostPerAttempt — rounded to 6 decimal places.
 *   - The report carries the verbatim `FinOpsBudgetEnvelope` so an operator
 *     can read the policy that was applied without re-fetching the source.
 *
 * Hard invariants (stamped as TYPE-LEVEL `false` literals on the artifact):
 *   - `secretsIncluded: false`
 *   - `rawPromptsIncluded: false`
 *   - `rawScreenshotsIncluded: false`
 *
 * Persistence uses the same atomic write pattern as the rest of the
 * test-intelligence module (`writeFile` to `${path}.${pid}.${randomUUID()}.tmp`,
 * then `rename`).
 */

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  ALLOWED_FINOPS_BUDGET_BREACH_REASONS,
  ALLOWED_FINOPS_ROLES,
  FINOPS_ARTIFACT_DIRECTORY,
  FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
  FINOPS_BUDGET_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type AgentSourceLabel,
  type FinOpsBudgetBreach,
  type FinOpsBudgetBreachReason,
  type FinOpsBudgetEnvelope,
  type FinOpsBudgetReport,
  type FinOpsCostRate,
  type FinOpsCostRateMap,
  type FinOpsJobOutcome,
  type FinOpsRole,
  type FinOpsRoleUsage,
  type LlmFinishReason,
  type LlmGatewayErrorClass,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { cloneFinOpsBudgetEnvelope } from "./finops-budget.js";
import {
  finalizePerSourceCostBreakdown,
  isAgentSourceLabel,
  recordPerSourceAttempt,
  recordPerSourceInFlightDedupHit,
  recordPerSourceReplayHit,
  type MutablePerSourceCostEntry,
} from "./per-source-cost.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

const MAX_REPORT_LABEL_LENGTH = 160;

const sanitizeReportString = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_REPORT_LABEL_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_REPORT_LABEL_LENGTH)}...`;
};

const sanitizeBudgetEnvelope = (
  input: FinOpsBudgetEnvelope,
): FinOpsBudgetEnvelope => {
  const cloned = cloneFinOpsBudgetEnvelope(input);
  return {
    ...cloned,
    budgetId: sanitizeReportString(cloned.budgetId),
    budgetVersion: sanitizeReportString(cloned.budgetVersion),
  };
};

/** Single attempt observation handed to the recorder. */
export interface FinOpsAttemptObservation {
  role: FinOpsRole;
  /** Optional agent-source label for per-source attribution. */
  source?: AgentSourceLabel;
  /** Deployment label observed (e.g. `gpt-oss-120b-mock`). */
  deployment: string;
  /** Wall-clock duration of the attempt in milliseconds. */
  durationMs: number;
  /** Decoded image-input bytes attached to this attempt. Visual roles only. */
  imageBytes?: number;
  /** True iff the attempt selected a non-mock deployment. */
  liveSmoke?: boolean;
  /** True iff the attempt was a fallback selection. */
  fallback?: boolean;
  /** The gateway result (success or failure) for this attempt. */
  result: LlmGenerationResult;
}

/** Optional cache-hit observation. Skips gateway counters. */
export interface FinOpsCacheHitObservation {
  role: FinOpsRole;
  /** Optional agent-source label credited with the replay hit. */
  source?: AgentSourceLabel;
  /** Optional deployment label that would have been used had the call run. */
  deployment?: string;
}

/** Optional cache-miss observation. Used when callers want to track miss rate. */
export interface FinOpsCacheMissObservation {
  role: FinOpsRole;
}

/** Mutable accumulator for one role. */
interface RoleAccumulator {
  role: FinOpsRole;
  deployment: string;
  attempts: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  imageBytes: number;
  cacheHits: number;
  cacheMisses: number;
  fallbackAttempts: number;
  liveSmokeCalls: number;
  durationMs: number;
  ingestBytes: number;
  lastFinishReason?: LlmFinishReason;
  lastErrorClass?: LlmGatewayErrorClass | "schema_invalid_response";
}

const createRoleAccumulator = (role: FinOpsRole): RoleAccumulator => ({
  role,
  deployment: "",
  attempts: 0,
  successes: 0,
  failures: 0,
  inputTokens: 0,
  outputTokens: 0,
  imageBytes: 0,
  cacheHits: 0,
  cacheMisses: 0,
  fallbackAttempts: 0,
  liveSmokeCalls: 0,
  durationMs: 0,
  ingestBytes: 0,
});

/**
 * Stateful recorder that aggregates per-role gateway usage. Construct via
 * `createFinOpsUsageRecorder()` and feed it observations as the job runs.
 */
export interface FinOpsUsageRecorder {
  recordAttempt(observation: FinOpsAttemptObservation): void;
  recordCacheHit(observation: FinOpsCacheHitObservation): void;
  recordCacheMiss(observation: FinOpsCacheMissObservation): void;
  recordInFlightDedupHit(source: AgentSourceLabel): void;
  recordBudgetBreach(breach: FinOpsBudgetBreach): void;
  /**
   * Record bytes ingested by a non-LLM source-ingest role
   * (`jira_paste_ingest`, `custom_context_ingest`). Ignored for LLM roles.
   */
  recordIngestBytes(role: FinOpsRole, bytes: number): void;
  /** Snapshot of every role accumulator (immutable copies). */
  snapshot(): FinOpsRoleUsage[];
  sourceSnapshot(jobId: string, sealedAt: string): FinOpsBudgetReport["bySource"];
  sourceTotals(
    jobId: string,
    sealedAt: string,
  ): FinOpsBudgetReport["bySourceTotal"];
  /** Explicit fail-closed budget breaches observed outside aggregate counters. */
  budgetBreaches(): FinOpsBudgetBreach[];
}

const ensureFinite = (value: number, fallback = 0): number => {
  if (!Number.isFinite(value)) return fallback;
  return value;
};

const positiveOrZero = (value: number | undefined): number => {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
};

const safeIntPositiveOrZero = (value: number | undefined): number => {
  const finite = positiveOrZero(value);
  return Math.floor(finite);
};

/** Construct a fresh recorder. */
export const createFinOpsUsageRecorder = (
  costRates?: FinOpsCostRateMap,
): FinOpsUsageRecorder => {
  const explicitBreaches: FinOpsBudgetBreach[] = [];
  const sourceAccumulators = new Map<AgentSourceLabel, MutablePerSourceCostEntry>();
  const accumulators: Record<FinOpsRole, RoleAccumulator> = {
    test_generation: createRoleAccumulator("test_generation"),
    visual_primary: createRoleAccumulator("visual_primary"),
    visual_fallback: createRoleAccumulator("visual_fallback"),
    jira_api_requests: createRoleAccumulator("jira_api_requests"),
    jira_paste_ingest: createRoleAccumulator("jira_paste_ingest"),
    custom_context_ingest: createRoleAccumulator("custom_context_ingest"),
  };

  const sourceAccumulatorFor = (
    source: AgentSourceLabel,
  ): MutablePerSourceCostEntry => {
    const existing = sourceAccumulators.get(source);
    if (existing !== undefined) return existing;
    const created: MutablePerSourceCostEntry = {
      costMinorUnits: 0,
      tokensIn: 0,
      tokensOut: 0,
      callCount: 0,
      inFlightDedupHits: 0,
      idempotentReplayHits: 0,
    };
    sourceAccumulators.set(source, created);
    return created;
  };

  const recordAttempt = (observation: FinOpsAttemptObservation): void => {
    if (!ALLOWED_FINOPS_ROLES.includes(observation.role)) {
      throw new RangeError(`recordAttempt: unknown role "${observation.role}"`);
    }
    const acc = accumulators[observation.role];
    acc.attempts += 1;
    if (
      typeof observation.deployment === "string" &&
      observation.deployment.length > 0
    ) {
      acc.deployment = sanitizeReportString(observation.deployment);
    }
    acc.durationMs += positiveOrZero(observation.durationMs);
    acc.imageBytes += safeIntPositiveOrZero(observation.imageBytes);
    if (observation.fallback === true) acc.fallbackAttempts += 1;
    if (observation.liveSmoke === true) acc.liveSmokeCalls += 1;

    if (observation.result.outcome === "success") {
      acc.successes += 1;
      acc.inputTokens += safeIntPositiveOrZero(
        observation.result.usage.inputTokens,
      );
      acc.outputTokens += safeIntPositiveOrZero(
        observation.result.usage.outputTokens,
      );
      acc.lastFinishReason = observation.result.finishReason;
    } else {
      acc.failures += 1;
      acc.lastErrorClass = observation.result.errorClass;
    }
    if (observation.source !== undefined) {
      if (!isAgentSourceLabel(observation.source)) {
        throw new RangeError(
          `recordAttempt: unknown source "${observation.source}"`,
        );
      }
      recordPerSourceAttempt({
        accumulator: sourceAccumulatorFor(observation.source),
        ...(costRates?.rates[observation.role] !== undefined
          ? { rate: costRates.rates[observation.role] }
          : {}),
        ...(observation.result.outcome === "success"
          ? {
              inputTokens: observation.result.usage.inputTokens,
              outputTokens: observation.result.usage.outputTokens,
            }
          : {}),
      });
    }
  };

  const recordCacheHit = (observation: FinOpsCacheHitObservation): void => {
    if (!ALLOWED_FINOPS_ROLES.includes(observation.role)) {
      throw new RangeError(
        `recordCacheHit: unknown role "${observation.role}"`,
      );
    }
    const acc = accumulators[observation.role];
    acc.cacheHits += 1;
    if (
      observation.deployment !== undefined &&
      acc.deployment.length === 0 &&
      observation.deployment.length > 0
    ) {
      acc.deployment = sanitizeReportString(observation.deployment);
    }
    if (observation.source !== undefined) {
      if (!isAgentSourceLabel(observation.source)) {
        throw new RangeError(
          `recordCacheHit: unknown source "${observation.source}"`,
        );
      }
      recordPerSourceReplayHit(sourceAccumulatorFor(observation.source));
    }
  };

  const recordCacheMiss = (observation: FinOpsCacheMissObservation): void => {
    if (!ALLOWED_FINOPS_ROLES.includes(observation.role)) {
      throw new RangeError(
        `recordCacheMiss: unknown role "${observation.role}"`,
      );
    }
    accumulators[observation.role].cacheMisses += 1;
  };

  const recordBudgetBreach = (breach: FinOpsBudgetBreach): void => {
    if (!ALLOWED_FINOPS_BUDGET_BREACH_REASONS.includes(breach.rule)) {
      throw new RangeError(`recordBudgetBreach: unknown rule "${breach.rule}"`);
    }
    if (
      breach.role !== undefined &&
      !ALLOWED_FINOPS_ROLES.includes(breach.role)
    ) {
      throw new RangeError(`recordBudgetBreach: unknown role "${breach.role}"`);
    }
    explicitBreaches.push({
      rule: breach.rule,
      ...(breach.role !== undefined ? { role: breach.role } : {}),
      observed: ensureFinite(breach.observed),
      threshold: ensureFinite(breach.threshold),
      message: sanitizeReportString(breach.message),
    });
  };

  const snapshot = (): FinOpsRoleUsage[] =>
    ALLOWED_FINOPS_ROLES.map((role) =>
      finalizeAccumulator(accumulators[role], costRates?.rates[role]),
    );

  const buildPerSourceBreakdown = (jobId: string, sealedAt: string) =>
    finalizePerSourceCostBreakdown({
      jobId,
      sealedAt,
      entries: sourceAccumulators,
    });

  const recordIngestBytes = (role: FinOpsRole, bytes: number): void => {
    if (!ALLOWED_FINOPS_ROLES.includes(role)) {
      throw new RangeError(`recordIngestBytes: unknown role "${role}"`);
    }
    accumulators[role].ingestBytes += safeIntPositiveOrZero(bytes);
  };

  const budgetBreaches = (): FinOpsBudgetBreach[] =>
    explicitBreaches.map((breach) => ({ ...breach }));

  return {
    recordAttempt,
    recordCacheHit,
    recordCacheMiss,
    recordInFlightDedupHit: (source) => {
      if (!isAgentSourceLabel(source)) {
        throw new RangeError(
          `recordInFlightDedupHit: unknown source "${source}"`,
        );
      }
      recordPerSourceInFlightDedupHit(sourceAccumulatorFor(source));
    },
    recordBudgetBreach,
    recordIngestBytes,
    snapshot,
    sourceSnapshot: (jobId, sealedAt) =>
      buildPerSourceBreakdown(jobId, sealedAt).bySource,
    sourceTotals: (jobId, sealedAt) =>
      buildPerSourceBreakdown(jobId, sealedAt).total,
    budgetBreaches,
  };
};

const finalizeAccumulator = (
  acc: RoleAccumulator,
  rate: FinOpsCostRate | undefined,
): FinOpsRoleUsage => {
  const estimatedCost = computeRoleCost(acc, rate);
  const usage: FinOpsRoleUsage = {
    role: acc.role,
    deployment: acc.deployment,
    attempts: acc.attempts,
    successes: acc.successes,
    failures: acc.failures,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    imageBytes: acc.imageBytes,
    cacheHits: acc.cacheHits,
    cacheMisses: acc.cacheMisses,
    fallbackAttempts: acc.fallbackAttempts,
    liveSmokeCalls: acc.liveSmokeCalls,
    durationMs: acc.durationMs,
    ingestBytes: acc.ingestBytes,
    estimatedCost,
  };
  if (acc.lastFinishReason !== undefined) {
    usage.lastFinishReason = acc.lastFinishReason;
  }
  if (acc.lastErrorClass !== undefined) {
    usage.lastErrorClass = acc.lastErrorClass;
  }
  return usage;
};

const round6 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
};

const computeRoleCost = (
  acc: RoleAccumulator,
  rate: FinOpsCostRate | undefined,
): number => {
  if (rate === undefined) return 0;
  const inputRate = positiveOrZero(rate.inputTokenCostPer1k);
  const outputRate = positiveOrZero(rate.outputTokenCostPer1k);
  const fixed = positiveOrZero(rate.fixedCostPerAttempt);
  const cost =
    (acc.inputTokens / 1000) * inputRate +
    (acc.outputTokens / 1000) * outputRate +
    acc.attempts * fixed;
  return round6(cost);
};

/** Input for `buildFinOpsBudgetReport`. */
export interface BuildFinOpsBudgetReportInput {
  jobId: string;
  generatedAt: string;
  budget: FinOpsBudgetEnvelope;
  recorder: FinOpsUsageRecorder;
  /** Optional cost rate map. The currency label is stamped onto the report. */
  costRates?: FinOpsCostRateMap;
  /**
   * Optional terminal-outcome override. When omitted the report computes
   * `outcome` from breach detection + cache-hit-only short-circuit.
   */
  outcomeOverride?: FinOpsJobOutcome;
}

/**
 * Build a deterministic FinOps budget report. The output is byte-stable
 * for a given input — roles are sorted alphabetically, breaches by
 * (rule, role, observed), and the budget envelope is cloned verbatim.
 */
export const buildFinOpsBudgetReport = (
  input: BuildFinOpsBudgetReportInput,
): FinOpsBudgetReport => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new RangeError("buildFinOpsBudgetReport: jobId must be non-empty");
  }
  if (typeof input.generatedAt !== "string" || input.generatedAt.length === 0) {
    throw new RangeError(
      "buildFinOpsBudgetReport: generatedAt must be non-empty",
    );
  }

  const usages = input.recorder.snapshot();
  const sortedUsages = [...usages].sort((a, b) =>
    a.role < b.role ? -1 : a.role > b.role ? 1 : 0,
  );

  const totals = aggregateTotals(sortedUsages);
  const bySource = input.recorder.sourceSnapshot(input.jobId, input.generatedAt);
  const bySourceTotal = input.recorder.sourceTotals(
    input.jobId,
    input.generatedAt,
  );
  const breaches = sortBreaches([
    ...detectBreaches(input.budget, sortedUsages, totals),
    ...input.recorder.budgetBreaches(),
  ]);
  const outcome =
    input.outcomeOverride !== undefined
      ? input.outcomeOverride
      : deriveOutcome(breaches, totals);

  const report: FinOpsBudgetReport = {
    schemaVersion: FINOPS_BUDGET_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    budget: sanitizeBudgetEnvelope(input.budget),
    ...(input.costRates !== undefined
      ? { currencyLabel: sanitizeReportString(input.costRates.currencyLabel) }
      : {}),
    roles: sortedUsages,
    bySource,
    bySourceTotal,
    bySourceSealedAt: input.generatedAt,
    totals,
    breaches,
    outcome,
    secretsIncluded: false,
    rawPromptsIncluded: false,
    rawScreenshotsIncluded: false,
  };
  return report;
};

const aggregateTotals = (
  usages: ReadonlyArray<FinOpsRoleUsage>,
): FinOpsBudgetReport["totals"] => {
  let inputTokens = 0;
  let outputTokens = 0;
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let fallbackAttempts = 0;
  let liveSmokeCalls = 0;
  let durationMs = 0;
  let imageBytes = 0;
  let estimatedCost = 0;
  for (const usage of usages) {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    attempts += usage.attempts;
    successes += usage.successes;
    failures += usage.failures;
    cacheHits += usage.cacheHits;
    cacheMisses += usage.cacheMisses;
    fallbackAttempts += usage.fallbackAttempts;
    liveSmokeCalls += usage.liveSmokeCalls;
    durationMs += usage.durationMs;
    imageBytes += usage.imageBytes;
    estimatedCost += usage.estimatedCost;
  }
  const totalCacheLookups = cacheHits + cacheMisses;
  const replayCacheHitRate =
    totalCacheLookups === 0 ? 0 : ensureFinite(cacheHits / totalCacheLookups);
  const replayCacheMissRate =
    totalCacheLookups === 0 ? 0 : ensureFinite(cacheMisses / totalCacheLookups);
  return {
    inputTokens,
    outputTokens,
    attempts,
    successes,
    failures,
    cacheHits,
    cacheMisses,
    fallbackAttempts,
    liveSmokeCalls,
    durationMs,
    imageBytes,
    estimatedCost: round6(estimatedCost),
    replayCacheHitRate: round6(Math.min(1, Math.max(0, replayCacheHitRate))),
    replayCacheMissRate: round6(Math.min(1, Math.max(0, replayCacheMissRate))),
    promptCacheHitRate: round6(Math.min(1, Math.max(0, replayCacheHitRate))),
    promptCacheMissRate: round6(
      Math.min(1, Math.max(0, replayCacheMissRate)),
    ),
  };
};

const detectBreaches = (
  envelope: FinOpsBudgetEnvelope,
  usages: ReadonlyArray<FinOpsRoleUsage>,
  totals: FinOpsBudgetReport["totals"],
): FinOpsBudgetBreach[] => {
  const breaches: FinOpsBudgetBreach[] = [];
  const usageByRole = new Map<FinOpsRole, FinOpsRoleUsage>(
    usages.map((u) => [u.role, u]),
  );

  // Job-level (totals) checks.
  if (
    envelope.maxJobWallClockMs !== undefined &&
    totals.durationMs > envelope.maxJobWallClockMs
  ) {
    breaches.push({
      rule: "max_total_wall_clock_ms",
      observed: totals.durationMs,
      threshold: envelope.maxJobWallClockMs,
      message: `total wall-clock ${totals.durationMs}ms exceeds maxJobWallClockMs ${envelope.maxJobWallClockMs}ms`,
    });
  }
  if (
    envelope.maxReplayCacheMissRate !== undefined &&
    totals.cacheHits + totals.cacheMisses > 0 &&
    totals.replayCacheMissRate > envelope.maxReplayCacheMissRate
  ) {
    breaches.push({
      rule: "max_replay_cache_miss_rate",
      observed: totals.replayCacheMissRate,
      threshold: envelope.maxReplayCacheMissRate,
      message: `replay-cache miss rate ${totals.replayCacheMissRate.toFixed(4)} exceeds maxReplayCacheMissRate ${envelope.maxReplayCacheMissRate.toFixed(4)}`,
    });
  }
  if (
    envelope.maxEstimatedCost !== undefined &&
    totals.estimatedCost > envelope.maxEstimatedCost
  ) {
    breaches.push({
      rule: "max_estimated_cost",
      observed: totals.estimatedCost,
      threshold: envelope.maxEstimatedCost,
      message: `estimated cost ${totals.estimatedCost} exceeds maxEstimatedCost ${envelope.maxEstimatedCost}`,
    });
  }

  // Per-role checks.
  for (const role of ALLOWED_FINOPS_ROLES) {
    const roleBudget = envelope.roles[role];
    const usage = usageByRole.get(role);
    if (roleBudget === undefined || usage === undefined) continue;

    if (
      roleBudget.maxTotalInputTokens !== undefined &&
      usage.inputTokens > roleBudget.maxTotalInputTokens
    ) {
      breaches.push({
        rule: "max_total_input_tokens",
        role,
        observed: usage.inputTokens,
        threshold: roleBudget.maxTotalInputTokens,
        message: `${role} consumed ${usage.inputTokens} input tokens, exceeds maxTotalInputTokens ${roleBudget.maxTotalInputTokens}`,
      });
    }
    if (
      roleBudget.maxTotalOutputTokens !== undefined &&
      usage.outputTokens > roleBudget.maxTotalOutputTokens
    ) {
      breaches.push({
        rule: "max_total_output_tokens",
        role,
        observed: usage.outputTokens,
        threshold: roleBudget.maxTotalOutputTokens,
        message: `${role} produced ${usage.outputTokens} output tokens, exceeds maxTotalOutputTokens ${roleBudget.maxTotalOutputTokens}`,
      });
    }
    if (
      roleBudget.maxTotalWallClockMs !== undefined &&
      usage.durationMs > roleBudget.maxTotalWallClockMs
    ) {
      breaches.push({
        rule: "max_total_wall_clock_ms",
        role,
        observed: usage.durationMs,
        threshold: roleBudget.maxTotalWallClockMs,
        message: `${role} wall-clock ${usage.durationMs}ms exceeds maxTotalWallClockMs ${roleBudget.maxTotalWallClockMs}ms`,
      });
    }
    if (
      roleBudget.maxAttempts !== undefined &&
      usage.attempts > roleBudget.maxAttempts
    ) {
      breaches.push({
        rule: "max_attempts",
        role,
        observed: usage.attempts,
        threshold: roleBudget.maxAttempts,
        message: `${role} made ${usage.attempts} attempts, exceeds maxAttempts ${roleBudget.maxAttempts}`,
      });
    }
    if (
      roleBudget.maxFallbackAttempts !== undefined &&
      usage.fallbackAttempts > roleBudget.maxFallbackAttempts
    ) {
      breaches.push({
        rule: "max_fallback_attempts",
        role,
        observed: usage.fallbackAttempts,
        threshold: roleBudget.maxFallbackAttempts,
        message: `${role} made ${usage.fallbackAttempts} fallback attempts, exceeds maxFallbackAttempts ${roleBudget.maxFallbackAttempts}`,
      });
    }
    if (
      roleBudget.maxLiveSmokeCalls !== undefined &&
      usage.liveSmokeCalls > roleBudget.maxLiveSmokeCalls
    ) {
      breaches.push({
        rule: "max_live_smoke_calls",
        role,
        observed: usage.liveSmokeCalls,
        threshold: roleBudget.maxLiveSmokeCalls,
        message: `${role} made ${usage.liveSmokeCalls} live-smoke calls, exceeds maxLiveSmokeCalls ${roleBudget.maxLiveSmokeCalls}`,
      });
    }
  }

  return breaches;
};

const sortBreaches = (
  breaches: ReadonlyArray<FinOpsBudgetBreach>,
): FinOpsBudgetBreach[] => {
  const ruleOrder = new Map<FinOpsBudgetBreachReason, number>(
    ALLOWED_FINOPS_BUDGET_BREACH_REASONS.map((r, i) => [r, i]),
  );
  return [...breaches].sort((a, b) => {
    const orderA = ruleOrder.get(a.rule) ?? Number.MAX_SAFE_INTEGER;
    const orderB = ruleOrder.get(b.rule) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const aRole = a.role ?? "";
    const bRole = b.role ?? "";
    if (aRole !== bRole) return aRole < bRole ? -1 : 1;
    if (a.observed !== b.observed) return a.observed - b.observed;
    return 0;
  });
};

const deriveOutcome = (
  breaches: ReadonlyArray<FinOpsBudgetBreach>,
  totals: FinOpsBudgetReport["totals"],
): FinOpsJobOutcome => {
  if (breaches.length > 0) return "budget_exceeded";
  if (totals.attempts === 0 && totals.cacheHits > 0) {
    return "completed_cache_hit";
  }
  return "completed";
};

/**
 * Persist the FinOps report under `<runDir>/finops/budget-report.json`.
 * Uses an atomic write (`tmp` then `rename`). Returns the on-disk bytes
 * so callers can register the artifact in the evidence manifest without
 * re-reading the file.
 */
export interface WriteFinOpsBudgetReportInput {
  report: FinOpsBudgetReport;
  /** Run directory that contains the FinOps subdirectory. */
  runDir: string;
}

export interface WriteFinOpsBudgetReportResult {
  /** Absolute path to the written artifact. */
  artifactPath: string;
  /** Relative filename within the FinOps subdirectory. */
  filename: typeof FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME;
  /** UTF-8 encoded bytes written. */
  bytes: Uint8Array;
}

export const writeFinOpsBudgetReport = async (
  input: WriteFinOpsBudgetReportInput,
): Promise<WriteFinOpsBudgetReportResult> => {
  const finopsDir = join(input.runDir, FINOPS_ARTIFACT_DIRECTORY);
  await mkdir(finopsDir, { recursive: true });
  const artifactPath = join(finopsDir, FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME);
  const serialized = canonicalJson(input.report);
  const bytes = new TextEncoder().encode(serialized);
  await mkdir(dirname(artifactPath), { recursive: true });
  const tmp = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, artifactPath);
  return {
    artifactPath,
    filename: FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME,
    bytes,
  };
};
