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
const DEFAULT_FIGMA_IMAGE_SCALE = 2;
const ALLOWED_FIGMA_CDN_HOSTS: readonly string[] = [
  "figma.com",
  ".figma.com",
  "figma-alpha-api.s3.us-west-2.amazonaws.com",
  "figma-alpha-api.s3.amazonaws.com",
];

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

export interface FetchFigmaScreenCapturesForTestIntelligenceInput {
  fileKey: string;
  accessToken: string;
  screens: ReadonlyArray<{ screenId: string; screenName?: string }>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  scale?: number;
}

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
  const url = buildFigmaRestUrl(
    input.nodeId === undefined
      ? { fileKey }
      : { fileKey, nodeId: input.nodeId },
  );
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

  const dispatchInput =
    input.nodeId === undefined
      ? {
          url,
          accessToken: input.accessToken,
          fileKey,
          timeoutMs,
          maxResponseBytes,
          fetchImpl,
        }
      : {
          url,
          accessToken: input.accessToken,
          fileKey,
          nodeId: input.nodeId,
          timeoutMs,
          maxResponseBytes,
          fetchImpl,
        };
  let lastError: FigmaRestFetchError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let result: FigmaRestFileSnapshot | FigmaRestFetchError;
    try {
      result = await dispatchOnce(dispatchInput);
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

export const fetchFigmaScreenCapturesForTestIntelligence = async (
  input: FetchFigmaScreenCapturesForTestIntelligenceInput,
): Promise<
  Array<{
    screenId: string;
    screenName?: string;
    mimeType: "image/png";
    base64Data: string;
  }>
> => {
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
  const scale = clampImageScale(input.scale ?? DEFAULT_FIGMA_IMAGE_SCALE);
  return Promise.all(
    input.screens.map(async (screen) => {
      const screenId = screen.screenId.trim();
      if (screenId.length === 0) {
        throw new FigmaRestFetchError({
          errorClass: "request_invalid",
          message: "screenId is required",
          retryable: false,
        });
      }
      const imageUrl = await fetchFigmaRenderableImageUrl({
        fileKey,
        screenId,
        accessToken: input.accessToken,
        fetchImpl,
        timeoutMs,
        maxResponseBytes,
        scale,
      });
      const pngBytes = await fetchFigmaScreenshotBytes({
        imageUrl,
        fetchImpl,
        timeoutMs,
        maxResponseBytes,
      });
      return {
        screenId,
        ...(screen.screenName !== undefined
          ? { screenName: screen.screenName }
          : {}),
        mimeType: "image/png" as const,
        base64Data: Buffer.from(pngBytes).toString("base64"),
      };
    }),
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

const buildFigmaImageLookupUrl = (input: {
  fileKey: string;
  screenId: string;
  scale: number;
}): string => {
  const params = new URLSearchParams({
    ids: input.screenId,
    format: "png",
    scale: String(input.scale),
  });
  return `https://${FIGMA_REST_HOST}/v1/images/${encodeURIComponent(input.fileKey)}?${params.toString()}`;
};

const clampImageScale = (value: number): number =>
  Math.max(0.5, Math.min(3, value));

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
    return interpretFigmaResponse(
      input.nodeId === undefined
        ? { payload: parsed, fileKey: input.fileKey }
        : { payload: parsed, fileKey: input.fileKey, nodeId: input.nodeId },
    );
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

const fetchFigmaRenderableImageUrl = async (input: {
  fileKey: string;
  screenId: string;
  accessToken: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
  scale: number;
}): Promise<string> => {
  const url = buildFigmaImageLookupUrl({
    fileKey: input.fileKey,
    screenId: input.screenId,
    scale: input.scale,
  });
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== FIGMA_REST_HOST
  ) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: "internal URL guard refused Figma image lookup destination",
      retryable: false,
    });
  }
  const response = await dispatchHttpRequest({
    url,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  const bodyText = await readBoundedText(response, input.maxResponseBytes);
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText) as unknown;
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image lookup response body is not valid JSON",
      retryable: false,
    });
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).images !== "object" ||
    (payload as Record<string, unknown>).images === null
  ) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image lookup response is missing an images map",
      retryable: false,
    });
  }
  const imageUrl = ((payload as Record<string, unknown>).images as Record<
    string,
    unknown
  >)[input.screenId];
  if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
    throw new FigmaRestFetchError({
      errorClass: "not_found",
      message: `Figma image export returned no renderable screenshot for screen '${input.screenId}'`,
      retryable: false,
    });
  }
  assertFigmaCdnUrlIsSafe(imageUrl);
  return imageUrl;
};

const fetchFigmaScreenshotBytes = async (input: {
  imageUrl: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}): Promise<Uint8Array> => {
  assertFigmaCdnUrlIsSafe(input.imageUrl);
  const response = await dispatchHttpRequest({
    url: input.imageUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > input.maxResponseBytes) {
    throw new FigmaRestFetchError({
      errorClass: "transport",
      message: `Figma screenshot response exceeds ${input.maxResponseBytes} bytes`,
      retryable: false,
    });
  }
  if (!isValidPngBytes(bytes)) {
    throw new FigmaRestFetchError({
      errorClass: "parse_error",
      message: "Figma image export returned an invalid PNG",
      retryable: false,
    });
  }
  return bytes;
};

const dispatchHttpRequest = async (input: {
  url: string;
  accessToken?: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<Response> => {
  let lastError: FigmaRestFetchError | undefined;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetchImpl(input.url, {
        method: "GET",
        headers:
          input.accessToken === undefined
            ? { accept: "application/json" }
            : {
                "x-figma-token": input.accessToken,
                accept: "application/json",
              },
        redirect: "error",
        signal: controller.signal,
      });
      const handled = await handleHttpStatus(response, {
        retryableTransportMessage: "Figma REST returned a transient error",
      });
      if (!(handled instanceof FigmaRestFetchError)) {
        return handled;
      }
      lastError = handled;
      if (!handled.retryable || attempt === 2) {
        throw handled;
      }
    } catch (err) {
      const normalized =
        err instanceof FigmaRestFetchError
          ? err
          : new FigmaRestFetchError({
              errorClass:
                err instanceof Error && /aborted/iu.test(err.message)
                  ? "timeout"
                  : "transport",
              message:
                err instanceof Error && /aborted/iu.test(err.message)
                  ? `Figma REST request timed out after ${input.timeoutMs}ms`
                  : redactBoundedMessage(
                      sanitizeErrorMessage({
                        error: err,
                        fallback: "Figma REST transport failure",
                      }),
                    ),
              retryable: true,
              cause: err,
            });
      lastError = normalized;
      if (!normalized.retryable || attempt === 2) {
        throw normalized;
      }
    } finally {
      clearTimeout(timer);
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

const handleHttpStatus = async (
  response: Response,
  input: { retryableTransportMessage: string },
): Promise<Response | FigmaRestFetchError> => {
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
      message: "Figma REST returned 404",
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
      message: input.retryableTransportMessage,
      retryable: true,
      status,
    });
  }
  if (status >= 400) {
    await drainBody(response);
    return new FigmaRestFetchError({
      errorClass: "request_invalid",
      message: `Figma REST returned ${status}`,
      retryable: false,
      status,
    });
  }
  return response;
};

const isAllowedFigmaCdnHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  return ALLOWED_FIGMA_CDN_HOSTS.some((entry) => {
    if (entry.startsWith(".")) {
      return host.endsWith(entry);
    }
    return host === entry;
  });
};

const assertFigmaCdnUrlIsSafe = (imageUrl: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: "Figma screenshot URL is not a valid URL",
      retryable: false,
    });
  }
  if (parsed.protocol !== "https:") {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `Figma screenshot URL must use https:// (got ${parsed.protocol})`,
      retryable: false,
    });
  }
  if (!isAllowedFigmaCdnHost(parsed.hostname)) {
    throw new FigmaRestFetchError({
      errorClass: "ssrf_refused",
      message: `Figma screenshot URL host "${parsed.hostname}" is not in the Figma CDN allowlist`,
      retryable: false,
    });
  }
  return parsed;
};

const isValidPngBytes = (bytes: Uint8Array): boolean => {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
};

const MAX_REDACTED_MESSAGE_LENGTH = 240;

const redactBoundedMessage = (input: string): string => {
  const redacted = redactHighRiskSecrets(input, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
  if (redacted.length <= MAX_REDACTED_MESSAGE_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_REDACTED_MESSAGE_LENGTH)}...`;
};
