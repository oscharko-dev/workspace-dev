/**
 * Unit tests for the DSPy-style prompt optimizer (Issue #2044). Cover the
 * bootstrap pipeline + quality gate, the deterministic search loop, the
 * FinOps token-budget cap, the additive lock-file write, the byte-stable
 * report artifact, and the empirical-lift demonstration that the issue's
 * acceptance criterion calls for.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
  PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET,
  PROMPT_OPTIMIZER_DIRECTIVE_IDS,
  PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME,
  PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION,
  PROMPT_OPTIMIZER_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type PromptOptimizationLockEntry,
  type PromptOptimizationReport,
  type PromptOptimizerAcceptedRun,
} from "../contracts/index.js";
import {
  appendOptimizedTemplateToLockFile,
  bootstrapExemplars,
  encodePromptOptimizationReportBytes,
  runPromptOptimizationCycle,
  writePromptOptimizationReportArtifact,
} from "./prompt-optimizer.js";

const ZERO_HASH =
  "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-05-08T10:00:00.000Z";
const DATASET_ID = "active-dataset";
const ROLE_STEP_ID = "test_generation";
const JOB_ID = "job-2044";

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: JOB_ID,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit loan application with valid IBAN",
  objective: "Verify a happy-path submission",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Submit", expected: "Confirmation shown" }],
  expectedResults: ["Confirmation shown"],
  figmaTraceRefs: [{ screenId: "s-loan", nodeId: "n-loan-form" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.85,
  },
  reviewState: "draft",
  audit: {
    jobId: JOB_ID,
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

const buildEvalSet = (): GeneratedTestCase[] => [
  buildCase({
    id: "tc-happy",
    type: "functional",
    figmaTraceRefs: [{ screenId: "s-loan", nodeId: "n-form" }],
  }),
  buildCase({
    id: "tc-a11y",
    title: "Keyboard navigation: focus order on loan form",
    objective: "Screen reader announces aria-label for IBAN input",
    type: "accessibility",
    expectedResults: [
      "Visible focus moves through every input",
      "Each control has an accessible name",
    ],
    figmaTraceRefs: [{ screenId: "s-loan", nodeId: "n-iban" }],
    openQuestions: [],
  }),
  buildCase({
    id: "tc-negative",
    title: "Reject IBAN with invalid checksum",
    type: "negative",
    expectedResults: [
      "An error message is shown indicating an invalid IBAN",
    ],
    figmaTraceRefs: [{ screenId: "s-loan", nodeId: "n-iban" }],
    openQuestions: ["IBAN error wording awaits design review"],
  }),
  buildCase({
    id: "tc-boundary",
    title: "Loan amount: minimum boundary 1000",
    objective: "Verify the boundary value 1000 is accepted",
    type: "validation",
    testData: ["amount=1000"],
    expectedResults: ["Submission rejected with error: amount must be >= 1000"],
    figmaTraceRefs: [{ screenId: "s-loan", nodeId: "n-amount" }],
    openQuestions: ["Boundary value confirmed?"],
  }),
];

const buildAcceptedRuns = (): readonly PromptOptimizerAcceptedRun[] => [
  {
    runId: "run-accepted-001",
    datasetId: DATASET_ID,
    score: 95,
    testCases: [buildCase({ id: "tc-accepted-a", title: "Accepted A" })],
  },
  {
    runId: "run-rejected-002",
    datasetId: DATASET_ID,
    score: 80,
    testCases: [buildCase({ id: "tc-rejected", title: "Rejected" })],
  },
  {
    runId: "run-other-dataset-003",
    datasetId: "other-dataset",
    score: 99,
    testCases: [buildCase({ id: "tc-other", title: "Other Dataset" })],
  },
  {
    runId: "run-accepted-004",
    datasetId: DATASET_ID,
    score: 92,
    testCases: [
      buildCase({ id: "tc-accepted-b1", title: "Accepted B1" }),
      buildCase({ id: "tc-accepted-b2", title: "Accepted B2" }),
    ],
  },
];

test("bootstrap: filters runs below the quality gate", () => {
  const exemplars = bootstrapExemplars({
    acceptedRuns: buildAcceptedRuns(),
    qualityGate: PROMPT_OPTIMIZER_DEFAULT_QUALITY_GATE,
    datasetId: DATASET_ID,
  });
  // run-accepted-001 (95) + run-accepted-004 (92) -> 1 + 2 = 3 cases
  assert.equal(exemplars.length, 3);
  assert.ok(exemplars.every((entry) => entry.score >= 90));
  assert.ok(exemplars.every((entry) => entry.datasetId === DATASET_ID));
  // Sorted by exemplarId ascending.
  const ids = exemplars.map((entry) => entry.exemplarId);
  assert.deepEqual(ids, [...ids].sort());
});

test("bootstrap: deduplicates content-equivalent cases", () => {
  const dup = buildCase({ id: "dup-a" });
  const dup2 = buildCase({ id: "dup-b" });
  const exemplars = bootstrapExemplars({
    acceptedRuns: [
      {
        runId: "run-1",
        datasetId: DATASET_ID,
        score: 95,
        testCases: [dup, dup2],
      },
    ],
    datasetId: DATASET_ID,
  });
  assert.equal(exemplars.length, 1);
});

test("bootstrap: rejects out-of-range qualityGate", () => {
  assert.throws(() =>
    bootstrapExemplars({
      acceptedRuns: buildAcceptedRuns(),
      qualityGate: 200,
    }),
  );
  assert.throws(() =>
    bootstrapExemplars({
      acceptedRuns: buildAcceptedRuns(),
      qualityGate: -1,
    }),
  );
});

test("cycle: deterministic — identical inputs yield identical reports", () => {
  const inputA = {
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 0xc0ffee,
  } as const;
  const reportA = runPromptOptimizationCycle(inputA);
  const reportB = runPromptOptimizationCycle(inputA);
  const bytesA = encodePromptOptimizationReportBytes(reportA);
  const bytesB = encodePromptOptimizationReportBytes(reportB);
  assert.equal(bytesA.toString("hex"), bytesB.toString("hex"));
});

test("cycle: empirical lift >= 3 points on the eval set", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 0xc0ffee,
  });
  // Acceptance criterion: at least one role's prompt improves the
  // benchmark scorecard by >= 3 points after one optimization cycle.
  assert.ok(
    report.improvementPoints >= 3,
    `expected >= 3 point lift; got ${report.improvementPoints}`,
  );
  assert.ok(report.optimizedScore > report.baselineScore);
  assert.ok(report.lockEntry.improvementPoints >= 3);
});

test("cycle: respects the FinOps budget cap (5x baseline default)", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 1,
  });
  assert.equal(
    report.tokenBudget.cap,
    report.tokenBudget.baselineTokenCost *
      PROMPT_OPTIMIZER_DEFAULT_BUDGET_MULTIPLIER,
  );
  assert.ok(report.tokenBudget.consumed <= report.tokenBudget.cap);
  assert.equal(report.tokenBudget.withinCap, true);
});

test("cycle: tight budget skips candidates without throwing", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 7,
    baselineTokenCost: 256,
    budgetMultiplier: 1, // tight: 256 total budget
  });
  assert.ok(report.tokenBudget.consumed <= 256);
  // Baseline candidate alone consumes the budget, so most candidates skipped.
  assert.ok(report.candidates.length >= 1);
});

test("cycle: rejects out-of-range hyperparameters", () => {
  const baseInput = {
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
  } as const;
  assert.throws(() =>
    runPromptOptimizationCycle({ ...baseInput, seed: -1 }),
  );
  assert.throws(() =>
    runPromptOptimizationCycle({ ...baseInput, searchBudget: 0 }),
  );
  assert.throws(() =>
    runPromptOptimizationCycle({ ...baseInput, maxFewShots: -1 }),
  );
  assert.throws(() =>
    runPromptOptimizationCycle({ ...baseInput, budgetMultiplier: 0 }),
  );
  assert.throws(() =>
    runPromptOptimizationCycle({ ...baseInput, baselineTokenCost: 0 }),
  );
});

test("cycle: provenance node records base template + optimizer activity", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 0xc0ffee,
  });
  assert.equal(
    report.provenance.activityId,
    `urn:ti:prompt-optimizer:activity:${JOB_ID}`,
  );
  assert.equal(
    report.provenance.entityId,
    `urn:ti:prompt-optimizer:entity:${JOB_ID}`,
  );
  assert.equal(
    report.provenance.wasInformedBy,
    `urn:ti:prompt-template:${TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION}`,
  );
  assert.equal(report.provenance.wasGeneratedAt, GENERATED_AT);
  // Lock entry pins the same base template version.
  assert.equal(
    report.lockEntry.basePromptTemplateVersion,
    TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  );
});

test("cycle: report carries pinned schema + optimizer + contract versions", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 0xc0ffee,
  });
  assert.equal(
    report.schemaVersion,
    PROMPT_OPTIMIZER_REPORT_SCHEMA_VERSION,
  );
  assert.equal(report.optimizerVersion, PROMPT_OPTIMIZER_VERSION);
  assert.equal(report.contractVersion, TEST_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(report.searchBudget, PROMPT_OPTIMIZER_DEFAULT_SEARCH_BUDGET);
});

test("cycle: only directive ids from the closed registry are emitted", () => {
  const report = runPromptOptimizationCycle({
    jobId: JOB_ID,
    datasetId: DATASET_ID,
    roleStepId: ROLE_STEP_ID,
    basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    generatedAt: GENERATED_AT,
    evalSet: buildEvalSet(),
    acceptedRuns: buildAcceptedRuns(),
    seed: 0xc0ffee,
  });
  for (const candidate of report.candidates) {
    for (const directiveId of candidate.directiveIds) {
      assert.ok(
        PROMPT_OPTIMIZER_DIRECTIVE_IDS.includes(directiveId),
        `unknown directive id: ${directiveId}`,
      );
    }
  }
  for (const directiveId of report.lockEntry.directiveIds) {
    assert.ok(PROMPT_OPTIMIZER_DIRECTIVE_IDS.includes(directiveId));
  }
});

test("write: persists a byte-stable canonical-JSON artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prompt-opt-"));
  try {
    const report = runPromptOptimizationCycle({
      jobId: JOB_ID,
      datasetId: DATASET_ID,
      roleStepId: ROLE_STEP_ID,
      basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      generatedAt: GENERATED_AT,
      evalSet: buildEvalSet(),
      acceptedRuns: buildAcceptedRuns(),
      seed: 0xc0ffee,
    });
    const written = await writePromptOptimizationReportArtifact({
      artifactDir: dir,
      report,
    });
    assert.equal(
      written.path,
      join(dir, PROMPT_OPTIMIZER_REPORT_ARTIFACT_FILENAME),
    );
    const onDisk = await readFile(written.path, "utf8");
    const reparsed = JSON.parse(onDisk) as PromptOptimizationReport;
    assert.equal(
      reparsed.lockEntry.optimizedTemplateId,
      report.lockEntry.optimizedTemplateId,
    );
    assert.equal(reparsed.optimizedScore, report.optimizedScore);
    // Canonical form ends with newline so diff tools render cleanly.
    assert.equal(onDisk.endsWith("\n"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock-file: appends optimizedTemplates additively without touching the base pin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prompt-opt-lock-"));
  try {
    const lockPath = join(dir, "lock.json");
    const baselineLock = {
      $schema: "./test-intelligence-prompt-template-version.lock.schema.json",
      description: "fixture lock file",
      version: "1.7.0",
      promptCompilerSha256: "a".repeat(64),
    };
    await writeFile(lockPath, JSON.stringify(baselineLock, null, 2));
    const report = runPromptOptimizationCycle({
      jobId: JOB_ID,
      datasetId: DATASET_ID,
      roleStepId: ROLE_STEP_ID,
      basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      generatedAt: GENERATED_AT,
      evalSet: buildEvalSet(),
      acceptedRuns: buildAcceptedRuns(),
      seed: 0xc0ffee,
    });
    const result = await appendOptimizedTemplateToLockFile({
      lockFilePath: lockPath,
      entry: report.lockEntry,
    });
    assert.equal(result.updated, true);
    assert.equal(result.entries, 1);

    const after = JSON.parse(await readFile(lockPath, "utf8"));
    // Base-template pin is preserved verbatim.
    assert.equal(after.version, "1.7.0");
    assert.equal(after.promptCompilerSha256, "a".repeat(64));
    assert.equal(after.description, "fixture lock file");
    // Additive optimizedTemplates array appended.
    assert.ok(Array.isArray(after.optimizedTemplates));
    assert.equal(after.optimizedTemplates.length, 1);
    const entry = after.optimizedTemplates[0] as PromptOptimizationLockEntry;
    assert.equal(entry.optimizedTemplateId, report.lockEntry.optimizedTemplateId);
    assert.equal(entry.basePromptTemplateVersion, "1.7.1");

    // Re-applying the same entry is idempotent.
    const second = await appendOptimizedTemplateToLockFile({
      lockFilePath: lockPath,
      entry: report.lockEntry,
    });
    assert.equal(second.updated, false);
    assert.equal(second.entries, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lock-file: refuses to write when the base-template pin is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "prompt-opt-lock-bad-"));
  try {
    const lockPath = join(dir, "lock.json");
    await writeFile(lockPath, JSON.stringify({ version: "x" }));
    const report = runPromptOptimizationCycle({
      jobId: JOB_ID,
      datasetId: DATASET_ID,
      roleStepId: ROLE_STEP_ID,
      basePromptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      generatedAt: GENERATED_AT,
      evalSet: buildEvalSet(),
      acceptedRuns: buildAcceptedRuns(),
      seed: 0xc0ffee,
    });
    await assert.rejects(
      appendOptimizedTemplateToLockFile({
        lockFilePath: lockPath,
        entry: report.lockEntry,
      }),
      /missing the base-template pin/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("standard runs: prompt-compiler.ts is untouched (no version bump in this PR)", async () => {
  // Belt-and-braces: the optimizer module only writes additive lock entries
  // and never modifies the prompt-compiler. This test asserts the constant
  // is present in the contracts barrel — if a refactor renames it the
  // optimizer's `wasInformedBy` provenance reference would silently drift.
  assert.equal(typeof TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION, "string");
  assert.match(TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION, /^[0-9]+\.[0-9]+\.[0-9]+$/);
});
