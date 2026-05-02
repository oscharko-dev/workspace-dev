/**
 * Unit tests for the auto-wiring helper that lifts the figma_to_qc
 * production runner from CLI-only to server-side (Issue #1733).
 *
 * Behavioural contract:
 *   - both gates off  -> factory undefined
 *   - one gate off    -> factory undefined
 *   - both gates on   -> factory returned, builds client lazily on first call
 *   - missing env vars-> ProductionRunnerError(LLM_GATEWAY_FAILED) on first call
 *   - secrets are not echoed in error messages
 */

import assert from "node:assert/strict";
import test from "node:test";

import { ProductionRunnerError } from "../test-intelligence/index.js";
import {
  resolveLlmConfigFromEnv,
  resolveTestIntelligenceProductionRunner,
} from "./test-intelligence-production-runner-factory.js";

const ENV_OK = {
  WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://aoai.example/openai/v1",
  WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
  WORKSPACE_TEST_SPACE_MODEL_API_KEY: "k-key-secret",
};

test("resolveTestIntelligenceProductionRunner: undefined when startup gate off", () => {
  const factory = resolveTestIntelligenceProductionRunner({
    startupEnabled: false,
    envEnabled: true,
    env: ENV_OK,
  });
  assert.equal(factory, undefined);
});

test("resolveTestIntelligenceProductionRunner: undefined when env gate off", () => {
  const factory = resolveTestIntelligenceProductionRunner({
    startupEnabled: true,
    envEnabled: false,
    env: ENV_OK,
  });
  assert.equal(factory, undefined);
});

test("resolveLlmConfigFromEnv: throws ProductionRunnerError when endpoint missing", () => {
  assert.throws(
    () =>
      resolveLlmConfigFromEnv({
        WORKSPACE_TEST_SPACE_MODEL_API_KEY: "k",
      }),
    ProductionRunnerError,
  );
  // Verify the error message names the missing env var, not the secret.
  try {
    resolveLlmConfigFromEnv({
      WORKSPACE_TEST_SPACE_MODEL_API_KEY: "k-secret",
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.ok(err instanceof ProductionRunnerError);
    assert.match(err.message, /WORKSPACE_TEST_SPACE_MODEL_ENDPOINT/u);
    assert.doesNotMatch(err.message, /k-secret/u);
  }
});

test("resolveLlmConfigFromEnv: throws ProductionRunnerError when api-key missing", () => {
  assert.throws(
    () =>
      resolveLlmConfigFromEnv({
        WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://aoai.example/openai/v1",
      }),
    ProductionRunnerError,
  );
});

test("resolveLlmConfigFromEnv: defaults deployment when not set", () => {
  const config = resolveLlmConfigFromEnv({
    WORKSPACE_TEST_SPACE_MODEL_ENDPOINT: "https://aoai.example/openai/v1",
    WORKSPACE_TEST_SPACE_MODEL_API_KEY: "k",
  });
  assert.ok(config.deployment.length > 0);
});

test("resolveTestIntelligenceProductionRunner: factory builds client lazily and forwards to runner", async () => {
  let buildCalls = 0;
  let runnerCalls = 0;
  const factory = resolveTestIntelligenceProductionRunner({
    startupEnabled: true,
    envEnabled: true,
    env: ENV_OK,
    buildLlmClient: () => {
      buildCalls += 1;
      return {} as unknown as ReturnType<
        Required<
          Parameters<typeof resolveTestIntelligenceProductionRunner>[0]
        >["buildLlmClient"]
      >;
    },
    runner: async (input) => {
      runnerCalls += 1;
      assert.equal(input.outputRoot, "/tmp/out");
      assert.ok(input.llm.client);
      return {
        jobId: input.jobId,
        generatedAt: input.generatedAt,
        fileKey: "abc",
      } as never;
    },
  });
  assert.ok(factory);
  assert.equal(buildCalls, 0);

  await factory({
    jobId: "ti-test-1",
    generatedAt: "2026-05-02T00:00:00.000Z",
    source: { kind: "figma_url", figmaUrl: "x", accessToken: "t" },
    outputRoot: "/tmp/out",
  });
  assert.equal(buildCalls, 1, "builds on first call");
  assert.equal(runnerCalls, 1);

  // Second call reuses cached client.
  await factory({
    jobId: "ti-test-2",
    generatedAt: "2026-05-02T00:00:01.000Z",
    source: { kind: "figma_url", figmaUrl: "y", accessToken: "t" },
    outputRoot: "/tmp/out",
  });
  assert.equal(buildCalls, 1, "client cached after first call");
  assert.equal(runnerCalls, 2);
});

test("resolveTestIntelligenceProductionRunner: missing env propagates as ProductionRunnerError on first invocation", async () => {
  const factory = resolveTestIntelligenceProductionRunner({
    startupEnabled: true,
    envEnabled: true,
    env: {}, // no envs at all
    runner: async () => {
      assert.fail("runner should not be reached when env is incomplete");
    },
  });
  assert.ok(factory);
  await assert.rejects(
    factory({
      jobId: "ti-test-3",
      generatedAt: "2026-05-02T00:00:02.000Z",
      source: { kind: "figma_url", figmaUrl: "x", accessToken: "t" },
      outputRoot: "/tmp/out",
    }),
    (err: unknown) =>
      err instanceof ProductionRunnerError &&
      err.failureClass === "LLM_GATEWAY_FAILED",
  );
});
