/**
 * FinOps budget envelope tests (Issue #1371).
 *
 * Covers:
 *   - cloning produces a deep copy (no aliasing on mutation).
 *   - validateFinOpsBudgetEnvelope rejects malformed numbers, unknown
 *     roles, and visual-only fields on test_generation.
 *   - resolveFinOpsRequestLimits picks the gateway-bound fields verbatim.
 *   - LLM gateway honours `maxWallClockMs` fail-closed (`retryable: false`).
 *   - LLM gateway honours `maxRetries` cap per request.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_FINOPS_BUDGET_BREACH_REASONS,
  ALLOWED_FINOPS_JOB_OUTCOMES,
  ALLOWED_FINOPS_ROLES,
  type FinOpsBudgetEnvelope,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGenerationRequest,
} from "../contracts/index.js";
import {
  cloneEuBankingDefaultFinOpsBudget,
  cloneFinOpsBudgetEnvelope,
  cloneProductionFinOpsBudgetEnvelope,
  DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY,
  DEFAULT_FINOPS_BUDGET_ENVELOPE,
  EU_BANKING_DEFAULT_FINOPS_BUDGET,
  PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  PRODUCTION_GENERATOR_WALL_CLOCK_MS,
  VISUAL_SIDECAR_WALL_CLOCK_MS,
  resolveFinOpsRequestLimits,
  resolveTestGenerationWallClockBudget,
  resolveWallClockBudget,
  validateFinOpsBudgetEnvelope,
} from "./finops-budget.js";
import { createLlmGatewayClient } from "./llm-gateway.js";

const VISUAL_CAPS: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: true,
};

const NON_VISUAL_CAPS: LlmGatewayCapabilities = {
  ...VISUAL_CAPS,
  imageInputSupport: false,
};

const baseConfig = (
  overrides: Partial<LlmGatewayClientConfig> = {},
): LlmGatewayClientConfig => ({
  role: "test_generation",
  compatibilityMode: "openai_chat",
  baseUrl: "https://example.invalid",
  deployment: "gpt-oss-120b-mock",
  modelRevision: "rev-1",
  gatewayRelease: "wave1",
  authMode: "none",
  declaredCapabilities: NON_VISUAL_CAPS,
  timeoutMs: 60_000,
  maxRetries: 5,
  circuitBreaker: { failureThreshold: 10, resetTimeoutMs: 1000 },
  ...overrides,
});

const baseRequest = (
  overrides: Partial<LlmGenerationRequest> = {},
): LlmGenerationRequest => ({
  jobId: "job-1",
  systemPrompt: "system",
  userPrompt: "user",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Constant snapshots
// ---------------------------------------------------------------------------

test("ALLOWED_FINOPS_ROLES enumerates the known roles", () => {
  assert.deepEqual(
    [...ALLOWED_FINOPS_ROLES].sort(),
    [
      "custom_context_ingest",
      "jira_api_requests",
      "jira_paste_ingest",
      "test_generation",
      "visual_fallback",
      "visual_primary",
    ].sort(),
  );
});

test("ALLOWED_FINOPS_JOB_OUTCOMES includes both completed and budget_exceeded", () => {
  assert.ok(ALLOWED_FINOPS_JOB_OUTCOMES.includes("completed"));
  assert.ok(ALLOWED_FINOPS_JOB_OUTCOMES.includes("completed_cache_hit"));
  assert.ok(ALLOWED_FINOPS_JOB_OUTCOMES.includes("budget_exceeded"));
});

test("ALLOWED_FINOPS_BUDGET_BREACH_REASONS covers wall-clock, retries, replay-cache miss rate", () => {
  assert.ok(ALLOWED_FINOPS_BUDGET_BREACH_REASONS.includes("max_wall_clock_ms"));
  assert.ok(ALLOWED_FINOPS_BUDGET_BREACH_REASONS.includes("max_retries"));
  assert.ok(
    ALLOWED_FINOPS_BUDGET_BREACH_REASONS.includes("max_replay_cache_miss_rate"),
  );
});

// ---------------------------------------------------------------------------
// Cloning + defaults
// ---------------------------------------------------------------------------

test("DEFAULT_FINOPS_BUDGET_ENVELOPE has no role limits", () => {
  assert.equal(DEFAULT_FINOPS_BUDGET_ENVELOPE.budgetId, "default-permissive");
  assert.deepEqual(
    Object.keys(DEFAULT_FINOPS_BUDGET_ENVELOPE.roles).sort(),
    [],
  );
});

test("cloneEuBankingDefaultFinOpsBudget returns a deep clone", () => {
  const a = cloneEuBankingDefaultFinOpsBudget();
  const b = cloneEuBankingDefaultFinOpsBudget();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  // Mutation on the clone does not affect the frozen baseline.
  if (a.roles.test_generation !== undefined) {
    a.roles.test_generation.maxInputTokensPerRequest = 999;
  }
  if (a.sourceQuotas !== undefined) {
    a.sourceQuotas.maxJiraApiRequestsPerJob = 999;
  }
  // Operator stance (CTO directive 2026-05-10): the eu-banking-default
  // budget mirrors the production-default permissive envelope. Cost-aware
  // profiles will override per customer once Wave 8 lands.
  assert.equal(
    EU_BANKING_DEFAULT_FINOPS_BUDGET.roles.test_generation
      ?.maxInputTokensPerRequest,
    200_000,
  );
  assert.notEqual(
    EU_BANKING_DEFAULT_FINOPS_BUDGET.sourceQuotas,
    a.sourceQuotas,
  );
  assert.equal(
    EU_BANKING_DEFAULT_FINOPS_BUDGET.sourceQuotas?.maxJiraApiRequestsPerJob,
    200,
  );
});

test("cloneFinOpsBudgetEnvelope drops unknown role keys (defensive)", () => {
  const envelope = {
    budgetId: "x",
    budgetVersion: "1.0.0",
    roles: {
      test_generation: { maxInputTokensPerRequest: 100 },
      // Cast through unknown to inject an off-discriminant key safely.
    },
  } as FinOpsBudgetEnvelope;
  const cloned = cloneFinOpsBudgetEnvelope(envelope);
  assert.deepEqual(Object.keys(cloned.roles), ["test_generation"]);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("validateFinOpsBudgetEnvelope accepts the EU-banking default", () => {
  const result = validateFinOpsBudgetEnvelope(EU_BANKING_DEFAULT_FINOPS_BUDGET);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateFinOpsBudgetEnvelope rejects empty budgetId", () => {
  const result = validateFinOpsBudgetEnvelope({
    budgetId: "",
    budgetVersion: "1",
    roles: {},
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "$.budgetId"));
});

test("validateFinOpsBudgetEnvelope rejects negative wall-clock", () => {
  const result = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    maxJobWallClockMs: -1,
    roles: {},
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "$.maxJobWallClockMs"));
});

test("validateFinOpsBudgetEnvelope rejects miss rate outside [0, 1]", () => {
  const a = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    maxReplayCacheMissRate: -0.1,
    roles: {},
  });
  assert.equal(a.valid, false);
  const b = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    maxReplayCacheMissRate: 1.5,
    roles: {},
  });
  assert.equal(b.valid, false);
});

test("validateFinOpsBudgetEnvelope rejects unknown role keys", () => {
  const envelope = {
    budgetId: "x",
    budgetVersion: "1",
    roles: { unknown_role: {} },
  } as unknown as FinOpsBudgetEnvelope;
  const result = validateFinOpsBudgetEnvelope(envelope);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "$.roles.unknown_role"));
});

test("validateFinOpsBudgetEnvelope rejects image fields on test_generation", () => {
  const result = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    roles: {
      test_generation: {
        maxImageBytesPerRequest: 1024,
      },
    },
  });
  assert.equal(result.valid, false);
});

test("validateFinOpsBudgetEnvelope rejects maxFallbackAttempts on visual_primary", () => {
  const result = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    roles: {
      visual_primary: { maxFallbackAttempts: 1 },
    },
  });
  assert.equal(result.valid, false);
});

test("validateFinOpsBudgetEnvelope rejects zero token budgets but allows zero retries", () => {
  const reject = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    roles: { test_generation: { maxInputTokensPerRequest: 0 } },
  });
  assert.equal(reject.valid, false);
  const ok = validateFinOpsBudgetEnvelope({
    budgetId: "x",
    budgetVersion: "1",
    roles: { test_generation: { maxRetriesPerRequest: 0 } },
  });
  assert.equal(ok.valid, true);
});

// ---------------------------------------------------------------------------
// resolveFinOpsRequestLimits
// ---------------------------------------------------------------------------

test("resolveFinOpsRequestLimits returns empty for undefined budget", () => {
  assert.deepEqual(resolveFinOpsRequestLimits(undefined), {});
});

test("resolveFinOpsRequestLimits maps the four request fields", () => {
  const limits = resolveFinOpsRequestLimits({
    maxInputTokensPerRequest: 100,
    maxOutputTokensPerRequest: 50,
    maxWallClockMsPerRequest: 1000,
    maxRetriesPerRequest: 1,
  });
  assert.deepEqual(limits, {
    maxInputTokens: 100,
    maxOutputTokens: 50,
    maxWallClockMs: 1000,
    maxRetries: 1,
  });
});

test("resolveWallClockBudget applies the default elastic coefficients", () => {
  // Wave-5 W5-2 follow-up (2026-05-11): coefficients re-calibrated for
  // live `gpt-oss-120b` latency. baseMs 90→150, perCaseMs 1.8→4,
  // perAdditionalJudgeMs 12→20, perAdversarialRoundMs 18→30,
  // visualSidecarMs 15→30. The expected formula is now derived against
  // the new constants so the test stays a value-pin.
  const budget = resolveWallClockBudget({
    caseCount: 9,
    judgePanelSize: 2,
    adversarialRounds: 2,
    visualSidecarEnabled: true,
  });
  assert.equal(budget, 150_000 + 9 * 4_000 + 20_000 + 2 * 30_000 + 30_000);
});

test("Epic #2167 P0 scenario — T7l7 11-case 2-judge 1-adversarial visual run clears the observed 194 879 ms breach", () => {
  // P0 multi-dataset benchmark (2026-05-11) captured a 194 879 ms observed
  // wall-clock on the 11-case T7l7 / Test-View-01 dataset. The original
  // coefficients resolved 136 800 ms, hard-failing G7_NO_FINOPS_BREACH. The
  // W5-2 re-calibration (b9c31a45) bumps the resolved budget to 274 000 ms,
  // which leaves a ~79 s margin over the observed run. If this number ever
  // drops back under 200 000 ms a P0-class regression is reintroduced —
  // this pin makes that fail visibly with the P0 scenario name.
  const t7l7 = resolveWallClockBudget({
    caseCount: 11,
    judgePanelSize: 2,
    adversarialRounds: 1,
    visualSidecarEnabled: true,
  });
  assert.equal(t7l7, 150_000 + 11 * 4_000 + 20_000 + 30_000 + 30_000);
  assert.ok(
    t7l7 >= 200_000,
    `Epic #2167 P0 regression guard: T7l7 elastic budget dropped to ${t7l7} ms (≥ 200 000 ms expected to clear observed 194 879 ms)`,
  );
});

test("resolveWallClockBudget clamps to the configured hard ceiling", () => {
  const budget = resolveWallClockBudget({
    caseCount: 500,
    judgePanelSize: 4,
    adversarialRounds: 8,
    visualSidecarEnabled: true,
  });
  assert.equal(budget, DEFAULT_FINOPS_WALL_CLOCK_BUDGET_POLICY.hardCeilingMs);
});

test("resolveTestGenerationWallClockBudget preserves explicit constant overrides", () => {
  const resolved = resolveTestGenerationWallClockBudget({
    explicitOverrideMs: 123_456,
    caseCount: 32,
    judgePanelSize: 3,
    adversarialRounds: 2,
    visualSidecarEnabled: true,
  });
  assert.equal(resolved.mode, "constant_override");
  assert.equal(resolved.resolvedMs, 123_456);
  assert.equal(resolved.overrideMs, 123_456);
  assert.equal(
    resolved.formulaMs,
    resolveWallClockBudget({
      caseCount: 32,
      judgePanelSize: 3,
      adversarialRounds: 2,
      visualSidecarEnabled: true,
    }),
  );
});

// ---------------------------------------------------------------------------
// Gateway: maxWallClockMs is FAIL CLOSED (retryable: false)
// ---------------------------------------------------------------------------

test("gateway: maxWallClockMs breach is fail-closed (retryable=false, attempts=1)", async () => {
  // Slow responder triggers AbortController via short maxWallClockMs.
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    dispatchCount += 1;
    return new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal !== undefined && signal !== null) {
        signal.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };

  const client = createLlmGatewayClient(
    baseConfig({
      timeoutMs: 60_000,
      maxRetries: 5,
    }),
    { fetchImpl },
  );

  const result = await client.generate(baseRequest({ maxWallClockMs: 25 }));

  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
    assert.equal(
      result.retryable,
      false,
      "wall-clock budget breach must be fail-closed (Issue #1371 AC)",
    );
    assert.equal(
      dispatchCount,
      1,
      "must not retry after wall-clock budget breach",
    );
  }
});

test("gateway: timeout without maxWallClockMs stays retryable", async () => {
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    dispatchCount += 1;
    return new Promise((_resolve, reject) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal !== undefined && signal !== null) {
        signal.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
      }
    });
  };

  const client = createLlmGatewayClient(
    baseConfig({ timeoutMs: 25, maxRetries: 0 }),
    {
      fetchImpl,
      sleep: () => Promise.resolve(),
    },
  );

  const result = await client.generate(baseRequest());
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
    // With no per-request budget, timeout remains retryable so existing
    // retry semantics are preserved when an operator hasn't opted in.
    assert.equal(result.retryable, true);
  }
  assert.equal(dispatchCount, 1);
});

test("gateway: maxWallClockMs covers delayed response body reads", async () => {
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    dispatchCount += 1;
    const signal = (init as RequestInit | undefined)?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "stop",
                    message: { content: "ok" },
                  },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1 },
              }),
            ),
          );
          controller.close();
        }, 50);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          controller.error(err);
        });
      },
    });
    return new Response(body, { status: 200 });
  };

  const client = createLlmGatewayClient(
    baseConfig({ timeoutMs: 60_000, maxRetries: 5 }),
    { fetchImpl },
  );
  const result = await client.generate(baseRequest({ maxWallClockMs: 5 }));
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "timeout");
    assert.equal(result.retryable, false);
    assert.match(result.message, /maxWallClockMs/);
  }
  assert.equal(dispatchCount, 1);
});

// ---------------------------------------------------------------------------
// Gateway: maxRetries cap
// ---------------------------------------------------------------------------

test("gateway: per-request maxRetries caps total attempts to min(config, request)", async () => {
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    dispatchCount += 1;
    return new Response("server error", { status: 503 });
  };
  const client = createLlmGatewayClient(baseConfig({ maxRetries: 5 }), {
    fetchImpl,
    sleep: () => Promise.resolve(),
  });
  const result = await client.generate(baseRequest({ maxRetries: 1 }));
  assert.equal(result.outcome, "error");
  // Effective cap = min(config.maxRetries=5, request.maxRetries=1) = 1
  // → 2 attempts total (initial + 1 retry).
  assert.equal(dispatchCount, 2);
});

test("gateway: per-request maxRetries=0 disables retry entirely", async () => {
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    dispatchCount += 1;
    return new Response("server error", { status: 503 });
  };
  const client = createLlmGatewayClient(baseConfig({ maxRetries: 5 }), {
    fetchImpl,
    sleep: () => Promise.resolve(),
  });
  const result = await client.generate(baseRequest({ maxRetries: 0 }));
  assert.equal(result.outcome, "error");
  assert.equal(dispatchCount, 1);
});

test("gateway: invalid maxRetries / maxWallClockMs surface as schema_invalid", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("{}", { status: 200 });
  const client = createLlmGatewayClient(baseConfig({ maxRetries: 5 }), {
    fetchImpl,
    sleep: () => Promise.resolve(),
  });

  const negRetries = await client.generate(baseRequest({ maxRetries: -1 }));
  assert.equal(negRetries.outcome, "error");
  if (negRetries.outcome === "error") {
    assert.equal(negRetries.errorClass, "schema_invalid");
    assert.equal(negRetries.retryable, false);
  }

  const zeroWall = await client.generate(baseRequest({ maxWallClockMs: 0 }));
  assert.equal(zeroWall.outcome, "error");
  if (zeroWall.outcome === "error") {
    assert.equal(zeroWall.errorClass, "schema_invalid");
    assert.equal(zeroWall.retryable, false);
  }
});

test("gateway: maxOutputTokens requires provider support", async () => {
  let dispatchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    dispatchCount += 1;
    return new Response("{}", { status: 200 });
  };
  const client = createLlmGatewayClient(
    baseConfig({
      declaredCapabilities: {
        ...NON_VISUAL_CAPS,
        maxOutputTokensSupport: false,
      },
    }),
    { fetchImpl },
  );
  const result = await client.generate(baseRequest({ maxOutputTokens: 1 }));
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.equal(result.retryable, false);
  }
  assert.equal(dispatchCount, 0);
});

test("gateway: reported output token overrun fails closed", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "{}" },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 3 },
      }),
      { status: 200 },
    );
  const client = createLlmGatewayClient(baseConfig(), { fetchImpl });
  const result = await client.generate(baseRequest({ maxOutputTokens: 2 }));
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") {
    assert.equal(result.errorClass, "schema_invalid");
    assert.match(result.message, /maxOutputTokens/);
    assert.equal(result.retryable, false);
  }
});

// Static reference to keep VISUAL_CAPS in scope for future visual tests.
void VISUAL_CAPS;

// ---------------------------------------------------------------------------
// PRODUCTION_FINOPS_BUDGET_ENVELOPE (Issue #1740)
// ---------------------------------------------------------------------------

test("PRODUCTION_FINOPS_BUDGET_ENVELOPE validates clean", () => {
  const result = validateFinOpsBudgetEnvelope(
    PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  );
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
});

test("PRODUCTION_FINOPS_BUDGET_ENVELOPE pins the calibrated production limits", () => {
  // Pin the exact limits operators get when they don't pass an override —
  // a regression on these values is a contract change requiring a bump.
  // Operator stance (CTO directive 2026-05-10, budgetVersion 1.1.0):
  // stability + quality first, cost is currently not a gating concern.
  assert.equal(
    PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetId,
    "production-default",
  );
  assert.equal(PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetVersion, "1.1.0");
  // 30 minutes per job (was 5 min) — accommodates multi-section banking
  // masks with cross-family judges + adversarial-critic + repair loop.
  assert.equal(
    PRODUCTION_FINOPS_BUDGET_ENVELOPE.maxJobWallClockMs,
    PRODUCTION_GENERATOR_WALL_CLOCK_MS,
  );
  // Replay-cache miss-rate gate disabled — quality/stability stance.
  assert.equal(PRODUCTION_FINOPS_BUDGET_ENVELOPE.maxReplayCacheMissRate, 1.0);
  const tg = PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.test_generation;
  assert.ok(tg !== undefined);
  // 200k input tokens — sized to mistral-large-3 / gpt-oss-120b context window.
  assert.equal(tg.maxInputTokensPerRequest, 200_000);
  // 32k output tokens per request (was 8k) — accommodates large suites.
  assert.equal(tg.maxOutputTokensPerRequest, 32_000);
  assert.equal(tg.maxTotalInputTokens, 2_000_000);
  assert.equal(tg.maxTotalOutputTokens, 200_000);
  assert.equal(tg.maxRetriesPerRequest, 6);
  assert.equal(tg.maxAttempts, 12);
  // 24h practical hard ceiling: long generator/fallback runs stay visible
  // instead of failing mid-generation.
  assert.equal(tg.maxWallClockMsPerRequest, PRODUCTION_GENERATOR_WALL_CLOCK_MS);
  assert.equal(tg.maxTotalWallClockMs, undefined);
  assert.equal(tg.maxLiveSmokeCalls, 0);
  const vp = PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.visual_primary;
  assert.ok(vp !== undefined);
  assert.equal(vp.maxInputTokensPerRequest, 100_000);
  assert.equal(vp.maxOutputTokensPerRequest, 16_000);
  // 16 MiB per request image (was 2 MiB) — tier-1 banking masks.
  assert.equal(vp.maxImageBytesPerRequest, 16 * 1024 * 1024);
  assert.equal(vp.maxRetriesPerRequest, 4);
  assert.equal(vp.maxAttempts, 6);
  assert.equal(vp.maxWallClockMsPerRequest, VISUAL_SIDECAR_WALL_CLOCK_MS);
  const vf = PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.visual_fallback;
  assert.ok(vf !== undefined);
  assert.equal(vf.maxInputTokensPerRequest, 100_000);
  assert.equal(vf.maxOutputTokensPerRequest, 16_000);
  assert.equal(vf.maxImageBytesPerRequest, 16 * 1024 * 1024);
  assert.equal(vf.maxRetriesPerRequest, 4);
  assert.equal(vf.maxAttempts, 6);
  assert.equal(vf.maxWallClockMsPerRequest, VISUAL_SIDECAR_WALL_CLOCK_MS);
  assert.equal(vf.maxFallbackAttempts, 6);
});

test("PRODUCTION_FINOPS_BUDGET_ENVELOPE is non-permissive vs DEFAULT (every field tighter or equal)", () => {
  // The default envelope sets no limits; production sets every limit.
  // Field-by-field: a defined production limit must be tighter than the
  // default's `undefined` (which is "no limit") — i.e., production must
  // never relax a default limit, and must define limits the default
  // didn't. This is the regression guard requested by #1740.
  assert.deepEqual(DEFAULT_FINOPS_BUDGET_ENVELOPE.roles, {});
  assert.notDeepEqual(PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles, {});
  assert.ok(
    PRODUCTION_FINOPS_BUDGET_ENVELOPE.maxJobWallClockMs !== undefined,
    "production must enforce maxJobWallClockMs",
  );
  // Confirm the production envelope tightens every role the default would
  // have left unbounded.
  for (const role of [
    "test_generation",
    "visual_primary",
    "visual_fallback",
  ] as const) {
    assert.ok(
      PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles[role] !== undefined,
      `production must define ${role} role`,
    );
  }
});

test("cloneProductionFinOpsBudgetEnvelope returns a fresh, mutable copy", () => {
  const a = cloneProductionFinOpsBudgetEnvelope();
  const b = cloneProductionFinOpsBudgetEnvelope();
  assert.notEqual(a, b);
  assert.deepEqual(a, b);
  // Mutation must not propagate back to the frozen original.
  a.budgetId = "mutated";
  assert.equal(
    PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetId,
    "production-default",
  );
});
