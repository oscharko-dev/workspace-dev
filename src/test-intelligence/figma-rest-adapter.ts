/**
 * Figma REST adapter for the test-intelligence production runner
 * (Issues #1733, #1734).
 *
 * Goals enforced here:
 *   - SSRF defence: only `api.figma.com` over `https:`. URL parsing rejects
 *     non-figma hostnames, http://, embedded credentials, and missing
 *     fileKey before any network call.
 *   - Token discipline: the access token is forwarded ONLY as the
 *     `X-Figma-Token` header on outbound requests. Errors are routed through
 *     `redactHighRiskSecrets` + `sanitizeErrorMessage` so neither the token
 *     nor any token-shaped value smuggled into the response body leaks.
 *   - Failure-class disjointness: `auth_failed` (401/403, fail-closed),
 *     `not_found` (404), `rate_limited` (429), `transport` (5xx, retry once),
 *     `timeout`, `parse_error` (malformed JSON body).
 *   - Retry budget: at most one retry on a transient class. Auth/4xx never
 *     retry. Default per-request timeout 30s.
 *
 * Why we do not import the existing `figma-source.ts`: that module lives in
 * `src/job-engine/` and `lint:boundaries` blocks `src/test-intelligence/`
 * from depending on `src/job-engine/`. The test-intelligence runner needs a
 * minimal, hardened fetcher that fits this air-gap-friendly module pattern;
 * a future consolidation is tracked separately.
 */

import { sanitizeErrorMessage } from "../error-sanitization.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";

const FIGMA_REST_HOST = "api.figma.com" as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const FIGMA_URL_DESIGN_PATH_RE = /^\/(?:design|file|proto)\/([^/]+)/u;

/** Failure classes returned by {@link FigmaRestFetchError.errorClass}. */
export type FigmaRestFetchErrorClass =
  | "auth_failed"
  | "not_found"
  | "rate_limited"
  | "transport"
  | "timeout"
  | "parse_error"
  | "ssrf_refused"
  | "request_invalid";

/**
 * Stable error class with a discriminant + retryable flag. Mirrors the
 * shape used by the LLM gateway client so the production runner can
 * surface a uniform `failureClass` envelope to callers.
 */
export class FigmaRestFetchError extends Error {
  readonly errorClass: FigmaRestFetchErrorClass;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(input: {
    errorClass: FigmaRestFetchErrorClass;
    message: string;
    retryable: boolean;
    status?: number;
    cause?: unknown;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "FigmaRestFetchError";
    this.errorClass = input.errorClass;
    this.retryable = input.retryable;
    if (input.status !== undefined) {
      this.status = input.status;
    }
  }
}

/** Parsed canonical view of a Figma file/document used downstream. */
export interface FigmaRestFileSnapshot {
  /** Figma file display name. */
  name: string;
  /** ISO-8601 timestamp of the file's last modification, when present. */
  lastModified?: string;
  /** Source key used to fetch the file. */
  fileKey: string;
  /** When fetched node-scoped, the requested node id; otherwise undefined. */
  nodeId?: string;
  /** The root document. For node-scoped fetches, the requested subtree. */
  document: FigmaRestNode;
}

/** Minimal Figma REST node shape consumed by the normalizer. */
export interface FigmaRestNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  characters?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  children?: FigmaRestNode[];
  absoluteBoundingBox?: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  };
}

export interface FetchFigmaFileForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  nodeId?: string;
  /** Override for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Wall-clock timeout in ms (defaults to 30_000). */
  timeoutMs?: number;
  /** Hard upper bound on the response body, in bytes (defaults to 32 MiB). */
  maxResponseBytes?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/** Parse a public Figma URL and extract the (fileKey, nodeId?) pair. */
export const parseFigmaUrl = (
  rawUrl: string,
): { fileKey: string; nodeId?: string } => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "figmaUrl is not a valid URL",
      retryable: false,
    });
  }
  if (url.protocol !== "https:") {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `figmaUrl must use https:// (got ${url.protocol})`,
      retryable: false,
    });
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "www.figma.com" &&
    hostname !== "figma.com" &&
    hostname !== "api.figma.com"
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `figmaUrl host must be figma.com (got ${hostname})`,
      retryable: false,
    });
  }
  const match = FIGMA_URL_DESIGN_PATH_RE.exec(url.pathname);
  if (!match || !match[1]) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "figmaUrl is missing a Figma file key",
      retryable: false,
    });
  }
  const fileKey = decodeURIComponent(match[1]);
  const rawNodeId = url.searchParams.get("node-id") ?? undefined;
  const nodeId =
    rawNodeId === undefined || rawNodeId.length === 0
      ? undefined
      : rawNodeId.replace(/-/gu, ":");
  return nodeId === undefined ? { fileKey } : { fileKey, nodeId };
};

/**
 * Fetch a Figma file (or node-scoped subtree) via the Figma REST API.
 *
 * Retry policy: at most one retry, and only when the first attempt failed
 * with a transient class (5xx, 429, timeout, transport). Non-transient
 * classes (auth_failed, not_found, parse_error, ssrf_refused) fail closed.
 */
export const fetchFigmaFileForTestIntelligence = async (
  input: FetchFigmaFileForTestIntelligenceInput,
): Promise<FigmaRestFileSnapshot> => {
  const fileKey = input.fileKey.trim();
  if (fileKey.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "fileKey is required",
      retryable: false,
    });
  }
  if (typeof input.accessToken !== "string" || input.accessToken.length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: "accessToken is required",
      retryable: false,
    });
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const url = buildFigmaRestUrl({ fileKey, nodeId: input.nodeId });
  // Hard gate: the constructed URL must point at api.figma.com over https.
  // If a future change introduces a path-template bug, this assertion fails
  // closed before any token leaves the process.
  const constructed = new URL(url);
  if (
    constructed.protocol !== "https:" ||
    constructed.hostname.toLowerCase() !== FIGMA_REST_HOST
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `internal URL guard refused destination ${constructed.host}`,
      retryable: false,
    });
  }

  let lastError: FigmaRestFetchError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result: FigmaRestFileSnapshot | FigmaRestFetchError;
    try {
      result = await dispatchOnce({
        url,
        accessToken: input.accessToken,
        fileKey,
        nodeId: input.nodeId,
        timeoutMs,
        maxResponseBytes,
        fetchImpl,
      });
    } catch (err) {
      result = new FigmaRestFetchError({
        errorClass: "transport",
        message: redactBoundedMessage(
          sanitizeErrorMessage({ error: err, fallback: "transport failure" }),
        ),
        retryable: true,
        cause: err,
      });
    }
    if (!(result instanceof FigmaRestFetchError)) {
      return result;
    }
    lastError = result;
    if (!result.retryable || attempt === 2) {
      throw result;
    }
  }
  throw (
    lastError ??
    new FigmaRestFetchError({
      errorClass: "transport",
      message: "no attempts executed",
      retryable: false,
    })
  );
};

const buildFigmaRestUrl = (input: {
  fileKey: string;
  nodeId?: string;
}): string => {
  const file = encodeURIComponent(input.fileKey);
  if (input.nodeId === undefined) {
    return `https://${FIGMA_REST_HOST}/v1/files/${file}`;
  }
  const ids = encodeURIComponent(input.nodeId);
  return `https://${FIGMA_REST_HOST}/v1/files/${file}/nodes?ids=${ids}`;
};

const dispatchOnce = async (input: {
  url: string;
  accessToken: string;
  fileKey: string;
  nodeId?: string;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImpl: typeof fetch;
}): Promise<FigmaRestFileSnapshot | FigmaRestFetchError> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let response: Response;
  try {
    response = await input.fetchImpl(input.url, {
      method: "GET",
      headers: {
        "x-figma-token": input.accessToken,
        accept: "application/json",
      },
      redirect: "error",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && /aborted/iu.test(err.message)) {
      return new FigmaRestFetchError({
        errorClass: "timeout",
        message: `Figma REST request timed out after ${input.timeoutMs}ms`,
        retryable: true,
      });
    }
    return new FigmaRestFetchError({
      errorClass: "transport",
      message: redactBoundedMessage(
        sanitizeErrorMessage({
          error: err,
          fallback: "Figma REST transport failure",
        }),
      ),
      retryable: true,
      cause: err,
    });
  }
  try {
    const status = response.status;
    if (status === 401 || status === 403) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "auth_failed",
        message: `Figma REST returned ${status}: access token rejected`,
        retryable: false,
        status,
      });
    }
    if (status === 404) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma REST returned 404 for fileKey '${redactBoundedMessage(input.fileKey)}'`,
        retryable: false,
        status,
      });
    }
    if (status === 429) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "rate_limited",
        message: "Figma REST returned 429 (rate limited)",
        retryable: true,
        status,
      });
    }
    if (status >= 500 && status <= 599) {
      await drainBody(response);
      return new FigmaRestFetchError({
        errorClass: "transport",
        message: `Figma REST returned ${status}`,
        retryable: true,
        status,
      });
    }
    if (status >= 400) {
      const bodyText = await readBoundedText(response, input.maxResponseBytes);
      return new FigmaRestFetchError({
        errorClass: "request_invalid",
        message: `Figma REST returned ${status}: ${redactBoundedMessage(bodyText)}`,
        retryable: false,
        status,
      });
    }
    const bodyText = await readBoundedText(response, input.maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText) as unknown;
    } catch {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: "Figma REST response body is not valid JSON",
        retryable: false,
        status,
      });
    }
    return interpretFigmaResponse({
      payload: parsed,
      fileKey: input.fileKey,
      nodeId: input.nodeId,
    });
  } finally {
    clearTimeout(timer);
  }
};

const drainBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    /* best-effort */
  }
};

const readBoundedText = async (
  response: Response,
  maxBytes: number,
): Promise<string> => {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new FigmaRestFetchError({
      errorClass: "transport",
      message: `Figma REST response exceeds ${maxBytes} bytes`,
      retryable: false,
    });
  }
  return text;
};

const interpretFigmaResponse = (input: {
  payload: unknown;
  fileKey: string;
  nodeId?: string;
}): FigmaRestFileSnapshot | FigmaRestFetchError => {
  if (
    typeof input.payload !== "object" ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    return new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma REST response body is not a JSON object",
      retryable: false,
    });
  }
  const record = input.payload as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : input.fileKey;
  const lastModified =
    typeof record.lastModified === "string" ? record.lastModified : undefined;

  if (input.nodeId !== undefined) {
    const nodes = record.nodes;
    if (typeof nodes !== "object" || nodes === null) {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: "Figma REST node-scoped response is missing 'nodes'",
        retryable: false,
      });
    }
    const entry = (nodes as Record<string, unknown>)[input.nodeId];
    if (typeof entry !== "object" || entry === null) {
      return new FigmaRestFetchError({
        errorClass: "not_found",
        message: `Figma REST returned no node entry for '${input.nodeId}'`,
        retryable: false,
      });
    }
    const document = (entry as Record<string, unknown>).document;
    if (typeof document !== "object" || document === null) {
      return new FigmaRestFetchError({
        errorClass: "parse_error",
        message: `Figma REST node entry '${input.nodeId}' has no 'document'`,
        retryable: false,
      });
    }
    return {
      name,
      ...(lastModified !== undefined ? { lastModified } : {}),
      fileKey: input.fileKey,
      nodeId: input.nodeId,
      document: document as FigmaRestNode,
    };
  }

  const document = record.document;
  if (typeof document !== "object" || document === null) {
    return new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma REST file response is missing 'document'",
      retryable: false,
    });
  }
  return {
    name,
    ...(lastModified !== undefined ? { lastModified } : {}),
    fileKey: input.fileKey,
    document: document as FigmaRestNode,
  };
};

const MAX_REDACTED_MESSAGE_LENGTH = 240;

const redactBoundedMessage = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_REDACTED_MESSAGE_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_REDACTED_MESSAGE_LENGTH)}...`;
};
