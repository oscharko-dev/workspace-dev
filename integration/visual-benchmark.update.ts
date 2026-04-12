import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  executeVisualBenchmarkFixture,
  type VisualBenchmarkExecutionOptions,
  type VisualBenchmarkFixtureRunResult,
} from "./visual-benchmark.execution.js";

type FetchLike = typeof fetch;
type VisualBenchmarkMode =
  | "update-fixtures"
  | "update-references"
  | "live"
  | "update-baseline";

export interface VisualBenchmarkUpdateDependencies extends VisualBenchmarkFixtureOptions {
  fetchImpl?: FetchLike;
  executeFixture?: (
    fixtureId: string,
    options?: VisualBenchmarkExecutionOptions,
  ) => Promise<VisualBenchmarkFixtureRunResult>;
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
    geometry: "paths",
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
      deviceScaleFactor:
        snapshot.viewport.deviceScaleFactor ?? metadata.export.scale,
    },
  };
};

const requireAccessToken = (): string => {
  const accessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
  assert.ok(
    accessToken,
    "FIGMA_ACCESS_TOKEN is required for visual-benchmark maintenance.",
  );
  return accessToken;
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
  const log = dependencies?.log ?? defaultLog;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const executeFixture =
    dependencies?.executeFixture ?? executeVisualBenchmarkFixture;
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);

  log(`Updating references for ${fixtureIds.length} fixture(s)...`);
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
    const renderedReference = await executeFixture(fixtureId, {
      ...dependencies,
      allowIncompleteVisualQuality: true,
    });
    const firstScreenArtifact = renderedReference.screens[0];
    if (firstScreenArtifact === undefined) {
      throw new Error(
        `Benchmark fixture '${fixtureId}' did not produce any screen artifacts.`,
      );
    }
    const firstViewportArtifact =
      firstScreenArtifact.viewports?.[0] ?? firstScreenArtifact;
    if (!isValidPngBuffer(firstViewportArtifact.screenshotBuffer)) {
      throw new Error(
        `Benchmark fixture '${fixtureId}' produced an invalid representative PNG.`,
      );
    }
    const updatedMetadata: VisualBenchmarkFixtureMetadata = {
      ...metadata,
      capturedAt: now(),
      viewport: {
        width: firstViewportArtifact.viewport.width,
        height: firstViewportArtifact.viewport.height,
        deviceScaleFactor: metadata.export.scale,
      },
    };

    const declaredScreensById = new Map(
      enumerateFixtureScreens(metadata).map((screen) => [
        screen.screenId,
        screen,
      ]),
    );

    for (const renderedScreen of renderedReference.screens) {
      const viewportArtifacts =
        renderedScreen.viewports !== undefined &&
        renderedScreen.viewports.length > 0
          ? renderedScreen.viewports
          : [
              {
                viewportId: "default",
                screenshotBuffer: renderedScreen.screenshotBuffer,
              },
            ];
      const representativeScreenViewport = viewportArtifacts[0];
      if (
        representativeScreenViewport !== undefined &&
        isValidPngBuffer(representativeScreenViewport.screenshotBuffer)
      ) {
        const legacyScreenPath = resolveVisualBenchmarkScreenPaths(
          fixtureId,
          renderedScreen.screenId,
          dependencies,
        ).referencePngPath;
        await mkdir(path.dirname(legacyScreenPath), { recursive: true });
        await writeFile(
          legacyScreenPath,
          representativeScreenViewport.screenshotBuffer,
        );
        log(`Updated ${path.relative(process.cwd(), legacyScreenPath)}`);
      }

      for (const viewportArtifact of viewportArtifacts) {
        const viewportId =
          typeof viewportArtifact.viewportId === "string" &&
          viewportArtifact.viewportId.trim().length > 0
            ? viewportArtifact.viewportId.trim()
            : "default";
        if (!isValidPngBuffer(viewportArtifact.screenshotBuffer)) {
          throw new Error(
            `Benchmark fixture '${fixtureId}' screen '${renderedScreen.screenId}' viewport '${viewportId}' produced an invalid PNG.`,
          );
        }
        const viewportPath = resolveVisualBenchmarkScreenViewportPaths(
          fixtureId,
          renderedScreen.screenId,
          viewportId,
          dependencies,
        ).referencePngPath;
        await mkdir(path.dirname(viewportPath), { recursive: true });
        await writeFile(viewportPath, viewportArtifact.screenshotBuffer);
        log(`Updated ${path.relative(process.cwd(), viewportPath)}`);
      }

      if (!declaredScreensById.has(renderedScreen.screenId)) {
        throw new Error(
          `Benchmark fixture '${fixtureId}' produced undeclared screen '${renderedScreen.screenId}'.`,
        );
      }
    }

    await writeVisualBenchmarkReference(
      fixtureId,
      firstViewportArtifact.screenshotBuffer,
      dependencies,
    );
    await writeVisualBenchmarkFixtureMetadata(
      fixtureId,
      updatedMetadata,
      dependencies,
    );

    const paths = resolveVisualBenchmarkFixturePaths(fixtureId, dependencies);
    log(`Updated ${path.relative(process.cwd(), paths.referencePngPath)}`);
  }
};

export const runVisualBenchmarkLiveAudit = async (
  dependencies?: VisualBenchmarkUpdateDependencies,
): Promise<VisualBenchmarkLiveAuditResult[]> => {
  const accessToken = requireAccessToken();
  const log = dependencies?.log ?? defaultLog;
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);
  const results: VisualBenchmarkLiveAuditResult[] = [];

  log(
    `Running maintenance live audit for ${fixtureIds.length} fixture(s) (frozen fixtures vs live Figma)...`,
  );
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
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
            screen.viewport.deviceScaleFactor ?? metadata.export.scale,
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
    await updateVisualBaselines({
      fixtureRoot: dependencies?.fixtureRoot,
      artifactRoot: dependencies?.artifactRoot,
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
