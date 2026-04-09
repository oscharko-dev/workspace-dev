import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getVisualBenchmarkFixtureRoot,
  listVisualBenchmarkFixtureIds,
  toStableJsonString,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";
import {
  runVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
} from "./visual-benchmark.execution.js";

const BASELINE_FILE_NAME = "baseline.json";
const NEUTRAL_DELTA_TOLERANCE = 1;

export interface VisualBenchmarkScoreEntry {
  fixtureId: string;
  score: number;
}

export interface VisualBenchmarkBaseline {
  version: 1;
  updatedAt: string;
  scores: VisualBenchmarkScoreEntry[];
}

export interface VisualBenchmarkDelta {
  fixtureId: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  indicator: "improved" | "degraded" | "neutral";
}

export interface VisualBenchmarkResult {
  deltas: VisualBenchmarkDelta[];
  overallBaseline: number | null;
  overallCurrent: number;
  overallDelta: number | null;
}

export interface VisualBenchmarkRunnerDependencies {
  runFixtureBenchmark?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkScoreEntry>;
}

const resolveBaselinePath = (options?: VisualBenchmarkFixtureOptions): string => {
  const root = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  return path.join(root, BASELINE_FILE_NAME);
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const fixtureIdToDisplayName = (fixtureId: string): string => {
  return fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const roundToTwoDecimals = (value: number): number =>
  Math.round(value * 100) / 100;

const parseBaseline = (content: string): VisualBenchmarkBaseline => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected baseline to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("Baseline version must be 1.");
  }
  if (typeof parsed.updatedAt !== "string" || parsed.updatedAt.trim().length === 0) {
    throw new Error("Baseline updatedAt must be a non-empty string.");
  }
  if (!Array.isArray(parsed.scores)) {
    throw new Error("Baseline scores must be an array.");
  }
  const scores: VisualBenchmarkScoreEntry[] = [];
  for (const entry of parsed.scores) {
    if (!isPlainRecord(entry)) {
      throw new Error("Each baseline score entry must be an object.");
    }
    if (typeof entry.fixtureId !== "string" || entry.fixtureId.trim().length === 0) {
      throw new Error("Baseline score entry fixtureId must be a non-empty string.");
    }
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      throw new Error("Baseline score entry score must be a finite number.");
    }
    scores.push({
      fixtureId: entry.fixtureId,
      score: entry.score,
    });
  }
  return {
    version: 1,
    updatedAt: parsed.updatedAt,
    scores,
  };
};

export const loadVisualBenchmarkBaseline = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkBaseline | null> => {
  const baselinePath = resolveBaselinePath(options);
  try {
    const content = await readFile(baselinePath, "utf8");
    return parseBaseline(content);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const saveVisualBenchmarkBaseline = async (
  result: VisualBenchmarkResult,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const baselinePath = resolveBaselinePath(options);
  const baseline: VisualBenchmarkBaseline = {
    version: 1,
    updatedAt: new Date().toISOString(),
    scores: result.deltas.map((delta) => ({
      fixtureId: delta.fixtureId,
      score: delta.current,
    })),
  };
  await writeFile(baselinePath, toStableJsonString(baseline), "utf8");
};

export const computeVisualBenchmarkScores = async (
  options?: VisualBenchmarkExecutionOptions,
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkScoreEntry[]> => {
  const fixtureIds = await listVisualBenchmarkFixtureIds(options);
  const scores: VisualBenchmarkScoreEntry[] = [];
  const runFixtureBenchmark =
    dependencies?.runFixtureBenchmark ??
    (async (fixtureId: string, fixtureOptions?: VisualBenchmarkExecutionOptions) =>
      runVisualBenchmarkFixture(fixtureId, fixtureOptions));

  for (const fixtureId of fixtureIds) {
    scores.push(await runFixtureBenchmark(fixtureId, options));
  }

  return scores;
};

export const computeVisualBenchmarkDeltas = (
  current: VisualBenchmarkScoreEntry[],
  baseline: VisualBenchmarkBaseline | null,
): VisualBenchmarkResult => {
  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(entry.fixtureId, entry.score);
    }
  }

  const deltas: VisualBenchmarkDelta[] = current.map((entry) => {
    const baselineScore = baselineMap.get(entry.fixtureId) ?? null;
    const delta = baselineScore !== null ? roundToTwoDecimals(entry.score - baselineScore) : null;
    let indicator: "improved" | "degraded" | "neutral";
    if (delta === null || Math.abs(delta) <= NEUTRAL_DELTA_TOLERANCE) {
      indicator = "neutral";
    } else if (delta > 0) {
      indicator = "improved";
    } else {
      indicator = "degraded";
    }
    return {
      fixtureId: entry.fixtureId,
      baseline: baselineScore,
      current: entry.score,
      delta,
      indicator,
    };
  });

  const overallCurrent = roundToTwoDecimals(
    current.reduce((sum, entry) => sum + entry.score, 0) / current.length,
  );

  let overallBaseline: number | null = null;
  if (baseline !== null && baseline.scores.length > 0) {
    overallBaseline = roundToTwoDecimals(
      baseline.scores.reduce((sum, entry) => sum + entry.score, 0) / baseline.scores.length,
    );
  }

  const overallDelta = overallBaseline !== null ? roundToTwoDecimals(overallCurrent - overallBaseline) : null;

  return {
    deltas,
    overallBaseline,
    overallCurrent,
    overallDelta,
  };
};

const padRight = (value: string, width: number): string => {
  return value + " ".repeat(Math.max(0, width - value.length));
};

const padLeft = (value: string, width: number): string => {
  return " ".repeat(Math.max(0, width - value.length)) + value;
};

const formatDeltaCell = (delta: number | null, indicator: "improved" | "degraded" | "neutral"): string => {
  if (delta === null) {
    return "\u2014 \u2796";
  }
  const sign = delta > 0 ? "+" : "";
  const emoji = indicator === "improved" ? " \u2705" : indicator === "degraded" ? " \u26A0\uFE0F" : " \u2796";
  return `${sign}${String(delta)}${emoji}`;
};

export const formatVisualBenchmarkTable = (result: VisualBenchmarkResult): string => {
  const viewCol = 23;
  const baselineCol = 8;
  const currentCol = 8;
  const deltaCol = 6;

  const formatScore = (score: number | null): string => {
    if (score === null) {
      return "\u2014";
    }
    return String(score);
  };

  const hr = (left: string, mid: string, right: string, fill: string): string => {
    return `${left}${fill.repeat(viewCol + 2)}${mid}${fill.repeat(baselineCol + 2)}${mid}${fill.repeat(currentCol + 2)}${mid}${fill.repeat(deltaCol + 2)}${right}`;
  };

  const lines: string[] = [];
  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500"));
  lines.push(
    `\u2502 ${padRight("View", viewCol)} \u2502 ${padRight("Baseline", baselineCol)} \u2502 ${padRight("Current", currentCol)} \u2502 ${padRight("Delta", deltaCol)} \u2502`,
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500"));

  for (const delta of result.deltas) {
    const displayName = fixtureIdToDisplayName(delta.fixtureId);
    const baselineStr = formatScore(delta.baseline);
    const currentStr = String(delta.current);
    const deltaStr = formatDeltaCell(delta.delta, delta.indicator);

    lines.push(
      `\u2502 ${padRight(displayName, viewCol)} \u2502 ${padLeft(baselineStr, baselineCol)} \u2502 ${padLeft(currentStr, currentCol)} \u2502 ${padRight(deltaStr, deltaCol)} \u2502`,
    );
  }

  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500"));

  const overallBaselineStr = formatScore(result.overallBaseline);
  const overallCurrentStr = String(result.overallCurrent);
  const overallDeltaStr = result.overallDelta !== null
    ? `${result.overallDelta > 0 ? "+" : ""}${String(result.overallDelta)}`
    : "\u2014";

  lines.push(
    `\u2502 ${padRight("Overall Average", viewCol)} \u2502 ${padLeft(overallBaselineStr, baselineCol)} \u2502 ${padLeft(overallCurrentStr, currentCol)} \u2502 ${padRight(overallDeltaStr, deltaCol)} \u2502`,
  );
  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500"));

  return lines.join("\n");
};

export const runVisualBenchmark = async (
  options?: VisualBenchmarkExecutionOptions & { updateBaseline?: boolean },
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkResult> => {
  const scores = await computeVisualBenchmarkScores(options, dependencies);
  const baseline = await loadVisualBenchmarkBaseline(options);
  const result = computeVisualBenchmarkDeltas(scores, baseline);
  const table = formatVisualBenchmarkTable(result);
  process.stdout.write(`${table}\n`);

  if (options?.updateBaseline === true) {
    await saveVisualBenchmarkBaseline(result, options);
    process.stdout.write("Baseline updated.\n");
  }

  return result;
};
