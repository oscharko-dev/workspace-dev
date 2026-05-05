/**
 * Integration tests for the production-runner repair loop (Issue #1900).
 *
 * Each scenario from the issue's acceptance test matrix is exercised
 * with deterministic in-memory fakes for the regenerator and the two
 * judge runners. Per-iteration artifacts are read off the temporary
 * runDir and asserted byte-for-byte where shape stability matters.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type FaithfulnessVerdict,
  type FaithfulnessVerdictLabel,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type JudgeVerdict,
  type LogicJudgeVerdictLabel,
  type RepairInstruction,
} from "../contracts/index.js";
import {
  REPAIR_LOOP_DEFAULT_MAX_ITERATIONS,
  REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP,
  REPAIR_PLANNER_ARTIFACT_PREFIX,
  TEST_GENERATION_REPAIR_ARTIFACT_PREFIX,
  consolidateRepairInstructions,
  runRepairLoop,
  type RepairLoopFaithfulnessJudgeRunner,
  type RepairLoopLogicJudgeRunner,
  type RepairLoopRegenerator,
  type RepairLoopResult,
  type RepairPlannerIterationArtifact,
  type TestGenerationRepairIterationArtifact,
} from "./repair-loop.js";

const minimalCase = (id: string): GeneratedTestCase => ({
  id,
  sourceJobId: "job-fixture",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: "1.1.0",
  title: `Case ${id}`,
  objective: `Objective ${id}`,
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [
    {
      index: 1,
      action: "Action",
      expected: "Expected",
    },
  ],
  expectedResults: ["Expected"],
  figmaTraceRefs: [],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: {
    targetSystem: "qc_alm_default",
    folderPath: "Test/Path",
    coverageGroup: "default",
    riskWeight: 1,
    fields: { Subject: "Test" },
  } as GeneratedTestCase["qcMappingPreview"],
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    coveredScreenIds: [],
    selfVerifyConfidence: 1,
    rationale: "ok",
  } as GeneratedTestCase["qualitySignals"],
  reviewState: "auto_accepted",
  audit: {
    jobId: "job-fixture",
    generatedAt: "2026-05-04T00:00:00Z",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: "1.1.0",
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "x".repeat(64),
    inputHash: "x".repeat(64),
    promptHash: "x".repeat(64),
    schemaHash: "x".repeat(64),
  } as GeneratedTestCase["audit"],
});

const buildList = (caseIds: readonly string[]): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-fixture",
  testCases: caseIds.map((id) => minimalCase(id)),
});

const buildLogicVerdict = (
  verdict: LogicJudgeVerdictLabel,
  repairInstructions: readonly RepairInstruction[] = [],
): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-04T00:00:00Z",
  jobId: "job-fixture",
  cacheHit: false,
  cacheKeyDigest: "k".repeat(64),
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  verdict,
  findings: [],
  repairInstructions,
});

const buildFaithfulnessVerdict = (
  verdict: FaithfulnessVerdictLabel,
): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-04T00:00:00Z",
  jobId: "job-fixture",
  cacheHit: false,
  cacheKeyDigest: "k".repeat(64),
  modelDeployment: "llama-4-maverick-vision-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  fallbackReason: "none",
  verdict,
  hallucinations: [],
  mismatches: [],
});

const HASHES = {
  inputHash: "1".repeat(64),
  promptHash: "2".repeat(64),
  schemaHash: "3".repeat(64),
  cacheKey: "4".repeat(64),
};

const okRegenerate =
  (newList: GeneratedTestCaseList): RepairLoopRegenerator =>
  async () => ({
    list: newList,
    llmResult: {
      outcome: "success",
      content: { testCases: [] },
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 50 },
      modelDeployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      attempt: 1,
    },
    llmDurationMs: 17,
    inputTokens: 100,
    outputTokens: 50,
    hashes: HASHES,
  });

const sequencedLogicJudge = (
  sequence: readonly JudgeVerdict[],
): RepairLoopLogicJudgeRunner => {
  let cursor = 0;
  return async () => {
    const verdict = sequence[Math.min(cursor, sequence.length - 1)];
    cursor += 1;
    return { verdict, inputTokens: 5, outputTokens: 5 };
  };
};

const sequencedFaithfulnessJudge = (
  sequence: readonly FaithfulnessVerdict[],
): RepairLoopFaithfulnessJudgeRunner => {
  let cursor = 0;
  return async () => {
    const verdict = sequence[Math.min(cursor, sequence.length - 1)];
    cursor += 1;
    return { verdict, inputTokens: 3, outputTokens: 3 };
  };
};

const withTempDir = async <T>(
  body: (dir: string) => Promise<T>,
): Promise<T> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "repair-loop-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const readPlannerArtifact = async (
  runDir: string,
  iteration: number,
): Promise<RepairPlannerIterationArtifact> => {
  const filePath = path.join(
    runDir,
    "agent-role-runs",
    `${REPAIR_PLANNER_ARTIFACT_PREFIX}${iteration}.json`,
  );
  return JSON.parse(await readFile(filePath, "utf8")) as RepairPlannerIterationArtifact;
};

const readGeneratorArtifact = async (
  runDir: string,
  iteration: number,
): Promise<TestGenerationRepairIterationArtifact> => {
  const filePath = path.join(
    runDir,
    "agent-role-runs",
    `${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}${iteration}.json`,
  );
  return JSON.parse(
    await readFile(filePath, "utf8"),
  ) as TestGenerationRepairIterationArtifact;
};

// ---------------------------------------------------------------------------
// Scenario 1: trivial 1-iter accept (initial verdicts both accept)
// ---------------------------------------------------------------------------
test("repair loop terminates at iteration 0 when both judges accept the initial output", async () => {
  await withTempDir(async (runDir) => {
    let regenCalls = 0;
    let logicCalls = 0;
    let faithCalls = 0;
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1", "tc-2"]),
      initialLogicVerdict: buildLogicVerdict("accept"),
      initialFaithfulnessVerdict: buildFaithfulnessVerdict("accept"),
      regenerate: async (...args) => {
        regenCalls += 1;
        return okRegenerate(buildList(["tc-1"]))(...args);
      },
      runLogicJudge: async () => {
        logicCalls += 1;
        return {
          verdict: buildLogicVerdict("accept"),
          inputTokens: 0,
          outputTokens: 0,
        };
      },
      runFaithfulnessJudge: async () => {
        faithCalls += 1;
        return {
          verdict: buildFaithfulnessVerdict("accept"),
          inputTokens: 0,
          outputTokens: 0,
        };
      },
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 0);
    assert.equal(result.iterations.length, 1);
    assert.equal(result.iterations[0]!.iteration, 0);
    assert.equal(regenCalls, 0);
    assert.equal(logicCalls, 0);
    assert.equal(faithCalls, 0);
    await assert.rejects(
      stat(
        path.join(
          runDir,
          "agent-role-runs",
          `${REPAIR_PLANNER_ARTIFACT_PREFIX}1.json`,
        ),
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: 2-iter repair (initial repair, second iteration accepts)
// ---------------------------------------------------------------------------
test("repair loop runs one repair iteration when logic-judge initially asks for repair", async () => {
  await withTempDir(async (runDir) => {
    const initialRepair: RepairInstruction[] = [
      {
        testCaseId: "tc-1",
        path: "qualitySignals.coveredFieldIds",
        instruction: "Populate coveredFieldIds for tc-1.",
      },
    ];
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", initialRepair),
      regenerate: okRegenerate(buildList(["tc-1", "tc-2"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    assert.equal(result.iterations.length, 2);
    assert.equal(result.iterations[1]!.iteration, 1);
    assert.equal(result.iterations[1]!.logicVerdict, "accept");
    assert.equal(result.finalList.testCases.length, 2);
    const planner = await readPlannerArtifact(runDir, 1);
    assert.equal(planner.iteration, 1);
    assert.equal(planner.outputs.repairInstructionCount, 1);
    assert.equal(
      planner.outputs.repairInstructions[0]!.testCaseId,
      "tc-1",
    );
    const generatorArtifact = await readGeneratorArtifact(runDir, 1);
    assert.equal(generatorArtifact.iteration, 1);
    assert.equal(generatorArtifact.outputs.testCaseCount, 2);
    assert.equal(generatorArtifact.llmGateway.outcome, "success");
    assert.equal(generatorArtifact.llmGateway.inputTokens, 100);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: 3-iter repair (two repair iterations, third accepts)
// ---------------------------------------------------------------------------
test("repair loop runs two repair iterations before the panel finally accepts", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", [
        {
          testCaseId: "tc-1",
          path: "expectedResults",
          instruction: "Expand the expected results.",
        },
      ]),
      regenerate: okRegenerate(buildList(["tc-1", "tc-2"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("repair", [
          {
            testCaseId: "tc-1",
            path: "steps[0]",
            instruction: "Add a missing step.",
          },
        ]),
        buildLogicVerdict("accept"),
      ]),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 2);
    assert.equal(result.iterations.length, 3);
    await stat(
      path.join(
        runDir,
        "agent-role-runs",
        `${REPAIR_PLANNER_ARTIFACT_PREFIX}1.json`,
      ),
    );
    await stat(
      path.join(
        runDir,
        "agent-role-runs",
        `${REPAIR_PLANNER_ARTIFACT_PREFIX}2.json`,
      ),
    );
    await stat(
      path.join(
        runDir,
        "agent-role-runs",
        `${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}1.json`,
      ),
    );
    await stat(
      path.join(
        runDir,
        "agent-role-runs",
        `${TEST_GENERATION_REPAIR_ARTIFACT_PREFIX}2.json`,
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: max-out (every iteration still requests repair)
// ---------------------------------------------------------------------------
test("repair loop terminates with needs_review when the iteration cap is exhausted", async () => {
  await withTempDir(async (runDir) => {
    const repairOnly: RepairInstruction[] = [
      {
        testCaseId: "tc-1",
        path: "expectedResults",
        instruction: "Still missing.",
      },
    ];
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      maxRepairIterations: 2,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", repairOnly),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("repair", repairOnly),
        buildLogicVerdict("repair", repairOnly),
      ]),
    });
    assert.equal(result.outcome, "needs_review");
    assert.equal(result.repairIterationCount, 2);
    assert.equal(result.maxRepairIterations, 2);
    assert.equal(result.iterations.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: logic-reject is terminal — no repair attempted
// ---------------------------------------------------------------------------
test("repair loop returns rejected immediately when the initial logic-judge verdict is reject", async () => {
  await withTempDir(async (runDir) => {
    let regenCalled = false;
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("reject"),
      regenerate: async (...args) => {
        regenCalled = true;
        return okRegenerate(buildList(["tc-1"]))(...args);
      },
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.repairIterationCount, 0);
    assert.equal(regenCalled, false);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: faithfulness-reject is terminal even when logic accepts
// ---------------------------------------------------------------------------
test("repair loop returns rejected when only faithfulness-judge issues reject on the initial pass", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("accept"),
      initialFaithfulnessVerdict: buildFaithfulnessVerdict("reject"),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
      runFaithfulnessJudge: sequencedFaithfulnessJudge([
        buildFaithfulnessVerdict("accept"),
      ]),
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.repairIterationCount, 0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7: both judges reject — terminal rejection
// ---------------------------------------------------------------------------
test("repair loop returns rejected when both judges reject on the initial pass", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("reject"),
      initialFaithfulnessVerdict: buildFaithfulnessVerdict("reject"),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
      runFaithfulnessJudge: sequencedFaithfulnessJudge([
        buildFaithfulnessVerdict("accept"),
      ]),
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.repairIterationCount, 0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 8: repair-planner failure — regenerator throws — error propagates
// ---------------------------------------------------------------------------
test("repair loop propagates regenerator failures so the runner can fail-fast", async () => {
  await withTempDir(async (runDir) => {
    const failingRegenerator: RepairLoopRegenerator = async () => {
      throw new Error("synthetic regen failure");
    };
    await assert.rejects(
      runRepairLoop({
        jobId: "job-fixture",
        runDir,
        initialList: buildList(["tc-1"]),
        initialLogicVerdict: buildLogicVerdict("repair", [
          {
            testCaseId: "tc-1",
            path: "expectedResults",
            instruction: "Add expected.",
          },
        ]),
        regenerate: failingRegenerator,
        runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
      }),
      /synthetic regen failure/,
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 9: faithfulness-judge flips from accept → repair → accept
// ---------------------------------------------------------------------------
test("repair loop drives a faithfulness-only repair cycle to acceptance", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("accept"),
      initialFaithfulnessVerdict: {
        ...buildFaithfulnessVerdict("repair"),
        hallucinations: [
          {
            testCaseId: "tc-1",
            stepIndex: 0,
            message: "Step references a control that does not exist.",
          },
        ],
      },
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
      runFaithfulnessJudge: sequencedFaithfulnessJudge([
        buildFaithfulnessVerdict("accept"),
      ]),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    const planner = await readPlannerArtifact(runDir, 1);
    assert.equal(planner.outputs.repairInstructionCount, 1);
    assert.equal(
      planner.outputs.repairInstructions[0]!.path,
      "steps[0]",
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario 10: needs_review → reject mid-loop
// ---------------------------------------------------------------------------
test("repair loop terminates with rejected when a re-judge swings to reject", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", [
        {
          testCaseId: "tc-1",
          path: "expectedResults",
          instruction: "Add expected.",
        },
      ]),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("reject")]),
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.repairIterationCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Sanity: maxRepairIterations is clamped to the hard cap
// ---------------------------------------------------------------------------
test("repair loop clamps maxRepairIterations to the documented hard cap", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      maxRepairIterations: 999,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("accept"),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
    });
    assert.equal(result.maxRepairIterations, REPAIR_LOOP_MAX_ITERATIONS_HARD_CAP);
  });
});

// ---------------------------------------------------------------------------
// Sanity: default cap matches the exported constant
// ---------------------------------------------------------------------------
test("repair loop default cap matches REPAIR_LOOP_DEFAULT_MAX_ITERATIONS", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("accept"),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
    });
    assert.equal(
      result.maxRepairIterations,
      REPAIR_LOOP_DEFAULT_MAX_ITERATIONS,
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity: consolidator deduplicates identical entries deterministically
// ---------------------------------------------------------------------------
test("consolidateRepairInstructions deduplicates and sorts deterministically", () => {
  const logic = buildLogicVerdict("repair", [
    {
      testCaseId: "tc-2",
      path: "expectedResults",
      instruction: "Expand expected results",
    },
    {
      testCaseId: "tc-1",
      path: "steps[0]",
      instruction: "Cover the missing path",
    },
    {
      testCaseId: "tc-1",
      path: "steps[0]",
      instruction: "Cover the missing path",
    },
  ]);
  const faithfulness: FaithfulnessVerdict = {
    ...buildFaithfulnessVerdict("repair"),
    hallucinations: [
      { testCaseId: "tc-1", stepIndex: 1, message: "Hallucinated control" },
    ],
    mismatches: [
      {
        testCaseId: "tc-2",
        stepIndex: 0,
        expectedLabel: "Save",
        visibleLabel: "Submit",
        message: "Label drift",
      },
    ],
  };
  const consolidated = consolidateRepairInstructions({ logic, faithfulness });
  assert.equal(consolidated.length, 4);
  assert.deepEqual(
    consolidated.map((entry) => `${entry.testCaseId}::${entry.path}`),
    [
      "tc-1::steps[0]",
      "tc-1::steps[1]",
      "tc-2::expectedResults",
      "tc-2::steps[0].expected",
    ],
  );
});

// ---------------------------------------------------------------------------
// Sanity: per-iteration callback fires for every iteration
// ---------------------------------------------------------------------------
test("onIterationComplete fires once per iteration including iteration 0", async () => {
  await withTempDir(async (runDir) => {
    const records: number[] = [];
    const result: RepairLoopResult = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", [
        {
          testCaseId: "tc-1",
          path: "expectedResults",
          instruction: "Add expected.",
        },
      ]),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
      onIterationComplete: (record) => {
        records.push(record.iteration);
      },
    });
    assert.equal(result.outcome, "accepted");
    assert.deepEqual(records, [0, 1]);
  });
});
