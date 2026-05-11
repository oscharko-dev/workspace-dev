import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  cosineSimilarity,
  detectTestCaseDuplicatesExtended,
  type EmbeddingProvider,
} from "./test-case-dedupe.js";

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

test("property: cosineSimilarity always in [0, 1] for finite vectors", () => {
  const finiteVecArb = fc.array(
    fc.double({ noNaN: true, min: -1e6, max: 1e6 }),
    { minLength: 1, maxLength: 8 },
  );
  fc.assert(
    fc.property(
      finiteVecArb,
      finiteVecArb.filter((v) => v.length > 0),
      (a, b) => {
        const padded =
          b.length === a.length
            ? b
            : b
                .slice(0, a.length)
                .concat(
                  Array.from(
                    { length: Math.max(0, a.length - b.length) },
                    () => 0,
                  ),
                );
        if (padded.length !== a.length) return;
        const sim = cosineSimilarity(a, padded);
        assert.ok(sim >= 0 && sim <= 1, `sim ${sim} out of [0, 1]`);
      },
    ),
    { numRuns: 64 },
  );
});

test("property: identical vector pair → cosineSimilarity = 1 (within fp epsilon) for non-zero inputs", () => {
  const nonZeroVecArb = fc
    .array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 8 })
    .map((arr) => arr.map((n) => n));
  fc.assert(
    fc.property(nonZeroVecArb, (v) => {
      const sim = cosineSimilarity(v, v);
      assert.ok(Math.abs(sim - 1) < 1e-9, `sim ${sim} not within ε of 1`);
    }),
    { numRuns: 64 },
  );
});

test("property: detectTestCaseDuplicatesExtended is deterministic across two runs", () => {
  fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(
        fc
          .record({ id: fc.string({ minLength: 1, maxLength: 8 }) })
          .map((r) => buildCase({ id: `tc-${r.id}` })),
        { selector: (c) => c.id, maxLength: 5 },
      ),
      async (cases) => {
        const opts = {
          jobId: "job-1",
          generatedAt: "2026-04-26T00:00:00.000Z",
          testCases: cases,
          lexicalThreshold: 0.5,
        };
        const a = await detectTestCaseDuplicatesExtended(opts);
        const b = await detectTestCaseDuplicatesExtended(opts);
        assert.equal(canonicalJson(a), canonicalJson(b));
      },
    ),
    { numRuns: 32 },
  );
});

test("property: when no provider/no probe, totals.duplicates equals lexical-flagged perCase entries", () => {
  fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(
        fc
          .record({ id: fc.string({ minLength: 1, maxLength: 8 }) })
          .map((r) => buildCase({ id: `tc-${r.id}` })),
        { selector: (c) => c.id, maxLength: 5 },
      ),
      async (cases) => {
        const out = await detectTestCaseDuplicatesExtended({
          jobId: "job-1",
          generatedAt: "2026-04-26T00:00:00.000Z",
          testCases: cases,
          lexicalThreshold: 0.5,
        });
        const flagged = out.perCase.filter((c) => c.isDuplicate).length;
        assert.equal(out.totals.duplicates, flagged);
        assert.equal(out.totals.internalEmbedding, 0);
        assert.equal(out.totals.externalMatches, 0);
      },
    ),
    { numRuns: 32 },
  );
});

test("property: with a constant-vector embedding provider, all >=2 cases are flagged as duplicates above threshold 0.5", () => {
  const provider: EmbeddingProvider = {
    identifier: "constant",
    embed: () => Promise.resolve([1, 0, 0]),
  };
  fc.assert(
    fc.asyncProperty(
      fc.uniqueArray(
        fc
          .record({ id: fc.string({ minLength: 1, maxLength: 8 }) })
          .map((r) => buildCase({ id: `tc-${r.id}` })),
        { selector: (c) => c.id, minLength: 2, maxLength: 5 },
      ),
      async (cases) => {
        const out = await detectTestCaseDuplicatesExtended({
          jobId: "job-1",
          generatedAt: "2026-04-26T00:00:00.000Z",
          testCases: cases,
          lexicalThreshold: 0.99,
          embeddingThreshold: 0.5,
          embeddingProvider: provider,
        });
        for (const c of out.perCase) {
          assert.ok(
            c.matchedSources.includes("embedding"),
            `case ${c.testCaseId} missing embedding source`,
          );
        }
      },
    ),
    { numRuns: 32 },
  );
});
