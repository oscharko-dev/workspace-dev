import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
} from "../contracts/index.js";
import type { IntraClassBoundaryClassifier } from "./equivalence-class-fingerprint.js";
import { validateGeneratedTestCasesWithInvariants } from "./test-case-validation.js";

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
  detectedValidations: [],
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
  title: "Enter IBAN DE89 0000 0000 0000",
  objective: "Submit the payment form with a valid IBAN",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "equivalence_partitioning",
  preconditions: [],
  testData: ["[REDACTED:IBAN]"],
  steps: [
    { index: 1, action: "Open the Payment Details screen" },
    { index: 2, action: "Enter the IBAN" },
    { index: 3, action: "Submit form", expected: "Confirmation displayed" },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment", nodePath: "root/form" }],
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

test("Issue #2123: validator emits intra_equivalence_class_redundancy warning for redundant case", () => {
  const a = buildCase({ id: "tc-a", title: "Enter IBAN DE89 0000 0000 0000" });
  const b = buildCase({ id: "tc-b", title: "Enter IBAN AT00 0000 0000 0000" });
  const outcome = validateGeneratedTestCasesWithInvariants({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [a, b],
    },
    intent: buildIntent(),
  });
  const redundancy = outcome.report.issues.filter(
    (i) => i.code === "intra_equivalence_class_redundancy",
  );
  assert.equal(redundancy.length, 1);
  assert.equal(redundancy[0]?.severity, "warning");
  assert.equal(redundancy[0]?.testCaseId, "tc-b");
  assert.equal(outcome.report.blocked, false);
  assert.equal(outcome.intraClassRedundancy?.findings.length, 1);
  assert.equal(outcome.intraClassRedundancy?.classCount, 1);
});

test("Issue #2123: validator emits exact_near_duplicate_text warning alongside equivalence-class redundancy", () => {
  const a = buildCase({ id: "tc-a", title: "Pay valid IBAN" });
  const b = buildCase({ id: "tc-b", title: "Pay valid IBAN." });
  const outcome = validateGeneratedTestCasesWithInvariants({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [a, b],
    },
    intent: buildIntent(),
  });
  const text = outcome.report.issues.filter(
    (i) => i.code === "exact_near_duplicate_text",
  );
  assert.equal(text.length, 1);
  assert.equal(text[0]?.severity, "warning");
  assert.equal(text[0]?.testCaseId, "tc-b");
});

test("Issue #2123: distinct equivalence classes produce no redundancy warnings", () => {
  const a = buildCase({
    id: "tc-positive",
    type: "functional",
    title: "Submit valid IBAN",
  });
  const b = buildCase({
    id: "tc-negative",
    type: "negative",
    title: "Reject invalid IBAN",
    figmaTraceRefs: [{ screenId: "s-payment", nodePath: "root/error" }],
  });
  const outcome = validateGeneratedTestCasesWithInvariants({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [a, b],
    },
    intent: buildIntent(),
  });
  assert.equal(
    outcome.report.issues.filter(
      (i) => i.code === "intra_equivalence_class_redundancy",
    ).length,
    0,
  );
});

test("Issue #2123: setting exactNearDuplicateTextDistance to 0 disables the auxiliary check", () => {
  const a = buildCase({ id: "tc-a", title: "Pay valid IBAN" });
  const b = buildCase({ id: "tc-b", title: "Pay valid IBAN." });
  const outcome = validateGeneratedTestCasesWithInvariants({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [a, b],
    },
    intent: buildIntent(),
    exactNearDuplicateTextDistance: 0,
  });
  assert.equal(
    outcome.report.issues.filter((i) => i.code === "exact_near_duplicate_text")
      .length,
    0,
  );
});

test("Issue #2123: boundary classifier veto suppresses the warning", () => {
  const classifier: IntraClassBoundaryClassifier = {
    identifier: "phi-4-mini-instruct@stub",
    classify: () => "keep",
  };
  const a = buildCase({
    id: "tc-a",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 22",
    openQuestions: ["IBAN length cap?"],
  });
  const b = buildCase({
    id: "tc-b",
    type: "boundary",
    technique: "boundary_value_analysis",
    title: "Boundary IBAN length 23",
    openQuestions: ["IBAN length cap?"],
  });
  const outcome = validateGeneratedTestCasesWithInvariants({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [a, b],
    },
    intent: buildIntent(),
    intraClassBoundaryClassifier: classifier,
  });
  assert.equal(
    outcome.report.issues.filter(
      (i) => i.code === "intra_equivalence_class_redundancy",
    ).length,
    0,
  );
});
