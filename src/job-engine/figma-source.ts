import { createPipelineError, getErrorMessage } from "./errors.js";
import type { FigmaFetchResult, FigmaFileResponse } from "./types.js";

const MIN_SCREEN_WIDTH = 320;
const MIN_SCREEN_HEIGHT = 480;
const MAX_ERROR_BODY_CHARS = 500;
const MAX_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ICON_RECOVERY_DESCENDANTS = 160;
const ICON_RECOVERY_BATCH_SIZE = 20;
const MAX_ICON_RECOVERY_DIMENSION = 96;
const MAX_ICON_RECOVERY_AREA = MAX_ICON_RECOVERY_DIMENSION * MAX_ICON_RECOVERY_DIMENSION;

interface FigmaNodeLike {
  id?: string;
  type?: string;
  visible?: boolean;
  name?: string;
  children?: FigmaNodeLike[];
  absoluteBoundingBox?: {
    width?: number;
    height?: number;
  };
  [key: string]: unknown;
}

interface FigmaFileLike extends FigmaFileResponse {
  document?: FigmaNodeLike;
}

class FigmaTooLargeError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "FigmaTooLargeError";
    if (typeof status === "number") {
      this.status = status;
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseFigmaStatus = (status: number): { code: string; retryable: boolean } => {
  if (status === 401 || status === 403) {
    return { code: "E_FIGMA_AUTH", retryable: false };
  }
  if (status === 404) {
    return { code: "E_FIGMA_NOT_FOUND", retryable: false };
  }
  if (status === 429) {
    return { code: "E_FIGMA_RATE_LIMIT", retryable: true };
  }
  if (status >= 500) {
    return { code: "E_FIGMA_UPSTREAM", retryable: true };
  }
  return { code: "E_FIGMA_HTTP", retryable: false };
};

const waitFor = async (delayMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const fetchWithTimeout = async ({
  fetchImpl,
  url,
  headers,
  timeoutMs
}: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<Response> => {
  return await fetchImpl(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("timeout");
};

const toRetryDelay = ({ attempt }: { attempt: number }): number => {
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

const isTooLargeBody = (body: string): boolean => {
  const normalized = body.toLowerCase();
  return (
    normalized.includes("request too large") ||
    normalized.includes("payload too large") ||
    normalized.includes("entity too large") ||
    normalized.includes("too large")
  );
};

const isTooLargeParseError = (error: unknown): boolean => {
  const queue: unknown[] = [error];
  const visited = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof Error) {
      const normalized = current.message.toLowerCase();
      if (
        normalized.includes("err_string_too_long") ||
        normalized.includes("invalid string length") ||
        normalized.includes("cannot create a string longer")
      ) {
        return true;
      }
      const maybeWithCause = current as Error & { cause?: unknown };
      if (maybeWithCause.cause !== undefined) {
        queue.push(maybeWithCause.cause);
      }
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }
    if (typeof current.code === "string" && current.code.toLowerCase().includes("err_string_too_long")) {
      return true;
    }
    if (current.cause !== undefined) {
      queue.push(current.cause);
    }
  }

  return false;
};

const parseJsonWithByteLimit = async ({
  response,
  requestLabel,
  allowTooLargeFallback
}: {
  response: Response;
  requestLabel: string;
  allowTooLargeFallback: boolean;
}): Promise<unknown> => {
  const headerContainer = (response as Response & { headers?: { get?: (name: string) => string | null } }).headers;
  const contentLengthRaw = typeof headerContainer?.get === "function" ? headerContainer.get("content-length") : null;
  const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : Number.NaN;
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_RESPONSE_BYTES) {
    if (allowTooLargeFallback) {
      throw new FigmaTooLargeError(
        `Figma response body exceeds byte limit (${requestLabel}, content-length=${contentLength}).`
      );
    }
    throw createPipelineError({
      code: "E_FIGMA_PARSE",
      stage: "figma.source",
      message: `Figma response body exceeds byte limit (${requestLabel}, content-length=${contentLength}).`
    });
  }

  if (!response.body) {
    return await response.json();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
      await reader.cancel();
      if (allowTooLargeFallback) {
        throw new FigmaTooLargeError(
          `Figma response body exceeds byte limit (${requestLabel}, bytes=${totalBytes}).`
        );
      }
      throw createPipelineError({
        code: "E_FIGMA_PARSE",
        stage: "figma.source",
        message: `Figma response body exceeds byte limit (${requestLabel}, bytes=${totalBytes}).`
      });
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const rawText = new TextDecoder("utf-8").decode(merged);
  return JSON.parse(rawText);
};

const toRecordOrParseError = ({
  payload,
  requestLabel
}: {
  payload: unknown;
  requestLabel: string;
}): Record<string, unknown> => {
  if (isRecord(payload)) {
    return payload;
  }
  throw createPipelineError({
    code: "E_FIGMA_PARSE",
    stage: "figma.source",
    message: `Could not parse Figma API response (${requestLabel}): response is not an object.`
  });
};

const executeFigmaRequest = async ({
  url,
  requestLabel,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  allowTooLargeFallback
}: {
  url: string;
  requestLabel: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  allowTooLargeFallback: boolean;
}): Promise<unknown> => {
  const performRequest = async (headers: Record<string, string>): Promise<Response> => {
    return await fetchWithTimeout({
      fetchImpl,
      url,
      timeoutMs,
      headers
    });
  };

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await performRequest({
        "X-Figma-Token": accessToken,
        Accept: "application/json"
      });

      if (response.status === 403) {
        const bodyText = (await response.clone().text()).toLowerCase();
        if (bodyText.includes("invalid token")) {
          onLog("Figma PAT rejected, retrying request with Bearer authorization header.");
          response = await performRequest({
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          });
        }
      }
    } catch (error) {
      const shouldRetry = attempt < maxRetries;
      if (shouldRetry) {
        const delayMs = toRetryDelay({ attempt });
        onLog(
          `Figma request failed (${requestLabel}, ${isTimeoutError(error) ? "timeout" : "network"}), retrying in ${delayMs}ms (${attempt}/${maxRetries}).`
        );
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: isTimeoutError(error) ? "E_FIGMA_TIMEOUT" : "E_FIGMA_NETWORK",
        stage: "figma.source",
        message: `Figma REST request failed (${requestLabel}): ${getErrorMessage(error)}`,
        cause: error
      });
    }

    if (!response.ok) {
      const failureBodyRaw = await response.text();
      const failureBody = failureBodyRaw.slice(0, MAX_ERROR_BODY_CHARS);
      const isTooLarge =
        response.status === 413 || (response.status === 400 && isTooLargeBody(failureBodyRaw));
      if (allowTooLargeFallback && isTooLarge) {
        throw new FigmaTooLargeError(
          `Figma request too large (${requestLabel}, status=${response.status}).`,
          response.status
        );
      }

      const status = parseFigmaStatus(response.status);
      if (status.retryable && attempt < maxRetries) {
        const delayMs = toRetryDelay({ attempt });
        onLog(
          `Figma API responded ${response.status} (${requestLabel}), retrying in ${delayMs}ms (${attempt}/${maxRetries}).`
        );
        await waitFor(delayMs);
        continue;
      }
      throw createPipelineError({
        code: status.code,
        stage: "figma.source",
        message: `Figma API error (${response.status}) (${requestLabel}): ${failureBody || "no response body"}`
      });
    }

    try {
      return await parseJsonWithByteLimit({
        response,
        requestLabel,
        allowTooLargeFallback
      });
    } catch (error) {
      if (error instanceof FigmaTooLargeError) {
        throw error;
      }
      if (allowTooLargeFallback && isTooLargeParseError(error)) {
        throw new FigmaTooLargeError(`Figma response exceeded parser limits (${requestLabel}).`);
      }
      throw createPipelineError({
        code: "E_FIGMA_PARSE",
        stage: "figma.source",
        message: `Could not parse Figma API response (${requestLabel}): ${getErrorMessage(error)}`,
        cause: error
      });
    }
  }

  throw createPipelineError({
    code: "E_FIGMA_RETRY_EXHAUSTED",
    stage: "figma.source",
    message: `Figma REST retries exhausted (${requestLabel}).`
  });
};

const asNodeArray = (value: unknown): FigmaNodeLike[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => isRecord(entry)) as FigmaNodeLike[];
};

const isScreenCandidateType = (type: string | undefined): boolean => {
  return type === "FRAME" || type === "COMPONENT";
};

const hasScreenLikeSize = (node: FigmaNodeLike, requireMinSize: boolean): boolean => {
  if (!requireMinSize) {
    return true;
  }
  const width = node.absoluteBoundingBox?.width ?? 0;
  const height = node.absoluteBoundingBox?.height ?? 0;
  return width >= MIN_SCREEN_WIDTH && height >= MIN_SCREEN_HEIGHT;
};

const collectScreenCandidates = ({
  root,
  maxCandidates,
  requireMinSize
}: {
  root: FigmaNodeLike;
  maxCandidates: number;
  requireMinSize: boolean;
}): FigmaNodeLike[] => {
  const candidates: FigmaNodeLike[] = [];

  const visit = (node: FigmaNodeLike): void => {
    if (candidates.length >= maxCandidates) {
      return;
    }
    if (node.visible === false) {
      return;
    }

    const nodeType = String(node.type ?? "").toUpperCase();
    if (isScreenCandidateType(nodeType) && hasScreenLikeSize(node, requireMinSize)) {
      candidates.push(node);
      if (candidates.length >= maxCandidates) {
        return;
      }
    }

    if (
      nodeType === "DOCUMENT" ||
      nodeType === "CANVAS" ||
      nodeType === "PAGE" ||
      nodeType === "SECTION" ||
      nodeType === "FRAME" ||
      nodeType === "COMPONENT"
    ) {
      for (const child of asNodeArray(node.children)) {
        visit(child);
        if (candidates.length >= maxCandidates) {
          return;
        }
      }
    }
  };

  visit(root);
  return candidates;
};

const hasIconRecoveryName = (node: FigmaNodeLike): boolean => {
  const normalizedName = String(node.name ?? "").toLowerCase();
  return (
    normalizedName.startsWith("ic_") ||
    normalizedName.includes("iconcomponent") ||
    normalizedName.includes("muisvgiconroot")
  );
};

const hasRecoverableIconBounds = (node: FigmaNodeLike): boolean => {
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return false;
  }
  if (width <= 0 || height <= 0) {
    return false;
  }
  return width <= MAX_ICON_RECOVERY_DIMENSION && height <= MAX_ICON_RECOVERY_DIMENSION && width * height <= MAX_ICON_RECOVERY_AREA;
};

const collectRecoverableIconDescendantIds = ({
  root,
  maxCandidates
}: {
  root: FigmaNodeLike;
  maxCandidates: number;
}): string[] => {
  const collected: string[] = [];
  const seen = new Set<string>();

  const visit = (node: FigmaNodeLike, isRoot: boolean): void => {
    if (collected.length >= maxCandidates) {
      return;
    }
    if (node.visible === false) {
      return;
    }

    const nodeId = typeof node.id === "string" ? node.id : "";
    if (
      !isRoot &&
      nodeId.length > 0 &&
      !seen.has(nodeId) &&
      hasIconRecoveryName(node) &&
      hasRecoverableIconBounds(node)
    ) {
      seen.add(nodeId);
      collected.push(nodeId);
      if (collected.length >= maxCandidates) {
        return;
      }
    }

    for (const child of asNodeArray(node.children)) {
      visit(child, false);
      if (collected.length >= maxCandidates) {
        return;
      }
    }
  };

  visit(root, true);
  return collected;
};

const splitIntoBatches = (ids: string[], batchSize: number): string[][] => {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    batches.push(ids.slice(index, index + batchSize));
  }
  return batches;
};

const extractNodeDocuments = (payload: unknown): Map<string, FigmaNodeLike> => {
  const parsed = toRecordOrParseError({ payload, requestLabel: "nodes" });
  const rawNodes = parsed.nodes;
  if (!isRecord(rawNodes)) {
    return new Map<string, FigmaNodeLike>();
  }

  const documents = new Map<string, FigmaNodeLike>();
  for (const [id, value] of Object.entries(rawNodes)) {
    if (!isRecord(value) || !isRecord(value.document)) {
      continue;
    }
    documents.set(id, value.document as FigmaNodeLike);
  }

  return documents;
};

const mergeNodesIntoTree = ({
  node,
  replacementsById
}: {
  node: FigmaNodeLike;
  replacementsById: Map<string, FigmaNodeLike>;
}): FigmaNodeLike => {
  const replacement = typeof node.id === "string" ? replacementsById.get(node.id) : undefined;
  const source = replacement ?? node;
  const children = asNodeArray(source.children);
  if (children.length === 0) {
    return source;
  }
  return {
    ...source,
    children: children.map((child) => mergeNodesIntoTree({ node: child, replacementsById }))
  };
};

const buildNodesUrl = ({
  fileKey,
  ids,
  includeGeometry
}: {
  fileKey: string;
  ids: string[];
  includeGeometry: boolean;
}): string => {
  const idsParam = ids.map((id) => encodeURIComponent(id)).join(",");
  const geometryParam = includeGeometry ? "&geometry=paths" : "";
  return `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${idsParam}${geometryParam}`;
};

const fetchBootstrapFile = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  bootstrapDepth
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  bootstrapDepth: number;
}): Promise<FigmaFileLike> => {
  for (let depth = bootstrapDepth; depth >= 1; depth -= 1) {
    const bootstrapUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=${depth}`;
    try {
      const payload = await executeFigmaRequest({
        url: bootstrapUrl,
        requestLabel: `files depth=${depth}`,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        allowTooLargeFallback: true
      });
      return toRecordOrParseError({ payload, requestLabel: `files depth=${depth}` }) as FigmaFileLike;
    } catch (error) {
      if (error instanceof FigmaTooLargeError && depth > 1) {
        onLog(`Figma bootstrap depth ${depth} still too large, retrying with depth ${depth - 1}.`);
        continue;
      }
      throw error;
    }
  }

  throw createPipelineError({
    code: "E_FIGMA_HTTP",
    stage: "figma.source",
    message: "Figma bootstrap request failed: could not fetch even at depth=1."
  });
};

export const fetchFigmaFile = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  bootstrapDepth,
  nodeBatchSize,
  maxScreenCandidates
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  bootstrapDepth: number;
  nodeBatchSize: number;
  maxScreenCandidates: number;
}): Promise<FigmaFetchResult> => {
  const directUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?geometry=paths`;

  try {
    const payload = await executeFigmaRequest({
      url: directUrl,
      requestLabel: "files geometry=paths",
      accessToken,
      timeoutMs,
      maxRetries,
      fetchImpl,
      onLog,
      allowTooLargeFallback: true
    });

    return {
      file: toRecordOrParseError({ payload, requestLabel: "files geometry=paths" }) as FigmaFileResponse,
      diagnostics: {
        sourceMode: "geometry-paths",
        fetchedNodes: 0,
        degradedGeometryNodes: []
      }
    };
  } catch (error) {
    if (!(error instanceof FigmaTooLargeError)) {
      throw error;
    }
    onLog("Primary Figma fetch is too large; switching to staged node fetch.");
  }

  const bootstrapFile = await fetchBootstrapFile({
    fileKey,
    accessToken,
    timeoutMs,
    maxRetries,
    fetchImpl,
    onLog,
    bootstrapDepth
  });

  const rootNode = isRecord(bootstrapFile.document) ? (bootstrapFile.document as FigmaNodeLike) : undefined;
  if (!rootNode) {
    return {
      file: bootstrapFile,
      diagnostics: {
        sourceMode: "staged-nodes",
        fetchedNodes: 0,
        degradedGeometryNodes: []
      }
    };
  }

  const screenCandidatesWithSize = collectScreenCandidates({
    root: rootNode,
    maxCandidates: maxScreenCandidates,
    requireMinSize: true
  });
  const screenCandidates =
    screenCandidatesWithSize.length > 0
      ? screenCandidatesWithSize
      : collectScreenCandidates({
          root: rootNode,
          maxCandidates: maxScreenCandidates,
          requireMinSize: false
        });

  const candidateIds = screenCandidates
    .map((node) => (typeof node.id === "string" ? node.id : ""))
    .filter((id, index, values) => id.length > 0 && values.indexOf(id) === index)
    .slice(0, maxScreenCandidates);

  if (candidateIds.length === 0) {
    onLog("Staged fetch found no screen candidates; using bootstrap tree only.");
    return {
      file: bootstrapFile,
      diagnostics: {
        sourceMode: "staged-nodes",
        fetchedNodes: 0,
        degradedGeometryNodes: []
      }
    };
  }

  const replacementNodes = new Map<string, FigmaNodeLike>();
  const degradedGeometryNodes = new Set<string>();

  const recoverIconGeometryForFallback = async ({
    screenNodeId,
    fallbackNode
  }: {
    screenNodeId: string;
    fallbackNode: FigmaNodeLike;
  }): Promise<number> => {
    const recoverableDescendantIds = collectRecoverableIconDescendantIds({
      root: fallbackNode,
      maxCandidates: MAX_ICON_RECOVERY_DESCENDANTS
    });

    if (recoverableDescendantIds.length === 0) {
      return 0;
    }

    let recoveredCount = 0;

    const fetchIconGeometryGroup = async (ids: string[]): Promise<void> => {
      if (ids.length === 0) {
        return;
      }

      try {
        const payload = await executeFigmaRequest({
          url: buildNodesUrl({ fileKey, ids, includeGeometry: true }),
          requestLabel: `nodes icon-geometry (${screenNodeId}, ${ids.length})`,
          accessToken,
          timeoutMs,
          maxRetries,
          fetchImpl,
          onLog,
          allowTooLargeFallback: true
        });

        const documents = extractNodeDocuments(payload);
        for (const id of ids) {
          const node = documents.get(id);
          if (!node) {
            continue;
          }
          const alreadyPresent = replacementNodes.has(id);
          replacementNodes.set(id, node);
          if (!alreadyPresent) {
            recoveredCount += 1;
          }
        }
        return;
      } catch (error) {
        if (!(error instanceof FigmaTooLargeError)) {
          throw error;
        }
      }

      if (ids.length > 1) {
        const midpoint = Math.ceil(ids.length / 2);
        await fetchIconGeometryGroup(ids.slice(0, midpoint));
        await fetchIconGeometryGroup(ids.slice(midpoint));
        return;
      }

      const nodeId = ids[0];
      if (nodeId) {
        onLog(`Icon geometry recovery skipped for node '${nodeId}' after oversized geometry response.`);
      }
    };

    for (const batch of splitIntoBatches(recoverableDescendantIds, ICON_RECOVERY_BATCH_SIZE)) {
      await fetchIconGeometryGroup(batch);
    }

    return recoveredCount;
  };

  const fetchNodeGroup = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) {
      return;
    }

    try {
      const payload = await executeFigmaRequest({
        url: buildNodesUrl({ fileKey, ids, includeGeometry: true }),
        requestLabel: `nodes geometry (${ids.length})`,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        allowTooLargeFallback: true
      });

      const documents = extractNodeDocuments(payload);
      for (const id of ids) {
        const node = documents.get(id);
        if (node) {
          replacementNodes.set(id, node);
        }
      }
      return;
    } catch (error) {
      if (!(error instanceof FigmaTooLargeError)) {
        throw error;
      }

      if (ids.length > 1) {
        const midpoint = Math.ceil(ids.length / 2);
        await fetchNodeGroup(ids.slice(0, midpoint));
        await fetchNodeGroup(ids.slice(midpoint));
        return;
      }
    }

    const nodeId = ids[0];
    if (!nodeId) {
      return;
    }
    onLog(`Node '${nodeId}' is too large with geometry; retrying without geometry.`);

    try {
      const payload = await executeFigmaRequest({
        url: buildNodesUrl({ fileKey, ids: [nodeId], includeGeometry: false }),
        requestLabel: `nodes no-geometry (${nodeId})`,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        allowTooLargeFallback: false
      });
      const documents = extractNodeDocuments(payload);
      const fallbackNode = documents.get(nodeId);
      if (fallbackNode) {
        replacementNodes.set(nodeId, fallbackNode);
        try {
          const recoveredCount = await recoverIconGeometryForFallback({
            screenNodeId: nodeId,
            fallbackNode
          });
          if (recoveredCount > 0) {
            onLog(`Recovered geometry for ${recoveredCount} icon descendants under node '${nodeId}'.`);
          }
        } catch (error) {
          onLog(`Icon geometry recovery failed for node '${nodeId}': ${getErrorMessage(error)}`);
        }
      }
      degradedGeometryNodes.add(nodeId);
    } catch {
      degradedGeometryNodes.add(nodeId);
      onLog(`Node '${nodeId}' could not be fetched without geometry; keeping bootstrap node.`);
    }
  };

  for (const batch of splitIntoBatches(candidateIds, nodeBatchSize)) {
    await fetchNodeGroup(batch);
  }

  const mergedRoot = mergeNodesIntoTree({
    node: rootNode,
    replacementsById: replacementNodes
  });

  return {
    file: {
      ...bootstrapFile,
      document: mergedRoot
    },
    diagnostics: {
      sourceMode: "staged-nodes",
      fetchedNodes: replacementNodes.size,
      degradedGeometryNodes: [...degradedGeometryNodes].sort((left, right) => left.localeCompare(right))
    }
  };
};
