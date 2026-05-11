import assert from "node:assert/strict";
import test from "node:test";

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  type ModelRoutingPolicy,
} from "../contracts/index.js";
import {
  applyModelRoutingOverride,
  buildModelRoutingOverride,
  buildRuntimeModelRoutingPolicy,
  computeModelRoutingPolicyDigest,
  createAzurePortfolioBinding,
  EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY,
} from "./model-routing-policy.js";
import { resolveProductionTopologyModelRoutingPolicy } from "./production-topology-clients.js";

const routeForRole = (
  policy: ModelRoutingPolicy,
  role: ModelRoutingPolicy["routes"][number]["role"],
) => policy.routes.find((route) => route.role === role);

const findRoute = (
  policy: ModelRoutingPolicy,
  role: ModelRoutingPolicy["routes"][number]["role"],
  slot: ModelRoutingPolicy["routes"][number]["slot"],
) => policy.routes.find((route) => route.role === role && route.slot === slot);

test("eu-banking default policy: declares cross-family diversity slots from Epic #2099 mapping", () => {
  const policy = EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY;

  const generatorPrimary = findRoute(policy, "test_generation", "primary");
  const generatorSecondary = findRoute(policy, "test_generation", "secondary");
  assert.equal(generatorPrimary?.modelBinding.modelId, "mistral-large-3");
  assert.equal(generatorSecondary?.modelBinding.modelId, "gpt-oss-120b");

  const logicPrimary = findRoute(policy, "logic_judge", "primary");
  const logicSecondary = findRoute(policy, "logic_judge", "secondary");
  const logicTriage = findRoute(policy, "logic_judge", "triage");
  assert.ok(logicPrimary);
  assert.ok(logicSecondary);
  assert.notEqual(
    logicPrimary?.modelBinding.modelId,
    logicSecondary?.modelBinding.modelId,
    "logic judge primary and secondary must be different deployments to enable cross-family voting",
  );
  assert.equal(logicTriage?.modelBinding.modelId, "phi-4-mini-instruct");
  assert.equal(logicTriage?.tierLabel, "light");

  const faithfulnessPrimary = findRoute(policy, "faithfulness_judge", "primary");
  const faithfulnessFallback = findRoute(policy, "faithfulness_judge", "fallback");
  assert.equal(
    faithfulnessPrimary?.modelBinding.modelId,
    "phi-4-multimodal-instruct",
  );
  assert.equal(
    faithfulnessFallback?.modelBinding.modelId,
    "llama-4-maverick-vision",
  );

  const docPrimary = findRoute(policy, "document_ingestion", "primary");
  const docFallback = findRoute(policy, "document_ingestion", "fallback");
  assert.equal(docPrimary?.modelBinding.modelId, "mistral-document-ai-2512");
  assert.equal(docFallback?.modelBinding.modelId, "mistral-large-3");

  const adversarialPrimary = findRoute(policy, "adversarial_critic", "primary");
  const adversarialSecondary = findRoute(
    policy,
    "adversarial_critic",
    "secondary",
  );
  assert.equal(adversarialPrimary?.modelBinding.modelId, "phi-4");
  assert.equal(adversarialSecondary?.modelBinding.modelId, "mistral-large-3");
  assert.equal(adversarialSecondary?.tierLabel, "heavy");
});

test("eu-banking default policy: cross-family diversity is canonically expressed via mistral + openai families", () => {
  const policy = EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY;
  const families = new Set<string>();
  for (const route of policy.routes) {
    if (route.role === "test_generation" || route.role === "logic_judge") {
      if (route.modelBinding.family !== undefined) {
        families.add(route.modelBinding.family);
      }
    }
  }
  assert.ok(
    families.has("mistral") && families.has("openai"),
    "generator + logic judge routes must span mistral + openai families for diversity voting",
  );
});

test("model routing policy: override changes the digest and targeted route metadata", () => {
  const digestBefore = computeModelRoutingPolicyDigest(
    EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY,
  );
  const overridden = applyModelRoutingOverride({
    policy: EU_BANKING_DEFAULT_MODEL_ROUTING_POLICY,
    override: buildModelRoutingOverride([
      {
        role: "logic_judge",
        tierLabel: "light",
        modelRevision: "logic-judge@2026-05-09",
        gatewayRelease: "azure-ai-foundry@2026.05",
        modelBinding: createAzurePortfolioBinding({
          deployment: "phi-4-mini-instruct",
        }),
      },
    ]),
  });

  const digestAfter = computeModelRoutingPolicyDigest(overridden);
  const logicJudge = routeForRole(overridden, "logic_judge");
  assert.notEqual(digestAfter, digestBefore);
  assert.ok(logicJudge);
  assert.equal(logicJudge?.tierLabel, "light");
  assert.equal(logicJudge?.modelBinding.modelId, "phi-4-mini-instruct");
  assert.equal(logicJudge?.modelRevision, "logic-judge@2026-05-09");
  assert.equal(logicJudge?.gatewayRelease, "azure-ai-foundry@2026.05");
});

test("model routing policy: runtime policy preserves non-primary default slots and stamps live identities", () => {
  const runtimePolicy = buildRuntimeModelRoutingPolicy({
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
    policyVersion: "runtime-2026-05-09",
    roles: [
      {
        role: "coverage_planner",
        deployment: "phi-4-mini-instruct-prod",
        modelRevision: "phi-4-mini-instruct-prod@2026-05-09",
        gatewayRelease: "azure-ai-foundry@2026.05",
      },
      {
        role: "risk_ranker",
        deployment: "phi-4-prod",
        modelRevision: "phi-4-prod@2026-05-09",
        gatewayRelease: "azure-ai-foundry@2026.05",
      },
    ],
  });

  const coveragePlanner = routeForRole(runtimePolicy, "coverage_planner");
  const riskRanker = routeForRole(runtimePolicy, "risk_ranker");
  assert.equal(coveragePlanner?.slot, "triage");
  assert.equal(coveragePlanner?.tierLabel, "light");
  assert.equal(
    coveragePlanner?.modelBinding.inferenceProfileId,
    "phi-4-mini-instruct-prod",
  );
  assert.equal(
    coveragePlanner?.modelRevision,
    "phi-4-mini-instruct-prod@2026-05-09",
  );
  assert.equal(riskRanker?.slot, "triage");
  assert.equal(riskRanker?.tierLabel, "light");
  assert.equal(riskRanker?.modelBinding.inferenceProfileId, "phi-4-prod");
});

test("production topology policy: coverage planner config uses its own routed deployment", () => {
  const policy = resolveProductionTopologyModelRoutingPolicy({
    endpoint: "https://gateway.example.test",
    visualEndpoint: "https://vision.example.test",
    deployment: "mistral-large-3",
    visualPrimaryDeployment: "llama-4-maverick-vision",
    visualFallbackDeployment: "phi-4-multimodal-instruct",
    logicJudgeDeployment: "gpt-oss-120b",
    a11yJudgeDeployment: "phi-4-multimodal-instruct",
    coveragePlannerDeployment: "phi-4-mini-instruct",
    riskRankerDeployment: "phi-4",
    modelRevisionSuffix: "2026-05-09",
    gatewayRelease: "azure-ai-foundry@2026.05",
    policyProfileId: EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  });

  const coveragePlanner = routeForRole(policy, "coverage_planner");
  assert.equal(coveragePlanner?.slot, "triage");
  assert.equal(coveragePlanner?.tierLabel, "light");
  assert.equal(
    coveragePlanner?.modelBinding.inferenceProfileId,
    "phi-4-mini-instruct",
  );
  assert.equal(
    coveragePlanner?.modelRevision,
    "phi-4-mini-instruct@2026-05-09",
  );
});
