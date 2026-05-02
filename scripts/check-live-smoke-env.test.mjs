import assert from "node:assert/strict";
import test from "node:test";
import { analyzeEnv } from "./check-live-smoke-env.mjs";

const FULL_ENV = {
  WORKSPACE_TEST_SPACE_MODEL_ENDPOINT:
    "https://example.cognitiveservices.azure.com",
  WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT: "gpt-oss-120b",
  WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT:
    "https://example.cognitiveservices.azure.com",
  WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT: "llama-4-maverick-vision",
  WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT: "phi-4-multimodal-poc",
  WORKSPACE_TEST_SPACE_API_KEY: "key-1",
};

test("analyzeEnv returns null when every required var is set with the legacy API key name", () => {
  assert.equal(analyzeEnv(FULL_ENV), null);
});

test("analyzeEnv returns null when the API key uses the operator MODEL alias", () => {
  const env = { ...FULL_ENV };
  delete env.WORKSPACE_TEST_SPACE_API_KEY;
  env.WORKSPACE_TEST_SPACE_MODEL_API_KEY = "key-via-alias";
  assert.equal(analyzeEnv(env), null);
});

test("analyzeEnv flags missing non-auth required env vars", () => {
  const env = { ...FULL_ENV };
  delete env.WORKSPACE_TEST_SPACE_MODEL_ENDPOINT;
  delete env.WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT;
  const result = analyzeEnv(env);
  assert.ok(result);
  assert.deepEqual(result.missingNonAuth, [
    "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
    "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  ]);
  // API key was still set, so apiKeySet remains true.
  assert.equal(result.apiKeySet, true);
});

test("analyzeEnv flags missing API key with both aliases listed", () => {
  const env = { ...FULL_ENV };
  delete env.WORKSPACE_TEST_SPACE_API_KEY;
  const result = analyzeEnv(env);
  assert.ok(result);
  assert.equal(result.apiKeySet, false);
  assert.deepEqual(result.apiKeyAliases, [
    "WORKSPACE_TEST_SPACE_API_KEY",
    "WORKSPACE_TEST_SPACE_MODEL_API_KEY",
  ]);
});

test("analyzeEnv treats empty-string env values as unset", () => {
  const env = { ...FULL_ENV, WORKSPACE_TEST_SPACE_API_KEY: "" };
  const result = analyzeEnv(env);
  assert.ok(result);
  assert.equal(result.apiKeySet, false);
});
