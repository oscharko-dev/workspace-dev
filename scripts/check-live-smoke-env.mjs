#!/usr/bin/env node
/**
 * Issue #1660 (audit-2026-05): fast-fail env-var checker for the live
 * visual-sidecar smoke. Runs as the first step of `pnpm run test:ti-live-smoke`
 * so an operator running the test from a fresh checkout sees a single,
 * friendly, actionable error message instead of an `assert.deepEqual`
 * failure deep inside the test runner.
 *
 * Zero runtime deps, zero side effects beyond stdout/stderr.
 *
 * Usage:
 *   node scripts/check-live-smoke-env.mjs
 *
 * Exit codes:
 *   0  every required env var is set; live smoke can proceed
 *   1  one or more required env vars are missing
 */

// API-key alias precedence — see `visual-sidecar-client.live.test.ts`.
const API_KEY_ALIASES = [
  "WORKSPACE_TEST_SPACE_API_KEY",
  "WORKSPACE_TEST_SPACE_MODEL_API_KEY",
];

const NON_AUTH_REQUIRED = [
  "WORKSPACE_TEST_SPACE_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT",
  "WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT",
  "WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT",
];

const isSet = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.length > 0;
};

/**
 * Pure analyser exported for the script's own test. Returns `null` when
 * the input env is sufficient to run the live smoke; returns a structured
 * descriptor of what's missing otherwise.
 */
export const analyzeEnv = (env) => {
  const missingNonAuth = NON_AUTH_REQUIRED.filter(
    (name) => typeof env[name] !== "string" || env[name].length === 0,
  );
  const apiKeySet = API_KEY_ALIASES.some(
    (name) => typeof env[name] === "string" && env[name].length > 0,
  );
  if (missingNonAuth.length === 0 && apiKeySet) {
    return null;
  }
  return {
    missingNonAuth,
    apiKeySet,
    apiKeyAliases: API_KEY_ALIASES,
  };
};

const run = () => {
  const liveSmokeFlag = process.env.WORKSPACE_TEST_SPACE_LIVE_SMOKE;
  const liveE2eFlag = process.env.WORKSPACE_TEST_SPACE_LIVE_E2E;
  const liveSmokeEnabled =
    typeof liveSmokeFlag === "string" && liveSmokeFlag.length > 0;
  const liveE2eEnabled =
    typeof liveE2eFlag === "string" && liveE2eFlag.length > 0;
  if (!liveSmokeEnabled && !liveE2eEnabled) {
    process.stdout.write(
      "[check-live-smoke-env] Neither WORKSPACE_TEST_SPACE_LIVE_SMOKE nor WORKSPACE_TEST_SPACE_LIVE_E2E is set; live tests are opt-in and will self-skip. Skipping env check.\n",
    );
    return;
  }

  const result = analyzeEnv(process.env);
  if (result === null) {
    process.stdout.write(
      "[check-live-smoke-env] All live smoke environment variables are set.\n",
    );
    return;
  }

  process.stderr.write(
    `[check-live-smoke-env] Live test is enabled (${
      liveE2eEnabled
        ? "WORKSPACE_TEST_SPACE_LIVE_E2E"
        : "WORKSPACE_TEST_SPACE_LIVE_SMOKE"
    }=1) but the environment is incomplete.\n`,
  );
  if (result.missingNonAuth.length > 0) {
    process.stderr.write("\n  Missing required env vars:\n");
    for (const name of result.missingNonAuth) {
      process.stderr.write(`    - ${name}\n`);
    }
  }
  if (!result.apiKeySet) {
    process.stderr.write(
      `\n  API key not set. Set ONE of (precedence in this order):\n`,
    );
    for (const name of result.apiKeyAliases) {
      process.stderr.write(`    - ${name}\n`);
    }
  }
  process.stderr.write(
    "\n  See docs/local-runtime.md and docs/test-intelligence.md for a full operator setup walkthrough.\n",
  );
  process.exit(1);
};

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    run();
  } catch (err) {
    process.stderr.write(
      `[check-live-smoke-env] failed: ${err && err.message}\n`,
    );
    process.exit(2);
  }
}
