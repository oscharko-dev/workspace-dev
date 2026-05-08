import assert from "node:assert/strict";
import test from "node:test";

import {
  EU_BANKING_DEFAULT_ROUTING_TABLE,
  PERMISSIVE_DEFAULT_ROUTING_TABLE,
  ROUTING_TABLE_ENVIRONMENTS,
  ROUTING_TABLE_PROFILES,
  ROUTING_TABLE_REGISTRY,
  ROUTING_TABLE_SCHEMA_VERSION,
  STANDARD_DEFAULT_ROUTING_TABLE,
  cloneRoutingTable,
  freezeRoutingTableExternal,
  getDefaultRoutingTable,
  isRoutingTableEnvironment,
  isRoutingTableProfile,
  resolveRoutingBinding,
  validateEuResidencyConstraint,
  validateRoutingTable,
} from "./routing-table.js";
import {
  TASK_COMPLEXITY_TIERS,
  classifyTask,
} from "./task-classifier-agent.js";

test("constants: routing-table profile + environment vocabularies are stable", () => {
  assert.deepEqual(
    [...ROUTING_TABLE_PROFILES],
    ["eu-banking-default", "standard-default", "permissive-default"],
  );
  assert.deepEqual(
    [...ROUTING_TABLE_ENVIRONMENTS],
    ["dev", "staging", "prod"],
  );
});

test("type guards: detect known profiles + environments", () => {
  assert.equal(isRoutingTableProfile("eu-banking-default"), true);
  assert.equal(isRoutingTableProfile("unknown"), false);
  assert.equal(isRoutingTableEnvironment("prod"), true);
  assert.equal(isRoutingTableEnvironment("qa"), false);
});

test("registry: every profile has a default table at the right schema version", () => {
  for (const profile of ROUTING_TABLE_PROFILES) {
    const table = ROUTING_TABLE_REGISTRY[profile];
    assert.equal(table.schemaVersion, ROUTING_TABLE_SCHEMA_VERSION);
    assert.equal(table.profile, profile);
    for (const env of ROUTING_TABLE_ENVIRONMENTS) {
      const envEntry = table.environments[env];
      for (const tier of TASK_COMPLEXITY_TIERS) {
        const binding = envEntry[tier];
        assert.ok(binding.providerId.length > 0);
        assert.ok(binding.modelId.length > 0);
      }
    }
  }
});

test("registry: built-in tables and helpers are deeply frozen", () => {
  for (const table of Object.values(ROUTING_TABLE_REGISTRY)) {
    assert.equal(Object.isFrozen(table), true);
    assert.equal(Object.isFrozen(table.environments), true);
    for (const env of ROUTING_TABLE_ENVIRONMENTS) {
      assert.equal(Object.isFrozen(table.environments[env]), true);
      for (const tier of TASK_COMPLEXITY_TIERS) {
        assert.equal(
          Object.isFrozen(table.environments[env][tier]),
          true,
          `${table.profile}/${env}/${tier} not frozen`,
        );
      }
    }
  }
});

test("getDefaultRoutingTable: returns the same frozen instance for repeat calls", () => {
  const a = getDefaultRoutingTable("eu-banking-default");
  const b = getDefaultRoutingTable("eu-banking-default");
  assert.equal(a, b);
  assert.equal(a, EU_BANKING_DEFAULT_ROUTING_TABLE);
});

test("validateRoutingTable: built-in tables pass validation", () => {
  for (const table of [
    EU_BANKING_DEFAULT_ROUTING_TABLE,
    STANDARD_DEFAULT_ROUTING_TABLE,
    PERMISSIVE_DEFAULT_ROUTING_TABLE,
  ]) {
    const result = validateRoutingTable(table);
    assert.equal(
      result.valid,
      true,
      `validation failed: ${JSON.stringify(result.errors)}`,
    );
    assert.equal(result.errors.length, 0);
  }
});

test("validateRoutingTable: rejects bad schema version", () => {
  const cloned = cloneRoutingTable(EU_BANKING_DEFAULT_ROUTING_TABLE);
  (cloned as { schemaVersion: string }).schemaVersion = "0.0.1";
  const result = validateRoutingTable(cloned);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) => e.path === "$.schemaVersion"),
    "expected schemaVersion error",
  );
});

test("validateRoutingTable: rejects empty providerId", () => {
  const cloned = cloneRoutingTable(STANDARD_DEFAULT_ROUTING_TABLE);
  cloned.environments.prod["tier-low"] = {
    providerId: "",
    modelId: "claude-haiku-4-5-20251001",
  };
  const result = validateRoutingTable(cloned);
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some(
      (e) => e.path === "$.environments.prod.tier-low.providerId",
    ),
  );
});

test("validateRoutingTable: rejects unknown environment key", () => {
  const cloned = cloneRoutingTable(STANDARD_DEFAULT_ROUTING_TABLE) as unknown as {
    environments: Record<string, unknown>;
  };
  cloned.environments["qa"] = cloned.environments["dev"];
  const result = validateRoutingTable(
    cloned as unknown as typeof STANDARD_DEFAULT_ROUTING_TABLE,
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.path === "$.environments.qa"));
});

test("validateEuResidencyConstraint: passes for built-in EU table", () => {
  const result = validateEuResidencyConstraint(
    EU_BANKING_DEFAULT_ROUTING_TABLE,
  );
  assert.equal(result.valid, true);
});

test("validateEuResidencyConstraint: flags non-EU bindings under eu-banking-default", () => {
  const cloned = cloneRoutingTable(EU_BANKING_DEFAULT_ROUTING_TABLE);
  cloned.environments.prod["tier-low"] = {
    providerId: "openai",
    modelId: "gpt-4o-mini",
    region: "us",
  };
  const result = validateEuResidencyConstraint(
    freezeRoutingTableExternal(cloned),
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((e) =>
      e.path.startsWith("$.environments.prod.tier-low.region"),
    ),
  );
});

test("validateEuResidencyConstraint: skips non-EU profiles", () => {
  const result = validateEuResidencyConstraint(
    PERMISSIVE_DEFAULT_ROUTING_TABLE,
  );
  assert.equal(result.valid, true);
});

test("resolveRoutingBinding: returns the right binding for the decision tier", () => {
  const decision = classifyTask({
    taskId: "task-x",
    taskKind: "regulatory_inference",
  });
  const binding = resolveRoutingBinding({
    table: EU_BANKING_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    decision,
  });
  assert.equal(binding.modelId, "gpt-oss-120b");
  assert.equal(binding.region, "eu");
});

test("resolveRoutingBinding: tier-low routes to the cheap binding", () => {
  const decision = classifyTask({
    taskId: "task-y",
    taskKind: "simple_ui_validation",
    estimatedInputTokens: 100,
  });
  const binding = resolveRoutingBinding({
    table: STANDARD_DEFAULT_ROUTING_TABLE,
    environment: "prod",
    decision,
  });
  assert.equal(binding.modelId, "claude-haiku-4-5-20251001");
});

test("cloneRoutingTable: produces a mutable copy", () => {
  const cloned = cloneRoutingTable(EU_BANKING_DEFAULT_ROUTING_TABLE);
  assert.notEqual(cloned, EU_BANKING_DEFAULT_ROUTING_TABLE);
  cloned.environments.dev["tier-low"].providerId = "custom";
  // Original is still intact.
  assert.equal(
    EU_BANKING_DEFAULT_ROUTING_TABLE.environments.dev["tier-low"].providerId,
    "in-house",
  );
});

test("freezeRoutingTableExternal: returned table is deeply frozen", () => {
  const cloned = cloneRoutingTable(STANDARD_DEFAULT_ROUTING_TABLE);
  const frozen = freezeRoutingTableExternal(cloned);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.environments), true);
  assert.equal(Object.isFrozen(frozen.environments.prod), true);
  assert.equal(Object.isFrozen(frozen.environments.prod["tier-low"]), true);
});
