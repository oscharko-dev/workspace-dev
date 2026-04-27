import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FigmaMcpScreenshotReference } from "../parity/types.js";

export interface FigmaScreenshotFetchConfig {
  fileKey: string;
  accessToken: string;
  desiredWidth: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  onLog?: (message: string) => void;
}

export interface FigmaScreenshotPipelineResult {
  fetchedCount: number;
  failedCount: number;
  totalCount: number;
  referenceImageMap: Map<string, Buffer>;
  failedNodeIds: Array<{
    nodeId: string;
    reason: string;
  }>;
}

type FetchLike = typeof fetch;

const fetchWithRetry = async ({
  url,
  headers,
  fetchImpl,
  maxRetries,
  onLog,
}: {
  url: string;
  headers: Record<string, string>;
  fetchImpl: FetchLike;
  maxRetries: number;
  onLog?: (message: string) => void;
}): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers });
      if (response.ok) {
        return response;
      }
      if (response.status >= 500 && attempt < maxRetries) {
        onLog?.(
          `Screenshot fetch retry ${String(attempt + 1)}/${String(maxRetries)} after ${String(response.status)}.`,
        );
        continue;
      }
      throw new Error(
        `Figma API request failed with ${String(response.status)} ${response.statusText}.`,
      );
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        onLog?.(
          `Screenshot fetch retry ${String(attempt + 1)}/${String(maxRetries)} after transport error.`,
        );
        continue;
      }
    }
  }
  throw lastError;
};

const buildImageUrl = ({
  fileKey,
  nodeId,
  scale,
}: {
  fileKey: string;
  nodeId: string;
  scale: number;
}): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    format: "png",
    scale: String(scale),
  });
  return `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${params.toString()}`;
};

export const fetchFigmaScreenshots = async ({
  screenshots,
  config,
}: {
  screenshots: FigmaMcpScreenshotReference[];
  config: FigmaScreenshotFetchConfig;
}): Promise<FigmaScreenshotPipelineResult> => {
  const fetchImpl = config.fetchImpl ?? fetch;
  const maxRetries = config.maxRetries ?? 3;
  const referenceImageMap = new Map<string, Buffer>();
  const failedNodeIds: Array<{ nodeId: string; reason: string }> = [];
  let fetchedCount = 0;

  // Filter to only quality-gate screenshots
  const qualityGateScreenshots = screenshots.filter(
    (s) => s.purpose === "quality-gate",
  );

  for (const screenshot of qualityGateScreenshots) {
    try {
      const scale = config.desiredWidth / 1280; // Assuming 1280px is the default width
      const imageUrl = buildImageUrl({
        fileKey: config.fileKey,
        nodeId: screenshot.nodeId,
        scale: Math.max(0.5, Math.min(3, scale)),
      });

      config.onLog?.(`Fetching screenshot for node ${screenshot.nodeId}...`);

      const response = await fetchWithRetry({
        url: imageUrl,
        headers: { "X-Figma-Token": config.accessToken },
        fetchImpl,
        maxRetries,
        onLog: config.onLog,
      });

      const buffer = Buffer.from(await response.arrayBuffer());

      if (buffer.length === 0) {
        failedNodeIds.push({
          nodeId: screenshot.nodeId,
          reason: "Empty image response",
        });
        continue;
      }

      referenceImageMap.set(screenshot.nodeId, buffer);
      fetchedCount += 1;
      config.onLog?.(
        `Successfully fetched screenshot for node ${screenshot.nodeId}.`,
      );
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Unknown error during fetch";
      failedNodeIds.push({
        nodeId: screenshot.nodeId,
        reason,
      });
      config.onLog?.(
        `Failed to fetch screenshot for node ${screenshot.nodeId}: ${reason}`,
      );
    }
  }

  return {
    fetchedCount,
    failedCount: failedNodeIds.length,
    totalCount: qualityGateScreenshots.length,
    referenceImageMap,
    failedNodeIds,
  };
};

export const persistFigmaScreenshotReferences = async ({
  referenceImageMap,
  outputDirectory,
  onLog,
}: {
  referenceImageMap: Map<string, Buffer>;
  outputDirectory: string;
  onLog?: (message: string) => void;
}): Promise<Map<string, string>> => {
  const referenceImagePaths = new Map<string, string>();

  // Create visual references directory if it doesn't exist
  await mkdir(outputDirectory, { recursive: true });

  for (const [nodeId, buffer] of referenceImageMap) {
    try {
      const filename = `reference-${nodeId.replace(/:/g, "-")}.png`;
      const filePath = path.join(outputDirectory, filename);

      await writeFile(filePath, buffer);
      referenceImagePaths.set(nodeId, filePath);
      onLog?.(`Persisted reference image for node ${nodeId} at ${filePath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      onLog?.(
        `Failed to persist reference for node ${nodeId}: ${errorMessage}`,
      );
    }
  }

  return referenceImagePaths;
};

export const parseImageUrl = (
  url: string,
): {
  fileKey: string;
  nodeId: string;
} | null => {
  try {
    const parsedUrl = new URL(url);
    const params = new URLSearchParams(parsedUrl.search);
    const nodeId = params.get("ids");

    // Extract fileKey from URL path: /v1/images/{fileKey}
    const pathMatch = parsedUrl.pathname.match(/\/v1\/images\/([^/]+)/);
    const fileKey = pathMatch ? pathMatch[1] : null;

    if (fileKey && nodeId) {
      return { fileKey: decodeURIComponent(fileKey), nodeId };
    }
  } catch {
    // Invalid URL, return null
  }

  return null;
};
