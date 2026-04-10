import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeVisualBenchmarkAggregateScore,
  loadVisualBenchmarkFixtureMetadata,
  assertAllowedFixtureId,
  assertAllowedScreenId,
  assertAllowedViewportId,
  enumerateFixtureScreens,
  enumerateFixtureScreenViewports,
  fromScreenIdToken,
  getVisualBenchmarkFixtureRoot,
  listVisualBenchmarkFixtureIds,
  toScreenIdToken,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
} from "./visual-benchmark.helpers.js";
import {
  executeVisualBenchmarkFixture,
  runVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureRunResult,
  type VisualBenchmarkFixtureScreenArtifact,
} from "./visual-benchmark.execution.js";
import {
  applyVisualQualityConfigToReport,
  normalizeVisualQualityViewportWeights,
  resolveVisualQualityViewports,
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
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
  score: number;
}

export interface VisualBenchmarkBaseline {
  version: 1 | 2 | 3;
  scores: VisualBenchmarkScoreEntry[];
  updatedAt?: string;
}

export interface VisualBenchmarkDelta {
  fixtureId: string;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
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
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
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

interface VisualBenchmarkArtifactLocation {
  screenId?: string;
  viewportId?: string;
}

export interface VisualBenchmarkLastRunArtifactEntry extends VisualBenchmarkLastRunArtifactManifest {
  actualImagePath: string;
  diffImagePath: string | null;
  reportPath: string | null;
}

export interface VisualBenchmarkLastRunArtifactInput {
  fixtureId: string;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
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

export interface VisualBenchmarkFixtureScreenScoreLike {
  screenId?: string;
  screenName?: string;
  viewports?: Array<{
    viewportId?: string;
    viewportLabel?: string;
    score: number;
  }>;
  score: number;
}

export interface VisualBenchmarkFixtureRunResultLike {
  fixtureId: string;
  aggregateScore: number;
  screens: VisualBenchmarkFixtureScreenScoreLike[];
}

export interface VisualBenchmarkRunnerDependencies {
  runFixtureBenchmark?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureRunResultLike>;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureRunResult>;
}

export interface VisualBenchmarkScreenAggregateEntry {
  fixtureId: string;
  screenId: string;
  score: number;
}

/**
 * Arithmetic mean of per-screen scores. Empty input throws (undefined behavior).
 * Rounded to 2 decimals to match the rest of the runner's score precision.
 */
export const computeFixtureAggregate = (
  screens: readonly { score: number; weight?: number }[],
): number => {
  return computeVisualBenchmarkAggregateScore(screens);
};

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

const normalizeOptionalScreenName = (
  screenName: string | undefined,
): string | undefined => {
  if (typeof screenName !== "string") {
    return undefined;
  }
  const normalized = screenName.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const getScreenAggregateKey = (fixtureId: string, screenId?: string): string => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const normalizedScreenId =
    typeof screenId === "string" && screenId.trim().length > 0
      ? assertAllowedScreenId(screenId.trim())
      : normalizedFixtureId;
  return `${normalizedFixtureId}::${normalizedScreenId}`;
};

const buildScreenAggregateMapFromScores = (
  scores: readonly VisualBenchmarkScoreEntry[],
): Map<string, VisualBenchmarkScreenAggregateEntry> => {
  const grouped = new Map<string, { fixtureId: string; screenId: string; scores: number[] }>();
  for (const entry of scores) {
    const canonical = toCanonicalScoreEntry(entry);
    const screenId =
      typeof canonical.screenId === "string" && canonical.screenId.length > 0
        ? canonical.screenId
        : canonical.fixtureId;
    const key = getScreenAggregateKey(canonical.fixtureId, screenId);
    const existing = grouped.get(key);
    if (existing === undefined) {
      grouped.set(key, {
        fixtureId: canonical.fixtureId,
        screenId,
        scores: [canonical.score],
      });
      continue;
    }
    existing.scores.push(canonical.score);
  }
  const aggregateMap = new Map<string, VisualBenchmarkScreenAggregateEntry>();
  for (const [key, group] of grouped.entries()) {
    const average =
      group.scores.length > 0
        ? roundToTwoDecimals(
            group.scores.reduce((sum, score) => sum + score, 0) /
              group.scores.length,
          )
        : 0;
    aggregateMap.set(key, {
      fixtureId: group.fixtureId,
      screenId: group.screenId,
      score: average,
    });
  }
  return aggregateMap;
};

const buildScreenAggregateMapFromEntries = (
  entries:
    | readonly VisualBenchmarkScreenAggregateEntry[]
    | undefined,
): Map<string, VisualBenchmarkScreenAggregateEntry> => {
  const aggregateMap = new Map<string, VisualBenchmarkScreenAggregateEntry>();
  if (entries === undefined) {
    return aggregateMap;
  }
  for (const entry of entries) {
    const key = getScreenAggregateKey(entry.fixtureId, entry.screenId);
    aggregateMap.set(key, {
      fixtureId: assertAllowedFixtureId(entry.fixtureId),
      screenId:
        typeof entry.screenId === "string" && entry.screenId.trim().length > 0
          ? assertAllowedScreenId(entry.screenId.trim())
          : assertAllowedFixtureId(entry.fixtureId),
      score: entry.score,
    });
  }
  return aggregateMap;
};

const toCanonicalScoreEntry = (
  entry: VisualBenchmarkScoreEntry,
): VisualBenchmarkScoreEntry => {
  const fixtureId = assertAllowedFixtureId(entry.fixtureId);
  const screenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : fixtureId;
  const screenName = normalizeOptionalScreenName(entry.screenName);
  const viewportId =
    typeof entry.viewportId === "string" && entry.viewportId.trim().length > 0
      ? entry.viewportId.trim()
      : undefined;
  const viewportLabel =
    typeof entry.viewportLabel === "string" &&
    entry.viewportLabel.trim().length > 0
      ? entry.viewportLabel.trim()
      : undefined;

  return {
    fixtureId,
    screenId,
    ...(screenName !== undefined ? { screenName } : {}),
    ...(viewportId !== undefined ? { viewportId } : {}),
    ...(viewportLabel !== undefined ? { viewportLabel } : {}),
    score: entry.score,
  };
};

export const getVisualBenchmarkScoreKey = (
  entry: Pick<
    VisualBenchmarkScoreEntry,
    "fixtureId" | "screenId" | "viewportId"
  >,
): string => {
  const fixtureId = assertAllowedFixtureId(entry.fixtureId);
  const screenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : fixtureId;
  const viewportId =
    typeof entry.viewportId === "string" && entry.viewportId.trim().length > 0
      ? entry.viewportId.trim()
      : "default";
  return `${fixtureId}::${screenId}::${viewportId}`;
};

const sortScores = (
  scores: readonly VisualBenchmarkScoreEntry[],
): VisualBenchmarkScoreEntry[] =>
  [...scores]
    .map((entry) => toCanonicalScoreEntry(entry))
    .sort((left, right) => {
      const fixtureComparison = left.fixtureId.localeCompare(right.fixtureId);
      if (fixtureComparison !== 0) {
        return fixtureComparison;
      }

      const screenComparison = left.screenId!.localeCompare(right.screenId!);
      if (screenComparison !== 0) {
        return screenComparison;
      }

      const viewportComparison = (left.viewportId ?? "").localeCompare(
        right.viewportId ?? "",
      );
      if (viewportComparison !== 0) {
        return viewportComparison;
      }

      return (left.screenName ?? "").localeCompare(right.screenName ?? "");
    });

const sortRawScores = (
  scores: readonly VisualBenchmarkScoreEntry[],
): VisualBenchmarkScoreEntry[] =>
  [...scores].sort((left, right) => {
    const fixtureComparison = left.fixtureId.localeCompare(right.fixtureId);
    if (fixtureComparison !== 0) {
      return fixtureComparison;
    }

    const screenComparison = (left.screenId ?? "").localeCompare(
      right.screenId ?? "",
    );
    if (screenComparison !== 0) {
      return screenComparison;
    }

    const viewportComparison = (left.viewportId ?? "").localeCompare(
      right.viewportId ?? "",
    );
    if (viewportComparison !== 0) {
      return viewportComparison;
    }

    return (left.screenName ?? "").localeCompare(right.screenName ?? "");
  });

const parseBaseline = (content: string): VisualBenchmarkBaseline => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected baseline to be an object.");
  }
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
    throw new Error("Baseline version must be 1, 2, or 3.");
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

    let screenId: string | undefined;
    let screenName: string | undefined;
    let viewportId: string | undefined;
    let viewportLabel: string | undefined;
    if (parsed.version === 3) {
      if (
        typeof entry.screenId !== "string" ||
        entry.screenId.trim().length === 0
      ) {
        throw new Error(
          "Baseline version 3 score entry screenId must be a non-empty string.",
        );
      }
      screenId = entry.screenId.trim();
      if (entry.screenName !== undefined) {
        if (
          typeof entry.screenName !== "string" ||
          entry.screenName.trim().length === 0
        ) {
          throw new Error(
            "Baseline version 3 score entry screenName must be a non-empty string when provided.",
          );
        }
        screenName = entry.screenName.trim();
      }
      if (entry.viewportId !== undefined) {
        if (
          typeof entry.viewportId !== "string" ||
          entry.viewportId.trim().length === 0
        ) {
          throw new Error(
            "Baseline version 3 score entry viewportId must be a non-empty string when provided.",
          );
        }
        viewportId = assertAllowedViewportId(entry.viewportId.trim());
      }
      if (entry.viewportLabel !== undefined) {
        if (
          typeof entry.viewportLabel !== "string" ||
          entry.viewportLabel.trim().length === 0
        ) {
          throw new Error(
            "Baseline version 3 score entry viewportLabel must be a non-empty string when provided.",
          );
        }
        viewportLabel = entry.viewportLabel.trim();
      }
    }

    scores.push({
      fixtureId: entry.fixtureId,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(screenName !== undefined ? { screenName } : {}),
      ...(viewportId !== undefined ? { viewportId } : {}),
      ...(viewportLabel !== undefined ? { viewportLabel } : {}),
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
      scores: sortRawScores(scores),
    };
  }

  if (parsed.version === 3) {
    return {
      version: 3,
      scores: sortScores(scores),
    };
  }

  return {
    version: 2,
    scores: sortRawScores(scores),
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

    let screenId: string | undefined;
    let screenName: string | undefined;
    let viewportId: string | undefined;
    let viewportLabel: string | undefined;
    if (entry.screenId !== undefined) {
      if (
        typeof entry.screenId !== "string" ||
        entry.screenId.trim().length === 0
      ) {
        throw new Error(
          "Last-run score entry screenId must be a non-empty string when provided.",
        );
      }
      screenId = entry.screenId.trim();
    }
    if (entry.screenName !== undefined) {
      if (
        typeof entry.screenName !== "string" ||
        entry.screenName.trim().length === 0
      ) {
        throw new Error(
          "Last-run score entry screenName must be a non-empty string when provided.",
        );
      }
      screenName = entry.screenName.trim();
    }
    if (entry.viewportId !== undefined) {
      if (
        typeof entry.viewportId !== "string" ||
        entry.viewportId.trim().length === 0
      ) {
        throw new Error(
          "Last-run score entry viewportId must be a non-empty string when provided.",
        );
      }
      viewportId = assertAllowedViewportId(entry.viewportId.trim());
    }
    if (entry.viewportLabel !== undefined) {
      if (
        typeof entry.viewportLabel !== "string" ||
        entry.viewportLabel.trim().length === 0
      ) {
        throw new Error(
          "Last-run score entry viewportLabel must be a non-empty string when provided.",
        );
      }
      viewportLabel = entry.viewportLabel.trim();
    }
    scores.push({
      fixtureId: entry.fixtureId,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(screenName !== undefined ? { screenName } : {}),
      ...(viewportId !== undefined ? { viewportId } : {}),
      ...(viewportLabel !== undefined ? { viewportLabel } : {}),
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
  let screenId: string | undefined;
  let screenName: string | undefined;
  let viewportId: string | undefined;
  let viewportLabel: string | undefined;
  if (parsed.screenId !== undefined) {
    if (
      typeof parsed.screenId !== "string" ||
      parsed.screenId.trim().length === 0
    ) {
      throw new Error(
        "Last-run artifact screenId must be a non-empty string when provided.",
      );
    }
    screenId = assertAllowedScreenId(parsed.screenId.trim());
  }
  if (parsed.screenName !== undefined) {
    if (
      typeof parsed.screenName !== "string" ||
      parsed.screenName.trim().length === 0
    ) {
      throw new Error(
        "Last-run artifact screenName must be a non-empty string when provided.",
      );
    }
    screenName = parsed.screenName.trim();
  }
  if (parsed.viewportId !== undefined) {
    if (
      typeof parsed.viewportId !== "string" ||
      parsed.viewportId.trim().length === 0
    ) {
      throw new Error(
        "Last-run artifact viewportId must be a non-empty string when provided.",
      );
    }
    viewportId = assertAllowedViewportId(parsed.viewportId.trim());
  }
  if (parsed.viewportLabel !== undefined) {
    if (
      typeof parsed.viewportLabel !== "string" ||
      parsed.viewportLabel.trim().length === 0
    ) {
      throw new Error(
        "Last-run artifact viewportLabel must be a non-empty string when provided.",
      );
    }
    viewportLabel = parsed.viewportLabel.trim();
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
    ...(screenId !== undefined ? { screenId } : {}),
    ...(screenName !== undefined ? { screenName } : {}),
    ...(viewportId !== undefined ? { viewportId } : {}),
    ...(viewportLabel !== undefined ? { viewportLabel } : {}),
    score: parsed.score,
    ranAt: parsed.ranAt,
    viewport: {
      width: parsed.viewport.width,
      height: parsed.viewport.height,
    },
    ...(thresholdResult !== undefined ? { thresholdResult } : {}),
  };
};

const resolveVisualBenchmarkLastRunArtifactPathsInternal = (
  fixtureId: string,
  location: VisualBenchmarkArtifactLocation,
  options?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkLastRunArtifactPaths => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const normalizedScreenId =
    typeof location.screenId === "string" && location.screenId.trim().length > 0
      ? assertAllowedScreenId(location.screenId.trim())
      : undefined;
  const normalizedViewportId =
    typeof location.viewportId === "string" &&
    location.viewportId.trim().length > 0
      ? assertAllowedViewportId(location.viewportId.trim())
      : undefined;
  const fixtureRoot = path.join(
    resolveArtifactRoot(options),
    LAST_RUN_ARTIFACT_ROOT_NAME,
    normalizedFixtureId,
  );
  let artifactDir =
    normalizedScreenId !== undefined
      ? path.join(fixtureRoot, "screens", toScreenIdToken(normalizedScreenId))
      : fixtureRoot;
  if (normalizedViewportId !== undefined) {
    artifactDir =
      normalizedScreenId !== undefined
        ? path.join(artifactDir, normalizedViewportId)
        : path.join(artifactDir, "viewports", normalizedViewportId);
  }
  return {
    fixtureDir: artifactDir,
    manifestJsonPath: path.join(artifactDir, LAST_RUN_MANIFEST_FILE_NAME),
    actualPngPath: path.join(artifactDir, LAST_RUN_ACTUAL_FILE_NAME),
    diffPngPath: path.join(artifactDir, LAST_RUN_DIFF_FILE_NAME),
    reportJsonPath: path.join(artifactDir, LAST_RUN_REPORT_FILE_NAME),
  };
};

export const resolveVisualBenchmarkLastRunArtifactPaths = (
  fixtureId: string,
  optionsOrScreenId?: VisualBenchmarkFixtureOptions | string,
  maybeOptions?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkLastRunArtifactPaths => {
  const screenId =
    typeof optionsOrScreenId === "string" ? optionsOrScreenId : undefined;
  const options =
    typeof optionsOrScreenId === "string" ? maybeOptions : optionsOrScreenId;
  return resolveVisualBenchmarkLastRunArtifactPathsInternal(
    fixtureId,
    { screenId },
    options,
  );
};

const deleteLegacyRootLastRunArtifacts = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const fixtureRootPaths = resolveVisualBenchmarkLastRunArtifactPathsInternal(
    fixtureId,
    {},
    options,
  );
  await Promise.all([
    rm(fixtureRootPaths.actualPngPath, { force: true }),
    rm(fixtureRootPaths.diffPngPath, { force: true }),
    rm(fixtureRootPaths.manifestJsonPath, { force: true }),
    rm(fixtureRootPaths.reportJsonPath, { force: true }),
    rm(path.join(fixtureRootPaths.fixtureDir, "viewports"), {
      recursive: true,
      force: true,
    }),
  ]);
};

const loadVisualBenchmarkLastRunArtifactAtLocation = async (
  fixtureId: string,
  location: VisualBenchmarkArtifactLocation,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry | null> => {
  const paths = resolveVisualBenchmarkLastRunArtifactPathsInternal(
    fixtureId,
    location,
    options,
  );
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

const loadArtifactEntriesFromViewportDirectory = async (
  fixtureId: string,
  baseDir: string,
  location: Omit<VisualBenchmarkArtifactLocation, "viewportId">,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry[]> => {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    const artifacts: VisualBenchmarkLastRunArtifactEntry[] = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const artifact = await loadVisualBenchmarkLastRunArtifactAtLocation(
        fixtureId,
        { ...location, viewportId: entry.name },
        options,
      );
      if (artifact !== null) {
        artifacts.push(artifact);
      }
    }
    return artifacts.sort((left, right) =>
      (left.viewportId ?? "").localeCompare(right.viewportId ?? ""),
    );
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
};

export const loadVisualBenchmarkLastRunArtifacts = async (
  fixtureId: string,
  optionsOrScreenId?: VisualBenchmarkFixtureOptions | string,
  maybeOptions?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry[]> => {
  const screenId =
    typeof optionsOrScreenId === "string" ? optionsOrScreenId : undefined;
  const options =
    typeof optionsOrScreenId === "string" ? maybeOptions : optionsOrScreenId;

  if (screenId === undefined) {
    const legacyArtifact = await loadVisualBenchmarkLastRunArtifactAtLocation(
      fixtureId,
      {},
      options,
    );
    if (legacyArtifact !== null) {
      return [legacyArtifact];
    }

    const fixtureRoot = path.join(
      resolveArtifactRoot(options),
      LAST_RUN_ARTIFACT_ROOT_NAME,
      assertAllowedFixtureId(fixtureId),
    );
    const rootViewportArtifacts = await loadArtifactEntriesFromViewportDirectory(
      fixtureId,
      path.join(fixtureRoot, "viewports"),
      {},
      options,
    );
    if (rootViewportArtifacts.length > 0) {
      return rootViewportArtifacts;
    }

    try {
      const screenEntries = await readdir(path.join(fixtureRoot, "screens"), {
        withFileTypes: true,
      });
      const artifacts: VisualBenchmarkLastRunArtifactEntry[] = [];
      for (const entry of screenEntries.filter((candidate) =>
        candidate.isDirectory(),
      )) {
        artifacts.push(
          ...(await loadVisualBenchmarkLastRunArtifacts(
            fixtureId,
            fromScreenIdToken(entry.name),
            options,
          )),
        );
      }
      return artifacts.sort((left, right) => {
        const screenComparison = (left.screenId ?? "").localeCompare(
          right.screenId ?? "",
        );
        if (screenComparison !== 0) {
          return screenComparison;
        }
        return (left.viewportId ?? "").localeCompare(right.viewportId ?? "");
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  const directArtifact = await loadVisualBenchmarkLastRunArtifactAtLocation(
    fixtureId,
    { screenId },
    options,
  );
  if (directArtifact !== null) {
    return [directArtifact];
  }

  const screenDir = resolveVisualBenchmarkLastRunArtifactPathsInternal(
    fixtureId,
    { screenId },
    options,
  ).fixtureDir;
  return loadArtifactEntriesFromViewportDirectory(
    fixtureId,
    screenDir,
    { screenId },
    options,
  );
};

const loadScoreScreenContext = async (
  fixtureId: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualQualityScreenContext | null> => {
  try {
    return await loadVisualQualityScreenContext(fixtureId, options);
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

const normalizeScoreEntryWithMetadata = async (
  entry: VisualBenchmarkScoreEntry,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkScoreEntry> => {
  const canonical = toCanonicalScoreEntry(entry);
  const providedScreenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : undefined;
  const providedScreenName = normalizeOptionalScreenName(entry.screenName);
  const screenContext = await loadScoreScreenContext(
    canonical.fixtureId,
    options,
  );
  const screenId =
    providedScreenId ?? screenContext?.screenId ?? canonical.fixtureId;
  const screenName =
    providedScreenName ??
    normalizeOptionalScreenName(screenContext?.screenName);

  return {
    fixtureId: canonical.fixtureId,
    screenId,
    ...(screenName !== undefined ? { screenName } : {}),
    ...(canonical.viewportId !== undefined
      ? { viewportId: canonical.viewportId }
      : {}),
    ...(canonical.viewportLabel !== undefined
      ? { viewportLabel: canonical.viewportLabel }
      : {}),
    score: canonical.score,
  };
};

const normalizeScoresWithMetadata = async (
  scores: readonly VisualBenchmarkScoreEntry[],
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkScoreEntry[]> => {
  const normalized: VisualBenchmarkScoreEntry[] = [];
  for (const entry of scores) {
    normalized.push(await normalizeScoreEntryWithMetadata(entry, options));
  }
  return sortScores(normalized);
};

export const loadVisualBenchmarkBaseline = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkBaseline | null> => {
  const baselinePath = resolveBaselinePath(options);
  try {
    const content = await readFile(baselinePath, "utf8");
    const parsed = parseBaseline(content);
    if (parsed.version === 3) {
      return {
        version: 3,
        scores: sortScores(parsed.scores),
      };
    }

    return {
      version: 3,
      scores: await normalizeScoresWithMetadata(parsed.scores, options),
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

export const saveVisualBenchmarkBaselineScores = async (
  scores: readonly VisualBenchmarkScoreEntry[],
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  const baselinePath = resolveBaselinePath(options);
  const normalizedScores = await normalizeScoresWithMetadata(scores, options);
  const baseline: VisualBenchmarkBaseline = {
    version: 3,
    scores: normalizedScores,
  };
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, toStableJsonString(baseline), "utf8");
};

export const saveVisualBenchmarkBaseline = async (
  result: VisualBenchmarkResult,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  await saveVisualBenchmarkBaselineScores(
    result.deltas.map((delta) => ({
      fixtureId: delta.fixtureId,
      screenId: delta.screenId,
      screenName: delta.screenName,
      ...(delta.viewportId !== undefined
        ? { viewportId: delta.viewportId }
        : {}),
      ...(delta.viewportLabel !== undefined
        ? { viewportLabel: delta.viewportLabel }
        : {}),
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
  const normalizedScores = await normalizeScoresWithMetadata(scores, options);
  const lastRun: VisualBenchmarkLastRun = {
    version: 1,
    ranAt: ranAt ?? new Date().toISOString(),
    scores: normalizedScores,
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
  const normalizedScreenId =
    typeof input.screenId === "string" && input.screenId.trim().length > 0
      ? assertAllowedScreenId(input.screenId.trim())
      : undefined;
  const normalizedViewportId =
    typeof input.viewportId === "string" && input.viewportId.trim().length > 0
      ? assertAllowedViewportId(input.viewportId.trim())
      : undefined;
  const paths = resolveVisualBenchmarkLastRunArtifactPathsInternal(
    input.fixtureId,
    {
      screenId: normalizedScreenId,
      viewportId: normalizedViewportId,
    },
    options,
  );
  const manifest: VisualBenchmarkLastRunArtifactManifest = {
    version: 1,
    fixtureId: assertAllowedFixtureId(input.fixtureId),
    ...(normalizedScreenId !== undefined
      ? { screenId: normalizedScreenId }
      : {}),
    ...(typeof input.screenName === "string" && input.screenName.length > 0
      ? { screenName: input.screenName }
      : {}),
    ...(normalizedViewportId !== undefined
      ? { viewportId: normalizedViewportId }
      : {}),
    ...(typeof input.viewportLabel === "string" &&
    input.viewportLabel.trim().length > 0
      ? { viewportLabel: input.viewportLabel.trim() }
      : {}),
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
  optionsOrScreenId?: VisualBenchmarkFixtureOptions | string,
  maybeOptions?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry | null> => {
  const artifacts = await loadVisualBenchmarkLastRunArtifacts(
    fixtureId,
    optionsOrScreenId as VisualBenchmarkFixtureOptions | string | undefined,
    maybeOptions,
  );
  return artifacts[0] ?? null;
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

const defaultRunFixtureBenchmark = async (
  fixtureId: string,
  fixtureOptions?: VisualBenchmarkExecutionOptions,
): Promise<VisualBenchmarkFixtureRunResultLike> => {
  const result = await executeVisualBenchmarkFixture(fixtureId, fixtureOptions);
  return {
    fixtureId: result.fixtureId,
    aggregateScore: result.aggregateScore,
    screens: result.screens.map((screen) => ({
      screenId: screen.screenId,
      screenName: screen.screenName,
      score: screen.score,
    })),
  };
};

const runResultToScoreEntries = (
  result: VisualBenchmarkFixtureRunResultLike,
): VisualBenchmarkScoreEntry[] => {
  return result.screens.flatMap((screen) => {
    if (Array.isArray(screen.viewports) && screen.viewports.length > 0) {
      return screen.viewports.map((viewport) => ({
        fixtureId: result.fixtureId,
        ...(screen.screenId !== undefined ? { screenId: screen.screenId } : {}),
        ...(screen.screenName !== undefined
          ? { screenName: screen.screenName }
          : {}),
        ...(viewport.viewportId !== undefined
          ? { viewportId: viewport.viewportId }
          : {}),
        ...(viewport.viewportLabel !== undefined
          ? { viewportLabel: viewport.viewportLabel }
          : {}),
        score: viewport.score,
      }));
    }

    return [
      {
        fixtureId: result.fixtureId,
        ...(screen.screenId !== undefined ? { screenId: screen.screenId } : {}),
        ...(screen.screenName !== undefined
          ? { screenName: screen.screenName }
          : {}),
        score: screen.score,
      },
    ];
  });
};

export const computeVisualBenchmarkScores = async (
  options?: VisualBenchmarkExecutionOptions,
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkScoreEntry[]> => {
  const fixtureIds = await listVisualBenchmarkFixtureIds(options);
  const scores: VisualBenchmarkScoreEntry[] = [];
  const runFixtureBenchmark =
    dependencies?.runFixtureBenchmark ?? defaultRunFixtureBenchmark;

  for (const fixtureId of fixtureIds) {
    const result = await runFixtureBenchmark(fixtureId, options);
    for (const entry of runResultToScoreEntries(result)) {
      scores.push(await normalizeScoreEntryWithMetadata(entry, options));
    }
  }

  return sortScores(scores);
};

export interface ComputeVisualBenchmarkDeltasOptions {
  neutralTolerance?: number;
  screenAggregates?: {
    current?: VisualBenchmarkScreenAggregateEntry[];
    baseline?: VisualBenchmarkScreenAggregateEntry[];
  };
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

  const baselineMap = new Map<string, VisualBenchmarkScoreEntry>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(
        getVisualBenchmarkScoreKey(entry),
        toCanonicalScoreEntry(entry),
      );
    }
  }

  const deltas: VisualBenchmarkDelta[] = current.map((entry) => {
    const canonicalEntry = toCanonicalScoreEntry(entry);
    const baselineEntry =
      baselineMap.get(getVisualBenchmarkScoreKey(canonicalEntry)) ?? null;
    const baselineScore = baselineEntry?.score ?? null;
    const delta =
      baselineScore !== null
        ? roundToTwoDecimals(canonicalEntry.score - baselineScore)
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
    return {
      fixtureId: canonicalEntry.fixtureId,
      screenId: canonicalEntry.screenId,
      ...(canonicalEntry.screenName !== undefined
        ? { screenName: canonicalEntry.screenName }
        : {}),
      ...(canonicalEntry.viewportId !== undefined
        ? { viewportId: canonicalEntry.viewportId }
        : {}),
      ...(canonicalEntry.viewportLabel !== undefined
        ? { viewportLabel: canonicalEntry.viewportLabel }
        : {}),
      baseline: baselineScore,
      current: canonicalEntry.score,
      delta,
      indicator,
    };
  });

  const currentScreenAggregateMap =
    deltaOptions?.screenAggregates?.current !== undefined
      ? buildScreenAggregateMapFromEntries(deltaOptions.screenAggregates.current)
      : buildScreenAggregateMapFromScores(current);
  const baselineScreenAggregateMap =
    deltaOptions?.screenAggregates?.baseline !== undefined
      ? buildScreenAggregateMapFromEntries(deltaOptions.screenAggregates.baseline)
      : baseline !== null
        ? buildScreenAggregateMapFromScores(baseline.scores)
        : new Map<string, VisualBenchmarkScreenAggregateEntry>();

  const currentScreenScores = Array.from(currentScreenAggregateMap.values()).map(
    (entry) => entry.score,
  );
  const overallCurrent = roundToTwoDecimals(
    currentScreenScores.reduce((sum, score) => sum + score, 0) /
      currentScreenScores.length,
  );

  const matchedCurrentScreenScores: number[] = [];
  const matchedBaselineScreenScores: number[] = [];
  for (const [key, currentEntry] of currentScreenAggregateMap.entries()) {
    const baselineEntry = baselineScreenAggregateMap.get(key);
    if (baselineEntry === undefined) {
      continue;
    }
    matchedCurrentScreenScores.push(currentEntry.score);
    matchedBaselineScreenScores.push(baselineEntry.score);
  }
  const matchedCount = matchedCurrentScreenScores.length;
  const overallBaseline =
    matchedCount > 0
      ? roundToTwoDecimals(
          matchedBaselineScreenScores.reduce((sum, score) => sum + score, 0) /
            matchedCount,
        )
      : null;
  const overallComparableCurrent =
    matchedCount > 0
      ? roundToTwoDecimals(
          matchedCurrentScreenScores.reduce((sum, score) => sum + score, 0) /
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
    const displayName = (() => {
      const fixtureName = fixtureIdToDisplayName(delta.fixtureId);
      const normalizedScreenName = normalizeOptionalScreenName(
        delta.screenName,
      );
      if (normalizedScreenName !== undefined) {
        const screenDisplay = `${fixtureName} / ${normalizedScreenName}`;
        return delta.viewportLabel !== undefined
          ? `${screenDisplay} / ${delta.viewportLabel}`
          : delta.viewportId !== undefined && delta.viewportId !== "default"
            ? `${screenDisplay} / ${delta.viewportId}`
            : screenDisplay;
      }
      if (
        typeof delta.screenId === "string" &&
        delta.screenId.length > 0 &&
        delta.screenId !== delta.fixtureId
      ) {
        const screenDisplay = `${fixtureName} / ${delta.screenId}`;
        return delta.viewportLabel !== undefined
          ? `${screenDisplay} / ${delta.viewportLabel}`
          : delta.viewportId !== undefined && delta.viewportId !== "default"
            ? `${screenDisplay} / ${delta.viewportId}`
            : screenDisplay;
      }
      if (delta.viewportLabel !== undefined) {
        return `${fixtureName} / ${delta.viewportLabel}`;
      }
      if (delta.viewportId !== undefined && delta.viewportId !== "default") {
        return `${fixtureName} / ${delta.viewportId}`;
      }
      return fixtureName;
    })();
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

const loadBaselineFileMtime = async (
  baselinePath: string,
): Promise<Date | null> => {
  try {
    const stats = await stat(baselinePath);
    return stats.mtime;
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

interface MultiScreenAlertInputs {
  currentScoresByFixture: ReadonlyMap<string, ReadonlySet<string>>;
  baseline: VisualBenchmarkBaseline | null;
  loadMetadata: (fixtureId: string) => Promise<VisualBenchmarkFixtureMetadata>;
  baselinePath: string;
}

interface PersistedVisualBenchmarkViewportArtifact {
  viewportId?: string;
  viewportLabel?: string;
  score: number;
  viewport: {
    width: number;
    height: number;
  };
  screenshotBuffer: Buffer;
  diffBuffer: Buffer | null;
  report: unknown | null;
}

const resolvePersistedViewportArtifacts = (
  screen: VisualBenchmarkFixtureScreenArtifact,
  qualityConfig?: VisualQualityConfig,
): PersistedVisualBenchmarkViewportArtifact[] => {
  if (Array.isArray(screen.viewports) && screen.viewports.length > 0) {
    return screen.viewports.map((viewportArtifact) => {
      const patchedReport =
        qualityConfig !== undefined &&
        isWorkspaceVisualQualityReport(viewportArtifact.report)
          ? applyVisualQualityConfigToReport(
              viewportArtifact.report,
              qualityConfig,
            )
          : viewportArtifact.report;
      const patchedScore =
        qualityConfig !== undefined &&
        isWorkspaceVisualQualityReport(patchedReport) &&
        typeof patchedReport.overallScore === "number"
          ? patchedReport.overallScore
          : viewportArtifact.score;
      return {
        ...(viewportArtifact.viewportId !== undefined
          ? { viewportId: viewportArtifact.viewportId }
          : {}),
        ...(viewportArtifact.viewportLabel !== undefined
          ? { viewportLabel: viewportArtifact.viewportLabel }
          : {}),
        score: patchedScore,
        viewport: viewportArtifact.viewport,
        screenshotBuffer: viewportArtifact.screenshotBuffer,
        diffBuffer: viewportArtifact.diffBuffer,
        report: patchedReport,
      };
    });
  }

  const patchedReport =
    qualityConfig !== undefined && isWorkspaceVisualQualityReport(screen.report)
      ? applyVisualQualityConfigToReport(screen.report, qualityConfig)
      : screen.report;
  const patchedScore =
    qualityConfig !== undefined &&
    isWorkspaceVisualQualityReport(patchedReport) &&
    typeof patchedReport.overallScore === "number"
      ? patchedReport.overallScore
      : screen.score;
  return [
    {
      score: patchedScore,
      viewport: screen.viewport,
      screenshotBuffer: screen.screenshotBuffer,
      diffBuffer: screen.diffBuffer,
      report: patchedReport,
    },
  ];
};

const computeMultiScreenBaselineAlerts = async ({
  currentScoresByFixture,
  baseline,
  loadMetadata,
  baselinePath,
}: MultiScreenAlertInputs): Promise<KpiAlert[]> => {
  const alerts: KpiAlert[] = [];
  const baselineScreensByFixture = new Map<string, Set<string>>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      const screenId =
        typeof entry.screenId === "string" && entry.screenId.length > 0
          ? entry.screenId
          : entry.fixtureId;
      let set = baselineScreensByFixture.get(entry.fixtureId);
      if (set === undefined) {
        set = new Set<string>();
        baselineScreensByFixture.set(entry.fixtureId, set);
      }
      set.add(screenId);
    }
  }

  const baselineMtime = await loadBaselineFileMtime(baselinePath);

  const fixtureIds = new Set<string>([
    ...currentScoresByFixture.keys(),
    ...baselineScreensByFixture.keys(),
  ]);

  for (const fixtureId of fixtureIds) {
    let metadata: VisualBenchmarkFixtureMetadata;
    try {
      metadata = await loadMetadata(fixtureId);
    } catch {
      continue;
    }
    const declaredScreens = enumerateFixtureScreens(metadata);
    const declaredScreenIds = new Set(declaredScreens.map((s) => s.screenId));

    const baselineScreenIds =
      baselineScreensByFixture.get(fixtureId) ?? new Set<string>();
    // MISSING: declared in metadata but no entry in baseline — baseline is
    // stale relative to metadata and needs an update.
    const missingScreenIds = declaredScreens
      .map((screen) => screen.screenId)
      .filter((id) => !baselineScreenIds.has(id));
    if (missingScreenIds.length > 0 && baselineScreenIds.size > 0) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_MISSING_SCREEN",
        severity: "warn",
        message: `Visual benchmark fixture '${fixtureId}' is missing baseline entries for declared screens: ${missingScreenIds.join(", ")}`,
        value: missingScreenIds.length,
        threshold: 0,
      });
    }

    const orphanBaselineScreenIds = Array.from(baselineScreenIds).filter(
      (id) => !declaredScreenIds.has(id),
    );
    if (orphanBaselineScreenIds.length > 0) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_ORPHAN_SCREEN_BASELINE",
        severity: "warn",
        message: `Visual benchmark fixture '${fixtureId}' has baseline entries for screens not declared in metadata: ${orphanBaselineScreenIds.join(", ")}`,
        value: orphanBaselineScreenIds.length,
        threshold: 0,
      });
    }

    if (
      baseline !== null &&
      baselineScreenIds.size > 0 &&
      baselineMtime !== null
    ) {
      const capturedAt = new Date(metadata.capturedAt);
      if (
        !Number.isNaN(capturedAt.getTime()) &&
        baselineMtime.getTime() < capturedAt.getTime()
      ) {
        alerts.push({
          code: "ALERT_VISUAL_QUALITY_STALE_SCREEN_BASELINE",
          severity: "warn",
          message: `Visual benchmark fixture '${fixtureId}' baseline is older than metadata.capturedAt (${metadata.capturedAt}).`,
          value: 1,
          threshold: 0,
        });
      }
    }
  }

  return alerts;
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
  const currentScreenAggregateMap = new Map<string, VisualBenchmarkScreenAggregateEntry>();
  const fixtureScreenContexts = new Map<string, VisualQualityScreenContext>();
  const artifactEntries: VisualBenchmarkLastRunArtifactInput[] = [];
  const fixtureMetadataCache = new Map<
    string,
    Promise<VisualBenchmarkFixtureMetadata>
  >();
  const loadCachedMetadata = (
    fixtureId: string,
  ): Promise<VisualBenchmarkFixtureMetadata> => {
    const existing = fixtureMetadataCache.get(fixtureId);
    if (existing !== undefined) {
      return existing;
    }
    const promise = loadVisualBenchmarkFixtureMetadata(fixtureId, options);
    fixtureMetadataCache.set(fixtureId, promise);
    return promise;
  };
  const fixtureObservedScreens = new Map<string, Set<string>>();

  if (
    dependencies?.runFixtureBenchmark !== undefined &&
    dependencies.executeFixture === undefined
  ) {
    const fixtureIds = await listVisualBenchmarkFixtureIds(options);
    const runFixtureBenchmark = dependencies.runFixtureBenchmark;
    scores = [];
    for (const fixtureId of fixtureIds) {
      const result = await runFixtureBenchmark(fixtureId, options);
      for (const screen of result.screens) {
        const normalizedScreenId =
          typeof screen.screenId === "string" && screen.screenId.trim().length > 0
            ? screen.screenId.trim()
            : fixtureId;
        const aggregateKey = getScreenAggregateKey(
          result.fixtureId,
          normalizedScreenId,
        );
        currentScreenAggregateMap.set(aggregateKey, {
          fixtureId: result.fixtureId,
          screenId: normalizedScreenId,
          score: screen.score,
        });
        let set = fixtureObservedScreens.get(result.fixtureId);
        if (set === undefined) {
          set = new Set<string>();
          fixtureObservedScreens.set(result.fixtureId, set);
        }
        set.add(normalizedScreenId);
      }
      for (const entry of runResultToScoreEntries(result)) {
        scores.push(await normalizeScoreEntryWithMetadata(entry, options));
      }
    }
    scores = sortScores(scores);
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
      const observedSet = new Set<string>();
      fixtureObservedScreens.set(result.fixtureId, observedSet);

      for (const screen of result.screens) {
        observedSet.add(screen.screenId);
        const screenContextKey = `${result.fixtureId}::${screen.screenId}`;
        const screenContext =
          options?.qualityConfig !== undefined
            ? {
                screenId: screen.screenId,
                screenName: screen.screenName,
              }
            : undefined;
        if (screenContext !== undefined) {
          fixtureScreenContexts.set(screenContextKey, screenContext);
        }
        const persistedViewportArtifacts = resolvePersistedViewportArtifacts(
          screen,
          options?.qualityConfig,
        );
        currentScreenAggregateMap.set(
          getScreenAggregateKey(result.fixtureId, screen.screenId),
          {
            fixtureId: result.fixtureId,
            screenId: screen.screenId,
            score: screen.score,
          },
        );
        for (const artifact of persistedViewportArtifacts) {
          scores.push({
            fixtureId: result.fixtureId,
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...(artifact.viewportId !== undefined
              ? { viewportId: artifact.viewportId }
              : {}),
            ...(artifact.viewportLabel !== undefined
              ? { viewportLabel: artifact.viewportLabel }
              : {}),
            score: artifact.score,
          });
          artifactEntries.push({
            fixtureId: result.fixtureId,
            screenId: screen.screenId,
            screenName: screen.screenName,
            ...(artifact.viewportId !== undefined
              ? { viewportId: artifact.viewportId }
              : {}),
            ...(artifact.viewportLabel !== undefined
              ? { viewportLabel: artifact.viewportLabel }
              : {}),
            score: artifact.score,
            ranAt: runAt,
            viewport: artifact.viewport,
            actualImageBuffer: artifact.screenshotBuffer,
            diffImageBuffer: artifact.diffBuffer,
            report: artifact.report,
          });
        }
      }
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

  const computeScreenAggregateForEntry = async (
    entry: VisualBenchmarkScreenAggregateEntry,
    sourceScores: readonly VisualBenchmarkScoreEntry[],
  ): Promise<number> => {
    const matchingViewportScores = sourceScores
      .map((scoreEntry) => toCanonicalScoreEntry(scoreEntry))
      .filter((scoreEntry) => {
        const scoreScreenId =
          typeof scoreEntry.screenId === "string" && scoreEntry.screenId.length > 0
            ? scoreEntry.screenId
            : scoreEntry.fixtureId;
        return (
          scoreEntry.fixtureId === entry.fixtureId &&
          scoreScreenId === entry.screenId
        );
      });
    if (matchingViewportScores.length <= 1) {
      return matchingViewportScores[0]?.score ?? entry.score;
    }

    const metadata = await loadCachedMetadata(entry.fixtureId);
    const screens = enumerateFixtureScreens(metadata);
    const screen = screens.find((candidate) => candidate.screenId === entry.screenId);
    if (screen === undefined) {
      return roundToTwoDecimals(
        matchingViewportScores.reduce((sum, candidate) => sum + candidate.score, 0) /
          matchingViewportScores.length,
      );
    }

    const configuredViewports = resolveVisualQualityViewports(
      qualityConfig,
      entry.fixtureId,
      {
        screenId: screen.screenId,
        screenName: screen.screenName,
      },
    );
    const resolvedViewports = enumerateFixtureScreenViewports(
      screen,
      configuredViewports ?? [],
    );
    const scoreByViewport = new Map<string, number>();
    for (const scoreEntry of matchingViewportScores) {
      const viewportId =
        typeof scoreEntry.viewportId === "string" && scoreEntry.viewportId.length > 0
          ? scoreEntry.viewportId
          : "default";
      scoreByViewport.set(viewportId, scoreEntry.score);
    }
    const matchedViewportSpecs = resolvedViewports.filter((viewport) =>
      scoreByViewport.has(viewport.id),
    );
    if (matchedViewportSpecs.length !== scoreByViewport.size) {
      return roundToTwoDecimals(
        matchingViewportScores.reduce((sum, candidate) => sum + candidate.score, 0) /
          matchingViewportScores.length,
      );
    }
    const normalizedSpecs = normalizeVisualQualityViewportWeights(
      matchedViewportSpecs,
    );
    let weightedScore = 0;
    for (const viewportSpec of normalizedSpecs) {
      weightedScore +=
        (scoreByViewport.get(viewportSpec.id) ?? 0) * (viewportSpec.weight ?? 0);
    }
    return roundToTwoDecimals(weightedScore);
  };

  const baselineScreenAggregateMap = new Map<
    string,
    VisualBenchmarkScreenAggregateEntry
  >();
  if (baseline !== null) {
    const baselineScreenKeys = new Set<string>();
    for (const entry of baseline.scores) {
      const canonical = toCanonicalScoreEntry(entry);
      const key = getScreenAggregateKey(canonical.fixtureId, canonical.screenId);
      if (baselineScreenKeys.has(key)) {
        continue;
      }
      baselineScreenKeys.add(key);
      baselineScreenAggregateMap.set(key, {
        fixtureId: canonical.fixtureId,
        screenId:
          canonical.screenId !== undefined
            ? canonical.screenId
            : canonical.fixtureId,
        score: await computeScreenAggregateForEntry(
          {
            fixtureId: canonical.fixtureId,
            screenId:
              canonical.screenId !== undefined
                ? canonical.screenId
                : canonical.fixtureId,
            score: canonical.score,
          },
          baseline.scores,
        ),
      });
    }
  }

  if (currentScreenAggregateMap.size > 0) {
    const currentScreenScores = Array.from(currentScreenAggregateMap.values()).map(
      (entry) => entry.score,
    );
    result.overallCurrent = roundToTwoDecimals(
      currentScreenScores.reduce((sum, score) => sum + score, 0) /
        currentScreenScores.length,
    );
    const matchedCurrentScores: number[] = [];
    const matchedBaselineScores: number[] = [];
    for (const [key, currentEntry] of currentScreenAggregateMap.entries()) {
      const baselineEntry = baselineScreenAggregateMap.get(key);
      if (baselineEntry === undefined) {
        continue;
      }
      matchedCurrentScores.push(currentEntry.score);
      matchedBaselineScores.push(baselineEntry.score);
    }
    if (matchedBaselineScores.length > 0) {
      const comparableCurrentAverage = roundToTwoDecimals(
        matchedCurrentScores.reduce((sum, score) => sum + score, 0) /
          matchedCurrentScores.length,
      );
      result.overallBaseline = roundToTwoDecimals(
        matchedBaselineScores.reduce((sum, score) => sum + score, 0) /
          matchedBaselineScores.length,
      );
      result.overallDelta = roundToTwoDecimals(
        comparableCurrentAverage - result.overallBaseline,
      );
    } else {
      result.overallBaseline = null;
      result.overallDelta = null;
    }
  }

  // Run regression detection (delta-based alerts + trend summaries)
  const regressionDetection = detectVisualBenchmarkRegression(
    result.deltas.map((delta) => ({
      fixtureId: delta.fixtureId,
      screenId: delta.screenId,
      screenName: delta.screenName,
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

  // Phase 1 multi-screen alerts: missing, orphan, stale baseline entries.
  const screenAlerts = await computeMultiScreenBaselineAlerts({
    currentScoresByFixture: fixtureObservedScreens,
    baseline,
    loadMetadata: loadCachedMetadata,
    baselinePath: resolveBaselinePath(options),
  });
  if (screenAlerts.length > 0) {
    result.alerts = [...result.alerts, ...screenAlerts];
  }

  // Apply quality config thresholds if config is present
  if (qualityConfig) {
    for (const delta of result.deltas) {
      const screenContextKey = `${delta.fixtureId}::${delta.screenId ?? delta.fixtureId}`;
      let screenContext = fixtureScreenContexts.get(screenContextKey);
      if (screenContext === undefined) {
        screenContext = await loadVisualQualityScreenContext(
          delta.fixtureId,
          options,
        );
        fixtureScreenContexts.set(screenContextKey, screenContext);
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
    const deltaByKey = new Map<string, VisualBenchmarkDelta>();
    for (const delta of result.deltas) {
      deltaByKey.set(getVisualBenchmarkScoreKey(delta), delta);
    }
    // Count artifact entries per fixture so single-screen fixtures
    // (v1 metadata or v2 with exactly one screen) land at the legacy
    // `last-run/<fixture>/` path for byte-identity with pre-multi-screen
    // consumers. Multi-screen fixtures go to `last-run/<fixture>/screens/<token>/`.
    const entriesPerFixture = new Map<string, number>();
    for (const entry of artifactEntries) {
      entriesPerFixture.set(
        entry.fixtureId,
        (entriesPerFixture.get(entry.fixtureId) ?? 0) + 1,
      );
    }
    const fixturesNeedingLegacyRootCleanup = new Set<string>();
    for (const entry of artifactEntries) {
      const fixtureEntryCount = entriesPerFixture.get(entry.fixtureId) ?? 0;
      const hasViewportId =
        typeof entry.viewportId === "string" && entry.viewportId.length > 0;
      if (fixtureEntryCount > 1 || hasViewportId) {
        fixturesNeedingLegacyRootCleanup.add(entry.fixtureId);
      }
    }
    for (const fixtureId of fixturesNeedingLegacyRootCleanup) {
      await deleteLegacyRootLastRunArtifacts(fixtureId, options);
    }
    for (const artifactEntry of artifactEntries) {
      const key = getVisualBenchmarkScoreKey({
        fixtureId: artifactEntry.fixtureId,
        screenId: artifactEntry.screenId,
        viewportId: artifactEntry.viewportId,
      });
      const delta = deltaByKey.get(key);
      const isMultiScreen =
        (entriesPerFixture.get(artifactEntry.fixtureId) ?? 0) > 1;
      await saveVisualBenchmarkLastRunArtifact(
        {
          ...artifactEntry,
          ...(isMultiScreen || artifactEntry.viewportId !== undefined
            ? {}
            : { screenId: undefined }),
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
    const existingHistory = await loadVisualBenchmarkHistory(options);
    const updatedHistory = appendVisualBenchmarkHistoryEntry(
      existingHistory,
      {
        runAt,
        scores: scores.map((entry) => ({
          fixtureId: entry.fixtureId,
          screenId: entry.screenId,
          screenName: entry.screenName,
          viewportId: entry.viewportId,
          viewportLabel: entry.viewportLabel,
          score: entry.score,
        })),
      },
      regressionConfig.historySize,
    );
    await saveVisualBenchmarkHistory(updatedHistory, options);
    process.stdout.write(
      `History updated (${String(updatedHistory.entries.length)} entries).\n`,
    );

    await saveVisualBenchmarkBaselineScores(scores, options);
    process.stdout.write("Baseline updated.\n");
  }

  return result;
};
