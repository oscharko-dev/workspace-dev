import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import {
  getAllowedWriteOrigins,
  validateImportSessionEventWriteAuth,
  validateWriteRequest,
} from "./request-security.js";

const createRequest = (headers: IncomingMessage["headers"]): IncomingMessage => {
  return {
    headers
  } as IncomingMessage;
};

test("request-security: getAllowedWriteOrigins keeps non-loopback hosts scoped to the exact origin", () => {
  const allowedOrigins = getAllowedWriteOrigins({
    host: "workspace-dev.internal",
    port: 1983
  });

  assert.deepEqual([...allowedOrigins].sort(), ["http://workspace-dev.internal:1983"]);
});

test("request-security: getAllowedWriteOrigins expands loopback aliases and normalizes IPv6 hosts", () => {
  const allowedOrigins = getAllowedWriteOrigins({
    host: "::1",
    port: 1983
  });

  assert.deepEqual([...allowedOrigins].sort(), [
    "http://127.0.0.1:1983",
    "http://[::1]:1983",
    "http://localhost:1983"
  ]);
});

test("request-security: getAllowedWriteOrigins keeps already-bracketed IPv6 hosts stable", () => {
  const allowedOrigins = getAllowedWriteOrigins({
    host: "[::1]",
    port: 1983
  });

  assert.equal(allowedOrigins.has("http://[::1]:1983"), true);
  assert.equal(allowedOrigins.has("http://[[::1]]:1983"), false);
});

test("request-security: getAllowedWriteOrigins treats localhost-style bind hosts as loopback aliases", () => {
  for (const host of ["localhost", "0.0.0.0", "::", "[::]"]) {
    const allowedOrigins = getAllowedWriteOrigins({ host, port: 1983 });
    assert.equal(allowedOrigins.has("http://127.0.0.1:1983"), true);
    assert.equal(allowedOrigins.has("http://localhost:1983"), true);
    assert.equal(allowedOrigins.has("http://[::1]:1983"), true);
  }
});

test("request-security: validateWriteRequest accepts application/json with charset and same-origin origin metadata", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json; charset=utf-8",
      origin: "http://127.0.0.1:1983",
      "sec-fetch-site": "same-origin"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.deepEqual(result, { ok: true });
});

test("request-security: validateWriteRequest accepts non-browser clients without origin metadata", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.deepEqual(result, { ok: true });
});

test("request-security: validateWriteRequest accepts same-site referer metadata without an origin header", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      referer: "http://localhost:1983/workspace/ui",
      "sec-fetch-site": "same-site"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.deepEqual(result, { ok: true });
});

test("request-security: validateWriteRequest accepts same-origin origin metadata without sec-fetch-site", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      origin: "http://localhost:1983"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.deepEqual(result, { ok: true });
});

test("request-security: validateWriteRequest rejects unsupported media types", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "text/plain",
      origin: "http://127.0.0.1:1983"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 415);
  assert.equal(result.payload.error, "UNSUPPORTED_MEDIA_TYPE");
});

test("request-security: validateWriteRequest rejects prefixed application/json content types", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "text/application/json",
      origin: "http://127.0.0.1:1983",
      "sec-fetch-site": "same-origin"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 415);
  assert.equal(result.payload.error, "UNSUPPORTED_MEDIA_TYPE");
});

test("request-security: validateWriteRequest rejects cross-site sec-fetch-site values", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "FORBIDDEN_REQUEST_ORIGIN");
  assert.match(result.payload.message, /cross-site browser requests/i);
});

test("request-security: validateWriteRequest rejects malformed origin headers", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      origin: "not-a-url",
      "sec-fetch-site": "same-origin"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "FORBIDDEN_REQUEST_ORIGIN");
});

test("request-security: validateWriteRequest rejects malformed referer headers", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      referer: "://broken",
      "sec-fetch-site": "same-site"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "FORBIDDEN_REQUEST_ORIGIN");
});

test("request-security: validateWriteRequest rejects browser metadata that omits both origin and referer", () => {
  const result = validateWriteRequest({
    request: createRequest({
      "content-type": "application/json",
      "sec-fetch-site": "same-origin"
    }),
    host: "127.0.0.1",
    port: 1983
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 403);
  assert.equal(result.payload.error, "FORBIDDEN_REQUEST_ORIGIN");
  assert.match(result.payload.message, /must include same-origin metadata/i);
});

test("request-security: validateImportSessionEventWriteAuth rejects writes when server auth is not configured", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer secret-token"
    }),
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.error, "AUTHENTICATION_UNAVAILABLE");
});

test("request-security: validateImportSessionEventWriteAuth rejects missing credentials", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({}),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
  assert.equal(result.wwwAuthenticate, 'Bearer realm="workspace-dev"');
});

test("request-security: validateImportSessionEventWriteAuth rejects shorter invalid bearer tokens", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer wrong"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
});

test("request-security: validateImportSessionEventWriteAuth rejects longer invalid bearer tokens", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer secret-token-extra"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
});

test("request-security: validateImportSessionEventWriteAuth rejects same-length invalid bearer tokens", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer secret-tokez"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
});

test("request-security: validateImportSessionEventWriteAuth accepts a valid bearer token", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer secret-token"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.deepEqual(result, {
    ok: true,
    principal: {
      scheme: "bearer",
    },
  });
});

test("request-security: validateImportSessionEventWriteAuth accepts bearer auth with mixed-case scheme and surrounding whitespace", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "bEaReR \t secret-token \t"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.deepEqual(result, {
    ok: true,
    principal: {
      scheme: "bearer",
    },
  });
});

test("request-security: validateImportSessionEventWriteAuth rejects empty bearer credentials after whitespace trimming", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      authorization: "Bearer \t "
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
});

test("request-security: validateImportSessionEventWriteAuth rejects non-bearer credentials", () => {
  const result = validateImportSessionEventWriteAuth({
    request: createRequest({
      cookie: "workspace_import_session_event_auth=forbidden"
    }),
    bearerToken: "secret-token",
    routeLabel: "Import session event"
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.statusCode, 401);
  assert.equal(result.payload.error, "UNAUTHORIZED");
  assert.match(result.payload.message, /bearer token/i);
});
