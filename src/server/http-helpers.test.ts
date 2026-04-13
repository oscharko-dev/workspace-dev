import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEFAULT_CONTENT_SECURITY_POLICY,
  MAX_REQUEST_BODY_BYTES,
  WORKSPACE_UI_CONTENT_SECURITY_POLICY,
} from "./constants.js";
import {
  readJsonBody,
  sendBuffer,
  sendJson,
  sendText,
} from "./http-helpers.js";

function createMockResponse(): ServerResponse & {
  body?: Buffer | string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[name.toLowerCase()];
      return this;
    },
    end(payload?: string | Buffer) {
      this.body = payload;
      return this;
    },
  } as unknown as ServerResponse & {
    body?: Buffer | string;
    headers: Record<string, string>;
  };
}

function toIncomingMessage(chunks: Array<string | Buffer>): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

test("sendJson writes JSON content-type, trailing newline, and default security headers", () => {
  const response = createMockResponse();
  sendJson({
    response,
    statusCode: 202,
    payload: { ok: true },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(
    response.headers["content-type"],
    "application/json; charset=utf-8",
  );
  assert.equal(
    response.headers["content-security-policy"],
    DEFAULT_CONTENT_SECURITY_POLICY,
  );
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.body, '{"ok":true}\n');
});

test("sendJson appends x-request-id to JSON error envelopes only", () => {
  const response = createMockResponse();
  response.setHeader("x-request-id", "req-helper-1");
  sendJson({
    response,
    statusCode: 400,
    payload: {
      error: "VALIDATION_ERROR",
      message: "Request validation failed.",
    },
  });

  assert.equal(
    response.body,
    '{"error":"VALIDATION_ERROR","message":"Request validation failed.","requestId":"req-helper-1"}\n',
  );
});

test("sendText supports cache control and an explicit UI CSP override", () => {
  const textResponse = createMockResponse();
  sendText({
    response: textResponse,
    statusCode: 200,
    contentType: "text/plain; charset=utf-8",
    payload: "hello",
    cacheControl: "no-store",
    contentSecurityPolicy: WORKSPACE_UI_CONTENT_SECURITY_POLICY,
  });
  assert.equal(
    textResponse.headers["content-type"],
    "text/plain; charset=utf-8",
  );
  assert.equal(textResponse.headers["cache-control"], "no-store");
  assert.equal(
    textResponse.headers["content-security-policy"],
    WORKSPACE_UI_CONTENT_SECURITY_POLICY,
  );
  assert.equal(textResponse.body, "hello");
});

test("sendBuffer applies the default CSP when frame embedding is not allowed", () => {
  const bufferResponse = createMockResponse();
  sendBuffer({
    response: bufferResponse,
    statusCode: 200,
    contentType: "application/octet-stream",
    payload: Buffer.from("ok", "utf8"),
  });
  assert.equal(
    bufferResponse.headers["content-type"],
    "application/octet-stream",
  );
  assert.equal(
    bufferResponse.headers["content-security-policy"],
    DEFAULT_CONTENT_SECURITY_POLICY,
  );
  assert.equal(bufferResponse.headers["x-frame-options"], "SAMEORIGIN");
  assert.deepEqual(bufferResponse.body, Buffer.from("ok", "utf8"));
});

test("sendBuffer omits frame-related headers when frame embedding is allowed", () => {
  const response = createMockResponse();
  sendBuffer({
    response,
    statusCode: 200,
    contentType: "text/html; charset=utf-8",
    payload: Buffer.from("<html></html>", "utf8"),
    allowFrameEmbedding: true,
    contentSecurityPolicy: WORKSPACE_UI_CONTENT_SECURITY_POLICY,
  });

  assert.equal(response.headers["content-security-policy"], undefined);
  assert.equal(response.headers["x-frame-options"], undefined);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("readJsonBody parses valid JSON, empty bodies, invalid JSON, and oversize payloads", async () => {
  await assert.doesNotReject(async () => {
    const parsed = await readJsonBody(toIncomingMessage(['{"ok":true}']));
    assert.deepEqual(parsed, { ok: true, value: { ok: true } });
  });

  await assert.doesNotReject(async () => {
    const parsed = await readJsonBody(toIncomingMessage(["   "]));
    assert.deepEqual(parsed, { ok: true, value: undefined });
  });

  await assert.doesNotReject(async () => {
    const parsed = await readJsonBody(toIncomingMessage(['{"broken"']));
    assert.deepEqual(parsed, {
      ok: false,
      reason: "INVALID_JSON",
      error: "Invalid JSON payload.",
    });
  });

  await assert.doesNotReject(async () => {
    const parsed = await readJsonBody(
      toIncomingMessage([
        Buffer.from("a".repeat(MAX_REQUEST_BODY_BYTES + 1), "utf8"),
      ]),
    );
    assert.deepEqual(parsed, {
      ok: false,
      reason: "OVERSIZE",
      error: "Request body exceeds 1 MiB size limit.",
      maxBytes: MAX_REQUEST_BODY_BYTES,
    });
  });
});

test("readJsonBody respects an explicit maxBytes override", async () => {
  const override = 2 * 1024 * 1024;

  // Body larger than the 1 MiB default but under the 2 MiB override → success.
  const underOverride = await readJsonBody(
    toIncomingMessage([
      Buffer.from(`"${"a".repeat(MAX_REQUEST_BODY_BYTES + 1024)}"`, "utf8"),
    ]),
    { maxBytes: override },
  );
  assert.equal(underOverride.ok, true);

  // Body over the override → oversize with the override echoed back.
  const overOverride = await readJsonBody(
    toIncomingMessage([Buffer.from("a".repeat(override + 1), "utf8")]),
    { maxBytes: override },
  );
  assert.deepEqual(overOverride, {
    ok: false,
    reason: "OVERSIZE",
    error: "Request body exceeds 2 MiB size limit.",
    maxBytes: override,
  });
});
