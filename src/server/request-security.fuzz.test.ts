import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import fc from "fast-check";
import { getAllowedWriteOrigins, validateWriteRequest } from "./request-security.js";

const createRequest = (headers: IncomingMessage["headers"]): IncomingMessage => {
  return { headers } as IncomingMessage;
};

const hostArb = fc.constantFrom(
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "workspace-dev.internal",
);
const portArb = fc.integer({ min: 1, max: 65535 });

test("fuzz: validateWriteRequest accepts valid JSON writes with same-origin or non-browser metadata", () => {
  fc.assert(
    fc.property(
      hostArb,
      portArb,
      fc.constantFrom("none", "origin", "referer", "origin-and-fetch", "referer-and-fetch"),
      (host, port, metadataMode) => {
        const allowedOrigins = [...getAllowedWriteOrigins({ host, port })];
        const allowedOrigin = allowedOrigins[0] ?? `http://${host}:${port}`;
        const headers: IncomingMessage["headers"] = {
          "content-type": "application/json; charset=utf-8",
        };

        if (metadataMode === "origin" || metadataMode === "origin-and-fetch") {
          headers.origin = allowedOrigin;
        }
        if (metadataMode === "referer" || metadataMode === "referer-and-fetch") {
          headers.referer = `${allowedOrigin}/workspace/ui`;
        }
        if (metadataMode === "origin-and-fetch") {
          headers["sec-fetch-site"] = "same-origin";
        }
        if (metadataMode === "referer-and-fetch") {
          headers["sec-fetch-site"] = "same-site";
        }

        const result = validateWriteRequest({
          request: createRequest(headers),
          host,
          port,
        });

        assert.deepEqual(
          result,
          { ok: true },
          `Expected request to be accepted for host=${host} port=${port} metadataMode=${metadataMode}`,
        );
      },
    ),
    { numRuns: 100 },
  );
});

test("fuzz: validateWriteRequest rejects unsupported content types before origin validation", () => {
  fc.assert(
    fc.property(hostArb, portArb, fc.constantFrom("text/plain", "text/application/json", "application/xml"), (host, port, contentType) => {
      const allowedOrigin = [...getAllowedWriteOrigins({ host, port })][0] ?? `http://${host}:${port}`;
      const result = validateWriteRequest({
        request: createRequest({
          "content-type": contentType,
          origin: allowedOrigin,
        }),
        host,
        port,
      });

      assert.equal(result.ok, false);
      if (result.ok) {
        return;
      }
      assert.equal(result.statusCode, 415);
      assert.equal(result.payload.error, "UNSUPPORTED_MEDIA_TYPE");
    }),
    { numRuns: 100 },
  );
});

test("fuzz: validateWriteRequest rejects cross-site or malformed browser metadata", () => {
  fc.assert(
    fc.property(
      hostArb,
      portArb,
      fc.constantFrom(
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        { referer: "https://evil.example/workspace/ui", "sec-fetch-site": "same-site" },
        { origin: "not-a-url", "sec-fetch-site": "same-origin" },
        { referer: "://broken", "sec-fetch-site": "same-site" },
        { "sec-fetch-site": "same-origin" },
      ),
      (host, port, metadata) => {
        const result = validateWriteRequest({
          request: createRequest({
            "content-type": "application/json",
            ...metadata,
          }),
          host,
          port,
        });

        assert.equal(result.ok, false);
        if (result.ok) {
          return;
        }
        assert.equal(result.statusCode, 403);
        assert.equal(result.payload.error, "FORBIDDEN_REQUEST_ORIGIN");
      },
    ),
    { numRuns: 100 },
  );
});
