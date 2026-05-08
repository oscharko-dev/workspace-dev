import assert from "node:assert/strict";
import test from "node:test";
import {
  A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  A11Y_VERDICT_SCHEMA_VERSION,
  COVERAGE_PLAN_SCHEMA_VERSION,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type A11yVerdict,
  type CoveragePlan,
  type BusinessTestIntentIr,
  type FaithfulnessVerdict,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  evaluatePolicyGate,
  pruneResolvedMultiSourceConflictViolations,
} from "./policy-gate.js";
import { cloneEuBankingDefaultProfile } from "./policy-profile.js";
import { computeCoverageReport } from "./test-case-coverage.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Submit form",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open" },
    { index: 2, action: "Submit", expected: "Receipt rendered" },
  ],
  expectedResults: ["Receipt rendered"],
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
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildAccessibilityCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase =>
  buildCase({
    type: "accessibility",
    title: "Form accessibility covers keyboard navigation, focus order, and screen-reader announcements",
    objective:
      "Confirm keyboard navigation, focus order, and screen-reader announcements for the form.",
    steps: [
      {
        index: 1,
        action: "Tab through every control using only the keyboard",
        expected: "Keyboard navigation reaches every control in a logical order",
      },
      {
        index: 2,
        action: "Verify focus order and visible focus indicator while tabbing",
        expected: "Focus order stays logical and every control shows a visible focus indicator",
      },
      {
        index: 3,
        action: "Trigger validation errors with a screen reader enabled",
        expected:
          "Validation messages are announced via aria-live and each control announces a meaningful label",
      },
    ],
    expectedResults: [
      "Keyboard navigation reaches every control in a logical order",
      "Focus order stays logical and every control shows a visible focus indicator",
      "Validation messages are announced via aria-live and each control announces a meaningful label",
    ],
    ...overrides,
  });

const buildIntent = (
  overrides: Partial<BusinessTestIntentIr> = {},
): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [{ screenId: "s-1", screenName: "Form", trace: { nodeId: "s-1" } }],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
  ...overrides,
});

const buildCoveragePlan = (
  overrides: Partial<CoveragePlan> = {},
): CoveragePlan => ({
  schemaVersion: COVERAGE_PLAN_SCHEMA_VERSION,
  jobId: "job-1",
  perScreen: [
    {
      screenId: "s-1",
      techniqueQuotas: [{ technique: "boundary_value_analysis", minCount: 1 }],
    },
  ],
  perElement: [],
  minimumCases: [],
  recommendedCases: [],
  mutationKillRateTarget: 0.85,
  ...overrides,
});

const harness = (cases: GeneratedTestCase[], intent: BusinessTestIntentIr) => {
  const list: GeneratedTestCaseList = {
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    jobId: "job-1",
    testCases: cases,
  };
  const profile = cloneEuBankingDefaultProfile();
  const validation = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
  });
  const coverage = computeCoverageReport({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    policyProfileId: profile.id,
    list,
    intent,
    duplicateSimilarityThreshold: profile.rules.duplicateSimilarityThreshold,
  });
  return { list, intent, profile, validation, coverage };
};

const buildFaithfulnessVerdict = (
  overrides: Partial<FaithfulnessVerdict> = {},
): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  cacheHit: false,
  cacheKeyDigest: ZERO,
  modelDeployment: "llama-4-maverick-vision",
  modelRevision: "llama-4-maverick-vision@test",
  gatewayRelease: "mock",
  fallbackReason: "none",
  score: 1,
  verdict: "accept",
  hallucinations: [],
  mismatches: [],
  ...overrides,
});

const buildA11yVerdict = (
  overrides: Partial<A11yVerdict> = {},
): A11yVerdict => ({
  schemaVersion: A11Y_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  cacheHit: false,
  cacheKeyDigest: ZERO,
  modelDeployment: "phi-4-multimodal-instruct",
  modelRevision: "phi-4-multimodal-instruct@test",
  gatewayRelease: "mock",
  verdict: "accept",
  criteria: [],
  findings: [],
  repairInstructions: [],
  ...overrides,
});

test("regulated risk category triggers needs_review", () => {
  const tc = buildCase({ riskCategory: "regulated_data" });
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.policyProfileId, EU_BANKING_DEFAULT_POLICY_PROFILE_ID);
  assert.equal(report.decisions[0]?.decision, "needs_review");
});

test("missing trace blocks the case", () => {
  const tc = buildCase({ figmaTraceRefs: [] });
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.blocked, true);
  assert.equal(report.decisions[0]?.decision, "blocked");
});

test("PII in test data blocks the case", () => {
  const tc = buildCase({ testData: ["jane.doe@example.com"] });
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "pii_in_test_data",
    ),
  );
});

test("missing accessibility case for form screens raises a job-level violation", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness([buildCase({})], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.ok(
    report.jobLevelViolations.some(
      (v) => v.outcome === "missing_accessibility_case",
    ),
  );
  assert.equal(report.blocked, true);
});

test("Issue #1951: missing screen-reader coverage on a form-screen accessibility case blocks the job", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness(
    [
      buildAccessibilityCase({
        id: "tc-a11y",
        title: "Form accessibility covers keyboard navigation and focus order",
        objective: "Confirm keyboard navigation and focus order on the form.",
        steps: [
          {
            index: 1,
            action: "Tab through every control using only the keyboard",
            expected: "Keyboard navigation reaches every control in a logical order",
          },
          {
            index: 2,
            action: "Verify focus order and visible focus indicator while tabbing",
            expected: "Focus order stays logical and every control shows a visible focus indicator",
          },
        ],
        expectedResults: [
          "Keyboard navigation reaches every control in a logical order",
          "Focus order stays logical and every control shows a visible focus indicator",
        ],
      }),
    ],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:form-screen-needs-accessibility-case",
  );
  assert.equal(violation?.outcome, "missing_accessibility_case");
  assert.match(violation?.reason ?? "", /screen-reader/u);
  assert.equal(report.blocked, true);
});

test("Issue #1794: banking profile blocks when an active model binding is missing ictRegisterRef", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    activeModelBindings: [
      {
        providerId: "llm-gateway",
        modelId: "gpt-oss-120b@test",
        inferenceProfileId: "gpt-oss-120b",
      },
      {
        providerId: "llm-gateway",
        modelId: "llama-4-maverick-vision@test",
        inferenceProfileId: "llama-4-maverick-vision",
        ictRegisterRef: "ICT-LLAMA-01",
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.outcome === "ict_register_ref_required",
  );
  assert.ok(violation, "expected banking ICT register violation");
  assert.equal(violation?.severity, "error");
  assert.match(violation?.reason ?? "", /ict_register_ref_required/);
  assert.equal(report.blocked, true);
});

test("Issue #2069: both_sidecars_failed is a blocking job-level error by default", () => {
  const tc = buildCase({});
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    visualSidecarRefusal: {
      failureClass: "both_sidecars_failed",
      failureMessage:
        "both_sidecars_failed: primary llama-4-maverick-vision (rate_limited), fallback phi-4-multimodal-poc (gateway_timeout)",
    },
  });

  // Default refusal handling is job-level only: the case stays approved.
  assert.equal(report.decisions[0]?.decision, "approved");
  const caseViolation = report.decisions[0]?.violations.find(
    (v) => v.rule === "policy:visual-sidecar-refused",
  );
  assert.equal(caseViolation, undefined);

  // Job-level: the missing visual evidence blocks the job, even though the
  // case-level decisions stay untouched unless visual verification is required.
  const jobViolation = report.jobLevelViolations.find(
    (v) => v.rule === "policy:visual-sidecar:both_failed",
  );
  assert.ok(jobViolation, "job-level refusal violation must be present");
  assert.equal(jobViolation?.outcome, "visual_sidecar_both_failed");
  assert.equal(jobViolation?.severity, "error");

  // Counts stay on the approved path when the run does not require
  // visual verification.
  assert.equal(report.needsReviewCount, 0);
  assert.equal(report.blockedCount, 0);
  assert.equal(report.approvedCount, 1);
  assert.equal(report.blocked, true);
});

test("Issue #2069: visual verification required blocks the case when both sidecars fail", () => {
  const tc = buildCase({});
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    visualSidecarRefusal: {
      failureClass: "both_sidecars_failed",
      failureMessage:
        "both_sidecars_failed: primary llama-4-maverick-vision (rate_limited), fallback phi-4-multimodal-poc (gateway_timeout)",
    },
    visualVerificationRequired: true,
  });

  assert.equal(report.decisions[0]?.decision, "blocked");
  const caseViolation = report.decisions[0]?.violations.find(
    (v) => v.rule === "policy:visual-sidecar:both_failed",
  );
  assert.ok(caseViolation, "per-case refusal violation must be present");
  assert.equal(caseViolation?.outcome, "visual_sidecar_both_failed");
  assert.equal(caseViolation?.severity, "error");
  assert.match(caseViolation?.reason ?? "", /both_sidecars_failed/);
  assert.equal(report.needsReviewCount, 0);
  assert.equal(report.blockedCount, 1);
  assert.equal(report.approvedCount, 0);
  assert.equal(report.blocked, true);
});

test("Issue #2069: fallback-recovered visual sidecar emits info-only policy evidence", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    visual: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      visualSidecarSchemaVersion: "1.0.0",
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalScreens: 1,
      screensWithFindings: 1,
      blocked: false,
      records: [
        {
          screenId: "s-1",
          deployment: "phi-4-multimodal-poc",
          outcomes: ["fallback_used"],
          issues: [],
          meanConfidence: 0.95,
        },
      ],
    },
  });
  const jobViolation = report.jobLevelViolations.find(
    (v) => v.rule === "policy:visual-sidecar:fallback_used",
  );
  assert.ok(jobViolation);
  assert.equal(
    jobViolation?.outcome,
    "visual_sidecar_fallback_used_succeeded",
  );
  assert.equal(jobViolation?.severity, "info");
  assert.equal(report.blocked, false);
  assert.equal(report.approvedCount, 1);
});

test("resolved multi-source conflicts are pruned before policy blockers are counted", () => {
  const report = pruneResolvedMultiSourceConflictViolations({
    report: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      policyProfileVersion: "1.0.0",
      totalTestCases: 1,
      approvedCount: 0,
      blockedCount: 0,
      needsReviewCount: 1,
      blocked: false,
      decisions: [
        {
          testCaseId: "tc-1",
          decision: "needs_review",
          violations: [
            {
              rule: "policy:multi-source-conflict-present",
              outcome: "multi_source_conflict_present",
              severity: "warning",
              reason: "multi-source conflict(s) conflict-1 affect this case",
            },
          ],
        },
      ],
      jobLevelViolations: [
        {
          rule: "policy:multi-source-conflict-present",
          outcome: "multi_source_conflict_present",
          severity: "warning",
          reason: "multi-source conflict artifact present: conflict-1",
        },
      ],
    },
    isConflictResolved: (conflictId) => conflictId === "conflict-1",
  });
  assert.equal(report.decisions[0]?.decision, "approved");
  assert.equal(report.decisions[0]?.violations.length, 0);
  assert.equal(report.jobLevelViolations.length, 0);
  assert.equal(report.approvedCount, 1);
  assert.equal(report.needsReviewCount, 0);
});

test("required field with negative coverage satisfies the rule", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-iban",
        screenId: "s-1",
        trace: { nodeId: "n2" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "IBAN",
        type: "text",
      },
    ],
    detectedValidations: [
      {
        id: "v-iban-required",
        screenId: "s-1",
        trace: { nodeId: "n2" },
        provenance: "figma_node",
        confidence: 0.85,
        rule: "Required",
        targetFieldId: "f-iban",
      },
    ],
  });
  const cases = [
    buildCase({ id: "tc-pos" }),
    buildCase({
      id: "tc-neg",
      type: "negative",
      title: "Reject empty IBAN",
      qualitySignals: {
        coveredFieldIds: ["f-iban"],
        coveredActionIds: [],
        coveredValidationIds: ["v-iban-required"],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    buildAccessibilityCase({
      id: "tc-a11y",
    }),
  ];
  const ctx = harness(cases, intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(
    report.jobLevelViolations.filter(
      (v) => v.outcome === "missing_negative_or_validation_for_required_field",
    ).length,
    0,
  );
});

test("missing negative or validation coverage for a required field blocks the job", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-iban",
        screenId: "s-1",
        trace: { nodeId: "n2" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "IBAN",
        type: "text",
      },
    ],
    detectedValidations: [
      {
        id: "v-iban-required",
        screenId: "s-1",
        trace: { nodeId: "n2" },
        provenance: "figma_node",
        confidence: 0.85,
        rule: "Required",
        targetFieldId: "f-iban",
      },
    ],
  });
  const ctx = harness(
    [
      buildCase({ id: "tc-pos" }),
      buildAccessibilityCase({
        id: "tc-a11y",
      }),
    ],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.jobLevelViolations.some(
      (v) => v.outcome === "missing_negative_or_validation_for_required_field",
    ),
  );
});

test("Issue #1947: unmet technique quotas block the job at the policy gate", () => {
  const ctx = harness([buildCase({ id: "tc-use-case" })], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan(),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:technique-coverage-minimum",
  );
  assert.ok(violation, "expected technique quota violation");
  assert.equal(violation?.outcome, "technique_quota_breach");
  assert.equal(violation?.severity, "error");
  assert.match(violation?.reason ?? "", /boundary_value_analysis/);
  assert.equal(report.blocked, true);
});

test("Issue #2068: tier-elastic mode replaces a fixed 12-EP planner quota on a 9-field K0 screen with the field-count floor", () => {
  const ctx = harness(
    Array.from({ length: 10 }, (_, idx) =>
      buildCase({
        id: `tc-ep-${idx + 1}`,
        technique: "equivalence_partitioning",
      }),
    ),
    buildIntent(),
  );
  const coveragePlan = buildCoveragePlan({
    perScreen: [
      {
        screenId: "s-1",
        techniqueQuotas: [
          { technique: "equivalence_partitioning", minCount: 12 },
        ],
      },
    ],
    perElement: Array.from({ length: 9 }, (_, idx) => ({
      screenId: "s-1",
      elementId: `s-1.field-${idx + 1}`,
      mustHaveCase: true,
      riskClass: "low" as const,
    })),
  });
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan,
  });
  assert.equal(
    report.jobLevelViolations.find(
      (entry) => entry.rule === "policy:technique-coverage-minimum",
    ),
    undefined,
    "tier-elastic mode should clear the 12-EP quota on a 9-field screen",
  );
});

test("Issue #2068: fixed override on a derived profile preserves the legacy 12-EP minimum", () => {
  const ctx = harness(
    Array.from({ length: 10 }, (_, idx) =>
      buildCase({
        id: `tc-ep-${idx + 1}`,
        technique: "equivalence_partitioning",
      }),
    ),
    buildIntent(),
  );
  ctx.profile.rules.techniqueCoverageMinimum = { mode: "fixed" };
  const coveragePlan = buildCoveragePlan({
    perScreen: [
      {
        screenId: "s-1",
        techniqueQuotas: [
          { technique: "equivalence_partitioning", minCount: 12 },
        ],
      },
    ],
    perElement: Array.from({ length: 9 }, (_, idx) => ({
      screenId: "s-1",
      elementId: `s-1.field-${idx + 1}`,
      mustHaveCase: true,
      riskClass: "low" as const,
    })),
  });
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan,
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:technique-coverage-minimum",
  );
  assert.ok(violation, "fixed mode should still flag the 12-EP deficit");
  assert.match(violation?.reason ?? "", /at least 12 "equivalence_partitioning"/);
});

test("Issue #1947: policy override can downgrade technique coverage minimum to warning", () => {
  const ctx = harness([buildCase({ id: "tc-use-case" })], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan(),
    policyOverrides: [
      {
        ruleId: "policy:technique-coverage-minimum",
        severity: "warning",
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:technique-coverage-minimum",
  );
  assert.ok(violation, "expected technique quota violation");
  assert.equal(violation?.severity, "warning");
  assert.equal(report.blocked, false);
});

test("Issue #1949: cross-modal faithfulness score below the gray-zone floor blocks every case", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    faithfulnessVerdict: buildFaithfulnessVerdict({
      score: 0.74,
      verdict: "repair",
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:cross-modal-faithfulness-score",
  );
  assert.equal(violation?.severity, "error");
  assert.equal(report.decisions[0]?.decision, "blocked");
  assert.equal(report.blocked, true);
});

test("Issue #1949: cross-modal faithfulness score in the gray zone routes to needs_review", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    faithfulnessVerdict: buildFaithfulnessVerdict({
      score: 0.76,
      verdict: "repair",
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:cross-modal-faithfulness-score",
  );
  assert.equal(violation?.severity, "warning");
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.equal(report.blocked, false);
});

test("Issue #2066: stepVerdicts override the case-level score so all-evidence_partial label-only steps clear the 0.80 floor", () => {
  const ctx = harness(
    [
      buildCase({
        steps: [
          { index: 1, action: "Open the loan form" },
          { index: 2, action: "See the introductory paragraph" },
          { index: 3, action: "Confirm the disclosure copy is displayed" },
        ],
      }),
    ],
    buildIntent(),
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    // Legacy score wired below the floor — would have blocked under v1.
    faithfulnessVerdict: buildFaithfulnessVerdict({
      score: 0.5,
      verdict: "accept",
      stepVerdicts: [
        {
          testCaseId: "tc",
          stepIndex: 1,
          verdict: "evidence_partial",
          message: "label visible; full description below the fold",
        },
        {
          testCaseId: "tc",
          stepIndex: 2,
          verdict: "evidence_partial",
          message: "heading consistent; supporting copy not in capture",
        },
        {
          testCaseId: "tc",
          stepIndex: 3,
          verdict: "evidence_partial",
          message: "disclosure marker visible; long-form copy in linked PDF",
        },
      ],
    }),
  });
  // Under the v2 rubric the tier-aware aggregate is 0.85 → above the
  // 0.80 floor, so the gate must NOT emit a faithfulness violation.
  assert.equal(
    report.jobLevelViolations.some(
      (entry) => entry.rule === "policy:cross-modal-faithfulness-score",
    ),
    false,
  );
  assert.equal(report.decisions[0]?.decision, "approved");
  assert.equal(report.blocked, false);
});

test("Issue #2066: a positive step mismatch still blocks even when the legacy score is high", () => {
  const ctx = harness(
    [
      buildCase({
        steps: [
          { index: 1, action: "Enter amount", data: "100", expected: "Field accepts" },
          { index: 2, action: "See receipt" },
        ],
      }),
    ],
    buildIntent(),
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    faithfulnessVerdict: buildFaithfulnessVerdict({
      score: 1,
      verdict: "repair",
      stepVerdicts: [
        {
          testCaseId: "tc",
          stepIndex: 1,
          verdict: "mismatch",
          message: "amount field rendered red instead of accepted",
        },
        {
          testCaseId: "tc",
          stepIndex: 2,
          verdict: "match",
          message: "receipt heading visible",
        },
      ],
    }),
  });
  // Tier-aware aggregate: (0 + 1)/2 = 0.5 → below 0.75 floor → error.
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:cross-modal-faithfulness-score",
  );
  assert.equal(violation?.severity, "error");
  assert.equal(report.blocked, true);
});

test("Issue #1949: policy override threshold can relax the cross-modal faithfulness gate", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    faithfulnessVerdict: buildFaithfulnessVerdict({
      score: 0.74,
      verdict: "repair",
    }),
    policyOverrides: [
      {
        ruleId: "policy:cross-modal-faithfulness-score",
        severity: "warning",
        threshold: 0.7,
      },
    ],
  });
  assert.equal(
    report.jobLevelViolations.some(
      (entry) => entry.rule === "policy:cross-modal-faithfulness-score",
    ),
    false,
  );
  assert.equal(report.decisions[0]?.decision, "approved");
  assert.equal(report.blocked, false);
});

test("low confidence triggers needs_review", () => {
  const tc = buildCase({
    qualitySignals: {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.4,
    },
  });
  const ctx = harness([tc], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.ok(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "low_confidence_review_required",
    ),
  );
});

test("visual sidecar prompt-injection text is propagated as job-level error", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    visual: {
      schemaVersion: "1.0.0",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      visualSidecarSchemaVersion: "1.0.0",
      generatedAt: GENERATED_AT,
      jobId: "job-1",
      totalScreens: 1,
      screensWithFindings: 1,
      blocked: true,
      records: [
        {
          screenId: "s-1",
          deployment: "llama-4-maverick-vision",
          outcomes: ["prompt_injection_like_text"],
          issues: [],
          meanConfidence: 0.9,
        },
      ],
    },
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.jobLevelViolations.some(
      (v) => v.outcome === "visual_sidecar_prompt_injection_text",
    ),
  );
});

test("counters reflect mixed decisions deterministically", () => {
  const cases = [
    buildCase({ id: "tc-1" }),
    buildCase({ id: "tc-2", figmaTraceRefs: [] }),
    buildCase({ id: "tc-3", riskCategory: "regulated_data" }),
  ];
  const ctx = harness(cases, buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.totalTestCases, 3);
  assert.equal(
    report.approvedCount + report.blockedCount + report.needsReviewCount,
    3,
  );
  assert.equal(report.blockedCount, 1);
  assert.equal(report.needsReviewCount, 1);
});

test("Issue #1412: low-tagged case under regulated intent raises risk_tag_downgrade_detected per-case and job-level", () => {
  const intent = buildIntent({ risks: ["regulated_data"] });
  const ctx = harness([buildCase({ riskCategory: "low" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.equal(report.blocked, false);

  const perCase = report.decisions[0]?.violations.find(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.ok(perCase, "per-case downgrade violation present");
  assert.equal(perCase.severity, "warning");
  assert.equal(perCase.rule, "policy:risk-tag-downgrade-detected");

  const job = report.jobLevelViolations.find(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.ok(job, "job-level downgrade violation present");
  assert.equal(job.severity, "warning");
});

test("Issue #1412: high-tagged case under regulated intent still flagged (high is outside review-only set)", () => {
  const intent = buildIntent({ risks: ["regulated_data"] });
  const ctx = harness([buildCase({ riskCategory: "high" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.ok(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
  );
});

test("Issue #1412: regulated_data-tagged case does not raise downgrade detection", () => {
  const intent = buildIntent({ risks: ["regulated_data"] });
  const ctx = harness([buildCase({ riskCategory: "regulated_data" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
    false,
  );
  assert.equal(
    report.jobLevelViolations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
    false,
  );
});

test("Issue #1412: financial intent classifies a low-tagged case as downgraded", () => {
  const intent = buildIntent({ risks: ["payment processing"] });
  const ctx = harness([buildCase({ riskCategory: "low" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  const perCase = report.decisions[0]?.violations.find(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.ok(perCase);
  assert.match(perCase.reason, /financial_transaction/);
});

test("Issue #1412: PII bound to a different screen does not flag the case", () => {
  const intent = buildIntent({
    screens: [
      { screenId: "s-1", screenName: "Login", trace: { nodeId: "s-1" } },
      { screenId: "s-2", screenName: "Profile", trace: { nodeId: "s-2" } },
    ],
    piiIndicators: [
      {
        id: "pii-1",
        kind: "email",
        confidence: 0.9,
        matchLocation: "label",
        redacted: "[REDACTED:email]",
        screenId: "s-2",
      },
    ],
  });
  const ctx = harness(
    [buildCase({ riskCategory: "low", figmaTraceRefs: [{ screenId: "s-1" }] })],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.equal(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
    false,
  );
});

test("Issue #1412: PII bound to the referenced screen flags a low-tagged case", () => {
  const intent = buildIntent({
    screens: [
      { screenId: "s-1", screenName: "Login", trace: { nodeId: "s-1" } },
      { screenId: "s-2", screenName: "Profile", trace: { nodeId: "s-2" } },
    ],
    piiIndicators: [
      {
        id: "pii-1",
        kind: "email",
        confidence: 0.9,
        matchLocation: "label",
        redacted: "[REDACTED:email]",
        screenId: "s-2",
      },
    ],
  });
  const ctx = harness(
    [buildCase({ riskCategory: "low", figmaTraceRefs: [{ screenId: "s-2" }] })],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });

  assert.equal(report.decisions[0]?.decision, "needs_review");
  const perCase = report.decisions[0]?.violations.find(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.ok(perCase);
  assert.equal(perCase.severity, "warning");
  assert.match(perCase.reason, /regulated_data/);
  const job = report.jobLevelViolations.find(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.ok(job);
  assert.equal(job.severity, "warning");
});

test("Issue #1412: PII without a screenId falls through to global (fail-closed)", () => {
  const intent = buildIntent({
    piiIndicators: [
      {
        id: "pii-unbound",
        kind: "email",
        confidence: 0.9,
        matchLocation: "label",
        redacted: "[REDACTED:email]",
      },
    ],
  });
  const ctx = harness([buildCase({ riskCategory: "low" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  assert.ok(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
  );
});

test("Issue #1412: feature flag false suppresses downgrade detection only", () => {
  const intent = buildIntent({ risks: ["regulated_data"] });
  const ctx = harness([buildCase({ riskCategory: "low" })], intent);
  ctx.profile.rules.enforceRiskTagDowngradeDetection = false;
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  // Downgrade outcome suppressed.
  assert.equal(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
    false,
  );
  assert.equal(
    report.jobLevelViolations.some(
      (v) => v.outcome === "risk_tag_downgrade_detected",
    ),
    false,
  );
  // Existing regulated-risk pathway still escalates the case.
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.ok(
    report.decisions[0]?.violations.some(
      (v) => v.outcome === "regulated_risk_review_required",
    ),
  );
});

test("Issue #1412: job-level downgrade entries are deduplicated per (testCaseId, intentRisk, declaredRisk)", () => {
  const intent = buildIntent({
    risks: ["regulated_data", "regulated personal data"],
  });
  const ctx = harness(
    [
      buildCase({ id: "tc-a", riskCategory: "low" }),
      buildCase({ id: "tc-b", riskCategory: "medium" }),
      buildCase({ id: "tc-c", riskCategory: "regulated_data" }),
    ],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
  });
  const job = report.jobLevelViolations.filter(
    (v) => v.outcome === "risk_tag_downgrade_detected",
  );
  assert.equal(job.length, 2, "exactly one entry per offending case");
  assert.deepEqual(
    job.map((v) => v.reason).filter((r) => /tc-c/.test(r)),
    [],
    "regulated_data-tagged case must not appear in the job-level summary",
  );
});

test("custom context policy signal escalates low-risk cases and records policy report evidence", () => {
  const ctx = harness([buildCase({ riskCategory: "low" })], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    customContextPolicySignals: [
      {
        sourceId: "custom-context-structured",
        entryId: "entry-1",
        attributeKey: "data_class",
        attributeValue: "PCI-DSS-3",
        riskCategory: "regulated_data",
        reason:
          'custom context data_class "PCI-DSS-3" requires regulated-data review',
        contentHash: "c".repeat(64),
      },
    ],
  });
  assert.equal(report.decisions[0]?.decision, "needs_review");
  assert.equal(
    report.decisions[0]?.violations.some(
      (violation) => violation.outcome === "custom_context_risk_escalation",
    ),
    true,
  );
  assert.equal(
    report.jobLevelViolations.some(
      (violation) =>
        violation.outcome === "custom_context_risk_escalation" &&
        violation.reason.includes("custom-context-structured"),
    ),
    true,
  );
});

// ---------------------------------------------------------------------------
// Issue #1946: customerProfile.ictRegisterRef inheritance
// ---------------------------------------------------------------------------

test("Issue #1946: ictRegisterRef inherited from customerProfile satisfies policy:ict-register-ref-required", () => {
  // Simulate what production-runner does: applyCustomerProfileIctRef fills
  // in missing ictRegisterRef on bindings before the policy gate runs.
  // The test drives policy-gate directly with the already-enriched bindings.
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    activeModelBindings: [
      {
        providerId: "llm-gateway",
        modelId: "gpt-oss-120b@test",
        inferenceProfileId: "gpt-oss-120b",
        // ictRegisterRef provided via profile inheritance
        ictRegisterRef: "ICT-PROFILE-REF-42",
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.outcome === "ict_register_ref_required",
  );
  assert.equal(
    violation,
    undefined,
    "should have no ict_register_ref_required violation when all bindings carry the ref",
  );
  assert.equal(report.blocked, false);
});

test("Issue #1946: missing ictRegisterRef still fires when no profile ref is present", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    activeModelBindings: [
      {
        providerId: "llm-gateway",
        modelId: "gpt-oss-120b@test",
        inferenceProfileId: "gpt-oss-120b",
        // no ictRegisterRef — no profile to inherit from
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.outcome === "ict_register_ref_required",
  );
  assert.ok(
    violation,
    "expected ict_register_ref_required violation when binding is missing ref and no profile",
  );
  assert.equal(report.blocked, true);
});

// ---------------------------------------------------------------------------
// Issue #1948: hard-gate that every p0 risk-class IR element has a covering case
// ---------------------------------------------------------------------------

test("Issue #1948: uncovered p0 risk-class IR element blocks the job", () => {
  const ctx = harness([buildCase({ id: "tc-pos" })], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan({
      perScreen: [
        {
          screenId: "s-1",
          techniqueQuotas: [{ technique: "use_case", minCount: 1 }],
        },
      ],
      perElement: [
        {
          screenId: "s-1",
          elementId: "act-transfer",
          mustHaveCase: true,
          riskClass: "financial_transaction",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:p0-risk-element-uncovered",
  );
  assert.ok(violation, "expected p0 uncovered violation");
  assert.equal(violation?.outcome, "p0_risk_element_uncovered");
  assert.equal(violation?.severity, "error");
  assert.match(violation?.reason ?? "", /financial_transaction/);
  assert.match(violation?.reason ?? "", /act-transfer/);
  assert.equal(report.blocked, true);
});

test("Issue #1948: live re-run scenario — Banking financial-transaction action uncovered → blocked", () => {
  // Banking-form screen with a financial-transaction action that no case
  // anchors via coveredActionIds. Replays the production runner pattern by
  // pairing the coverage plan with a positive case that touches an unrelated
  // field.
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-iban",
        screenId: "s-payment",
        trace: { nodeId: "n-iban" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "IBAN",
        type: "text",
      },
    ],
    detectedActions: [
      {
        id: "act-submit-payment",
        screenId: "s-payment",
        trace: { nodeId: "n-submit" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Submit payment",
        kind: "submit",
      },
    ],
    screens: [
      { screenId: "s-payment", screenName: "Payment", trace: { nodeId: "s-payment" } },
    ],
  });
  const ctx = harness(
    [
      buildCase({
        id: "tc-iban-only",
        figmaTraceRefs: [{ screenId: "s-payment" }],
        qualitySignals: {
          coveredFieldIds: ["f-iban"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ],
    intent,
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan({
      perScreen: [
        {
          screenId: "s-payment",
          techniqueQuotas: [{ technique: "use_case", minCount: 1 }],
        },
      ],
      perElement: [
        {
          screenId: "s-payment",
          elementId: "act-submit-payment",
          mustHaveCase: true,
          riskClass: "financial_transaction",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:p0-risk-element-uncovered",
  );
  assert.ok(violation, "expected p0 uncovered violation for unsubmitted payment");
  assert.equal(report.blocked, true);
});

test("Issue #1948: covered p0 element produces no violation", () => {
  const ctx = harness(
    [
      buildCase({
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: ["act-transfer"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ],
    buildIntent(),
  );
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan({
      perScreen: [
        {
          screenId: "s-1",
          techniqueQuotas: [{ technique: "use_case", minCount: 1 }],
        },
      ],
      perElement: [
        {
          screenId: "s-1",
          elementId: "act-transfer",
          mustHaveCase: true,
          riskClass: "financial_transaction",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:p0-risk-element-uncovered",
  );
  assert.equal(violation, undefined);
});

test("Issue #1948: no false positives on screens with zero p0 elements", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan({
      perElement: [
        {
          screenId: "s-1",
          elementId: "f-low-risk",
          mustHaveCase: false,
          riskClass: "medium",
        },
        {
          screenId: "s-1",
          elementId: "f-high-but-not-p0",
          mustHaveCase: true,
          riskClass: "high",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:p0-risk-element-uncovered",
  );
  assert.equal(violation, undefined);
});

test("Issue #1948: customerProfile policyOverride downgrades p0 uncovered to warning", () => {
  const ctx = harness([buildCase({ id: "tc-pos" })], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coveragePlan: buildCoveragePlan({
      perScreen: [
        {
          screenId: "s-1",
          techniqueQuotas: [{ technique: "use_case", minCount: 1 }],
        },
      ],
      perElement: [
        {
          screenId: "s-1",
          elementId: "act-transfer",
          mustHaveCase: true,
          riskClass: "regulated_data",
        },
      ],
    }),
    policyOverrides: [
      {
        ruleId: "policy:p0-risk-element-uncovered",
        severity: "warning",
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:p0-risk-element-uncovered",
  );
  assert.ok(violation, "expected p0 uncovered violation");
  assert.equal(violation?.severity, "warning");
  assert.equal(report.blocked, false);
});

test("Issue #1951: customerProfile policyOverride can downgrade form-screen accessibility hard-gate to warning", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness([buildCase({ id: "tc-pos" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    policyOverrides: [
      {
        ruleId: "policy:form-screen-needs-accessibility-case",
        severity: "warning",
      },
    ],
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:form-screen-needs-accessibility-case",
  );
  assert.equal(violation?.severity, "warning");
  assert.equal(report.blocked, false);
});

test("Issue #1951: a11y_judge covered_weakly verdict routes the job to needs_review", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness([buildAccessibilityCase({ id: "tc-a11y" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    a11yVerdict: buildA11yVerdict({
      verdict: "repair",
      criteria: [
        {
          criterionId: "s-1::error-announcements",
          screenId: "s-1",
          screenName: "Form",
          pillarId: "error-announcements",
          successCriterion: "WCAG 4.1.3 Status Messages",
          verdict: "covered_weakly",
          rationale: "The case mentions screen readers but not specific announcements.",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.outcome === "a11y_criterion_covered_weakly",
  );
  assert.equal(violation?.severity, "warning");
  assert.equal(report.blocked, false);
});

test("Issue #1951: a11y_judge not_covered verdict blocks the job", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness([buildAccessibilityCase({ id: "tc-a11y" })], intent);
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    a11yVerdict: buildA11yVerdict({
      verdict: "repair",
      criteria: [
        {
          criterionId: "s-1::error-announcements",
          screenId: "s-1",
          screenName: "Form",
          pillarId: "error-announcements",
          successCriterion: "WCAG 4.1.3 Status Messages",
          verdict: "not_covered",
          rationale: "No existing case verifies screen-reader announcements.",
        },
      ],
    }),
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.outcome === "a11y_criterion_not_covered",
  );
  assert.equal(violation?.severity, "error");
  assert.equal(report.blocked, true);
});

test("Issue #1951: disabled form-screen accessibility rule suppresses a11y_judge gating", () => {
  const intent = buildIntent({
    detectedFields: [
      {
        id: "f-1",
        screenId: "s-1",
        trace: { nodeId: "n1" },
        provenance: "figma_node",
        confidence: 0.9,
        label: "Email",
        type: "text",
      },
    ],
  });
  const ctx = harness([buildAccessibilityCase({ id: "tc-a11y" })], intent);
  ctx.profile.rules.requireAccessibilityCaseWhenFormPresent = false;
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    a11yVerdict: buildA11yVerdict({
      verdict: "repair",
      criteria: [
        {
          criterionId: "s-1::error-announcements",
          screenId: "s-1",
          screenName: "Form",
          pillarId: "error-announcements",
          successCriterion: "WCAG 4.1.3 Status Messages",
          verdict: "not_covered",
          rationale: "No existing case verifies screen-reader announcements.",
        },
      ],
    }),
  });
  assert.equal(
    report.jobLevelViolations.some(
      (entry) => entry.outcome === "a11y_criterion_not_covered",
    ),
    false,
  );
  assert.equal(report.blocked, false);
});

test("Issue #1950: coverage-baseline drift > 10% emits a warning-severity job-level violation (needs_review, not blocking)", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coverageBaselineDrift: {
      tenantId: "tenant-1",
      archetype: "customer-self-service",
      policyProfileId: ctx.profile.id,
      threshold: 0.1,
      seeded: false,
      exceeded: true,
      findings: [
        {
          axis: "fieldCoverage",
          baseline: 0.8,
          candidate: 0.5,
          absoluteDelta: -0.3,
          relativeDelta: 0.375,
          threshold: 0.1,
        },
      ],
    },
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:coverage-drift-exceeded",
  );
  assert.ok(violation, "expected coverage-drift-exceeded violation");
  assert.equal(violation?.outcome, "coverage_drift_exceeded");
  assert.equal(violation?.severity, "warning");
  assert.match(violation?.reason ?? "", /coverage drift exceeded/);
  assert.match(violation?.reason ?? "", /fieldCoverage/);
  // Decision class is needs_review — warning severity does not block.
  assert.equal(report.blocked, false);
});

test("Issue #1950: seeded baseline (first run) does not emit a coverage-drift violation", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coverageBaselineDrift: {
      tenantId: "tenant-1",
      archetype: "customer-self-service",
      policyProfileId: ctx.profile.id,
      threshold: 0.1,
      seeded: true,
      exceeded: false,
      findings: [],
    },
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:coverage-drift-exceeded",
  );
  assert.equal(violation, undefined);
});

test("Issue #1950: in-tolerance candidate does not emit a coverage-drift violation", () => {
  const ctx = harness([buildCase({})], buildIntent());
  const report = evaluatePolicyGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: ctx.list,
    intent: ctx.intent,
    profile: ctx.profile,
    validation: ctx.validation,
    coverage: ctx.coverage,
    coverageBaselineDrift: {
      tenantId: "tenant-1",
      archetype: "customer-self-service",
      policyProfileId: ctx.profile.id,
      threshold: 0.1,
      seeded: false,
      exceeded: false,
      findings: [],
    },
  });
  const violation = report.jobLevelViolations.find(
    (entry) => entry.rule === "policy:coverage-drift-exceeded",
  );
  assert.equal(violation, undefined);
});
