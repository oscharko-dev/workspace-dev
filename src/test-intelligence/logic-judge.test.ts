import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_LOGIC_JUDGE_FINDING_CODES,
  ALLOWED_LOGIC_JUDGE_VERDICTS,
  BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  LOGIC_JUDGE_OUTPUT_SCHEMA_NAME,
  LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LlmGenerationResult,
} from "../contracts/index.js";
import { createFinOpsUsageRecorder } from "./finops-report.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  LOGIC_JUDGE_FINOPS_SOURCE,
  LOGIC_JUDGE_RESPONSE_SCHEMA,
  LogicJudgeError,
  buildCompiledLogicJudgePrompt,
  parseLogicJudgeResponse,
  runLogicJudge,
} from "./logic-judge.js";

const ZERO = "0".repeat(64);
const GENERATED_AT = "2026-05-05T10:00:00.000Z";

const buildIntent = (): BusinessTestIntentIr => ({
  version: BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION,
  source: { kind: "figma_local_json", contentHash: "hash-fixture" },
  screens: [
    {
      screenId: "s-banking",
      screenName: "Auszahlung Antrag",
      trace: { nodeId: "s-banking" },
    },
  ],
  detectedFields: [
    {
      id: "f-iban",
      screenId: "s-banking",
      trace: { nodeId: "n-1" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "IBAN",
      type: "text",
    },
  ],
  detectedActions: [
    {
      id: "a-submit",
      screenId: "s-banking",
      trace: { nodeId: "n-2" },
      provenance: "figma_node",
      confidence: 0.9,
      label: "Auszahlung freigeben",
      kind: "submit",
    },
  ],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildCase = (
  overrides: Partial<GeneratedTestCase> = {},
): GeneratedTestCase => ({
  id: "tc-aaaaaaaaaaaa",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Auszahlung mit Vier-Augen-Freigabe",
  objective: "Auszahlung freigeben",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "financial_transaction",
  technique: "use_case",
  preconditions: ["Nutzer ist angemeldet"],
  testData: ["IBAN gültig"],
  steps: [
    {
      index: 1,
      action: "IBAN eingeben",
      expected: "Feld akzeptiert",
    },
    {
      index: 2,
      action: "Vier-Augen-Freigabe anfordern",
      expected: "Freigabe-Step erscheint",
    },
  ],
  expectedResults: ["Auszahlung erfolgreich"],
  figmaTraceRefs: [{ screenId: "s-banking", nodeId: "n-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: ["f-iban"],
    coveredActionIds: ["a-submit"],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "auto_approved",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: "1.0.0",
    visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
    cacheHit: false,
    cacheKey: ZERO,
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (
  testCases: readonly GeneratedTestCase[],
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [...testCases],
});

const buildSuccessResult = (content: unknown): LlmGenerationResult => ({
  outcome: "success",
  content,
  finishReason: "stop",
  usage: { inputTokens: 1200, outputTokens: 240 },
  modelDeployment: "gpt-oss-120b-mock",
  modelRevision: "mock-1",
  gatewayRelease: "mock-release",
  attempt: 1,
});

const cleanJudgePayload = {
  verdict: "accept",
  summary: "All cases populate coverage and trace ids correctly.",
  findings: [],
  repairInstructions: [],
};

const buildClient = (responder: () => unknown) =>
  createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "mock-1",
    gatewayRelease: "mock-release",
    responder: () => buildSuccessResult(responder()),
  });

test("logic-judge: happy path → accept verdict and finops attribution to judge_primary", async () => {
  const intent = buildIntent();
  const list = buildList([buildCase()]);
  const finops = createFinOpsUsageRecorder();
  const client = buildClient(() => cleanJudgePayload);

  const result = await runLogicJudge({
    jobId: "job-1",
    intent,
    generatedList: list,
    llmClient: client,
    finopsRecorder: finops,
  });

  assert.equal(result.judgeAccepted, true);
  assert.equal(result.verdict.verdict, "accept");
  assert.equal(
    result.verdict.schemaVersion,
    LOGIC_JUDGE_VERDICT_SCHEMA_VERSION,
  );
  assert.equal(
    result.verdict.promptTemplateVersion,
    LOGIC_JUDGE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(result.verdict.modelBinding, "mock-1");
  assert.deepEqual(result.verdict.repairInstructions, []);

  const sourceSnapshot = finops.sourceSnapshot("job-1", GENERATED_AT);
  const judgePrimary = sourceSnapshot[LOGIC_JUDGE_FINOPS_SOURCE];
  assert.ok(
    judgePrimary !== undefined,
    "judge_primary entry must be present in finops bySource snapshot",
  );
  assert.equal(judgePrimary.callCount, 1);
});

test("logic-judge: empty coveredFieldIds + coveredActionIds downgrades fabricated 'accept' to 'repair'", async () => {
  const intent = buildIntent();
  const broken = buildCase({
    qualitySignals: {
      coveredFieldIds: [],
      coveredActionIds: [],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.5,
    },
  });
  const list = buildList([broken]);
  const finops = createFinOpsUsageRecorder();
  // Model fabricates "accept" — local cross-check must override.
  const client = buildClient(() => ({
    verdict: "accept",
    summary: "looks good to me",
    findings: [],
    repairInstructions: [],
  }));

  const result = await runLogicJudge({
    jobId: "job-1",
    intent,
    generatedList: list,
    llmClient: client,
    finopsRecorder: finops,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.judgeAccepted, false);
  const codes = result.verdict.findings.map((f) => f.code);
  assert.ok(
    codes.includes("coverage_fields_missing"),
    `coverage_fields_missing finding must be present, got ${codes.join(",")}`,
  );
});

test("logic-judge: financial_transaction case missing four-eyes step → repair", async () => {
  const intent = buildIntent();
  const broken = buildCase({
    riskCategory: "financial_transaction",
    steps: [
      { index: 1, action: "IBAN eingeben", expected: "Feld akzeptiert" },
      // No four-eyes / Freigabe step.
      {
        index: 2,
        action: "Direkt Auszahlung absenden",
        expected: "Auszahlung erfolgreich",
      },
    ],
  });
  const list = buildList([broken]);
  const finops = createFinOpsUsageRecorder();
  const client = buildClient(() => ({
    verdict: "accept",
    summary: "missing four-eyes is fine",
    findings: [],
    repairInstructions: [],
  }));

  const result = await runLogicJudge({
    jobId: "job-1",
    intent,
    generatedList: list,
    llmClient: client,
    finopsRecorder: finops,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.ok(
    result.verdict.findings.some((f) => f.code === "banking_four_eyes_missing"),
    "banking_four_eyes_missing finding must be present",
  );
});

test("logic-judge: schema-invalid response → throws LogicJudgeError(judge_response_invalid)", async () => {
  const intent = buildIntent();
  const list = buildList([buildCase()]);
  const finops = createFinOpsUsageRecorder();
  const client = buildClient(() => ({
    // verdict is a banned literal.
    verdict: "totally-fine",
    summary: "x",
    findings: [],
    repairInstructions: [],
  }));

  await assert.rejects(
    runLogicJudge({
      jobId: "job-1",
      intent,
      generatedList: list,
      llmClient: client,
      finopsRecorder: finops,
    }),
    (err) => {
      assert.ok(err instanceof LogicJudgeError);
      assert.equal(err.errorClass, "judge_response_invalid");
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test("logic-judge: model 'reject' verdict → judgeAccepted=false, no upgrade", async () => {
  const intent = buildIntent();
  const list = buildList([buildCase()]);
  const finops = createFinOpsUsageRecorder();
  const client = buildClient(() => ({
    verdict: "reject",
    summary: "fundamental contract break",
    findings: [
      {
        code: "schema_required_field_blank",
        severity: "blocker",
        testCaseId: "tc-aaaaaaaaaaaa",
        reason: "objective string is empty",
      },
    ],
    repairInstructions: [],
  }));

  const result = await runLogicJudge({
    jobId: "job-1",
    intent,
    generatedList: list,
    llmClient: client,
    finopsRecorder: finops,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.judgeAccepted, false);
  assert.equal(result.verdict.findings.length >= 1, true);
});

test("logic-judge: gateway refusal → throws LogicJudgeError(judge_refusal)", async () => {
  const intent = buildIntent();
  const list = buildList([buildCase()]);
  const finops = createFinOpsUsageRecorder();
  const refusing = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "mock-1",
    gatewayRelease: "mock-release",
    staticResponse: {
      outcome: "error",
      errorClass: "refusal",
      message: "model refused under safety policy",
      retryable: false,
      attempt: 1,
    },
  });

  await assert.rejects(
    runLogicJudge({
      jobId: "job-1",
      intent,
      generatedList: list,
      llmClient: refusing,
      finopsRecorder: finops,
    }),
    (err) => {
      assert.ok(err instanceof LogicJudgeError);
      assert.equal(err.errorClass, "judge_refusal");
      return true;
    },
  );
});

test("logic-judge: deterministic prompt hashes for structurally-equal inputs (caching discipline)", async () => {
  const intent = buildIntent();
  const list = buildList([buildCase()]);
  const compiledA = buildCompiledLogicJudgePrompt({
    jobId: "job-1",
    intent,
    generatedList: list,
    modelBinding: "gpt-oss-120b",
  });
  const compiledB = buildCompiledLogicJudgePrompt({
    jobId: "job-1",
    intent,
    generatedList: list,
    modelBinding: "gpt-oss-120b",
  });
  assert.equal(compiledA.hashes.promptHash, compiledB.hashes.promptHash);
  assert.equal(compiledA.hashes.inputHash, compiledB.hashes.inputHash);
  assert.equal(compiledA.hashes.schemaHash, compiledB.hashes.schemaHash);
  assert.equal(compiledA.outputSchemaName, LOGIC_JUDGE_OUTPUT_SCHEMA_NAME);
});

test("logic-judge: response schema enumerates the closed verdict + finding-code surfaces", () => {
  const properties = (LOGIC_JUDGE_RESPONSE_SCHEMA as Record<string, unknown>)
    .properties as Record<string, { enum?: readonly string[] }>;
  assert.deepEqual(
    properties.verdict.enum,
    [...ALLOWED_LOGIC_JUDGE_VERDICTS],
  );
  const findings = (
    properties.findings as { items: { properties: Record<string, { enum?: readonly string[] }> } }
  ).items.properties;
  assert.deepEqual(
    findings.code.enum,
    [...ALLOWED_LOGIC_JUDGE_FINDING_CODES],
  );
});

test("logic-judge: parseLogicJudgeResponse rejects repairInstructions on a non-repair verdict", () => {
  const result = parseLogicJudgeResponse({
    verdict: "accept",
    summary: "ok",
    findings: [],
    repairInstructions: [
      {
        testCaseId: "tc-x",
        mutationKind: "coverage_fields_missing",
        guidance: "fill in fields",
      },
    ],
  });
  assert.equal(result.ok, false);
});

test("logic-judge: faithfulness check flags coveredFieldIds that do not exist in the IR", async () => {
  const intent = buildIntent();
  const ghost = buildCase({
    qualitySignals: {
      coveredFieldIds: ["f-iban", "f-not-in-ir"],
      coveredActionIds: ["a-submit"],
      coveredValidationIds: [],
      coveredNavigationIds: [],
      confidence: 0.9,
    },
  });
  const list = buildList([ghost]);
  const finops = createFinOpsUsageRecorder();
  const client = buildClient(() => ({
    verdict: "accept",
    summary: "ok",
    findings: [],
    repairInstructions: [],
  }));

  const result = await runLogicJudge({
    jobId: "job-1",
    intent,
    generatedList: list,
    llmClient: client,
    finopsRecorder: finops,
  });

  // Local cross-check downgrades to reject (blocker severity for fabricated ids).
  assert.equal(result.verdict.verdict, "reject");
  assert.ok(
    result.verdict.findings.some(
      (f) =>
        f.code === "faithfulness_unknown_field" &&
        f.testCaseId === ghost.id,
    ),
  );
});
