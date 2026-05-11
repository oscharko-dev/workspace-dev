/**
 * Auto-wiring helper for the Inspector test-intelligence production runner
 * (Issue #1733). When `WorkspaceStartOptions.testIntelligence.enabled` is
 * true AND the env-var gate `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` is set,
 * `resolveTestIntelligenceProductionRunner` returns a factory that builds
 * an Azure-bound `LlmGatewayClient` from `WORKSPACE_TEST_SPACE_*` env vars
 * lazily (on first submission), then dispatches to
 * `runFigmaToQcTestCases`. When required env vars are missing, the factory
 * returns `undefined` so the request handler keeps its existing
 * `503 LLM_GATEWAY_UNCONFIGURED` fail-closed behaviour.
 *
 * The lazy build avoids forcing operators who only want the read-only
 * Inspector surface (review/audit/export) to also configure the LLM
 * endpoint. The first submission validates env, builds, and caches the
 * client for the lifetime of the process.
 *
 * The factory never throws synchronously: missing env vars surface as a
 * `ProductionRunnerError(LLM_GATEWAY_FAILED)` so the request handler maps
 * it to the standard 500 envelope rather than crashing the request loop.
 */

import {
  PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  ProductionRunnerError,
  runFigmaToQcTestCases,
  type RunFigmaToQcTestCasesResult,
} from "../test-intelligence/index.js";
import { type LlmGatewayClientBundle } from "../test-intelligence/llm-gateway-bundle.js";
import { createProductionTopologyClientBundle } from "../test-intelligence/production-topology-clients.js";
import type { WorkspaceRuntimeLogger } from "../logging.js";
import type {
  TestIntelligenceProductionRunnerFactory,
  TestIntelligenceProductionRunnerFactoryInput,
} from "./request-handler.js";

const TEST_GENERATION_TIMEOUT_MS = 240_000;
const TEST_GENERATION_MAX_OUTPUT_TOKENS = 32_000;
const DEFAULT_VISUAL_PRIMARY_DEPLOYMENT = "llama-4-maverick-vision";
const DEFAULT_VISUAL_FALLBACK_DEPLOYMENT = "phi-4-multimodal-instruct";

export interface ResolveTestIntelligenceProductionRunnerInput {
  /** Resolved startup gate (`options.testIntelligence?.enabled === true`). */
  startupEnabled: boolean;
  /** Resolved env gate (`resolveTestIntelligenceEnabled(env)`). */
  envEnabled: boolean;
  /** Process env to read `WORKSPACE_TEST_SPACE_*` from. */
  env: NodeJS.ProcessEnv;
  /** Optional logger for one-shot startup-side messages. */
  logger?: WorkspaceRuntimeLogger;
  /** Test seam for the LLM gateway bundle builder. */
  buildLlmBundle?: (config: ResolvedLlmConfig) => LlmGatewayClientBundle;
  /** Test seam for the runner. */
  runner?: (
    input: Parameters<typeof runFigmaToQcTestCases>[0],
  ) => Promise<RunFigmaToQcTestCasesResult>;
}

export interface ResolvedLlmConfig {
  endpoint: string;
  deployment: string;
  visualEndpoint: string;
  visualPrimaryDeployment: string;
  visualFallbackDeployment: string;
  logicJudgeDeployment?: string;
  a11yJudgeDeployment?: string;
  coveragePlannerDeployment?: string;
  riskRankerDeployment?: string;
  apiKey: string;
}

const readTrimmed = (
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined => {
  const raw = env[key];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const resolveApiKeyFromEnv = (env: NodeJS.ProcessEnv): string | undefined => {
  return readTrimmed(env, "WORKSPACE_TEST_SPACE_LLM_API_KEY");
};

/**
 * Read endpoint/deployment/api-key from env. Throws
 * `ProductionRunnerError(LLM_GATEWAY_FAILED)` (retryable=false) when any
 * required input is missing — this is mapped by the request handler to a
 * 500 envelope listing the missing env var.
 */
export const resolveLlmConfigFromEnv = (
  env: NodeJS.ProcessEnv,
): ResolvedLlmConfig => {
  const endpoint = readTrimmed(env, "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT");
  if (endpoint === undefined) {
    throw new ProductionRunnerError({
      failureClass: "LLM_GATEWAY_FAILED",
      message:
        "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT must be set for test-intelligence runner.",
      retryable: false,
    });
  }
  const apiKey = resolveApiKeyFromEnv(env);
  if (apiKey === undefined) {
    throw new ProductionRunnerError({
      failureClass: "LLM_GATEWAY_FAILED",
      message:
        "WORKSPACE_TEST_SPACE_LLM_API_KEY must be set for test-intelligence runner.",
      retryable: false,
    });
  }
  const deployment =
    readTrimmed(env, "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT") ??
    PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT;
  const visualEndpoint =
    readTrimmed(env, "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT") ?? endpoint;
  const visualPrimaryDeployment =
    readTrimmed(env, "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT") ??
    DEFAULT_VISUAL_PRIMARY_DEPLOYMENT;
  const visualFallbackDeployment =
    readTrimmed(env, "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT") ??
    DEFAULT_VISUAL_FALLBACK_DEPLOYMENT;
  const logicJudgeDeployment = readTrimmed(
    env,
    "WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT",
  );
  const a11yJudgeDeployment = readTrimmed(
    env,
    "WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT",
  );
  const coveragePlannerDeployment = readTrimmed(
    env,
    "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
  );
  const riskRankerDeployment = readTrimmed(
    env,
    "WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT",
  );
  return {
    endpoint,
    deployment,
    visualEndpoint,
    visualPrimaryDeployment,
    visualFallbackDeployment,
    ...(logicJudgeDeployment !== undefined ? { logicJudgeDeployment } : {}),
    ...(a11yJudgeDeployment !== undefined ? { a11yJudgeDeployment } : {}),
    ...(coveragePlannerDeployment !== undefined
      ? { coveragePlannerDeployment }
      : {}),
    ...(riskRankerDeployment !== undefined ? { riskRankerDeployment } : {}),
    apiKey,
  };
};

const defaultBuildLlmBundle = (
  config: ResolvedLlmConfig,
): LlmGatewayClientBundle =>
  createProductionTopologyClientBundle(
    {
      endpoint: config.endpoint,
      visualEndpoint: config.visualEndpoint,
      deployment: config.deployment,
      visualPrimaryDeployment: config.visualPrimaryDeployment,
      visualFallbackDeployment: config.visualFallbackDeployment,
      ...(config.logicJudgeDeployment !== undefined
        ? { logicJudgeDeployment: config.logicJudgeDeployment }
        : {}),
      ...(config.a11yJudgeDeployment !== undefined
        ? { a11yJudgeDeployment: config.a11yJudgeDeployment }
        : {}),
      ...(config.coveragePlannerDeployment !== undefined
        ? { coveragePlannerDeployment: config.coveragePlannerDeployment }
        : {}),
      ...(config.riskRankerDeployment !== undefined
        ? { riskRankerDeployment: config.riskRankerDeployment }
        : {}),
      modelRevisionSuffix: "server-auto-wire",
      gatewayRelease: "azure-ai-foundry-server-auto-wire",
    },
    {
      apiKeyProvider: () => config.apiKey,
    },
  );

/**
 * Resolve a runner factory when both gates are on; return `undefined`
 * otherwise so the request handler retains its default 503 fail-closed
 * behaviour. Callers wire the return value into
 * `runtime.testIntelligenceProductionRunner`.
 */
export const resolveTestIntelligenceProductionRunner = (
  input: ResolveTestIntelligenceProductionRunnerInput,
): TestIntelligenceProductionRunnerFactory | undefined => {
  if (!input.startupEnabled || !input.envEnabled) {
    return undefined;
  }
  const buildLlmBundle = input.buildLlmBundle ?? defaultBuildLlmBundle;
  const runner = input.runner ?? runFigmaToQcTestCases;
  let cachedBundle: LlmGatewayClientBundle | undefined;

  // One-shot startup log: announce the active FinOps envelope so an
  // operator reading `journalctl` can confirm what cost ceiling the
  // server applies before the first job lands.
  input.logger?.log({
    level: "info",
    event: "test_intelligence_finops_envelope",
    message: `Test-intelligence production FinOps envelope active: ${PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetId}@${PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetVersion} (test_generation: ${PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.test_generation?.maxOutputTokensPerRequest ?? 0} out tokens, ${PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.test_generation?.maxWallClockMsPerRequest ?? 0}ms wall-clock)`,
  });

  const factory: TestIntelligenceProductionRunnerFactory = async (
    factoryInput: TestIntelligenceProductionRunnerFactoryInput,
  ): Promise<RunFigmaToQcTestCasesResult> => {
    if (cachedBundle === undefined) {
      const config = resolveLlmConfigFromEnv(input.env);
      cachedBundle = buildLlmBundle(config);
      input.logger?.log({
        level: "info",
        event: "test_intelligence_runner_wired",
        message: `Test-intelligence production runner LLM bundle built (deployment=${config.deployment}, visualPrimary=${config.visualPrimaryDeployment}, visualFallback=${config.visualFallbackDeployment}${config.coveragePlannerDeployment !== undefined ? `, coveragePlanner=${config.coveragePlannerDeployment}` : ""}${config.riskRankerDeployment !== undefined ? `, riskRanker=${config.riskRankerDeployment}` : ""})`,
      });
    }
    return runner({
      jobId: factoryInput.jobId,
      generatedAt: factoryInput.generatedAt,
      source: factoryInput.source,
      outputRoot: factoryInput.outputRoot,
      llm: {
        client: cachedBundle.testGeneration,
        bundle: cachedBundle,
        // FinOps envelope's per-request limits override these legacy
        // fields; they remain set for the (rare) case where an operator
        // wires a runner that doesn't pass a FinOps budget.
        maxOutputTokens: TEST_GENERATION_MAX_OUTPUT_TOKENS,
        maxWallClockMs: TEST_GENERATION_TIMEOUT_MS,
      },
      ...(factoryInput.events !== undefined
        ? { events: factoryInput.events }
        : {}),
    });
  };
  return factory;
};
