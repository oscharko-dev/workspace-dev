import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  REDACTION_POLICY_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  VISUAL_SIDECAR_SCHEMA_VERSION,
  type GeneratedTestCase,
  type GeneratedTestCaseAuditMetadata,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import {
  BASELINE_ARCHETYPE_FIXTURE_IDS,
  type BaselineArchetypeFixtureId,
  loadBaselineArchetypeFixture,
} from "./baseline-fixtures.js";
import { DEFAULT_FINOPS_BUDGET_ENVELOPE } from "./finops-budget.js";
import {
  buildFinOpsBudgetReport,
  createFinOpsUsageRecorder,
} from "./finops-report.js";
import { deriveBusinessTestIntentIr } from "./intent-derivation.js";
import { synthesizeGeneratedTestCases } from "./poc-harness.js";
import { compilePrompt } from "./prompt-compiler.js";
import { buildTraceabilityMatrix } from "./traceability-matrix.js";
import { runValidationPipeline } from "./validation-pipeline.js";

const FIXTURES_DIR = join(new URL(".", import.meta.url).pathname, "fixtures");

const BASELINE_EVAL_SCHEMA_VERSION = "1.0.0" as const;
const BASELINE_EVAL_MODEL_REVISION = "baseline-eval-deterministic-mock" as const;
const BASELINE_EVAL_GATEWAY_RELEASE = "baseline-eval-1.0" as const;
const BASELINE_EVAL_POLICY_BUNDLE_VERSION =
  "baseline-eval-eu-banking-default" as const;
const BASELINE_EVAL_HUMAN_ACCEPTANCE_SAMPLE_SIZE = 5 as const;

const GENERIC_EXPECTED_RESULT_PATTERNS: ReadonlyArray<RegExp> = [
  /^the next screen is reachable$/u,
  /^the control performs its action$/u,
  /^field accepts the minimum boundary value$/u,
  /^field accepts the maximum boundary value$/u,
  /^inline validation error displayed$/u,
  /^an inline validation error is shown$/u,
  /^each validation rule is mapped to a clear message$/u,
  /^all controls reachable via keyboard$/u,
  /^each control announces a meaningful label$/u,
  /^submit is blocked until the rule is satisfied$/u,
];

export const BASELINE_EVAL_FIXTURE_GENERATED_AT =
  "2026-05-03T00:00:00.000Z" as const;

export interface BaselineEvalTraceabilityCaseCoverage {
  testCaseId: string;
  sourceRefCount: number;
  intentRefCount: number;
  visualRefCount: number;
}

export interface BaselineEvalTraceabilityCoverage {
  totalCases: number;
  casesWithSourceRefs: number;
  casesWithIntentRefs: number;
  casesWithVisualRefs: number;
  sourceRefPresenceRate: number;
  intentRefPresenceRate: number;
  visualRefPresenceRate: number;
  perCase: BaselineEvalTraceabilityCaseCoverage[];
}

export interface BaselineEvalHumanAcceptanceSnapshot {
  sampleSize: number;
  approvedCount: number;
  rate: number;
  sampledTestCaseIds: string[];
}

export interface BaselineArchetypeEvalMetrics {
  coveragePositiveCount: number;
  coverageNegativeCount: number;
  coverageBoundaryCount: number;
  duplicateRate: number;
  genericExpectedResultRate: number;
  unmarkedAssumptionRate: number;
  traceabilityCoverage: BaselineEvalTraceabilityCoverage;
  humanAcceptanceRateSnapshot: BaselineEvalHumanAcceptanceSnapshot;
  finOpsSpendMinorUnits: number;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export interface BaselineArchetypeEvalArtifact {
  schemaVersion: typeof BASELINE_EVAL_SCHEMA_VERSION;
  contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  generatedAt: string;
  archetypeId: BaselineArchetypeFixtureId;
  archetype: string;
  intent: string;
  metrics: BaselineArchetypeEvalMetrics;
  methodology: {
    deterministic: true;
    tokenAccounting: "estimated_utf8_bytes_div_4";
    latencySource: "mock_gateway_duration";
    spendSource: "currency_agnostic_estimated_cost_x100";
    humanAcceptanceSampleSize: number;
  };
}

export const baselineEvalFixtureFilename = (
  archetypeId: BaselineArchetypeFixtureId,
): string => `eval-baseline-${stripBaselinePrefix(archetypeId)}.json`;

export const baselineEvalFixturePath = (
  archetypeId: BaselineArchetypeFixtureId,
): string => join(FIXTURES_DIR, baselineEvalFixtureFilename(archetypeId));

export const buildBaselineArchetypeEvalArtifact = async (input: {
  archetypeId: BaselineArchetypeFixtureId;
  generatedAt?: string;
}): Promise<BaselineArchetypeEvalArtifact> => {
  const generatedAt = input.generatedAt ?? BASELINE_EVAL_FIXTURE_GENERATED_AT;
  const fixture = await loadBaselineArchetypeFixture(input.archetypeId);
  const jobId = `baseline-eval-${stripBaselinePrefix(input.archetypeId)}`;
  const intent = deriveBusinessTestIntentIr({ figma: fixture.figma });
  const compiled = compilePrompt({
    jobId,
    intent,
    modelBinding: {
      modelRevision: BASELINE_EVAL_MODEL_REVISION,
      gatewayRelease: BASELINE_EVAL_GATEWAY_RELEASE,
    },
    policyBundleVersion: BASELINE_EVAL_POLICY_BUNDLE_VERSION,
    visualBinding: {
      schemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
      selectedDeployment: "mock",
      fallbackReason: "none",
      screenCount: 0,
    },
  });
  const audit = buildAuditMetadata({
    jobId,
    generatedAt,
    cacheKeyDigest: compiled.request.hashes.cacheKey,
    inputHash: compiled.request.hashes.inputHash,
    promptHash: compiled.request.hashes.promptHash,
    schemaHash: compiled.request.hashes.schemaHash,
  });
  const generatedList = synthesizeGeneratedTestCases({
    jobId,
    generatedAt,
    intent,
    audit,
  });
  const validation = runValidationPipeline({
    jobId,
    generatedAt,
    list: generatedList,
    intent,
  });
  const traceability = buildTraceabilityMatrix({
    jobId,
    generatedAt,
    intent,
    list: validation.generatedTestCases,
    validation: validation.validation,
    policy: validation.policy,
  });

  const tokensIn = estimateTokens([
    compiled.request.systemPrompt,
    compiled.request.userPrompt,
    compiled.request.responseSchema,
  ]);
  const tokensOut = estimateTokens([validation.generatedTestCases]);
  const finopsRecorder = createFinOpsUsageRecorder();
  finopsRecorder.recordAttempt({
    role: "test_generation",
    deployment: BASELINE_EVAL_MODEL_REVISION,
    durationMs: 0,
    result: {
      outcome: "success",
      content: validation.generatedTestCases,
      finishReason: "stop",
      usage: { inputTokens: tokensIn, outputTokens: tokensOut },
      modelDeployment: BASELINE_EVAL_MODEL_REVISION,
      modelRevision: BASELINE_EVAL_MODEL_REVISION,
      gatewayRelease: BASELINE_EVAL_GATEWAY_RELEASE,
      attempt: 1,
    },
  });
  const finopsReport = buildFinOpsBudgetReport({
    jobId,
    generatedAt,
    budget: DEFAULT_FINOPS_BUDGET_ENVELOPE,
    recorder: finopsRecorder,
  });

  return {
    schemaVersion: BASELINE_EVAL_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    generatedAt,
    archetypeId: input.archetypeId,
    archetype: fixture.summary.archetype,
    intent: fixture.summary.intent,
    metrics: {
      coveragePositiveCount: validation.coverage.positiveCaseCount,
      coverageNegativeCount: validation.coverage.negativeCaseCount,
      coverageBoundaryCount: validation.coverage.boundaryCaseCount,
      duplicateRate: computeDuplicateRate(
        validation.generatedTestCases.testCases,
        validation.coverage.duplicatePairs.length,
      ),
      genericExpectedResultRate: computeGenericExpectedResultRate(
        validation.generatedTestCases.testCases,
      ),
      unmarkedAssumptionRate: computeUnmarkedAssumptionRate(
        validation.generatedTestCases.testCases,
        traceability,
      ),
      traceabilityCoverage: buildTraceabilityCoverage(
        validation.generatedTestCases.testCases,
        traceability,
      ),
      humanAcceptanceRateSnapshot: buildHumanAcceptanceSnapshot(
        validation.generatedTestCases.testCases,
        validation.policy.decisions,
      ),
      finOpsSpendMinorUnits: Math.round(finopsReport.totals.estimatedCost * 100),
      latencyMs: finopsReport.totals.durationMs,
      tokensIn: finopsReport.totals.inputTokens,
      tokensOut: finopsReport.totals.outputTokens,
    },
    methodology: {
      deterministic: true,
      tokenAccounting: "estimated_utf8_bytes_div_4",
      latencySource: "mock_gateway_duration",
      spendSource: "currency_agnostic_estimated_cost_x100",
      humanAcceptanceSampleSize: BASELINE_EVAL_HUMAN_ACCEPTANCE_SAMPLE_SIZE,
    },
  };
};

export const readBaselineArchetypeEvalArtifact = async (
  archetypeId: BaselineArchetypeFixtureId,
): Promise<BaselineArchetypeEvalArtifact> => {
  const raw = await readFile(baselineEvalFixturePath(archetypeId), "utf8");
  return JSON.parse(raw) as BaselineArchetypeEvalArtifact;
};

export const buildAllBaselineArchetypeEvalArtifacts = async (input?: {
  generatedAt?: string;
}): Promise<ReadonlyArray<BaselineArchetypeEvalArtifact>> => {
  return Promise.all(
    BASELINE_ARCHETYPE_FIXTURE_IDS.map((archetypeId) =>
      buildBaselineArchetypeEvalArtifact({
        archetypeId,
        ...(input?.generatedAt !== undefined
          ? { generatedAt: input.generatedAt }
          : {}),
      }),
    ),
  );
};

export const writeBaselineArchetypeEvalArtifact = async (input: {
  artifact: BaselineArchetypeEvalArtifact;
  outputPath?: string;
}): Promise<string> => {
  const outputPath =
    input.outputPath ?? baselineEvalFixturePath(input.artifact.archetypeId);
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(input.artifact), "utf8");
  await rename(tempPath, outputPath);
  return outputPath;
};

export const writeAllBaselineArchetypeEvalArtifacts = async (input?: {
  generatedAt?: string;
}): Promise<ReadonlyArray<string>> => {
  const artifacts = await buildAllBaselineArchetypeEvalArtifacts(input);
  return Promise.all(
    artifacts.map((artifact) => writeBaselineArchetypeEvalArtifact({ artifact })),
  );
};

const buildAuditMetadata = (input: {
  jobId: string;
  generatedAt: string;
  cacheKeyDigest: string;
  inputHash: string;
  promptHash: string;
  schemaHash: string;
}): GeneratedTestCaseAuditMetadata => ({
  jobId: input.jobId,
  generatedAt: input.generatedAt,
  contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
  schemaVersion: GENERATED_TEST_CASE_SCHEMA_VERSION,
  promptTemplateVersion: TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
  redactionPolicyVersion: REDACTION_POLICY_VERSION,
  visualSidecarSchemaVersion: VISUAL_SIDECAR_SCHEMA_VERSION,
  cacheHit: false,
  cacheKey: input.cacheKeyDigest,
  inputHash: input.inputHash,
  promptHash: input.promptHash,
  schemaHash: input.schemaHash,
});

const computeDuplicateRate = (
  testCases: ReadonlyArray<GeneratedTestCase>,
  duplicatePairCount: number,
): number => {
  const totalCases = testCases.length;
  if (totalCases < 2) return 0;
  const pairCount = (totalCases * (totalCases - 1)) / 2;
  return roundTo(duplicatePairCount / pairCount);
};

const computeGenericExpectedResultRate = (
  testCases: ReadonlyArray<GeneratedTestCase>,
): number => {
  const expectedResults = testCases.flatMap((testCase) => testCase.expectedResults);
  if (expectedResults.length === 0) return 0;
  const genericCount = expectedResults.filter((value) =>
    isGenericExpectedResult(value),
  ).length;
  return roundTo(genericCount / expectedResults.length);
};

const isGenericExpectedResult = (value: string): boolean => {
  const normalized = normalizeText(value);
  return GENERIC_EXPECTED_RESULT_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
};

const computeUnmarkedAssumptionRate = (
  testCases: ReadonlyArray<GeneratedTestCase>,
  traceability: ReturnType<typeof buildTraceabilityMatrix>,
): number => {
  const ambiguousRows = traceability.rows.filter((row) =>
    row.reconciliationDecisions.some((decision) => decision.ambiguity !== undefined),
  );
  if (ambiguousRows.length === 0) return 0;
  const casesById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  const unmarked = ambiguousRows.filter((row) => {
    const testCase = casesById.get(row.testCaseId);
    return (
      testCase !== undefined &&
      testCase.assumptions.length === 0 &&
      testCase.openQuestions.length === 0
    );
  }).length;
  return roundTo(unmarked / ambiguousRows.length);
};

const buildTraceabilityCoverage = (
  testCases: ReadonlyArray<GeneratedTestCase>,
  traceability: ReturnType<typeof buildTraceabilityMatrix>,
): BaselineEvalTraceabilityCoverage => {
  const testCasesById = new Map(testCases.map((testCase) => [testCase.id, testCase]));
  const perCase = traceability.rows
    .map((row) => {
      const testCase = testCasesById.get(row.testCaseId);
      const sourceRefCount = testCase?.figmaTraceRefs.length ?? 0;
      const intentRefCount =
        row.intentFieldIds.length +
        row.intentActionIds.length +
        row.intentValidationIds.length +
        row.intentNavigationIds.length;
      const visualRefCount = row.visualObservations.length;
      return {
        testCaseId: row.testCaseId,
        sourceRefCount,
        intentRefCount,
        visualRefCount,
      };
    })
    .sort((a, b) =>
      a.testCaseId < b.testCaseId ? -1 : a.testCaseId > b.testCaseId ? 1 : 0,
    );
  const totalCases = perCase.length;
  const casesWithSourceRefs = perCase.filter((row) => row.sourceRefCount > 0).length;
  const casesWithIntentRefs = perCase.filter((row) => row.intentRefCount > 0).length;
  const casesWithVisualRefs = perCase.filter((row) => row.visualRefCount > 0).length;
  return {
    totalCases,
    casesWithSourceRefs,
    casesWithIntentRefs,
    casesWithVisualRefs,
    sourceRefPresenceRate: totalCases === 0 ? 0 : roundTo(casesWithSourceRefs / totalCases),
    intentRefPresenceRate: totalCases === 0 ? 0 : roundTo(casesWithIntentRefs / totalCases),
    visualRefPresenceRate: totalCases === 0 ? 0 : roundTo(casesWithVisualRefs / totalCases),
    perCase,
  };
};

const buildHumanAcceptanceSnapshot = (
  testCases: ReadonlyArray<GeneratedTestCase>,
  decisions: ReadonlyArray<{ testCaseId: string; decision: string }>,
): BaselineEvalHumanAcceptanceSnapshot => {
  const sampledTestCaseIds = testCases
    .slice(0, BASELINE_EVAL_HUMAN_ACCEPTANCE_SAMPLE_SIZE)
    .map((testCase) => testCase.id);
  const decisionById = new Map(
    decisions.map((decision) => [decision.testCaseId, decision.decision]),
  );
  const approvedCount = sampledTestCaseIds.filter(
    (testCaseId) => decisionById.get(testCaseId) === "approved",
  ).length;
  return {
    sampleSize: sampledTestCaseIds.length,
    approvedCount,
    rate:
      sampledTestCaseIds.length === 0
        ? 0
        : roundTo(approvedCount / sampledTestCaseIds.length),
    sampledTestCaseIds,
  };
};

const estimateTokens = (values: ReadonlyArray<unknown>): number => {
  const encoder = new TextEncoder();
  const totalBytes = values.reduce<number>((sum, value) => {
    if (typeof value === "string") {
      return sum + encoder.encode(value).byteLength;
    }
    return sum + encoder.encode(JSON.stringify(value)).byteLength;
  }, 0);
  return Math.ceil(totalBytes / 4);
};

const stripBaselinePrefix = (archetypeId: BaselineArchetypeFixtureId): string =>
  archetypeId.replace(/^baseline-/u, "");

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const roundTo = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
