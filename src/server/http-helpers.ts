import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  resolveStrictTransportSecurity,
  MAX_REQUEST_BODY_BYTES,
} from "./constants.js";

function appendRequestIdToErrorPayload({
  response,
  payload,
}: {
  response: ServerResponse;
  payload: unknown;
}): unknown {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return payload;
  }

  const payloadRecord = payload as Record<string, unknown>;
  if (typeof payloadRecord.error !== "string" || "requestId" in payloadRecord) {
    return payload;
  }

  const requestId = response.getHeader("x-request-id");
  if (typeof requestId !== "string" || requestId.trim().length === 0) {
    return payload;
  }

  return {
    ...payloadRecord,
    requestId,
  };
}

function applySecurityHeaders({
  response,
  allowFrameEmbedding,
  cacheControl,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  allowFrameEmbedding?: boolean;
  cacheControl?: string;
  contentSecurityPolicy?: string;
}): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cache-control", cacheControl ?? "no-store");
  const strictTransportSecurity = resolveStrictTransportSecurity();
  if (strictTransportSecurity !== undefined) {
    response.setHeader(
      "strict-transport-security",
      strictTransportSecurity,
    );
  } else {
    response.removeHeader("strict-transport-security");
  }
  if (!allowFrameEmbedding) {
    response.setHeader("x-frame-options", "SAMEORIGIN");
    response.setHeader(
      "content-security-policy",
      contentSecurityPolicy ?? DEFAULT_CONTENT_SECURITY_POLICY,
    );
    return;
  }

  response.removeHeader("x-frame-options");
  response.removeHeader("content-security-policy");
}

export function sendJson({
  response,
  statusCode,
  payload,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  payload: unknown;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(
    `${JSON.stringify(appendRequestIdToErrorPayload({ response, payload }))}\n`,
  );
}

export function sendText({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl,
  allowFrameEmbedding,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: string;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding }),
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", contentType);
  response.end(payload);
}

export function sendBuffer({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl,
  allowFrameEmbedding,
  contentSecurityPolicy,
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: Buffer;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
  contentSecurityPolicy?: string;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding }),
    ...(contentSecurityPolicy === undefined ? {} : { contentSecurityPolicy }),
  });
  response.setHeader("content-type", contentType);
  response.end(payload);
}

export type ReadJsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "OVERSIZE"; error: string; maxBytes: number }
  | { ok: false; reason: "INVALID_JSON"; error: string };

export async function readJsonBody(
  request: IncomingMessage,
  options?: { maxBytes?: number },
): Promise<ReadJsonBodyResult> {
  const maxBytes = options?.maxBytes ?? MAX_REQUEST_BODY_BYTES;
  let body = "";
  let bodyBytes = 0;

  for await (const chunk of request) {
    const normalizedChunkBuffer =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(String(chunk), "utf8");
    bodyBytes += normalizedChunkBuffer.byteLength;
    if (bodyBytes > maxBytes) {
      return {
        ok: false,
        reason: "OVERSIZE",
        error: `Request body exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB size limit.`,
        maxBytes,
      };
    }
    const normalizedChunk = normalizedChunkBuffer.toString("utf8");
    body += normalizedChunk;
  }

  if (body.trim().length === 0) {
    return { ok: true, value: undefined };
  }

  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return {
      ok: false,
      reason: "INVALID_JSON",
      error: "Invalid JSON payload.",
    };
  }
}
