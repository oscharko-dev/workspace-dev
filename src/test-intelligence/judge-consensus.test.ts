import assert from "node:assert/strict";
import test from "node:test";

import {
  A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  A11Y_VERDICT_SCHEMA_VERSION,
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type A11yVerdict,
  type FaithfulnessVerdict,
  type FaithfulnessVerdictLabel,
  type JudgeVerdict,
  type LogicJudgeVerdictLabel,
  type RepairInstruction,
} from "../contracts/index.js";
import {
  buildA11yJudgeConsensusEntry,
  buildFaithfulnessJudgeConsensusEntry,
  buildJudgeConsensus,
  buildLogicJudgeConsensusEntry,
} from "./judge-consensus.js";

const buildLogicVerdict = (
  verdict: LogicJudgeVerdictLabel,
  options?: {
    findings?: JudgeVerdict["findings"];
    repairInstructions?: readonly RepairInstruction[];
  },
): JudgeVerdict => ({
  schemaVersion: LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-06T00:00:00.000Z",
  jobId: "job-consensus",
  cacheHit: false,
  cacheKeyDigest: "l".repeat(64),
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  verdict,
  findings: options?.findings ?? [],
  repairInstructions: options?.repairInstructions ?? [],
});

const buildFaithfulnessVerdict = (
  verdict: FaithfulnessVerdictLabel,
  options?: Partial<
    Pick<FaithfulnessVerdict, "hallucinations" | "mismatches">
  >,
): FaithfulnessVerdict => ({
  schemaVersion: FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-06T00:00:00.000Z",
  jobId: "job-consensus",
  cacheHit: false,
  cacheKeyDigest: "f".repeat(64),
  modelDeployment: "llama-4-maverick-vision-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  fallbackReason: "none",
  score: 1,
  verdict,
  hallucinations: options?.hallucinations ?? [],
  mismatches: options?.mismatches ?? [],
});

const buildA11yVerdict = (
  verdict: A11yVerdict["verdict"],
  options?: Partial<Pick<A11yVerdict, "findings" | "repairInstructions">>,
): A11yVerdict => ({
  schemaVersion: A11Y_VERDICT_SCHEMA_VERSION,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  promptTemplateVersion: A11Y_JUDGE_PROMPT_TEMPLATE_VERSION,
  generatedAt: "2026-05-06T00:00:00.000Z",
  jobId: "job-consensus",
  cacheHit: false,
  cacheKeyDigest: "a".repeat(64),
  modelDeployment: "phi-4-multimodal-instruct-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock",
  verdict,
  criteria: [],
  findings: options?.findings ?? [],
  repairInstructions: options?.repairInstructions ?? [],
});

test("buildJudgeConsensus accepts a single accept judge unchanged", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [buildLogicJudgeConsensusEntry(buildLogicVerdict("accept"))],
  });

  assert.equal(consensus.verdict, "accept");
  assert.equal(consensus.repairState, "none");
  assert.equal(consensus.vetoBy, undefined);
  assert.deepEqual(consensus.activeFindings, []);
  assert.deepEqual(consensus.repairInstructions, []);
  assert.deepEqual(consensus.repairHistory, {
    attempted: false,
    repairIterationCount: 0,
    finalOutcome: "not_needed",
    historicalFindings: [],
    historicalRepairInstructions: [],
  });
  assert.equal(consensus.panel.length, 1);
});

test("buildJudgeConsensus preserves a logic schema-class veto as repair and surfaces vetoBy", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      buildLogicJudgeConsensusEntry(
        buildLogicVerdict("repair", {
          repairInstructions: [
            {
              testCaseId: "$job",
              path: "steps[0].action",
              instruction: "Fix the structured output schema.",
              kind: "schema_violation",
              message: "steps[0].action missing",
            },
          ],
        }),
      ),
      buildFaithfulnessJudgeConsensusEntry(buildFaithfulnessVerdict("accept")),
    ],
  });

  assert.equal(consensus.verdict, "repair");
  assert.equal(consensus.repairState, "repair_required");
  assert.deepEqual(consensus.vetoBy, {
    judgeId: "logic_judge",
    verdict: "repair",
    findingCodes: [],
  });
  assert.deepEqual(consensus.activeFindings, []);
  assert.equal(consensus.repairInstructions.length, 1);
});

test("buildJudgeConsensus preserves a faithfulness mismatch veto and unions repair instructions", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
      buildFaithfulnessJudgeConsensusEntry(
        buildFaithfulnessVerdict("repair", {
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              expectedLabel: "Continue",
              visibleLabel: "Weiter",
              message: "Visible CTA label does not match the generated step.",
            },
          ],
        }),
      ),
    ],
  });

  assert.equal(consensus.verdict, "repair");
  assert.equal(consensus.repairState, "repair_required");
  assert.deepEqual(consensus.vetoBy, {
    judgeId: "faithfulness_judge",
    verdict: "repair",
    findingCodes: ["cross_modal_mismatch"],
  });
  assert.equal(consensus.activeFindings.length, 1);
  assert.equal(consensus.repairInstructions.length, 1);
  assert.match(
    consensus.repairInstructions[0]?.instruction ?? "",
    /Faithfulness mismatch/u,
  );
});

test("buildJudgeConsensus keeps a low-confidence accept versus reject tie as a split", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        ...buildLogicJudgeConsensusEntry(buildLogicVerdict("reject")),
        confidence: 0.5,
      },
      buildFaithfulnessJudgeConsensusEntry(buildFaithfulnessVerdict("accept")),
    ],
  });

  assert.equal(consensus.verdict, "repair");
  assert.equal(consensus.agreementShape, "split");
  assert.equal(consensus.vetoBy, undefined);
});

test("Issue #2102: consensus voting protocol covers 30 handcrafted disagreement cases", () => {
  const buildPanelEntry = (input: {
    judgeId: string;
    verdict: "accept" | "repair" | "reject";
    confidence?: number;
    findingCode?: string;
  }) => ({
    judgeId: input.judgeId,
    verdict: input.verdict,
    weight: 1,
    ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    findings:
      input.findingCode === undefined
        ? []
        : [
            {
              scope: "job" as const,
              testCaseId: "$job",
              code: input.findingCode,
              message: input.findingCode,
              category: "other" as const,
            },
          ],
    repairInstructions: [],
  });

  const cases = [
    { name: "unanimous accept", panel: ["accept", "accept", "accept"], verdict: "accept", agreementShape: "unanimous" },
    { name: "unanimous repair", panel: ["repair", "repair", "repair"], verdict: "repair", agreementShape: "unanimous" },
    { name: "majority repair", panel: ["repair", "repair", "accept"], verdict: "repair", agreementShape: "majority" },
    { name: "majority accept no dissenting repair", panel: ["accept", "accept", "accept"], verdict: "accept", agreementShape: "unanimous" },
    { name: "majority accept with one repair", panel: ["accept", "accept", "repair"], verdict: "repair", agreementShape: "majority" },
    { name: "low confidence a11y reject becomes repair against accept majority", panel: ["accept", "accept", "reject"], verdict: "repair", agreementShape: "majority", confidenceByIndex: { 2: 0.4 } },
    { name: "high confidence reject vetoes accept majority", panel: ["accept", "accept", "reject"], verdict: "reject", agreementShape: "vetoed", judgeIds: ["logic_judge", "faithfulness_judge", "logic_judge"] },
    { name: "high confidence reject vetoes repair majority", panel: ["repair", "repair", "reject"], verdict: "reject", agreementShape: "vetoed", judgeIds: ["logic_judge", "faithfulness_judge", "logic_judge"] },
    { name: "logic repair schema veto stays vetoed", panel: ["repair", "accept"], verdict: "repair", agreementShape: "vetoed", schemaRepairAt: 0 },
    { name: "faithfulness mismatch veto stays vetoed", panel: ["accept", "repair"], verdict: "repair", agreementShape: "vetoed", mismatchAt: 1 },
    { name: "accept repair low-confidence a11y reject resolves as majority repair", panel: ["accept", "repair", "reject"], verdict: "repair", agreementShape: "majority", confidenceByIndex: { 2: 0.5 } },
    { name: "two-judge accept repair is split", panel: ["accept", "repair"], verdict: "repair", agreementShape: "split" },
    { name: "two-judge accept reject low confidence is split", panel: ["accept", "reject"], verdict: "repair", agreementShape: "split", confidenceByIndex: { 1: 0.5 } },
    { name: "two-judge accept reject high confidence vetoes", panel: ["accept", "reject"], verdict: "reject", agreementShape: "vetoed", judgeIds: ["logic_judge", "logic_judge"] },
    { name: "a11y reject normalizes to repair", panel: ["accept", "accept", "reject"], verdict: "repair", agreementShape: "majority", confidenceByIndex: { 2: 0.5 }, judgeIds: ["logic_judge", "faithfulness_judge", "a11y_judge"] },
    { name: "transient a11y reject does not veto but still normalizes to repair", panel: ["accept", "accept", "reject"], verdict: "repair", agreementShape: "majority", transientRejectAt: 2 },
    { name: "transient two-judge reject splits", panel: ["accept", "reject"], verdict: "repair", agreementShape: "split", transientRejectAt: 1 },
    { name: "weighted majority accept with repair still repairs", panel: ["accept", "accept", "repair"], verdict: "repair", agreementShape: "majority", weights: { 0: 2, 1: 2, 2: 1 } },
    { name: "weighted majority repair stays repair", panel: ["repair", "accept", "repair"], verdict: "repair", agreementShape: "majority", weights: { 0: 2, 1: 1, 2: 2 } },
    { name: "weighted split stays split", panel: ["accept", "repair"], verdict: "repair", agreementShape: "split", weights: { 0: 2, 1: 2 } },
    { name: "single low confidence reject still splitless unanimous reject", panel: ["reject"], verdict: "reject", agreementShape: "unanimous", confidenceByIndex: { 0: 0.4 } },
    { name: "single high confidence reject vetoes", panel: ["reject"], verdict: "reject", agreementShape: "vetoed" },
    { name: "faithfulness reject high confidence vetoes", panel: ["accept", "reject"], verdict: "reject", agreementShape: "vetoed", judgeIds: ["logic_judge", "faithfulness_judge"] },
    { name: "logic reject low confidence with repair panel can normalize to unanimous repair", panel: ["repair", "repair", "reject"], verdict: "repair", agreementShape: "unanimous", confidenceByIndex: { 2: 0.4 } },
    { name: "logic reject low confidence with accept majority accepts", panel: ["accept", "accept", "reject"], verdict: "accept", agreementShape: "majority", confidenceByIndex: { 2: 0.4 }, judgeIds: ["faithfulness_judge", "a11y_judge", "logic_judge"] },
    { name: "repair accept reject low confidence split", panel: ["repair", "accept", "reject"], verdict: "repair", agreementShape: "split", confidenceByIndex: { 2: 0.2 }, judgeIds: ["faithfulness_judge", "a11y_judge", "logic_judge"] },
    { name: "accept accept repair no veto codes", panel: ["accept", "accept", "repair"], verdict: "repair", agreementShape: "majority", judgeIds: ["logic_judge", "a11y_judge", "faithfulness_judge"] },
    { name: "repair accept accept with low confidence reject absent", panel: ["repair", "accept", "accept"], verdict: "repair", agreementShape: "majority" },
    { name: "split with four judges and no strict majority", panel: ["accept", "accept", "repair", "repair"], verdict: "repair", agreementShape: "split" },
    { name: "four-judge high confidence reject vetoes", panel: ["accept", "accept", "repair", "reject"], verdict: "reject", agreementShape: "vetoed", judgeIds: ["logic_judge", "faithfulness_judge", "a11y_judge", "logic_judge"] },
  ] as const;

  assert.equal(cases.length, 30);

  for (const scenario of cases) {
    const judgeIds =
      scenario.judgeIds ??
      scenario.panel.map((_, index) =>
        index === 0
          ? "logic_judge"
          : index === 1
            ? "faithfulness_judge"
            : index === 2
              ? "a11y_judge"
              : `judge_${index + 1}`,
      );
    const panel = scenario.panel.map((verdict, index) => {
      const repairInstruction =
        scenario.schemaRepairAt === index
          ? [
              {
                testCaseId: "$job",
                path: "$.schema",
                instruction: "Repair the schema mismatch.",
                kind: "schema_violation" as const,
              },
            ]
          : [];
      const findingCode =
        scenario.transientRejectAt === index
          ? "gateway_unavailable"
          : scenario.mismatchAt === index
            ? "cross_modal_mismatch"
            : undefined;
      const entry = buildPanelEntry({
        judgeId: judgeIds[index]!,
        verdict,
        confidence: scenario.confidenceByIndex?.[index],
        findingCode,
      });
      return {
        ...entry,
        ...(scenario.weights?.[index] !== undefined
          ? { weight: scenario.weights[index]! }
          : {}),
        ...(repairInstruction.length > 0
          ? { repairInstructions: repairInstruction }
          : {}),
        ...(scenario.mismatchAt === index
          ? {
              findings: [
                {
                  scope: "test_case" as const,
                  testCaseId: "tc-1",
                  code: "cross_modal_mismatch",
                  message: "Mismatch",
                  category: "cross_modal_mismatch" as const,
                },
              ],
            }
          : {}),
      };
    });
    const consensus = buildJudgeConsensus({
      jobId: `job-${scenario.name.replace(/\s+/gu, "-")}`,
      generatedAt: "2026-05-06T00:00:00.000Z",
      panel,
    });
    assert.equal(
      consensus.verdict,
      scenario.verdict,
      `${scenario.name}: verdict`,
    );
    assert.equal(
      consensus.agreementShape,
      scenario.agreementShape,
      `${scenario.name}: agreementShape`,
    );
  }
});

test("buildJudgeConsensus records repaired-success history separately from active findings", () => {
  const historicalFinding = {
    scope: "test_case" as const,
    testCaseId: "tc-old",
    code: "schema_class:missing_field",
    message: "The initial run was missing a required field.",
    severity: "error" as const,
    category: "schema_class" as const,
  };

  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [buildLogicJudgeConsensusEntry(buildLogicVerdict("accept"))],
    repairHistory: {
      attempted: true,
      repairIterationCount: 1,
      finalOutcome: "accepted",
      historicalFindings: [historicalFinding],
      historicalRepairInstructions: [
        {
          testCaseId: "tc-old",
          path: "steps[0].action",
          instruction: "Add the missing field to the generated payload.",
        },
      ],
    },
  });

  assert.equal(consensus.repairState, "repaired");
  assert.equal(consensus.verdict, "accept");
  assert.deepEqual(consensus.activeFindings, []);
  assert.equal(consensus.repairHistory.attempted, true);
  assert.equal(consensus.repairHistory.repairIterationCount, 1);
  assert.equal(consensus.repairHistory.finalOutcome, "accepted");
  assert.deepEqual(consensus.repairHistory.historicalFindings, [
    historicalFinding,
  ]);
  assert.equal(consensus.repairHistory.historicalRepairInstructions.length, 1);
});

test("buildJudgeConsensus normalizes a11y and coverage rejects down to repair", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        judgeId: "a11y_judge",
        verdict: "reject",
        weight: 1,
        findings: [
          {
            scope: "job",
            testCaseId: "$job",
            code: "missing_form_screen_a11y_case",
            message: "Missing accessibility case for form screen 1:1.",
            category: "a11y_gap",
            severity: "error",
          },
        ],
        repairInstructions: [
          {
            testCaseId: "$job",
            path: "qualitySignals.coveredScreenIds",
            instruction: "Add the missing accessibility case for screen 1:1.",
          },
        ],
      },
      buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
    ],
  });

  assert.equal(consensus.verdict, "repair");
  assert.equal(consensus.repairState, "repair_required");
  assert.equal(consensus.panel[0]?.verdict, "repair");
  assert.equal(consensus.activeFindings.length, 1);
});

test("buildJudgeConsensus marks repaired history separately from active findings", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [buildLogicJudgeConsensusEntry(buildLogicVerdict("accept"))],
    repairHistory: {
      attempted: true,
      repairIterationCount: 2,
      finalOutcome: "accepted",
      historicalFindings: [
        {
          scope: "job",
          testCaseId: "$job",
          code: "schema_violation",
          message: "qualitySignals.coveredFieldIds was emitted as an object.",
          category: "schema_class",
          severity: "error",
        },
      ],
      historicalRepairInstructions: [
        {
          testCaseId: "$job",
          path: "$.qualitySignals.coveredFieldIds",
          instruction: "Emit coveredFieldIds as an array of cited IR ids.",
          kind: "schema_violation",
        },
      ],
    },
  });

  assert.equal(consensus.verdict, "accept");
  assert.equal(consensus.repairState, "repaired");
  assert.deepEqual(consensus.activeFindings, []);
  assert.equal(consensus.repairHistory.attempted, true);
  assert.equal(consensus.repairHistory.repairIterationCount, 2);
  assert.equal(consensus.repairHistory.finalOutcome, "accepted");
  assert.equal(consensus.repairHistory.historicalFindings.length, 1);
  assert.equal(
    consensus.repairHistory.historicalFindings[0]?.code,
    "schema_violation",
  );
  assert.equal(
    consensus.repairHistory.historicalRepairInstructions.length,
    1,
  );
});

test("buildA11yJudgeConsensusEntry projects structured a11y findings into the consensus panel", () => {
  const entry = buildA11yJudgeConsensusEntry(
    buildA11yVerdict("repair", {
      findings: [
        {
          criterionId: "1:1::focus-indicator",
          testCaseId: "$job",
          code: "criterion_covered_weakly:1:1::focus-indicator",
          severity: "warning",
          message: "Focus indication is only weakly covered.",
        },
      ],
      repairInstructions: [
        {
          testCaseId: "$job",
          path: "$job.a11yCoverage[1:1::focus-indicator]",
          instruction: "Add an explicit focus-visible assertion for each tab stop.",
        },
      ],
    }),
  );

  assert.equal(entry.judgeId, "a11y_judge");
  assert.equal(entry.verdict, "repair");
  assert.equal(entry.findings[0]?.category, "a11y_gap");
  assert.equal(entry.repairInstructions.length, 1);
});

// ---------------------------------------------------------------------------
// Issue #2038 — cross-family ensemble integration into judge-consensus.
// ---------------------------------------------------------------------------

test("buildJudgeConsensus emits crossFamily summary when every judge declares a family", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-cross-family",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        ...buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
        family: "anthropic",
        region: "eu",
        modelId: "claude-3.5-sonnet",
        promptVersion: "logic-judge.v1",
      },
      {
        ...buildFaithfulnessJudgeConsensusEntry(
          buildFaithfulnessVerdict("accept"),
        ),
        family: "openai",
        region: "eu",
        modelId: "gpt-4o",
        promptVersion: "faithfulness-judge.v1",
      },
      {
        ...buildA11yJudgeConsensusEntry(buildA11yVerdict("accept")),
        family: "google",
        region: "eu",
        modelId: "gemini-1.5-pro",
        promptVersion: "a11y-judge.v1",
      },
    ],
  });
  assert.notEqual(consensus.crossFamily, undefined);
  assert.equal(consensus.crossFamily?.decision, "unanimous_accept");
  assert.equal(consensus.crossFamily?.escalation, "none");
  assert.deepEqual([...(consensus.crossFamily?.families ?? [])].sort(), [
    "anthropic",
    "google",
    "openai",
  ]);
});

test("buildJudgeConsensus omits crossFamily summary when every judge shares the same family", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-single-family",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        ...buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
        family: "in-house",
        region: "eu",
        modelId: "gpt-oss-120b",
        promptVersion: "logic-judge.v1",
      },
      {
        ...buildA11yJudgeConsensusEntry(buildA11yVerdict("accept")),
        family: "in-house",
        region: "eu",
        modelId: "gpt-oss-120b",
        promptVersion: "a11y-judge.v1",
      },
    ],
  });
  assert.equal(consensus.crossFamily, undefined);
});

test("buildJudgeConsensus refuses an unknown family marker on a panel entry", () => {
  assert.throws(
    () =>
      buildJudgeConsensus({
        jobId: "job-bad-family",
        generatedAt: "2026-05-06T00:00:00.000Z",
        panel: [
          {
            ...buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
            family: "unknown" as never,
          },
        ],
      }),
    /unknown family/u,
  );
});

test("buildJudgeConsensus refuses a malformed humanReview decision", () => {
  assert.throws(
    () =>
      buildJudgeConsensus({
        jobId: "job-bad-human-review",
        generatedAt: "2026-05-06T00:00:00.000Z",
        panel: [buildLogicJudgeConsensusEntry(buildLogicVerdict("accept"))],
        humanReview: {
          schemaVersion: "1.0.0",
          reviewerKind: "dry_run_marker",
          principalHash: "not-hex",
          verdict: "deferred",
          rationale: "ok",
          decidedAt: "2026-05-06T00:00:00.000Z",
          triggeredBy: "split_decision",
        },
      }),
    /principalHash must be 64 lowercase hex chars/u,
  );
});

test("buildJudgeConsensus forwards crossFamilyOptions.mostTrustedFamily into the summary", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-most-trusted",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        ...buildLogicJudgeConsensusEntry(buildLogicVerdict("reject")),
        family: "anthropic",
        region: "eu",
      },
      {
        ...buildFaithfulnessJudgeConsensusEntry(
          buildFaithfulnessVerdict("accept"),
        ),
        family: "openai",
        region: "eu",
      },
      {
        ...buildA11yJudgeConsensusEntry(buildA11yVerdict("accept")),
        family: "google",
        region: "eu",
      },
    ],
    crossFamilyOptions: { mostTrustedFamily: "anthropic" },
  });
  assert.equal(consensus.crossFamily?.decision, "majority_decision");
  assert.equal(consensus.crossFamily?.escalation, "human_review_required");
});

test("buildJudgeConsensus emits a crossFamily summary when only family is supplied", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-minimal-cross-family",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      {
        ...buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
        family: "anthropic",
      },
      {
        ...buildA11yJudgeConsensusEntry(buildA11yVerdict("accept")),
        family: "google",
      },
    ],
  });
  assert.notEqual(consensus.crossFamily, undefined);
  assert.equal(consensus.crossFamily?.decision, "unanimous_accept");
});

test("buildJudgeConsensus refuses an empty modelId on a panel entry", () => {
  assert.throws(
    () =>
      buildJudgeConsensus({
        jobId: "job-empty-model-id",
        generatedAt: "2026-05-06T00:00:00.000Z",
        panel: [
          {
            ...buildLogicJudgeConsensusEntry(buildLogicVerdict("accept")),
            family: "anthropic",
            modelId: "",
          },
        ],
      }),
    /invalid modelId/u,
  );
});

test("buildJudgeConsensus attaches a humanReview decision verbatim", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-with-human-review",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [buildLogicJudgeConsensusEntry(buildLogicVerdict("accept"))],
    humanReview: {
      schemaVersion: "1.0.0",
      reviewerKind: "dry_run_marker",
      principalHash: "a".repeat(64),
      verdict: "deferred",
      rationale: "Marker for offline analysis",
      decidedAt: "2026-05-06T00:00:00.000Z",
      triggeredBy: "split_decision",
    },
  });
  assert.equal(consensus.humanReview?.reviewerKind, "dry_run_marker");
  assert.equal(consensus.humanReview?.principalHash, "a".repeat(64));
});
