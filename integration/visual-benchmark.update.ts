import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isValidPngBuffer,
  listVisualBenchmarkFixtureIds,
  loadVisualBenchmarkFixtureInputs,
  loadVisualBenchmarkFixtureMetadata,
  loadVisualBenchmarkReference,
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
import { executeVisualBenchmarkFixture } from "./visual-benchmark.execution.js";

type FetchLike = typeof fetch;
type VisualBenchmarkMode =
  | "update-fixtures"
  | "update-references"
  | "live"
  | "update-baseline";

export interface VisualBenchmarkUpdateDependencies extends VisualBenchmarkFixtureOptions {
  fetchImpl?: FetchLike;
  log?: (message: string) => void;
  now?: () => string;
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

const fetchWithRetry = async (
  url: string,
  headers: Record<string, string>,
  maxRetries: number,
  fetchImpl: FetchLike,
  log: (message: string) => void,
): Promise<Response> => {
  let lastError: Error = new Error(
    `fetchWithRetry exhausted ${String(maxRetries)} retries for ${url}`,
  );
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchImpl(url, { headers });
      if (response.ok) {
        return response;
      }
      // 4xx responses are deterministic failures — do not retry.
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `Figma API request failed: ${String(response.status)} ${response.statusText} — ${url}`,
        );
      }
      // 5xx responses are transient — retry if attempts remain.
      if (response.status >= 500 && attempt < maxRetries) {
        log(
          `Figma API returned ${String(response.status)}, retrying (${String(attempt + 1)}/${String(maxRetries)})...`,
        );
        lastError = new Error(
          `Figma API request failed: ${String(response.status)} ${response.statusText} — ${url}`,
        );
        continue;
      }
      throw new Error(
        `Figma API request failed: ${String(response.status)} ${response.statusText} — ${url}`,
      );
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        log(
          `Fetch error, retrying (${String(attempt + 1)}/${String(maxRetries)})...`,
        );
        continue;
      }
    }
  }
  throw lastError;
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
  dependencies?: Pick<VisualBenchmarkUpdateDependencies, "fetchImpl" | "log">,
): Promise<VisualBenchmarkNodeSnapshot> => {
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  const log = dependencies?.log ?? defaultLog;
  const url = buildNodeUrl(metadata.source.fileKey, metadata.source.nodeId);
  const response = await fetchWithRetry(
    url,
    { "X-Figma-Token": accessToken },
    3,
    fetchImpl,
    log,
  );
  const payload = (await response.json()) as unknown;
  return extractNodeSnapshot(payload, metadata.source.nodeId);
};

export const fetchVisualBenchmarkReferenceImage = async (
  metadata: VisualBenchmarkFixtureMetadata,
  accessToken: string,
  dependencies?: Pick<VisualBenchmarkUpdateDependencies, "fetchImpl" | "log">,
): Promise<Buffer> => {
  const fetchImpl = dependencies?.fetchImpl ?? fetch;
  const log = dependencies?.log ?? defaultLog;
  const imageLookupUrl = buildImageUrl(metadata);
  const imageLookupResponse = await fetchWithRetry(
    imageLookupUrl,
    { "X-Figma-Token": accessToken },
    3,
    fetchImpl,
    log,
  );
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

  const imageResponse = await fetchWithRetry(imageUrl, {}, 3, fetchImpl, log);
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
    viewport: snapshot.viewport,
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
  const fixtureIds = await listVisualBenchmarkFixtureIds(dependencies);

  log(`Updating references for ${fixtureIds.length} fixture(s)...`);
  for (const fixtureId of fixtureIds) {
    const metadata = await loadVisualBenchmarkFixtureMetadata(
      fixtureId,
      dependencies,
    );
    const renderedReference = await executeVisualBenchmarkFixture(fixtureId, {
      ...dependencies,
      allowIncompleteVisualQuality: true,
    });
    const updatedMetadata: VisualBenchmarkFixtureMetadata = {
      ...metadata,
      capturedAt: now(),
      viewport: {
        width: renderedReference.viewport.width,
        height: renderedReference.viewport.height,
      },
    };

    await writeVisualBenchmarkReference(
      fixtureId,
      renderedReference.screenshotBuffer,
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

  log(`Running live audit for ${fixtureIds.length} fixture(s)...`);
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

    const figmaChanged =
      toStableJsonString(frozenFigmaInput) !==
      toStableJsonString(liveSnapshot.payload);
    const referenceChanged = !frozenReference.equals(liveReference);
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
      "Usage: visual-benchmark.update.ts --update-fixtures | --update-references | --live | --update-baseline",
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
