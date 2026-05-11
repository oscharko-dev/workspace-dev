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
  EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID,
  EU_BANKING_SOVEREIGN_POLICY_PROFILE_VERSION,
  SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
  type FinOpsWallClockBudgetPolicy,
  type JudgeRefusalPolicyConfig,
  type RegionAttestationHostingRegion,
  type TechniqueCoverageMinimumPolicy,
  TIER_ELASTIC_EP_TIERS,
  type TestCasePolicyProfile,
  type TestCasePolicyProfileRules,
} from "../contracts/index.js";
import { DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY } from "./finops-budget.js";

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
 * Issue #2171 extends the default with policy-profile-owned coefficients so
 * the audit-visible formula comes from the profile, not a hidden runtime
 * constant. Customers that contractually require a fixed floor still opt into
 * `{ mode: "fixed" }` on a derived profile.
 */
export const EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM:
  Readonly<TechniqueCoverageMinimumPolicy> = Object.freeze({
    mode: "tier-elastic",
    tiers: TIER_ELASTIC_EP_TIERS,
  });

/**
 * Issue #2070 — secure default self-consistency sample count for the
 * built-in EU banking profile. Three independently seeded samples permit a
 * structural majority vote while keeping runtime bounded.
 */
export const EU_BANKING_DEFAULT_SELF_CONSISTENCY_SAMPLE_COUNT = 3 as const;

/**
 * Issue #2116 — default for the `eu-banking-default` profile's
 * `requirePerStepFaithfulness` rule.
 *
 * The secure default is `false`: a legacy verdict that lacks
 * `stepVerdicts` raises a job-level *warning*
 * (`policy:cross-modal-faithfulness:case-level-fallback`) but does not
 * block the run. Operators that mandate per-step audit evidence flip
 * this to `true` via `cloneEuBankingDefaultProfile()` (or their own
 * profile constructor) so the same condition becomes a blocking error.
 *
 * Pinned as a typed constant so CI catches a drift in the secure
 * default — flipping it here is a deliberate governance decision and
 * must be reviewed alongside the ADR.
 */
export const EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS = false as const;

export const EU_BANKING_DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY:
  Readonly<FinOpsWallClockBudgetPolicy> = DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY;

export const EU_BANKING_DEFAULT_JUDGE_REFUSAL_POLICY:
  Readonly<JudgeRefusalPolicyConfig> = Object.freeze({
    faithfulness: "needs_review",
    a11y: "needs_review",
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
  judgeRefusalPolicy: EU_BANKING_DEFAULT_JUDGE_REFUSAL_POLICY,
  enforceRiskTagDowngradeDetection: true,
  fieldCoverageRatioMin: EU_BANKING_DEFAULT_FIELD_COVERAGE_RATIO_MIN,
  actionCoverageRatioMin: EU_BANKING_DEFAULT_ACTION_COVERAGE_RATIO_MIN,
  negativeCaseLift: {
    gateMode: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_GATE_MODE,
    thresholdRatio: EU_BANKING_DEFAULT_NEGATIVE_CASE_LIFT_THRESHOLD_RATIO,
  },
  techniqueCoverageMinimum: EU_BANKING_DEFAULT_TECHNIQUE_COVERAGE_MINIMUM,
  selfConsistency: {
    sampleCount: EU_BANKING_DEFAULT_SELF_CONSISTENCY_SAMPLE_COUNT,
  },
  requirePerStepFaithfulness: EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS,
  finopsWallClockBudget: EU_BANKING_DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY,
  allowedHostingRegions: SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
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
      judgeRefusalPolicy: EU_BANKING_DEFAULT_JUDGE_REFUSAL_POLICY,
      selfConsistency: Object.freeze({
        sampleCount: EU_BANKING_DEFAULT_SELF_CONSISTENCY_SAMPLE_COUNT,
      }),
      requirePerStepFaithfulness:
        EU_BANKING_DEFAULT_REQUIRE_PER_STEP_FAITHFULNESS,
      finopsWallClockBudget: EU_BANKING_DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY,
      allowedHostingRegions: Object.freeze([
        ...SUPPORTED_REGION_ATTESTATION_HOSTING_REGIONS,
      ]),
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
  const judgeRefusalPolicy =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.judgeRefusalPolicy;
  if (judgeRefusalPolicy !== undefined) {
    rules.judgeRefusalPolicy = {
      faithfulness: judgeRefusalPolicy.faithfulness,
      a11y: judgeRefusalPolicy.a11y,
    };
  }
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
    rules.techniqueCoverageMinimum =
      techniqueCoverageMinimum.mode === "tier-elastic"
        ? {
            mode: "tier-elastic",
            ...(techniqueCoverageMinimum.tiers !== undefined
              ? {
                  tiers: techniqueCoverageMinimum.tiers.map((tier) => ({
                    minFieldCount: tier.minFieldCount,
                    multiplier: tier.multiplier,
                    floor: tier.floor,
                    label: tier.label,
                  })),
                }
              : {}),
          }
        : { mode: "fixed" };
  }
  const selfConsistency = EU_BANKING_DEFAULT_POLICY_PROFILE.rules.selfConsistency;
  if (selfConsistency !== undefined) {
    rules.selfConsistency = {
      sampleCount: selfConsistency.sampleCount,
    };
  }
  const requirePerStepFaithfulness =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.requirePerStepFaithfulness;
  if (requirePerStepFaithfulness !== undefined) {
    rules.requirePerStepFaithfulness = requirePerStepFaithfulness;
  }
  const allowedHostingRegions =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.allowedHostingRegions;
  if (allowedHostingRegions !== undefined) {
    rules.allowedHostingRegions = [...allowedHostingRegions];
  }
  const finopsWallClockBudget =
    EU_BANKING_DEFAULT_POLICY_PROFILE.rules.finopsWallClockBudget;
  if (finopsWallClockBudget !== undefined) {
    rules.finopsWallClockBudget = {
      baseMs: finopsWallClockBudget.baseMs,
      perCaseMs: finopsWallClockBudget.perCaseMs,
      perAdditionalJudgeMs: finopsWallClockBudget.perAdditionalJudgeMs,
      perAdversarialRoundMs: finopsWallClockBudget.perAdversarialRoundMs,
      visualSidecarMs: finopsWallClockBudget.visualSidecarMs,
      hardCeilingMs: finopsWallClockBudget.hardCeilingMs,
    };
  }
  return {
    id: EU_BANKING_DEFAULT_POLICY_PROFILE.id,
    version: EU_BANKING_DEFAULT_POLICY_PROFILE.version,
    description: EU_BANKING_DEFAULT_POLICY_PROFILE.description,
    rules,
  };
};

/**
 * Issue #2187 — description for the `eu-banking-sovereign` profile. The
 * sovereign profile inherits every hard gate and rule from
 * `eu-banking-default`; the difference is **topology**: all LLM calls
 * resolve to an operator-configured sovereign-cloud / on-prem gateway,
 * the harness refuses every non-allow-listed HTTP egress, and the Figma
 * payload arrives pre-fetched from a `figma-export` run on a
 * connected machine.
 */
export const EU_BANKING_SOVEREIGN_POLICY_PROFILE_DESCRIPTION: string =
  "Sovereign-cloud / air-gap deployment profile for DE Sparkassen, Volksbanken, " +
  "and on-prem-only insurers. Inherits the full EU banking compliance gate; all " +
  "LLM calls route through a customer-configured sovereign-cloud gateway, public " +
  "Azure / Figma / cloud-cache egress is refused, and the Figma payload is " +
  "pre-fetched outside the air-gap.";

/**
 * Built-in `eu-banking-sovereign` policy profile (Issue #2187, deep-frozen).
 *
 * Identity (`id` + `version`) is distinct from `eu-banking-default` so
 * audit-dossier signatures and policy-report fingerprints make the
 * deployment topology explicit. The rule set is **byte-identical** to
 * the default profile; sovereign-cloud customers narrow
 * `allowedHostingRegions` via {@link cloneEuBankingSovereignProfile}
 * to the regions covered by their attestation contract.
 */
export const EU_BANKING_SOVEREIGN_POLICY_PROFILE:
  Readonly<TestCasePolicyProfile> = Object.freeze({
    id: EU_BANKING_SOVEREIGN_POLICY_PROFILE_ID,
    version: EU_BANKING_SOVEREIGN_POLICY_PROFILE_VERSION,
    description: EU_BANKING_SOVEREIGN_POLICY_PROFILE_DESCRIPTION,
    rules: EU_BANKING_DEFAULT_POLICY_PROFILE.rules,
  });

/**
 * Return a deep-cloned, mutable copy of the built-in
 * `eu-banking-sovereign` profile. The clone starts from a default-profile
 * clone (so every rule is independently mutable), then overrides
 * identity and description to match the sovereign profile.
 *
 * Optional `allowedHostingRegions` narrows the attested region allow-list
 * to the customer's contracted set — e.g. `["eu-de-1"]` for STACKIT or
 * `["eu-de-1", "eu-fr-1"]` for a STACKIT + OVH sovereign hybrid. When
 * omitted the clone keeps the full EU regional list, which sovereign-
 * cloud operators MUST tighten before running real workloads.
 */
export const cloneEuBankingSovereignProfile = (
  options: {
    readonly allowedHostingRegions?: readonly RegionAttestationHostingRegion[];
  } = {},
): TestCasePolicyProfile => {
  const base = cloneEuBankingDefaultProfile();
  base.id = EU_BANKING_SOVEREIGN_POLICY_PROFILE.id;
  base.version = EU_BANKING_SOVEREIGN_POLICY_PROFILE.version;
  base.description = EU_BANKING_SOVEREIGN_POLICY_PROFILE.description;
  if (options.allowedHostingRegions !== undefined) {
    if (options.allowedHostingRegions.length === 0) {
      throw new RangeError(
        "cloneEuBankingSovereignProfile: allowedHostingRegions must be non-empty; " +
          "sovereign deployments require at least one attested hosting region.",
      );
    }
    base.rules.allowedHostingRegions = [...options.allowedHostingRegions];
  }
  return base;
};
