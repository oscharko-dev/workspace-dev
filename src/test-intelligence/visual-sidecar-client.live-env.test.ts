import assert from "node:assert/strict";
import test from "node:test";

import {
  findMissingRequiredLiveEnv,
  formatMissingRequiredLiveEnvMessage,
  isLiveSmokeEnabled,
  LIVE_LLM_API_KEY_ENV,
  LIVE_SMOKE_FLAG,
  LIVE_SMOKE_SKIP_MESSAGE,
  REQUIRED_LIVE_ENV,
  requireLiveSmokeApiKey,
  resolveLiveSmokeApiKey,
} from "./visual-sidecar-client.live-env.js";

test("live visual-sidecar smoke stays opt-in when the enable flag is unset", () => {
  assert.equal(isLiveSmokeEnabled({}), false);
  assert.equal(
    LIVE_SMOKE_SKIP_MESSAGE,
    `${LIVE_SMOKE_FLAG}=1 enables the operator-controlled live smoke test.`,
  );
});

test("live visual-sidecar smoke reports the documented missing-env message", () => {
  const missing = findMissingRequiredLiveEnv({});
  assert.deepEqual(missing, [...REQUIRED_LIVE_ENV]);
  assert.equal(
    formatMissingRequiredLiveEnvMessage(missing),
    "missing required live smoke env names: WORKSPACE_TEST_SPACE_MODEL_ENDPOINT, WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT, WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT, WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT, WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
  );
});

test("live smoke API key resolution uses the canonical LLM alias", () => {
  const resolved = resolveLiveSmokeApiKey({
    [LIVE_LLM_API_KEY_ENV]: "llm-key",
  });
  assert.deepEqual(resolved, {
    ok: true,
    source: LIVE_LLM_API_KEY_ENV,
    value: "llm-key",
  });
});

test("live smoke API key resolution rejects missing canonical LLM key", () => {
  const resolved = resolveLiveSmokeApiKey({});
  assert.equal(resolved.ok, false);
  if (resolved.ok) return;
  assert.equal(resolved.apiKeySet, false);
  assert.equal(resolved.apiKeyConflict, false);
  assert.deepEqual(resolved.apiKeyAliases, [LIVE_LLM_API_KEY_ENV]);
  assert.throws(
    () => requireLiveSmokeApiKey("test-context", {}),
    /test-context: live smoke requires WORKSPACE_TEST_SPACE_LLM_API_KEY/u,
  );
});
