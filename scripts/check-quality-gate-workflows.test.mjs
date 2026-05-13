import { test } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";

const readWorkflow = (path) => readFile(path, "utf8");

const extractJob = (workflow, jobName, nextJobName) => {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notStrictEqual(start, -1, `missing workflow job: ${jobName}`);

  if (nextJobName === undefined) {
    return workflow.slice(start);
  }

  const end = workflow.indexOf(`  ${nextJobName}:`, start + 1);
  assert.notStrictEqual(end, -1, `missing workflow job: ${nextJobName}`);
  return workflow.slice(start, end);
};

const assertNoHeavyBlockingCommands = (workflow, label) => {
  for (const pattern of [
    /pnpm run test(?:\s|$)/,
    /pnpm run test:coverage/,
    /pnpm run test:mutation/,
    /pnpm run test:golden/,
    /pnpm run test:ti-/,
    /pnpm run ui:test:coverage/,
    /pnpm run ui:test:e2e/,
    /pnpm run test:flaky-retry/,
    /pnpm run test:bdd/,
    /pnpm run test:property-based/,
    /pnpm run verify:pack/,
    /pnpm run lint:publint/,
    /pnpm run lint:types-publish/,
    /pnpm run lint:size/,
    /pnpm run perf:/,
    /pnpm run sbom:/,
    /pnpm run verify:sbom:parity/,
    /pnpm run verify:reproducible-build/,
  ]) {
    assert.doesNotMatch(workflow, pattern, `${label} contains ${pattern}`);
  }
};

test("main release gate keeps required check names while staying fast", async () => {
  const workflow = await readWorkflow(".github/workflows/release-gate.yml");

  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /node-version: \[22, 24\]/);

  const quality = extractJob(workflow, "quality", "fips-smoke");
  assert.match(quality, /timeout-minutes: 25/);
  assert.match(quality, /Supply-chain and workflow policy/);
  assert.match(quality, /pnpm run verify:pnpm-supply-chain-policy/);
  assert.match(quality, /pnpm run verify:supply-chain-iocs/);
  assert.match(quality, /Repository policy/);
  assert.match(quality, /Focused runtime smoke tests/);
  assertNoHeavyBlockingCommands(quality, "release quality job");

  assert.match(workflow, /\n  fips-smoke:\n/);
  assert.match(workflow, /\n  release-readiness:\n/);
  assert.match(workflow, /needs: \[quality, fips-smoke\]/);
  assert.doesNotMatch(workflow, /pnpm run release:readiness/);
  assert.doesNotMatch(workflow, /\n  performance-web:\n/);
});

test("dev quality gate is a fast push gate, not a deep release suite", async () => {
  const workflow = await readWorkflow(".github/workflows/dev-quality-gate.yml");

  assert.match(workflow, /push:\n\s+branches: \[dev\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /\n  policy-guards:\n/);
  assert.match(workflow, /\n  typecheck-build:\n/);
  assert.match(workflow, /\n  focused-tests:\n/);
  assert.match(workflow, /\n  template-smoke:\n/);
  assert.match(workflow, /\n  dev-summary:\n/);
  assertNoHeavyBlockingCommands(workflow, "dev quality gate");

  for (const requiredNeed of [
    "policy-guards",
    "typecheck-build",
    "focused-tests",
    "template-smoke",
  ]) {
    assert.match(workflow, new RegExp(`\\n\\s+- ${requiredNeed}\\n`));
  }
});

test("PR quality gate remains fast for normal dev iteration", async () => {
  const workflow = await readWorkflow(".github/workflows/pr-quality-gate.yml");

  assert.match(workflow, /pull_request:\n\s+branches: \[dev\]/);
  assert.match(workflow, /timeout-minutes: 30/);
  assert.match(workflow, /Workflow and supply-chain policy/);
  assert.match(workflow, /pnpm run verify:pnpm-supply-chain-policy/);
  assert.match(workflow, /pnpm run verify:supply-chain-iocs/);
  assert.match(workflow, /Focused tests/);
  assertNoHeavyBlockingCommands(workflow, "PR quality gate");
});

test("visual benchmark is manual deep quality, not a dev push blocker", async () => {
  const workflow = await readWorkflow(".github/workflows/visual-benchmark.yml");

  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /push:\n\s+branches: \[dev\]/);
});

test("main source guard can satisfy the required check on main pushes", async () => {
  const workflow = await readWorkflow(
    ".github/workflows/main-merge-source-guard.yml",
  );

  assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /allow-only-dev:\n\s+timeout-minutes: 5/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /CHECK_EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /CHECK_HEAD_REF: \$\{\{ github\.head_ref \}\}/);
  assert.match(
    workflow,
    /if \[\[ "\$\{CHECK_EVENT_NAME\}" == "pull_request" \]\]/,
  );
  assert.match(workflow, /"\$\{CHECK_HEAD_REF\}" != "dev"/);
  assert.match(
    workflow,
    /git fetch --no-tags --prune origin refs\/heads\/dev:refs\/remotes\/origin\/dev/,
  );
  assert.match(
    workflow,
    /git diff --quiet "\$\{CHECK_SHA\}" refs\/remotes\/origin\/dev/,
  );
});

test("required branch-protection checks run on protected branch pushes", async () => {
  const workflowLint = await readWorkflow(
    ".github/workflows/workflow-lint.yml",
  );
  const pinCheck = await readWorkflow(".github/workflows/pin-check.yml");
  const dependencyReview = await readWorkflow(
    ".github/workflows/dependency-review.yml",
  );

  for (const workflow of [workflowLint, pinCheck, dependencyReview]) {
    assert.match(workflow, /push:\n\s+branches: \[dev, main\]/);
    assert.match(workflow, /pull_request:\n\s+branches: \[dev, main\]/);
  }

  assert.match(
    dependencyReview,
    /Review dependency changes for known advisories \(PR\)\n\s+if: github\.event_name == 'pull_request'/,
  );
  assert.match(
    dependencyReview,
    /Review dependency changes for known advisories \(push\)\n\s+if: github\.event_name == 'push'/,
  );
  assert.match(dependencyReview, /base-ref: \$\{\{ github\.event\.before \}\}/);
});
