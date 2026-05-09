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
import type { LlmGatewayClientConfig } from "../contracts/index.js";

const TEXT_ROLE_TIMEOUT_MS = 240_000;
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
}

const withOptionalDeployment = <T extends object>(
  key: string,
  value: string | undefined,
  build: (deployment: string) => T,
): T | {} => (value !== undefined ? { [key]: build(value) } : {});

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

const withOptionalIctRef = (
  config: LlmGatewayClientConfig,
  ictRegisterRef: string | undefined,
): LlmGatewayClientConfig =>
  ictRegisterRef !== undefined ? { ...config, ictRegisterRef } : config;

export const buildProductionRoleClientConfig = (input: {
  role:
    | "test_generation"
    | "logic_judge"
    | "coverage_planner"
    | "risk_ranker"
    | "visual_primary"
    | "visual_fallback"
    | "a11y_judge";
  endpoint: string;
  deployment: string;
  modelRevisionSuffix: string;
  gatewayRelease: string;
  ictRegisterRef?: string;
}): LlmGatewayClientConfig => {
  const shared = {
    compatibilityMode: "openai_chat" as const,
    baseUrl: input.endpoint,
    deployment: input.deployment,
    modelRevision: `${input.deployment}@${input.modelRevisionSuffix}`,
    gatewayRelease: input.gatewayRelease,
    authMode: "api_key" as const,
    maxRetries: 1,
    circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
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
): LlmGatewayClientBundleConfigs => ({
  testGeneration: buildProductionRoleClientConfig({
    role: "test_generation",
    endpoint: input.endpoint,
    deployment: input.deployment,
    modelRevisionSuffix: input.modelRevisionSuffix,
    gatewayRelease: input.gatewayRelease,
    ...(input.ictRegisterRef !== undefined
      ? { ictRegisterRef: input.ictRegisterRef }
      : {}),
  }),
  visualPrimary: buildProductionRoleClientConfig({
    role: "visual_primary",
    endpoint: input.visualEndpoint,
    deployment: input.visualPrimaryDeployment,
    modelRevisionSuffix: input.modelRevisionSuffix,
    gatewayRelease: input.gatewayRelease,
    ...(input.ictRegisterRef !== undefined
      ? { ictRegisterRef: input.ictRegisterRef }
      : {}),
  }),
  visualFallback: buildProductionRoleClientConfig({
    role: "visual_fallback",
    endpoint: input.visualEndpoint,
    deployment: input.visualFallbackDeployment,
    modelRevisionSuffix: input.modelRevisionSuffix,
    gatewayRelease: input.gatewayRelease,
    ...(input.ictRegisterRef !== undefined
      ? { ictRegisterRef: input.ictRegisterRef }
      : {}),
  }),
  ...withOptionalDeployment(
    "logicJudge",
    input.logicJudgeDeployment,
    (deployment) =>
      buildProductionRoleClientConfig({
          role: "logic_judge",
          endpoint: input.endpoint,
          deployment,
          modelRevisionSuffix: input.modelRevisionSuffix,
          gatewayRelease: input.gatewayRelease,
          ...(input.ictRegisterRef !== undefined
            ? { ictRegisterRef: input.ictRegisterRef }
            : {}),
      }),
  ),
  ...withOptionalDeployment(
    "a11yJudge",
    input.a11yJudgeDeployment,
    (deployment) =>
      buildProductionRoleClientConfig({
          role: "a11y_judge",
          endpoint: input.visualEndpoint,
          deployment,
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
    (deployment) =>
      buildProductionRoleClientConfig({
          role: "coverage_planner",
          endpoint: input.endpoint,
          deployment,
          modelRevisionSuffix: input.modelRevisionSuffix,
          gatewayRelease: input.gatewayRelease,
          ...(input.ictRegisterRef !== undefined
            ? { ictRegisterRef: input.ictRegisterRef }
            : {}),
      }),
  ),
  ...withOptionalDeployment(
    "riskRanker",
    input.riskRankerDeployment,
    (deployment) =>
      buildProductionRoleClientConfig({
          role: "risk_ranker",
          endpoint: input.endpoint,
          deployment,
          modelRevisionSuffix: input.modelRevisionSuffix,
          gatewayRelease: input.gatewayRelease,
          ...(input.ictRegisterRef !== undefined
            ? { ictRegisterRef: input.ictRegisterRef }
            : {}),
      }),
  ),
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
