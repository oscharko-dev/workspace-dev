import assert from "node:assert/strict";
import test from "node:test";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
} from "../contracts/index.js";
import { computeCoverageReport } from "./test-case-coverage.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "title",
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "do", expected: "ok" }],
  expectedResults: ["ok"],
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
    generatedAt: "2026-04-25T10:00:00.000Z",
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

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [{ screenId: "s-1", screenName: "Form", trace: { nodeId: "s-1" } }],
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
    {
      id: "f-2",
      screenId: "s-1",
      trace: { nodeId: "n2" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
  detectedActions: [
    {
      id: "a-1",
      screenId: "s-1",
      trace: { nodeId: "na1" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Submit",
      kind: "button",
    },
  ],
  detectedValidations: [
    {
      id: "v-1",
      screenId: "s-1",
      trace: { nodeId: "n2" },
      provenance: "figma_node",
      confidence: 0.85,
      rule: "Required",
      targetFieldId: "f-2",
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

test("coverage buckets reflect intent ids covered by accepted cases", () => {
  const cases = [
    buildCase({
      id: "tc-1",
      type: "functional",
      qualitySignals: {
        coveredFieldIds: ["f-1"],
        coveredActionIds: ["a-1"],
        coveredValidationIds: [],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
    buildCase({
      id: "tc-2",
      type: "negative",
      qualitySignals: {
        coveredFieldIds: ["f-2"],
        coveredActionIds: [],
        coveredValidationIds: ["v-1"],
        coveredNavigationIds: [],
        confidence: 0.9,
      },
    }),
  ];
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: cases,
    },
    intent: buildIntent(),
    duplicateSimilarityThreshold: 0.92,
  });
  assert.equal(report.fieldCoverage.total, 2);
  assert.equal(report.fieldCoverage.covered, 2);
  assert.equal(report.fieldCoverage.ratio, 1);
  assert.deepEqual(report.fieldCoverage.uncoveredIds, []);
  assert.equal(report.actionCoverage.covered, 1);
  assert.equal(report.validationCoverage.covered, 1);
  assert.equal(report.traceCoverage.withTrace, 2);
  assert.equal(report.negativeCaseCount, 1);
  assert.equal(report.positiveCaseCount, 1);
});

test("uncovered ids are sorted deterministically", () => {
  const intent = buildIntent();
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent,
    duplicateSimilarityThreshold: 0.92,
  });
  assert.deepEqual(report.fieldCoverage.uncoveredIds, ["f-1", "f-2"]);
  assert.equal(report.fieldCoverage.ratio, 0);
});

test("rubric score is rounded and clamped", () => {
  const report = computeCoverageReport({
    jobId: "job-1",
    generatedAt: "2026-04-25T10:00:00.000Z",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    list: {
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      jobId: "job-1",
      testCases: [],
    },
    intent: buildIntent(),
    duplicateSimilarityThreshold: 0.92,
    rubricScore: 0.123456789,
  });
  assert.equal(report.rubricScore, 0.123457);
});

test("rubric score out of range throws", () => {
  assert.throws(
    () =>
      computeCoverageReport({
        jobId: "job-1",
        generatedAt: "2026-04-25T10:00:00.000Z",
        policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
        list: {
          schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
          jobId: "job-1",
          testCases: [],
        },
        intent: buildIntent(),
        duplicateSimilarityThreshold: 0.92,
        rubricScore: 1.5,
      }),
    RangeError,
  );
});
