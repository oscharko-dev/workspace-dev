/**
 * Unit tests for the shared TMS adapter utilities (Issue #2183).
 *
 * Acceptance:
 *   - `computeTmsIdempotencyKey` is deterministic for the same triple
 *     and refuses empty inputs.
 *   - `executeWithRetry` retries `TmsTransportError` and
 *     `TmsRateLimitError` up to `maxAttempts`, never retries
 *     `TmsAuthError` / `TmsValidationError`.
 *   - `loadTmsCredentialsFromEnv` reads OAuth → PAT → Bearer in order
 *     and returns `credentials_missing` when none are set.
 *   - `sanitizeTmsErrorDetail` strips URLs, applies length cap, and
 *     redacts known-bad patterns.
 *   - `chunkBatches` splits in declaration order and refuses size <= 0.
 *   - `classifyTmsHttpFailure` maps statuses to the documented classes.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  TmsAuthError,
  TmsRateLimitError,
  TmsTransportError,
  TmsValidationError,
} from "./tms-adapter-contract.js";
import {
  buildBasicAuthHeader,
  chunkBatches,
  classifyTmsHttpFailure,
  computeTmsIdempotencyKey,
  executeWithRetry,
  loadTmsCredentialsFromEnv,
  resolvePrincipalId,
  sanitizeTmsErrorDetail,
} from "./tms-shared.js";

test("computeTmsIdempotencyKey: deterministic for same tuple", () => {
  const a = computeTmsIdempotencyKey({
    tenantId: "tenant-1",
    runId: "run-1",
    testCaseId: "tc-1",
  });
  const b = computeTmsIdempotencyKey({
    tenantId: "tenant-1",
    runId: "run-1",
    testCaseId: "tc-1",
  });
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("computeTmsIdempotencyKey: distinct tuples give distinct keys", () => {
  const a = computeTmsIdempotencyKey({
    tenantId: "t",
    runId: "r",
    testCaseId: "x",
  });
  const b = computeTmsIdempotencyKey({
    tenantId: "t",
    runId: "r",
    testCaseId: "y",
  });
  assert.notEqual(a, b);
});

test("computeTmsIdempotencyKey: refuses empty inputs", () => {
  assert.throws(
    () => computeTmsIdempotencyKey({ tenantId: "", runId: "r", testCaseId: "x" }),
    /tenantId/,
  );
  assert.throws(
    () => computeTmsIdempotencyKey({ tenantId: "t", runId: "", testCaseId: "x" }),
    /runId/,
  );
});

test("executeWithRetry: returns value with attempt count 1 on first success", async () => {
  let calls = 0;
  const result = await executeWithRetry({
    adapterId: "xray",
    operation: async () => {
      calls += 1;
      return "ok";
    },
  });
  assert.equal(result.value, "ok");
  assert.equal(result.attemptCount, 1);
  assert.equal(calls, 1);
});

test("executeWithRetry: retries TmsTransportError up to maxAttempts", async () => {
  let calls = 0;
  await assert.rejects(
    executeWithRetry({
      adapterId: "xray",
      operation: async () => {
        calls += 1;
        throw new TmsTransportError("xray", `transport failure ${calls}`);
      },
      maxAttempts: 3,
      sleep: async () => {},
    }),
    TmsTransportError,
  );
  assert.equal(calls, 3);
});

test("executeWithRetry: never retries TmsAuthError", async () => {
  let calls = 0;
  await assert.rejects(
    executeWithRetry({
      adapterId: "xray",
      operation: async () => {
        calls += 1;
        throw new TmsAuthError("xray", "rejected");
      },
      maxAttempts: 5,
      sleep: async () => {},
    }),
    TmsAuthError,
  );
  assert.equal(calls, 1);
});

test("executeWithRetry: never retries TmsValidationError", async () => {
  let calls = 0;
  await assert.rejects(
    executeWithRetry({
      adapterId: "xray",
      operation: async () => {
        calls += 1;
        throw new TmsValidationError("xray", "bad", "bad");
      },
      maxAttempts: 5,
      sleep: async () => {},
    }),
    TmsValidationError,
  );
  assert.equal(calls, 1);
});

test("executeWithRetry: respects rate limit retry-after", async () => {
  let calls = 0;
  const sleepCalls: number[] = [];
  await executeWithRetry({
    adapterId: "xray",
    operation: async () => {
      calls += 1;
      if (calls < 2) throw new TmsRateLimitError("xray", 5_000, "rate-limited");
      return "ok";
    },
    maxAttempts: 2,
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  });
  assert.equal(calls, 2);
  assert.equal(sleepCalls.length, 1);
  assert.ok(sleepCalls[0]! >= 5_000, `sleep ${sleepCalls[0]} should be >= 5000`);
});

test("loadTmsCredentialsFromEnv: prefers OAuth over PAT over Bearer", () => {
  const result = loadTmsCredentialsFromEnv({
    adapterId: "xray",
    env: {
      WORKSPACE_TEST_SPACE_TMS_XRAY_OAUTH_ACCESS_TOKEN: "oauth-tok",
      WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "pat-tok",
      WORKSPACE_TEST_SPACE_TMS_XRAY_BEARER: "bearer-tok",
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.credentials.kind, "oauth2");
});

test("loadTmsCredentialsFromEnv: falls back to PAT when only PAT is set", () => {
  const result = loadTmsCredentialsFromEnv({
    adapterId: "xray",
    env: { WORKSPACE_TEST_SPACE_TMS_XRAY_TOKEN: "pat-tok" },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.credentials.kind, "pat");
});

test("loadTmsCredentialsFromEnv: returns credentials_missing on empty env", () => {
  const result = loadTmsCredentialsFromEnv({ adapterId: "xray", env: {} });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "credentials_missing");
});

test("sanitizeTmsErrorDetail: strips URLs", () => {
  const result = sanitizeTmsErrorDetail("failed at https://example.com/path");
  assert.match(result, /\[REDACTED_URL\]/);
});

test("sanitizeTmsErrorDetail: applies length cap", () => {
  const longRaw = "x".repeat(500);
  const result = sanitizeTmsErrorDetail(longRaw);
  assert.ok(result.length <= 244, `length ${result.length} exceeds cap`);
});

test("sanitizeTmsErrorDetail: maps non-string non-Error to transport_error", () => {
  assert.equal(sanitizeTmsErrorDetail(42), "transport_error");
  assert.equal(sanitizeTmsErrorDetail(undefined), "transport_error");
});

test("chunkBatches: splits in declaration order", () => {
  assert.deepEqual(chunkBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("chunkBatches: refuses size <= 0", () => {
  assert.throws(() => chunkBatches([1], 0), RangeError);
});

test("classifyTmsHttpFailure: 401 → TmsAuthError", () => {
  const err = classifyTmsHttpFailure({
    adapterId: "xray",
    status: 401,
    detail: "auth rejected",
  });
  assert.ok(err instanceof TmsAuthError);
});

test("classifyTmsHttpFailure: 422 → TmsValidationError", () => {
  const err = classifyTmsHttpFailure({
    adapterId: "xray",
    status: 422,
    detail: "validation failed",
  });
  assert.ok(err instanceof TmsValidationError);
});

test("classifyTmsHttpFailure: 429 → TmsRateLimitError", () => {
  const err = classifyTmsHttpFailure({
    adapterId: "xray",
    status: 429,
    detail: "rate-limited",
    retryAfterMs: 1000,
  });
  assert.ok(err instanceof TmsRateLimitError);
  assert.equal((err as TmsRateLimitError).retryAfterMs, 1000);
});

test("classifyTmsHttpFailure: 500 → TmsTransportError", () => {
  const err = classifyTmsHttpFailure({
    adapterId: "xray",
    status: 500,
    detail: "server fault",
  });
  assert.ok(err instanceof TmsTransportError);
});

test("buildBasicAuthHeader: returns Basic <base64>", () => {
  const header = buildBasicAuthHeader({ username: "u", token: "p" });
  assert.equal(header, `Basic ${Buffer.from("u:p", "utf8").toString("base64")}`);
});

test("resolvePrincipalId: defaults when undefined or empty", () => {
  assert.equal(resolvePrincipalId(undefined), "tms-principal:default");
  assert.equal(resolvePrincipalId(""), "tms-principal:default");
  assert.equal(resolvePrincipalId("alice"), "alice");
});
