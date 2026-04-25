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

import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import {
  ALLOWED_LLM_GATEWAY_AUTH_MODES,
  ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES,
  ALLOWED_LLM_GATEWAY_ERROR_CLASSES,
  ALLOWED_LLM_GATEWAY_ROLES,
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGatewayCompatibilityMode,
  type LlmGatewayErrorClass,
  type LlmGatewayRole,
  type LlmGenerationFailure,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type LlmGenerationSuccess,
  type LlmFinishReason,
} from "../contracts/index.js";
import {
  createLlmCircuitBreaker,
  type LlmCircuitBreaker,
  type LlmCircuitClock,
  type LlmCircuitTransitionEvent,
} from "./llm-circuit-breaker.js";

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
}

const DEFAULT_BACKOFF_MS: ReadonlyArray<number> = [100, 200, 400, 800, 1600];
const MAX_REDACTED_MESSAGE_LENGTH = 240;

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
  const breaker = createLlmCircuitBreaker({
    failureThreshold: config.circuitBreaker.failureThreshold,
    resetTimeoutMs: config.circuitBreaker.resetTimeoutMs,
    ...(runtime.clock !== undefined ? { clock: runtime.clock } : {}),
    ...(runtime.onCircuitTransition !== undefined
      ? { onStateTransition: runtime.onCircuitTransition }
      : {}),
  });

  const generate = async (
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult> => {
    const guardError = guardImagePayload(config.role, request);
    if (guardError !== undefined) return guardError;

    const maxAttempts = Math.max(1, config.maxRetries + 1);
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
        return result;
      }

      // Failure path. Decide whether to feed the breaker a transient signal
      // or a non-transient (policy) signal.
      if (isTransientFailure(result.errorClass)) {
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
  };
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

const isTransientFailure = (errorClass: LlmGatewayErrorClass): boolean => {
  return (
    errorClass === "timeout" ||
    errorClass === "transport" ||
    errorClass === "rate_limited"
  );
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
  const url = buildOpenAiChatUrl(config.baseUrl, config.deployment);
  const body = buildOpenAiChatBody(config, request);
  const headers = await buildAuthHeaders(config, apiKeyProvider, attempt);
  if ("error" in headers) return headers.error;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: headers.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (
      err instanceof Error &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      return {
        outcome: "error",
        errorClass: "timeout",
        message: `request timed out after ${config.timeoutMs}ms`,
        retryable: true,
        attempt,
      };
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
  } finally {
    clearTimeout(timer);
  }

  return parseOpenAiChatResponse({ response, config, attempt });
};

const buildOpenAiChatUrl = (baseUrl: string, deployment: string): string => {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const params = new URLSearchParams({ model: deployment });
  return `${trimmed}/chat/completions?${params.toString()}`;
};

interface OpenAiChatBody {
  model: string;
  messages: ReadonlyArray<{ role: string; content: unknown }>;
  response_format?: {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown> };
  };
  seed?: number;
  reasoning_effort?: "low" | "medium" | "high";
  max_output_tokens?: number;
  stream?: boolean;
}

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
  if (
    config.declaredCapabilities.structuredOutputs &&
    request.responseSchema !== undefined &&
    request.responseSchemaName !== undefined
  ) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: request.responseSchemaName,
        schema: request.responseSchema,
      },
    };
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
    body.max_output_tokens = request.maxOutputTokens;
  }
  return body;
};

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
  attempt,
}: {
  response: Response;
  config: LlmGatewayClientConfig;
  attempt: number;
}): Promise<LlmGenerationResult> => {
  const status = response.status;
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (err) {
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

  if (status === 429) {
    return {
      outcome: "error",
      errorClass: "rate_limited",
      message: `rate limited (status 429)`,
      retryable: true,
      attempt,
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      outcome: "error",
      errorClass: "transport",
      message: `gateway returned ${status}`,
      retryable: true,
      attempt,
    };
  }
  if (status === 408) {
    return {
      outcome: "error",
      errorClass: "timeout",
      message: `gateway returned 408`,
      retryable: true,
      attempt,
    };
  }
  if (status >= 400) {
    return {
      outcome: "error",
      errorClass: "schema_invalid",
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
  if (config.declaredCapabilities.structuredOutputs) {
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
  } else {
    content = rawContent;
    rawTextContent = rawContent;
  }

  const usage = envelope["usage"];
  const usageRecord =
    typeof usage === "object" && usage !== null
      ? (usage as Record<string, unknown>)
      : {};

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
  assertNonEmpty(config.deployment, "deployment");
  assertNonEmpty(config.modelRevision, "modelRevision");
  assertNonEmpty(config.gatewayRelease, "gatewayRelease");
  if (
    config.modelWeightsSha256 !== undefined &&
    !/^[0-9a-f]{64}$/i.test(config.modelWeightsSha256)
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
};

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(
      `LlmGatewayClient: ${field} must be a non-empty string`,
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
