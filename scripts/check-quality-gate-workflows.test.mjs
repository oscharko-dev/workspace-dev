import { test } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

const readWorkflow = (path) => readFile(path, "utf8");

const extractStep = (workflow, stepName, nextStepName) => {
  const start = workflow.indexOf(`- name: ${stepName}`);
  assert.notStrictEqual(start, -1, `missing workflow step: ${stepName}`);

  if (nextStepName === undefined) {
    return workflow.slice(start);
  }

  const end = workflow.indexOf(`- name: ${nextStepName}`, start);
  assert.notStrictEqual(end, -1, `missing workflow step: ${nextStepName}`);
  return workflow.slice(start, end);
};

test("release gate keeps required quality matrix while running coverage once", async () => {
  const workflow = await readWorkflow(".github/workflows/release-gate.yml");

  assert.match(workflow, /node-version: \[22, 24\]/);
  assert.match(workflow, /quality:\n\s+timeout-minutes: 90/);

  const node24TestStep = extractStep(
    workflow,
    "Run Node 24 compatibility test suite",
    "Enforce backend coverage gate",
  );
  assert.match(node24TestStep, /if: matrix\.node-version == 24/);
  assert.match(node24TestStep, /run: pnpm run test/);

  const coverageStep = extractStep(
    workflow,
    "Enforce backend coverage gate",
    "Verify package tarball contents",
  );
  assert.match(coverageStep, /if: matrix\.node-version == 22/);
  assert.match(coverageStep, /timeout-minutes: 75/);
  assert.match(coverageStep, /run: pnpm run test:coverage/);

  for (const [stepName, nextStepName] of [
    ["Verify package tarball contents", "Enforce package publishing lint"],
    ["Enforce package publishing lint", "Enforce package type publish lint"],
    ["Enforce package type publish lint", "Run profile release gates"],
    ["Run profile release gates", undefined],
  ]) {
    const step = extractStep(workflow, stepName, nextStepName);
    assert.match(step, /if: matrix\.node-version == 22/);
  }
});

test("changesets release preflight uses the same bounded coverage budget", async () => {
  const workflow = await readWorkflow(
    ".github/workflows/changesets-release.yml",
  );

  assert.match(workflow, /release-preflight:\n\s+timeout-minutes: 90/);
  assert.match(
    workflow,
    /- name: Typecheck release package\n\s+run: pnpm run typecheck/,
  );

  const coverageStep = extractStep(
    workflow,
    "Enforce backend coverage gate",
    "Verify package tarball contents",
  );
  assert.match(coverageStep, /timeout-minutes: 75/);
  assert.match(coverageStep, /run: pnpm run test:coverage/);
});

test("dev quality gate has no hard-disabled workflow jobs", async () => {
  const workflow = await readWorkflow(".github/workflows/dev-quality-gate.yml");

  assert.doesNotMatch(workflow, /workflow_disabled/);
  assert.match(
    workflow,
    /unit-tests:\n\s+needs: \[setup\]\n\s+if: needs\.setup\.outputs\.src == 'true'/,
  );
  assert.match(
    workflow,
    /mutation-testing:\n\s+needs: \[setup\]\n\s+if: github\.event_name == 'workflow_dispatch'/,
  );
  assert.match(
    workflow,
    /coverage:\n\s+needs: \[setup\]\n\s+if: needs\.setup\.outputs\.src == 'true'/,
  );
  assert.match(
    workflow,
    /build-and-publish-checks:\n\s+needs: \[setup\]\n\s+if: needs\.setup\.outputs\.src == 'true'/,
  );
});

test("dev summary aggregates every dev gate job", async () => {
  const workflow = await readWorkflow(".github/workflows/dev-quality-gate.yml");

  for (const requiredNeed of [
    "policy-guards",
    "typecheck",
    "unit-tests",
    "template-tests",
    "golden-and-ti",
    "mutation-testing",
    "coverage",
    "e2e",
    "security-smoke",
    "build-and-publish-checks",
    "performance-web",
  ]) {
    assert.match(workflow, new RegExp(`\\n\\s+- ${requiredNeed}\\n`));
  }

  assert.match(
    workflow,
    /for name in POLICY_GUARDS TYPECHECK UNIT_TESTS TEMPLATE_TESTS GOLDEN_AND_TI MUTATION_TESTING COVERAGE E2E SECURITY_SMOKE BUILD_AND_PUBLISH_CHECKS PERFORMANCE_WEB;/,
  );
});

test("main source guard can satisfy the required check on main pushes", async () => {
  const workflow = await readWorkflow(
    ".github/workflows/main-merge-source-guard.yml",
  );

  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /allow-only-dev:\n\s+timeout-minutes: 5/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /GITHUB_EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /GITHUB_HEAD_REF: \$\{\{ github\.head_ref \}\}/);
  assert.match(
    workflow,
    /if \[\[ "\$\{GITHUB_EVENT_NAME\}" == "pull_request" \]\]/,
  );
  assert.match(workflow, /"\$\{GITHUB_HEAD_REF\}" != "dev"/);
  assert.match(
    workflow,
    /git fetch --no-tags --prune origin refs\/heads\/dev:refs\/remotes\/origin\/dev/,
  );
  assert.match(
    workflow,
    /git diff --quiet "\$\{GITHUB_SHA\}" refs\/remotes\/origin\/dev/,
  );
});
