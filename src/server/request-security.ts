import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const JSON_CONTENT_TYPE_PATTERN = /^application\/json(?:\s*(?:;|$))/i;
const ALLOWED_SEC_FETCH_SITE_VALUES = new Set(["same-origin", "same-site"]);

interface WriteRequestValidationSuccess {
  ok: true;
}

interface WriteRequestValidationFailure {
  ok: false;
  statusCode: number;
  payload: {
    error: "FORBIDDEN_REQUEST_ORIGIN" | "UNSUPPORTED_MEDIA_TYPE";
    message: string;
  };
}

type WriteRequestValidationResult = WriteRequestValidationSuccess | WriteRequestValidationFailure;
type SameOriginRequestValidationResult = WriteRequestValidationSuccess | WriteRequestValidationFailure;

interface ImportSessionEventAuthValidationSuccess {
  ok: true;
  principal: {
    scheme: "bearer";
  };
}

interface ImportSessionEventAuthValidationFailure {
  ok: false;
  statusCode: 401 | 503;
  payload: {
    error: "UNAUTHORIZED" | "AUTHENTICATION_UNAVAILABLE";
    message: string;
  };
  wwwAuthenticate?: string;
}

export type ImportSessionEventAuthValidationResult =
  | ImportSessionEventAuthValidationSuccess
  | ImportSessionEventAuthValidationFailure;

const getHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
};

const normalizeOrigin = (value: string | undefined): string | undefined => {
  if (!value || value.trim().length === 0) {
    return undefined;
  }
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
};

const normalizeOriginHost = (host: string): string => {
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]`;
  }
  return host;
};

const isLoopbackLikeHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]"
  );
};

export const getAllowedWriteOrigins = ({
  host,
  port
}: {
  host: string;
  port: number;
}): Set<string> => {
  const allowedOrigins = new Set<string>([`http://${normalizeOriginHost(host)}:${port}`]);
  if (isLoopbackLikeHost(host)) {
    allowedOrigins.add(`http://127.0.0.1:${port}`);
    allowedOrigins.add(`http://localhost:${port}`);
    allowedOrigins.add(`http://[::1]:${port}`);
  }
  return allowedOrigins;
};

const validateSameOriginRequest = ({
  request,
  host,
  port,
  requireBrowserMetadata = false
}: {
  request: IncomingMessage;
  host: string;
  port: number;
  requireBrowserMetadata?: boolean;
}): SameOriginRequestValidationResult => {
  const originHeader = getHeaderValue(request.headers.origin);
  const refererHeader = getHeaderValue(request.headers.referer);
  const secFetchSite = getHeaderValue(request.headers["sec-fetch-site"])?.trim().toLowerCase();
  const origin = normalizeOrigin(originHeader);
  const refererOrigin = normalizeOrigin(refererHeader);
  const allowedOrigins = getAllowedWriteOrigins({ host, port });
  const hasBrowserMetadata =
    originHeader !== undefined || refererHeader !== undefined || secFetchSite !== undefined;

  if (requireBrowserMetadata && !hasBrowserMetadata) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "FORBIDDEN_REQUEST_ORIGIN",
        message: "Browser requests to workspace-dev write routes must include same-origin metadata."
      }
    };
  }

  if (secFetchSite !== undefined && !ALLOWED_SEC_FETCH_SITE_VALUES.has(secFetchSite)) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "FORBIDDEN_REQUEST_ORIGIN",
        message: "Cross-site browser requests to workspace-dev write routes are blocked."
      }
    };
  }

  if (originHeader !== undefined && (!origin || !allowedOrigins.has(origin))) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "FORBIDDEN_REQUEST_ORIGIN",
        message: "Only same-origin browser requests may access workspace-dev write routes."
      }
    };
  }

  if (refererHeader !== undefined && (!refererOrigin || !allowedOrigins.has(refererOrigin))) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "FORBIDDEN_REQUEST_ORIGIN",
        message: "Only same-origin browser requests may access workspace-dev write routes."
      }
    };
  }

  if (hasBrowserMetadata && originHeader === undefined && refererHeader === undefined) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        error: "FORBIDDEN_REQUEST_ORIGIN",
        message: "Browser requests to workspace-dev write routes must include same-origin metadata."
      }
    };
  }

  return { ok: true };
};

export const validateWriteRequest = ({
  request,
  host,
  port
}: {
  request: IncomingMessage;
  host: string;
  port: number;
}): WriteRequestValidationResult => {
  const contentType = getHeaderValue(request.headers["content-type"]);
  if (!contentType || !JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
    return {
      ok: false,
      statusCode: 415,
      payload: {
        error: "UNSUPPORTED_MEDIA_TYPE",
        message: "Write routes require 'Content-Type: application/json'."
      }
    };
  }

  return validateSameOriginRequest({ request, host, port });
};

const WORKSPACE_BEARER_REALM = "workspace-dev";

const normalizeConfiguredBearerToken = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readBearerToken = (request: IncomingMessage): string | undefined => {
  const authorization = getHeaderValue(request.headers.authorization);
  if (!authorization) {
    return undefined;
  }

  if (authorization.length <= "Bearer".length) {
    return undefined;
  }

  const expectedScheme = "bearer";
  for (let index = 0; index < expectedScheme.length; index += 1) {
    const code = authorization.charCodeAt(index);
    const normalized =
      code >= 0x41 && code <= 0x5a
        ? String.fromCharCode(code + 0x20)
        : authorization[index];
    if (normalized !== expectedScheme[index]) {
      return undefined;
    }
  }

  let tokenStart = "Bearer".length;
  while (tokenStart < authorization.length) {
    const code = authorization.charCodeAt(tokenStart);
    if (code !== 0x20 && code !== 0x09) {
      break;
    }
    tokenStart += 1;
  }

  if (tokenStart === "Bearer".length || tokenStart >= authorization.length) {
    return undefined;
  }

  let tokenEnd = authorization.length;
  while (tokenEnd > tokenStart) {
    const code = authorization.charCodeAt(tokenEnd - 1);
    if (code !== 0x20 && code !== 0x09) {
      break;
    }
    tokenEnd -= 1;
  }

  return tokenEnd > tokenStart
    ? authorization.slice(tokenStart, tokenEnd)
    : undefined;
};

const tokensMatch = (expected: string, candidate: string): boolean => {
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
};

export const validateImportSessionEventWriteAuth = ({
  request,
  bearerToken,
  routeLabel,
}: {
  request: IncomingMessage;
  bearerToken?: string;
  routeLabel: string;
}): ImportSessionEventAuthValidationResult => {
  const configuredToken = normalizeConfiguredBearerToken(bearerToken);
  if (!configuredToken) {
    return {
      ok: false,
      statusCode: 503,
      payload: {
        error: "AUTHENTICATION_UNAVAILABLE",
        message: `${routeLabel} writes are disabled until server bearer authentication is configured.`
      }
    };
  }

  const receivedToken = readBearerToken(request);
  if (receivedToken && tokensMatch(configuredToken, receivedToken)) {
    return {
      ok: true,
      principal: {
        scheme: "bearer",
      },
    };
  }

  return {
    ok: false,
    statusCode: 401,
    payload: {
      error: "UNAUTHORIZED",
      message: `${routeLabel} writes require a valid Bearer token.`,
    },
    wwwAuthenticate: `Bearer realm="${WORKSPACE_BEARER_REALM}"`,
  };
};

export const validateBearerToken = ({
  request,
  bearerToken,
  routeLabel
}: {
  request: IncomingMessage;
  bearerToken?: string;
  routeLabel: string;
}): ImportSessionEventAuthValidationResult => {
  const result = validateImportSessionEventWriteAuth({
    request,
    ...(bearerToken === undefined ? {} : { bearerToken }),
    routeLabel,
  });
  if (!result.ok) {
    return {
      ...result,
      payload: {
        ...result.payload,
        message: `${routeLabel} writes require a valid Bearer token.`
      }
    };
  }

  return result;
};
