import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import {
  assertAllowedFixtureId,
  assertAllowedScreenId,
  enumerateFixtureScreens,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureMetadata,
  resolveVisualBenchmarkFixturePaths,
  resolveVisualBenchmarkScreenPaths,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
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
  executeVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureExecutionArtifacts,
  type VisualBenchmarkFixtureRunResult,
  type VisualBenchmarkFixtureScreenArtifact,
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
  screenId?: string;
  screenName?: string;
  previousScore: number | null;
  newScore: number;
  approvedFrom: string;
  referencePath: string;
  approvals: Array<{
    fixtureId: string;
    screenId: string;
    screenName?: string;
    previousScore: number | null;
    newScore: number;
    approvedFrom: string;
    referencePath: string;
  }>;
}

interface VisualBaselineTargetOptions {
  fixtureId?: string;
  screenId?: string;
}

type VisualBaselineFixtureExecutionLike =
  | VisualBenchmarkFixtureExecutionArtifacts
  | VisualBenchmarkFixtureRunResult;

export interface VisualBaselineDependencies extends VisualBenchmarkFixtureOptions {
  qualityConfig?: VisualQualityConfig;
  log?: (message: string) => void;
  now?: () => Date;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBaselineFixtureExecutionLike>;
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
  viewport: { width: number; height: number } | undefined,
  options?: VisualBenchmarkFixtureOptions,
): Promise<void> => {
  await writeVisualBenchmarkFixtureMetadata(
    fixtureId,
    {
      ...metadata,
      capturedAt,
      viewport:
        viewport === undefined
          ? metadata.viewport
          : {
              width: viewport.width,
              height: viewport.height,
            },
    },
    options,
  );
};

const assertValidTargetSelection = (
  target?: VisualBaselineTargetOptions,
): void => {
  if (target?.fixtureId !== undefined) {
    assertAllowedFixtureId(target.fixtureId);
  }
  if (target?.screenId !== undefined) {
    assertAllowedScreenId(target.screenId);
    if (target.fixtureId === undefined) {
      throw new Error("A fixture id is required when targeting a screen.");
    }
  }
};

const isMultiScreenFixture = (
  screens: readonly VisualBenchmarkFixtureScreenMetadata[],
): boolean => screens.length > 1;

const resolveTargetScreens = (
  fixtureId: string,
  metadata: VisualBenchmarkFixtureMetadata,
  screenId?: string,
): VisualBenchmarkFixtureScreenMetadata[] => {
  const screens = enumerateFixtureScreens(metadata);
  if (screenId === undefined) {
    return screens;
  }

  const normalizedScreenId = assertAllowedScreenId(screenId);
  const matched = screens.find((entry) => entry.screenId === normalizedScreenId);
  if (matched === undefined) {
    throw new Error(
      `Fixture '${fixtureId}' does not declare screen '${normalizedScreenId}'.`,
    );
  }
  return [matched];
};

const createScoreEntryForScreen = (
  fixtureId: string,
  screen: Pick<VisualBenchmarkFixtureScreenMetadata, "screenId" | "screenName">,
  score: number,
): VisualBenchmarkScoreEntry => {
  return {
    fixtureId,
    screenId: screen.screenId,
    screenName: normalizeOptionalScreenName(screen.screenName),
    score,
  };
};

const mergeScoresForFixture = (
  existingScores: readonly VisualBenchmarkScoreEntry[],
  replacementScores: readonly VisualBenchmarkScoreEntry[],
  fixtureId: string,
  replaceAllFixtureScreens: boolean,
): VisualBenchmarkScoreEntry[] => {
  const normalizedFixtureId = assertAllowedFixtureId(fixtureId);
  if (!replaceAllFixtureScreens) {
    return mergeScores(existingScores, replacementScores);
  }

  const merged = existingScores
    .filter((entry) => entry.fixtureId !== normalizedFixtureId)
    .map((entry) => ({ ...entry }));
  for (const entry of replacementScores) {
    merged.push({ ...entry });
  }
  return sortScores(merged);
};

const getReferencePngPath = (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  multiScreen: boolean,
  options?: VisualBenchmarkFixtureOptions,
): string => {
  return multiScreen
    ? resolveVisualBenchmarkScreenPaths(fixtureId, screen.screenId, options)
        .referencePngPath
    : resolveVisualBenchmarkFixturePaths(fixtureId, options).referencePngPath;
};

const writeReferenceForScreen = async (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  multiScreen: boolean,
  buffer: Buffer,
  options?: VisualBenchmarkFixtureOptions,
): Promise<string> => {
  if (!isValidPngBuffer(buffer)) {
    throw new Error(
      `Refusing to write invalid PNG for fixture '${fixtureId}' screen '${screen.screenId}'.`,
    );
  }
  if (!multiScreen) {
    await writeVisualBenchmarkReference(fixtureId, buffer, options);
    return resolveVisualBenchmarkFixturePaths(fixtureId, options).referencePngPath;
  }

  const referencePngPath = getReferencePngPath(fixtureId, screen, true, options);
  await mkdir(path.dirname(referencePngPath), { recursive: true });
  await writeFile(referencePngPath, buffer);
  return referencePngPath;
};

const loadArtifactForScreen = async (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  allScreens: readonly VisualBenchmarkFixtureScreenMetadata[],
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry | null> => {
  const artifact = await loadVisualBenchmarkLastRunArtifact(
    fixtureId,
    screen.screenId,
    options,
  );
  if (artifact !== null) {
    return artifact;
  }

  if (allScreens.length === 1) {
    return await loadVisualBenchmarkLastRunArtifact(fixtureId, options);
  }

  return null;
};

const buildArtifactEntry = async (
  fixtureId: string,
  screen: VisualBenchmarkFixtureScreenMetadata,
  result: Pick<
    VisualBenchmarkFixtureScreenArtifact,
    "score" | "screenshotBuffer" | "diffBuffer" | "report" | "viewport"
  >,
  ranAt: string,
  multiScreen: boolean,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualBenchmarkLastRunArtifactEntry> => {
  return await saveVisualBenchmarkLastRunArtifact(
    {
      fixtureId,
      ...(multiScreen ? { screenId: screen.screenId } : {}),
      ...(screen.screenName.trim().length > 0
        ? { screenName: screen.screenName }
        : {}),
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

const normalizeExecutionResult = (
  fixtureId: string,
  metadata: VisualBenchmarkFixtureMetadata,
  executionResult: VisualBaselineFixtureExecutionLike,
  targetScreens: readonly VisualBenchmarkFixtureScreenMetadata[],
): VisualBenchmarkFixtureScreenArtifact[] => {
  if ("screens" in executionResult && Array.isArray(executionResult.screens)) {
    const screenArtifacts = new Map(
      executionResult.screens.map((entry) => [entry.screenId, entry]),
    );
    return targetScreens.map((screen) => {
      const artifact = screenArtifacts.get(screen.screenId);
      if (artifact === undefined) {
        throw new Error(
          `Benchmark fixture '${fixtureId}' did not produce artifacts for screen '${screen.screenId}'.`,
        );
      }
      return artifact;
    });
  }

  const allScreens = enumerateFixtureScreens(metadata);
  if (allScreens.length !== 1 || targetScreens.length !== 1) {
    throw new Error(
      `Benchmark fixture '${fixtureId}' returned legacy single-screen artifacts for a multi-screen baseline update.`,
    );
  }

  const [screen] = targetScreens;
  return [
    {
      screenId: screen.screenId,
      screenName: screen.screenName,
      nodeId: screen.nodeId,
      score: executionResult.score,
      screenshotBuffer: executionResult.screenshotBuffer,
      diffBuffer: executionResult.diffBuffer,
      report: executionResult.report,
      viewport: executionResult.viewport,
    },
  ];
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

export const updateVisualBaselines = async (
  options?: VisualBaselineDependencies & VisualBaselineTargetOptions,
): Promise<VisualBaselineUpdateResult> => {
  assertValidTargetSelection(options);
  const log = options?.log ?? defaultLog;
  const executeFixture =
    options?.executeFixture ??
    (async (
      fixtureId: string,
      fixtureOptions?: VisualBenchmarkExecutionOptions,
    ) => executeVisualBenchmarkFixture(fixtureId, fixtureOptions));
  const regressionConfig = await resolveRegressionConfig(options);
  const runAt = (options?.now ?? (() => new Date()))().toISOString();

  let fixtureIds: string[];
  if (options?.fixtureId !== undefined) {
    assertAllowedFixtureId(options.fixtureId);
    fixtureIds = [options.fixtureId];
    if (options.screenId !== undefined) {
      log(
        `Updating visual baseline for fixture '${options.fixtureId}' screen '${options.screenId}'...`,
      );
    } else {
      log(`Updating visual baseline for fixture '${options.fixtureId}'...`);
    }
  } else {
    fixtureIds = await listVisualBenchmarkFixtureIds(options);
    log(`Updating visual baselines for ${fixtureIds.length} fixture(s)...`);
  }

  const previousBaseline = await loadVisualBenchmarkBaseline(options);
  const previousLastRun = await loadVisualBenchmarkLastRun(options);
  const scores: VisualBenchmarkScoreEntry[] = [];
  const artifacts: VisualBenchmarkLastRunArtifactEntry[] = [];
  let replaceAllTargetFixtureScreens = options?.screenId === undefined;

  for (const fixtureId of fixtureIds) {
    log(`Running benchmark for '${fixtureId}'...`);
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      options,
    );
    const allScreens = enumerateFixtureScreens(metadata);
    const targetScreens = resolveTargetScreens(
      fixtureId,
      metadata,
      options?.screenId,
    );
    const multiScreen = isMultiScreenFixture(allScreens);
    if (
      options?.fixtureId === fixtureId &&
      options.screenId === undefined &&
      !multiScreen
    ) {
      // Legacy single-screen fixture updates should only replace that screen's
      // score entry, preserving any unrelated historical screen rows.
      replaceAllTargetFixtureScreens = false;
    }
    const result = await executeFixture(fixtureId, options);
    const screenArtifacts = normalizeExecutionResult(
      fixtureId,
      metadata,
      result,
      targetScreens,
    );

    for (const screenArtifact of screenArtifacts) {
      const targetScreen =
        targetScreens.find((screen) => screen.screenId === screenArtifact.screenId) ??
        targetScreens[0];
      if (targetScreen === undefined) {
        throw new Error(
          `Benchmark fixture '${fixtureId}' produced an unexpected screen artifact.`,
        );
      }
      await writeReferenceForScreen(
        fixtureId,
        targetScreen,
        multiScreen,
        screenArtifact.screenshotBuffer,
        options,
      );
      const artifact = await buildArtifactEntry(
        fixtureId,
        targetScreen,
        screenArtifact,
        runAt,
        multiScreen,
        options,
      );
      scores.push(
        createScoreEntryForScreen(
          fixtureId,
          targetScreen,
          screenArtifact.score,
        ),
      );
      artifacts.push(artifact);
      log(
        `  Updated reference for '${targetScreen.screenName}' (${targetScreen.screenId}): ${screenArtifact.score}`,
      );
    }

    await updateFixtureMetadata(
      fixtureId,
      metadata,
      runAt,
      multiScreen ? undefined : screenArtifacts[0]?.viewport,
      options,
    );
  }

  const mergedLastRunScores =
    options?.fixtureId === undefined
      ? sortScores(scores)
      : mergeScoresForFixture(
          previousLastRun?.scores ?? [],
          scores,
          options.fixtureId,
          replaceAllTargetFixtureScreens,
        );
  const mergedBaselineScores =
    options?.fixtureId === undefined
      ? sortScores(scores)
      : mergeScoresForFixture(
          previousBaseline?.scores ?? [],
          scores,
          options.fixtureId,
          replaceAllTargetFixtureScreens,
        );

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
  target: string | { fixtureId: string; screenId?: string },
  options?: VisualBaselineDependencies,
): Promise<VisualBaselineApproveResult> => {
  const fixtureId =
    typeof target === "string"
      ? assertAllowedFixtureId(target)
      : assertAllowedFixtureId(target.fixtureId);
  const targetScreenId =
    typeof target === "string" ? undefined : target.screenId;
  assertValidTargetSelection({ fixtureId, screenId: targetScreenId });
  const regressionConfig = await resolveRegressionConfig(options);
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  const allScreens = enumerateFixtureScreens(metadata);
  const targetScreens = resolveTargetScreens(fixtureId, metadata, targetScreenId);
  const multiScreen = isMultiScreenFixture(allScreens);
  const previousBaseline = await loadVisualBenchmarkBaseline(options);
  const baselineMap = new Map(
    (previousBaseline?.scores ?? []).map((entry) => [getScoreKey(entry), entry.score]),
  );

  const approvedScores: VisualBenchmarkScoreEntry[] = [];
  const approvals: VisualBaselineApproveResult["approvals"] = [];
  let latestRanAt: string | null = null;
  let singleViewport: { width: number; height: number } | undefined;

  for (const screen of targetScreens) {
    const artifact = await loadArtifactForScreen(
      fixtureId,
      screen,
      allScreens,
      options,
    );
    if (artifact === null) {
      const commandSuffix =
        targetScreenId === undefined
          ? `--fixture ${fixtureId}`
          : `--fixture ${fixtureId} --screen ${screen.screenId}`;
      throw new Error(
        `No last-run artifact found for '${fixtureId}' screen '${screen.screenId}'. Run 'pnpm visual:baseline update ${commandSuffix}' or 'pnpm benchmark:visual' first.`,
      );
    }

    const actualImageBuffer = await readFile(
      path.resolve(process.cwd(), artifact.actualImagePath),
    );
    const referencePath = await writeReferenceForScreen(
      fixtureId,
      screen,
      multiScreen,
      actualImageBuffer,
      options,
    );
    const approvedScoreEntry = createScoreEntryForScreen(
      fixtureId,
      screen,
      artifact.score,
    );
    const previousScore = getBaselineMapScore(
      baselineMap,
      fixtureId,
      approvedScoreEntry.screenId,
    );

    approvedScores.push(approvedScoreEntry);
    approvals.push({
      fixtureId,
      screenId: approvedScoreEntry.screenId!,
      ...(approvedScoreEntry.screenName !== undefined
        ? { screenName: approvedScoreEntry.screenName }
        : {}),
      previousScore,
      newScore: artifact.score,
      approvedFrom: artifact.actualImagePath,
      referencePath,
    });
    if (latestRanAt === null || artifact.ranAt > latestRanAt) {
      latestRanAt = artifact.ranAt;
    }
    if (!multiScreen) {
      singleViewport = artifact.viewport;
    }
  }

  if (latestRanAt === null) {
    throw new Error(`No screens were approved for fixture '${fixtureId}'.`);
  }

  await updateFixtureMetadata(
    fixtureId,
    metadata,
    latestRanAt,
    multiScreen ? undefined : singleViewport,
    options,
  );
  const mergedBaselineScores = mergeScoresForFixture(
    previousBaseline?.scores ?? [],
    approvedScores,
    fixtureId,
    targetScreenId === undefined && multiScreen,
  );
  await saveVisualBenchmarkBaselineScores(mergedBaselineScores, options);

  const previousLastRun = await loadVisualBenchmarkLastRun(options);
  const mergedLastRunScores = mergeScoresForFixture(
    previousLastRun?.scores ?? [],
    approvedScores,
    fixtureId,
    targetScreenId === undefined && multiScreen,
  );
  await saveVisualBenchmarkLastRun(
    mergedLastRunScores,
    options,
    latestRanAt,
  );
  const existingHistory = await loadVisualBenchmarkHistory(options);
  const updatedHistory = appendVisualBenchmarkHistoryEntry(
    existingHistory,
    {
      runAt: latestRanAt,
      scores: approvedScores.map((entry) => ({
        fixtureId: entry.fixtureId,
        screenId: entry.screenId,
        screenName: entry.screenName,
        score: entry.score,
      })),
    },
    regressionConfig.historySize,
  );
  await saveVisualBenchmarkHistory(updatedHistory, options);

  const [firstApproval] = approvals;
  if (firstApproval === undefined) {
    throw new Error(`No screens were approved for fixture '${fixtureId}'.`);
  }

  return {
    fixtureId,
    screenId: firstApproval.screenId,
    ...(firstApproval.screenName !== undefined
      ? { screenName: firstApproval.screenName }
      : {}),
    previousScore: firstApproval.previousScore,
    newScore: firstApproval.newScore,
    approvedFrom: firstApproval.approvedFrom,
    referencePath: firstApproval.referencePath,
    approvals,
  };
};

export const computeVisualBaselineStatus = async (
  options?: VisualBaselineDependencies & VisualBaselineTargetOptions,
): Promise<VisualBaselineStatusResult> => {
  assertValidTargetSelection(options);
  const fixtureIds =
    options?.fixtureId !== undefined
      ? [assertAllowedFixtureId(options.fixtureId)]
      : await listVisualBenchmarkFixtureIds(options);
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
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      options,
    );
    const allScreens = enumerateFixtureScreens(metadata);
    const targetScreens = resolveTargetScreens(
      fixtureId,
      metadata,
      options?.screenId,
    );
    const multiScreen = isMultiScreenFixture(allScreens);
    for (const screen of targetScreens) {
      const artifact = await loadArtifactForScreen(
        fixtureId,
        screen,
        allScreens,
        options,
      );
      const baselineScore = getBaselineMapScore(
        baselineMap,
        fixtureId,
        screen.screenId,
      );
      const lastRunScore = artifact?.score ?? null;
      const indicator =
        lastRunScore === null
          ? "unavailable"
          : getDiffIndicator(baselineScore, lastRunScore, regressionConfig);

      entries.push({
        fixtureId,
        screenId: screen.screenId,
        ...(normalizeOptionalScreenName(screen.screenName) !== undefined
          ? { screenName: normalizeOptionalScreenName(screen.screenName) }
          : {}),
        baselineScore,
        lastRunScore,
        hasPendingDiff: lastRunScore !== null && indicator !== "neutral",
        indicator,
        capturedAt: metadata.capturedAt,
        ageInDays: computeAgeInDays(metadata.capturedAt, now),
        lastRunAt: artifact?.ranAt ?? null,
        referencePngExists: await fileExists(
          getReferencePngPath(fixtureId, screen, multiScreen, options),
        ),
        actualImagePath: artifact?.actualImagePath ?? null,
        diffImagePath: artifact?.diffImagePath ?? null,
        reportPath: artifact?.reportPath ?? null,
      });
    }
  }

  return { entries };
};

export const computeVisualBaselineDiff = async (
  options?: VisualBaselineDependencies & VisualBaselineTargetOptions,
): Promise<VisualBaselineDiffResult> => {
  assertValidTargetSelection(options);
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
  const filteredScores = lastRun.scores.filter((entry) => {
    if (
      options?.fixtureId !== undefined &&
      entry.fixtureId !== options.fixtureId
    ) {
      return false;
    }
    if (options?.screenId === undefined) {
      return true;
    }
    return entry.screenId === options.screenId;
  });
  if (filteredScores.length === 0) {
    const targetLabel =
      options?.screenId === undefined
        ? options?.fixtureId ?? "requested selection"
        : `${options.fixtureId}::${options.screenId}`;
    throw new Error(`No last run found for '${targetLabel}'.`);
  }

  for (const entry of filteredScores) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      entry.fixtureId,
      options,
    );
    const allScreens = enumerateFixtureScreens(metadata);
    const lastRunScreenId =
      typeof entry.screenId === "string" && entry.screenId.trim().length > 0
        ? entry.screenId.trim()
        : undefined;
    const canonicalLegacyScreenId =
      lastRunScreenId !== undefined &&
      lastRunScreenId === entry.fixtureId &&
      allScreens.length === 1
        ? undefined
        : lastRunScreenId;
    const resolvedScreen =
      canonicalLegacyScreenId !== undefined
        ? allScreens.find((screen) => screen.screenId === canonicalLegacyScreenId) ?? {
            screenId: canonicalLegacyScreenId,
            screenName:
              normalizeOptionalScreenName(entry.screenName) ??
              normalizeOptionalScreenName(metadata.source.nodeName) ??
              canonicalLegacyScreenId,
            nodeId: canonicalLegacyScreenId,
            viewport: metadata.viewport,
          }
        : allScreens.length === 1
          ? allScreens[0]
          : {
              screenId: metadata.source.nodeId,
              screenName:
                normalizeOptionalScreenName(entry.screenName) ??
                normalizeOptionalScreenName(metadata.source.nodeName) ??
                metadata.source.nodeId,
              nodeId: metadata.source.nodeId,
              viewport: metadata.viewport,
            };
    const artifact = await loadArtifactForScreen(
      entry.fixtureId,
      resolvedScreen,
      allScreens,
      options,
    );
    const screenName = normalizeOptionalScreenName(resolvedScreen.screenName);
    const baselineScore = getBaselineMapScore(
      baselineMap,
      entry.fixtureId,
      resolvedScreen.screenId,
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
      screenId: resolvedScreen.screenId,
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
    `\u2502 ${padRight("View", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Last Run", cols[2])} \u2502 ${padRight("Diff", cols[3])} \u2502 ${padRight("Ref", cols[4])} \u2502 ${padRight("Captured", cols[5])} \u2502 ${padRight("Age", cols[6])} \u2502`,
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
    `\u2502 ${padRight("View", cols[0])} \u2502 ${padRight("Baseline", cols[1])} \u2502 ${padRight("Current", cols[2])} \u2502 ${padRight("Delta", cols[3])} \u2502 ${padRight("Run Date", cols[4])} \u2502`,
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
