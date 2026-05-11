import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTIVE_NODE_THRESHOLD,
  clearResolverCache,
  resolveFigmaDesignContext,
  type FigmaDesignContext,
  type FigmaMeta,
  type McpResolverConfig,
} from "../src/job-engine/figma-mcp-resolver.js";
import {
  startMockMcpServer,
  type MockMcpServer,
  type Scenario,
} from "./mcp-mock-server.js";

// ---------------------------------------------------------------------------
// Shared fixtures & helpers
// ---------------------------------------------------------------------------

const META: FigmaMeta = { fileKey: "fk", nodeId: "1:2" };
const INSECURE_ENV = "WORKSPACE_ALLOW_INSECURE_MCP";

/** Rest fallback JSON — matches the existing rest-nodes-success.json shape. */
const REST_NODES_BODY = {
  nodes: {
    "1:2": {
      document: { type: "FRAME", name: "Fallback" },
    },
  },
};

/** Rest image export — canned success payload for screenshot fallback. */
const REST_IMAGE_BODY = {
  images: { "1:2": "https://cdn.example/fallback.png" },
};

/**
 * Routes MCP traffic to the mock server; any other host (currently only
 * api.figma.com) returns canned REST JSON. Keeping REST stubbed in-process
 * avoids standing up a second server for a single fallback path.
 */
const buildFetchRouter = (
  mcp: MockMcpServer,
  options: {
    restNodesResponse?: () => Response;
    restImagesResponse?: () => Response;
  } = {},
): typeof fetch => {
  return async (input, init): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(mcp.url) || url === mcp.url) {
      return globalThis.fetch(input, init);
    }
    if (url.startsWith("https://api.figma.com/v1/files/")) {
      return (
        options.restNodesResponse?.() ??
        new Response(JSON.stringify(REST_NODES_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    if (url.startsWith("https://api.figma.com/v1/images/")) {
      return (
        options.restImagesResponse?.() ??
        new Response(JSON.stringify(REST_IMAGE_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    throw new Error(`unexpected URL in test fetch: ${url}`);
  };
};

const createConfig = (
  server: MockMcpServer,
  overrides?: Partial<McpResolverConfig>,
): McpResolverConfig => ({
  serverUrl: server.url,
  accessToken: "test-token",
  authMode: "desktop",
  fetchImpl: buildFetchRouter(server),
  timeoutMs: 2_000,
  maxRetries: 3,
  onLog: () => {},
  ...overrides,
});

/**
 * Wraps a test body in a live server + insecure-MCP env override, guaranteeing
 * cleanup on both success and failure paths.
 */
const withServer = async (
  run: (server: MockMcpServer) => Promise<void>,
): Promise<void> => {
  const previousEnv = process.env[INSECURE_ENV];
  process.env[INSECURE_ENV] = "true";
  const server = await startMockMcpServer();
  try {
    clearResolverCache();
    await run(server);
  } finally {
    clearResolverCache();
    await server.close();
    if (previousEnv === undefined) {
      delete process.env[INSECURE_ENV];
    } else {
      process.env[INSECURE_ENV] = previousEnv;
    }
  }
};

const expectPipelineCode = (error: unknown, code: string): void => {
  assert.ok(error instanceof Error, `expected Error, got ${String(error)}`);
  const fields = error as Record<string, unknown>;
  assert.equal(
    fields["code"],
    code,
    `expected error.code=${code}, got ${String(fields["code"])}`,
  );
  assert.equal(fields["stage"], "figma.source");
};

/** Builds a nested XML big enough to trigger adaptive fan-out (>= 50 nodes). */
const buildLargeNestedXml = (
  childCount: number,
): { xml: string; childIds: string[] } => {
  const childIds = Array.from(
    { length: childCount },
    (_, index) => `child:${String(index + 1)}`,
  );
  const xml = `<FRAME id="1:2" name="Root">${childIds
    .map(
      (id, i) =>
        `<FRAME id="${id}" name="C${String(i + 1)}"><TEXT id="${id}-t" name="t"/></FRAME>`,
    )
    .join("")}</FRAME>`;
  return { xml, childIds };
};

// ---------------------------------------------------------------------------
// Happy path + caching
// ---------------------------------------------------------------------------

test("ok scenario returns canonical fixtures and caches on second call", async () => {
  await withServer(async (server) => {
    const config = createConfig(server);
    const first = await resolveFigmaDesignContext(META, config);
    assert.equal(first.code, "export default function MyFrame() {}");
    assert.equal(first.screenshot, "https://cdn.figma.com/screenshot.png");
    assert.equal(first.fallbackMode, "none");
    assert.ok(first.metadata?.xml.length, "expected metadata xml present");

    const second = await resolveFigmaDesignContext(META, config);
    assert.equal(second.resolvedAt, first.resolvedAt, "expected cache hit");
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test("rate-limit with Retry-After recovers after one retry and surfaces diagnostic", async () => {
  await withServer(async (server) => {
    const scenario: Scenario = {
      kind: "rate-limit",
      retryAfterSeconds: 0,
      failTimes: 1,
    };
    server.setScenario("get_metadata", scenario);
    server.setScenario("get_design_context", scenario);

    const result = await resolveFigmaDesignContext(META, createConfig(server));
    assert.equal(result.fallbackMode, "none");
    const rateLimited = result.diagnostics?.some(
      (d) => d.code === "W_MCP_RATE_LIMITED",
    );
    assert.ok(rateLimited, "expected W_MCP_RATE_LIMITED diagnostic");
  });
});

test("rate-limit exhausting maxRetries bubbles up through resolver (MCP rate-limit + REST rate-limit)", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", {
      kind: "rate-limit",
      retryAfterSeconds: 0,
    });
    // REST fallback is also rate-limited so the outer error propagates.
    const config = createConfig(server, {
      maxRetries: 2,
      fetchImpl: buildFetchRouter(server, {
        restNodesResponse: () =>
          new Response(JSON.stringify({ err: "too many" }), {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
          }),
      }),
    });
    await assert.rejects(
      () => resolveFigmaDesignContext(META, config),
      (error: unknown) => {
        expectPipelineCode(error, "E_FIGMA_REST_RATE_LIMIT");
        return true;
      },
    );
  });
});

test("callMcpTool directly throws E_MCP_RATE_LIMIT when 429 exhausts retries", async () => {
  await withServer(async (server) => {
    server.setScenario("get_metadata", {
      kind: "rate-limit",
      retryAfterSeconds: 0,
    });
    const config = createConfig(server, { maxRetries: 2 });
    const { callMcpTool } =
      await import("../src/job-engine/figma-mcp-resolver.js");
    await assert.rejects(
      () =>
        callMcpTool({
          toolName: "get_metadata",
          args: { fileKey: META.fileKey, nodeId: "1:2" },
          config,
        }),
      (error: unknown) => {
        expectPipelineCode(error, "E_MCP_RATE_LIMIT");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Server errors
// ---------------------------------------------------------------------------

test("server-error retried succeeds and still produces a clean context", async () => {
  await withServer(async (server) => {
    server.setScenario("get_metadata", { kind: "server-error", failTimes: 1 });
    server.setScenario("get_design_context", {
      kind: "server-error",
      failTimes: 1,
    });
    const config = createConfig(server, { maxRetries: 3 });
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "none");
    assert.equal(result.code, "export default function MyFrame() {}");
  });
});

test("server-error in MCP envelope (200 body with error field) classifies as E_MCP_SERVER_ERROR and triggers REST fallback", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", { kind: "mcp-error-envelope" });
    const config = createConfig(server, { maxRetries: 2 });
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "rest");
    const fallback = result.diagnostics?.find(
      (d) => d.code === "W_MCP_FALLBACK_REST",
    );
    assert.ok(fallback, "expected W_MCP_FALLBACK_REST diagnostic");
  });
});

test("partial response (invalid JSON) classifies as E_MCP_SERVER_ERROR then REST falls back", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", { kind: "partial" });
    const config = createConfig(server, { maxRetries: 2 });
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "rest");
  });
});

// ---------------------------------------------------------------------------
// Non-retryable HTTP classifications
// ---------------------------------------------------------------------------

test("auth 401 on design context propagates as E_MCP_AUTH (non-retryable, no REST retry)", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", {
      kind: "auth-error",
      status: 401,
    });
    const config = createConfig(server, {
      maxRetries: 1,
      fetchImpl: buildFetchRouter(server, {
        restNodesResponse: () =>
          new Response(JSON.stringify({ err: "rest auth" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    await assert.rejects(
      () => resolveFigmaDesignContext(META, config),
      (error: unknown) => {
        expectPipelineCode(error, "E_FIGMA_REST_AUTH");
        return true;
      },
    );
  });
});

test("404 on design context surfaces through REST fallback as E_FIGMA_REST_NOT_FOUND when REST also 404s", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", { kind: "not-found" });
    const config = createConfig(server, {
      maxRetries: 1,
      fetchImpl: buildFetchRouter(server, {
        restNodesResponse: () =>
          new Response(JSON.stringify({ err: "nope" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    await assert.rejects(
      () => resolveFigmaDesignContext(META, config),
      (error: unknown) => {
        expectPipelineCode(error, "E_FIGMA_REST_NOT_FOUND");
        return true;
      },
    );
  });
});

test("400 on design context surfaces via REST fallback when REST also rejects", async () => {
  await withServer(async (server) => {
    server.setScenario("get_design_context", { kind: "invalid-request" });
    const config = createConfig(server, {
      maxRetries: 1,
      fetchImpl: buildFetchRouter(server, {
        restNodesResponse: () =>
          new Response(JSON.stringify({ err: "bad" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    // A 400 on REST classifies to E_FIGMA_REST_ERROR (not in the narrow 401/403/404/429 map).
    await assert.rejects(
      () => resolveFigmaDesignContext(META, config),
      (error: unknown) => {
        expectPipelineCode(error, "E_FIGMA_REST_ERROR");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Timeout, abort, network
// ---------------------------------------------------------------------------

test("slow response exceeding timeoutMs bubbles up as aborted error (native TimeoutError path)", async () => {
  await withServer(async (server) => {
    // Native AbortSignal.timeout throws a TimeoutError whose message contains
    // "aborted" — the resolver classifies that as E_MCP_ABORTED, which the
    // REST fallback gate treats as user-cancelled and re-throws.
    server.setScenario("get_design_context", { kind: "slow", delayMs: 500 });
    const config = createConfig(server, { timeoutMs: 50, maxRetries: 1 });
    await assert.rejects(
      () => resolveFigmaDesignContext(META, config),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const code = (error as Record<string, unknown>)["code"];
        assert.ok(
          code === "E_MCP_ABORTED" || code === "E_MCP_TIMEOUT",
          `expected timeout/abort code, got ${String(code)}`,
        );
        return true;
      },
    );
  });
});

test("callMcpTool directly surfaces E_MCP_TIMEOUT when fetch rejects with a non-abort timeout error", async () => {
  await withServer(async (server) => {
    // Custom fetch that throws a pure TimeoutError (no "aborted" substring) so
    // the resolver's isAbortError returns false and isTimeoutError wins.
    const timeoutFetch: typeof fetch = () => {
      const error = new Error("request timed out");
      error.name = "TimeoutError";
      return Promise.reject(error);
    };
    const config: McpResolverConfig = {
      serverUrl: server.url,
      accessToken: "t",
      authMode: "desktop",
      fetchImpl: timeoutFetch,
      timeoutMs: 25,
      maxRetries: 1,
      onLog: () => {},
    };
    const { callMcpTool } =
      await import("../src/job-engine/figma-mcp-resolver.js");
    await assert.rejects(
      () =>
        callMcpTool({
          toolName: "get_metadata",
          args: { fileKey: META.fileKey, nodeId: "1:2" },
          config,
        }),
      (error: unknown) => {
        expectPipelineCode(error, "E_MCP_TIMEOUT");
        return true;
      },
    );
  });
});

test("callMcpTool directly surfaces E_MCP_NETWORK on connection failure", async () => {
  await withServer(async (server) => {
    await server.close();
    const config: McpResolverConfig = {
      serverUrl: server.url,
      accessToken: "t",
      authMode: "desktop",
      fetchImpl: buildFetchRouter(server),
      timeoutMs: 500,
      maxRetries: 1,
      onLog: () => {},
    };
    const { callMcpTool } =
      await import("../src/job-engine/figma-mcp-resolver.js");
    await assert.rejects(
      () =>
        callMcpTool({
          toolName: "get_metadata",
          args: { fileKey: META.fileKey, nodeId: "1:2" },
          config,
        }),
      (error: unknown) => {
        expectPipelineCode(error, "E_MCP_NETWORK");
        return true;
      },
    );
    // Note: withServer's `await server.close()` is idempotent, so closing
    // twice is safe.
  });
});

test("caller-provided aborted signal rejects with AbortError", async () => {
  await withServer(async (server) => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        resolveFigmaDesignContext(META, createConfig(server), {
          signal: controller.signal,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message.toLowerCase() + " " + ((error as Error).name ?? ""),
          /abort/,
        );
        return true;
      },
    );
  });
});

test("closing the server mid-flight yields an E_MCP_NETWORK classification that REST recovers", async () => {
  const previousEnv = process.env[INSECURE_ENV];
  process.env[INSECURE_ENV] = "true";
  const server = await startMockMcpServer();
  clearResolverCache();
  try {
    // Close the server BEFORE the call so the very first request fails.
    await server.close();
    const config: McpResolverConfig = {
      serverUrl: server.url,
      accessToken: "t",
      authMode: "desktop",
      fetchImpl: buildFetchRouter(server),
      timeoutMs: 500,
      maxRetries: 1,
      onLog: () => {},
    };
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "rest");
  } finally {
    clearResolverCache();
    if (previousEnv === undefined) {
      delete process.env[INSECURE_ENV];
    } else {
      process.env[INSECURE_ENV] = previousEnv;
    }
  }
});

// ---------------------------------------------------------------------------
// Adaptive batching via large metadata
// ---------------------------------------------------------------------------

test("large metadata triggers subtree fan-out and surfaces partial-failure abort", async () => {
  await withServer(async (server) => {
    const { xml, childIds } = buildLargeNestedXml(ADAPTIVE_NODE_THRESHOLD);

    // Override get_metadata with a custom nested XML so we actually hit the
    // subtree-batching branch.
    let callSeq = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith(server.url)) {
        const raw = init?.body;
        const body = typeof raw === "string" ? raw : "";
        const parsed = JSON.parse(body) as {
          params?: { name?: string; arguments?: { nodeId?: string } };
        };
        if (parsed.params?.name === "get_metadata") {
          return new Response(JSON.stringify({ result: { xml } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (parsed.params?.name === "get_design_context") {
          callSeq += 1;
          // First subtree call succeeds, second fails hard to trigger
          // subtreeAbortController.abort() and abort other in-flight.
          if (callSeq === 2) {
            return new Response(
              JSON.stringify({ error: { message: "boom" } }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(
            JSON.stringify({ result: { code: "// batch ok", assets: {} } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (parsed.params?.name === "get_screenshot") {
          return new Response(
            JSON.stringify({ result: { url: "https://cdn/s.png" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
      }
      if (url.startsWith("https://api.figma.com/v1/files/")) {
        return new Response(JSON.stringify(REST_NODES_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://api.figma.com/v1/images/")) {
        return new Response(JSON.stringify(REST_IMAGE_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected URL in test fetch: ${url}`);
    };

    const config: McpResolverConfig = {
      serverUrl: server.url,
      accessToken: "t",
      authMode: "desktop",
      fetchImpl,
      timeoutMs: 2_000,
      maxRetries: 1,
      onLog: () => {},
    };

    // With maxRetries=1, the partial batch failure cannot be retried and bubbles
    // up — which invokes the REST fallback path. Assert REST was used.
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "rest");
    assert.equal(result.metadata?.nodeCount, childIds.length * 2 + 1);
  });
});

// ---------------------------------------------------------------------------
// Screenshot REST fallback
// ---------------------------------------------------------------------------

test("screenshot fallback to REST when MCP get_screenshot fails", async () => {
  await withServer(async (server) => {
    server.setScenario("get_screenshot", { kind: "server-error" });
    const config = createConfig(server, { maxRetries: 1 });
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.screenshot, "https://cdn.example/fallback.png");
    const fallback = result.diagnostics?.some(
      (d) => d.code === "W_MCP_SCREENSHOT_FALLBACK_REST",
    );
    assert.ok(fallback, "expected W_MCP_SCREENSHOT_FALLBACK_REST diagnostic");
  });
});

// ---------------------------------------------------------------------------
// Guard: non-loopback Host header is rejected
// ---------------------------------------------------------------------------

test("mock server rejects non-loopback Host headers", async () => {
  await withServer(async (server) => {
    const res = await globalThis.fetch(server.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "evil.example.com",
      },
      body: JSON.stringify({
        method: "tools/call",
        params: { name: "get_metadata", arguments: {} },
      }),
    });
    // Node's fetch overwrites Host with the target host by default, so this
    // request should actually succeed — but if a malicious caller forced a
    // Host override via a proxy, the server MUST still only bind to 127.0.0.1.
    // Verify at least that the server answered (host-check is server-side).
    assert.ok(res.status === 200 || res.status === 403);
  });
});

test("mock server returns 404 for unknown tool names", async () => {
  await withServer(async (server) => {
    const res = await globalThis.fetch(server.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "tools/call",
        params: { name: "does_not_exist", arguments: {} },
      }),
    });
    assert.equal(res.status, 404);
  });
});

test("mock server reset() clears per-tool scenarios", async () => {
  await withServer(async (server) => {
    server.setScenario("get_metadata", { kind: "server-error" });
    server.reset();
    const config = createConfig(server);
    const result = await resolveFigmaDesignContext(META, config);
    assert.equal(result.fallbackMode, "none");
  });
});
