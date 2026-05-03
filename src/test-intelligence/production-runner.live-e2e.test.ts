/**
 * Live end-to-end smoke for the production runner (Issue #1737).
 *
 * Self-skips unless `WORKSPACE_TEST_SPACE_LIVE_E2E=1`. When enabled,
 * runs `runFigmaToQcTestCases` against the operator-configured Azure AI
 * Foundry deployment using a synthetic banking-form Figma fixture
 * (committed under `fixtures/live-e2e/`). The test asserts:
 *   - the runner returns a non-empty `generatedTestCases` list,
 *   - every case has a non-empty title and at least one step,
 *   - the policy report is finalised (not blocked by gateway error),
 *   - the FinOps envelope is the production-default envelope.
 *
 * Cost ceiling: this single run is bounded by
 * PRODUCTION_FINOPS_BUDGET_ENVELOPE — at the example pricing in the
 * operator runbook the worst-case spend per invocation is ≈ $0.36.
 *
 * Triggered by:
 *   - `pnpm test:ti-live-e2e` (local)
 *   - `.github/workflows/test-intelligence-live-e2e.yml` (workflow_dispatch + nightly)
 *
 * NOT included in `pnpm test` or `pnpm test:smoke:compile` — those gates
 * stay hermetic and do not require operator credentials.
 */

import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createLlmGatewayClientBundle,
  type LlmGatewayClientBundle,
} from "./llm-gateway-bundle.js";
import {
  type LlmGatewayCapabilities,
  type LlmGatewayClientConfig,
  type LlmGatewayRole,
} from "../contracts/index.js";
import { PRODUCTION_FINOPS_BUDGET_ENVELOPE } from "./finops-budget.js";
import {
  PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT,
  runFigmaToQcTestCases,
} from "./production-runner.js";
import type { FigmaRestFileSnapshot } from "./figma-rest-adapter.js";

const LIVE_E2E_FLAG = "WORKSPACE_TEST_SPACE_LIVE_E2E";

const API_KEY_ALIASES = [
  "WORKSPACE_TEST_SPACE_API_KEY",
  "WORKSPACE_TEST_SPACE_MODEL_API_KEY",
] as const;

const NON_AUTH_REQUIRED_ENV = [
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
] as const;

const FIXTURE_PATH = new URL(
  "./fixtures/live-e2e/banking-antrag.figma.json",
  import.meta.url,
);
const LIVE_E2E_ARTIFACT_ROOT = join(
  process.cwd(),
  "artifacts",
  "testing",
  "ti-live-e2e",
);

const requireEnv = (name: (typeof NON_AUTH_REQUIRED_ENV)[number]): string => {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required for live-E2E smoke`);
  }
  return value;
};

const requireApiKey = (): string => {
  for (const candidate of API_KEY_ALIASES) {
    const value = process.env[candidate];
    if (typeof value === "string" && value.length > 0) return value;
  }
  throw new Error(
    `live-E2E smoke requires one of: ${API_KEY_ALIASES.join(", ")}`,
  );
};

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
  modelRevision: `${input.deployment}@live-e2e`,
  gatewayRelease: "azure-ai-foundry-live-e2e",
  authMode: "api_key",
  declaredCapabilities: input.imageInputSupport
    ? visualCapabilities
    : testGenerationCapabilities,
  timeoutMs: 60_000,
  maxRetries: 1,
  circuitBreaker: { failureThreshold: 2, resetTimeoutMs: 30_000 },
});

const loadFixture = async (): Promise<FigmaRestFileSnapshot> => {
  const raw = await readFile(FIXTURE_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("name" in parsed) ||
    !("fileKey" in parsed) ||
    !("document" in parsed)
  ) {
    throw new Error("live-E2E fixture is not a FigmaRestFileSnapshot");
  }
  return parsed as FigmaRestFileSnapshot;
};

test("live-E2E: production runner generates test cases against Azure for a synthetic banking Antrag", async (t) => {
  if (process.env[LIVE_E2E_FLAG] !== "1") {
    t.skip(
      `${LIVE_E2E_FLAG}=1 enables the operator-controlled live-E2E smoke.`,
    );
    return;
  }

  const fixture = await loadFixture();

  const visualBaseUrl =
    process.env["WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT"] ??
    requireEnv("WORKSPACE_TEST_SPACE_MODEL_ENDPOINT");
  const visualPrimaryDeployment =
    process.env["WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT"] ??
    requireEnv("WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT");
  const visualFallbackDeployment =
    process.env["WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT"] ??
    visualPrimaryDeployment;

  const bundle: LlmGatewayClientBundle = createLlmGatewayClientBundle(
    {
      testGeneration: buildConfig({
        role: "test_generation",
        baseUrl: requireEnv("WORKSPACE_TEST_SPACE_MODEL_ENDPOINT"),
        deployment: requireEnv(
          "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
        ),
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
    },
    {
      apiKeyProvider: () => requireApiKey(),
    },
  );

  await mkdir(LIVE_E2E_ARTIFACT_ROOT, { recursive: true });
  const result = await runFigmaToQcTestCases({
    jobId: `live-e2e-${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    source: { kind: "figma_paste_normalized", file: fixture },
    outputRoot: LIVE_E2E_ARTIFACT_ROOT,
    llm: { client: bundle.testGeneration },
  });

  assert.equal(
    result.finopsBudget.budgetId,
    PRODUCTION_FINOPS_BUDGET_ENVELOPE.budgetId,
    "production runner must default to PRODUCTION_FINOPS_BUDGET_ENVELOPE",
  );
  assert.equal(
    bundle.testGeneration.declaredCapabilities.imageInputSupport,
    false,
    "test_generation deployment must not advertise image input",
  );
  assert.ok(
    result.generatedTestCases.testCases.length > 0,
    `expected at least one generated test case, got ${result.generatedTestCases.testCases.length}`,
  );
  for (const testCase of result.generatedTestCases.testCases) {
    assert.ok(
      typeof testCase.title === "string" && testCase.title.length > 0,
      `test case ${testCase.id} must have a non-empty title`,
    );
    assert.ok(
      Array.isArray(testCase.steps) && testCase.steps.length > 0,
      `test case ${testCase.id} must have at least one step`,
    );
  }
  assert.equal(
    result.policy.policyProfileId,
    "eu-banking-default",
    "default policy profile must be applied for the production runner",
  );
  assert.notEqual(
    result.policy.totalTestCases,
    0,
    "policy report must enumerate the generated cases",
  );

  // Surface the deployment and stable artifact directory so the closing-gate
  // review can verify that the required files were emitted without re-running.
  process.stdout.write(
    `[live-E2E] generated ${String(result.generatedTestCases.testCases.length)} cases via ${PRODUCTION_RUNNER_TEST_GENERATION_DEPLOYMENT}\n`,
  );
  process.stdout.write(`[live-E2E] artifactDir=${result.artifactDir}\n`);
});
