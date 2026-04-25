import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_LLM_GATEWAY_ERROR_CLASSES,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGenerationRequest,
} from "../contracts/index.js";
import {
  createLlmGatewayClient,
  isLlmGatewayErrorRetryable,
  LLM_GATEWAY_ERROR_CLASSES,
  LlmGatewayError,
} from "./llm-gateway.js";

const baseCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const visualCapabilities: LlmGatewayCapabilities = {
  ...baseCapabilities,
  imageInputSupport: true,
};

const baseConfig: LlmGatewayClientConfig = {
  role: "test_generation",
  compatibilityMode: "openai_chat",
  baseUrl: "https://example.cognitiveservices.azure.com/openai/v1",
  deployment: "gpt-oss-120b",
  modelRevision: "gpt-oss-120b@2026-04-25",
  gatewayRelease: "azure-ai-foundry@2026.04",
  authMode: "api_key",
  declaredCapabilities: baseCapabilities,
  timeoutMs: 5_000,
  maxRetries: 2,
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 1_000 },
};

const sampleRequest = (
  overrides: Partial<LlmGenerationRequest> = {},
): LlmGenerationRequest => ({
  jobId: "job-1",
  systemPrompt: "system",
  userPrompt: "user",
  responseSchema: {
    type: "object",
    properties: { ack: { type: "string" } },
    required: ["ack"],
  },
  responseSchemaName: "probe.v1",
  ...overrides,
});

const okJsonResponse = (body: unknown, status = 200): Response => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const buildChoiceBody = (
  contentJson: unknown,
  finish: string = "stop",
): Record<string, unknown> => ({
  choices: [
    {
      finish_reason: finish,
      message: { role: "assistant", content: JSON.stringify(contentJson) },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

test("config validation: rejects test_generation with imageInputSupport", () => {
  assert.throws(
    () =>
      createLlmGatewayClient({
        ...baseConfig,
        declaredCapabilities: visualCapabilities,
      }),
    RangeError,
  );
});

test("config validation: rejects empty deployment / bad sha", () => {
  assert.throws(
    () => createLlmGatewayClient({ ...baseConfig, deployment: "" }),
    RangeError,
  );
  assert.throws(
    () =>
      createLlmGatewayClient({
        ...baseConfig,
        modelWeightsSha256: "not-a-sha",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      createLlmGatewayClient({
        ...baseConfig,
        modelWeightsSha256: "A".repeat(64),
      }),
    /lowercase hex/,
  );
});

test("LlmGatewayError discriminates errorClass / retryable / attempt", () => {
  const err = new LlmGatewayError({
    errorClass: "rate_limited",
    message: "x",
    retryable: true,
    attempt: 2,
  });
  assert.equal(err.errorClass, "rate_limited");
  assert.equal(err.retryable, true);
  assert.equal(err.attempt, 2);
  assert.equal(err.name, "LlmGatewayError");
  assert.ok(err instanceof Error);
});

test("LLM_GATEWAY_ERROR_CLASSES set contains all allowed classes", () => {
  for (const cls of ALLOWED_LLM_GATEWAY_ERROR_CLASSES) {
    assert.ok(LLM_GATEWAY_ERROR_CLASSES.has(cls));
  }
});

test("isLlmGatewayErrorRetryable: only transient classes retry", () => {
  assert.equal(isLlmGatewayErrorRetryable("timeout"), true);
  assert.equal(isLlmGatewayErrorRetryable("transport"), true);
  assert.equal(isLlmGatewayErrorRetryable("rate_limited"), true);
  assert.equal(isLlmGatewayErrorRetryable("refusal"), false);
  assert.equal(isLlmGatewayErrorRetryable("schema_invalid"), false);
  assert.equal(isLlmGatewayErrorRetryable("incomplete"), false);
  assert.equal(isLlmGatewayErrorRetryable("image_payload_rejected"), false);
});

test("guards image payloads on test_generation role without making a network call", async () => {
  let calls = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse({});
    },
    apiKeyProvider: () => "secret-key-value",
  });
  const result = await client.generate(
    sampleRequest({
      imageInputs: [{ mimeType: "image/png", base64Data: "AA" }],
    }),
  );
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "image_payload_rejected");
    assert.equal(result.retryable, false);
  }
  assert.equal(calls, 0);
});

test("guards oversized input budgets before making a network call", async () => {
  let calls = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse({});
    },
    apiKeyProvider: () => "secret-key-value",
  });

  const result = await client.generate(
    sampleRequest({
      userPrompt: "word ".repeat(20_000),
      maxInputTokens: 100,
    }),
  );

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /maxInputTokens/);
  }
  assert.equal(calls, 0);
});

test("response-size ceiling rejects oversized gateway bodies before JSON parsing", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(1024 * 1024 + 1),
        },
      }),
    apiKeyProvider: () => "secret-key-value",
  });

  const result = await client.generate(sampleRequest());

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /response body exceeds/);
    assert.equal(result.retryable, false);
  }
});

test("structured-output success: parses JSON content and strips raw text", async () => {
  const fetchImpl: typeof fetch = async () =>
    okJsonResponse(buildChoiceBody({ ack: "ok" }));
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl,
    apiKeyProvider: () => "k",
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.deepEqual(result.content, { ack: "ok" });
    assert.equal(result.rawTextContent, undefined);
    assert.equal(result.finishReason, "stop");
    assert.equal(result.modelDeployment, "gpt-oss-120b");
    assert.equal(result.attempt, 1);
    assert.equal(result.usage.inputTokens, 10);
    assert.equal(result.usage.outputTokens, 5);
  }
});

test("plain-text success is allowed when no response schema is requested", async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async (_url, init) => {
      observedBody = init?.body as string | undefined;
      return okJsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "plain text probe ok" },
          },
        ],
      });
    },
    apiKeyProvider: () => "k",
  });
  const result = await client.generate({
    jobId: "job-1",
    systemPrompt: "system",
    userPrompt: "user",
  });
  assert.equal(observedBody?.includes("response_format"), false);
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.content, "plain text probe ok");
    assert.equal(result.rawTextContent, "plain text probe ok");
  }
});

test("forwards api-key header from provider; never echoes it back", async () => {
  let observedHeaders: Headers | undefined;
  const fetchImpl: typeof fetch = async (_url, init) => {
    observedHeaders = new Headers(init?.headers);
    return okJsonResponse(buildChoiceBody({ ack: "ok" }));
  };
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl,
    apiKeyProvider: () => "supersecret-token-1234567890",
  });
  const result = await client.generate(sampleRequest());
  assert.equal(observedHeaders?.get("api-key"), "supersecret-token-1234567890");
  assert.equal(result.outcome, "success");
  // The token must never appear in the result envelope JSON.
  const dumped = JSON.stringify(result);
  assert.equal(dumped.includes("supersecret-token"), false);
});

test("bearer auth mode uses Authorization: Bearer header", async () => {
  let observed: Headers | undefined;
  const client = createLlmGatewayClient(
    { ...baseConfig, authMode: "bearer_token" },
    {
      fetchImpl: async (_u, init) => {
        observed = new Headers(init?.headers);
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "abc.def.ghi",
    },
  );
  await client.generate(sampleRequest());
  assert.equal(observed?.get("authorization"), "Bearer abc.def.ghi");
  assert.equal(observed?.get("api-key"), null);
});

test("none auth mode: no auth headers attached", async () => {
  let observed: Headers | undefined;
  const client = createLlmGatewayClient(
    { ...baseConfig, authMode: "none" },
    {
      fetchImpl: async (_u, init) => {
        observed = new Headers(init?.headers);
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
    },
  );
  await client.generate(sampleRequest());
  assert.equal(observed?.get("api-key"), null);
  assert.equal(observed?.get("authorization"), null);
});

test("api_key mode without apiKeyProvider returns transport error and never calls fetch", async () => {
  let calls = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse({});
    },
  });
  const result = await client.generate(sampleRequest());
  assert.equal(calls, 0);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "transport");
    assert.equal(result.retryable, false);
  }
});

test("non-retryable auth failures do not open the circuit breaker", async () => {
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      circuitBreaker: { failureThreshold: 1, resetTimeoutMs: 1_000 },
    },
    {
      fetchImpl: async () => okJsonResponse({}),
    },
  );
  const first = await client.generate(sampleRequest());
  const second = await client.generate(sampleRequest());
  assert.equal(first.outcome, "error");
  assert.equal(second.outcome, "error");
  if (second.outcome === "error") {
    assert.equal(second.errorClass, "transport");
    assert.match(second.message, /apiKeyProvider/);
  }
  assert.equal(client.getCircuitBreaker().getSnapshot().state, "closed");
});

test("apiKeyProvider returning empty string is rejected", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => okJsonResponse({}),
    apiKeyProvider: () => "",
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
});

test("rate-limited 429 surfaces rate_limited and retries", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("rate limit", { status: 429 });
      }
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });
  const result = await client.generate(sampleRequest());
  assert.equal(attempts, 3);
  assert.equal(result.outcome, "success");
  if (result.outcome === "success") {
    assert.equal(result.attempt, 3);
  }
});

test("oversized 429 body preserves rate_limited retry classification", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("ignored", {
          status: 429,
          headers: { "content-length": String(1024 * 1024 + 1) },
        });
      }
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });

  const result = await client.generate(sampleRequest());

  assert.equal(attempts, 3);
  assert.equal(result.outcome, "success");
});

test("5xx surfaces transport-class and retries up to max", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      return new Response("boom", { status: 503 });
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });
  const result = await client.generate(sampleRequest());
  assert.equal(attempts, baseConfig.maxRetries + 1);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "transport");
    assert.equal(result.retryable, true);
    assert.equal(result.attempt, baseConfig.maxRetries + 1);
  }
});

test("oversized 5xx body preserves transport retry classification", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      return new Response("ignored", {
        status: 503,
        headers: { "content-length": String(1024 * 1024 + 1) },
      });
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });

  const result = await client.generate(sampleRequest());

  assert.equal(attempts, 3);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "transport");
    assert.equal(result.retryable, true);
  }
});

test("4xx body surfaces schema_invalid and does NOT retry", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(attempts, 1);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.equal(result.retryable, false);
  }
});

test("content_filter finish_reason maps to refusal and does NOT retry", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      return okJsonResponse({
        choices: [{ finish_reason: "content_filter", message: {} }],
      });
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(attempts, 1);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "refusal");
    assert.equal(result.retryable, false);
  }
});

test("explicit message.refusal field maps to refusal", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      okJsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: { refusal: "I cannot help with that." },
          },
        ],
      }),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "refusal");
  }
});

test("length finish_reason maps to incomplete", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      okJsonResponse(buildChoiceBody({ ack: "ok" }, "length")),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "incomplete");
    assert.equal(result.retryable, false);
  }
});

test("tool_calls finish_reason returns an explicit unsupported response", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      okJsonResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: { role: "assistant", content: null, tool_calls: [] },
          },
        ],
      }),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /tool-call responses are not supported/);
    assert.equal(result.retryable, false);
  }
});

test("non-JSON content body surfaces schema_invalid", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      okJsonResponse({
        choices: [
          { finish_reason: "stop", message: { content: "not-a-json-object" } },
        ],
      }),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
  }
});

test("valid JSON that violates response schema surfaces schema_invalid", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => okJsonResponse(buildChoiceBody({ nope: "wrong" })),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /violates response schema/);
    assert.match(result.message, /\.ack is required/);
    assert.equal(result.retryable, false);
  }
});

test("response missing choices surfaces schema_invalid", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => okJsonResponse({}),
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
  }
});

test("AbortError-class fetch failure becomes timeout error", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
  }
});

test("fetch throwing non-abort error becomes transport error and retries", async () => {
  let attempts = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      throw new Error("network unreachable");
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });
  const result = await client.generate(sampleRequest());
  assert.equal(attempts, baseConfig.maxRetries + 1);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "transport");
  }
});

test("token-shaped strings in error messages are redacted", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      throw new Error(
        "boom Authorization: Bearer leaky-secret-1234567890abcdef ; cause=x",
      );
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.message.includes("leaky-secret"), false);
    assert.equal(result.message.includes("[REDACTED]"), true);
  }
});

test("circuit breaker opens after enough transient failures and short-circuits subsequent requests", async () => {
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      maxRetries: 0,
      circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 1_000 },
    },
    {
      fetchImpl: async () => new Response("oops", { status: 503 }),
      apiKeyProvider: () => "k",
      sleep: async () => undefined,
    },
  );
  const r1 = await client.generate(sampleRequest());
  assert.equal(r1.outcome, "error");
  const r2 = await client.generate(sampleRequest());
  assert.equal(r2.outcome, "error");
  // Now breaker should be open
  const r3 = await client.generate(sampleRequest());
  assert.equal(r3.outcome, "error");
  if (r3.outcome === "error") {
    assert.equal(r3.errorClass, "transport");
    assert.match(r3.message, /circuit breaker is open/);
  }
});

test("structured outputs flag drives response_format inclusion", async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      declaredCapabilities: { ...baseCapabilities, structuredOutputs: false },
    },
    {
      fetchImpl: async (_u, init) => {
        observedBody = init?.body as string | undefined;
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  await client.generate(sampleRequest());
  assert.ok(observedBody);
  assert.equal(observedBody?.includes("response_format"), false);
});

test("URL composition preserves trailing-slash baseUrl and adds chat/completions", async () => {
  let observedUrl: string | undefined;
  const client = createLlmGatewayClient(
    { ...baseConfig, baseUrl: "https://example.com/openai/v1/" },
    {
      fetchImpl: async (url) => {
        observedUrl = String(url);
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  await client.generate(sampleRequest());
  assert.match(
    observedUrl ?? "",
    /\/openai\/v1\/chat\/completions$/,
  );
  assert.equal((observedUrl ?? "").includes("?model="), false);
});

test("visual sidecar role accepts image payloads", async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      role: "visual_primary",
      deployment: "llama-4-maverick-vision",
      modelRevision: "llama-4-maverick-vision@2026-04-25",
      declaredCapabilities: visualCapabilities,
    },
    {
      fetchImpl: async (_u, init) => {
        observedBody = init?.body as string | undefined;
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  const result = await client.generate(
    sampleRequest({
      imageInputs: [{ mimeType: "image/png", base64Data: "AAAA" }],
    }),
  );
  assert.equal(result.outcome, "success");
  assert.match(observedBody ?? "", /image_url/);
  assert.match(observedBody ?? "", /data:image\/png;base64,AAAA/);
});

test("seed, reasoning_effort, and max_output_tokens flags only forward when declared", async () => {
  const observedBodies: string[] = [];
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      declaredCapabilities: {
        ...baseCapabilities,
        reasoningEffortSupport: false,
      },
    },
    {
      fetchImpl: async (_u, init) => {
        observedBodies.push(init?.body as string);
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  await client.generate(
    sampleRequest({ seed: 42, reasoningEffort: "high", maxOutputTokens: 256 }),
  );
  assert.equal(observedBodies[0]?.includes('"seed":42'), true);
  assert.equal(
    observedBodies[0]?.includes('"max_completion_tokens":256'),
    true,
  );
  assert.equal(observedBodies[0]?.includes("reasoning_effort"), false);

  const noMaxOutputTokensClient = createLlmGatewayClient(
    {
      ...baseConfig,
      declaredCapabilities: {
        ...baseCapabilities,
        maxOutputTokensSupport: false,
      },
    },
    {
      fetchImpl: async (_u, init) => {
        observedBodies.push(init?.body as string);
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  await noMaxOutputTokensClient.generate(
    sampleRequest({ maxOutputTokens: 256 }),
  );
  assert.equal(observedBodies[1]?.includes("max_completion_tokens"), false);
});
