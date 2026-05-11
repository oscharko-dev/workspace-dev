import { createLlmCircuitBreaker, type LlmCircuitBreaker } from "./llm-circuit-breaker.js";
import type { JiraGatewayClient } from "./jira-gateway-client.js";
import type { JiraFetchRequest, JiraFetchResult, JiraGatewayConfig, JiraCapabilityProbe } from "../contracts/index.js";

export type MockJiraResponder = (
  request: JiraFetchRequest,
  attempt: number
) => JiraFetchResult | Promise<JiraFetchResult>;

export interface CreateMockJiraGatewayClientInput {
  config: JiraGatewayConfig;
  capability?: JiraCapabilityProbe;
  staticResponse?: JiraFetchResult;
  responder?: MockJiraResponder;
  circuitBreaker?: { failureThreshold: number; resetTimeoutMs: number };
}

export interface MockJiraGatewayClient extends JiraGatewayClient {
  readonly callCount: () => number;
  readonly recordedRequests: () => ReadonlyArray<JiraFetchRequest>;
  readonly reset: () => void;
}

const DEFAULT_CAPABILITY: JiraCapabilityProbe = {
  version: "9.0.0",
  deploymentType: "Cloud",
  adfSupported: true,
};

const buildDefaultSuccess = (_request: JiraFetchRequest, capability: JiraCapabilityProbe, attempt: number): JiraFetchResult => ({
  issues: [],
  capability,
  responseHash: "mock-hash",
  retryable: false,
  attempts: attempt,
});

export const createMockJiraGatewayClient = (input: CreateMockJiraGatewayClientInput): MockJiraGatewayClient => {
  const breakerConfig = input.circuitBreaker ?? { failureThreshold: 3, resetTimeoutMs: 30000 };
  let breaker: LlmCircuitBreaker = createLlmCircuitBreaker(breakerConfig);
  let count = 0;
  const recorded: JiraFetchRequest[] = [];
  const capability = input.capability ?? DEFAULT_CAPABILITY;

  const fetchIssues = async (request: JiraFetchRequest): Promise<JiraFetchResult> => {
    const decision = breaker.beforeRequest();
    if (!decision.allowRequest) {
      return {
        issues: [],
        capability,
        responseHash: "",
        retryable: false,
        attempts: count + 1,
      };
    }

    count += 1;
    recorded.push(structuredClone(request));

    let result: JiraFetchResult;
    if (input.responder !== undefined) {
      result = await input.responder(request, count);
    } else if (input.staticResponse !== undefined) {
      result = input.staticResponse;
    } else {
      result = buildDefaultSuccess(request, capability, count);
    }

    if (result.issues.length > 0 || !result.retryable) {
      if (!result.retryable && result.issues.length === 0) {
        breaker.recordNonTransientOutcome();
      } else {
        breaker.recordSuccess();
      }
    } else {
      breaker.recordTransientFailure();
    }

    return result;
  };

  const probeCapability = async (): Promise<{ ok: true; capability: JiraCapabilityProbe } | { ok: false; code: string; message: string; retryable: boolean }> => {
    return { ok: true, capability };
  };

  return {
    config: input.config,
    getCircuitBreaker: () => breaker,
    fetchIssues,
    probeCapability,
    callCount: () => count,
    recordedRequests: () => recorded.map((r) => structuredClone(r)),
    reset: () => {
      count = 0;
      recorded.length = 0;
      breaker = createLlmCircuitBreaker(breakerConfig);
    },
  };
};
