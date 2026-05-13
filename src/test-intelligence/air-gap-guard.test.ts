import assert from "node:assert/strict";
import test from "node:test";

import {
  AIR_GAP_ALLOWED_HOSTS_ENV,
  AIR_GAP_MODE_ENV,
  AirGapNetworkPolicyError,
  AirGapResourceLocationError,
  assertLocalFilesystemPath,
  createAirGapFetchGuard,
  isAirGapModeEnabled,
  readAirGapAllowedHosts,
} from "./air-gap-guard.js";

const enabledEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  [AIR_GAP_MODE_ENV]: "1",
  ...extra,
});

test("isAirGapModeEnabled accepts 1/true/yes case-insensitively and only those", () => {
  assert.equal(isAirGapModeEnabled({ [AIR_GAP_MODE_ENV]: "1" }), true);
  assert.equal(isAirGapModeEnabled({ [AIR_GAP_MODE_ENV]: "TRUE" }), true);
  assert.equal(isAirGapModeEnabled({ [AIR_GAP_MODE_ENV]: " yes " }), true);
  assert.equal(isAirGapModeEnabled({ [AIR_GAP_MODE_ENV]: "0" }), false);
  assert.equal(isAirGapModeEnabled({ [AIR_GAP_MODE_ENV]: "no" }), false);
  assert.equal(isAirGapModeEnabled({}), false);
});

test("readAirGapAllowedHosts trims, lowercases, drops empties", () => {
  assert.deepEqual(
    readAirGapAllowedHosts({
      [AIR_GAP_ALLOWED_HOSTS_ENV]: "  LLM.local , , stackit.example.de ,",
    }),
    ["llm.local", "stackit.example.de"],
  );
  assert.deepEqual(readAirGapAllowedHosts({}), []);
});

test("guard is a transparent pass-through when air-gap mode is off", async () => {
  let invoked = false;
  const inner: typeof fetch = async () => {
    invoked = true;
    return new Response("ok", { status: 200 });
  };
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: {},
    allowedHosts: [],
  });
  const response = await guarded("https://public.example.com/x");
  assert.equal(response.status, 200);
  assert.equal(invoked, true);
});

test("guard rejects hosts outside the explicit allow-list", async () => {
  const inner: typeof fetch = async () => new Response("ok", { status: 200 });
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv(),
    allowedHosts: ["llm.local"],
  });
  await assert.rejects(
    () => guarded("https://api.figma.com/v1/files/abc"),
    (err) =>
      err instanceof AirGapNetworkPolicyError &&
      new URL(err.url).hostname === "api.figma.com",
  );
});

test("guard permits hosts inside the explicit allow-list", async () => {
  let receivedUrl = "";
  const inner: typeof fetch = async (input) => {
    receivedUrl = typeof input === "string" ? input : input.toString();
    return new Response("ok", { status: 200 });
  };
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv(),
    allowedHosts: ["llm.local"],
  });
  const response = await guarded("https://llm.local/chat/completions");
  assert.equal(response.status, 200);
  assert.equal(new URL(receivedUrl).hostname, "llm.local");
});

test("guard falls back to env allow-list when no explicit hosts are provided", async () => {
  const inner: typeof fetch = async () => new Response("ok", { status: 200 });
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv({ [AIR_GAP_ALLOWED_HOSTS_ENV]: "stackit.example.de" }),
  });
  await assert.rejects(
    () => guarded("https://other.example.de/"),
    AirGapNetworkPolicyError,
  );
  const response = await guarded("https://stackit.example.de/chat/completions");
  assert.equal(response.status, 200);
});

test("guard rejects requests with no parseable host", async () => {
  const inner: typeof fetch = async () => new Response("ok", { status: 200 });
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv(),
    allowedHosts: ["llm.local"],
  });
  await assert.rejects(
    () => guarded("/relative/path"),
    AirGapNetworkPolicyError,
  );
});

test("guard permits data: URIs because they emit no network traffic", async () => {
  let invoked = false;
  const inner: typeof fetch = async () => {
    invoked = true;
    return new Response("ok", { status: 200 });
  };
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv(),
    allowedHosts: ["llm.local"],
  });
  await guarded("data:text/plain;base64,aGVsbG8=");
  assert.equal(invoked, true);
});

test("guard refuses URL-object inputs whose host is not allow-listed", async () => {
  const inner: typeof fetch = async () => new Response("ok", { status: 200 });
  const guarded = createAirGapFetchGuard({
    fetchImpl: inner,
    env: enabledEnv(),
    allowedHosts: ["llm.local"],
  });
  await assert.rejects(
    () => guarded(new URL("https://leak.example.com/")),
    AirGapNetworkPolicyError,
  );
});

test("assertLocalFilesystemPath is a no-op outside air-gap mode", () => {
  assert.doesNotThrow(() =>
    assertLocalFilesystemPath("s3://bucket/key", { env: {} }),
  );
});

test("assertLocalFilesystemPath rejects every remote scheme under air-gap mode", () => {
  const env = enabledEnv();
  for (const remote of [
    "s3://bucket/key",
    "http://example.com/cache",
    "https://example.com/cache",
    "gs://bucket/key",
    "azure://container/blob",
    "az://container/blob",
    "ftp://host/file",
    "sftp://host/file",
    "abfs://container@acct.dfs.core.windows.net/path",
  ]) {
    assert.throws(
      () => assertLocalFilesystemPath(remote, { env }),
      AirGapResourceLocationError,
      `expected reject for ${remote}`,
    );
  }
});

test("assertLocalFilesystemPath accepts absolute and relative local paths", () => {
  const env = enabledEnv();
  assert.doesNotThrow(() =>
    assertLocalFilesystemPath("/var/lib/workspace-dev/cache", { env }),
  );
  assert.doesNotThrow(() =>
    assertLocalFilesystemPath("./cache", { env }),
  );
  assert.doesNotThrow(() =>
    assertLocalFilesystemPath("C:\\workspace\\cache", { env }),
  );
});

test("assertLocalFilesystemPath rejects empty path under air-gap mode", () => {
  assert.throws(
    () => assertLocalFilesystemPath("   ", { env: enabledEnv() }),
    AirGapResourceLocationError,
  );
});
