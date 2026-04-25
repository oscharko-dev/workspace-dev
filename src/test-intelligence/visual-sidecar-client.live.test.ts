import assert from "node:assert/strict";
import test from "node:test";

import type {
  LlmGatewayCapabilities,
  LlmGatewayClientConfig,
  LlmGatewayRole,
  VisualScreenDescription,
} from "../contracts/index.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { createLlmGatewayClientBundle } from "./llm-gateway-bundle.js";
import { loadWave1PocCaptureFixture, loadWave1PocFixture } from "./poc-fixtures.js";
import { describeVisualScreens } from "./visual-sidecar-client.js";

const LIVE_SMOKE_FLAG = "WORKSPACE_TEST_SPACE_LIVE_SMOKE";
const API_KEY_ENV = "WORKSPACE_TEST_SPACE_API_KEY";

const REQUIRED_LIVE_ENV = [
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  API_KEY_ENV,
] as const;

const testGenerationCapabilities: LlmGatewayCapabilities = {
  structuredOutputs: true,
  seedSupport: false,
  reasoningEffortSupport: false,
  maxOutputTokensSupport: true,
  streamingSupport: false,
  imageInputSupport: false,
};

const visualCapabilities: LlmGatewayCapabilities = {
  ...testGenerationCapabilities,
  imageInputSupport: true,
};

const circuitBreaker = { failureThreshold: 2, resetTimeoutMs: 30_000 } as const;

const requireEnv = (name: (typeof REQUIRED_LIVE_ENV)[number]): string => {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required for live visual-sidecar smoke`);
  }
  return value;
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
  modelRevision: `${input.deployment}@live-smoke`,
  gatewayRelease: "azure-ai-foundry-live-smoke",
  authMode: "api_key",
  declaredCapabilities: input.imageInputSupport
    ? visualCapabilities
    : testGenerationCapabilities,
  timeoutMs: 30_000,
  maxRetries: 1,
  circuitBreaker,
});

test("live visual sidecar smoke: fixture capture describes through role-separated Azure deployments", async (t) => {
  if (process.env[LIVE_SMOKE_FLAG] !== "1") {
    t.skip(`${LIVE_SMOKE_FLAG}=1 enables the operator-controlled live smoke test.`);
    return;
  }

  const missing = REQUIRED_LIVE_ENV.filter((name) => {
    const value = process.env[name];
    return typeof value !== "string" || value.length === 0;
  });
  assert.deepEqual(
    missing,
    [],
    `missing required live smoke env names: ${missing.join(", ")}`,
  );

  const fixture = await loadWave1PocFixture("poc-onboarding");
  const { captures } = await loadWave1PocCaptureFixture("poc-onboarding");
  const bundle = createLlmGatewayClientBundle(
    {
      testGeneration: buildConfig({
        role: "test_generation",
        baseUrl: requireEnv("WORKSPACE_TEST_SPACE_MODEL_ENDPOINT"),
        deployment: requireEnv("WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT"),
        imageInputSupport: false,
      }),
      visualPrimary: buildConfig({
        role: "visual_primary",
        baseUrl: requireEnv("WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT"),
        deployment: requireEnv("WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT"),
        imageInputSupport: true,
      }),
      visualFallback: buildConfig({
        role: "visual_fallback",
        baseUrl: requireEnv("WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT"),
        deployment: requireEnv("WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT"),
        imageInputSupport: true,
      }),
    },
    {
      apiKeyProvider: () => requireEnv(API_KEY_ENV),
    },
  );

  const result = await describeVisualScreens({
    bundle,
    captures,
    jobId: "job-live-visual-sidecar-smoke",
    generatedAt: "2026-04-25T00:00:00.000Z",
    intent: deriveBusinessTestIntentIr({ figma: fixture.figma }),
    primaryDeployment: "llama-4-maverick-vision",
  });

  assert.equal(result.outcome, "success");
  if (result.outcome !== "success") return;
  assert.ok(result.visual.length > 0);
  assert.ok(result.visual.every(hasKnownScreenId));
  assert.equal(result.captureIdentities.length, captures.length);
  assert.equal(
    bundle.testGeneration.declaredCapabilities.imageInputSupport,
    false,
  );
});

const hasKnownScreenId = (screen: VisualScreenDescription): boolean =>
  typeof screen.screenId === "string" && screen.screenId.length > 0;
