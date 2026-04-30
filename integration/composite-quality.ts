import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { toStableJsonString } from "./visual-benchmark.helpers.js";

export const CompositeQualityWeightsSchema = z.object({
  visual: z.number().min(0).optional(),
  performance: z.number().min(0).optional(),
});

export interface CompositeQualityWeights {
  visual: number;
  performance: number;
}

export const DEFAULT_COMPOSITE_QUALITY_WEIGHTS: CompositeQualityWeights = {
  visual: 0.6,
  performance: 0.4,
};

export type LighthouseProfile = "mobile" | "desktop";

export interface CompositeLighthouseSampleMetrics {
  measurement?: "lighthouse" | "playwright-browser-timing";
  profile: LighthouseProfile;
  route: string;
  performanceScore: number | null;
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

export interface PerformanceAggregateMetrics {
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

export interface PerformanceScoreBreakdown {
  score: number | null;
  sampleCount: number;
  samples: CompositeLighthouseSampleMetrics[];
  aggregateMetrics: PerformanceAggregateMetrics;
  warnings: string[];
}

export interface VisualScoreInput {
  overallScore: number;
  ranAt: string;
  source: string;
  warning?: string;
}

export type CompositeQualityDimension = "visual" | "performance";

export interface CompositeQualityReport {
  version: 1;
  generatedAt: string;
  weights: CompositeQualityWeights;
  visual: {
    score: number;
    ranAt: string;
    source: string;
  } | null;
  performance: PerformanceScoreBreakdown | null;
  composite: {
    score: number | null;
    includedDimensions: CompositeQualityDimension[];
    explanation: string;
  };
  warnings: string[];
}

export interface CompositeQualityHistoryEntry {
  runAt: string;
  weights: CompositeQualityWeights;
  visualScore: number | null;
  performanceScore: number | null;
  compositeScore: number | null;
}

export interface CompositeQualityHistory {
  version: 1;
  entries: CompositeQualityHistoryEntry[];
}

export const DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE = 20;
export const MAX_COMPOSITE_QUALITY_HISTORY_SIZE = 1000;

export const COMPOSITE_QUALITY_PR_COMMENT_MARKER =
  "<!-- workspace-dev-composite-quality -->" as const;

const COMPOSITE_HISTORY_DIR_NAME = "composite-quality";
const COMPOSITE_HISTORY_FILE_NAME = "composite-quality-history.json";
const LEGACY_COMPOSITE_HISTORY_FILE_NAME = "history.json";

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const assertFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`composite-quality: ${label} must be a finite number.`);
  }
  return value;
};

const assertInRange0to100 = (value: number, label: string): number => {
  if (value < 0 || value > 100) {
    throw new Error(
      `composite-quality: ${label} must be within 0..100 (received ${String(value)}).`,
    );
  }
  return value;
};

export const resolveCompositeQualityWeights = (
  input?: { visual?: number; performance?: number } | null,
): CompositeQualityWeights => {
  if (input === undefined || input === null) {
    return { ...DEFAULT_COMPOSITE_QUALITY_WEIGHTS };
  }

  const parsed = CompositeQualityWeightsSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`composite-quality: invalid weights (${issues}).`);
  }

  const { visual: rawVisual, performance: rawPerformance } = parsed.data;

  const validate = (value: number | undefined, label: string): void => {
    if (value === undefined) {
      return;
    }
    if (!Number.isFinite(value)) {
      throw new Error(
        `composite-quality: ${label} weight must be a finite number.`,
      );
    }
    if (value < 0 || value > 1) {
      throw new Error(
        `composite-quality: ${label} weight must be within 0..1 (received ${String(value)}).`,
      );
    }
  };

  validate(rawVisual, "visual");
  validate(rawPerformance, "performance");

  let visual: number;
  let performance: number;
  if (rawVisual === undefined && rawPerformance === undefined) {
    return { ...DEFAULT_COMPOSITE_QUALITY_WEIGHTS };
  } else if (rawVisual === undefined && rawPerformance !== undefined) {
    performance = rawPerformance;
    visual = 1 - rawPerformance;
  } else if (rawPerformance === undefined && rawVisual !== undefined) {
    visual = rawVisual;
    performance = 1 - rawVisual;
  } else {
    visual = rawVisual ?? 0;
    performance = rawPerformance ?? 0;
  }

  const sum = visual + performance;
  if (!Number.isFinite(sum) || sum <= 0) {
    throw new Error("composite-quality: weights must sum to a positive value.");
  }

  return {
    visual: roundTo(visual / sum, 4),
    performance: roundTo(performance / sum, 4),
  };
};

export const computeCompositeQualityScore = (
  visualScore: number | null,
  performanceScore: number | null,
  weights: CompositeQualityWeights,
): {
  score: number | null;
  includedDimensions: CompositeQualityDimension[];
  explanation: string;
} => {
  if (visualScore !== null) {
    assertFiniteNumber(visualScore, "visual score");
    assertInRange0to100(visualScore, "visual score");
  }
  if (performanceScore !== null) {
    assertFiniteNumber(performanceScore, "performance score");
    assertInRange0to100(performanceScore, "performance score");
  }

  if (visualScore === null && performanceScore === null) {
    return {
      score: null,
      includedDimensions: [],
      explanation: "no scores available",
    };
  }

  if (visualScore !== null && performanceScore === null) {
    const score = roundTo(visualScore, 2);
    return {
      score,
      includedDimensions: ["visual"],
      explanation: `visual-only fallback: ${String(score)}`,
    };
  }

  if (performanceScore !== null && visualScore === null) {
    const score = roundTo(performanceScore, 2);
    return {
      score,
      includedDimensions: ["performance"],
      explanation: `performance-only fallback: ${String(score)}`,
    };
  }

  const visual = visualScore as number;
  const performance = performanceScore as number;
  const raw = weights.visual * visual + weights.performance * performance;
  const score = roundTo(raw, 2);
  return {
    score,
    includedDimensions: ["visual", "performance"],
    explanation: `${String(weights.visual)} * ${String(visual)} + ${String(weights.performance)} * ${String(performance)} = ${String(score)}`,
  };
};

const meanOrNull = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((acc, value) => acc + value, 0);
  return roundTo(total / values.length, 2);
};

const finiteNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const computePerformanceScore = (
  samples: readonly CompositeLighthouseSampleMetrics[],
): PerformanceScoreBreakdown => {
  if (samples.length === 0) {
    return {
      score: null,
      sampleCount: 0,
      samples: [],
      aggregateMetrics: {
        fcp_ms: null,
        lcp_ms: null,
        cls: null,
        tbt_ms: null,
        speed_index_ms: null,
      },
      warnings: ["no lighthouse samples provided"],
    };
  }

  const warnings: string[] = [];
  const perfScores: number[] = [];
  const fcpValues: number[] = [];
  const lcpValues: number[] = [];
  const clsValues: number[] = [];
  const tbtValues: number[] = [];
  const speedIndexValues: number[] = [];

  samples.forEach((sample, index) => {
    const label = `sample[${String(index)}] ${sample.profile} ${sample.route}`;
    const usesBrowserTiming = sample.measurement === "playwright-browser-timing";
    if (
      typeof sample.performanceScore === "number" &&
      Number.isFinite(sample.performanceScore)
    ) {
      if (sample.performanceScore < 0 || sample.performanceScore > 100) {
        throw new Error(
          `composite-quality: ${label} performanceScore must be within 0..100.`,
        );
      }
      perfScores.push(sample.performanceScore);
    } else if (!usesBrowserTiming) {
      warnings.push(`${label}: missing performance score`);
    }
    if (typeof sample.fcp_ms === "number" && Number.isFinite(sample.fcp_ms)) {
      fcpValues.push(sample.fcp_ms);
    } else if (!usesBrowserTiming) {
      warnings.push(`${label}: missing FCP`);
    }
    if (typeof sample.lcp_ms === "number" && Number.isFinite(sample.lcp_ms)) {
      lcpValues.push(sample.lcp_ms);
    } else {
      warnings.push(`${label}: missing LCP`);
    }
    if (typeof sample.cls === "number" && Number.isFinite(sample.cls)) {
      clsValues.push(sample.cls);
    } else {
      warnings.push(`${label}: missing CLS`);
    }
    if (typeof sample.tbt_ms === "number" && Number.isFinite(sample.tbt_ms)) {
      tbtValues.push(sample.tbt_ms);
    } else if (!usesBrowserTiming) {
      warnings.push(`${label}: missing TBT`);
    }
    if (
      typeof sample.speed_index_ms === "number" &&
      Number.isFinite(sample.speed_index_ms)
    ) {
      speedIndexValues.push(sample.speed_index_ms);
    } else if (!usesBrowserTiming) {
      warnings.push(`${label}: missing Speed Index`);
    }
  });

  return {
    score: meanOrNull(perfScores),
    sampleCount: samples.length,
    samples: samples.map(({ measurement: _measurement, ...sample }) => ({
      ...sample,
    })),
    aggregateMetrics: {
      fcp_ms: meanOrNull(fcpValues),
      lcp_ms: meanOrNull(lcpValues),
      cls: meanOrNull(clsValues),
      tbt_ms: meanOrNull(tbtValues),
      speed_index_ms: meanOrNull(speedIndexValues),
    },
    warnings,
  };
};

const extractNumericValue = (audits: unknown, key: string): number | null => {
  if (!isPlainRecord(audits)) {
    return null;
  }
  const audit = audits[key];
  if (!isPlainRecord(audit)) {
    return null;
  }
  const value = audit["numericValue"];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const extractPerformanceCategoryScore = (lhr: unknown): number | null => {
  if (!isPlainRecord(lhr)) {
    return null;
  }
  const categories = lhr["categories"];
  if (!isPlainRecord(categories)) {
    return null;
  }
  const performance = categories["performance"];
  if (!isPlainRecord(performance)) {
    return null;
  }
  const score = performance["score"];
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }
  return roundTo(score * 100, 2);
};

const collectPerformanceCheckWarnings = (
  report: Record<string, unknown>,
): string[] => {
  const checks = isPlainRecord(report["checks"]) ? report["checks"] : {};
  const warnings: string[] = [];
  for (const group of ["budgets", "regression"] as const) {
    const groupChecks = checks[group];
    if (!Array.isArray(groupChecks)) {
      continue;
    }
    groupChecks.forEach((check, index) => {
      if (!isPlainRecord(check) || check["pass"] !== false) {
        return;
      }
      const metric =
        typeof check["metric"] === "string" && check["metric"].length > 0
          ? check["metric"]
          : `${group}[${String(index)}]`;
      const reason =
        typeof check["reason"] === "string" && check["reason"].length > 0
          ? `: ${check["reason"]}`
          : "";
      warnings.push(`${group} performance check failed for ${metric}${reason}`);
    });
  }
  return warnings;
};

const resolveLighthouseRoot = (
  value: unknown,
): Record<string, unknown> | null => {
  if (!isPlainRecord(value)) {
    return null;
  }
  const nestedReport = value["report"];
  if (isPlainRecord(nestedReport)) {
    const nestedReportLhr = nestedReport["lhr"];
    if (isPlainRecord(nestedReportLhr)) {
      return nestedReportLhr;
    }
    return nestedReport;
  }
  const nestedLhr = value["lhr"];
  if (isPlainRecord(nestedLhr)) {
    return nestedLhr;
  }
  return value;
};

const assertLighthouseProfile = (value: unknown): LighthouseProfile => {
  if (value === "mobile" || value === "desktop") {
    return value;
  }
  throw new Error(
    `composite-quality: unsupported lighthouse profile (${String(value)}).`,
  );
};

export interface LoadLighthouseSampleOptions {
  artifactDir: string;
  perfReportPath?: string;
}

export interface LoadLighthouseSamplesResult {
  samples: CompositeLighthouseSampleMetrics[];
  sourcePath: string | null;
  warnings: string[];
}

const resolveLighthouseReportPath = (
  raw: string,
  artifactDir: string,
): string => {
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(artifactDir, raw);
};

export const loadLighthouseSamplesFromPerfReport = async (
  options: LoadLighthouseSampleOptions,
): Promise<LoadLighthouseSamplesResult> => {
  const warnings: string[] = [];
  const { artifactDir } = options;
  const candidatePaths =
    options.perfReportPath !== undefined
      ? [options.perfReportPath]
      : [
          path.join(artifactDir, "perf-assert-report.json"),
          path.join(artifactDir, "perf-baseline.json"),
        ];

  let sourcePath: string | null = null;
  let rawContent: string | null = null;
  for (const candidate of candidatePaths) {
    try {
      rawContent = await readFile(candidate, "utf8");
      sourcePath = candidate;
      break;
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }

  if (rawContent === null || sourcePath === null) {
    warnings.push(
      `performance report not found (looked for ${candidatePaths.join(", ")})`,
    );
    return { samples: [], sourcePath: null, warnings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`performance report is not valid JSON: ${reason}`);
    return { samples: [], sourcePath, warnings };
  }

  if (!isPlainRecord(parsed) || !Array.isArray(parsed["samples"])) {
    warnings.push("performance report missing samples[] array");
    return { samples: [], sourcePath, warnings };
  }

  const samples: CompositeLighthouseSampleMetrics[] = [];
  const reportSamples = parsed["samples"];
  for (let index = 0; index < reportSamples.length; index += 1) {
    const sample: unknown = reportSamples[index];
    if (!isPlainRecord(sample)) {
      warnings.push(`sample[${String(index)}]: not an object, skipping`);
      continue;
    }
    let profile: LighthouseProfile;
    try {
      profile = assertLighthouseProfile(sample["profile"]);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`sample[${String(index)}]: ${reason}`);
      continue;
    }
    const route =
      typeof sample["route"] === "string" ? sample["route"] : "(unknown)";
    const metrics = isPlainRecord(sample["metrics"])
      ? sample["metrics"]
      : undefined;
    const artifacts = sample["artifacts"];
    const lighthouseReportRaw = isPlainRecord(artifacts)
      ? artifacts["lighthouseReport"]
      : undefined;
    const browserTimingReportRaw = isPlainRecord(artifacts)
      ? artifacts["browserTimingReport"]
      : undefined;
    const usesBrowserTiming =
      parsed["measurement"] === "playwright-browser-timing" ||
      typeof browserTimingReportRaw === "string";

    if (usesBrowserTiming) {
      if (metrics === undefined) {
        warnings.push(
          `sample[${String(index)}] ${profile} ${route}: missing metrics object`,
        );
        continue;
      }
      samples.push({
        measurement: "playwright-browser-timing",
        profile,
        route,
        performanceScore: null,
        fcp_ms: null,
        lcp_ms: finiteNumberOrNull(metrics["lcp_ms"]),
        cls: finiteNumberOrNull(metrics["cls"]),
        tbt_ms: null,
        speed_index_ms: null,
      });
      continue;
    }

    if (typeof lighthouseReportRaw !== "string") {
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: missing artifacts.lighthouseReport path`,
      );
      continue;
    }
    const reportPath = resolveLighthouseReportPath(
      lighthouseReportRaw,
      artifactDir,
    );
    let lhrContent: string;
    try {
      lhrContent = await readFile(reportPath, "utf8");
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: failed to read ${reportPath} (${reason})`,
      );
      continue;
    }
    let lhr: unknown;
    try {
      lhr = JSON.parse(lhrContent);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(
        `sample[${String(index)}] ${profile} ${route}: malformed lighthouse report (${reason})`,
      );
      continue;
    }
    const lighthouseRoot = resolveLighthouseRoot(lhr);
    const audits =
      lighthouseRoot !== null ? lighthouseRoot["audits"] : undefined;
    samples.push({
      profile,
      route,
      performanceScore: extractPerformanceCategoryScore(lighthouseRoot),
      fcp_ms: extractNumericValue(audits, "first-contentful-paint"),
      lcp_ms: extractNumericValue(audits, "largest-contentful-paint"),
      cls: extractNumericValue(audits, "cumulative-layout-shift"),
      tbt_ms: extractNumericValue(audits, "total-blocking-time"),
      speed_index_ms: extractNumericValue(audits, "speed-index"),
    });
  }

  warnings.push(...collectPerformanceCheckWarnings(parsed));

  return { samples, sourcePath, warnings };
};

export const loadVisualBenchmarkScoreFromLastRun = async (
  lastRunPath: string,
): Promise<VisualScoreInput | null> => {
  let content: string;
  try {
    content = await readFile(lastRunPath, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `composite-quality: visual last-run JSON at ${lastRunPath} is malformed (${reason}).`,
    );
  }
  if (!isPlainRecord(parsed)) {
    throw new Error(
      `composite-quality: visual last-run JSON at ${lastRunPath} must be an object.`,
    );
  }
  const ranAtRaw = parsed["ranAt"];
  if (typeof ranAtRaw !== "string" || ranAtRaw.trim().length === 0) {
    throw new Error(
      `composite-quality: visual last-run JSON at ${lastRunPath} is missing ranAt.`,
    );
  }
  const overallCurrent = parsed["overallCurrent"];
  const overallScore = parsed["overallScore"];
  const screenAggregateScore = parsed["screenAggregateScore"];
  const firstScoreFromList = (): number | null => {
    const scores = parsed["scores"];
    if (!Array.isArray(scores) || scores.length === 0) {
      return null;
    }
    const first: unknown = scores[0];
    if (!isPlainRecord(first)) {
      return null;
    }
    const score = first["score"];
    return typeof score === "number" && Number.isFinite(score) ? score : null;
  };
  const candidateScores: Array<number | null> = [
    typeof overallCurrent === "number" && Number.isFinite(overallCurrent)
      ? overallCurrent
      : null,
    typeof overallScore === "number" && Number.isFinite(overallScore)
      ? overallScore
      : null,
    typeof screenAggregateScore === "number" &&
    Number.isFinite(screenAggregateScore)
      ? screenAggregateScore
      : null,
    firstScoreFromList(),
  ];
  const resolvedScore = candidateScores.find(
    (value): value is number => value !== null,
  );
  if (resolvedScore === undefined) {
    throw new Error(
      `composite-quality: visual last-run JSON at ${lastRunPath} does not contain a usable score.`,
    );
  }
  const failedFixtures = parsed["failedFixtures"];
  if (Array.isArray(failedFixtures) && failedFixtures.length > 0) {
    const failedCount = failedFixtures.length;
    const scores = parsed["scores"];
    const passedCount = Array.isArray(scores) ? scores.length : 0;
    if (passedCount === 0) {
      throw new Error(
        `composite-quality: visual last-run at ${lastRunPath} has ${String(failedCount)} failed fixture(s) and no passing scores — refusing to produce a composite score from a fully failed visual benchmark.`,
      );
    }
    // Partial failure (some fixtures passed, some failed): allow the score
    // but the composite-quality downstream will see the reduced overallCurrent.
    assertInRange0to100(resolvedScore, "visual overall score");
    return {
      overallScore: roundTo(resolvedScore, 2),
      ranAt: ranAtRaw,
      source: lastRunPath,
      warning: `${String(failedCount)} of ${String(failedCount + passedCount)} visual benchmark fixture(s) failed — score is based on ${String(passedCount)} passing fixture(s) only.`,
    };
  }
  assertInRange0to100(resolvedScore, "visual overall score");
  return {
    overallScore: roundTo(resolvedScore, 2),
    ranAt: ranAtRaw,
    source: lastRunPath,
  };
};

export const resolveCompositeQualityHistoryPath = (
  artifactRoot: string,
): string => {
  return path.join(
    artifactRoot,
    COMPOSITE_HISTORY_DIR_NAME,
    COMPOSITE_HISTORY_FILE_NAME,
  );
};

const parseHistoryEntry = (
  value: unknown,
  index: number,
): CompositeQualityHistoryEntry => {
  if (!isPlainRecord(value)) {
    throw new Error(
      `composite-quality: history entry[${String(index)}] must be an object.`,
    );
  }
  const runAt = value["runAt"];
  if (typeof runAt !== "string" || runAt.trim().length === 0) {
    throw new Error(
      `composite-quality: history entry[${String(index)}] runAt must be a non-empty string.`,
    );
  }
  const weightsRaw = value["weights"];
  if (!isPlainRecord(weightsRaw)) {
    throw new Error(
      `composite-quality: history entry[${String(index)}] weights must be an object.`,
    );
  }
  const visualWeight = weightsRaw["visual"];
  const performanceWeight = weightsRaw["performance"];
  if (
    typeof visualWeight !== "number" ||
    !Number.isFinite(visualWeight) ||
    typeof performanceWeight !== "number" ||
    !Number.isFinite(performanceWeight)
  ) {
    throw new Error(
      `composite-quality: history entry[${String(index)}] weights must contain finite visual/performance numbers.`,
    );
  }
  const parseNullableScore = (key: string): number | null => {
    const raw = value[key];
    if (raw === null) {
      return null;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(
        `composite-quality: history entry[${String(index)}] ${key} must be a finite number or null.`,
      );
    }
    return raw;
  };
  return {
    runAt,
    weights: { visual: visualWeight, performance: performanceWeight },
    visualScore: parseNullableScore("visualScore"),
    performanceScore: parseNullableScore("performanceScore"),
    compositeScore: parseNullableScore("compositeScore"),
  };
};

export const parseCompositeQualityHistory = (
  content: string,
): CompositeQualityHistory => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `composite-quality: history file is not valid JSON (${reason}).`,
    );
  }
  if (!isPlainRecord(parsed)) {
    throw new Error("composite-quality: history must be an object.");
  }
  if (parsed["version"] !== 1) {
    throw new Error("composite-quality: history version must be 1.");
  }
  if (!Array.isArray(parsed["entries"])) {
    throw new Error("composite-quality: history entries must be an array.");
  }
  const entries = parsed["entries"].map((entry: unknown, index: number) =>
    parseHistoryEntry(entry, index),
  );
  return { version: 1, entries };
};

export const loadCompositeQualityHistory = async (
  historyPath: string,
): Promise<CompositeQualityHistory | null> => {
  const loadFromPath = async (
    candidatePath: string,
  ): Promise<CompositeQualityHistory | null> => {
    try {
      const content = await readFile(candidatePath, "utf8");
      return parseCompositeQualityHistory(content);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  };

  try {
    const directHistory = await loadFromPath(historyPath);
    if (directHistory !== null) {
      return directHistory;
    }
    if (path.basename(historyPath) !== COMPOSITE_HISTORY_FILE_NAME) {
      return null;
    }
    return await loadFromPath(
      path.join(path.dirname(historyPath), LEGACY_COMPOSITE_HISTORY_FILE_NAME),
    );
  } catch (error: unknown) {
    throw error;
  }
};

export const saveCompositeQualityHistory = async (
  historyPath: string,
  history: CompositeQualityHistory,
): Promise<void> => {
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, toStableJsonString(history), "utf8");
};

export const appendCompositeQualityHistoryEntry = (
  history: CompositeQualityHistory | null,
  entry: CompositeQualityHistoryEntry,
  maxEntries: number = DEFAULT_COMPOSITE_QUALITY_HISTORY_SIZE,
): CompositeQualityHistory => {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(
      "composite-quality: maxEntries must be a positive integer.",
    );
  }
  if (maxEntries > MAX_COMPOSITE_QUALITY_HISTORY_SIZE) {
    throw new Error(
      `composite-quality: maxEntries must not exceed ${String(MAX_COMPOSITE_QUALITY_HISTORY_SIZE)}.`,
    );
  }
  if (typeof entry.runAt !== "string" || entry.runAt.trim().length === 0) {
    throw new Error(
      "composite-quality: history entry runAt must be a non-empty string.",
    );
  }
  const validateScore = (
    value: number | null,
    label: string,
  ): number | null => {
    if (value === null) {
      return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(
        `composite-quality: history entry ${label} must be a finite number or null.`,
      );
    }
    return value;
  };
  const normalized: CompositeQualityHistoryEntry = {
    runAt: entry.runAt,
    weights: {
      visual: entry.weights.visual,
      performance: entry.weights.performance,
    },
    visualScore: validateScore(entry.visualScore, "visualScore"),
    performanceScore: validateScore(entry.performanceScore, "performanceScore"),
    compositeScore: validateScore(entry.compositeScore, "compositeScore"),
  };
  const existing = history?.entries ?? [];
  const combined = [...existing, normalized];
  const trimmed =
    combined.length > maxEntries ? combined.slice(-maxEntries) : combined;
  return { version: 1, entries: trimmed };
};

export interface BuildCompositeQualityReportInput {
  visual: VisualScoreInput | null;
  performance: PerformanceScoreBreakdown | null;
  weights: CompositeQualityWeights;
  generatedAt?: string;
}

export const buildCompositeQualityReport = (
  input: BuildCompositeQualityReportInput,
): CompositeQualityReport => {
  const warnings: string[] = [];
  if (input.visual === null) {
    warnings.push("visual score missing");
  }
  if (input.performance === null) {
    warnings.push("performance breakdown missing");
  } else if (input.performance.warnings.length > 0) {
    for (const warning of input.performance.warnings) {
      warnings.push(`performance: ${warning}`);
    }
  }
  const visualScore = input.visual?.overallScore ?? null;
  const performanceScore = input.performance?.score ?? null;
  const composite = computeCompositeQualityScore(
    visualScore,
    performanceScore,
    input.weights,
  );
  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    weights: { ...input.weights },
    visual:
      input.visual === null
        ? null
        : {
            score: roundTo(input.visual.overallScore, 2),
            ranAt: input.visual.ranAt,
            source: input.visual.source,
          },
    performance:
      input.performance === null
        ? null
        : {
            score: input.performance.score,
            sampleCount: input.performance.sampleCount,
            samples: input.performance.samples.map((sample) => ({ ...sample })),
            aggregateMetrics: { ...input.performance.aggregateMetrics },
            warnings: [...input.performance.warnings],
          },
    composite,
    warnings,
  };
};

const verdictEmoji = (score: number | null): string => {
  if (score === null) {
    return ":grey_question:";
  }
  if (score >= 90) {
    return ":white_check_mark:";
  }
  if (score >= 70) {
    return ":warning:";
  }
  return ":x:";
};

const formatScoreOrDash = (value: number | null): string =>
  value === null ? "—" : String(value);

const formatMsOrDash = (value: number | null): string =>
  value === null ? "—" : `${String(Math.round(value))} ms`;

const formatUnitlessOrDash = (value: number | null, decimals = 3): string =>
  value === null ? "—" : roundTo(value, decimals).toFixed(decimals);

const formatPercent = (value: number): string =>
  `${String(Math.round(value * 100))}%`;

export const renderCompositeQualityMarkdown = (
  report: CompositeQualityReport,
): string => {
  const lines: string[] = [];
  lines.push(COMPOSITE_QUALITY_PR_COMMENT_MARKER);
  lines.push("## Combined Visual + Performance Quality");
  lines.push("");
  const compositeScore = report.composite.score;
  const weights = report.weights;
  lines.push(
    `${verdictEmoji(compositeScore)} **Composite Score:** ${formatScoreOrDash(compositeScore)} / 100 (weights: visual ${formatPercent(weights.visual)}, performance ${formatPercent(weights.performance)})`,
  );
  lines.push("");
  lines.push("| Dimension | Score | Weight |");
  lines.push("|-----------|-------|--------|");
  lines.push(
    `| Visual | ${formatScoreOrDash(report.visual?.score ?? null)} | ${formatPercent(weights.visual)} |`,
  );
  lines.push(
    `| Performance | ${formatScoreOrDash(report.performance?.score ?? null)} | ${formatPercent(weights.performance)} |`,
  );
  lines.push(
    `| **Composite** | **${formatScoreOrDash(compositeScore)}** | — |`,
  );
  lines.push("");

  if (report.performance !== null && report.performance.samples.length > 0) {
    lines.push(
      "<details><summary>Performance metrics (FCP / LCP / CLS / TBT / Speed Index)</summary>",
    );
    lines.push("");
    lines.push("| Profile | Route | FCP | LCP | CLS | TBT | SI |");
    lines.push("|---------|-------|-----|-----|-----|-----|----|");
    for (const sample of report.performance.samples) {
      lines.push(
        `| ${sample.profile} | ${sample.route} | ${formatMsOrDash(sample.fcp_ms)} | ${formatMsOrDash(sample.lcp_ms)} | ${formatUnitlessOrDash(sample.cls)} | ${formatMsOrDash(sample.tbt_ms)} | ${formatMsOrDash(sample.speed_index_ms)} |`,
      );
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (report.visual !== null) {
    lines.push(
      `Visual score source: ${report.visual.source} (ran ${report.visual.ranAt})`,
    );
  } else {
    lines.push("Visual score source: not available");
  }
  if (report.performance !== null) {
    lines.push(
      `Performance source: ${String(report.performance.sampleCount)} sample(s) aggregated`,
    );
  } else {
    lines.push("Performance source: not available");
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("### Warnings");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
  }

  lines.push("");
  lines.push(`_Explanation: ${report.composite.explanation}_`);

  return lines.join("\n");
};
