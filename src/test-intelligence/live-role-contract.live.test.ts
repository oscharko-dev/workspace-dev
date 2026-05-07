import assert from "node:assert/strict";
import test from "node:test";

import type {
  LlmGatewayCapabilities,
  LlmGatewayClientConfig,
  LlmGatewayRole,
} from "../contracts/index.js";
import { createLlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import {
  formatLiveRoleContractSmokeReport,
  runLiveRoleContractSmoke,
} from "./live-role-contract-smoke.js";
import {
  findMissingRequiredLiveEnv,
  formatMissingRequiredLiveEnvMessage,
  isLiveSmokeEnabled,
  LIVE_SMOKE_SKIP_MESSAGE,
} from "./visual-sidecar-client.live-env.js";

const API_KEY_ALIASES = [
  "WORKSPACE_TEST_SPACE_API_KEY",
  "WORKSPACE_TEST_SPACE_MODEL_API_KEY",
] as const;

const textCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const visualCapabilities: LlmGatewayCapabilities = {
  ...textCapabilities,
  imageInputSupport: true,
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required for live role-contract smoke`);
  }
  return value;
};

const requireApiKey = (): string => {
  for (const candidate of API_KEY_ALIASES) {
    const value = process.env[candidate];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `live role-contract smoke requires one of: ${API_KEY_ALIASES.join(", ")}`,
  );
};

const buildConfig = (input: {
  role: LlmGatewayRole;
  baseUrl: string;
  deployment: string;
  imageInputSupport: boolean;
}): LlmGatewayClientConfig => ({
  role: input.role,
  compatibilityMode: "openai_chat",
  baseUrl: input.baseUrl,
  deployment: input.deployment,
  modelRevision: `${input.deployment}@live-contract`,
  gatewayRelease: "azure-ai-foundry-live-contract",
  authMode: "api_key",
  declaredCapabilities: input.imageInputSupport
    ? visualCapabilities
    : textCapabilities,
  timeoutMs: 60_000,
  maxRetries: 1,
  circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
});

test("live role contract smoke: every configured role satisfies its runtime contract", async (t) => {
  if (!isLiveSmokeEnabled()) {
    t.skip(LIVE_SMOKE_SKIP_MESSAGE);
    return;
  }

  const missing = findMissingRequiredLiveEnv();
  assert.deepEqual(missing, [], formatMissingRequiredLiveEnvMessage(missing));

  const textBaseUrl = requireEnv("WORKSPACE_TEST_SPACE_MODEL_ENDPOINT");
  const textDeployment = requireEnv("WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT");
  const visualBaseUrl = requireEnv("WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT");
  const visualPrimaryDeployment = requireEnv(
    "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  );
  const visualFallbackDeployment = requireEnv(
    "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );

  const bundle = createLlmGatewayClientBundle(
    {
      testGeneration: buildConfig({
        role: "test_generation",
        baseUrl: textBaseUrl,
        deployment: textDeployment,
        imageInputSupport: false,
      }),
      visualPrimary: buildConfig({
        role: "visual_primary",
        baseUrl: visualBaseUrl,
        deployment: visualPrimaryDeployment,
        imageInputSupport: true,
      }),
      visualFallback: buildConfig({
        role: "visual_fallback",
        baseUrl: visualBaseUrl,
        deployment: visualFallbackDeployment,
        imageInputSupport: true,
      }),
      ...(process.env["WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT"]
        ? {
            logicJudge: buildConfig({
              role: "logic_judge",
              baseUrl: textBaseUrl,
              deployment: requireEnv("WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT"),
              imageInputSupport: false,
            }),
          }
        : {}),
      ...(process.env["WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT"]
        ? {
            coveragePlanner: buildConfig({
              role: "coverage_planner",
              baseUrl: textBaseUrl,
              deployment: requireEnv(
                "WORKSPACE_TEST_SPACE_COVERAGE_PLANNER_DEPLOYMENT",
              ),
              imageInputSupport: false,
            }),
          }
        : {}),
      ...(process.env["WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT"]
        ? {
            riskRanker: buildConfig({
              role: "risk_ranker",
              baseUrl: textBaseUrl,
              deployment: requireEnv("WORKSPACE_TEST_SPACE_RISK_RANKER_DEPLOYMENT"),
              imageInputSupport: false,
            }),
          }
        : {}),
      ...(process.env["WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT"]
        ? {
            a11yJudge: buildConfig({
              role: "a11y_judge",
              baseUrl: visualBaseUrl,
              deployment: requireEnv("WORKSPACE_TEST_SPACE_A11Y_JUDGE_DEPLOYMENT"),
              imageInputSupport: true,
            }),
          }
        : {}),
    },
    {
      apiKeyProvider: () => requireApiKey(),
    },
  );

  const report = await runLiveRoleContractSmoke(bundle);
  const formatted = formatLiveRoleContractSmokeReport(report);
  process.stdout.write(`${formatted}\n`);
  assert.equal(report.ok, true, formatted);
});
