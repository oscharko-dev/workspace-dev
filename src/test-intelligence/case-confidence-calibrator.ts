import { readdir, readFile, stat, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, basename, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import {
  JUDGE_CONSENSUS_ARTIFACT_FILENAME,
  SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME,
  TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME,
  FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME,
  GENERATED_TESTCASES_ARTIFACT_FILENAME,
  TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME,
  type FaithfulnessTierReport,
  type GeneratedTestCase,
  type GeneratedTestCaseConfidenceComponents,
  type GeneratedTestCaseList,
  type JudgeConsensusVerdict,
  type SelfConsistencyReport,
  type TestCasePolicyDecision,
  type TestCaseRiskCategory,
} from "../contracts/index.js";
import type {
  TestDataOracleReport,
} from "./test-data-oracle-governance.js";
import { canonicalJson } from "./content-hash.js";
import {
  buildReliabilityDiagram,
  CALIBRATION_ECE_THRESHOLDS,
  CALIBRATION_MIN_SAMPLE_FLOOR,
  CALIBRATION_RISK_CATEGORIES,
  computeBrierScore,
  type ReliabilityDiagramBin,
} from "./calibration-metrics.js";

export const CASE_CONFIDENCE_CURVE_SCHEMA_VERSION = "1.0.0" as const;
export const CASE_CONFIDENCE_CURVE_ARTIFACT_FILENAME =
  "case-confidence-curve.json" as const;
export const CASE_CONFIDENCE_LABEL_MANIFEST_FILENAME =
  "case-confidence-labels.json" as const;
export const CASE_CONFIDENCE_RELIABILITY_DIAGRAM_SCHEMA_VERSION =
  "1.0.0" as const;

export type CaseConfidenceReviewLabel = "accepted" | "needs_review";
export type CaseConfidenceCalibrationSource =
  | "manual_labels"
  | "historical_policy_fallback"
  | "default_fallback";
export type CaseConfidenceCalibrationEvaluationSplit =
  | "held_out"
  | "all_samples_fallback";

export interface CaseConfidenceCurveArtifact {
  readonly schemaVersion: typeof CASE_CONFIDENCE_CURVE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly datasetId: string;
  readonly calibrationSource: CaseConfidenceCalibrationSource;
  readonly sampleCount: number;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly intercept: number;
  readonly slope: number;
  readonly trainingBrierScore: number;
  readonly heldOutSampleCount: number;
  readonly heldOutBrierScore?: number;
  readonly calibrationEvaluationSplit: CaseConfidenceCalibrationEvaluationSplit;
  readonly minimumRiskCategorySampleFloor: number;
  readonly heldOutSampleCountByRiskCategory: Readonly<
    Record<TestCaseRiskCategory, number>
  >;
  readonly eceByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
  readonly eceThresholdByRiskCategory: Readonly<
    Record<TestCaseRiskCategory, number>
  >;
}

export type CalibrationReport = CaseConfidenceCurveArtifact;

export interface CaseConfidenceDistributionSummary {
  readonly confidenceMean: number;
  readonly confidenceP10: number;
  readonly confidenceP50: number;
  readonly confidenceP90: number;
}

interface HistoricalAcceptedAnchor {
  readonly runId: string;
  readonly testCaseId: string;
  readonly tokenFingerprint: readonly string[];
  readonly screenIds: readonly string[];
  readonly coveredFieldIds: readonly string[];
}

interface HistoricalRunSnapshot {
  readonly runId: string;
  readonly list: GeneratedTestCaseList;
  readonly policy: ReadonlyMap<string, TestCasePolicyDecision>;
  readonly judgeConsensus: JudgeConsensusVerdict;
  readonly faithfulnessTierReport?: FaithfulnessTierReport;
  readonly selfConsistencyReport?: SelfConsistencyReport;
  readonly oracleReport?: TestDataOracleReport;
}

interface HistoricalCalibrationSample {
  readonly runId: string;
  readonly testCaseId: string;
  readonly riskCategory: TestCaseRiskCategory;
  readonly rawScore: number;
  readonly label: 0 | 1;
}

export interface CaseConfidenceReliabilityDiagramArtifact {
  readonly schemaVersion: typeof CASE_CONFIDENCE_RELIABILITY_DIAGRAM_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly datasetId: string;
  readonly riskCategory: TestCaseRiskCategory;
  readonly evaluationSplit: CaseConfidenceCalibrationEvaluationSplit;
  readonly minimumSampleFloor: number;
  readonly threshold: number;
  readonly sampleCount: number;
  readonly pluginEce: number;
  readonly debiasedEce: number;
  readonly bins: ReadonlyArray<ReliabilityDiagramBin>;
}

interface LabelManifest {
  readonly labels: ReadonlyMap<string, CaseConfidenceReviewLabel>;
  readonly source: Extract<CaseConfidenceCalibrationSource, "manual_labels">;
}

export interface LoadCaseConfidenceCalibrationInput {
  readonly datasetRoot: string;
  readonly generatedAt: string;
  readonly currentRunId?: string;
}

export interface LoadedCaseConfidenceCalibration {
  readonly curve: CaseConfidenceCurveArtifact;
  readonly acceptedAnchors: readonly HistoricalAcceptedAnchor[];
  readonly artifactPath: string;
  readonly reliabilityArtifactPaths: Readonly<
    Record<TestCaseRiskCategory, string>
  >;
}

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-value));

const defaultCurve = (input: {
  datasetId: string;
  generatedAt: string;
}): CaseConfidenceCurveArtifact => ({
  schemaVersion: CASE_CONFIDENCE_CURVE_SCHEMA_VERSION,
  generatedAt: input.generatedAt,
  datasetId: input.datasetId,
  calibrationSource: "default_fallback",
  sampleCount: 0,
  positiveCount: 0,
  negativeCount: 0,
  intercept: -2.25,
  slope: 5.5,
  trainingBrierScore: round6(0.0625),
  heldOutSampleCount: 0,
  calibrationEvaluationSplit: "all_samples_fallback",
  minimumRiskCategorySampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
  heldOutSampleCountByRiskCategory: Object.fromEntries(
    CALIBRATION_RISK_CATEGORIES.map((riskCategory) => [riskCategory, 0]),
  ) as Record<TestCaseRiskCategory, number>,
  eceByRiskCategory: Object.fromEntries(
    CALIBRATION_RISK_CATEGORIES.map((riskCategory) => [riskCategory, 0]),
  ) as Record<TestCaseRiskCategory, number>,
  eceThresholdByRiskCategory: CALIBRATION_ECE_THRESHOLDS,
});

const caseKey = (runId: string, testCaseId: string): string =>
  `${runId}::${testCaseId}`;

const normalizeTextTokens = (value: string): readonly string[] => {
  const normalized = value
    .toLowerCase()
    .replace(/\btc[\s_-]*\d+\b/gu, " ")
    .replace(/[^a-z0-9äöüß]+/gu, " ")
    .trim();
  if (normalized.length === 0) return [];
  const unique = new Set<string>();
  for (const token of normalized.split(/\s+/u)) {
    if (token.length < 3) continue;
    unique.add(token);
  }
  return [...unique].sort((left, right) => left.localeCompare(right));
};

const jaccardSimilarity = (
  left: readonly string[],
  right: readonly string[],
): number => {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : round6(intersection / union);
};

const overlapRatio = (
  left: readonly string[],
  right: readonly string[],
): number => {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  let overlap = 0;
  for (const value of left) {
    if (rightSet.has(value)) overlap += 1;
  }
  return round6(overlap / Math.max(left.length, right.length));
};

const buildAnchorForCase = (testCase: GeneratedTestCase, runId: string): HistoricalAcceptedAnchor => ({
  runId,
  testCaseId: testCase.id,
  tokenFingerprint: normalizeTextTokens(
    `${testCase.title} ${testCase.objective} ${testCase.expectedResults.join(" ")}`,
  ),
  screenIds: [...new Set(testCase.figmaTraceRefs.map((ref) => ref.screenId))].sort(
    (left, right) => left.localeCompare(right),
  ),
  coveredFieldIds: [...new Set(testCase.qualitySignals.coveredFieldIds)].sort(
    (left, right) => left.localeCompare(right),
  ),
});

const deriveFaithfulnessScore = (
  testCaseId: string,
  report: FaithfulnessTierReport | undefined,
): number => {
  if (report === undefined) return 1;
  const scores = report.entries
    .filter((entry) => entry.testCaseId === testCaseId)
    .map((entry) => entry.score);
  if (scores.length === 0) return clamp01(report.aggregateScore);
  return clamp01(
    round6(scores.reduce((sum, value) => sum + value, 0) / scores.length),
  );
};

const deriveSelfConsistencyAgreement = (
  testCaseId: string,
  report: SelfConsistencyReport | undefined,
): number => {
  if (report === undefined) return 1;
  const direct = report.targets.find(
    (target) => target.selectedTestCaseId === testCaseId,
  );
  if (direct !== undefined) {
    return clamp01(direct.agreement);
  }
  return clamp01(report.selfConsistencyAgreement);
};

const deriveOracleResolved = (
  testCaseId: string,
  report: TestDataOracleReport | undefined,
): boolean => {
  if (report === undefined) return false;
  const projection = report.cases.find((entry) => entry.testCaseId === testCaseId);
  if (projection === undefined) return false;
  return (
    projection.oracleResolvedFields.length > 0 ||
    projection.authoritativeTestData.length > 0
  );
};

const deriveJudgePanelAgreement = (
  testCaseId: string,
  consensus: JudgeConsensusVerdict,
): number => {
  const findingCount = consensus.activeFindings.filter(
    (finding) => finding.testCaseId === testCaseId,
  ).length;
  const repairInstructionCount = consensus.repairInstructions.filter(
    (instruction) => instruction.testCaseId === testCaseId,
  ).length;
  const verdictBase =
    consensus.crossFamily !== undefined
      ? 1 - consensus.crossFamily.disagreementRate
      : consensus.verdict === "accept"
        ? 0.92
        : consensus.verdict === "repair"
          ? 0.7
          : 0.4;
  const reviewPenalty =
    consensus.humanReview !== undefined && findingCount > 0 ? 0.12 : 0;
  const score =
    verdictBase -
    findingCount * 0.14 -
    repairInstructionCount * 0.08 -
    reviewPenalty;
  return clamp01(round6(score));
};

const deriveRagHitStrength = (
  testCase: GeneratedTestCase,
  acceptedAnchors: readonly HistoricalAcceptedAnchor[],
  excludedRunId?: string,
): number => {
  if (acceptedAnchors.length === 0) return 0;
  const currentTokens = normalizeTextTokens(
    `${testCase.title} ${testCase.objective} ${testCase.expectedResults.join(" ")}`,
  );
  const currentScreens = [...new Set(testCase.figmaTraceRefs.map((ref) => ref.screenId))];
  const currentFields = [...new Set(testCase.qualitySignals.coveredFieldIds)];
  let strongest = 0;
  for (const anchor of acceptedAnchors) {
    if (excludedRunId !== undefined && anchor.runId === excludedRunId) continue;
    const tokenScore = jaccardSimilarity(currentTokens, anchor.tokenFingerprint);
    const screenScore = overlapRatio(currentScreens, anchor.screenIds);
    const fieldScore = overlapRatio(currentFields, anchor.coveredFieldIds);
    const score = Math.max(
      tokenScore >= 0.7 && (screenScore > 0 || fieldScore > 0)
        ? 1
        : 0,
      tokenScore >= 0.55 ? 0.8 : 0,
      fieldScore >= 0.5 ? 0.7 : 0,
      screenScore > 0 ? 0.6 : 0,
    );
    if (score > strongest) {
      strongest = score;
    }
  }
  return clamp01(round6(strongest));
};

export const buildGeneratedTestCaseConfidenceComponents = (input: {
  readonly testCase: GeneratedTestCase;
  readonly judgeConsensus: JudgeConsensusVerdict;
  readonly faithfulnessTierReport?: FaithfulnessTierReport;
  readonly selfConsistencyReport?: SelfConsistencyReport;
  readonly oracleReport?: TestDataOracleReport;
  readonly acceptedAnchors?: readonly HistoricalAcceptedAnchor[];
  readonly excludedRunId?: string;
}): GeneratedTestCaseConfidenceComponents => {
  const judgePanelAgreement = deriveJudgePanelAgreement(
    input.testCase.id,
    input.judgeConsensus,
  );
  const faithfulnessScore = deriveFaithfulnessScore(
    input.testCase.id,
    input.faithfulnessTierReport,
  );
  const selfConsistencyAgreement = deriveSelfConsistencyAgreement(
    input.testCase.id,
    input.selfConsistencyReport,
  );
  const ragHitStrength = deriveRagHitStrength(
    input.testCase,
    input.acceptedAnchors ?? [],
    input.excludedRunId,
  );
  const oracleResolved = deriveOracleResolved(
    input.testCase.id,
    input.oracleReport,
  );
  const rawScore = clamp01(
    round6(
      judgePanelAgreement * 0.34 +
        faithfulnessScore * 0.24 +
        selfConsistencyAgreement * 0.2 +
        ragHitStrength * 0.14 +
        (oracleResolved ? 0.08 : 0),
    ),
  );
  return {
    judgePanelAgreement,
    faithfulnessScore,
    selfConsistencyAgreement,
    ragHitStrength,
    oracleResolved,
    rawScore,
  };
};

const applyCurve = (
  rawScore: number,
  curve: Pick<CaseConfidenceCurveArtifact, "intercept" | "slope">,
): number => clamp01(round6(sigmoid(curve.intercept + curve.slope * rawScore)));

const calibrateSamples = (
  samples: readonly HistoricalCalibrationSample[],
  curve: Pick<CaseConfidenceCurveArtifact, "intercept" | "slope">,
): ReadonlyArray<{
  riskCategory: TestCaseRiskCategory;
  confidence: number;
  label: 0 | 1;
}> =>
  samples.map((sample) => ({
    riskCategory: sample.riskCategory,
    confidence: applyCurve(sample.rawScore, curve),
    label: sample.label,
  }));

const splitCalibrationSamples = (
  samples: readonly HistoricalCalibrationSample[],
): {
  readonly sorted: readonly HistoricalCalibrationSample[];
  readonly heldOut: readonly HistoricalCalibrationSample[];
  readonly training: readonly HistoricalCalibrationSample[];
} => {
  const sorted = [...samples].sort((left, right) =>
    caseKey(left.runId, left.testCaseId).localeCompare(
      caseKey(right.runId, right.testCaseId),
    ),
  );
  const heldOut =
    sorted.length >= 10 ? sorted.filter((_sample, index) => index % 5 === 0) : [];
  const training =
    heldOut.length > 0
      ? sorted.filter((_sample, index) => index % 5 !== 0)
      : sorted;
  return { sorted, heldOut, training };
};

const byRiskCategoryRecord = <T>(
  buildValue: (riskCategory: TestCaseRiskCategory) => T,
): Record<TestCaseRiskCategory, T> =>
  Object.fromEntries(
    CALIBRATION_RISK_CATEGORIES.map((riskCategory) => [
      riskCategory,
      buildValue(riskCategory),
    ]),
  ) as Record<TestCaseRiskCategory, T>;

const buildReliabilityArtifacts = (input: {
  datasetId: string;
  generatedAt: string;
  evaluationSplit: CaseConfidenceCalibrationEvaluationSplit;
  evaluationSamples: ReadonlyArray<{
    riskCategory: TestCaseRiskCategory;
    confidence: number;
    label: 0 | 1;
  }>;
}): {
  readonly eceByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
  readonly sampleCountByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
  readonly diagrams: ReadonlyArray<CaseConfidenceReliabilityDiagramArtifact>;
} => {
  const diagrams = CALIBRATION_RISK_CATEGORIES.map((riskCategory) => {
    const samples = input.evaluationSamples
      .filter((sample) => sample.riskCategory === riskCategory)
      .map((sample) => ({
        confidence: sample.confidence,
        label: sample.label,
      }));
    const reliability = buildReliabilityDiagram(samples);
    return {
      schemaVersion: CASE_CONFIDENCE_RELIABILITY_DIAGRAM_SCHEMA_VERSION,
      generatedAt: input.generatedAt,
      datasetId: input.datasetId,
      riskCategory,
      evaluationSplit: input.evaluationSplit,
      minimumSampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
      threshold: CALIBRATION_ECE_THRESHOLDS[riskCategory],
      sampleCount: reliability.sampleCount,
      pluginEce: reliability.pluginEce,
      debiasedEce: reliability.debiasedEce,
      bins: reliability.bins,
    };
  });
  return {
    eceByRiskCategory: byRiskCategoryRecord(
      (riskCategory) =>
        diagrams.find((diagram) => diagram.riskCategory === riskCategory)
          ?.debiasedEce ?? 0,
    ),
    sampleCountByRiskCategory: byRiskCategoryRecord(
      (riskCategory) =>
        diagrams.find((diagram) => diagram.riskCategory === riskCategory)
          ?.sampleCount ?? 0,
    ),
    diagrams,
  };
};

const fitPlattCurve = (input: {
  readonly datasetId: string;
  readonly generatedAt: string;
  readonly source: Extract<
    CaseConfidenceCalibrationSource,
    "manual_labels" | "historical_policy_fallback"
  >;
  readonly samples: readonly HistoricalCalibrationSample[];
}): CaseConfidenceCurveArtifact => {
  const { sorted, heldOut, training } = splitCalibrationSamples(input.samples);
  const trainingPositives = training.filter((sample) => sample.label === 1).length;
  const trainingNegatives = training.length - trainingPositives;
  if (trainingPositives === 0 || trainingNegatives === 0) {
    return {
      ...defaultCurve({
        datasetId: input.datasetId,
        generatedAt: input.generatedAt,
      }),
      calibrationSource: input.source,
      sampleCount: sorted.length,
      positiveCount: sorted.filter((sample) => sample.label === 1).length,
      negativeCount: sorted.filter((sample) => sample.label === 0).length,
    };
  }

  let intercept = -2;
  let slope = 4;
  const learningRate = 0.35;
  for (let iteration = 0; iteration < 600; iteration += 1) {
    let interceptGradient = 0;
    let slopeGradient = 0;
    for (const sample of training) {
      const probability = sigmoid(intercept + slope * sample.rawScore);
      const delta = probability - sample.label;
      interceptGradient += delta;
      slopeGradient += delta * sample.rawScore;
    }
    intercept -= (learningRate * interceptGradient) / training.length;
    slope -= (learningRate * slopeGradient) / training.length;
  }

  const curve = {
    intercept: round6(intercept),
    slope: round6(slope),
  };
  const evaluationSplit = heldOut.length > 0 ? "held_out" : "all_samples_fallback";
  const reliabilityArtifacts = buildReliabilityArtifacts({
    datasetId: input.datasetId,
    generatedAt: input.generatedAt,
    evaluationSplit,
    evaluationSamples: calibrateSamples(heldOut.length > 0 ? heldOut : sorted, curve),
  });
  return {
    schemaVersion: CASE_CONFIDENCE_CURVE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    datasetId: input.datasetId,
    calibrationSource: input.source,
    sampleCount: sorted.length,
    positiveCount: sorted.filter((sample) => sample.label === 1).length,
    negativeCount: sorted.filter((sample) => sample.label === 0).length,
    intercept: curve.intercept,
    slope: curve.slope,
    trainingBrierScore: computeBrierScore(calibrateSamples(training, curve)),
    heldOutSampleCount: heldOut.length,
    calibrationEvaluationSplit: evaluationSplit,
    minimumRiskCategorySampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
    heldOutSampleCountByRiskCategory: reliabilityArtifacts.sampleCountByRiskCategory,
    eceByRiskCategory: reliabilityArtifacts.eceByRiskCategory,
    eceThresholdByRiskCategory: CALIBRATION_ECE_THRESHOLDS,
    ...(heldOut.length > 0
      ? { heldOutBrierScore: computeBrierScore(calibrateSamples(heldOut, curve)) }
      : {}),
  };
};

const tryReadJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
};

const deriveRunIdFromDir = (runDir: string): string => {
  const leaf = basename(runDir);
  return leaf === "_runner-output" ? basename(dirname(runDir)) : leaf;
};

const loadHistoricalRunSnapshot = async (
  runDir: string,
): Promise<HistoricalRunSnapshot | undefined> => {
  const list = await tryReadJson<GeneratedTestCaseList>(
    join(runDir, GENERATED_TESTCASES_ARTIFACT_FILENAME),
  );
  const policyReport = await tryReadJson<{
    decisions?: ReadonlyArray<{ testCaseId: string; decision: TestCasePolicyDecision }>;
  }>(join(runDir, TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME));
  const judgeConsensus = await tryReadJson<JudgeConsensusVerdict>(
    join(runDir, JUDGE_CONSENSUS_ARTIFACT_FILENAME),
  );
  if (list === undefined || policyReport === undefined || judgeConsensus === undefined) {
    return undefined;
  }
  const faithfulnessTierReport = await tryReadJson<FaithfulnessTierReport>(
    join(runDir, FAITHFULNESS_TIER_REPORT_ARTIFACT_FILENAME),
  );
  const selfConsistencyReport = await tryReadJson<SelfConsistencyReport>(
    join(runDir, SELF_CONSISTENCY_REPORT_ARTIFACT_FILENAME),
  );
  const oracleReport = await tryReadJson<TestDataOracleReport>(
    join(runDir, TEST_DATA_ORACLE_REPORT_ARTIFACT_FILENAME),
  );
  const policy = new Map<string, TestCasePolicyDecision>();
  for (const decision of policyReport.decisions ?? []) {
    policy.set(decision.testCaseId, decision.decision);
  }
  return {
    runId: deriveRunIdFromDir(runDir),
    list,
    policy,
    judgeConsensus,
    ...(faithfulnessTierReport !== undefined ? { faithfulnessTierReport } : {}),
    ...(selfConsistencyReport !== undefined ? { selfConsistencyReport } : {}),
    ...(oracleReport !== undefined ? { oracleReport } : {}),
  };
};

const listHistoricalRunDirs = async (datasetRoot: string): Promise<readonly string[]> => {
  const entries = await readdir(datasetRoot, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const direct = join(datasetRoot, entry.name);
    out.push(direct);
    out.push(join(direct, "_runner-output"));
  }
  return out;
};

const loadExplicitLabelManifest = async (
  datasetRoot: string,
): Promise<LabelManifest | undefined> => {
  const manifestPath = join(
    datasetRoot,
    "accepted-runs",
    CASE_CONFIDENCE_LABEL_MANIFEST_FILENAME,
  );
  const manifest = await tryReadJson<{
    labels?: ReadonlyArray<{
      runId?: string;
      testCaseId?: string;
      label?: CaseConfidenceReviewLabel;
    }>;
  }>(manifestPath);
  if (manifest?.labels === undefined) return undefined;
  const labels = new Map<string, CaseConfidenceReviewLabel>();
  for (const label of manifest.labels) {
    if (
      typeof label.runId !== "string" ||
      label.runId.length === 0 ||
      typeof label.testCaseId !== "string" ||
      label.testCaseId.length === 0 ||
      (label.label !== "accepted" && label.label !== "needs_review")
    ) {
      continue;
    }
    labels.set(caseKey(label.runId, label.testCaseId), label.label);
  }
  return { labels, source: "manual_labels" };
};

const buildAcceptedAnchors = (
  snapshots: readonly HistoricalRunSnapshot[],
  explicitLabels: LabelManifest | undefined,
): readonly HistoricalAcceptedAnchor[] => {
  const anchors: HistoricalAcceptedAnchor[] = [];
  for (const snapshot of snapshots) {
    for (const testCase of snapshot.list.testCases) {
      const label =
        explicitLabels?.labels.get(caseKey(snapshot.runId, testCase.id)) ??
        (snapshot.policy.get(testCase.id) === "approved"
          ? "accepted"
          : "needs_review");
      if (label !== "accepted") continue;
      anchors.push(buildAnchorForCase(testCase, snapshot.runId));
    }
  }
  return anchors;
};

const buildHistoricalCalibrationSamples = (input: {
  readonly snapshots: readonly HistoricalRunSnapshot[];
  readonly explicitLabels?: LabelManifest;
  readonly acceptedAnchors: readonly HistoricalAcceptedAnchor[];
}): readonly HistoricalCalibrationSample[] => {
  const out: HistoricalCalibrationSample[] = [];
  for (const snapshot of input.snapshots) {
    for (const testCase of snapshot.list.testCases) {
      const label =
        input.explicitLabels?.labels.get(caseKey(snapshot.runId, testCase.id)) ??
        (snapshot.policy.get(testCase.id) === "approved"
          ? "accepted"
          : "needs_review");
      const components = buildGeneratedTestCaseConfidenceComponents({
        testCase,
        judgeConsensus: snapshot.judgeConsensus,
        acceptedAnchors: input.acceptedAnchors,
        excludedRunId: snapshot.runId,
        ...(snapshot.faithfulnessTierReport !== undefined
          ? { faithfulnessTierReport: snapshot.faithfulnessTierReport }
          : {}),
        ...(snapshot.selfConsistencyReport !== undefined
          ? { selfConsistencyReport: snapshot.selfConsistencyReport }
          : {}),
        ...(snapshot.oracleReport !== undefined
          ? { oracleReport: snapshot.oracleReport }
          : {}),
      });
      out.push({
        runId: snapshot.runId,
        testCaseId: testCase.id,
        riskCategory: testCase.riskCategory,
        rawScore: components.rawScore,
        label: label === "accepted" ? 1 : 0,
      });
    }
  }
  return out;
};

const writeCurveArtifact = async (
  datasetRoot: string,
  curve: CaseConfidenceCurveArtifact,
): Promise<string> => {
  const artifactPath = resolveCaseConfidenceCurveArtifactPath(datasetRoot);
  await mkdir(dirname(artifactPath), { recursive: true });
  const tmpPath = `${artifactPath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, `${canonicalJson(curve)}\n`, "utf8");
  await rename(tmpPath, artifactPath);
  return artifactPath;
};

const writeReliabilityDiagramArtifacts = async (
  datasetRoot: string,
  diagrams: readonly CaseConfidenceReliabilityDiagramArtifact[],
): Promise<Readonly<Record<TestCaseRiskCategory, string>>> => {
  const artifactDir = dirname(resolveCaseConfidenceCurveArtifactPath(datasetRoot));
  await mkdir(artifactDir, { recursive: true });
  const paths = {} as Record<TestCaseRiskCategory, string>;
  for (const diagram of diagrams) {
    const artifactPath = join(
      artifactDir,
      `case-confidence-reliability-${diagram.riskCategory}.json`,
    );
    const tmpPath = `${artifactPath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${canonicalJson(diagram)}\n`, "utf8");
    await rename(tmpPath, artifactPath);
    paths[diagram.riskCategory] = artifactPath;
  }
  return paths;
};

const resolveCaseConfidenceCurveArtifactPath = (datasetRoot: string): string => {
  const normalizedRoot = resolve(datasetRoot);
  const sandboxMarker = `${sep}sandbox${sep}test-case${sep}`;
  const sandboxIndex = normalizedRoot.lastIndexOf(sandboxMarker);
  if (sandboxIndex >= 0) {
    const workspaceRoot = normalizedRoot.slice(0, sandboxIndex);
    return join(
      workspaceRoot,
      "sandbox",
      "calibration",
      CASE_CONFIDENCE_CURVE_ARTIFACT_FILENAME,
    );
  }
  return join(
    normalizedRoot,
    ".calibration",
    CASE_CONFIDENCE_CURVE_ARTIFACT_FILENAME,
  );
};

export const loadCaseConfidenceCalibration = async (
  input: LoadCaseConfidenceCalibrationInput,
): Promise<LoadedCaseConfidenceCalibration> => {
  const datasetRoot = resolve(input.datasetRoot);
  const datasetId = basename(datasetRoot);
  const candidateRunDirs = await listHistoricalRunDirs(datasetRoot);
  const snapshots: HistoricalRunSnapshot[] = [];
  for (const runDir of candidateRunDirs) {
    if (deriveRunIdFromDir(runDir) === input.currentRunId) continue;
    const runStats = await stat(runDir).catch(() => undefined);
    if (runStats === undefined || !runStats.isDirectory()) continue;
    const snapshot = await loadHistoricalRunSnapshot(runDir);
    if (snapshot !== undefined) {
      snapshots.push(snapshot);
    }
  }
  const explicitLabels = await loadExplicitLabelManifest(datasetRoot);
  const acceptedAnchors = buildAcceptedAnchors(snapshots, explicitLabels);
  const samples = buildHistoricalCalibrationSamples({
    snapshots,
    acceptedAnchors,
    ...(explicitLabels !== undefined ? { explicitLabels } : {}),
  });
  const curve =
    samples.length === 0
      ? defaultCurve({ datasetId, generatedAt: input.generatedAt })
      : fitPlattCurve({
          datasetId,
          generatedAt: input.generatedAt,
          source: explicitLabels?.source ?? "historical_policy_fallback",
          samples,
        });
  const { sorted, heldOut } = splitCalibrationSamples(samples);
  const evaluationSplit = heldOut.length > 0 ? "held_out" : "all_samples_fallback";
  const reliabilityArtifacts = buildReliabilityArtifacts({
    datasetId,
    generatedAt: input.generatedAt,
    evaluationSplit,
    evaluationSamples: calibrateSamples(heldOut.length > 0 ? heldOut : sorted, curve),
  });
  const reliabilityArtifactPaths = await writeReliabilityDiagramArtifacts(
    datasetRoot,
    reliabilityArtifacts.diagrams,
  );
  const artifactPath = await writeCurveArtifact(datasetRoot, curve);
  return {
    curve,
    acceptedAnchors,
    artifactPath,
    reliabilityArtifactPaths,
  };
};

export const applyCaseConfidenceCalibration = (input: {
  readonly list: GeneratedTestCaseList;
  readonly curve: CaseConfidenceCurveArtifact;
  readonly judgeConsensus: JudgeConsensusVerdict;
  readonly faithfulnessTierReport?: FaithfulnessTierReport;
  readonly selfConsistencyReport?: SelfConsistencyReport;
  readonly oracleReport?: TestDataOracleReport;
  readonly acceptedAnchors?: readonly HistoricalAcceptedAnchor[];
  readonly excludedRunId?: string;
}): GeneratedTestCaseList => ({
  ...input.list,
  testCases: input.list.testCases.map((testCase) => {
    const confidenceComponents = buildGeneratedTestCaseConfidenceComponents({
      testCase,
      judgeConsensus: input.judgeConsensus,
      ...(input.faithfulnessTierReport !== undefined
        ? { faithfulnessTierReport: input.faithfulnessTierReport }
        : {}),
      ...(input.selfConsistencyReport !== undefined
        ? { selfConsistencyReport: input.selfConsistencyReport }
        : {}),
      ...(input.oracleReport !== undefined
        ? { oracleReport: input.oracleReport }
        : {}),
      ...(input.acceptedAnchors !== undefined
        ? { acceptedAnchors: input.acceptedAnchors }
        : {}),
      ...(input.excludedRunId !== undefined
        ? { excludedRunId: input.excludedRunId }
        : {}),
    });
    return {
      ...testCase,
      confidence: applyCurve(confidenceComponents.rawScore, input.curve),
      confidenceComponents,
    };
  }),
});

const percentile = (
  sorted: readonly number[],
  quantile: number,
): number => {
  if (sorted.length === 0) return 0;
  const index = Math.floor((sorted.length - 1) * quantile);
  return round6(sorted[index] ?? 0);
};

export const summarizeCaseConfidenceDistribution = (
  list: GeneratedTestCaseList,
): CaseConfidenceDistributionSummary | undefined => {
  const values = list.testCases
    .map((testCase) => testCase.confidence)
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    confidenceMean: round6(
      sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    ),
    confidenceP10: percentile(sorted, 0.1),
    confidenceP50: percentile(sorted, 0.5),
    confidenceP90: percentile(sorted, 0.9),
  };
};
