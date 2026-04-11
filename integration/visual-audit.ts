import assert from "node:assert/strict";
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
  loadLastRunBufferForScreen,
  safeSimilarityScore,
} from "./visual-audit.helpers.js";

export type VisualAuditLabel =
  | "Design Drift Detected"
  | "Generator Regression"
  | "Both Drifted"
  | "Stable";

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
  fixtureLabel: VisualAuditLabel;
  lastKnownGoodAt: string;
  screens: VisualAuditScreenResult[];
}

export interface VisualAuditReport {
  auditedAt: string;
  totalFixtures: number;
  driftedFixtures: number;
  regressedFixtures: number;
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

interface AuditScreenContext {
  fixtureId: string;
  metadata: VisualBenchmarkFixtureMetadata;
  frozenFallback: Buffer;
  liveSnapshot: VisualBenchmarkNodeSnapshot;
  fetchContext: FetchContext;
  options: VisualBenchmarkFixtureOptions;
  driftThreshold: number;
  regressionThreshold: number;
}

const auditScreen = async (
  screen: VisualBenchmarkFixtureScreenMetadata,
  context: AuditScreenContext,
): Promise<VisualAuditScreenResult> => {
  const screenMetadata = buildScreenMetadata(context.metadata, screen);
  const liveBuffer = await fetchCachedLiveImage(
    screenMetadata,
    context.fetchContext,
  );
  const frozenBuffer = await loadFrozenScreenBuffer(
    context.fixtureId,
    screen,
    context.frozenFallback,
    context.options,
  );
  const driftScore = safeSimilarityScore(frozenBuffer, liveBuffer);
  const lastRunBuffer = await loadLastRunBufferForScreen(
    context.fixtureId,
    screen,
    context.options,
  );
  const regressionScore =
    lastRunBuffer !== null
      ? safeSimilarityScore(frozenBuffer, lastRunBuffer)
      : null;
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
    liveLastModified: context.liveSnapshot.lastModified,
  };
};

interface AuditFixtureContext {
  fixtureId: string;
  accessToken: string;
  cache: LiveImageCache;
  fetchImpl: typeof fetch;
  sleepImpl: (ms: number) => Promise<void>;
  log: (message: string) => void;
  options: VisualBenchmarkFixtureOptions;
  driftThreshold: number;
  regressionThreshold: number;
}

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
  const fetchContext: FetchContext = {
    accessToken: context.accessToken,
    cache: context.cache,
    fetchImpl: context.fetchImpl,
    sleepImpl: context.sleepImpl,
    log: context.log,
  };
  const liveSnapshot = await fetchVisualBenchmarkNodeSnapshot(
    metadata,
    context.accessToken,
    {
      fetchImpl: context.fetchImpl,
      sleepImpl: context.sleepImpl,
      log: context.log,
    },
  );
  const screens: VisualAuditScreenResult[] = [];
  for (const screen of enumerateFixtureScreens(metadata)) {
    const screenResult = await auditScreen(screen, {
      fixtureId: context.fixtureId,
      metadata,
      frozenFallback,
      liveSnapshot,
      fetchContext,
      options: context.options,
      driftThreshold: context.driftThreshold,
      regressionThreshold: context.regressionThreshold,
    });
    screens.push(screenResult);
  }
  return {
    fixtureId: context.fixtureId,
    fixtureLabel: combineFixtureLabel(screens),
    lastKnownGoodAt: metadata.capturedAt,
    screens,
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
      options: dependencies,
      driftThreshold: runtime.driftThreshold,
      regressionThreshold: runtime.regressionThreshold,
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
    fixtures,
  };
};
