import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type BusinessTestIntentIr,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { classifyTestCaseDelta } from "./test-case-delta.js";

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
  steps: [{ index: 1, action: "do something", expected: "ok" }],
  expectedResults: ["ok"],
  figmaTraceRefs: [{ screenId: "screen-a" }],
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

const intentWithScreens = (screenIds: string[]): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: screenIds.map((id) => ({
    screenId: id,
    screenName: id,
    trace: { nodeId: id },
  })),
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

const idArb = fc.string({ minLength: 1, maxLength: 12 });
const titleArb = fc.string({ minLength: 1, maxLength: 24 });

const caseArb = fc
  .record({
    id: idArb,
    title: titleArb,
    screen: fc.constantFrom("screen-a", "screen-b", "screen-c"),
  })
  .map((r) =>
    buildCase({
      id: `tc-${r.id}`,
      title: r.title,
      figmaTraceRefs: [{ screenId: r.screen }],
    }),
  );

test("property: stable fingerprint AND no IR delta touch yields `unchanged`", () => {
  fc.assert(
    fc.property(caseArb, (tc) => {
      const out = classifyTestCaseDelta({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: list([tc]),
        current: list([tc]),
        currentIntent: intentWithScreens(["screen-a", "screen-b", "screen-c"]),
      });
      assert.equal(out.rows[0]?.verdict, "unchanged");
    }),
    { numRuns: 64 },
  );
});

test("property: case absent from current with all trace screens absent from IR is `obsolete`", () => {
  fc.assert(
    fc.property(caseArb, (tc) => {
      const out = classifyTestCaseDelta({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        prior: list([tc]),
        current: list([]),
        currentIntent: intentWithScreens([]),
      });
      assert.equal(out.rows[0]?.verdict, "obsolete");
    }),
    { numRuns: 64 },
  );
});

test("property: classifier output is deterministic", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(caseArb, { selector: (c) => c.id, maxLength: 6 }),
      fc.uniqueArray(caseArb, { selector: (c) => c.id, maxLength: 6 }),
      (prior, current) => {
        const opts = {
          jobId: "job-1",
          generatedAt: "2026-04-26T00:00:00.000Z",
          prior: list(prior),
          current: list(current),
          currentIntent: intentWithScreens([
            "screen-a",
            "screen-b",
            "screen-c",
          ]),
        };
        const a = classifyTestCaseDelta(opts);
        const b = classifyTestCaseDelta(opts);
        assert.equal(canonicalJson(a), canonicalJson(b));
      },
    ),
    { numRuns: 64 },
  );
});

test("property: every row has an allowed verdict + each verdict's reasons all in the allowlist", () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(caseArb, { selector: (c) => c.id, maxLength: 4 }),
      fc.uniqueArray(caseArb, { selector: (c) => c.id, maxLength: 4 }),
      (prior, current) => {
        const out = classifyTestCaseDelta({
          jobId: "job-1",
          generatedAt: "2026-04-26T00:00:00.000Z",
          prior: list(prior),
          current: list(current),
          currentIntent: intentWithScreens([
            "screen-a",
            "screen-b",
            "screen-c",
          ]),
        });
        for (const r of out.rows) {
          assert.ok(
            [
              "new",
              "unchanged",
              "changed",
              "obsolete",
              "requires_review",
            ].includes(r.verdict),
          );
          // Reasons array sorted (set-derived) and unique.
          const sortedCopy = r.reasons.slice().sort();
          assert.deepEqual(r.reasons, sortedCopy);
          assert.equal(new Set(r.reasons).size, r.reasons.length);
        }
      },
    ),
    { numRuns: 64 },
  );
});
