import assert from "node:assert/strict";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  enumerateFixtureScreens,
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
  resolveVisualBenchmarkScreenPaths,
  resolveVisualBenchmarkScreenViewportPaths,
  resolveVisualBenchmarkFixturePaths,
  toStableJsonString,
  type VisualBenchmarkFixtureMetadata,
  type VisualBenchmarkFixtureOptions,
  type VisualBenchmarkViewport,
  writeVisualBenchmarkFixtureInputs,
  writeVisualBenchmarkFixtureMetadata,
  writeVisualBenchmarkReference,
} from "./visual-benchmark.helpers.js";
import { updateVisualBaselines } from "./visual-baseline.js";
import {
  loadVisualQualityConfig,
  type VisualQualityConfig,
} from "./visual-quality-config.js";
import {
  executeVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureRunResult,
} from "./visual-benchmark.execution.js";
import {
  loadVisualBenchmarkViewCatalog,
  resolveVisualBenchmarkCanonicalReferencePaths,
  toCatalogViewMapByFixture,
  type VisualBenchmarkViewCatalog,
  type VisualBenchmarkViewCatalogEntry,
} from "./visual-benchmark-view-catalog.js";

type FetchLike = typeof fetch;
type VisualBenchmarkMode =
  | "update-fixtures"
  | "update-references"
  | "live"
  | "update-baseline";

export interface VisualBenchmarkUpdateDependencies extends VisualBenchmarkFixtureOptions {
  catalogPath?: string;
  fetchImpl?: FetchLike;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureRunResult>;
  qualityConfig?: VisualQualityConfig;
  log?: (message: string) => void;
  now?: () => string;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface VisualBenchmarkNodeSnapshot {
  payload: Record<string, unknown>;
  nodeName: string;
  lastModified: string;
  viewport: VisualBenchmarkViewport;
}

export interface VisualBenchmarkLiveAuditResult {
  fixtureId: string;
  figmaChanged: boolean;
  referenceChanged: boolean;
  frozenLastModified: string;
  liveLastModified: string;
}

const MODULE_FILE = fileURLToPath(import.meta.url);

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const defaultLog = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const defaultSleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const DEFAULT_CANONICAL_REFERENCE_VERSION = 1;

interface CanonicalReferenceMeta {
  fixtureId: string;
  label: string;
  fileKey: string;
  nodeId: string;
  nodeName: string;
  export: {
    format: "png";
    scale: number;
  };
  comparison: {
    viewportId: string;
    maxDiffPercent: number;
  };
  referenceVersion: number;
  figmaLastModified: string;
  capturedAt: string;
  sha256: string;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
  try {
    const targetStat = await stat(targetPath);
    return targetStat.isFile();
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

const resolveCatalogPath = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<string | null> => {
  if (
    typeof dependencies?.catalogPath === "string" &&
    dependencies.catalogPath.trim().length > 0
  ) {
    return dependencies.catalogPath.trim();
  }
  if (
    typeof dependencies?.fixtureRoot === "string" &&
    dependencies.fixtureRoot.trim().length > 0
  ) {
    const candidatePath = path.join(
      path.resolve(dependencies.fixtureRoot),
      "benchmark-views.json",
    );
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
    return null;
  }
  return null;
};

const loadCatalogByFixture = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<ReadonlyMap<string, VisualBenchmarkViewCatalogEntry>> => {
  const catalogPath = await resolveCatalogPath(dependencies);
  if (
    catalogPath === null &&
    typeof dependencies?.fixtureRoot === "string" &&
    dependencies.fixtureRoot.trim().length > 0
  ) {
    return new Map();
  }
  const catalog: VisualBenchmarkViewCatalog =
    catalogPath === null
      ? await loadVisualBenchmarkViewCatalog()
      : await loadVisualBenchmarkViewCatalog(catalogPath);
  return toCatalogViewMapByFixture(catalog);
};

const createCanonicalReferenceMeta = (input: {
  fixtureId: string;
  now: string;
  snapshot: VisualBenchmarkNodeSnapshot;
  referenceBuffer: Buffer;
  view?: VisualBenchmarkViewCatalogEntry;
  metadata: VisualBenchmarkFixtureMetadata;
}): CanonicalReferenceMeta => {
  const view = input.view;
  const label = view?.label ?? input.fixtureId;
  const referenceVersion =
    view?.referenceVersion ?? DEFAULT_CANONICAL_REFERENCE_VERSION;
  const exportConfig =
    view?.export ?? {
      format: input.metadata.export.format,
      scale: input.metadata.export.scale,
    };
  const comparison =
    view?.comparison ?? {
      viewportId: "default",
      maxDiffPercent: 0.1,
    };
  return {
    fixtureId: input.fixtureId,
    label,
    fileKey: view?.fileKey ?? input.metadata.source.fileKey,
    nodeId: view?.nodeId ?? input.metadata.source.nodeId,
    nodeName: view?.nodeName ?? input.metadata.source.nodeName,
    export: {
      format: "png",
      scale: exportConfig.scale,
    },
    comparison: {
      viewportId: comparison.viewportId,
      maxDiffPercent: comparison.maxDiffPercent,
    },
    referenceVersion,
    figmaLastModified: input.snapshot.lastModified,
    capturedAt: input.now,
    sha256: createHash("sha256").update(input.referenceBuffer).digest("hex"),
  };
};

const MAX_RETRY_DELAY_MS = 60_000;

const resolveRetryAfterDelay = (
  retryAfterHeader: string | null,
  attempt: number,
): number => {
  if (
    typeof retryAfterHeader === "string" &&
    retryAfterHeader.trim().length > 0
  ) {
    const seconds = Number.parseInt(retryAfterHeader.trim(), 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000);
    }
  }
  return Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** attempt);
};

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
};

const readPositiveNumber = (value: unknown, fieldName: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return parsed;
};

class NonRetryableFetchError extends Error {}

interface FetchWithRetryOptions {
  url: string;
  headers: Record<string, string>;
  maxRetries: number;
  fetchImpl: FetchLike;
  log: (message: string) => void;
  sleepImpl: (ms: number) => Promise<void>;
}

const formatFigmaFailure = (response: Response, url: string): string =>
  `Figma API request failed: ${String(response.status)} ${response.statusText} — ${url}`;

const handleRateLimitedResponse = async (
  response: Response,
  context: FetchWithRetryOptions,
  attempt: number,
): Promise<Error> => {
  const delayMs = resolveRetryAfterDelay(
    response.headers.get("Retry-After"),
    attempt,
  );
  if (attempt < context.maxRetries) {
    context.log(
      `Figma API returned 429, retrying in ${String(delayMs)}ms (${String(attempt + 1)}/${String(context.maxRetries)})...`,
    );
    await context.sleepImpl(delayMs);
  }
  return new Error(formatFigmaFailure(response, context.url));
};

const fetchWithRetry = async (
  options: FetchWithRetryOptions,
): Promise<Response> => {
  let lastError: Error = new Error(
    `fetchWithRetry exhausted ${String(options.maxRetries)} retries for ${options.url}`,
  );
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      const response = await options.fetchImpl(options.url, {
        headers: options.headers,
      });
      if (response.ok) {
        return response;
      }
      if (response.status === 429) {
        lastError = await handleRateLimitedResponse(response, options, attempt);
        if (attempt < options.maxRetries) {
          continue;
        }
        throw lastError;
      }
      if (response.status >= 400 && response.status < 500) {
        throw new NonRetryableFetchError(
          formatFigmaFailure(response, options.url),
        );
      }
      if (response.status >= 500 && attempt < options.maxRetries) {
        options.log(
          `Figma API returned ${String(response.status)}, retrying (${String(attempt + 1)}/${String(options.maxRetries)})...`,
        );
        lastError = new Error(formatFigmaFailure(response, options.url));
        continue;
      }
      throw new Error(formatFigmaFailure(response, options.url));
    } catch (error: unknown) {
      if (error instanceof NonRetryableFetchError) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < options.maxRetries) {
        options.log(
          `Fetch error, retrying (${String(attempt + 1)}/${String(options.maxRetries)})...`,
        );
        continue;
      }
    }
  }
  throw lastError;
};

const loadValidPngIfPresent = async (
  pngPath: string,
): Promise<Buffer | null> => {
  try {
    const buffer = await readFile(pngPath);
    if (!isValidPngBuffer(buffer)) {
      throw new Error(`Expected a valid PNG at '${pngPath}'.`);
    }
    return buffer;
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

const extractNodeSnapshot = (
  payload: unknown,
  nodeId: string,
): VisualBenchmarkNodeSnapshot => {
  if (!isPlainRecord(payload)) {
    throw new Error("Expected Figma node payload to be an object.");
  }

  const lastModified = readRequiredString(
    payload.lastModified,
    "Figma node payload lastModified",
  );
  const nodes = payload.nodes;
  if (!isPlainRecord(nodes)) {
    throw new Error("Figma node payload must contain a nodes map.");
  }

  const nodeEntry = nodes[nodeId];
  if (!isPlainRecord(nodeEntry)) {
    throw new Error(`Figma node payload does not contain node '${nodeId}'.`);
  }

  const document = nodeEntry.document;
  if (!isPlainRecord(document)) {
    throw new Error(`Figma node '${nodeId}' is missing a document payload.`);
  }

  const absoluteBoundingBox = document.absoluteBoundingBox;
  if (!isPlainRecord(absoluteBoundingBox)) {
    throw new Error(`Figma node '${nodeId}' is missing absoluteBoundingBox.`);
  }

  return {
    payload: payload as Record<string, unknown>,
    nodeName: readRequiredString(document.name, `Figma node '${nodeId}' name`),
    lastModified,
    viewport: {
      width: Math.round(
        readPositiveNumber(
          absoluteBoundingBox.width,
          `Figma node '${nodeId}' absoluteBoundingBox.width`,
        ),
      ),
      height: Math.round(
        readPositiveNumber(
          absoluteBoundingBox.height,
          `Figma node '${nodeId}' absoluteBoundingBox.height`,
        ),
      ),
    },
  };
};

const buildNodeUrl = (fileKey: string, nodeId: string): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    depth: "8",
  });
  return `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`;
};

const buildImageUrl = (metadata: VisualBenchmarkFixtureMetadata): string => {
  const params = new URLSearchParams({
    ids: metadata.source.nodeId,
    format: metadata.export.format,
    scale: String(metadata.export.scale),
  });
  return `https://api.figma.com/v1/images/${encodeURIComponent(metadata.source.fileKey)}?${params.toString()}`;
};

export const fetchVisualBenchmarkNodeSnapshot = async (
  metadata: VisualBenchmarkFixtureMetadata,
  accessToken: string,
  dependencies?: Pick<
    VisualBenchmarkUpdateDependencies,
    "fetchImpl" | "log" | "sleepImpl"
  >,
): Promise<VisualBenchmarkNodeSnapshot> => {
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  const log = dependencies?.log ?? defaultLog;
  const sleepImpl = dependencies?.sleepImpl ?? defaultSleep;
  const url = buildNodeUrl(metadata.source.fileKey, metadata.source.nodeId);
  const response = await fetchWithRetry({
    url,
    headers: { "X-Figma-Token": accessToken },
    maxRetries: 3,
    fetchImpl,
    log,
    sleepImpl,
  });
  const payload = (await response.json()) as unknown;
  return extractNodeSnapshot(payload, metadata.source.nodeId);
};

export const fetchVisualBenchmarkReferenceImage = async (
  metadata: VisualBenchmarkFixtureMetadata,
  accessToken: string,
  dependencies?: Pick<
    VisualBenchmarkUpdateDependencies,
    "fetchImpl" | "log" | "sleepImpl"
  >,
): Promise<Buffer> => {
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  const log = dependencies?.log ?? defaultLog;
  const sleepImpl = dependencies?.sleepImpl ?? defaultSleep;
  const imageLookupUrl = buildImageUrl(metadata);
  const imageLookupResponse = await fetchWithRetry({
    url: imageLookupUrl,
    headers: { "X-Figma-Token": accessToken },
    maxRetries: 3,
    fetchImpl,
    log,
    sleepImpl,
  });
  const imageLookupResult = (await imageLookupResponse.json()) as unknown;
  if (!isPlainRecord(imageLookupResult)) {
    throw new Error("Expected Figma image response to be an object.");
  }
  const images = imageLookupResult.images;
  if (!isPlainRecord(images)) {
    throw new Error("Figma image response must contain an images map.");
  }

  const imageUrl = images[metadata.source.nodeId];
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    throw new Error(
      `Figma image export returned no renderable image for node '${metadata.source.nodeId}'.`,
    );
  }

  const imageResponse = await fetchWithRetry({
    url: imageUrl,
    headers: {},
    maxRetries: 3,
    fetchImpl,
    log,
    sleepImpl,
  });
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!isValidPngBuffer(buffer)) {
    throw new Error(
      `Figma image export for node '${metadata.source.nodeId}' returned an invalid PNG.`,
    );
  }
  return buffer;
};

const updateMetadataFromSnapshot = (
  metadata: VisualBenchmarkFixtureMetadata,
  snapshot: VisualBenchmarkNodeSnapshot,
  options?: {
    capturedAt?: string;
  },
): VisualBenchmarkFixtureMetadata => {
  const representativeDeviceScaleFactor =
    snapshot.viewport.deviceScaleFactor ??
    metadata.viewport.deviceScaleFactor ??
    1;
  return {
    ...metadata,
    ...(options?.capturedAt ? { capturedAt: options.capturedAt } : {}),
    source: {
      ...metadata.source,
      nodeName: snapshot.nodeName,
      lastModified: snapshot.lastModified,
    },
    viewport: {
      ...snapshot.viewport,
      deviceScaleFactor: representativeDeviceScaleFactor,
    },
  };
};

const FIGMA_TOKEN_ENV_KEYS = [
  "WORKSPACEDEV_FIGMA_TOKEN",
  "VISUAL_BENCHMARK_FIGMA_TOKEN",
  "FIGMA_ACCESS_TOKEN",
] as const;

const requireAccessToken = (): string => {
  for (const envKey of FIGMA_TOKEN_ENV_KEYS) {
    const token = process.env[envKey]?.trim();
    if (token) {
      return token;
    }
  }
  assert.fail(
    `A Figma token is required for visual-benchmark maintenance. Set one of: ${FIGMA_TOKEN_ENV_KEYS.join(", ")}.`,
  );
};

export const updateVisualBenchmarkFixtures = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<void> => {
  const accessToken = requireAccessToken();
  const log = dependencies?.log ?? defaultLog;
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);

  log(`Updating fixtures for ${fixtureIds.length} fixture(s)...`);
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
    const snapshot = await fetchVisualBenchmarkNodeSnapshot(
      metadata,
      accessToken,
      dependencies,
    );
    const updatedMetadata = updateMetadataFromSnapshot(metadata, snapshot);

    await writeVisualBenchmarkFixtureInputs(
      fixtureId,
      snapshot.payload,
      dependencies,
    );
    await writeVisualBenchmarkFixtureMetadata(
      fixtureId,
      updatedMetadata,
      dependencies,
    );

    const paths = resolveVisualBenchmarkFixturePaths(fixtureId, dependencies);
    log(`Updated ${path.relative(process.cwd(), paths.figmaJsonPath)}`);
  }
};

export const updateVisualBenchmarkReferences = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<void> => {
  const accessToken = requireAccessToken();
  const log = dependencies?.log ?? defaultLog;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);
  const catalogPath = await resolveCatalogPath(dependencies);
  const benchmarkViewsByFixture = await loadCatalogByFixture(dependencies);
  const canonicalPathOptions =
    catalogPath === null
      ? { fixtureRoot: dependencies?.fixtureRoot }
      : { fixtureRoot: dependencies?.fixtureRoot, catalogPath };

  log(`Updating references for ${fixtureIds.length} fixture(s)...`);
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
    const view = benchmarkViewsByFixture.get(fixtureId);
    const sourceNodeId = view?.nodeId ?? metadata.source.nodeId;
    const sourceNodeName = view?.nodeName ?? metadata.source.nodeName;
    const sourceFileKey = view?.fileKey ?? metadata.source.fileKey;
    const selectedViewportId = view?.comparison.viewportId ?? "default";
    const exportScale = view?.export.scale ?? metadata.export.scale;
    const selectedScreen =
      enumerateFixtureScreens(metadata).find(
        (screen) => screen.screenId === sourceNodeId,
      ) ?? enumerateFixtureScreens(metadata)[0];
    const selectedViewport =
      selectedScreen?.viewports?.find(
        (candidate) => candidate.id === selectedViewportId,
      ) ?? selectedScreen?.viewport;
    const snapshotSeedMetadata: VisualBenchmarkFixtureMetadata = {
      ...metadata,
      source: {
        ...metadata.source,
        fileKey: sourceFileKey,
        nodeId: sourceNodeId,
        nodeName: sourceNodeName,
      },
      export: {
        format: "png",
        scale: exportScale,
      },
    };
    const snapshot = await fetchVisualBenchmarkNodeSnapshot(
      snapshotSeedMetadata,
      accessToken,
      dependencies,
    );
    const exportMetadata: VisualBenchmarkFixtureMetadata = {
      ...snapshotSeedMetadata,
      source: {
        ...snapshotSeedMetadata.source,
        nodeName: snapshot.nodeName,
        lastModified: snapshot.lastModified,
      },
      viewport: snapshot.viewport,
    };
    const referenceBuffer = await fetchVisualBenchmarkReferenceImage(
      exportMetadata,
      accessToken,
      dependencies,
    );
    if (!isValidPngBuffer(referenceBuffer)) {
      throw new Error(
        `Benchmark fixture '${fixtureId}' returned an invalid PNG from Figma export.`,
      );
    }
    const parsedReferencePng = PNG.sync.read(referenceBuffer);
    const referenceViewport = {
      width: parsedReferencePng.width,
      height: parsedReferencePng.height,
      deviceScaleFactor: selectedViewport?.deviceScaleFactor ?? 1,
    };

    const capturedAt = now();
    const canonicalPaths = resolveVisualBenchmarkCanonicalReferencePaths(
      {
        fixtureId,
        referenceVersion:
          view?.referenceVersion ?? DEFAULT_CANONICAL_REFERENCE_VERSION,
      },
      canonicalPathOptions,
    );
    await mkdir(canonicalPaths.fixtureVersionDir, { recursive: true });
    await writeFile(canonicalPaths.figmaPngPath, referenceBuffer);
    const canonicalMeta = createCanonicalReferenceMeta({
      fixtureId,
      now: capturedAt,
      snapshot,
      referenceBuffer,
      view,
      metadata,
    });
    await writeFile(
      canonicalPaths.referenceMetaJsonPath,
      toStableJsonString(canonicalMeta),
      "utf8",
    );
    log(`Updated ${path.relative(process.cwd(), canonicalPaths.figmaPngPath)}`);
    log(
      `Updated ${path.relative(process.cwd(), canonicalPaths.referenceMetaJsonPath)}`,
    );

    const legacyScreenPath = resolveVisualBenchmarkScreenPaths(
      fixtureId,
      sourceNodeId,
      dependencies,
    ).referencePngPath;
    const viewportReferencePath = resolveVisualBenchmarkScreenViewportPaths(
      fixtureId,
      sourceNodeId,
      selectedViewportId,
      dependencies,
    ).referencePngPath;
    await mkdir(path.dirname(legacyScreenPath), { recursive: true });
    await mkdir(path.dirname(viewportReferencePath), { recursive: true });
    await writeFile(legacyScreenPath, referenceBuffer);
    await writeFile(viewportReferencePath, referenceBuffer);
    await writeVisualBenchmarkReference(
      fixtureId,
      referenceBuffer,
      dependencies,
    );

    const updatedMetadata: VisualBenchmarkFixtureMetadata = {
      ...metadata,
      capturedAt,
      source: {
        ...metadata.source,
        fileKey: sourceFileKey,
        nodeId: sourceNodeId,
        nodeName: snapshot.nodeName,
        lastModified: snapshot.lastModified,
      },
      export: {
        format: "png",
        scale: exportScale,
      },
      viewport: {
        width: referenceViewport.width,
        height: referenceViewport.height,
        deviceScaleFactor: referenceViewport.deviceScaleFactor,
      },
      ...(Array.isArray(metadata.screens) && metadata.screens.length > 0
        ? {
            screens: metadata.screens.map((screen) => {
              const screenMatchesSource =
                screen.screenId === sourceNodeId ||
                screen.nodeId === sourceNodeId ||
                screen.nodeId === metadata.source.nodeId ||
                screen.screenName === sourceNodeName;
              const updateSingleScreen =
                !screenMatchesSource && metadata.screens?.length === 1;
              if (!screenMatchesSource && !updateSingleScreen) {
                return screen;
              }
              const updatedScreenViewports = Array.isArray(screen.viewports)
                ? screen.viewports.map((viewport) =>
                    viewport.id === selectedViewportId
                      ? {
                          ...viewport,
                          width: referenceViewport.width,
                          height: referenceViewport.height,
                          deviceScaleFactor:
                            viewport.deviceScaleFactor ??
                            referenceViewport.deviceScaleFactor,
                        }
                      : viewport,
                  )
                : screen.viewports;
              return {
                ...screen,
                screenId: sourceNodeId,
                screenName: snapshot.nodeName,
                nodeId: sourceNodeId,
                viewport: {
                  ...(screen.viewport ?? referenceViewport),
                  width: referenceViewport.width,
                  height: referenceViewport.height,
                  deviceScaleFactor:
                    screen.viewport?.deviceScaleFactor ??
                    referenceViewport.deviceScaleFactor,
                },
                ...(updatedScreenViewports !== undefined
                  ? { viewports: updatedScreenViewports }
                  : {}),
              };
            }),
          }
        : {}),
    };
    await writeVisualBenchmarkFixtureMetadata(
      fixtureId,
      updatedMetadata,
      dependencies,
    );
    const fixturePaths = resolveVisualBenchmarkFixturePaths(
      fixtureId,
      dependencies,
    );
    log(`Updated ${path.relative(process.cwd(), fixturePaths.referencePngPath)}`);
    log(`Updated ${path.relative(process.cwd(), legacyScreenPath)}`);
    log(`Updated ${path.relative(process.cwd(), viewportReferencePath)}`);
  }
};

export const runVisualBenchmarkLiveAudit = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<VisualBenchmarkLiveAuditResult[]> => {
  const accessToken = requireAccessToken();
  const log = dependencies?.log ?? defaultLog;
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);
  const catalogPath = await resolveCatalogPath(dependencies);
  const benchmarkViewsByFixture = await loadCatalogByFixture(dependencies);
  const canonicalPathOptions =
    catalogPath === null
      ? { fixtureRoot: dependencies?.fixtureRoot }
      : { fixtureRoot: dependencies?.fixtureRoot, catalogPath };
  const results: VisualBenchmarkLiveAuditResult[] = [];

  log(
    `Running maintenance live audit for ${fixtureIds.length} fixture(s) (frozen fixtures vs live Figma)...`,
  );
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
    const view = benchmarkViewsByFixture.get(fixtureId);
    const frozenFigmaInput = await loadVisualBenchmarkFixtureInputs(
      fixtureId,
      dependencies,
    );
    const frozenReference = await loadVisualBenchmarkReference(
      fixtureId,
      dependencies,
    );
    const liveSnapshot = await fetchVisualBenchmarkNodeSnapshot(
      metadata,
      accessToken,
      dependencies,
    );
    const liveReference = await fetchVisualBenchmarkReferenceImage(
      metadata,
      accessToken,
      dependencies,
    );
    let viewportReferenceDrift = false;
    const declaredScreens = enumerateFixtureScreens(metadata);
    for (const screen of declaredScreens) {
      const screenMetadata: VisualBenchmarkFixtureMetadata = {
        ...metadata,
        source: {
          ...metadata.source,
          nodeId: screen.nodeId,
          nodeName: screen.screenName,
        },
        viewport: {
          width: screen.viewport.width,
          height: screen.viewport.height,
          deviceScaleFactor:
            screen.viewport.deviceScaleFactor ??
            metadata.viewport.deviceScaleFactor ??
            1,
        },
      };
      const liveScreenReference =
        screen.nodeId === metadata.source.nodeId
          ? liveReference
          : await fetchVisualBenchmarkReferenceImage(
              screenMetadata,
              accessToken,
              dependencies,
            );
      const frozenScreenPaths = resolveVisualBenchmarkScreenPaths(
        fixtureId,
        screen.screenId,
        dependencies,
      );
      const candidateBuffers: Buffer[] = [];
      const screenReference = await loadValidPngIfPresent(
        frozenScreenPaths.referencePngPath,
      );
      if (screenReference !== null) {
        candidateBuffers.push(screenReference);
      }
      if (screen.nodeId === metadata.source.nodeId) {
        candidateBuffers.push(frozenReference);
      }
      if (screen.nodeId === (view?.nodeId ?? metadata.source.nodeId)) {
        try {
          const canonicalPaths = resolveVisualBenchmarkCanonicalReferencePaths(
            {
              fixtureId,
              referenceVersion:
                view?.referenceVersion ?? DEFAULT_CANONICAL_REFERENCE_VERSION,
            },
            canonicalPathOptions,
          );
          const canonicalBuffer = await loadValidPngIfPresent(
            canonicalPaths.figmaPngPath,
          );
          if (canonicalBuffer !== null) {
            candidateBuffers.push(canonicalBuffer);
          }
        } catch {
          viewportReferenceDrift = true;
        }
      }

      const hasMatch = candidateBuffers.some((buffer) =>
        buffer.equals(liveScreenReference),
      );
      if (!hasMatch) {
        viewportReferenceDrift = true;
      }

      let viewportFiles: string[] = [];
      try {
        viewportFiles = await readdir(frozenScreenPaths.screenDir);
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
      for (const fileName of viewportFiles) {
        if (
          !fileName.endsWith(".png") ||
          fileName === "reference.png" ||
          fileName.trim().length === 0
        ) {
          continue;
        }
        const viewportReferencePath = path.join(
          frozenScreenPaths.screenDir,
          fileName,
        );
        const viewportReference = await loadValidPngIfPresent(
          viewportReferencePath,
        );
        if (viewportReference === null) {
          viewportReferenceDrift = true;
          continue;
        }
      }
    }

    const figmaChanged =
      toStableJsonString(frozenFigmaInput) !==
      toStableJsonString(liveSnapshot.payload);
    const referenceChanged =
      !frozenReference.equals(liveReference) || viewportReferenceDrift;
    const result: VisualBenchmarkLiveAuditResult = {
      fixtureId,
      figmaChanged,
      referenceChanged,
      frozenLastModified: metadata.source.lastModified,
      liveLastModified: liveSnapshot.lastModified,
    };
    results.push(result);

    log(
      `Fixture '${fixtureId}': figma=${figmaChanged ? "DRIFT" : "stable"}, reference=${referenceChanged ? "DRIFT" : "stable"}, frozenLastModified=${result.frozenLastModified}, liveLastModified=${result.liveLastModified}`,
    );
  }

  return results;
};

export const resolveVisualBenchmarkMaintenanceMode = (
  args: readonly string[],
): VisualBenchmarkMode => {
  const modes = args.filter((arg): arg is `--${VisualBenchmarkMode}` => {
    return (
      arg === "--update-fixtures" ||
      arg === "--update-references" ||
      arg === "--live" ||
      arg === "--update-baseline"
    );
  });

  if (modes.length !== 1 || args.length !== 1) {
    throw new Error(
      "Usage: visual-benchmark.update.ts --update-fixtures | --update-references | --live | --update-baseline\n--live is the maintenance audit for frozen fixtures vs live Figma. For drift/regression classification against persisted generated output, use 'pnpm visual:audit live'.",
    );
  }

  switch (modes[0]) {
    case "--update-fixtures":
      return "update-fixtures";
    case "--update-references":
      return "update-references";
    case "--live":
      return "live";
    case "--update-baseline":
      return "update-baseline";
  }
};

export const runVisualBenchmarkMaintenance = async (
  args: readonly string[],
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<void> => {
  const mode = resolveVisualBenchmarkMaintenanceMode(args);
  const log = dependencies?.log ?? defaultLog;
  if (mode === "update-fixtures") {
    await updateVisualBenchmarkFixtures(dependencies);
    return;
  }
  if (mode === "update-references") {
    await updateVisualBenchmarkReferences(dependencies);
    return;
  }
  if (mode === "update-baseline") {
    const executeFixture =
      dependencies?.executeFixture ?? executeVisualBenchmarkFixture;
    const qualityConfig =
      dependencies?.qualityConfig ??
      (await loadVisualQualityConfig(dependencies));
    await updateVisualBaselines({
      fixtureRoot: dependencies?.fixtureRoot,
      artifactRoot: dependencies?.artifactRoot,
      qualityConfig,
      executeFixture: async (fixtureId, options) =>
        executeFixture(fixtureId, {
          ...options,
          qualityConfig,
        }),
      log,
    });
    return;
  }
  await runVisualBenchmarkLiveAudit(dependencies);
};

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === MODULE_FILE;

if (isDirectExecution) {
  void runVisualBenchmarkMaintenance(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
