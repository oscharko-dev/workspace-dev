/**
 * Four-eyes review policy (Issue #1376).
 *
 * The policy is consulted at review-snapshot seed time to stamp
 * `fourEyesEnforced` and `fourEyesReasons` on every test case. Two
 * inputs drive enforcement:
 *
 *   1. The case's `riskCategory` — operators configure
 *      `fourEyesRequiredRiskCategories`. The default ships
 *      `financial_transaction`, `regulated_data`, and `high`, mapping
 *      the issue's `payment / authorization / identity / regulatory`
 *      surface onto the existing `TestCaseRiskCategory` taxonomy.
 *   2. The visual-sidecar validation report — operators configure
 *      `fourEyesVisualSidecarTriggerOutcomes`. When ANY screen the
 *      case references in `figmaTraceRefs` carries a triggering
 *      outcome, four-eyes is enforced regardless of risk category.
 *      This honours the 2026-04-24 multimodal addendum which calls out
 *      low-confidence visual descriptions, fallback-only execution,
 *      figma-vs-vision conflicts, suspected PII, and
 *      prompt-injection-shaped text.
 *
 * The module is pure and side-effect free: factory + clone +
 * normalize + evaluator. No filesystem, no logging, no telemetry.
 */

import {
  ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS,
  ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES,
  DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES,
  DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS,
  type FourEyesEnforcementReason,
  type FourEyesPolicy,
  type GeneratedTestCase,
  type TestCaseRiskCategory,
  type VisualSidecarValidationOutcome,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";

/** Allowed risk categories surfaced by `TestCaseRiskCategory`. */
const ALLOWED_RISK_CATEGORIES: ReadonlySet<TestCaseRiskCategory> =
  new Set<TestCaseRiskCategory>([
    "low",
    "medium",
    "high",
    "regulated_data",
    "financial_transaction",
  ]);

const ALLOWED_VISUAL_OUTCOMES: ReadonlySet<VisualSidecarValidationOutcome> =
  new Set<VisualSidecarValidationOutcome>(
    ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES,
  );

/** Map a triggering visual outcome to its enforcement reason. */
const VISUAL_OUTCOME_TO_REASON: Readonly<
  Partial<Record<VisualSidecarValidationOutcome, FourEyesEnforcementReason>>
> = {
  low_confidence: "visual_low_confidence",
  fallback_used: "visual_fallback_used",
  possible_pii: "visual_possible_pii",
  prompt_injection_like_text: "visual_prompt_injection",
  conflicts_with_figma_metadata: "visual_metadata_conflict",
};

/** Built-in EU-banking default four-eyes policy (#1376). */
export const EU_BANKING_DEFAULT_FOUR_EYES_POLICY: FourEyesPolicy =
  Object.freeze({
    requiredRiskCategories: Object.freeze(
      DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES.slice().sort(),
    ),
    visualSidecarTriggerOutcomes: Object.freeze(
      DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS.slice().sort(),
    ),
  });

const dedupeAndSort = <T extends string>(values: readonly T[]): T[] => {
  return Array.from(new Set(values)).sort();
};

/** Deep-clone a four-eyes policy with sorted, deduplicated arrays. */
export const cloneFourEyesPolicy = (policy: FourEyesPolicy): FourEyesPolicy => {
  return {
    requiredRiskCategories: dedupeAndSort([...policy.requiredRiskCategories]),
    visualSidecarTriggerOutcomes: dedupeAndSort([
      ...policy.visualSidecarTriggerOutcomes,
    ]),
  };
};

/**
 * Operator-supplied four-eyes config from `WorkspaceStartOptions`. Both
 * arrays are optional; passing `undefined` selects the built-in default
 * for that dimension. Passing an empty array DISABLES the dimension.
 */
export interface ResolveFourEyesPolicyInput {
  fourEyesRequiredRiskCategories?: readonly TestCaseRiskCategory[];
  fourEyesVisualSidecarTriggerOutcomes?: readonly VisualSidecarValidationOutcome[];
}

/**
 * Build a normalized four-eyes policy from the operator-supplied config.
 * Unknown values are dropped silently rather than throwing — `validate`
 * surfaces them as `ValidationIssue[]` for callers that want to log.
 */
export const resolveFourEyesPolicy = (
  input: ResolveFourEyesPolicyInput | undefined,
): FourEyesPolicy => {
  const rawRisk =
    input?.fourEyesRequiredRiskCategories ??
    DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES;
  const rawVisual =
    input?.fourEyesVisualSidecarTriggerOutcomes ??
    DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS;
  const filteredRisk = rawRisk.filter((r) => ALLOWED_RISK_CATEGORIES.has(r));
  const filteredVisual = rawVisual.filter((o) =>
    ALLOWED_VISUAL_OUTCOMES.has(o),
  );
  return {
    requiredRiskCategories: dedupeAndSort([...filteredRisk]),
    visualSidecarTriggerOutcomes: dedupeAndSort([...filteredVisual]),
  };
};

/** Single hand-rolled validation issue (mirrors `src/schemas.ts` style). */
export interface FourEyesPolicyValidationIssue {
  path: string;
  code: "unknown_risk_category" | "unknown_visual_sidecar_outcome";
  message: string;
}

export interface FourEyesPolicyValidationResult {
  ok: boolean;
  issues: FourEyesPolicyValidationIssue[];
}

/**
 * Validate an operator-supplied four-eyes config and report unknown
 * risk categories or outcomes. Does not throw. The store treats unknown
 * entries as no-ops (they are dropped) but a future operator console
 * may want to surface diagnostics.
 */
export const validateFourEyesPolicy = (
  input: ResolveFourEyesPolicyInput | undefined,
): FourEyesPolicyValidationResult => {
  const issues: FourEyesPolicyValidationIssue[] = [];
  const risk = input?.fourEyesRequiredRiskCategories ?? [];
  for (let i = 0; i < risk.length; i += 1) {
    const value = risk[i] as string;
    if (!ALLOWED_RISK_CATEGORIES.has(value as TestCaseRiskCategory)) {
      issues.push({
        path: `fourEyesRequiredRiskCategories[${String(i)}]`,
        code: "unknown_risk_category",
        message: `Unknown risk category "${value}".`,
      });
    }
  }
  const visual = input?.fourEyesVisualSidecarTriggerOutcomes ?? [];
  for (let i = 0; i < visual.length; i += 1) {
    const value = visual[i] as string;
    if (!ALLOWED_VISUAL_OUTCOMES.has(value as VisualSidecarValidationOutcome)) {
      issues.push({
        path: `fourEyesVisualSidecarTriggerOutcomes[${String(i)}]`,
        code: "unknown_visual_sidecar_outcome",
        message: `Unknown visual-sidecar validation outcome "${value}".`,
      });
    }
  }
  return { ok: issues.length === 0, issues };
};

/** Result of evaluating a single test case under a four-eyes policy. */
export interface FourEyesEnforcementEvaluation {
  enforced: boolean;
  /** Sorted, deduplicated list of enforcement reasons. */
  reasons: FourEyesEnforcementReason[];
}

export interface EvaluateFourEyesEnforcementInput {
  testCase: GeneratedTestCase;
  policy: FourEyesPolicy;
  visualReport?: VisualSidecarValidationReport;
}

const collectVisualReasonsForCase = (
  testCase: GeneratedTestCase,
  triggers: readonly VisualSidecarValidationOutcome[],
  visualReport: VisualSidecarValidationReport | undefined,
): Set<FourEyesEnforcementReason> => {
  const reasons = new Set<FourEyesEnforcementReason>();
  if (!visualReport || triggers.length === 0) return reasons;
  if (testCase.figmaTraceRefs.length === 0) return reasons;
  const triggerSet = new Set<VisualSidecarValidationOutcome>(triggers);
  const screenIds = new Set(testCase.figmaTraceRefs.map((ref) => ref.screenId));
  for (const record of visualReport.records) {
    if (!screenIds.has(record.screenId)) continue;
    for (const outcome of record.outcomes) {
      if (!triggerSet.has(outcome)) continue;
      const reason = VISUAL_OUTCOME_TO_REASON[outcome];
      if (reason !== undefined) {
        reasons.add(reason);
      }
    }
  }
  return reasons;
};

/**
 * Evaluate whether four-eyes is enforced for a single test case under
 * the supplied policy. Pure, deterministic, side-effect free.
 */
export const evaluateFourEyesEnforcement = (
  input: EvaluateFourEyesEnforcementInput,
): FourEyesEnforcementEvaluation => {
  const reasons = new Set<FourEyesEnforcementReason>();
  const requiredRiskCategories = new Set<TestCaseRiskCategory>(
    input.policy.requiredRiskCategories,
  );
  if (requiredRiskCategories.has(input.testCase.riskCategory)) {
    reasons.add("risk_category");
  }
  for (const visualReason of collectVisualReasonsForCase(
    input.testCase,
    input.policy.visualSidecarTriggerOutcomes,
    input.visualReport,
  )) {
    reasons.add(visualReason);
  }
  const sortedReasons = Array.from(reasons).sort();
  return { enforced: sortedReasons.length > 0, reasons: sortedReasons };
};

/**
 * Type-narrowing helper: whether a value is a recognised four-eyes
 * enforcement reason. Useful for validators / inspector readers.
 */
export const isFourEyesEnforcementReason = (
  value: unknown,
): value is FourEyesEnforcementReason => {
  return (
    typeof value === "string" &&
    (ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS as readonly string[]).includes(value)
  );
};
