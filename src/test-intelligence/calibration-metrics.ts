import type { TestCaseRiskCategory } from "../contracts/index.js";

export const CALIBRATION_HISTOGRAM_BIN_COUNT = 10 as const;
export const CALIBRATION_MIN_SAMPLE_FLOOR = 50 as const;

export const CALIBRATION_RISK_CATEGORIES: ReadonlyArray<TestCaseRiskCategory> =
  Object.freeze([
    "low",
    "medium",
    "high",
    "regulated_data",
    "financial_transaction",
  ]);

export const CALIBRATION_ECE_THRESHOLDS: Readonly<
  Record<TestCaseRiskCategory, number>
> = Object.freeze({
  low: 0.1,
  medium: 0.1,
  high: 0.1,
  regulated_data: 0.05,
  financial_transaction: 0.05,
});

export interface CalibrationSample {
  readonly confidence: number;
  readonly label: 0 | 1;
}

export interface RiskCalibrationSample extends CalibrationSample {
  readonly riskCategory: TestCaseRiskCategory;
}

export interface ReliabilityDiagramBin {
  readonly binIndex: number;
  readonly lowerBoundInclusive: number;
  readonly upperBoundInclusive: number;
  readonly sampleCount: number;
  readonly meanConfidence: number;
  readonly empiricalAccuracy: number;
  readonly calibrationGap: number;
  readonly absoluteCalibrationGap: number;
  readonly debiasedAbsoluteCalibrationGap: number;
}

export interface ReliabilityDiagram {
  readonly sampleCount: number;
  readonly binCount: number;
  readonly pluginEce: number;
  readonly debiasedEce: number;
  readonly bins: ReadonlyArray<ReliabilityDiagramBin>;
}

export interface RiskCalibrationDiagnostics {
  readonly overall: ReliabilityDiagram;
  readonly byRiskCategory: Readonly<Record<TestCaseRiskCategory, ReliabilityDiagram>>;
  readonly eceByRiskCategory: Readonly<Record<TestCaseRiskCategory, number>>;
}

const round6 = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : round6(values.reduce((sum, value) => sum + value, 0) / values.length);

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial =
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t);
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
};

const normalCdf = (value: number): number =>
  0.5 * (1 + erf(value / Math.SQRT2));

const expectedAbsoluteNormal = (meanValue: number, stddev: number): number => {
  if (!Number.isFinite(stddev) || stddev <= 0) {
    return Math.abs(meanValue);
  }
  const absoluteMean = Math.abs(meanValue);
  const scaled = absoluteMean / stddev;
  return (
    stddev *
      Math.sqrt(2 / Math.PI) *
      Math.exp(-(absoluteMean * absoluteMean) / (2 * stddev * stddev)) +
    absoluteMean * (2 * normalCdf(scaled) - 1)
  );
};

export const computeBrierScore = (
  samples: ReadonlyArray<CalibrationSample>,
): number => {
  if (samples.length === 0) return 0;
  let total = 0;
  for (const sample of samples) {
    const delta = clamp01(sample.confidence) - sample.label;
    total += delta * delta;
  }
  return round6(total / samples.length);
};

export const buildReliabilityDiagram = (
  samples: ReadonlyArray<CalibrationSample>,
  binCount: number = CALIBRATION_HISTOGRAM_BIN_COUNT,
): ReliabilityDiagram => {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      binCount,
      pluginEce: 0,
      debiasedEce: 0,
      bins: Array.from({ length: binCount }, (_, index) => ({
        binIndex: index,
        lowerBoundInclusive: round6(index / binCount),
        upperBoundInclusive: round6((index + 1) / binCount),
        sampleCount: 0,
        meanConfidence: 0,
        empiricalAccuracy: 0,
        calibrationGap: 0,
        absoluteCalibrationGap: 0,
        debiasedAbsoluteCalibrationGap: 0,
      })),
    };
  }

  const bins: ReliabilityDiagramBin[] = [];
  let pluginEce = 0;
  let debiasedEce = 0;

  for (let index = 0; index < binCount; index += 1) {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    const bucket = samples.filter((sample) =>
      index === binCount - 1
        ? sample.confidence >= lower && sample.confidence <= upper
        : sample.confidence >= lower && sample.confidence < upper,
    );
    if (bucket.length === 0) {
      bins.push({
        binIndex: index,
        lowerBoundInclusive: round6(lower),
        upperBoundInclusive: round6(upper),
        sampleCount: 0,
        meanConfidence: 0,
        empiricalAccuracy: 0,
        calibrationGap: 0,
        absoluteCalibrationGap: 0,
        debiasedAbsoluteCalibrationGap: 0,
      });
      continue;
    }
    const meanConfidence = mean(bucket.map((sample) => clamp01(sample.confidence)));
    const empiricalAccuracy = mean(bucket.map((sample) => sample.label));
    const calibrationGap = round6(meanConfidence - empiricalAccuracy);
    const absoluteCalibrationGap = round6(Math.abs(calibrationGap));
    const bucketWeight = bucket.length / samples.length;
    const stddev =
      bucket.length > 1
        ? Math.sqrt(
            (empiricalAccuracy * (1 - empiricalAccuracy)) / bucket.length,
          )
        : 0;
    const debiasedAbsoluteCalibrationGap = round6(
      2 * absoluteCalibrationGap -
        expectedAbsoluteNormal(calibrationGap, stddev),
    );
    pluginEce += bucketWeight * absoluteCalibrationGap;
    debiasedEce += bucketWeight * debiasedAbsoluteCalibrationGap;
    bins.push({
      binIndex: index,
      lowerBoundInclusive: round6(lower),
      upperBoundInclusive: round6(upper),
      sampleCount: bucket.length,
      meanConfidence,
      empiricalAccuracy,
      calibrationGap,
      absoluteCalibrationGap,
      debiasedAbsoluteCalibrationGap,
    });
  }

  return {
    sampleCount: samples.length,
    binCount,
    pluginEce: round6(pluginEce),
    debiasedEce: round6(Math.max(debiasedEce, 0)),
    bins,
  };
};

export const computeExpectedCalibrationError = (
  samples: ReadonlyArray<CalibrationSample>,
  binCount: number = CALIBRATION_HISTOGRAM_BIN_COUNT,
): number => buildReliabilityDiagram(samples, binCount).debiasedEce;

export const buildRiskCalibrationDiagnostics = (
  samples: ReadonlyArray<RiskCalibrationSample>,
  binCount: number = CALIBRATION_HISTOGRAM_BIN_COUNT,
): RiskCalibrationDiagnostics => {
  const overall = buildReliabilityDiagram(samples, binCount);
  const byRiskCategory = {} as Record<
    TestCaseRiskCategory,
    ReliabilityDiagram
  >;
  const eceByRiskCategory = {} as Record<TestCaseRiskCategory, number>;
  for (const riskCategory of CALIBRATION_RISK_CATEGORIES) {
    const bucket = samples.filter(
      (sample) => sample.riskCategory === riskCategory,
    );
    const diagram = buildReliabilityDiagram(bucket, binCount);
    byRiskCategory[riskCategory] = diagram;
    eceByRiskCategory[riskCategory] = diagram.debiasedEce;
  }
  return {
    overall,
    byRiskCategory,
    eceByRiskCategory,
  };
};
