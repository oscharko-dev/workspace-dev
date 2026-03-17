import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DesignIR, ScreenElementIR } from "../parity/types.js";

type ImageExportFormat = "png" | "svg";

interface ImageCandidate {
  nodeId: string;
  format: ImageExportFormat;
}

interface ExportImageAssetsInput {
  fileKey: string;
  accessToken: string;
  ir: DesignIR;
  generatedProjectDir: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  onLog: (message: string) => void;
}

interface ExportImageAssetsResult {
  imageAssetMap: Record<string, string>;
  candidateCount: number;
  exportedCount: number;
  failedCount: number;
}

const MAX_IDS_PER_REQUEST = 100;

const waitFor = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const toRetryDelayMs = (attempt: number): number => {
  return Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const flattenElements = (elements: ScreenElementIR[]): ScreenElementIR[] => {
  const all: ScreenElementIR[] = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    all.push(current);
    if (Array.isArray(current.children) && current.children.length > 0) {
      stack.push(...current.children);
    }
  }
  return all;
};

const collectImageCandidates = (ir: DesignIR): ImageCandidate[] => {
  const byNodeId = new Map<string, ImageCandidate>();
  for (const screen of ir.screens) {
    const allNodes = flattenElements(screen.children);
    for (const node of allNodes) {
      if (node.type !== "image" || !node.id.trim()) {
        continue;
      }
      const format: ImageExportFormat = node.nodeType.toUpperCase() === "VECTOR" ? "svg" : "png";
      const existing = byNodeId.get(node.id);
      if (!existing) {
        byNodeId.set(node.id, {
          nodeId: node.id,
          format
        });
        continue;
      }
      if (existing.format === "png" && format === "svg") {
        byNodeId.set(node.id, {
          nodeId: node.id,
          format
        });
      }
    }
  }
  return [...byNodeId.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
};

const splitIntoBatches = <T>(items: T[], batchSize: number): T[][] => {
  if (items.length === 0) {
    return [];
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
};

const fetchWithToken = async ({
  fetchImpl,
  url,
  accessToken,
  timeoutMs
}: {
  fetchImpl: typeof fetch;
  url: string;
  accessToken: string;
  timeoutMs: number;
}): Promise<Response> => {
  const request = async (headers: Record<string, string>): Promise<Response> => {
    return await fetchImpl(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  };

  const firstResponse = await request({
    "X-Figma-Token": accessToken,
    Accept: "application/json"
  });
  if (firstResponse.status !== 403) {
    return firstResponse;
  }
  const bodyText = (await firstResponse.clone().text()).toLowerCase();
  if (!bodyText.includes("invalid token")) {
    return firstResponse;
  }
  return await request({
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  });
};

const fetchJsonWithRetries = async ({
  fetchImpl,
  url,
  accessToken,
  timeoutMs,
  maxRetries
}: {
  fetchImpl: typeof fetch;
  url: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
}): Promise<unknown> => {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchWithToken({
        fetchImpl,
        url,
        accessToken,
        timeoutMs
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          await waitFor(toRetryDelayMs(attempt));
          continue;
        }
        const failureBody = (await response.text()).slice(0, 240);
        throw new Error(`HTTP ${response.status}${failureBody ? ` (${failureBody})` : ""}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      await waitFor(toRetryDelayMs(attempt));
    }
  }

  throw new Error("request retries exhausted");
};

const fetchBinaryWithRetries = async ({
  fetchImpl,
  url,
  timeoutMs,
  maxRetries
}: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  maxRetries: number;
}): Promise<Uint8Array> => {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
          await waitFor(toRetryDelayMs(attempt));
          continue;
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (error) {
      if (attempt >= maxRetries) {
        throw error;
      }
      await waitFor(toRetryDelayMs(attempt));
    }
  }

  throw new Error("download retries exhausted");
};

const toDeterministicImageFileName = ({
  nodeId,
  format
}: {
  nodeId: string;
  format: ImageExportFormat;
}): string => {
  const stem = nodeId.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "image";
  const shortHash = createHash("sha256").update(nodeId).digest("hex").slice(0, 8);
  return `${stem}_${shortHash}.${format}`;
};

export const exportImageAssetsFromFigma = async ({
  fileKey,
  accessToken,
  ir,
  generatedProjectDir,
  fetchImpl,
  timeoutMs,
  maxRetries,
  onLog
}: ExportImageAssetsInput): Promise<ExportImageAssetsResult> => {
  const candidates = collectImageCandidates(ir);
  if (candidates.length === 0) {
    onLog("Image asset export: 0 image candidates in IR.");
    return {
      imageAssetMap: {},
      candidateCount: 0,
      exportedCount: 0,
      failedCount: 0
    };
  }

  const byFormat: Record<ImageExportFormat, ImageCandidate[]> = {
    png: [],
    svg: []
  };
  for (const candidate of candidates) {
    byFormat[candidate.format].push(candidate);
  }

  const imagesByNodeId = new Map<string, string>();
  let failedCount = 0;

  const exportDir = path.join(generatedProjectDir, "public", "images");
  await mkdir(exportDir, { recursive: true });

  for (const format of ["png", "svg"] as const) {
    const formatCandidates = byFormat[format];
    if (formatCandidates.length === 0) {
      continue;
    }

    const batches = splitIntoBatches(formatCandidates, MAX_IDS_PER_REQUEST);
    for (const batch of batches) {
      const ids = batch.map((candidate) => candidate.nodeId);
      const requestUrl = `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(ids.join(","))}&format=${format}`;

      let payload: unknown;
      try {
        payload = await fetchJsonWithRetries({
          fetchImpl,
          url: requestUrl,
          accessToken,
          timeoutMs,
          maxRetries
        });
      } catch (error) {
        failedCount += batch.length;
        onLog(
          `Image asset export warning: failed to resolve ${format.toUpperCase()} URLs for ${batch.length} node(s): ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
        continue;
      }

      const imageMapCandidate = isRecord(payload) && isRecord(payload.images) ? payload.images : undefined;
      if (!imageMapCandidate) {
        failedCount += batch.length;
        onLog(
          `Image asset export warning: /v1/images payload missing 'images' record for ${format.toUpperCase()} batch of ${batch.length} node(s).`
        );
        continue;
      }

      for (const candidate of batch) {
        const remoteUrlValue = imageMapCandidate[candidate.nodeId];
        if (typeof remoteUrlValue !== "string" || remoteUrlValue.trim().length === 0) {
          failedCount += 1;
          onLog(`Image asset export warning: no downloadable URL returned for node '${candidate.nodeId}'.`);
          continue;
        }

        let bytes: Uint8Array;
        try {
          bytes = await fetchBinaryWithRetries({
            fetchImpl,
            url: remoteUrlValue,
            timeoutMs,
            maxRetries
          });
        } catch (error) {
          failedCount += 1;
          onLog(
            `Image asset export warning: failed to download asset for node '${candidate.nodeId}': ${
              error instanceof Error ? error.message : "unknown error"
            }`
          );
          continue;
        }

        const fileName = toDeterministicImageFileName({
          nodeId: candidate.nodeId,
          format: candidate.format
        });
        const relativePath = path.posix.join("images", fileName);
        const absolutePath = path.join(exportDir, fileName);
        await writeFile(absolutePath, bytes);
        imagesByNodeId.set(candidate.nodeId, `/${relativePath}`);
      }
    }
  }

  const imageAssetMap = Object.fromEntries(
    [...imagesByNodeId.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
  const exportedCount = Object.keys(imageAssetMap).length;
  onLog(
    `Image asset export summary: candidates=${candidates.length}, exported=${exportedCount}, failed=${failedCount}.`
  );

  return {
    imageAssetMap,
    candidateCount: candidates.length,
    exportedCount,
    failedCount
  };
};
