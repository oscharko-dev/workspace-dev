import assert from "node:assert/strict";
import test from "node:test";

import {
  FigmaRestFetchError,
  fetchFigmaFileForTestIntelligence,
  fetchFigmaScreenCapturesForTestIntelligence,
  parseFigmaUrl,
} from "./figma-rest-adapter.js";

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const errJson = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const minimalFile = {
  name: "Test View 03",
  lastModified: "2026-05-01T00:00:00Z",
  version: "1",
  thumbnailUrl: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    children: [],
  },
};

const PNG_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082",
  "hex",
);

test("parseFigmaUrl extracts fileKey + nodeId from a design URL", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/M7FGS79qLfr3O4OXEYbxy0/Test-View-03?node-id=0-1",
  );
  assert.equal(parsed.fileKey, "M7FGS79qLfr3O4OXEYbxy0");
  assert.equal(parsed.nodeId, "0:1");
});

test("parseFigmaUrl accepts a /file/ legacy URL", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/file/ABC123xyz/My-File?node-id=12-34",
  );
  assert.equal(parsed.fileKey, "ABC123xyz");
  assert.equal(parsed.nodeId, "12:34");
});

test("parseFigmaUrl accepts a URL without nodeId", () => {
  const parsed = parseFigmaUrl(
    "https://www.figma.com/design/ABC123xyz/My-File",
  );
  assert.equal(parsed.fileKey, "ABC123xyz");
  assert.equal(parsed.nodeId, undefined);
});

test("parseFigmaUrl rejects a non-figma host (SSRF guard)", () => {
  assert.throws(
    () => parseFigmaUrl("https://evil.example.com/design/ABC/X"),
    /figma\.com/,
  );
});

test("parseFigmaUrl rejects a non-https URL", () => {
  assert.throws(
    () => parseFigmaUrl("http://www.figma.com/design/ABC/X"),
    /https/,
  );
});

test("parseFigmaUrl rejects a URL without a fileKey", () => {
  assert.throws(
    () => parseFigmaUrl("https://www.figma.com/design/"),
    /file key/,
  );
});

test("fetchFigmaFileForTestIntelligence returns parsed REST file on 200", async () => {
  let seenUrl: string | undefined;
  let seenHeaders: Headers | undefined;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seenUrl = url;
    seenHeaders = new Headers(init?.headers);
    return okJson(minimalFile);
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    fetchImpl,
  });
  assert.equal(result.name, "Test View 03");
  assert.ok(seenUrl?.startsWith("https://api.figma.com/v1/files/ABC"));
  assert.equal(seenHeaders?.get("x-figma-token"), "figd_test");
});

test("fetchFigmaFileForTestIntelligence rejects 401/403 fail-closed (no retry)", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return errJson(401, { err: "Unauthorized" });
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaFileForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "auth_failed" &&
      err.retryable === false,
  );
  assert.equal(calls, 1);
});

test("fetchFigmaFileForTestIntelligence retries once on 5xx then succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return errJson(503, { err: "busy" });
    return okJson(minimalFile);
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    fetchImpl,
  });
  assert.equal(calls, 2);
  assert.equal(result.name, "Test View 03");
});

test("fetchFigmaFileForTestIntelligence does NOT echo the access token in error messages", async () => {
  const tok = "figd_supersecret_test_token_value_1234567890_padded_padded";
  const fetchImpl = (async () => {
    return errJson(403, { err: tok });
  }) as unknown as typeof fetch;
  try {
    await fetchFigmaFileForTestIntelligence({
      fileKey: "ABC",
      accessToken: tok,
      fetchImpl,
    });
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof FigmaRestFetchError);
    assert.ok(
      !err.message.includes(tok),
      `error message must not contain raw token, got: ${err.message}`,
    );
  }
});

test("fetchFigmaFileForTestIntelligence appends ids when nodeId is supplied", async () => {
  let seenUrl: string | undefined;
  const fetchImpl = (async (url: string) => {
    seenUrl = url;
    return okJson({
      name: "x",
      lastModified: "2026-05-01T00:00:00Z",
      version: "1",
      thumbnailUrl: "",
      nodes: {
        "0:1": {
          document: {
            id: "0:1",
            name: "Frame",
            type: "FRAME",
            children: [],
          },
        },
      },
    });
  }) as unknown as typeof fetch;
  const result = await fetchFigmaFileForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    nodeId: "0:1",
    fetchImpl,
  });
  assert.ok(seenUrl?.includes("/v1/files/ABC/nodes"));
  assert.ok(seenUrl?.includes("ids=0%3A1"));
  // For node-scoped fetches, the adapter wraps the returned subtree as the document root.
  assert.equal(result.document.id, "0:1");
});

test("fetchFigmaScreenCapturesForTestIntelligence resolves image lookup URLs and returns PNG captures", async () => {
  const requestedUrls: string[] = [];
  const requestHeaders: Headers[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requestedUrls.push(url);
    requestHeaders.push(new Headers(init?.headers));
    if (url.includes("/v1/images/")) {
      return okJson({
        images: {
          "1:1":
            "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
        },
      });
    }
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as unknown as typeof fetch;
  const captures = await fetchFigmaScreenCapturesForTestIntelligence({
    fileKey: "ABC",
    accessToken: "figd_test",
    screens: [{ screenId: "1:1", screenName: "Main Screen" }],
    fetchImpl,
  });
  assert.equal(captures.length, 1);
  assert.equal(captures[0]?.screenId, "1:1");
  assert.equal(captures[0]?.screenName, "Main Screen");
  assert.equal(captures[0]?.mimeType, "image/png");
  assert.equal(
    Buffer.from(captures[0]?.base64Data ?? "", "base64").equals(PNG_BYTES),
    true,
  );
  assert.deepEqual(requestedUrls, [
    "https://api.figma.com/v1/images/ABC?ids=1%3A1&format=png&scale=2",
    "https://figma-alpha-api.s3.us-west-2.amazonaws.com/1_1.png",
  ]);
  assert.equal(requestHeaders.length, 2);
  assert.equal(requestHeaders[0]?.get("x-figma-token"), "figd_test");
  assert.equal(requestHeaders[1]?.get("x-figma-token"), null);
});

test("fetchFigmaScreenCapturesForTestIntelligence rejects non-Figma CDN screenshot URLs", async () => {
  const fetchImpl = (async (url: string) => {
    if (url.includes("/v1/images/")) {
      return okJson({
        images: {
          "1:1": "https://evil.example.com/1_1.png",
        },
      });
    }
    return new Response(PNG_BYTES, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as unknown as typeof fetch;
  await assert.rejects(
    () =>
      fetchFigmaScreenCapturesForTestIntelligence({
        fileKey: "ABC",
        accessToken: "figd_test",
        screens: [{ screenId: "1:1" }],
        fetchImpl,
      }),
    (err: unknown): boolean =>
      err instanceof FigmaRestFetchError &&
      err.errorClass === "ssrf_refused",
  );
});
