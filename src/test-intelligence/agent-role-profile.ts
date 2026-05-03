/**
 * Static `AgentRoleProfile` matrix for the multi-agent harness
 * (Issue #1779, Story MA-3 #1758).
 *
 * The profiles below pin every role tracked by the Production Runner
 * state machine to a deterministic budget tier, capability filter,
 * output schema, FinOps attribution group, and (for LLM roles) a
 * prompt-template version + model binding.
 *
 * The registry is a small hand-rolled, deeply-frozen module with no
 * runtime configuration surface — there is no way to add or mutate
 * profiles at runtime. New roles or new fields require a contract
 * bump and a `CONTRACT_CHANGELOG.md` entry.
 *
 * Capability invariant: no `llm_role` profile may declare
 * `capability === "propose_changes"`. Filesystem, gateway, and
 * review-store mutations are reserved for deterministic services
 * gated by `RepairChangeGuard` and friends. The invariant is enforced
 * both at module load (registry construction throws on violation) and
 * by `agent-role-profile.test.ts` as a boundary self-test.
 */

import {
  AGENT_HARNESS_ROLES,
  AGENT_ROLE_CAPABILITIES,
  AGENT_ROLE_FINOPS_GROUPS,
  AGENT_ROLE_KINDS,
  AGENT_ROLE_MAX_ATTEMPT_VALUES,
  AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  type AgentHarnessRole,
  type AgentModelBinding,
  type AgentRoleCapability,
  type AgentRoleFinOpsGroup,
  type AgentRoleKind,
  type AgentRoleProfile,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";

/**
 * Capabilities forbidden for any LLM role. The harness reserves
 * filesystem / gateway / review-store mutations for deterministic
 * services gated by `RepairChangeGuard`.
 */
export const LLM_ROLE_FORBIDDEN_CAPABILITIES: readonly AgentRoleCapability[] =
  Object.freeze(["propose_changes"]);

/**
 * Validate a candidate `AgentRoleProfile` against the static contract
 * invariants. Used at module load and re-exposed for the self-test.
 */
export const assertAgentRoleProfileInvariants = (
  profile: AgentRoleProfile,
): void => {
  const where = `AgentRoleProfile[${profile.role}]`;

  if (profile.schemaVersion !== AGENT_ROLE_PROFILE_SCHEMA_VERSION) {
    throw new TypeError(
      `${where}: schemaVersion must be "${AGENT_ROLE_PROFILE_SCHEMA_VERSION}", got "${String(
        profile.schemaVersion,
      )}"`,
    );
  }
  if (!AGENT_HARNESS_ROLES.includes(profile.role)) {
    throw new TypeError(
      `${where}: role "${String(profile.role)}" is not a known AgentHarnessRole`,
    );
  }
  if (!AGENT_ROLE_KINDS.includes(profile.roleKind)) {
    throw new TypeError(
      `${where}: roleKind "${String(
        profile.roleKind,
      )}" is not a known AgentRoleKind`,
    );
  }
  if (!AGENT_ROLE_CAPABILITIES.includes(profile.capability)) {
    throw new TypeError(
      `${where}: capability "${String(
        profile.capability,
      )}" is not a known AgentRoleCapability`,
    );
  }
  if (!AGENT_ROLE_FINOPS_GROUPS.includes(profile.finOpsGroup)) {
    throw new TypeError(
      `${where}: finOpsGroup "${String(
        profile.finOpsGroup,
      )}" is not a known AgentRoleFinOpsGroup`,
    );
  }
  if (
    !AGENT_ROLE_MAX_ATTEMPT_VALUES.includes(
      profile.maxAttempts as 1 | 2 | 3,
    )
  ) {
    throw new TypeError(
      `${where}: maxAttempts must be one of [${AGENT_ROLE_MAX_ATTEMPT_VALUES.join(
        ", ",
      )}], got ${String(profile.maxAttempts)}`,
    );
  }
  if (
    !Number.isInteger(profile.maxInputTokens) ||
    profile.maxInputTokens < 0
  ) {
    throw new TypeError(
      `${where}: maxInputTokens must be a non-negative integer, got ${String(
        profile.maxInputTokens,
      )}`,
    );
  }
  if (
    !Number.isInteger(profile.maxOutputTokens) ||
    profile.maxOutputTokens < 0
  ) {
    throw new TypeError(
      `${where}: maxOutputTokens must be a non-negative integer, got ${String(
        profile.maxOutputTokens,
      )}`,
    );
  }
  if (typeof profile.outputSchema !== "string" || profile.outputSchema.length === 0) {
    throw new TypeError(`${where}: outputSchema must be a non-empty string`);
  }

  if (profile.roleKind === "llm_role") {
    if (LLM_ROLE_FORBIDDEN_CAPABILITIES.includes(profile.capability)) {
      throw new TypeError(
        `${where}: llm_role profiles must not declare capability "${profile.capability}"; ` +
          `filesystem / gateway / review-store mutations are reserved for deterministic services.`,
      );
    }
    if (profile.promptVersion === undefined || profile.promptVersion.length === 0) {
      throw new TypeError(
        `${where}: llm_role profiles require a non-empty promptVersion`,
      );
    }
    if (profile.modelBinding === undefined) {
      throw new TypeError(
        `${where}: llm_role profiles require a modelBinding`,
      );
    }
    assertAgentModelBindingInvariants(profile.modelBinding, where);
    if (profile.maxInputTokens === 0 || profile.maxOutputTokens === 0) {
      throw new TypeError(
        `${where}: llm_role profiles require positive token budgets`,
      );
    }
  } else {
    if (profile.promptVersion !== undefined) {
      throw new TypeError(
        `${where}: deterministic_service profiles must not declare promptVersion`,
      );
    }
    if (profile.modelBinding !== undefined) {
      throw new TypeError(
        `${where}: deterministic_service profiles must not declare modelBinding`,
      );
    }
  }
};

const assertAgentModelBindingInvariants = (
  binding: AgentModelBinding,
  where: string,
): void => {
  if (typeof binding.providerId !== "string" || binding.providerId.length === 0) {
    throw new TypeError(
      `${where}: modelBinding.providerId must be a non-empty string`,
    );
  }
  if (typeof binding.modelId !== "string" || binding.modelId.length === 0) {
    throw new TypeError(
      `${where}: modelBinding.modelId must be a non-empty string`,
    );
  }
  if (
    binding.inferenceProfileId !== undefined &&
    (typeof binding.inferenceProfileId !== "string" ||
      binding.inferenceProfileId.length === 0)
  ) {
    throw new TypeError(
      `${where}: modelBinding.inferenceProfileId, when present, must be a non-empty string`,
    );
  }
  if (
    binding.ictRegisterRef !== undefined &&
    (typeof binding.ictRegisterRef !== "string" ||
      binding.ictRegisterRef.length === 0)
  ) {
    throw new TypeError(
      `${where}: modelBinding.ictRegisterRef, when present, must be a non-empty string`,
    );
  }
};

const freezeBinding = (binding: AgentModelBinding): AgentModelBinding =>
  Object.freeze({
    providerId: binding.providerId,
    modelId: binding.modelId,
    ...(binding.inferenceProfileId !== undefined
      ? { inferenceProfileId: binding.inferenceProfileId }
      : {}),
    ...(binding.ictRegisterRef !== undefined
      ? { ictRegisterRef: binding.ictRegisterRef }
      : {}),
  });

const freezeProfile = (profile: AgentRoleProfile): AgentRoleProfile => {
  assertAgentRoleProfileInvariants(profile);
  const frozen: AgentRoleProfile = {
    schemaVersion: profile.schemaVersion,
    role: profile.role,
    roleKind: profile.roleKind,
    ...(profile.promptVersion !== undefined
      ? { promptVersion: profile.promptVersion }
      : {}),
    ...(profile.modelBinding !== undefined
      ? { modelBinding: freezeBinding(profile.modelBinding) }
      : {}),
    outputSchema: profile.outputSchema,
    maxAttempts: profile.maxAttempts,
    maxInputTokens: profile.maxInputTokens,
    maxOutputTokens: profile.maxOutputTokens,
    capability: profile.capability,
    finOpsGroup: profile.finOpsGroup,
  };
  return Object.freeze(frozen);
};

const VISUAL_SIDECAR_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "visual_sidecar",
  roleKind: "deterministic_service",
  outputSchema: "visual-sidecar-result.v1",
  maxAttempts: 1,
  maxInputTokens: 0,
  maxOutputTokens: 0,
  capability: "read_artifacts",
  finOpsGroup: "visual",
});

const GENERATOR_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "generator",
  roleKind: "llm_role",
  promptVersion: "generator.v1",
  modelBinding: {
    providerId: "in-house",
    modelId: "gpt-oss-120b",
  },
  outputSchema: "generated-test-cases.v1",
  maxAttempts: 2,
  maxInputTokens: 32_000,
  maxOutputTokens: 8_000,
  capability: "read_artifacts",
  finOpsGroup: "generation",
});

const SEMANTIC_JUDGE_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "semantic_judge",
  roleKind: "llm_role",
  promptVersion: "semantic-judge.v1",
  modelBinding: {
    providerId: "in-house",
    modelId: "gpt-oss-120b",
  },
  outputSchema: "judge-panel-verdict.v1",
  maxAttempts: 2,
  maxInputTokens: 24_000,
  maxOutputTokens: 4_000,
  capability: "score_only",
  finOpsGroup: "judge",
});

const ADVERSARIAL_GAP_FINDER_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "adversarial_gap_finder",
  roleKind: "llm_role",
  promptVersion: "gap-finder.v1",
  modelBinding: {
    providerId: "in-house",
    modelId: "phi-4-multimodal-poc",
  },
  outputSchema: "gap-finder-findings.v1",
  maxAttempts: 2,
  maxInputTokens: 24_000,
  maxOutputTokens: 4_000,
  capability: "read_artifacts",
  finOpsGroup: "judge",
});

const REPAIR_PLANNER_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "repair_planner",
  roleKind: "llm_role",
  promptVersion: "repair-planner.v1",
  modelBinding: {
    providerId: "in-house",
    modelId: "gpt-oss-120b",
  },
  outputSchema: "repair-plan.v1",
  maxAttempts: 3,
  maxInputTokens: 24_000,
  maxOutputTokens: 6_000,
  capability: "read_artifacts",
  finOpsGroup: "repair",
});

const FINAL_VERIFIER_PROFILE: AgentRoleProfile = freezeProfile({
  schemaVersion: AGENT_ROLE_PROFILE_SCHEMA_VERSION,
  role: "final_verifier",
  roleKind: "deterministic_service",
  outputSchema: "final-verifier-report.v1",
  maxAttempts: 1,
  maxInputTokens: 0,
  maxOutputTokens: 0,
  capability: "read_artifacts",
  finOpsGroup: "verification",
});

const REGISTRY_OBJECT: Record<AgentHarnessRole, AgentRoleProfile> = {
  adversarial_gap_finder: ADVERSARIAL_GAP_FINDER_PROFILE,
  final_verifier: FINAL_VERIFIER_PROFILE,
  generator: GENERATOR_PROFILE,
  repair_planner: REPAIR_PLANNER_PROFILE,
  semantic_judge: SEMANTIC_JUDGE_PROFILE,
  visual_sidecar: VISUAL_SIDECAR_PROFILE,
};

/**
 * Frozen registry of every `AgentRoleProfile` shipped with this
 * version of the contract. Keys cover {@link AGENT_HARNESS_ROLES}
 * exhaustively; the `Record` type ensures TypeScript flags new roles
 * without entries.
 */
export const AGENT_ROLE_PROFILE_REGISTRY: Readonly<
  Record<AgentHarnessRole, AgentRoleProfile>
> = Object.freeze(REGISTRY_OBJECT);

/**
 * Return the static profile for `role`. Throws when `role` is not
 * registered (which `AgentHarnessRole`'s closed union prevents at
 * compile time, but the runtime guard protects misuse from JS callers).
 */
export const getAgentRoleProfile = (
  role: AgentHarnessRole,
): AgentRoleProfile => {
  const profile = AGENT_ROLE_PROFILE_REGISTRY[role];
  if (profile === undefined) {
    throw new RangeError(
      `getAgentRoleProfile: no profile registered for role "${String(role)}"`,
    );
  }
  return profile;
};

/**
 * Return every registered profile sorted by role name. Stable order
 * makes the output safe to feed into canonical-JSON anchors.
 */
export const listAgentRoleProfiles = (): readonly AgentRoleProfile[] =>
  AGENT_HARNESS_ROLES.map((role) => AGENT_ROLE_PROFILE_REGISTRY[role]);

/**
 * Serialise `profile` to canonical JSON. Round-tripping the result
 * through `JSON.parse` yields a structurally-equal profile.
 */
export const serializeAgentRoleProfile = (
  profile: AgentRoleProfile,
): string => canonicalJson(profile);

/** Type guard for {@link AgentHarnessRole}. */
export const isAgentHarnessRole = (value: unknown): value is AgentHarnessRole =>
  typeof value === "string" &&
  (AGENT_HARNESS_ROLES as readonly string[]).includes(value);

/** Type guard for {@link AgentRoleCapability}. */
export const isAgentRoleCapability = (
  value: unknown,
): value is AgentRoleCapability =>
  typeof value === "string" &&
  (AGENT_ROLE_CAPABILITIES as readonly string[]).includes(value);

/** Type guard for {@link AgentRoleKind}. */
export const isAgentRoleKind = (value: unknown): value is AgentRoleKind =>
  typeof value === "string" &&
  (AGENT_ROLE_KINDS as readonly string[]).includes(value);

/** Type guard for {@link AgentRoleFinOpsGroup}. */
export const isAgentRoleFinOpsGroup = (
  value: unknown,
): value is AgentRoleFinOpsGroup =>
  typeof value === "string" &&
  (AGENT_ROLE_FINOPS_GROUPS as readonly string[]).includes(value);
