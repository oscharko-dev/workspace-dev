import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import bankingPlaybookData from "./adversarial-playbooks/banking.json" with { type: "json" };
import insurancePlaybookData from "./adversarial-playbooks/insurance.json" with { type: "json" };

import type {
  BusinessTestIntentIr,
  CoveragePlan,
  FaithfulnessVerdict,
  GeneratedTestCaseList,
  JudgeVerdict,
  LlmGenerationResult,
  RegulatoryRelevanceDomain,
  RepairInstruction,
  RiskRanking,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import { generateWithLocalWallClockGuard } from "./llm-generation-guard.js";
import type { LlmGatewayClient } from "./llm-gateway.js";

export const ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION = "1.0.0" as const;
export const ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX =
  "adversarial_critic_round_" as const;
export const ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME =
  "adversarial-critic-trace.json" as const;
export const ADVERSARIAL_CRITIC_RESPONSE_SCHEMA_NAME =
  "workspace-dev-adversarial-critic-v1" as const;
export const ADVERSARIAL_CRITIC_MAX_ROUNDS = 2 as const;
export const ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD = 0.3 as const;

export const ADVERSARIAL_CRITIC_FINDING_CATEGORIES = [
  "access_control",
  "boundary",
  "data_leak",
  "negative_path",
  "regulatory_evasion",
  "rounding_exploit",
  "state_violation",
  "workflow_bypass",
] as const;

export type AdversarialCriticFindingCategory =
  (typeof ADVERSARIAL_CRITIC_FINDING_CATEGORIES)[number];

export interface AdversarialCriticPlaybookEntry {
  readonly id: string;
  readonly category: AdversarialCriticFindingCategory;
  readonly title: string;
  readonly hint: string;
  readonly testDataHints: readonly string[];
}

export interface AdversarialCriticFinding {
  readonly schemaVersion: typeof ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION;
  readonly findingId: string;
  readonly category: AdversarialCriticFindingCategory;
  readonly title: string;
  readonly rationale: string;
  readonly affectedFieldId?: string;
  readonly affectedActionId?: string;
  readonly affectedValidationId?: string;
  readonly affectedNavigationId?: string;
  readonly affectedScreenId?: string;
  readonly sourceRefs: readonly string[];
  readonly ruleRefs: readonly string[];
  readonly minimumReproducibleTestData: readonly string[];
  readonly suggestedTestType: "boundary" | "negative" | "navigation" | "validation";
  readonly repairInstruction: string;
}

export interface NegativeCoverageAccounting {
  readonly baselineNegativeCaseCount: number;
  readonly baselineTotalCaseCount: number;
  readonly baselineNegativeRatio: number;
  readonly finalNegativeCaseCount: number;
  readonly finalTotalCaseCount: number;
  readonly finalNegativeRatio: number;
  readonly relativeRatioIncrease: number;
  readonly meetsThreshold: boolean;
}

export interface AdversarialCriticRoundArtifact {
  readonly schemaVersion: typeof ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION;
  readonly jobId: string;
  readonly round: number;
  readonly domain: RegulatoryRelevanceDomain;
  readonly playbookEntryIds: readonly string[];
  readonly inputs: {
    readonly generatedListHash: string;
    readonly coveragePlanHash: string;
    readonly riskRankingHash: string;
    readonly intentHash: string;
    readonly logicVerdictHash?: string;
    readonly faithfulnessVerdictHash?: string;
  };
  readonly outputs: {
    readonly findingCount: number;
    readonly dedupeKeys: readonly string[];
    readonly findings: readonly AdversarialCriticFinding[];
  };
  readonly llmGateway: {
    readonly outcome: "success" | "error";
    readonly errorClass?: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly durationMs: number;
    readonly modelDeployment: string;
  };
}

export interface AdversarialCriticTraceArtifact {
  readonly schemaVersion: typeof ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION;
  readonly jobId: string;
  readonly domain: RegulatoryRelevanceDomain;
  readonly roundsExecuted: number;
  readonly stopReason:
    | "converged_no_new_findings"
    | "critic_failed"
    | "deterministic_fallback_applied"
    | "max_rounds_reached"
    | "no_rounds_needed";
  readonly negativeCoverage: NegativeCoverageAccounting;
  readonly rounds: readonly {
    readonly round: number;
    readonly findingCount: number;
    readonly dedupeKeys: readonly string[];
  }[];
}

export interface RunAdversarialCriticRoundInput {
  readonly jobId: string;
  readonly round: number;
  readonly domain: RegulatoryRelevanceDomain;
  readonly client: LlmGatewayClient;
  readonly intent: BusinessTestIntentIr;
  readonly generatedList: GeneratedTestCaseList;
  readonly coveragePlan: CoveragePlan;
  readonly riskRanking: RiskRanking;
  readonly logicVerdict?: JudgeVerdict;
  readonly faithfulnessVerdict?: FaithfulnessVerdict;
  readonly maxInputTokens?: number;
  readonly maxOutputTokens?: number;
  readonly maxWallClockMs?: number;
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
}

export interface RunAdversarialCriticRoundResult {
  readonly artifact: AdversarialCriticRoundArtifact;
  readonly gatewayResult: LlmGenerationResult;
  readonly findings: readonly AdversarialCriticFinding[];
}

const GENERAL_PLAYBOOK: readonly AdversarialCriticPlaybookEntry[] =
  Object.freeze([
    {
      id: "general-boundary-empty-required",
      category: "boundary",
      title: "Required value empty or whitespace-only",
      hint: "Challenge empty, whitespace, and minimal-length inputs.",
      testDataHints: ["empty string", "single whitespace", "minimum allowed length - 1"],
    },
    {
      id: "general-state-double-action",
      category: "state_violation",
      title: "Repeated primary action mutates state twice",
      hint: "Look for duplicate side effects after repeated submit or confirm.",
      testDataHints: ["double click submit", "repeat enter key"],
    },
    {
      id: "general-negative-conflicting-fields",
      category: "negative_path",
      title: "Conflicting field combination accepted",
      hint: "Challenge inputs that are individually plausible but jointly invalid.",
      testDataHints: ["field A valid, field B valid, combination invalid"],
    },
    {
      id: "general-workflow-direct-navigation",
      category: "workflow_bypass",
      title: "Mandatory workflow step bypassed through direct navigation",
      hint: "Open a later state directly or reuse stale state.",
      testDataHints: ["direct deep link", "reused stale draft state"],
    },
    {
      id: "general-data-leak-summary",
      category: "data_leak",
      title: "Summary or confirmation exposes excessive data",
      hint: "Challenge whether details leak in summaries or read-only views.",
      testDataHints: ["sensitive identifier visible in summary"],
    },
    {
      id: "general-rounding-derived-value",
      category: "rounding_exploit",
      title: "Derived value flips at decimal or formatting boundary",
      hint: "Use decimal precision and locale formatting to challenge calculations.",
      testDataHints: ["0.01", "0,01", "9999.995"],
    },
    {
      id: "general-access-control-cross-context",
      category: "access_control",
      title: "Cross-context data becomes visible",
      hint: "Challenge whether one context can surface another entity's data.",
      testDataHints: ["record A identifier", "record B identifier"],
    },
    {
      id: "general-regulatory-missing-review",
      category: "regulatory_evasion",
      title: "High-risk action lacks explicit review or warning",
      hint: "Challenge whether regulated or irreversible actions skip user-visible safeguards.",
      testDataHints: ["high-risk toggle without confirmation"],
    },
  ]);

const freezePlaybook = (
  entries: readonly AdversarialCriticPlaybookEntry[],
): readonly AdversarialCriticPlaybookEntry[] =>
  Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));

const BANKING_PLAYBOOK = freezePlaybook(
  bankingPlaybookData as readonly AdversarialCriticPlaybookEntry[],
);
const INSURANCE_PLAYBOOK = freezePlaybook(
  insurancePlaybookData as readonly AdversarialCriticPlaybookEntry[],
);

const isFindingCategory = (
  value: unknown,
): value is AdversarialCriticFindingCategory =>
  typeof value === "string" &&
  (ADVERSARIAL_CRITIC_FINDING_CATEGORIES as readonly string[]).includes(value);

const normalizeStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? Object.freeze(
        value
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
          .slice(0, 8),
      )
    : Object.freeze([]);

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const dedupeKeyParts = (finding: AdversarialCriticFinding): readonly string[] =>
  [
    finding.category,
    finding.affectedFieldId ?? "",
    finding.affectedActionId ?? "",
    finding.affectedValidationId ?? "",
    finding.affectedNavigationId ?? "",
    finding.affectedScreenId ?? "",
    [...finding.sourceRefs].sort().join("|"),
    [...finding.ruleRefs].sort().join("|"),
  ];

export const computeAdversarialFindingDedupeKey = (
  finding: AdversarialCriticFinding,
): string => dedupeKeyParts(finding).join("\0");

export const dedupeAdversarialFindings = (input: {
  readonly findings: readonly AdversarialCriticFinding[];
  readonly seenKeys?: ReadonlySet<string>;
}): readonly AdversarialCriticFinding[] => {
  const deduped = new Map<string, AdversarialCriticFinding>();
  for (const finding of input.findings) {
    const key = computeAdversarialFindingDedupeKey(finding);
    if (input.seenKeys?.has(key) || deduped.has(key)) {
      continue;
    }
    deduped.set(key, finding);
  }
  return Object.freeze(
    [...deduped.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map((entry) => entry[1]),
  );
};

export const buildAdversarialRepairInstructions = (
  findings: readonly AdversarialCriticFinding[],
): readonly RepairInstruction[] =>
  Object.freeze(
    findings.map((finding) => ({
      testCaseId: "$job",
      path: finding.affectedFieldId !== undefined ? "testCases" : "$job",
      instruction: finding.repairInstruction,
      message: `Adversarial critic: ${finding.title}`,
    })),
  );

const buildResponseSchema = (): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "category",
          "title",
          "rationale",
          "minimumReproducibleTestData",
          "suggestedTestType",
          "repairInstruction",
        ],
        properties: {
          category: {
            enum: [...ADVERSARIAL_CRITIC_FINDING_CATEGORIES],
          },
          title: { type: "string", minLength: 1, maxLength: 160 },
          rationale: { type: "string", minLength: 1, maxLength: 320 },
          affectedFieldId: { type: "string", minLength: 1, maxLength: 160 },
          affectedActionId: { type: "string", minLength: 1, maxLength: 160 },
          affectedValidationId: { type: "string", minLength: 1, maxLength: 160 },
          affectedNavigationId: { type: "string", minLength: 1, maxLength: 160 },
          affectedScreenId: { type: "string", minLength: 1, maxLength: 160 },
          sourceRefs: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 160 },
            maxItems: 8,
          },
          ruleRefs: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 160 },
            maxItems: 8,
          },
          minimumReproducibleTestData: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 200 },
            minItems: 1,
            maxItems: 6,
          },
          suggestedTestType: {
            enum: ["boundary", "negative", "navigation", "validation"],
          },
          repairInstruction: {
            type: "string",
            minLength: 1,
            maxLength: 240,
          },
        },
      },
    },
  },
});

const resolvePlaybook = (
  domain: RegulatoryRelevanceDomain,
): readonly AdversarialCriticPlaybookEntry[] => {
  switch (domain) {
    case "banking":
      return BANKING_PLAYBOOK;
    case "insurance":
      return INSURANCE_PLAYBOOK;
    default:
      return GENERAL_PLAYBOOK;
  }
};

const buildPrompt = (
  input: RunAdversarialCriticRoundInput,
): {
  readonly playbook: readonly AdversarialCriticPlaybookEntry[];
  readonly systemPrompt: string;
  readonly userPrompt: string;
} => {
  const playbook = resolvePlaybook(input.domain);
  return {
    playbook,
    systemPrompt: [
      "You are the adversarial critic for workspace-dev test intelligence.",
      "Your task is to attack the current generated suite and identify blind spots a malicious, careless, or rushed user could exploit.",
      "Return JSON only.",
      "Findings must be domain-grounded, concrete, and reproducible.",
      "Do not invent system behavior that is absent from the source artifacts.",
      "Prefer high-value gaps over cosmetic UI checks.",
      "If the suite already covers a concern, omit it.",
      "Do not produce more than 6 findings.",
    ].join(" "),
    userPrompt: [
      `[1] Domain\n${input.domain}`,
      "[2] AdversaryPlaybook",
      canonicalJson(playbook),
      "[3] BusinessTestIntentIr",
      canonicalJson(input.intent),
      "[4] CoveragePlan",
      canonicalJson(input.coveragePlan),
      "[5] RiskRanking",
      canonicalJson(input.riskRanking),
      "[6] GeneratedTestCases",
      canonicalJson(input.generatedList),
      ...(input.logicVerdict === undefined
        ? []
        : ["[7] LogicJudgeVerdict", canonicalJson(input.logicVerdict)]),
      ...(input.faithfulnessVerdict === undefined
        ? []
        : [
            "[8] FaithfulnessJudgeVerdict",
            canonicalJson(input.faithfulnessVerdict),
          ]),
      [
        "[9] CriticInstructions",
        "- Focus on boundary, state-violation, regulatory, access-control, workflow-bypass, rounding, and negative-path blind spots.",
        "- Emit only findings that are not already covered by an obvious test case.",
        "- Each finding must include a minimum reproducible test-data fragment.",
        "- Recommend how the generator should improve the suite without increasing total case count.",
      ].join("\n"),
    ].join("\n"),
  };
};

export const validateAdversarialCriticResponse = (
  content: unknown,
): readonly AdversarialCriticFinding[] => {
  if (
    typeof content !== "object" ||
    content === null ||
    !Array.isArray((content as Record<string, unknown>).findings)
  ) {
    throw new TypeError(
      "adversarial critic response must be an object with findings[]",
    );
  }
  const findingsRaw = (content as Record<string, unknown>).findings as unknown[];
  const findings: AdversarialCriticFinding[] = [];
  for (let index = 0; index < findingsRaw.length; index += 1) {
    const finding = findingsRaw[index];
    if (typeof finding !== "object" || finding === null) {
      continue;
    }
    const record = finding as Record<string, unknown>;
    if (!isFindingCategory(record.category)) {
      continue;
    }
    if (
      typeof record.title !== "string" ||
      record.title.trim().length === 0 ||
      typeof record.rationale !== "string" ||
      record.rationale.trim().length === 0 ||
      typeof record.repairInstruction !== "string" ||
      record.repairInstruction.trim().length === 0
    ) {
      continue;
    }
    const suggestedTestType =
      record.suggestedTestType === "boundary" ||
      record.suggestedTestType === "negative" ||
      record.suggestedTestType === "navigation" ||
      record.suggestedTestType === "validation"
        ? record.suggestedTestType
        : undefined;
    if (suggestedTestType === undefined) {
      continue;
    }
    const minimumReproducibleTestData = normalizeStringArray(
      record.minimumReproducibleTestData,
    );
    if (minimumReproducibleTestData.length === 0) {
      continue;
    }
    findings.push({
      schemaVersion: ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION,
      findingId: `adversarial-${index + 1}`,
      category: record.category,
      title: record.title.trim(),
      rationale: record.rationale.trim(),
      ...(typeof record.affectedFieldId === "string" &&
      record.affectedFieldId.trim().length > 0
        ? { affectedFieldId: record.affectedFieldId.trim() }
        : {}),
      ...(typeof record.affectedActionId === "string" &&
      record.affectedActionId.trim().length > 0
        ? { affectedActionId: record.affectedActionId.trim() }
        : {}),
      ...(typeof record.affectedValidationId === "string" &&
      record.affectedValidationId.trim().length > 0
        ? { affectedValidationId: record.affectedValidationId.trim() }
        : {}),
      ...(typeof record.affectedNavigationId === "string" &&
      record.affectedNavigationId.trim().length > 0
        ? { affectedNavigationId: record.affectedNavigationId.trim() }
        : {}),
      ...(typeof record.affectedScreenId === "string" &&
      record.affectedScreenId.trim().length > 0
        ? { affectedScreenId: record.affectedScreenId.trim() }
        : {}),
      sourceRefs: normalizeStringArray(record.sourceRefs),
      ruleRefs: normalizeStringArray(record.ruleRefs),
      minimumReproducibleTestData,
      suggestedTestType,
      repairInstruction: record.repairInstruction.trim(),
    });
  }
  return Object.freeze(findings.slice(0, 6));
};

const parseAdversarialCriticResponse = (
  content: unknown,
): {
  readonly findings: readonly AdversarialCriticFinding[];
  readonly errorClass?: "schema_validation";
} => {
  try {
    return { findings: validateAdversarialCriticResponse(content) };
  } catch {
    return {
      findings: Object.freeze([] as AdversarialCriticFinding[]),
      errorClass: "schema_validation",
    };
  }
};

export const runAdversarialCriticRound = async (
  input: RunAdversarialCriticRoundInput,
): Promise<RunAdversarialCriticRoundResult> => {
  const prompt = buildPrompt(input);
  const startedAt = Date.now();
  const gatewayResult = await generateWithLocalWallClockGuard({
    client: input.client,
    operationLabel: "adversarial critic gateway request",
    request: {
      jobId: input.jobId,
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      responseSchema: buildResponseSchema(),
      responseSchemaName: ADVERSARIAL_CRITIC_RESPONSE_SCHEMA_NAME,
      ...(input.maxInputTokens !== undefined
        ? { maxInputTokens: input.maxInputTokens }
        : {}),
      ...(input.maxOutputTokens !== undefined
        ? { maxOutputTokens: input.maxOutputTokens }
        : {}),
      ...(input.maxWallClockMs !== undefined
        ? { maxWallClockMs: input.maxWallClockMs }
        : {}),
      ...(input.maxRetries !== undefined
        ? { maxRetries: input.maxRetries }
        : {}),
      ...(input.abortSignal !== undefined
        ? { abortSignal: input.abortSignal }
        : {}),
    },
    ...(input.maxWallClockMs !== undefined
      ? { defaultWallClockMs: input.maxWallClockMs }
      : {}),
  });
  const durationMs = Date.now() - startedAt;
  const parsedResponse =
    gatewayResult.outcome === "success"
      ? parseAdversarialCriticResponse(gatewayResult.content)
      : { findings: Object.freeze([] as AdversarialCriticFinding[]) };
  const findings = parsedResponse.findings;
  const artifact: AdversarialCriticRoundArtifact = {
    schemaVersion: ADVERSARIAL_CRITIC_FINDING_SCHEMA_VERSION,
    jobId: input.jobId,
    round: input.round,
    domain: input.domain,
    playbookEntryIds: prompt.playbook.map((entry) => entry.id),
    inputs: {
      generatedListHash: sha256Hex(input.generatedList),
      coveragePlanHash: sha256Hex(input.coveragePlan),
      riskRankingHash: sha256Hex(input.riskRanking),
      intentHash: sha256Hex(input.intent),
      ...(input.logicVerdict !== undefined
        ? { logicVerdictHash: sha256Hex(input.logicVerdict) }
        : {}),
      ...(input.faithfulnessVerdict !== undefined
        ? {
            faithfulnessVerdictHash: sha256Hex(input.faithfulnessVerdict),
          }
        : {}),
    },
    outputs: {
      findingCount: findings.length,
      dedupeKeys: findings.map(computeAdversarialFindingDedupeKey),
      findings,
    },
    llmGateway: {
      outcome:
        gatewayResult.outcome === "error" ||
        parsedResponse.errorClass !== undefined
          ? "error"
          : "success",
      ...(gatewayResult.outcome === "error"
        ? { errorClass: gatewayResult.errorClass, modelDeployment: "unknown" }
        : parsedResponse.errorClass !== undefined
          ? {
              errorClass: parsedResponse.errorClass,
              modelDeployment: gatewayResult.modelDeployment,
            }
          : { modelDeployment: gatewayResult.modelDeployment }),
      inputTokens:
        gatewayResult.outcome === "success"
          ? gatewayResult.usage.inputTokens ?? 0
          : 0,
      outputTokens:
        gatewayResult.outcome === "success"
          ? gatewayResult.usage.outputTokens ?? 0
          : 0,
      durationMs,
    },
  };
  return { artifact, gatewayResult, findings };
};

export const writeAdversarialCriticRoundArtifact = async (input: {
  readonly runDir: string;
  readonly artifact: AdversarialCriticRoundArtifact;
}): Promise<{ artifactPath: string }> => {
  const artifactPath = join(
    input.runDir,
    "agent-role-runs",
    `${ADVERSARIAL_CRITIC_ROUND_ARTIFACT_PREFIX}${input.artifact.round}.json`,
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.artifact)}\n`, "utf8");
  await rename(tempPath, artifactPath);
  return { artifactPath };
};

export const writeAdversarialCriticTraceArtifact = async (input: {
  readonly runDir: string;
  readonly artifact: AdversarialCriticTraceArtifact;
}): Promise<{ artifactPath: string }> => {
  const artifactPath = join(
    input.runDir,
    ADVERSARIAL_CRITIC_TRACE_ARTIFACT_FILENAME,
  );
  await mkdir(dirname(artifactPath), { recursive: true });
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${canonicalJson(input.artifact)}\n`, "utf8");
  await rename(tempPath, artifactPath);
  return { artifactPath };
};

export const computeNegativeCoverageAccounting = (input: {
  readonly baselineList: GeneratedTestCaseList;
  readonly finalList: GeneratedTestCaseList;
}): NegativeCoverageAccounting => {
  const baselineNegativeCaseCount = input.baselineList.testCases.filter(
    (testCase) => testCase.type === "negative",
  ).length;
  const finalNegativeCaseCount = input.finalList.testCases.filter(
    (testCase) => testCase.type === "negative",
  ).length;
  const baselineTotalCaseCount = input.baselineList.testCases.length;
  const finalTotalCaseCount = input.finalList.testCases.length;
  const baselineNegativeRatio =
    baselineTotalCaseCount === 0
      ? 0
      : round6(baselineNegativeCaseCount / baselineTotalCaseCount);
  const finalNegativeRatio =
    finalTotalCaseCount === 0
      ? 0
      : round6(finalNegativeCaseCount / finalTotalCaseCount);
  const relativeRatioIncrease =
    baselineNegativeRatio === 0
      ? finalNegativeRatio > 0
        ? 1
        : 0
      : round6(
          (finalNegativeRatio - baselineNegativeRatio) /
            baselineNegativeRatio,
        );
  return {
    baselineNegativeCaseCount,
    baselineTotalCaseCount,
    baselineNegativeRatio,
    finalNegativeCaseCount,
    finalTotalCaseCount,
    finalNegativeRatio,
    relativeRatioIncrease,
    meetsThreshold:
      relativeRatioIncrease >= ADVERSARIAL_NEGATIVE_RATIO_IMPROVEMENT_THRESHOLD,
  };
};
