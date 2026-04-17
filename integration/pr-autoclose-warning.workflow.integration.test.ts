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

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /types: \[opened, edited, reopened\]/);
  assert.match(workflow, /actions\/github-script@v8/);
  assert.match(workflow, /core\.warning\(/);
  assert.equal(
    workflow.includes("close[sd]?|fix(?:e[sd])?|resolve[sd]?"),
    true,
  );
  assert.match(workflow, /#\(\\d\+\)/);
  assert.doesNotMatch(workflow, /core\.setFailed\(/);
});
