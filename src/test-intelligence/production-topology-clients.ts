import {
  createLlmGatewayClient,
  type LlmGatewayClient,
  type LlmGatewayRuntime,
} from "./llm-gateway.js";
import {
  createLlmGatewayClientBundle,
  type LlmGatewayClientBundle,
  type LlmGatewayClientBundleConfigs,
} from "./llm-gateway-bundle.js";
import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  type LlmGatewayClientConfig,
  type ModelRoutingOverride,
  type ModelRoutingPolicy,
  type ModelRoutingRole,
} from "../contracts/index.js";
import {
  PRODUCTION_FINOPS_BUDGET_ENVELOPE,
  PRODUCTION_GENERATOR_WALL_CLOCK_MS,
} from "./finops-budget.js";
import {
  buildRuntimeModelRoutingPolicy,
  getDefaultModelRoutingPolicy,
} from "./model-routing-policy.js";

const TEXT_ROLE_TIMEOUT_MS = PRODUCTION_GENERATOR_WALL_CLOCK_MS;
const AUX_TEXT_ROLE_TIMEOUT_MS = 60_000;
const VISUAL_ROLE_TIMEOUT_MS = 300_000;
const LEGACY_GPT_OSS_DEPLOYMENT = "gpt-oss-120b";

export interface BuildProductionTopologyClientConfigsInput {
  endpoint: string;
  visualEndpoint: string;
  deployment: string;
  visualPrimaryDeployment: string;
  visualFallbackDeployment: string;
  logicJudgeDeployment?: string;
  a11yJudgeDeployment?: string;
  coveragePlannerDeployment?: string;
  riskRankerDeployment?: string;
  ictRegisterRef?: string;
  modelRevisionSuffix: string;
  gatewayRelease: string;
  policyProfileId?: string;
  modelRoutingOverride?: ModelRoutingOverride;
}

type ProductionTopologyRole =
  | "test_generation"
  | "logic_judge"
  | "coverage_planner"
  | "risk_ranker"
  | "visual_primary"
  | "visual_fallback"
  | "a11y_judge";

const withOptionalDeployment = <T extends object>(
  key: string,
  value: string | undefined,
  build: (deployment: string) => T,
): Partial<Record<string, T>> =>
  value !== undefined ? { [key]: build(value) } : {};

const baseTextCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
} as const;

const baseVisualCapabilities = {
  ...baseTextCapabilities,
  imageInputSupport: true,
} as const;

const constrainedDecodingConfigForDeployment = (deployment: string) =>
  deployment === LEGACY_GPT_OSS_DEPLOYMENT
    ? {
        constrainedDecoding: {
          preferredAdapter: "llguidance" as const,
          fallbackAdapter: "prompt_only" as const,
          adapterVersion: "1",
        },
      }
    : {
        constrainedDecoding: {
          preferredAdapter: "outlines" as const,
          fallbackAdapter: "prompt_only" as const,
          adapterVersion: "1",
        },
      };

const wireStructuredOutputOverrideForDeployment = (
  deployment: string,
): { wireStructuredOutputMode?: "none" } =>
  deployment === LEGACY_GPT_OSS_DEPLOYMENT
    ? { wireStructuredOutputMode: "none" }
    : {};

const maxRetriesForProductionRole = (role: ProductionTopologyRole): number => {
  switch (role) {
    case "test_generation":
    case "logic_judge":
    case "coverage_planner":
    case "risk_ranker":
      return (
        PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.test_generation
          ?.maxRetriesPerRequest ?? 6
      );
    case "visual_primary":
    case "a11y_judge":
      return (
        PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.visual_primary
          ?.maxRetriesPerRequest ?? 4
      );
    case "visual_fallback":
      return (
        PRODUCTION_FINOPS_BUDGET_ENVELOPE.roles.visual_fallback
          ?.maxRetriesPerRequest ?? 4
      );
  }
};

const routeDeployment = (
  route: ModelRoutingPolicy["routes"][number] | undefined,
): string | undefined =>
  route?.modelBinding.inferenceProfileId ?? route?.modelBinding.modelId;

const defaultTestGenerationFallbackDeployment = (input: {
  readonly policyProfileId: string | undefined;
  readonly primaryDeployment: string;
}): string | undefined => {
  const defaultPolicy = getDefaultModelRoutingPolicy(
    input.policyProfileId ?? EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  );
  return defaultPolicy.routes
    .filter((route) => route.role === "test_generation")
    .map(routeDeployment)
    .find(
      (deployment): deployment is string =>
        deployment !== undefined && deployment !== input.primaryDeployment,
    );
};

const withOptionalIctRef = (
  config: LlmGatewayClientConfig,
  ictRegisterRef: string | undefined,
): LlmGatewayClientConfig =>
  ictRegisterRef !== undefined ? { ...config, ictRegisterRef } : config;

export const buildProductionRoleClientConfig = (input: {
  role: ProductionTopologyRole;
  endpoint: string;
  deployment: string;
  modelRevisionSuffix: string;
  gatewayRelease: string;
  ictRegisterRef?: string;
}): LlmGatewayClientConfig => {
  const maxRetries = maxRetriesForProductionRole(input.role);
  const shared = {
    compatibilityMode: "openai_chat" as const,
    baseUrl: input.endpoint,
    deployment: input.deployment,
    modelRevision: `${input.deployment}@${input.modelRevisionSuffix}`,
    gatewayRelease: input.gatewayRelease,
    authMode: "api_key" as const,
    maxRetries,
    circuitBreaker: {
      failureThreshold: maxRetries + 1,
      resetTimeoutMs: 30_000,
    },
  };

  switch (input.role) {
    case "test_generation":
    case "logic_judge":
      return withOptionalIctRef(
        {
          role: input.role,
          ...shared,
          declaredCapabilities: baseTextCapabilities,
          timeoutMs: TEXT_ROLE_TIMEOUT_MS,
          ...constrainedDecodingConfigForDeployment(input.deployment),
          ...wireStructuredOutputOverrideForDeployment(input.deployment),
        },
        input.ictRegisterRef,
      );
    case "coverage_planner":
    case "risk_ranker":
      return withOptionalIctRef(
        {
          role: input.role,
          ...shared,
          declaredCapabilities: baseTextCapabilities,
          timeoutMs: AUX_TEXT_ROLE_TIMEOUT_MS,
          ...constrainedDecodingConfigForDeployment(input.deployment),
          wireStructuredOutputMode: "none",
        },
        input.ictRegisterRef,
      );
    case "visual_primary":
    case "visual_fallback":
    case "a11y_judge":
      return withOptionalIctRef(
        {
          role: input.role,
          ...shared,
          declaredCapabilities: baseVisualCapabilities,
          timeoutMs: VISUAL_ROLE_TIMEOUT_MS,
        },
        input.ictRegisterRef,
      );
  }
};

export const buildProductionTopologyClientConfigs = (
  input: BuildProductionTopologyClientConfigsInput,
): LlmGatewayClientBundleConfigs => {
  const policy = resolveProductionTopologyModelRoutingPolicy(input);
  const deploymentFor = (
    role: ModelRoutingRole,
    slot: "fallback" | "primary" | "secondary" | "triage" = "primary",
  ): string => {
    const route =
      policy.routes.find(
        (candidate) => candidate.role === role && candidate.slot === slot,
      ) ?? policy.routes.find((candidate) => candidate.role === role);
    if (
      route?.modelBinding.inferenceProfileId !== undefined &&
      route.modelBinding.inferenceProfileId.length > 0
    ) {
      return route.modelBinding.inferenceProfileId;
    }
    return route?.modelBinding.modelId ?? input.deployment;
  };
  const testGenerationDeployment = deploymentFor("test_generation");
  const routedSecondaryDeployment = deploymentFor(
    "test_generation",
    "secondary",
  );
  const testGenerationSecondaryDeployment =
    routedSecondaryDeployment !== testGenerationDeployment
      ? routedSecondaryDeployment
      : defaultTestGenerationFallbackDeployment({
          policyProfileId: input.policyProfileId,
          primaryDeployment: testGenerationDeployment,
        });
  return {
    testGeneration: buildProductionRoleClientConfig({
      role: "test_generation",
      endpoint: input.endpoint,
      deployment: testGenerationDeployment,
      modelRevisionSuffix: input.modelRevisionSuffix,
      gatewayRelease: input.gatewayRelease,
      ...(input.ictRegisterRef !== undefined
        ? { ictRegisterRef: input.ictRegisterRef }
        : {}),
    }),
    ...(testGenerationSecondaryDeployment !== undefined
      ? {
          testGenerationSecondary: buildProductionRoleClientConfig({
            role: "test_generation",
            endpoint: input.endpoint,
            deployment: testGenerationSecondaryDeployment,
            modelRevisionSuffix: input.modelRevisionSuffix,
            gatewayRelease: input.gatewayRelease,
            ...(input.ictRegisterRef !== undefined
              ? { ictRegisterRef: input.ictRegisterRef }
              : {}),
          }),
        }
      : {}),
    visualPrimary: buildProductionRoleClientConfig({
      role: "visual_primary",
      endpoint: input.visualEndpoint,
      deployment: deploymentFor("visual_primary"),
      modelRevisionSuffix: input.modelRevisionSuffix,
      gatewayRelease: input.gatewayRelease,
      ...(input.ictRegisterRef !== undefined
        ? { ictRegisterRef: input.ictRegisterRef }
        : {}),
    }),
    visualFallback: buildProductionRoleClientConfig({
      role: "visual_fallback",
      endpoint: input.visualEndpoint,
      deployment: deploymentFor("visual_fallback"),
      modelRevisionSuffix: input.modelRevisionSuffix,
      gatewayRelease: input.gatewayRelease,
      ...(input.ictRegisterRef !== undefined
        ? { ictRegisterRef: input.ictRegisterRef }
        : {}),
    }),
    ...withOptionalDeployment("logicJudge", input.logicJudgeDeployment, () =>
      buildProductionRoleClientConfig({
        role: "logic_judge",
        endpoint: input.endpoint,
        deployment: deploymentFor("logic_judge"),
        modelRevisionSuffix: input.modelRevisionSuffix,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      }),
    ),
    ...withOptionalDeployment("a11yJudge", input.a11yJudgeDeployment, () =>
      buildProductionRoleClientConfig({
        role: "a11y_judge",
        endpoint: input.visualEndpoint,
        deployment: deploymentFor("a11y_judge"),
        modelRevisionSuffix: input.modelRevisionSuffix,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      }),
    ),
    ...withOptionalDeployment(
      "coveragePlanner",
      input.coveragePlannerDeployment,
      () =>
        buildProductionRoleClientConfig({
          role: "coverage_planner",
          endpoint: input.endpoint,
          deployment: deploymentFor("coverage_planner"),
          modelRevisionSuffix: input.modelRevisionSuffix,
          gatewayRelease: input.gatewayRelease,
          ...(input.ictRegisterRef !== undefined
            ? { ictRegisterRef: input.ictRegisterRef }
            : {}),
        }),
    ),
    ...withOptionalDeployment("riskRanker", input.riskRankerDeployment, () =>
      buildProductionRoleClientConfig({
        role: "risk_ranker",
        endpoint: input.endpoint,
        deployment: deploymentFor("risk_ranker"),
        modelRevisionSuffix: input.modelRevisionSuffix,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      }),
    ),
  };
};

export const resolveProductionTopologyModelRoutingPolicy = (
  input: BuildProductionTopologyClientConfigsInput,
): ModelRoutingPolicy =>
  buildRuntimeModelRoutingPolicy({
    policyProfileId:
      input.policyProfileId ?? EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    roles: [
      {
        role: "test_generation",
        deployment: input.deployment,
        modelRevision: `${input.deployment}@${input.modelRevisionSuffix}`,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      },
      {
        role: "visual_primary",
        deployment: input.visualPrimaryDeployment,
        modelRevision: `${input.visualPrimaryDeployment}@${input.modelRevisionSuffix}`,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      },
      {
        role: "visual_fallback",
        deployment: input.visualFallbackDeployment,
        modelRevision: `${input.visualFallbackDeployment}@${input.modelRevisionSuffix}`,
        gatewayRelease: input.gatewayRelease,
        ...(input.ictRegisterRef !== undefined
          ? { ictRegisterRef: input.ictRegisterRef }
          : {}),
      },
      ...(input.logicJudgeDeployment !== undefined
        ? [
            {
              role: "logic_judge" as const,
              deployment: input.logicJudgeDeployment,
              modelRevision: `${input.logicJudgeDeployment}@${input.modelRevisionSuffix}`,
              gatewayRelease: input.gatewayRelease,
              ...(input.ictRegisterRef !== undefined
                ? { ictRegisterRef: input.ictRegisterRef }
                : {}),
            },
          ]
        : []),
      ...(input.a11yJudgeDeployment !== undefined
        ? [
            {
              role: "a11y_judge" as const,
              deployment: input.a11yJudgeDeployment,
              modelRevision: `${input.a11yJudgeDeployment}@${input.modelRevisionSuffix}`,
              gatewayRelease: input.gatewayRelease,
              ...(input.ictRegisterRef !== undefined
                ? { ictRegisterRef: input.ictRegisterRef }
                : {}),
            },
          ]
        : []),
      ...(input.coveragePlannerDeployment !== undefined
        ? [
            {
              role: "coverage_planner" as const,
              deployment: input.coveragePlannerDeployment,
              modelRevision: `${input.coveragePlannerDeployment}@${input.modelRevisionSuffix}`,
              gatewayRelease: input.gatewayRelease,
              ...(input.ictRegisterRef !== undefined
                ? { ictRegisterRef: input.ictRegisterRef }
                : {}),
            },
          ]
        : []),
      ...(input.riskRankerDeployment !== undefined
        ? [
            {
              role: "risk_ranker" as const,
              deployment: input.riskRankerDeployment,
              modelRevision: `${input.riskRankerDeployment}@${input.modelRevisionSuffix}`,
              gatewayRelease: input.gatewayRelease,
              ...(input.ictRegisterRef !== undefined
                ? { ictRegisterRef: input.ictRegisterRef }
                : {}),
            },
          ]
        : []),
    ],
    ...(input.modelRoutingOverride !== undefined
      ? { override: input.modelRoutingOverride }
      : {}),
  });

export const createProductionTopologyClientBundle = (
  input: BuildProductionTopologyClientConfigsInput,
  runtime: LlmGatewayRuntime,
): LlmGatewayClientBundle =>
  createLlmGatewayClientBundle(
    buildProductionTopologyClientConfigs(input),
    runtime,
  );

export const createProductionRoleClient = (
  config: LlmGatewayClientConfig,
  runtime: LlmGatewayRuntime,
): LlmGatewayClient => createLlmGatewayClient(config, runtime);
