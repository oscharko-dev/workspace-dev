/**
 * Issue #1901 — end-to-end integration tests for the coverage hard-gate
 * driving the production repair loop (Issue #1900).
 *
 * Each test boots the {@link runRepairLoop} state machine with:
 *   - an initial test case set that fails one hard-gate rule
 *   - a deterministic per-iteration regenerator that fixes the failure
 *   - a per-iteration logic-judge runner that re-applies the hard-gate
 *
 * The verifications on the issue's acceptance matrix are:
 *   1. A case with empty `coveredFieldIds` triggers a repair iteration
 *      that resolves the failure and returns `outcome="accepted"`.
 *   2. A case carrying a hallucinated id triggers a repair iteration
 *      that swaps the fabricated id for a real IR id, returning
 *      `outcome="accepted"`.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type CoveragePlan,
  type GeneratedTestCase,
  type GeneratedTestCaseFigmaTrace,
  type GeneratedTestCaseList,
  type GeneratedTestCaseQualitySignals,
  type JudgeVerdict,
  type LogicJudgeVerdictLabel,
  type TestDesignModel,
} from "../contracts/index.js";
import {
  applyCoverageHardGate,
  type LogicJudgeCoverageThresholds,
} from "./logic-judge.js";
import {
  REPAIR_LOOP_DEFAULT_MAX_ITERATIONS,
  runRepairLoop,
  type RepairLoopLogicJudgeRunner,
  type RepairLoopRegenerator,
} from "./repair-loop.js";

const SCREEN_ID = "screen-1";
const FIELD_IDS = ["fld-a", "fld-b", "fld-c"] as const;
const ACTION_IDS = ["act-x", "act-y"] as const;
const VALIDATION_IDS = ["val-1"] as const;
const NAVIGATION_IDS = ["nav-1"] as const;

const STRICT_THRESHOLDS: LogicJudgeCoverageThresholds = {
  fieldCoverageRatioMin: 0.4,
  actionCoverageRatioMin: 0.5,
};

const buildTestDesignModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-1901-int",
  sourceHash: "0".repeat(64),
  screens: [
    {
      screenId: SCREEN_ID,
      name: "Loan application",
      elements: FIELD_IDS.map((id) => ({
        elementId: id,
        label: `Field ${id}`,
        kind: "text",
      })),
      actions: ACTION_IDS.map((id) => ({
        actionId: id,
        label: `Action ${id}`,
        kind: "submit",
      })),
      validations: VALIDATION_IDS.map((id) => ({
        validationId: id,
        rule: `Rule ${id}`,
      })),
      calculations: [],
      visualRefs: [],
      sourceRefs: [],
    },
  ],
  businessRules: [],
  assumptions: [],
  openQuestions: [],
  riskSignals: [],
});

const buildQualitySignals = (
  override: Partial<GeneratedTestCaseQualitySignals> = {},
): GeneratedTestCaseQualitySignals => ({
  coveredFieldIds: [],
  coveredActionIds: [],
  coveredValidationIds: [],
  coveredNavigationIds: [],
  confidence: 0.9,
  ...override,
});

const buildFigmaTraceRef = (): GeneratedTestCaseFigmaTrace => ({
  screenId: SCREEN_ID,
  nodeId: "node-42",
});

const buildTestCase = (
  id: string,
  qualitySignals: Partial<GeneratedTestCaseQualitySignals>,
  type: GeneratedTestCase["type"] = "functional",
): GeneratedTestCase =>
  ({
    id,
    sourceJobId: "job-1901-int",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: `Case ${id}`,
    objective: "Cover IR fields and actions",
    level: "system",
    type,
    priority: "p1",
    riskCategory: "low",
    technique: "use_case",
    preconditions: [],
    testData: [],
    steps: [{ index: 1, action: "Open form", expected: "Form rendered" }],
    expectedResults: ["Form rendered"],
    figmaTraceRefs: [buildFigmaTraceRef()],
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: true } as GeneratedTestCase["qcMappingPreview"],
    qualitySignals: buildQualitySignals(qualitySignals),
    reviewState: "draft",
    audit: {
      jobId: "job-1901-int",
      generatedAt: "2026-05-05T10:00:00Z",
      contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
      schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
      promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
      redactionPolicyVersion: "1.0.0",
      visualSidecarSchemaVersion: "1.1.0",
      cacheHit: false,
      cacheKey: "k".repeat(64),
      inputHash: "i".repeat(64),
      promptHash: "p".repeat(64),
      schemaHash: "s".repeat(64),
    } as GeneratedTestCase["audit"],
  }) as GeneratedTestCase;

const buildList = (
  cases: readonly GeneratedTestCase[],
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1901-int",
  testCases: [...cases],
});

const buildBaseLlmVerdict = (
  verdict: LogicJudgeVerdictLabel,
): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-05T10:00:00Z",
  jobId: "job-1901-int",
  cacheHit: false,
  cacheKeyDigest: "k".repeat(64),
  modelDeployment: "mistral-document-ai-2512",
  modelRevision: "mistral-document-ai-2512@test",
  gatewayRelease: "mock",
  verdict,
  findings: [],
  repairInstructions: [],
});

const HASHES = {
  inputHash: "1".repeat(64),
  promptHash: "2".repeat(64),
  schemaHash: "3".repeat(64),
  cacheKey: "4".repeat(64),
};

const buildCoveragePlan = (): CoveragePlan => ({
  jobId: "job-1901-int",
  schemaVersion: "1.0.0",
  mutationKillRateTarget: 0.85,
  minimumCases: [],
  recommendedCases: [],
  perScreen: [
    {
      screenId: SCREEN_ID,
      techniqueQuotas: [{ technique: "boundary_value_analysis", minCount: 2 }],
    },
  ],
  perElement: [],
  techniques: ["boundary_value"],
});

const buildRegenerator = (
  newList: GeneratedTestCaseList,
): RepairLoopRegenerator =>
  async () => ({
    list: newList,
    llmResult: {
      outcome: "success" as const,
      content: { testCases: [] },
      finishReason: "stop" as const,
      usage: { inputTokens: 100, outputTokens: 50 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt: 1,
    },
    llmDurationMs: 17,
    inputTokens: 100,
    outputTokens: 50,
    hashes: HASHES,
  });

const buildHardGateLogicJudgeRunner = (
  testDesignModel: TestDesignModel,
  thresholds: LogicJudgeCoverageThresholds,
  coveragePlan?: CoveragePlan,
): RepairLoopLogicJudgeRunner =>
  async ({ list }) => ({
    verdict: applyCoverageHardGate(buildBaseLlmVerdict("accept"), {
      testDesignModel,
      generatedTestCases: list,
      ...(coveragePlan !== undefined ? { coveragePlan } : {}),
      knownNavigationIds: [...NAVIGATION_IDS],
      coverageThresholds: thresholds,
    }),
    inputTokens: 5,
    outputTokens: 5,
  });

const withTempDir = async <T>(
  body: (dir: string) => Promise<T>,
): Promise<T> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "repair-loop-1901-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("end-to-end repair: empty coveredFieldIds triggers and resolves a repair iteration", async () => {
  const testDesignModel = buildTestDesignModel();
  // Initial list: case with all coveredXxxIds empty → fails hard-gate.
  const initialList = buildList([
    buildTestCase("tc-empty", {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
    }),
  ]);
  // Repaired list: same case id, now populated with real IR ids that
  // exceed both field-coverage and action-coverage thresholds. Issue
  // #1905: form screens require an anchored accessibility case, so add
  // one to the repaired list to satisfy the hard-gate.
  const repairedList = buildList([
    buildTestCase("tc-empty", {
      coveredFieldIds: ["fld-a", "fld-b"],
      coveredActionIds: ["act-x"],
      coveredValidationIds: ["val-1"],
      coveredNavigationIds: ["nav-1"],
    }),
    buildTestCase(
      "tc-a11y",
      { coveredFieldIds: ["fld-a"] },
      "accessibility",
    ),
  ]);

  const initialVerdict = applyCoverageHardGate(buildBaseLlmVerdict("accept"), {
    testDesignModel,
    generatedTestCases: initialList,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.equal(
    initialVerdict.verdict,
    "repair",
    "the hard-gate must upgrade accept to repair on empty coverage signals",
  );
  assert.ok(
    initialVerdict.findings.some((f) => f.code === "empty_coverage_signals"),
  );

  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-1901-int",
      runDir,
      initialList,
      initialLogicVerdict: initialVerdict,
      regenerate: buildRegenerator(repairedList),
      runLogicJudge: buildHardGateLogicJudgeRunner(
        testDesignModel,
        STRICT_THRESHOLDS,
      ),
      maxRepairIterations: REPAIR_LOOP_DEFAULT_MAX_ITERATIONS,
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    assert.equal(result.finalList.testCases[0]?.id, "tc-empty");
    assert.deepEqual(
      result.finalList.testCases[0]?.qualitySignals.coveredFieldIds,
      ["fld-a", "fld-b"],
    );
    assert.equal(result.finalLogicVerdict.verdict, "accept");
  });
});

test("end-to-end repair: hallucinated id is replaced with a real IR id across one iteration", async () => {
  const testDesignModel = buildTestDesignModel();
  const initialList = buildList([
    buildTestCase("tc-hallu", {
      coveredFieldIds: ["fld-a", "fld-b", "fld-DOES-NOT-EXIST"],
      coveredActionIds: ["act-x", "act-y"],
      coveredValidationIds: ["val-1"],
    }),
  ]);
  const repairedList = buildList([
    buildTestCase("tc-hallu", {
      // Fabricated id replaced with the third real field id.
      coveredFieldIds: ["fld-a", "fld-b", "fld-c"],
      coveredActionIds: ["act-x", "act-y"],
      coveredValidationIds: ["val-1"],
    }),
    // Issue #1905: anchored a11y case so the form-screen hard-gate
    // does not block the repair-loop's `accepted` outcome.
    buildTestCase(
      "tc-a11y",
      { coveredFieldIds: ["fld-a"] },
      "accessibility",
    ),
  ]);

  const initialVerdict = applyCoverageHardGate(buildBaseLlmVerdict("accept"), {
    testDesignModel,
    generatedTestCases: initialList,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.equal(initialVerdict.verdict, "repair");
  const halluFinding = initialVerdict.findings.find(
    (f) => f.code === "hallucinated_id",
  );
  assert.ok(halluFinding);
  assert.match(
    initialVerdict.repairInstructions[0]?.instruction ?? "",
    /fld-DOES-NOT-EXIST/u,
    "the repair instruction must surface the fabricated id verbatim",
  );

  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-1901-int",
      runDir,
      initialList,
      initialLogicVerdict: initialVerdict,
      regenerate: buildRegenerator(repairedList),
      runLogicJudge: buildHardGateLogicJudgeRunner(
        testDesignModel,
        STRICT_THRESHOLDS,
      ),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    assert.deepEqual(
      result.finalList.testCases[0]?.qualitySignals.coveredFieldIds,
      ["fld-a", "fld-b", "fld-c"],
    );
    assert.equal(
      result.finalLogicVerdict.findings.length,
      0,
      "no hard-gate findings remain after repair",
    );
  });
});

test("end-to-end repair: unmet technique quota triggers repair before acceptance", async () => {
  const testDesignModel = buildTestDesignModel();
  const coveragePlan = buildCoveragePlan();
  const boundaryCase = {
    ...buildTestCase(
      "tc-boundary-1",
      {
        coveredFieldIds: ["fld-a", "fld-b"],
        coveredActionIds: ["act-x"],
        coveredValidationIds: ["val-1"],
      },
      "boundary",
    ),
    technique: "boundary_value_analysis",
  } as GeneratedTestCase;
  const initialList = buildList([
    boundaryCase,
    buildTestCase(
      "tc-a11y",
      { coveredFieldIds: ["fld-a"] },
      "accessibility",
    ),
  ]);
  const repairedList = buildList([
    boundaryCase,
    {
      ...buildTestCase(
        "tc-boundary-2",
        {
          coveredFieldIds: ["fld-c"],
          coveredActionIds: ["act-y"],
          coveredValidationIds: ["val-1"],
        },
        "boundary",
      ),
      technique: "boundary_value_analysis",
    } as GeneratedTestCase,
    buildTestCase(
      "tc-a11y",
      { coveredFieldIds: ["fld-a"] },
      "accessibility",
    ),
  ]);

  const initialVerdict = applyCoverageHardGate(buildBaseLlmVerdict("accept"), {
    testDesignModel,
    generatedTestCases: initialList,
    coveragePlan,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.equal(initialVerdict.verdict, "repair");
  assert.ok(
    initialVerdict.findings.some(
      (finding) => finding.code === "technique_quota_breach",
    ),
  );
  assert.match(
    initialVerdict.repairInstructions[0]?.instruction ?? "",
    /CoveragePlan\.techniqueQuotas/u,
  );

  await withTempDir(async (runDir) => {
    const result = await runRepairLoop({
      jobId: "job-1901-int",
      runDir,
      initialList,
      initialLogicVerdict: initialVerdict,
      regenerate: buildRegenerator(repairedList),
      runLogicJudge: buildHardGateLogicJudgeRunner(
        testDesignModel,
        STRICT_THRESHOLDS,
        coveragePlan,
      ),
    });
    assert.equal(result.outcome, "accepted");
    assert.equal(result.repairIterationCount, 1);
    assert.equal(result.finalLogicVerdict.verdict, "accept");
    assert.equal(
      result.finalList.testCases.filter(
        (testCase) =>
          testCase.technique === "boundary_value_analysis" &&
          testCase.figmaTraceRefs.some(
            (traceRef) => traceRef.screenId === SCREEN_ID,
          ),
      ).length,
      2,
    );
  });
});
