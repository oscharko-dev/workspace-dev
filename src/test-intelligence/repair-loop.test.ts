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
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
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
  REPAIR_LOOP_TRACE_ARTIFACT_FILENAME,
  REPAIR_PLANNER_ARTIFACT_PREFIX,
  TEST_GENERATION_REPAIR_ARTIFACT_PREFIX,
  computeVerdictSignature,
  consolidateRepairInstructions,
  runRepairLoop,
  type RepairLoopFaithfulnessJudgeRunner,
  type RepairLoopLogicJudgeRunner,
  type RepairLoopRegenerator,
  type RepairLoopResult,
  type RepairLoopTraceArtifact,
  type RepairPlannerIterationArtifact,
  type TestGenerationRepairIterationArtifact,
} from "./repair-loop.js";

const minimalCase = (id: string): GeneratedTestCase => ({
  id,
  sourceJobId: "job-fixture",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
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
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
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
  findings: JudgeVerdict["findings"] = [],
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
  findings,
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

test("Issue #1929: repair loop preserves all 9 initial logic/faithfulness verdict combinations in iteration 0", async () => {
  const logicVerdicts: readonly LogicJudgeVerdictLabel[] = [
    "accept",
    "repair",
    "reject",
  ];
  const faithfulnessVerdicts: readonly FaithfulnessVerdictLabel[] = [
    "accept",
    "repair",
    "reject",
  ];

  for (const logicVerdict of logicVerdicts) {
    for (const faithfulnessVerdict of faithfulnessVerdicts) {
      await withTempDir(async (runDir) => {
        const result = await runRepairLoop({
          jobId: "job-fixture",
          runDir,
          maxRepairIterations: 0,
          initialList: buildList(["tc-1"]),
          initialLogicVerdict: buildLogicVerdict(logicVerdict),
          initialFaithfulnessVerdict: buildFaithfulnessVerdict(
            faithfulnessVerdict,
          ),
          regenerate: okRegenerate(buildList(["tc-1"])),
          runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
          runFaithfulnessJudge: sequencedFaithfulnessJudge([
            buildFaithfulnessVerdict("accept"),
          ]),
        });

        assert.equal(result.iterations.length, 1);
        assert.equal(result.iterations[0]!.logicVerdict, logicVerdict);
        assert.equal(
          result.iterations[0]!.faithfulnessVerdict,
          faithfulnessVerdict,
        );
        assert.equal(result.finalLogicVerdict.verdict, logicVerdict);
        assert.equal(
          result.finalFaithfulnessVerdict?.verdict,
          faithfulnessVerdict,
        );
        assert.equal(
          result.outcome,
          logicVerdict === "accept" && faithfulnessVerdict === "accept"
            ? "accepted"
            : "needs_review",
        );
      });
    }
  }
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
      initialLogicVerdict: buildLogicVerdict(
        "repair",
        [
          {
            testCaseId: "tc-1",
            path: "expectedResults",
            instruction: "Expand the expected results.",
          },
        ],
        [
          {
            testCaseId: "tc-1",
            code: "missing_expected",
            severity: "error",
            message: "expected results missing",
          },
        ],
      ),
      regenerate: okRegenerate(buildList(["tc-1", "tc-2"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict(
          "repair",
          [
            {
              testCaseId: "tc-1",
              path: "steps[0]",
              instruction: "Add a missing step.",
            },
          ],
          [
            {
              testCaseId: "tc-1",
              code: "missing_step",
              severity: "error",
              message: "step missing",
            },
          ],
        ),
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
// Scenario 4: max-out (every iteration still requests repair, but the LLM
// makes *some* progress each time so the convergence detector does not
// short-circuit the cap — Issue #1939).
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
      initialLogicVerdict: buildLogicVerdict("repair", repairOnly, [
        {
          testCaseId: "tc-1",
          code: "missing_expected",
          severity: "error",
          message: "expected results missing",
        },
      ]),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("repair", repairOnly, [
          {
            testCaseId: "tc-1",
            code: "missing_precondition",
            severity: "error",
            message: "precondition missing",
          },
        ]),
        buildLogicVerdict("repair", repairOnly, [
          {
            testCaseId: "tc-1",
            code: "missing_step",
            severity: "error",
            message: "step missing",
          },
        ]),
      ]),
    });
    assert.equal(result.outcome, "needs_review");
    assert.equal(result.repairIterationCount, 2);
    assert.equal(result.maxRepairIterations, 2);
    assert.equal(result.iterations.length, 3);
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 (Issue #1928): initial logic-reject now drives the repair loop
// instead of short-circuiting; recoverable schema violations get a chance to
// converge through the iteration cycle.
// ---------------------------------------------------------------------------
test("repair loop runs an iteration when the initial logic-judge verdict is reject and converges on accept", async () => {
  await withTempDir(async (runDir) => {
    let regenCalls = 0;
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("reject"),
      regenerate: async (...args) => {
        regenCalls += 1;
        return okRegenerate(buildList(["tc-1"]))(...args);
      },
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("accept")]),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    assert.equal(regenCalls, 1);
    const planner = await readPlannerArtifact(runDir, 1);
    assert.equal(planner.iteration, 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 (Issue #1928): initial faithfulness-reject also runs the loop.
// ---------------------------------------------------------------------------
test("repair loop runs an iteration when only faithfulness-judge issues reject on the initial pass", async () => {
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
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 (Issue #1928): even when both judges reject on the initial pass
// the loop attempts the bounded repair cycle before terminating.
// ---------------------------------------------------------------------------
test("repair loop runs an iteration even when both judges reject on the initial pass", async () => {
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
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario 7b (Issue #1928): if the post-repair logic-judge still rejects,
// the loop terminates with `rejected` after recording the iteration.
// ---------------------------------------------------------------------------
test("repair loop returns rejected when the post-repair logic-judge still rejects", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-fixture",
      runDir,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("reject"),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([buildLogicVerdict("reject")]),
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.repairIterationCount, 1);
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
// ---------------------------------------------------------------------------
// Issue #1939: convergence-stall detection + trace artifact
// ---------------------------------------------------------------------------
test("repair loop aborts with convergence_stalled when consecutive verdict signatures match", async () => {
  await withTempDir(async (runDir) => {
    const stuckRi: RepairInstruction[] = [
      {
        testCaseId: "tc-1",
        path: "expectedResults",
        instruction: "Add expected.",
      },
    ];
    const stuckFindings: JudgeVerdict["findings"] = [
      {
        testCaseId: "tc-1",
        code: "missing_expected",
        severity: "error",
        message: "expected missing",
      },
    ];
    const result = await runRepairLoop({
      jobId: "job-stall",
      runDir,
      maxRepairIterations: 3,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", stuckRi, stuckFindings),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("repair", stuckRi, stuckFindings),
      ]),
    });
    assert.equal(result.outcome, "convergence_stalled");
    assert.equal(result.repairIterationCount, 1);
    assert.equal(result.iterations.length, 2);
    assert.equal(
      result.iterations[0]!.verdictSignature,
      result.iterations[1]!.verdictSignature,
    );

    const tracePath = path.join(runDir, REPAIR_LOOP_TRACE_ARTIFACT_FILENAME);
    const trace = JSON.parse(
      await readFile(tracePath, "utf8"),
    ) as RepairLoopTraceArtifact;
    assert.equal(trace.outcome, "convergence_stalled");
    assert.equal(trace.jobId, "job-stall");
    assert.equal(trace.stallDetectedAtIteration, 1);
    assert.equal(trace.stallSignature, result.iterations[1]!.verdictSignature);
    assert.equal(trace.iterations.length, 2);
    assert.deepEqual(
      trace.iterations.map((entry) => entry.iteration),
      [0, 1],
    );
  });
});

test("repair loop does not stall when verdict signatures differ across iterations", async () => {
  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-progress",
      runDir,
      maxRepairIterations: 3,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict(
        "repair",
        [
          {
            testCaseId: "tc-1",
            path: "expectedResults",
            instruction: "Add expected.",
          },
        ],
        [
          {
            testCaseId: "tc-1",
            code: "missing_expected",
            severity: "error",
            message: "expected missing",
          },
        ],
      ),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("accept"),
      ]),
    });
    assert.equal(result.outcome, "accepted");
    await assert.rejects(
      stat(path.join(runDir, REPAIR_LOOP_TRACE_ARTIFACT_FILENAME)),
    );
  });
});

test("repair loop trace is not written when the loop ends in needs_review without a stall", async () => {
  await withTempDir(async (runDir) => {
    const baseRi: RepairInstruction[] = [
      {
        testCaseId: "tc-1",
        path: "expectedResults",
        instruction: "Still missing.",
      },
    ];
    const result = await runRepairLoop({
      jobId: "job-cap",
      runDir,
      maxRepairIterations: 2,
      initialList: buildList(["tc-1"]),
      initialLogicVerdict: buildLogicVerdict("repair", baseRi, [
        {
          testCaseId: "tc-1",
          code: "missing_a",
          severity: "error",
          message: "a missing",
        },
      ]),
      regenerate: okRegenerate(buildList(["tc-1"])),
      runLogicJudge: sequencedLogicJudge([
        buildLogicVerdict("repair", baseRi, [
          {
            testCaseId: "tc-1",
            code: "missing_b",
            severity: "error",
            message: "b missing",
          },
        ]),
        buildLogicVerdict("repair", baseRi, [
          {
            testCaseId: "tc-1",
            code: "missing_c",
            severity: "error",
            message: "c missing",
          },
        ]),
      ]),
    });
    assert.equal(result.outcome, "needs_review");
    await assert.rejects(
      stat(path.join(runDir, REPAIR_LOOP_TRACE_ARTIFACT_FILENAME)),
    );
  });
});

test("computeVerdictSignature is invariant to finding-code order and instruction text", () => {
  const a = buildLogicVerdict(
    "repair",
    [
      {
        testCaseId: "tc-1",
        path: "p1",
        instruction: "instruction one",
      },
    ],
    [
      {
        testCaseId: "tc-1",
        code: "alpha",
        severity: "error",
        message: "msg alpha",
      },
      {
        testCaseId: "tc-1",
        code: "beta",
        severity: "error",
        message: "msg beta",
      },
    ],
  );
  const b = buildLogicVerdict(
    "repair",
    [
      {
        testCaseId: "tc-1",
        path: "p1",
        instruction: "completely different wording",
      },
    ],
    [
      {
        testCaseId: "tc-1",
        code: "beta",
        severity: "error",
        message: "different msg",
      },
      {
        testCaseId: "tc-1",
        code: "alpha",
        severity: "error",
        message: "different msg",
      },
    ],
  );
  assert.equal(computeVerdictSignature(a), computeVerdictSignature(b));

  const c = buildLogicVerdict(
    "repair",
    [],
    [
      {
        testCaseId: "tc-1",
        code: "alpha",
        severity: "error",
        message: "msg",
      },
      {
        testCaseId: "tc-1",
        code: "gamma",
        severity: "error",
        message: "msg",
      },
    ],
  );
  assert.notEqual(computeVerdictSignature(a), computeVerdictSignature(c));
});

test("computeVerdictSignature distinguishes a11y findings for different unresolved criteria", () => {
  const focusCriterion = buildLogicVerdict(
    "repair",
    [
      {
        testCaseId: "$job",
        path: "$job.a11yCoverage[1:1::focus-visible]",
        instruction: "Strengthen the focus-visible case.",
      },
    ],
    [
      {
        testCaseId: "$job",
        code: "criterion_covered_weakly:1:1::focus-visible",
        severity: "warning",
        message: "Focus-visible coverage is weak.",
      },
    ],
  );
  const errorCriterion = buildLogicVerdict(
    "repair",
    [
      {
        testCaseId: "$job",
        path: "$job.a11yCoverage[1:1::error-identification]",
        instruction: "Add an error-identification assertion.",
      },
    ],
    [
      {
        testCaseId: "$job",
        code: "criterion_covered_weakly:1:1::error-identification",
        severity: "warning",
        message: "Error-identification coverage is weak.",
      },
    ],
  );

  assert.notEqual(
    computeVerdictSignature(focusCriterion),
    computeVerdictSignature(errorCriterion),
  );
});

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
