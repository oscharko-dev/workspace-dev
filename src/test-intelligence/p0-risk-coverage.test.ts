import assert from "node:assert/strict";
import test from "node:test";
import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type CoveragePlan,
  type GeneratedTestCase,
} from "../contracts/index.js";
import { collectUncoveredP0Elements } from "./p0-risk-coverage.js";

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
  title: "title",
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open" }],
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

const buildPlan = (
  perElement: CoveragePlan["perElement"],
): CoveragePlan => ({
  schemaVersion: COVERAGE_PLAN_SCHEMA_VERSION,
  jobId: "job-1",
  perScreen: [],
  perElement,
  minimumCases: [],
  recommendedCases: [],
  mutationKillRateTarget: 0.85,
});

test("returns empty when coverage plan is undefined", () => {
  assert.deepEqual(collectUncoveredP0Elements([], undefined), []);
});

test("returns empty when no p0 risk-class elements are present", () => {
  const plan = buildPlan([
    { screenId: "s", elementId: "e1", mustHaveCase: false, riskClass: "low" },
    { screenId: "s", elementId: "e2", mustHaveCase: true, riskClass: "high" },
    { screenId: "s", elementId: "e3", mustHaveCase: false, riskClass: "medium" },
  ]);
  assert.deepEqual(collectUncoveredP0Elements([], plan), []);
});

test("flags a financial_transaction element when no case covers it", () => {
  const plan = buildPlan([
    {
      screenId: "s-pay",
      elementId: "act-pay",
      mustHaveCase: true,
      riskClass: "financial_transaction",
    },
  ]);
  const result = collectUncoveredP0Elements(
    [buildCase({ qualitySignals: {
      coveredFieldIds: ["unrelated"],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    } })],
    plan,
  );
  assert.deepEqual(result, [
    { screenId: "s-pay", elementId: "act-pay", riskClass: "financial_transaction" },
  ]);
});

test("treats coveredFieldIds and coveredActionIds as the union of evidence", () => {
  const plan = buildPlan([
    {
      screenId: "s",
      elementId: "f-iban",
      mustHaveCase: true,
      riskClass: "regulated_data",
    },
    {
      screenId: "s",
      elementId: "act-submit",
      mustHaveCase: true,
      riskClass: "financial_transaction",
    },
  ]);
  const result = collectUncoveredP0Elements(
    [
      buildCase({
        id: "a",
        qualitySignals: {
          coveredFieldIds: ["f-iban"],
          coveredActionIds: [],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
      buildCase({
        id: "b",
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: ["act-submit"],
          coveredValidationIds: [],
          coveredNavigationIds: [],
          confidence: 0.9,
        },
      }),
    ],
    plan,
  );
  assert.deepEqual(result, []);
});

test("ignores coveredValidationIds and coveredNavigationIds", () => {
  const plan = buildPlan([
    {
      screenId: "s",
      elementId: "act-submit",
      mustHaveCase: true,
      riskClass: "financial_transaction",
    },
  ]);
  const result = collectUncoveredP0Elements(
    [
      buildCase({
        qualitySignals: {
          coveredFieldIds: [],
          coveredActionIds: [],
          coveredValidationIds: ["act-submit"],
          coveredNavigationIds: ["act-submit"],
          confidence: 0.9,
        },
      }),
    ],
    plan,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.elementId, "act-submit");
});

test("output is sorted by (screenId, elementId)", () => {
  const plan = buildPlan([
    {
      screenId: "s-z",
      elementId: "e-1",
      mustHaveCase: true,
      riskClass: "regulated_data",
    },
    {
      screenId: "s-a",
      elementId: "e-9",
      mustHaveCase: true,
      riskClass: "financial_transaction",
    },
    {
      screenId: "s-a",
      elementId: "e-1",
      mustHaveCase: true,
      riskClass: "regulated_data",
    },
  ]);
  const result = collectUncoveredP0Elements([], plan);
  assert.deepEqual(
    result.map((entry) => `${entry.screenId}/${entry.elementId}`),
    ["s-a/e-1", "s-a/e-9", "s-z/e-1"],
  );
});
