import type { KpiAlert } from "../src/parity/types-kpi.js";

export interface VisualBenchmarkRegressionConfig {
  maxScoreDropPercent: number;
  neutralTolerance: number;
}

export const DEFAULT_VISUAL_BENCHMARK_REGRESSION_CONFIG: VisualBenchmarkRegressionConfig =
  {
    maxScoreDropPercent: 5,
    neutralTolerance: 1,
  };

export type VisualBenchmarkTrendDirection =
  | "up"
  | "down"
  | "neutral"
  | "unavailable";

export interface VisualBenchmarkTrendSummary {
  fixtureId: string;
  current: number;
  baseline: number | null;
  delta: number | null;
  direction: VisualBenchmarkTrendDirection;
  withinTolerance: boolean;
  dropPercent: number | null;
}

export interface VisualBenchmarkScoreCandidate {
  fixtureId: string;
  current: number;
  baseline: number | null;
}

export interface VisualBenchmarkRegressionDetectionResult {
  alerts: KpiAlert[];
  summaries: VisualBenchmarkTrendSummary[];
}

const roundToTwoDecimals = (value: number): number =>
  Math.round(value * 100) / 100;

const assertRegressionConfig = (
  config: VisualBenchmarkRegressionConfig,
): void => {
  if (
    !Number.isFinite(config.maxScoreDropPercent) ||
    config.maxScoreDropPercent < 0
  ) {
    throw new Error(
      "maxScoreDropPercent must be a non-negative finite number.",
    );
  }
  if (config.maxScoreDropPercent > 100) {
    throw new Error("maxScoreDropPercent must not exceed 100.");
  }
  if (
    !Number.isFinite(config.neutralTolerance) ||
    config.neutralTolerance < 0
  ) {
    throw new Error("neutralTolerance must be a non-negative finite number.");
  }
  if (config.neutralTolerance > 100) {
    throw new Error("neutralTolerance must not exceed 100.");
  }
};

export const detectVisualBenchmarkRegression = (
  scores: readonly VisualBenchmarkScoreCandidate[],
  config: VisualBenchmarkRegressionConfig = DEFAULT_VISUAL_BENCHMARK_REGRESSION_CONFIG,
): VisualBenchmarkRegressionDetectionResult => {
  assertRegressionConfig(config);

  const summaries: VisualBenchmarkTrendSummary[] = [];
  const alerts: KpiAlert[] = [];

  for (const entry of scores) {
    if (!Number.isFinite(entry.current)) {
      throw new Error(
        `Current score for fixture '${entry.fixtureId}' must be a finite number.`,
      );
    }

    if (entry.baseline === null) {
      summaries.push({
        fixtureId: entry.fixtureId,
        current: entry.current,
        baseline: null,
        delta: null,
        direction: "unavailable",
        withinTolerance: true,
        dropPercent: null,
      });
      continue;
    }

    if (!Number.isFinite(entry.baseline)) {
      throw new Error(
        `Baseline score for fixture '${entry.fixtureId}' must be a finite number or null.`,
      );
    }

    const delta = roundToTwoDecimals(entry.current - entry.baseline);
    const absDelta = Math.abs(delta);
    const withinTolerance = absDelta <= config.neutralTolerance;
    const direction: VisualBenchmarkTrendDirection = withinTolerance
      ? "neutral"
      : delta > 0
        ? "up"
        : "down";

    const dropPercent =
      entry.baseline > 0
        ? roundToTwoDecimals(
            ((entry.baseline - entry.current) / entry.baseline) * 100,
          )
        : null;

    summaries.push({
      fixtureId: entry.fixtureId,
      current: entry.current,
      baseline: entry.baseline,
      delta,
      direction,
      withinTolerance,
      dropPercent,
    });

    if (
      direction === "down" &&
      dropPercent !== null &&
      dropPercent > config.maxScoreDropPercent
    ) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_DROP",
        severity: "warn",
        message:
          `Visual quality dropped ${String(dropPercent)}% for fixture '${entry.fixtureId}' ` +
          `(baseline ${String(entry.baseline)} -> current ${String(entry.current)}).`,
        value: dropPercent,
        threshold: config.maxScoreDropPercent,
      });
    }
  }

  return { alerts, summaries };
};

const formatArrow = (direction: VisualBenchmarkTrendDirection): string => {
  switch (direction) {
    case "up":
      return "\u2191";
    case "down":
      return "\u2193";
    case "neutral":
      return "\u2192";
    case "unavailable":
      return "\u2014";
  }
};

export const formatVisualBenchmarkTrendLine = (
  summary: VisualBenchmarkTrendSummary,
): string => {
  if (summary.baseline === null || summary.delta === null) {
    return `${summary.fixtureId}: ${String(summary.current)} (no baseline)`;
  }
  const arrow = formatArrow(summary.direction);
  const magnitude = Math.abs(summary.delta);
  return `${summary.fixtureId}: ${String(summary.current)} (${arrow}${String(magnitude)} from baseline ${String(summary.baseline)})`;
};

export const formatVisualBenchmarkTrendSummaryBlock = (
  summaries: readonly VisualBenchmarkTrendSummary[],
): string => {
  if (summaries.length === 0) {
    return "";
  }
  const lines = summaries.map(
    (summary) => `  ${formatVisualBenchmarkTrendLine(summary)}`,
  );
  return `Trend (per fixture):\n${lines.join("\n")}`;
};
