import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeParseFigmaPayload, summarizeFigmaPayloadValidationError } from "../figma-payload-validation.js";
import { createPipelineError, getErrorMessage, type PipelineDiagnosticLimits } from "./errors.js";
import type {
  FigmaRestCircuitBreaker,
  FigmaRestCircuitBreakerSnapshot
} from "./figma-rest-circuit-breaker.js";
import type { FigmaFetchResult, FigmaFileResponse } from "./types.js";

const MIN_SCREEN_WIDTH = 320;
const MIN_SCREEN_HEIGHT = 480;
const MAX_ERROR_BODY_CHARS = 500;
const MAX_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_ICON_RECOVERY_DESCENDANTS = 160;
const ICON_RECOVERY_BATCH_SIZE = 20;
const MAX_ICON_RECOVERY_DIMENSION = 96;
const MAX_ICON_RECOVERY_AREA = MAX_ICON_RECOVERY_DIMENSION * MAX_ICON_RECOVERY_DIMENSION;
const LOW_FIDELITY_MIN_INSTANCE_COUNT = 12;
const LOW_FIDELITY_MIN_EXPLICIT_COMPONENTS = 6;
const LOW_FIDELITY_MIN_VECTOR_FALLBACKS = 2;
const LOW_FIDELITY_MAX_TEXT_TO_INSTANCE_RATIO = 0.45;
const MAX_AUTHORITATIVE_SUBTREE_CANDIDATES = 8;
const SCREEN_CANDIDATE_NAME_EXCLUDE_RE = /^(icon|icons|atom|atoms|component|components|_hidden)(\/|$)/i;
const SCREEN_CANDIDATE_PAGE_EXCLUDE_RE = /\b(components|assets|icons|tokens|styles)\b/i;
const SCREEN_CANDIDATE_INPUT_HINT_RE = /\b(input|field|form|email|password|search|phone|otp|button|cta)\b/i;
const SCREEN_CANDIDATE_POOL_MULTIPLIER = 5;
const SCREEN_CANDIDATE_POOL_LIMIT = 400;
const FIGMA_CACHE_ENTRY_VERSION = 1;
const FIGMA_CACHE_LATEST_INDEX_VERSION = 1;

interface FigmaCacheEntry {
  version: number;
  fileKey: string;
  lastModified: string;
  cachedAt: number;
  ttlMs: number;
  fileVersionId?: string;
  candidateSubtreeHashes?: Record<string, string>;
  diagnostics: FigmaFetchResult["diagnostics"];
  file: FigmaFetchResult["file"];
}

interface FigmaCacheLatestIndex {
  version: number;
  fileKey: string;
  lastModified: string;
  updatedAt: number;
}

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
}

interface FigmaFileLike extends FigmaFileResponse {
  document?: FigmaNodeLike;
}

interface FigmaStagedIncrementalContext {
  fileVersionId?: string;
  previousRootNode: FigmaNodeLike;
  previousCandidateSubtreeHashes: Record<string, string>;
}

interface ScreenCandidateStats {
  total: number;
  excludedByPage: number;
  excludedByName: number;
  excludedByPattern: number;
  selected: number;
}

interface ScreenCandidateSelection {
  candidates: FigmaNodeLike[];
  stats: ScreenCandidateStats;
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

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
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

const getErrorCode = (error: unknown): string | undefined => {
  return isRecord(error) && typeof error.code === "string" ? error.code : undefined;
};

const getErrorCause = (error: unknown): unknown => {
  return error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
};

const isTransientFigmaRestFailure = (error: unknown): boolean => {
  if (error instanceof FigmaTooLargeError) {
    return false;
  }

  const code = getErrorCode(error);
  if (
    code === "E_FIGMA_NETWORK" ||
    code === "E_FIGMA_TIMEOUT" ||
    code === "E_FIGMA_RATE_LIMIT" ||
    code === "E_FIGMA_UPSTREAM"
  ) {
    return true;
  }

  if (code === "E_FIGMA_PARSE") {
    return isTimeoutError(error) || isTimeoutError(getErrorCause(error));
  }

  return false;
};

const toCircuitOpenError = ({
  requestLabel,
  snapshot,
  pipelineDiagnosticLimits
}: {
  requestLabel: string;
  snapshot: FigmaRestCircuitBreakerSnapshot;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}) => {
  const message =
    snapshot.state === "half-open" && snapshot.probeInFlight
      ? `Figma REST circuit breaker is half-open and already probing (${requestLabel}).`
      : `Figma REST circuit breaker is open (${requestLabel}).`;

  return createPipelineError({
    code: "E_FIGMA_CIRCUIT_OPEN",
    stage: "figma.source",
    message,
    ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {}),
    diagnostics: [
      {
        code: "E_FIGMA_CIRCUIT_OPEN",
        message,
        suggestion: "Wait for the breaker reset window to elapse or restore Figma API availability before retrying.",
        stage: "figma.source",
        severity: "error",
        details: {
          circuitState: snapshot.state,
          consecutiveFailures: snapshot.consecutiveFailures,
          failureThreshold: snapshot.failureThreshold,
          resetTimeoutMs: snapshot.resetTimeoutMs,
          ...(snapshot.nextProbeAt !== undefined
            ? { nextProbeAt: new Date(snapshot.nextProbeAt).toISOString() }
            : {}),
          probeInFlight: snapshot.probeInFlight,
          requestLabel
        }
      }
    ]
  });
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
  allowTooLargeFallback,
  pipelineDiagnosticLimits
}: {
  response: Response;
  requestLabel: string;
  allowTooLargeFallback: boolean;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<unknown> => {
  const responseWithOptionalHeaders = response as {
    headers?: {
      get?: (name: string) => string | null;
    };
  };
  const headers = responseWithOptionalHeaders.headers;
  const contentLengthRaw = typeof headers?.get === "function" ? headers.get("content-length") : null;
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
      message: `Figma response body exceeds byte limit (${requestLabel}, content-length=${contentLength}).`,
      ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
    });
  }

  if (!response.body) {
    return await response.json();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const readResult = (await reader.read()) as {
      done: boolean;
      value?: Uint8Array;
    };
    if (readResult.done) {
      break;
    }
    const chunk = readResult.value;
    if (!(chunk instanceof Uint8Array)) {
      continue;
    }
    totalBytes += chunk.byteLength;
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
        message: `Figma response body exceeds byte limit (${requestLabel}, bytes=${totalBytes}).`,
        ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
      });
    }
    chunks.push(chunk);
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
  requestLabel,
  pipelineDiagnosticLimits
}: {
  payload: unknown;
  requestLabel: string;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Record<string, unknown> => {
  if (isRecord(payload)) {
    return payload;
  }
  throw createPipelineError({
    code: "E_FIGMA_PARSE",
    stage: "figma.source",
    message: `Could not parse Figma API response (${requestLabel}): response is not an object.`,
    ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
  });
};

const toFigmaFileOrParseError = ({
  payload,
  requestLabel,
  pipelineDiagnosticLimits
}: {
  payload: unknown;
  requestLabel: string;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): FigmaFileResponse => {
  const parsedRecord = toRecordOrParseError({
    payload,
    requestLabel,
    ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
  });
  const parsedPayload = safeParseFigmaPayload({ input: parsedRecord });
  if (parsedPayload.success) {
    return parsedPayload.data;
  }
  throw createPipelineError({
    code: "E_FIGMA_PARSE",
    stage: "figma.source",
    message:
      `Could not parse Figma API response (${requestLabel}): invalid Figma payload ` +
      `(${summarizeFigmaPayloadValidationError({ error: parsedPayload.error })}).`,
    ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
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
  allowTooLargeFallback,
  figmaRestCircuitBreaker,
  pipelineDiagnosticLimits
}: {
  url: string;
  requestLabel: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  allowTooLargeFallback: boolean;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<unknown> => {
  const circuitDecision = figmaRestCircuitBreaker?.beforeRequest();
  if (circuitDecision && !circuitDecision.allowRequest) {
    throw toCircuitOpenError({
      requestLabel,
      snapshot: circuitDecision.snapshot,
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });
  }

  const performRequest = async (headers: Record<string, string>): Promise<Response> => {
    return await fetchWithTimeout({
      fetchImpl,
      url,
      timeoutMs,
      headers
    });
  };

  try {
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
          cause: error,
          ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
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
          message: `Figma API error (${response.status}) (${requestLabel}): ${failureBody || "no response body"}`,
          ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
        });
      }

      try {
        const payload = await parseJsonWithByteLimit({
          response,
          requestLabel,
          allowTooLargeFallback,
          ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
        });
        figmaRestCircuitBreaker?.recordSuccess();
        return payload;
      } catch (error) {
        if (error instanceof FigmaTooLargeError) {
          throw error;
        }
        if (allowTooLargeFallback && isTooLargeParseError(error)) {
          throw new FigmaTooLargeError(`Figma response exceeded parser limits (${requestLabel}).`);
        }
        if (isTimeoutError(error) && attempt < maxRetries) {
          const delayMs = toRetryDelay({ attempt });
          onLog(`Figma response parse timed out (${requestLabel}), retrying in ${delayMs}ms (${attempt}/${maxRetries}).`);
          await waitFor(delayMs);
          continue;
        }
        throw createPipelineError({
          code: "E_FIGMA_PARSE",
          stage: "figma.source",
          message: `Could not parse Figma API response (${requestLabel}): ${getErrorMessage(error)}`,
          cause: error,
          ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
        });
      }
    }

    throw createPipelineError({
      code: "E_FIGMA_RETRY_EXHAUSTED",
      stage: "figma.source",
      message: `Figma REST retries exhausted (${requestLabel}).`,
      ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
    });
  } catch (error) {
    if (error instanceof FigmaTooLargeError) {
      figmaRestCircuitBreaker?.recordNonTransientOutcome();
      throw error;
    }

    if (getErrorCode(error) !== "E_FIGMA_CIRCUIT_OPEN") {
      if (isTransientFigmaRestFailure(error)) {
        figmaRestCircuitBreaker?.recordTransientFailure();
      } else {
        figmaRestCircuitBreaker?.recordNonTransientOutcome();
      }
    }

    throw error;
  }
};

const toFigmaCacheFilePath = ({
  cacheDir,
  fileKey,
  lastModified
}: {
  cacheDir: string;
  fileKey: string;
  lastModified: string;
}): string => {
  const hash = createHash("sha256").update(`${fileKey}:${lastModified}`).digest("hex");
  return path.join(cacheDir, `${hash}.json`);
};

const toFigmaCacheLatestIndexPath = ({
  cacheDir,
  fileKey
}: {
  cacheDir: string;
  fileKey: string;
}): string => {
  const hash = createHash("sha256").update(fileKey).digest("hex");
  return path.join(cacheDir, `${hash}.latest.json`);
};

const toCanonicalJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalJsonValue(entry));
  }
  if (!isRecord(value)) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
    output[key] = toCanonicalJsonValue(value[key]);
  }
  return output;
};

const toNodeSubtreeHash = (node: FigmaNodeLike): string => {
  const canonical = toCanonicalJsonValue(node);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
};

const toSortedHashRecord = (hashes: Map<string, string>): Record<string, string> => {
  const sortedEntries = [...hashes.entries()]
    .filter(([id, hash]) => id.length > 0 && hash.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(sortedEntries);
};

const toCacheEntry = (payload: unknown): FigmaCacheEntry | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const degradedGeometryNodes = payload.diagnostics && isRecord(payload.diagnostics)
    ? payload.diagnostics.degradedGeometryNodes
    : undefined;
  if (!isStringArray(degradedGeometryNodes)) {
    return undefined;
  }
  const lowFidelityReasonsRaw = payload.diagnostics && isRecord(payload.diagnostics)
    ? payload.diagnostics.lowFidelityReasons
    : undefined;
  if (lowFidelityReasonsRaw !== undefined && !isStringArray(lowFidelityReasonsRaw)) {
    return undefined;
  }

  const sourceMode = payload.diagnostics && isRecord(payload.diagnostics) ? payload.diagnostics.sourceMode : undefined;
  const fetchedNodes = payload.diagnostics && isRecord(payload.diagnostics) ? payload.diagnostics.fetchedNodes : undefined;
  const lowFidelityDetected =
    payload.diagnostics && isRecord(payload.diagnostics) ? payload.diagnostics.lowFidelityDetected : undefined;
  const authoritativeSubtreeCount =
    payload.diagnostics && isRecord(payload.diagnostics) ? payload.diagnostics.authoritativeSubtreeCount : undefined;
  const fileVersionId = typeof payload.fileVersionId === "string" ? payload.fileVersionId : undefined;
  const candidateSubtreeHashesRaw = payload.candidateSubtreeHashes;
  let candidateSubtreeHashes: Record<string, string> | undefined;
  if (candidateSubtreeHashesRaw !== undefined) {
    if (!isRecord(candidateSubtreeHashesRaw)) {
      return undefined;
    }
    const parsedHashes: Record<string, string> = {};
    for (const [nodeId, hash] of Object.entries(candidateSubtreeHashesRaw)) {
      if (typeof hash !== "string") {
        return undefined;
      }
      if (nodeId.length > 0 && hash.length > 0) {
        parsedHashes[nodeId] = hash;
      }
    }
    candidateSubtreeHashes = parsedHashes;
  }
  if (
    (sourceMode !== "geometry-paths" && sourceMode !== "staged-nodes") ||
    typeof fetchedNodes !== "number" ||
    !Number.isFinite(fetchedNodes) ||
    fetchedNodes < 0 ||
    (lowFidelityDetected !== undefined && typeof lowFidelityDetected !== "boolean") ||
    (authoritativeSubtreeCount !== undefined &&
      (!isFiniteNumber(authoritativeSubtreeCount) || authoritativeSubtreeCount < 0))
  ) {
    return undefined;
  }

  if (
    typeof payload.version !== "number" ||
    !Number.isFinite(payload.version) ||
    typeof payload.fileKey !== "string" ||
    typeof payload.lastModified !== "string" ||
    typeof payload.cachedAt !== "number" ||
    !Number.isFinite(payload.cachedAt) ||
    typeof payload.ttlMs !== "number" ||
    !Number.isFinite(payload.ttlMs) ||
    !isRecord(payload.file)
  ) {
    return undefined;
  }

  const cacheEntry: FigmaCacheEntry = {
    version: payload.version,
    fileKey: payload.fileKey,
    lastModified: payload.lastModified,
    cachedAt: payload.cachedAt,
    ttlMs: payload.ttlMs,
    diagnostics: {
      sourceMode,
      fetchedNodes,
      degradedGeometryNodes,
      ...(typeof lowFidelityDetected === "boolean" ? { lowFidelityDetected } : {}),
      ...(lowFidelityReasonsRaw && lowFidelityReasonsRaw.length > 0 ? { lowFidelityReasons: lowFidelityReasonsRaw } : {}),
      ...(isFiniteNumber(authoritativeSubtreeCount) ? { authoritativeSubtreeCount } : {})
    },
    file: payload.file
  };
  if (typeof fileVersionId === "string" && fileVersionId.length > 0) {
    cacheEntry.fileVersionId = fileVersionId;
  }
  if (candidateSubtreeHashes && Object.keys(candidateSubtreeHashes).length > 0) {
    cacheEntry.candidateSubtreeHashes = candidateSubtreeHashes;
  }
  return cacheEntry;
};

const toLatestCacheIndex = (payload: unknown): FigmaCacheLatestIndex | undefined => {
  if (
    !isRecord(payload) ||
    typeof payload.version !== "number" ||
    !Number.isFinite(payload.version) ||
    typeof payload.fileKey !== "string" ||
    typeof payload.lastModified !== "string" ||
    typeof payload.updatedAt !== "number" ||
    !Number.isFinite(payload.updatedAt)
  ) {
    return undefined;
  }
  return {
    version: payload.version,
    fileKey: payload.fileKey,
    lastModified: payload.lastModified,
    updatedAt: payload.updatedAt
  };
};

const readCacheEntryFile = async ({
  cacheFilePath,
  fileKey,
  onLog,
  cacheMissLabel
}: {
  cacheFilePath: string;
  fileKey: string;
  onLog: (message: string) => void;
  cacheMissLabel: string;
}): Promise<FigmaCacheEntry | undefined> => {
  let raw: string;
  try {
    raw = await readFile(cacheFilePath, "utf8");
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      onLog(`Figma cache miss for file '${fileKey}' (${cacheMissLabel}).`);
      return undefined;
    }
    onLog(`Figma cache read failed for file '${fileKey}': ${getErrorMessage(error)}.`);
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onLog(`Figma cache miss for file '${fileKey}' (invalid cache JSON): ${getErrorMessage(error)}.`);
    return undefined;
  }

  const cacheEntry = toCacheEntry(parsed);
  if (!cacheEntry || cacheEntry.version !== FIGMA_CACHE_ENTRY_VERSION || cacheEntry.fileKey !== fileKey) {
    onLog(`Figma cache miss for file '${fileKey}' (entry mismatch).`);
    return undefined;
  }
  return cacheEntry;
};

const readCachedFigmaResult = async ({
  cacheFilePath,
  fileKey,
  lastModified,
  cacheTtlMs,
  onLog
}: {
  cacheFilePath: string;
  fileKey: string;
  lastModified: string;
  cacheTtlMs: number;
  onLog: (message: string) => void;
}): Promise<FigmaFetchResult | undefined> => {
  const cacheEntry = await readCacheEntryFile({
    cacheFilePath,
    fileKey,
    onLog,
    cacheMissLabel: "no cache entry"
  });
  if (!cacheEntry) {
    return undefined;
  }
  if (cacheEntry.lastModified !== lastModified) {
    onLog(`Figma cache miss for file '${fileKey}' (entry mismatch).`);
    return undefined;
  }

  const ageMs = Date.now() - cacheEntry.cachedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > cacheTtlMs) {
    onLog(`Figma cache stale for file '${fileKey}' (age=${Math.max(0, Math.trunc(ageMs))}ms).`);
    try {
      await unlink(cacheFilePath);
    } catch {
      // Best-effort stale cleanup.
    }
    return undefined;
  }

  onLog(`Figma cache hit for file '${fileKey}' (age=${Math.trunc(ageMs)}ms).`);
  return {
    file: cacheEntry.file,
    diagnostics: cacheEntry.diagnostics
  };
};

const readLatestCacheIndex = async ({
  cacheIndexPath,
  fileKey,
  onLog
}: {
  cacheIndexPath: string;
  fileKey: string;
  onLog: (message: string) => void;
}): Promise<FigmaCacheLatestIndex | undefined> => {
  let raw: string;
  try {
    raw = await readFile(cacheIndexPath, "utf8");
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      return undefined;
    }
    onLog(`Figma incremental index read failed for file '${fileKey}': ${getErrorMessage(error)}.`);
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    onLog(`Figma incremental index parse failed for file '${fileKey}': ${getErrorMessage(error)}.`);
    return undefined;
  }

  const indexEntry = toLatestCacheIndex(parsed);
  if (
    !indexEntry ||
    indexEntry.version !== FIGMA_CACHE_LATEST_INDEX_VERSION ||
    indexEntry.fileKey !== fileKey ||
    indexEntry.lastModified.trim().length === 0
  ) {
    onLog(`Figma incremental index invalid for file '${fileKey}', ignoring index entry.`);
    return undefined;
  }
  return indexEntry;
};

const writeCachedFigmaResult = async ({
  cacheDir,
  cacheFilePath,
  fileKey,
  lastModified,
  cacheTtlMs,
  fileVersionId,
  candidateSubtreeHashes,
  result,
  onLog
}: {
  cacheDir: string;
  cacheFilePath: string;
  fileKey: string;
  lastModified: string;
  cacheTtlMs: number;
  fileVersionId?: string;
  candidateSubtreeHashes?: Record<string, string>;
  result: FigmaFetchResult;
  onLog: (message: string) => void;
}): Promise<void> => {
  const entry: FigmaCacheEntry = {
    version: FIGMA_CACHE_ENTRY_VERSION,
    fileKey,
    lastModified,
    cachedAt: Date.now(),
    ttlMs: cacheTtlMs,
    diagnostics: result.diagnostics,
    file: result.file
  };
  if (typeof fileVersionId === "string" && fileVersionId.length > 0) {
    entry.fileVersionId = fileVersionId;
  }
  if (candidateSubtreeHashes && Object.keys(candidateSubtreeHashes).length > 0) {
    entry.candidateSubtreeHashes = candidateSubtreeHashes;
  }

  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cacheFilePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    const latestIndexPath = toFigmaCacheLatestIndexPath({ cacheDir, fileKey });
    const latestIndex: FigmaCacheLatestIndex = {
      version: FIGMA_CACHE_LATEST_INDEX_VERSION,
      fileKey,
      lastModified,
      updatedAt: Date.now()
    };
    await writeFile(latestIndexPath, `${JSON.stringify(latestIndex, null, 2)}\n`, "utf8");
    onLog(`Figma cache write completed for file '${fileKey}'.`);
  } catch (error) {
    onLog(`Figma cache write failed for file '${fileKey}': ${getErrorMessage(error)}.`);
  }
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

const toTrimmedName = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const toNodeArea = (node: FigmaNodeLike): number => {
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  if (typeof width !== "number" || typeof height !== "number") {
    return 0;
  }
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return width * height;
};

const toAspectRatioScore = (node: FigmaNodeLike): number => {
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
    return 0;
  }
  const ratio = width / height;
  const portraitTarget = 390 / 844;
  const landscapeTarget = 16 / 10;
  const normalizedPortraitDelta = Math.abs(ratio - portraitTarget) / 1;
  const normalizedLandscapeDelta = Math.abs(ratio - landscapeTarget) / 2;
  const normalizedDelta = Math.min(normalizedPortraitDelta, normalizedLandscapeDelta);
  return Math.max(0, 1 - Math.min(1, normalizedDelta));
};

const collectDescendantSignals = (node: FigmaNodeLike): {
  descendantCount: number;
  hasTextDescendant: boolean;
  hasInputHintInDescendants: boolean;
} => {
  let descendantCount = 0;
  let hasTextDescendant = false;
  let hasInputHintInDescendants = false;
  const queue = [...asNodeArray(node.children)];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    descendantCount += 1;
    const nodeType = (current.type ?? "").toUpperCase();
    if (nodeType === "TEXT") {
      hasTextDescendant = true;
    }
    const nodeName = toTrimmedName(current.name);
    if (nodeName.length > 0 && SCREEN_CANDIDATE_INPUT_HINT_RE.test(nodeName)) {
      hasInputHintInDescendants = true;
    }
    for (const child of asNodeArray(current.children)) {
      queue.push(child);
    }
  }

  return { descendantCount, hasTextDescendant, hasInputHintInDescendants };
};

const toCandidateQualityScore = (node: FigmaNodeLike): number => {
  const childCount = asNodeArray(node.children).length;
  const descendantSignals = collectDescendantSignals(node);
  const aspectRatioScore = toAspectRatioScore(node);

  return (
    (descendantSignals.hasTextDescendant ? 6 : 0) +
    (descendantSignals.hasInputHintInDescendants ? 4 : 0) +
    Math.min(6, childCount) * 0.6 +
    Math.min(20, descendantSignals.descendantCount) * 0.2 +
    aspectRatioScore * 3
  );
};

const toScreenNamePattern = ({
  screenNamePattern,
  onLog
}: {
  screenNamePattern: string | undefined;
  onLog: (message: string) => void;
}): RegExp | undefined => {
  const normalizedPattern = typeof screenNamePattern === "string" ? screenNamePattern.trim() : "";
  if (normalizedPattern.length === 0) {
    return undefined;
  }
  try {
    return new RegExp(normalizedPattern, "i");
  } catch (error) {
    onLog(
      `Invalid figmaScreenNamePattern '${normalizedPattern}' (${getErrorMessage(error)}); include filter disabled.`
    );
    return undefined;
  }
};

const collectScreenCandidates = ({
  root,
  maxCandidates,
  requireMinSize,
  screenNamePattern
}: {
  root: FigmaNodeLike;
  maxCandidates: number;
  requireMinSize: boolean;
  screenNamePattern: RegExp | undefined;
}): ScreenCandidateSelection => {
  const candidates: Array<{
    node: FigmaNodeLike;
    qualityScore: number;
    area: number;
    traversalIndex: number;
  }> = [];
  const stats: ScreenCandidateStats = {
    total: 0,
    excludedByPage: 0,
    excludedByName: 0,
    excludedByPattern: 0,
    selected: 0
  };

  let traversalIndex = 0;
  const candidatePoolLimit = Math.max(
    Math.max(1, maxCandidates),
    Math.min(SCREEN_CANDIDATE_POOL_LIMIT, Math.max(1, maxCandidates) * SCREEN_CANDIDATE_POOL_MULTIPLIER)
  );

  const visit = (node: FigmaNodeLike, pageName: string): void => {
    if (candidates.length >= candidatePoolLimit) {
      return;
    }
    if (node.visible === false) {
      return;
    }

    const nodeType = (node.type ?? "").toUpperCase();
    const nextPageName =
      nodeType === "CANVAS" || nodeType === "PAGE" ? toTrimmedName(node.name).toLowerCase() : pageName;

    if (isScreenCandidateType(nodeType) && hasScreenLikeSize(node, requireMinSize)) {
      stats.total += 1;
      const normalizedName = toTrimmedName(node.name);
      const pageExcluded = nextPageName.length > 0 && SCREEN_CANDIDATE_PAGE_EXCLUDE_RE.test(nextPageName);
      if (pageExcluded) {
        stats.excludedByPage += 1;
      } else if (normalizedName.length > 0 && SCREEN_CANDIDATE_NAME_EXCLUDE_RE.test(normalizedName)) {
        stats.excludedByName += 1;
      } else if (screenNamePattern && !screenNamePattern.test(normalizedName)) {
        stats.excludedByPattern += 1;
      } else {
        candidates.push({
          node,
          qualityScore: toCandidateQualityScore(node),
          area: toNodeArea(node),
          traversalIndex
        });
        traversalIndex += 1;
      }
      if (candidates.length >= candidatePoolLimit) {
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
        visit(child, nextPageName);
        if (candidates.length >= candidatePoolLimit) {
          return;
        }
      }
    }
  };

  visit(root, "");

  const selected = [...candidates]
    .sort((left, right) => {
      if (right.qualityScore !== left.qualityScore) {
        return right.qualityScore - left.qualityScore;
      }
      if (right.area !== left.area) {
        return right.area - left.area;
      }
      return left.traversalIndex - right.traversalIndex;
    })
    .slice(0, Math.max(1, maxCandidates))
    .map((entry) => entry.node);

  stats.selected = selected.length;
  return { candidates: selected, stats };
};

const hasIconRecoveryName = (node: FigmaNodeLike): boolean => {
  const normalizedName = (node.name ?? "").toLowerCase();
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

const findNodeById = ({
  root,
  targetId
}: {
  root: FigmaNodeLike;
  targetId: string;
}): FigmaNodeLike | undefined => {
  const queue: FigmaNodeLike[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.id === targetId) {
      return current;
    }
    for (const child of asNodeArray(current.children)) {
      queue.push(child);
    }
  }
  return undefined;
};

const normalizeFidelityNodeName = (value: string | undefined): string => {
  return (value ?? "")
    .replace(/🔥/g, " ")
    .replace(/^_+/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const isExplicitBoardComponentName = (value: string | undefined): boolean => {
  const normalized = normalizeFidelityNodeName(value);
  if (!normalized) {
    return false;
  }
  if (/<\s*(button|card|alert|stack\d*|chip|avatar|paper|divider|badge|tab|dialog|snackbar|navigation)\s*>/i.test(value ?? "")) {
    return true;
  }
  return /^(button|card|alert|stack\d*|chip|avatar|paper|divider|badge|tab|dialog|snackbar|navigation)$/.test(normalized);
};

const isFallbackProneVectorNode = (node: FigmaNodeLike): boolean => {
  if (node.type !== "VECTOR") {
    return false;
  }
  const normalizedName = normalizeFidelityNodeName(node.name);
  if (!normalizedName) {
    return false;
  }
  const width = node.absoluteBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height;
  const withinIconSize =
    (isFiniteNumber(width) && width <= 160 && width > 0) &&
    (isFiniteNumber(height) && height <= 160 && height > 0);
  if (!withinIconSize) {
    return false;
  }
  return !(
    normalizedName.includes("icon") ||
    normalizedName.startsWith("ic_") ||
    normalizedName.startsWith("icon/") ||
    normalizedName.startsWith("icons/") ||
    normalizedName.startsWith("icon-") ||
    normalizedName.startsWith("icon_")
  );
};

const detectLowFidelityReasons = (file: FigmaFileResponse): string[] => {
  const root = isRecord(file.document) ? (file.document as FigmaNodeLike) : undefined;
  if (!root) {
    return [];
  }

  let instanceCount = 0;
  let explicitBoardComponentCount = 0;
  let fallbackProneVectorCount = 0;
  let textNodeCount = 0;
  const queue: FigmaNodeLike[] = [root];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.type === "INSTANCE") {
      instanceCount += 1;
    }
    if (isExplicitBoardComponentName(current.name)) {
      explicitBoardComponentCount += 1;
    }
    if (current.type === "TEXT" && typeof (current as { characters?: unknown }).characters === "string") {
      if (((current as { characters?: string }).characters ?? "").trim().length > 0) {
        textNodeCount += 1;
      }
    }
    if (isFallbackProneVectorNode(current)) {
      fallbackProneVectorCount += 1;
    }
    for (const child of asNodeArray(current.children)) {
      queue.push(child);
    }
  }

  const reasons: string[] = [];
  if (
    instanceCount >= LOW_FIDELITY_MIN_INSTANCE_COUNT &&
    explicitBoardComponentCount >= LOW_FIDELITY_MIN_EXPLICIT_COMPONENTS
  ) {
    reasons.push(
      `Direct geometry payload is instance-heavy (${instanceCount} instances, ${explicitBoardComponentCount} explicit board components).`
    );
  }
  if (
    explicitBoardComponentCount >= Math.max(4, LOW_FIDELITY_MIN_EXPLICIT_COMPONENTS - 2) &&
    fallbackProneVectorCount >= LOW_FIDELITY_MIN_VECTOR_FALLBACKS
  ) {
    reasons.push(
      `Direct geometry payload contains ${fallbackProneVectorCount} small vector nodes without icon-like semantics; logo/icon fidelity may degrade.`
    );
  }
  if (
    instanceCount >= LOW_FIDELITY_MIN_INSTANCE_COUNT &&
    textNodeCount > 0 &&
    textNodeCount / instanceCount <= LOW_FIDELITY_MAX_TEXT_TO_INSTANCE_RATIO
  ) {
    reasons.push(
      `Direct geometry payload exposes relatively few text descendants (${textNodeCount} text nodes across ${instanceCount} instances).`
    );
  }
  return reasons;
};

export const applyAuthoritativeFigmaSubtrees = ({
  file,
  subtrees
}: {
  file: FigmaFileResponse;
  subtrees: Array<{ nodeId: string; document: unknown }>;
}): {
  file: FigmaFileResponse;
  appliedNodeIds: string[];
} => {
  const root = isRecord(file.document) ? (file.document as FigmaNodeLike) : undefined;
  if (!root || subtrees.length === 0) {
    return {
      file,
      appliedNodeIds: []
    };
  }

  const replacementsById = new Map<string, FigmaNodeLike>();
  const appliedNodeIds: string[] = [];
  for (const subtree of subtrees) {
    const nodeId = subtree.nodeId.trim();
    if (!nodeId || !isRecord(subtree.document) || !findNodeById({ root, targetId: nodeId })) {
      continue;
    }
    replacementsById.set(nodeId, subtree.document as FigmaNodeLike);
    appliedNodeIds.push(nodeId);
  }

  if (replacementsById.size === 0) {
    return {
      file,
      appliedNodeIds: []
    };
  }

  return {
    file: {
      ...file,
      document: mergeNodesIntoTree({
        node: root,
        replacementsById
      })
    },
    appliedNodeIds: appliedNodeIds.sort((left, right) => left.localeCompare(right))
  };
};

export const fetchAuthoritativeFigmaSubtrees = async ({
  fileKey,
  accessToken,
  file,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  maxScreenCandidates,
  screenNamePattern,
  figmaRestCircuitBreaker,
  pipelineDiagnosticLimits
}: {
  fileKey: string;
  accessToken: string;
  file: FigmaFileResponse;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  maxScreenCandidates: number;
  screenNamePattern?: string;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<Array<{ nodeId: string; document: unknown }>> => {
  const root = isRecord(file.document) ? (file.document as FigmaNodeLike) : undefined;
  if (!root || detectLowFidelityReasons(file).length === 0) {
    return [];
  }

  const includeScreenNamePattern = toScreenNamePattern({
    screenNamePattern,
    onLog
  });
  const screenCandidatesWithSize = collectScreenCandidates({
    root,
    maxCandidates: Math.min(MAX_AUTHORITATIVE_SUBTREE_CANDIDATES, Math.max(1, maxScreenCandidates)),
    requireMinSize: true,
    screenNamePattern: includeScreenNamePattern
  });
  const candidateIds = screenCandidatesWithSize.candidates
    .map((candidate) => candidate.id?.trim())
    .filter((candidateId): candidateId is string => Boolean(candidateId));
  const authoritativeSubtrees: Array<{ nodeId: string; document: unknown }> = [];

  const fetchScreenSubtree = async ({
    nodeId,
    includeGeometry
  }: {
    nodeId: string;
    includeGeometry: boolean;
  }): Promise<FigmaNodeLike | undefined> => {
    const payload = await executeFigmaRequest({
      url: buildNodesUrl({
        fileKey,
        ids: [nodeId],
        includeGeometry
      }),
      requestLabel: `nodes authoritative ${nodeId}${includeGeometry ? " geometry=paths" : ""}`,
      accessToken,
      timeoutMs,
      maxRetries,
      fetchImpl,
      onLog,
      allowTooLargeFallback: true,
      ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });
    return extractNodeDocuments(payload).get(nodeId);
  };

  for (const nodeId of candidateIds) {
    let authoritativeDocument: FigmaNodeLike | undefined;
    try {
      authoritativeDocument = await fetchScreenSubtree({
        nodeId,
        includeGeometry: true
      });
    } catch (error) {
      if (!(error instanceof FigmaTooLargeError)) {
        throw error;
      }
      onLog(
        `Authoritative subtree fetch for '${nodeId}' was too large with geometry=paths; retrying without geometry.`
      );
      authoritativeDocument = await fetchScreenSubtree({
        nodeId,
        includeGeometry: false
      });
    }
    if (!authoritativeDocument) {
      onLog(`Authoritative subtree fetch for '${nodeId}' returned no document; keeping REST subtree.`);
      continue;
    }
    authoritativeSubtrees.push({
      nodeId,
      document: authoritativeDocument
    });
  }

  return authoritativeSubtrees;
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
  bootstrapDepth,
  figmaRestCircuitBreaker,
  pipelineDiagnosticLimits
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  bootstrapDepth: number;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
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
        allowTooLargeFallback: true,
        ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });
      return toFigmaFileOrParseError({
        payload,
        requestLabel: `files depth=${depth}`,
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      }) as FigmaFileLike;
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
    message: "Figma bootstrap request failed: could not fetch even at depth=1.",
    ...(pipelineDiagnosticLimits ? { limits: pipelineDiagnosticLimits } : {})
  });
};

const fetchLatestFileVersionId = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  figmaRestCircuitBreaker,
  pipelineDiagnosticLimits
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<string | undefined> => {
  const versionsUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/versions?page_size=1`;
  const payload = await executeFigmaRequest({
    url: versionsUrl,
    requestLabel: "files versions page_size=1",
    accessToken,
    timeoutMs,
    maxRetries,
    fetchImpl,
    onLog,
    allowTooLargeFallback: false,
    ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
    ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
  });
  const record = toRecordOrParseError({
    payload,
    requestLabel: "files versions page_size=1",
    ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
  });
  const versions = Array.isArray(record.versions) ? record.versions : [];
  const first = versions.length > 0 && isRecord(versions[0]) ? versions[0] : undefined;
  const versionId = typeof first?.id === "string" ? first.id.trim() : "";
  return versionId.length > 0 ? versionId : undefined;
};

const resolveStagedIncrementalContext = async ({
  cacheDir,
  fileKey,
  currentLastModified,
  cacheTtlMs,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  figmaRestCircuitBreaker,
  pipelineDiagnosticLimits
}: {
  cacheDir: string;
  fileKey: string;
  currentLastModified: string;
  cacheTtlMs: number;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<{ fileVersionId?: string; context?: FigmaStagedIncrementalContext }> => {
  let fileVersionId: string | undefined;
  try {
    fileVersionId = await fetchLatestFileVersionId({
      fileKey,
      accessToken,
      timeoutMs,
      maxRetries,
      fetchImpl,
      onLog,
      ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });
  } catch (error) {
    onLog(
      `Figma incremental versions check failed for file '${fileKey}', falling back to full staged fetch: ${getErrorMessage(error)}.`
    );
    return {};
  }

  if (!fileVersionId) {
    onLog(`Figma incremental skipped for file '${fileKey}' (missing latest version id).`);
    return {};
  }

  const latestIndexPath = toFigmaCacheLatestIndexPath({ cacheDir, fileKey });
  const latestIndex = await readLatestCacheIndex({
    cacheIndexPath: latestIndexPath,
    fileKey,
    onLog
  });
  if (!latestIndex) {
    onLog(`Figma incremental skipped for file '${fileKey}' (no previous cache index).`);
    return { fileVersionId };
  }
  if (latestIndex.lastModified === currentLastModified) {
    onLog(`Figma incremental skipped for file '${fileKey}' (no previous cache revision).`);
    return { fileVersionId };
  }

  const previousCacheFilePath = toFigmaCacheFilePath({
    cacheDir,
    fileKey,
    lastModified: latestIndex.lastModified
  });
  const previousEntry = await readCacheEntryFile({
    cacheFilePath: previousCacheFilePath,
    fileKey,
    onLog,
    cacheMissLabel: "previous cache entry missing"
  });
  if (!previousEntry) {
    onLog(`Figma incremental skipped for file '${fileKey}' (previous cache entry unavailable).`);
    return { fileVersionId };
  }

  const previousAgeMs = Date.now() - previousEntry.cachedAt;
  if (!Number.isFinite(previousAgeMs) || previousAgeMs < 0 || previousAgeMs > cacheTtlMs) {
    onLog(
      `Figma incremental skipped for file '${fileKey}' (previous cache stale, age=${Math.max(0, Math.trunc(previousAgeMs))}ms).`
    );
    return { fileVersionId };
  }

  const previousRootNode = isRecord(previousEntry.file.document) ? (previousEntry.file.document as FigmaNodeLike) : undefined;
  if (!previousRootNode) {
    onLog(`Figma incremental skipped for file '${fileKey}' (previous cache root node missing).`);
    return { fileVersionId };
  }

  const previousCandidateSubtreeHashes = previousEntry.candidateSubtreeHashes;
  if (!previousCandidateSubtreeHashes || Object.keys(previousCandidateSubtreeHashes).length === 0) {
    onLog(`Figma incremental skipped for file '${fileKey}' (previous subtree hashes missing).`);
    return { fileVersionId };
  }

  onLog(
    `Figma incremental enabled for file '${fileKey}' (previousLastModified=${latestIndex.lastModified}, currentVersion=${fileVersionId}).`
  );
  return {
    fileVersionId,
    context: {
      fileVersionId,
      previousRootNode,
      previousCandidateSubtreeHashes
    }
  };
};

export const fetchFigmaFile = async ({
  fileKey,
  accessToken,
  timeoutMs,
  maxRetries,
  fetchImpl,
  onLog,
  figmaRestCircuitBreaker,
  bootstrapDepth,
  nodeBatchSize,
  nodeFetchConcurrency,
  adaptiveBatchingEnabled,
  maxScreenCandidates,
  screenNamePattern,
  cacheEnabled,
  cacheTtlMs,
  cacheDir,
  pipelineDiagnosticLimits
}: {
  fileKey: string;
  accessToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl: typeof fetch;
  onLog: (message: string) => void;
  figmaRestCircuitBreaker?: FigmaRestCircuitBreaker;
  bootstrapDepth: number;
  nodeBatchSize: number;
  nodeFetchConcurrency: number;
  adaptiveBatchingEnabled: boolean;
  maxScreenCandidates: number;
  screenNamePattern?: string;
  cacheEnabled: boolean;
  cacheTtlMs: number;
  cacheDir: string;
  pipelineDiagnosticLimits?: PipelineDiagnosticLimits;
}): Promise<FigmaFetchResult> => {
  const resolvedCacheDir = cacheDir.trim();

  const fetchFreshFile = async ({
    currentLastModified,
    cacheTtlMsForIncremental,
    allowIncremental
  }: {
    currentLastModified?: string;
    cacheTtlMsForIncremental?: number;
    allowIncremental?: boolean;
  }): Promise<{
    result: FigmaFetchResult;
    fileVersionId?: string;
    candidateSubtreeHashes?: Record<string, string>;
  }> => {
    let stagedFileVersionId: string | undefined;
    let stagedIncrementalContext: FigmaStagedIncrementalContext | undefined;
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
      allowTooLargeFallback: true,
      ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });
      const file = toFigmaFileOrParseError({
        payload,
        requestLabel: "files geometry=paths",
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });
      const lowFidelityReasons = detectLowFidelityReasons(file);

      return {
        result: {
          file,
          diagnostics: {
            sourceMode: "geometry-paths",
            fetchedNodes: 0,
            degradedGeometryNodes: [],
            ...(lowFidelityReasons.length > 0
              ? {
                  lowFidelityDetected: true,
                  lowFidelityReasons
                }
              : {})
          }
        },
        ...(typeof stagedFileVersionId === "string" ? { fileVersionId: stagedFileVersionId } : {})
      };
    } catch (error) {
      if (!(error instanceof FigmaTooLargeError)) {
        throw error;
      }
      onLog("Primary Figma fetch is too large; switching to staged node fetch.");
    }

    if (
      allowIncremental &&
      typeof currentLastModified === "string" &&
      currentLastModified.length > 0 &&
      typeof cacheTtlMsForIncremental === "number"
    ) {
      const resolvedIncremental = await resolveStagedIncrementalContext({
        cacheDir: resolvedCacheDir,
        fileKey,
        currentLastModified,
        cacheTtlMs: cacheTtlMsForIncremental,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });
      stagedFileVersionId = resolvedIncremental.fileVersionId;
      stagedIncrementalContext = resolvedIncremental.context;
    }

    const bootstrapFile = await fetchBootstrapFile({
      fileKey,
      accessToken,
      timeoutMs,
      maxRetries,
      fetchImpl,
      onLog,
      bootstrapDepth,
      ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });

    const rootNode = isRecord(bootstrapFile.document) ? bootstrapFile.document : undefined;
    if (!rootNode) {
      return {
        result: {
          file: bootstrapFile,
          diagnostics: {
            sourceMode: "staged-nodes",
            fetchedNodes: 0,
            degradedGeometryNodes: []
          }
        },
        ...(typeof stagedFileVersionId === "string" ? { fileVersionId: stagedFileVersionId } : {})
      };
    }

    const includeScreenNamePattern = toScreenNamePattern({ screenNamePattern, onLog });
    const screenCandidatesWithSize = collectScreenCandidates({
      root: rootNode,
      maxCandidates: maxScreenCandidates,
      requireMinSize: true,
      screenNamePattern: includeScreenNamePattern
    });
    const screenCandidateSelection =
      screenCandidatesWithSize.candidates.length > 0
        ? screenCandidatesWithSize
        : collectScreenCandidates({
            root: rootNode,
            maxCandidates: maxScreenCandidates,
            requireMinSize: false,
            screenNamePattern: includeScreenNamePattern
          });
    const usedMinSizePass = screenCandidatesWithSize.candidates.length > 0;
    onLog(
      `Staged candidate filter pass=${usedMinSizePass ? "min-size" : "no-min-size"} total=${screenCandidateSelection.stats.total} excludedByPage=${screenCandidateSelection.stats.excludedByPage} excludedByName=${screenCandidateSelection.stats.excludedByName} excludedByPattern=${screenCandidateSelection.stats.excludedByPattern} selected=${screenCandidateSelection.stats.selected}.`
    );

    const candidateIds = screenCandidateSelection.candidates
      .map((node) => (typeof node.id === "string" ? node.id : ""))
      .filter((id, index, values) => id.length > 0 && values.indexOf(id) === index)
      .slice(0, maxScreenCandidates);

    if (candidateIds.length === 0) {
      onLog("Staged fetch found no screen candidates; using bootstrap tree only.");
      return {
        result: {
          file: bootstrapFile,
          diagnostics: {
            sourceMode: "staged-nodes",
            fetchedNodes: 0,
            degradedGeometryNodes: []
          }
        },
        ...(typeof stagedFileVersionId === "string" ? { fileVersionId: stagedFileVersionId } : {})
      };
    }

  const replacementNodes = new Map<string, FigmaNodeLike>();
  const networkFetchedNodeIds = new Set<string>();
  const degradedGeometryNodes = new Set<string>();
  const candidateSubtreeHashes = new Map<string, string>();
  let dynamicNodeBatchSize = Math.max(1, nodeBatchSize);
  let oversizedBatchCount = 0;

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
          allowTooLargeFallback: true,
          ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
          ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
        });

        const documents = extractNodeDocuments(payload);
        for (const id of ids) {
          const node = documents.get(id);
          if (!node) {
            continue;
          }
          replacementNodes.set(id, node);
          networkFetchedNodeIds.add(id);
          recoveredCount += 1;
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

    let fallbackReason: "oversized" | "timeout" | null = null;
    try {
      const payload = await executeFigmaRequest({
        url: buildNodesUrl({ fileKey, ids, includeGeometry: true }),
        requestLabel: `nodes geometry (${ids.length})`,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        allowTooLargeFallback: true,
        ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });

      const documents = extractNodeDocuments(payload);
      for (const id of ids) {
        const node = documents.get(id);
        if (node) {
          replacementNodes.set(id, node);
          networkFetchedNodeIds.add(id);
        }
      }
      return;
    } catch (error) {
      if (error instanceof FigmaTooLargeError) {
        fallbackReason = "oversized";
      } else if (isTimeoutError(error)) {
        fallbackReason = "timeout";
      } else {
        throw error;
      }

      if (adaptiveBatchingEnabled && ids.length >= dynamicNodeBatchSize && dynamicNodeBatchSize > 1) {
        oversizedBatchCount += 1;
        if (oversizedBatchCount >= 2) {
          const previousBatchSize = dynamicNodeBatchSize;
          dynamicNodeBatchSize = Math.max(1, Math.floor(dynamicNodeBatchSize / 2));
          oversizedBatchCount = 0;
          if (dynamicNodeBatchSize !== previousBatchSize) {
            onLog(
              `Adaptive staged fetch reduced node batch size from ${previousBatchSize} to ${dynamicNodeBatchSize} after oversized/timeout responses.`
            );
          }
        }
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
    onLog(
      fallbackReason === "timeout"
        ? `Node '${nodeId}' timed out with geometry; retrying without geometry.`
        : `Node '${nodeId}' is too large with geometry; retrying without geometry.`
    );

    try {
      const payload = await executeFigmaRequest({
        url: buildNodesUrl({ fileKey, ids: [nodeId], includeGeometry: false }),
        requestLabel: `nodes no-geometry (${nodeId})`,
        accessToken,
        timeoutMs,
        maxRetries,
        fetchImpl,
        onLog,
        allowTooLargeFallback: false,
        ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
        ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
      });
      const documents = extractNodeDocuments(payload);
      const fallbackNode = documents.get(nodeId);
      if (fallbackNode) {
        replacementNodes.set(nodeId, fallbackNode);
        networkFetchedNodeIds.add(nodeId);
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

  let geometryCandidateIds = [...candidateIds];
  if (stagedIncrementalContext) {
    try {
      const snapshotNodes = new Map<string, FigmaNodeLike>();
      const snapshotBatchSize = Math.max(1, nodeBatchSize);

      const fetchSnapshotNodeGroup = async (ids: string[]): Promise<void> => {
        if (ids.length === 0) {
          return;
        }
        try {
          const payload = await executeFigmaRequest({
            url: buildNodesUrl({ fileKey, ids, includeGeometry: false }),
            requestLabel: `nodes snapshot (${ids.length})`,
            accessToken,
            timeoutMs,
            maxRetries,
            fetchImpl,
            onLog,
            allowTooLargeFallback: true,
            ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
            ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
          });
          const documents = extractNodeDocuments(payload);
          for (const id of ids) {
            const node = documents.get(id);
            if (node) {
              snapshotNodes.set(id, node);
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
          await fetchSnapshotNodeGroup(ids.slice(0, midpoint));
          await fetchSnapshotNodeGroup(ids.slice(midpoint));
          return;
        }

        const nodeId = ids[0];
        throw new Error(`Incremental snapshot fetch too large for node '${nodeId}'.`);
      };

      let nextSnapshotIndex = 0;
      const takeNextSnapshotBatch = (): string[] => {
        if (nextSnapshotIndex >= candidateIds.length) {
          return [];
        }
        const slice = candidateIds.slice(nextSnapshotIndex, nextSnapshotIndex + snapshotBatchSize);
        nextSnapshotIndex += slice.length;
        return slice;
      };

      const snapshotWorkerCount = Math.min(
        Math.max(1, nodeFetchConcurrency),
        Math.max(1, Math.ceil(candidateIds.length / snapshotBatchSize))
      );

      await Promise.all(
        Array.from({ length: snapshotWorkerCount }, async () => {
          for (;;) {
            const batch = takeNextSnapshotBatch();
            if (batch.length === 0) {
              return;
            }
            await fetchSnapshotNodeGroup(batch);
          }
        })
      );

      const changedCandidateIds: string[] = [];
      let reusedCount = 0;
      for (const nodeId of candidateIds) {
        const snapshotNode = snapshotNodes.get(nodeId);
        if (snapshotNode) {
          candidateSubtreeHashes.set(nodeId, toNodeSubtreeHash(snapshotNode));
        }

        const currentHash = candidateSubtreeHashes.get(nodeId);
        const previousHash = stagedIncrementalContext.previousCandidateSubtreeHashes[nodeId];
        if (currentHash && previousHash && currentHash === previousHash) {
          const previousNode = findNodeById({
            root: stagedIncrementalContext.previousRootNode,
            targetId: nodeId
          });
          if (previousNode) {
            replacementNodes.set(nodeId, previousNode);
            reusedCount += 1;
            continue;
          }
        }
        changedCandidateIds.push(nodeId);
      }
      geometryCandidateIds = changedCandidateIds;
      onLog(`Figma incremental reuse=${reusedCount}, changed=${geometryCandidateIds.length}.`);
    } catch (error) {
      onLog(
        `Figma incremental fallback for file '${fileKey}': ${getErrorMessage(error)}. Fetching all candidate nodes with geometry.`
      );
      geometryCandidateIds = [...candidateIds];
      candidateSubtreeHashes.clear();
    }
  }

  let nextNodeIndex = 0;
  const takeNextBatch = (): string[] => {
    if (nextNodeIndex >= geometryCandidateIds.length) {
      return [];
    }
    const batchSize = Math.max(1, dynamicNodeBatchSize);
    const slice = geometryCandidateIds.slice(nextNodeIndex, nextNodeIndex + batchSize);
    nextNodeIndex += slice.length;
    return slice;
  };

  if (geometryCandidateIds.length > 0) {
    const workerCount = Math.min(
      Math.max(1, nodeFetchConcurrency),
      Math.max(1, Math.ceil(geometryCandidateIds.length / Math.max(1, dynamicNodeBatchSize)))
    );
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (;;) {
          const batch = takeNextBatch();
          if (batch.length === 0) {
            return;
          }
          await fetchNodeGroup(batch);
        }
      })
    );
  }

    for (const nodeId of candidateIds) {
      if (candidateSubtreeHashes.has(nodeId)) {
        continue;
      }
      const candidateNode = findNodeById({ root: rootNode, targetId: nodeId });
      if (candidateNode) {
        candidateSubtreeHashes.set(nodeId, toNodeSubtreeHash(candidateNode));
      }
    }

    const mergedRoot = mergeNodesIntoTree({
      node: rootNode,
      replacementsById: replacementNodes
    });

    const candidateHashRecord = toSortedHashRecord(candidateSubtreeHashes);
    const resolvedFileVersionId = stagedIncrementalContext?.fileVersionId ?? stagedFileVersionId;
    return {
      result: {
        file: {
          ...bootstrapFile,
          document: mergedRoot
        },
        diagnostics: {
          sourceMode: "staged-nodes",
          fetchedNodes: networkFetchedNodeIds.size,
          degradedGeometryNodes: [...degradedGeometryNodes].sort((left, right) => left.localeCompare(right))
        }
      },
      ...(typeof resolvedFileVersionId === "string" ? { fileVersionId: resolvedFileVersionId } : {}),
      ...(Object.keys(candidateHashRecord).length > 0 ? { candidateSubtreeHashes: candidateHashRecord } : {})
    };
  };

  if (!cacheEnabled || resolvedCacheDir.length === 0) {
    onLog("Figma cache disabled; fetching fresh data.");
    const freshOutcome = await fetchFreshFile({ allowIncremental: false });
    return freshOutcome.result;
  }

  const resolvedCacheTtlMs = Math.max(1, Math.trunc(cacheTtlMs));
  const metadataUrl = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=1`;

  let lastModified: string | undefined;
  try {
    const metadataPayload = await executeFigmaRequest({
      url: metadataUrl,
      requestLabel: "files metadata depth=1",
      accessToken,
      timeoutMs,
      maxRetries,
      fetchImpl,
      onLog,
      allowTooLargeFallback: false,
      ...(figmaRestCircuitBreaker ? { figmaRestCircuitBreaker } : {}),
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });
    const metadataRecord = toRecordOrParseError({
      payload: metadataPayload,
      requestLabel: "files metadata depth=1",
      ...(pipelineDiagnosticLimits ? { pipelineDiagnosticLimits } : {})
    });
    const value = typeof metadataRecord.lastModified === "string" ? metadataRecord.lastModified.trim() : "";
    if (value.length > 0) {
      lastModified = value;
    }
  } catch (error) {
    onLog(`Figma cache metadata check failed for file '${fileKey}': ${getErrorMessage(error)}.`);
    const freshOutcome = await fetchFreshFile({ allowIncremental: false });
    return freshOutcome.result;
  }

  if (!lastModified) {
    onLog(`Figma cache miss for file '${fileKey}' (missing lastModified metadata).`);
    const freshOutcome = await fetchFreshFile({ allowIncremental: false });
    return freshOutcome.result;
  }

  const cacheFilePath = toFigmaCacheFilePath({
    cacheDir: resolvedCacheDir,
    fileKey,
    lastModified
  });

  const cachedResult = await readCachedFigmaResult({
    cacheFilePath,
    fileKey,
    lastModified,
    cacheTtlMs: resolvedCacheTtlMs,
    onLog
  });
  if (cachedResult) {
    return cachedResult;
  }

  const freshOutcome = await fetchFreshFile({
    currentLastModified: lastModified,
    cacheTtlMsForIncremental: resolvedCacheTtlMs,
    allowIncremental: true
  });
  await writeCachedFigmaResult({
    cacheDir: resolvedCacheDir,
    cacheFilePath,
    fileKey,
    lastModified,
    cacheTtlMs: resolvedCacheTtlMs,
    ...(typeof freshOutcome.fileVersionId === "string" ? { fileVersionId: freshOutcome.fileVersionId } : {}),
    ...(freshOutcome.candidateSubtreeHashes ? { candidateSubtreeHashes: freshOutcome.candidateSubtreeHashes } : {}),
    result: freshOutcome.result,
    onLog
  });
  return freshOutcome.result;
};
