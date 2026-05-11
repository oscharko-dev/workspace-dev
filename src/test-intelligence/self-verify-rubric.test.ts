import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS,
  ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
  SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME,
  SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
  SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  type BusinessTestIntentIr,
  type GeneratedTestCase,
  type GeneratedTestCaseList,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type SelfVerifyRubricCaseEvaluation,
} from "../contracts/index.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  aggregateSelfVerifyRubricScores,
  buildSelfVerifyRubricResponseSchema,
  buildSelfVerifyRubricUserPrompt,
  computeSelfVerifyRubricCacheKeyDigest,
  computeSelfVerifyRubricInputHash,
  computeSelfVerifyRubricPromptHash,
  computeSelfVerifyRubricSchemaHash,
  createFileSystemSelfVerifyRubricReplayCache,
  createMemorySelfVerifyRubricReplayCache,
  projectSelfVerifyRubricToTestCaseQualitySignals,
  runSelfVerifyRubricPass,
  validateSelfVerifyRubricResponse,
  writeSelfVerifyRubricReportArtifact,
} from "./self-verify-rubric.js";

const ZERO = "0000000000000000000000000000000000000000000000000000000000000000";
const GENERATED_AT = "2026-04-25T10:00:00.000Z";

const buildCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-1",
  sourceJobId: "job-1",
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  title: "Submit valid form",
  objective: "Submit the form successfully",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "low",
  technique: "use_case",
  preconditions: [],
  testData: [],
  steps: [{ index: 1, action: "Open screen", expected: "Screen visible" }],
  expectedResults: ["Form is submitted"],
  figmaTraceRefs: [{ screenId: "s-1" }],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.9,
  },
  reviewState: "draft",
  audit: {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
    promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    visualSidecarSchemaVersion: "1.0.0",
    cacheHit: false,
    cacheKey: "k",
    inputHash: ZERO,
    promptHash: ZERO,
    schemaHash: ZERO,
  },
  ...overrides,
});

const buildList = (
  cases: ReadonlyArray<GeneratedTestCase>,
): GeneratedTestCaseList => ({
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  jobId: "job-1",
  testCases: [...cases],
});

const buildIntent = (): BusinessTestIntentIr => ({
  version: "1.0.0",
  source: { kind: "figma_local_json", contentHash: ZERO },
  screens: [{ screenId: "s-1", screenName: "Form", trace: { nodeId: "s-1" } }],
  detectedFields: [],
  detectedActions: [],
  detectedValidations: [],
  detectedNavigation: [],
  inferredBusinessObjects: [],
  risks: [],
  assumptions: [],
  openQuestions: [],
  piiIndicators: [],
  redactions: [],
});

const buildPerfectCaseEvaluation = (
  testCaseId: string,
  visualPresent = false,
): Record<string, unknown> => {
  const dimensions = [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
    .sort()
    .map((dimension) => ({ dimension, score: 1 }));
  const evaluation: Record<string, unknown> = {
    testCaseId,
    dimensions,
    citations: [
      { ruleId: "test.synth.default", message: "Synthesized perfect score" },
    ],
  };
  if (visualPresent) {
    evaluation["visualSubscores"] = [
      ...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES,
    ]
      .sort()
      .map((subscore) => ({ subscore, score: 1 }));
  }
  return evaluation;
};

const buildPerfectResponse = (
  ids: ReadonlyArray<string>,
  visualPresent = false,
): { caseEvaluations: Record<string, unknown>[] } => ({
  caseEvaluations: ids.map((id) =>
    buildPerfectCaseEvaluation(id, visualPresent),
  ),
});

const buildPerfectMockClient = (visualPresent = false) =>
  createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: (request): LlmGenerationResult => {
      assert.equal(
        request.responseSchemaName,
        SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
      );
      const ids: string[] = [];
      const re = /"id"\s*:\s*"([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(request.userPrompt)) !== null) {
        const id = match[1];
        if (id !== undefined && !ids.includes(id) && /^tc-/.test(id)) {
          ids.push(id);
        }
      }
      return {
        outcome: "success",
        content: buildPerfectResponse(ids, visualPresent),
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
        modelDeployment: "gpt-oss-120b-mock",
        modelRevision: "rev-1",
        gatewayRelease: "rel-1",
        attempt: 1,
      };
    },
  });

const RUBRIC_BINDING = {
  deployment: "gpt-oss-120b-mock",
  modelRevision: "rev-1",
  gatewayRelease: "rel-1",
};

/* ============================================================== */
/*  Hash + cache key determinism                                   */
/* ============================================================== */

test("rubric prompt hash is deterministic across calls", () => {
  const a = computeSelfVerifyRubricPromptHash();
  const b = computeSelfVerifyRubricPromptHash();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("rubric schema hash is deterministic across calls", () => {
  const a = computeSelfVerifyRubricSchemaHash();
  const b = computeSelfVerifyRubricSchemaHash();
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("rubric input hash binds list + intent + visual together", () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const list2 = buildList([buildCase({ id: "tc-2" })]);
  const intent = buildIntent();
  const a = computeSelfVerifyRubricInputHash({ list, intent });
  const b = computeSelfVerifyRubricInputHash({ list, intent });
  const c = computeSelfVerifyRubricInputHash({ list: list2, intent });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("rubric cache key digest changes when input changes", () => {
  const intent = buildIntent();
  const list = buildList([buildCase({ id: "tc-1" })]);
  const inputHash = computeSelfVerifyRubricInputHash({ list, intent });
  const promptHash = computeSelfVerifyRubricPromptHash();
  const schemaHash = computeSelfVerifyRubricSchemaHash();
  const baseKey = {
    passKind: "self_verify_rubric" as const,
    inputHash,
    promptHash,
    schemaHash,
    modelDeployment: "gpt-oss-120b-mock",
    compatibilityMode: "openai_chat" as const,
    modelRevision: "r",
    gatewayRelease: "g",
    policyBundleVersion: "wave1",
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    rubricSchemaVersion: SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
  };
  const a = computeSelfVerifyRubricCacheKeyDigest(baseKey);
  const b = computeSelfVerifyRubricCacheKeyDigest({
    ...baseKey,
    modelRevision: "different",
  });
  assert.notEqual(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("rubric cache key digest changes when deployment or compatibility changes", () => {
  const intent = buildIntent();
  const list = buildList([buildCase({ id: "tc-1" })]);
  const baseKey = {
    passKind: "self_verify_rubric" as const,
    inputHash: computeSelfVerifyRubricInputHash({ list, intent }),
    promptHash: computeSelfVerifyRubricPromptHash(),
    schemaHash: computeSelfVerifyRubricSchemaHash(),
    modelDeployment: "gpt-oss-120b-mock",
    compatibilityMode: "openai_chat" as const,
    modelRevision: "r",
    gatewayRelease: "g",
    policyBundleVersion: "wave1",
    redactionPolicyVersion: REDACTION_POLICY_VERSION,
    promptTemplateVersion: SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION,
    rubricSchemaVersion: SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
  };
  assert.notEqual(
    computeSelfVerifyRubricCacheKeyDigest(baseKey),
    computeSelfVerifyRubricCacheKeyDigest({
      ...baseKey,
      modelDeployment: "different-deployment",
    }),
  );
  assert.notEqual(
    computeSelfVerifyRubricCacheKeyDigest(baseKey),
    computeSelfVerifyRubricCacheKeyDigest({
      ...baseKey,
      compatibilityMode: "responses_api" as never,
    }),
  );
});

/* ============================================================== */
/*  Validation of malformed responses                              */
/* ============================================================== */

test("rubric validation rejects non-object responses", () => {
  const result = validateSelfVerifyRubricResponse(
    "not-an-object",
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "schema_invalid_response");
  }
});

test("rubric validation rejects responses missing caseEvaluations", () => {
  const result = validateSelfVerifyRubricResponse({}, ["tc-1"], false);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "schema_invalid_response");
  }
});

test("rubric validation rejects out-of-range scores", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [
        {
          testCaseId: "tc-1",
          dimensions: [
            ...[...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
              .slice(0, ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length - 1)
              .map((d) => ({ dimension: d, score: 0.5 })),
            {
              dimension:
                ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS[
                  ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length - 1
                ],
              score: 1.5,
            },
          ],
          citations: [],
        },
      ],
    },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "score_out_of_range");
  }
});

test("rubric validation rejects unexpected testCaseId", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [buildPerfectCaseEvaluation("tc-extra")],
    },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "extra_test_case_score");
  }
});

test("rubric validation rejects duplicate testCaseId", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [
        buildPerfectCaseEvaluation("tc-1"),
        buildPerfectCaseEvaluation("tc-1"),
      ],
    },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "duplicate_test_case_score");
  }
});

test("rubric validation rejects missing testCaseId", () => {
  const result = validateSelfVerifyRubricResponse(
    { caseEvaluations: [] },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "missing_test_case_score");
  }
});

test("rubric validation rejects visualSubscores when no visual was supplied", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [buildPerfectCaseEvaluation("tc-1", true)],
    },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
});

test("rubric validation accepts visualSubscores when visual was supplied", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [buildPerfectCaseEvaluation("tc-1", true)],
    },
    ["tc-1"],
    true,
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.caseEvaluations.length, 1);
    assert.equal(result.caseEvaluations[0]?.rubricScore, 1);
    assert.equal(result.caseEvaluations[0]?.visualSubscores?.length, 4);
  }
});

test("rubric validation requires complete dimension set", () => {
  const result = validateSelfVerifyRubricResponse(
    {
      caseEvaluations: [
        {
          testCaseId: "tc-1",
          dimensions: [{ dimension: "schema_conformance", score: 1 }],
          citations: [],
        },
      ],
    },
    ["tc-1"],
    false,
  );
  assert.equal(result.ok, false);
});

/* ============================================================== */
/*  Aggregation                                                    */
/* ============================================================== */

test("aggregate produces job-level mean and per-dimension means", () => {
  const evaluations: SelfVerifyRubricCaseEvaluation[] = [
    {
      testCaseId: "tc-1",
      dimensions: [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
        .sort()
        .map((d) => ({ dimension: d, score: 1 })),
      citations: [],
      rubricScore: 1,
    },
    {
      testCaseId: "tc-2",
      dimensions: [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
        .sort()
        .map((d) => ({ dimension: d, score: 0.5 })),
      citations: [],
      rubricScore: 0.5,
    },
  ];
  const aggregate = aggregateSelfVerifyRubricScores(evaluations);
  assert.equal(aggregate.jobLevelRubricScore, 0.75);
  assert.equal(
    aggregate.dimensionScores.length,
    ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS.length,
  );
  for (const d of aggregate.dimensionScores) {
    assert.equal(d.score, 0.75);
  }
  assert.equal(aggregate.visualSubscores, undefined);
});

test("aggregate includes visualSubscores when any case has them", () => {
  const evaluations: SelfVerifyRubricCaseEvaluation[] = [
    {
      testCaseId: "tc-1",
      dimensions: [...ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS]
        .sort()
        .map((d) => ({ dimension: d, score: 1 })),
      visualSubscores: [...ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES]
        .sort()
        .map((s) => ({ subscore: s, score: 0.5 })),
      citations: [],
      rubricScore: 0.75,
    },
  ];
  const aggregate = aggregateSelfVerifyRubricScores(evaluations);
  assert.equal(
    aggregate.visualSubscores?.length,
    ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES.length,
  );
  for (const s of aggregate.visualSubscores ?? []) {
    assert.equal(s.score, 0.5);
  }
});

test("aggregate over empty list returns zero job score and zero dimensions", () => {
  const aggregate = aggregateSelfVerifyRubricScores([]);
  assert.equal(aggregate.jobLevelRubricScore, 0);
  for (const d of aggregate.dimensionScores) {
    assert.equal(d.score, 0);
  }
});

/* ============================================================== */
/*  projectSelfVerifyRubricToTestCaseQualitySignals                 */
/* ============================================================== */

test("projectSelfVerifyRubricToTestCaseQualitySignals emits a sorted per-case list", () => {
  const evaluations: SelfVerifyRubricCaseEvaluation[] = [
    {
      testCaseId: "tc-2",
      dimensions: [],
      citations: [],
      rubricScore: 0.4,
    },
    {
      testCaseId: "tc-1",
      dimensions: [],
      citations: [],
      rubricScore: 0.876543212,
    },
  ];
  const signals = projectSelfVerifyRubricToTestCaseQualitySignals(evaluations);
  assert.equal(signals.length, 2);
  assert.equal(signals[0]?.testCaseId, "tc-1");
  assert.equal(signals[0]?.rubricScore, 0.876543);
  assert.equal(signals[1]?.testCaseId, "tc-2");
  assert.equal(signals[1]?.rubricScore, 0.4);
});

/* ============================================================== */
/*  runSelfVerifyRubricPass — happy path + cache + refusal         */
/* ============================================================== */

test("runSelfVerifyRubricPass scores every test case on the happy path", async () => {
  const list = buildList([
    buildCase({ id: "tc-1" }),
    buildCase({ id: "tc-2" }),
  ]);
  const intent = buildIntent();
  const client = buildPerfectMockClient(false);
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.equal(result.report.refusal, undefined);
  assert.equal(result.report.caseEvaluations.length, 2);
  assert.equal(result.report.aggregate.jobLevelRubricScore, 1);
  assert.equal(result.cacheHit, false);
  assert.equal(result.caseQualitySignals.length, 2);
  for (const signal of result.caseQualitySignals) {
    assert.equal(signal.rubricScore, 1);
  }
});

test("runSelfVerifyRubricPass cache hit skips the LLM call", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const cache = createMemorySelfVerifyRubricReplayCache();
  const client = buildPerfectMockClient(false);

  const first = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
    cache,
  });
  assert.equal(first.cacheHit, false);
  assert.equal(client.callCount(), 1);

  const second = await runSelfVerifyRubricPass({
    jobId: "job-2", // same input → same cache key — jobId is stamped post-restore
    generatedAt: "2026-04-25T10:30:00.000Z",
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
    cache,
  });
  assert.equal(second.cacheHit, true);
  // The LLM was never called the second time
  assert.equal(client.callCount(), 1);
  assert.equal(second.report.cacheHit, true);
  assert.equal(second.report.jobId, "job-2");
});

test("runSelfVerifyRubricPass refuses when the gateway returns an error", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: () => ({
      outcome: "error",
      errorClass: "transport",
      message: "simulated gateway transport error",
      retryable: false,
      attempt: 1,
    }),
  });
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.equal(result.report.refusal?.code, "gateway_failure");
  assert.equal(result.report.caseEvaluations.length, 0);
  assert.equal(result.caseQualitySignals.length, 0);
});

test("runSelfVerifyRubricPass refuses when client uses a non-test_generation role", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const client = createMockLlmGatewayClient({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    modelRevision: "rev-v",
    gatewayRelease: "rel-v",
    declaredCapabilities: {
      structuredOutputs: true,
      seedSupport: true,
      reasoningEffortSupport: false,
      maxOutputTokensSupport: true,
      streamingSupport: false,
      imageInputSupport: true,
    },
  });
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.equal(result.report.refusal?.code, "image_payload_attempted");
});

test("runSelfVerifyRubricPass refuses before LLM call when model binding mismatches client", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const client = buildPerfectMockClient(false);
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: { ...RUBRIC_BINDING, modelRevision: "different-rev" },
  });
  assert.equal(result.report.refusal?.code, "model_binding_mismatch");
  assert.equal(client.callCount(), 0);
});

test("runSelfVerifyRubricPass refuses non-openai_chat compatibility before LLM call", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    compatibilityMode: "responses_api" as never,
  });
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.equal(result.report.refusal?.code, "model_binding_mismatch");
  assert.equal(client.callCount(), 0);
});

test("runSelfVerifyRubricPass redacts secret-like substrings from refusal messages", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const leakyToken =
    "sk-ant-api01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // pragma: allowlist secret
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: () => ({
      outcome: "error",
      errorClass: "transport",
      message: `gateway leaked token ${leakyToken} in error path`,
      retryable: false,
      attempt: 1,
    }),
  });
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  const refusalMessage = result.report.refusal?.message ?? "";
  assert.equal(refusalMessage.includes(leakyToken), false);
});

test("runSelfVerifyRubricPass refuses on schema_invalid_response when content shape is wrong", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: () => ({
      outcome: "success",
      content: { unexpected: "shape" },
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0 },
      modelDeployment: "gpt-oss-120b-mock",
      modelRevision: "rev-1",
      gatewayRelease: "rel-1",
      attempt: 1,
    }),
  });
  const result = await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.equal(result.report.refusal?.code, "schema_invalid_response");
});

/* ============================================================== */
/*  Filesystem cache + persistence                                 */
/* ============================================================== */

test("filesystem rubric cache round-trips a stored entry", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rubric-fs-cache-"));
  try {
    const cache = createFileSystemSelfVerifyRubricReplayCache(tempRoot);
    const list = buildList([buildCase({ id: "tc-1" })]);
    const intent = buildIntent();
    const client = buildPerfectMockClient(false);

    const first = await runSelfVerifyRubricPass({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list,
      intent,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      policyBundleVersion: "wave1",
      client,
      modelBinding: RUBRIC_BINDING,
      cache,
    });
    assert.equal(first.cacheHit, false);

    // Re-build a fresh client to prove the second call avoids invocation.
    const otherClient = createMockLlmGatewayClient({
      role: "test_generation",
      deployment: "gpt-oss-120b-mock",
      modelRevision: "rev-1",
      gatewayRelease: "rel-1",
      responder: () => {
        throw new Error("LLM should not be called on cache hit");
      },
    });
    const second = await runSelfVerifyRubricPass({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list,
      intent,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      policyBundleVersion: "wave1",
      client: otherClient,
      modelBinding: RUBRIC_BINDING,
      cache,
    });
    assert.equal(second.cacheHit, true);
    assert.equal(otherClient.callCount(), 0);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("writeSelfVerifyRubricReportArtifact emits canonical JSON under testcases/", async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "rubric-write-"));
  try {
    const list = buildList([buildCase({ id: "tc-1" })]);
    const intent = buildIntent();
    const client = buildPerfectMockClient(false);
    const result = await runSelfVerifyRubricPass({
      jobId: "job-1",
      generatedAt: GENERATED_AT,
      list,
      intent,
      policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
      policyBundleVersion: "wave1",
      client,
      modelBinding: RUBRIC_BINDING,
    });
    const written = await writeSelfVerifyRubricReportArtifact({
      report: result.report,
      runDir: tempRoot,
    });
    assert.match(
      written.artifactPath,
      new RegExp(`testcases/${SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME}$`),
    );
    const raw = await readFile(written.artifactPath, "utf8");
    const parsed = JSON.parse(raw) as { schemaVersion: string };
    assert.equal(
      parsed.schemaVersion,
      SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/* ============================================================== */
/*  Prompt + schema sanity                                         */
/* ============================================================== */

test("rubric response schema enforces full dimension list", () => {
  const schema = buildSelfVerifyRubricResponseSchema();
  const props = (schema as { properties: Record<string, unknown> }).properties;
  assert.ok(props["caseEvaluations"]);
});

test("rubric user prompt embeds the test case ids", () => {
  const list = buildList([
    buildCase({ id: "tc-alpha" }),
    buildCase({ id: "tc-beta" }),
  ]);
  const prompt = buildSelfVerifyRubricUserPrompt({
    list,
    intent: buildIntent(),
  });
  assert.ok(prompt.includes("tc-alpha"));
  assert.ok(prompt.includes("tc-beta"));
});

test("rubric user prompt redacts secret-like strings before the gateway call", () => {
  const secret = "sk-ant-api01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // pragma: allowlist secret
  const list = buildList([
    buildCase({
      id: "tc-secret",
      testData: [`apiKey=${secret}`],
      expectedResults: [`Authorization: Bearer ${secret}`],
    }),
  ]);
  const prompt = buildSelfVerifyRubricUserPrompt({
    list,
    intent: buildIntent(),
    visual: [
      {
        screenId: "s-1",
        sidecarDeployment: "mock",
        regions: [
          {
            regionId: "r-1",
            confidence: 0.9,
            visibleText: `Token ${secret}`,
          },
        ],
        confidenceSummary: { min: 0.9, max: 0.9, mean: 0.9 },
      },
    ],
  });
  assert.equal(prompt.includes(secret), false);
  assert.ok(prompt.includes("[REDACTED]"));
});

test("rubric request never carries imageInputs (image-payload guarantee)", async () => {
  const list = buildList([buildCase({ id: "tc-1" })]);
  const intent = buildIntent();
  let captured: LlmGenerationRequest | undefined;
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b-mock",
    modelRevision: "rev-1",
    gatewayRelease: "rel-1",
    responder: (request) => {
      captured = request;
      return {
        outcome: "success",
        content: buildPerfectResponse(["tc-1"], false),
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0 },
        modelDeployment: "gpt-oss-120b-mock",
        modelRevision: "rev-1",
        gatewayRelease: "rel-1",
        attempt: 1,
      };
    },
  });
  await runSelfVerifyRubricPass({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    list,
    intent,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyBundleVersion: "wave1",
    client,
    modelBinding: RUBRIC_BINDING,
  });
  assert.ok(captured !== undefined);
  assert.equal(captured?.imageInputs, undefined);
  assert.equal(
    captured?.responseSchemaName,
    SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME,
  );
});
