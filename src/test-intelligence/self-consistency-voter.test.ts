import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
} from "../contracts/index.js";
import {
  voteGeneratedTestCaseSamples,
  writeSelfConsistencyReport,
} from "./self-consistency-voter.js";

const makeCase = (input: {
  id: string;
  title: string;
  type?: GeneratedTestCase["type"];
  technique?: GeneratedTestCase["technique"];
  riskCategory?: GeneratedTestCase["riskCategory"];
  expected?: string;
}): GeneratedTestCase => ({
  id: input.id,
  sourceJobId: "job-2070",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: input.title,
  objective: input.title,
  level: "application",
  type: input.type ?? "functional",
  priority: "p1",
  riskCategory: input.riskCategory ?? "medium",
  technique: input.technique ?? "use_case",
  preconditions: [],
  testData: [],
  steps: [
    {
      index: 1,
      action: "Formular ausfuellen",
      ...(input.expected !== undefined ? { expected: input.expected } : {}),
    },
  ],
  expectedResults: input.expected === undefined ? [] : [input.expected],
  figmaTraceRefs: [{ screenId: "screen-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["field-1"],
    coveredActionIds: ["action-1"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.95,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-2070",
    generatedAt: "2026-05-09T10:00:00.000Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.1.0",
    cacheHit: false,
    cacheKey: `cache-${input.id}`,
    inputHash: `input-${input.id}`,
    promptHash: `prompt-${input.id}`,
    schemaHash: `schema-${input.id}`,
  },
});

const makeList = (testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-2070",
  testCases,
});

test("voteGeneratedTestCaseSamples applies 2-of-3 majority and preserves clean targets", () => {
  const sampleA = makeList([
    makeCase({
      id: "tc-a",
      title: "Berechnung",
      expected: "Falscher Zwischenwert",
    }),
  ]);
  const sampleB = makeList([
    makeCase({
      id: "tc-b",
      title: "Berechnung",
      expected: "Korrekter Finanzierungsbedarf",
    }),
  ]);
  const sampleC = makeList([
    makeCase({
      id: "tc-c",
      title: "Berechnung",
      expected: "Korrekter Finanzierungsbedarf",
    }),
  ]);

  const result = voteGeneratedTestCaseSamples({
    jobId: "job-2070",
    generatedAt: "2026-05-09T10:00:00.000Z",
    lists: [sampleA, sampleB, sampleC],
  });

  assert.equal(result.merged.testCases.length, 1);
  assert.equal(
    result.merged.testCases[0]?.steps[0]?.expected,
    "Korrekter Finanzierungsbedarf",
  );
  assert.notEqual(result.merged.testCases[0]?.reviewState, "needs_review");
  assert.equal(result.report.sampleCount, 3);
  assert.equal(result.report.targets.length, 1);
  assert.equal(result.report.targets[0]?.disagreement, false);
  assert.equal(result.report.targets[0]?.consensusStrength, "weak_consensus");
  const weakVote = result.report.targets[0]?.votes.find(
    (vote) => vote.consensusStrength === "weak_consensus",
  );
  assert.deepEqual(weakVote?.confidenceInterval95, [0.20766, 0.938508]);
  assert.equal(weakVote?.bootstrapSampleSize, 3);
  assert.ok(result.report.selfConsistencyAgreement < 1);
});

test("voteGeneratedTestCaseSamples routes unresolved disagreement to human review", () => {
  const sampleA = makeList([
    makeCase({ id: "tc-a", title: "Regel", type: "functional" }),
  ]);
  const sampleB = makeList([
    makeCase({ id: "tc-b", title: "Regel", type: "negative" }),
  ]);
  const sampleC = makeList([
    makeCase({ id: "tc-c", title: "Regel", type: "validation" }),
  ]);

  const result = voteGeneratedTestCaseSamples({
    jobId: "job-2070",
    generatedAt: "2026-05-09T10:00:00.000Z",
    lists: [sampleA, sampleB, sampleC],
  });

  assert.equal(result.merged.testCases.length, 1);
  assert.equal(result.merged.testCases[0]?.reviewState, "needs_review");
  assert.equal(
    result.merged.testCases[0]?.openQuestions.some((entry) =>
      entry.startsWith("self_consistency_disagreement:"),
    ),
    true,
  );
  assert.equal(result.report.targets[0]?.consensusStrength, "strong_consensus");
  assert.equal(result.report.targets[0]?.disagreement, true);
  assert.equal(result.report.targets[0]?.disagreementRoute, "human_review");
});

test("voteGeneratedTestCaseSamples can surface weak consensus toward cross-family arbitration", () => {
  const sampleA = makeList([
    makeCase({ id: "tc-a", title: "Regel", expected: "A" }),
  ]);
  const sampleB = makeList([
    makeCase({ id: "tc-b", title: "Regel", expected: "B" }),
  ]);
  const sampleC = makeList([
    makeCase({ id: "tc-c", title: "Regel", expected: "B" }),
  ]);

  const result = voteGeneratedTestCaseSamples({
    jobId: "job-2070",
    generatedAt: "2026-05-09T10:00:00.000Z",
    lists: [sampleA, sampleB, sampleC],
    disagreementRoute: "cross_family_arbitration",
  });

  assert.equal(result.report.targets[0]?.consensusStrength, "weak_consensus");
  assert.equal(
    result.report.targets[0]?.votes.some(
      (vote) => vote.consensusStrength === "weak_consensus",
    ),
    true,
  );
  assert.equal(result.report.targets[0]?.disagreementRoute, undefined);
});

test("writeSelfConsistencyReport persists the canonical report artifact", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "self-consistency-"));
  try {
    const report = voteGeneratedTestCaseSamples({
      jobId: "job-2070",
      generatedAt: "2026-05-09T10:00:00.000Z",
      lists: [
        makeList([makeCase({ id: "tc-a", title: "Berechnung" })]),
        makeList([makeCase({ id: "tc-b", title: "Berechnung" })]),
        makeList([makeCase({ id: "tc-c", title: "Berechnung" })]),
      ],
    }).report;

    const written = await writeSelfConsistencyReport({
      runDir: tempRoot,
      report,
    });

    assert.ok(
      written.artifactPath.endsWith(SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME),
    );
    const fromDisk = await readFile(written.artifactPath, "utf8");
    assert.equal(fromDisk, written.bytes.toString("utf8"));
    assert.equal(fromDisk.endsWith("\n"), true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
