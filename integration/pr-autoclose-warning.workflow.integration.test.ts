import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

test("integration: PR auto-close warning workflow stays warning-only and keyword-based", async () => {
  const workflow = await readFile(
    path.resolve(packageRoot, ".github/workflows/pr-autoclose-warning.yml"),
    "utf8",
  );

  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /types: \[opened, edited, reopened, synchronize, closed\]/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /actions\/checkout@(?:v6|[0-9a-f]{40})\s*#\s*v6/);
  assert.match(
    workflow,
    /actions\/github-script@(?:v9|[0-9a-f]{40})\s*#\s*v9/,
  );
  assert.match(workflow, /core\.warning\(/);
  assert.match(workflow, /issues\.createComment/);
  assert.match(workflow, /issues\.updateComment/);
  assert.match(workflow, /issues\.deleteComment/);
  assert.match(workflow, /scripts\/pr-autoclose-warning\.mjs/);
  assert.doesNotMatch(workflow, /core\.setFailed\(/);
});

test("integration: PR auto-close warning helper keeps GitHub keyword matching logic", async () => {
  const helper = await readFile(
    path.resolve(packageRoot, "scripts/pr-autoclose-warning.mjs"),
    "utf8",
  );

  assert.equal(helper.includes("close[sd]?"), true);
  assert.equal(helper.includes("fix(?:e[sd])?"), true);
  assert.equal(helper.includes("resolve[sd]?"), true);
  assert.match(helper, /PR_AUTOCLOSE_WARNING_MARKER/);
  assert.equal(
    helper.includes("without a GitHub auto-close keyword"),
    true,
  );
});
