import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import { evaluatePolicyGate } from "./policy-gate.js";
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
    buildCase({
      id: "tc-a11y",
      type: "accessibility",
      title: "Form is keyboard accessible",
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
      buildCase({
        id: "tc-a11y",
        type: "accessibility",
        title: "Form is keyboard accessible",
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
