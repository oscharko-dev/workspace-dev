/**
 * Unit tests for the domain-invariant registry (Issue #2040). These cover
 * the DSL contract (`{ id, scope, forall, holds, severity, source }`),
 * the active-dataset invariant set, and the deterministic ordering
 * guarantees the validation pipeline relies on.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  buildActiveDatasetInvariantRegistry,
  computeInvariantCoverageRatio,
  createInvariantRegistry,
  evaluateInvariants,
  type DomainInvariant,
} from "./domain-invariant-registry.js";
import { buildTestDesignModel } from "./test-design-model.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntentWithFinancing = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-loan",
      screenName: "Loan",
      trace: { nodeId: "s-loan" },
    },
  ],
  detectedFields: [
    {
      id: "s-loan::field::n-principal",
      screenId: "s-loan",
      trace: { nodeId: "n-principal" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Principal",
      type: "text",
    },
    {
      id: "s-loan::field::n-financing-need",
      screenId: "s-loan",
      trace: { nodeId: "n-financing-need" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Financing need",
      type: "text",
    },
  ],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: ["Die MwSt. ist nicht Teil des Finanzierungsbedarfs."],
  piiIndicators: [],
  redactions: [],
});

const buildIntentNoFinancing = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-form",
      screenName: "Simple Form",
      trace: { nodeId: "s-form" },
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
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit loan",
  objective: "Submit a loan application",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    { index: 1, action: "Open the loan form" },
    {
      index: 2,
      action: "Submit the form",
      expected: "Confirmation displayed",
    },
  ],
  expectedResults: ["Confirmation displayed"],
  figmaTraceRefs: [{ screenId: "s-loan" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
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

const buildContext = (
  intent: BusinessTestIntentIr,
): { intent: BusinessTestIntentIr; model: TestDesignModel } => {
  const model = buildTestDesignModel({ jobId: "job-1", intent });
  return { intent, model };
};

test("registry: rejects malformed invariant ids", () => {
  const registry = createInvariantRegistry();
  assert.throws(() =>
    registry.register({
      id: "not-following-pattern",
      scope: "scope",
      description: "desc",
      source: "test",
      severity: "error",
      forall: () => false,
      holds: () => true,
    }),
  );
});

test("registry: refuses duplicate invariant ids", () => {
  const registry = createInvariantRegistry();
  const invariant: DomainInvariant = {
    id: "INV-TEST-01",
    scope: "test",
    description: "desc",
    source: "test",
    severity: "error",
    forall: () => true,
    holds: () => true,
  };
  registry.register(invariant);
  assert.throws(() => registry.register(invariant));
});

test("registry: list() and ids() are alphabetically sorted", () => {
  const registry = createInvariantRegistry();
  for (const id of ["INV-Z-01", "INV-A-01", "INV-M-01"]) {
    registry.register({
      id,
      scope: "test",
      description: id,
      source: "test",
      severity: "warning",
      forall: () => false,
      holds: () => true,
    });
  }
  assert.deepEqual(registry.ids(), ["INV-A-01", "INV-M-01", "INV-Z-01"]);
  assert.deepEqual(
    registry.list().map((entry) => entry.id),
    ["INV-A-01", "INV-M-01", "INV-Z-01"],
  );
});

test("active-dataset registry exposes the documented invariant ids", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  assert.deepEqual(registry.ids(), [
    "INV-FINANCING-NEED-01",
    "INV-NETTO-BRUTTO-01",
    "INV-OPTIONAL-COST-01",
    "INV-VAT-01",
  ]);
});

test("evaluateInvariants: case touching VAT-financing rule fires INV-VAT-01 violation", () => {
  const intent = buildIntentWithFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    title: "Verify financing need with VAT",
    objective:
      "Submit the loan form and confirm the financing need including VAT.",
    expectedResults: [
      "Financing need equals 1.000,00 € including VAT.",
    ],
    steps: [
      {
        index: 1,
        action: "Open the financing screen",
        expected: "Financing need with VAT plus shown.",
      },
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending],
    context,
  });
  assert.ok(
    evaluation.violations.some(
      (violation) => violation.invariantId === "INV-VAT-01",
    ),
    "INV-VAT-01 violation must fire when the case includes VAT in the financing-need result",
  );
  assert.ok(evaluation.exercisedInvariants.includes("INV-VAT-01"));
});

test("evaluateInvariants: brutto/netto exclusivity is rejected on a single string", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    expectedResults: [
      "The total Netto and Brutto amounts both equal 1.000,00 €.",
    ],
  });
  const ok = buildCase({
    id: "tc-2",
    expectedResults: ["The Netto total is 1.000,00 €."],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending, ok],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-NETTO-BRUTTO-01",
    ).length,
    1,
  );
  const offendingEval = evaluation.cases.find(
    (entry) => entry.testCaseId === offending.id,
  );
  assert.ok(offendingEval);
  assert.ok(offendingEval.exercises.includes("INV-NETTO-BRUTTO-01"));
});

test("evaluateInvariants: optional-cost expectation without selection is a violation", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const offending = buildCase({
    expectedResults: [
      "The total includes the optional fee Versandgebühr and equals 105,00 €.",
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [offending],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
    ).length,
    1,
  );
});

test("evaluateInvariants: optional-cost selection in preconditions clears the case", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const ok = buildCase({
    preconditions: [
      "The optional fee Versandgebühr is selected with value 5,00 €.",
    ],
    expectedResults: [
      "The total includes the optional fee Versandgebühr and equals 105,00 €.",
    ],
  });
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [ok],
    context,
  });
  assert.equal(
    evaluation.violations.filter(
      (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
    ).length,
    0,
  );
});

test("evaluateInvariants: violations are sorted deterministically", () => {
  const intent = buildIntentWithFinancing();
  const context = buildContext(intent);
  const cases = [
    buildCase({
      id: "tc-z",
      expectedResults: ["Financing need equals 1.000,00 € VAT plus."],
    }),
    buildCase({
      id: "tc-a",
      expectedResults: ["Financing need equals 1.000,00 € VAT plus."],
    }),
  ];
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: cases,
    context,
  });
  const ids = evaluation.violations.map((violation) => violation.testCaseId);
  assert.deepEqual(ids, [...ids].sort((left, right) => left.localeCompare(right)));
});

test("computeInvariantCoverageRatio: empty registry yields zeros", () => {
  const ratio = computeInvariantCoverageRatio({
    registered: [],
    cases: [],
    exercisedInvariants: [],
    violations: [],
  });
  assert.deepEqual(ratio, { total: 0, exercised: 0, ratio: 0 });
});

test("computeInvariantCoverageRatio: rounds to six digits", () => {
  const ratio = computeInvariantCoverageRatio({
    registered: ["a", "b", "c"],
    cases: [],
    exercisedInvariants: ["a"],
    violations: [],
  });
  assert.deepEqual(ratio, {
    total: 3,
    exercised: 1,
    ratio: Math.round((1 / 3) * 1_000_000) / 1_000_000,
  });
});

test("evaluateInvariants: registry with no scope match leaves invariantCoverage at zero", () => {
  const intent = buildIntentNoFinancing();
  const context = buildContext(intent);
  const evaluation = evaluateInvariants({
    registry: buildActiveDatasetInvariantRegistry(),
    testCases: [buildCase({ expectedResults: ["Confirmation displayed."] })],
    context,
  });
  assert.deepEqual(evaluation.exercisedInvariants, []);
  assert.equal(evaluation.violations.length, 0);
  assert.equal(evaluation.registered.length, 4);
});
