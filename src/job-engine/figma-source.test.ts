import assert from "node:assert/strict";
import test from "node:test";
import { fetchFigmaFile } from "./figma-source.js";

const jsonResponse = (payload: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
};

test("fetchFigmaFile returns parsed response object on first success", async () => {
  const result = await fetchFigmaFile({
    fileKey: "abc",
    accessToken: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    fetchImpl: async () => jsonResponse({ name: "Demo", document: {} }),
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.name, "Demo");
});

test("fetchFigmaFile retries with Bearer header when PAT is rejected", async () => {
  const headersSeen: Array<Record<string, string>> = [];
  let call = 0;

  const result = await fetchFigmaFile({
    fileKey: "abc",
    accessToken: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    fetchImpl: async (_url, init) => {
      call += 1;
      headersSeen.push(init?.headers as Record<string, string>);
      if (call === 1) {
        return new Response("invalid token", { status: 403 });
      }
      return jsonResponse({ name: "Retried", document: {} });
    },
    onLog: () => {
      // no-op
    }
  });

  assert.equal(result.name, "Retried");
  assert.equal(call, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[0], "X-Figma-Token"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[1], "Authorization"), true);
});

test("fetchFigmaFile retries network errors and eventually succeeds", async () => {
  let call = 0;
  const logs: string[] = [];

  const result = await fetchFigmaFile({
    fileKey: "abc",
    accessToken: "token",
    timeoutMs: 1000,
    maxRetries: 3,
    fetchImpl: async () => {
      call += 1;
      if (call < 3) {
        throw new Error("network down");
      }
      return jsonResponse({ name: "Recovered", document: {} });
    },
    onLog: (message) => {
      logs.push(message);
    }
  });

  assert.equal(result.name, "Recovered");
  assert.equal(call, 3);
  assert.ok(logs.some((entry) => entry.includes("retrying")));
});

test("fetchFigmaFile throws typed error after exhausted timeout retries", async () => {
  await assert.rejects(
    () =>
      fetchFigmaFile({
        fileKey: "abc",
        accessToken: "token",
        timeoutMs: 1000,
        maxRetries: 1,
        fetchImpl: async () => {
          throw new Error("request timeout");
        },
        onLog: () => {
          // no-op
        }
      }),
    (error: unknown) => {
      const typed = error as { code?: string; stage?: string };
      return typed.code === "E_FIGMA_TIMEOUT" && typed.stage === "figma.source";
    }
  );
});

test("fetchFigmaFile classifies http failures and parse errors", async () => {
  await assert.rejects(
    () =>
      fetchFigmaFile({
        fileKey: "abc",
        accessToken: "token",
        timeoutMs: 1000,
        maxRetries: 1,
        fetchImpl: async () => new Response("not found", { status: 404 }),
        onLog: () => {
          // no-op
        }
      }),
    (error: unknown) => (error as { code?: string }).code === "E_FIGMA_NOT_FOUND"
  );

  await assert.rejects(
    () =>
      fetchFigmaFile({
        fileKey: "abc",
        accessToken: "token",
        timeoutMs: 1000,
        maxRetries: 1,
        fetchImpl: async () => jsonResponse(["not-an-object"]),
        onLog: () => {
          // no-op
        }
      }),
    (error: unknown) => (error as { code?: string }).code === "E_FIGMA_PARSE"
  );
});
