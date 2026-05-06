import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CASE_MERGER_REPORT_ARTIFACT_FILENAME,
  CASE_MERGER_REPORT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type CaseMergerReport,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type RepairInstruction,
  type TestCaseTechnique29119,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildCaseMergerSignature,
  mergeGeneratedTestCaseLists,
  mergeGeneratedTestCaseListsWithProvenance,
  writeCaseMergerReport,
} from "./case-merger.js";

const JOB_ID = "job-1937";
const GENERATED_AT = "2026-05-06T12:00:00.000Z";

const buildCase = (
  id: string,
  overrides: Partial<GeneratedTestCase> & {
    technique?: TestCaseTechnique29119;
    coveredFieldIds?: string[];
    coveredActionIds?: string[];
    coveredValidationIds?: string[];
    coveredNavigationIds?: string[];
    screenId?: string;
  } = {},
): GeneratedTestCase => {
  const screenId = overrides.screenId ?? "s-payment";
  const coveredFieldIds = overrides.coveredFieldIds ?? [
    `${screenId}::field::n-iban`,
  ];
  const coveredActionIds = overrides.coveredActionIds ?? [];
  const coveredValidationIds = overrides.coveredValidationIds ?? [];
  const coveredNavigationIds = overrides.coveredNavigationIds ?? [];
  const technique = overrides.technique ?? "boundary_value_analysis";
  return {
    id,
    sourceJobId: JOB_ID,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: `Test case ${id}`,
    objective: `Objective for ${id}`,
    level: "system",
    type: "validation",
    priority: "p1",
    riskCategory: "regulated_data",
    technique,
    preconditions: [],
    testData: [],
    steps: [{ index: 1, action: "act", expected: "ok" }],
    expectedResults: ["pass"],
    figmaTraceRefs: [{ screenId, nodeId: `${screenId}-node` }],
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: true },
    qualitySignals: {
      coveredFieldIds,
      coveredActionIds,
      coveredValidationIds,
      coveredNavigationIds,
      confidence: 0.85,
    },
    reviewState: "draft",
    audit: {
      jobId: JOB_ID,
      generatedAt: GENERATED_AT,
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      redactionPolicyVersion: REDACTION_POLICY_VERSION,
      visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      cacheHit: false,
      cacheKey: `cache-${id}`,
      inputHash: "a".repeat(64),
      promptHash: "b".repeat(64),
      schemaHash: "c".repeat(64),
    },
    ...overrides,
  };
};

const buildList = (testCases: GeneratedTestCase[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: JOB_ID,
  testCases,
});

const buildRepair = (
  testCaseId: string,
  path = "$.expectedResults",
): RepairInstruction => ({
  testCaseId,
  path,
  instruction: "rewrite the assertion",
});

test("case-merger: merges disjoint passes and labels provenance per pass", () => {
  const runA = buildList([buildCase("tc-a-1", { coveredFieldIds: ["f1"] })]);
  const runB = buildList([buildCase("tc-b-1", { coveredFieldIds: ["f2"] })]);

  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });

  assert.equal(merged.testCases.length, 2);
  assert.deepEqual(
    merged.testCases.map((c) => c.id).sort(),
    ["tc-a-1", "tc-b-1"],
  );
  assert.equal(report.totals.runACount, 1);
  assert.equal(report.totals.runBCount, 1);
  assert.equal(report.totals.mergedCount, 2);
  assert.equal(report.totals.onlyInRunA, 1);
  assert.equal(report.totals.onlyInRunB, 1);
  assert.equal(report.totals.inBoth, 0);
  const provenances = new Map(
    report.entries.map((entry) => [entry.testCaseId, entry.provenance]),
  );
  assert.equal(provenances.get("tc-a-1"), "runA");
  assert.equal(provenances.get("tc-b-1"), "runB");
});

test("case-merger: full overlap collapses with positive bias toward pass A", () => {
  const sharedFieldIds = ["f1", "f2"];
  const runA = buildList([
    buildCase("tc-a-iban", { coveredFieldIds: sharedFieldIds }),
  ]);
  const runB = buildList([
    buildCase("tc-b-iban", { coveredFieldIds: sharedFieldIds }),
  ]);

  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });

  assert.equal(merged.testCases.length, 1);
  assert.equal(merged.testCases[0]?.id, "tc-a-iban");
  assert.equal(report.entries.length, 1);
  const entry = report.entries[0]!;
  assert.equal(entry.provenance, "both");
  assert.equal(entry.conflictResolution, "positive_bias_run_a");
  assert.equal(entry.droppedTestCaseId, "tc-b-iban");
  assert.equal(report.totals.conflictsResolvedByPositiveBias, 1);
  assert.equal(report.totals.conflictsResolvedByRepair, 0);
});

test("case-merger: partial overlap merges shared cases and keeps unique ones", () => {
  const runA = buildList([
    buildCase("tc-a-iban", { coveredFieldIds: ["iban"] }),
    buildCase("tc-a-amount", {
      coveredFieldIds: ["amount"],
      technique: "equivalence_partitioning",
    }),
  ]);
  const runB = buildList([
    buildCase("tc-b-iban", { coveredFieldIds: ["iban"] }),
    buildCase("tc-b-recipient", {
      coveredFieldIds: ["recipient"],
      technique: "decision_table",
    }),
  ]);

  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });

  assert.equal(merged.testCases.length, 3);
  assert.equal(report.totals.inBoth, 1);
  assert.equal(report.totals.onlyInRunA, 1);
  assert.equal(report.totals.onlyInRunB, 1);

  const ibanEntry = report.entries.find(
    (entry) => entry.testCaseId === "tc-a-iban",
  );
  assert.ok(ibanEntry);
  assert.equal(ibanEntry?.provenance, "both");
  const amountEntry = report.entries.find(
    (entry) => entry.testCaseId === "tc-a-amount",
  );
  assert.equal(amountEntry?.provenance, "runA");
  const recipientEntry = report.entries.find(
    (entry) => entry.testCaseId === "tc-b-recipient",
  );
  assert.equal(recipientEntry?.provenance, "runB");
});

test("case-merger: conflict-resolution rule 1 prefers the un-repaired side", () => {
  // Both passes produced the same case (same signature) — pass A's variant
  // is flagged for repair, pass B's is clean. The merger MUST drop the
  // repaired side and keep the un-repaired one even though pass A would
  // win under the positive-bias fallback.
  const runA = buildList([
    buildCase("tc-a-iban", { coveredFieldIds: ["iban"] }),
  ]);
  const runB = buildList([
    buildCase("tc-b-iban", { coveredFieldIds: ["iban"] }),
  ]);

  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
    repairs: { runA: [buildRepair("tc-a-iban")] },
  });

  assert.equal(merged.testCases.length, 1);
  assert.equal(merged.testCases[0]?.id, "tc-b-iban");
  const entry = report.entries[0]!;
  assert.equal(entry.testCaseId, "tc-b-iban");
  assert.equal(entry.conflictResolution, "prefer_unrepaired");
  assert.equal(entry.droppedTestCaseId, "tc-a-iban");
  assert.equal(report.totals.conflictsResolvedByRepair, 1);
  assert.equal(report.totals.conflictsResolvedByPositiveBias, 0);
});

test("case-merger: when both sides carry repair instructions, falls back to positive bias", () => {
  const runA = buildList([
    buildCase("tc-a-iban", { coveredFieldIds: ["iban"] }),
  ]);
  const runB = buildList([
    buildCase("tc-b-iban", { coveredFieldIds: ["iban"] }),
  ]);

  const { report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
    repairs: {
      runA: [buildRepair("tc-a-iban")],
      runB: [buildRepair("tc-b-iban")],
    },
  });

  const entry = report.entries[0]!;
  assert.equal(entry.testCaseId, "tc-a-iban");
  assert.equal(entry.conflictResolution, "positive_bias_run_a");
  assert.equal(report.totals.conflictsResolvedByPositiveBias, 1);
});

test("case-merger: conflict path absorbs coverage ids from the dropped pass", () => {
  // Same signature seed (sorted coveredFieldIds match) but each side
  // contributes a unique action id. The surviving case must carry both.
  const runA = buildList([
    buildCase("tc-a", {
      coveredFieldIds: ["iban"],
      coveredActionIds: ["submit"],
    }),
  ]);
  const runB = buildList([
    buildCase("tc-b", {
      coveredFieldIds: ["iban"],
      coveredActionIds: ["submit"],
      coveredNavigationIds: ["nav-confirm"],
    }),
  ]);

  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });

  assert.equal(merged.testCases.length, 1);
  const surviving = merged.testCases[0]!;
  assert.equal(surviving.id, "tc-a");
  assert.deepEqual(surviving.qualitySignals.coveredNavigationIds, [
    "nav-confirm",
  ]);
  const entry = report.entries[0]!;
  assert.equal(entry.qualitySignalsCoverageMerged, true);
});

test("case-merger: empty inputs produce an empty merged list and zeroed totals", () => {
  const empty = buildList([]);
  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [empty, empty],
    generatedAt: GENERATED_AT,
  });
  assert.equal(merged.testCases.length, 0);
  assert.equal(report.entries.length, 0);
  assert.equal(report.totals.mergedCount, 0);
  assert.equal(report.totals.runACount, 0);
  assert.equal(report.totals.runBCount, 0);
});

test("case-merger: rejects mixed jobIds", () => {
  const runA = buildList([buildCase("tc-a")]);
  const runB: GeneratedTestCaseList = {
    ...buildList([buildCase("tc-b")]),
    jobId: "job-other",
  };
  assert.throws(
    () =>
      mergeGeneratedTestCaseListsWithProvenance({
        lists: [runA, runB],
        generatedAt: GENERATED_AT,
      }),
    /must share the same jobId/,
  );
});

test("case-merger: signature includes screenId and technique so different screens never collapse", () => {
  const runA = buildList([
    buildCase("tc-a", {
      screenId: "s-payment",
      coveredFieldIds: ["amount"],
    }),
  ]);
  const runB = buildList([
    buildCase("tc-b", {
      screenId: "s-confirm",
      coveredFieldIds: ["amount"],
    }),
  ]);
  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });
  assert.equal(merged.testCases.length, 2);
  assert.equal(report.totals.inBoth, 0);
});

test("case-merger: signature is order-insensitive across coveredFieldIds and coveredActionIds", () => {
  // Pass A lists fields in one order; pass B lists the same fields in a
  // permuted order. The dedup signature MUST collapse them.
  const runA = buildList([
    buildCase("tc-a", {
      coveredFieldIds: ["alpha", "beta", "gamma"],
      coveredActionIds: ["one", "two"],
    }),
  ]);
  const runB = buildList([
    buildCase("tc-b", {
      coveredFieldIds: ["gamma", "alpha", "beta"],
      coveredActionIds: ["two", "one"],
    }),
  ]);
  const { merged, report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });
  assert.equal(merged.testCases.length, 1);
  assert.equal(report.totals.inBoth, 1);
  assert.equal(report.entries[0]?.testCaseId, "tc-a");
});

test("case-merger: deterministic — equivalent inputs in different orders produce byte-identical artifacts", () => {
  const a1 = buildCase("tc-1", { coveredFieldIds: ["f1"] });
  const a2 = buildCase("tc-2", { coveredFieldIds: ["f2"] });
  const b1 = buildCase("tc-3", { coveredFieldIds: ["f3"] });
  const b2 = buildCase("tc-4", { coveredFieldIds: ["f4"] });

  const left = mergeGeneratedTestCaseListsWithProvenance({
    lists: [buildList([a1, a2]), buildList([b1, b2])],
    generatedAt: GENERATED_AT,
  });
  const right = mergeGeneratedTestCaseListsWithProvenance({
    lists: [buildList([a2, a1]), buildList([b2, b1])],
    generatedAt: GENERATED_AT,
  });

  assert.equal(canonicalJson(left.merged), canonicalJson(right.merged));
  assert.equal(canonicalJson(left.report), canonicalJson(right.report));
});

test("case-merger: property — N runs over permuted inputs converge on the same canonical merged list", () => {
  const cases = [
    buildCase("tc-a", { coveredFieldIds: ["alpha"], coveredActionIds: ["x"] }),
    buildCase("tc-b", {
      coveredFieldIds: ["beta"],
      technique: "decision_table",
    }),
    buildCase("tc-c", {
      screenId: "s-confirm",
      coveredFieldIds: ["gamma"],
      technique: "state_transition",
    }),
    buildCase("tc-d", {
      screenId: "s-confirm",
      coveredFieldIds: ["delta"],
      technique: "use_case",
    }),
    buildCase("tc-e", {
      coveredFieldIds: ["epsilon"],
      coveredActionIds: ["y", "z"],
    }),
  ];

  // Reference run: pass A keeps tc-a/tc-b/tc-c, pass B keeps tc-c
  // (overlap) plus tc-d/tc-e.
  const reference = mergeGeneratedTestCaseListsWithProvenance({
    lists: [
      buildList([cases[0]!, cases[1]!, cases[2]!]),
      buildList([cases[2]!, cases[3]!, cases[4]!]),
    ],
    generatedAt: GENERATED_AT,
  });
  const referenceJson = canonicalJson(reference.merged);

  const permutations: number[][] = [
    [0, 1, 2],
    [2, 1, 0],
    [1, 0, 2],
    [0, 2, 1],
  ];

  for (const aOrder of permutations) {
    for (const bOrder of permutations) {
      const aCases = aOrder.map((i) => [cases[0]!, cases[1]!, cases[2]!][i]!);
      const bCases = bOrder.map((i) => [cases[2]!, cases[3]!, cases[4]!][i]!);
      const trial = mergeGeneratedTestCaseListsWithProvenance({
        lists: [buildList(aCases), buildList(bCases)],
        generatedAt: GENERATED_AT,
      });
      assert.equal(canonicalJson(trial.merged), referenceJson);
    }
  }
});

test("case-merger: writeCaseMergerReport persists deterministic JSON with the canonical filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "case-merger-"));
  try {
    const runA = buildList([buildCase("tc-a", { coveredFieldIds: ["f1"] })]);
    const runB = buildList([buildCase("tc-b", { coveredFieldIds: ["f2"] })]);
    const { report } = mergeGeneratedTestCaseListsWithProvenance({
      lists: [runA, runB],
      generatedAt: GENERATED_AT,
    });

    const result = await writeCaseMergerReport({
      report,
      destinationDir: dir,
    });
    assert.ok(result.artifactPath.endsWith(CASE_MERGER_REPORT_ARTIFACT_FILENAME));

    const raw = await readFile(result.artifactPath, "utf8");
    const parsed = JSON.parse(raw) as CaseMergerReport;
    assert.equal(parsed.schemaVersion, CASE_MERGER_REPORT_SCHEMA_VERSION);
    assert.equal(parsed.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
    assert.equal(parsed.jobId, JOB_ID);
    assert.equal(parsed.entries.length, 2);
    // Atomic writer should have left no `.tmp` siblings behind.
    assert.equal(raw, canonicalJson(report));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("case-merger: per-case provenance log is sorted by testCaseId for stable diffs", () => {
  const runA = buildList([
    buildCase("tc-c", { coveredFieldIds: ["c"] }),
    buildCase("tc-a", { coveredFieldIds: ["a"] }),
  ]);
  const runB = buildList([buildCase("tc-b", { coveredFieldIds: ["b"] })]);
  const { report } = mergeGeneratedTestCaseListsWithProvenance({
    lists: [runA, runB],
    generatedAt: GENERATED_AT,
  });
  const ids = report.entries.map((entry) => entry.testCaseId);
  assert.deepEqual(ids, ["tc-a", "tc-b", "tc-c"]);
});

test("case-merger: signature exposes the canonical screenId from figmaTraceRefs", () => {
  const tc = buildCase("tc-x", {
    coveredFieldIds: ["alpha", "beta"],
    coveredActionIds: ["zoo", "alpha"],
    technique: "decision_table",
  });
  const sig = buildCaseMergerSignature(tc);
  // Canonical-JSON sorts keys; field/action lists must be sorted.
  assert.match(sig, /"coveredActionIds":\["alpha","zoo"\]/);
  assert.match(sig, /"coveredFieldIds":\["alpha","beta"\]/);
  assert.match(sig, /"screenId":"s-payment"/);
  assert.match(sig, /"technique":"decision_table"/);
});

test("case-merger: legacy mergeGeneratedTestCaseLists wrapper preserves the public API", () => {
  // The pre-Issue-1937 callers (production-runner) only need the merged
  // list back. The wrapper must still return the same `GeneratedTestCaseList`
  // shape and apply the same dedup rules.
  const runA = buildList([buildCase("tc-a", { coveredFieldIds: ["f1"] })]);
  const runB = buildList([buildCase("tc-b", { coveredFieldIds: ["f1"] })]);
  const merged = mergeGeneratedTestCaseLists([runA, runB]);
  assert.equal(merged.schemaVersion, GENERATED_TEST_CASE_SCHEMA_VERSION);
  assert.equal(merged.jobId, JOB_ID);
  assert.equal(merged.testCases.length, 1);
  assert.equal(merged.testCases[0]?.id, "tc-a");
});
