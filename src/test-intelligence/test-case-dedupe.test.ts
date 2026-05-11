import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEDUPE_REPORT_ARTIFACT_FILENAME,
  DEDUPE_REPORT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
} from "../contracts/index.js";
import {
  cosineSimilarity,
  createDisabledExternalDedupeProbe,
  createUnconfiguredExternalDedupeProbe,
  detectTestCaseDuplicatesExtended,
  type EmbeddingProvider,
  type ExternalDedupeProbe,
  writeTestCaseDedupeReport,
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
  steps: [{ index: 1, action: "open screen", expected: "ok" }],
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

test("cosineSimilarity: identical vectors → 1", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
});

test("cosineSimilarity: orthogonal vectors → 0", () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: rejects mismatched lengths and non-finite components", () => {
  assert.throws(() => cosineSimilarity([1, 0], [1]), RangeError);
  assert.throws(() => cosineSimilarity([1, NaN], [1, 1]), RangeError);
  assert.throws(() => cosineSimilarity([1, 0], [1, Infinity]), RangeError);
});

test("cosineSimilarity: zero-magnitude vector → 0", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
});

test("air-gapped (no provider, no probe) → lexical-only path still flags duplicates", async () => {
  // Two test cases with identical titles + steps + traces should
  // exceed the lexical threshold.
  const a = buildCase({
    id: "tc-a",
    title: "Pay with valid IBAN",
    steps: [{ index: 1, action: "Open payment screen" }],
  });
  const b = buildCase({
    id: "tc-b",
    title: "Pay with valid IBAN",
    steps: [{ index: 1, action: "Open payment screen" }],
  });
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [a, b],
    lexicalThreshold: 0.6,
  });
  assert.equal(out.embeddingProvider.configured, false);
  assert.equal(out.externalProbe.state, "disabled");
  assert.equal(out.totals.internalLexical, 1);
  assert.equal(out.totals.internalEmbedding, 0);
  assert.equal(out.totals.externalMatches, 0);
  assert.equal(out.totals.duplicates, 2);
  for (const c of out.perCase) {
    assert.deepEqual(c.matchedSources, ["lexical"]);
    assert.equal(c.isDuplicate, true);
  }
});

test("air-gapped: completely distinct cases → no duplicates", async () => {
  const a = buildCase({
    id: "tc-a",
    title: "abcde",
    riskCategory: "low",
    figmaTraceRefs: [{ screenId: "s-1" }],
    steps: [{ index: 1, action: "abcde" }],
  });
  const b = buildCase({
    id: "tc-b",
    title: "ZYXWV",
    riskCategory: "high",
    figmaTraceRefs: [{ screenId: "s-2" }],
    steps: [{ index: 1, action: "ZYXWV" }],
  });
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [a, b],
    lexicalThreshold: 0.85,
  });
  assert.equal(out.totals.duplicates, 0);
  assert.equal(out.totals.internalLexical, 0);
});

test("embedding provider: similar vectors above threshold flagged", async () => {
  const a = buildCase({ id: "tc-a", title: "Title A" });
  const b = buildCase({ id: "tc-b", title: "Title B" });
  const provider: EmbeddingProvider = {
    identifier: "test-embedding-1",
    embed: (tc) =>
      Promise.resolve(tc.id === "tc-a" ? [1, 0, 0] : [0.99, 0.01, 0]),
  };
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [a, b],
    lexicalThreshold: 0.99,
    embeddingThreshold: 0.95,
    embeddingProvider: provider,
  });
  assert.equal(out.embeddingProvider.configured, true);
  assert.equal(out.embeddingProvider.identifier, "test-embedding-1");
  assert.equal(out.totals.internalEmbedding, 1);
  assert.equal(out.totals.duplicates, 2);
  assert.deepEqual(
    out.perCase.find((c) => c.testCaseId === "tc-a")?.matchedSources,
    ["embedding"],
  );
});

test("embedding provider: orthogonal vectors below threshold → not flagged", async () => {
  const a = buildCase({ id: "tc-a", title: "Title A" });
  const b = buildCase({ id: "tc-b", title: "Title B" });
  const provider: EmbeddingProvider = {
    identifier: "test-embedding-2",
    embed: (tc) => Promise.resolve(tc.id === "tc-a" ? [1, 0, 0] : [0, 1, 0]),
  };
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [a, b],
    lexicalThreshold: 0.99,
    embeddingThreshold: 0.5,
    embeddingProvider: provider,
  });
  assert.equal(out.totals.internalEmbedding, 0);
});

test("embedding provider: inconsistent vector dimensions throw", async () => {
  const a = buildCase({ id: "tc-a" });
  const b = buildCase({ id: "tc-b" });
  const provider: EmbeddingProvider = {
    identifier: "bad-provider",
    embed: (tc) => Promise.resolve(tc.id === "tc-a" ? [1, 0] : [1, 0, 0]),
  };
  await assert.rejects(
    () =>
      detectTestCaseDuplicatesExtended({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        testCases: [a, b],
        lexicalThreshold: 0.99,
        embeddingThreshold: 0.5,
        embeddingProvider: provider,
      }),
    RangeError,
  );
});

test("embedding provider: empty vector throws", async () => {
  const a = buildCase({ id: "tc-a" });
  const provider: EmbeddingProvider = {
    identifier: "empty",
    embed: () => Promise.resolve([]),
  };
  await assert.rejects(
    () =>
      detectTestCaseDuplicatesExtended({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        testCases: [a],
        lexicalThreshold: 0.99,
        embeddingThreshold: 0.5,
        embeddingProvider: provider,
      }),
    RangeError,
  );
});

test("external probe disabled by default → state=disabled, cases=0", async () => {
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [buildCase({ id: "tc-a" })],
    lexicalThreshold: 0.99,
  });
  assert.equal(out.externalProbe.state, "disabled");
  assert.equal(out.externalProbe.cases, 0);
  assert.equal(out.externalProbe.note, undefined);
});

test("external probe configured & found → external_lookup finding surfaces", async () => {
  const probe: ExternalDedupeProbe = {
    identifier: "qc:test",
    lookup: ({ testCase }) =>
      Promise.resolve(
        testCase.id === "tc-dup"
          ? {
              kind: "found",
              matchedFolderPath: "/Subject/X",
              matchedEntityId: "qc-123",
            }
          : { kind: "missing" },
      ),
  };
  // Make the two cases lexically distinct so the lexical path
  // does NOT contribute a matchedSource — that way the assertion
  // on `tc-dup`'s matched sources isolates the external probe.
  const dup = buildCase({
    id: "tc-dup",
    title: "alpha alpha alpha",
    figmaTraceRefs: [{ screenId: "screen-a" }],
    steps: [{ index: 1, action: "alpha alpha alpha" }],
  });
  const fresh = buildCase({
    id: "tc-fresh",
    title: "zulu zulu zulu",
    figmaTraceRefs: [{ screenId: "screen-z" }],
    steps: [{ index: 1, action: "zulu zulu zulu" }],
  });
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [dup, fresh],
    lexicalThreshold: 0.99,
    externalProbe: probe,
    externalContext: (tc) => ({
      externalIdCandidate: `ext-${tc.id}`,
      targetFolderPath: "/Subject/X",
    }),
  });
  assert.equal(out.externalProbe.state, "executed");
  assert.equal(out.externalProbe.cases, 2);
  assert.equal(out.externalFindings.length, 1);
  assert.equal(out.externalFindings[0]?.testCaseId, "tc-dup");
  assert.equal(out.externalFindings[0]?.matchedEntityId, "qc-123");
  assert.equal(out.externalFindings[0]?.externalIdCandidate, "ext-tc-dup");
  assert.deepEqual(
    out.perCase.find((c) => c.testCaseId === "tc-dup")?.matchedSources,
    ["external_lookup"],
  );
});

test("external probe unavailable on every case → state=unconfigured (fail-closed)", async () => {
  const probe = createUnconfiguredExternalDedupeProbe();
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [buildCase({ id: "tc-a" }), buildCase({ id: "tc-b" })],
    lexicalThreshold: 0.99,
    externalProbe: probe,
  });
  assert.equal(out.externalProbe.state, "unconfigured");
  assert.equal(out.externalProbe.cases, 2);
  assert.match(out.externalProbe.note ?? "", /external_probe_not_configured/);
  assert.equal(out.externalFindings.length, 0);
});

test("external probe disabled sentinel → state=executed, no findings", async () => {
  const probe = createDisabledExternalDedupeProbe();
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [buildCase({ id: "tc-a" })],
    lexicalThreshold: 0.99,
    externalProbe: probe,
  });
  assert.equal(out.externalProbe.state, "executed");
  assert.equal(out.externalFindings.length, 0);
});

test("external probe throws on a case → partial_failure with sanitised note", async () => {
  const probe: ExternalDedupeProbe = {
    identifier: "throws-once",
    lookup: ({ testCase }) => {
      if (testCase.id === "tc-bad") {
        throw new Error(
          "secret-token sk_live_abcd1234 leaked\nin error message",
        );
      }
      return Promise.resolve({ kind: "missing" });
    },
  };
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [buildCase({ id: "tc-bad" }), buildCase({ id: "tc-ok" })],
    lexicalThreshold: 0.99,
    externalProbe: probe,
  });
  assert.equal(out.externalProbe.state, "partial_failure");
  assert.equal(out.externalFindings.length, 0);
  // Note must collapse whitespace.
  assert.ok(out.externalProbe.note);
  assert.equal(out.externalProbe.note?.includes("\n"), false);
});

test("invariants are stamped + thresholds out of range throw", async () => {
  await assert.rejects(
    () =>
      detectTestCaseDuplicatesExtended({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        testCases: [],
        lexicalThreshold: 1.5,
      }),
    RangeError,
  );
  const a = buildCase({ id: "tc-a" });
  const provider: EmbeddingProvider = {
    identifier: "p",
    embed: () => Promise.resolve([1, 0]),
  };
  await assert.rejects(
    () =>
      detectTestCaseDuplicatesExtended({
        jobId: "job-1",
        generatedAt: "2026-04-26T00:00:00.000Z",
        testCases: [a],
        lexicalThreshold: 0.5,
        embeddingThreshold: -0.01,
        embeddingProvider: provider,
      }),
    RangeError,
  );
});

test("schemaVersion + invariants set + sorted findings", async () => {
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [],
    lexicalThreshold: 0.5,
  });
  assert.equal(out.schemaVersion, DEDUPE_REPORT_SCHEMA_VERSION);
  assert.equal(out.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(out.rawScreenshotsIncluded, false);
  assert.equal(out.secretsIncluded, false);
});

test("perCase rows are sorted by testCaseId for determinism", async () => {
  const out = await detectTestCaseDuplicatesExtended({
    jobId: "job-1",
    generatedAt: "2026-04-26T00:00:00.000Z",
    testCases: [
      buildCase({ id: "tc-z" }),
      buildCase({ id: "tc-a" }),
      buildCase({ id: "tc-m" }),
    ],
    lexicalThreshold: 0.5,
  });
  assert.deepEqual(
    out.perCase.map((c) => c.testCaseId),
    ["tc-a", "tc-m", "tc-z"],
  );
});

test("writeTestCaseDedupeReport persists deterministic canonical JSON atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wd-dedupe-"));
  try {
    const report = await detectTestCaseDuplicatesExtended({
      jobId: "job-1",
      generatedAt: "2026-04-26T00:00:00.000Z",
      testCases: [buildCase({ id: "tc-a" })],
      lexicalThreshold: 0.5,
    });
    const r = await writeTestCaseDedupeReport({
      report,
      destinationDir: dir,
    });
    assert.equal(r.artifactPath, join(dir, DEDUPE_REPORT_ARTIFACT_FILENAME));
    const raw = await readFile(r.artifactPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], DEDUPE_REPORT_SCHEMA_VERSION);
    // Re-write byte-identical.
    const r2 = await writeTestCaseDedupeReport({
      report,
      destinationDir: dir,
    });
    const raw2 = await readFile(r2.artifactPath, "utf8");
    assert.equal(raw, raw2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
