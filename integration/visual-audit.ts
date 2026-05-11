import assert from "node:assert/strict";
import { executeVisualBenchmarkFixture, type VisualBenchmarkFixtureRunResult } from "./visual-benchmark.execution.js";
import {
  enumerateFixtureScreens,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkFixtureScreenMetadata,
} from "./visual-benchmark.helpers.js";
import {
  fetchVisualBenchmarkNodeSnapshot,
  fetchVisualBenchmarkReferenceImage,
  type VisualBenchmarkNodeSnapshot,
} from "./visual-benchmark.update.js";
import {
  buildLiveImageCacheKey,
  buildScreenMetadata,
  loadFrozenScreenBuffer,
  loadLastRunSurfaceForScreen,
  readPngDimensions,
  safeSimilarityScore,
  VisualAuditSurfaceError,
} from "./visual-audit.helpers.js";

export type VisualAuditLabel =
  | "Design Drift Detected"
  | "Generator Regression"
  | "Both Drifted"
  | "Stable";

export type VisualAuditFixtureStatus = "completed" | "unavailable";

export interface VisualAuditScreenResult {
  screenId: string;
  screenName: string;
  driftScore: number;
  regressionScore: number | null;
  label: VisualAuditLabel;
  frozenLastModified: string;
  liveLastModified: string;
}

export interface VisualAuditFixtureResult {
  fixtureId: string;
  status: VisualAuditFixtureStatus;
  fixtureLabel: VisualAuditLabel | "Unavailable";
  lastKnownGoodAt: string;
  error?: string;
  screens: VisualAuditScreenResult[];
}

export interface VisualAuditReport {
  auditedAt: string;
  totalFixtures: number;
  driftedFixtures: number;
  regressedFixtures: number;
  unavailableFixtures: number;
  fixtures: VisualAuditFixtureResult[];
}

export interface VisualAuditDependencies extends VisualBenchmarkFixtureOptions {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  now?: () => string;
  driftThreshold?: number;
  regressionThreshold?: number;
  fixtureId?: string;
  executeFixture?: (
    fixtureId: string,
    options?: Parameters<typeof executeVisualBenchmarkFixture>[1],
  ) => Promise<VisualBenchmarkFixtureRunResult>;
}

const DEFAULT_DRIFT_THRESHOLD = 95;
const DEFAULT_REGRESSION_THRESHOLD = 95;

const defaultLog = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const requireFigmaAccessToken = (): string => {
  const token = process.env.FIGMA_ACCESS_TOKEN?.trim();
  assert.ok(
    token,
    "FIGMA_ACCESS_TOKEN is required for visual-audit live mode.",
  );
  return token;
};

const resolveScreenLabel = (
  driftScore: number,
  regressionScore: number | null,
  driftThreshold: number,
  regressionThreshold: number,
): VisualAuditLabel => {
  const drifted = driftScore < driftThreshold;
  const regressed =
    regressionScore !== null && regressionScore < regressionThreshold;
  if (drifted && regressed) {
    return "Both Drifted";
  }
  if (drifted) {
    return "Design Drift Detected";
  }
  if (regressed) {
    return "Generator Regression";
  }
  return "Stable";
};

const compareThreshold = (score: number | null, threshold: number): boolean =>
  score !== null && score >= threshold;

const combineFixtureLabel = (
  screens: readonly VisualAuditScreenResult[],
): VisualAuditLabel => {
  let anyDrift = false;
  let anyRegression = false;
  for (const screen of screens) {
    if (screen.label === "Both Drifted") {
      return "Both Drifted";
    }
    if (screen.label === "Design Drift Detected") {
      anyDrift = true;
    } else if (screen.label === "Generator Regression") {
      anyRegression = true;
    }
  }
  if (anyDrift && anyRegression) {
    return "Both Drifted";
  }
  if (anyDrift) {
    return "Design Drift Detected";
  }
  if (anyRegression) {
    return "Generator Regression";
  }
  return "Stable";
};

type LiveImageCache = Map<string, Buffer>;

interface FetchContext {
  accessToken: string;
  cache: LiveImageCache;
  snapshotCache: Map<string, VisualBenchmarkNodeSnapshot>;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

const fetchCachedLiveImage = async (
  metadata: VisualBenchmarkFixtureMetadata,
  context: FetchContext,
): Promise<Buffer> => {
  const cacheKey = buildLiveImageCacheKey(metadata);
  const cached = context.cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const buffer = await fetchVisualBenchmarkReferenceImage(
    metadata,
    context.accessToken,
    {
      fetchImpl: context.fetchImpl,
      sleepImpl: context.sleepImpl,
      log: context.log,
    },
  );
  context.cache.set(cacheKey, buffer);
  return buffer;
};

const buildScreenViewportConfig = (
  viewport: { width: number; height: number },
) => ({
  viewports: [
    {
      id: "audit",
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
    },
  ],
});

const buildAuditQualityConfig = (
  fixtureId: string,
  screenTargets: ReadonlyMap<string, { width: number; height: number }>,
) => ({
  fixtures: {
    [fixtureId]: {
      screens: Object.fromEntries(
        [...screenTargets.entries()].map(([screenId, viewport]) => [
          screenId,
          buildScreenViewportConfig(viewport),
        ]),
      ),
    },
  },
});

const resolveComparableScale = (
  source: { width: number; height: number },
  target: { width: number; height: number },
): number | null => {
  const widthScale = target.width / source.width;
  const heightScale = target.height / source.height;
  if (
    !Number.isFinite(widthScale) ||
    !Number.isFinite(heightScale) ||
    widthScale <= 0 ||
    heightScale <= 0
  ) {
    return null;
  }
  if (Math.abs(widthScale - heightScale) > 0.0001) {
    return null;
  }
  if (widthScale < 0.01 || widthScale > 4) {
    return null;
  }
  return widthScale;
};

const fetchCachedLiveSnapshot = async (
  metadata: VisualBenchmarkFixtureMetadata,
  context: FetchContext,
): Promise<VisualBenchmarkNodeSnapshot> => {
  const cacheKey = `${metadata.source.fileKey}:${metadata.source.nodeId}`;
  const cached = context.snapshotCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const snapshot = await fetchVisualBenchmarkNodeSnapshot(
    metadata,
    context.accessToken,
    {
      fetchImpl: context.fetchImpl,
      sleepImpl: context.sleepImpl,
      log: context.log,
    },
  );
  context.snapshotCache.set(cacheKey, snapshot);
  return snapshot;
};

interface AuditScreenContext {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  fetchContext: FetchContext;
  options: VisualBenchmarkFixtureOptions;
  driftThreshold: number;
  regressionThreshold: number;
  frozenBuffer: Buffer;
  frozenDimensions: { width: number; height: number };
  regressionSurface: {
    buffer: Buffer;
    ranAt: string;
    source: "persisted-last-run" | "fresh-render";
  };
}

const auditScreen = async (
  screen: VisualBenchmarkFixtureScreenMetadata,
  context: AuditScreenContext,
): Promise<VisualAuditScreenResult> => {
  const screenMetadata = buildScreenMetadata(context.metadata, screen);
  const liveSnapshot = await fetchCachedLiveSnapshot(
    screenMetadata,
    context.fetchContext,
  );
  const comparisonDimensions = readPngDimensions(context.regressionSurface.buffer);
  const comparisonLabel =
    context.regressionSurface.source === "persisted-last-run"
      ? "persisted last-run output"
      : "fresh render output";
  const liveScale = resolveComparableScale(
    liveSnapshot.viewport,
    context.frozenDimensions,
  );
  if (liveScale === null) {
    throw new VisualAuditSurfaceError(
      `visual-audit: live Figma export for '${screen.screenId}' cannot be normalized to ${String(context.frozenDimensions.width)}x${String(context.frozenDimensions.height)}.`,
    );
  }
  const liveBuffer = await fetchCachedLiveImage(
    {
      ...screenMetadata,
      export: {
        ...screenMetadata.export,
        scale: liveScale,
      },
    },
    context.fetchContext,
  );
  const driftScore = safeSimilarityScore(context.frozenBuffer, liveBuffer);
  const regressionScore = safeSimilarityScore(
    context.regressionSurface.buffer,
    liveBuffer,
  );
  if (
    comparisonDimensions.width !== context.frozenDimensions.width ||
    comparisonDimensions.height !== context.frozenDimensions.height
  ) {
    throw new VisualAuditSurfaceError(
      `visual-audit: ${comparisonLabel} for '${screen.screenId}' resolved to ${String(comparisonDimensions.width)}x${String(comparisonDimensions.height)} instead of ${String(context.frozenDimensions.width)}x${String(context.frozenDimensions.height)}.`,
    );
  }
  const label = resolveScreenLabel(
    driftScore,
    regressionScore,
    context.driftThreshold,
    context.regressionThreshold,
  );
  return {
    screenId: screen.screenId,
    screenName: screen.screenName,
    driftScore,
    regressionScore,
    label,
    frozenLastModified: context.metadata.source.lastModified,
    liveLastModified: liveSnapshot.lastModified,
  };
};

interface AuditFixtureContext {
  fixtureId: string;
  accessToken: string;
  cache: LiveImageCache;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  log: (message: string) => void;
  now: () => string;
  options: VisualBenchmarkFixtureOptions;
  driftThreshold: number;
  regressionThreshold: number;
  executeFixture: (
    fixtureId: string,
    options?: Parameters<typeof executeVisualBenchmarkFixture>[1],
  ) => Promise<VisualBenchmarkFixtureRunResult>;
}

interface AuditRegressionSurface {
  buffer: Buffer;
  ranAt: string;
  source: "persisted-last-run" | "fresh-render";
}

const pickMostRecentRunAt = (
  timestamps: readonly string[],
): string | null => {
  let latest: string | null = null;
  for (const timestamp of timestamps) {
    if (latest === null || timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest;
};

const auditFixture = async (
  context: AuditFixtureContext,
): Promise<VisualAuditFixtureResult> => {
  const metadata = await loadVisualBenchmarkFixtureMetadata(
    context.fixtureId,
    context.options,
  );
  const frozenFallback = await loadVisualBenchmarkReference(
    context.fixtureId,
    context.options,
  );
  const screens = enumerateFixtureScreens(metadata);
  const fetchContext: FetchContext = {
    accessToken: context.accessToken,
    cache: context.cache,
    snapshotCache: new Map(),
    fetchImpl: context.fetchImpl,
    sleepImpl: context.sleepImpl,
    log: context.log,
  };
  const frozenScreens = new Map<
    string,
    {
      buffer: Buffer;
      dimensions: { width: number; height: number };
    }
  >();
  for (const screen of screens) {
    const frozenBuffer = await loadFrozenScreenBuffer(
      context.fixtureId,
      screen,
      frozenFallback,
      context.options,
    );
    frozenScreens.set(screen.screenId, {
      buffer: frozenBuffer,
      dimensions: readPngDimensions(frozenBuffer),
    });
  }
  const regressionSurfacesByScreenId = new Map<string, AuditRegressionSurface>();
  const fallbackScreens: VisualBenchmarkFixtureScreenMetadata[] = [];
  const comparisonErrorsByScreenId = new Map<string, string>();
  for (const screen of screens) {
    const persisted = await loadLastRunSurfaceForScreen(
      context.fixtureId,
      screen,
      context.options,
    );
    if (persisted === null) {
      fallbackScreens.push(screen);
      context.log(
        `visual-audit ${context.fixtureId}/${screen.screenId}: persisted last-run artifact missing, falling back to a fresh render.`,
      );
      continue;
    }
    const frozen = frozenScreens.get(screen.screenId);
    assert.ok(
      frozen !== undefined,
      `Missing frozen screen dimensions for '${screen.screenId}'.`,
    );
    try {
      const persistedDimensions = readPngDimensions(persisted.buffer);
      if (
        persistedDimensions.width !== frozen.dimensions.width ||
        persistedDimensions.height !== frozen.dimensions.height
      ) {
        fallbackScreens.push(screen);
        context.log(
          `visual-audit ${context.fixtureId}/${screen.screenId}: persisted last-run artifact dimensions ${String(persistedDimensions.width)}x${String(persistedDimensions.height)} do not match frozen ${String(frozen.dimensions.width)}x${String(frozen.dimensions.height)}; falling back to a fresh render.`,
        );
        continue;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      fallbackScreens.push(screen);
      context.log(
        `visual-audit ${context.fixtureId}/${screen.screenId}: persisted last-run artifact is invalid (${message}); falling back to a fresh render.`,
      );
      continue;
    }
    regressionSurfacesByScreenId.set(screen.screenId, {
      buffer: persisted.buffer,
      ranAt: persisted.ranAt,
      source: "persisted-last-run",
    });
  }

  let freshRenderRanAt: string | null = null;
  if (fallbackScreens.length > 0) {
    const qualityConfig = buildAuditQualityConfig(
      context.fixtureId,
      new Map(
        fallbackScreens.map((screen) => {
          const frozen = frozenScreens.get(screen.screenId);
          assert.ok(
            frozen !== undefined,
            `Missing frozen screen dimensions for '${screen.screenId}'.`,
          );
          return [screen.screenId, frozen.dimensions];
        }),
      ),
    );

    let generatedRun: VisualBenchmarkFixtureRunResult;
    try {
      generatedRun = await context.executeFixture(context.fixtureId, {
        ...context.options,
        qualityConfig,
        allowIncompleteVisualQuality: true,
        log: context.log,
      });
      freshRenderRanAt = context.now();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      for (const screen of fallbackScreens) {
        comparisonErrorsByScreenId.set(
          screen.screenId,
          `visual-audit: fresh render fallback failed for '${screen.screenId}': ${message}`,
        );
      }
      generatedRun = {
        fixtureId: context.fixtureId,
        aggregateScore: 0,
        screens: [],
      };
    }

    const generatedByScreenId = new Map(
      generatedRun.screens.map((screen) => [screen.screenId, screen]),
    );
    for (const screen of fallbackScreens) {
      const generated = generatedByScreenId.get(screen.screenId);
      if (generated === undefined) {
        comparisonErrorsByScreenId.set(
          screen.screenId,
          comparisonErrorsByScreenId.get(screen.screenId) ??
            `visual-audit: benchmark execution did not produce screen '${screen.screenId}' during fresh render fallback.`,
        );
        continue;
      }
      regressionSurfacesByScreenId.set(screen.screenId, {
        buffer: generated.screenshotBuffer,
        ranAt: freshRenderRanAt ?? metadata.capturedAt,
        source: "fresh-render",
      });
    }
  }

  const completedScreens: VisualAuditScreenResult[] = [];
  let fixtureError: string | undefined;
  for (const screen of screens) {
    try {
      const frozen = frozenScreens.get(screen.screenId);
      if (frozen === undefined) {
        throw new VisualAuditSurfaceError(
          `visual-audit: missing frozen reference for screen '${screen.screenId}'.`,
        );
      }
      const regressionSurface = regressionSurfacesByScreenId.get(screen.screenId);
      if (regressionSurface === undefined) {
        throw new VisualAuditSurfaceError(
          comparisonErrorsByScreenId.get(screen.screenId) ??
            `visual-audit: no comparison surface available for '${screen.screenId}'.`,
        );
      }
      const result = await auditScreen(screen, {
        fixtureId: context.fixtureId,
        metadata,
        fetchContext,
        options: context.options,
        driftThreshold: context.driftThreshold,
        regressionThreshold: context.regressionThreshold,
        frozenBuffer: frozen.buffer,
        frozenDimensions: frozen.dimensions,
        regressionSurface,
      });
      completedScreens.push(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      fixtureError = fixtureError ?? message;
      context.log(
        `visual-audit ${context.fixtureId}/${screen.screenId}: unavailable (${message})`,
      );
    }
  }

  if (completedScreens.length === 0 || fixtureError !== undefined) {
    const persistedRunAt = pickMostRecentRunAt(
      [...regressionSurfacesByScreenId.values()]
        .filter((surface) => surface.source === "persisted-last-run")
        .map((surface) => surface.ranAt),
    );
    return {
      fixtureId: context.fixtureId,
      status: "unavailable",
      fixtureLabel: "Unavailable",
      error:
        fixtureError ??
        `visual-audit: fixture '${context.fixtureId}' produced no comparable screens.`,
      lastKnownGoodAt: persistedRunAt ?? metadata.capturedAt,
      screens: completedScreens,
    };
  }

  const completedSurfaces = completedScreens
    .map((screen) => regressionSurfacesByScreenId.get(screen.screenId))
    .filter((surface): surface is AuditRegressionSurface => surface !== undefined);
  const persistedRunAt = pickMostRecentRunAt(
    completedSurfaces
      .filter((surface) => surface.source === "persisted-last-run")
      .map((surface) => surface.ranAt),
  );
  const allRegressionScoresHealthy = completedScreens.every((screen) =>
    compareThreshold(screen.regressionScore, context.regressionThreshold),
  );

  return {
    fixtureId: context.fixtureId,
    status: "completed",
    fixtureLabel: combineFixtureLabel(completedScreens),
    lastKnownGoodAt: allRegressionScoresHealthy
      ? (persistedRunAt ?? freshRenderRanAt ?? metadata.capturedAt)
      : (persistedRunAt ?? metadata.capturedAt),
    screens: completedScreens,
  };
};

const selectFixtureIds = async (
  deps: VisualAuditDependencies,
): Promise<string[]> => {
  const allIds = await listVisualBenchmarkFixtureIds(deps);
  if (deps.fixtureId !== undefined) {
    if (!allIds.includes(deps.fixtureId)) {
      throw new Error(`visual-audit: fixture '${deps.fixtureId}' not found.`);
    }
    return [deps.fixtureId];
  }
  return allIds;
};

const countLabelled = (
  fixtures: readonly VisualAuditFixtureResult[],
  labels: readonly VisualAuditLabel[],
): number =>
  fixtures.filter((fixture) => labels.includes(fixture.fixtureLabel)).length;

interface ResolvedRuntime {
  log: (message: string) => void;
  now: () => string;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  driftThreshold: number;
  regressionThreshold: number;
}

const resolveRuntime = (
  dependencies: VisualAuditDependencies,
): ResolvedRuntime => ({
  log: dependencies.log ?? defaultLog,
  now: dependencies.now ?? ((): string => new Date().toISOString()),
  fetchImpl: dependencies.fetchImpl ?? fetch,
  sleepImpl:
    dependencies.sleepImpl ??
    ((ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms))),
  driftThreshold: dependencies.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD,
  regressionThreshold:
    dependencies.regressionThreshold ?? DEFAULT_REGRESSION_THRESHOLD,
});

export const runVisualAudit = async (
  deps?: VisualAuditDependencies,
): Promise<VisualAuditReport> => {
  const accessToken = requireFigmaAccessToken();
  const dependencies = deps ?? {};
  const runtime = resolveRuntime(dependencies);
  const fixtureIds = await selectFixtureIds(dependencies);
  const cache: LiveImageCache = new Map();
  const fixtures: VisualAuditFixtureResult[] = [];
  for (const fixtureId of fixtureIds) {
    const result = await auditFixture({
      fixtureId,
      accessToken,
      cache,
      fetchImpl: runtime.fetchImpl,
      sleepImpl: runtime.sleepImpl,
      log: runtime.log,
      now: runtime.now,
      options: dependencies,
      driftThreshold: runtime.driftThreshold,
      regressionThreshold: runtime.regressionThreshold,
      executeFixture:
        dependencies.executeFixture ?? executeVisualBenchmarkFixture,
    });
    fixtures.push(result);
    runtime.log(
      `visual-audit ${fixtureId}: ${result.fixtureLabel} (${String(result.screens.length)} screen(s))`,
    );
  }
  return {
    auditedAt: runtime.now(),
    totalFixtures: fixtures.length,
    driftedFixtures: countLabelled(fixtures, [
      "Design Drift Detected",
      "Both Drifted",
    ]),
    regressedFixtures: countLabelled(fixtures, [
      "Generator Regression",
      "Both Drifted",
    ]),
    unavailableFixtures: fixtures.filter((fixture) => fixture.status !== "completed").length,
    fixtures,
  };
};
