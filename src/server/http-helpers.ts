import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES } from "./constants.js";

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
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(payload)}\n`);
}

export function sendText({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: string;
  cacheControl?: string;
}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  if (cacheControl) {
    response.setHeader("cache-control", cacheControl);
  }
  response.end(payload);
}

export function sendBuffer({
  response,
  statusCode,
  contentType,
  payload,
  cacheControl
}: {
  response: ServerResponse;
  statusCode: number;
  contentType: string;
  payload: Buffer;
  cacheControl?: string;
}): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  if (cacheControl) {
    response.setHeader("cache-control", cacheControl);
  }
  response.end(payload);
}

export async function readJsonBody(
  request: IncomingMessage
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let body = "";

  for await (const chunk of request) {
    const normalizedChunk =
      typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    body += normalizedChunk;
    if (body.length > MAX_REQUEST_BODY_BYTES) {
      return { ok: false, error: "Request body exceeds 1 MiB size limit." };
    }
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
