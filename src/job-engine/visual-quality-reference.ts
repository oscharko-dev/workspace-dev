import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceVisualQualityFrozenReference,
  WorkspaceVisualReferenceFixtureMetadata
} from "../contracts/index.js";
import { isWithinRoot } from "./preview.js";

type FetchLike = typeof fetch;

export interface VisualQualityReferenceNodeCandidate {
  nodeId: string;
  nodeName: string;
  width: number;
  height: number;
}

export interface FigmaVisualReferenceResult {
  buffer: Buffer;
  metadata: WorkspaceVisualReferenceFixtureMetadata;
}

export interface FrozenVisualReferenceResult {
  buffer: Buffer;
  metadata: WorkspaceVisualReferenceFixtureMetadata;
  imagePath: string;
  metadataPath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isPositiveNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
};

const readRequiredString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
};

const readPositiveNumber = (value: unknown, fieldName: string): number => {
  if (!isPositiveNumber(value)) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return value;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const isValidPngBuffer = (buffer: Buffer): boolean => {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
};

export const parsePngDimensions = (buffer: Buffer): { width: number; height: number } => {
  const IHDR_OFFSET = 12;
  const WIDTH_OFFSET = 16;
  const HEIGHT_OFFSET = 20;
  if (!isValidPngBuffer(buffer) || buffer.length < 24) {
    throw new Error("Expected a valid PNG buffer.");
  }
  const chunkType = buffer.subarray(IHDR_OFFSET, WIDTH_OFFSET).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error("PNG buffer is missing the IHDR chunk.");
  }
  return {
    width: buffer.readUInt32BE(WIDTH_OFFSET),
    height: buffer.readUInt32BE(HEIGHT_OFFSET)
  };
};

const fetchWithRetry = async ({
  url,
  headers,
  fetchImpl,
  maxRetries,
  onLog
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
        onLog?.(`Visual quality reference fetch retry ${String(attempt + 1)}/${String(maxRetries)} after ${String(response.status)}.`);
        continue;
      }
      throw new Error(`Figma API request failed with ${String(response.status)} ${response.statusText}.`);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        onLog?.(`Visual quality reference fetch retry ${String(attempt + 1)}/${String(maxRetries)} after transport error.`);
        continue;
      }
    }
  }
  throw lastError;
};

const buildNodeUrl = ({ fileKey, nodeId }: { fileKey: string; nodeId: string }): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    geometry: "paths"
  });
  return `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`;
};

const buildImageUrl = ({
  fileKey,
  nodeId,
  scale
}: {
  fileKey: string;
  nodeId: string;
  scale: number;
}): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    format: "png",
    scale: String(scale)
  });
  return `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${params.toString()}`;
};

export const extractTopLevelFrameCandidates = ({
  file
}: {
  file: unknown;
}): VisualQualityReferenceNodeCandidate[] => {
  if (!isRecord(file) || !isRecord(file.document) || !Array.isArray(file.document.children)) {
    return [];
  }

  const candidates: VisualQualityReferenceNodeCandidate[] = [];
  for (const page of file.document.children) {
    if (!isRecord(page) || !Array.isArray(page.children)) {
      continue;
    }
    for (const child of page.children) {
      if (!isRecord(child)) {
        continue;
      }
      if (child.type !== "FRAME" && child.type !== "SECTION") {
        continue;
      }
      const absoluteBoundingBox = child.absoluteBoundingBox;
      if (!isRecord(absoluteBoundingBox)) {
        continue;
      }
      const width = Number(absoluteBoundingBox.width);
      const height = Number(absoluteBoundingBox.height);
      if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
        continue;
      }
      const nodeId = typeof child.id === "string" ? child.id.trim() : "";
      const nodeName = typeof child.name === "string" ? child.name.trim() : "";
      if (nodeId.length === 0 || nodeName.length === 0) {
        continue;
      }
      candidates.push({
        nodeId,
        nodeName,
        width: Math.round(width),
        height: Math.round(height)
      });
    }
  }

  return candidates;
};

export const selectVisualQualityReferenceNode = ({
  file,
  preferredNamePattern
}: {
  file: unknown;
  preferredNamePattern?: string;
}): VisualQualityReferenceNodeCandidate => {
  const candidates = extractTopLevelFrameCandidates({ file });
  if (candidates.length === 0) {
    throw new Error("No top-level frame candidates were found for visual quality validation.");
  }

  const normalizedPattern = preferredNamePattern?.trim().toLowerCase();
  const rankedCandidates = [...candidates].sort((left, right) => {
    const leftMatches = normalizedPattern ? left.nodeName.toLowerCase().includes(normalizedPattern) : false;
    const rightMatches = normalizedPattern ? right.nodeName.toLowerCase().includes(normalizedPattern) : false;
    if (leftMatches !== rightMatches) {
      return leftMatches ? -1 : 1;
    }
    const leftArea = left.width * left.height;
    const rightArea = right.width * right.height;
    if (leftArea !== rightArea) {
      return rightArea - leftArea;
    }
    return left.nodeName.localeCompare(right.nodeName);
  });

  return rankedCandidates[0]!;
};

export const fetchFigmaVisualReference = async ({
  fileKey,
  nodeId,
  accessToken,
  desiredWidth,
  fetchImpl = fetch,
  maxRetries = 3,
  onLog
}: {
  fileKey: string;
  nodeId: string;
  accessToken: string;
  desiredWidth: number;
  fetchImpl?: FetchLike;
  maxRetries?: number;
  onLog?: (message: string) => void;
}): Promise<FigmaVisualReferenceResult> => {
  const nodeResponse = await fetchWithRetry({
    url: buildNodeUrl({ fileKey, nodeId }),
    headers: { "X-Figma-Token": accessToken },
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {})
  });
  const nodePayload = await nodeResponse.json() as unknown;
  if (!isRecord(nodePayload)) {
    throw new Error("Expected Figma node payload to be an object.");
  }
  const lastModified = readRequiredString(nodePayload.lastModified, "Figma node payload lastModified");
  const nodes = nodePayload.nodes;
  if (!isRecord(nodes)) {
    throw new Error("Figma node payload must contain a nodes map.");
  }
  const nodeEntry = nodes[nodeId];
  if (!isRecord(nodeEntry) || !isRecord(nodeEntry.document)) {
    throw new Error(`Figma node payload does not contain a document for '${nodeId}'.`);
  }
  const document = nodeEntry.document;
  const absoluteBoundingBox = document.absoluteBoundingBox;
  if (!isRecord(absoluteBoundingBox)) {
    throw new Error(`Figma node '${nodeId}' is missing absoluteBoundingBox.`);
  }

  const sourceWidth = readPositiveNumber(absoluteBoundingBox.width, `Figma node '${nodeId}' absoluteBoundingBox.width`);
  readPositiveNumber(absoluteBoundingBox.height, `Figma node '${nodeId}' absoluteBoundingBox.height`);
  const scale = desiredWidth / sourceWidth;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Could not derive a valid Figma export scale for node '${nodeId}'.`);
  }

  const imageLookupResponse = await fetchWithRetry({
    url: buildImageUrl({ fileKey, nodeId, scale }),
    headers: { "X-Figma-Token": accessToken },
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {})
  });
  const imageLookup = await imageLookupResponse.json() as unknown;
  if (!isRecord(imageLookup) || !isRecord(imageLookup.images)) {
    throw new Error("Figma image response must contain an images map.");
  }
  const imageUrl = imageLookup.images[nodeId];
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    throw new Error(`Figma image export returned no renderable image for node '${nodeId}'.`);
  }

  const imageResponse = await fetchWithRetry({
    url: imageUrl,
    headers: {},
    fetchImpl,
    maxRetries,
    ...(onLog ? { onLog } : {})
  });
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Figma image export for node '${nodeId}' returned an invalid PNG.`);
  }

  const imageDimensions = parsePngDimensions(buffer);
  return {
    buffer,
    metadata: {
      capturedAt: new Date().toISOString(),
      source: {
        fileKey,
        nodeId,
        nodeName: readRequiredString(document.name, `Figma node '${nodeId}' name`),
        lastModified
      },
      viewport: {
        width: imageDimensions.width,
        height: imageDimensions.height
      }
    }
  };
};

const readVisualReferenceMetadata = async ({
  metadataPath
}: {
  metadataPath: string;
}): Promise<WorkspaceVisualReferenceFixtureMetadata> => {
  const parsed = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.source) || !isRecord(parsed.viewport)) {
    throw new Error(`Visual quality reference metadata '${metadataPath}' is invalid.`);
  }
  return {
    capturedAt: readRequiredString(parsed.capturedAt, "visual quality reference metadata capturedAt"),
    source: {
      fileKey: readRequiredString(parsed.source.fileKey, "visual quality reference metadata source.fileKey"),
      nodeId: readRequiredString(parsed.source.nodeId, "visual quality reference metadata source.nodeId"),
      nodeName: readRequiredString(parsed.source.nodeName, "visual quality reference metadata source.nodeName"),
      lastModified: readRequiredString(parsed.source.lastModified, "visual quality reference metadata source.lastModified")
    },
    viewport: {
      width: Math.round(readPositiveNumber(parsed.viewport.width, "visual quality reference metadata viewport.width")),
      height: Math.round(readPositiveNumber(parsed.viewport.height, "visual quality reference metadata viewport.height"))
    }
  };
};

export const loadFrozenVisualReference = async ({
  imagePath,
  metadataPath
}: {
  imagePath: string;
  metadataPath: string;
}): Promise<FrozenVisualReferenceResult> => {
  const [buffer, metadata] = await Promise.all([
    readFile(imagePath),
    readVisualReferenceMetadata({ metadataPath })
  ]);
  if (!isValidPngBuffer(buffer)) {
    throw new Error(`Frozen visual quality reference '${imagePath}' is not a valid PNG.`);
  }
  return {
    buffer,
    metadata,
    imagePath,
    metadataPath
  };
};

const resolveFrozenReferenceOverridePath = ({
  fixtureRoot,
  candidatePath,
  fieldName
}: {
  fixtureRoot: string;
  candidatePath: string;
  fieldName: string;
}): string => {
  const normalizedPath = readRequiredString(candidatePath, fieldName);
  const resolvedPath = path.isAbsolute(normalizedPath)
    ? path.resolve(normalizedPath)
    : path.resolve(fixtureRoot, normalizedPath);
  if (!isWithinRoot({ candidatePath: resolvedPath, rootPath: fixtureRoot })) {
    throw new Error(`${fieldName} must resolve within fixture root '${fixtureRoot}'.`);
  }
  return resolvedPath;
};

export const resolveVisualQualityFrozenReferencePaths = ({
  fixtureRoot,
  frozenReference
}: {
  fixtureRoot: string;
  frozenReference: WorkspaceVisualQualityFrozenReference;
}): {
  imagePath: string;
  metadataPath: string;
} => {
  return {
    imagePath: resolveFrozenReferenceOverridePath({
      fixtureRoot,
      candidatePath: frozenReference.imagePath,
      fieldName: "visualQualityFrozenReference.imagePath"
    }),
    metadataPath: resolveFrozenReferenceOverridePath({
      fixtureRoot,
      candidatePath: frozenReference.metadataPath,
      fieldName: "visualQualityFrozenReference.metadataPath"
    })
  };
};

export const findVisualQualityFixtureManifest = async ({
  workspaceRoot,
  inputPaths
}: {
  workspaceRoot: string;
  inputPaths: string[];
}): Promise<{
  fixtureRoot: string;
  frozenReferenceImage: string;
  frozenReferenceMetadata: string;
} | undefined> => {
  const visited = new Set<string>();
  for (const inputPath of inputPaths) {
    const resolvedInputPath = path.resolve(workspaceRoot, inputPath);
    let currentDir = path.dirname(resolvedInputPath);
    while (true) {
      if (visited.has(currentDir)) {
        break;
      }
      visited.add(currentDir);
      const manifestPath = path.join(currentDir, "manifest.json");
      try {
        await access(manifestPath);
      } catch {
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          break;
        }
        currentDir = parentDir;
        continue;
      }

      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (!isRecord(manifest) || !isRecord(manifest.visualQuality)) {
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          break;
        }
        currentDir = parentDir;
        continue;
      }

      const frozenReferenceImage = readRequiredString(
        manifest.visualQuality.frozenReferenceImage,
        "customer fixture visualQuality.frozenReferenceImage"
      );
      const frozenReferenceMetadata = readRequiredString(
        manifest.visualQuality.frozenReferenceMetadata,
        "customer fixture visualQuality.frozenReferenceMetadata"
      );
      return {
        fixtureRoot: currentDir,
        frozenReferenceImage,
        frozenReferenceMetadata
      };
    }
  }
  return undefined;
};
