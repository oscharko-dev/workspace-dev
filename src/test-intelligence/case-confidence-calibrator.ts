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
import {
  LOCALE_CALIBRATION_FALLBACK_KEY,
  SUPPORTED_LOCALES,
  type LocaleCalibrationKey,
  type SupportedLocale,
} from "./locale-calibration.js";

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

/**
 * Per-locale Platt-curve entry stored inside `CaseConfidenceCurveArtifact.localeCurves`.
 *
 * When a locale's sample count falls below `CALIBRATION_MIN_SAMPLE_FLOOR` the
 * entry mirrors the aggregate (default) curve and `fallbackToDefault` is `true`
 * so callers can distinguish a real per-locale fit from an inherited one.
 */
export interface LocaleCurveEntry {
  readonly intercept: number;
  readonly slope: number;
  readonly sampleCount: number;
  readonly trainingBrierScore: number;
  readonly eceByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
  readonly sampleCountByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
  /** True when this locale's sample count was below the minimum floor and the default curve was copied. */
  readonly fallbackToDefault: boolean;
}

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
  /**
   * Per-locale Platt-curve fits (Issue #2117).
   *
   * `"default"` is always the aggregate curve (same `intercept`/`slope` as
   * the top-level fields, kept for symmetric iteration).  Each `SupportedLocale`
   * entry is only present when the locale appears in the sample set; it holds
   * `fallbackToDefault: false` when the locale had ≥ `CALIBRATION_MIN_SAMPLE_FLOOR`
   * samples and a genuine fit was run, or `fallbackToDefault: true` when the
   * aggregate was copied because the locale was under-represented.
   */
  readonly localeCurves: Readonly<Record<LocaleCalibrationKey, LocaleCurveEntry>>;
  /**
   * Per-locale ECE hard threshold (Issue #2107, Issue #2117).
   * Fixed at 0.10 — independent of risk category — for the per-locale gate.
   * Source: acceptance criteria §5 of Issue #2117.
   */
  readonly perLocaleEceThreshold: number;
  /** Sample count broken down by locale key (includes "default" = total). */
  readonly localeSampleCount: Readonly<Record<LocaleCalibrationKey, number>>;
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
  /** Resolved locale for the sample, or "unknown" when not determinable (Issue #2117). */
  readonly locale: SupportedLocale | "unknown";
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
  /**
   * Optional mapping of Figma `screenId` → `SupportedLocale` used to
   * resolve per-locale Platt curves (Issue #2117).  When absent, all samples
   * receive locale `"unknown"` and only the aggregate (default) curve is fit.
   * Additive: existing callers that omit this field continue to work unchanged.
   */
  readonly screenLocaleMap?: ReadonlyMap<string, SupportedLocale>;
}

export interface LoadedCaseConfidenceCalibration {
  readonly curve: CaseConfidenceCurveArtifact;
  readonly acceptedAnchors: readonly HistoricalAcceptedAnchor[];
  readonly artifactPath: string;
  readonly reliabilityArtifactPaths: Readonly<
    Record<TestCaseRiskCategory, string>
  >;
  /**
   * Paths to per-locale reliability diagram artifacts (Issue #2117).
   * Additive optional: present only when `screenLocaleMap` was supplied and
   * at least one locale met the minimum sample floor.
   */
  readonly localeReliabilityArtifactPaths?: Readonly<
    Partial<Record<LocaleCalibrationKey, string>>
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

/** Fixed per-locale ECE threshold per Issue #2107 acceptance criteria §5 of Issue #2117. */
const PER_LOCALE_ECE_THRESHOLD = 0.10 as const;

const buildDefaultLocaleCurveEntry = (input: {
  intercept: number;
  slope: number;
  trainingBrierScore: number;
}): LocaleCurveEntry => ({
  intercept: input.intercept,
  slope: input.slope,
  sampleCount: 0,
  trainingBrierScore: input.trainingBrierScore,
  eceByRiskCategory: Object.fromEntries(
    CALIBRATION_RISK_CATEGORIES.map((rc) => [rc, 0]),
  ) as Record<TestCaseRiskCategory, number>,
  sampleCountByRiskCategory: Object.fromEntries(
    CALIBRATION_RISK_CATEGORIES.map((rc) => [rc, 0]),
  ) as Record<TestCaseRiskCategory, number>,
  fallbackToDefault: false,
});

const buildDefaultLocaleCurves = (input: {
  intercept: number;
  slope: number;
  trainingBrierScore: number;
}): Readonly<Record<LocaleCalibrationKey, LocaleCurveEntry>> => {
  const fallbackEntry: LocaleCurveEntry = {
    ...buildDefaultLocaleCurveEntry(input),
    fallbackToDefault: false,
  };
  const localeEntries = SUPPORTED_LOCALES.map((locale) => [
    locale,
    { ...buildDefaultLocaleCurveEntry(input), fallbackToDefault: true },
  ]);
  return Object.fromEntries([
    [LOCALE_CALIBRATION_FALLBACK_KEY, fallbackEntry],
    ...localeEntries,
  ]) as Record<LocaleCalibrationKey, LocaleCurveEntry>;
};

const buildDefaultLocaleSampleCount = (): Readonly<Record<LocaleCalibrationKey, number>> =>
  Object.fromEntries([
    [LOCALE_CALIBRATION_FALLBACK_KEY, 0],
    ...SUPPORTED_LOCALES.map((locale) => [locale, 0]),
  ]) as Record<LocaleCalibrationKey, number>;

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
  localeCurves: buildDefaultLocaleCurves({
    intercept: -2.25,
    slope: 5.5,
    trainingBrierScore: round6(0.0625),
  }),
  perLocaleEceThreshold: PER_LOCALE_ECE_THRESHOLD,
  localeSampleCount: buildDefaultLocaleSampleCount(),
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

/**
 * Run gradient-descent Platt scaling on a training set.
 * Returns `{ intercept, slope }` only — caller wraps into the artifact.
 */
const gradientDescentPlatt = (
  training: readonly HistoricalCalibrationSample[],
): { intercept: number; slope: number } => {
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
  return { intercept: round6(intercept), slope: round6(slope) };
};

/**
 * Fit a per-locale `LocaleCurveEntry` from a locale-specific sample slice.
 * When the slice is below `CALIBRATION_MIN_SAMPLE_FLOOR` or lacks both
 * positives and negatives, `fallbackToDefault` is set and the default curve
 * parameters are used.
 */
const fitLocaleEntry = (
  localeSamples: readonly HistoricalCalibrationSample[],
  defaultCurveParams: { intercept: number; slope: number; trainingBrierScore: number },
): LocaleCurveEntry => {
  if (localeSamples.length < CALIBRATION_MIN_SAMPLE_FLOOR) {
    return {
      intercept: defaultCurveParams.intercept,
      slope: defaultCurveParams.slope,
      sampleCount: localeSamples.length,
      trainingBrierScore: defaultCurveParams.trainingBrierScore,
      eceByRiskCategory: Object.fromEntries(
        CALIBRATION_RISK_CATEGORIES.map((rc) => [rc, 0]),
      ) as Record<TestCaseRiskCategory, number>,
      sampleCountByRiskCategory: Object.fromEntries(
        CALIBRATION_RISK_CATEGORIES.map((rc) => [
          rc,
          localeSamples.filter((s) => s.riskCategory === rc).length,
        ]),
      ) as Record<TestCaseRiskCategory, number>,
      fallbackToDefault: true,
    };
  }
  const { sorted: localeSorted, training: localeTraining } =
    splitCalibrationSamples(localeSamples);
  const positives = localeTraining.filter((s) => s.label === 1).length;
  const negatives = localeTraining.length - positives;
  if (positives === 0 || negatives === 0) {
    return {
      intercept: defaultCurveParams.intercept,
      slope: defaultCurveParams.slope,
      sampleCount: localeSorted.length,
      trainingBrierScore: defaultCurveParams.trainingBrierScore,
      eceByRiskCategory: Object.fromEntries(
        CALIBRATION_RISK_CATEGORIES.map((rc) => [rc, 0]),
      ) as Record<TestCaseRiskCategory, number>,
      sampleCountByRiskCategory: Object.fromEntries(
        CALIBRATION_RISK_CATEGORIES.map((rc) => [
          rc,
          localeSorted.filter((s) => s.riskCategory === rc).length,
        ]),
      ) as Record<TestCaseRiskCategory, number>,
      fallbackToDefault: true,
    };
  }
  const { intercept, slope } = gradientDescentPlatt(localeTraining);
  const localeCurveParams = { intercept, slope };
  const trainingBrierScore = computeBrierScore(
    calibrateSamples(localeTraining, localeCurveParams),
  );
  const reliabilityResult = buildReliabilityArtifacts({
    datasetId: "locale-fit",
    generatedAt: "",
    evaluationSplit: "all_samples_fallback",
    evaluationSamples: calibrateSamples(localeSorted, localeCurveParams),
  });
  return {
    intercept,
    slope,
    sampleCount: localeSorted.length,
    trainingBrierScore,
    eceByRiskCategory: reliabilityResult.eceByRiskCategory,
    sampleCountByRiskCategory: reliabilityResult.sampleCountByRiskCategory,
    fallbackToDefault: false,
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

  // Build aggregate local sample count per locale
  const localeSampleCountMap = new Map<LocaleCalibrationKey, number>();
  localeSampleCountMap.set(LOCALE_CALIBRATION_FALLBACK_KEY, sorted.length);
  for (const locale of SUPPORTED_LOCALES) {
    localeSampleCountMap.set(
      locale,
      sorted.filter((s) => s.locale === locale).length,
    );
  }
  const localeSampleCount = Object.fromEntries(
    localeSampleCountMap.entries(),
  ) as Record<LocaleCalibrationKey, number>;

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
      localeSampleCount,
    };
  }

  const { intercept, slope } = gradientDescentPlatt(training);
  const curve = { intercept, slope };

  const evaluationSplit = heldOut.length > 0 ? "held_out" : "all_samples_fallback";
  const reliabilityArtifacts = buildReliabilityArtifacts({
    datasetId: input.datasetId,
    generatedAt: input.generatedAt,
    evaluationSplit,
    evaluationSamples: calibrateSamples(heldOut.length > 0 ? heldOut : sorted, curve),
  });

  const aggregateTrainingBrierScore = computeBrierScore(calibrateSamples(training, curve));

  // Build per-locale curves using the same gradient-descent pattern.
  const defaultCurveParams = {
    intercept: curve.intercept,
    slope: curve.slope,
    trainingBrierScore: aggregateTrainingBrierScore,
  };
  const defaultLocaleEntry: LocaleCurveEntry = {
    intercept: curve.intercept,
    slope: curve.slope,
    sampleCount: sorted.length,
    trainingBrierScore: aggregateTrainingBrierScore,
    eceByRiskCategory: reliabilityArtifacts.eceByRiskCategory,
    sampleCountByRiskCategory: reliabilityArtifacts.sampleCountByRiskCategory,
    fallbackToDefault: false,
  };
  const localeEntries: Array<[string, LocaleCurveEntry]> = [
    [LOCALE_CALIBRATION_FALLBACK_KEY, defaultLocaleEntry],
    ...SUPPORTED_LOCALES.map((locale): [string, LocaleCurveEntry] => {
      const localeSamples = sorted.filter((s) => s.locale === locale);
      return [locale, fitLocaleEntry(localeSamples, defaultCurveParams)];
    }),
  ];
  const localeCurves = Object.fromEntries(localeEntries) as Record<
    LocaleCalibrationKey,
    LocaleCurveEntry
  >;

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
    trainingBrierScore: aggregateTrainingBrierScore,
    heldOutSampleCount: heldOut.length,
    calibrationEvaluationSplit: evaluationSplit,
    minimumRiskCategorySampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
    heldOutSampleCountByRiskCategory: reliabilityArtifacts.sampleCountByRiskCategory,
    eceByRiskCategory: reliabilityArtifacts.eceByRiskCategory,
    eceThresholdByRiskCategory: CALIBRATION_ECE_THRESHOLDS,
    localeCurves,
    perLocaleEceThreshold: PER_LOCALE_ECE_THRESHOLD,
    localeSampleCount,
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

/**
 * Resolve the locale for a single test case using its first `figmaTraceRefs`
 * screen and the caller-supplied map.  Returns `"unknown"` when the map is
 * absent or the screen id has no entry.
 */
const deriveLocaleForCase = (
  testCase: GeneratedTestCase,
  screenLocaleMap: ReadonlyMap<string, SupportedLocale> | undefined,
): SupportedLocale | "unknown" => {
  if (screenLocaleMap === undefined) return "unknown";
  const firstRef = testCase.figmaTraceRefs[0];
  if (firstRef === undefined) return "unknown";
  return screenLocaleMap.get(firstRef.screenId) ?? "unknown";
};

const buildHistoricalCalibrationSamples = (input: {
  readonly snapshots: readonly HistoricalRunSnapshot[];
  readonly explicitLabels?: LabelManifest;
  readonly acceptedAnchors: readonly HistoricalAcceptedAnchor[];
  readonly screenLocaleMap?: ReadonlyMap<string, SupportedLocale>;
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
        locale: deriveLocaleForCase(testCase, input.screenLocaleMap),
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

/**
 * Per-locale reliability diagram artifact.
 * Mirrors `CaseConfidenceReliabilityDiagramArtifact` but carries a
 * `locale` discriminator so consumers can load by locale key.
 * File name: `case-confidence-reliability-locale-<locale>.json`.
 */
export interface CaseConfidenceLocaleReliabilityDiagramArtifact {
  readonly schemaVersion: typeof CASE_CONFIDENCE_RELIABILITY_DIAGRAM_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly datasetId: string;
  readonly locale: LocaleCalibrationKey;
  readonly evaluationSplit: CaseConfidenceCalibrationEvaluationSplit;
  readonly minimumSampleFloor: number;
  readonly sampleCount: number;
  readonly pluginEce: number;
  readonly debiasedEce: number;
  readonly bins: ReadonlyArray<ReliabilityDiagramBin>;
}

/**
 * Write one per-locale reliability diagram artifact per locale key.
 * Only locales whose sample count exceeds zero are emitted.
 */
const writeLocaleReliabilityDiagramArtifacts = async (
  datasetRoot: string,
  input: {
    readonly datasetId: string;
    readonly generatedAt: string;
    readonly localeCurves: Readonly<Record<LocaleCalibrationKey, LocaleCurveEntry>>;
    readonly samples: readonly HistoricalCalibrationSample[];
    readonly aggregateCurve: Pick<CaseConfidenceCurveArtifact, "intercept" | "slope">;
  },
): Promise<Readonly<Partial<Record<LocaleCalibrationKey, string>>>> => {
  const artifactDir = dirname(resolveCaseConfidenceCurveArtifactPath(datasetRoot));
  await mkdir(artifactDir, { recursive: true });
  const paths: Partial<Record<LocaleCalibrationKey, string>> = {};

  const localeKeys: LocaleCalibrationKey[] = [
    LOCALE_CALIBRATION_FALLBACK_KEY,
    ...SUPPORTED_LOCALES,
  ];

  for (const localeKey of localeKeys) {
    const localeSamples =
      localeKey === LOCALE_CALIBRATION_FALLBACK_KEY
        ? input.samples
        : input.samples.filter((s) => s.locale === localeKey);
    if (localeSamples.length === 0) continue;

    const localeCurveEntry = input.localeCurves[localeKey];
    const curvePick = localeCurveEntry ?? input.aggregateCurve;
    const calibrated = calibrateSamples(localeSamples, curvePick);
    const reliability = buildReliabilityDiagram(
      calibrated.map((s) => ({ confidence: s.confidence, label: s.label })),
    );

    const artifact: CaseConfidenceLocaleReliabilityDiagramArtifact = {
      schemaVersion: CASE_CONFIDENCE_RELIABILITY_DIAGRAM_SCHEMA_VERSION,
      generatedAt: input.generatedAt,
      datasetId: input.datasetId,
      locale: localeKey,
      evaluationSplit: "all_samples_fallback",
      minimumSampleFloor: CALIBRATION_MIN_SAMPLE_FLOOR,
      sampleCount: reliability.sampleCount,
      pluginEce: reliability.pluginEce,
      debiasedEce: reliability.debiasedEce,
      bins: reliability.bins,
    };

    const artifactPath = join(
      artifactDir,
      `case-confidence-reliability-locale-${localeKey}.json`,
    );
    const tmpPath = `${artifactPath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${canonicalJson(artifact)}\n`, "utf8");
    await rename(tmpPath, artifactPath);
    paths[localeKey] = artifactPath;
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
    ...(input.screenLocaleMap !== undefined ? { screenLocaleMap: input.screenLocaleMap } : {}),
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

  // Per-locale reliability artifacts — only when locale information was supplied.
  const localeReliabilityArtifactPaths: Readonly<Partial<Record<LocaleCalibrationKey, string>>> | undefined =
    input.screenLocaleMap !== undefined
      ? await writeLocaleReliabilityDiagramArtifacts(datasetRoot, {
          datasetId,
          generatedAt: input.generatedAt,
          localeCurves: curve.localeCurves,
          samples,
          aggregateCurve: { intercept: curve.intercept, slope: curve.slope },
        })
      : undefined;

  return {
    curve,
    acceptedAnchors,
    artifactPath,
    reliabilityArtifactPaths,
    ...(localeReliabilityArtifactPaths !== undefined
      ? { localeReliabilityArtifactPaths }
      : {}),
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
  /**
   * Optional mapping of Figma `screenId` → `SupportedLocale` (Issue #2117).
   * When present, the per-locale Platt curve is selected for each test case
   * using its first `figmaTraceRefs` screen.  Falls back to the aggregate
   * (default) curve for unseen locales.  Additive: omitting this field leaves
   * existing callers unchanged.
   */
  readonly screenLocaleMap?: ReadonlyMap<string, SupportedLocale>;
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

    // Select per-locale curve when a locale map is provided (Issue #2117).
    // Falls back to the aggregate (default) curve for unseen or unknown locales.
    const selectedCurve = (() => {
      if (input.screenLocaleMap === undefined) return input.curve;
      const locale = deriveLocaleForCase(testCase, input.screenLocaleMap);
      if (locale === "unknown") return input.curve;
      const localeEntry = input.curve.localeCurves[locale];
      if (localeEntry === undefined || localeEntry.fallbackToDefault) return input.curve;
      return localeEntry;
    })();

    return {
      ...testCase,
      confidence: applyCurve(confidenceComponents.rawScore, selectedCurve),
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
