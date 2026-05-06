import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_RISK_RANKING_RATIONALES,
  RISK_RANKING_ARTIFACT_FILENAME,
  RISK_RANKING_SCHEMA_VERSION,
  type CoveragePlan,
  type CoveragePlanElementRiskClass,
  type CoveragePlanPerElement,
  type LlmGenerationResult,
  type RiskRanking,
  type RiskRankingElement,
  type RiskRankingRationale,
  type TestCaseRiskCategory,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

export interface BuildRiskRankingInput {
  jobId: string;
  coveragePlan: CoveragePlan;
  policyProfile?: Record<string, unknown>;
  topK?: number;
}

export interface BuildRiskRankingWithAugmentationInput
  extends BuildRiskRankingInput {
  rankerClient?: LlmGatewayClient;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxWallClockMs?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
}

export interface RiskRankingBuildResult {
  ranking: RiskRanking;
  usedAugmentation: boolean;
  gatewayResult?: LlmGenerationResult;
}

const RISK_RANKER_RESPONSE_SCHEMA_NAME =
  "workspace-dev-risk-ranker-v1" as const;

const DEFAULT_TOP_K = 10 as const;
const TOP_K_FRACTION = 0.4 as const;

const BASE_SCORE_BY_RISK_CLASS: Readonly<
  Record<CoveragePlanElementRiskClass, number>
> = {
  regulated_data: 0.9,
  financial_transaction: 0.85,
  high: 0.7,
  medium: 0.5,
  low: 0.25,
};

const RATIONALE_BY_RISK_CLASS: Readonly<
  Record<CoveragePlanElementRiskClass, RiskRankingRationale>
> = {
  regulated_data: "regulated_data",
  financial_transaction: "financial_transaction",
  high: "high_risk_signal",
  medium: "medium_risk_signal",
  low: "baseline",
};

const POLICY_STRICT_FLOOR = 0.95 as const;
const MUST_HAVE_BONUS = 0.05 as const;

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

const isAllowedRationale = (
  value: unknown,
): value is RiskRankingRationale =>
  typeof value === "string" &&
  (ALLOWED_RISK_RANKING_RATIONALES as readonly string[]).includes(value);

const extractStrictRiskCategories = (
  policyProfile: Record<string, unknown> | undefined,
): ReadonlySet<TestCaseRiskCategory> => {
  if (policyProfile === undefined) {
    return new Set();
  }
  const rules = policyProfile["rules"];
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
    return new Set();
  }
  const strictRaw = (rules as Record<string, unknown>)["strictRiskCategories"];
  if (!Array.isArray(strictRaw)) {
    return new Set();
  }
  const allowed: ReadonlySet<TestCaseRiskCategory> = new Set([
    "low",
    "medium",
    "high",
    "regulated_data",
    "financial_transaction",
  ]);
  const result = new Set<TestCaseRiskCategory>();
  for (const candidate of strictRaw) {
    if (typeof candidate === "string" && allowed.has(candidate as TestCaseRiskCategory)) {
      result.add(candidate as TestCaseRiskCategory);
    }
  }
  return result;
};

const computeTopK = (totalElements: number, override: number | undefined): number => {
  if (override !== undefined) {
    if (!Number.isSafeInteger(override) || override < 0) {
      throw new RangeError(
        "buildRiskRanking: topK must be a non-negative safe integer",
      );
    }
    return Math.min(override, totalElements);
  }
  if (totalElements === 0) {
    return 0;
  }
  return Math.min(
    DEFAULT_TOP_K,
    Math.max(1, Math.ceil(totalElements * TOP_K_FRACTION)),
  );
};

const compareRankedElements = (
  left: RiskRankingElement,
  right: RiskRankingElement,
): number => {
  if (left.riskScore !== right.riskScore) {
    return right.riskScore - left.riskScore;
  }
  const screenCmp = left.screenId.localeCompare(right.screenId);
  if (screenCmp !== 0) {
    return screenCmp;
  }
  return left.elementId.localeCompare(right.elementId);
};

const scoreElement = (input: {
  element: CoveragePlanPerElement;
  strictCategories: ReadonlySet<TestCaseRiskCategory>;
}): RiskRankingElement => {
  const baseScore = BASE_SCORE_BY_RISK_CLASS[input.element.riskClass];
  const withMustHave = input.element.mustHaveCase
    ? baseScore + MUST_HAVE_BONUS
    : baseScore;
  const isStrict = input.strictCategories.has(input.element.riskClass);
  const rawScore = isStrict
    ? Math.max(withMustHave, POLICY_STRICT_FLOOR)
    : withMustHave;
  const rationale: RiskRankingRationale = isStrict
    ? "policy_strict"
    : input.element.mustHaveCase &&
        input.element.riskClass !== "regulated_data" &&
        input.element.riskClass !== "financial_transaction" &&
        input.element.riskClass !== "high"
      ? "must_have_case"
      : RATIONALE_BY_RISK_CLASS[input.element.riskClass];
  return {
    screenId: input.element.screenId,
    elementId: input.element.elementId,
    riskScore: clamp01(Number(rawScore.toFixed(4))),
    rationale,
  };
};

export const buildRiskRanking = (
  input: BuildRiskRankingInput,
): RiskRanking => {
  const strictCategories = extractStrictRiskCategories(input.policyProfile);
  const ranked = input.coveragePlan.perElement
    .map((element) => scoreElement({ element, strictCategories }))
    .sort(compareRankedElements);
  const topK = computeTopK(ranked.length, input.topK);
  return {
    schemaVersion: RISK_RANKING_SCHEMA_VERSION,
    jobId: input.jobId,
    rankedElements: ranked,
    topKElementIds: ranked.slice(0, topK).map((entry) => entry.elementId),
  };
};

const buildRiskRankerResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["rankedElements"],
  properties: {
    rankedElements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["screenId", "elementId", "riskScore", "rationale"],
        properties: {
          screenId: { type: "string", minLength: 1 },
          elementId: { type: "string", minLength: 1 },
          riskScore: { type: "number", minimum: 0, maximum: 1 },
          rationale: { enum: [...ALLOWED_RISK_RANKING_RATIONALES] },
        },
      },
    },
  },
});

const mergeRiskRankingAugmentation = (input: {
  ranking: RiskRanking;
  augmentation: unknown;
  topKOverride: number | undefined;
}): RiskRanking => {
  if (typeof input.augmentation !== "object" || input.augmentation === null) {
    return input.ranking;
  }
  const augmentation = input.augmentation as Record<string, unknown>;
  const overridesRaw = Array.isArray(augmentation["rankedElements"])
    ? augmentation["rankedElements"]
    : [];
  const merged = input.ranking.rankedElements.map((entry) => {
    const override = overridesRaw.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as Record<string, unknown>)["screenId"] === entry.screenId &&
        (candidate as Record<string, unknown>)["elementId"] === entry.elementId,
    ) as Record<string, unknown> | undefined;
    if (override === undefined) {
      return entry;
    }
    const candidateScore =
      typeof override["riskScore"] === "number" &&
      Number.isFinite(override["riskScore"])
        ? clamp01(override["riskScore"])
        : entry.riskScore;
    const nextScore =
      candidateScore > entry.riskScore ? candidateScore : entry.riskScore;
    const candidateRationale = override["rationale"];
    const nextRationale: RiskRankingRationale =
      isAllowedRationale(candidateRationale) && nextScore > entry.riskScore
        ? candidateRationale
        : entry.rationale;
    return {
      screenId: entry.screenId,
      elementId: entry.elementId,
      riskScore: Number(nextScore.toFixed(4)),
      rationale: nextRationale,
    };
  });
  const ranked = merged.slice().sort(compareRankedElements);
  const topK = computeTopK(ranked.length, input.topKOverride);
  return {
    schemaVersion: input.ranking.schemaVersion,
    jobId: input.ranking.jobId,
    rankedElements: ranked,
    topKElementIds: ranked.slice(0, topK).map((entry) => entry.elementId),
  };
};

export const buildRiskRankingWithAugmentation = async (
  input: BuildRiskRankingWithAugmentationInput,
): Promise<RiskRankingBuildResult> => {
  const ranking = buildRiskRanking(input);
  if (input.rankerClient === undefined) {
    return { ranking, usedAugmentation: false };
  }
  const request = {
    jobId: input.jobId,
    systemPrompt: [
      "You are the optional Risk-Ranker augmentation model for workspace-dev.",
      "You receive a deterministic CoveragePlan baseline, the deterministic RiskRanking, and an optional policy profile as JSON.",
      "Return JSON only. You may only raise an element's riskScore (never lower it) and must keep scores within the closed interval [0, 1].",
      "Rationale tokens are limited to the closed taxonomy provided by the schema; never invent new tokens.",
      "Never emit elements that are not present in the deterministic baseline.",
    ].join(" "),
    userPrompt: [
      "[1] CoveragePlan",
      canonicalJson(input.coveragePlan),
      "[2] RiskRankingBaseline",
      canonicalJson(ranking),
      ...(input.policyProfile === undefined
        ? []
        : ["[3] PolicyProfile", canonicalJson(input.policyProfile)]),
    ].join("\n"),
    responseSchema: buildRiskRankerResponseSchema(),
    responseSchemaName: RISK_RANKER_RESPONSE_SCHEMA_NAME,
    ...(input.maxInputTokens !== undefined
      ? { maxInputTokens: input.maxInputTokens }
      : {}),
    ...(input.maxOutputTokens !== undefined
      ? { maxOutputTokens: input.maxOutputTokens }
      : {}),
    ...(input.maxWallClockMs !== undefined
      ? { maxWallClockMs: input.maxWallClockMs }
      : {}),
    ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
    ...(input.abortSignal !== undefined
      ? { abortSignal: input.abortSignal }
      : {}),
  };
  const gatewayResult = await input.rankerClient.generate(request);
  if (gatewayResult.outcome !== "success") {
    return { ranking, usedAugmentation: false, gatewayResult };
  }
  return {
    ranking: mergeRiskRankingAugmentation({
      ranking,
      augmentation: gatewayResult.content,
      topKOverride: input.topK,
    }),
    usedAugmentation: true,
    gatewayResult,
  };
};

export const writeRiskRankingArtifact = async (input: {
  ranking: RiskRanking;
  runDir: string;
}): Promise<{ artifactPath: string }> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeRiskRankingArtifact: runDir must be a non-empty string",
    );
  }
  await mkdir(input.runDir, { recursive: true });
  const artifactPath = join(input.runDir, RISK_RANKING_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.ranking), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};
