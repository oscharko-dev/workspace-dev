import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  loadVisualBenchmarkFixtureMetadata,
  assertAllowedFixtureId,
  getVisualBenchmarkFixtureRoot,
  listVisualBenchmarkFixtureIds,
  toStableJsonString,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";
import {
  executeVisualBenchmarkFixture,
  runVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureExecutionArtifacts,
} from "./visual-benchmark.execution.js";
import {
  applyVisualQualityConfigToReport,
  resolveVisualQualityRegressionConfig,
  resolveVisualQualityThresholds,
  checkVisualQualityThreshold,
  type VisualQualityScreenContext,
  type VisualQualityConfig,
  type VisualQualityResolvedRegressionConfig,
  type VisualQualityThresholdResult,
} from "./visual-quality-config.js";
import {
  appendVisualBenchmarkHistoryEntry,
  loadVisualBenchmarkHistory,
  saveVisualBenchmarkHistory,
  type VisualBenchmarkHistory,
} from "./visual-benchmark-history.js";
import {
  detectVisualBenchmarkRegression,
  formatVisualBenchmarkTrendSummaryBlock,
  type VisualBenchmarkRegressionDetectionResult,
  type VisualBenchmarkScoreCandidate,
  type VisualBenchmarkTrendSummary,
} from "./visual-benchmark-regression.js";
import type { KpiAlert } from "../src/parity/types-kpi.js";
import type { WorkspaceVisualQualityReport } from "../src/contracts/index.js";

const BASELINE_FILE_NAME = "baseline.json";
const LAST_RUN_FILE_NAME = "last-run.json";
const LAST_RUN_ARTIFACT_ROOT_NAME = "last-run";
const LAST_RUN_MANIFEST_FILE_NAME = "manifest.json";
const LAST_RUN_ACTUAL_FILE_NAME = "actual.png";
const LAST_RUN_DIFF_FILE_NAME = "diff.png";
const LAST_RUN_REPORT_FILE_NAME = "report.json";
const DEFAULT_ARTIFACT_ROOT = path.resolve(
  process.cwd(),
  "artifacts",
  "visual-benchmark",
);
const DEFAULT_NEUTRAL_DELTA_TOLERANCE = 1;

export interface VisualBenchmarkScoreEntry {
  fixtureId: string;
  score: number;
}

export interface VisualBenchmarkBaseline {
  version: 1 | 2;
  scores: VisualBenchmarkScoreEntry[];
  updatedAt?: string;
}

export interface VisualBenchmarkDelta {
  fixtureId: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  indicator: "improved" | "degraded" | "neutral" | "unavailable";
  thresholdResult?: VisualQualityThresholdResult;
}

export interface VisualBenchmarkResult {
  deltas: VisualBenchmarkDelta[];
  overallBaseline: number | null;
  overallCurrent: number;
  overallDelta: number | null;
  alerts: KpiAlert[];
  trendSummaries: VisualBenchmarkTrendSummary[];
}

export interface VisualBenchmarkLastRun {
  version: 1;
  ranAt: string;
  scores: VisualBenchmarkScoreEntry[];
}

export interface VisualBenchmarkLastRunArtifactManifest {
  version: 1;
  fixtureId: string;
  score: number;
  ranAt: string;
  viewport: {
    width: number;
    height: number;
  };
  thresholdResult?: VisualQualityThresholdResult;
}

export interface VisualBenchmarkLastRunArtifactPaths {
  fixtureDir: string;
  manifestJsonPath: string;
  actualPngPath: string;
  diffPngPath: string;
  reportJsonPath: string;
}

export interface VisualBenchmarkLastRunArtifactEntry extends VisualBenchmarkLastRunArtifactManifest {
  actualImagePath: string;
  diffImagePath: string | null;
  reportPath: string | null;
}

export interface VisualBenchmarkLastRunArtifactInput {
  fixtureId: string;
  score: number;
  ranAt: string;
  viewport: {
    width: number;
    height: number;
  };
  actualImageBuffer: Buffer;
  diffImageBuffer?: Buffer | null;
  report?: unknown | null;
  thresholdResult?: VisualQualityThresholdResult;
}

export interface VisualBenchmarkRunnerDependencies {
  runFixtureBenchmark?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkScoreEntry>;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureExecutionArtifacts>;
}

const resolveBaselinePath = (
  options?: VisualBenchmarkFixtureOptions,
): string => {
  const root = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  return path.join(root, BASELINE_FILE_NAME);
};

const resolveLastRunPath = (
  options?: VisualBenchmarkFixtureOptions,
): string => {
  return path.join(resolveArtifactRoot(options), LAST_RUN_FILE_NAME);
};

const resolveArtifactRoot = (options?: VisualBenchmarkFixtureOptions): string =>
  options?.artifactRoot ?? DEFAULT_ARTIFACT_ROOT;

const toWorkspaceRelativePath = (filePath: string): string =>
  path.relative(process.cwd(), filePath) || ".";

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

const sortScores = (
  scores: readonly VisualBenchmarkScoreEntry[],
): VisualBenchmarkScoreEntry[] =>
  [...scores]
    .map((entry) => ({
      fixtureId: assertAllowedFixtureId(entry.fixtureId),
      score: entry.score,
    }))
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));

const parseBaseline = (content: string): VisualBenchmarkBaseline => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected baseline to be an object.");
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error("Baseline version must be 1 or 2.");
  }
  if (!Array.isArray(parsed.scores)) {
    throw new Error("Baseline scores must be an array.");
  }

  const scores: VisualBenchmarkScoreEntry[] = [];
  for (const entry of parsed.scores) {
    if (!isPlainRecord(entry)) {
      throw new Error("Each baseline score entry must be an object.");
    }
    if (
      typeof entry.fixtureId !== "string" ||
      entry.fixtureId.trim().length === 0
    ) {
      throw new Error(
        "Baseline score entry fixtureId must be a non-empty string.",
      );
    }
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      throw new Error("Baseline score entry score must be a finite number.");
    }
    scores.push({
      fixtureId: entry.fixtureId,
      score: entry.score,
    });
  }

  if (parsed.version === 1) {
    if (
      typeof parsed.updatedAt !== "string" ||
      parsed.updatedAt.trim().length === 0
    ) {
      throw new Error("Baseline updatedAt must be a non-empty string.");
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt,
      scores: sortScores(scores),
    };
  }

  return {
    version: 2,
    scores: sortScores(scores),
  };
};

const parseLastRun = (content: string): VisualBenchmarkLastRun => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected last-run to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("Last-run version must be 1.");
  }
  if (typeof parsed.ranAt !== "string" || parsed.ranAt.trim().length === 0) {
    throw new Error("Last-run ranAt must be a non-empty string.");
  }
  if (!Array.isArray(parsed.scores)) {
    throw new Error("Last-run scores must be an array.");
  }

  const scores: VisualBenchmarkScoreEntry[] = [];
  for (const entry of parsed.scores) {
    if (!isPlainRecord(entry)) {
      throw new Error("Each last-run score entry must be an object.");
    }
    if (
      typeof entry.fixtureId !== "string" ||
      entry.fixtureId.trim().length === 0
    ) {
      throw new Error(
        "Last-run score entry fixtureId must be a non-empty string.",
      );
    }
    if (typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      throw new Error("Last-run score entry score must be a finite number.");
    }
    scores.push({
      fixtureId: entry.fixtureId,
      score: entry.score,
    });
  }

  return {
    version: 1,
    ranAt: parsed.ranAt,
    scores: sortScores(scores),
  };
};

const parseLastRunArtifactManifest = (
  content: string,
): VisualBenchmarkLastRunArtifactManifest => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected last-run artifact manifest to be an object.");
  }
  if (parsed.version !== 1) {
    throw new Error("Last-run artifact manifest version must be 1.");
  }
  if (
    typeof parsed.fixtureId !== "string" ||
    parsed.fixtureId.trim().length === 0
  ) {
    throw new Error("Last-run artifact fixtureId must be a non-empty string.");
  }
  if (typeof parsed.score !== "number" || !Number.isFinite(parsed.score)) {
    throw new Error("Last-run artifact score must be a finite number.");
  }
  if (typeof parsed.ranAt !== "string" || parsed.ranAt.trim().length === 0) {
    throw new Error("Last-run artifact ranAt must be a non-empty string.");
  }
  if (!isPlainRecord(parsed.viewport)) {
    throw new Error("Last-run artifact viewport must be an object.");
  }
  if (
    typeof parsed.viewport.width !== "number" ||
    !Number.isFinite(parsed.viewport.width) ||
    parsed.viewport.width <= 0
  ) {
    throw new Error(
      "Last-run artifact viewport.width must be a positive number.",
    );
  }
  if (
    typeof parsed.viewport.height !== "number" ||
    !Number.isFinite(parsed.viewport.height) ||
    parsed.viewport.height <= 0
  ) {
    throw new Error(
      "Last-run artifact viewport.height must be a positive number.",
    );
  }

  let thresholdResult: VisualQualityThresholdResult | undefined;
  if (isPlainRecord(parsed.thresholdResult)) {
    const thresholds = parsed.thresholdResult.thresholds;
    if (
      typeof parsed.thresholdResult.score !== "number" ||
      !Number.isFinite(parsed.thresholdResult.score) ||
      (parsed.thresholdResult.verdict !== "pass" &&
        parsed.thresholdResult.verdict !== "warn" &&
        parsed.thresholdResult.verdict !== "fail") ||
      !isPlainRecord(thresholds) ||
      typeof thresholds.warn !== "number" ||
      !Number.isFinite(thresholds.warn) ||
      (thresholds.fail !== undefined &&
        (typeof thresholds.fail !== "number" ||
          !Number.isFinite(thresholds.fail)))
    ) {
      throw new Error(
        "Last-run artifact thresholdResult must contain a valid score, verdict, and thresholds.",
      );
    }
    thresholdResult = {
      score: parsed.thresholdResult.score,
      verdict: parsed.thresholdResult.verdict,
      thresholds: {
        warn: thresholds.warn,
        ...(thresholds.fail !== undefined ? { fail: thresholds.fail } : {}),
      },
    };
  }

  return {
    version: 1,
    fixtureId: assertAllowedFixtureId(parsed.fixtureId),
    score: parsed.score,
    ranAt: parsed.ranAt,
    viewport: {
      width: parsed.viewport.width,
      height: parsed.viewport.height,
    },
    ...(thresholdResult !== undefined ? { thresholdResult } : {}),
  };
};

export const resolveVisualBenchmarkLastRunArtifactPaths = (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkLastRunArtifactPaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const fixtureDir = path.join(
    resolveArtifactRoot(options),
    LAST_RUN_ARTIFACT_ROOT_NAME,
    normalizedFixtureId,
  );
  return {
    fixtureDir,
    manifestJsonPath: path.join(fixtureDir, LAST_RUN_MANIFEST_FILE_NAME),
    actualPngPath: path.join(fixtureDir, LAST_RUN_ACTUAL_FILE_NAME),
    diffPngPath: path.join(fixtureDir, LAST_RUN_DIFF_FILE_NAME),
    reportJsonPath: path.join(fixtureDir, LAST_RUN_REPORT_FILE_NAME),
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

export const saveVisualBenchmarkBaselineScores = async (
  scores: readonly VisualBenchmarkScoreEntry[],
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const baselinePath = resolveBaselinePath(options);
  const baseline: VisualBenchmarkBaseline = {
    version: 2,
    scores: sortScores(scores),
  };
  await writeFile(baselinePath, toStableJsonString(baseline), "utf8");
};

export const saveVisualBenchmarkBaseline = async (
  result: VisualBenchmarkResult,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  await saveVisualBenchmarkBaselineScores(
    result.deltas.map((delta) => ({
      fixtureId: delta.fixtureId,
      score: delta.current,
    })),
    options,
  );
};

export const saveVisualBenchmarkLastRun = async (
  scores: VisualBenchmarkScoreEntry[],
  options?: VisualBenchmarkFixtureOptions,
  ranAt?: string,
): Promise<void> => {
  const lastRunPath = resolveLastRunPath(options);
  const lastRun: VisualBenchmarkLastRun = {
    version: 1,
    ranAt: ranAt ?? new Date().toISOString(),
    scores: sortScores(scores),
  };
  await mkdir(path.dirname(lastRunPath), { recursive: true });
  await writeFile(lastRunPath, toStableJsonString(lastRun), "utf8");
};

export const loadVisualBenchmarkLastRun = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRun | null> => {
  const lastRunPath = resolveLastRunPath(options);
  try {
    const content = await readFile(lastRunPath, "utf8");
    return parseLastRun(content);
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

export const saveVisualBenchmarkLastRunArtifact = async (
  input: VisualBenchmarkLastRunArtifactInput,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry> => {
  const paths = resolveVisualBenchmarkLastRunArtifactPaths(
    input.fixtureId,
    options,
  );
  const manifest: VisualBenchmarkLastRunArtifactManifest = {
    version: 1,
    fixtureId: assertAllowedFixtureId(input.fixtureId),
    score: input.score,
    ranAt: input.ranAt,
    viewport: {
      width: input.viewport.width,
      height: input.viewport.height,
    },
    ...(input.thresholdResult !== undefined
      ? { thresholdResult: input.thresholdResult }
      : {}),
  };

  await mkdir(paths.fixtureDir, { recursive: true });
  await writeFile(paths.actualPngPath, input.actualImageBuffer);
  if (input.diffImageBuffer !== undefined && input.diffImageBuffer !== null) {
    await writeFile(paths.diffPngPath, input.diffImageBuffer);
  }
  if (input.report !== undefined && input.report !== null) {
    await writeFile(
      paths.reportJsonPath,
      toStableJsonString(input.report),
      "utf8",
    );
  }
  await writeFile(paths.manifestJsonPath, toStableJsonString(manifest), "utf8");

  return {
    ...manifest,
    actualImagePath: toWorkspaceRelativePath(paths.actualPngPath),
    diffImagePath:
      input.diffImageBuffer !== undefined && input.diffImageBuffer !== null
        ? toWorkspaceRelativePath(paths.diffPngPath)
        : null,
    reportPath:
      input.report !== undefined && input.report !== null
        ? toWorkspaceRelativePath(paths.reportJsonPath)
        : null,
  };
};

export const loadVisualBenchmarkLastRunArtifact = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry | null> => {
  const paths = resolveVisualBenchmarkLastRunArtifactPaths(fixtureId, options);
  try {
    const manifest = parseLastRunArtifactManifest(
      await readFile(paths.manifestJsonPath, "utf8"),
    );
    let diffImagePath: string | null = null;
    let reportPath: string | null = null;
    try {
      await readFile(paths.diffPngPath);
      diffImagePath = toWorkspaceRelativePath(paths.diffPngPath);
    } catch (error: unknown) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }
    try {
      await readFile(paths.reportJsonPath, "utf8");
      reportPath = toWorkspaceRelativePath(paths.reportJsonPath);
    } catch (error: unknown) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        )
      ) {
        throw error;
      }
    }

    return {
      ...manifest,
      actualImagePath: toWorkspaceRelativePath(paths.actualPngPath),
      diffImagePath,
      reportPath,
    };
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

const isWorkspaceVisualQualityReport = (
  value: unknown,
): value is WorkspaceVisualQualityReport => {
  return typeof value === "object" && value !== null && "status" in value;
};

const loadVisualQualityScreenContext = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualQualityScreenContext> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  return {
    screenId: metadata.source.nodeId,
    screenName: metadata.source.nodeName,
  };
};

export const computeVisualBenchmarkScores = async (
  options?: VisualBenchmarkExecutionOptions,
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkScoreEntry[]> => {
  const fixtureIds = await listVisualBenchmarkFixtureIds(options);
  const scores: VisualBenchmarkScoreEntry[] = [];
  const runFixtureBenchmark =
    dependencies?.runFixtureBenchmark ??
    (async (
      fixtureId: string,
      fixtureOptions?: VisualBenchmarkExecutionOptions,
    ) => runVisualBenchmarkFixture(fixtureId, fixtureOptions));

  for (const fixtureId of fixtureIds) {
    scores.push(await runFixtureBenchmark(fixtureId, options));
  }

  return sortScores(scores);
};

export interface ComputeVisualBenchmarkDeltasOptions {
  neutralTolerance?: number;
}

export const computeVisualBenchmarkDeltas = (
  current: VisualBenchmarkScoreEntry[],
  baseline: VisualBenchmarkBaseline | null,
  deltaOptions?: ComputeVisualBenchmarkDeltasOptions,
): VisualBenchmarkResult => {
  if (current.length === 0) {
    throw new Error("Current visual benchmark scores must not be empty.");
  }

  const neutralTolerance =
    deltaOptions?.neutralTolerance ?? DEFAULT_NEUTRAL_DELTA_TOLERANCE;
  if (!Number.isFinite(neutralTolerance) || neutralTolerance < 0) {
    throw new Error("neutralTolerance must be a non-negative finite number.");
  }

  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(entry.fixtureId, entry.score);
    }
  }

  const matchedPairs: Array<{ current: number; baseline: number }> = [];
  const deltas: VisualBenchmarkDelta[] = current.map((entry) => {
    const baselineScore = baselineMap.get(entry.fixtureId) ?? null;
    const delta =
      baselineScore !== null
        ? roundToTwoDecimals(entry.score - baselineScore)
        : null;
    let indicator: "improved" | "degraded" | "neutral" | "unavailable";
    if (delta === null) {
      indicator = "unavailable";
    } else if (Math.abs(delta) <= neutralTolerance) {
      indicator = "neutral";
    } else if (delta > 0) {
      indicator = "improved";
    } else {
      indicator = "degraded";
    }
    if (baselineScore !== null) {
      matchedPairs.push({
        current: entry.score,
        baseline: baselineScore,
      });
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

  const matchedCount = matchedPairs.length;
  const overallBaseline =
    matchedCount > 0
      ? roundToTwoDecimals(
          matchedPairs.reduce((sum, pair) => sum + pair.baseline, 0) /
            matchedCount,
        )
      : null;
  const overallComparableCurrent =
    matchedCount > 0
      ? roundToTwoDecimals(
          matchedPairs.reduce((sum, pair) => sum + pair.current, 0) /
            matchedCount,
        )
      : null;
  const overallDelta =
    overallComparableCurrent !== null && overallBaseline !== null
      ? roundToTwoDecimals(overallComparableCurrent - overallBaseline)
      : null;

  return {
    deltas,
    overallBaseline,
    overallCurrent,
    overallDelta,
    alerts: [],
    trendSummaries: [],
  };
};

const padRight = (value: string, width: number): string =>
  value + " ".repeat(Math.max(0, width - value.length));

const padLeft = (value: string, width: number): string =>
  " ".repeat(Math.max(0, width - value.length)) + value;

const formatDeltaCell = (
  delta: number | null,
  indicator: "improved" | "degraded" | "neutral" | "unavailable",
): string => {
  if (delta === null) {
    return indicator === "unavailable" ? "\u2014 n/a" : "\u2014 \u2796";
  }
  const sign = delta > 0 ? "+" : "";
  const emoji =
    indicator === "improved"
      ? " \u2705"
      : indicator === "degraded"
        ? " \u26A0\uFE0F"
        : " \u2796";
  return `${sign}${String(delta)}${emoji}`;
};

export const formatVisualBenchmarkTable = (
  result: VisualBenchmarkResult,
): string => {
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

  const hr = (
    left: string,
    mid: string,
    right: string,
    fill: string,
  ): string => {
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
  const overallDeltaStr =
    result.overallDelta !== null
      ? `${result.overallDelta > 0 ? "+" : ""}${String(result.overallDelta)}`
      : "\u2014";

  lines.push(
    `\u2502 ${padRight("Overall Average", viewCol)} \u2502 ${padLeft(overallBaselineStr, baselineCol)} \u2502 ${padLeft(overallCurrentStr, currentCol)} \u2502 ${padRight(overallDeltaStr, deltaCol)} \u2502`,
  );
  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500"));

  return lines.join("\n");
};

export const runVisualBenchmark = async (
  options?: VisualBenchmarkExecutionOptions & {
    updateBaseline?: boolean;
    qualityConfig?: VisualQualityConfig;
  },
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkResult> => {
  const runAt = new Date().toISOString();
  let scores: VisualBenchmarkScoreEntry[];
  const fixtureScreenContexts = new Map<string, VisualQualityScreenContext>();
  const artifactEntries: VisualBenchmarkLastRunArtifactInput[] = [];

  if (
    dependencies?.runFixtureBenchmark !== undefined &&
    dependencies.executeFixture === undefined
  ) {
    scores = await computeVisualBenchmarkScores(options, dependencies);
  } else {
    const fixtureIds = await listVisualBenchmarkFixtureIds(options);
    const executeFixture =
      dependencies?.executeFixture ??
      (async (
        fixtureId: string,
        fixtureOptions?: VisualBenchmarkExecutionOptions,
      ) => executeVisualBenchmarkFixture(fixtureId, fixtureOptions));

    scores = [];
    for (const fixtureId of fixtureIds) {
      const result = await executeFixture(fixtureId, options);
      const screenContext =
        options?.qualityConfig !== undefined
          ? await loadVisualQualityScreenContext(result.fixtureId, options)
          : undefined;
      if (screenContext !== undefined) {
        fixtureScreenContexts.set(result.fixtureId, screenContext);
      }
      const patchedReport = isWorkspaceVisualQualityReport(result.report)
        ? applyVisualQualityConfigToReport(
            result.report,
            options?.qualityConfig,
          )
        : result.report;
      const patchedScore =
        isWorkspaceVisualQualityReport(patchedReport) &&
        typeof patchedReport.overallScore === "number"
          ? patchedReport.overallScore
          : result.score;
      scores.push({
        fixtureId: result.fixtureId,
        score: patchedScore,
      });
      artifactEntries.push({
        fixtureId: result.fixtureId,
        score: patchedScore,
        ranAt: runAt,
        viewport: result.viewport,
        actualImageBuffer: result.screenshotBuffer,
        diffImageBuffer: result.diffBuffer,
        report: patchedReport,
      });
    }
    scores = sortScores(scores);
  }

  await saveVisualBenchmarkLastRun(scores, options, runAt);
  const baseline = await loadVisualBenchmarkBaseline(options);
  const qualityConfig = options?.qualityConfig;
  const regressionConfig = resolveVisualQualityRegressionConfig(qualityConfig);
  const result = computeVisualBenchmarkDeltas(scores, baseline, {
    neutralTolerance: regressionConfig.neutralTolerance,
  });

  // Run regression detection (delta-based alerts + trend summaries)
  const regressionDetection = detectVisualBenchmarkRegression(
    result.deltas.map((delta) => ({
      fixtureId: delta.fixtureId,
      current: delta.current,
      baseline: delta.baseline,
    })),
    {
      maxScoreDropPercent: regressionConfig.maxScoreDropPercent,
      neutralTolerance: regressionConfig.neutralTolerance,
    },
  );
  result.alerts = regressionDetection.alerts;
  result.trendSummaries = regressionDetection.summaries;

  // Apply quality config thresholds if config is present
  if (qualityConfig) {
    for (const delta of result.deltas) {
      let screenContext = fixtureScreenContexts.get(delta.fixtureId);
      if (screenContext === undefined) {
        screenContext = await loadVisualQualityScreenContext(
          delta.fixtureId,
          options,
        );
        fixtureScreenContexts.set(delta.fixtureId, screenContext);
      }
      const thresholds = resolveVisualQualityThresholds(
        qualityConfig,
        delta.fixtureId,
        screenContext,
      );
      delta.thresholdResult = checkVisualQualityThreshold(
        delta.current,
        thresholds,
      );
    }
  }

  if (artifactEntries.length > 0) {
    for (const artifactEntry of artifactEntries) {
      const delta = result.deltas.find(
        (entry) => entry.fixtureId === artifactEntry.fixtureId,
      );
      await saveVisualBenchmarkLastRunArtifact(
        {
          ...artifactEntry,
          thresholdResult: delta?.thresholdResult,
        },
        options,
      );
    }
  }

  const table = formatVisualBenchmarkTable(result);
  process.stdout.write(`${table}\n`);

  // Emit per-fixture trend summary block
  const trendBlock = formatVisualBenchmarkTrendSummaryBlock(
    result.trendSummaries,
  );
  if (trendBlock.length > 0) {
    process.stdout.write(`\n${trendBlock}\n`);
  }

  // Emit regression alerts, if any
  if (result.alerts.length > 0) {
    const alertLines = result.alerts.map(
      (alert) => `  \u26A0\uFE0F ${alert.code}: ${alert.message}`,
    );
    process.stdout.write(
      `\n${String(result.alerts.length)} visual quality regression alert(s):\n${alertLines.join("\n")}\n`,
    );
  }

  if (qualityConfig) {
    const failedFixtures = result.deltas.filter(
      (d) => d.thresholdResult?.verdict === "fail",
    );
    const warnedFixtures = result.deltas.filter(
      (d) => d.thresholdResult?.verdict === "warn",
    );
    if (failedFixtures.length > 0) {
      process.stdout.write(
        `\n\u274C ${failedFixtures.length} fixture(s) below fail threshold: ${failedFixtures.map((d) => d.fixtureId).join(", ")}\n`,
      );
    }
    if (warnedFixtures.length > 0) {
      process.stdout.write(
        `\u26A0\uFE0F ${warnedFixtures.length} fixture(s) below warn threshold: ${warnedFixtures.map((d) => d.fixtureId).join(", ")}\n`,
      );
    }
    if (failedFixtures.length === 0 && warnedFixtures.length === 0) {
      process.stdout.write(`\n\u2705 All fixtures pass quality thresholds.\n`);
    }
  }

  if (options?.updateBaseline === true) {
    await saveVisualBenchmarkBaselineScores(scores, options);
    process.stdout.write("Baseline updated.\n");
    const existingHistory = await loadVisualBenchmarkHistory(options);
    const updatedHistory = appendVisualBenchmarkHistoryEntry(
      existingHistory,
      {
        runAt,
        scores: scores.map((entry) => ({
          fixtureId: entry.fixtureId,
          score: entry.score,
        })),
      },
      regressionConfig.historySize,
    );
    await saveVisualBenchmarkHistory(updatedHistory, options);
    process.stdout.write(
      `History updated (${String(updatedHistory.entries.length)} entries).\n`,
    );
  }

  return result;
};
