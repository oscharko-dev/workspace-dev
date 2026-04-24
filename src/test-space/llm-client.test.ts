import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceTestSpaceLlmClientFromEnv,
} from "./llm-client.js";
import {
  WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV,
  WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV,
  WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV,
} from "./constants.js";

const NOOP_REQUEST = {} as never;
const NOOP_FIGMA_SUMMARY = {} as never;

const VALID_LLM_OUTPUT = {
  testCases: [
    {
      id: "TC-001",
      title: "Happy path",
      priority: "P0",
      type: "happy_path",
      steps: [
        {
          order: 1,
          action: "Open checkout",
          expectedResult: "Checkout opens",
        },
      ],
      expectedResult: "Payment succeeds",
      coverageTags: ["smoke"],
    },
  ],
  coverageFindings: [],
} as const;

test("Test Space LLM client normalizes Foundry base endpoints and sends chat-completions JSON", async () => {
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(JSON.stringify(VALID_LLM_OUTPUT), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      [WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV]:
        "https://example.invalid",
      [WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV]: "azure-gpt-4o",
      [WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV]: "test-bearer-token",
    },
    fetchImpl,
  });

  assert.ok(client);
  const result = await client.generateStructuredOutput({
    modelDeployment: "gpt-oss-120b",
    prompt: "Generate test cases.",
    request: NOOP_REQUEST,
    figmaSummary: NOOP_FIGMA_SUMMARY,
  });

  assert.deepEqual(result, VALID_LLM_OUTPUT);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.input,
    "https://example.invalid/openai/v1/chat/completions",
  );
  assert.deepEqual(calls[0]?.init?.headers, {
    "content-type": "application/json",
    authorization: "Bearer test-bearer-token",
  });

  const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal(body.model, "azure-gpt-4o");
  assert.equal(body.temperature, 0);
  assert.equal(Array.isArray(body.messages), true);
  assert.match(
    String((body.messages as Array<{ content?: unknown }>)[0]?.content),
    /TestSpaceLlmOutputSchema/,
  );
  assert.match(
    String((body.messages as Array<{ content?: unknown }>)[1]?.content),
    /Request summary JSON:/,
  );
});

test("Test Space LLM client accepts legacy env names and parses chat-completion content arrays", async () => {
  const calls: Array<{
    input: RequestInfo | URL;
    init?: RequestInit;
  }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(VALID_LLM_OUTPUT),
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      WORKSPACE_TEST_SPACE_LLM_ENDPOINT_URL:
        "https://example.invalid/openai/v1",
      WORKSPACE_TEST_SPACE_LLM_API_KEY: "legacy-bearer-token",
    },
    fetchImpl,
  });

  assert.ok(client);
  const result = await client.generateStructuredOutput({
    modelDeployment: "service-default",
    prompt: "Generate test cases.",
    request: NOOP_REQUEST,
    figmaSummary: NOOP_FIGMA_SUMMARY,
  });

  assert.deepEqual(result, VALID_LLM_OUTPUT);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]?.input,
    "https://example.invalid/openai/v1/chat/completions",
  );
  assert.deepEqual(calls[0]?.init?.headers, {
    "content-type": "application/json",
    authorization: "Bearer legacy-bearer-token",
  });
});

test("Test Space LLM client returns undefined when no endpoint is configured", () => {
  assert.equal(createWorkspaceTestSpaceLlmClientFromEnv({ env: {} }), undefined);
});

test("Test Space LLM client aborts timed out requests", async () => {
  let capturedSignal: AbortSignal | undefined;
  const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedSignal = init?.signal as AbortSignal | undefined;
    return await new Promise<Response>(() => {});
  };

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      [WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV]: "https://example.invalid",
    },
    fetchImpl,
    timeoutMs: 20,
  });

  assert.ok(client);
  await assert.rejects(
    () =>
      client.generateStructuredOutput({
        modelDeployment: "gpt-oss-120b",
        prompt: "Generate test cases.",
        request: NOOP_REQUEST,
        figmaSummary: NOOP_FIGMA_SUMMARY,
      }),
    /timed out/i,
  );
  assert.equal(capturedSignal?.aborted, true);
});

test("Test Space LLM client keeps the timeout active while reading a stalled response body", async () => {
  let capturedSignal: AbortSignal | undefined;
  let bodyCanceled = false;
  const stalledBody = new ReadableStream<Uint8Array>({
    pull() {
      return new Promise<void>(() => {});
    },
    cancel() {
      bodyCanceled = true;
    },
  });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedSignal = init?.signal as AbortSignal | undefined;
    void input;
    return new Response(stalledBody, {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      [WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV]: "https://example.invalid",
    },
    fetchImpl,
    timeoutMs: 20,
  });

  assert.ok(client);
  await assert.rejects(
    () =>
      client.generateStructuredOutput({
        modelDeployment: "gpt-oss-120b",
        prompt: "Generate test cases.",
        request: NOOP_REQUEST,
        figmaSummary: NOOP_FIGMA_SUMMARY,
      }),
    /timed out/i,
  );
  assert.equal(capturedSignal?.aborted, true);
  assert.equal(bodyCanceled, true);
});

test("Test Space LLM client rejects oversized responses without parsing them", async () => {
  const fetchImpl = async () =>
    new Response("0123456789abcdefg", {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      [WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV]: "https://example.invalid",
    },
    fetchImpl,
    maxResponseBytes: 16,
  });

  assert.ok(client);
  await assert.rejects(
    () =>
      client.generateStructuredOutput({
        modelDeployment: "gpt-oss-120b",
        prompt: "Generate test cases.",
        request: NOOP_REQUEST,
        figmaSummary: NOOP_FIGMA_SUMMARY,
      }),
    /more than 16 bytes/i,
  );
});

test("Test Space LLM client does not leak non-2xx response bodies", async () => {
  const fetchImpl = async () =>
    new Response("secret response body", {
      status: 500,
      headers: {
        "content-type": "text/plain",
      },
    });

  const client = createWorkspaceTestSpaceLlmClientFromEnv({
    env: {
      [WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV]: "https://example.invalid",
    },
    fetchImpl,
  });

  assert.ok(client);
  await assert.rejects(
    async () =>
      await client.generateStructuredOutput({
        modelDeployment: "gpt-oss-120b",
        prompt: "Generate test cases.",
        request: NOOP_REQUEST,
        figmaSummary: NOOP_FIGMA_SUMMARY,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Test Space LLM endpoint responded with 500." &&
      !error.message.includes("secret response body"),
  );
});
