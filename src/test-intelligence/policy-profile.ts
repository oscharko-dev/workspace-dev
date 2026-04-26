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
  type TestCasePolicyProfile,
  type TestCasePolicyProfileRules,
} from "../contracts/index.js";

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
  return {
    id: EU_BANKING_DEFAULT_POLICY_PROFILE.id,
    version: EU_BANKING_DEFAULT_POLICY_PROFILE.version,
    description: EU_BANKING_DEFAULT_POLICY_PROFILE.description,
    rules,
  };
};
