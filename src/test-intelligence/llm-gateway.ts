/**
 * LLM gateway client surface for the Figma-to-Test Wave 1 POC (Issue #1363).
 *
 * Goals enforced here:
 *   - Role separation: `test_generation` is bound to a non-multimodal
 *     deployment (e.g. `gpt-oss-120b`); image payloads sent to that role are
 *     rejected before any network call.
 *   - Failure-class disjointness: refusals, schema-invalid responses,
 *     incomplete responses, timeouts, rate limits, and transport errors are
 *     surfaced as separate `LlmGatewayErrorClass` values.
 *   - Retries only for technical failures (`transport`, `timeout`,
 *     `rate_limited`). Refusals, schema-invalid, and image-payload
 *     rejections must never retry.
 *   - Tokens stay in memory only. The factory takes an `apiKeyProvider`
 *     callback that is invoked once per request; the value is forwarded as
 *     a header and never logged, persisted, echoed in errors, or returned
 *     in success responses.
 *   - Reasoning / chain-of-thought traces are stripped before content is
 *     returned. Only the structured JSON envelope (or the raw text body
 *     when structured outputs are unsupported) reaches the caller.
 */

import * as net from "node:net";

import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import {
  ALLOWED_LLM_GATEWAY_AUTH_MODES,
  ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES,
  ALLOWED_LLM_GATEWAY_ERROR_CLASSES,
  ALLOWED_LLM_GATEWAY_ROLES,
  ALLOWED_LLM_GATEWAY_WIRE_STRUCTURED_OUTPUT_MODES,
  type AgentSourceLabel,
  type GatewayIdempotencyKey,
  type GatewayInFlightDedupInputs,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGatewayCompatibilityMode,
  type LlmGatewayErrorClass,
  type LlmGatewayRole,
  type LlmGatewayWireStructuredOutputMode,
  type LlmGenerationFailure,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type LlmGenerationSuccess,
  type LlmFinishReason,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  createLlmCircuitBreaker,
  type LlmCircuitBreaker,
  type LlmCircuitClock,
  type LlmCircuitTransitionEvent,
} from "./llm-circuit-breaker.js";
import {
  type GatewayIdempotencyMetrics,
  type LlmGatewayIdempotencyCache,
} from "./llm-gateway-idempotency.js";
import { estimateLlmInputTokens } from "./llm-token-estimator.js";

/** Stable error class with `errorClass` discriminant + retryable flag. */
export class LlmGatewayError extends Error {
  readonly errorClass: LlmGatewayErrorClass;
  readonly retryable: boolean;
  readonly attempt: number;
  constructor({
    errorClass,
    message,
    retryable,
    attempt,
    cause,
  }: {
    errorClass: LlmGatewayErrorClass;
    message: string;
    retryable: boolean;
    attempt: number;
    cause?: unknown;
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "LlmGatewayError";
    this.errorClass = errorClass;
    this.retryable = retryable;
    this.attempt = attempt;
  }
}

/** Reader for the gateway API key. Invoked once per outbound request. */
export type LlmGatewayApiKeyProvider = () =>
  | string
  | undefined
  | Promise<string | undefined>;

export interface LlmGatewayRuntime {
  fetchImpl?: typeof fetch;
  clock?: LlmCircuitClock;
  /** Source of the API key for `api_key` / `bearer_token` auth modes. */
  apiKeyProvider?: LlmGatewayApiKeyProvider;
  /** Sleep helper for retry backoff. Defaults to `setTimeout` Promise. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Backoff schedule for retryable failures, in milliseconds. Index `i`
   * gives the wait between attempt `i+1` and attempt `i+2`. Falls back to
   * exponential 100/200/400/...ms (capped) when not provided.
   */
  retryBackoffMs?: ReadonlyArray<number>;
  onCircuitTransition?: (event: LlmCircuitTransitionEvent) => void;
  /**
   * Optional gateway-side idempotency cache (Issue #1784). When supplied
   * AND the per-request `LlmGenerationRequest.idempotency` envelope is
   * also set, the gateway computes the HMAC of those inputs (using the
   * cache's operator-configured secret), looks up the TTL-bounded
   * cache, and returns the cached structured success on a hit without
   * dispatching a second LLM call. A hit increments the cache's
   * `replays` counter so downstream FinOps can roll up
   * `gateway_idempotent_replay` separately from
   * `replay_cache_hit`. The HMAC secret stays inside the cache instance
   * and is never exposed via this runtime or persisted to artifacts.
   */
  idempotencyCache?: LlmGatewayIdempotencyCache;
  /**
   * Optional callback fired when a concurrent request joins an existing
   * in-flight Promise for the same `request.inFlightDedup` key.
   */
  onInFlightDedupHit?: (source: AgentSourceLabel) => void;
}

export interface LlmGatewayClient {
  readonly role: LlmGatewayRole;
  readonly compatibilityMode: LlmGatewayCompatibilityMode;
  readonly deployment: string;
  readonly modelRevision: string;
  readonly gatewayRelease: string;
  readonly modelWeightsSha256: string | undefined;
  readonly declaredCapabilities: Readonly<LlmGatewayCapabilities>;
  generate(request: LlmGenerationRequest): Promise<LlmGenerationResult>;
  getCircuitBreaker(): LlmCircuitBreaker;
  /**
   * Snapshot of the per-client idempotency cache counters (Issue #1784).
   * Returns `undefined` when no `runtime.idempotencyCache` was wired in
   * — operators can use that to detect a misconfigured client (the
   * harness expects every gateway client to carry an idempotency cache
   * outside dry-run mode).
   */
  getIdempotencyMetrics(): GatewayIdempotencyMetrics | undefined;
}

interface LlmGenerationRequestInternal extends LlmGenerationRequest {
  onInFlightDedupHit?: (source: AgentSourceLabel) => void;
}

const DEFAULT_BACKOFF_MS: ReadonlyArray<number> = [100, 200, 400, 800, 1600];
const MAX_REDACTED_MESSAGE_LENGTH = 240;
/**
 * Default ceiling on a gateway response body, in bytes. Covers a worst-case
 * structured envelope (≈4k cases × ≈1.5 KiB each) with headroom and stays an
 * order of magnitude below typical Node heap sizes so a runaway stream can
 * never exhaust memory. Operators can lower or raise the cap per client via
 * `LlmGatewayClientConfig.maxResponseBytes` (Issue #1414).
 */
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Construct an LLM gateway client. The factory validates the configuration
 * eagerly so misconfigurations surface at startup, not at the first call.
 */
export const createLlmGatewayClient = (
  config: LlmGatewayClientConfig,
  runtime: LlmGatewayRuntime = {},
): LlmGatewayClient => {
  validateConfig(config);

  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = runtime.sleep ?? defaultSleep;
  const backoff = runtime.retryBackoffMs ?? DEFAULT_BACKOFF_MS;
  const inFlightRequests = new Map<string, Promise<LlmGenerationResult>>();
  const breaker = createLlmCircuitBreaker({
    failureThreshold: config.circuitBreaker.failureThreshold,
    resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
    ...(runtime.clock !== undefined ? { clock: runtime.clock } : {}),
    ...(runtime.onCircuitTransition !== undefined
      ? { onStateTransition: runtime.onCircuitTransition }
      : {}),
  });

  const generateUncached = async (
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult> => {
    const guardError = guardImagePayload(config.role, request);
    if (guardError !== undefined) return guardError;
    const budgetError = guardInputBudget(request);
    if (budgetError !== undefined) return budgetError;
    const wallClockError = guardWallClockBudget(request);
    if (wallClockError !== undefined) return wallClockError;
    const retriesError = guardMaxRetriesBudget(request);
    if (retriesError !== undefined) return retriesError;
    const outputBudgetError = guardOutputBudgetSupport(config, request);
    if (outputBudgetError !== undefined) return outputBudgetError;

    // Issue #1784: gateway-side idempotency keys (HMAC + TTL). When a
    // cache is wired AND the per-request inputs are present, we look up
    // the cache before attempting any dispatch. A hit returns the
    // cached structured success and counts as `gateway_idempotent_replay`
    // in FinOps; a miss carries the precomputed key forward so we can
    // store the result on success without recomputing the HMAC.
    const idempotencyCache = runtime.idempotencyCache;
    const idempotencyInputs = request.idempotency;
    let pendingIdempotencyKey:
      | { hmac: string; key: GatewayIdempotencyKey }
      | undefined;
    if (idempotencyCache !== undefined && idempotencyInputs !== undefined) {
      let lookup;
      try {
        lookup = await idempotencyCache.lookup(idempotencyInputs);
      } catch (err) {
        return {
          outcome: "error",
          errorClass: "schema_invalid",
          message: redactBoundedMessage(
            sanitizeErrorMessage({
              error: err,
              fallback: "idempotency lookup failed",
            }),
          ),
          retryable: false,
          attempt: 0,
        };
      }
      if (lookup.hit) {
        return lookup.result;
      }
      pendingIdempotencyKey = { hmac: lookup.key.hmac, key: lookup.key };
    }

    // Per-request retry cap (Issue #1371): operator may pin a tighter cap
    // for a single job without rebuilding the client. The effective cap is
    // the minimum of the static config and the per-request request value.
    const effectiveRetries =
      request.maxRetries !== undefined
        ? Math.min(config.maxRetries, request.maxRetries)
        : config.maxRetries;
    const maxAttempts = Math.max(1, effectiveRetries + 1);
    let lastFailure: LlmGenerationFailure | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const decision = breaker.beforeRequest();
      if (!decision.allowRequest) {
        return {
          outcome: "error",
          errorClass: "transport",
          message: `circuit breaker is ${decision.snapshot.state}`,
          retryable: false,
          attempt,
        };
      }

      let result: LlmGenerationResult;
      try {
        result = await dispatchOnce({
          attempt,
          config,
          request,
          fetchImpl,
          apiKeyProvider: runtime.apiKeyProvider,
        });
      } catch (err) {
        result = {
          outcome: "error",
          errorClass: "transport",
          message: redactBoundedMessage(
            sanitizeErrorMessage({
              error: err,
              fallback: "transport failure",
            }),
          ),
          retryable: true,
          attempt,
        };
      }

      if (result.outcome === "success") {
        breaker.recordSuccess();
        if (
          idempotencyCache !== undefined &&
          pendingIdempotencyKey !== undefined
        ) {
          // Best-effort store: a disk-write failure is observable via
          // `getMetrics().diskWriteFailures` but must not turn a
          // successful gateway response into a caller-visible failure.
          // The in-memory entry is still admitted, so a same-process
          // replay succeeds even when disk persistence does not.
          try {
            await idempotencyCache.store(pendingIdempotencyKey.key, result);
          } catch {
            // Counters already reflect the failure; swallow here.
          }
        }
        return result;
      }

      // Failure path. Decide whether to feed the breaker a transient signal
      // or a non-transient (policy) signal.
      if (result.retryable && isTransientFailure(result.errorClass)) {
        breaker.recordTransientFailure();
      } else {
        breaker.recordNonTransientOutcome();
      }

      lastFailure = result;

      if (!result.retryable || attempt >= maxAttempts) {
        return result;
      }

      const waitMs = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 0;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    return (
      lastFailure ?? {
        outcome: "error",
        errorClass: "transport",
        message: "no attempts executed",
        retryable: false,
        attempt: 0,
      }
    );
  };

  const generate = async (
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult> => {
    const requestInternal = request as LlmGenerationRequestInternal;
    const dedupInputs = request.inFlightDedup;
    if (dedupInputs === undefined) {
      return generateUncached(request);
    }

    let dedupKey: string;
    try {
      dedupKey = buildInFlightDedupKey(dedupInputs);
    } catch (err) {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message: redactBoundedMessage(
          sanitizeErrorMessage({
            error: err,
            fallback: "in-flight dedup key rejected",
          }),
        ),
        retryable: false,
        attempt: 0,
      };
    }

    const existing = inFlightRequests.get(dedupKey);
    if (existing !== undefined) {
      if (dedupInputs.source !== undefined) {
        requestInternal.onInFlightDedupHit?.(dedupInputs.source);
        runtime.onInFlightDedupHit?.(dedupInputs.source);
      }
      return existing;
    }

    const pending = generateUncached(request);
    inFlightRequests.set(dedupKey, pending);
    try {
      return await pending;
    } finally {
      if (inFlightRequests.get(dedupKey) === pending) {
        inFlightRequests.delete(dedupKey);
      }
    }
  };

  return {
    role: config.role,
    compatibilityMode: config.compatibilityMode,
    deployment: config.deployment,
    modelRevision: config.modelRevision,
    gatewayRelease: config.gatewayRelease,
    modelWeightsSha256: config.modelWeightsSha256,
    declaredCapabilities: { ...config.declaredCapabilities },
    generate,
    getCircuitBreaker: () => breaker,
    getIdempotencyMetrics: () =>
      runtime.idempotencyCache?.getMetrics(),
  };
};

const HEX64_RE = /^[0-9a-f]{64}$/u;

const buildInFlightDedupKey = (input: GatewayInFlightDedupInputs): string => {
  if (!HEX64_RE.test(input.promptHash)) {
    throw new RangeError("promptHash must be a 64-char lowercase hex digest");
  }
  if (
    typeof input.modelBinding !== "string" ||
    input.modelBinding.trim().length === 0
  ) {
    throw new RangeError("modelBinding must be a non-empty string");
  }
  if (!HEX64_RE.test(input.schemaHash)) {
    throw new RangeError("schemaHash must be a 64-char lowercase hex digest");
  }
  if (!HEX64_RE.test(input.policyProfileHash)) {
    throw new RangeError(
      "policyProfileHash must be a 64-char lowercase hex digest",
    );
  }
  if (
    input.source !== undefined &&
    (typeof input.source !== "string" || input.source.length === 0)
  ) {
    throw new RangeError("source must be a non-empty string when provided");
  }
  return canonicalJson({
    promptHash: input.promptHash,
    modelBinding: input.modelBinding,
    schemaHash: input.schemaHash,
    policyProfileHash: input.policyProfileHash,
  });
};

const guardImagePayload = (
  role: LlmGatewayRole,
  request: LlmGenerationRequest,
): LlmGenerationFailure | undefined => {
  if (role === "test_generation" && (request.imageInputs?.length ?? 0) > 0) {
    return {
      outcome: "error",
      errorClass: "image_payload_rejected",
      message:
        "test_generation role refuses image payloads; route screenshots through a visual sidecar role",
      retryable: false,
      attempt: 0,
    };
  }
  return undefined;
};

const guardInputBudget = (
  request: LlmGenerationRequest,
): LlmGenerationFailure | undefined => {
  if (request.maxInputTokens === undefined) return undefined;
  if (
    !Number.isSafeInteger(request.maxInputTokens) ||
    request.maxInputTokens <= 0
  ) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "maxInputTokens must be a positive integer",
      retryable: false,
      attempt: 0,
    };
  }
  const estimatedTokens = estimateLlmInputTokens(request);
  if (estimatedTokens > request.maxInputTokens) {
    return {
      outcome: "error",
      errorClass: "input_budget_exceeded",
      message: `estimated input tokens ${estimatedTokens} exceeds maxInputTokens ${request.maxInputTokens}`,
      retryable: false,
      attempt: 0,
    };
  }
  return undefined;
};

/**
 * Validate `request.maxWallClockMs`. The wall-clock budget itself is enforced
 * inside `dispatchOnce` against an `AbortController`; this guard only rejects
 * malformed values up-front so the gateway never starts a request with a
 * structurally invalid budget (Issue #1371).
 */
const guardWallClockBudget = (
  request: LlmGenerationRequest,
): LlmGenerationFailure | undefined => {
  if (request.maxWallClockMs === undefined) return undefined;
  if (
    !Number.isSafeInteger(request.maxWallClockMs) ||
    request.maxWallClockMs <= 0
  ) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "maxWallClockMs must be a positive integer",
      retryable: false,
      attempt: 0,
    };
  }
  return undefined;
};

/**
 * Validate `request.maxRetries`. The cap is applied via `Math.min` against
 * the client config inside `generate`; this guard only rejects malformed
 * values up-front (Issue #1371).
 */
const guardMaxRetriesBudget = (
  request: LlmGenerationRequest,
): LlmGenerationFailure | undefined => {
  if (request.maxRetries === undefined) return undefined;
  if (!Number.isSafeInteger(request.maxRetries) || request.maxRetries < 0) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "maxRetries must be a non-negative integer",
      retryable: false,
      attempt: 0,
    };
  }
  return undefined;
};

const guardOutputBudgetSupport = (
  config: LlmGatewayClientConfig,
  request: LlmGenerationRequest,
): LlmGenerationFailure | undefined => {
  if (request.maxOutputTokens === undefined) return undefined;
  if (
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens <= 0
  ) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "maxOutputTokens must be a positive integer",
      retryable: false,
      attempt: 0,
    };
  }
  if (!config.declaredCapabilities.maxOutputTokensSupport) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message:
        "maxOutputTokens budget requires a deployment with maxOutputTokensSupport",
      retryable: false,
      attempt: 0,
    };
  }
  return undefined;
};

const isTransientFailure = (errorClass: LlmGatewayErrorClass): boolean => {
  return (
    errorClass === "timeout" ||
    errorClass === "transport" ||
    errorClass === "rate_limited"
  );
};

const isAbortLikeError = (err: unknown): boolean =>
  err instanceof Error &&
  (err.name === "AbortError" || /aborted/i.test(err.message));

const timeoutFailure = (input: {
  wallClockBudgetCausedTimeout: boolean;
  effectiveTimeoutMs: number;
  attempt: number;
}): LlmGenerationFailure => {
  if (input.wallClockBudgetCausedTimeout) {
    return {
      outcome: "error",
      errorClass: "timeout",
      message: `request exceeded maxWallClockMs ${input.effectiveTimeoutMs}ms`,
      retryable: false,
      attempt: input.attempt,
    };
  }
  return {
    outcome: "error",
    errorClass: "timeout",
    message: `request timed out after ${input.effectiveTimeoutMs}ms`,
    retryable: true,
    attempt: input.attempt,
  };
};

const dispatchOnce = async ({
  attempt,
  config,
  request,
  fetchImpl,
  apiKeyProvider,
}: {
  attempt: number;
  config: LlmGatewayClientConfig;
  request: LlmGenerationRequest;
  fetchImpl: typeof fetch;
  apiKeyProvider: LlmGatewayApiKeyProvider | undefined;
}): Promise<LlmGenerationResult> => {
  // Compatibility mode is enforced eagerly in `validateConfig`; the type
  // system narrows it to the only currently-supported wire protocol here.
  const url = buildOpenAiChatUrl(config.baseUrl);
  const body = buildOpenAiChatBody(config, request);
  const headers = await buildAuthHeaders(config, apiKeyProvider, attempt);
  if ("error" in headers) return headers.error;

  // Per-request wall-clock budget overrides the static client timeout when
  // it is smaller. When the breach is attributed to the per-request budget
  // we mark `retryable: false` (FinOps fail-closed semantics — Issue #1371)
  // because retrying would by definition violate the same budget.
  const requestMaxWallClockMs = request.maxWallClockMs;
  const useRequestBudget =
    requestMaxWallClockMs !== undefined &&
    requestMaxWallClockMs < config.timeoutMs;
  const effectiveTimeoutMs = useRequestBudget
    ? requestMaxWallClockMs
    : config.timeoutMs;
  const wallClockBudgetCausedTimeout = useRequestBudget;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  // Issue #1694 (audit-2026-05 Wave 2): compose the per-request timeout
  // signal with the caller-supplied `request.abortSignal` (typically the
  // job-engine's `jobAbortController.signal`) so cancelling the job aborts
  // the in-flight LLM call instead of waiting for the timeout to fire.
  const upstreamSignal = request.abortSignal;
  const fetchSignal: AbortSignal = upstreamSignal
    ? AbortSignal.any([upstreamSignal, controller.signal])
    : controller.signal;
  const upstreamWasAborted = (): boolean =>
    upstreamSignal !== undefined && upstreamSignal.aborted;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: headers.headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: fetchSignal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (isAbortLikeError(err)) {
      // Distinguish caller-cancellation from per-request timeout. If the
      // upstream signal fired, surface "canceled" (not retryable, not a
      // breaker-recordable transient). Otherwise the controller fired due
      // to `effectiveTimeoutMs` and we surface "timeout".
      if (upstreamWasAborted()) {
        return {
          outcome: "error",
          errorClass: "canceled",
          message: "caller-supplied abortSignal aborted the request",
          retryable: false,
          attempt,
        };
      }
      return timeoutFailure({
        wallClockBudgetCausedTimeout,
        effectiveTimeoutMs,
        attempt,
      });
    }
    return {
      outcome: "error",
      errorClass: "transport",
      message: redactBoundedMessage(
        sanitizeErrorMessage({ error: err, fallback: "transport failure" }),
      ),
      retryable: true,
      attempt,
    };
  }

  try {
    return await parseOpenAiChatResponse({
      response,
      config,
      request,
      attempt,
      effectiveTimeoutMs,
      wallClockBudgetCausedTimeout,
    });
  } finally {
    clearTimeout(timer);
  }
};

const buildOpenAiChatUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${trimmed}/chat/completions`;
};

interface OpenAiChatBody {
  model: string;
  messages: ReadonlyArray<{ role: string; content: unknown }>;
  response_format?:
    | {
        type: "json_schema";
        json_schema: { name: string; schema: Record<string, unknown> };
      }
    | { type: "json_object" };
  seed?: number;
  reasoning_effort?: "low" | "medium" | "high";
  max_completion_tokens?: number;
  stream?: boolean;
}

const DEFAULT_WIRE_STRUCTURED_OUTPUT_MODE: LlmGatewayWireStructuredOutputMode =
  "json_schema";

const resolveWireMode = (
  config: LlmGatewayClientConfig,
): LlmGatewayWireStructuredOutputMode =>
  config.wireStructuredOutputMode ?? DEFAULT_WIRE_STRUCTURED_OUTPUT_MODE;

const buildOpenAiChatBody = (
  config: LlmGatewayClientConfig,
  request: LlmGenerationRequest,
): OpenAiChatBody => {
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: request.systemPrompt },
  ];

  const hasImages = (request.imageInputs?.length ?? 0) > 0;
  if (hasImages && config.declaredCapabilities.imageInputSupport) {
    const parts: Array<Record<string, unknown>> = [
      { type: "text", text: request.userPrompt },
    ];
    for (const image of request.imageInputs ?? []) {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${image.mimeType};base64,${image.base64Data}`,
        },
      });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: request.userPrompt });
  }

  const body: OpenAiChatBody = {
    model: config.deployment,
    messages,
    stream: false,
  };
  const responseSchema = request.responseSchema;
  const responseSchemaName = request.responseSchemaName;
  if (
    config.declaredCapabilities.structuredOutputs &&
    responseSchema !== undefined &&
    responseSchemaName !== undefined
  ) {
    const wireMode = resolveWireMode(config);
    if (wireMode === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: responseSchemaName,
          schema: responseSchema,
        },
      };
    } else if (wireMode === "json_object") {
      body.response_format = { type: "json_object" };
    }
    // wireMode === "none": omit response_format entirely. The gateway still
    // parses + schema-validates `content` in-process below, so the
    // structured-output success contract is preserved.
  }
  if (config.declaredCapabilities.seedSupport && request.seed !== undefined) {
    body.seed = request.seed;
  }
  if (
    config.declaredCapabilities.reasoningEffortSupport &&
    request.reasoningEffort !== undefined
  ) {
    body.reasoning_effort = request.reasoningEffort;
  }
  if (
    config.declaredCapabilities.maxOutputTokensSupport &&
    request.maxOutputTokens !== undefined
  ) {
    body.max_completion_tokens = request.maxOutputTokens;
  }
  return body;
};

const isStructuredOutputRequested = (
  config: LlmGatewayClientConfig,
  request: LlmGenerationRequest,
): boolean =>
  config.declaredCapabilities.structuredOutputs &&
  request.responseSchema !== undefined &&
  request.responseSchemaName !== undefined;

const buildAuthHeaders = async (
  config: LlmGatewayClientConfig,
  apiKeyProvider: LlmGatewayApiKeyProvider | undefined,
  attempt: number,
): Promise<
  { headers: Record<string, string> } | { error: LlmGenerationFailure }
> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  if (config.authMode === "none") {
    return { headers };
  }

  if (apiKeyProvider === undefined) {
    return {
      error: {
        outcome: "error",
        errorClass: "transport",
        message:
          "auth mode requires apiKeyProvider but none was supplied to runtime",
        retryable: false,
        attempt,
      },
    };
  }
  const provided = await apiKeyProvider();
  if (typeof provided !== "string" || provided.length === 0) {
    return {
      error: {
        outcome: "error",
        errorClass: "transport",
        message: "apiKeyProvider returned an empty value",
        retryable: false,
        attempt,
      },
    };
  }

  if (config.authMode === "api_key") {
    headers["api-key"] = provided;
  } else {
    headers["authorization"] = `Bearer ${provided}`;
  }
  return { headers };
};

const parseOpenAiChatResponse = async ({
  response,
  config,
  request,
  attempt,
  effectiveTimeoutMs,
  wallClockBudgetCausedTimeout,
}: {
  response: Response;
  config: LlmGatewayClientConfig;
  request: LlmGenerationRequest;
  attempt: number;
  effectiveTimeoutMs: number;
  wallClockBudgetCausedTimeout: boolean;
}): Promise<LlmGenerationResult> => {
  const status = response.status;
  if (status === 429) {
    await cancelResponseBody(response);
    return {
      outcome: "error",
      errorClass: "rate_limited",
      message: `rate limited (status 429)`,
      retryable: true,
      attempt,
    };
  }
  if (status >= 500 && status <= 599) {
    await cancelResponseBody(response);
    return {
      outcome: "error",
      errorClass: "transport",
      message: `gateway returned ${status}`,
      retryable: true,
      attempt,
    };
  }
  if (status === 408) {
    await cancelResponseBody(response);
    return {
      outcome: "error",
      errorClass: "timeout",
      message: `gateway returned 408`,
      retryable: true,
      attempt,
    };
  }

  let bodyText: string;
  const maxResponseBytes =
    config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  try {
    const readResult = await readResponseTextWithLimit(
      response,
      maxResponseBytes,
    );
    if (!readResult.ok) {
      return {
        outcome: "error",
        errorClass: "response_too_large",
        message: `response body exceeds maxResponseBytes ${maxResponseBytes}`,
        retryable: false,
        attempt,
      };
    }
    bodyText = readResult.text;
  } catch (err) {
    if (isAbortLikeError(err)) {
      return timeoutFailure({
        wallClockBudgetCausedTimeout,
        effectiveTimeoutMs,
        attempt,
      });
    }
    return {
      outcome: "error",
      errorClass: "transport",
      message: redactBoundedMessage(
        sanitizeErrorMessage({ error: err, fallback: "response read failure" }),
      ),
      retryable: true,
      attempt,
    };
  }

  if (status >= 400) {
    // Issue #1703 (audit-2026-05 Wave 2): separate protocol-level failures
    // from schema_invalid. Auth/authz/proxy/conflict statuses indicate the
    // gateway endpoint or credentials are misconfigured — surfacing them
    // as `schema_invalid` previously confused dashboards and runbooks
    // (operators would chase a model-output bug when the cause was a key
    // rotation or routing regression). Distinct mapping:
    //   401, 403, 407         -> protocol  (auth / proxy auth)
    //   404, 405, 410         -> protocol  (endpoint / verb / gone)
    //   400, 409, 412, 422,
    //   415, 416, 417         -> schema_invalid  (payload / state / contract)
    //   any other 4xx         -> protocol  (default to operator-actionable)
    const PROTOCOL_STATUSES = new Set([401, 403, 407, 404, 405, 410]);
    const SCHEMA_INVALID_STATUSES = new Set([
      400, 409, 412, 415, 416, 417, 422,
    ]);
    const errorClass: LlmGatewayErrorClass = PROTOCOL_STATUSES.has(status)
      ? "protocol"
      : SCHEMA_INVALID_STATUSES.has(status)
        ? "schema_invalid"
        : "protocol";
    return {
      outcome: "error",
      errorClass,
      message: `gateway returned ${status}: ${redactBoundedMessage(bodyText)}`,
      retryable: false,
      attempt,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "response body is not valid JSON",
      retryable: false,
      attempt,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "response body is not a JSON object",
      retryable: false,
      attempt,
    };
  }

  const envelope = parsed as Record<string, unknown>;
  const rawChoices = envelope["choices"];
  if (!Array.isArray(rawChoices) || rawChoices.length === 0) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "response missing non-empty choices array",
      retryable: false,
      attempt,
    };
  }
  const choices: ReadonlyArray<unknown> = rawChoices as ReadonlyArray<unknown>;
  const firstChoice: unknown = choices[0];
  if (typeof firstChoice !== "object" || firstChoice === null) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "first choice is not an object",
      retryable: false,
      attempt,
    };
  }
  const choice = firstChoice as Record<string, unknown>;
  const finishReason = normalizeFinishReason(choice["finish_reason"]);

  if (finishReason === "content_filter") {
    return {
      outcome: "error",
      errorClass: "refusal",
      message: "model refused via content_filter",
      retryable: false,
      attempt,
    };
  }

  const messageRaw = choice["message"];
  if (typeof messageRaw !== "object" || messageRaw === null) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "first choice missing message object",
      retryable: false,
      attempt,
    };
  }
  const message = messageRaw as Record<string, unknown>;

  const refusal = message["refusal"];
  if (typeof refusal === "string" && refusal.length > 0) {
    return {
      outcome: "error",
      errorClass: "refusal",
      message: `model refusal: ${redactBoundedMessage(refusal)}`,
      retryable: false,
      attempt,
    };
  }

  if (finishReason === "tool_calls") {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "tool-call responses are not supported by the LLM gateway",
      retryable: false,
      attempt,
    };
  }

  const rawContent = message["content"];
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
      message: "message.content missing or empty",
      retryable: false,
      attempt,
    };
  }

  if (finishReason === "length") {
    return {
      outcome: "error",
      errorClass: "incomplete",
      message: "response truncated by length limit",
      retryable: false,
      attempt,
    };
  }

  // Structured outputs path: caller passed a schema, so the body must parse
  // as JSON and we surface that as `content`. The raw text body is omitted
  // from the success record because (a) it is redundant and (b) some
  // providers smuggle reasoning text in adjacent fields that must never be
  // persisted.
  let content: unknown;
  let rawTextContent: string | undefined;
  if (isStructuredOutputRequested(config, request)) {
    try {
      content = JSON.parse(rawContent) as unknown;
    } catch {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message: "structured-output content is not valid JSON",
        retryable: false,
        attempt,
      };
    }
    const schemaViolation = validateJsonSchemaSubset(
      content,
      request.responseSchema,
    );
    if (schemaViolation !== undefined) {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message: `structured-output content violates response schema: ${schemaViolation}`,
        retryable: false,
        attempt,
      };
    }
  } else {
    content = rawContent;
    rawTextContent = rawContent;
  }

  const usage = envelope["usage"];
  const usageRecord =
    typeof usage === "object" && usage !== null
      ? (usage as Record<string, unknown>)
      : {};
  const outputTokens = usageRecord["completion_tokens"];
  if (request.maxOutputTokens !== undefined) {
    if (typeof outputTokens !== "number") {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message:
          "maxOutputTokens budget requires completion_tokens usage from the gateway",
        retryable: false,
        attempt,
      };
    }
    if (outputTokens > request.maxOutputTokens) {
      return {
        outcome: "error",
        errorClass: "schema_invalid",
        message: `reported output tokens ${outputTokens} exceeds maxOutputTokens ${request.maxOutputTokens}`,
        retryable: false,
        attempt,
      };
    }
  }

  const success: LlmGenerationSuccess = {
    outcome: "success",
    content,
    finishReason,
    usage: {
      ...(typeof usageRecord["prompt_tokens"] === "number"
        ? { inputTokens: usageRecord["prompt_tokens"] }
        : {}),
      ...(typeof usageRecord["completion_tokens"] === "number"
        ? { outputTokens: usageRecord["completion_tokens"] }
        : {}),
    },
    modelDeployment: config.deployment,
    modelRevision: config.modelRevision,
    gatewayRelease: config.gatewayRelease,
    attempt,
  };
  if (rawTextContent !== undefined) {
    success.rawTextContent = rawTextContent;
  }
  return success;
};

const readResponseTextWithLimit = async (
  response: Response,
  maxResponseBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> => {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maxResponseBytes) {
      await cancelResponseBody(response);
      return { ok: false };
    }
  }

  if (response.body === null) {
    const text = await response.text();
    // Issue #1693: same allocation-free byte-length path as estimateInputTokens.
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) {
      return { ok: false };
    }
    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maxResponseBytes) {
      await reader.cancel();
      return { ok: false };
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
};

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort resource release only; preserve the primary gateway result.
  }
};

const validateJsonSchemaSubset = (
  value: unknown,
  schema: Record<string, unknown> | undefined,
  path = "$",
): string | undefined => {
  if (schema === undefined) return undefined;

  const constValue = schema["const"];
  if (constValue !== undefined && !Object.is(value, constValue)) {
    return `${path} must equal ${JSON.stringify(constValue)}`;
  }

  const enumValues = schema["enum"];
  if (
    Array.isArray(enumValues) &&
    !enumValues.some((item) => Object.is(item, value))
  ) {
    return `${path} must be one of the allowed enum values`;
  }

  const type = schema["type"];
  if (typeof type === "string") {
    const typeError = validateJsonSchemaType(value, type, path);
    if (typeError !== undefined) return typeError;
  }

  if (type === "object") {
    const record =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    if (record === undefined) return `${path} must be an object`;

    const required = schema["required"];
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key === "string" && !(key in record)) {
          return `${path}.${key} is required`;
        }
      }
    }

    const properties = schema["properties"];
    if (
      typeof properties === "object" &&
      properties !== null &&
      !Array.isArray(properties)
    ) {
      const propertySchemas = properties as Record<string, unknown>;
      for (const [key, propertySchema] of Object.entries(propertySchemas)) {
        if (
          key in record &&
          typeof propertySchema === "object" &&
          propertySchema !== null &&
          !Array.isArray(propertySchema)
        ) {
          const nested = validateJsonSchemaSubset(
            record[key],
            propertySchema as Record<string, unknown>,
            `${path}.${key}`,
          );
          if (nested !== undefined) return nested;
        }
      }
    }

    if (schema["additionalProperties"] === false) {
      const allowed = new Set(
        typeof properties === "object" &&
          properties !== null &&
          !Array.isArray(properties)
          ? Object.keys(properties)
          : [],
      );
      for (const key of Object.keys(record)) {
        if (!allowed.has(key)) return `${path}.${key} is not allowed`;
      }
    }
  }

  if (type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    const minItems = schema["minItems"];
    if (typeof minItems === "number" && value.length < minItems) {
      return `${path} must contain at least ${minItems} items`;
    }
    const items = schema["items"];
    if (typeof items === "object" && items !== null && !Array.isArray(items)) {
      for (let index = 0; index < value.length; index += 1) {
        const nested = validateJsonSchemaSubset(
          value[index],
          items as Record<string, unknown>,
          `${path}[${index}]`,
        );
        if (nested !== undefined) return nested;
      }
    }
  }

  if (typeof value === "string") {
    const minLength = schema["minLength"];
    if (typeof minLength === "number" && value.length < minLength) {
      return `${path} must be at least ${minLength} characters`;
    }
    const maxLength = schema["maxLength"];
    if (typeof maxLength === "number" && value.length > maxLength) {
      return `${path} must be at most ${maxLength} characters`;
    }
    const pattern = schema["pattern"];
    if (typeof pattern === "string" && !new RegExp(pattern).test(value)) {
      return `${path} must match ${pattern}`;
    }
  }

  if (typeof value === "number") {
    const minimum = schema["minimum"];
    if (typeof minimum === "number" && value < minimum) {
      return `${path} must be >= ${minimum}`;
    }
    const maximum = schema["maximum"];
    if (typeof maximum === "number" && value > maximum) {
      return `${path} must be <= ${maximum}`;
    }
  }

  return undefined;
};

const validateJsonSchemaType = (
  value: unknown,
  type: string,
  path: string,
): string | undefined => {
  switch (type) {
    case "object":
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? undefined
        : `${path} must be an object`;
    case "array":
      return Array.isArray(value) ? undefined : `${path} must be an array`;
    case "string":
      return typeof value === "string" ? undefined : `${path} must be a string`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? undefined
        : `${path} must be a number`;
    case "integer":
      return Number.isInteger(value) ? undefined : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${path} must be a boolean`;
    case "null":
      return value === null ? undefined : `${path} must be null`;
    default:
      return undefined;
  }
};

const normalizeFinishReason = (value: unknown): LlmFinishReason => {
  if (typeof value !== "string") return "other";
  switch (value) {
    case "stop":
    case "length":
    case "content_filter":
    case "tool_calls":
      return value;
    default:
      return "other";
  }
};

/**
 * Bounded, secret-redacted message helper. Inputs are passed through
 * `redactHighRiskSecrets` (header/token forms) and truncated to keep error
 * payloads from becoming exfil channels for opaque tokens.
 */
const redactBoundedMessage = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_REDACTED_MESSAGE_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_REDACTED_MESSAGE_LENGTH)}...`;
};

const validateConfig = (config: LlmGatewayClientConfig): void => {
  if (!ALLOWED_LLM_GATEWAY_ROLES.includes(config.role)) {
    throw new RangeError(`LlmGatewayClient: invalid role "${config.role}"`);
  }
  if (
    !ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES.includes(config.compatibilityMode)
  ) {
    throw new RangeError(
      `LlmGatewayClient: unsupported compatibility mode "${config.compatibilityMode}"`,
    );
  }
  if (!ALLOWED_LLM_GATEWAY_AUTH_MODES.includes(config.authMode)) {
    throw new RangeError(
      `LlmGatewayClient: invalid auth mode "${config.authMode}"`,
    );
  }
  assertNonEmpty(config.baseUrl, "baseUrl");
  validateGatewayBaseUrl(config.baseUrl);
  assertNonEmpty(config.deployment, "deployment");
  assertNonEmpty(config.modelRevision, "modelRevision");
  assertNonEmpty(config.gatewayRelease, "gatewayRelease");
  if (
    config.modelWeightsSha256 !== undefined &&
    !/^[0-9a-f]{64}$/.test(config.modelWeightsSha256)
  ) {
    throw new RangeError(
      "LlmGatewayClient: modelWeightsSha256 must be 64 lowercase hex chars",
    );
  }
  if (
    config.role === "test_generation" &&
    config.declaredCapabilities.imageInputSupport
  ) {
    throw new RangeError(
      "LlmGatewayClient: test_generation role must not declare imageInputSupport",
    );
  }
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new RangeError(
      "LlmGatewayClient: timeoutMs must be a positive number",
    );
  }
  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) {
    throw new RangeError(
      "LlmGatewayClient: maxRetries must be a non-negative integer",
    );
  }
  if (
    !Number.isInteger(config.circuitBreaker.failureThreshold) ||
    config.circuitBreaker.failureThreshold < 1
  ) {
    throw new RangeError(
      "LlmGatewayClient: circuitBreaker.failureThreshold must be a positive integer",
    );
  }
  if (
    !Number.isFinite(config.circuitBreaker.resetTimeoutMs) ||
    config.circuitBreaker.resetTimeoutMs < 0
  ) {
    throw new RangeError(
      "LlmGatewayClient: circuitBreaker.resetTimeoutMs must be non-negative",
    );
  }
  if (
    config.maxResponseBytes !== undefined &&
    (!Number.isSafeInteger(config.maxResponseBytes) ||
      config.maxResponseBytes <= 0)
  ) {
    throw new RangeError(
      "LlmGatewayClient: maxResponseBytes must be a positive integer",
    );
  }
  if (
    config.wireStructuredOutputMode !== undefined &&
    !ALLOWED_LLM_GATEWAY_WIRE_STRUCTURED_OUTPUT_MODES.includes(
      config.wireStructuredOutputMode,
    )
  ) {
    throw new RangeError(
      `LlmGatewayClient: invalid wireStructuredOutputMode "${config.wireStructuredOutputMode}"`,
    );
  }
};

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(
      `LlmGatewayClient: ${field} must be a non-empty string`,
    );
  }
};

/**
 * Issue #1682 (audit-2026-05 Wave 1): SSRF / token-leak hardening for the
 * LLM-gateway `baseUrl`. Mirrors the guard already enforced on the Jira
 * gateway. Fails closed at construction time so a misconfigured deployment
 * cannot reach internal services with the bearer token attached.
 */
const isPrivateIpHost = (host: string): boolean => {
  const unbracketed = host.replace(/^\[/u, "").replace(/\]$/u, "");
  if (net.isIPv6(unbracketed)) {
    // Conservative: treat any IPv6 literal as private/blocked. Operators that
    // need an IPv6 endpoint should use the corresponding DNS name.
    return true;
  }
  if (!net.isIPv4(unbracketed)) {
    return false;
  }
  const parts = unbracketed.split(".").map((part) => Number.parseInt(part, 10));
  const first = parts[0];
  const second = parts[1];
  if (first === undefined || second === undefined) {
    return true;
  }
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  return false;
};

const validateGatewayBaseUrl = (baseUrl: string): void => {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RangeError("LlmGatewayClient: baseUrl is not a valid URL");
  }
  if (parsed.protocol !== "https:") {
    throw new RangeError(
      "LlmGatewayClient: baseUrl must use https:// (plain HTTP would expose the bearer token in transit)",
    );
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new RangeError(
      "LlmGatewayClient: baseUrl must not embed credentials in userinfo",
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    throw new RangeError("LlmGatewayClient: baseUrl must include a hostname");
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new RangeError(
      `LlmGatewayClient: baseUrl host "${host}" is blocked (loopback/link-local)`,
    );
  }
  if (isPrivateIpHost(host)) {
    throw new RangeError(
      `LlmGatewayClient: baseUrl host "${host}" is in a blocked private IP range`,
    );
  }
};

/** Set of known error classes — re-exported for convenience. */
export const LLM_GATEWAY_ERROR_CLASSES: ReadonlySet<LlmGatewayErrorClass> =
  new Set(ALLOWED_LLM_GATEWAY_ERROR_CLASSES);

/** Whether a given error class is retryable. */
export const isLlmGatewayErrorRetryable = (
  errorClass: LlmGatewayErrorClass,
): boolean => isTransientFailure(errorClass);
