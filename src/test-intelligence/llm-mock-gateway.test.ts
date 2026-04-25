import assert from "node:assert/strict";
import test from "node:test";
import {
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGenerationResult,
} from "../contracts/index.js";
import {
  createMockLlmGatewayClient,
  createMockLlmGatewayClientFromConfig,
} from "./llm-mock-gateway.js";

const visualCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: true,
};

test("mock: default success envelope is deterministic across calls", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
  });
  const r1 = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  const r2 = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(r1.outcome, "success");
  assert.equal(r2.outcome, "success");
  if (r1.outcome === "success" && r2.outcome === "success") {
    // attempt counter increments to make retries observable
    assert.equal(r1.attempt, 1);
    assert.equal(r2.attempt, 2);
    assert.equal(r1.modelDeployment, r2.modelDeployment);
    assert.deepEqual(r1.content, r2.content);
  }
});

test("mock: responder controls outcome", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "rate_limited",
      message: "throttle",
      retryable: true,
      attempt,
    }),
  });
  const result: LlmGenerationResult = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "rate_limited");
    assert.equal(result.attempt, 1);
  }
});

test("mock: image guard rejects payload to test_generation without invoking responder", async () => {
  let invoked = 0;
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    responder: () => {
      invoked += 1;
      return {
        outcome: "success",
        content: {},
        finishReason: "stop",
        usage: {},
        modelDeployment: "x",
        modelRevision: "x",
        gatewayRelease: "x",
        attempt: 1,
      };
    },
  });
  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
    imageInputs: [{ mimeType: "image/png", base64Data: "AA" }],
  });
  assert.equal(invoked, 0);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "image_payload_rejected");
  }
});

test("mock: visual roles accept image payloads", async () => {
  const client = createMockLlmGatewayClient({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: visualCapabilities,
  });
  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
    imageInputs: [{ mimeType: "image/png", base64Data: "AAAAAA" }],
  });
  assert.equal(result.outcome, "success");
  // Recorded request must redact bytes:
  const recorded = client.recordedRequests();
  assert.equal(recorded[0]?.imageInputs?.[0]?.base64Data, "[mock:6b]");
});

test("mock: recordedRequests returns defensive snapshots", async () => {
  const client = createMockLlmGatewayClient({
    role: "visual_primary",
    deployment: "llama-4-maverick-vision",
    modelRevision: "rev",
    gatewayRelease: "rel",
    declaredCapabilities: visualCapabilities,
  });
  await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
    imageInputs: [{ mimeType: "image/png", base64Data: "AAAAAA" }],
  });
  const first = client.recordedRequests();
  first[0]!.imageInputs![0]!.base64Data = "mutated";
  first[0]!.responseSchema = { mutated: true };

  const second = client.recordedRequests();
  assert.equal(second[0]?.imageInputs?.[0]?.base64Data, "[mock:6b]");
  assert.equal(second[0]?.responseSchema, undefined);
});

test("mock: rejects test_generation role declaring imageInputSupport", () => {
  assert.throws(
    () =>
      createMockLlmGatewayClient({
        role: "test_generation",
        deployment: "gpt-oss-120b",
        modelRevision: "rev",
        gatewayRelease: "rel",
        declaredCapabilities: visualCapabilities,
      }),
    RangeError,
  );
});

test("mock: circuit breaker opens after configured transient failures", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 1_000 },
    responder: (_req, attempt) => ({
      outcome: "error",
      errorClass: "transport",
      message: "x",
      retryable: true,
      attempt,
    }),
  });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  const r = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(r.outcome, "error");
  if (r.outcome === "error") {
    assert.equal(r.errorClass, "transport");
    assert.match(r.message, /circuit breaker is open/);
  }
});

test("mock: non-retryable transport failures do not open the circuit breaker", async () => {
  let calls = 0;
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1_000 },
    responder: (_req, attempt) => {
      calls += 1;
      return {
        outcome: "error",
        errorClass: "transport",
        message: "local config failure",
        retryable: false,
        attempt,
      };
    },
  });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
  });
  assert.equal(calls, 2);
  assert.equal(result.outcome, "error");
  assert.equal(client.getCircuitBreaker().getSnapshot().state, "closed");
});

test("mock: retryable flags on non-transient classes do not open the circuit breaker", async () => {
  let calls = 0;
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
    circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1_000 },
    responder: (_req, attempt) => {
      calls += 1;
      return {
        outcome: "error",
        errorClass: "refusal",
        message: "policy",
        retryable: true,
        attempt,
      };
    },
  });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  assert.equal(calls, 2);
  assert.equal(client.getCircuitBreaker().getSnapshot().state, "closed");
});

test("mock: reset clears recorded requests and breaker state", async () => {
  const client = createMockLlmGatewayClient({
    role: "test_generation",
    deployment: "gpt-oss-120b",
    modelRevision: "rev",
    gatewayRelease: "rel",
  });
  await client.generate({ jobId: "j", systemPrompt: "s", userPrompt: "u" });
  client.reset();
  assert.equal(client.callCount(), 0);
  assert.equal(client.recordedRequests().length, 0);
});

test("createMockLlmGatewayClientFromConfig copies identity and config", async () => {
  const config: LlmGatewayClientConfig = {
    role: "visual_fallback",
    compatibilityMode: "openai_chat",
    baseUrl: "https://x/openai/v1",
    deployment: "phi-4-multimodal-poc",
    modelRevision: "rev",
    gatewayRelease: "rel",
    modelWeightsSha256: "a".repeat(64),
    authMode: "api_key",
    declaredCapabilities: visualCapabilities,
    timeoutMs: 5_000,
    maxRetries: 0,
    circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1_000 },
  };
  const client = createMockLlmGatewayClientFromConfig(config);
  assert.equal(client.role, "visual_fallback");
  assert.equal(client.deployment, "phi-4-multimodal-poc");
  assert.equal(client.modelWeightsSha256, "a".repeat(64));
});
