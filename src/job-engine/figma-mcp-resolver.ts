import type { FigmaMcpAuthMode } from "../parity/types-core.js";
import {
  createPipelineError,
  getErrorMessage,
  type PipelineDiagnosticLimits,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MCP_SERVER_URL = "https://mcp.figma.com/mcp";
const ADAPTIVE_NODE_THRESHOLD = 50;
const MAX_SUBTREE_BATCH_SIZE = 5;
const STAGE = "figma.source" as const;
const CACHE_TTL_MS: number = 5 * 60_000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  context: FigmaDesignContext;
  expiresAt: number;
}

const resolverCache = new Map<string, CacheEntry>();
const inflightResolverCache = new Map<string, Promise<FigmaDesignContext>>();

const getCacheKey = (
  fileKey: string,
  nodeId: string,
  version?: string,
): string => `${fileKey}:${nodeId}:${version?.trim() || "current"}`;

export const clearResolverCache = (): void => {
  resolverCache.clear();
  inflightResolverCache.clear();
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FigmaMeta {
  fileKey: string;
  nodeId?: string;
  pasteID?: number;
  dataType?: string;
  version?: string;
}

export interface FigmaDesignContext {
  code: string;
  assets: Record<string, string>;
  screenshot?: string;
  metadata?: FigmaNodeMetadata;
  fileKey: string;
  nodeId: string;
  resolvedAt: string;
  diagnostics?: McpResolverDiagnostic[];
}

export interface FigmaNodeMetadata {
  xml: string;
  nodeCount: number;
  rootNodeType: string;
  rootNodeName: string;
}

export interface ResolverOptions {
  signal?: AbortSignal;
  skipScreenshot?: boolean;
  forceRefresh?: boolean;
  maxDepth?: number;
}

export interface McpResolverDiagnostic {
  code: string;
  message: string;
  severity: "info" | "warning";
}

export interface McpResolverConfig {
  serverUrl: string;
  accessToken: string;
  authMode: FigmaMcpAuthMode;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
  onLog?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const toRetryDelay = ({ attempt }: { attempt: number }): number => {
  const base = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
};

const waitFor = async (
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    return;
  }

  if (signal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
};

const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.max(0, Math.trunc(asSeconds * 1_000));
  }
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) {
    return undefined;
  }
  return Math.max(0, asDate - Date.now());
};

const isAbortError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("name" in error && error.name === "AbortError") {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted");
};

const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  if ("name" in error && error.name === "TimeoutError") {
    return true;
  }
  return error.message.toLowerCase().includes("timeout");
};

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
};

const buildSignal = (
  timeoutMs: number,
  external?: AbortSignal,
): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(Math.max(1, timeoutMs));
  return external ? AbortSignal.any([external, timeoutSignal]) : timeoutSignal;
};

/**
 * Wraps `limits` for `createPipelineError` so that `undefined` is never
 * passed to the optional `limits` property under `exactOptionalPropertyTypes`.
 */
const limitsArg = (
  limits: PipelineDiagnosticLimits | undefined,
): { limits: PipelineDiagnosticLimits } | Record<string, never> =>
  limits ? { limits } : {};

// ---------------------------------------------------------------------------
// MCP response shape (internal)
// ---------------------------------------------------------------------------

interface McpToolResponse {
  result?: unknown;
  error?: { message?: string; code?: number };
}

// ---------------------------------------------------------------------------
// MCP tool call arguments
// ---------------------------------------------------------------------------

type McpToolArgs = Record<string, unknown>;

// ---------------------------------------------------------------------------
// MCP tool result shapes (internal)
// ---------------------------------------------------------------------------

interface DesignContextResult {
  code?: string;
  assets?: Record<string, string>;
}

interface MetadataResult {
  xml?: string;
}

interface ScreenshotResult {
  url?: string;
}

interface MetadataNodeCandidate {
  id: string;
  type: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Error classification helpers
// ---------------------------------------------------------------------------

const classifyHttpStatus = (status: number): string => {
  if (status === 400) {
    return "E_MCP_INVALID_REQUEST";
  }
  if (status === 401 || status === 403) {
    return "E_MCP_AUTH";
  }
  if (status === 404) {
    return "E_MCP_NOT_FOUND";
  }
  if (status === 429) {
    return "E_MCP_RATE_LIMIT";
  }
  return "E_MCP_SERVER_ERROR";
};

const isRetryableStatus = (status: number): boolean =>
  status === 429 || status >= 500;

const isPipelineError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  typeof (error as Record<string, unknown>).code === "string" &&
  (error as Record<string, unknown>).stage === STAGE;

const isRetryablePipelineCode = (code: string): boolean =>
  code === "E_MCP_RATE_LIMIT" || code === "E_MCP_SERVER_ERROR";

// ---------------------------------------------------------------------------
// parseMcpResponse — extract result from MCP JSON envelope
// ---------------------------------------------------------------------------

const parseMcpResponse = ({
  response,
  toolName,
  limits,
}: {
  response: Response;
  toolName: string;
  limits: { limits: PipelineDiagnosticLimits } | Record<string, never>;
}): Promise<unknown> =>
  response
    .json()
    .then((parsed: unknown) => {
      const mcpResponse = parsed as McpToolResponse;
      if (mcpResponse.error) {
        throw createPipelineError({
          code: "E_MCP_SERVER_ERROR",
          stage: STAGE,
          message: `MCP ${toolName} error: ${mcpResponse.error.message ?? "unknown"}`,
          ...limits,
        });
      }
      return mcpResponse.result;
    })
    .catch((jsonError: unknown) => {
      if (isPipelineError(jsonError)) {
        throw jsonError;
      }
      throw createPipelineError({
        code: "E_MCP_SERVER_ERROR",
        stage: STAGE,
        message: `MCP ${toolName} returned invalid JSON: ${getErrorMessage(jsonError)}`,
        cause: jsonError,
        ...limits,
      });
    });

// ---------------------------------------------------------------------------
// classifyCatchError — wrap non-pipeline errors for retry logic
// ---------------------------------------------------------------------------

const classifyCatchError = ({
  error,
  toolName,
  timeoutMs,
  signal,
  limits,
}: {
  error: unknown;
  toolName: string;
  timeoutMs: number;
  signal?: AbortSignal;
  limits: { limits: PipelineDiagnosticLimits } | Record<string, never>;
}): { wrapped: Error; retryable: boolean } => {
  if (isPipelineError(error)) {
    const code = (error as Record<string, unknown>).code as string;
    return {
      wrapped: error as Error,
      retryable: isRetryablePipelineCode(code),
    };
  }
  if (signal?.aborted || isAbortError(error)) {
    return {
      wrapped: createPipelineError({
        code: "E_MCP_ABORTED",
        stage: STAGE,
        message: `MCP ${toolName} aborted`,
        cause: error,
        ...limits,
      }),
      retryable: false,
    };
  }
  if (isTimeoutError(error)) {
    return {
      wrapped: createPipelineError({
        code: "E_MCP_TIMEOUT",
        stage: STAGE,
        message: `MCP ${toolName} timed out after ${String(timeoutMs)}ms`,
        cause: error,
        ...limits,
      }),
      retryable: true,
    };
  }
  return {
    wrapped: createPipelineError({
      code: "E_MCP_NETWORK",
      stage: STAGE,
      message: `MCP ${toolName} network error: ${getErrorMessage(error)}`,
      cause: error,
      ...limits,
    }),
    retryable: true,
  };
};

// ---------------------------------------------------------------------------
// callMcpTool — low-level MCP call with retries
// ---------------------------------------------------------------------------

const callMcpTool = async ({
  toolName,
  args,
  config,
  signal,
  diagnostics,
}: {
  toolName: string;
  args: McpToolArgs;
  config: McpResolverConfig;
  signal?: AbortSignal;
  diagnostics?: McpResolverDiagnostic[];
}): Promise<unknown> => {
  const { serverUrl, accessToken, fetchImpl, timeoutMs, maxRetries, onLog } =
    config;
  const limits = limitsArg(config.pipelineDiagnosticLimits);

  if (!serverUrl) {
    throw createPipelineError({
      code: "E_MCP_NO_SERVER",
      stage: STAGE,
      message: "MCP server URL is not configured",
      ...limits,
    });
  }

  if (
    !serverUrl.startsWith("https://") &&
    !serverUrl.startsWith("http://127.0.0.1") &&
    !serverUrl.startsWith("http://localhost")
  ) {
    throw createPipelineError({
      code: "E_MCP_NO_SERVER",
      stage: STAGE,
      message: `MCP server URL must use HTTPS or localhost. Got: ${serverUrl.split("//")[0] ?? "unknown"}://...`,
      ...limits,
    });
  }

  const body = JSON.stringify({
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    try {
      const combinedSignal = buildSignal(timeoutMs, signal);
      onLog?.(`MCP call ${toolName} attempt ${String(attempt)}`);

      const response = await fetchImpl(serverUrl, {
        method: "POST",
        headers,
        body,
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorCode = classifyHttpStatus(response.status);
        const actionHint =
          response.status === 400
            ? " The file key may be invalid or expired — try re-copying from Figma."
            : response.status === 403
              ? " Check your Figma access permissions."
              : "";
        if (response.status === 429) {
          diagnostics?.push({
            code: "W_MCP_RATE_LIMITED",
            message: `MCP ${toolName} rate limited (attempt ${String(attempt)}/${String(maxRetries)})`,
            severity: "warning",
          });
        }
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          onLog?.(
            `MCP ${toolName} returned ${String(response.status)}, retrying`,
          );
          lastError = createPipelineError({
            code: errorCode,
            stage: STAGE,
            message: `MCP ${toolName} returned HTTP ${String(response.status)}${actionHint}`,
            ...limits,
          });
          await waitFor(toRetryDelay({ attempt }), signal);
          continue;
        }
        throw createPipelineError({
          code: errorCode,
          stage: STAGE,
          message: `MCP ${toolName} failed with HTTP ${String(response.status)}${actionHint}`,
          ...limits,
        });
      }

      return await parseMcpResponse({ response, toolName, limits });
    } catch (error: unknown) {
      const classified = classifyCatchError({
        error,
        toolName,
        timeoutMs,
        ...(signal ? { signal } : {}),
        limits,
      });
      lastError = classified.wrapped;
      if (!classified.retryable || attempt >= maxRetries) {
        throw classified.wrapped;
      }
      await waitFor(toRetryDelay({ attempt }), signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : createPipelineError({
        code: "E_MCP_NETWORK",
        stage: STAGE,
        message: `MCP ${toolName} failed after ${String(maxRetries)} attempts`,
        ...limitsArg(config.pipelineDiagnosticLimits),
      });
};

// ---------------------------------------------------------------------------
// XML parsing helpers
// ---------------------------------------------------------------------------

const estimateNodeCount = (xml: string): number => {
  let count = 0;
  let index = 0;
  while (index < xml.length) {
    const openPos = xml.indexOf("<", index);
    if (openPos === -1) {
      break;
    }
    const nextChar = xml[openPos + 1];
    if (nextChar !== "/" && nextChar !== "!" && nextChar !== "?") {
      count += 1;
    }
    index = openPos + 1;
  }
  return count;
};

const extractRootNodeInfo = (
  xml: string,
): { rootNodeType: string; rootNodeName: string } => {
  const match = /<(\w+)\s[^>]*name="([^"]*)"/.exec(xml);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return { rootNodeType: match[1], rootNodeName: match[2] };
  }
  const tagMatch = /<(\w+)/.exec(xml);
  return {
    rootNodeType: tagMatch?.[1] ?? "unknown",
    rootNodeName: "unnamed",
  };
};

const extractFirstFrameNodeId = (xml: string): string | undefined => {
  const framePattern = /<(?:FRAME|COMPONENT|COMPONENT_SET)\s[^>]*id="([^"]+)"/i;
  const match = framePattern.exec(xml);
  return match?.[1];
};

const extractChildSubtreeIds = (xml: string): string[] => {
  const ids: string[] = [];
  const pattern =
    /<(?:FRAME|COMPONENT|COMPONENT_SET|GROUP|SECTION)\s[^>]*id="([^"]+)"/gi;
  let match = pattern.exec(xml);
  while (match !== null) {
    if (match[1] !== undefined) {
      ids.push(match[1]);
    }
    if (ids.length >= MAX_SUBTREE_BATCH_SIZE) {
      break;
    }
    match = pattern.exec(xml);
  }
  return ids;
};

const extractMetadataNodeCandidates = (
  xml: string,
): MetadataNodeCandidate[] => {
  const candidates: MetadataNodeCandidate[] = [];
  const pattern = /<([A-Z_]+)\s([^>]*)>/gi;
  let match = pattern.exec(xml);
  while (match !== null) {
    const type = match[1]?.trim();
    const attributes = match[2] ?? "";
    const idMatch = /\bid="([^"]+)"/i.exec(attributes);
    if (!type || !idMatch?.[1]) {
      match = pattern.exec(xml);
      continue;
    }
    const nameMatch = /\bname="([^"]*)"/i.exec(attributes);
    candidates.push({
      id: idMatch[1],
      type,
      ...(nameMatch?.[1] !== undefined ? { name: nameMatch[1] } : {}),
    });
    match = pattern.exec(xml);
  }
  return candidates;
};

const normalizeMetadataComparable = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const isPrimaryMcpNodeType = (value: unknown): boolean =>
  value === "FRAME" ||
  value === "COMPONENT" ||
  value === "COMPONENT_SET" ||
  value === "SECTION" ||
  value === "GROUP";

const resolvePreferredNodeTypes = (
  dataType: string | undefined,
): readonly string[] => {
  const normalized = normalizeMetadataComparable(dataType ?? "");
  if (normalized === "COMPONENT_SET") {
    return ["COMPONENT_SET"];
  }
  if (normalized === "COMPONENT") {
    return ["COMPONENT", "INSTANCE"];
  }
  if (normalized === "INSTANCE") {
    return ["INSTANCE", "COMPONENT"];
  }
  if (normalized === "SCENE") {
    return ["FRAME", "SECTION", "GROUP", "COMPONENT", "COMPONENT_SET"];
  }
  return [];
};

const matchesPasteIdHint = ({
  nodeId,
  pasteID,
}: {
  nodeId: string;
  pasteID: number | undefined;
}): boolean => {
  if (!Number.isInteger(pasteID)) {
    return false;
  }
  const target = String(pasteID);
  return nodeId
    .split(/[:-]/)
    .map((segment) => segment.trim())
    .some((segment) => segment === target);
};

const resolveNodeIdFromMetadataCandidates = ({
  candidates,
  meta,
}: {
  candidates: readonly MetadataNodeCandidate[];
  meta: FigmaMeta;
}): { nodeId?: string; reason?: string } => {
  const primaryCandidates = candidates.filter((candidate) =>
    isPrimaryMcpNodeType(candidate.type),
  );
  const preferredNodeTypes = resolvePreferredNodeTypes(meta.dataType);

  if (meta.pasteID !== undefined) {
    const pasteMatches = primaryCandidates.filter((candidate) =>
      matchesPasteIdHint({ nodeId: candidate.id, pasteID: meta.pasteID }),
    );
    const preferredPasteMatch =
      pasteMatches.find((candidate) =>
        preferredNodeTypes.includes(normalizeMetadataComparable(candidate.type)),
      ) ?? pasteMatches[0];
    if (preferredPasteMatch) {
      return {
        nodeId: preferredPasteMatch.id,
        reason:
          preferredNodeTypes.length > 0
            ? "metadata pasteID + dataType hint"
            : "metadata pasteID hint",
      };
    }
  }

  if (preferredNodeTypes.length > 0) {
    const preferredCandidate = primaryCandidates.find((candidate) =>
      preferredNodeTypes.includes(normalizeMetadataComparable(candidate.type)),
    );
    if (preferredCandidate) {
      return {
        nodeId: preferredCandidate.id,
        reason: "metadata dataType hint",
      };
    }
  }

  if (primaryCandidates[0]) {
    return {
      nodeId: primaryCandidates[0].id,
      reason: "metadata primary-node fallback",
    };
  }

  return {};
};

// ---------------------------------------------------------------------------
// resolveNodeId
// ---------------------------------------------------------------------------

const resolveNodeId = async (
  meta: FigmaMeta,
  config: McpResolverConfig,
  signal?: AbortSignal,
): Promise<string> => {
  throwIfAborted(signal);

  if (meta.nodeId && meta.nodeId.length > 0) {
    return meta.nodeId;
  }

  config.onLog?.("No nodeId provided, scanning root for first frame");

  try {
    const result = await callMcpTool({
      toolName: "get_metadata",
      args: { fileKey: meta.fileKey, nodeId: "0:1" },
      config,
      ...(signal ? { signal } : {}),
    });

    const metadataResult = result as MetadataResult | null | undefined;
    if (metadataResult?.xml) {
      const candidates = extractMetadataNodeCandidates(metadataResult.xml);
      const resolvedFromMetadata = resolveNodeIdFromMetadataCandidates({
        candidates,
        meta,
      });
      if (resolvedFromMetadata.nodeId) {
        config.onLog?.(
          `Resolved root nodeId from ${resolvedFromMetadata.reason ?? "metadata"}: ${resolvedFromMetadata.nodeId}`,
        );
        return resolvedFromMetadata.nodeId;
      }

      const frameNodeId = extractFirstFrameNodeId(metadataResult.xml);
      if (frameNodeId) {
        config.onLog?.(
          `Resolved root frame nodeId via legacy fallback: ${frameNodeId}`,
        );
        return frameNodeId;
      }
    }
  } catch (error: unknown) {
    if (signal?.aborted || isAbortError(error)) {
      throw error;
    }
    config.onLog?.(
      `Failed to resolve nodeId from root metadata: ${getErrorMessage(error)}`,
    );
  }

  config.onLog?.("Falling back to document root 0:1");
  return "0:1";
};

// ---------------------------------------------------------------------------
// Adaptive design context fetching
// ---------------------------------------------------------------------------

const fetchDesignContextSingle = async (
  fileKey: string,
  nodeId: string,
  config: McpResolverConfig,
  signal?: AbortSignal,
  diagnostics?: McpResolverDiagnostic[],
): Promise<DesignContextResult> => {
  const result = await callMcpTool({
    toolName: "get_design_context",
    args: { fileKey, nodeId },
    config,
    ...(signal ? { signal } : {}),
    ...(diagnostics ? { diagnostics } : {}),
  });
  return (result ?? { code: "", assets: {} }) as DesignContextResult;
};

const mergeDesignContextResults = (
  results: readonly DesignContextResult[],
): DesignContextResult => {
  const codeParts: string[] = [];
  const mergedAssets: Record<string, string> = {};

  for (const entry of results) {
    if (entry.code) {
      codeParts.push(entry.code);
    }
    if (entry.assets) {
      for (const [key, value] of Object.entries(entry.assets)) {
        mergedAssets[key] = value;
      }
    }
  }

  return {
    code: codeParts.join("\n"),
    assets: mergedAssets,
  };
};

const fetchDesignContextAdaptive = async (
  fileKey: string,
  nodeId: string,
  xml: string,
  nodeCount: number,
  config: McpResolverConfig,
  signal?: AbortSignal,
  diagnostics?: McpResolverDiagnostic[],
): Promise<DesignContextResult> => {
  if (nodeCount < ADAPTIVE_NODE_THRESHOLD) {
    config.onLog?.(
      `Node count ${String(nodeCount)} < ${String(ADAPTIVE_NODE_THRESHOLD)}, using single fetch`,
    );
    return fetchDesignContextSingle(
      fileKey,
      nodeId,
      config,
      signal,
      diagnostics,
    );
  }

  config.onLog?.(
    `Node count ${String(nodeCount)} >= ${String(ADAPTIVE_NODE_THRESHOLD)}, using subtree batching`,
  );

  const subtreeIds = extractChildSubtreeIds(xml);
  if (subtreeIds.length === 0) {
    config.onLog?.("No subtree IDs found, falling back to single fetch");
    return fetchDesignContextSingle(
      fileKey,
      nodeId,
      config,
      signal,
      diagnostics,
    );
  }

  const results: DesignContextResult[] = [];
  for (const subtreeId of subtreeIds) {
    const result = await fetchDesignContextSingle(
      fileKey,
      subtreeId,
      config,
      signal,
      diagnostics,
    );
    results.push(result);
  }

  return mergeDesignContextResults(results);
};

// ---------------------------------------------------------------------------
// REST fallback helpers
// ---------------------------------------------------------------------------

const classifyRestStatus = (status: number): string => {
  if (status === 401 || status === 403) {
    return "E_FIGMA_REST_AUTH";
  }
  if (status === 404) {
    return "E_FIGMA_REST_NOT_FOUND";
  }
  if (status === 429) {
    return "E_FIGMA_REST_RATE_LIMIT";
  }
  return "E_FIGMA_REST_ERROR";
};

const shouldForwardRestVersion = (version: string | undefined): boolean => {
  if (!version) {
    return false;
  }
  const trimmed = version.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed);
};

const toRestRetryDelay = ({
  attempt,
  retryAfter,
}: {
  attempt: number;
  retryAfter: string | null;
}): number => parseRetryAfterMs(retryAfter) ?? toRetryDelay({ attempt });

const buildRestNodesUrl = ({
  fileKey,
  nodeId,
  version,
  maxDepth,
}: {
  fileKey: string;
  nodeId: string;
  version?: string;
  maxDepth?: number;
}): string => {
  const params = new URLSearchParams({
    ids: nodeId,
  });
  const trimmedVersion = version?.trim();
  if (trimmedVersion && shouldForwardRestVersion(trimmedVersion)) {
    params.set("version", trimmedVersion);
  }
  if (
    typeof maxDepth === "number" &&
    Number.isFinite(maxDepth) &&
    maxDepth > 0
  ) {
    params.set("depth", String(Math.trunc(maxDepth)));
  }
  return `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${params.toString()}`;
};

const buildRestImageUrl = ({
  fileKey,
  nodeId,
  version,
}: {
  fileKey: string;
  nodeId: string;
  version?: string;
}): string => {
  const params = new URLSearchParams({
    ids: nodeId,
    format: "png",
  });
  const trimmedVersion = version?.trim();
  if (trimmedVersion && shouldForwardRestVersion(trimmedVersion)) {
    params.set("version", trimmedVersion);
  }
  return `https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?${params.toString()}`;
};

const fetchDesignContextViaRest = async ({
  fileKey,
  nodeId,
  version,
  accessToken,
  fetchImpl,
  timeoutMs,
  maxRetries,
  maxDepth,
  limits,
  onLog,
  diagnostics,
  ...rest
}: {
  fileKey: string;
  nodeId: string;
  version?: string;
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  maxDepth?: number;
  signal?: AbortSignal;
  limits: { limits: PipelineDiagnosticLimits } | Record<string, never>;
  onLog?: (message: string) => void;
  diagnostics?: McpResolverDiagnostic[];
}): Promise<DesignContextResult> => {
  throwIfAborted(rest.signal);
  onLog?.("Falling back to Figma REST API");

  const url = buildRestNodesUrl({
    fileKey,
    nodeId,
    ...(version ? { version } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  });
  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "X-Figma-Token": accessToken,
          Accept: "application/json",
        },
        signal: buildSignal(timeoutMs, rest.signal),
      });
    } catch (error: unknown) {
      if (rest.signal?.aborted || isAbortError(error)) {
        throw error;
      }
      lastError = createPipelineError({
        code: isTimeoutError(error)
          ? "E_FIGMA_REST_TIMEOUT"
          : "E_FIGMA_REST_NETWORK",
        stage: STAGE,
        message: `Figma REST fallback request failed: ${getErrorMessage(error)}`,
        cause: error,
        ...limits,
      });
      if (attempt >= maxRetries) {
        throw lastError;
      }
      await waitFor(toRetryDelay({ attempt }), rest.signal);
      continue;
    }

    if (!response.ok) {
      if (response.status === 429) {
        diagnostics?.push({
          code: "W_FIGMA_REST_RATE_LIMITED",
          message: `Figma REST fallback rate limited (attempt ${String(attempt)}/${String(maxRetries)})`,
          severity: "warning",
        });
      }
      lastError = createPipelineError({
        code: classifyRestStatus(response.status),
        stage: STAGE,
        message: `Figma REST fallback failed with HTTP ${String(response.status)}`,
        ...limits,
      });
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await waitFor(
          toRestRetryDelay({
            attempt,
            retryAfter: response.headers.get("retry-after"),
          }),
          rest.signal,
        );
        continue;
      }
      throw lastError;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const nodes = data.nodes as Record<string, unknown> | undefined;
    const nodeData = nodes?.[nodeId];
    if (!nodeData || typeof nodeData !== "object") {
      throw createPipelineError({
        code: "E_FIGMA_REST_NOT_FOUND",
        stage: STAGE,
        message: `Figma REST fallback did not return a document for node '${nodeId}'`,
        ...limits,
      });
    }

    return {
      code: JSON.stringify(
        ((nodeData as Record<string, unknown>).document as Record<string, unknown> | undefined) ?? {},
        null,
        2,
      ),
      assets: {},
    };
  }

  throw lastError instanceof Error
    ? lastError
    : createPipelineError({
        code: "E_FIGMA_REST_ERROR",
        stage: STAGE,
        message: "Figma REST fallback failed after retries",
        ...limits,
      });
};

const fetchScreenshotViaRest = async ({
  fileKey,
  nodeId,
  version,
  accessToken,
  fetchImpl,
  timeoutMs,
  maxRetries,
  signal,
  limits,
  onLog,
  diagnostics,
}: {
  fileKey: string;
  nodeId: string;
  version?: string;
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  signal?: AbortSignal;
  limits: { limits: PipelineDiagnosticLimits } | Record<string, never>;
  onLog?: (message: string) => void;
  diagnostics?: McpResolverDiagnostic[];
}): Promise<string | undefined> => {
  throwIfAborted(signal);
  onLog?.("Falling back to Figma REST image export for screenshot");

  const url = buildRestImageUrl({
    fileKey,
    nodeId,
    ...(version ? { version } : {}),
  });
  let lastError: unknown;

  for (let attempt = 1; attempt <= Math.max(1, maxRetries); attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: {
          "X-Figma-Token": accessToken,
          Accept: "application/json",
        },
        signal: buildSignal(timeoutMs, signal),
      });
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) {
        throw error;
      }
      lastError = createPipelineError({
        code: isTimeoutError(error)
          ? "E_FIGMA_REST_TIMEOUT"
          : "E_FIGMA_REST_NETWORK",
        stage: STAGE,
        message: `Figma REST screenshot fallback request failed: ${getErrorMessage(error)}`,
        cause: error,
        ...limits,
      });
      if (attempt >= maxRetries) {
        throw lastError;
      }
      await waitFor(toRetryDelay({ attempt }), signal);
      continue;
    }

    if (!response.ok) {
      if (response.status === 429) {
        diagnostics?.push({
          code: "W_FIGMA_REST_RATE_LIMITED",
          message: `Figma REST screenshot fallback rate limited (attempt ${String(attempt)}/${String(maxRetries)})`,
          severity: "warning",
        });
      }
      lastError = createPipelineError({
        code: classifyRestStatus(response.status),
        stage: STAGE,
        message: `Figma REST screenshot fallback failed with HTTP ${String(response.status)}`,
        ...limits,
      });
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await waitFor(
          toRestRetryDelay({
            attempt,
            retryAfter: response.headers.get("retry-after"),
          }),
          signal,
        );
        continue;
      }
      throw lastError;
    }

    const payload = (await response.json()) as {
      images?: Record<string, string | null>;
    };
    const imageUrl = payload.images?.[nodeId];
    return typeof imageUrl === "string" && imageUrl.length > 0
      ? imageUrl
      : undefined;
  }

  throw lastError instanceof Error
    ? lastError
    : createPipelineError({
        code: "E_FIGMA_REST_ERROR",
        stage: STAGE,
        message: "Figma REST screenshot fallback failed after retries",
        ...limits,
      });
};

// ---------------------------------------------------------------------------
// resolveFigmaDesignContext — main entry point
// ---------------------------------------------------------------------------

export const resolveFigmaDesignContext = async (
  meta: FigmaMeta,
  config: McpResolverConfig,
  options?: ResolverOptions,
): Promise<FigmaDesignContext> => {
  const signal = options?.signal;
  throwIfAborted(signal);
  const resolvedNodeId = await resolveNodeId(meta, config, signal);
  const cacheKey = getCacheKey(meta.fileKey, resolvedNodeId, meta.version);

  const executeResolution = async (): Promise<FigmaDesignContext> => {
    throwIfAborted(signal);
    const diagnostics: McpResolverDiagnostic[] = [];

    config.onLog?.(`Resolving design context for fileKey=${meta.fileKey}`);

    if (!options?.forceRefresh) {
      const cached = resolverCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        config.onLog?.("Cache hit — returning cached design context");
        return cached.context;
      }
    }

    config.onLog?.(`Fetching metadata for node ${resolvedNodeId}`);

    let xml = "";
    let nodeCount = 0;
    let rootNodeType = "unknown";
    let rootNodeName = "unnamed";

    try {
      const metaResult = await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: meta.fileKey, nodeId: resolvedNodeId },
        config,
        ...(signal ? { signal } : {}),
        diagnostics,
      });

      const metadataResult = metaResult as MetadataResult | null | undefined;
      if (metadataResult?.xml) {
        xml = metadataResult.xml;
        nodeCount = estimateNodeCount(xml);
        const rootInfo = extractRootNodeInfo(xml);
        rootNodeType = rootInfo.rootNodeType;
        rootNodeName = rootInfo.rootNodeName;
        config.onLog?.(
          `Metadata: ${String(nodeCount)} nodes, root=${rootNodeType}/${rootNodeName}`,
        );
      }
    } catch (error: unknown) {
      if (signal?.aborted || isAbortError(error)) {
        throw error;
      }
      config.onLog?.(
        `Metadata fetch failed, proceeding with single design context call: ${getErrorMessage(error)}`,
      );
    }

    let designContext: DesignContextResult;
    let restFallbackUsed = false;

    try {
      designContext = await fetchDesignContextAdaptive(
        meta.fileKey,
        resolvedNodeId,
        xml,
        nodeCount,
        config,
        signal,
        diagnostics,
      );
    } catch (mcpError: unknown) {
      if (signal?.aborted || isAbortError(mcpError)) {
        throw mcpError;
      }
      config.onLog?.(
        `MCP design context failed: ${getErrorMessage(mcpError)}, attempting REST fallback`,
      );
      diagnostics.push({
        code: "W_MCP_FALLBACK_REST",
        message: `MCP failed, fell back to Figma REST API: ${getErrorMessage(mcpError)}`,
        severity: "warning",
      });
      restFallbackUsed = true;
      designContext = await fetchDesignContextViaRest({
        fileKey: meta.fileKey,
        nodeId: resolvedNodeId,
        ...(meta.version ? { version: meta.version } : {}),
        accessToken: config.accessToken,
        fetchImpl: config.fetchImpl,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        ...(options?.maxDepth !== undefined
          ? { maxDepth: options.maxDepth }
          : {}),
        ...(signal ? { signal } : {}),
        limits: limitsArg(config.pipelineDiagnosticLimits),
        ...(config.onLog ? { onLog: config.onLog } : {}),
        diagnostics,
      });
    }

    let screenshotUrl: string | undefined;

    if (!options?.skipScreenshot) {
      try {
        config.onLog?.("Fetching screenshot");
        const screenshotResult = await callMcpTool({
          toolName: "get_screenshot",
          args: { fileKey: meta.fileKey, nodeId: resolvedNodeId },
          config,
          ...(signal ? { signal } : {}),
          diagnostics,
        });
        const screenshotData = screenshotResult as
          | ScreenshotResult
          | null
          | undefined;
        screenshotUrl = screenshotData?.url ?? undefined;
      } catch (error: unknown) {
        if (signal?.aborted || isAbortError(error)) {
          throw error;
        }
        config.onLog?.(
          `Screenshot fetch failed (non-fatal): ${getErrorMessage(error)}`,
        );
      }

      if (!screenshotUrl && restFallbackUsed) {
        try {
          screenshotUrl = await fetchScreenshotViaRest({
            fileKey: meta.fileKey,
            nodeId: resolvedNodeId,
            ...(meta.version ? { version: meta.version } : {}),
            accessToken: config.accessToken,
            fetchImpl: config.fetchImpl,
            timeoutMs: config.timeoutMs,
            maxRetries: config.maxRetries,
            ...(signal ? { signal } : {}),
            limits: limitsArg(config.pipelineDiagnosticLimits),
            ...(config.onLog ? { onLog: config.onLog } : {}),
            diagnostics,
          });
          if (screenshotUrl) {
            diagnostics.push({
              code: "W_MCP_SCREENSHOT_FALLBACK_REST",
              message:
                "MCP screenshot was unavailable, fell back to Figma REST image export.",
              severity: "warning",
            });
          }
        } catch (error: unknown) {
          if (signal?.aborted || isAbortError(error)) {
            throw error;
          }
          config.onLog?.(
            `REST screenshot fallback failed (non-fatal): ${getErrorMessage(error)}`,
          );
        }
      }
    }

    const result: FigmaDesignContext = {
      code: designContext.code ?? "",
      assets: designContext.assets ?? {},
      ...(screenshotUrl ? { screenshot: screenshotUrl } : {}),
      ...(xml.length > 0
        ? { metadata: { xml, nodeCount, rootNodeType, rootNodeName } }
        : {}),
      fileKey: meta.fileKey,
      nodeId: resolvedNodeId,
      resolvedAt: new Date().toISOString(),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
    };

    resolverCache.set(cacheKey, {
      context: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return result;
  };

  if (!options?.forceRefresh) {
    const cached = resolverCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      config.onLog?.("Cache hit — returning cached design context");
      return cached.context;
    }
    if (!signal) {
      const inflight = inflightResolverCache.get(cacheKey);
      if (inflight) {
        config.onLog?.("In-flight cache hit — awaiting existing resolution");
        return inflight;
      }
      const pending = executeResolution().finally(() => {
        inflightResolverCache.delete(cacheKey);
      });
      inflightResolverCache.set(cacheKey, pending);
      return pending;
    }
  }

  return executeResolution();
};

// ---------------------------------------------------------------------------
// Re-export constants for external use
// ---------------------------------------------------------------------------

export {
  DEFAULT_MCP_SERVER_URL,
  ADAPTIVE_NODE_THRESHOLD,
  MAX_SUBTREE_BATCH_SIZE,
  CACHE_TTL_MS,
  callMcpTool,
};
