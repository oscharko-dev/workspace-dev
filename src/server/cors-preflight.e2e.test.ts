import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import type { JobEngine } from "../job-engine.js";
import { createWorkspaceRequestHandler } from "./request-handler.js";

function createStubJobEngine(): JobEngine {
  return {} as unknown as JobEngine;
}

const getPort = (): number => 20_000 + Math.floor(Math.random() * 10_000);

test("e2e: protected write routes reject cross-origin preflight with explicit 405", async () => {
  const port = getPort();
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  let resolvedPort = port;
  const handler = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt: Date.now(),
    absoluteOutputRoot: process.cwd(),
    defaults: { figmaSourceMode: "rest", llmCodegenMode: "deterministic" },
    runtime: { previewEnabled: false },
    jobEngine: createStubJobEngine(),
    moduleDir: path.resolve(import.meta.dirname ?? ".", "..")
  });

  const server = http.createServer(async (request, response) => {
    try {
      await handler(request, response);
    } catch {
      if (!response.writableEnded) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "INTERNAL_ERROR" }));
      }
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolvedPort = address.port;
      }
      resolve();
    });
  });

  try {
    for (const route of ["/workspace/submit", "/workspace/jobs/job-1/stale-check"]) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: "OPTIONS",
        headers: {
          origin: "https://portal.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type"
        }
      });

      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST");
      assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(response.headers.get("access-control-allow-methods"), null);
      assert.equal(response.headers.get("access-control-allow-headers"), null);
      assert.equal(response.headers.get("access-control-max-age"), null);

      const body = (await response.json()) as Record<string, unknown>;
      assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/i);
      assert.deepEqual(body, {
        error: "METHOD_NOT_ALLOWED",
        message: `Write route '${route}' only supports POST and does not support cross-origin browser preflight requests.`,
        requestId: response.headers.get("x-request-id")
      });
    }

    const unknownRouteResponse = await fetch(`${baseUrl}/workspace/jobs/job-1/result`, {
      method: "OPTIONS",
      headers: {
        origin: "https://portal.example",
        "access-control-request-method": "POST"
      }
    });

    assert.equal(unknownRouteResponse.status, 404);
    assert.equal(unknownRouteResponse.headers.get("allow"), null);
    const unknownRouteBody = (await unknownRouteResponse.json()) as Record<string, unknown>;
    assert.equal(unknownRouteBody.error, "NOT_FOUND");
  } finally {
    server.close();
  }
});
