import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  advancedFlowScenarioNames,
} from "./bdd/advanced-flows.js";
import {
  jobLifecycleScenarioNames,
} from "./bdd/job-lifecycle.js";
import { readFeatureScenarioNames } from "./bdd/harness.js";
import { securityContractScenarioNames } from "./bdd/security-contract.js";
import { validateModeLock } from "./mode-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const featureExpectations = [
  {
    featurePath: path.resolve(__dirname, "../features/workspace-mode-lock.feature"),
    requiredScenarios: [
      "Accept locked modes",
      "Accept hybrid mode",
      "Reject unsupported modes with actionable guidance",
    ],
  },
  {
    featurePath: path.resolve(__dirname, "../features/workspace-job-lifecycle.feature"),
    requiredScenarios: [...jobLifecycleScenarioNames],
  },
  {
    featurePath: path.resolve(__dirname, "../features/workspace-advanced-flows.feature"),
    requiredScenarios: [...advancedFlowScenarioNames],
  },
  {
    featurePath: path.resolve(__dirname, "../features/workspace-security-contract.feature"),
    requiredScenarios: [...securityContractScenarioNames],
  },
] as const;

for (const { featurePath, requiredScenarios } of featureExpectations) {
  test(`bdd contract: feature scenarios exist for ${path.basename(featurePath)}`, async () => {
    const scenarios = await readFeatureScenarioNames(featurePath);
    assert.ok(scenarios.length >= requiredScenarios.length);
    for (const requiredScenario of requiredScenarios) {
      assert.ok(
        scenarios.includes(requiredScenario),
        `Missing required BDD scenario: ${requiredScenario}. Found: [${scenarios.join(", ")}]`,
      );
    }
  });
}

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

test("bdd contract: hybrid mode stays valid", () => {
  const result = validateModeLock({
    figmaSourceMode: "hybrid",
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
