import assert from "node:assert/strict";
import test from "node:test";

import {
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type CoveragePlan,
  type GeneratedTestCaseList,
  type TestDesignModel,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  createMemoryLogicJudgeCache,
  runLogicJudge,
} from "./logic-judge.js";

const SAMPLE_TEST_DESIGN_MODEL = {
  screens: [{ screenId: "1:1", name: "Loan form" }],
} as unknown as TestDesignModel;

const SAMPLE_COVERAGE_PLAN = {
  perScreen: [{ screenId: "1:1", requiredFlows: ["submit"] }],
} as unknown as CoveragePlan;

const SAMPLE_GENERATED_TEST_CASES = {
  testCases: [
    {
      testCaseId: "tc-1",
      title: "Submit a valid investment amount",
    },
  ],
} as unknown as GeneratedTestCaseList;

test("runLogicJudge happy path emits an accept verdict and prompt artifact", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        verdict: "accept",
        findings: [],
        repairInstructions: [],
      },
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 7 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-happy",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.cacheHit, false);
  assert.equal(result.verdict.schemaVersion, LOGIC_JUDGE_VERDICT_SCHEMA_VERSION);
  assert.equal(
    result.verdict.contractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
  assert.equal(
    result.verdict.promptTemplateVersion,
    LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(result.verdict.verdict, "accept");
  assert.deepEqual(result.verdict.findings, []);
  assert.deepEqual(result.verdict.repairInstructions, []);
  assert.equal(
    result.promptArtifact.responseSchemaName,
    "workspace-dev-logic-judge-v1",
  );
  assert.equal(client.callCount(), 1);
});

test("runLogicJudge reuses the replay cache on the second invocation", async () => {
  const cache = createMemoryLogicJudgeCache();
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        verdict: "accept",
        findings: [],
        repairInstructions: [],
      },
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 7 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const first = await runLogicJudge({
    jobId: "logic-judge-cache",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
    cache,
  });
  const second = await runLogicJudge({
    jobId: "logic-judge-cache",
    generatedAt: "2026-05-05T10:01:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
    cache,
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.verdict.verdict, "accept");
  assert.equal(second.verdict.cacheHit, true);
  assert.equal(client.callCount(), 1);
});

test("runLogicJudge converts a gateway refusal into a reject verdict", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "error",
      errorClass: "refusal",
      message: "judge refused",
      retryable: false,
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-refusal",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.refusal?.code, "refusal");
  assert.match(result.verdict.refusal?.message ?? "", /judge refused/u);
  assert.equal(result.verdict.findings[0]?.severity, "error");
});
