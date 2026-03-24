import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { getAllowedFigmaSourceModes, getAllowedLlmCodegenModes, getWorkspaceDefaults } from "./mode-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");

const readRepoFile = async (relativePath: string): Promise<string> => {
  return await readFile(path.resolve(packageRoot, relativePath), "utf8");
};

test("docs: mode lock docs stay aligned with runtime constraints", async () => {
  const architectureDoc = await readRepoFile("ARCHITECTURE.md");
  const claudeDoc = await readRepoFile("CLAUDE.md");
  const docsToCheck = [architectureDoc, claudeDoc];
  const defaults = getWorkspaceDefaults();
  const figmaModeLock = `figmaSourceMode=${getAllowedFigmaSourceModes().join("|")}`;
  const codegenModeLock = `llmCodegenMode=${getAllowedLlmCodegenModes().join("|")}`;

  for (const document of docsToCheck) {
    assert.match(document, new RegExp(figmaModeLock.replace("|", "\\|")));
    assert.match(document, new RegExp(codegenModeLock.replace("|", "\\|")));
  }

  assert.match(architectureDoc, /MODE_LOCK_VIOLATION/);
  assert.match(claudeDoc, /figmaSourceMode=rest\|hybrid\|local_json/);
  assert.match(claudeDoc, /module resolution `node16`/);
  assert.equal(defaults.figmaSourceMode, "rest");
  assert.equal(defaults.llmCodegenMode, "deterministic");
});

test("docs: validation and app template source contain expected pipeline patterns", async () => {
  const validationSource = await readRepoFile("src/job-engine/validation.ts");
  const appTemplateSource = await readRepoFile("src/parity/templates/app-template.ts");

  assert.match(validationSource, /args: \["lint", "--fix"\]/);
  assert.match(validationSource, /args: \["run", "test"\]/);
  assert.match(validationSource, /args: \["run", "validate:ui"\]/);
  assert.match(validationSource, /args: \["run", "perf:assert"\]/);
  assert.match(appTemplateSource, /BrowserRouter/);
  assert.match(appTemplateSource, /HashRouter/);
});
