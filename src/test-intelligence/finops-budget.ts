/**
 * FinOps budget envelope factory + validation (Issue #1371).
 *
 * The envelope is the operator-supplied policy that bounds an LLM job's
 * input/output tokens, wall-clock duration, retry count, image payload size,
 * and replay-cache miss rate per role. Validation is hand-rolled (no
 * external schema lib — workspace-dev is zero-runtime-deps) and returns a
 * structured issue list in the same shape as `validateGeneratedTestCaseList`
 * for consumer parity.
 *
 * The envelope is intentionally read-only: factories return a frozen deep
 * clone so callers cannot mutate the bound limits after construction.
 */

import {
  ALLOWED_FINOPS_ROLES,
  type FinOpsBudgetEnvelope,
  type FinOpsRole,
  type FinOpsRoleBudget,
} from "../contracts/index.js";

/** Single validation issue, mirrors the project's hand-rolled validator shape. */
export interface FinOpsBudgetValidationIssue {
  path: string;
  message: string;
}

/** Result returned by `validateFinOpsBudgetEnvelope`. */
export interface FinOpsBudgetValidationResult {
  valid: boolean;
  errors: ReadonlyArray<FinOpsBudgetValidationIssue>;
}

/** Default envelope with no enforced limits. Useful as a "permissive" baseline. */
export const DEFAULT_FINOPS_BUDGET_ENVELOPE: FinOpsBudgetEnvelope =
  Object.freeze({
    budgetId: "default-permissive",
    budgetVersion: "1.0.0",
    roles: Object.freeze({}),
  }) as FinOpsBudgetEnvelope;

/**
 * Built-in `eu-banking-default` budget profile. Conservative limits suitable
 * for the EU-banking deployment lane: 8k input tokens / 2k output tokens
 * per request, 60s per-request wall-clock, 3 retries, 2 fallback attempts,
 * 5 MiB image cap, ≤ 50% replay-cache miss rate.
 */
export const EU_BANKING_DEFAULT_FINOPS_BUDGET: FinOpsBudgetEnvelope =
  Object.freeze({
    budgetId: "eu-banking-default",
    budgetVersion: "1.0.0",
    maxJobWallClockMs: 5 * 60 * 1000,
    maxReplayCacheMissRate: 0.5,
    roles: Object.freeze({
      test_generation: Object.freeze({
        maxInputTokensPerRequest: 8192,
        maxOutputTokensPerRequest: 2048,
        maxTotalInputTokens: 32768,
        maxTotalOutputTokens: 8192,
        maxWallClockMsPerRequest: 60_000,
        maxTotalWallClockMs: 180_000,
        maxRetriesPerRequest: 3,
        maxAttempts: 6,
      }),
      visual_primary: Object.freeze({
        maxInputTokensPerRequest: 8192,
        maxOutputTokensPerRequest: 1024,
        maxWallClockMsPerRequest: 45_000,
        maxRetriesPerRequest: 2,
        maxAttempts: 4,
        maxImageBytesPerRequest: 5 * 1024 * 1024,
      }),
      visual_fallback: Object.freeze({
        maxInputTokensPerRequest: 8192,
        maxOutputTokensPerRequest: 1024,
        maxWallClockMsPerRequest: 60_000,
        maxRetriesPerRequest: 2,
        maxAttempts: 4,
        maxImageBytesPerRequest: 5 * 1024 * 1024,
        maxFallbackAttempts: 4,
      }),
    }) as FinOpsBudgetEnvelope["roles"],
  }) as FinOpsBudgetEnvelope;

/** Deep-clone an envelope (returns a fresh, mutable copy). */
export const cloneFinOpsBudgetEnvelope = (
  envelope: FinOpsBudgetEnvelope,
): FinOpsBudgetEnvelope => {
  const roles: FinOpsBudgetEnvelope["roles"] = {};
  for (const role of ALLOWED_FINOPS_ROLES) {
    const source = envelope.roles[role];
    if (source !== undefined) {
      roles[role] = cloneRoleBudget(source);
    }
  }
  const cloned: FinOpsBudgetEnvelope = {
    budgetId: envelope.budgetId,
    budgetVersion: envelope.budgetVersion,
    ...(envelope.maxJobWallClockMs !== undefined
      ? { maxJobWallClockMs: envelope.maxJobWallClockMs }
      : {}),
    ...(envelope.maxReplayCacheMissRate !== undefined
      ? { maxReplayCacheMissRate: envelope.maxReplayCacheMissRate }
      : {}),
    ...(envelope.maxEstimatedCost !== undefined
      ? { maxEstimatedCost: envelope.maxEstimatedCost }
      : {}),
    roles,
  };
  return cloned;
};

const cloneRoleBudget = (input: FinOpsRoleBudget): FinOpsRoleBudget => {
  const out: FinOpsRoleBudget = {};
  const keys = [
    "maxInputTokensPerRequest",
    "maxOutputTokensPerRequest",
    "maxTotalInputTokens",
    "maxTotalOutputTokens",
    "maxWallClockMsPerRequest",
    "maxTotalWallClockMs",
    "maxRetriesPerRequest",
    "maxAttempts",
    "maxImageBytesPerRequest",
    "maxFallbackAttempts",
    "maxLiveSmokeCalls",
  ] as const;
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
};

/** Clone the built-in EU-banking budget so callers can mutate without aliasing. */
export const cloneEuBankingDefaultFinOpsBudget = (): FinOpsBudgetEnvelope =>
  cloneFinOpsBudgetEnvelope(EU_BANKING_DEFAULT_FINOPS_BUDGET);

const POSITIVE_INTEGER_FIELDS: ReadonlyArray<keyof FinOpsRoleBudget> = [
  "maxInputTokensPerRequest",
  "maxOutputTokensPerRequest",
  "maxTotalInputTokens",
  "maxTotalOutputTokens",
  "maxWallClockMsPerRequest",
  "maxTotalWallClockMs",
  "maxRetriesPerRequest",
  "maxAttempts",
  "maxImageBytesPerRequest",
  "maxFallbackAttempts",
  "maxLiveSmokeCalls",
];

/**
 * Validate an envelope. Numeric fields must be safe integers ≥ 0 (retries
 * may be 0; tokens/wall-clock must be positive when supplied). The
 * `maxReplayCacheMissRate` must be in `[0, 1]`.
 */
export const validateFinOpsBudgetEnvelope = (
  envelope: FinOpsBudgetEnvelope,
): FinOpsBudgetValidationResult => {
  const errors: FinOpsBudgetValidationIssue[] = [];

  if (typeof envelope.budgetId !== "string" || envelope.budgetId.length === 0) {
    errors.push({
      path: "$.budgetId",
      message: "budgetId must be a non-empty string",
    });
  }
  if (
    typeof envelope.budgetVersion !== "string" ||
    envelope.budgetVersion.length === 0
  ) {
    errors.push({
      path: "$.budgetVersion",
      message: "budgetVersion must be a non-empty string",
    });
  }

  if (envelope.maxJobWallClockMs !== undefined) {
    if (
      !Number.isSafeInteger(envelope.maxJobWallClockMs) ||
      envelope.maxJobWallClockMs <= 0
    ) {
      errors.push({
        path: "$.maxJobWallClockMs",
        message: "maxJobWallClockMs must be a positive safe integer",
      });
    }
  }

  if (envelope.maxReplayCacheMissRate !== undefined) {
    if (
      !Number.isFinite(envelope.maxReplayCacheMissRate) ||
      envelope.maxReplayCacheMissRate < 0 ||
      envelope.maxReplayCacheMissRate > 1
    ) {
      errors.push({
        path: "$.maxReplayCacheMissRate",
        message: "maxReplayCacheMissRate must be a number in [0, 1]",
      });
    }
  }

  if (envelope.maxEstimatedCost !== undefined) {
    if (
      !Number.isFinite(envelope.maxEstimatedCost) ||
      envelope.maxEstimatedCost < 0
    ) {
      errors.push({
        path: "$.maxEstimatedCost",
        message: "maxEstimatedCost must be a non-negative finite number",
      });
    }
  }

  for (const role of ALLOWED_FINOPS_ROLES) {
    const roleBudget = envelope.roles[role];
    if (roleBudget === undefined) continue;
    validateRoleBudget(role, roleBudget, errors);
  }

  // Reject unknown role keys so a typo can't silently drop a budget.
  for (const key of Object.keys(envelope.roles)) {
    if (!ALLOWED_FINOPS_ROLES.includes(key as FinOpsRole)) {
      errors.push({
        path: `$.roles.${key}`,
        message: `roles.${key} is not a known FinOps role`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
};

const validateRoleBudget = (
  role: FinOpsRole,
  budget: FinOpsRoleBudget,
  errors: FinOpsBudgetValidationIssue[],
): void => {
  for (const field of POSITIVE_INTEGER_FIELDS) {
    const value = budget[field];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      errors.push({
        path: `$.roles.${role}.${field}`,
        message: `${field} must be a non-negative safe integer`,
      });
      continue;
    }
    // Token / wall-clock fields must be strictly positive (zero is
    // nonsensical for those budgets); retries / attempts may be 0
    // (operator wants to disable that role's calls entirely).
    if (
      field !== "maxRetriesPerRequest" &&
      field !== "maxAttempts" &&
      field !== "maxFallbackAttempts" &&
      field !== "maxLiveSmokeCalls" &&
      value === 0
    ) {
      errors.push({
        path: `$.roles.${role}.${field}`,
        message: `${field} must be > 0 when supplied`,
      });
    }
  }
  // Visual-only fields don't make sense for test_generation: warn rather
  // than reject so an operator can supply a single shared template.
  if (
    role === "test_generation" &&
    (budget.maxImageBytesPerRequest !== undefined ||
      budget.maxFallbackAttempts !== undefined)
  ) {
    errors.push({
      path: `$.roles.test_generation`,
      message:
        "test_generation does not accept image input or fallback; remove maxImageBytesPerRequest / maxFallbackAttempts",
    });
  }
  // `maxFallbackAttempts` is only meaningful for visual_fallback.
  if (role === "visual_primary" && budget.maxFallbackAttempts !== undefined) {
    errors.push({
      path: `$.roles.visual_primary.maxFallbackAttempts`,
      message:
        "maxFallbackAttempts is only enforced for visual_fallback; move the limit there",
    });
  }
};

/**
 * Resolve the effective per-request limits a gateway client should apply
 * for a role. Convenience helper that returns the fields the gateway
 * actually consumes (`maxInputTokens`, `maxOutputTokens`, `maxWallClockMs`,
 * `maxRetries`).
 */
export interface FinOpsResolvedRequestLimits {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
}

/** Pick the per-request limits the gateway needs from a role budget. */
export const resolveFinOpsRequestLimits = (
  budget: FinOpsRoleBudget | undefined,
): FinOpsResolvedRequestLimits => {
  if (budget === undefined) return {};
  const out: FinOpsResolvedRequestLimits = {};
  if (budget.maxInputTokensPerRequest !== undefined) {
    out.maxInputTokens = budget.maxInputTokensPerRequest;
  }
  if (budget.maxOutputTokensPerRequest !== undefined) {
    out.maxOutputTokens = budget.maxOutputTokensPerRequest;
  }
  if (budget.maxWallClockMsPerRequest !== undefined) {
    out.maxWallClockMs = budget.maxWallClockMsPerRequest;
  }
  if (budget.maxRetriesPerRequest !== undefined) {
    out.maxRetries = budget.maxRetriesPerRequest;
  }
  return out;
};
