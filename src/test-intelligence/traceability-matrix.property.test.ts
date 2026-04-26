import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { buildTraceabilityMatrix } from "./traceability-matrix.js";

const ZERO = "0".repeat(64);

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-x",
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
  steps: [{ index: 1, action: "open screen" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "screen-a", nodeId: "node-1" }],
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

const list = (cases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: cases,
});

const intentEmpty = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [],
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

const idArb = fc.string({ minLength: 1, maxLength: 8 }).map((s) => `tc-${s}`);

test("property: buildTraceabilityMatrix is deterministic", () => {
  fc.assert(
    fc.property(fc.uniqueArray(idArb, { maxLength: 5 }), (ids) => {
      const cases = ids.map((id) => buildCase({ id }));
      const a = buildTraceabilityMatrix({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        intent: intentEmpty(),
        list: list(cases),
      });
      const b = buildTraceabilityMatrix({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        intent: intentEmpty(),
        list: list(cases),
      });
      assert.equal(canonicalJson(a), canonicalJson(b));
    }),
    { numRuns: 32 },
  );
});

test("property: rows always sorted by testCaseId", () => {
  fc.assert(
    fc.property(fc.uniqueArray(idArb, { maxLength: 6 }), (ids) => {
      const cases = ids.map((id) => buildCase({ id }));
      const matrix = buildTraceabilityMatrix({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        intent: intentEmpty(),
        list: list(cases),
      });
      const actual = matrix.rows.map((r) => r.testCaseId);
      const expected = actual.slice().sort();
      assert.deepEqual(actual, expected);
    }),
    { numRuns: 32 },
  );
});

test("property: hard invariants always stamped false", () => {
  fc.assert(
    fc.property(fc.uniqueArray(idArb, { maxLength: 4 }), (ids) => {
      const matrix = buildTraceabilityMatrix({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        intent: intentEmpty(),
        list: list(ids.map((id) => buildCase({ id }))),
      });
      assert.equal(matrix.rawScreenshotsIncluded, false);
      assert.equal(matrix.secretsIncluded, false);
    }),
    { numRuns: 32 },
  );
});

test("property: totals.rows always equals rows.length", () => {
  fc.assert(
    fc.property(fc.uniqueArray(idArb, { maxLength: 6 }), (ids) => {
      const matrix = buildTraceabilityMatrix({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        intent: intentEmpty(),
        list: list(ids.map((id) => buildCase({ id }))),
      });
      assert.equal(matrix.totals.rows, matrix.rows.length);
    }),
    { numRuns: 32 },
  );
});
