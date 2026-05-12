import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert";

const readReleaseWorkflow = () =>
  readFile(".github/workflows/changesets-release.yml", "utf8");

const extractStep = (workflow, stepName, nextStepName) => {
  const start = workflow.indexOf(`- name: ${stepName}`);
  assert.notStrictEqual(start, -1, `missing workflow step: ${stepName}`);

  const end = workflow.indexOf(`- name: ${nextStepName}`, start);
  assert.notStrictEqual(end, -1, `missing workflow step: ${nextStepName}`);

  return workflow.slice(start, end);
};

test("changesets release workflow: npm CLI upgrade is effective and guarded", async () => {
  const workflow = await readReleaseWorkflow();
  const upgradeStep = extractStep(
    workflow,
    "Upgrade npm for trusted publishing",
    "Install dependencies",
  );

  assert.match(upgradeStep, /npm install --global --ignore-scripts npm@11\./);
  assert.doesNotMatch(upgradeStep, /pnpm add --global.*npm@11/);
  assert.match(upgradeStep, /NPM_CLI_VERSION="\$\(npm --version\)"/);
  assert.match(upgradeStep, /npm trusted publishing requires npm CLI >= 11\.5\.1/);
});

test("changesets release workflow: trusted publishing uses token-free npmrc and explicit OIDC token", async () => {
  const workflow = await readReleaseWorkflow();
  const authStep = extractStep(
    workflow,
    "Select npm publish auth mode",
    "Apply pending changesets and publish package",
  );

  assert.match(authStep, /trusted-publisher-oidc\)/);
  assert.match(
    authStep,
    /TRUSTED_NPMRC="\$\{RUNNER_TEMP\}\/npm-trusted-publisher\.npmrc"/,
  );
  assert.match(
    authStep,
    /echo "registry=https:\/\/registry\.npmjs\.org\/" > "\$\{TRUSTED_NPMRC\}"/,
  );
  assert.match(
    authStep,
    /echo "NPM_CONFIG_USERCONFIG=\$\{TRUSTED_NPMRC\}" >> "\$GITHUB_ENV"/,
  );
  assert.match(authStep, /ACTIONS_ID_TOKEN_REQUEST_URL/);
  assert.match(authStep, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(authStep, /audience=npm%3Aregistry\.npmjs\.org/);
  assert.match(authStep, /echo "::add-mask::\$\{NPM_ID_TOKEN\}"/);
  assert.match(authStep, /NPM_ID_TOKEN_FILE="\$\{RUNNER_TEMP\}\/npm-id-token"/);
  assert.match(authStep, /printf '%s' "\$\{NPM_ID_TOKEN\}" > "\$\{NPM_ID_TOKEN_FILE\}"/);
  assert.match(authStep, /chmod 600 "\$\{NPM_ID_TOKEN_FILE\}"/);
  assert.match(authStep, /echo "NPM_ID_TOKEN_FILE=\$\{NPM_ID_TOKEN_FILE\}" >> "\$GITHUB_ENV"/);
  assert.doesNotMatch(authStep, /NPM_ID_TOKEN=\$\{NPM_ID_TOKEN\}" >> "\$GITHUB_ENV"/);
});

test("changesets release workflow: trusted publishing token is scoped to publish step", async () => {
  const workflow = await readReleaseWorkflow();
  const publishStep = extractStep(
    workflow,
    "Apply pending changesets and publish package",
    "Create GitHub release and attach evidence assets",
  );

  assert.match(publishStep, /cleanup_npm_id_token\(\)/);
  assert.match(publishStep, /trap cleanup_npm_id_token EXIT/);
  assert.match(publishStep, /NPM_ID_TOKEN="\$\(< "\$\{NPM_ID_TOKEN_FILE\}"\)"/);
  assert.match(publishStep, /export NPM_ID_TOKEN/);
  assert.match(publishStep, /rm -f "\$\{NPM_ID_TOKEN_FILE\}"/);
});
