import assert from "node:assert/strict";
import test from "node:test";

import type {
  BusinessTestIntentIr,
  CoveragePlan,
  GeneratedTestCaseList,
  RiskRanking,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  computeAdversarialFindingDedupeKey,
  computeNegativeCoverageAccounting,
  dedupeAdversarialFindings,
  runAdversarialCriticRound,
  validateAdversarialCriticResponse,
} from "./adversarial-critic-agent.js";

const SAMPLE_INTENT = {
  schemaVersion: "1.0.0",
  contractVersion: "1.13.0",
  jobId: "job-2039",
} as BusinessTestIntentIr;

const SAMPLE_COVERAGE_PLAN = {
  schemaVersion: "1.0.0",
  jobId: "job-2039",
  minimumCases: [],
  recommendedCases: [],
  techniques: [],
  mutationKillRateTarget: 0.85,
} as CoveragePlan;

const SAMPLE_RISK_RANKING = {
  schemaVersion: "1.0.0",
  jobId: "job-2039",
  rankedItems: [],
} as RiskRanking;

const makeList = (
  testCases: Array<{
    id: string;
    type: "functional" | "negative" | "boundary" | "validation";
  }>,
): GeneratedTestCaseList =>
  ({
    schemaVersion: "1.0.0",
    jobId: "job-2039",
    testCases,
  }) as GeneratedTestCaseList;

test("adversarial critic: validateAdversarialCriticResponse keeps only well-formed findings", () => {
  const findings = validateAdversarialCriticResponse({
    findings: [
      {
        category: "boundary",
        title: "Loan amount upper bound is untested",
        rationale: "The suite never probes the documented max amount.",
        affectedFieldId: "field:loan_amount",
        sourceRefs: ["rule:max-loan-amount"],
        ruleRefs: ["policy:max-loan-amount"],
        minimumReproducibleTestData: ["loan_amount=999999.99"],
        suggestedTestType: "boundary",
        repairInstruction:
          "Replace a low-value happy path with an upper-bound amount case.",
      },
      {
        category: "boundary",
        title: "",
        rationale: "Missing title should be dropped.",
        minimumReproducibleTestData: ["foo=bar"],
        suggestedTestType: "boundary",
        repairInstruction: "invalid",
      },
    ],
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.category, "boundary");
  assert.equal(findings[0]?.affectedFieldId, "field:loan_amount");
});

test("adversarial critic: dedupe keeps only the first finding per category and affected target", () => {
  const first = validateAdversarialCriticResponse({
    findings: [
      {
        category: "negative_path",
        title: "Missing IBAN ownership rejection",
        rationale: "The suite does not reject a mismatched account holder.",
        affectedFieldId: "field:iban",
        sourceRefs: ["rule:iban-owner-match"],
        ruleRefs: [],
        minimumReproducibleTestData: ["iban=DE001234", "owner_name=Other"],
        suggestedTestType: "negative",
        repairInstruction: "Swap in an owner-mismatch negative case.",
      },
    ],
  })[0];
  const duplicate = validateAdversarialCriticResponse({
    findings: [
      {
        category: "negative_path",
        title: "Duplicate IBAN ownership rejection",
        rationale: "Same blind spot, different wording.",
        affectedFieldId: "field:iban",
        sourceRefs: ["rule:iban-owner-match"],
        ruleRefs: [],
        minimumReproducibleTestData: ["iban=DE001234", "owner_name=Other"],
        suggestedTestType: "negative",
        repairInstruction: "Still the same fix.",
      },
    ],
  })[0];

  assert.ok(first);
  assert.ok(duplicate);
  assert.equal(
    computeAdversarialFindingDedupeKey(first),
    computeAdversarialFindingDedupeKey(duplicate),
  );
  const seenKeys = new Set<string>();
  const deduped = dedupeAdversarialFindings({
    findings: [first, duplicate],
    seenKeys,
  });
  assert.deepEqual(deduped, [first]);
});

test("adversarial critic: malformed success payload degrades to an empty finding set", async () => {
  const client = createMockLlmGatewayClient({
    role: "logic_judge",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "mock-1",
    gatewayRelease: "mock",
    staticResponse: {
      outcome: "success",
      content: { testCases: [{ id: "legacy-generator-payload" }] },
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
      modelDeployment: "gpt-oss-120b-mock",
      modelRevision: "mock-1",
      gatewayRelease: "mock",
      attempt: 1,
    },
  });

  const result = await runAdversarialCriticRound({
    jobId: "job-2039",
    round: 1,
    domain: "banking",
    client,
    intent: SAMPLE_INTENT,
    generatedList: makeList([{ id: "tc-1", type: "functional" }]),
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    riskRanking: SAMPLE_RISK_RANKING,
  });

  assert.equal(result.gatewayResult.outcome, "success");
  assert.deepEqual(result.findings, []);
  assert.equal(result.artifact.outputs.findingCount, 0);
});

test("adversarial critic: negative coverage accounting reports the >=30% ratio improvement threshold", () => {
  const accounting = computeNegativeCoverageAccounting({
    baselineList: makeList([
      { id: "tc-1", type: "functional" },
      { id: "tc-2", type: "functional" },
      { id: "tc-3", type: "negative" },
    ]),
    finalList: makeList([
      { id: "tc-1", type: "functional" },
      { id: "tc-2", type: "negative" },
      { id: "tc-3", type: "negative" },
    ]),
  });

  assert.equal(accounting.baselineNegativeRatio, 0.333333);
  assert.equal(accounting.finalNegativeRatio, 0.666667);
  assert.equal(accounting.relativeRatioIncrease, 1.000003);
  assert.equal(accounting.meetsThreshold, true);
});
