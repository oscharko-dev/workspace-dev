import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
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
  resolveVisualBenchmarkFixturePaths,
  resolveVisualBenchmarkScreenPaths,
  resolveVisualBenchmarkScreenViewportPaths,
  toScreenIdToken,
  toStableJsonString,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureManifest,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureManifest,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
} from "./visual-benchmark.helpers.js";
import {
  BENCHMARK_BROWSER_NAMES,
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
import { parseStorybookComponentVisualCatalogArtifact } from "../src/storybook/artifact-validation.js";
import type {
  StorybookComponentVisualCatalogArtifact,
  StorybookComponentVisualCatalogEntry,
} from "../src/storybook/types.js";
import { fetchVisualBenchmarkReferenceImage } from "./visual-benchmark.update.js";
import {
  loadVisualBenchmarkViewCatalog,
  resolveVisualBenchmarkCanonicalReferencePaths,
  toCatalogViewMapByFixture,
  type VisualBenchmarkViewCatalogEntry,
} from "./visual-benchmark-view-catalog.js";
import { PNG } from "pngjs";

const BASELINE_FILE_NAME = "baseline.json";
const LAST_RUN_FILE_NAME = "last-run.json";
const LAST_RUN_ARTIFACT_ROOT_NAME = "last-run";
const LAST_RUN_MANIFEST_FILE_NAME = "manifest.json";
const LAST_RUN_ACTUAL_FILE_NAME = "actual.png";
const LAST_RUN_REFERENCE_FILE_NAME = "reference.png";
const LAST_RUN_DIFF_FILE_NAME = "diff.png";
const LAST_RUN_REPORT_FILE_NAME = "report.json";
const DEFAULT_ARTIFACT_ROOT = path.resolve(
  process.cwd(),
  "artifacts",
  "visual-benchmark",
);
const DEFAULT_NEUTRAL_DELTA_TOLERANCE = 1;
const DEFAULT_HEADLINE_SCREEN_WEIGHT = 0.7;
const DEFAULT_HEADLINE_COMPONENT_WEIGHT = 0.3;
const OVERFITTING_CORE_IMPROVEMENT_DELTA = 1;
const OVERFITTING_COMPONENT_DEGRADATION_DELTA = -1;
const STORYBOOK_COMPONENT_FIXTURE_ID = "storybook-components";

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

export interface VisualBenchmarkFixtureFailure {
  readonly fixtureId: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface VisualBenchmarkResult {
  deltas: VisualBenchmarkDelta[];
  overallBaseline: number | null;
  overallCurrent: number;
  overallDelta: number | null;
  alerts: KpiAlert[];
  trendSummaries: VisualBenchmarkTrendSummary[];
  screenAggregateScore?: number;
  componentAggregateScore?: number;
  componentCoverage?: {
    comparedCount: number;
    skippedCount: number;
    coveragePercent: number;
    bySkipReason: Record<string, number>;
  };
  browserBreakdown?: VisualBenchmarkBrowserBreakdown;
  crossBrowserConsistency?: VisualBenchmarkCrossBrowserConsistency;
  warnings?: string[];
  failedFixtures?: readonly VisualBenchmarkFixtureFailure[];
}

type VisualBenchmarkComponentResultEntry = NonNullable<
  WorkspaceVisualQualityReport["components"]
>[number];
type VisualBenchmarkBrowserBreakdown = NonNullable<
  WorkspaceVisualQualityReport["browserBreakdown"]
>;
type VisualBenchmarkCrossBrowserConsistency = NonNullable<
  WorkspaceVisualQualityReport["crossBrowserConsistency"]
>;
type VisualBenchmarkPerBrowserArtifact = NonNullable<
  WorkspaceVisualQualityReport["perBrowser"]
>[number];

export interface VisualBenchmarkLastRun {
  version: 1 | 2;
  ranAt: string;
  scores: VisualBenchmarkScoreEntry[];
  overallScore?: number;
  overallCurrent?: number;
  overallBaseline?: number | null;
  overallDelta?: number | null;
  screenAggregateScore?: number;
  componentAggregateScore?: number;
  componentCoverage?: {
    comparedCount: number;
    skippedCount: number;
    coveragePercent: number;
    bySkipReason: Record<string, number>;
  };
  browserBreakdown?: VisualBenchmarkBrowserBreakdown;
  crossBrowserConsistency?: VisualBenchmarkCrossBrowserConsistency;
  components?: VisualBenchmarkComponentResultEntry[];
  warnings?: string[];
  failedFixtures?: readonly VisualBenchmarkFixtureFailure[];
}

export interface VisualBenchmarkLastRunArtifactManifest {
  version: 1 | 2;
  fixtureId: string;
  screenId?: string;
  screenName?: string;
  viewportId?: string;
  viewportLabel?: string;
  score: number;
  ranAt: string;
  mode?: VisualBenchmarkFixtureMetadata["mode"];
  viewport: {
    width: number;
    height: number;
  };
  referenceImagePath?: string;
  thresholdResult?: VisualQualityThresholdResult;
  browserBreakdown?: VisualBenchmarkBrowserBreakdown;
  crossBrowserConsistency?: VisualBenchmarkCrossBrowserConsistency;
  perBrowser?: VisualBenchmarkPerBrowserArtifact[];
}

export interface VisualBenchmarkLastRunArtifactPaths {
  fixtureDir: string;
  manifestJsonPath: string;
  actualPngPath: string;
  referencePngPath: string;
  diffPngPath: string;
  reportJsonPath: string;
}

interface VisualBenchmarkArtifactLocation {
  screenId?: string;
  viewportId?: string;
}

export interface VisualBenchmarkLastRunArtifactEntry extends VisualBenchmarkLastRunArtifactManifest {
  actualImagePath: string;
  referenceImagePath: string | null;
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
  mode?: VisualBenchmarkFixtureMetadata["mode"];
  viewport: {
    width: number;
    height: number;
  };
  actualImageBuffer: Buffer;
  referenceImageBuffer?: Buffer | null;
  diffImageBuffer?: Buffer | null;
  report?: unknown | null;
  thresholdResult?: VisualQualityThresholdResult;
  browserArtifacts?: VisualBenchmarkFixtureScreenArtifact["browserArtifacts"];
  crossBrowserConsistency?: VisualBenchmarkFixtureScreenArtifact["crossBrowserConsistency"];
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
  prepareStorybookComponentFixtures?: (
    options?: VisualBenchmarkRunOptions,
  ) => Promise<PreparedStorybookComponentFixtures>;
}

export interface VisualBenchmarkScreenAggregateEntry {
  fixtureId: string;
  screenId: string;
  score: number;
  weight?: number;
}

interface VisualBenchmarkCategorizedAggregates {
  screen: VisualBenchmarkScreenAggregateEntry[];
  component: VisualBenchmarkScreenAggregateEntry[];
}

interface VisualBenchmarkCoverageAccumulator {
  comparedCount: number;
  skippedCount: number;
  bySkipReason: Record<string, number>;
}

export interface VisualBenchmarkRunOptions extends VisualBenchmarkExecutionOptions {
  updateBaseline?: boolean;
  qualityConfig?: VisualQualityConfig;
  componentVisualCatalogFile?: string;
  ci?: boolean;
}

interface PreparedStorybookComponentFixtures {
  options?: VisualBenchmarkRunOptions;
  cleanup?: () => Promise<void>;
  warnings: string[];
  skippedComponents: VisualBenchmarkComponentResultEntry[];
  skippedCoverage: VisualBenchmarkCoverageAccumulator;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Arithmetic mean of per-screen scores. Empty input throws (undefined behavior).
 * Rounded to 2 decimals to match the rest of the runner's score precision.
 */
export const computeFixtureAggregate = (
  screens: readonly { score: number; weight?: number }[],
): number => {
  return computeVisualBenchmarkAggregateScore(screens);
};

export const blendVisualBenchmarkHeadlineScore = (input: {
  screenAggregateScore?: number | null;
  componentAggregateScore?: number | null;
  screenWeight?: number;
  componentWeight?: number;
}): number | null => {
  const screenScore =
    typeof input.screenAggregateScore === "number"
      ? input.screenAggregateScore
      : null;
  const componentScore =
    typeof input.componentAggregateScore === "number"
      ? input.componentAggregateScore
      : null;
  if (screenScore === null && componentScore === null) {
    return null;
  }
  if (screenScore === null) {
    return roundToTwoDecimals(componentScore!);
  }
  if (componentScore === null) {
    return roundToTwoDecimals(screenScore);
  }
  const screenWeight = input.screenWeight ?? DEFAULT_HEADLINE_SCREEN_WEIGHT;
  const componentWeight =
    input.componentWeight ?? DEFAULT_HEADLINE_COMPONENT_WEIGHT;
  return roundToTwoDecimals(
    screenScore * screenWeight + componentScore * componentWeight,
  );
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
      ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
    });
  }
  return aggregateMap;
};

const createEmptyCoverageAccumulator = (): VisualBenchmarkCoverageAccumulator => ({
  comparedCount: 0,
  skippedCount: 0,
  bySkipReason: {},
});

const mergeComponentCoverage = (
  accumulator: VisualBenchmarkCoverageAccumulator,
  coverage:
    | {
        comparedCount: number;
        skippedCount: number;
        bySkipReason: Record<string, number>;
      }
    | undefined,
): void => {
  if (coverage === undefined) {
    return;
  }
  accumulator.comparedCount += coverage.comparedCount;
  accumulator.skippedCount += coverage.skippedCount;
  for (const [key, value] of Object.entries(coverage.bySkipReason)) {
    accumulator.bySkipReason[key] = (accumulator.bySkipReason[key] ?? 0) + value;
  }
};

const sortWarnings = (warnings: readonly string[] | undefined): string[] | undefined => {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    return undefined;
  }
  const normalized = [...new Set(
    warnings.filter((warning) => typeof warning === "string" && warning.trim().length > 0)
  )]
    .map((warning) => warning.trim())
    .sort((left, right) => left.localeCompare(right));
  return normalized.length > 0 ? normalized : undefined;
};

const createTransparentPngBuffer = ({
  width,
  height,
}: {
  width: number;
  height: number;
}): Buffer => {
  const png = new PNG({ width, height });
  png.data.fill(0);
  return PNG.sync.write(png);
};

const readPngViewport = (
  buffer: Buffer,
): {
  width: number;
  height: number;
} => {
  const parsed = PNG.sync.read(buffer);
  return {
    width: parsed.width,
    height: parsed.height,
  };
};

const resolveStorybookComponentFixtureCatalogPath = async (
  options?: VisualBenchmarkRunOptions,
): Promise<string | null> => {
  const requested = options?.componentVisualCatalogFile;
  if (typeof requested !== "string" || requested.trim().length === 0) {
    return null;
  }
  const resolved = path.isAbsolute(requested)
    ? requested
    : path.resolve(process.cwd(), requested);
  try {
    await stat(resolved);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw new Error(
        `Storybook component visual catalog '${resolved}' does not exist.`,
      );
    }
    throw error;
  }
  return resolved;
};

const toStorybookSkippedComponentSummary = (
  entry: StorybookComponentVisualCatalogEntry,
): VisualBenchmarkComponentResultEntry => ({
  componentId: entry.componentId,
  componentName: entry.storyTitle ?? entry.figmaFamilyName,
  status: "skipped",
  ...(entry.skipReason ? { skipReason: entry.skipReason } : {}),
  ...(entry.storyEntryId ? { storyEntryId: entry.storyEntryId } : {}),
  ...(entry.referenceNodeId ? { referenceNodeId: entry.referenceNodeId } : {}),
  ...(entry.warnings.length > 0 ? { warnings: [...entry.warnings] } : {}),
});

const buildStorybookComponentCoverageFromCatalog = (
  artifact: StorybookComponentVisualCatalogArtifact,
): VisualBenchmarkCoverageAccumulator => {
  const accumulator = createEmptyCoverageAccumulator();
  for (const entry of artifact.entries) {
    if (entry.comparisonStatus === "ready") {
      continue;
    }
    accumulator.skippedCount += 1;
    if (entry.skipReason) {
      accumulator.bySkipReason[entry.skipReason] =
        (accumulator.bySkipReason[entry.skipReason] ?? 0) + 1;
    }
  }
  return accumulator;
};

export const prepareStorybookComponentFixtures = async (
  options?: VisualBenchmarkRunOptions,
  dependencies?: {
    fetchReferenceImage?: (
      metadata: VisualBenchmarkFixtureMetadata,
    ) => Promise<Buffer>;
  },
): Promise<PreparedStorybookComponentFixtures> => {
  const catalogPath = await resolveStorybookComponentFixtureCatalogPath(options);
  if (catalogPath === null) {
    return {
      warnings: [],
      skippedComponents: [],
      skippedCoverage: createEmptyCoverageAccumulator(),
    };
  }

  const artifact = parseStorybookComponentVisualCatalogArtifact({
    input: await readFile(catalogPath, "utf8"),
  });
  const skippedComponents = artifact.entries
    .filter((entry) => entry.comparisonStatus !== "ready")
    .map((entry) => toStorybookSkippedComponentSummary(entry));
  const skippedCoverage = buildStorybookComponentCoverageFromCatalog(artifact);
  const readyEntries = artifact.entries.filter(
    (entry) => entry.comparisonStatus === "ready",
  );
  if (readyEntries.length === 0) {
    return {
      warnings: [],
      skippedComponents,
      skippedCoverage,
    };
  }

  const sourceFixtureRoot = options?.fixtureRoot ?? getVisualBenchmarkFixtureRoot();
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "workspace-dev-storybook-components-"),
  );
  const mergedFixtureRoot = path.join(tempRoot, "fixtures");
  const warnings: string[] = [];
  try {
    await cp(sourceFixtureRoot, mergedFixtureRoot, {
      recursive: true,
      force: true,
    });
  } catch (error: unknown) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      await rm(tempRoot, { recursive: true, force: true });
      throw error;
    }
    await mkdir(mergedFixtureRoot, { recursive: true });
  }

  const fixtureId = STORYBOOK_COMPONENT_FIXTURE_ID;
  const now = new Date().toISOString();
  const fetchReferenceImage = dependencies?.fetchReferenceImage;
  const ciMode = options?.ci === true;
  const accessToken = ciMode
    ? undefined
    : process.env.WORKSPACEDEV_FIGMA_TOKEN?.trim() ??
      process.env.FIGMA_ACCESS_TOKEN?.trim();
  const fixtureScreens: Array<Record<string, unknown>> = [];
  let representativeSource:
    | VisualBenchmarkFixtureMetadata["source"]
    | undefined;
  let representativeViewport:
    | VisualBenchmarkFixtureMetadata["viewport"]
    | undefined;
  let fixtureReferenceBuffer: Buffer | undefined;

  for (const entry of readyEntries) {
    const referenceFileKey = entry.referenceFileKey;
    const referenceNodeId = entry.referenceNodeId;
    const storyEntryId = entry.storyEntryId;
    if (!referenceFileKey || !referenceNodeId || !storyEntryId) {
      warnings.push(
        `Storybook component '${entry.componentId}' is marked ready but is missing fixture metadata and will be skipped.`,
      );
      skippedComponents.push({
        componentId: entry.componentId,
        componentName: entry.storyTitle ?? entry.figmaFamilyName,
        status: "skipped",
        skipReason: "missing_story",
        ...(entry.warnings.length > 0 ? { warnings: [...entry.warnings] } : {}),
      });
      skippedCoverage.skippedCount += 1;
      skippedCoverage.bySkipReason.missing_story =
        (skippedCoverage.bySkipReason.missing_story ?? 0) + 1;
      continue;
    }

    let referenceBuffer: Buffer | undefined;
    const referenceMetadata: VisualBenchmarkFixtureMetadata = {
      version: 4,
      mode: "storybook_component",
      fixtureId,
      capturedAt: now,
      source: {
        fileKey: referenceFileKey,
        nodeId: referenceNodeId,
        nodeName: entry.figmaFamilyName,
        lastModified: now,
      },
      viewport: { width: 1, height: 1 },
      export: { format: "png", scale: 1 },
    };

    const frozenReferencePath = resolveVisualBenchmarkScreenViewportPaths(
      fixtureId,
      entry.componentId,
      "default",
      {
        fixtureRoot: mergedFixtureRoot,
      },
    ).referencePngPath;
    try {
      referenceBuffer = await readFile(frozenReferencePath);
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

    if (referenceBuffer !== undefined) {
      // Reuse frozen, versioned references first to keep CI deterministic.
    } else if (fetchReferenceImage) {
      referenceBuffer = await fetchReferenceImage(referenceMetadata);
    } else if (accessToken) {
      try {
        referenceBuffer = await fetchVisualBenchmarkReferenceImage(
          referenceMetadata,
          accessToken,
        );
      } catch (error: unknown) {
        warnings.push(
          `Storybook component '${entry.componentId}' reference export failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      warnings.push(
        ciMode
          ? `Storybook component '${entry.componentId}' has no frozen reference at '${toWorkspaceRelativePath(frozenReferencePath)}' and live Figma export is disabled in CI mode.`
          : `Storybook component '${entry.componentId}' could not export a frozen Figma reference because no Figma access token is configured.`,
      );
    }

    const referenceViewport =
      referenceBuffer !== undefined
        ? readPngViewport(referenceBuffer)
        : { width: 1, height: 1 };
    const padding = entry.baselineCanvas?.padding ?? 16;
    const executionViewport = {
      width: referenceViewport.width + padding * 2,
      height: referenceViewport.height + padding * 2,
    };

    fixtureScreens.push({
      screenId: entry.componentId,
      screenName: entry.figmaFamilyName,
      nodeId: referenceNodeId,
      viewport: referenceViewport,
      viewports: [
        {
          id: "default",
          width: executionViewport.width,
          height: executionViewport.height,
        },
      ],
      entryId: storyEntryId,
      ...(entry.storyTitle ? { storyTitle: entry.storyTitle } : {}),
      referenceNodeId,
      referenceFileKey,
      captureStrategy: "storybook_root_union",
      baselineCanvas: entry.baselineCanvas
        ? { ...entry.baselineCanvas }
        : { width: referenceViewport.width, height: referenceViewport.height },
    });

    if (referenceBuffer !== undefined) {
      await mkdir(
        path.join(
          mergedFixtureRoot,
          fixtureId,
          "screens",
          toScreenIdToken(entry.componentId),
        ),
        { recursive: true },
      );
      await writeFile(
        path.join(
          mergedFixtureRoot,
          fixtureId,
          "screens",
          toScreenIdToken(entry.componentId),
          "default.png",
        ),
        referenceBuffer,
      );
      fixtureReferenceBuffer ??= referenceBuffer;
    }

    representativeSource ??= referenceMetadata.source;
    representativeViewport ??= referenceViewport;
  }

  if (fixtureScreens.length === 0) {
    await rm(tempRoot, { recursive: true, force: true });
    return {
      warnings,
      skippedComponents,
      skippedCoverage,
    };
  }

  representativeSource ??= {
    fileKey: "storybook-components",
    nodeId: "storybook-components",
    nodeName: "Storybook Components",
    lastModified: now,
  };
  representativeViewport ??= fixtureScreens[0]!.viewport as {
    width: number;
    height: number;
  };
  fixtureReferenceBuffer ??= createTransparentPngBuffer({
    width: representativeViewport.width,
    height: representativeViewport.height,
  });

  const manifest: VisualBenchmarkFixtureManifest = {
    version: 1,
    fixtureId,
    visualQuality: {
      frozenReferenceImage: "reference.png",
      frozenReferenceMetadata: "metadata.json",
    },
  };
  const metadata: VisualBenchmarkFixtureMetadata = {
    version: 4,
    mode: "storybook_component",
    fixtureId,
    capturedAt: now,
    source: representativeSource,
    viewport: representativeViewport,
    export: {
      format: "png",
      scale: 1,
    },
    screens:
      fixtureScreens as unknown as VisualBenchmarkFixtureMetadata["screens"],
  };

  await writeVisualBenchmarkFixtureManifest(
    fixtureId,
    manifest,
    { fixtureRoot: mergedFixtureRoot },
  );
  await writeVisualBenchmarkFixtureMetadata(
    fixtureId,
    metadata,
    { fixtureRoot: mergedFixtureRoot },
  );
  await writeVisualBenchmarkFixtureInputs(
    fixtureId,
    {},
    { fixtureRoot: mergedFixtureRoot },
  );
  await writeVisualBenchmarkReference(
    fixtureId,
    fixtureReferenceBuffer,
    { fixtureRoot: mergedFixtureRoot },
  );

  return {
    options: {
      ...options,
      fixtureRoot: mergedFixtureRoot,
    },
    cleanup: async () => {
      await rm(tempRoot, { recursive: true, force: true });
    },
    warnings,
    skippedComponents,
    skippedCoverage,
  };
};

const resolveDeclaredScreenWeight = (
  metadata: VisualBenchmarkFixtureMetadata,
  screenId: string,
): number | undefined =>
  enumerateFixtureScreens(metadata).find((screen) => screen.screenId === screenId)
    ?.weight;

const normalizeLastRunComponentCoverage = (
  value: unknown,
): VisualBenchmarkLastRun["componentCoverage"] | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  if (
    !isFiniteNumber(value.comparedCount) ||
    !isFiniteNumber(value.skippedCount) ||
    !isFiniteNumber(value.coveragePercent) ||
    !isPlainRecord(value.bySkipReason)
  ) {
    return undefined;
  }
  const bySkipReason: Record<string, number> = {};
  for (const [key, entryValue] of Object.entries(value.bySkipReason)) {
    if (isFiniteNumber(entryValue)) {
      bySkipReason[key] = entryValue;
    }
  }
  return {
    comparedCount: value.comparedCount,
    skippedCount: value.skippedCount,
    coveragePercent: value.coveragePercent,
    bySkipReason,
  };
};

const normalizeLastRunComponents = (
  value: unknown,
): VisualBenchmarkComponentResultEntry[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const normalized: VisualBenchmarkComponentResultEntry[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry)) {
      continue;
    }
    if (
      typeof entry.componentId !== "string" ||
      entry.componentId.trim().length === 0 ||
      typeof entry.componentName !== "string" ||
      entry.componentName.trim().length === 0 ||
      (entry.status !== "compared" && entry.status !== "skipped")
    ) {
      continue;
    }
    const component: VisualBenchmarkComponentResultEntry = {
      componentId: entry.componentId.trim(),
      componentName: entry.componentName.trim(),
      status: entry.status,
    };
    if (isFiniteNumber(entry.score)) {
      component.score = entry.score;
    }
    if (typeof entry.diffImagePath === "string" && entry.diffImagePath.trim().length > 0) {
      component.diffImagePath = entry.diffImagePath.trim();
    }
    if (typeof entry.reportPath === "string" && entry.reportPath.trim().length > 0) {
      component.reportPath = entry.reportPath.trim();
    }
    if (typeof entry.skipReason === "string" && entry.skipReason.trim().length > 0) {
      component.skipReason = entry.skipReason.trim();
    }
    if (typeof entry.storyEntryId === "string" && entry.storyEntryId.trim().length > 0) {
      component.storyEntryId = entry.storyEntryId.trim();
    }
    if (typeof entry.referenceNodeId === "string" && entry.referenceNodeId.trim().length > 0) {
      component.referenceNodeId = entry.referenceNodeId.trim();
    }
    const warnings = sortWarnings(entry.warnings);
    if (warnings) {
      component.warnings = warnings;
    }
    normalized.push(component);
  }
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.sort((left, right) => {
    const byId = left.componentId.localeCompare(right.componentId);
    if (byId !== 0) {
      return byId;
    }
    return left.componentName.localeCompare(right.componentName);
  });
};

const normalizeLastRunBrowserBreakdown = (
  value: unknown,
): VisualBenchmarkBrowserBreakdown | undefined => {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const breakdown: VisualBenchmarkBrowserBreakdown = {};
  for (const browserName of BENCHMARK_BROWSER_NAMES) {
    const score = value[browserName];
    if (isFiniteNumber(score)) {
      breakdown[browserName] = score;
    }
  }
  return Object.keys(breakdown).length > 0 ? breakdown : undefined;
};

const normalizeLastRunCrossBrowserConsistency = (
  value: unknown,
): VisualBenchmarkCrossBrowserConsistency | undefined => {
  if (!isPlainRecord(value) || !Array.isArray(value.browsers)) {
    return undefined;
  }
  const browsers = value.browsers
    .map((browserName) =>
      typeof browserName === "string" &&
      (BENCHMARK_BROWSER_NAMES as readonly string[]).includes(browserName)
        ? browserName
        : null,
    )
    .filter((browserName): browserName is BenchmarkBrowserName => browserName !== null);
  if (browsers.length === 0 || !isFiniteNumber(value.consistencyScore)) {
    return undefined;
  }
  const pairwiseDiffs = Array.isArray(value.pairwiseDiffs)
    ? value.pairwiseDiffs
        .map((entry) => {
          if (!isPlainRecord(entry) || !isFiniteNumber(entry.diffPercent)) {
            return null;
          }
          const browserA =
            typeof entry.browserA === "string" &&
            (BENCHMARK_BROWSER_NAMES as readonly string[]).includes(entry.browserA)
              ? entry.browserA
              : null;
          const browserB =
            typeof entry.browserB === "string" &&
            (BENCHMARK_BROWSER_NAMES as readonly string[]).includes(entry.browserB)
              ? entry.browserB
              : null;
          if (browserA === null || browserB === null) {
            return null;
          }
          return {
            browserA,
            browserB,
            diffPercent: entry.diffPercent,
            ...(typeof entry.diffImagePath === "string" &&
            entry.diffImagePath.trim().length > 0
              ? { diffImagePath: entry.diffImagePath.trim() }
              : {}),
          };
        })
        .filter(
          (
            entry,
          ): entry is VisualBenchmarkCrossBrowserConsistency["pairwiseDiffs"][number] =>
            entry !== null,
        )
    : [];
  const warnings = sortWarnings(value.warnings);
  return {
    browsers,
    consistencyScore: value.consistencyScore,
    pairwiseDiffs,
    ...(warnings ? { warnings } : {}),
  };
};

const normalizeLastRunPerBrowserArtifacts = (
  value: unknown,
): VisualBenchmarkPerBrowserArtifact[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const normalized: VisualBenchmarkPerBrowserArtifact[] = [];
  for (const entry of value) {
    if (!isPlainRecord(entry) || !isFiniteNumber(entry.overallScore)) {
      continue;
    }
    const browser =
      typeof entry.browser === "string" &&
      (BENCHMARK_BROWSER_NAMES as readonly string[]).includes(entry.browser)
        ? entry.browser
        : null;
    if (browser === null) {
      continue;
    }
    normalized.push({
      browser,
      overallScore: entry.overallScore,
      ...(typeof entry.actualImagePath === "string" &&
      entry.actualImagePath.trim().length > 0
        ? { actualImagePath: entry.actualImagePath.trim() }
        : {}),
      ...(typeof entry.diffImagePath === "string" &&
      entry.diffImagePath.trim().length > 0
        ? { diffImagePath: entry.diffImagePath.trim() }
        : {}),
      ...(typeof entry.reportPath === "string" &&
      entry.reportPath.trim().length > 0
        ? { reportPath: entry.reportPath.trim() }
        : {}),
      ...(sortWarnings(entry.warnings)
        ? { warnings: sortWarnings(entry.warnings) }
        : {}),
    });
  }
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
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error("Last-run version must be 1 or 2.");
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

  const lastRun: VisualBenchmarkLastRun = {
    version: parsed.version,
    ranAt: parsed.ranAt,
    scores: sortScores(scores),
  };
  if (isFiniteNumber(parsed.overallScore)) {
    lastRun.overallScore = parsed.overallScore;
  }
  if (isFiniteNumber(parsed.overallCurrent)) {
    lastRun.overallCurrent = parsed.overallCurrent;
  }
  if (parsed.overallBaseline === null || isFiniteNumber(parsed.overallBaseline)) {
    lastRun.overallBaseline = parsed.overallBaseline;
  }
  if (parsed.overallDelta === null || isFiniteNumber(parsed.overallDelta)) {
    lastRun.overallDelta = parsed.overallDelta;
  }
  if (isFiniteNumber(parsed.screenAggregateScore)) {
    lastRun.screenAggregateScore = parsed.screenAggregateScore;
  }
  if (isFiniteNumber(parsed.componentAggregateScore)) {
    lastRun.componentAggregateScore = parsed.componentAggregateScore;
  }
  const componentCoverage = normalizeLastRunComponentCoverage(parsed.componentCoverage);
  if (componentCoverage) {
    lastRun.componentCoverage = componentCoverage;
  }
  const browserBreakdown = normalizeLastRunBrowserBreakdown(parsed.browserBreakdown);
  if (browserBreakdown) {
    lastRun.browserBreakdown = browserBreakdown;
  }
  const crossBrowserConsistency = normalizeLastRunCrossBrowserConsistency(
    parsed.crossBrowserConsistency,
  );
  if (crossBrowserConsistency) {
    lastRun.crossBrowserConsistency = crossBrowserConsistency;
  }
  const components = normalizeLastRunComponents(parsed.components);
  if (components) {
    lastRun.components = components;
  }
  const warnings = sortWarnings(parsed.warnings);
  if (warnings) {
    lastRun.warnings = warnings;
  }
  return lastRun;
};

const parseLastRunArtifactManifest = (
  content: string,
): VisualBenchmarkLastRunArtifactManifest => {
  const parsed: unknown = JSON.parse(content);
  if (!isPlainRecord(parsed)) {
    throw new Error("Expected last-run artifact manifest to be an object.");
  }
  if (parsed.version !== 1 && parsed.version !== 2) {
    throw new Error("Last-run artifact manifest version must be 1 or 2.");
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
  let mode: VisualBenchmarkFixtureMetadata["mode"] | undefined;
  if (parsed.mode !== undefined) {
    if (
      parsed.mode !== "generated_app_screen" &&
      parsed.mode !== "storybook_component"
    ) {
      throw new Error(
        "Last-run artifact mode must be 'generated_app_screen' or 'storybook_component' when provided.",
      );
    }
    mode = parsed.mode;
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

  const manifest: VisualBenchmarkLastRunArtifactManifest = {
    version: parsed.version,
    fixtureId: assertAllowedFixtureId(parsed.fixtureId),
    ...(screenId !== undefined ? { screenId } : {}),
    ...(screenName !== undefined ? { screenName } : {}),
    ...(viewportId !== undefined ? { viewportId } : {}),
    ...(viewportLabel !== undefined ? { viewportLabel } : {}),
    score: parsed.score,
    ranAt: parsed.ranAt,
    ...(mode !== undefined ? { mode } : {}),
    viewport: {
      width: parsed.viewport.width,
      height: parsed.viewport.height,
    },
    ...(thresholdResult !== undefined ? { thresholdResult } : {}),
  };
  if (
    typeof parsed.referenceImagePath === "string" &&
    parsed.referenceImagePath.trim().length > 0
  ) {
    manifest.referenceImagePath = parsed.referenceImagePath.trim();
  }
  const browserBreakdown = normalizeLastRunBrowserBreakdown(parsed.browserBreakdown);
  if (browserBreakdown) {
    manifest.browserBreakdown = browserBreakdown;
  }
  const crossBrowserConsistency = normalizeLastRunCrossBrowserConsistency(
    parsed.crossBrowserConsistency,
  );
  if (crossBrowserConsistency) {
    manifest.crossBrowserConsistency = crossBrowserConsistency;
  }
  const perBrowser = normalizeLastRunPerBrowserArtifacts(parsed.perBrowser);
  if (perBrowser) {
    manifest.perBrowser = perBrowser;
  }
  return manifest;
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
    referencePngPath: path.join(artifactDir, LAST_RUN_REFERENCE_FILE_NAME),
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
    rm(fixtureRootPaths.referencePngPath, { force: true }),
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
    let referenceImagePath: string | null = null;
    let diffImagePath: string | null = null;
    let reportPath: string | null = null;
    try {
      await readFile(paths.referencePngPath);
      referenceImagePath = toWorkspaceRelativePath(paths.referencePngPath);
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
      referenceImagePath,
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
  screenId: string | undefined,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualQualityScreenContext | null> => {
  try {
    return await loadVisualQualityScreenContext(fixtureId, screenId, options);
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
    providedScreenId ?? canonical.screenId,
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
  summary?: {
    overallScore?: number;
    overallCurrent?: number;
    overallBaseline?: number | null;
    overallDelta?: number | null;
    screenAggregateScore?: number;
    componentAggregateScore?: number;
    componentCoverage?: VisualBenchmarkLastRun["componentCoverage"];
    browserBreakdown?: VisualBenchmarkLastRun["browserBreakdown"];
    crossBrowserConsistency?: VisualBenchmarkLastRun["crossBrowserConsistency"];
    components?: VisualBenchmarkComponentResultEntry[];
    warnings?: string[];
    failedFixtures?: readonly VisualBenchmarkFixtureFailure[];
  },
): Promise<void> => {
  const lastRunPath = resolveLastRunPath(options);
  const normalizedScores = await normalizeScoresWithMetadata(scores, options);
  const lastRun: VisualBenchmarkLastRun = {
    version: 2,
    ranAt: ranAt ?? new Date().toISOString(),
    scores: normalizedScores,
    ...(summary?.overallScore !== undefined ? { overallScore: summary.overallScore } : {}),
    ...(summary?.overallCurrent !== undefined ? { overallCurrent: summary.overallCurrent } : {}),
    ...(summary?.overallBaseline !== undefined ? { overallBaseline: summary.overallBaseline } : {}),
    ...(summary?.overallDelta !== undefined ? { overallDelta: summary.overallDelta } : {}),
    ...(summary?.screenAggregateScore !== undefined
      ? { screenAggregateScore: summary.screenAggregateScore }
      : {}),
    ...(summary?.componentAggregateScore !== undefined
      ? { componentAggregateScore: summary.componentAggregateScore }
      : {}),
    ...(summary?.componentCoverage
      ? {
          componentCoverage: {
            ...summary.componentCoverage,
            bySkipReason: { ...summary.componentCoverage.bySkipReason },
          },
        }
      : {}),
    ...(summary?.browserBreakdown
      ? {
          browserBreakdown: { ...summary.browserBreakdown },
        }
      : {}),
    ...(summary?.crossBrowserConsistency
      ? {
          crossBrowserConsistency: {
            ...summary.crossBrowserConsistency,
            browsers: [...summary.crossBrowserConsistency.browsers],
            pairwiseDiffs: summary.crossBrowserConsistency.pairwiseDiffs.map((pair) => ({ ...pair })),
            ...(summary.crossBrowserConsistency.warnings
              ? { warnings: [...summary.crossBrowserConsistency.warnings] }
              : {}),
          },
        }
      : {}),
    ...(summary?.components && summary.components.length > 0
      ? {
          components: summary.components.map((component) => ({
            ...component,
            ...(component.warnings ? { warnings: [...component.warnings] } : {}),
          })),
        }
      : {}),
    ...(summary?.warnings && summary.warnings.length > 0 ? { warnings: [...summary.warnings] } : {}),
    ...(summary?.failedFixtures && summary.failedFixtures.length > 0
      ? {
          failedFixtures: summary.failedFixtures.map((failure) => ({
            fixtureId: failure.fixtureId,
            error: {
              code: failure.error.code,
              message: failure.error.message,
            },
          })),
        }
      : {}),
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
    version: 2,
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
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    viewport: {
      width: input.viewport.width,
      height: input.viewport.height,
    },
    ...(input.thresholdResult !== undefined
      ? { thresholdResult: input.thresholdResult }
      : {}),
  };

  await Promise.all([
    rm(path.join(paths.fixtureDir, "browsers"), {
      recursive: true,
      force: true,
    }),
    rm(path.join(paths.fixtureDir, "pairwise"), {
      recursive: true,
      force: true,
    }),
    input.referenceImageBuffer !== undefined && input.referenceImageBuffer !== null
      ? Promise.resolve()
      : rm(paths.referencePngPath, { force: true }),
    input.diffImageBuffer !== undefined && input.diffImageBuffer !== null
      ? Promise.resolve()
      : rm(paths.diffPngPath, { force: true }),
    input.report !== undefined && input.report !== null
      ? Promise.resolve()
      : rm(paths.reportJsonPath, { force: true }),
  ]);
  await mkdir(paths.fixtureDir, { recursive: true });
  await writeFile(paths.actualPngPath, input.actualImageBuffer);
  if (input.referenceImageBuffer !== undefined && input.referenceImageBuffer !== null) {
    await writeFile(paths.referencePngPath, input.referenceImageBuffer);
    manifest.referenceImagePath = toWorkspaceRelativePath(paths.referencePngPath);
  }
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
  const perBrowserArtifacts: VisualBenchmarkPerBrowserArtifact[] = [];
  if (input.browserArtifacts !== undefined && input.browserArtifacts.length > 0) {
    for (const artifact of input.browserArtifacts) {
      const browserDir = path.join(paths.fixtureDir, "browsers", artifact.browser);
      await mkdir(browserDir, { recursive: true });
      const browserActualPath = path.join(browserDir, LAST_RUN_ACTUAL_FILE_NAME);
      const browserDiffPath = path.join(browserDir, LAST_RUN_DIFF_FILE_NAME);
      const browserReportPath = path.join(browserDir, LAST_RUN_REPORT_FILE_NAME);
      await writeFile(browserActualPath, artifact.screenshotBuffer);
      if (artifact.diffBuffer !== null) {
        await writeFile(browserDiffPath, artifact.diffBuffer);
      }
      if (artifact.report !== null) {
        await writeFile(browserReportPath, toStableJsonString(artifact.report), "utf8");
      }
      perBrowserArtifacts.push({
        browser: artifact.browser,
        overallScore: artifact.score,
        actualImagePath: toWorkspaceRelativePath(browserActualPath),
        ...(artifact.diffBuffer !== null
          ? { diffImagePath: toWorkspaceRelativePath(browserDiffPath) }
          : {}),
        ...(artifact.report !== null
          ? { reportPath: toWorkspaceRelativePath(browserReportPath) }
          : {}),
        ...(isWorkspaceVisualQualityReport(artifact.report) &&
        Array.isArray(artifact.report.warnings) &&
        artifact.report.warnings.length > 0
          ? { warnings: [...artifact.report.warnings] }
          : {}),
      });
    }
    manifest.perBrowser = perBrowserArtifacts;
    manifest.browserBreakdown = perBrowserArtifacts.reduce<
      VisualBenchmarkBrowserBreakdown
    >((accumulator, artifact) => {
      accumulator[artifact.browser] = artifact.overallScore;
      return accumulator;
    }, {});
  }
  if (input.crossBrowserConsistency !== undefined) {
    const pairwiseDir = path.join(paths.fixtureDir, "pairwise");
    await mkdir(pairwiseDir, { recursive: true });
    manifest.crossBrowserConsistency = {
      browsers: [...input.crossBrowserConsistency.browsers],
      consistencyScore: input.crossBrowserConsistency.consistencyScore,
      pairwiseDiffs: [],
      ...(input.crossBrowserConsistency.warnings.length > 0
        ? { warnings: [...input.crossBrowserConsistency.warnings] }
        : {}),
    };
    for (const pair of input.crossBrowserConsistency.pairwiseDiffs) {
      const pairwisePath = path.join(
        pairwiseDir,
        `${pair.browserA}-vs-${pair.browserB}.png`,
      );
      if (pair.diffBuffer !== null) {
        await writeFile(pairwisePath, pair.diffBuffer);
      }
      manifest.crossBrowserConsistency.pairwiseDiffs.push({
        browserA: pair.browserA,
        browserB: pair.browserB,
        diffPercent: pair.diffPercent,
        ...(pair.diffBuffer !== null
          ? { diffImagePath: toWorkspaceRelativePath(pairwisePath) }
          : {}),
      });
    }
  }
  await writeFile(paths.manifestJsonPath, toStableJsonString(manifest), "utf8");

  return {
    ...manifest,
    actualImagePath: toWorkspaceRelativePath(paths.actualPngPath),
    referenceImagePath:
      input.referenceImageBuffer !== undefined &&
      input.referenceImageBuffer !== null
        ? toWorkspaceRelativePath(paths.referencePngPath)
        : null,
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
  screenId: string | undefined,
  options?: VisualBenchmarkFixtureOptions,
): Promise<VisualQualityScreenContext> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(fixtureId, options);
  if (
    typeof screenId === "string" &&
    Array.isArray(metadata.screens) &&
    metadata.screens.length > 0
  ) {
    const screen = metadata.screens.find((candidate) => candidate.screenId === screenId);
    if (screen !== undefined) {
      return {
        screenId: screen.screenId,
        screenName: screen.storyTitle ?? screen.screenName,
      };
    }
  }
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
  browserArtifacts?: VisualBenchmarkFixtureScreenArtifact["browserArtifacts"];
  crossBrowserConsistency?: VisualBenchmarkFixtureScreenArtifact["crossBrowserConsistency"];
}

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    const result = await stat(targetPath);
    return result.isFile();
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
};

const resolveFixtureCatalogPath = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<string | null> => {
  if (
    typeof options?.fixtureRoot === "string" &&
    options.fixtureRoot.trim().length > 0
  ) {
    const candidatePath = path.join(
      path.resolve(options.fixtureRoot),
      "benchmark-views.json",
    );
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
    return null;
  }
  return null;
};

const loadBenchmarkCatalogByFixture = async (
  options?: VisualBenchmarkFixtureOptions,
): Promise<ReadonlyMap<string, VisualBenchmarkViewCatalogEntry>> => {
  const catalogPath = await resolveFixtureCatalogPath(options);
  if (
    catalogPath === null &&
    typeof options?.fixtureRoot === "string" &&
    options.fixtureRoot.trim().length > 0
  ) {
    return new Map();
  }
  const catalog =
    catalogPath === null
      ? await loadVisualBenchmarkViewCatalog()
      : await loadVisualBenchmarkViewCatalog(catalogPath);
  return toCatalogViewMapByFixture(catalog);
};

const loadReferenceImageBufferForArtifact = async (input: {
  fixtureId: string;
  screenId?: string;
  viewportId?: string;
  options?: VisualBenchmarkFixtureOptions;
  benchmarkView?: VisualBenchmarkViewCatalogEntry;
}): Promise<Buffer | null> => {
  if (input.benchmarkView !== undefined) {
    const comparisonViewportId = input.benchmarkView.comparison.viewportId;
    const normalizedViewportId =
      typeof input.viewportId === "string" && input.viewportId.trim().length > 0
        ? input.viewportId.trim()
        : "default";
    if (normalizedViewportId !== comparisonViewportId) {
      return null;
    }
    if (
      typeof input.screenId === "string" &&
      input.screenId.trim().length > 0 &&
      input.screenId.trim() !== input.benchmarkView.nodeId
    ) {
      return null;
    }
    const canonicalPath = resolveVisualBenchmarkCanonicalReferencePaths(
      input.benchmarkView,
      { fixtureRoot: input.options?.fixtureRoot },
    ).figmaPngPath;
    try {
      return await readFile(canonicalPath);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new Error(
          `Missing canonical reference for fixture '${input.fixtureId}' at '${canonicalPath}'. Refresh references before running the benchmark.`,
        );
      }
      throw error;
    }
  }

  const candidates: string[] = [];
  if (
    typeof input.screenId === "string" &&
    input.screenId.trim().length > 0 &&
    typeof input.viewportId === "string" &&
    input.viewportId.trim().length > 0
  ) {
    candidates.push(
      resolveVisualBenchmarkScreenViewportPaths(
        input.fixtureId,
        input.screenId,
        input.viewportId,
        input.options,
      ).referencePngPath,
    );
  }
  if (
    typeof input.screenId === "string" &&
    input.screenId.trim().length > 0
  ) {
    candidates.push(
      resolveVisualBenchmarkScreenPaths(
        input.fixtureId,
        input.screenId,
        input.options,
      ).referencePngPath,
    );
  }
  candidates.push(
    resolveVisualBenchmarkFixturePaths(
      input.fixtureId,
      input.options,
    ).referencePngPath,
  );

  for (const candidatePath of candidates) {
    try {
      return await readFile(candidatePath);
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
  return null;
};

const extractDiffPercentFromReport = (report: unknown): number | null => {
  if (typeof report !== "object" || report === null) {
    return null;
  }
  const candidate = report as {
    metadata?: {
      diffPixelCount?: unknown;
      totalPixels?: unknown;
    };
  };
  const diffPixelCount = candidate.metadata?.diffPixelCount;
  const totalPixels = candidate.metadata?.totalPixels;
  if (
    typeof diffPixelCount !== "number" ||
    !Number.isFinite(diffPixelCount) ||
    typeof totalPixels !== "number" ||
    !Number.isFinite(totalPixels) ||
    totalPixels <= 0
  ) {
    return null;
  }
  return Math.round(((diffPixelCount / totalPixels) * 100) * 100) / 100;
};

const buildCanonicalDiffAlerts = (input: {
  artifactEntries: readonly VisualBenchmarkLastRunArtifactInput[];
  benchmarkViewsByFixture: ReadonlyMap<string, VisualBenchmarkViewCatalogEntry>;
}): KpiAlert[] => {
  const alerts: KpiAlert[] = [];
  for (const view of input.benchmarkViewsByFixture.values()) {
    const matchingArtifact = input.artifactEntries.find((entry) => {
      if (entry.fixtureId !== view.fixtureId) {
        return false;
      }
      const normalizedViewportId =
        typeof entry.viewportId === "string" && entry.viewportId.length > 0
          ? entry.viewportId
          : "default";
      if (normalizedViewportId !== view.comparison.viewportId) {
        return false;
      }
      const normalizedScreenId =
        typeof entry.screenId === "string" && entry.screenId.length > 0
          ? entry.screenId
          : entry.fixtureId;
      return normalizedScreenId === view.nodeId;
    });

    if (matchingArtifact === undefined) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_CANONICAL_REFERENCE_MISSING",
        severity: "warn",
        message:
          `No canonical comparison artifact was produced for fixture '${view.fixtureId}' ` +
          `(screen '${view.nodeId}', viewport '${view.comparison.viewportId}').`,
        value: 0,
        threshold: view.comparison.maxDiffPercent,
      });
      continue;
    }

    const diffPercent = extractDiffPercentFromReport(matchingArtifact.report);
    if (diffPercent === null) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_CANONICAL_REFERENCE_MISSING",
        severity: "warn",
        message:
          `Canonical comparison report was missing diff metadata for fixture '${view.fixtureId}' ` +
          `(screen '${view.nodeId}', viewport '${view.comparison.viewportId}').`,
        value: 0,
        threshold: view.comparison.maxDiffPercent,
      });
      continue;
    }

    if (diffPercent > view.comparison.maxDiffPercent) {
      alerts.push({
        code: "ALERT_VISUAL_QUALITY_CANONICAL_DIFF_EXCEEDED",
        severity: "warn",
        message:
          `Canonical pixel diff ${diffPercent.toFixed(2)}% exceeded ` +
          `${view.comparison.maxDiffPercent.toFixed(2)}% for fixture '${view.fixtureId}' ` +
          `(screen '${view.nodeId}', viewport '${view.comparison.viewportId}').`,
        value: diffPercent,
        threshold: view.comparison.maxDiffPercent,
      });
    }
  }
  return alerts;
};

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
        ...(viewportArtifact.browserArtifacts !== undefined
          ? { browserArtifacts: viewportArtifact.browserArtifacts }
          : {}),
        ...(viewportArtifact.crossBrowserConsistency !== undefined
          ? { crossBrowserConsistency: viewportArtifact.crossBrowserConsistency }
          : {}),
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
      ...(screen.browserArtifacts !== undefined
        ? { browserArtifacts: screen.browserArtifacts }
        : {}),
      ...(screen.crossBrowserConsistency !== undefined
        ? { crossBrowserConsistency: screen.crossBrowserConsistency }
        : {}),
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

const toFixtureFailure = (
  fixtureId: string,
  error: unknown,
): VisualBenchmarkFixtureFailure => {
  const code =
    error instanceof Error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : "E_VISUAL_BENCHMARK_FIXTURE_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  return { fixtureId, error: { code, message } };
};

export const runVisualBenchmark = async (
  options?: VisualBenchmarkRunOptions,
  dependencies?: VisualBenchmarkRunnerDependencies,
): Promise<VisualBenchmarkResult> => {
  const runAt = new Date().toISOString();
  const preparedStorybookComponents =
    await (dependencies?.prepareStorybookComponentFixtures ??
      (async (fixtureOptions?: VisualBenchmarkRunOptions) =>
        prepareStorybookComponentFixtures(fixtureOptions)))(options);
  const effectiveOptions = preparedStorybookComponents.options ?? options;
  const benchmarkViewsByFixture =
    await loadBenchmarkCatalogByFixture(effectiveOptions);
  let scores: VisualBenchmarkScoreEntry[];
  const currentScreenAggregateMap = new Map<string, VisualBenchmarkScreenAggregateEntry>();
  const fixtureScreenContexts = new Map<string, VisualQualityScreenContext>();
  const artifactEntries: VisualBenchmarkLastRunArtifactInput[] = [];
  const benchmarkWarnings: string[] = [
    ...preparedStorybookComponents.warnings,
  ];
  const failedFixtures: VisualBenchmarkFixtureFailure[] = [];
  const benchmarkBrowserBreakdownAccumulator: Partial<
    Record<BenchmarkBrowserName, { sum: number; count: number }>
  > = {};
  const benchmarkCrossBrowserConsistency: VisualBenchmarkCrossBrowserConsistency[] = [];
  const componentCoverageAccumulator = createEmptyCoverageAccumulator();
  const componentSummaries = new Map<string, VisualBenchmarkComponentResultEntry>();
  mergeComponentCoverage(
    componentCoverageAccumulator,
    preparedStorybookComponents.skippedCoverage,
  );
  for (const component of preparedStorybookComponents.skippedComponents) {
    componentSummaries.set(component.componentId, { ...component });
  }
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
    const promise = loadVisualBenchmarkFixtureMetadata(fixtureId, effectiveOptions);
    fixtureMetadataCache.set(fixtureId, promise);
    return promise;
  };
  const fixtureObservedScreens = new Map<string, Set<string>>();
  try {
    if (
      dependencies?.runFixtureBenchmark !== undefined &&
      dependencies.executeFixture === undefined
    ) {
      const fixtureIds = await listVisualBenchmarkFixtureIds(effectiveOptions);
      const runFixtureBenchmark = dependencies.runFixtureBenchmark;
      scores = [];
      for (const fixtureId of fixtureIds) {
        let result: VisualBenchmarkFixtureRunResultLike;
        try {
          result = await runFixtureBenchmark(fixtureId, effectiveOptions);
        } catch (error: unknown) {
          const failure = toFixtureFailure(fixtureId, error);
          failedFixtures.push(failure);
          benchmarkWarnings.push(
            `Visual benchmark fixture '${fixtureId}' failed: ${failure.error.code} ${failure.error.message}`,
          );
          process.stdout.write(
            `\u26A0\uFE0F  Visual benchmark fixture '${fixtureId}' failed (${failure.error.code}); continuing with remaining fixtures.\n`,
          );
          continue;
        }
        for (const screen of result.screens) {
          const normalizedScreenId =
            typeof screen.screenId === "string" &&
            screen.screenId.trim().length > 0
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
          scores.push(
            await normalizeScoreEntryWithMetadata(entry, effectiveOptions),
          );
        }
      }
      scores = sortScores(scores);
    } else {
      const fixtureIds = await listVisualBenchmarkFixtureIds(effectiveOptions);
      const executeFixture =
        dependencies?.executeFixture ??
        (async (
          fixtureId: string,
          fixtureOptions?: VisualBenchmarkExecutionOptions,
        ) => executeVisualBenchmarkFixture(fixtureId, fixtureOptions));

      scores = [];
      for (const fixtureId of fixtureIds) {
        const benchmarkView = benchmarkViewsByFixture.get(fixtureId);
        const fixtureExecutionOptions: VisualBenchmarkExecutionOptions =
          benchmarkView === undefined
            ? {
                ...effectiveOptions,
              }
            : {
                ...effectiveOptions,
                viewportId: benchmarkView.comparison.viewportId,
                referenceOverridePath:
                  resolveVisualBenchmarkScreenViewportPaths(
                    fixtureId,
                    benchmarkView.nodeId,
                    benchmarkView.comparison.viewportId,
                    effectiveOptions,
                  ).referencePngPath,
                referenceOverrideViewportId:
                  benchmarkView.comparison.viewportId,
              };
        let result: VisualBenchmarkFixtureRunResult;
        try {
          result = await executeFixture(fixtureId, fixtureExecutionOptions);
        } catch (error: unknown) {
          const failure = toFixtureFailure(fixtureId, error);
          failedFixtures.push(failure);
          benchmarkWarnings.push(
            `Visual benchmark fixture '${fixtureId}' failed: ${failure.error.code} ${failure.error.message}`,
          );
          process.stdout.write(
            `\u26A0\uFE0F  Visual benchmark fixture '${fixtureId}' failed (${failure.error.code}); continuing with remaining fixtures.\n`,
          );
          continue;
        }
        const metadata = await loadCachedMetadata(result.fixtureId);
        const declaredScreensById = new Map(
          enumerateFixtureScreens(metadata).map((screen) => [
            screen.screenId,
            screen,
          ]),
        );
        const observedSet = new Set<string>();
        fixtureObservedScreens.set(result.fixtureId, observedSet);
        if (Array.isArray(result.warnings)) {
          benchmarkWarnings.push(...result.warnings);
        }
        if (result.browserBreakdown) {
          for (const browserName of BENCHMARK_BROWSER_NAMES) {
            const score = result.browserBreakdown[browserName];
            if (!isFiniteNumber(score)) {
              continue;
            }
            const current =
              benchmarkBrowserBreakdownAccumulator[browserName] ??
              { sum: 0, count: 0 };
            current.sum += score;
            current.count += 1;
            benchmarkBrowserBreakdownAccumulator[browserName] = current;
          }
        }
        if (result.crossBrowserConsistency) {
          benchmarkCrossBrowserConsistency.push({
            browsers: [...result.crossBrowserConsistency.browsers],
            consistencyScore: result.crossBrowserConsistency.consistencyScore,
            pairwiseDiffs: result.crossBrowserConsistency.pairwiseDiffs.map(
              (pair) => ({
                browserA: pair.browserA,
                browserB: pair.browserB,
                diffPercent: pair.diffPercent,
              }),
            ),
            ...(result.crossBrowserConsistency.warnings.length > 0
              ? { warnings: [...result.crossBrowserConsistency.warnings] }
              : {}),
          });
        }
        mergeComponentCoverage(
          componentCoverageAccumulator,
          result.componentCoverage,
        );

        for (const screen of result.screens) {
          const declaredScreen = declaredScreensById.get(screen.screenId);
          if (metadata.mode === "storybook_component") {
            const warnings = sortWarnings(screen.warnings);
            componentSummaries.set(screen.screenId, {
              componentId: screen.screenId,
              componentName:
                declaredScreen?.storyTitle ??
                normalizeOptionalScreenName(screen.screenName) ??
                screen.screenId,
              status: screen.status === "skipped" ? "skipped" : "compared",
              ...(screen.status === "skipped"
                ? {
                    skipReason:
                      typeof screen.skipReason === "string" &&
                      screen.skipReason.trim().length > 0
                        ? screen.skipReason.trim()
                        : "skipped",
                  }
                : { score: screen.score }),
              ...(declaredScreen?.entryId
                ? { storyEntryId: declaredScreen.entryId }
                : {}),
              ...(declaredScreen?.referenceNodeId
                ? { referenceNodeId: declaredScreen.referenceNodeId }
                : {}),
              ...(warnings ? { warnings } : {}),
            });
          }
          if (screen.status === "skipped") {
            continue;
          }
          observedSet.add(screen.screenId);
          const screenContextKey = `${result.fixtureId}::${screen.screenId}`;
          const screenContext =
            effectiveOptions?.qualityConfig !== undefined
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
            effectiveOptions?.qualityConfig,
          );
          currentScreenAggregateMap.set(
            getScreenAggregateKey(result.fixtureId, screen.screenId),
            {
              fixtureId: result.fixtureId,
              screenId: screen.screenId,
              score: screen.score,
              ...(screen.weight !== undefined
                ? { weight: screen.weight }
                : declaredScreen?.weight !== undefined
                  ? { weight: declaredScreen.weight }
                  : {}),
            },
          );
          for (const artifact of persistedViewportArtifacts) {
            const referenceImageBuffer =
              await loadReferenceImageBufferForArtifact({
                fixtureId: result.fixtureId,
                screenId: screen.screenId,
                viewportId: artifact.viewportId,
                options: effectiveOptions,
                benchmarkView,
              });
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
              mode: metadata.mode,
              viewport: artifact.viewport,
              actualImageBuffer: artifact.screenshotBuffer,
              ...(referenceImageBuffer !== null
                ? { referenceImageBuffer }
                : {}),
              diffImageBuffer: artifact.diffBuffer,
              report: artifact.report,
              ...(artifact.browserArtifacts !== undefined
                ? { browserArtifacts: artifact.browserArtifacts }
                : {}),
              ...(artifact.crossBrowserConsistency !== undefined
                ? { crossBrowserConsistency: artifact.crossBrowserConsistency }
                : {}),
            });
          }
        }
      }
      scores = sortScores(scores);
    }
    const baseline = await loadVisualBenchmarkBaseline(effectiveOptions);
    const qualityConfig = effectiveOptions?.qualityConfig;
    const regressionConfig = resolveVisualQualityRegressionConfig(qualityConfig);
  if (scores.length === 0) {
    const emptyResult: VisualBenchmarkResult = {
      deltas: [],
      overallBaseline: null,
      overallCurrent: 0,
      overallDelta: null,
      alerts: [],
      trendSummaries: [],
      ...(benchmarkWarnings.length > 0 ? { warnings: [...benchmarkWarnings] } : {}),
      ...(failedFixtures.length > 0 ? { failedFixtures: [...failedFixtures] } : {}),
    };
    if (
      componentCoverageAccumulator.comparedCount > 0 ||
      componentCoverageAccumulator.skippedCount > 0
    ) {
      const total =
        componentCoverageAccumulator.comparedCount +
        componentCoverageAccumulator.skippedCount;
      emptyResult.componentCoverage = {
        comparedCount: componentCoverageAccumulator.comparedCount,
        skippedCount: componentCoverageAccumulator.skippedCount,
        coveragePercent:
          total === 0
            ? 0
            : roundToTwoDecimals(
                (componentCoverageAccumulator.comparedCount / total) * 100,
              ),
        bySkipReason: { ...componentCoverageAccumulator.bySkipReason },
      };
    }
    const components = [...componentSummaries.values()].sort((left, right) => {
      const byId = left.componentId.localeCompare(right.componentId);
      if (byId !== 0) {
        return byId;
      }
      return left.componentName.localeCompare(right.componentName);
    });
    await saveVisualBenchmarkLastRun(scores, effectiveOptions, runAt, {
      overallScore: emptyResult.overallCurrent,
      overallCurrent: emptyResult.overallCurrent,
      overallBaseline: emptyResult.overallBaseline,
      overallDelta: emptyResult.overallDelta,
      ...(emptyResult.browserBreakdown
        ? { browserBreakdown: emptyResult.browserBreakdown }
        : {}),
      ...(emptyResult.crossBrowserConsistency
        ? { crossBrowserConsistency: emptyResult.crossBrowserConsistency }
        : {}),
      ...(emptyResult.componentCoverage
        ? { componentCoverage: emptyResult.componentCoverage }
        : {}),
      ...(components.length > 0 ? { components } : {}),
      ...(emptyResult.warnings ? { warnings: emptyResult.warnings } : {}),
      ...(failedFixtures.length > 0 ? { failedFixtures: [...failedFixtures] } : {}),
    });
    return emptyResult;
  }
  const result = computeVisualBenchmarkDeltas(scores, baseline, {
    neutralTolerance: regressionConfig.neutralTolerance,
  });
  const overallBrowserBreakdown = Object.entries(
    benchmarkBrowserBreakdownAccumulator,
  ).reduce<VisualBenchmarkBrowserBreakdown>((accumulator, [browserName, value]) => {
    if (!value || value.count === 0) {
      return accumulator;
    }
    accumulator[browserName as BenchmarkBrowserName] =
      roundToTwoDecimals(value.sum / value.count);
    return accumulator;
  }, {});
  if (Object.keys(overallBrowserBreakdown).length > 0) {
    result.browserBreakdown = overallBrowserBreakdown;
  }
  if (benchmarkCrossBrowserConsistency.length > 0) {
    const first = benchmarkCrossBrowserConsistency[0]!;
    result.crossBrowserConsistency = {
      browsers: [...first.browsers],
      consistencyScore: benchmarkCrossBrowserConsistency.reduce(
        (lowest, entry) => Math.min(lowest, entry.consistencyScore),
        100,
      ),
      pairwiseDiffs: benchmarkCrossBrowserConsistency.flatMap((entry) =>
        entry.pairwiseDiffs.map((pair) => ({ ...pair })),
      ),
      ...(sortWarnings(
        benchmarkCrossBrowserConsistency.flatMap(
          (entry) => entry.warnings ?? [],
        ),
      )
        ? {
            warnings: sortWarnings(
              benchmarkCrossBrowserConsistency.flatMap(
                (entry) => entry.warnings ?? [],
              ),
            ),
          }
        : {}),
    };
  }

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
      const resolvedScreenId =
        canonical.screenId !== undefined
          ? canonical.screenId
          : canonical.fixtureId;
      const metadata = await loadCachedMetadata(canonical.fixtureId);
      const weight = resolveDeclaredScreenWeight(metadata, resolvedScreenId);
      baselineScreenAggregateMap.set(key, {
        fixtureId: canonical.fixtureId,
        screenId: resolvedScreenId,
        score: await computeScreenAggregateForEntry(
          {
            fixtureId: canonical.fixtureId,
            screenId: resolvedScreenId,
            score: canonical.score,
          },
          baseline.scores,
        ),
        ...(weight !== undefined ? { weight } : {}),
      });
    }
  }

  const categorizeAggregatesByMode = async (
    aggregateMap: Map<string, VisualBenchmarkScreenAggregateEntry>,
  ): Promise<VisualBenchmarkCategorizedAggregates> => {
    const categorized: VisualBenchmarkCategorizedAggregates = {
      screen: [],
      component: [],
    };
    for (const entry of aggregateMap.values()) {
      const metadata = await loadCachedMetadata(entry.fixtureId);
      if (metadata.mode === "storybook_component") {
        categorized.component.push(entry);
      } else {
        categorized.screen.push(entry);
      }
    }
    return categorized;
  };

  const computeAggregateAverage = (
    entries: readonly VisualBenchmarkScreenAggregateEntry[],
  ): number | null => {
    if (entries.length === 0) {
      return null;
    }
    return computeFixtureAggregate(entries);
  };

  const currentCategorizedAggregates = await categorizeAggregatesByMode(
    currentScreenAggregateMap,
  );
  const baselineCategorizedAggregates = await categorizeAggregatesByMode(
    baselineScreenAggregateMap,
  );

  const currentScreenAggregateScore = computeAggregateAverage(
    currentCategorizedAggregates.screen,
  );
  const currentComponentAggregateScore = computeAggregateAverage(
    currentCategorizedAggregates.component,
  );
  const baselineScreenAggregateScore = computeAggregateAverage(
    baselineCategorizedAggregates.screen,
  );
  const baselineComponentAggregateScore = computeAggregateAverage(
    baselineCategorizedAggregates.component,
  );
  const screenAggregateDelta =
    currentScreenAggregateScore !== null && baselineScreenAggregateScore !== null
      ? roundToTwoDecimals(
          currentScreenAggregateScore - baselineScreenAggregateScore,
        )
      : null;
  const componentAggregateDelta =
    currentComponentAggregateScore !== null &&
    baselineComponentAggregateScore !== null
      ? roundToTwoDecimals(
          currentComponentAggregateScore - baselineComponentAggregateScore,
        )
      : null;

  const comparableCurrentScreenAggregateScore =
    baselineScreenAggregateScore !== null ? currentScreenAggregateScore : null;
  const comparableCurrentComponentAggregateScore =
    baselineComponentAggregateScore !== null
      ? currentComponentAggregateScore
      : null;

  result.screenAggregateScore = currentScreenAggregateScore ?? undefined;
  result.componentAggregateScore = currentComponentAggregateScore ?? undefined;
  if (
    componentCoverageAccumulator.comparedCount > 0 ||
    componentCoverageAccumulator.skippedCount > 0
  ) {
    const totalComponentCount =
      componentCoverageAccumulator.comparedCount +
      componentCoverageAccumulator.skippedCount;
    result.componentCoverage = {
      comparedCount: componentCoverageAccumulator.comparedCount,
      skippedCount: componentCoverageAccumulator.skippedCount,
      coveragePercent:
        totalComponentCount === 0
          ? 0
          : roundToTwoDecimals(
              (componentCoverageAccumulator.comparedCount / totalComponentCount) *
                100,
            ),
      bySkipReason: { ...componentCoverageAccumulator.bySkipReason },
    };
    if (componentCoverageAccumulator.skippedCount > 0) {
      benchmarkWarnings.push(
        `Storybook component coverage skipped ${String(componentCoverageAccumulator.skippedCount)} component screen(s).`,
      );
    }
  }

  if (currentScreenAggregateMap.size > 0) {
    if (
      currentScreenAggregateScore !== null &&
      currentComponentAggregateScore === null
    ) {
      benchmarkWarnings.push(
        "Visual benchmark headline score used full-page results only because no component aggregate was available.",
      );
    } else if (
      currentScreenAggregateScore === null &&
      currentComponentAggregateScore !== null
    ) {
      benchmarkWarnings.push(
        "Visual benchmark headline score used component results only because no full-page aggregate was available.",
      );
    }
    result.overallCurrent =
      blendVisualBenchmarkHeadlineScore({
        screenAggregateScore: currentScreenAggregateScore,
        componentAggregateScore: currentComponentAggregateScore,
      }) ?? 0;
    const comparableCurrentHeadline = blendVisualBenchmarkHeadlineScore({
      screenAggregateScore: comparableCurrentScreenAggregateScore,
      componentAggregateScore: comparableCurrentComponentAggregateScore,
    });
    const comparableBaselineHeadline = blendVisualBenchmarkHeadlineScore({
      screenAggregateScore:
        comparableCurrentScreenAggregateScore !== null
          ? baselineScreenAggregateScore
          : null,
      componentAggregateScore:
        comparableCurrentComponentAggregateScore !== null
          ? baselineComponentAggregateScore
          : null,
    });
    result.overallBaseline = comparableBaselineHeadline;
    result.overallDelta =
      comparableCurrentHeadline !== null && comparableBaselineHeadline !== null
        ? roundToTwoDecimals(
            comparableCurrentHeadline - comparableBaselineHeadline,
          )
        : null;
  }

  if (benchmarkWarnings.length > 0) {
    result.warnings = [...new Set(benchmarkWarnings)];
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
    baselinePath: resolveBaselinePath(effectiveOptions),
  });
  if (screenAlerts.length > 0) {
    result.alerts = [...result.alerts, ...screenAlerts];
  }

  if (
    screenAggregateDelta !== null &&
    componentAggregateDelta !== null &&
    screenAggregateDelta >= OVERFITTING_CORE_IMPROVEMENT_DELTA &&
    componentAggregateDelta <= OVERFITTING_COMPONENT_DEGRADATION_DELTA
  ) {
    result.alerts = [
      ...result.alerts,
      {
        code: "ALERT_VISUAL_QUALITY_OVERFITTING_RISK",
        severity: "warn",
        message:
          "Full-page benchmark quality improved while Storybook component aggregate degraded, indicating potential overfitting to benchmark fixtures.",
        value: componentAggregateDelta,
        threshold: OVERFITTING_COMPONENT_DEGRADATION_DELTA,
      },
    ];
    benchmarkWarnings.push(
      "Potential overfitting detected: core benchmark delta improved while component aggregate regressed.",
    );
  }

  const canonicalDiffAlerts = buildCanonicalDiffAlerts({
    artifactEntries,
    benchmarkViewsByFixture,
  });
  if (canonicalDiffAlerts.length > 0) {
    result.alerts = [...result.alerts, ...canonicalDiffAlerts];
    benchmarkWarnings.push(
      ...canonicalDiffAlerts.map((alert) => alert.message),
    );
  }

  // Apply quality config thresholds if config is present
  if (qualityConfig) {
    for (const delta of result.deltas) {
      const screenContextKey = `${delta.fixtureId}::${delta.screenId ?? delta.fixtureId}`;
      let screenContext = fixtureScreenContexts.get(screenContextKey);
      if (screenContext === undefined) {
        screenContext = await loadVisualQualityScreenContext(
          delta.fixtureId,
          delta.screenId,
          effectiveOptions,
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

  if (benchmarkWarnings.length > 0) {
    result.warnings = [...benchmarkWarnings];
  }

  if (failedFixtures.length > 0) {
    result.failedFixtures = [...failedFixtures];
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
      await deleteLegacyRootLastRunArtifacts(fixtureId, effectiveOptions);
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
      const savedArtifact = await saveVisualBenchmarkLastRunArtifact(
        {
          ...artifactEntry,
          ...(isMultiScreen || artifactEntry.viewportId !== undefined
            ? {}
            : { screenId: undefined }),
          thresholdResult: delta?.thresholdResult,
        },
        effectiveOptions,
      );
      const component = artifactEntry.screenId
        ? componentSummaries.get(artifactEntry.screenId)
        : undefined;
      if (component && component.status === "compared") {
        if (component.diffImagePath === undefined && savedArtifact.diffImagePath !== null) {
          component.diffImagePath = savedArtifact.diffImagePath;
        }
        if (component.reportPath === undefined && savedArtifact.reportPath !== null) {
          component.reportPath = savedArtifact.reportPath;
        }
      }
    }
  }

  const components = [...componentSummaries.values()].sort((left, right) => {
    const byId = left.componentId.localeCompare(right.componentId);
    if (byId !== 0) {
      return byId;
    }
    return left.componentName.localeCompare(right.componentName);
  });
  await saveVisualBenchmarkLastRun(scores, effectiveOptions, runAt, {
    overallScore: result.overallCurrent,
    overallCurrent: result.overallCurrent,
    overallBaseline: result.overallBaseline,
    overallDelta: result.overallDelta,
    ...(result.browserBreakdown
      ? { browserBreakdown: result.browserBreakdown }
      : {}),
    ...(result.crossBrowserConsistency
      ? { crossBrowserConsistency: result.crossBrowserConsistency }
      : {}),
    ...(result.screenAggregateScore !== undefined
      ? { screenAggregateScore: result.screenAggregateScore }
      : {}),
    ...(result.componentAggregateScore !== undefined
      ? { componentAggregateScore: result.componentAggregateScore }
      : {}),
    ...(result.componentCoverage ? { componentCoverage: result.componentCoverage } : {}),
    ...(components.length > 0 ? { components } : {}),
    ...(result.warnings ? { warnings: result.warnings } : {}),
    ...(failedFixtures.length > 0 ? { failedFixtures: [...failedFixtures] } : {}),
  });

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
    const thresholdFailedFixtures = result.deltas.filter(
      (d) => d.thresholdResult?.verdict === "fail",
    );
    const warnedFixtures = result.deltas.filter(
      (d) => d.thresholdResult?.verdict === "warn",
    );
    if (thresholdFailedFixtures.length > 0) {
      process.stdout.write(
        `\n\u274C ${thresholdFailedFixtures.length} fixture(s) below fail threshold: ${thresholdFailedFixtures.map((d) => d.fixtureId).join(", ")}\n`,
      );
    }
    if (warnedFixtures.length > 0) {
      process.stdout.write(
        `\u26A0\uFE0F ${warnedFixtures.length} fixture(s) below warn threshold: ${warnedFixtures.map((d) => d.fixtureId).join(", ")}\n`,
      );
    }
    if (thresholdFailedFixtures.length === 0 && warnedFixtures.length === 0) {
      process.stdout.write(`\n\u2705 All fixtures pass quality thresholds.\n`);
    }
  }

  if (effectiveOptions?.updateBaseline === true) {
    const existingHistory = await loadVisualBenchmarkHistory(effectiveOptions);
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
    await saveVisualBenchmarkHistory(updatedHistory, effectiveOptions);
    process.stdout.write(
      `History updated (${String(updatedHistory.entries.length)} entries).\n`,
    );

    await saveVisualBenchmarkBaselineScores(scores, effectiveOptions);
    process.stdout.write("Baseline updated.\n");
  }

  return result;
  } finally {
    await preparedStorybookComponents.cleanup?.();
  }
};
