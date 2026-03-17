import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateModeLock } from "./mode-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const featurePath = path.resolve(__dirname, "../features/workspace-mode-lock.feature");

const extractScenarioNames = (featureContent: string): string[] =>
  featureContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("Scenario:"))
    .map((line) => line.replace("Scenario:", "").trim());

test("bdd contract: workspace mode-lock feature scenarios exist", async () => {
  const featureContent = await readFile(featurePath, "utf8");
  const scenarios = extractScenarioNames(featureContent);
  const requiredScenarios = [
    "Accept locked modes",
    "Reject unsupported modes with actionable guidance"
  ];

  assert.ok(scenarios.length >= requiredScenarios.length);
  for (const requiredScenario of requiredScenarios) {
    assert.ok(
      scenarios.includes(requiredScenario),
      `Missing required BDD scenario: ${requiredScenario}. Found: [${scenarios.join(", ")}]`
    );
  }
});

test("bdd contract: locked modes stay valid", () => {
  const result = validateModeLock({
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("bdd contract: local_json mode stays valid", () => {
  const result = validateModeLock({
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic"
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("bdd contract: unsupported modes stay rejected with guidance", () => {
  const result = validateModeLock({
    figmaSourceMode: "mcp",
    llmCodegenMode: "hybrid"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
  assert.ok(result.errors.some((error) => error.includes("full Workspace Dev platform deployment")));
});
