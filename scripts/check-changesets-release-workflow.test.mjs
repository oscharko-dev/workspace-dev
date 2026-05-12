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

test("changesets release workflow: trusted publishing uses a token-free npmrc", async () => {
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
});
