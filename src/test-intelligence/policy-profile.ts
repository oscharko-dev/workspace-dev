/**
 * Policy profile registry for the test-case policy gate (Issue #1364).
 *
 * Wave 1 ships a single profile, `eu-banking-default`, suitable for
 * regulated EU banking flows: payments, identity, and authorisation
 * surfaces require strong review controls; PII in test data is always
 * blocking; required fields must have at least one negative or validation
 * test; screens with form fields require at least one accessibility case
 * when the policy enables it.
 *
 * Profiles are passed through `policy-gate` by value, so consumers can
 * derive new profiles by spreading the defaults and overriding fields.
 */

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
  type TechniqueCoverageMinimumPolicy,
  type TestCasePolicyProfile,
  type TestCasePolicyProfileRules,
} from "../contracts/index.js";

/**
 * Issue #1901 — minimum job-level field-coverage ratio required by the
 * logic-judge coverage hard-gate. Below this threshold the judge emits
 * the `insufficient_coverage_breadth` finding (severity: error) and the
 * repair-loop is triggered.
 */
export const EU_BANKING_DEFAULT_FIELD_COVERAGE_RATIO_MIN = 0.4 as const;

/**
 * Issue #1901 — minimum job-level action-coverage ratio required by the
 * logic-judge coverage hard-gate. Same emission semantics as
 * {@link EU_BANKING_DEFAULT_FIELD_COVERAGE_RATIO_MIN}.
 */
export const EU_BANKING_DEFAULT_ACTION_COVERAGE_RATIO_MIN = 0.5 as const;

/**
 * Issue #2053 — relative negative-case-ratio improvement threshold the
 * adversarial-critic `G-NEG-CASE` hard gate enforces by default. Mirrors
 * the in-module `ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD`
 * constant in `adversarial-critic-agent.ts`; both values are kept in
 * sync via `policy-profile.test.ts`.
 */
export const EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO =
  0.3 as const;

/**
 * Issue #2053 — default gate mode for `G-NEG-CASE` on the
 * `eu-banking-default` profile. The secure default is `"enforce"` so
 * audit-grade runs fail closed when the adversarial-critic loop fails
 * to lift the negative-case ratio by the configured threshold.
 * Operators who want a record-only behaviour for fast iterative local
 * runs override this to `"advisory"` (or `"off"`) on a derived profile.
 */
export const EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE =
  "enforce" as const;

/**
 * Issue #2068 — default `policy:technique-coverage-minimum` resolution
 * mode for `eu-banking-default`. The secure default is `"tier-elastic"`
 * so the gate scales the equivalence-partitioning floor with the
 * screen's coverage-relevant field count instead of trapping
 * small-field screens (`<= 8` fields) at the legacy 12-EP minimum.
 *
 * Customers that contractually require a fixed floor opt into
 * `{ mode: "fixed" }` on a derived profile.
 */
export const EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM:
  Readonly<TechniqueCoverageMinimumPolicy> = Object.freeze({
    mode: "tier-elastic",
  });

const EU_BANKING_DEFAULT_RULES: TestCasePolicyProfileRules = {
  reviewOnlyRiskCategories: ["regulated_data", "financial_transaction"],
  strictRiskCategories: ["regulated_data", "financial_transaction", "high"],
  requireAccessibilityCaseWhenFormPresent: true,
  requireNegativeOrValidationForValidationRules: true,
  requireBoundaryCaseForRequiredFields: true,
  minConfidence: 0.6,
  duplicateSimilarityThreshold: 0.92,
  maxOpenQuestionsPerCase: 5,
  maxAssumptionsPerCase: 8,
  enforceRiskTagDowngradeDetection: true,
  fieldCoverageRatioMin: EU_BANKING_DEFAULT_FIELD_COVERAGE_RATIO_MIN,
  actionCoverageRatioMin: EU_BANKING_DEFAULT_ACTION_COVERAGE_RATIO_MIN,
  negativeCaseLift: {
    gateMode: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
    thresholdRatio: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
  },
  techniqueCoverageMinimum: EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM,
};

/** Default `eu-banking-default` policy profile (deep-frozen). */
export const EU_BANKING_DEFAULT_POLICY_PROFILE: Readonly<TestCasePolicyProfile> =
  Object.freeze({
    id: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    version: EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION,
    description:
      "Default EU banking compliance gate: PII blocks export, regulated/financial risk requires review, required fields must have negative/validation/boundary cases, accessibility is required when form fields are present.",
    rules: Object.freeze({
      ...EU_BANKING_DEFAULT_RULES,
      reviewOnlyRiskCategories: Object.freeze([
        ...EU_BANKING_DEFAULT_RULES.reviewOnlyRiskCategories,
      ]) as TestCasePolicyProfileRules["reviewOnlyRiskCategories"],
      strictRiskCategories: Object.freeze([
        ...EU_BANKING_DEFAULT_RULES.strictRiskCategories,
      ]) as TestCasePolicyProfileRules["strictRiskCategories"],
      negativeCaseLift: Object.freeze({
        gateMode: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
        thresholdRatio: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
      }),
      techniqueCoverageMinimum: EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM,
    }),
  });

/**
 * Return a deep-cloned, mutable copy of the built-in `eu-banking-default`
 * profile so callers can override individual rules without mutating the
 * frozen module-level constant.
 */
export const cloneEuBankingDefaultProfile = (): TestCasePolicyProfile => {
  const rules: TestCasePolicyProfileRules = {
    reviewOnlyRiskCategories: [
      ...EU_BANKING_DEFAULT_POLICY_PROFILE.rules.reviewOnlyRiskCategories,
    ],
    strictRiskCategories: [
      ...EU_BANKING_DEFAULT_POLICY_PROFILE.rules.strictRiskCategories,
    ],
    requireAccessibilityCaseWhenFormPresent:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules
        .requireAccessibilityCaseWhenFormPresent,
    requireNegativeOrValidationForValidationRules:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules
        .requireNegativeOrValidationForValidationRules,
    requireBoundaryCaseForRequiredFields:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules
        .requireBoundaryCaseForRequiredFields,
    minConfidence: EU_BANKING_DEFAULT_POLICY_PROFILE.rules.minConfidence,
    duplicateSimilarityThreshold:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules.duplicateSimilarityThreshold,
    maxOpenQuestionsPerCase:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules.maxOpenQuestionsPerCase,
    maxAssumptionsPerCase:
      EU_BANKING_DEFAULT_POLICY_PROFILE.rules.maxAssumptionsPerCase,
  };
  // Preserve the optional flag only when the source has it set, so callers
  // that explicitly set `false` round-trip cleanly under
  // `exactOptionalPropertyTypes`.
  const enforceFlag =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.enforceRiskTagDowngradeDetection;
  if (enforceFlag !== undefined) {
    rules.enforceRiskTagDowngradeDetection = enforceFlag;
  }
  const fieldCoverageRatioMin =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.fieldCoverageRatioMin;
  if (fieldCoverageRatioMin !== undefined) {
    rules.fieldCoverageRatioMin = fieldCoverageRatioMin;
  }
  const actionCoverageRatioMin =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.actionCoverageRatioMin;
  if (actionCoverageRatioMin !== undefined) {
    rules.actionCoverageRatioMin = actionCoverageRatioMin;
  }
  const negativeCaseLift =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.negativeCaseLift;
  if (negativeCaseLift !== undefined) {
    rules.negativeCaseLift = {
      gateMode: negativeCaseLift.gateMode,
      thresholdRatio: negativeCaseLift.thresholdRatio,
    };
  }
  const techniqueCoverageMinimum =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.techniqueCoverageMinimum;
  if (techniqueCoverageMinimum !== undefined) {
    rules.techniqueCoverageMinimum = {
      mode: techniqueCoverageMinimum.mode,
    };
  }
  return {
    id: EU_BANKING_DEFAULT_POLICY_PROFILE.id,
    version: EU_BANKING_DEFAULT_POLICY_PROFILE.version,
    description: EU_BANKING_DEFAULT_POLICY_PROFILE.description,
    rules,
  };
};
