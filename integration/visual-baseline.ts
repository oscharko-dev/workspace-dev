import { readFile, stat } from "node:fs/promises";
import {
  assertAllowedFixtureId,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkFixturePaths,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";
import {
  loadVisualBenchmarkBaseline,
  loadVisualBenchmarkLastRun,
  loadVisualBenchmarkLastRunArtifact,
  resolveVisualBenchmarkLastRunArtifactPaths,
  saveVisualBenchmarkBaselineScores,
  saveVisualBenchmarkLastRun,
  saveVisualBenchmarkLastRunArtifact,
  type VisualBenchmarkBaseline,
  type VisualBenchmarkLastRunArtifactEntry,
  type VisualBenchmarkScoreEntry,
} from "./visual-benchmark-runner.js";
import {
  appendVisualBenchmarkHistoryEntry,
  loadVisualBenchmarkHistory,
  saveVisualBenchmarkHistory,
} from "./visual-benchmark-history.js";
import {
  executeVisualBenchmarkFixtureLegacy,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureExecutionArtifacts,
} from "./visual-benchmark.execution.js";
import {
  loadVisualQualityConfig,
  resolveVisualQualityRegressionConfig,
  type VisualQualityConfig,
  type VisualQualityResolvedRegressionConfig,
} from "./visual-quality-config.js";

export interface VisualBaselineStatusEntry {
  fixtureId: string;
  screenId: string;
  screenName?: string;
  baselineScore: number | null;
  lastRunScore: number | null;
  hasPendingDiff: boolean;
  indicator: "improved" | "degraded" | "neutral" | "new" | "unavailable";
  capturedAt: string | null;
  ageInDays: number | null;
  lastRunAt: string | null;
  referencePngExists: boolean;
  actualImagePath: string | null;
  diffImagePath: string | null;
  reportPath: string | null;
}

export interface VisualBaselineStatusResult {
  entries: VisualBaselineStatusEntry[];
}

export interface VisualBaselineDiffEntry {
  fixtureId: string;
  screenId: string;
  screenName?: string;
  baseline: number | null;
  current: number;
  delta: number | null;
  indicator: "improved" | "degraded" | "neutral" | "new";
  ranAt: string | null;
  actualImagePath: string | null;
  diffImagePath: string | null;
  reportPath: string | null;
}

export interface VisualBaselineDiffResult {
  diffs: VisualBaselineDiffEntry[];
  hasPendingDiffs: boolean;
}

export interface VisualBaselineUpdateResult {
  scores: VisualBenchmarkScoreEntry[];
  previousBaseline: VisualBenchmarkBaseline | null;
  artifacts: VisualBenchmarkLastRunArtifactEntry[];
}

export interface VisualBaselineApproveResult {
  fixtureId: string;
  previousScore: number | null;
  newScore: number;
  approvedFrom: string;
  referencePath: string;
}

export interface VisualBaselineDependencies extends VisualBenchmarkFixtureOptions {
  qualityConfig?: VisualQualityConfig;
  log?: (message: string) => void;
  now?: () => Date;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureExecutionArtifacts>;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const defaultLog = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const fixtureIdToDisplayName = (fixtureId: string): string => {
  return fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const normalizeOptionalScreenName = (
  screenName: string | undefined,
): string | undefined => {
  if (typeof screenName !== "string") {
    return undefined;
  }
  const normalized = screenName.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const getScoreKey = (
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
): VisualBenchmarkScoreEntry[] => {
  return [...scores].sort((left, right) => {
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
};

const padRight = (value: string, width: number): string =>
  value + " ".repeat(Math.max(0, width - value.length));

const padLeft = (value: string, width: number): string =>
  " ".repeat(Math.max(0, width - value.length)) + value;

const formatDeltaCell = (delta: number | null, indicator: string): string => {
  if (delta === null) {
    return "\u2014 \u2796";
  }
  const sign = delta > 0 ? "+" : "";
  const emoji =
    indicator === "improved"
      ? " \u2705"
      : indicator === "degraded"
        ? " \u26A0\uFE0F"
        : indicator === "new"
          ? " \uD83C\uDD95"
          : " \u2796";
  return `${sign}${String(delta)}${emoji}`;
};

const hr = (
  left: string,
  mid: string,
  right: string,
  fill: string,
  colWidths: number[],
): string => {
  return `${left}${colWidths.map((w) => fill.repeat(w + 2)).join(mid)}${right}`;
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const computeAgeInDays = (iso: string | null, now: Date): number | null => {
  if (iso === null) {
    return null;
  }
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - parsed) / DAY_IN_MS));
};

const mergeScores = (
  existingScores: readonly VisualBenchmarkScoreEntry[],
  replacementScores: readonly VisualBenchmarkScoreEntry[],
): VisualBenchmarkScoreEntry[] => {
  const replacements = new Map(
    replacementScores.map((entry) => [getScoreKey(entry), entry]),
  );
  const merged = existingScores
    .filter((entry) => !replacements.has(getScoreKey(entry)))
    .map((entry) => ({ ...entry }));

  for (const entry of replacementScores) {
    merged.push({ ...entry });
  }

  return sortScores(merged);
};

const updateFixtureMetadata = async (
  fixtureId: string,
  metadata: VisualBenchmarkFixtureMetadata,
  capturedAt: string,
  viewport: { width: number; height: number },
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  await writeVisualBenchmarkFixtureMetadata(
    fixtureId,
    {
      ...metadata,
      capturedAt,
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
    },
    options,
  );
};

const getDiffIndicator = (
  baselineScore: number | null,
  currentScore: number,
  regressionConfig: VisualQualityResolvedRegressionConfig,
): "improved" | "degraded" | "neutral" | "new" => {
  if (baselineScore === null) {
    return "new";
  }
  const delta = Math.round((currentScore - baselineScore) * 100) / 100;
  if (Math.abs(delta) <= regressionConfig.neutralTolerance) {
    return "neutral";
  }
  return delta > 0 ? "improved" : "degraded";
};

const resolveRegressionConfig = async (
  options?: VisualBaselineDependencies,
): Promise<VisualQualityResolvedRegressionConfig> => {
  const qualityConfig =
    options?.qualityConfig ?? (await loadVisualQualityConfig(options));
  return resolveVisualQualityRegressionConfig(qualityConfig);
};

const createScoreEntry = (
  fixtureId: string,
  score: number,
  metadata: VisualBenchmarkFixtureMetadata,
): VisualBenchmarkScoreEntry => {
  return {
    fixtureId,
    screenId: metadata.source.nodeId,
    screenName: normalizeOptionalScreenName(metadata.source.nodeName),
    score,
  };
};

const getBaselineMapScore = (
  baselineMap: ReadonlyMap<string, number>,
  fixtureId: string,
  screenId: string | undefined,
): number | null => {
  const screenKey = getScoreKey({ fixtureId, screenId });
  if (baselineMap.has(screenKey)) {
    return baselineMap.get(screenKey) ?? null;
  }

  const legacyKey = getScoreKey({ fixtureId });
  return baselineMap.get(legacyKey) ?? null;
};

const getEntryDisplayName = (
  fixtureId: string,
  screenName?: string,
): string => {
  const normalizedScreenName = normalizeOptionalScreenName(screenName);
  if (
    normalizedScreenName !== undefined &&
    normalizedScreenName !== fixtureId
  ) {
    return normalizedScreenName;
  }
  return fixtureIdToDisplayName(fixtureId);
};

const buildArtifactEntry = async (
  fixtureId: string,
  result: VisualBenchmarkFixtureExecutionArtifacts,
  ranAt: string,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry> => {
  return await saveVisualBenchmarkLastRunArtifact(
    {
      fixtureId,
      score: result.score,
      ranAt,
      viewport: result.viewport,
      actualImageBuffer: result.screenshotBuffer,
      diffImageBuffer: result.diffBuffer,
      report: result.report,
    },
    options,
  );
};

export const updateVisualBaselines = async (
  options?: VisualBaselineDependencies & { fixtureId?: string },
): Promise<VisualBaselineUpdateResult> => {
  const log = options?.log ?? defaultLog;
  const executeFixture =
    options?.executeFixture ??
    (async (
      fixtureId: string,
      fixtureOptions?: VisualBenchmarkExecutionOptions,
    ) => executeVisualBenchmarkFixtureLegacy(fixtureId, fixtureOptions));
  const regressionConfig = await resolveRegressionConfig(options);
  const runAt = (options?.now ?? (() => new Date()))().toISOString();

  let fixtureIds: string[];
  if (options?.fixtureId !== undefined) {
    assertAllowedFixtureId(options.fixtureId);
    fixtureIds = [options.fixtureId];
    log(`Updating visual baseline for fixture '${options.fixtureId}'...`);
  } else {
    fixtureIds = await listVisualBenchmarkFixtureIds(options);
    log(`Updating visual baselines for ${fixtureIds.length} fixture(s)...`);
  }

  const previousBaseline = await loadVisualBenchmarkBaseline(options);
  const previousLastRun = await loadVisualBenchmarkLastRun(options);
  const scores: VisualBenchmarkScoreEntry[] = [];
  const artifacts: VisualBenchmarkLastRunArtifactEntry[] = [];

  for (const fixtureId of fixtureIds) {
    log(`Running benchmark for '${fixtureId}'...`);
    const result = await executeFixture(fixtureId, options);
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      options,
    );
    await writeVisualBenchmarkReference(
      fixtureId,
      result.screenshotBuffer,
      options,
    );
    await updateFixtureMetadata(
      fixtureId,
      metadata,
      runAt,
      result.viewport,
      options,
    );
    const artifact = await buildArtifactEntry(
      fixtureId,
      result,
      runAt,
      options,
    );

    scores.push(createScoreEntry(fixtureId, result.score, metadata));
    artifacts.push(artifact);
    log(`  Updated reference and baseline score: ${result.score}`);
  }

  const mergedLastRunScores = mergeScores(
    previousLastRun?.scores ?? [],
    scores,
  );
  const mergedBaselineScores =
    options?.fixtureId !== undefined
      ? mergeScores(previousBaseline?.scores ?? [], scores)
      : scores;

  await saveVisualBenchmarkLastRun(mergedLastRunScores, options, runAt);
  await saveVisualBenchmarkBaselineScores(mergedBaselineScores, options);
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

  log("Visual baseline updated.");
  return {
    scores,
    previousBaseline,
    artifacts,
  };
};

export const approveVisualBaseline = async (
  screenName: string,
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineApproveResult> => {
  const fixtureId = assertAllowedFixtureId(screenName);
  const regressionConfig = await resolveRegressionConfig(options);
  const artifact = await loadVisualBenchmarkLastRunArtifact(fixtureId, options);
  if (artifact === null) {
    throw new Error(
      `No last-run artifact found for '${fixtureId}'. Run 'pnpm visual:baseline update --fixture ${fixtureId}' or 'pnpm benchmark:visual' first.`,
    );
  }

  const artifactPaths = resolveVisualBenchmarkLastRunArtifactPaths(
    fixtureId,
    options,
  );
  const actualImageBuffer = await readFile(artifactPaths.actualPngPath);
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  await writeVisualBenchmarkReference(fixtureId, actualImageBuffer, options);
  await updateFixtureMetadata(
    fixtureId,
    metadata,
    artifact.ranAt,
    artifact.viewport,
    options,
  );
  const approvedScoreEntry = createScoreEntry(
    fixtureId,
    artifact.score,
    metadata,
  );

  const previousBaseline = await loadVisualBenchmarkBaseline(options);
  const previousScore = getBaselineMapScore(
    new Map(
      (previousBaseline?.scores ?? []).map((entry) => [
        getScoreKey(entry),
        entry.score,
      ]),
    ),
    fixtureId,
    approvedScoreEntry.screenId,
  );
  const mergedBaselineScores = mergeScores(previousBaseline?.scores ?? [], [
    approvedScoreEntry,
  ]);
  await saveVisualBenchmarkBaselineScores(mergedBaselineScores, options);

  const previousLastRun = await loadVisualBenchmarkLastRun(options);
  const mergedLastRunScores = mergeScores(previousLastRun?.scores ?? [], [
    approvedScoreEntry,
  ]);
  await saveVisualBenchmarkLastRun(
    mergedLastRunScores,
    options,
    artifact.ranAt,
  );
  const existingHistory = await loadVisualBenchmarkHistory(options);
  const updatedHistory = appendVisualBenchmarkHistoryEntry(
    existingHistory,
    {
      runAt: artifact.ranAt,
      scores: [
        {
          fixtureId: approvedScoreEntry.fixtureId,
          screenId: approvedScoreEntry.screenId,
          screenName: approvedScoreEntry.screenName,
          score: approvedScoreEntry.score,
        },
      ],
    },
    regressionConfig.historySize,
  );
  await saveVisualBenchmarkHistory(updatedHistory, options);

  return {
    fixtureId,
    previousScore,
    newScore: artifact.score,
    approvedFrom: artifact.actualImagePath,
    referencePath: resolveVisualBenchmarkFixturePaths(fixtureId, options)
      .referencePngPath,
  };
};

export const computeVisualBaselineStatus = async (
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineStatusResult> => {
  const fixtureIds = await listVisualBenchmarkFixtureIds(options);
  const baseline = await loadVisualBenchmarkBaseline(options);
  const regressionConfig = await resolveRegressionConfig(options);
  const now = (options?.now ?? (() => new Date()))();
  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(getScoreKey(entry), entry.score);
    }
  }

  const entries: VisualBaselineStatusEntry[] = [];
  for (const fixtureId of fixtureIds) {
    const paths = resolveVisualBenchmarkFixturePaths(fixtureId, options);
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      options,
    );
    const artifact = await loadVisualBenchmarkLastRunArtifact(
      fixtureId,
      options,
    );
    const screenId = metadata.source.nodeId;
    const screenName = normalizeOptionalScreenName(metadata.source.nodeName);
    const baselineScore = getBaselineMapScore(baselineMap, fixtureId, screenId);
    const lastRunScore = artifact?.score ?? null;
    const indicator =
      lastRunScore === null
        ? "unavailable"
        : getDiffIndicator(baselineScore, lastRunScore, regressionConfig);

    entries.push({
      fixtureId,
      screenId,
      ...(screenName !== undefined ? { screenName } : {}),
      baselineScore,
      lastRunScore,
      hasPendingDiff: lastRunScore !== null && indicator !== "neutral",
      indicator,
      capturedAt: metadata.capturedAt,
      ageInDays: computeAgeInDays(metadata.capturedAt, now),
      lastRunAt: artifact?.ranAt ?? null,
      referencePngExists: await fileExists(paths.referencePngPath),
      actualImagePath: artifact?.actualImagePath ?? null,
      diffImagePath: artifact?.diffImagePath ?? null,
      reportPath: artifact?.reportPath ?? null,
    });
  }

  return { entries };
};

export const computeVisualBaselineDiff = async (
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineDiffResult> => {
  const lastRun = await loadVisualBenchmarkLastRun(options);
  if (lastRun === null || lastRun.scores.length === 0) {
    throw new Error(
      "No last run found. Run 'pnpm visual:baseline update' or 'pnpm benchmark:visual' first.",
    );
  }

  const baseline = await loadVisualBenchmarkBaseline(options);
  const regressionConfig = await resolveRegressionConfig(options);
  const baselineMap = new Map<string, number>();
  if (baseline !== null) {
    for (const entry of baseline.scores) {
      baselineMap.set(getScoreKey(entry), entry.score);
    }
  }

  const diffs: VisualBaselineDiffEntry[] = [];
  for (const entry of lastRun.scores) {
    const artifact = await loadVisualBenchmarkLastRunArtifact(
      entry.fixtureId,
      options,
    );
    const screenId =
      typeof entry.screenId === "string" && entry.screenId.trim().length > 0
        ? entry.screenId.trim()
        : entry.fixtureId;
    const screenName = normalizeOptionalScreenName(entry.screenName);
    const baselineScore = getBaselineMapScore(
      baselineMap,
      entry.fixtureId,
      screenId,
    );
    const delta =
      baselineScore !== null
        ? Math.round((entry.score - baselineScore) * 100) / 100
        : null;
    const indicator = getDiffIndicator(
      baselineScore,
      entry.score,
      regressionConfig,
    );
    diffs.push({
      fixtureId: entry.fixtureId,
      screenId,
      ...(screenName !== undefined ? { screenName } : {}),
      baseline: baselineScore,
      current: entry.score,
      delta,
      indicator,
      ranAt: artifact?.ranAt ?? lastRun.ranAt,
      actualImagePath: artifact?.actualImagePath ?? null,
      diffImagePath: artifact?.diffImagePath ?? null,
      reportPath: artifact?.reportPath ?? null,
    });
  }

  const hasPendingDiffs = diffs.some((entry) => entry.indicator !== "neutral");
  return { diffs, hasPendingDiffs };
};

export const formatVisualBaselineStatusTable = (
  result: VisualBaselineStatusResult,
): string => {
  const cols = [23, 10, 10, 10, 5, 10, 5];
  const lines: string[] = [];

  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500", cols));
  lines.push(
    `\u2502 ${padRight("Fixture", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Last Run", cols[2])} \u2502 ${padRight("Diff", cols[3])} \u2502 ${padRight("Ref", cols[4])} \u2502 ${padRight("Captured", cols[5])} \u2502 ${padRight("Age", cols[6])} \u2502`,
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500", cols));

  for (const entry of result.entries) {
    const diffStr =
      entry.lastRunScore === null
        ? "\u2014 \u2796"
        : formatDeltaCell(
            entry.baselineScore !== null
              ? Math.round((entry.lastRunScore - entry.baselineScore) * 100) /
                  100
              : null,
            entry.indicator,
          );

    lines.push(
      `\u2502 ${padRight(getEntryDisplayName(entry.fixtureId, entry.screenName), cols[0])} \u2502 ${padLeft(entry.baselineScore !== null ? String(entry.baselineScore) : "\u2014", cols[1])} \u2502 ${padLeft(entry.lastRunScore !== null ? String(entry.lastRunScore) : "\u2014", cols[2])} \u2502 ${padRight(diffStr, cols[3])} \u2502 ${padRight(entry.referencePngExists ? "\u2713" : "\u2717", cols[4])} \u2502 ${padRight(entry.capturedAt !== null ? entry.capturedAt.slice(0, 10) : "\u2014", cols[5])} \u2502 ${padLeft(entry.ageInDays !== null ? String(entry.ageInDays) : "\u2014", cols[6])} \u2502`,
    );
  }

  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500", cols));
  return lines.join("\n");
};

export const formatVisualBaselineDiffTable = (
  result: VisualBaselineDiffResult,
): string => {
  const cols = [23, 10, 10, 10, 10];
  const lines: string[] = [];

  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500", cols));
  lines.push(
    `\u2502 ${padRight("Fixture", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Current", cols[2])} \u2502 ${padRight("Delta", cols[3])} \u2502 ${padRight("Run Date", cols[4])} \u2502`,
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500", cols));

  for (const diff of result.diffs) {
    lines.push(
      `\u2502 ${padRight(getEntryDisplayName(diff.fixtureId, diff.screenName), cols[0])} \u2502 ${padLeft(diff.baseline !== null ? String(diff.baseline) : "\u2014", cols[1])} \u2502 ${padLeft(String(diff.current), cols[2])} \u2502 ${padRight(formatDeltaCell(diff.delta, diff.indicator), cols[3])} \u2502 ${padRight(diff.ranAt !== null ? diff.ranAt.slice(0, 10) : "\u2014", cols[4])} \u2502`,
    );
  }

  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500", cols));
  return lines.join("\n");
};
