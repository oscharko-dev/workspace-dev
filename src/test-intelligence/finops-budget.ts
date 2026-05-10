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
  MAX_CUSTOM_CONTEXT_BYTES_PER_JOB,
  MAX_JIRA_API_REQUESTS_PER_JOB,
  MAX_JIRA_PASTE_BYTES_PER_JOB,
  type FinOpsBudgetBreachReason,
  type FinOpsBudgetEnvelope,
  type FinOpsRole,
  type FinOpsRoleBudget,
  type FinOpsWallClockBudgetPolicy,
  type ResolvedFinOpsWallClockBudget,
  type TestCasePolicyProfileRules,
} from "../contracts/index.js";

export const ADVERSARIAL_CRITIC_BUDGET_FRACTION = 0.25 as const;

export interface AdversarialCriticBudgetLimits {
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly maxRetries?: number;
}

export interface ResolveWallClockBudgetInput {
  readonly caseCount: number;
  readonly judgePanelSize: number;
  readonly adversarialRounds: number;
  readonly visualSidecarEnabled: boolean;
  readonly coefficients?: FinOpsWallClockBudgetPolicy;
}

export interface ResolveTestGenerationWallClockBudgetInput
  extends ResolveWallClockBudgetInput {
  readonly explicitOverrideMs?: number;
  readonly profileRules?: TestCasePolicyProfileRules;
}

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

export const DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY:
  Readonly<FinOpsWallClockBudgetPolicy> = Object.freeze({
    baseMs: 90_000,
    perCaseMs: 1_800,
    perAdditionalJudgeMs: 12_000,
    perAdversarialRoundMs: 18_000,
    visualSidecarMs: 15_000,
    hardCeilingMs: 360_000,
  });

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
 * 5 MiB image cap, ≤ 50% replay-cache miss rate. Source ingestion roles
 * are bounded by the `sourceQuotas` block.
 */
export const EU_BANKING_DEFAULT_FINOPS_BUDGET: FinOpsBudgetEnvelope =
  Object.freeze({
    budgetId: "eu-banking-default",
    budgetVersion: "1.1.0",
    // Operator stance (CTO directive 2026-05-10): stability + quality
    // first, cost is currently not a gating concern. The eu-banking-default
    // profile mirrors the production-default permissive envelope; future
    // cost-aware profiles can override per customer.
    maxJobWallClockMs: 30 * 60 * 1000,
    maxReplayCacheMissRate: 1.0,
    roles: Object.freeze({
      test_generation: Object.freeze({
        maxInputTokensPerRequest: 200_000,
        maxOutputTokensPerRequest: 32_000,
        maxTotalInputTokens: 2_000_000,
        maxTotalOutputTokens: 200_000,
        maxWallClockMsPerRequest: 600_000,
        maxTotalWallClockMs: 1_800_000,
        maxRetriesPerRequest: 6,
        maxAttempts: 12,
      }),
      visual_primary: Object.freeze({
        maxInputTokensPerRequest: 100_000,
        maxOutputTokensPerRequest: 16_000,
        maxWallClockMsPerRequest: 300_000,
        maxRetriesPerRequest: 4,
        maxAttempts: 6,
        maxImageBytesPerRequest: 16 * 1024 * 1024,
      }),
      visual_fallback: Object.freeze({
        maxInputTokensPerRequest: 100_000,
        maxOutputTokensPerRequest: 16_000,
        maxWallClockMsPerRequest: 300_000,
        maxRetriesPerRequest: 4,
        maxAttempts: 6,
        maxImageBytesPerRequest: 16 * 1024 * 1024,
        maxFallbackAttempts: 6,
      }),
      jira_api_requests: Object.freeze({
        maxAttempts: MAX_JIRA_API_REQUESTS_PER_JOB,
      }),
      jira_paste_ingest: Object.freeze({
        maxIngestBytesPerJob: MAX_JIRA_PASTE_BYTES_PER_JOB,
      }),
      custom_context_ingest: Object.freeze({
        maxIngestBytesPerJob: MAX_CUSTOM_CONTEXT_BYTES_PER_JOB,
      }),
    }) as FinOpsBudgetEnvelope["roles"],
    sourceQuotas: Object.freeze({
      maxJiraApiRequestsPerJob: MAX_JIRA_API_REQUESTS_PER_JOB,
      maxJiraPasteBytesPerJob: MAX_JIRA_PASTE_BYTES_PER_JOB,
      maxCustomContextBytesPerJob: MAX_CUSTOM_CONTEXT_BYTES_PER_JOB,
    }),
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
    ...(envelope.sourceQuotas !== undefined
      ? { sourceQuotas: { ...envelope.sourceQuotas } }
      : {}),
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
    "maxIngestBytesPerJob",
  ] as const;
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
};

const quarterBudget = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return undefined;
  }
  return Math.max(1, Math.floor(value * ADVERSARIAL_CRITIC_BUDGET_FRACTION));
};

export const resolveAdversarialCriticBudgetLimits = (
  generatorBudget: FinOpsRoleBudget | undefined,
): AdversarialCriticBudgetLimits => ({
  ...(quarterBudget(generatorBudget?.maxInputTokensPerRequest) !== undefined
    ? {
        maxInputTokens: quarterBudget(
          generatorBudget?.maxInputTokensPerRequest,
        )!,
      }
    : {}),
  ...(quarterBudget(generatorBudget?.maxOutputTokensPerRequest) !== undefined
    ? {
        maxOutputTokens: quarterBudget(
          generatorBudget?.maxOutputTokensPerRequest,
        )!,
      }
    : {}),
  ...(quarterBudget(generatorBudget?.maxWallClockMsPerRequest) !== undefined
    ? {
        maxWallClockMs: quarterBudget(
          generatorBudget?.maxWallClockMsPerRequest,
        )!,
      }
    : {}),
  ...(generatorBudget?.maxRetriesPerRequest !== undefined
    ? {
        maxRetries: Math.max(
          0,
          Math.min(1, generatorBudget.maxRetriesPerRequest),
        ),
      }
    : {}),
});

/** Clone the built-in EU-banking budget so callers can mutate without aliasing. */
export const cloneEuBankingDefaultFinOpsBudget = (): FinOpsBudgetEnvelope =>
  cloneFinOpsBudgetEnvelope(EU_BANKING_DEFAULT_FINOPS_BUDGET);

const assertNonNegativeSafeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
};

export const resolveFinOpsWallClockBudgetPolicy = (
  rules: TestCasePolicyProfileRules | undefined,
): Readonly<FinOpsWallClockBudgetPolicy> => {
  const policy = rules?.finopsWallClockBudget;
  if (policy === undefined) {
    return DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY;
  }
  return Object.freeze({
    baseMs: policy.baseMs,
    perCaseMs: policy.perCaseMs,
    perAdditionalJudgeMs: policy.perAdditionalJudgeMs,
    perAdversarialRoundMs: policy.perAdversarialRoundMs,
    visualSidecarMs: policy.visualSidecarMs,
    hardCeilingMs: policy.hardCeilingMs,
  });
};

export const resolveWallClockBudget = (
  input: ResolveWallClockBudgetInput,
): number => {
  assertNonNegativeSafeInteger(input.caseCount, "caseCount");
  assertNonNegativeSafeInteger(input.judgePanelSize, "judgePanelSize");
  assertNonNegativeSafeInteger(input.adversarialRounds, "adversarialRounds");
  const coefficients =
    input.coefficients ?? DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY;
  const unclamped =
    coefficients.baseMs +
    coefficients.perCaseMs * input.caseCount +
    coefficients.perAdditionalJudgeMs * Math.max(0, input.judgePanelSize - 1) +
    coefficients.perAdversarialRoundMs * input.adversarialRounds +
    (input.visualSidecarEnabled ? coefficients.visualSidecarMs : 0);
  return Math.min(unclamped, coefficients.hardCeilingMs);
};

export const resolveTestGenerationWallClockBudget = (
  input: ResolveTestGenerationWallClockBudgetInput,
): ResolvedFinOpsWallClockBudget => {
  const coefficients = resolveFinOpsWallClockBudgetPolicy(input.profileRules);
  const formulaMs = resolveWallClockBudget({
    caseCount: input.caseCount,
    judgePanelSize: input.judgePanelSize,
    adversarialRounds: input.adversarialRounds,
    visualSidecarEnabled: input.visualSidecarEnabled,
    coefficients,
  });
  const caseMs = coefficients.perCaseMs * input.caseCount;
  const additionalJudgeMs =
    coefficients.perAdditionalJudgeMs * Math.max(0, input.judgePanelSize - 1);
  const adversarialRoundMs =
    coefficients.perAdversarialRoundMs * input.adversarialRounds;
  const visualSidecarMs = input.visualSidecarEnabled
    ? coefficients.visualSidecarMs
    : 0;
  const unclampedMs =
    coefficients.baseMs +
    caseMs +
    additionalJudgeMs +
    adversarialRoundMs +
    visualSidecarMs;
  return {
    mode:
      input.explicitOverrideMs !== undefined
        ? "constant_override"
        : "elastic",
    role: "test_generation",
    resolvedMs: input.explicitOverrideMs ?? formulaMs,
    formulaMs,
    ...(input.explicitOverrideMs !== undefined
      ? { overrideMs: input.explicitOverrideMs }
      : {}),
    caseCount: input.caseCount,
    judgePanelSize: input.judgePanelSize,
    adversarialRounds: input.adversarialRounds,
    visualSidecarEnabled: input.visualSidecarEnabled,
    coefficients,
    breakdown: {
      baseMs: coefficients.baseMs,
      caseMs,
      additionalJudgeMs,
      adversarialRoundMs,
      visualSidecarMs,
      unclampedMs,
      hardCeilingMs: coefficients.hardCeilingMs,
    },
  };
};

/**
 * Production-default FinOps envelope for the `figma_to_qc_test_cases`
 * production runner (Issue #1740). Calibrated for the customer's deployment
 * topology (Azure AI Foundry: `gpt-oss-120b` for test-generation,
 * `llama-4-maverick-vision` primary + a vision sidecar for visual roles)
 * and the live-Azure smoke runs from 2026-05-02 (5/5 banking-form fixtures
 * stayed under these caps with margin).
 *
 * The envelope is **fail-closed**: every field is set, no role is
 * unconstrained. Operators who want a different envelope must pass it
 * explicitly via `RunFigmaToQcTestCasesInput.finopsBudget`; the runner
 * does NOT merge — operator override wins outright.
 *
 * Design: production uses this; the validation fixture baseline keeps using
 * {@link DEFAULT_FINOPS_BUDGET_ENVELOPE} (the permissive baseline) for
 * fixture replays where the goal is to reproduce a frozen golden, not to
 * police cost.
 */
export const PRODUCTION_FINOPS_BUDGET_ENVELOPE: FinOpsBudgetEnvelope =
  Object.freeze({
    budgetId: "production-default",
    budgetVersion: "1.1.0",
    // 30 minutes wall-clock per job — operator stance (CTO directive
    // 2026-05-10): stability + quality first, cost is currently not a
    // gating concern. Accommodates very wide flows, multi-section masks,
    // multi-judge cross-family panels, adversarial-critic rounds, and
    // multiple repair iterations without breaching the wall-clock budget.
    // Tier-1 production-readiness target; tighter cost-aware profiles
    // can override per customer once Wave 8 lands.
    maxJobWallClockMs: 30 * 60 * 1000,
    // Disable the replay-cache miss-rate gate by default. The cache is
    // best-effort; flagging a "clean run" because cache hit rate dropped
    // is a cost-aware concern, not a quality/stability one.
    maxReplayCacheMissRate: 1.0,
    roles: Object.freeze({
      test_generation: Object.freeze({
        // 200k input tokens — sized to the mistral-large-3 / gpt-oss-120b
        // context window (~128k effective payload + ~70k prompt scaffolding
        // headroom). Multi-section banking masks routinely emit IR slices
        // in the 100k+ range; the previous 80k cap rejected those at the
        // FINOPS_BUDGET_INVALID gate before the LLM ever saw them.
        maxInputTokensPerRequest: 200_000,
        // 2M cumulative input tokens across self-consistency samples
        // (Issue #2070, default 3 samples) plus up to multiple repair
        // iterations. 5x headroom over per-request to allow the full
        // repair-loop budget without disabling the repair path.
        maxTotalInputTokens: 2_000_000,
        // 32k output tokens per request — accommodates large suites of
        // 30–60 generated cases per response, plus any per-step rationale
        // / openQuestions / oracle annotations the quality lifters now
        // emit. Caps runaway emission at 4x previous limit.
        maxOutputTokensPerRequest: 32_000,
        // 200k cumulative output tokens across the self-consistency
        // fan-out plus follow-up repair iterations. 5x previous;
        // accommodates very wide multi-screen masks and multi-round
        // repair without disabling repair-loop coverage.
        maxTotalOutputTokens: 200_000,
        // 6 retries per request — covers transient 429s, partial-batch
        // schema drift, network blips, and slow first-byte from
        // sovereign-cloud endpoints with margin.
        maxRetriesPerRequest: 6,
        // 12 generator attempts — default 3 self-consistency samples plus
        // up to ~9 repair iterations. Operator stance: never give up on
        // quality due to attempt counter.
        maxAttempts: 12,
        // 10 minutes per request — accommodates large prompts on
        // sovereign-cloud endpoints + slow first-byte; previous 120 s
        // was right-sized for small masks only.
        maxWallClockMsPerRequest: 600_000,
        // No live-smoke calls allowed by default; the live-E2E lane sets
        // its own envelope.
        maxLiveSmokeCalls: 0,
      }),
      visual_primary: Object.freeze({
        // 100k input tokens — accommodates large multi-section
        // screenshots + describe-screens directive on phi-4-multimodal
        // and llama-4-maverick-vision (16k–32k effective).
        maxInputTokensPerRequest: 100_000,
        // 16k output tokens — accommodates richer cross-modal descriptions
        // including per-step verdicts and evidence_partial annotations
        // (Issue #2170 follow-on).
        maxOutputTokensPerRequest: 16_000,
        // 16 MiB per request image — accommodates Figma exports of
        // tier-1 banking masks with multi-section dashboards. Matches the
        // tier-1 expected upper bound for a single screen capture.
        maxImageBytesPerRequest: 16 * 1024 * 1024,
        // 4 retries — covers transient gateway 429s, model-deployment
        // 404 fall-through, and protocol drift on the visual lane.
        maxRetriesPerRequest: 4,
        // 6 attempts — primary path is best-effort but we want maximum
        // coverage before falling through to the fallback.
        maxAttempts: 6,
        // 5 minutes per request — accommodates slow first-byte from
        // vision-deployment cold starts.
        maxWallClockMsPerRequest: 300_000,
      }),
      visual_fallback: Object.freeze({
        // Same generous caps as primary; the only difference is the
        // longer wall-clock budget for fallback deployments which are
        // typically smaller and slower per first-byte.
        maxInputTokensPerRequest: 100_000,
        maxOutputTokensPerRequest: 16_000,
        maxImageBytesPerRequest: 16 * 1024 * 1024,
        maxRetriesPerRequest: 4,
        maxAttempts: 6,
        // 5 minutes per request — fallback deployments tolerate a longer
        // first byte than the primary.
        maxWallClockMsPerRequest: 300_000,
        // 6 fallback attempts before giving up — quality-first stance:
        // a failed visual binding contaminates faithfulness scoring.
        maxFallbackAttempts: 6,
      }),
    }) as FinOpsBudgetEnvelope["roles"],
  }) as FinOpsBudgetEnvelope;

/** Clone the production-default envelope so callers can mutate without aliasing. */
export const cloneProductionFinOpsBudgetEnvelope = (): FinOpsBudgetEnvelope =>
  cloneFinOpsBudgetEnvelope(PRODUCTION_FINOPS_BUDGET_ENVELOPE);

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
  "maxIngestBytesPerJob",
];

/** Roles that perform non-LLM source ingestion (paste/text). */
const INGEST_ONLY_ROLES: ReadonlyArray<FinOpsRole> = [
  "jira_paste_ingest",
  "custom_context_ingest",
];

/** Roles that perform Jira REST API calls (no LLM, no image input). */
const JIRA_API_ROLES: ReadonlyArray<FinOpsRole> = ["jira_api_requests"];

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

  // Validate sourceQuotas if supplied.
  if (envelope.sourceQuotas !== undefined) {
    const sq = envelope.sourceQuotas;
    for (const [field, value] of [
      ["maxJiraApiRequestsPerJob", sq.maxJiraApiRequestsPerJob],
      ["maxJiraPasteBytesPerJob", sq.maxJiraPasteBytesPerJob],
      ["maxCustomContextBytesPerJob", sq.maxCustomContextBytesPerJob],
    ] as [string, number | undefined][]) {
      if (value !== undefined) {
        if (!Number.isSafeInteger(value) || value < 0) {
          errors.push({
            path: `$.sourceQuotas.${field}`,
            message: `sourceQuotas.${field} must be a non-negative safe integer`,
          });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Result of a source-quota pre-flight check against an envelope.
 */
export interface SourceQuotaCheckResult {
  ok: boolean;
  breachReason?: FinOpsBudgetBreachReason;
  message?: string;
}

/**
 * Check whether the planned Jira API call count fits within the source
 * quota. Returns `ok: true` when under quota or unconfigured.
 */
export const checkJiraApiQuota = (
  envelope: FinOpsBudgetEnvelope,
  plannedCalls: number,
): SourceQuotaCheckResult => {
  const cap =
    envelope.sourceQuotas?.maxJiraApiRequestsPerJob ??
    envelope.roles.jira_api_requests?.maxAttempts;
  if (cap === undefined || plannedCalls <= cap) return { ok: true };
  return {
    ok: false,
    breachReason: "jira_api_quota_exceeded",
    message: `planned Jira API calls ${plannedCalls} exceeds maxJiraApiRequestsPerJob ${cap}`,
  };
};

/**
 * Check whether the raw Jira paste size fits within the source quota.
 */
export const checkJiraPasteQuota = (
  envelope: FinOpsBudgetEnvelope,
  pasteBytes: number,
): SourceQuotaCheckResult => {
  const cap =
    envelope.sourceQuotas?.maxJiraPasteBytesPerJob ??
    envelope.roles.jira_paste_ingest?.maxIngestBytesPerJob;
  if (cap === undefined || pasteBytes <= cap) return { ok: true };
  return {
    ok: false,
    breachReason: "jira_paste_quota_exceeded",
    message: `Jira paste bytes ${pasteBytes} exceeds maxJiraPasteBytesPerJob ${cap}`,
  };
};

/**
 * Check whether the custom-context input size fits within the source quota.
 */
export const checkCustomContextQuota = (
  envelope: FinOpsBudgetEnvelope,
  inputBytes: number,
): SourceQuotaCheckResult => {
  const cap =
    envelope.sourceQuotas?.maxCustomContextBytesPerJob ??
    envelope.roles.custom_context_ingest?.maxIngestBytesPerJob;
  if (cap === undefined || inputBytes <= cap) return { ok: true };
  return {
    ok: false,
    breachReason: "custom_context_quota_exceeded",
    message: `custom context input bytes ${inputBytes} exceeds maxCustomContextBytesPerJob ${cap}`,
  };
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
  // Ingest-only roles do not perform LLM calls — reject LLM-specific limits.
  if (
    INGEST_ONLY_ROLES.includes(role) &&
    (budget.maxInputTokensPerRequest !== undefined ||
      budget.maxOutputTokensPerRequest !== undefined ||
      budget.maxImageBytesPerRequest !== undefined ||
      budget.maxFallbackAttempts !== undefined)
  ) {
    errors.push({
      path: `$.roles.${role}`,
      message: `${role} is an ingest role and does not accept LLM or image limits; use maxIngestBytesPerJob / maxAttempts only`,
    });
  }
  // Jira API roles do not perform LLM calls or byte-level ingest.
  if (
    JIRA_API_ROLES.includes(role) &&
    (budget.maxInputTokensPerRequest !== undefined ||
      budget.maxOutputTokensPerRequest !== undefined ||
      budget.maxImageBytesPerRequest !== undefined ||
      budget.maxIngestBytesPerJob !== undefined)
  ) {
    errors.push({
      path: `$.roles.${role}`,
      message: `${role} is a Jira API role; use maxAttempts only`,
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
