import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FigmaMcpScreenshotReference } from "../parity/types.js";
import { isValidPngBuffer } from "./visual-quality-reference.js";

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

class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readPositiveNumber = (value: unknown, fieldName: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return value;
};

const redactLogMessage = ({
  accessToken,
  message,
}: {
  accessToken: string;
  message: string;
}): string => {
  const token = accessToken.trim();
  if (!token) {
    return message;
  }
  return message.split(token).join("[REDACTED]");
};

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
      // Issue #1681 (audit-2026-05 Wave 1): never follow redirects on Figma
      // CDN fetches. A redirect to an attacker host would be invisible to the
      // allowlist check above and could exfiltrate any forwarded headers.
      const response = await fetchImpl(url, { headers, redirect: "error" });
      if (response.ok) {
        return response;
      }
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < maxRetries
      ) {
        onLog?.(
          `Screenshot fetch retry ${String(attempt + 1)}/${String(maxRetries)} after ${String(response.status)}.`,
        );
        continue;
      }
      throw new HttpError(
        response.status,
        `Screenshot request failed with ${String(response.status)} ${response.statusText}.`,
      );
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
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

const buildNodeUrl = ({
  fileKey,
  nodeId,
}: {
  fileKey: string;
  nodeId: string;
}): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    geometry: "paths",
  });
  return `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`;
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

const clampScale = (scale: number): number => {
  return Math.max(0.5, Math.min(3, scale));
};

const resolveScreenshotTarget = ({
  fallbackFileKey,
  screenshot,
}: {
  fallbackFileKey: string;
  screenshot: FigmaMcpScreenshotReference;
}): {
  fileKey: string;
  nodeId: string;
} => {
  const parsedImageUrl = parseImageUrl(screenshot.url);
  return {
    fileKey: parsedImageUrl?.fileKey ?? fallbackFileKey,
    nodeId: parsedImageUrl?.nodeId ?? screenshot.nodeId,
  };
};

const fetchNodeSourceWidth = async ({
  fileKey,
  nodeId,
  accessToken,
  fetchImpl,
  maxRetries,
  onLog,
}: {
  fileKey: string;
  nodeId: string;
  accessToken: string;
  fetchImpl: FetchLike;
  maxRetries: number;
  onLog?: (message: string) => void;
}): Promise<number> => {
  const response = await fetchWithRetry({
    url: buildNodeUrl({ fileKey, nodeId }),
    headers: { "X-Figma-Token": accessToken },
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {}),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload.nodes)) {
    throw new Error("Figma node response must contain a nodes map.");
  }
  const nodeEntry = payload.nodes[nodeId];
  if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
    throw new Error(
      `Figma node response does not contain a document for '${nodeId}'.`,
    );
  }
  const absoluteBoundingBox = nodeEntry.document.absoluteBoundingBox;
  if (!isRecord(absoluteBoundingBox)) {
    throw new Error(`Figma node '${nodeId}' is missing absoluteBoundingBox.`);
  }
  return readPositiveNumber(
    absoluteBoundingBox.width,
    `Figma node '${nodeId}' absoluteBoundingBox.width`,
  );
};

const fetchRenderableImageUrl = async ({
  fileKey,
  nodeId,
  scale,
  accessToken,
  fetchImpl,
  maxRetries,
  onLog,
}: {
  fileKey: string;
  nodeId: string;
  scale: number;
  accessToken: string;
  fetchImpl: FetchLike;
  maxRetries: number;
  onLog?: (message: string) => void;
}): Promise<string> => {
  const response = await fetchWithRetry({
    url: buildImageUrl({ fileKey, nodeId, scale }),
    headers: { "X-Figma-Token": accessToken },
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {}),
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload.images)) {
    throw new Error("Figma image response must contain an images map.");
  }
  const imageUrl = payload.images[nodeId];
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    throw new Error(
      `Figma image export returned no renderable image for node '${nodeId}'.`,
    );
  }
  return imageUrl;
};

/**
 * Issue #1681 (audit-2026-05 Wave 1): Figma image-CDN allowlist for the
 * screenshot pipeline. Even though the URL originates from a Figma REST
 * `images` map response (which is trusted), a redirect or compromised CDN
 * could otherwise pivot the runtime toward an arbitrary host. The allowlist
 * is hostname-suffix based to tolerate Figma's S3 bucket subdomains while
 * rejecting everything else.
 */
const ALLOWED_FIGMA_CDN_HOSTS: readonly string[] = [
  "figma.com",
  ".figma.com",
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
  "figma-alpha-api.s3.amazonaws.com",
];

const isAllowedFigmaCdnHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return ALLOWED_FIGMA_CDN_HOSTS.some((entry) => {
    if (entry.startsWith(".")) {
      return host.endsWith(entry);
    }
    return host === entry;
  });
};

const assertScreenshotUrlIsSafe = (imageUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("Figma screenshot URL is not a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Figma screenshot URL has unsupported scheme: ${parsed.protocol}`,
    );
  }
  if (!isAllowedFigmaCdnHost(parsed.hostname)) {
    throw new Error(
      `Figma screenshot URL host "${parsed.hostname}" is not in the Figma CDN allowlist.`,
    );
  }
  return parsed;
};

const fetchPngBuffer = async ({
  imageUrl,
  fetchImpl,
  maxRetries,
  onLog,
}: {
  imageUrl: string;
  fetchImpl: FetchLike;
  maxRetries: number;
  onLog?: (message: string) => void;
}): Promise<Buffer> => {
  assertScreenshotUrlIsSafe(imageUrl);
  const response = await fetchWithRetry({
    url: imageUrl,
    headers: {},
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {}),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!isValidPngBuffer(buffer)) {
    throw new Error("Figma image export returned an invalid PNG.");
  }
  return buffer;
};

const toReferenceFileName = (nodeId: string): string => {
  const stem =
    nodeId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "image";
  const shortHash = createHash("sha256")
    .update(nodeId)
    .digest("hex")
    .slice(0, 8);
  return `reference-${stem}-${shortHash}.png`;
};

const atomicWriteBuffer = async ({
  filePath,
  buffer,
}: {
  filePath: string;
  buffer: Buffer;
}): Promise<void> => {
  const tmpPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`;
  await writeFile(tmpPath, buffer);
  await rename(tmpPath, filePath);
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
  const onSafeLog = (message: string): void => {
    config.onLog?.(
      redactLogMessage({
        accessToken: config.accessToken,
        message,
      }),
    );
  };
  const referenceImageMap = new Map<string, Buffer>();
  const failedNodeIds: Array<{ nodeId: string; reason: string }> = [];
  let fetchedCount = 0;

  const qualityGateScreenshots = screenshots.filter(
    (s) => s.purpose === "quality-gate",
  );

  await Promise.all(
    qualityGateScreenshots.map(async (screenshot) => {
      try {
        const target = resolveScreenshotTarget({
          fallbackFileKey: config.fileKey,
          screenshot,
        });

        onSafeLog(`Fetching screenshot for node ${target.nodeId}...`);

        // #1671 — the geometry probe and the image-render request are
        // independent given `fileKey + nodeId`; only the PNG download
        // depends on the resolved imageUrl. Run the geometry probe and a
        // tentative scale=1 render in parallel, then reuse that imageUrl
        // when `clampScale(desiredWidth / sourceWidth) === 1` (the common
        // case where sourceWidth ≈ desiredWidth — saves one round-trip
        // per node). When scale ≠ 1 we re-issue the image-render at the
        // corrected scale; total wall-time is still ≤ the previous
        // sequential 3-RTT chain.
        const [sourceWidth, imageUrlAt1x] = await Promise.all([
          fetchNodeSourceWidth({
            fileKey: target.fileKey,
            nodeId: target.nodeId,
            accessToken: config.accessToken,
            fetchImpl,
            maxRetries,
            onLog: onSafeLog,
          }),
          fetchRenderableImageUrl({
            fileKey: target.fileKey,
            nodeId: target.nodeId,
            scale: 1,
            accessToken: config.accessToken,
            fetchImpl,
            maxRetries,
            onLog: onSafeLog,
          }),
        ]);
        const scale = clampScale(config.desiredWidth / sourceWidth);
        const imageUrl =
          scale === 1
            ? imageUrlAt1x
            : await fetchRenderableImageUrl({
                fileKey: target.fileKey,
                nodeId: target.nodeId,
                scale,
                accessToken: config.accessToken,
                fetchImpl,
                maxRetries,
                onLog: onSafeLog,
              });
        const buffer = await fetchPngBuffer({
          imageUrl,
          fetchImpl,
          maxRetries,
          onLog: onSafeLog,
        });

        referenceImageMap.set(target.nodeId, buffer);
        fetchedCount += 1;
        onSafeLog(`Successfully fetched screenshot for node ${target.nodeId}.`);
      } catch (error) {
        const reason = redactLogMessage({
          accessToken: config.accessToken,
          message:
            error instanceof Error
              ? error.message
              : "Unknown error during fetch",
        });
        failedNodeIds.push({
          nodeId: screenshot.nodeId,
          reason,
        });
        onSafeLog(
          `Failed to fetch screenshot for node ${screenshot.nodeId}: ${reason}`,
        );
      }
    }),
  );

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
      const filename = toReferenceFileName(nodeId);
      const filePath = path.join(outputDirectory, filename);

      await atomicWriteBuffer({ filePath, buffer });
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
    const fileKey = pathMatch?.[1];

    if (fileKey && nodeId) {
      return { fileKey: decodeURIComponent(fileKey), nodeId };
    }
  } catch {
    // Invalid URL, return null
  }

  return null;
};
