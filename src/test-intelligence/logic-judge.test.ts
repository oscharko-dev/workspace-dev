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

test("runLogicJudge surfaces a repair verdict with findings and repair instructions", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        verdict: "repair",
        findings: [
          {
            testCaseId: "$job",
            code: "missing_covered_field_ids",
            severity: "warning",
            message: "qualitySignals.coveredFieldIds is empty",
          },
        ],
        repairInstructions: [
          {
            testCaseId: "$job",
            path: "qualitySignals.coveredFieldIds",
            instruction: "populate from IR field identifiers traced by the steps",
          },
        ],
      },
      finishReason: "stop",
      usage: { inputTokens: 11, outputTokens: 9 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-repair",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.cacheHit, false);
  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.findings.length, 1);
  assert.equal(result.verdict.findings[0]?.code, "missing_covered_field_ids");
  assert.equal(result.verdict.findings[0]?.severity, "warning");
  assert.equal(result.verdict.repairInstructions.length, 1);
  assert.equal(
    result.verdict.repairInstructions[0]?.path,
    "qualitySignals.coveredFieldIds",
  );
  assert.equal(result.verdict.refusal, undefined);
  assert.equal(client.callCount(), 1);
});

test("runLogicJudge normalizes missing finding testCaseId to $job", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        verdict: "repair",
        findings: [
          {
            code: "job_level_schema_gap",
            severity: "warning",
            message: "Job-level coverage warning without a case anchor.",
          },
        ],
        repairInstructions: [],
      },
      finishReason: "stop",
      usage: { inputTokens: 20, outputTokens: 10 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-missing-finding-anchor",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.findings[0]?.testCaseId, "$job");
  assert.equal(result.verdict.findings[0]?.code, "job_level_schema_gap");
  assert.equal(result.verdict.refusal, undefined);
});

test("runLogicJudge passes through a semantic reject verdict from the model", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        verdict: "reject",
        findings: [
          {
            testCaseId: "$job",
            code: "fundamental_unsoundness",
            severity: "error",
            message: "generator output is not traceable to the supplied IR",
          },
        ],
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
    jobId: "logic-judge-semantic-reject",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.findings.length, 1);
  assert.equal(result.verdict.findings[0]?.code, "fundamental_unsoundness");
  assert.equal(result.verdict.findings[0]?.severity, "error");
  assert.deepEqual(result.verdict.repairInstructions, []);
  assert.equal(
    result.verdict.refusal,
    undefined,
    "semantic reject must not be tagged as a refusal",
  );
});

test("runLogicJudge converts a token-limit overrun into a reject verdict", async () => {
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
      usage: { inputTokens: 11, outputTokens: 9999 },
      modelDeployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-token-limit",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
    maxOutputTokens: 16,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.refusal?.code, "schema_invalid");
  assert.match(
    result.verdict.refusal?.message ?? "",
    /exceeds maxOutputTokens/u,
  );
  assert.equal(result.verdict.findings[0]?.severity, "error");
});

const SCHEMA_VIOLATION_REPAIR_CASES = [
  {
    jobId: "logic-judge-schema-missing-required",
    title: "missing required field",
    content: {
      verdict: "repair",
      findings: [
        {
          testCaseId: "$job",
          code: "schema_violation",
          severity: "error",
        },
      ],
      repairInstructions: [],
    },
    repairPath: "$.findings[0].message",
  },
  {
    jobId: "logic-judge-schema-extra-forbidden",
    title: "extra forbidden field",
    content: {
      verdict: "repair",
      findings: [],
      repairInstructions: [],
      unexpectedField: true,
    },
    repairPath: "$.unexpectedField",
  },
  {
    jobId: "logic-judge-schema-type-mismatch",
    title: "type mismatch",
    content: {
      verdict: ["repair"],
      findings: [],
      repairInstructions: [],
    },
    repairPath: "$.verdict",
  },
] as const;

for (const scenario of SCHEMA_VIOLATION_REPAIR_CASES) {
  test(`runLogicJudge surfaces a schema_violation repair verdict for ${scenario.title}`, async () => {
    const client = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      responder: (_request, attempt) => ({
        outcome: "success",
        content: scenario.content,
        finishReason: "stop",
        usage: { inputTokens: 11, outputTokens: 7 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    });

    const result = await runLogicJudge({
      jobId: scenario.jobId,
      generatedAt: "2026-05-05T10:00:00Z",
      testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
      coveragePlan: SAMPLE_COVERAGE_PLAN,
      generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
      client,
    });

    assert.equal(result.verdict.verdict, "repair");
    assert.equal(result.verdict.refusal, undefined);
    assert.equal(result.verdict.findings[0]?.code, "schema_invalid_response");
    assert.equal(result.verdict.findings[0]?.severity, "error");
    assert.equal(
      result.verdict.repairInstructions[0]?.kind,
      "schema_violation",
    );
    assert.equal(result.verdict.repairInstructions[0]?.path, scenario.repairPath);
    assert.match(result.verdict.repairInstructions[0]?.path ?? "", /^\$/u);
    assert.match(
      result.verdict.repairInstructions[0]?.instruction ?? "",
      /response schema/u,
    );
    assert.equal(client.callCount(), 1);
  });
}

test("runLogicJudge converts gateway schema_invalid response-shape failures into repair", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "mistral-document-ai-2512",
    modelRevision: "mistral-document-ai-2512@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "error",
      errorClass: "schema_invalid",
      message:
        "structured-output content violates response schema: $.repairInstructions[0].path must be a string",
      retryable: false,
      attempt,
    }),
  });

  const result = await runLogicJudge({
    jobId: "logic-judge-gateway-schema-invalid-repair",
    generatedAt: "2026-05-05T10:00:00Z",
    testDesignModel: SAMPLE_TEST_DESIGN_MODEL,
    coveragePlan: SAMPLE_COVERAGE_PLAN,
    generatedTestCases: SAMPLE_GENERATED_TEST_CASES,
    client,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.refusal, undefined);
  assert.equal(result.verdict.findings[0]?.code, "schema_invalid");
  assert.equal(
    result.verdict.repairInstructions[0]?.kind,
    "schema_violation",
  );
  assert.equal(
    result.verdict.repairInstructions[0]?.path,
    "$.repairInstructions[0].path",
  );
});
