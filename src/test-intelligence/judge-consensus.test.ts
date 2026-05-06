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
  assert.equal(consensus.vetoBy, undefined);
  assert.deepEqual(consensus.repairInstructions, []);
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
  assert.deepEqual(consensus.vetoBy, {
    judgeId: "logic_judge",
    verdict: "repair",
    findingCodes: [],
  });
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
  assert.deepEqual(consensus.vetoBy, {
    judgeId: "faithfulness_judge",
    verdict: "repair",
    findingCodes: ["cross_modal_mismatch"],
  });
  assert.equal(consensus.repairInstructions.length, 1);
  assert.match(
    consensus.repairInstructions[0]?.instruction ?? "",
    /Faithfulness mismatch/u,
  );
});

test("buildJudgeConsensus resolves an accept versus reject tie to repair", () => {
  const consensus = buildJudgeConsensus({
    jobId: "job-consensus",
    generatedAt: "2026-05-06T00:00:00.000Z",
    panel: [
      buildLogicJudgeConsensusEntry(buildLogicVerdict("reject")),
      buildFaithfulnessJudgeConsensusEntry(buildFaithfulnessVerdict("accept")),
    ],
  });

  assert.equal(consensus.verdict, "repair");
  assert.equal(consensus.vetoBy, undefined);
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
  assert.equal(consensus.panel[0]?.verdict, "repair");
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
