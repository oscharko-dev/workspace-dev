/**
 * Cost-aware routing table (Issue #2043).
 *
 * Maps a `(profile, environment, tier)` triple to a concrete
 * {@link AgentModelBinding} the gateway should use for any task whose
 * classifier decision matches that triple. The table is the
 * configurable seam between the deterministic classifier and the
 * actual model deployments — operators tune the table per
 * environment without redeploying the harness.
 *
 * Design:
 *
 * - Closed runtime vocabulary. The set of routing profiles and
 *   environments is bounded so a typo in a CLI flag fails loudly at
 *   table-validation time rather than silently drops back to a
 *   default.
 *
 * - Three default tables ship in-tree: `eu-banking-default`,
 *   `permissive-default`, and `standard-default`. Each carries one
 *   entry per environment (`dev`, `staging`, `prod`) and one binding
 *   per tier. The bindings line up with the existing harness model
 *   inventory (gpt-oss-120b for tier-high, mid-tier deployments for
 *   tier-mid, phi/Haiku-class for tier-low). Operators can override
 *   any binding by passing a custom table to `resolveRoutingBinding`.
 *
 * - Validation is hand-rolled (no external schema lib — the project
 *   is zero-runtime-deps) and produces structured errors so
 *   misconfigurations surface in a single round of CI failures.
 *
 * - Tables are deeply frozen. The default tables are exported as
 *   frozen singletons; the `cloneRoutingTable` helper produces a
 *   fresh, mutable copy when callers want to derive a custom table.
 */

import type { AgentModelBinding } from "../contracts/index.js";
import {
  JUDGE_MODEL_FAMILIES,
  JUDGE_MODEL_REGIONS,
} from "../contracts/index.js";
import {
  TASK_COMPLEXITY_TIERS,
  type TaskClassificationDecision,
  type TaskComplexityTier,
} from "./task-classifier-agent.js";

/**
 * Closed runtime list of routing environments. Matches the harness's
 * existing dev/staging/prod separation. Adding an environment
 * requires bumping {@link ROUTING_TABLE_SCHEMA_VERSION}.
 */
export const ROUTING_TABLE_ENVIRONMENTS = ["dev", "staging", "prod"] as const;

/** Discriminant of {@link ROUTING_TABLE_ENVIRONMENTS}. */
export type RoutingTableEnvironment =
  (typeof ROUTING_TABLE_ENVIRONMENTS)[number];

/**
 * Closed runtime list of routing profiles. The names mirror the
 * existing FinOps budget profile ids so an operator running with
 * `--policy-profile eu-banking-default` automatically picks the
 * matching routing table.
 */
export const ROUTING_TABLE_PROFILES = [
  "eu-banking-default",
  "standard-default",
  "permissive-default",
] as const;

/** Discriminant of {@link ROUTING_TABLE_PROFILES}. */
export type RoutingTableProfile = (typeof ROUTING_TABLE_PROFILES)[number];

/** Schema version literal stamped on every persisted table. */
export const ROUTING_TABLE_SCHEMA_VERSION = "1.0.0" as const;

/** Stable filename for the routing-table artifact, when persisted. */
export const ROUTING_TABLE_ARTIFACT_FILENAME = "routing-table.json" as const;

/**
 * One routing table — covers every environment × tier combination for
 * a single profile. The shape is dense (no optional cells) so the
 * resolution path can never fall back to an undefined binding.
 */
export interface RoutingTable {
  readonly schemaVersion: typeof ROUTING_TABLE_SCHEMA_VERSION;
  readonly profile: RoutingTableProfile;
  readonly environments: Readonly<
    Record<
      RoutingTableEnvironment,
      Readonly<Record<TaskComplexityTier, AgentModelBinding>>
    >
  >;
}

/** Type guard for {@link RoutingTableEnvironment}. */
export const isRoutingTableEnvironment = (
  value: unknown,
): value is RoutingTableEnvironment =>
  typeof value === "string" &&
  (ROUTING_TABLE_ENVIRONMENTS as readonly string[]).includes(value);

/** Type guard for {@link RoutingTableProfile}. */
export const isRoutingTableProfile = (
  value: unknown,
): value is RoutingTableProfile =>
  typeof value === "string" &&
  (ROUTING_TABLE_PROFILES as readonly string[]).includes(value);

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
    ...(binding.family !== undefined ? { family: binding.family } : {}),
    ...(binding.region !== undefined ? { region: binding.region } : {}),
  });

const freezeTierMap = (
  map: Record<TaskComplexityTier, AgentModelBinding>,
): Readonly<Record<TaskComplexityTier, AgentModelBinding>> =>
  Object.freeze({
    "tier-low": freezeBinding(map["tier-low"]),
    "tier-mid": freezeBinding(map["tier-mid"]),
    "tier-high": freezeBinding(map["tier-high"]),
  });

const freezeEnvMap = (
  map: Record<
    RoutingTableEnvironment,
    Record<TaskComplexityTier, AgentModelBinding>
  >,
): RoutingTable["environments"] =>
  Object.freeze({
    dev: freezeTierMap(map.dev),
    staging: freezeTierMap(map.staging),
    prod: freezeTierMap(map.prod),
  });

const deepFreezeEnvironments = (
  environments: RoutingTable["environments"],
): RoutingTable["environments"] =>
  freezeEnvMap({
    dev: {
      "tier-low": { ...environments.dev["tier-low"] },
      "tier-mid": { ...environments.dev["tier-mid"] },
      "tier-high": { ...environments.dev["tier-high"] },
    },
    staging: {
      "tier-low": { ...environments.staging["tier-low"] },
      "tier-mid": { ...environments.staging["tier-mid"] },
      "tier-high": { ...environments.staging["tier-high"] },
    },
    prod: {
      "tier-low": { ...environments.prod["tier-low"] },
      "tier-mid": { ...environments.prod["tier-mid"] },
      "tier-high": { ...environments.prod["tier-high"] },
    },
  });

const freezeRoutingTable = (table: RoutingTable): RoutingTable =>
  Object.freeze({
    schemaVersion: table.schemaVersion,
    profile: table.profile,
    environments: deepFreezeEnvironments(table.environments),
  });

const EU_BANKING_DEFAULT_ROUTING_TABLE_OBJECT: RoutingTable = freezeRoutingTable({
  schemaVersion: ROUTING_TABLE_SCHEMA_VERSION,
  profile: "eu-banking-default",
  environments: freezeEnvMap({
    dev: {
      "tier-low": { providerId: "in-house", modelId: "phi-4", family: "in-house", region: "eu" },
      "tier-mid": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu" },
      "tier-high": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu" },
    },
    staging: {
      "tier-low": { providerId: "in-house", modelId: "phi-4", family: "in-house", region: "eu" },
      "tier-mid": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu" },
      "tier-high": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu" },
    },
    prod: {
      "tier-low": { providerId: "in-house", modelId: "phi-4", family: "in-house", region: "eu", ictRegisterRef: "ICT-PHI-4" },
      "tier-mid": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu", ictRegisterRef: "ICT-GPT-OSS-120B" },
      "tier-high": { providerId: "in-house", modelId: "gpt-oss-120b", family: "in-house", region: "eu", ictRegisterRef: "ICT-GPT-OSS-120B" },
    },
  }),
});

const STANDARD_DEFAULT_ROUTING_TABLE_OBJECT: RoutingTable = freezeRoutingTable({
  schemaVersion: ROUTING_TABLE_SCHEMA_VERSION,
  profile: "standard-default",
  environments: freezeEnvMap({
    dev: {
      "tier-low": { providerId: "anthropic", modelId: "claude-haiku-4-5-20251001", family: "anthropic", region: "global" },
      "tier-mid": { providerId: "anthropic", modelId: "claude-sonnet-4-6", family: "anthropic", region: "global" },
      "tier-high": { providerId: "anthropic", modelId: "claude-opus-4-7", family: "anthropic", region: "global" },
    },
    staging: {
      "tier-low": { providerId: "anthropic", modelId: "claude-haiku-4-5-20251001", family: "anthropic", region: "global" },
      "tier-mid": { providerId: "anthropic", modelId: "claude-sonnet-4-6", family: "anthropic", region: "global" },
      "tier-high": { providerId: "anthropic", modelId: "claude-opus-4-7", family: "anthropic", region: "global" },
    },
    prod: {
      "tier-low": { providerId: "anthropic", modelId: "claude-haiku-4-5-20251001", family: "anthropic", region: "global" },
      "tier-mid": { providerId: "anthropic", modelId: "claude-sonnet-4-6", family: "anthropic", region: "global" },
      "tier-high": { providerId: "anthropic", modelId: "claude-opus-4-7", family: "anthropic", region: "global" },
    },
  }),
});

const PERMISSIVE_DEFAULT_ROUTING_TABLE_OBJECT: RoutingTable = freezeRoutingTable({
  schemaVersion: ROUTING_TABLE_SCHEMA_VERSION,
  profile: "permissive-default",
  environments: freezeEnvMap({
    dev: {
      "tier-low": { providerId: "openai", modelId: "gpt-4o-mini", family: "openai", region: "global" },
      "tier-mid": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
      "tier-high": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
    },
    staging: {
      "tier-low": { providerId: "openai", modelId: "gpt-4o-mini", family: "openai", region: "global" },
      "tier-mid": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
      "tier-high": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
    },
    prod: {
      "tier-low": { providerId: "openai", modelId: "gpt-4o-mini", family: "openai", region: "global" },
      "tier-mid": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
      "tier-high": { providerId: "openai", modelId: "gpt-4o", family: "openai", region: "global" },
    },
  }),
});

/** Built-in EU-banking routing table. EU-resident, in-house only. */
export const EU_BANKING_DEFAULT_ROUTING_TABLE: RoutingTable =
  EU_BANKING_DEFAULT_ROUTING_TABLE_OBJECT;

/** Built-in standard routing table. Anthropic Haiku/Sonnet/Opus tiering. */
export const STANDARD_DEFAULT_ROUTING_TABLE: RoutingTable =
  STANDARD_DEFAULT_ROUTING_TABLE_OBJECT;

/** Built-in permissive routing table. OpenAI gpt-4o-mini/gpt-4o tiering. */
export const PERMISSIVE_DEFAULT_ROUTING_TABLE: RoutingTable =
  PERMISSIVE_DEFAULT_ROUTING_TABLE_OBJECT;

/** Frozen registry of every default routing table shipped in-tree. */
export const ROUTING_TABLE_REGISTRY: Readonly<
  Record<RoutingTableProfile, RoutingTable>
> = Object.freeze({
  "eu-banking-default": EU_BANKING_DEFAULT_ROUTING_TABLE,
  "standard-default": STANDARD_DEFAULT_ROUTING_TABLE,
  "permissive-default": PERMISSIVE_DEFAULT_ROUTING_TABLE,
});

/**
 * Look up the default routing table for the given profile. Throws when
 * the profile is unknown — the closed `RoutingTableProfile` union
 * prevents this at compile time, but the runtime guard protects JS
 * callers and dynamic configurations.
 */
export const getDefaultRoutingTable = (
  profile: RoutingTableProfile,
): RoutingTable => {
  const registry = ROUTING_TABLE_REGISTRY as Partial<
    Record<RoutingTableProfile, RoutingTable>
  >;
  const table = registry[profile];
  if (table === undefined) {
    throw new RangeError(
      `getDefaultRoutingTable: no built-in table for profile "${profile}"`,
    );
  }
  return table;
};

/**
 * Validation issue produced by {@link validateRoutingTable}. Mirrors
 * the project's hand-rolled validator shape (`{path, message}`).
 */
export interface RoutingTableValidationIssue {
  readonly path: string;
  readonly message: string;
}

/** Result returned by {@link validateRoutingTable}. */
export interface RoutingTableValidationResult {
  readonly valid: boolean;
  readonly errors: readonly RoutingTableValidationIssue[];
}

/**
 * Validate a routing table. Every environment must populate a binding
 * for every tier, the bindings must satisfy {@link AgentModelBinding}
 * invariants, and the schema version + profile must match the
 * accepted constants.
 */
export const validateRoutingTable = (
  table: RoutingTable,
): RoutingTableValidationResult => {
  const errors: RoutingTableValidationIssue[] = [];
  const looseTable = table as {
    schemaVersion: string;
    profile: string;
    environments: Partial<
      Record<
        RoutingTableEnvironment,
        Partial<Record<TaskComplexityTier, AgentModelBinding>>
      >
    >;
  };

  if (looseTable.schemaVersion !== ROUTING_TABLE_SCHEMA_VERSION) {
    errors.push({
      path: "$.schemaVersion",
      message: `schemaVersion must be "${ROUTING_TABLE_SCHEMA_VERSION}", got "${looseTable.schemaVersion}"`,
    });
  }
  if (!isRoutingTableProfile(looseTable.profile)) {
    errors.push({
      path: "$.profile",
      message: `profile "${looseTable.profile}" is not a known RoutingTableProfile`,
    });
  }

  for (const env of ROUTING_TABLE_ENVIRONMENTS) {
    const envEntry = looseTable.environments[env];
    if (envEntry === undefined) {
      errors.push({
        path: `$.environments.${env}`,
        message: `environments.${env} is required`,
      });
      continue;
    }
    for (const tier of TASK_COMPLEXITY_TIERS) {
      const binding = envEntry[tier];
      if (binding === undefined) {
        errors.push({
          path: `$.environments.${env}.${tier}`,
          message: `environments.${env}.${tier} is required`,
        });
        continue;
      }
      validateBinding(binding, `$.environments.${env}.${tier}`, errors);
    }
  }

  // Reject unknown environment / tier keys so a typo can't silently
  // drop a binding.
  for (const envKey of Object.keys(looseTable.environments)) {
    if (!isRoutingTableEnvironment(envKey)) {
      errors.push({
        path: `$.environments.${envKey}`,
        message: `environments.${envKey} is not a known RoutingTableEnvironment`,
      });
    }
  }

  return { valid: errors.length === 0, errors };
};

const validateBinding = (
  binding: AgentModelBinding,
  where: string,
  errors: RoutingTableValidationIssue[],
): void => {
  if (typeof binding.providerId !== "string" || binding.providerId.length === 0) {
    errors.push({
      path: `${where}.providerId`,
      message: "providerId must be a non-empty string",
    });
  }
  if (typeof binding.modelId !== "string" || binding.modelId.length === 0) {
    errors.push({
      path: `${where}.modelId`,
      message: "modelId must be a non-empty string",
    });
  }
  if (
    binding.family !== undefined &&
    !(JUDGE_MODEL_FAMILIES as readonly string[]).includes(binding.family)
  ) {
    errors.push({
      path: `${where}.family`,
      message: `family "${binding.family}" is not a known JudgeModelFamily`,
    });
  }
  if (
    binding.region !== undefined &&
    !(JUDGE_MODEL_REGIONS as readonly string[]).includes(binding.region)
  ) {
    errors.push({
      path: `${where}.region`,
      message: `region "${binding.region}" is not a known JudgeModelRegion`,
    });
  }
};

/**
 * EU-residency guard. When the profile is `eu-banking-default`, every
 * binding's `region` must be `eu`. Returns a fresh validation result
 * so the caller can chain it with {@link validateRoutingTable}.
 */
export const validateEuResidencyConstraint = (
  table: RoutingTable,
): RoutingTableValidationResult => {
  if (table.profile !== "eu-banking-default") {
    return { valid: true, errors: [] };
  }
  const errors: RoutingTableValidationIssue[] = [];
  for (const env of ROUTING_TABLE_ENVIRONMENTS) {
    const envEntry = table.environments[env];
    for (const tier of TASK_COMPLEXITY_TIERS) {
      const binding = envEntry[tier];
      if (binding.region !== "eu") {
        errors.push({
          path: `$.environments.${env}.${tier}.region`,
          message: `eu-banking-default requires region="eu" for every binding; ${env}/${tier} has region="${binding.region ?? "(unset)"}"`,
        });
      }
    }
  }
  return { valid: errors.length === 0, errors };
};

/**
 * Resolve the model binding the gateway should use for a given
 * classifier decision. The function is a pure lookup — no defaults
 * are inserted, the table must already cover the requested tier.
 */
export const resolveRoutingBinding = (input: {
  readonly table: RoutingTable;
  readonly environment: RoutingTableEnvironment;
  readonly decision: TaskClassificationDecision;
}): AgentModelBinding => {
  const looseEnvironments = input.table.environments as Partial<
    Record<
      RoutingTableEnvironment,
      Partial<Record<TaskComplexityTier, AgentModelBinding>>
    >
  >;
  const envEntry = looseEnvironments[input.environment];
  if (envEntry === undefined) {
    throw new RangeError(
      `resolveRoutingBinding: unknown environment "${input.environment}"`,
    );
  }
  const binding = envEntry[input.decision.tier];
  if (binding === undefined) {
    throw new RangeError(
      `resolveRoutingBinding: no binding for tier "${input.decision.tier}" in environment "${input.environment}"`,
    );
  }
  return binding;
};

/**
 * Deep-clone a routing table into a fresh, mutable copy. Callers may
 * mutate the returned object before passing it back to
 * {@link freezeRoutingTableExternal} for shipping to the gateway.
 */
export const cloneRoutingTable = (table: RoutingTable): RoutingTable => {
  const cloneTier = (
    src: Readonly<Record<TaskComplexityTier, AgentModelBinding>>,
  ): Record<TaskComplexityTier, AgentModelBinding> => ({
    "tier-low": cloneBinding(src["tier-low"]),
    "tier-mid": cloneBinding(src["tier-mid"]),
    "tier-high": cloneBinding(src["tier-high"]),
  });
  return {
    schemaVersion: table.schemaVersion,
    profile: table.profile,
    environments: {
      dev: cloneTier(table.environments.dev),
      staging: cloneTier(table.environments.staging),
      prod: cloneTier(table.environments.prod),
    },
  };
};

const cloneBinding = (binding: AgentModelBinding): AgentModelBinding => ({
  providerId: binding.providerId,
  modelId: binding.modelId,
  ...(binding.inferenceProfileId !== undefined
    ? { inferenceProfileId: binding.inferenceProfileId }
    : {}),
  ...(binding.ictRegisterRef !== undefined
    ? { ictRegisterRef: binding.ictRegisterRef }
    : {}),
  ...(binding.family !== undefined ? { family: binding.family } : {}),
  ...(binding.region !== undefined ? { region: binding.region } : {}),
});

/**
 * Re-freeze a (possibly mutated) routing table. Mirrors the shape of
 * the in-tree built-in tables so the consumer cannot tell the
 * difference between a default and a custom table.
 */
export const freezeRoutingTableExternal = (
  table: RoutingTable,
): RoutingTable => freezeRoutingTable(table);
