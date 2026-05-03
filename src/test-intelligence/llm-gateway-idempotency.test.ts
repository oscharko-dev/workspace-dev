import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
  type GatewayIdempotencyInputs,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGenerationRequest,
} from "../contracts/index.js";
import { createLlmGatewayClient } from "./llm-gateway.js";
import {
  computeGatewayIdempotencyHmac,
  createLlmGatewayIdempotencyCache,
  DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS,
  GATEWAY_IDEMPOTENCY_CACHE_DIRNAME,
  gatewayIdempotencyCacheDir,
  gatewayIdempotencyCachePath,
} from "./llm-gateway-idempotency.js";

const HEX64 = "0".repeat(64);
const HEX64_ALT = "1".repeat(64);

const sampleInputs = (
  overrides: Partial<GatewayIdempotencyInputs> = {},
): GatewayIdempotencyInputs => ({
  jobId: "job-1",
  roleStepId: "job-1-generator-1",
  attempt: 1,
  promptVersion: "generator/v3",
  schemaHash: HEX64,
  inputHash: HEX64_ALT,
  ...overrides,
});

const baseCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
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
  maxRetries: 0,
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
  idempotency: sampleInputs(),
  ...overrides,
});

const okJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const buildChoiceBody = (contentJson: unknown): Record<string, unknown> => ({
  choices: [
    {
      finish_reason: "stop",
      message: { role: "assistant", content: JSON.stringify(contentJson) },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
});

test("computeGatewayIdempotencyHmac is deterministic for same inputs+secret", async () => {
  const a = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-1");
  const b = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-1");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("computeGatewayIdempotencyHmac changes when any input changes", async () => {
  const base = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-1");
  for (const variant of [
    sampleInputs({ jobId: "job-2" }),
    sampleInputs({ roleStepId: "job-1-generator-2" }),
    sampleInputs({ attempt: 2 }),
    sampleInputs({ promptVersion: "generator/v4" }),
    sampleInputs({ schemaHash: "a".repeat(64) }),
    sampleInputs({ inputHash: "b".repeat(64) }),
  ]) {
    const v = await computeGatewayIdempotencyHmac(variant, "secret-1");
    assert.notEqual(v, base);
  }
});

test("computeGatewayIdempotencyHmac differs across secrets", async () => {
  const a = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-1");
  const b = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-2");
  assert.notEqual(a, b);
});

test("computeGatewayIdempotencyHmac rejects empty secret", async () => {
  await assert.rejects(
    computeGatewayIdempotencyHmac(sampleInputs(), ""),
    /non-empty/,
  );
});

test("computeGatewayIdempotencyHmac is order-independent for same fields", async () => {
  // Reorder via a fresh literal — canonicalJson must produce the same digest.
  const reordered: GatewayIdempotencyInputs = {
    schemaHash: HEX64,
    inputHash: HEX64_ALT,
    promptVersion: "generator/v3",
    attempt: 1,
    roleStepId: "job-1-generator-1",
    jobId: "job-1",
  };
  const a = await computeGatewayIdempotencyHmac(sampleInputs(), "secret-1");
  const b = await computeGatewayIdempotencyHmac(reordered, "secret-1");
  assert.equal(a, b);
});

test("createLlmGatewayIdempotencyCache rejects missing/empty secret", () => {
  assert.throws(
    () =>
      createLlmGatewayIdempotencyCache({
        hmacSecret: "",
      }),
    /non-empty/,
  );
});

test("createLlmGatewayIdempotencyCache rejects bad ttl/maxEntries", () => {
  assert.throws(
    () => createLlmGatewayIdempotencyCache({ hmacSecret: "x", ttlMs: 0 }),
    /ttlMs/,
  );
  assert.throws(
    () => createLlmGatewayIdempotencyCache({ hmacSecret: "x", maxEntries: 0 }),
    /maxEntries/,
  );
});

test("cache.computeKey rejects malformed inputs", async () => {
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  await assert.rejects(
    cache.computeKey(sampleInputs({ jobId: "" })),
    /jobId/,
  );
  await assert.rejects(
    cache.computeKey(sampleInputs({ schemaHash: "not-hex" })),
    /schemaHash/,
  );
  await assert.rejects(
    cache.computeKey(sampleInputs({ attempt: 0 })),
    /attempt/,
  );
});

test("cache.lookup miss returns the computed key for storage", async () => {
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  const inputs = sampleInputs();
  const result = await cache.lookup(inputs);
  assert.equal(result.hit, false);
  if (result.hit) return;
  assert.equal(result.key.schemaVersion, GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION);
  assert.equal(result.key.jobId, inputs.jobId);
  assert.equal(result.key.roleStepId, inputs.roleStepId);
  assert.equal(result.key.attempt, inputs.attempt);
  assert.match(result.key.hmac, /^[0-9a-f]{64}$/);

  const metrics = cache.getMetrics();
  assert.equal(metrics.misses, 1);
  assert.equal(metrics.replays, 0);
  assert.equal(metrics.stores, 0);
});

test("cache.store + cache.lookup hit returns identical structured result", async () => {
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  const inputs = sampleInputs();
  const miss = await cache.lookup(inputs);
  if (miss.hit) throw new Error("seeded lookup unexpectedly hit");
  await cache.store(miss.key, {
    outcome: "success",
    content: { ack: "ok" },
    finishReason: "stop",
    usage: { inputTokens: 10, outputTokens: 5 },
    modelDeployment: "gpt-oss-120b",
    modelRevision: "gpt-oss-120b@2026-04-25",
    gatewayRelease: "azure-ai-foundry@2026.04",
    attempt: 1,
  });

  const second = await cache.lookup(inputs);
  assert.equal(second.hit, true);
  if (!second.hit) return;
  assert.deepEqual(second.result.content, { ack: "ok" });
  assert.equal(second.result.outcome, "success");

  const metrics = cache.getMetrics();
  assert.equal(metrics.misses, 1);
  assert.equal(metrics.replays, 1);
  assert.equal(metrics.stores, 1);
});

test("TTL expiry: a cached entry past ttlMs misses and increments ttlExpirations", async () => {
  let now = 1_000;
  const cache = createLlmGatewayIdempotencyCache({
    hmacSecret: "secret-1",
    ttlMs: 100,
    clock: () => now,
  });
  const miss = await cache.lookup(sampleInputs());
  if (miss.hit) throw new Error("unexpected hit");
  await cache.store(miss.key, {
    outcome: "success",
    content: { ack: "ok" },
    finishReason: "stop",
    usage: {},
    modelDeployment: "x",
    modelRevision: "y",
    gatewayRelease: "z",
    attempt: 1,
  });

  now += 50;
  const fresh = await cache.lookup(sampleInputs());
  assert.equal(fresh.hit, true);

  now += 2_000;
  const stale = await cache.lookup(sampleInputs());
  assert.equal(stale.hit, false);
  const metrics = cache.getMetrics();
  assert.ok(metrics.ttlExpirations >= 1);
});

test("maxEntries: oldest entry is evicted under bounded memory", async () => {
  const cache = createLlmGatewayIdempotencyCache({
    hmacSecret: "secret-1",
    maxEntries: 2,
  });
  const a = await cache.lookup(sampleInputs({ roleStepId: "step-a" }));
  if (a.hit) throw new Error();
  await cache.store(a.key, mkSuccess({ ack: "a" }));
  const b = await cache.lookup(sampleInputs({ roleStepId: "step-b" }));
  if (b.hit) throw new Error();
  await cache.store(b.key, mkSuccess({ ack: "b" }));
  const c = await cache.lookup(sampleInputs({ roleStepId: "step-c" }));
  if (c.hit) throw new Error();
  await cache.store(c.key, mkSuccess({ ack: "c" }));

  // step-a is the oldest insert and should have been evicted.
  const checkA = await cache.lookup(sampleInputs({ roleStepId: "step-a" }));
  assert.equal(checkA.hit, false);
  const checkB = await cache.lookup(sampleInputs({ roleStepId: "step-b" }));
  assert.equal(checkB.hit, true);
  assert.ok(cache.getMetrics().memoryEvictions >= 1);
});

test("disk persistence: file is content-addressable, redacted, has no raw body or secret", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idemp-disk-"));
  try {
    const cache = createLlmGatewayIdempotencyCache({
      hmacSecret: "operator-secret-AAAA",
      diskRoot: dir,
    });
    const miss = await cache.lookup(sampleInputs());
    if (miss.hit) throw new Error();
    await cache.store(miss.key, {
      outcome: "success",
      content: { ack: "ok" },
      rawTextContent: "<raw model body MUST NOT be persisted>",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5 },
      modelDeployment: "gpt-oss-120b",
      modelRevision: "gpt-oss-120b@2026-04-25",
      gatewayRelease: "azure-ai-foundry@2026.04",
      attempt: 1,
    });

    const cacheDir = gatewayIdempotencyCacheDir(dir);
    const files = await readdir(cacheDir);
    assert.equal(files.length, 1);
    const filename = files[0]!;
    assert.match(filename, /^[0-9a-f]{64}\.json$/);
    assert.equal(filename, `${miss.key.hmac}.json`);

    const onDiskPath = gatewayIdempotencyCachePath(dir, miss.key.hmac);
    assert.equal(onDiskPath, join(cacheDir, `${miss.key.hmac}.json`));

    const raw = await readFile(onDiskPath, "utf8");
    assert.doesNotMatch(raw, /<raw model body MUST NOT be persisted>/);
    assert.doesNotMatch(raw, /operator-secret-AAAA/);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed["schemaVersion"], GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION);
    const result = parsed["result"] as Record<string, unknown>;
    assert.equal(result["outcome"], "success");
    assert.deepEqual(result["content"], { ack: "ok" });
    assert.equal(
      "rawTextContent" in result,
      false,
      "raw text body must never be persisted to the idempotency cache",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("worker-crash-mid-call: a fresh process+cache rehydrates from disk and avoids second LLM call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idemp-worker-"));
  try {
    let upstreamCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      upstreamCalls += 1;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    };

    // Process 1: gateway runs, stores result on disk.
    const cache1 = createLlmGatewayIdempotencyCache({
      hmacSecret: "operator-secret-AAAA",
      diskRoot: dir,
    });
    const client1 = createLlmGatewayClient(baseConfig, {
      fetchImpl,
      apiKeyProvider: () => "api-key-AAAAAAAA",
      idempotencyCache: cache1,
    });
    const r1 = await client1.generate(sampleRequest());
    assert.equal(r1.outcome, "success");
    assert.equal(upstreamCalls, 1);
    assert.equal(cache1.getMetrics().stores, 1);

    // Worker crashed: cache1 (in-memory) is gone. Process 2 spins up a
    // brand new cache instance pointed at the same diskRoot.
    const cache2 = createLlmGatewayIdempotencyCache({
      hmacSecret: "operator-secret-AAAA",
      diskRoot: dir,
    });
    const client2 = createLlmGatewayClient(baseConfig, {
      fetchImpl,
      apiKeyProvider: () => "api-key-AAAAAAAA",
      idempotencyCache: cache2,
    });
    const r2 = await client2.generate(sampleRequest());

    // Acceptance criteria #1784:
    //   - identical role-step replay returns the cached result
    //   - no second LLM call
    //   - gateway_idempotent_replay counter increments
    assert.equal(r2.outcome, "success");
    if (r1.outcome !== "success" || r2.outcome !== "success") return;
    assert.deepEqual(r2.content, r1.content);
    assert.equal(upstreamCalls, 1, "second generate must not dispatch fetch");
    const metrics = cache2.getMetrics();
    assert.equal(metrics.replays, 1);
    assert.equal(metrics.diskReads, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway: idempotency hit short-circuits dispatch when inputs+cache present", async () => {
  let upstreamCalls = 0;
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      upstreamCalls += 1;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "api-key-AAAAAAAA",
    idempotencyCache: cache,
  });

  const r1 = await client.generate(sampleRequest());
  assert.equal(r1.outcome, "success");
  assert.equal(upstreamCalls, 1);

  const r2 = await client.generate(sampleRequest());
  assert.equal(r2.outcome, "success");
  assert.equal(upstreamCalls, 1, "second generate must short-circuit");
  assert.equal(client.getIdempotencyMetrics()?.replays, 1);
  assert.equal(client.getIdempotencyMetrics()?.stores, 1);
});

test("gateway: requests without idempotency input still dispatch every call", async () => {
  let upstreamCalls = 0;
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      upstreamCalls += 1;
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "api-key-AAAAAAAA",
    idempotencyCache: cache,
  });

  await client.generate({
    jobId: "job-1",
    systemPrompt: "s",
    userPrompt: "u",
    responseSchema: { type: "object", required: ["ack"] },
    responseSchemaName: "probe.v1",
  });
  await client.generate({
    jobId: "job-1",
    systemPrompt: "s",
    userPrompt: "u",
    responseSchema: { type: "object", required: ["ack"] },
    responseSchemaName: "probe.v1",
  });
  assert.equal(upstreamCalls, 2);
  assert.equal(client.getIdempotencyMetrics()?.replays, 0);
});

test("gateway: failed dispatch is NOT cached (next call re-dispatches)", async () => {
  let upstreamCalls = 0;
  const cache = createLlmGatewayIdempotencyCache({ hmacSecret: "secret-1" });
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () => {
      upstreamCalls += 1;
      if (upstreamCalls === 1) {
        return new Response(`{"error":"boom"}`, {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return okJsonResponse(buildChoiceBody({ ack: "ok" }));
    },
    apiKeyProvider: () => "api-key-AAAAAAAA",
    idempotencyCache: cache,
  });

  const r1 = await client.generate(sampleRequest());
  assert.equal(r1.outcome, "error");
  assert.equal(cache.getMetrics().stores, 0);

  const r2 = await client.generate(sampleRequest());
  assert.equal(r2.outcome, "success");
  assert.equal(upstreamCalls, 2);
  assert.equal(cache.getMetrics().stores, 1);
});

test("gateway: getIdempotencyMetrics is undefined when no cache wired", async () => {
  const client = createLlmGatewayClient(baseConfig, {
    fetchImpl: async () =>
      okJsonResponse(buildChoiceBody({ ack: "ok" })),
    apiKeyProvider: () => "api-key-AAAAAAAA",
  });
  assert.equal(client.getIdempotencyMetrics(), undefined);
});

test("gateway: secret provider callback is invoked, value is never persisted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idemp-secret-"));
  try {
    let providerCalls = 0;
    const cache = createLlmGatewayIdempotencyCache({
      hmacSecret: () => {
        providerCalls += 1;
        return "operator-secret-CCCC";
      },
      diskRoot: dir,
    });
    const client = createLlmGatewayClient(baseConfig, {
      fetchImpl: async () => okJsonResponse(buildChoiceBody({ ack: "ok" })),
      apiKeyProvider: () => "api-key-AAAAAAAA",
      idempotencyCache: cache,
    });
    await client.generate(sampleRequest());
    assert.ok(providerCalls > 0);

    const cacheDir = join(dir, GATEWAY_IDEMPOTENCY_CACHE_DIRNAME);
    const files = await readdir(cacheDir);
    assert.equal(files.length, 1);
    const raw = await readFile(join(cacheDir, files[0]!), "utf8");
    assert.doesNotMatch(raw, /operator-secret-CCCC/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway: malformed disk file is ignored without throwing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idemp-corrupt-"));
  try {
    const cache = createLlmGatewayIdempotencyCache({
      hmacSecret: "secret-1",
      diskRoot: dir,
    });
    const lookup = await cache.lookup(sampleInputs());
    if (lookup.hit) throw new Error();

    // Drop a corrupt file at the expected hmac path.
    const path = gatewayIdempotencyCachePath(dir, lookup.key.hmac);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, GATEWAY_IDEMPOTENCY_CACHE_DIRNAME), {
      recursive: true,
    });
    await writeFile(path, "this-is-not-json");

    const second = await cache.lookup(sampleInputs());
    assert.equal(second.hit, false);
    assert.ok(cache.getMetrics().diskReadFailures >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway: tampered disk file with mismatched hmac is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "idemp-tamper-"));
  try {
    const cache = createLlmGatewayIdempotencyCache({
      hmacSecret: "secret-1",
      diskRoot: dir,
    });
    const lookup = await cache.lookup(sampleInputs());
    if (lookup.hit) throw new Error();

    // Forge a disk envelope where the inner key.hmac does not match the
    // file location's hmac. Even a parser-clean file must be rejected.
    const path = gatewayIdempotencyCachePath(dir, lookup.key.hmac);
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, GATEWAY_IDEMPOTENCY_CACHE_DIRNAME), {
      recursive: true,
    });
    const envelope = {
      schemaVersion: GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
      storedAtMs: Date.now(),
      key: {
        schemaVersion: GATEWAY_IDEMPOTENCY_KEY_SCHEMA_VERSION,
        jobId: "spoofed",
        roleStepId: "spoofed",
        attempt: 1,
        promptVersion: "spoofed",
        schemaHash: HEX64,
        inputHash: HEX64_ALT,
        hmac: "f".repeat(64),
      },
      result: {
        outcome: "success",
        content: { ack: "spoof" },
        finishReason: "stop",
        usage: {},
        modelDeployment: "x",
        modelRevision: "y",
        gatewayRelease: "z",
        attempt: 1,
      },
    };
    await writeFile(path, JSON.stringify(envelope));

    const second = await cache.lookup(sampleInputs());
    assert.equal(second.hit, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS is 24h", () => {
  assert.equal(DEFAULT_GATEWAY_IDEMPOTENCY_TTL_MS, 24 * 60 * 60 * 1000);
});

test("gatewayIdempotencyCachePath refuses non-hex hmac (defence-in-depth)", () => {
  assert.throws(() => gatewayIdempotencyCachePath("/tmp/x", "../escape"), RangeError);
  assert.throws(() => gatewayIdempotencyCachePath("/tmp/x", "0".repeat(63)), RangeError);
});

const mkSuccess = (content: unknown) => ({
  outcome: "success" as const,
  content,
  finishReason: "stop" as const,
  usage: {},
  modelDeployment: "x",
  modelRevision: "y",
  gatewayRelease: "z",
  attempt: 1,
});
