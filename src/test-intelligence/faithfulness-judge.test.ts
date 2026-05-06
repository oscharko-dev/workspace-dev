import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  type LlmGatewayCapabilities,
  type VisualSidecarCaptureInput,
} from "../contracts/index.js";
import { createMockLlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import {
  createMemoryFaithfulnessJudgeCache,
  runFaithfulnessJudge,
} from "./faithfulness-judge.js";

const PNG_BASE64 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
).toString("base64");

const VISUAL_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: true,
};

const SAMPLE_CAPTURES: ReadonlyArray<VisualSidecarCaptureInput> = [
  {
    screenId: "1:1",
    screenName: "Loan form",
    mimeType: "image/png",
    base64Data: PNG_BASE64,
  },
];

const SAMPLE_CASE_SET = {
  testCases: [
    {
      id: "tc-1",
      title: "Submit a valid investment amount",
    },
  ],
};

const TWO_CASE_SET = {
  testCases: [
    {
      id: "tc-1",
      title: "Submit a valid investment amount",
    },
    {
      id: "tc-2",
      title: "Reject an invalid investment amount",
    },
  ],
};

test("runFaithfulnessJudge happy path emits an accept verdict on the primary model", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-happy",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.cacheHit, false);
  assert.equal(
    result.verdict.schemaVersion,
    FAITHFULNESS_VERDICT_SCHEMA_VERSION,
  );
  assert.equal(
    result.verdict.contractVersion,
    TEST_INTELLIGENCE_CONTRACT_VERSION,
  );
  assert.equal(
    result.verdict.promptTemplateVersion,
    FAITHFULNESS_JUDGE_PROMPT_TEMPLATE_VERSION,
  );
  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.score, 1);
  assert.equal(result.verdict.fallbackReason, "none");
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 1);
});

test("runFaithfulnessJudge surfaces a hallucination-driven repair verdict", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              message: "The button described in the step is not visible.",
            },
          ],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-hallucination",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.match(
    result.verdict.hallucinations[0]?.message ?? "",
    /not visible/u,
  );
});

test("runFaithfulnessJudge falls back when the primary response is invalid", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { nope: true },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 4 },
        modelDeployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-fallback",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "accept");
  assert.equal(result.verdict.score, 1);
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.attempts.length, 2);
});

test("runFaithfulnessJudge reuses the replay cache on the second invocation", async () => {
  const cache = createMemoryFaithfulnessJudgeCache();
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "accept",
          hallucinations: [],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const first = await runFaithfulnessJudge({
    jobId: "faithfulness-cache",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    cache,
  });
  const second = await runFaithfulnessJudge({
    jobId: "faithfulness-cache",
    generatedAt: "2026-05-05T10:01:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    cache,
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.verdict.cacheHit, true);
  assert.equal(resultCallCount(bundle.visualPrimary), 1);
  assert.equal(resultCallCount(bundle.visualFallback), 0);
});

test("runFaithfulnessJudge surfaces a label-mismatch repair verdict from the primary model", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [],
          mismatches: [
            {
              testCaseId: "tc-1",
              stepIndex: 1,
              expectedLabel: "Sicherheiten verwalten",
              visibleLabel: "Sicherheiten anlegen",
              message: "The visible label differs from the generated step label.",
            },
          ],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-mismatch",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "repair");
  assert.equal(result.verdict.score, 0);
  assert.deepEqual(result.verdict.hallucinations, []);
  assert.equal(result.verdict.mismatches.length, 1);
  assert.equal(
    result.verdict.mismatches[0]?.expectedLabel,
    "Sicherheiten verwalten",
  );
  assert.equal(
    result.verdict.mismatches[0]?.visibleLabel,
    "Sicherheiten anlegen",
  );
  assert.equal(result.attempts.length, 1);
  assert.equal(resultCallCount(bundle.visualFallback), 0);
});

test("runFaithfulnessJudge derives score from the share of cases without cross-modal findings", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: {
          verdict: "repair",
          hallucinations: [
            {
              testCaseId: "tc-1",
              stepIndex: 2,
              message: "The CTA is not visible on the screenshot.",
            },
          ],
          mismatches: [],
        },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-score",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: TWO_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.score, 0.5);
});

test("runFaithfulnessJudge emits a refusal when both gateways reject the image payload", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, _attempt) => ({
        outcome: "error",
        errorClass: "image_payload_rejected",
        message: "primary refused decoded screenshot payload",
        retryable: false,
        attempt: 0,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, _attempt) => ({
        outcome: "error",
        errorClass: "image_payload_rejected",
        message: "fallback refused decoded screenshot payload",
        retryable: false,
        attempt: 0,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-image-fail",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.verdict.refusal?.code, "image_payload_rejected");
  assert.match(
    result.verdict.refusal?.message ?? "",
    /fallback refused decoded screenshot payload/u,
  );
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.equal(result.verdict.hallucinations[0]?.testCaseId, "$job");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 2);
});

test("runFaithfulnessJudge emits a refusal when both gateways exceed the input-token budget", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, _attempt) => ({
        outcome: "error",
        errorClass: "input_budget_exceeded",
        message: "primary input-token budget exceeded",
        retryable: false,
        attempt: 0,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, _attempt) => ({
        outcome: "error",
        errorClass: "input_budget_exceeded",
        message: "fallback input-token budget exceeded",
        retryable: false,
        attempt: 0,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-token-limit",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
    maxInputTokens: 16,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.refusal?.code, "input_budget_exceeded");
  assert.match(result.verdict.refusal?.message ?? "", /input/iu);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0]?.role, "visual_primary");
  assert.equal(result.attempts[1]?.result.outcome, "error");
  if (result.attempts[1]?.result.outcome === "error") {
    assert.equal(
      result.attempts[1]?.result.errorClass,
      "input_budget_exceeded",
    );
  }
  assert.equal(result.attempts[1]?.role, "visual_fallback");
});

test("runFaithfulnessJudge emits a schema-invalid refusal when both responses fail validation", async () => {
  const bundle = createMockLlmGatewayClientBundle({
    testGeneration: {
      role: "test_generation",
      deployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@test",
      gatewayRelease: "mock",
    },
    visualPrimary: {
      role: "visual_primary",
      deployment: "mistral-document-ai-2512",
      modelRevision: "mistral-document-ai-2512@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { verdict: "definitely-not-a-label" },
        finishReason: "stop",
        usage: { inputTokens: 9, outputTokens: 5 },
        modelDeployment: "mistral-document-ai-2512",
        modelRevision: "mistral-document-ai-2512@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
    visualFallback: {
      role: "visual_fallback",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@test",
      gatewayRelease: "mock",
      declaredCapabilities: VISUAL_CAPS,
      responder: (_request, attempt) => ({
        outcome: "success",
        content: { hallucinations: "not an array" },
        finishReason: "stop",
        usage: { inputTokens: 7, outputTokens: 4 },
        modelDeployment: "llama-4-maverick-vision",
        modelRevision: "llama-4-maverick-vision@test",
        gatewayRelease: "mock",
        attempt,
      }),
    },
  });

  const result = await runFaithfulnessJudge({
    jobId: "faithfulness-schema-refusal",
    generatedAt: "2026-05-05T10:00:00Z",
    captures: SAMPLE_CAPTURES,
    generatedTestCases: SAMPLE_CASE_SET,
    bundle,
  });

  assert.equal(result.verdict.verdict, "reject");
  assert.equal(result.verdict.score, 0);
  assert.equal(result.verdict.refusal?.code, "schema_invalid_response");
  assert.equal(result.verdict.modelDeployment, "llama-4-maverick-vision");
  assert.equal(result.verdict.fallbackReason, "primary_unavailable");
  assert.equal(result.verdict.hallucinations.length, 1);
  assert.equal(result.verdict.hallucinations[0]?.testCaseId, "$job");
  assert.deepEqual(result.verdict.mismatches, []);
  assert.equal(result.attempts.length, 2);
});

const resultCallCount = (client: object): number =>
  (client as { callCount?: () => number }).callCount?.() ?? 0;
