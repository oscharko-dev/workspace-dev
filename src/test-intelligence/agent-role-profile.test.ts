import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_HARNESS_ROLES,
  AGENT_ROLE_CAPABILITIES,
  AGENT_ROLE_FINOPS_GROUPS,
  AGENT_ROLE_KINDS,
  AGENT_ROLE_MAX_ATTEMPT_VALUES,
  AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  type AgentRoleProfile,
} from "../contracts/index.js";
import {
  AGENT_ROLE_PROFILE_REGISTRY,
  LLM_ROLE_FORBIDDEN_CAPABILITIES,
  assertAgentRoleProfileInvariants,
  getAgentRoleProfile,
  isAgentHarnessRole,
  isAgentRoleCapability,
  isAgentRoleFinOpsGroup,
  isAgentRoleKind,
  listAgentRoleProfiles,
  serializeAgentRoleProfile,
} from "./agent-role-profile.js";
import { canonicalJson } from "./content-hash.js";

test("registry: covers every AgentHarnessRole exactly once", () => {
  const keys = Object.keys(AGENT_ROLE_PROFILE_REGISTRY).sort();
  const expected = [...AGENT_HARNESS_ROLES].sort();
  assert.deepEqual(keys, expected);
  for (const role of AGENT_HARNESS_ROLES) {
    const profile = AGENT_ROLE_PROFILE_REGISTRY[role];
    assert.equal(profile.role, role, `role mismatch for "${role}"`);
    assert.equal(profile.schemaVersion, AGENT_ROLE_PROFILE_SCHEMA_VERSION);
  }
});

test("registry: every profile is deeply frozen", () => {
  for (const profile of listAgentRoleProfiles()) {
    assert.equal(Object.isFrozen(profile), true, `profile ${profile.role} not frozen`);
    if (profile.modelBinding !== undefined) {
      assert.equal(
        Object.isFrozen(profile.modelBinding),
        true,
        `modelBinding for ${profile.role} not frozen`,
      );
    }
  }
  assert.equal(Object.isFrozen(AGENT_ROLE_PROFILE_REGISTRY), true);
});

test("boundary: no llm_role profile may declare propose_changes", () => {
  for (const profile of listAgentRoleProfiles()) {
    if (profile.roleKind !== "llm_role") continue;
    for (const forbidden of LLM_ROLE_FORBIDDEN_CAPABILITIES) {
      assert.notEqual(
        profile.capability,
        forbidden,
        `llm_role "${profile.role}" must not have capability "${forbidden}"`,
      );
    }
    assert.notEqual(profile.capability, "propose_changes");
  }
});

test("boundary: every llm_role profile pins promptVersion + modelBinding + positive token budgets", () => {
  for (const profile of listAgentRoleProfiles()) {
    if (profile.roleKind !== "llm_role") continue;
    assert.equal(typeof profile.promptVersion, "string");
    assert.ok((profile.promptVersion ?? "").length > 0);
    assert.ok(profile.modelBinding !== undefined);
    assert.ok(profile.modelBinding!.providerId.length > 0);
    assert.ok(profile.modelBinding!.modelId.length > 0);
    assert.ok(profile.maxInputTokens > 0);
    assert.ok(profile.maxOutputTokens > 0);
  }
});

test("boundary: deterministic services do not declare promptVersion or modelBinding", () => {
  for (const profile of listAgentRoleProfiles()) {
    if (profile.roleKind !== "deterministic_service") continue;
    assert.equal(profile.promptVersion, undefined);
    assert.equal(profile.modelBinding, undefined);
  }
});

test("boundary: maxAttempts is in the closed allowed set", () => {
  for (const profile of listAgentRoleProfiles()) {
    assert.ok(
      (AGENT_ROLE_MAX_ATTEMPT_VALUES as readonly number[]).includes(
        profile.maxAttempts,
      ),
      `maxAttempts ${profile.maxAttempts} for "${profile.role}" not in allowed set`,
    );
  }
});

test("boundary: capability and finOpsGroup are members of the closed sets", () => {
  for (const profile of listAgentRoleProfiles()) {
    assert.ok(
      (AGENT_ROLE_CAPABILITIES as readonly string[]).includes(profile.capability),
    );
    assert.ok(
      (AGENT_ROLE_FINOPS_GROUPS as readonly string[]).includes(profile.finOpsGroup),
    );
    assert.ok((AGENT_ROLE_KINDS as readonly string[]).includes(profile.roleKind));
  }
});

test("serialization: every profile round-trips through canonical JSON", () => {
  for (const profile of listAgentRoleProfiles()) {
    const serialized = serializeAgentRoleProfile(profile);
    const parsed = JSON.parse(serialized) as AgentRoleProfile;
    // canonical-JSON sorts keys, so re-serialising the parsed value
    // yields a byte-identical string.
    assert.equal(canonicalJson(parsed), serialized);
    assert.equal(parsed.role, profile.role);
    assert.equal(parsed.schemaVersion, profile.schemaVersion);
    assert.equal(parsed.capability, profile.capability);
    assert.equal(parsed.finOpsGroup, profile.finOpsGroup);
  }
});

test("serialization: modelBinding round-trips with optional ictRegisterRef", () => {
  const sample: AgentRoleProfile = {
    schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
    role: "generator",
    roleKind: "llm_role",
    promptVersion: "generator.v1",
    modelBinding: {
      providerId: "azure-openai",
      modelId: "gpt-oss-120b",
      inferenceProfileId: "deployment-x",
      ictRegisterRef: "ICT-001",
    },
    outputSchema: "generated-test-cases.v1",
    maxAttempts: 1,
    maxInputTokens: 1_000,
    maxOutputTokens: 1_000,
    capability: "read_artifacts",
    finOpsGroup: "generation",
  };
  assertAgentRoleProfileInvariants(sample);
  const parsed = JSON.parse(serializeAgentRoleProfile(sample)) as AgentRoleProfile;
  assert.equal(parsed.modelBinding?.providerId, "azure-openai");
  assert.equal(parsed.modelBinding?.modelId, "gpt-oss-120b");
  assert.equal(parsed.modelBinding?.inferenceProfileId, "deployment-x");
  assert.equal(parsed.modelBinding?.ictRegisterRef, "ICT-001");
});

test("getAgentRoleProfile: returns the same frozen instance for every call", () => {
  const a = getAgentRoleProfile("generator");
  const b = getAgentRoleProfile("generator");
  assert.equal(a, b);
});

test("invariants: rejects llm_role with propose_changes", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "generator",
        roleKind: "llm_role",
        promptVersion: "generator.v1",
        modelBinding: { providerId: "in-house", modelId: "x" },
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capability: "propose_changes",
        finOpsGroup: "generation",
      }),
    /llm_role profiles must not declare capability "propose_changes"/,
  );
});

test("invariants: rejects llm_role missing promptVersion", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "generator",
        roleKind: "llm_role",
        modelBinding: { providerId: "in-house", modelId: "x" },
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capability: "read_artifacts",
        finOpsGroup: "generation",
      }),
    /llm_role profiles require a non-empty promptVersion/,
  );
});

test("invariants: rejects llm_role missing modelBinding", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "generator",
        roleKind: "llm_role",
        promptVersion: "generator.v1",
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capability: "read_artifacts",
        finOpsGroup: "generation",
      }),
    /llm_role profiles require a modelBinding/,
  );
});

test("invariants: rejects deterministic_service with promptVersion or modelBinding", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "visual_sidecar",
        roleKind: "deterministic_service",
        promptVersion: "x.v1",
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capability: "read_artifacts",
        finOpsGroup: "visual",
      }),
    /must not declare promptVersion/,
  );
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "visual_sidecar",
        roleKind: "deterministic_service",
        modelBinding: { providerId: "in-house", modelId: "x" },
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 0,
        maxOutputTokens: 0,
        capability: "read_artifacts",
        finOpsGroup: "visual",
      }),
    /must not declare modelBinding/,
  );
});

test("invariants: rejects negative or non-integer token budgets", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "visual_sidecar",
        roleKind: "deterministic_service",
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: -1,
        maxOutputTokens: 0,
        capability: "read_artifacts",
        finOpsGroup: "visual",
      }),
    /maxInputTokens must be a non-negative integer/,
  );
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "visual_sidecar",
        roleKind: "deterministic_service",
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 0,
        maxOutputTokens: 1.5,
        capability: "read_artifacts",
        finOpsGroup: "visual",
      }),
    /maxOutputTokens must be a non-negative integer/,
  );
});

test("invariants: rejects empty modelBinding fields", () => {
  assert.throws(
    () =>
      assertAgentRoleProfileInvariants({
        schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
        role: "generator",
        roleKind: "llm_role",
        promptVersion: "generator.v1",
        modelBinding: { providerId: "", modelId: "x" },
        outputSchema: "x.v1",
        maxAttempts: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        capability: "read_artifacts",
        finOpsGroup: "generation",
      }),
    /providerId must be a non-empty string/,
  );
});

test("type guards: accept registered values, reject others", () => {
  assert.equal(isAgentHarnessRole("generator"), true);
  assert.equal(isAgentHarnessRole("not-a-role"), false);
  assert.equal(isAgentHarnessRole(42), false);
  assert.equal(isAgentRoleCapability("score_only"), true);
  assert.equal(isAgentRoleCapability("write_anywhere"), false);
  assert.equal(isAgentRoleKind("llm_role"), true);
  assert.equal(isAgentRoleKind("agent"), false);
  assert.equal(isAgentRoleFinOpsGroup("repair"), true);
  assert.equal(isAgentRoleFinOpsGroup("misc"), false);
});

test("listAgentRoleProfiles: stable alphabetical order", () => {
  const order = listAgentRoleProfiles().map((p) => p.role);
  const sorted = [...order].sort();
  assert.deepEqual(order, sorted);
});
