/**
 * Issue #1901 — coverage hard-gate unit tests for the logic judge.
 *
 * Each scenario from the issue's acceptance matrix is exercised against
 * the deterministic post-LLM `applyCoverageHardGate` augmentation:
 *
 *   1. Empty `qualitySignals.coveredXxxIds` arrays trigger
 *      `empty_coverage_signals` (severity: error) and upgrade an LLM
 *      `accept` to `repair`.
 *   2. A covered id absent from the IR triggers `hallucinated_id`
 *      (severity: error) with the fabricated id surfaced in the
 *      repair instruction.
 *   3. Job-level coverage below `fieldCoverageRatioMin` /
 *      `actionCoverageRatioMin` triggers `insufficient_coverage_breadth`
 *      (severity: error) at `testCaseId="$job"`.
 *   4. `figmaTraceRefs` entries lacking `nodeId` trigger `weak_trace`
 *      (severity: warning) — does NOT upgrade an `accept` to `repair`.
 *   5. A reject verdict from the LLM is left terminal — the hard-gate
 *      may add findings but does not downgrade the verdict.
 *   6. Refusal verdicts (gateway failure) are passed through
 *      untouched — the hard-gate never inspects refused responses.
 *   7. Fully populated, IR-faithful cases pass the gate cleanly —
 *      verdict and findings remain `accept` / `[]`.
 *   8. Cache hits and misses produce byte-identical hard-gate output
 *      because the gate is purely deterministic on its inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_DESIGN_MODEL_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseFigmaTrace,
  type GeneratedTestCaseList,
  type GeneratedTestCaseQualitySignals,
  type JudgeVerdict,
  type LogicJudgeVerdictLabel,
  type TestDesignModel,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES,
  applyCoverageHardGate,
  createMemoryLogicJudgeCache,
  runLogicJudge,
  type LogicJudgeCoverageThresholds,
} from "./logic-judge.js";

const SCREEN_ID = "screen-1";
const FIELD_IDS = ["fld-a", "fld-b", "fld-c"] as const;
const ACTION_IDS = ["act-x", "act-y"] as const;
const VALIDATION_IDS = ["val-1", "val-2"] as const;
const NAVIGATION_IDS = ["nav-1"] as const;

const buildTestDesignModel = (): TestDesignModel => ({
  schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
  jobId: "job-1901",
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

const buildFigmaTraceRef = (
  override: Partial<GeneratedTestCaseFigmaTrace> = {},
): GeneratedTestCaseFigmaTrace => ({
  screenId: SCREEN_ID,
  nodeId: "node-42",
  ...override,
});

const buildTestCase = (
  id: string,
  override: {
    qualitySignals?: Partial<GeneratedTestCaseQualitySignals>;
    figmaTraceRefs?: GeneratedTestCaseFigmaTrace[];
    type?: GeneratedTestCase["type"];
  } = {},
): GeneratedTestCase =>
  ({
    id,
    sourceJobId: "job-1901",
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    title: `Case ${id}`,
    objective: "Cover IR fields and actions",
    level: "system",
    type: override.type ?? "functional",
    priority: "p1",
    riskCategory: "low",
    technique: "use_case",
    preconditions: [],
    testData: [],
    steps: [{ index: 1, action: "Open form", expected: "Form rendered" }],
    expectedResults: ["Form rendered"],
    figmaTraceRefs: override.figmaTraceRefs ?? [buildFigmaTraceRef()],
    assumptions: [],
    openQuestions: [],
    qcMappingPreview: { exportable: true } as GeneratedTestCase["qcMappingPreview"],
    qualitySignals: buildQualitySignals(override.qualitySignals ?? {}),
    reviewState: "draft",
    audit: {
      jobId: "job-1901",
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
  jobId: "job-1901",
  testCases: [...cases],
});

const buildLlmVerdict = (
  verdict: LogicJudgeVerdictLabel,
): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-05T10:00:00Z",
  jobId: "job-1901",
  cacheHit: false,
  cacheKeyDigest: "k".repeat(64),
  modelDeployment: "mistral-document-ai-2512",
  modelRevision: "mistral-document-ai-2512@test",
  gatewayRelease: "mock",
  verdict,
  findings: [],
  repairInstructions: [],
});

const STRICT_THRESHOLDS: LogicJudgeCoverageThresholds = {
  fieldCoverageRatioMin: 0.4,
  actionCoverageRatioMin: 0.5,
};

test("hard-gate emits empty_coverage_signals + upgrades accept to repair", () => {
  const list = buildList([
    buildTestCase("tc-empty", {
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.equal(augmented.verdict, "repair");
  const empty = augmented.findings.find(
    (f) => f.code === LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.emptyCoverageSignals,
  );
  assert.ok(empty, "expected empty_coverage_signals finding");
  assert.equal(empty.severity, "error");
  assert.equal(empty.testCaseId, "tc-empty");
  const repair = augmented.repairInstructions.find(
    (instruction) => instruction.testCaseId === "tc-empty",
  );
  assert.ok(repair);
  assert.equal(repair.path, "qualitySignals.coveredFieldIds");
  assert.match(repair.instruction, /Populate qualitySignals\.coveredFieldIds/u);
});

test("hard-gate emits hallucinated_id with the fabricated id in repair instruction", () => {
  const list = buildList([
    buildTestCase("tc-hallu", {
      qualitySignals: {
        coveredFieldIds: ["fld-a", "fld-NOT-IN-IR"],
        coveredActionIds: ["act-x"],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
  });
  const finding = augmented.findings.find(
    (f) => f.code === LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.hallucinatedId,
  );
  assert.ok(finding, "expected hallucinated_id finding");
  assert.equal(finding.severity, "error");
  assert.equal(finding.testCaseId, "tc-hallu");
  const repair = augmented.repairInstructions.find(
    (instruction) =>
      instruction.testCaseId === "tc-hallu" &&
      instruction.path === "qualitySignals.coveredFieldIds",
  );
  assert.ok(repair);
  assert.match(repair.instruction, /fld-NOT-IN-IR/u);
  assert.equal(augmented.verdict, "repair");
});

test("hard-gate emits insufficient_coverage_breadth at $job when below thresholds", () => {
  // IR has 3 fields and 2 actions. Cover 1 field (ratio 0.333 < 0.4) and
  // 1 action (ratio 0.5 == 0.5, NOT below). Expect a single breach with
  // the fieldCoverage ratio surfaced.
  const list = buildList([
    buildTestCase("tc-breadth", {
      qualitySignals: {
        coveredFieldIds: ["fld-a"],
        coveredActionIds: ["act-x"],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  const finding = augmented.findings.find(
    (f) =>
      f.code ===
      LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.insufficientCoverageBreadth,
  );
  assert.ok(finding, "expected insufficient_coverage_breadth finding");
  assert.equal(finding.severity, "error");
  assert.equal(finding.testCaseId, "$job");
  assert.match(finding.message, /fieldCoverage\.ratio/u);
  assert.doesNotMatch(
    finding.message,
    /actionCoverage\.ratio/u,
    "actionCoverage was at threshold, not below — must not be reported",
  );
  assert.equal(augmented.verdict, "repair");
});

test("hard-gate emits weak_trace as warning and does NOT upgrade accept to repair", () => {
  const list = buildList([
    buildTestCase("tc-weak", {
      qualitySignals: {
        coveredFieldIds: ["fld-a", "fld-b"],
        coveredActionIds: ["act-x", "act-y"],
        coveredValidationIds: ["val-1", "val-2"],
      },
      figmaTraceRefs: [{ screenId: SCREEN_ID }],
    }),
    // Issue #1905: form screens require an anchored accessibility case;
    // include one here so the new missing_form_screen_a11y_case finding
    // does not trip and confound this test's weak_trace assertion.
    buildTestCase("tc-a11y", {
      type: "accessibility",
      qualitySignals: {
        coveredFieldIds: ["fld-a"],
      },
      figmaTraceRefs: [buildFigmaTraceRef()],
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  const finding = augmented.findings.find(
    (f) => f.code === LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.weakTrace,
  );
  assert.ok(finding, "expected weak_trace finding");
  assert.equal(finding.severity, "warning");
  assert.equal(finding.testCaseId, "tc-weak");
  assert.equal(
    augmented.verdict,
    "accept",
    "warning-only findings must not upgrade verdict",
  );
});

test("hard-gate leaves a reject verdict terminal even when adding error findings", () => {
  const list = buildList([
    buildTestCase("tc-empty", {
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("reject"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
  });
  assert.equal(augmented.verdict, "reject");
  assert.ok(
    augmented.findings.some(
      (f) =>
        f.code ===
        LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.emptyCoverageSignals,
    ),
    "still augments findings on reject",
  );
});

test("hard-gate passes through refusal verdicts untouched", () => {
  const refusalVerdict: JudgeVerdict = {
    ...buildLlmVerdict("reject"),
    findings: [
      {
        testCaseId: "$job",
        code: "gateway_failure",
        severity: "error",
        message: "gateway down",
      },
    ],
    refusal: { code: "gateway_failure", message: "gateway down" },
  };
  const list = buildList([
    buildTestCase("tc-empty", {
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(refusalVerdict, {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.deepEqual(augmented, refusalVerdict, "refusal verdicts are immutable");
});

test("hard-gate accepts a fully covered, IR-faithful test case set with no findings", () => {
  const list = buildList([
    buildTestCase("tc-full", {
      qualitySignals: {
        coveredFieldIds: ["fld-a", "fld-b", "fld-c"],
        coveredActionIds: ["act-x", "act-y"],
        coveredValidationIds: ["val-1"],
        coveredNavigationIds: ["nav-1"],
      },
      figmaTraceRefs: [buildFigmaTraceRef()],
    }),
    // Issue #1905: form screens require an anchored accessibility case
    // for the hard-gate to remain finding-free.
    buildTestCase("tc-a11y", {
      type: "accessibility",
      qualitySignals: {
        coveredFieldIds: ["fld-a"],
      },
      figmaTraceRefs: [buildFigmaTraceRef()],
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
    coverageThresholds: STRICT_THRESHOLDS,
  });
  assert.equal(augmented.verdict, "accept");
  assert.deepEqual(augmented.findings, []);
  assert.deepEqual(augmented.repairInstructions, []);
});

test("hard-gate skips navigation existence check when knownNavigationIds is undefined", () => {
  const list = buildList([
    buildTestCase("tc-nav-only", {
      qualitySignals: {
        coveredFieldIds: ["fld-a"],
        coveredNavigationIds: ["nav-not-in-ir"],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
  });
  // Without knownNavigationIds, navigation existence is not enforced.
  // No hallucinated_id finding should be emitted for the navigation id.
  const navHallu = augmented.findings.find(
    (f) =>
      f.code === LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.hallucinatedId &&
      f.testCaseId === "tc-nav-only",
  );
  assert.equal(navHallu, undefined);
});

test("hard-gate flags hallucinated navigation id when knownNavigationIds is supplied", () => {
  const list = buildList([
    buildTestCase("tc-nav-bad", {
      qualitySignals: {
        coveredFieldIds: ["fld-a"],
        coveredNavigationIds: ["nav-not-in-ir"],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: buildTestDesignModel(),
    generatedTestCases: list,
    knownNavigationIds: [...NAVIGATION_IDS],
  });
  const finding = augmented.findings.find(
    (f) => f.code === LOGIC_JUDGE_COVERAGE_HARD_GATE_FINDING_CODES.hallucinatedId,
  );
  assert.ok(finding);
  assert.equal(finding.testCaseId, "tc-nav-bad");
  const repair = augmented.repairInstructions.find(
    (instruction) =>
      instruction.testCaseId === "tc-nav-bad" &&
      instruction.path === "qualitySignals.coveredNavigationIds",
  );
  assert.ok(repair);
  assert.match(repair.instruction, /nav-not-in-ir/u);
});

test("runLogicJudge applies the hard-gate to a cache hit and a cache miss byte-identically", async () => {
  const cache = createMemoryLogicJudgeCache();
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: { verdict: "accept", findings: [], repairInstructions: [] },
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 7 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });
  const list = buildList([
    buildTestCase("tc-empty", {
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
      },
    }),
  ]);
  const sharedInputs = {
    jobId: "job-1901",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: buildTestDesignModel(),
    coveragePlan: { perScreen: [] } as never,
    generatedTestCases: list,
    client,
    cache,
    knownNavigationIds: [...NAVIGATION_IDS] as readonly string[],
    coverageThresholds: STRICT_THRESHOLDS,
  };
  const first = await runLogicJudge(sharedInputs);
  const second = await runLogicJudge(sharedInputs);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.verdict.verdict, "repair");
  assert.equal(second.verdict.verdict, "repair");
  assert.equal(client.callCount(), 1, "second invocation must hit cache");
  assert.deepEqual(
    first.verdict.findings.map((f) => f.code).sort(),
    second.verdict.findings.map((f) => f.code).sort(),
  );
});

test("hard-gate emits no findings when the IR is empty (vacuous job)", () => {
  const emptyModel: TestDesignModel = {
    schemaVersion: TEST_DESIGN_MODEL_SCHEMA_VERSION,
    jobId: "job-empty",
    sourceHash: "0".repeat(64),
    screens: [],
    businessRules: [],
    assumptions: [],
    openQuestions: [],
    riskSignals: [],
  };
  const list = buildList([
    buildTestCase("tc-vacuous", {
      qualitySignals: {
        coveredFieldIds: [],
        coveredActionIds: [],
        coveredValidationIds: [],
        coveredNavigationIds: [],
      },
    }),
  ]);
  const augmented = applyCoverageHardGate(buildLlmVerdict("accept"), {
    testDesignModel: emptyModel,
    generatedTestCases: list,
    coverageThresholds: STRICT_THRESHOLDS,
  });
  // No coverable IR elements => empty_coverage_signals does not fire.
  // figmaTraceRef has nodeId set => no weak_trace.
  // No fields/actions in the IR => insufficient_coverage_breadth is skipped.
  assert.equal(augmented.verdict, "accept");
  assert.deepEqual(augmented.findings, []);
});
