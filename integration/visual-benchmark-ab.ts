import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { z } from "zod";
import {
  getVisualBenchmarkScoreKey,
  loadVisualBenchmarkLastRunArtifacts,
  runVisualBenchmark,
  type VisualBenchmarkDelta,
  type VisualBenchmarkLastRunArtifactEntry,
  type VisualBenchmarkResult,
  type VisualBenchmarkRunOptions,
} from "./visual-benchmark-runner.js";
import {
  parseVisualQualityConfig,
  resolveVisualQualityRegressionConfig,
  type VisualQualityConfig,
} from "./visual-quality-config.js";
import {
  assertBenchmarkBrowserName,
  type BenchmarkBrowserName,
} from "./visual-benchmark.execution.js";
import {
  assertAllowedFixtureId,
  assertAllowedScreenId,
  assertAllowedViewportId,
  fromScreenIdToken,
  getVisualBenchmarkFixtureRoot,
  toScreenIdToken,
  type VisualBenchmarkFixtureOptions,
} from "./visual-benchmark.helpers.js";

// ---------------------------------------------------------------------------
// Public configuration shape
// ---------------------------------------------------------------------------

export const DEFAULT_AB_NEUTRAL_TOLERANCE = 1;
export const DEFAULT_AB_ARTIFACT_ROOT = path.resolve(
  process.cwd(),
  "artifacts",
  "visual-benchmark-ab",
);
const CONFIG_A_DIRECTORY_NAME = "config-a";
const CONFIG_B_DIRECTORY_NAME = "config-b";
const COMPARISON_FILE_NAME = "comparison.json";
const COMPARISON_TABLE_FILE_NAME = "comparison.txt";
const THREE_WAY_DIFF_DIRECTORY_NAME = "three-way";

export const VisualBenchmarkAbConfigSchema = z
  .object({
    label: z.string().min(1),
    description: z.string().optional(),
    qualityConfig: z.unknown().optional(),
    browsers: z.array(z.string().min(1)).min(1).optional(),
    viewportId: z.string().min(1).optional(),
    componentVisualCatalogFile: z.string().min(1).optional(),
    storybookStaticDir: z.string().min(1).optional(),
  })
  .strict();

export interface VisualBenchmarkAbConfig {
  label: string;
  description?: string;
  qualityConfig?: VisualQualityConfig;
  browsers?: BenchmarkBrowserName[];
  viewportId?: string;
  componentVisualCatalogFile?: string;
  storybookStaticDir?: string;
}

export const parseVisualBenchmarkAbConfig = (
  input: unknown,
): VisualBenchmarkAbConfig => {
  const parseResult = VisualBenchmarkAbConfigSchema.safeParse(input);
  if (!parseResult.success) {
    const messages = parseResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid A/B config: ${messages}`);
  }
  const raw = parseResult.data;
  const config: VisualBenchmarkAbConfig = {
    label: raw.label,
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
  if (raw.qualityConfig !== undefined) {
    config.qualityConfig = parseVisualQualityConfig(raw.qualityConfig);
  }
  if (raw.browsers !== undefined) {
    const seen = new Set<BenchmarkBrowserName>();
    const ordered: BenchmarkBrowserName[] = [];
    for (const candidate of raw.browsers) {
      const validated = assertBenchmarkBrowserName(candidate);
      if (!seen.has(validated)) {
        seen.add(validated);
        ordered.push(validated);
      }
    }
    config.browsers = ordered;
  }
  if (raw.viewportId !== undefined) {
    config.viewportId = assertAllowedViewportId(raw.viewportId);
  }
  if (raw.componentVisualCatalogFile !== undefined) {
    config.componentVisualCatalogFile = raw.componentVisualCatalogFile;
  }
  if (raw.storybookStaticDir !== undefined) {
    config.storybookStaticDir = raw.storybookStaticDir;
  }
  return config;
};

export const loadVisualBenchmarkAbConfig = async (
  filePath: string,
): Promise<VisualBenchmarkAbConfig> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(`A/B config file '${filePath}' does not exist.`);
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to parse JSON in A/B config '${filePath}': ${message}`,
    );
  }
  return parseVisualBenchmarkAbConfig(parsed);
};

// ---------------------------------------------------------------------------
// Comparison data shapes
// ---------------------------------------------------------------------------

export type VisualBenchmarkAbIndicator =
  | "improved"
  | "degraded"
  | "neutral"
  | "unavailable";

export interface VisualBenchmarkAbComparisonEntry {
  fixtureId: string;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
  scoreA: number | null;
  scoreB: number | null;
  delta: number | null;
  indicator: VisualBenchmarkAbIndicator;
}

export interface VisualBenchmarkAbStatistics {
  totalEntries: number;
  comparedEntries: number;
  improvedCount: number;
  degradedCount: number;
  neutralCount: number;
  unavailableCount: number;
  meanDelta: number | null;
  meanImprovement: number | null;
  bestImprovement: number | null;
  worstRegression: number | null;
  netChange: number;
}

export interface VisualBenchmarkAbConfigSummary {
  label: string;
  description?: string;
  overallScore: number;
}

export interface VisualBenchmarkAbResult {
  configA: VisualBenchmarkAbConfigSummary;
  configB: VisualBenchmarkAbConfigSummary;
  entries: VisualBenchmarkAbComparisonEntry[];
  overallDelta: number | null;
  statistics: VisualBenchmarkAbStatistics;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Pure comparison
// ---------------------------------------------------------------------------

const roundToTwoDecimals = (value: number): number =>
  Math.round(value * 100) / 100;

const indicatorFromDelta = (
  delta: number | null,
  neutralTolerance: number,
): VisualBenchmarkAbIndicator => {
  if (delta === null) {
    return "unavailable";
  }
  if (delta > neutralTolerance) {
    return "improved";
  }
  if (delta < -neutralTolerance) {
    return "degraded";
  }
  return "neutral";
};

const toEntryKey = (delta: VisualBenchmarkDelta): string =>
  getVisualBenchmarkScoreKey({
    fixtureId: delta.fixtureId,
    screenId: delta.screenId,
    viewportId: delta.viewportId,
  });

const buildDeltaIndex = (
  result: VisualBenchmarkResult,
): Map<string, VisualBenchmarkDelta> => {
  const index = new Map<string, VisualBenchmarkDelta>();
  for (const delta of result.deltas) {
    index.set(toEntryKey(delta), delta);
  }
  return index;
};

const sortEntries = (
  entries: VisualBenchmarkAbComparisonEntry[],
): VisualBenchmarkAbComparisonEntry[] =>
  [...entries].sort((left, right) => {
    const fixtureCompare = left.fixtureId.localeCompare(right.fixtureId);
    if (fixtureCompare !== 0) {
      return fixtureCompare;
    }
    const screenCompare = (left.screenId ?? "").localeCompare(
      right.screenId ?? "",
    );
    if (screenCompare !== 0) {
      return screenCompare;
    }
    return (left.viewportId ?? "").localeCompare(right.viewportId ?? "");
  });

const computeStatistics = (
  entries: readonly VisualBenchmarkAbComparisonEntry[],
): VisualBenchmarkAbStatistics => {
  let comparedEntries = 0;
  let improvedCount = 0;
  let degradedCount = 0;
  let neutralCount = 0;
  let unavailableCount = 0;
  let bestImprovement: number | null = null;
  let worstRegression: number | null = null;
  let positiveDeltaSum = 0;
  let positiveDeltaCount = 0;
  let netChange = 0;
  for (const entry of entries) {
    if (entry.indicator === "unavailable" || entry.delta === null) {
      unavailableCount += 1;
      continue;
    }
    comparedEntries += 1;
    netChange += entry.delta;
    if (entry.indicator === "improved") {
      improvedCount += 1;
      positiveDeltaSum += entry.delta;
      positiveDeltaCount += 1;
    } else if (entry.indicator === "degraded") {
      degradedCount += 1;
    } else {
      neutralCount += 1;
    }
    if (bestImprovement === null || entry.delta > bestImprovement) {
      bestImprovement = entry.delta;
    }
    if (worstRegression === null || entry.delta < worstRegression) {
      worstRegression = entry.delta;
    }
  }
  const meanDelta =
    comparedEntries > 0
      ? roundToTwoDecimals(netChange / comparedEntries)
      : null;
  const meanImprovement =
    positiveDeltaCount > 0
      ? roundToTwoDecimals(positiveDeltaSum / positiveDeltaCount)
      : null;
  return {
    totalEntries: entries.length,
    comparedEntries,
    improvedCount,
    degradedCount,
    neutralCount,
    unavailableCount,
    meanDelta,
    meanImprovement,
    bestImprovement:
      bestImprovement !== null ? roundToTwoDecimals(bestImprovement) : null,
    worstRegression:
      worstRegression !== null ? roundToTwoDecimals(worstRegression) : null,
    netChange: roundToTwoDecimals(netChange),
  };
};

export interface CompareVisualBenchmarkResultsInput {
  configA: {
    label: string;
    description?: string;
    result: VisualBenchmarkResult;
  };
  configB: {
    label: string;
    description?: string;
    result: VisualBenchmarkResult;
  };
  neutralTolerance?: number;
}

export const compareVisualBenchmarkResults = (
  input: CompareVisualBenchmarkResultsInput,
): VisualBenchmarkAbResult => {
  const neutralTolerance =
    input.neutralTolerance ?? DEFAULT_AB_NEUTRAL_TOLERANCE;
  const indexA = buildDeltaIndex(input.configA.result);
  const indexB = buildDeltaIndex(input.configB.result);
  const allKeys = new Set<string>([...indexA.keys(), ...indexB.keys()]);
  const entries: VisualBenchmarkAbComparisonEntry[] = [];
  for (const key of allKeys) {
    const a = indexA.get(key);
    const b = indexB.get(key);
    const reference = a ?? b;
    if (reference === undefined) {
      continue;
    }
    const scoreA = a ? a.current : null;
    const scoreB = b ? b.current : null;
    const delta =
      scoreA !== null && scoreB !== null
        ? roundToTwoDecimals(scoreB - scoreA)
        : null;
    const entry: VisualBenchmarkAbComparisonEntry = {
      fixtureId: reference.fixtureId,
      ...(reference.screenId !== undefined
        ? { screenId: reference.screenId }
        : {}),
      ...(reference.screenName !== undefined
        ? { screenName: reference.screenName }
        : {}),
      ...(reference.viewportId !== undefined
        ? { viewportId: reference.viewportId }
        : {}),
      ...(reference.viewportLabel !== undefined
        ? { viewportLabel: reference.viewportLabel }
        : {}),
      scoreA,
      scoreB,
      delta,
      indicator: indicatorFromDelta(delta, neutralTolerance),
    };
    entries.push(entry);
  }
  const sortedEntries = sortEntries(entries);
  const overallA = input.configA.result.overallCurrent;
  const overallB = input.configB.result.overallCurrent;
  const overallDelta =
    Number.isFinite(overallA) && Number.isFinite(overallB)
      ? roundToTwoDecimals(overallB - overallA)
      : null;
  const statistics = computeStatistics(sortedEntries);
  const collectedWarnings = new Set<string>();
  for (const warning of input.configA.result.warnings ?? []) {
    collectedWarnings.add(`[${input.configA.label}] ${warning}`);
  }
  for (const warning of input.configB.result.warnings ?? []) {
    collectedWarnings.add(`[${input.configB.label}] ${warning}`);
  }
  const warnings =
    collectedWarnings.size > 0
      ? [...collectedWarnings].sort((left, right) => left.localeCompare(right))
      : undefined;
  return {
    configA: {
      label: input.configA.label,
      ...(input.configA.description !== undefined
        ? { description: input.configA.description }
        : {}),
      overallScore: overallA,
    },
    configB: {
      label: input.configB.label,
      ...(input.configB.description !== undefined
        ? { description: input.configB.description }
        : {}),
      overallScore: overallB,
    },
    entries: sortedEntries,
    overallDelta,
    statistics,
    ...(warnings !== undefined ? { warnings } : {}),
  };
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const padRight = (value: string, width: number): string => {
  if (value.length >= width) {
    return value.slice(0, width);
  }
  return value + " ".repeat(width - value.length);
};

const padLeft = (value: string, width: number): string => {
  if (value.length >= width) {
    return value.slice(0, width);
  }
  return " ".repeat(width - value.length) + value;
};

const formatScoreCell = (score: number | null): string => {
  if (score === null) {
    return "\u2014";
  }
  return String(roundToTwoDecimals(score));
};

const formatDeltaCell = (
  delta: number | null,
  indicator: VisualBenchmarkAbIndicator,
): string => {
  if (delta === null || indicator === "unavailable") {
    return "\u2014 n/a";
  }
  const sign = delta > 0 ? "+" : "";
  const emoji =
    indicator === "improved"
      ? " \u2705"
      : indicator === "degraded"
        ? " \u26A0\uFE0F"
        : " \u2796";
  return `${sign}${String(roundToTwoDecimals(delta))}${emoji}`;
};

const fixtureIdToDisplayName = (fixtureId: string): string =>
  fixtureId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const buildEntryDisplayName = (
  entry: VisualBenchmarkAbComparisonEntry,
): string => {
  const fixtureName = fixtureIdToDisplayName(entry.fixtureId);
  const screenLabel =
    typeof entry.screenName === "string" && entry.screenName.length > 0
      ? entry.screenName
      : typeof entry.screenId === "string" &&
          entry.screenId.length > 0 &&
          entry.screenId !== entry.fixtureId
        ? entry.screenId
        : null;
  const viewportLabel =
    entry.viewportLabel ??
    (entry.viewportId !== undefined && entry.viewportId !== "default"
      ? entry.viewportId
      : undefined);
  const parts: string[] = [fixtureName];
  if (screenLabel !== null) {
    parts.push(screenLabel);
  }
  if (viewportLabel !== undefined) {
    parts.push(viewportLabel);
  }
  return parts.join(" / ");
};

export const formatVisualBenchmarkAbTable = (
  result: VisualBenchmarkAbResult,
): string => {
  const viewCol = 31;
  const aCol = 8;
  const bCol = 8;
  const deltaCol = 10;
  const aHeader = `${result.configA.label}`.slice(0, aCol);
  const bHeader = `${result.configB.label}`.slice(0, bCol);

  const hr = (left: string, mid: string, right: string, fill: string): string =>
    `${left}${fill.repeat(viewCol + 2)}${mid}${fill.repeat(aCol + 2)}${mid}${fill.repeat(bCol + 2)}${mid}${fill.repeat(deltaCol + 2)}${right}`;

  const lines: string[] = [];
  lines.push(hr("\u250C", "\u252C", "\u2510", "\u2500"));
  lines.push(
    `\u2502 ${padRight("View", viewCol)} \u2502 ${padRight(aHeader, aCol)} \u2502 ${padRight(bHeader, bCol)} \u2502 ${padRight("B vs A", deltaCol)} \u2502`,
  );
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500"));
  for (const entry of result.entries) {
    lines.push(
      `\u2502 ${padRight(buildEntryDisplayName(entry), viewCol)} \u2502 ${padLeft(formatScoreCell(entry.scoreA), aCol)} \u2502 ${padLeft(formatScoreCell(entry.scoreB), bCol)} \u2502 ${padRight(formatDeltaCell(entry.delta, entry.indicator), deltaCol)} \u2502`,
    );
  }
  lines.push(hr("\u251C", "\u253C", "\u2524", "\u2500"));
  const overallDeltaCell =
    result.overallDelta !== null
      ? `${result.overallDelta > 0 ? "+" : ""}${String(roundToTwoDecimals(result.overallDelta))}`
      : "\u2014";
  lines.push(
    `\u2502 ${padRight("Overall Average", viewCol)} \u2502 ${padLeft(String(roundToTwoDecimals(result.configA.overallScore)), aCol)} \u2502 ${padLeft(String(roundToTwoDecimals(result.configB.overallScore)), bCol)} \u2502 ${padRight(overallDeltaCell, deltaCol)} \u2502`,
  );
  lines.push(hr("\u2514", "\u2534", "\u2518", "\u2500"));
  return lines.join("\n");
};

export const formatVisualBenchmarkAbStatistics = (
  result: VisualBenchmarkAbResult,
): string => {
  const stats = result.statistics;
  const lines: string[] = [];
  lines.push(
    `Statistical summary (${result.configB.label} vs ${result.configA.label}):`,
  );
  lines.push(
    `  Compared entries:    ${String(stats.comparedEntries)}/${String(stats.totalEntries)}`,
  );
  lines.push(`  Improved (\u2705):       ${String(stats.improvedCount)}`);
  lines.push(`  Degraded (\u26A0\uFE0F):       ${String(stats.degradedCount)}`);
  lines.push(`  Neutral (\u2796):        ${String(stats.neutralCount)}`);
  if (stats.unavailableCount > 0) {
    lines.push(
      `  Unavailable:         ${String(stats.unavailableCount)} (missing in one side)`,
    );
  }
  const formatOptional = (value: number | null): string =>
    value === null ? "n/a" : String(value);
  lines.push(`  Mean delta:          ${formatOptional(stats.meanDelta)}`);
  lines.push(`  Mean improvement:    ${formatOptional(stats.meanImprovement)}`);
  lines.push(`  Best improvement:    ${formatOptional(stats.bestImprovement)}`);
  lines.push(`  Worst regression:    ${formatOptional(stats.worstRegression)}`);
  lines.push(`  Net change:          ${String(stats.netChange)}`);
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Three-way diff composition
// ---------------------------------------------------------------------------

export interface ThreeWayDiffComposeInput {
  reference: Buffer | null;
  outputA: Buffer | null;
  outputB: Buffer | null;
  gap?: number;
  background?: { r: number; g: number; b: number };
}

const PLACEHOLDER_RGB = { r: 220, g: 220, b: 220 };
const DEFAULT_BACKGROUND_RGB = { r: 255, g: 255, b: 255 };
const DEFAULT_THREE_WAY_GAP = 16;
const PLACEHOLDER_FALLBACK_SIZE = 64;

const fillPng = (
  png: PNG,
  color: { r: number; g: number; b: number },
): void => {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color.r;
    png.data[i + 1] = color.g;
    png.data[i + 2] = color.b;
    png.data[i + 3] = 255;
  }
};

export const composeThreeWayDiff = (
  input: ThreeWayDiffComposeInput,
): Buffer => {
  const gap = input.gap ?? DEFAULT_THREE_WAY_GAP;
  const background = input.background ?? DEFAULT_BACKGROUND_RGB;
  const present: PNG[] = [];
  const refPng = input.reference ? PNG.sync.read(input.reference) : null;
  if (refPng) present.push(refPng);
  const aPng = input.outputA ? PNG.sync.read(input.outputA) : null;
  if (aPng) present.push(aPng);
  const bPng = input.outputB ? PNG.sync.read(input.outputB) : null;
  if (bPng) present.push(bPng);
  if (present.length === 0) {
    throw new Error(
      "composeThreeWayDiff requires at least one of reference, outputA, outputB.",
    );
  }
  const fallbackHeight = Math.max(...present.map((image) => image.height));
  const fallbackWidth = Math.max(...present.map((image) => image.width));
  const placeholderHeight =
    fallbackHeight > 0 ? fallbackHeight : PLACEHOLDER_FALLBACK_SIZE;
  const placeholderWidth =
    fallbackWidth > 0 ? fallbackWidth : PLACEHOLDER_FALLBACK_SIZE;
  const buildPlaceholder = (): PNG => {
    const placeholder = new PNG({
      width: placeholderWidth,
      height: placeholderHeight,
    });
    fillPng(placeholder, PLACEHOLDER_RGB);
    return placeholder;
  };
  const refCanvas = refPng ?? buildPlaceholder();
  const aCanvas = aPng ?? buildPlaceholder();
  const bCanvas = bPng ?? buildPlaceholder();
  const totalWidth =
    refCanvas.width + gap + aCanvas.width + gap + bCanvas.width;
  const totalHeight = Math.max(
    refCanvas.height,
    aCanvas.height,
    bCanvas.height,
  );
  const canvas = new PNG({ width: totalWidth, height: totalHeight });
  fillPng(canvas, background);
  const drawAt = (source: PNG, dx: number): void => {
    const dy = Math.floor((totalHeight - source.height) / 2);
    PNG.bitblt(source, canvas, 0, 0, source.width, source.height, dx, dy);
  };
  drawAt(refCanvas, 0);
  drawAt(aCanvas, refCanvas.width + gap);
  drawAt(bCanvas, refCanvas.width + gap + aCanvas.width + gap);
  return PNG.sync.write(canvas);
};

// ---------------------------------------------------------------------------
// Three-way diff filesystem orchestration
// ---------------------------------------------------------------------------

const resolveReferenceImagePath = (
  fixtureId: string,
  screenId: string | undefined,
  viewportId: string | undefined,
  options?: VisualBenchmarkFixtureOptions,
): string => {
  const root = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  const validatedFixtureId = assertAllowedFixtureId(fixtureId);
  if (
    typeof screenId === "string" &&
    screenId.length > 0 &&
    typeof viewportId === "string" &&
    viewportId.length > 0
  ) {
    const validatedScreenId = assertAllowedScreenId(screenId);
    const validatedViewportId = assertAllowedViewportId(viewportId);
    return path.join(
      root,
      validatedFixtureId,
      "screens",
      toScreenIdToken(validatedScreenId),
      `${validatedViewportId}.png`,
    );
  }
  return path.join(root, validatedFixtureId, "reference.png");
};

const safeReadFile = async (filePath: string): Promise<Buffer | null> => {
  try {
    return await readFile(filePath);
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

interface ResolveSideArtifactsInput {
  fixtureId: string;
  screenId?: string;
  viewportId?: string;
  artifactRoot: string;
}

const findArtifactEntry = async (
  input: ResolveSideArtifactsInput,
): Promise<VisualBenchmarkLastRunArtifactEntry | null> => {
  const sideOptions: VisualBenchmarkFixtureOptions = {
    artifactRoot: input.artifactRoot,
  };
  const lookupScreen =
    input.screenId !== undefined ? input.screenId : input.fixtureId;
  const entries = await loadVisualBenchmarkLastRunArtifacts(
    input.fixtureId,
    lookupScreen,
    sideOptions,
  );
  if (entries.length === 0 && input.screenId === undefined) {
    const fallback = await loadVisualBenchmarkLastRunArtifacts(
      input.fixtureId,
      sideOptions,
    );
    return (
      fallback.find(
        (entry) =>
          input.viewportId === undefined ||
          entry.viewportId === input.viewportId,
      ) ??
      fallback[0] ??
      null
    );
  }
  if (input.viewportId !== undefined) {
    const matched = entries.find(
      (entry) => entry.viewportId === input.viewportId,
    );
    if (matched !== undefined) {
      return matched;
    }
  }
  return entries[0] ?? null;
};

export interface ThreeWayDiffPersistedRecord {
  fixtureId: string;
  screenId?: string;
  viewportId?: string;
  diffImagePath: string;
  referenceImagePath: string | null;
  outputAImagePath: string | null;
  outputBImagePath: string | null;
}

export interface PersistThreeWayDiffsInput {
  result: VisualBenchmarkAbResult;
  artifactRoot: string;
  fixtureOptions?: VisualBenchmarkFixtureOptions;
}

export const persistVisualBenchmarkAbThreeWayDiffs = async (
  input: PersistThreeWayDiffsInput,
): Promise<ThreeWayDiffPersistedRecord[]> => {
  const records: ThreeWayDiffPersistedRecord[] = [];
  const threeWayRoot = path.join(
    input.artifactRoot,
    THREE_WAY_DIFF_DIRECTORY_NAME,
  );
  const sideARoot = path.join(input.artifactRoot, CONFIG_A_DIRECTORY_NAME);
  const sideBRoot = path.join(input.artifactRoot, CONFIG_B_DIRECTORY_NAME);
  for (const entry of input.result.entries) {
    const referencePath = resolveReferenceImagePath(
      entry.fixtureId,
      entry.screenId,
      entry.viewportId,
      input.fixtureOptions,
    );
    const referenceBuffer = await safeReadFile(referencePath);
    const artifactA = await findArtifactEntry({
      fixtureId: entry.fixtureId,
      ...(entry.screenId !== undefined ? { screenId: entry.screenId } : {}),
      ...(entry.viewportId !== undefined
        ? { viewportId: entry.viewportId }
        : {}),
      artifactRoot: sideARoot,
    });
    const artifactB = await findArtifactEntry({
      fixtureId: entry.fixtureId,
      ...(entry.screenId !== undefined ? { screenId: entry.screenId } : {}),
      ...(entry.viewportId !== undefined
        ? { viewportId: entry.viewportId }
        : {}),
      artifactRoot: sideBRoot,
    });
    const outputAPath =
      artifactA !== null
        ? path.resolve(process.cwd(), artifactA.actualImagePath)
        : null;
    const outputBPath =
      artifactB !== null
        ? path.resolve(process.cwd(), artifactB.actualImagePath)
        : null;
    const outputABuffer =
      outputAPath !== null ? await safeReadFile(outputAPath) : null;
    const outputBBuffer =
      outputBPath !== null ? await safeReadFile(outputBPath) : null;
    if (
      referenceBuffer === null &&
      outputABuffer === null &&
      outputBBuffer === null
    ) {
      continue;
    }
    let composed: Buffer;
    try {
      composed = composeThreeWayDiff({
        reference: referenceBuffer,
        outputA: outputABuffer,
        outputB: outputBBuffer,
      });
    } catch {
      continue;
    }
    const screenSegment =
      entry.screenId !== undefined
        ? toScreenIdToken(entry.screenId)
        : "default";
    const viewportSegment =
      entry.viewportId !== undefined ? entry.viewportId : "default";
    const diffPath = path.join(
      threeWayRoot,
      assertAllowedFixtureId(entry.fixtureId),
      screenSegment,
      `${viewportSegment}.png`,
    );
    await mkdir(path.dirname(diffPath), { recursive: true });
    await writeFile(diffPath, composed);
    records.push({
      fixtureId: entry.fixtureId,
      ...(entry.screenId !== undefined ? { screenId: entry.screenId } : {}),
      ...(entry.viewportId !== undefined
        ? { viewportId: entry.viewportId }
        : {}),
      diffImagePath: path.relative(process.cwd(), diffPath) || diffPath,
      referenceImagePath:
        referenceBuffer !== null
          ? path.relative(process.cwd(), referencePath) || referencePath
          : null,
      outputAImagePath:
        outputAPath !== null
          ? path.relative(process.cwd(), outputAPath) || outputAPath
          : null,
      outputBImagePath:
        outputBPath !== null
          ? path.relative(process.cwd(), outputBPath) || outputBPath
          : null,
    });
  }
  return records;
};

// ---------------------------------------------------------------------------
// Top-level runner
// ---------------------------------------------------------------------------

export interface RunVisualBenchmarkAbDependencies {
  runBenchmark?: (
    side: "a" | "b",
    options: VisualBenchmarkRunOptions,
  ) => Promise<VisualBenchmarkResult>;
}

export interface RunVisualBenchmarkAbInput {
  configA: VisualBenchmarkAbConfig;
  configB: VisualBenchmarkAbConfig;
  artifactRoot?: string;
  neutralTolerance?: number;
  fixtureOptions?: VisualBenchmarkFixtureOptions;
}

const buildRunOptions = (
  config: VisualBenchmarkAbConfig,
  artifactRoot: string,
  fixtureOptions?: VisualBenchmarkFixtureOptions,
): VisualBenchmarkRunOptions => {
  const options: VisualBenchmarkRunOptions = {
    artifactRoot,
  };
  if (fixtureOptions?.fixtureRoot !== undefined) {
    options.fixtureRoot = fixtureOptions.fixtureRoot;
  }
  if (config.qualityConfig !== undefined) {
    options.qualityConfig = config.qualityConfig;
  }
  if (config.viewportId !== undefined) {
    options.viewportId = config.viewportId;
  }
  if (config.componentVisualCatalogFile !== undefined) {
    options.componentVisualCatalogFile = config.componentVisualCatalogFile;
  }
  if (config.storybookStaticDir !== undefined) {
    options.storybookStaticDir = config.storybookStaticDir;
  }
  if (config.browsers !== undefined) {
    options.browsers = config.browsers;
  }
  return options;
};

const resolveRunnerNeutralTolerance = (
  configA: VisualBenchmarkAbConfig,
  configB: VisualBenchmarkAbConfig,
  override: number | undefined,
): number => {
  if (override !== undefined) {
    return override;
  }
  const fromB = configB.qualityConfig
    ? resolveVisualQualityRegressionConfig(configB.qualityConfig)
        .neutralTolerance
    : undefined;
  if (typeof fromB === "number") {
    return fromB;
  }
  const fromA = configA.qualityConfig
    ? resolveVisualQualityRegressionConfig(configA.qualityConfig)
        .neutralTolerance
    : undefined;
  if (typeof fromA === "number") {
    return fromA;
  }
  return DEFAULT_AB_NEUTRAL_TOLERANCE;
};

export const runVisualBenchmarkAb = async (
  input: RunVisualBenchmarkAbInput,
  dependencies?: RunVisualBenchmarkAbDependencies,
): Promise<VisualBenchmarkAbResult> => {
  if (input.configA.label === input.configB.label) {
    throw new Error(
      `A/B configs must declare distinct labels, both received '${input.configA.label}'.`,
    );
  }
  const artifactRoot = input.artifactRoot ?? DEFAULT_AB_ARTIFACT_ROOT;
  const sideARoot = path.join(artifactRoot, CONFIG_A_DIRECTORY_NAME);
  const sideBRoot = path.join(artifactRoot, CONFIG_B_DIRECTORY_NAME);
  const runBenchmark =
    dependencies?.runBenchmark ??
    (async (_side: "a" | "b", options: VisualBenchmarkRunOptions) =>
      runVisualBenchmark(options));
  const neutralTolerance = resolveRunnerNeutralTolerance(
    input.configA,
    input.configB,
    input.neutralTolerance,
  );
  const optionsA = buildRunOptions(
    input.configA,
    sideARoot,
    input.fixtureOptions,
  );
  const optionsB = buildRunOptions(
    input.configB,
    sideBRoot,
    input.fixtureOptions,
  );
  const resultA = await runBenchmark("a", optionsA);
  const resultB = await runBenchmark("b", optionsB);
  return compareVisualBenchmarkResults({
    configA: {
      label: input.configA.label,
      ...(input.configA.description !== undefined
        ? { description: input.configA.description }
        : {}),
      result: resultA,
    },
    configB: {
      label: input.configB.label,
      ...(input.configB.description !== undefined
        ? { description: input.configB.description }
        : {}),
      result: resultB,
    },
    neutralTolerance,
  });
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const orderedJsonStringify = (value: unknown): string =>
  JSON.stringify(
    value,
    (_key, raw) => {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const ordered: Record<string, unknown> = {};
        for (const key of Object.keys(raw as Record<string, unknown>).sort()) {
          ordered[key] = (raw as Record<string, unknown>)[key];
        }
        return ordered;
      }
      return raw;
    },
    2,
  );

export interface PersistVisualBenchmarkAbResultInput {
  result: VisualBenchmarkAbResult;
  artifactRoot: string;
  table?: string;
}

export interface PersistedVisualBenchmarkAbReportPaths {
  comparisonJsonPath: string;
  comparisonTablePath?: string;
}

export const persistVisualBenchmarkAbResult = async (
  input: PersistVisualBenchmarkAbResultInput,
): Promise<PersistedVisualBenchmarkAbReportPaths> => {
  await mkdir(input.artifactRoot, { recursive: true });
  const comparisonJsonPath = path.join(
    input.artifactRoot,
    COMPARISON_FILE_NAME,
  );
  await writeFile(
    comparisonJsonPath,
    `${orderedJsonStringify(input.result)}\n`,
  );
  let comparisonTablePath: string | undefined;
  if (input.table !== undefined) {
    comparisonTablePath = path.join(
      input.artifactRoot,
      COMPARISON_TABLE_FILE_NAME,
    );
    await writeFile(comparisonTablePath, `${input.table}\n`);
  }
  return {
    comparisonJsonPath,
    ...(comparisonTablePath !== undefined ? { comparisonTablePath } : {}),
  };
};

export const VISUAL_BENCHMARK_AB_INTERNAL = Object.freeze({
  CONFIG_A_DIRECTORY_NAME,
  CONFIG_B_DIRECTORY_NAME,
  COMPARISON_FILE_NAME,
  COMPARISON_TABLE_FILE_NAME,
  THREE_WAY_DIFF_DIRECTORY_NAME,
  fromScreenIdToken,
  toScreenIdToken,
});
