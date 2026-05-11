/**
 * Training-influence differential-privacy budget accountant (Issue #2128).
 *
 * Per-tenant accounting layer that bounds how much input content a tenant
 * may contribute to an LLM provider gateway inside a single cycle. Each
 * job is charged `epsilon = inputTokens * perTokenEpsilon` and a constant
 * `delta = deltaPerJob` against the tenant budget. Jobs that would exceed
 * either cap are blocked until the operator advances the cycle.
 *
 * IMPORTANT — this is NOT a cryptographic differential-privacy guarantee.
 * True DP cannot be enforced from the client side alone; the provider's
 * training pipeline must implement the mechanism. This module is an
 * operator-controlled budget-accounting layer that supports a "stop
 * sending further input under this cycle" decision when the contractually
 * allowed contribution has been reached. See the ADR for the full model.
 *
 * The accountant is opt-in. When `TrainingInfluenceDpBudgetConfig.enabled`
 * is `false` (the secure default for every shipped policy profile), the
 * accountant short-circuits with a `skipped_disabled` decision and writes
 * no manifest.
 */

import {
  ALLOWED_DP_BUDGET_DECISIONS,
  DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION,
  DP_BUDGET_DEFAULT_DELTA_PER_JOB,
  DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type DpBudgetCharge,
  type DpBudgetConsumedManifest,
  type DpBudgetDecision,
  type TenantDpBudgetState,
  type TrainingInfluenceDpBudgetConfig,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const isFinitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertConfig = (config: TrainingInfluenceDpBudgetConfig): void => {
  if (!isFiniteNonNegative(config.tenantEpsilonBudget)) {
    throw new RangeError(
      "TrainingInfluenceDpBudgetConfig.tenantEpsilonBudget must be a non-negative finite number",
    );
  }
  if (!isFiniteNonNegative(config.tenantDeltaBudget)) {
    throw new RangeError(
      "TrainingInfluenceDpBudgetConfig.tenantDeltaBudget must be a non-negative finite number",
    );
  }
  if (config.perTokenEpsilon !== undefined && !isFinitePositive(config.perTokenEpsilon)) {
    throw new RangeError(
      "TrainingInfluenceDpBudgetConfig.perTokenEpsilon must be a positive finite number",
    );
  }
  if (config.deltaPerJob !== undefined && !isFiniteNonNegative(config.deltaPerJob)) {
    throw new RangeError(
      "TrainingInfluenceDpBudgetConfig.deltaPerJob must be a non-negative finite number",
    );
  }
};

/**
 * Deterministically estimate the per-job DP charge from an input-token
 * count. The estimate is linear in `inputTokens` (basic composition); the
 * delta term is constant per job. Two byte-identical calls return
 * byte-identical charges.
 */
export const estimateJobDpCharge = (input: {
  readonly inputTokens: number;
  readonly perTokenEpsilon?: number;
  readonly deltaPerJob?: number;
}): DpBudgetCharge => {
  if (
    !Number.isSafeInteger(input.inputTokens) ||
    input.inputTokens < 0
  ) {
    throw new RangeError(
      "estimateJobDpCharge: inputTokens must be a non-negative safe integer",
    );
  }
  const perTokenEpsilon = input.perTokenEpsilon ?? DP_BUDGET_DEFAULT_PER_TOKEN_EPSILON;
  const deltaPerJob = input.deltaPerJob ?? DP_BUDGET_DEFAULT_DELTA_PER_JOB;
  if (!isFinitePositive(perTokenEpsilon)) {
    throw new RangeError(
      "estimateJobDpCharge: perTokenEpsilon must be a positive finite number",
    );
  }
  if (!isFiniteNonNegative(deltaPerJob)) {
    throw new RangeError(
      "estimateJobDpCharge: deltaPerJob must be a non-negative finite number",
    );
  }
  return {
    epsilon: input.inputTokens * perTokenEpsilon,
    delta: deltaPerJob,
    inputTokens: input.inputTokens,
    perTokenEpsilon,
    deltaPerJob,
  };
};

/**
 * Build a fresh tenant accountant state at the start of a new cycle. Use
 * `resetTenantDpBudgetCycle` to roll an existing state forward into the
 * next cycle while preserving the tenant identity.
 */
export const createTenantDpBudgetState = (input: {
  readonly tenantId: string;
  readonly cycleId: string;
  readonly cycleStartedAt: string;
  readonly config: TrainingInfluenceDpBudgetConfig;
}): TenantDpBudgetState => {
  if (!isNonEmptyString(input.tenantId)) {
    throw new TypeError(
      "createTenantDpBudgetState: tenantId must be a non-empty string",
    );
  }
  if (!isNonEmptyString(input.cycleId)) {
    throw new TypeError(
      "createTenantDpBudgetState: cycleId must be a non-empty string",
    );
  }
  if (
    !isNonEmptyString(input.cycleStartedAt) ||
    !ISO_8601_PATTERN.test(input.cycleStartedAt)
  ) {
    throw new TypeError(
      "createTenantDpBudgetState: cycleStartedAt must be ISO-8601",
    );
  }
  assertConfig(input.config);
  return Object.freeze({
    schemaVersion: DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    tenantId: input.tenantId,
    cycleId: input.cycleId,
    cycleStartedAt: input.cycleStartedAt,
    epsilonBudget: input.config.tenantEpsilonBudget,
    deltaBudget: input.config.tenantDeltaBudget,
    epsilonConsumed: 0,
    deltaConsumed: 0,
    jobsCharged: 0,
  });
};

/**
 * Roll a state forward into a new cycle. Tenant identity is preserved;
 * consumed totals reset to zero. Operators advance the cycle on their
 * preferred audit cadence (daily, quarterly, per-engagement).
 */
export const resetTenantDpBudgetCycle = (
  previous: TenantDpBudgetState,
  next: {
    readonly cycleId: string;
    readonly cycleStartedAt: string;
    readonly config?: TrainingInfluenceDpBudgetConfig;
  },
): TenantDpBudgetState => {
  if (!isNonEmptyString(next.cycleId)) {
    throw new TypeError(
      "resetTenantDpBudgetCycle: next.cycleId must be a non-empty string",
    );
  }
  if (next.cycleId === previous.cycleId) {
    throw new RangeError(
      "resetTenantDpBudgetCycle: next.cycleId must differ from the current cycleId",
    );
  }
  if (
    !isNonEmptyString(next.cycleStartedAt) ||
    !ISO_8601_PATTERN.test(next.cycleStartedAt)
  ) {
    throw new TypeError(
      "resetTenantDpBudgetCycle: next.cycleStartedAt must be ISO-8601",
    );
  }
  const epsilonBudget = next.config?.tenantEpsilonBudget ?? previous.epsilonBudget;
  const deltaBudget = next.config?.tenantDeltaBudget ?? previous.deltaBudget;
  if (next.config !== undefined) {
    assertConfig(next.config);
  }
  return Object.freeze({
    schemaVersion: previous.schemaVersion,
    contractVersion: previous.contractVersion,
    tenantId: previous.tenantId,
    cycleId: next.cycleId,
    cycleStartedAt: next.cycleStartedAt,
    epsilonBudget,
    deltaBudget,
    epsilonConsumed: 0,
    deltaConsumed: 0,
    jobsCharged: 0,
  });
};

/** Result of a single accountant call. */
export interface ApplyDpChargeResult {
  /** Decision for the caller. `accepted` means the inference may proceed. */
  readonly decision: DpBudgetDecision;
  /**
   * Tenant state AFTER the charge — equal to `previous` for non-accepted
   * decisions so callers can persist `newState` unconditionally.
   */
  readonly newState: TenantDpBudgetState;
  /**
   * The estimate that was considered. Always present, even for `skipped`
   * decisions, so audit can record what would have been charged.
   */
  readonly charge: DpBudgetCharge;
  /** Reason for the decision (audit-friendly, never user-controllable). */
  readonly reason: string;
}

/**
 * Apply a single job's charge against the tenant budget. The decision is
 * deterministic in its inputs.
 *
 * - `enabled === false` → `skipped_disabled`, state unchanged.
 * - Charge would push consumed past either cap → `rejected_budget_exhausted`,
 *   state unchanged, caller must NOT issue inference for this job.
 * - Otherwise → `accepted`, `newState` is the post-charge state.
 */
export const applyDpCharge = (
  state: TenantDpBudgetState,
  input: {
    readonly config: TrainingInfluenceDpBudgetConfig;
    readonly inputTokens: number;
  },
): ApplyDpChargeResult => {
  assertConfig(input.config);
  const charge = estimateJobDpCharge({
    inputTokens: input.inputTokens,
    ...(input.config.perTokenEpsilon !== undefined
      ? { perTokenEpsilon: input.config.perTokenEpsilon }
      : {}),
    ...(input.config.deltaPerJob !== undefined
      ? { deltaPerJob: input.config.deltaPerJob }
      : {}),
  });
  if (!input.config.enabled) {
    return {
      decision: "skipped_disabled",
      newState: state,
      charge,
      reason: "training_influence_dp_budget_disabled",
    };
  }
  const projectedEpsilon = state.epsilonConsumed + charge.epsilon;
  const projectedDelta = state.deltaConsumed + charge.delta;
  if (projectedEpsilon > state.epsilonBudget) {
    return {
      decision: "rejected_budget_exhausted",
      newState: state,
      charge,
      reason: "epsilon_budget_would_exceed_cap",
    };
  }
  if (projectedDelta > state.deltaBudget) {
    return {
      decision: "rejected_budget_exhausted",
      newState: state,
      charge,
      reason: "delta_budget_would_exceed_cap",
    };
  }
  return {
    decision: "accepted",
    newState: Object.freeze({
      schemaVersion: state.schemaVersion,
      contractVersion: state.contractVersion,
      tenantId: state.tenantId,
      cycleId: state.cycleId,
      cycleStartedAt: state.cycleStartedAt,
      epsilonBudget: state.epsilonBudget,
      deltaBudget: state.deltaBudget,
      epsilonConsumed: projectedEpsilon,
      deltaConsumed: projectedDelta,
      jobsCharged: state.jobsCharged + 1,
    }),
    charge,
    reason: "within_budget",
  };
};

/**
 * Assemble a per-job manifest carrying the `dpBudgetConsumed` record for
 * audit. The manifest reflects the POST-CHARGE state: callers pass the
 * `newState` returned by `applyDpCharge`.
 */
export const buildDpBudgetConsumedManifest = (input: {
  readonly result: ApplyDpChargeResult;
  readonly stateAfter: TenantDpBudgetState;
  readonly jobId: string;
  readonly generatedAt: string;
}): DpBudgetConsumedManifest => {
  if (!isNonEmptyString(input.jobId)) {
    throw new TypeError(
      "buildDpBudgetConsumedManifest: jobId must be a non-empty string",
    );
  }
  if (
    !isNonEmptyString(input.generatedAt) ||
    !ISO_8601_PATTERN.test(input.generatedAt)
  ) {
    throw new TypeError(
      "buildDpBudgetConsumedManifest: generatedAt must be ISO-8601",
    );
  }
  const { result, stateAfter } = input;
  return Object.freeze({
    schemaVersion: DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    tenantId: stateAfter.tenantId,
    jobId: input.jobId,
    cycleId: stateAfter.cycleId,
    generatedAt: input.generatedAt,
    decision: result.decision,
    dpBudgetConsumed: Object.freeze({
      epsilon: result.charge.epsilon,
      delta: result.charge.delta,
      inputTokens: result.charge.inputTokens,
    }),
    cycleTotals: Object.freeze({
      epsilonConsumed: stateAfter.epsilonConsumed,
      deltaConsumed: stateAfter.deltaConsumed,
      epsilonBudget: stateAfter.epsilonBudget,
      deltaBudget: stateAfter.deltaBudget,
      jobsCharged: stateAfter.jobsCharged,
    }),
    parameters: Object.freeze({
      perTokenEpsilon: result.charge.perTokenEpsilon,
      deltaPerJob: result.charge.deltaPerJob,
    }),
  });
};

const isDpDecision = (value: unknown): value is DpBudgetDecision =>
  typeof value === "string" &&
  (ALLOWED_DP_BUDGET_DECISIONS as readonly string[]).includes(value);

/** Hand-rolled validator for {@link DpBudgetConsumedManifest}. */
export const isDpBudgetConsumedManifest = (
  value: unknown,
): value is DpBudgetConsumedManifest => {
  if (!isRecord(value)) return false;
  if (
    value["schemaVersion"] !== DP_BUDGET_CONSUMED_MANIFEST_SCHEMA_VERSION ||
    value["contractVersion"] !== TEST_INTELLIGENCE_CONTRACT_VERSION ||
    !isNonEmptyString(value["tenantId"]) ||
    !isNonEmptyString(value["jobId"]) ||
    !isNonEmptyString(value["cycleId"]) ||
    !isNonEmptyString(value["generatedAt"]) ||
    !ISO_8601_PATTERN.test(value["generatedAt"] as string) ||
    !isDpDecision(value["decision"])
  ) {
    return false;
  }
  const consumed = value["dpBudgetConsumed"];
  if (
    !isRecord(consumed) ||
    !isFiniteNonNegative(consumed["epsilon"]) ||
    !isFiniteNonNegative(consumed["delta"]) ||
    !Number.isSafeInteger(consumed["inputTokens"]) ||
    (consumed["inputTokens"] as number) < 0
  ) {
    return false;
  }
  const totals = value["cycleTotals"];
  if (
    !isRecord(totals) ||
    !isFiniteNonNegative(totals["epsilonConsumed"]) ||
    !isFiniteNonNegative(totals["deltaConsumed"]) ||
    !isFiniteNonNegative(totals["epsilonBudget"]) ||
    !isFiniteNonNegative(totals["deltaBudget"]) ||
    !Number.isSafeInteger(totals["jobsCharged"]) ||
    (totals["jobsCharged"] as number) < 0
  ) {
    return false;
  }
  const parameters = value["parameters"];
  if (
    !isRecord(parameters) ||
    !isFinitePositive(parameters["perTokenEpsilon"]) ||
    !isFiniteNonNegative(parameters["deltaPerJob"])
  ) {
    return false;
  }
  return true;
};

/**
 * Serialize a manifest to canonical JSON with a trailing newline — the
 * convention every other harness artifact in this codebase shares so the
 * harness-artifact-manifest sha256 stays byte-stable across writers.
 */
export const serializeDpBudgetConsumedManifest = (
  manifest: DpBudgetConsumedManifest,
): string => `${canonicalJson(manifest)}\n`;
