import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_REQUEST_BODY_BYTES } from "./constants.js";
import { readJsonBody, sendBuffer, sendJson, sendText } from "./http-helpers.js";

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
    end(payload?: string | Buffer) {
      this.body = payload;
      return this;
    }
  } as unknown as ServerResponse & {
    body?: Buffer | string;
    headers: Record<string, string>;
  };
}

function toIncomingMessage(chunks: Array<string | Buffer>): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

test("sendJson writes JSON content-type and trailing newline", () => {
  const response = createMockResponse();
  sendJson({
    response,
    statusCode: 202,
    payload: { ok: true }
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body, "{\"ok\":true}\n");
});

test("sendText and sendBuffer write payloads with optional cache-control", () => {
  const textResponse = createMockResponse();
  sendText({
    response: textResponse,
    statusCode: 200,
    contentType: "text/plain; charset=utf-8",
    payload: "hello",
    cacheControl: "no-store"
  });
  assert.equal(textResponse.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(textResponse.headers["cache-control"], "no-store");
  assert.equal(textResponse.body, "hello");

  const bufferResponse = createMockResponse();
  sendBuffer({
    response: bufferResponse,
    statusCode: 200,
    contentType: "application/octet-stream",
    payload: Buffer.from("ok", "utf8")
  });
  assert.equal(bufferResponse.headers["content-type"], "application/octet-stream");
  assert.deepEqual(bufferResponse.body, Buffer.from("ok", "utf8"));
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
    assert.deepEqual(parsed, { ok: false, error: "Invalid JSON payload." });
  });

  await assert.doesNotReject(async () => {
    const parsed = await readJsonBody(toIncomingMessage([Buffer.from("a".repeat(MAX_REQUEST_BODY_BYTES + 1), "utf8")]));
    assert.deepEqual(parsed, { ok: false, error: "Request body exceeds 1 MiB size limit." });
  });
});
