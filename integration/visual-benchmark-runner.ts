import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  loadVisualBenchmarkFixtureMetadata,
  assertAllowedFixtureId,
  assertAllowedScreenId,
  enumerateFixtureScreens,
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
  screenId?: string;
  screenName?: string;
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

/**
 * Arithmetic mean of per-screen scores. Empty input throws (undefined behavior).
 * Rounded to 2 decimals to match the rest of the runner's score precision.
 */
export const computeFixtureAggregate = (
  screens: readonly { score: number }[],
): number => {
  if (screens.length === 0) {
    throw new Error("computeFixtureAggregate requires at least one screen.");
  }
  const total = screens.reduce((sum, screen) => sum + screen.score, 0);
  return Math.round((total / screens.length) * 100) / 100;
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

const toCanonicalScoreEntry = (
  entry: VisualBenchmarkScoreEntry,
): VisualBenchmarkScoreEntry => {
  const fixtureId = assertAllowedFixtureId(entry.fixtureId);
  const screenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : fixtureId;
  const screenName = normalizeOptionalScreenName(entry.screenName);

  return {
    fixtureId,
    screenId,
    ...(screenName !== undefined ? { screenName } : {}),
    score: entry.score,
  };
};

export const getVisualBenchmarkScoreKey = (
  entry: Pick<VisualBenchmarkScoreEntry, "fixtureId" | "screenId">,
): string => {
  const fixtureId = assertAllowedFixtureId(entry.fixtureId);
  const screenId =
    typeof entry.screenId === "string" && entry.screenId.trim().length > 0
      ? entry.screenId.trim()
      : fixtureId;
  return `${fixtureId}::${screenId}`;
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
    }

    scores.push({
      fixtureId: entry.fixtureId,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(screenName !== undefined ? { screenName } : {}),
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
    scores.push({
      fixtureId: entry.fixtureId,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(screenName !== undefined ? { screenName } : {}),
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
  optionsOrScreenId?: VisualBenchmarkFixtureOptions | string,
  maybeOptions?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkLastRunArtifactPaths => {
  // Overload: second positional can be screenId (string) OR options.
  // Preserves the legacy single-arg path call sites used by visual-baseline.
  const screenId =
    typeof optionsOrScreenId === "string" ? optionsOrScreenId : undefined;
  const options =
    typeof optionsOrScreenId === "string" ? maybeOptions : optionsOrScreenId;
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  const fixtureRoot = path.join(
    resolveArtifactRoot(options),
    LAST_RUN_ARTIFACT_ROOT_NAME,
    normalizedFixtureId,
  );
  // Multi-screen layout: place per-screen artifacts in `<fixture>/screens/<token>/`.
  // Single-screen (no screenId) writes at the legacy `<fixture>/` root for
  // byte-identity with pre-multi-screen consumers (visual-baseline.ts).
  const artifactDir =
    screenId !== undefined
      ? path.join(fixtureRoot, "screens", toScreenIdToken(screenId))
      : fixtureRoot;
  return {
    fixtureDir: artifactDir,
    manifestJsonPath: path.join(artifactDir, LAST_RUN_MANIFEST_FILE_NAME),
    actualPngPath: path.join(artifactDir, LAST_RUN_ACTUAL_FILE_NAME),
    diffPngPath: path.join(artifactDir, LAST_RUN_DIFF_FILE_NAME),
    reportJsonPath: path.join(artifactDir, LAST_RUN_REPORT_FILE_NAME),
  };
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
  // Validate screenId up-front so it cannot escape the fixture sandbox via
  // path tokens. Legacy single-screen callers pass no screenId.
  const normalizedScreenId =
    typeof input.screenId === "string" && input.screenId.trim().length > 0
      ? assertAllowedScreenId(input.screenId.trim())
      : undefined;
  const paths =
    normalizedScreenId !== undefined
      ? resolveVisualBenchmarkLastRunArtifactPaths(
          input.fixtureId,
          normalizedScreenId,
          options,
        )
      : resolveVisualBenchmarkLastRunArtifactPaths(input.fixtureId, options);
  const manifest: VisualBenchmarkLastRunArtifactManifest = {
    version: 1,
    fixtureId: assertAllowedFixtureId(input.fixtureId),
    ...(normalizedScreenId !== undefined
      ? { screenId: normalizedScreenId }
      : {}),
    ...(typeof input.screenName === "string" && input.screenName.length > 0
      ? { screenName: input.screenName }
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
  const screenId =
    typeof optionsOrScreenId === "string" ? optionsOrScreenId : undefined;
  const options =
    typeof optionsOrScreenId === "string" ? maybeOptions : optionsOrScreenId;
  // Legacy call with no screenId: if the legacy path has no manifest but a
  // per-screen layout exists (multi-screen fixture), fall back to the first
  // screen's manifest for backward compatibility with single-artifact consumers.
  if (screenId === undefined) {
    const legacyPaths = resolveVisualBenchmarkLastRunArtifactPaths(
      fixtureId,
      options,
    );
    try {
      await stat(legacyPaths.manifestJsonPath);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        const screensDir = path.join(legacyPaths.fixtureDir, "screens");
        try {
          const entries = await readdir(screensDir, { withFileTypes: true });
          const firstScreenDir = entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()[0];
          if (firstScreenDir !== undefined) {
            return loadVisualBenchmarkLastRunArtifact(
              fixtureId,
              firstScreenDir.replace(/_/g, ":"),
              options,
            );
          }
        } catch (readdirError: unknown) {
          if (
            !(
              readdirError instanceof Error &&
              "code" in readdirError &&
              (readdirError as NodeJS.ErrnoException).code === "ENOENT"
            )
          ) {
            throw readdirError;
          }
        }
      } else {
        throw error;
      }
    }
  }
  const paths =
    screenId !== undefined
      ? resolveVisualBenchmarkLastRunArtifactPaths(fixtureId, screenId, options)
      : resolveVisualBenchmarkLastRunArtifactPaths(fixtureId, options);
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
  return result.screens.map((screen) => ({
    fixtureId: result.fixtureId,
    ...(screen.screenId !== undefined ? { screenId: screen.screenId } : {}),
    ...(screen.screenName !== undefined
      ? { screenName: screen.screenName }
      : {}),
    score: screen.score,
  }));
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

  const matchedPairs: Array<{ current: number; baseline: number }> = [];
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
    if (baselineScore !== null) {
      matchedPairs.push({
        current: canonicalEntry.score,
        baseline: baselineScore,
      });
    }
    return {
      fixtureId: canonicalEntry.fixtureId,
      screenId: canonicalEntry.screenId,
      ...(canonicalEntry.screenName !== undefined
        ? { screenName: canonicalEntry.screenName }
        : {}),
      baseline: baselineScore,
      current: canonicalEntry.score,
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
    scores = await computeVisualBenchmarkScores(options, dependencies);
    for (const entry of scores) {
      if (entry.screenId !== undefined) {
        let set = fixtureObservedScreens.get(entry.fixtureId);
        if (set === undefined) {
          set = new Set<string>();
          fixtureObservedScreens.set(entry.fixtureId, set);
        }
        set.add(entry.screenId);
      }
    }
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
        // Only re-apply the config when a qualityConfig is supplied.
        // Without a config, preserve the per-screen score from the
        // execution result so that stubbed fan-out tests can exercise
        // distinct per-screen scores via `screen.score`.
        const patchedReport =
          options?.qualityConfig !== undefined &&
          isWorkspaceVisualQualityReport(screen.report)
            ? applyVisualQualityConfigToReport(
                screen.report,
                options.qualityConfig,
              )
            : screen.report;
        const patchedScore =
          options?.qualityConfig !== undefined &&
          isWorkspaceVisualQualityReport(patchedReport) &&
          typeof patchedReport.overallScore === "number"
            ? patchedReport.overallScore
            : screen.score;
        scores.push({
          fixtureId: result.fixtureId,
          screenId: screen.screenId,
          screenName: screen.screenName,
          score: patchedScore,
        });
        artifactEntries.push({
          fixtureId: result.fixtureId,
          screenId: screen.screenId,
          screenName: screen.screenName,
          score: patchedScore,
          ranAt: runAt,
          viewport: screen.viewport,
          actualImageBuffer: screen.screenshotBuffer,
          diffImageBuffer: screen.diffBuffer,
          report: patchedReport,
        });
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
      const screenContextKey = getVisualBenchmarkScoreKey({
        fixtureId: delta.fixtureId,
        screenId: delta.screenId,
      });
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
    for (const artifactEntry of artifactEntries) {
      const key = getVisualBenchmarkScoreKey({
        fixtureId: artifactEntry.fixtureId,
        screenId: artifactEntry.screenId,
      });
      const delta = deltaByKey.get(key);
      const isMultiScreen =
        (entriesPerFixture.get(artifactEntry.fixtureId) ?? 0) > 1;
      await saveVisualBenchmarkLastRunArtifact(
        {
          ...artifactEntry,
          ...(isMultiScreen ? {} : { screenId: undefined }),
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

  const existingHistory = await loadVisualBenchmarkHistory(options);
  const updatedHistory = appendVisualBenchmarkHistoryEntry(
    existingHistory,
    {
      runAt,
      scores: scores.map((entry) => ({
        fixtureId: entry.fixtureId,
        screenId: entry.screenId,
        screenName: entry.screenName,
        score: entry.score,
      })),
    },
    regressionConfig.historySize,
  );
  await saveVisualBenchmarkHistory(updatedHistory, options);
  process.stdout.write(
    `History updated (${String(updatedHistory.entries.length)} entries).\n`,
  );

  if (options?.updateBaseline === true) {
    await saveVisualBenchmarkBaselineScores(scores, options);
    process.stdout.write("Baseline updated.\n");
  }

  return result;
};
