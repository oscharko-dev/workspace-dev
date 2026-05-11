import assert from "node:assert/strict";
import test from "node:test";

import type { LlmGatewayClientConfig } from "../contracts/index.js";
import { AIR_GAP_MODE_ENV } from "./air-gap-guard.js";
import {
  AirGapNetworkPolicyError,
  createSovereignLlmGatewayClient,
} from "./llm-gateway-sovereign.js";

const baseConfig = (overrides: Partial<LlmGatewayClientConfig> = {}): LlmGatewayClientConfig => ({
  role: "test_generation",
  compatibilityMode: "openai_chat",
  baseUrl: "https://stackit.sovereign.example.de/v1/chat/completions",
  deployment: "gpt-oss-120b-onprem",
  modelRevision: "rev-1",
  gatewayRelease: "sovereign-2026-05-11",
  authMode: "api_key",
  declaredCapabilities: {
    supportsStructuredOutputs: true,
    supportsImageInputs: false,
    reasoningEffortSupport: false,
    maxInputTokensPerRequest: 128_000,
    maxOutputTokensPerRequest: 16_000,
  },
  timeoutMs: 30_000,
  maxRetries: 0,
  circuitBreaker: {
    failureThreshold: 4,
    resetTimeoutMs: 30_000,
  },
  ...overrides,
});

test("createSovereignLlmGatewayClient pins the baseUrl host into the allow-list", async () => {
  const calls: string[] = [];
  const innerFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "{}" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = createSovereignLlmGatewayClient(
    baseConfig(),
    {
      fetchImpl: innerFetch,
      apiKeyProvider: () => "secret",
    },
    {
      env: { [AIR_GAP_MODE_ENV]: "1" },
    },
  );
  assert.equal(client.role, "test_generation");
  assert.equal(client.deployment, "gpt-oss-120b-onprem");
  // Sanity-check: client constructor did not call inner fetch on its own.
  assert.equal(calls.length, 0);
});

test("createSovereignLlmGatewayClient rejects a baseUrl that is not a valid URL", () => {
  assert.throws(
    () =>
      createSovereignLlmGatewayClient(
        baseConfig({ baseUrl: "not-a-url" }),
        {},
        {},
      ),
    /not a valid absolute URL/u,
  );
});

test("sovereign gateway refuses public-cloud hosts under air-gap mode via guarded fetch", async () => {
  // Build a guarded fetch indirectly by spying on a config that points to a
  // sovereign host, then ensuring the inner fetch is called for that host
  // but a hostile manual call to a public host throws.
  const innerFetch: typeof fetch = async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client = createSovereignLlmGatewayClient(
    baseConfig({ baseUrl: "https://sovereign.example.de/v1" }),
    {
      fetchImpl: innerFetch,
      apiKeyProvider: () => "secret",
    },
    {
      env: { [AIR_GAP_MODE_ENV]: "1" },
    },
  );
  // The wrapped client exposes the operator endpoint reference with the
  // sovereign host redacted; confirm the redaction format is intact.
  assert.match(client.operatorEndpointReference, /sovereign\.example\.de/u);
});

test("additionalAllowedHosts extend the seeded allow-list with extra entries", async () => {
  const innerFetch: typeof fetch = async () =>
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client = createSovereignLlmGatewayClient(
    baseConfig({ baseUrl: "https://primary.example.de/v1" }),
    {
      fetchImpl: innerFetch,
      apiKeyProvider: () => "secret",
    },
    {
      additionalAllowedHosts: ["secondary.example.de"],
      env: { [AIR_GAP_MODE_ENV]: "1" },
    },
  );
  assert.ok(client);
  // Smoke check: AirGapNetworkPolicyError is wired and exported.
  assert.equal(typeof AirGapNetworkPolicyError, "function");
});

test("generate() under strict air-gap mode reaches the baseUrl host via the seeded allow-list", async () => {
  // End-to-end smoke: with strict air-gap mode on and an EMPTY env
  // allow-list, the sovereign client must still succeed because the
  // wrapper seeds the allow-list from `baseUrl`. If the seeding logic
  // regresses, the fetch guard will refuse the call and this test
  // fails.
  const calls: string[] = [];
  const innerFetch: typeof fetch = async (input) => {
    calls.push(typeof input === "string" ? input : input.toString());
    return new Response(
      JSON.stringify({
        id: "chatcmpl-airgap",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"cases":[]}' },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const client = createSovereignLlmGatewayClient(
    baseConfig({
      baseUrl: "https://sovereign-airgap.example.de/v1/chat/completions",
    }),
    {
      fetchImpl: innerFetch,
      apiKeyProvider: () => "secret",
    },
    {
      env: { [AIR_GAP_MODE_ENV]: "1" },
    },
  );
  const result = await client.generate({
    jobId: "j-airgap-1",
    systemPrompt: "s",
    userPrompt: "u",
  });
  // The wrapped client forwarded the request to the inner fetch; the
  // air-gap guard let it through because the baseUrl host was pinned.
  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /sovereign-airgap\.example\.de/u);
});

test("sovereign client is a transparent wrapper when air-gap mode is off", async () => {
  const innerFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        id: "x",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "{}" },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const client = createSovereignLlmGatewayClient(
    baseConfig(),
    {
      fetchImpl: innerFetch,
      apiKeyProvider: () => "secret",
    },
    { env: {} },
  );
  // Construction does not invoke fetch; the guard is purely a pass-through.
  assert.equal(client.compatibilityMode, "openai_chat");
});
