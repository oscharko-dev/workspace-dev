import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  type JudgeModelFamily,
  MODEL_ROUTING_POLICY_SCHEMA_VERSION,
  MODEL_ROUTING_ROLES,
  MODEL_ROUTING_ROUTE_SLOTS,
  MODEL_ROUTING_TIER_LABELS,
  type AgentModelBinding,
  type ModelRoutingOverride,
  type ModelRoutingOverrideRoute,
  type ModelRoutingPolicy,
  type ModelRoutingRole,
  type ModelRoutingRoute,
  type ModelRoutingRouteSlot,
  type ModelRoutingTierLabel,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

const AZURE_PROVIDER_ID = "azure-ai-foundry" as const;
const EU_REGION = "eu" as const;
const EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY_VERSION = "1.0.0" as const;

const inferFamilyFromDeployment = (
  deployment: string,
): JudgeModelFamily | undefined => {
  if (deployment.startsWith("mistral")) return "mistral";
  if (deployment.startsWith("gpt-oss")) return "openai";
  return undefined;
};

export const isModelRoutingRole = (
  value: unknown,
): value is ModelRoutingRole =>
  typeof value === "string" &&
  (MODEL_ROUTING_ROLES as readonly string[]).includes(value);

export const isModelRoutingRouteSlot = (
  value: unknown,
): value is ModelRoutingRouteSlot =>
  typeof value === "string" &&
  (MODEL_ROUTING_ROUTE_SLOTS as readonly string[]).includes(value);

export const isModelRoutingTierLabel = (
  value: unknown,
): value is ModelRoutingTierLabel =>
  typeof value === "string" &&
  (MODEL_ROUTING_TIER_LABELS as readonly string[]).includes(value);

const cloneModelBinding = (binding: AgentModelBinding): AgentModelBinding =>
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

const freezeRoute = (route: ModelRoutingRoute): ModelRoutingRoute =>
  Object.freeze({
    role: route.role,
    slot: route.slot,
    tierLabel: route.tierLabel,
    modelBinding: cloneModelBinding(route.modelBinding),
    ...(route.modelRevision !== undefined
      ? { modelRevision: route.modelRevision }
      : {}),
    ...(route.gatewayRelease !== undefined
      ? { gatewayRelease: route.gatewayRelease }
      : {}),
  });

const sortRoutes = (
  routes: readonly ModelRoutingRoute[],
): readonly ModelRoutingRoute[] =>
  [...routes]
    .map(freezeRoute)
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.slot.localeCompare(right.slot) ||
        left.tierLabel.localeCompare(right.tierLabel),
    );

const freezePolicy = (policy: ModelRoutingPolicy): ModelRoutingPolicy =>
  Object.freeze({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyProfileId: policy.policyProfileId,
    routes: sortRoutes(policy.routes),
  });

export const createAzurePortfolioBinding = (input: {
  deployment: string;
  ictRegisterRef?: string;
}): AgentModelBinding => {
  const family = inferFamilyFromDeployment(input.deployment);
  return Object.freeze({
    providerId: AZURE_PROVIDER_ID,
    modelId: input.deployment,
    inferenceProfileId: input.deployment,
    ...(family !== undefined ? { family } : {}),
    region: EU_REGION,
    ...(input.ictRegisterRef !== undefined
      ? { ictRegisterRef: input.ictRegisterRef }
      : {}),
  });
};

export const EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY: ModelRoutingPolicy =
  freezePolicy({
    schemaVersion: MODEL_ROUTING_POLICY_SCHEMA_VERSION,
    policyId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyVersion: EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY_VERSION,
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    routes: [
      {
        role: "test_generation",
        slot: "primary",
        tierLabel: "heavy",
        modelBinding: createAzurePortfolioBinding({
          deployment: "mistral-large-3",
        }),
      },
      {
        role: "logic_judge",
        slot: "primary",
        tierLabel: "heavy",
        modelBinding: createAzurePortfolioBinding({
          deployment: "gpt-oss-120b",
        }),
      },
      {
        role: "coverage_planner",
        slot: "triage",
        tierLabel: "light",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4-mini-instruct",
        }),
      },
      {
        role: "risk_ranker",
        slot: "triage",
        tierLabel: "light",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4",
        }),
      },
      {
        role: "visual_primary",
        slot: "primary",
        tierLabel: "multimodal",
        modelBinding: createAzurePortfolioBinding({
          deployment: "llama-4-maverick-vision",
        }),
      },
      {
        role: "visual_fallback",
        slot: "fallback",
        tierLabel: "multimodal",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4-multimodal-instruct",
        }),
      },
      {
        role: "a11y_judge",
        slot: "primary",
        tierLabel: "multimodal",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4-multimodal-instruct",
        }),
      },
      {
        role: "faithfulness_judge",
        slot: "primary",
        tierLabel: "multimodal",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4-multimodal-instruct",
        }),
      },
      {
        role: "document_ingestion",
        slot: "primary",
        tierLabel: "multimodal",
        modelBinding: createAzurePortfolioBinding({
          deployment: "mistral-document-ai-2512",
        }),
      },
      {
        role: "adversarial_critic",
        slot: "primary",
        tierLabel: "light",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4",
        }),
      },
      {
        role: "calibration_holdout_generator",
        slot: "primary",
        tierLabel: "heavy",
        modelBinding: createAzurePortfolioBinding({
          deployment: "gpt-oss-120b",
        }),
      },
    ],
  });

export const cloneModelRoutingPolicy = (
  policy: ModelRoutingPolicy,
): ModelRoutingPolicy =>
  freezePolicy({
    schemaVersion: policy.schemaVersion,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    policyProfileId: policy.policyProfileId,
    routes: policy.routes.map((route) => ({
      role: route.role,
      slot: route.slot,
      tierLabel: route.tierLabel,
      modelBinding: { ...route.modelBinding },
      ...(route.modelRevision !== undefined
        ? { modelRevision: route.modelRevision }
        : {}),
      ...(route.gatewayRelease !== undefined
        ? { gatewayRelease: route.gatewayRelease }
        : {}),
    })),
  });

export const getDefaultModelRoutingPolicy = (
  policyProfileId: string,
): ModelRoutingPolicy => {
  if (policyProfileId === EU_BANKING_DEFAULT_POLICY_PROFILE_ID) {
    return EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY;
  }
  return freezePolicy({
    schemaVersion: MODEL_ROUTING_POLICY_SCHEMA_VERSION,
    policyId: policyProfileId,
    policyVersion: "runtime",
    policyProfileId,
    routes: [],
  });
};

const routeKey = (route: { role: string; slot?: string }): string =>
  `${route.role}::${route.slot ?? "primary"}`;

export const applyModelRoutingOverride = (input: {
  policy: ModelRoutingPolicy;
  override?: ModelRoutingOverride;
}): ModelRoutingPolicy => {
  if (input.override === undefined || input.override.routes.length === 0) {
    return input.policy;
  }
  const byKey = new Map<string, ModelRoutingRoute>(
    input.policy.routes.map((route) => [routeKey(route), route]),
  );
  for (const overrideRoute of input.override.routes) {
    const slot = overrideRoute.slot ?? "primary";
    const existing = byKey.get(routeKey({ role: overrideRoute.role, slot }));
    if (existing === undefined) {
      if (overrideRoute.modelBinding === undefined) {
        continue;
      }
      byKey.set(
        routeKey({ role: overrideRoute.role, slot }),
        freezeRoute({
          role: overrideRoute.role,
          slot,
          tierLabel: overrideRoute.tierLabel ?? "heavy",
          modelBinding: overrideRoute.modelBinding,
          ...(overrideRoute.modelRevision !== undefined
            ? { modelRevision: overrideRoute.modelRevision }
            : {}),
          ...(overrideRoute.gatewayRelease !== undefined
            ? { gatewayRelease: overrideRoute.gatewayRelease }
            : {}),
        }),
      );
      continue;
    }
    byKey.set(
      routeKey({ role: overrideRoute.role, slot }),
      freezeRoute({
        role: existing.role,
        slot,
        tierLabel: overrideRoute.tierLabel ?? existing.tierLabel,
        modelBinding: overrideRoute.modelBinding ?? existing.modelBinding,
        ...((overrideRoute.modelRevision ?? existing.modelRevision) !== undefined
          ? {
              modelRevision:
                overrideRoute.modelRevision ?? existing.modelRevision,
            }
          : {}),
        ...((overrideRoute.gatewayRelease ?? existing.gatewayRelease) !==
        undefined
          ? {
              gatewayRelease:
                overrideRoute.gatewayRelease ?? existing.gatewayRelease,
            }
          : {}),
      }),
    );
  }
  return freezePolicy({
    schemaVersion: input.policy.schemaVersion,
    policyId: input.policy.policyId,
    policyVersion: input.policy.policyVersion,
    policyProfileId: input.policy.policyProfileId,
    routes: Array.from(byKey.values()),
  });
};

export const computeModelRoutingPolicyDigest = (
  policy: ModelRoutingPolicy,
): string => sha256Hex(policy);

const policyRouteForRole = (
  policy: ModelRoutingPolicy,
  role: ModelRoutingRole,
  slot: ModelRoutingRouteSlot = "primary",
): ModelRoutingRoute | undefined =>
  policy.routes.find((route) => route.role === role && route.slot === slot) ??
  policy.routes.find((route) => route.role === role);

const roleAliasFromGatewayRole = (
  role: ModelRoutingRole,
): ModelRoutingOverrideRoute["role"] => role;

export const buildRuntimeModelRoutingPolicy = (input: {
  policyProfileId: string;
  policyVersion?: string;
  roles: ReadonlyArray<{
    role: ModelRoutingRole;
    deployment: string;
    modelRevision: string;
    gatewayRelease: string;
    ictRegisterRef?: string;
  }>;
  override?: ModelRoutingOverride;
}): ModelRoutingPolicy => {
  const base = applyModelRoutingOverride({
    policy: getDefaultModelRoutingPolicy(input.policyProfileId),
    ...(input.override !== undefined ? { override: input.override } : {}),
  });
  const runtimeRoutes: ModelRoutingRoute[] = input.roles.map((role) => {
    const defaultRoute =
      policyRouteForRole(base, roleAliasFromGatewayRole(role.role)) ??
      ({
        role: role.role,
        slot: "primary",
        tierLabel: "heavy",
        modelBinding: createAzurePortfolioBinding({
          deployment: role.deployment,
          ...(role.ictRegisterRef !== undefined
            ? { ictRegisterRef: role.ictRegisterRef }
            : {}),
        }),
      } satisfies ModelRoutingRoute);
    return freezeRoute({
      role: role.role,
      slot: defaultRoute.slot,
      tierLabel: defaultRoute.tierLabel,
      modelBinding: {
        ...defaultRoute.modelBinding,
        modelId: role.deployment,
        inferenceProfileId: role.deployment,
        ...(role.ictRegisterRef !== undefined
          ? { ictRegisterRef: role.ictRegisterRef }
          : {}),
      },
      modelRevision: role.modelRevision,
      gatewayRelease: role.gatewayRelease,
    });
  });
  return freezePolicy({
    schemaVersion: MODEL_ROUTING_POLICY_SCHEMA_VERSION,
    policyId: base.policyId,
    policyVersion: input.policyVersion ?? base.policyVersion,
    policyProfileId: input.policyProfileId,
    routes: runtimeRoutes,
  });
};

export const buildModelRoutingOverride = (
  routes: readonly ModelRoutingOverrideRoute[],
): ModelRoutingOverride => ({
  routes: [...routes].sort(
    (left, right) =>
      routeKey(left).localeCompare(routeKey(right)) ||
      (left.tierLabel ?? "").localeCompare(right.tierLabel ?? ""),
  ),
});

export const serializeModelRoutingPolicy = (
  policy: ModelRoutingPolicy,
): string => canonicalJson(policy);
