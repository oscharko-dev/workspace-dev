import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES } from "./constants.js";

function applySecurityHeaders({
  response,
  allowFrameEmbedding,
  cacheControl
}: {
  response: ServerResponse;
  allowFrameEmbedding?: boolean;
  cacheControl?: string;
}): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cache-control", cacheControl ?? "no-store");
  if (!allowFrameEmbedding) {
    response.setHeader("x-frame-options", "SAMEORIGIN");
    response.setHeader("content-security-policy", "frame-ancestors 'self'");
    return;
  }

  response.removeHeader("x-frame-options");
  response.removeHeader("content-security-policy");
}

export function sendJson({
  response,
  statusCode,
  payload
}: {
  response: ServerResponse;
  statusCode: number;
  payload: unknown;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({ response });
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

export function sendText({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl,
  allowFrameEmbedding
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: string;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding })
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
  allowFrameEmbedding
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: Buffer;
  cacheControl?: string;
  allowFrameEmbedding?: boolean;
}): void {
  response.statusCode = statusCode;
  applySecurityHeaders({
    response,
    ...(cacheControl === undefined ? {} : { cacheControl }),
    ...(allowFrameEmbedding === undefined ? {} : { allowFrameEmbedding })
  });
  response.setHeader("content-type", contentType);
  response.end(payload);
}

export async function readJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let body = "";
  let bodyBytes = 0;

  for await (const chunk of request) {
    const normalizedChunkBuffer =
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    bodyBytes += normalizedChunkBuffer.byteLength;
    if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, error: "Request body exceeds 1 MiB size limit." };
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
    return { ok: false, error: "Invalid JSON payload." };
  }
}
