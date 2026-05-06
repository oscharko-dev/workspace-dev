import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COVERAGE_PLAN_SCHEMA_VERSION,
  DEFAULT_MUTATION_KILL_RATE_TARGET,
  RISK_RANKING_ARTIFACT_FILENAME,
  RISK_RANKING_SCHEMA_VERSION,
  type CoveragePlan,
  type CoveragePlanPerElement,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import { createMockLlmGatewayClient } from "./llm-mock-gateway.js";
import {
  buildRiskRanking,
  buildRiskRankingWithAugmentation,
  writeRiskRankingArtifact,
} from "./risk-ranker.js";

const buildPerElement = (
  overrides: Partial<CoveragePlanPerElement> & { elementId: string },
): CoveragePlanPerElement => ({
  screenId: overrides.screenId ?? "loan",
  elementId: overrides.elementId,
  mustHaveCase: overrides.mustHaveCase ?? true,
  riskClass: overrides.riskClass ?? "low",
});

const buildCoveragePlan = (): CoveragePlan => ({
  schemaVersion: COVERAGE_PLAN_SCHEMA_VERSION,
  jobId: "job-1935",
  perScreen: [
    {
      screenId: "loan",
      techniqueQuotas: [
        { technique: "use_case", minCount: 1 },
        { technique: "boundary_value_analysis", minCount: 1 },
      ],
    },
  ],
  perElement: [
    buildPerElement({ elementId: "principal", riskClass: "financial_transaction" }),
    buildPerElement({ elementId: "iban", riskClass: "regulated_data" }),
    buildPerElement({ elementId: "rate", riskClass: "high" }),
    buildPerElement({ elementId: "term", riskClass: "medium" }),
    buildPerElement({ elementId: "label", riskClass: "low", mustHaveCase: false }),
  ],
  minimumCases: [],
  recommendedCases: [],
  techniques: [],
  mutationKillRateTarget: DEFAULT_MUTATION_KILL_RATE_TARGET,
});

test("buildRiskRanking: deterministic baseline sorts by risk score and emits topK ids", () => {
  const ranking = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });

  assert.equal(ranking.schemaVersion, RISK_RANKING_SCHEMA_VERSION);
  assert.equal(ranking.jobId, "job-1935");
  assert.equal(ranking.rankedElements.length, 5);
  // regulated_data > financial_transaction > high > medium > low
  assert.deepEqual(
    ranking.rankedElements.map((entry) => entry.elementId),
    ["iban", "principal", "rate", "term", "label"],
  );
  assert.equal(ranking.rankedElements[0]?.rationale, "regulated_data");
  assert.equal(ranking.rankedElements[1]?.rationale, "financial_transaction");
  assert.equal(ranking.rankedElements[2]?.rationale, "high_risk_signal");
  // baseline rationale for the must_have low entry kicks in only when the
  // policy strict floor is not active and the riskClass is below "high".
  assert.equal(ranking.rankedElements[3]?.rationale, "must_have_case");
  // top-K defaults to ceil(elements * 0.4) clamped to a minimum of 1.
  assert.equal(ranking.topKElementIds.length, 2);
  assert.deepEqual(ranking.topKElementIds, ["iban", "principal"]);
});

test("buildRiskRanking: scores fall in [0,1] and respect must_have bonus", () => {
  const ranking = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });

  for (const entry of ranking.rankedElements) {
    assert.ok(entry.riskScore >= 0 && entry.riskScore <= 1);
  }
  // mustHaveCase=true on a low element raises the score above the bare baseline.
  const labelEntry = ranking.rankedElements.find(
    (entry) => entry.elementId === "label",
  );
  const termEntry = ranking.rankedElements.find(
    (entry) => entry.elementId === "term",
  );
  assert.ok(labelEntry);
  assert.ok(termEntry);
  // medium > low even when low has mustHaveCase=false
  assert.ok(termEntry.riskScore > labelEntry.riskScore);
});

test("buildRiskRanking: DORA-style strict policy floor lifts strict categories to 0.95+", () => {
  const ranking = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
    policyProfile: {
      rules: {
        strictRiskCategories: ["regulated_data", "financial_transaction"],
      },
    },
  });

  const iban = ranking.rankedElements.find((entry) => entry.elementId === "iban");
  const principal = ranking.rankedElements.find(
    (entry) => entry.elementId === "principal",
  );
  assert.ok(iban);
  assert.ok(principal);
  assert.ok(iban.riskScore >= 0.95);
  assert.ok(principal.riskScore >= 0.95);
  assert.equal(iban.rationale, "policy_strict");
  assert.equal(principal.rationale, "policy_strict");
});

test("buildRiskRanking: backwards-compatible without an explicit policy profile", () => {
  const ranking = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });
  assert.ok(ranking.rankedElements.every((entry) => entry.rationale !== "policy_strict"));
});

test("buildRiskRanking: deterministic — equal inputs produce byte-identical output", () => {
  const left = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });
  const right = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });
  assert.equal(canonicalJson(left), canonicalJson(right));
});

test("buildRiskRanking: explicit topK override clamps to the ranked length", () => {
  const ranking = buildRiskRanking({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
    topK: 100,
  });
  assert.equal(ranking.topKElementIds.length, 5);
});

test("buildRiskRanking: empty coverage plan emits an empty ranking", () => {
  const empty: CoveragePlan = {
    ...buildCoveragePlan(),
    perElement: [],
  };
  const ranking = buildRiskRanking({ jobId: "job-1935", coveragePlan: empty });
  assert.equal(ranking.rankedElements.length, 0);
  assert.equal(ranking.topKElementIds.length, 0);
});

test("buildRiskRankingWithAugmentation: returns deterministic baseline when no rankerClient", async () => {
  const result = await buildRiskRankingWithAugmentation({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
  });
  assert.equal(result.usedAugmentation, false);
  assert.equal(result.gatewayResult, undefined);
  assert.equal(result.ranking.schemaVersion, RISK_RANKING_SCHEMA_VERSION);
});

test("buildRiskRankingWithAugmentation: LLM augmentation may only raise scores and re-rank", async () => {
  const ranker = createMockLlmGatewayClient({
    role: "risk_ranker",
    deployment: "phi-4-mini-instruct",
    modelRevision: "phi-4-mini-instruct@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "success",
      content: {
        rankedElements: [
          // Try to LOWER iban score — must be ignored.
          {
            screenId: "loan",
            elementId: "iban",
            riskScore: 0.1,
            rationale: "baseline",
          },
          // Raise rate score above the financial_transaction baseline.
          {
            screenId: "loan",
            elementId: "rate",
            riskScore: 0.99,
            rationale: "high_risk_signal",
          },
          // Unknown element — must be ignored gracefully.
          {
            screenId: "ghost",
            elementId: "ghost",
            riskScore: 1.0,
            rationale: "baseline",
          },
        ],
      },
      finishReason: "stop",
      usage: { inputTokens: 19, outputTokens: 11 },
      modelDeployment: "phi-4-mini-instruct",
      modelRevision: "phi-4-mini-instruct@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await buildRiskRankingWithAugmentation({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
    rankerClient: ranker,
  });

  assert.equal(result.usedAugmentation, true);
  assert.equal(ranker.callCount(), 1);
  const iban = result.ranking.rankedElements.find(
    (entry) => entry.elementId === "iban",
  );
  const rate = result.ranking.rankedElements.find(
    (entry) => entry.elementId === "rate",
  );
  assert.ok(iban);
  assert.ok(rate);
  // Lowering attempt is ignored: iban remains at the deterministic baseline.
  assert.ok(iban.riskScore >= 0.9);
  // Rate is raised — it should now outrank principal (financial_transaction).
  assert.equal(rate.riskScore, 0.99);
  const order = result.ranking.rankedElements.map((entry) => entry.elementId);
  assert.equal(order.indexOf("rate") < order.indexOf("principal"), true);
  // Unknown element does NOT appear in the merged result.
  assert.equal(
    result.ranking.rankedElements.find(
      (entry) => entry.elementId === "ghost",
    ),
    undefined,
  );
});

test("buildRiskRankingWithAugmentation: gateway non-success falls back to baseline", async () => {
  const ranker = createMockLlmGatewayClient({
    role: "risk_ranker",
    deployment: "phi-4-mini-instruct",
    modelRevision: "phi-4-mini-instruct@test",
    gatewayRelease: "mock",
    responder: (_request, attempt) => ({
      outcome: "schema_invalid",
      schemaName: "workspace-dev-risk-ranker-v1",
      validationErrors: ["fixture: schema_invalid"],
      finishReason: "stop",
      usage: { inputTokens: 5, outputTokens: 0 },
      modelDeployment: "phi-4-mini-instruct",
      modelRevision: "phi-4-mini-instruct@test",
      gatewayRelease: "mock",
      attempt,
    }),
  });

  const result = await buildRiskRankingWithAugmentation({
    jobId: "job-1935",
    coveragePlan: buildCoveragePlan(),
    rankerClient: ranker,
  });

  assert.equal(result.usedAugmentation, false);
  assert.ok(result.gatewayResult);
  assert.equal(result.gatewayResult.outcome, "schema_invalid");
  assert.equal(result.ranking.rankedElements.length, 5);
});

test("writeRiskRankingArtifact: persists canonical JSON at risk-ranking.json", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "risk-ranking-"));
  try {
    const ranking = buildRiskRanking({
      jobId: "job-1935",
      coveragePlan: buildCoveragePlan(),
    });
    const { artifactPath } = await writeRiskRankingArtifact({
      ranking,
      runDir,
    });
    assert.equal(artifactPath, join(runDir, RISK_RANKING_ARTIFACT_FILENAME));
    const persisted = await readFile(artifactPath, "utf8");
    assert.equal(persisted, canonicalJson(ranking));
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("writeRiskRankingArtifact: rejects empty runDir", async () => {
  await assert.rejects(
    () =>
      writeRiskRankingArtifact({
        ranking: buildRiskRanking({
          jobId: "job-1935",
          coveragePlan: buildCoveragePlan(),
        }),
        runDir: "",
      }),
    /runDir must be a non-empty string/,
  );
});
