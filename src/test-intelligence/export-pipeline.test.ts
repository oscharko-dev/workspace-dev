import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEDUPE_REPORT_ARTIFACT_FILENAME,
  EXPORT_REPORT_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME,
  EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  QC_MAPPING_PREVIEW_ARTIFACT_FILENAME,
  REVIEW_GATE_SCHEMA_VERSION,
  TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  TRACEABILITY_MATRIX_ARTIFACT_FILENAME,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type ReviewGateSnapshot,
  type ReviewSnapshot,
  type TestCaseCoverageReport,
  type TestCasePolicyDecisionRecord,
  type TestCasePolicyReport,
  type TestCaseValidationReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  runAndPersistExportPipeline,
  runExportPipeline,
} from "./export-pipeline.js";

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
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Pay with valid IBAN",
  objective: "Ensure a valid IBAN is accepted by the payment form.",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "regulated_data",
  technique: "use_case",
  preconditions: ["Logged-in user"],
  testData: ["IBAN: <redacted>"],
  steps: [
    { index: 1, action: "Open payment form", expected: "Form is visible" },
    { index: 2, action: "Submit", expected: "Payment accepted" },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-submit" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.91,
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

const buildList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const buildValidation = (
  overrides: Partial<TestCaseValidationReport> = {},
): TestCaseValidationReport => ({
  schemaVersion: TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  totalTestCases: 1,
  errorCount: 0,
  warningCount: 0,
  blocked: false,
  issues: [],
  ...overrides,
});

const buildPolicy = (
  decisions: TestCasePolicyDecisionRecord[],
): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
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

const buildCoverage = (): TestCaseCoverageReport => ({
  schemaVersion: TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: "eu-banking-default",
  totalTestCases: 1,
  fieldCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  actionCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  validationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  navigationCoverage: { total: 0, covered: 0, ratio: 0, uncoveredIds: [] },
  traceCoverage: { total: 1, withTrace: 1, ratio: 1 },
  negativeCaseCount: 0,
  validationCaseCount: 0,
  boundaryCaseCount: 0,
  accessibilityCaseCount: 0,
  workflowCaseCount: 0,
  positiveCaseCount: 1,
  assumptionsRatio: 0,
  openQuestionsCount: 0,
  duplicatePairs: [],
});

const snapshotEntry = (overrides: Partial<ReviewSnapshot>): ReviewSnapshot => ({
  testCaseId: "tc-1",
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
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    perTestCase,
    approvedCount,
    needsReviewCount,
    rejectedCount,
  };
};

const visualReportApproved = (): VisualSidecarValidationReport => ({
  schemaVersion: VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
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

test("export-pipeline: refuses when no test cases are approved", () => {
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation(),
    policy: buildPolicy([
      { testCaseId: "tc-1", decision: "needs_review", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({ state: "needs_review", policyDecision: "needs_review" }),
    ]),
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("no_approved_test_cases"));
  assert.ok(result.refusalCodes.includes("unapproved_test_cases_present"));
});

test("export-pipeline: ACCEPTANCE — unapproved test cases cannot be exported (regression)", () => {
  // Even if ONE of three cases is approved, residual unapproved cases force refusal
  // unless they are explicitly rejected.
  const cases = [
    buildCase({ id: "tc-a" }),
    buildCase({ id: "tc-b" }),
    buildCase({ id: "tc-c" }),
  ];
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList(cases),
    validation: buildValidation({ totalTestCases: 3 }),
    policy: buildPolicy([
      { testCaseId: "tc-a", decision: "approved", violations: [] },
      { testCaseId: "tc-b", decision: "needs_review", violations: [] },
      { testCaseId: "tc-c", decision: "needs_review", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({
        testCaseId: "tc-a",
        state: "approved",
        policyDecision: "approved",
      }),
      snapshotEntry({
        testCaseId: "tc-b",
        state: "needs_review",
        policyDecision: "needs_review",
      }),
      snapshotEntry({
        testCaseId: "tc-c",
        state: "edited",
        policyDecision: "needs_review",
      }),
    ]),
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("unapproved_test_cases_present"));
  assert.equal(result.exportedTestCases.length, 0);
  assert.equal(result.payloads.json, undefined);
  assert.equal(result.payloads.csv, undefined);
});

test("export-pipeline: refuses when validation reports schema_invalid", () => {
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation({ blocked: true, errorCount: 1 }),
    policy: buildPolicy([
      { testCaseId: "tc-1", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({ state: "approved", policyDecision: "approved" }),
    ]),
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("schema_invalid_cases_present"));
});

test("export-pipeline: semantic override permits export with audit-blocked validation report", () => {
  const overridePath = "$.testCases[0].steps[0].action";
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation({
      blocked: true,
      errorCount: 1,
      issues: [
        {
          testCaseId: "tc-1",
          path: overridePath,
          code: "semantic_suspicious_content",
          severity: "error",
          message:
            "shell_metacharacters: matches destructive shell-command shape",
        },
      ],
    }),
    policy: buildPolicy([
      {
        testCaseId: "tc-1",
        decision: "needs_review",
        violations: [
          {
            rule: "validation:semantic_suspicious_content:overridden",
            outcome: "semantic_suspicious_content",
            severity: "warning",
            reason:
              "shell_metacharacters: matches destructive shell-command shape (reviewer override active)",
            path: overridePath,
          },
        ],
      },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({ state: "approved", policyDecision: "needs_review" }),
    ]),
    semanticContentOverrides: new Map([["tc-1", new Set([overridePath])]]),
  });
  assert.equal(result.refused, false);
  assert.equal(result.refusalCodes.length, 0);
  assert.equal(result.exportedTestCases.length, 1);
});

test("export-pipeline: refuses when visual sidecar is blocked", () => {
  const visual = visualReportApproved();
  visual.blocked = true;
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation(),
    policy: buildPolicy([
      { testCaseId: "tc-1", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({ state: "approved", policyDecision: "approved" }),
    ]),
    visual,
  });
  assert.equal(result.refused, true);
  assert.ok(result.refusalCodes.includes("visual_sidecar_blocked"));
});

test("export-pipeline: writes only export-report.json on refusal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "export-refuse-"));
  try {
    const { paths } = await runAndPersistExportPipeline({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      intent: buildIntent(),
      list: buildList([buildCase({})]),
      validation: buildValidation(),
      policy: buildPolicy([
        { testCaseId: "tc-1", decision: "needs_review", violations: [] },
      ]),
      reviewSnapshot: buildSnapshot([
        snapshotEntry({
          state: "needs_review",
          policyDecision: "needs_review",
        }),
      ]),
      destinationDir: dir,
    });
    assert.equal(
      paths.exportReportPath,
      join(dir, EXPORT_REPORT_ARTIFACT_FILENAME),
    );
    assert.equal(paths.testcasesJsonPath, undefined);
    assert.equal(paths.testcasesCsvPath, undefined);
    assert.equal(paths.testcasesAlmXmlPath, undefined);
    assert.equal(paths.testcasesXlsxPath, undefined);
    assert.equal(paths.qcMappingPreviewPath, undefined);
    assert.equal(paths.dedupeReportPath, undefined);
    assert.equal(paths.traceabilityMatrixPath, undefined);
    const reportRaw = await readFile(paths.exportReportPath, "utf8");
    assert.match(reportRaw, /"refused":true/);
    assert.match(reportRaw, /"rawScreenshotsIncluded":false/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("export-pipeline: emits all required artifacts when every case is approved or rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "export-emit-"));
  try {
    const { artifacts, paths } = await runAndPersistExportPipeline({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      intent: buildIntent(),
      list: buildList([buildCase({ id: "tc-a" }), buildCase({ id: "tc-b" })]),
      validation: buildValidation({ totalTestCases: 2 }),
      policy: buildPolicy([
        { testCaseId: "tc-a", decision: "approved", violations: [] },
        { testCaseId: "tc-b", decision: "needs_review", violations: [] },
      ]),
      reviewSnapshot: buildSnapshot([
        snapshotEntry({
          testCaseId: "tc-a",
          state: "approved",
          policyDecision: "approved",
        }),
        snapshotEntry({
          testCaseId: "tc-b",
          state: "rejected",
          policyDecision: "needs_review",
        }),
      ]),
      visual: visualReportApproved(),
      enableXlsx: true,
      testGenerationDeployment: "gpt-oss-120b",
      destinationDir: dir,
    });
    assert.equal(artifacts.refused, false);
    assert.equal(artifacts.exportedTestCases.length, 1);
    assert.equal(artifacts.exportedTestCases[0]?.id, "tc-a");
    assert.ok(paths.testcasesJsonPath);
    assert.ok(paths.testcasesCsvPath);
    assert.ok(paths.testcasesAlmXmlPath);
    assert.ok(paths.testcasesXlsxPath);
    assert.ok(paths.qcMappingPreviewPath);
    assert.equal(
      paths.dedupeReportPath,
      join(dir, DEDUPE_REPORT_ARTIFACT_FILENAME),
    );
    assert.equal(
      paths.traceabilityMatrixPath,
      join(dir, TRACEABILITY_MATRIX_ARTIFACT_FILENAME),
    );
    // Verify each persisted file matches the in-memory bytes.
    const jsonBytes = await readFile(paths.testcasesJsonPath ?? "");
    const expectedJsonLength = artifacts.payloads.json?.length ?? -1;
    assert.equal(jsonBytes.length, expectedJsonLength);

    // Report should include all 5 artifact records when xlsx is enabled.
    assert.equal(artifacts.report.artifacts.length, 5);
    const filenames = artifacts.report.artifacts.map((a) => a.filename);
    assert.ok(filenames.includes(EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME));
    assert.ok(filenames.includes(QC_MAPPING_PREVIEW_ARTIFACT_FILENAME));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("export-pipeline: report has rawScreenshotsIncluded invariant set to false", () => {
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({})]),
    validation: buildValidation(),
    policy: buildPolicy([
      { testCaseId: "tc-1", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({ state: "approved", policyDecision: "approved" }),
    ]),
  });
  assert.equal(result.report.rawScreenshotsIncluded, false);
});

test("export-pipeline: visual evidence hashes are sorted and unique", () => {
  const result = runExportPipeline({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({ id: "tc-a" }), buildCase({ id: "tc-b" })]),
    validation: buildValidation({ totalTestCases: 2 }),
    policy: buildPolicy([
      { testCaseId: "tc-a", decision: "approved", violations: [] },
      { testCaseId: "tc-b", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({
        testCaseId: "tc-a",
        state: "approved",
        policyDecision: "approved",
      }),
      snapshotEntry({
        testCaseId: "tc-b",
        state: "approved",
        policyDecision: "approved",
      }),
    ]),
    visual: visualReportApproved(),
  });
  assert.equal(result.refused, false);
  // Both cases trace to the same screen, so their evidence hash matches.
  assert.equal(result.report.visualEvidenceHashes.length, 1);
});

test("export-pipeline: deterministic output across two runs", () => {
  const inputs = {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    intent: buildIntent(),
    list: buildList([buildCase({ id: "tc-a" }), buildCase({ id: "tc-b" })]),
    validation: buildValidation({ totalTestCases: 2 }),
    policy: buildPolicy([
      { testCaseId: "tc-a", decision: "approved", violations: [] },
      { testCaseId: "tc-b", decision: "approved", violations: [] },
    ]),
    reviewSnapshot: buildSnapshot([
      snapshotEntry({
        testCaseId: "tc-a",
        state: "approved",
        policyDecision: "approved",
      }),
      snapshotEntry({
        testCaseId: "tc-b",
        state: "approved",
        policyDecision: "approved",
      }),
    ]),
    enableXlsx: true,
  };
  const a = runExportPipeline(inputs);
  const b = runExportPipeline(inputs);
  // JSON, CSV, ALM XML, mapping preview must match byte-for-byte.
  assert.deepEqual(a.payloads.json, b.payloads.json);
  assert.deepEqual(a.payloads.csv, b.payloads.csv);
  assert.deepEqual(a.payloads.almXml, b.payloads.almXml);
  assert.deepEqual(a.payloads.qcMappingPreview, b.payloads.qcMappingPreview);
  assert.deepEqual(a.payloads.xlsx, b.payloads.xlsx);
});
