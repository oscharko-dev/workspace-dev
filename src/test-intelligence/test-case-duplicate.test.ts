import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  buildTestCaseFingerprint,
  detectDuplicateTestCases,
  jaccardSimilarity,
} from "./test-case-duplicate.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";

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
  steps: [{ index: 1, action: "do something", expected: "ok" }],
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

test("identical fingerprints have similarity 1", () => {
  const fp = buildTestCaseFingerprint(
    buildCase({ id: "a", title: "Pay with valid IBAN" }),
  );
  assert.equal(jaccardSimilarity(fp, fp), 1);
});

test("disjoint fingerprints have similarity 0", () => {
  const a = buildTestCaseFingerprint(
    buildCase({
      id: "a",
      title: "abcde",
      type: "functional",
      riskCategory: "low",
      figmaTraceRefs: [{ screenId: "s-1" }],
      steps: [{ index: 1, action: "abcde" }],
    }),
  );
  const b = buildTestCaseFingerprint(
    buildCase({
      id: "b",
      title: "ZYXWV",
      type: "negative",
      riskCategory: "high",
      figmaTraceRefs: [{ screenId: "s-2" }],
      steps: [{ index: 1, action: "ZYXWV" }],
    }),
  );
  assert.equal(jaccardSimilarity(a, b), 0);
});

test("near-duplicate cases above threshold are reported deterministically", () => {
  const a = buildCase({
    id: "tc-aa",
    title: "Pay with valid IBAN",
    steps: [
      { index: 1, action: "Open payment screen" },
      { index: 2, action: "Submit form", expected: "Confirmation displayed" },
    ],
  });
  const b = buildCase({
    id: "tc-bb",
    title: "Pay with valid IBAN.",
    steps: [
      { index: 1, action: "Open payment screen!" },
      { index: 2, action: "Submit form", expected: "Confirmation displayed." },
    ],
  });
  const c = buildCase({
    id: "tc-cc",
    title: "Reset password flow",
    steps: [
      { index: 1, action: "Click forgot password link" },
      { index: 2, action: "Enter email", expected: "Reset email sent" },
    ],
    figmaTraceRefs: [{ screenId: "s-2" }],
  });
  const pairs = detectDuplicateTestCases({
    testCases: [a, b, c],
    threshold: 0.7,
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.leftTestCaseId, "tc-aa");
  assert.equal(pairs[0]?.rightTestCaseId, "tc-bb");
  assert.ok((pairs[0]?.similarity ?? 0) >= 0.7);
});

test("threshold validation rejects out-of-range values", () => {
  assert.throws(
    () => detectDuplicateTestCases({ testCases: [], threshold: -0.1 }),
    RangeError,
  );
  assert.throws(
    () => detectDuplicateTestCases({ testCases: [], threshold: 1.5 }),
    RangeError,
  );
});

test("pairs are emitted in lexical id order regardless of input order", () => {
  const a = buildCase({ id: "z-case" });
  const b = buildCase({ id: "a-case" });
  const pairs = detectDuplicateTestCases({
    testCases: [a, b],
    threshold: 0.0,
  });
  assert.ok(pairs.length >= 1);
  assert.equal(pairs[0]?.leftTestCaseId, "a-case");
  assert.equal(pairs[0]?.rightTestCaseId, "z-case");
});
