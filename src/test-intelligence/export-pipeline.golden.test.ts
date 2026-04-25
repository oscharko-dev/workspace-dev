/**
 * Golden test for the export pipeline (Issue #1365).
 *
 * Builds a deterministic input bundle with two approved test cases and
 * one rejected test case, runs the pipeline, and asserts byte-identity
 * against checked-in golden fixtures for:
 *
 *   - testcases.json
 *   - testcases.csv
 *   - testcases.alm.xml
 *   - qc-mapping-preview.json
 *   - export-report.json
 *
 * Re-record by running with FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1.
 */

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import { runExportPipeline } from "./export-pipeline.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");
const APPROVE =
  process.env["FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE"] === "1";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [
    {
      screenId: "s-payment",
      screenName: "Payment Details",
      trace: { nodeId: "s-payment" },
    },
  ],
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
});

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-base",
  sourceJobId: "job-1365-golden",
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
  figmaTraceRefs: [{ screenId: "s-payment" }],
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
    jobId: "job-1365-golden",
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

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1365-golden",
  testCases: cases,
});

const buildValidation = (): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1365-golden",
  totalTestCases: 3,
  errorCount: 0,
  warningCount: 0,
  blocked: false,
  issues: [],
});

const buildPolicy = (
  decisions: TestCasePolicyDecisionRecord[],
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1365-golden",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: decisions.length,
  approvedCount: decisions.filter((d) => d.decision === "approved").length,
  blockedCount: decisions.filter((d) => d.decision === "blocked").length,
  needsReviewCount: decisions.filter((d) => d.decision === "needs_review")
    .length,
  blocked: decisions.some((d) => d.decision === "blocked"),
  decisions,
  jobLevelViolations: [],
});

const snapshotEntry = (overrides: Partial<ReviewSnapshot>): ReviewSnapshot => ({
  testCaseId: "tc-base",
  state: "approved",
  policyDecision: "approved",
  lastEventId: "evt-1",
  lastEventAt: GENERATED_AT,
  fourEyesEnforced: false,
  approvers: [],
  ...overrides,
});

const buildSnapshot = (perTestCase: ReviewSnapshot[]): ReviewGateSnapshot => {
  let approvedCount = 0;
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const e of perTestCase) {
    if (
      e.state === "approved" ||
      e.state === "exported" ||
      e.state === "transferred"
    )
      approvedCount += 1;
    else if (e.state === "needs_review" || e.state === "edited")
      needsReviewCount += 1;
    else if (e.state === "rejected") rejectedCount += 1;
  }
  return {
    schemaVersion: REVIEW_GATE_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    jobId: "job-1365-golden",
    generatedAt: GENERATED_AT,
    perTestCase,
    approvedCount,
    needsReviewCount,
    rejectedCount,
  };
};

const buildVisual = (): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1365-golden",
  totalScreens: 1,
  screensWithFindings: 0,
  blocked: false,
  records: [
    {
      screenId: "s-payment",
      deployment: "llama-4-maverick-vision",
      outcomes: ["ok"],
      issues: [],
      meanConfidence: 0.85,
    },
  ],
});

const ARTIFACTS = [
  {
    name: "issue-1365.expected.testcases.json",
    payload: "json" as const,
    contentType: "text" as const,
  },
  {
    name: "issue-1365.expected.testcases.csv",
    payload: "csv" as const,
    contentType: "text" as const,
  },
  {
    name: "issue-1365.expected.testcases.alm.xml",
    payload: "almXml" as const,
    contentType: "text" as const,
  },
  {
    name: "issue-1365.expected.qc-mapping-preview.json",
    payload: "qcMappingPreview" as const,
    contentType: "text" as const,
  },
];

test("golden: export pipeline emits byte-identical artifacts", async () => {
  const result = runExportPipeline({
    jobId: "job-1365-golden",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([
      buildCase({
        id: "tc-approved-1",
        title: "Pay with valid IBAN",
        objective: "Confirm valid IBAN is accepted",
        riskCategory: "regulated_data",
        priority: "p1",
        steps: [
          { index: 1, action: "Open form", expected: "Form visible" },
          { index: 2, action: "Submit valid IBAN", expected: "Accepted" },
        ],
        expectedResults: ["Confirmation"],
      }),
      buildCase({
        id: "tc-approved-2",
        title: "Reject invalid IBAN",
        objective: "Confirm invalid IBAN is rejected with a banner",
        riskCategory: "financial_transaction",
        priority: "p0",
        steps: [
          { index: 1, action: "Open form", expected: "Form visible" },
          { index: 2, action: "Submit invalid IBAN", expected: "Banner shown" },
        ],
        expectedResults: ["Banner displayed"],
      }),
      buildCase({
        id: "tc-rejected-1",
        title: "Speculative case",
        objective: "Out-of-scope speculative",
        riskCategory: "low",
      }),
    ]),
    validation: buildValidation(),
    policy: buildPolicy([
      {
        testCaseId: "tc-approved-1",
        decision: "approved",
        violations: [],
      },
      {
        testCaseId: "tc-approved-2",
        decision: "approved",
        violations: [],
      },
      {
        testCaseId: "tc-rejected-1",
        decision: "needs_review",
        violations: [],
      },
    ]),
    visual: buildVisual(),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({
        testCaseId: "tc-approved-1",
        state: "approved",
        policyDecision: "approved",
        approvers: ["alice"],
      }),
      snapshotEntry({
        testCaseId: "tc-approved-2",
        state: "approved",
        policyDecision: "approved",
        approvers: ["alice"],
      }),
      snapshotEntry({
        testCaseId: "tc-rejected-1",
        state: "rejected",
        policyDecision: "needs_review",
      }),
    ]),
    testGenerationDeployment: "gpt-oss-120b",
  });

  assert.equal(result.refused, false);

  const decoder = new TextDecoder();
  for (const artifact of ARTIFACTS) {
    const bytes = result.payloads[artifact.payload];
    assert.ok(bytes, `expected payload ${artifact.payload}`);
    const serialized = decoder.decode(bytes);
    const path = join(FIXTURES_DIR, artifact.name);
    if (APPROVE) {
      await writeFile(path, serialized, "utf8");
      continue;
    }
    const expected = await readFile(path, "utf8");
    assert.equal(
      serialized,
      expected,
      `golden ${artifact.name} drifted — re-run with FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1`,
    );
  }

  // Export-report.json is sensitive to artifact byte order, so we serialize
  // separately to keep the comparison stable.
  const reportSerialized = JSON.stringify(result.report, null, 2) + "\n";
  const reportPath = join(
    FIXTURES_DIR,
    "issue-1365.expected.export-report.json",
  );
  if (APPROVE) {
    await writeFile(reportPath, reportSerialized, "utf8");
  } else {
    const expected = await readFile(reportPath, "utf8");
    assert.equal(
      reportSerialized,
      expected,
      "golden export-report.json drifted — re-run with FIGMAPIPE_TEST_INTELLIGENCE_GOLDEN_APPROVE=1",
    );
  }

  // Determinism guard: the report must list approved cases only.
  assert.equal(result.report.exportedTestCaseCount, 2);
  for (const entry of result.report.artifacts) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(entry.bytes > 0);
  }
});

test("golden: pipeline refuses if any of the cases is unapproved", () => {
  const result = runExportPipeline({
    jobId: "job-1365-golden",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({ id: "tc-1" }), buildCase({ id: "tc-2" })]),
    validation: buildValidation(),
    policy: buildPolicy([
      { testCaseId: "tc-1", decision: "approved", violations: [] },
      { testCaseId: "tc-2", decision: "needs_review", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({
        testCaseId: "tc-1",
        state: "approved",
        policyDecision: "approved",
      }),
      snapshotEntry({
        testCaseId: "tc-2",
        state: "needs_review",
        policyDecision: "needs_review",
      }),
    ]),
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("unapproved_test_cases_present"));
});
