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

  const originHeader = getHeaderValue(request.headers.origin);
  const refererHeader = getHeaderValue(request.headers.referer);
  const secFetchSite = getHeaderValue(request.headers["sec-fetch-site"])?.trim().toLowerCase();
  const origin = normalizeOrigin(originHeader);
  const refererOrigin = normalizeOrigin(refererHeader);
  const allowedOrigins = getAllowedWriteOrigins({ host, port });
  const hasBrowserMetadata =
    originHeader !== undefined || refererHeader !== undefined || secFetchSite !== undefined;

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
