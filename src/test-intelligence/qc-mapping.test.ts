import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type TestCasePolicyReport,
  type VisualSidecarValidationReport,
} from "../contracts/index.js";
import {
  buildQcMappingPreview,
  buildTargetFolderPath,
  computeExternalIdCandidate,
  cloneOpenTextAlmReferenceProfile,
} from "./qc-mapping.js";

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
  title: "T",
  objective: "O",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "click submit", expected: "ok" }],
  expectedResults: ["page accepted"],
  figmaTraceRefs: [{ screenId: "s-payment", nodeId: "n-submit" }],
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

const wrapList = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const emptyPolicy = (): TestCasePolicyReport => ({
  schemaVersion: TEST_CASE_POLICY_REPORT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  generatedAt: GENERATED_AT,
  jobId: "job-1",
  policyProfileId: "eu-banking-default",
  policyProfileVersion: "1.0.0",
  totalTestCases: 0,
  approvedCount: 0,
  blockedCount: 0,
  needsReviewCount: 0,
  blocked: false,
  decisions: [],
  jobLevelViolations: [],
});

test("qc-mapping: target folder path uses screen name + risk", () => {
  const profile = cloneOpenTextAlmReferenceProfile();
  const folder = buildTargetFolderPath({
    profile,
    testCase: buildCase({ riskCategory: "regulated_data" }),
    intent: buildIntent(),
  });
  assert.equal(folder, "/Subject/Payment-Details/regulated_data");
});

test("qc-mapping: target folder path falls back to _unmapped without trace", () => {
  const profile = cloneOpenTextAlmReferenceProfile();
  const folder = buildTargetFolderPath({
    profile,
    testCase: buildCase({ figmaTraceRefs: [] }),
    intent: buildIntent(),
  });
  assert.equal(folder, "/Subject/_unmapped/low");
});

test("qc-mapping: external id candidate is deterministic", () => {
  const profile = cloneOpenTextAlmReferenceProfile();
  const a = computeExternalIdCandidate({
    jobId: "job-1",
    testCaseId: "tc-1",
    profile,
  });
  const b = computeExternalIdCandidate({
    jobId: "job-1",
    testCaseId: "tc-1",
    profile,
  });
  assert.equal(a, b);
  assert.equal(a.length, 16);
});

test("qc-mapping: external id varies with jobId and testCaseId", () => {
  const profile = cloneOpenTextAlmReferenceProfile();
  const a = computeExternalIdCandidate({
    jobId: "job-1",
    testCaseId: "tc-1",
    profile,
  });
  const b = computeExternalIdCandidate({
    jobId: "job-2",
    testCaseId: "tc-1",
    profile,
  });
  const c = computeExternalIdCandidate({
    jobId: "job-1",
    testCaseId: "tc-2",
    profile,
  });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test("qc-mapping: preview entries sorted by testCaseId", () => {
  const list = wrapList([
    buildCase({ id: "tc-z" }),
    buildCase({ id: "tc-a" }),
    buildCase({ id: "tc-m" }),
  ]);
  const preview = buildQcMappingPreview({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
    policy: emptyPolicy(),
  });
  assert.deepEqual(
    preview.entries.map((e) => e.testCaseId),
    ["tc-a", "tc-m", "tc-z"],
  );
});

test("qc-mapping: blocking reasons combine case + policy violations", () => {
  const list = wrapList([buildCase({ id: "tc-1" })]);
  const policy: TestCasePolicyReport = {
    ...emptyPolicy(),
    decisions: [
      {
        testCaseId: "tc-1",
        decision: "blocked",
        violations: [
          {
            rule: "policy:visual_sidecar_failure",
            outcome: "visual_sidecar_failure",
            severity: "error",
            reason: "primary deployment unavailable",
          },
        ],
      },
    ],
  };
  const preview = buildQcMappingPreview({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
    policy,
  });
  const entry = preview.entries[0];
  assert.ok(entry);
  if (!entry) return;
  assert.equal(entry.exportable, false);
  assert.deepEqual(entry.blockingReasons, ["policy:visual_sidecar_failure"]);
});

test("qc-mapping: visual provenance derives from sidecar records", () => {
  const list = wrapList([buildCase({ id: "tc-1" })]);
  const visual: VisualSidecarValidationReport = {
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
  };
  const preview = buildQcMappingPreview({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
    policy: emptyPolicy(),
    visual,
  });
  const entry = preview.entries[0];
  assert.ok(entry);
  if (!entry) return;
  assert.equal(entry.visualProvenance?.deployment, "llama-4-maverick-vision");
  assert.equal(entry.visualProvenance?.fallbackReason, "none");
  assert.equal(entry.visualProvenance?.evidenceHash.length, 64);
});

test("qc-mapping: provenance uses primary_unavailable when fallback_used", () => {
  const list = wrapList([buildCase({ id: "tc-1" })]);
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
        screenId: "s-payment",
        deployment: "phi-4-multimodal-poc",
        outcomes: ["fallback_used"],
        issues: [],
        meanConfidence: 0.5,
      },
    ],
  };
  const preview = buildQcMappingPreview({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent: buildIntent(),
    policy: emptyPolicy(),
    visual,
  });
  const entry = preview.entries[0];
  assert.ok(entry);
  if (!entry) return;
  assert.equal(entry.visualProvenance?.fallbackReason, "primary_unavailable");
});
