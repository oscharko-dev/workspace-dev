/**
 * Deterministic mock LLM gateway for CI and air-gapped validation execution
 * (Issue #1363).
 *
 * The mock implements the full `LlmGatewayClient` contract without making
 * any network calls. It is the default execution path for offline runs:
 * the orchestrator selects it whenever the deployment is configured as
 * `mock` or whenever live execution is opt-in and disabled.
 *
 * Determinism is the only guarantee callers care about. The mock therefore
 * supports two response modes:
 *   - A static envelope returned for every call, OR
 *   - A pure function `(request, attempt) => result` that lets fixtures
 *     model schema-invalid, refusal, timeout, etc. paths.
 *
 * The mock honors the same image-payload guard as the real client so that
 * tests can verify the guard without standing up a fake HTTP server.
 */

import {
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGatewayCompatibilityMode,
  type LlmGatewayRole,
  type LlmGenerationFailure,
  type LlmGenerationRequest,
  type LlmGenerationResult,
  type LlmGenerationSuccess,
} from "../contracts/index.js";
import {
  createLlmCircuitBreaker,
  type LlmCircuitBreaker,
} from "./llm-circuit-breaker.js";
import {
  isLlmGatewayErrorRetryable,
  type LlmGatewayClient,
} from "./llm-gateway.js";
import { estimateLlmInputTokens } from "./llm-token-estimator.js";

export type MockResponder = (
  request: LlmGenerationRequest,
  attempt: number,
) => LlmGenerationResult | Promise<LlmGenerationResult>;

export interface CreateMockLlmGatewayClientInput {
  role: LlmGatewayRole;
  deployment: string;
  modelRevision: string;
  gatewayRelease: string;
  ictRegisterRef?: string;
  /** Test-only escape hatch for banking-policy refusal scenarios. */
  omitIctRegisterRef?: boolean;
  operatorEndpointReference?: string;
  modelWeightsSha256?: string;
  compatibilityMode?: LlmGatewayCompatibilityMode;
  declaredCapabilities?: LlmGatewayCapabilities;
  /**
   * Either a fixed envelope returned every call, or a function. When neither
   * is provided, the mock returns a generic success with `content = {}`.
   */
  staticResponse?: LlmGenerationResult;
  responder?: MockResponder;
  /** Optional circuit-breaker thresholds; defaults are reasonable for tests. */
  circuitBreaker?: { failureThreshold: number; resetTimeoutMs: number };
}

export interface MockLlmGatewayClient extends LlmGatewayClient {
  readonly callCount: () => number;
  readonly recordedRequests: () => ReadonlyArray<LlmGenerationRequest>;
  /** Reset the recorded calls and the circuit breaker. */
  readonly reset: () => void;
}

const DEFAULT_CAPABILITIES: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: true,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const DEFAULT_BREAKER = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
} as const;

const cloneRequest = (request: LlmGenerationRequest): LlmGenerationRequest => {
  // Strip image payloads from the recording snapshot to avoid retaining
  // potentially-large fixture bytes longer than necessary.
  const cloned: LlmGenerationRequest = {
    jobId: request.jobId,
    systemPrompt: request.systemPrompt,
    userPrompt: request.userPrompt,
  };
  if (request.responseSchema !== undefined) {
    cloned.responseSchema = request.responseSchema;
  }
  if (request.responseSchemaName !== undefined) {
    cloned.responseSchemaName = request.responseSchemaName;
  }
  if (request.imageInputs !== undefined) {
    cloned.imageInputs = request.imageInputs.map((image) => ({
      mimeType: image.mimeType,
      base64Data: `[mock:${image.base64Data.length}b]`,
    }));
  }
  if (request.seed !== undefined) cloned.seed = request.seed;
  if (request.reasoningEffort !== undefined) {
    cloned.reasoningEffort = request.reasoningEffort;
  }
  if (request.maxInputTokens !== undefined) {
    cloned.maxInputTokens = request.maxInputTokens;
  }
  if (request.maxOutputTokens !== undefined) {
    cloned.maxOutputTokens = request.maxOutputTokens;
  }
  if (request.maxWallClockMs !== undefined) {
    cloned.maxWallClockMs = request.maxWallClockMs;
  }
  if (request.maxRetries !== undefined) {
    cloned.maxRetries = request.maxRetries;
  }
  return cloned;
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

const guardOutputBudget = (
  request: LlmGenerationRequest,
  declaredCapabilities: LlmGatewayCapabilities,
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
  if (!declaredCapabilities.maxOutputTokensSupport) {
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

/**
 * Build the default success envelope. Fully deterministic given the request
 * shape — `attempt` is encoded so retries are observable in fixtures.
 */
const buildDefaultSuccess = (
  request: LlmGenerationRequest,
  config: { deployment: string; modelRevision: string; gatewayRelease: string },
  attempt: number,
): LlmGenerationSuccess => ({
  outcome: "success",
  content: {
    mock: true,
    jobId: request.jobId,
    promptHashLength: request.systemPrompt.length + request.userPrompt.length,
  },
  finishReason: "stop",
  usage: { inputTokens: 0, outputTokens: 0 },
  modelDeployment: config.deployment,
  modelRevision: config.modelRevision,
  gatewayRelease: config.gatewayRelease,
  attempt,
});

export const createMockLlmGatewayClient = (
  input: CreateMockLlmGatewayClientInput,
): MockLlmGatewayClient => {
  const compatibilityMode: LlmGatewayCompatibilityMode =
    input.compatibilityMode ?? "openai_chat";
  const declaredCapabilities =
    input.declaredCapabilities ?? DEFAULT_CAPABILITIES;

  if (
    input.role === "test_generation" &&
    declaredCapabilities.imageInputSupport
  ) {
    throw new RangeError(
      "createMockLlmGatewayClient: test_generation role must not declare imageInputSupport",
    );
  }

  const breakerConfig = input.circuitBreaker ?? DEFAULT_BREAKER;
  let breaker: LlmCircuitBreaker = createLlmCircuitBreaker(breakerConfig);
  let count = 0;
  const recorded: LlmGenerationRequest[] = [];

  const config = {
    deployment: input.deployment,
    modelRevision: input.modelRevision,
    gatewayRelease: input.gatewayRelease,
  };

  const generate = async (
    request: LlmGenerationRequest,
  ): Promise<LlmGenerationResult> => {
    const guard = guardImagePayload(input.role, request);
    if (guard !== undefined) return guard;
    const budgetGuard = guardInputBudget(request);
    if (budgetGuard !== undefined) return budgetGuard;
    const outputBudgetGuard = guardOutputBudget(request, declaredCapabilities);
    if (outputBudgetGuard !== undefined) return outputBudgetGuard;

    const decision = breaker.beforeRequest();
    if (!decision.allowRequest) {
      return {
        outcome: "error",
        errorClass: "transport",
        message: `circuit breaker is ${decision.snapshot.state}`,
        retryable: false,
        attempt: count + 1,
      };
    }

    count += 1;
    recorded.push(cloneRequest(request));

    let result: LlmGenerationResult;
    if (input.responder !== undefined) {
      result = await input.responder(request, count);
    } else if (input.staticResponse !== undefined) {
      result = input.staticResponse;
    } else {
      result = buildDefaultSuccess(request, config, count);
    }

    if (
      result.outcome === "success" &&
      request.maxOutputTokens !== undefined &&
      (result.usage.outputTokens === undefined ||
        result.usage.outputTokens > request.maxOutputTokens)
    ) {
      result = {
        outcome: "error",
        errorClass: "schema_invalid",
        message:
          result.usage.outputTokens === undefined
            ? "maxOutputTokens budget requires output token usage from the gateway"
            : `reported output tokens ${result.usage.outputTokens} exceeds maxOutputTokens ${request.maxOutputTokens}`,
        retryable: false,
        attempt: count,
      };
    }

    if (result.outcome === "success") {
      breaker.recordSuccess();
    } else if (
      result.retryable &&
      isLlmGatewayErrorRetryable(result.errorClass)
    ) {
      breaker.recordTransientFailure();
    } else {
      breaker.recordNonTransientOutcome();
    }
    return result;
  };

  return {
    role: input.role,
    compatibilityMode,
    deployment: input.deployment,
    modelRevision: input.modelRevision,
    gatewayRelease: input.gatewayRelease,
    ictRegisterRef: input.omitIctRegisterRef
      ? undefined
      : (input.ictRegisterRef ?? `mock-ict:${input.deployment}`),
    operatorEndpointReference:
      input.operatorEndpointReference ??
      `mock://${input.deployment}/[redacted]`,
    modelWeightsSha256: input.modelWeightsSha256,
    declaredCapabilities: { ...declaredCapabilities },
    generate,
    getCircuitBreaker: () => breaker,
    getIdempotencyMetrics: () => undefined,
    callCount: () => count,
    recordedRequests: () => recorded.map((request) => structuredClone(request)),
    reset: () => {
      count = 0;
      recorded.length = 0;
      breaker = createLlmCircuitBreaker(breakerConfig);
    },
  };
};

/**
 * Helper that turns an `LlmGatewayClientConfig` into a mock client. Useful
 * for orchestration code that picks live vs mock based on configuration —
 * the same config object can be passed to either factory.
 */
export const createMockLlmGatewayClientFromConfig = (
  config: LlmGatewayClientConfig,
  overrides: Pick<
    CreateMockLlmGatewayClientInput,
    "responder" | "staticResponse"
  > = {},
): MockLlmGatewayClient => {
  return createMockLlmGatewayClient({
    role: config.role,
    deployment: config.deployment,
    modelRevision: config.modelRevision,
    gatewayRelease: config.gatewayRelease,
    ...(config.ictRegisterRef !== undefined
      ? { ictRegisterRef: config.ictRegisterRef }
      : {}),
    ...(config.modelWeightsSha256 !== undefined
      ? { modelWeightsSha256: config.modelWeightsSha256 }
      : {}),
    compatibilityMode: config.compatibilityMode,
    declaredCapabilities: config.declaredCapabilities,
    circuitBreaker: config.circuitBreaker,
    ...(overrides.responder !== undefined
      ? { responder: overrides.responder }
      : {}),
    ...(overrides.staticResponse !== undefined
      ? { staticResponse: overrides.staticResponse }
      : {}),
  });
};
