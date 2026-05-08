/**
 * Property-based assertions on the domain-invariant registry (Issue #2040).
 *
 * These tests treat the active-dataset registry as a black box and use
 * fast-check to derive concrete `(precondition, expected)` pairs from the
 * registered sampler factories. The assertions encode the load-bearing
 * properties of the DSL itself:
 *
 *   1. A case generated to satisfy an invariant must not be reported as
 *      a violation of that invariant by the registry's `holds` predicate.
 *   2. A case engineered to *break* an invariant must trigger that
 *      invariant's `holds` predicate to return `false`.
 *   3. The registry is deterministic: re-running `evaluateInvariants` on
 *      the same input yields identical outputs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  buildActiveDatasetInvariantRegistry,
  evaluateInvariants,
} from "./domain-invariant-registry.js";
import { buildTestDesignModel } from "./test-design-model.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO_HASH },
  screens: [
    {
      screenId: "s-form",
      screenName: "Form",
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

const baseCase = (overrides: Partial<GeneratedTestCase>): GeneratedTestCase => ({
  id: overrides.id ?? "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: overrides.title ?? "Property-based case",
  objective: overrides.objective ?? "Run a property-based check",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: overrides.preconditions ?? [],
  testData: overrides.testData ?? [],
  steps: overrides.steps ?? [
    { index: 1, action: "Open the form" },
    {
      index: 2,
      action: "Submit the form",
      expected: "Confirmation displayed.",
    },
  ],
  expectedResults: overrides.expectedResults ?? ["Confirmation displayed."],
  figmaTraceRefs: overrides.figmaTraceRefs ?? [{ screenId: "s-form" }],
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
});

const buildContext = (intent = buildIntent()) => ({
  intent,
  model: buildTestDesignModel({ jobId: "job-1", intent }),
});

const NETTO_AMOUNT = fc.integer({ min: 100, max: 5_000 });
const OPTIONAL_FEE = fc.integer({ min: 5, max: 250 });

test("property: well-formed Netto-only expectation never violates INV-NETTO-BRUTTO-01", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const context = buildContext();
  fc.assert(
    fc.property(NETTO_AMOUNT, (amount) => {
      const tc = baseCase({
        expectedResults: [`The Netto total equals ${amount},00 €.`],
      });
      const evaluation = evaluateInvariants({
        registry,
        testCases: [tc],
        context,
      });
      const nettoBrutto = evaluation.violations.filter(
        (violation) => violation.invariantId === "INV-NETTO-BRUTTO-01",
      );
      return nettoBrutto.length === 0;
    }),
    { numRuns: 32, seed: 0xa07a },
  );
});

test("property: optional-cost expectation without selection always violates INV-OPTIONAL-COST-01", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const context = buildContext();
  fc.assert(
    fc.property(NETTO_AMOUNT, OPTIONAL_FEE, (base, fee) => {
      const tc = baseCase({
        preconditions: [],
        steps: [{ index: 1, action: "Open the form" }],
        expectedResults: [
          `The total includes the optional fee Versandgebühr and equals ${base + fee},00 €.`,
        ],
      });
      const evaluation = evaluateInvariants({
        registry,
        testCases: [tc],
        context,
      });
      return (
        evaluation.violations.filter(
          (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
        ).length === 1
      );
    }),
    { numRuns: 32, seed: 0xa07b },
  );
});

test("property: optional-cost expectation with declared selection never violates INV-OPTIONAL-COST-01", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const context = buildContext();
  fc.assert(
    fc.property(NETTO_AMOUNT, OPTIONAL_FEE, (base, fee) => {
      const tc = baseCase({
        preconditions: [
          `The optional fee Versandgebühr is selected with value ${fee},00 €.`,
        ],
        expectedResults: [
          `The total includes the optional fee Versandgebühr and equals ${base + fee},00 €.`,
        ],
      });
      const evaluation = evaluateInvariants({
        registry,
        testCases: [tc],
        context,
      });
      return (
        evaluation.violations.filter(
          (violation) => violation.invariantId === "INV-OPTIONAL-COST-01",
        ).length === 0
      );
    }),
    { numRuns: 32, seed: 0xa07c },
  );
});

test("property: evaluator is deterministic — same input yields byte-identical output", () => {
  const registry = buildActiveDatasetInvariantRegistry();
  const context = buildContext();
  fc.assert(
    fc.property(NETTO_AMOUNT, (amount) => {
      const tc = baseCase({
        expectedResults: [`The Netto total equals ${amount},00 €.`],
      });
      const a = JSON.stringify(
        evaluateInvariants({ registry, testCases: [tc], context }),
      );
      const b = JSON.stringify(
        evaluateInvariants({ registry, testCases: [tc], context }),
      );
      return a === b;
    }),
    { numRuns: 16, seed: 0xa07d },
  );
});
