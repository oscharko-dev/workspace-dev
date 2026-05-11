import { test } from "node:test";
import assert from "node:assert";

import { resolvePublishEnv } from "./changesets-publish.mjs";

const withEnv = (env, fn) => {
  const previous = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
};

test("resolvePublishEnv: defaults to trusted publishing outside GitHub Actions", () => {
  const publishEnv = withEnv({}, () => resolvePublishEnv());

  assert.strictEqual(publishEnv.WORKSPACE_DEV_PUBLISH_AUTH_MODE, undefined);
  assert.strictEqual(publishEnv.NPM_CONFIG_PROVENANCE, undefined);
});

test("resolvePublishEnv: rejects unsupported publish auth modes outside GitHub Actions", () => {
  assert.throws(
    () =>
      withEnv({ WORKSPACE_DEV_PUBLISH_AUTH_MODE: "bad-mode" }, () =>
        resolvePublishEnv()
      ),
    /Unsupported WORKSPACE_DEV_PUBLISH_AUTH_MODE/
  );
});

test("resolvePublishEnv: requires id-token for trusted publishing in GitHub Actions", () => {
  assert.throws(
    () =>
      withEnv(
        {
          GITHUB_ACTIONS: "true",
          WORKSPACE_DEV_PUBLISH_AUTH_MODE: "trusted-publisher-oidc"
        },
        () => resolvePublishEnv()
      ),
    /id-token permission is not available/
  );
});

test("resolvePublishEnv: removes token fallback for trusted publishing in GitHub Actions", () => {
  const publishEnv = withEnv(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/oidc",
      GITHUB_ACTIONS: "true",
      NODE_AUTH_TOKEN: "legacy-token",
      NPM_TOKEN: "legacy-token",
      WORKSPACE_DEV_PUBLISH_AUTH_MODE: "trusted-publisher-oidc"
    },
    () => resolvePublishEnv()
  );

  assert.strictEqual(publishEnv.NODE_AUTH_TOKEN, undefined);
  assert.strictEqual(publishEnv.NPM_TOKEN, undefined);
  assert.strictEqual(publishEnv.NPM_CONFIG_PROVENANCE, "true");
});

test("resolvePublishEnv: requires token for npm-token mode", () => {
  assert.throws(
    () =>
      withEnv({ WORKSPACE_DEV_PUBLISH_AUTH_MODE: "npm-token" }, () =>
        resolvePublishEnv()
      ),
    /NODE_AUTH_TOKEN\/NPM_TOKEN is missing/
  );
});

test("resolvePublishEnv: normalizes npm-token mode outside GitHub Actions", () => {
  const publishEnv = withEnv(
    {
      NPM_TOKEN: "npm-token-value",
      WORKSPACE_DEV_PUBLISH_AUTH_MODE: "npm-token"
    },
    () => resolvePublishEnv()
  );

  assert.strictEqual(publishEnv.NODE_AUTH_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_CONFIG_PROVENANCE, undefined);
});

test("resolvePublishEnv: disables provenance in GitHub npm-token mode without OIDC", () => {
  const publishEnv = withEnv(
    {
      GITHUB_ACTIONS: "true",
      NODE_AUTH_TOKEN: "npm-token-value",
      WORKSPACE_DEV_PUBLISH_AUTH_MODE: "npm-token"
    },
    () => resolvePublishEnv()
  );

  assert.strictEqual(publishEnv.NODE_AUTH_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_CONFIG_PROVENANCE, "false");
});

test("resolvePublishEnv: enables provenance in GitHub npm-token mode with OIDC", () => {
  const publishEnv = withEnv(
    {
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-token",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example/oidc",
      GITHUB_ACTIONS: "true",
      NODE_AUTH_TOKEN: "npm-token-value",
      WORKSPACE_DEV_PUBLISH_AUTH_MODE: "npm-token"
    },
    () => resolvePublishEnv()
  );

  assert.strictEqual(publishEnv.NODE_AUTH_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_TOKEN, "npm-token-value");
  assert.strictEqual(publishEnv.NPM_CONFIG_PROVENANCE, "true");
});
