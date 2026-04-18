import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const readWorkflow = () =>
  readFile(
    path.resolve(packageRoot, ".github/workflows/changesets-release.yml"),
    "utf8",
  );

test("integration: release workflow does not grant write-scoped permissions at workflow level", async () => {
  const workflow = await readWorkflow();

  const jobsIndex = workflow.indexOf("\njobs:");
  assert.ok(jobsIndex !== -1, "workflow must have a jobs section");

  const preamble = workflow.slice(0, jobsIndex);

  assert.doesNotMatch(
    preamble,
    /contents:\s*write/,
    "workflow-level permissions must not include contents: write",
  );
  assert.doesNotMatch(
    preamble,
    /pull-requests:\s*write/,
    "workflow-level permissions must not include pull-requests: write",
  );
  assert.doesNotMatch(
    preamble,
    /id-token:\s*write/,
    "workflow-level permissions must not include id-token: write",
  );

  assert.match(
    preamble,
    /permissions:/,
    "workflow must declare an explicit permissions block",
  );
  assert.match(
    preamble,
    /contents:\s*read/,
    "workflow-level permissions must set contents: read",
  );
});

test("integration: release job has required write permissions at job level", async () => {
  const workflow = await readWorkflow();

  const releaseJobIndex = workflow.indexOf("\n  release:");
  assert.ok(releaseJobIndex !== -1, "workflow must have a release job");

  const releaseSection = workflow.slice(releaseJobIndex);

  assert.match(
    releaseSection,
    /permissions:/,
    "release job must declare an explicit permissions block",
  );
  assert.match(
    releaseSection,
    /contents:\s*write/,
    "release job must have contents: write",
  );
  assert.match(
    releaseSection,
    /pull-requests:\s*write/,
    "release job must have pull-requests: write",
  );
  assert.match(
    releaseSection,
    /id-token:\s*write/,
    "release job must have id-token: write",
  );
});

test("integration: install/test jobs set persist-credentials: false on checkout", async () => {
  const workflow = await readWorkflow();

  const jobsStart = workflow.indexOf("\njobs:");
  assert.ok(jobsStart !== -1);

  const releaseStart = workflow.indexOf("\n  release:");
  assert.ok(releaseStart !== -1);

  const preReleaseJobs = workflow.slice(jobsStart, releaseStart);

  const checkouts = preReleaseJobs.match(/uses: actions\/checkout@v\d+/g);
  assert.ok(
    checkouts !== null && checkouts.length > 0,
    "pre-release jobs must contain at least one checkout step",
  );

  const persistFalseOccurrences = (
    preReleaseJobs.match(/persist-credentials:\s*false/g) ?? []
  ).length;

  assert.equal(
    persistFalseOccurrences,
    checkouts.length,
    `every checkout in pre-release jobs must set persist-credentials: false (found ${persistFalseOccurrences} of ${checkouts.length})`,
  );
});
