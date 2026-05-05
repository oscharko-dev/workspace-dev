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
      testCaseId: "tc-1",
      title: "Submit a valid investment amount",
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

const resultCallCount = (client: object): number =>
  (client as { callCount?: () => number }).callCount?.() ?? 0;
