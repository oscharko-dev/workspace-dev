import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS,
  ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES,
  DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES,
  DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type GeneratedTestCase,
  type TestCaseRiskCategory,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
  cloneFourEyesPolicy,
  evaluateFourEyesEnforcement,
  isFourEyesEnforcementReason,
  resolveFourEyesPolicy,
  validateFourEyesPolicy,
} from "./four-eyes-policy.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "T",
  objective: "O",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do" }],
  expectedResults: [],
  figmaTraceRefs: [{ screenId: "s-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "auto_approved",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

test("four-eyes-policy: EU banking default lists payment/regulated/high (sorted)", () => {
  const policy = EU_BANKING_DEFAULT_FOUR_EYES_POLICY;
  assert.deepEqual([...policy.requiredRiskCategories].sort(), [
    "financial_transaction",
    "high",
    "regulated_data",
  ]);
  assert.deepEqual([...policy.visualSidecarTriggerOutcomes].sort(), [
    "conflicts_with_figma_metadata",
    "fallback_used",
    "low_confidence",
    "possible_pii",
    "prompt_injection_like_text",
  ]);
});

test("four-eyes-policy: cloneFourEyesPolicy dedupes and sorts", () => {
  const cloned = cloneFourEyesPolicy({
    requiredRiskCategories: [
      "high",
      "high",
      "regulated_data",
      "financial_transaction",
    ],
    visualSidecarTriggerOutcomes: ["fallback_used", "low_confidence"],
  });
  assert.deepEqual(cloned.requiredRiskCategories, [
    "financial_transaction",
    "high",
    "regulated_data",
  ]);
  assert.deepEqual(cloned.visualSidecarTriggerOutcomes, [
    "fallback_used",
    "low_confidence",
  ]);
});

test("four-eyes-policy: resolveFourEyesPolicy applies defaults when input is undefined", () => {
  const policy = resolveFourEyesPolicy(undefined);
  assert.deepEqual(
    [...policy.requiredRiskCategories].sort(),
    [...DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES].sort(),
  );
  assert.deepEqual(
    [...policy.visualSidecarTriggerOutcomes].sort(),
    [...DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS].sort(),
  );
});

test("four-eyes-policy: resolveFourEyesPolicy honours empty arrays as DISABLED", () => {
  const policy = resolveFourEyesPolicy({
    fourEyesRequiredRiskCategories: [],
    fourEyesVisualSidecarTriggerOutcomes: [],
  });
  assert.deepEqual(policy.requiredRiskCategories, []);
  assert.deepEqual(policy.visualSidecarTriggerOutcomes, []);
});

test("four-eyes-policy: resolveFourEyesPolicy drops unknown values silently", () => {
  const policy = resolveFourEyesPolicy({
    fourEyesRequiredRiskCategories: [
      "regulated_data",
      "bogus" as unknown as TestCaseRiskCategory,
    ],
    fourEyesVisualSidecarTriggerOutcomes: [
      "ok",
      "not_a_real_outcome" as unknown as (typeof ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES)[number],
    ],
  });
  assert.deepEqual(policy.requiredRiskCategories, ["regulated_data"]);
  assert.deepEqual(policy.visualSidecarTriggerOutcomes, ["ok"]);
});

test("four-eyes-policy: validateFourEyesPolicy reports unknown values", () => {
  const result = validateFourEyesPolicy({
    fourEyesRequiredRiskCategories: [
      "regulated_data",
      "bogus" as unknown as TestCaseRiskCategory,
    ],
    fourEyesVisualSidecarTriggerOutcomes: [
      "wat" as unknown as (typeof ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES)[number],
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0]?.code, "unknown_risk_category");
  assert.equal(result.issues[1]?.code, "unknown_visual_sidecar_outcome");
});

test("four-eyes-policy: evaluate enforces by risk_category", () => {
  const result = evaluateFourEyesEnforcement({
    testCase: buildCase({ riskCategory: "financial_transaction" }),
    policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
  });
  assert.equal(result.enforced, true);
  assert.deepEqual(result.reasons, ["risk_category"]);
});

test("four-eyes-policy: evaluate does not enforce for non-listed risk", () => {
  const result = evaluateFourEyesEnforcement({
    testCase: buildCase({ riskCategory: "low" }),
    policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
  });
  assert.equal(result.enforced, false);
  assert.deepEqual(result.reasons, []);
});

test("four-eyes-policy: evaluate enforces by visual sidecar low_confidence", () => {
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "s-1",
        deployment: "llama-4-maverick-vision",
        outcomes: ["ok", "low_confidence"],
        issues: [],
        meanConfidence: 0.4,
      },
    ],
  };
  const result = evaluateFourEyesEnforcement({
    testCase: buildCase({ riskCategory: "low" }),
    policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    visualReport: visual,
  });
  assert.equal(result.enforced, true);
  assert.deepEqual(result.reasons, ["visual_low_confidence"]);
});

test("four-eyes-policy: evaluate maps each visual outcome to its reason", () => {
  const outcomes = [
    "fallback_used",
    "possible_pii",
    "prompt_injection_like_text",
    "conflicts_with_figma_metadata",
  ] as const;
  const expectedReasons = [
    "visual_fallback_used",
    "visual_possible_pii",
    "visual_prompt_injection",
    "visual_metadata_conflict",
  ] as const;
  for (let i = 0; i < outcomes.length; i += 1) {
    const visual: VisualSidecarValidationReport = {
      schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalScreens: 1,
      screensWithFindings: 1,
      blocked: false,
      records: [
        {
          screenId: "s-1",
          deployment: "llama-4-maverick-vision",
          outcomes: ["ok", outcomes[i] ?? "ok"],
          issues: [],
          meanConfidence: 0.5,
        },
      ],
    };
    const result = evaluateFourEyesEnforcement({
      testCase: buildCase({ riskCategory: "low" }),
      policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
      visualReport: visual,
    });
    assert.equal(result.enforced, true);
    assert.deepEqual(result.reasons, [expectedReasons[i]]);
  }
});

test("four-eyes-policy: evaluate combines risk + visual reasons (sorted)", () => {
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "s-1",
        deployment: "llama-4-maverick-vision",
        outcomes: ["fallback_used", "low_confidence"],
        issues: [],
        meanConfidence: 0.4,
      },
    ],
  };
  const result = evaluateFourEyesEnforcement({
    testCase: buildCase({ riskCategory: "regulated_data" }),
    policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    visualReport: visual,
  });
  assert.equal(result.enforced, true);
  assert.deepEqual(result.reasons, [
    "risk_category",
    "visual_fallback_used",
    "visual_low_confidence",
  ]);
});

test("four-eyes-policy: evaluate ignores visual records for unrelated screens", () => {
  const visual: VisualSidecarValidationReport = {
    schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    generatedAt: GENERATED_AT,
    jobId: "job-1",
    totalScreens: 1,
    screensWithFindings: 1,
    blocked: false,
    records: [
      {
        screenId: "another-screen",
        deployment: "llama-4-maverick-vision",
        outcomes: ["low_confidence"],
        issues: [],
        meanConfidence: 0.4,
      },
    ],
  };
  const result = evaluateFourEyesEnforcement({
    testCase: buildCase({
      figmaTraceRefs: [{ screenId: "s-1" }],
      riskCategory: "low",
    }),
    policy: EU_BANKING_DEFAULT_FOUR_EYES_POLICY,
    visualReport: visual,
  });
  assert.equal(result.enforced, false);
  assert.deepEqual(result.reasons, []);
});

test("four-eyes-policy: isFourEyesEnforcementReason narrows correctly", () => {
  for (const r of ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS) {
    assert.equal(isFourEyesEnforcementReason(r), true);
  }
  assert.equal(isFourEyesEnforcementReason("not-a-reason"), false);
  assert.equal(isFourEyesEnforcementReason(undefined), false);
});
