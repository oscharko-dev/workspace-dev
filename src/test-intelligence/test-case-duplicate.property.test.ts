import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
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

const buildCase = (id: string, title: string): GeneratedTestCase => ({
  id,
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title,
  objective: "obj",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: title, expected: "ok" }],
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
});

test("jaccard similarity is symmetric", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 60 }),
      fc.string({ minLength: 1, maxLength: 60 }),
      (titleA, titleB) => {
        const a = buildTestCaseFingerprint(buildCase("a", titleA));
        const b = buildTestCaseFingerprint(buildCase("b", titleB));
        return jaccardSimilarity(a, b) === jaccardSimilarity(b, a);
      },
    ),
    { numRuns: 250 },
  );
});

test("jaccard similarity is bounded in [0, 1]", () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.string({ minLength: 1, maxLength: 80 }),
      (titleA, titleB) => {
        const a = buildTestCaseFingerprint(buildCase("a", titleA));
        const b = buildTestCaseFingerprint(buildCase("b", titleB));
        const s = jaccardSimilarity(a, b);
        return s >= 0 && s <= 1;
      },
    ),
    { numRuns: 250 },
  );
});

test("a case is always identical to itself", () => {
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 80 }), (title) => {
      const fp = buildTestCaseFingerprint(buildCase("a", title));
      return jaccardSimilarity(fp, fp) === 1;
    }),
    { numRuns: 100 },
  );
});

test("duplicate detector emits pairs in sorted (left, right) lex order", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.string({ minLength: 1, maxLength: 8 }), {
        minLength: 2,
        maxLength: 6,
      }),
      (titles) => {
        const cases = titles.map((t, i) => buildCase(`tc-${i}`, t));
        const pairs = detectDuplicateTestCases({
          testCases: cases,
          threshold: 0,
        });
        for (const p of pairs) {
          if (p.leftTestCaseId > p.rightTestCaseId) return false;
        }
        for (let i = 1; i < pairs.length; i++) {
          const prev = pairs[i - 1]!;
          const cur = pairs[i]!;
          if (
            prev.leftTestCaseId > cur.leftTestCaseId ||
            (prev.leftTestCaseId === cur.leftTestCaseId &&
              prev.rightTestCaseId > cur.rightTestCaseId)
          ) {
            return false;
          }
        }
        return true;
      },
    ),
    { numRuns: 100 },
  );
});

test("threshold 0 produces all C(n,2) pairs", () => {
  const cases = [
    buildCase("tc-1", "title-a"),
    buildCase("tc-2", "title-b"),
    buildCase("tc-3", "title-c"),
  ];
  const pairs = detectDuplicateTestCases({
    testCases: cases,
    threshold: 0,
  });
  assert.equal(pairs.length, 3);
});

test("threshold > 1 raises RangeError", () => {
  assert.throws(() =>
    detectDuplicateTestCases({ testCases: [], threshold: 2 }),
  );
});
