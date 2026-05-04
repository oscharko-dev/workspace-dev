import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_LLM_GATEWAY_ERROR_CLASSES,
  type GatewayInFlightDedupInputs,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGenerationRequest,
} from "../contracts/index.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
} from "./finops-report.js";
import { DEFAULT_FINOPS_BUDGET_ENVELOPE } from "./finops-budget.js";
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

const HEX64 = "0".repeat(64);
const HEX64_ALT = "1".repeat(64);
const HEX64_POLICY = "2".repeat(64);
const HEX64_POLICY_ALT = "3".repeat(64);

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

const sampleInFlightDedup = (
  overrides: Partial<GatewayInFlightDedupInputs> = {},
): GatewayInFlightDedupInputs => ({
  source: "ir_mutation_oracle",
  promptHash: HEX64,
  modelBinding: "gpt-oss-120b@azure-ai-foundry@2026.04",
  schemaHash: HEX64_ALT,
  policyProfileHash: HEX64_POLICY,
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

const cancellableResponse = ({
  status,
  headers,
  onCancel,
}: {
  status: number;
  headers?: HeadersInit;
  onCancel: () => void;
}): Response => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("ignored"));
    },
    cancel() {
      onCancel();
    },
  });
  return new Response(stream, { status, headers });
};

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

test("config validation: rejects blank ictRegisterRef", () => {
  assert.throws(
    () => createLlmGatewayClient({ ...baseConfig, ictRegisterRef: "   " }),
    /ictRegisterRef/u,
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
  assert.equal(isLlmGatewayErrorRetryable("input_budget_exceeded"), false);
  // Issue #1703: protocol failures are operator-actionable, never retryable.
  assert.equal(isLlmGatewayErrorRetryable("protocol"), false);
  // Issue #1694: caller-cancellation must never re-attempt.
  assert.equal(isLlmGatewayErrorRetryable("canceled"), false);
});

// Issue #1703 (audit-2026-05 Wave 2): protocol vs schema_invalid mapping.
test("4xx mapping: 401/403 surface as protocol (not schema_invalid)", async () => {
  for (const status of [401, 403, 407, 404, 405, 410]) {
    const client = createLlmGatewayClient(baseConfig, {
      fetchImpl: async () =>
        new Response(`{"error":"unauthorized"}`, {
          status,
          headers: { "content-type": "application/json" },
        }),
      apiKeyProvider: () => "secret-key-value",
    });
    const result = await client.generate({
      jobId: "j",
      systemPrompt: "s",
      userPrompt: "u",
    });
    assert.equal(result.outcome, "error", `status ${status}`);
    if (result.outcome !== "error") return;
    assert.equal(
      result.errorClass,
      "protocol",
      `expected protocol class for status ${status}, got ${result.errorClass}`,
    );
    assert.equal(result.retryable, false);
  }
});

test("4xx mapping: 400/409/422 surface as schema_invalid", async () => {
  for (const status of [400, 409, 412, 415, 416, 417, 422]) {
    const client = createLlmGatewayClient(baseConfig, {
      fetchImpl: async () =>
        new Response(`{"error":"bad payload"}`, {
          status,
          headers: { "content-type": "application/json" },
        }),
      apiKeyProvider: () => "secret-key-value",
    });
    const result = await client.generate({
      jobId: "j",
      systemPrompt: "s",
      userPrompt: "u",
    });
    assert.equal(result.outcome, "error", `status ${status}`);
    if (result.outcome !== "error") return;
    assert.equal(
      result.errorClass,
      "schema_invalid",
      `expected schema_invalid for status ${status}, got ${result.errorClass}`,
    );
  }
});

// Issue #1694 (audit-2026-05 Wave 2): caller-supplied AbortSignal cancels
// the in-flight call and surfaces a non-retryable `canceled` error class.
test("abortSignal: caller-cancellation surfaces canceled (not timeout, not retryable)", async () => {
  const controller = new AbortController();
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        // Pre-aborted signal: listeners attached after abort do NOT fire,
        // so reject synchronously when entering the fetch.
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      }),
    apiKeyProvider: () => "secret-key-value",
  });
  controller.abort();
  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
    abortSignal: controller.signal,
  });
  assert.equal(result.outcome, "error");
  if (result.outcome !== "error") return;
  assert.equal(result.errorClass, "canceled");
  assert.equal(result.retryable, false);
});

test("abortSignal: cancellation mid-flight surfaces canceled", async () => {
  const controller = new AbortController();
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
        // Trigger upstream abort once the fetch has begun.
        setTimeout(() => controller.abort(), 5);
      }),
    apiKeyProvider: () => "secret-key-value",
  });
  const result = await client.generate({
    jobId: "j",
    systemPrompt: "s",
    userPrompt: "u",
    abortSignal: controller.signal,
  });
  assert.equal(result.outcome, "error");
  if (result.outcome !== "error") return;
  assert.equal(result.errorClass, "canceled");
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
  let keyReads = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse({});
    },
    apiKeyProvider: () => {
      keyReads += 1;
      return "secret-key-value";
    },
  });

  const result = await client.generate(
    sampleRequest({
      userPrompt: "word ".repeat(20_000),
      maxInputTokens: 100,
    }),
  );

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "input_budget_exceeded");
    assert.equal(result.retryable, false);
    assert.match(result.message, /maxInputTokens/);
  }
  assert.equal(calls, 0);
  assert.equal(keyReads, 0);
});

test("rejects malformed maxInputTokens with schema_invalid", async () => {
  let calls = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse({});
    },
    apiKeyProvider: () => "secret-key-value",
  });

  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const result = await client.generate(
      sampleRequest({ maxInputTokens: bad }),
    );
    assert.equal(result.outcome, "error");
    if (result.outcome === "error") {
      assert.equal(result.errorClass, "schema_invalid");
      assert.equal(result.retryable, false);
      assert.match(result.message, /maxInputTokens must be a positive integer/);
    }
  }
  assert.equal(calls, 0);
});

test("input budget at the cap succeeds; one byte over fails closed", async () => {
  let calls = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      calls += 1;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "secret-key-value",
  });

  // Estimator: ceil(bytes/4). With systemPrompt="system" (6) + userPrompt
  // length L + responseSchema JSON length (computed below), we pick L so
  // the estimate equals the cap exactly.
  const schemaBytes = JSON.stringify(sampleRequest().responseSchema).length;
  const cap = 200;
  const targetBytes = cap * 4;
  const userBytes = targetBytes - 6 - schemaBytes; // 6 = "system"
  assert.ok(userBytes > 0, "fixture must yield a positive userPrompt length");

  const ok = await client.generate(
    sampleRequest({
      userPrompt: "x".repeat(userBytes),
      maxInputTokens: cap,
    }),
  );
  assert.equal(ok.outcome, "success");
  assert.equal(calls, 1);

  const tooBig = await client.generate(
    sampleRequest({
      userPrompt: "x".repeat(userBytes + 4),
      maxInputTokens: cap,
    }),
  );
  assert.equal(tooBig.outcome, "error");
  if (tooBig.outcome === "error") {
    assert.equal(tooBig.errorClass, "input_budget_exceeded");
    assert.equal(tooBig.retryable, false);
  }
  assert.equal(
    calls,
    1,
    "rejection at the cap must not dispatch a network call",
  );
});

test("response-size ceiling: Content-Length over default cap is rejected", async () => {
  const overCap = 8 * 1024 * 1024 + 1;
  let cancelled = false;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      cancellableResponse({
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(overCap),
        },
        onCancel: () => {
          cancelled = true;
        },
      }),
    apiKeyProvider: () => "secret-key-value",
  });

  const result = await client.generate(sampleRequest());

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "response_too_large");
    assert.match(
      result.message,
      /response body exceeds maxResponseBytes 8388608/,
    );
    assert.equal(result.retryable, false);
    assert.equal(isLlmGatewayErrorRetryable(result.errorClass), false);
  }
  assert.equal(cancelled, true, "declared-oversized body must be cancelled");
});

test("response-size ceiling: streaming guard aborts when chunk total exceeds cap", async () => {
  const cap = 4 * 1024;
  const chunkBytes = 1024;
  let chunksDelivered = 0;
  let cancelled = false;
  const client = createLlmGatewayClient(
    { ...baseConfig, maxResponseBytes: cap },
    {
      fetchImpl: async () => {
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (chunksDelivered >= 16) {
              controller.close();
              return;
            }
            chunksDelivered += 1;
            controller.enqueue(new Uint8Array(chunkBytes));
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      apiKeyProvider: () => "k",
    },
  );

  const result = await client.generate(sampleRequest());

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "response_too_large");
    assert.match(result.message, new RegExp(`maxResponseBytes ${cap}`));
    assert.equal(result.retryable, false);
  }
  assert.equal(
    cancelled,
    true,
    "stream must be cancelled when cap is exceeded",
  );
  assert.ok(
    chunksDelivered <= 6,
    `streaming guard must abort early (delivered=${chunksDelivered})`,
  );
});

test("response-size ceiling: streaming guard catches lying Content-Length", async () => {
  const cap = 1024;
  const oversized = "x".repeat(cap * 4);
  const client = createLlmGatewayClient(
    { ...baseConfig, maxResponseBytes: cap },
    {
      fetchImpl: async () =>
        new Response(oversized, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "16",
          },
        }),
      apiKeyProvider: () => "k",
    },
  );

  const result = await client.generate(sampleRequest());

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "response_too_large");
  }
});

test("response-size ceiling: response just at the cap boundary succeeds", async () => {
  const cap = 4 * 1024;
  const body = JSON.stringify(buildChoiceBody({ ack: "ok" }));
  assert.ok(
    new TextEncoder().encode(body).byteLength < cap,
    "fixture must fit under the cap",
  );
  const client = createLlmGatewayClient(
    { ...baseConfig, maxResponseBytes: cap },
    {
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      apiKeyProvider: () => "k",
    },
  );

  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "success");
});

test("config validation: rejects non-positive / non-integer maxResponseBytes", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => createLlmGatewayClient({ ...baseConfig, maxResponseBytes: bad }),
      /maxResponseBytes/,
      `value ${String(bad)} must be rejected`,
    );
  }
});

test("response_too_large is registered in the error-class enum and is non-retryable", () => {
  assert.ok(LLM_GATEWAY_ERROR_CLASSES.has("response_too_large"));
  assert.ok(ALLOWED_LLM_GATEWAY_ERROR_CLASSES.includes("response_too_large"));
  assert.equal(isLlmGatewayErrorRetryable("response_too_large"), false);
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
  let cancellations = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        return cancellableResponse({
          status: 429,
          headers: { "content-length": String(1024 * 1024 + 1) },
          onCancel: () => {
            cancellations += 1;
          },
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
  assert.equal(cancellations, 2);
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
  let cancellations = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      attempts += 1;
      return cancellableResponse({
        status: 503,
        headers: { "content-length": String(1024 * 1024 + 1) },
        onCancel: () => {
          cancellations += 1;
        },
      });
    },
    apiKeyProvider: () => "k",
    sleep: async () => undefined,
    retryBackoffMs: [0, 0, 0],
  });

  const result = await client.generate(sampleRequest());

  assert.equal(attempts, 3);
  assert.equal(cancellations, 3);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "transport");
    assert.equal(result.retryable, true);
  }
});

test("408 response body is cancelled while preserving timeout classification", async () => {
  let cancelled = false;
  const client = createLlmGatewayClient(
    { ...baseConfig, maxRetries: 0 },
    {
      fetchImpl: async () =>
        cancellableResponse({
          status: 408,
          onCancel: () => {
            cancelled = true;
          },
        }),
      apiKeyProvider: () => "k",
      sleep: async () => undefined,
    },
  );

  const result = await client.generate(sampleRequest());

  assert.equal(cancelled, true);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
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
  assert.match(observedUrl ?? "", /\/openai\/v1\/chat\/completions$/);
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
  const unsupported = await noMaxOutputTokensClient.generate(
    sampleRequest({ maxOutputTokens: 256 }),
  );
  assert.equal(unsupported.outcome, "error");
  if (unsupported.outcome === "error") {
    assert.equal(unsupported.errorClass, "schema_invalid");
    assert.match(unsupported.message, /maxOutputTokensSupport/);
  }
  assert.equal(observedBodies.length, 1);
});

// ---------------------------------------------------------------------------
// wireStructuredOutputMode (Issue #1733 customer-demo follow-up):
// gpt-oss-120b on Azure AI Foundry's openai/v1 path returned empty content for
// every response_format value (probed 2026-05-02). The new field lets
// operators downgrade the wire body to `json_object` or omit response_format
// entirely while keeping the in-process JSON-parse + schema-validate
// guarantees intact.
// ---------------------------------------------------------------------------

test("wireStructuredOutputMode: defaults to json_schema when omitted", async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async (_u, init) => {
      observedBody = init?.body as string | undefined;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
  });
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "success");
  assert.match(observedBody ?? "", /"type":"json_schema"/);
  assert.match(observedBody ?? "", /"name":"probe\.v1"/);
});

test('wireStructuredOutputMode: "json_object" emits weaker wire format but still validates schema in-process', async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(
    { ...baseConfig, wireStructuredOutputMode: "json_object" },
    {
      fetchImpl: async (_u, init) => {
        observedBody = init?.body as string | undefined;
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "success");
  assert.match(
    observedBody ?? "",
    /"response_format":\{"type":"json_object"\}/,
  );
  assert.equal((observedBody ?? "").includes("json_schema"), false);
  if (result.outcome === "success") {
    // In-process JSON parse + schema validation still apply.
    assert.deepEqual(result.content, { ack: "ok" });
  }
});

test('wireStructuredOutputMode: "json_object" still surfaces schema_invalid for content that violates the schema', async () => {
  const client = createLlmGatewayClient(
    { ...baseConfig, wireStructuredOutputMode: "json_object" },
    {
      // The schema requires { ack: string }; respond with a number to verify
      // in-process validation continues to fire even with the weaker wire
      // format.
      fetchImpl: async () => okJsonResponse(buildChoiceBody({ ack: 1234 })),
      apiKeyProvider: () => "k",
    },
  );
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /violates response schema/);
  }
});

test('wireStructuredOutputMode: "none" omits response_format but still parses + schema-validates JSON content', async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(
    { ...baseConfig, wireStructuredOutputMode: "none" },
    {
      fetchImpl: async (_u, init) => {
        observedBody = init?.body as string | undefined;
        return okJsonResponse(buildChoiceBody({ ack: "ok" }));
      },
      apiKeyProvider: () => "k",
    },
  );
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "success");
  assert.equal((observedBody ?? "").includes("response_format"), false);
  if (result.outcome === "success") {
    assert.deepEqual(result.content, { ack: "ok" });
    // raw text MUST still be omitted from the success record (the contract
    // strips it whenever the caller passed a schema, regardless of wire mode,
    // so reasoning text smuggled in adjacent fields cannot leak via that
    // path).
    assert.equal(result.rawTextContent, undefined);
  }
});

test('wireStructuredOutputMode: "none" surfaces schema_invalid when free-form content is not parseable JSON', async () => {
  const client = createLlmGatewayClient(
    { ...baseConfig, wireStructuredOutputMode: "none" },
    {
      // A model that, despite the prompt, returns prose rather than JSON.
      fetchImpl: async () =>
        okJsonResponse({
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: "Sorry, I cannot do that.",
              },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      apiKeyProvider: () => "k",
    },
  );
  const result = await client.generate(sampleRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /not valid JSON/);
  }
});

test("in-flight dedup: concurrent identical keys collapse to one gateway call and increment FinOps bySource hit counter", async () => {
  const recorder = createFinOpsUsageRecorder();
  let dispatches = 0;
  let releaseFetch: (() => void) | undefined;
  const releasePromise = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      dispatches += 1;
      await releasePromise;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
    onInFlightDedupHit: (source) => recorder.recordInFlightDedupHit(source),
  });

  const first = client.generate({
    ...sampleRequest(),
    inFlightDedup: sampleInFlightDedup(),
  });
  const second = client.generate({
    ...sampleRequest(),
    inFlightDedup: sampleInFlightDedup(),
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dispatches, 1);
  releaseFetch?.();

  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(dispatches, 1);
  assert.deepEqual(r1, r2);

  const report = buildFinOpsBudgetReport({
    jobId: "job-1",
    generatedAt: "2026-05-03T12:00:00.000Z",
    budget: DEFAULT_FINOPS_BUDGET_ENVELOPE,
    recorder,
  });
  assert.equal(report.bySource.ir_mutation_oracle.inFlightDedupHits, 1);
});

test("in-flight dedup: different policyProfileHash values do not collapse", async () => {
  let dispatches = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
  });

  await Promise.all([
    client.generate({
      ...sampleRequest(),
      inFlightDedup: sampleInFlightDedup({
        policyProfileHash: HEX64_POLICY,
      }),
    }),
    client.generate({
      ...sampleRequest(),
      inFlightDedup: sampleInFlightDedup({
        policyProfileHash: HEX64_POLICY_ALT,
      }),
    }),
  ]);

  assert.equal(dispatches, 2);
});

test("in-flight dedup: malformed key surfaces schema_invalid before transport", async () => {
  let dispatches = 0;
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      dispatches += 1;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "k",
  });

  const result = await client.generate({
    ...sampleRequest(),
    inFlightDedup: sampleInFlightDedup({
      policyProfileHash: "short",
    }),
  });

  assert.equal(dispatches, 0);
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /policyProfileHash/u);
  }
});

test("config validation: rejects invalid wireStructuredOutputMode value", () => {
  assert.throws(
    () =>
      createLlmGatewayClient(
        {
          ...baseConfig,
          // intentionally invalid sentinel — exercise the runtime guard.
          wireStructuredOutputMode:
            "raw_text" as unknown as LlmGatewayClientConfig["wireStructuredOutputMode"],
        },
        { apiKeyProvider: () => "k" },
      ),
    /invalid wireStructuredOutputMode/,
  );
});

test('wireStructuredOutputMode: "none" plus structuredOutputs:false still omits response_format (no double-write)', async () => {
  let observedBody: string | undefined;
  const client = createLlmGatewayClient(
    {
      ...baseConfig,
      declaredCapabilities: { ...baseCapabilities, structuredOutputs: false },
      wireStructuredOutputMode: "none",
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
  assert.equal((observedBody ?? "").includes("response_format"), false);
});
