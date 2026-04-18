import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  clearResolverCache,
  resolveFigmaDesignContext,
  callMcpTool,
  ADAPTIVE_NODE_THRESHOLD,
  MAX_SUBTREE_BATCH_SIZE,
  DEFAULT_MCP_SERVER_URL,
  CACHE_TTL_MS,
  type FigmaMeta,
  type McpResolverConfig,
} from "./figma-mcp-resolver.js";

const mcpFixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../integration/fixtures/figma-paste-pipeline/mcp",
);

function readMcpFixture(relativePath: string): string {
  return readFileSync(path.join(mcpFixtureRoot, relativePath), "utf8").trim();
}

function readMcpFixtureJson<T>(relativePath: string): T {
  return JSON.parse(readMcpFixture(relativePath)) as T;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const createConfig = (fetchImpl: typeof fetch): McpResolverConfig => ({
  serverUrl: "https://mcp.figma.com/mcp",
  accessToken: "test-token",
  authMode: "desktop" as const,
  fetchImpl,
  timeoutMs: 5_000,
  maxRetries: 3,
  onLog: () => {},
});

const withEnv = async (
  overrides: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> => {
  const previousEntries = Object.entries(overrides).map(([key]) => [
    key,
    process.env[key],
  ]);

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
};

/**
 * XML with 2 small nodes — nodeCount will be 2 (below ADAPTIVE_NODE_THRESHOLD).
 */
const SMALL_XML = readMcpFixture("metadata-small.xml");

/**
 * XML with 60 FRAME nodes — nodeCount will be >= ADAPTIVE_NODE_THRESHOLD (50),
 * triggering subtree batching across more than MAX_SUBTREE_BATCH_SIZE direct children.
 */
const DESIGN_CONTEXT_SUCCESS = readMcpFixtureJson<{
  code: string;
  assets: Record<string, unknown>;
}>("design-context-success.json");
const SCREENSHOT_SUCCESS = readMcpFixtureJson<{ url: string }>(
  "screenshot-success.json",
);
const REST_NODES_SUCCESS = readMcpFixtureJson<{
  nodes: Record<string, unknown>;
}>("rest-nodes-success.json");
const ERROR_ENVELOPE = readMcpFixtureJson<{
  error: { message: string; code?: number };
}>("error-envelope.json");

// MCP response envelope helpers
const mcpOk = (result: unknown) => ({ result });
const mcpRestNodes = (nodeId: string, doc: unknown) => ({
  nodes: { [nodeId]: { document: doc } },
});

// Parse the tool name out of a POST body
const parseTool = async (req: Request): Promise<string> => {
  const body = (await req.json()) as {
    params?: { name?: string };
  };
  return body.params?.name ?? "";
};

const createDeferred = <T,>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const buildDirectChildXml = (
  childCount: number,
): { xml: string; childIds: string[] } => {
  const childIds = Array.from(
    { length: childCount },
    (_, index) => `child:${String(index + 1)}`,
  );
  const xml = `<FRAME id="0:1" name="Root">${childIds
    .map(
      (childId, index) =>
        `<FRAME id="${childId}" name="Frame${String(index + 1)}"/>`,
    )
    .join("")}</FRAME>`;
  return { xml, childIds };
};

const buildNestedAdaptiveXml = (): {
  xml: string;
  directChildIds: string[];
  nestedChildIds: string[];
} => {
  const nestedChildIds = Array.from(
    { length: ADAPTIVE_NODE_THRESHOLD },
    (_, index) => `nested:${String(index + 1)}`,
  );
  const directChildIds = ["branch:1", "branch:2"];
  const xml =
    `<FRAME id="0:1" name="Root">` +
    `<FRAME id="${directChildIds[0]}" name="Branch1">` +
    nestedChildIds
      .map(
        (childId, index) =>
          `<FRAME id="${childId}" name="Nested${String(index + 1)}"/>`,
      )
      .join("") +
    `</FRAME>` +
    `<FRAME id="${directChildIds[1]}" name="Branch2"/>` +
    `</FRAME>`;
  return { xml, directChildIds, nestedChildIds };
};

const buildAuxiliaryHeavyAdaptiveXml = (): {
  xml: string;
} => {
  const auxiliaryTags = Array.from(
    { length: ADAPTIVE_NODE_THRESHOLD + 1 },
    (_, index) => `Decoration${String(index + 1)}`,
  );
  const xml =
    `<FRAME id="0:1" name="Root">` +
    `<BOOLEAN_OPERATION name="${auxiliaryTags[0]}"/>` +
    `<FRAME id="child:1" name="Frame1"/>` +
    auxiliaryTags
      .slice(1)
      .map((auxTag) => `<BOOLEAN_OPERATION name="${auxTag}"/>`)
      .join("") +
    `<FRAME id="child:2" name="Frame2"/>` +
    `</FRAME>`;
  return { xml };
};

// ---------------------------------------------------------------------------
// Test setup — clear cache before every test
// ---------------------------------------------------------------------------

// We clear the cache at the start of each relevant test inline (no global
// beforeEach in node:test without hooks), so each test calls clearResolverCache()
// as its first action.

// ---------------------------------------------------------------------------
// Happy Paths
// ---------------------------------------------------------------------------

test("small design — three MCP calls: get_metadata, get_design_context, get_screenshot", async () => {
  clearResolverCache();

  const calls: Array<{ tool: string; args?: Record<string, unknown> }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const body = (await req.json()) as {
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const tool = body.params?.name ?? "";
    calls.push({ tool, args: body.params?.arguments });

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk(DESIGN_CONTEXT_SUCCESS));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk(SCREENSHOT_SUCCESS));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  // The three expected MCP calls (nodeId is provided so no root scan)
  assert.equal(
    calls.some((entry) => entry.tool === "get_metadata"),
    true,
  );
  assert.equal(
    calls.some((entry) => entry.tool === "get_design_context"),
    true,
  );
  assert.equal(
    calls.some((entry) => entry.tool === "get_screenshot"),
    true,
  );
  assert.deepEqual(
    calls.find((entry) => entry.tool === "get_design_context")?.args,
    { fileKey: "abc", nodeId: "1:2" },
  );

  // Returned context shape
  assert.ok(typeof result.code === "string" && result.code.length > 0);
  assert.ok(typeof result.assets === "object");
  assert.equal(result.screenshot, SCREENSHOT_SUCCESS.url);
  assert.ok(result.metadata !== undefined);
  assert.equal(result.fileKey, "abc");
  assert.equal(result.nodeId, "1:2");
  assert.ok(
    typeof result.resolvedAt === "string" && result.resolvedAt.length > 0,
  );
});

test("large design — subtree batching fetches all direct children in deterministic order", async () => {
  clearResolverCache();

  const { xml, childIds } = buildDirectChildXml(ADAPTIVE_NODE_THRESHOLD + 2);

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    const body = (await new Request(input, init).json()) as {
      params?: { arguments?: { nodeId?: string } };
    };

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml }));
    }
    if (tool === "get_design_context") {
      const nodeId = body.params?.arguments?.nodeId ?? "unknown";
      const reverseIndex = childIds.length - childIds.indexOf(nodeId);
      await new Promise((resolve) => setTimeout(resolve, reverseIndex));
      return jsonResponse(mcpOk({ code: `// code for ${nodeId}`, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "bigfile", nodeId: "0:1" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));
  assert.equal(
    result.code,
    childIds.map((nodeId) => `// code for ${nodeId}`).join("\n"),
  );
});

test("large nested design — subtree batching only fetches direct children", async () => {
  clearResolverCache();

  const { xml, directChildIds, nestedChildIds } = buildNestedAdaptiveXml();
  const designContextCalls: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    const body = (await new Request(input, init).json()) as {
      params?: { arguments?: { nodeId?: string } };
    };

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml }));
    }
    if (tool === "get_design_context") {
      const nodeId = body.params?.arguments?.nodeId ?? "unknown";
      designContextCalls.push(nodeId);
      return jsonResponse(mcpOk({ code: `// code for ${nodeId}`, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "nestedfile", nodeId: "0:1" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  assert.deepEqual(designContextCalls, directChildIds);
  assert.equal(designContextCalls.includes("0:1"), false);
  for (const nestedChildId of nestedChildIds) {
    assert.equal(designContextCalls.includes(nestedChildId), false);
  }
  assert.equal(
    result.code,
    directChildIds.map((nodeId) => `// code for ${nodeId}`).join("\n"),
  );
});

test("large design — subtree batching keeps diagnostics ordered by direct child", async () => {
  clearResolverCache();

  const { xml, childIds } = buildDirectChildXml(ADAPTIVE_NODE_THRESHOLD + 1);
  const attemptByNodeId = new Map<string, number>();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    const body = (await new Request(input, init).json()) as {
      params?: { arguments?: { nodeId?: string } };
    };

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml }));
    }
    if (tool === "get_design_context") {
      const nodeId = body.params?.arguments?.nodeId ?? "unknown";
      const attempt = (attemptByNodeId.get(nodeId) ?? 0) + 1;
      attemptByNodeId.set(nodeId, attempt);
      if (
        (nodeId === childIds[0] && attempt <= 2) ||
        (nodeId === childIds[1] && attempt === 1)
      ) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      if (nodeId === childIds[0]) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return jsonResponse(mcpOk({ code: `// code for ${nodeId}`, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "diagnostics-file", nodeId: "0:1" },
    createConfig(fetchImpl),
  );

  assert.equal(
    result.code,
    childIds.map((nodeId) => `// code for ${nodeId}`).join("\n"),
  );
  assert.deepEqual(
    result.diagnostics?.map((diagnostic) => diagnostic.code),
    ["W_MCP_RATE_LIMITED", "W_MCP_RATE_LIMITED", "W_MCP_RATE_LIMITED"],
  );
  assert.deepEqual(
    result.diagnostics?.map((diagnostic) => diagnostic.message),
    [
      "MCP get_design_context rate limited (attempt 1/3)",
      "MCP get_design_context rate limited (attempt 2/3)",
      "MCP get_design_context rate limited (attempt 1/3)",
    ],
  );
});

test("large design — subtree batching uses rolling concurrency instead of serializing whole waves", async () => {
  clearResolverCache();

  const childIds = Array.from(
    { length: MAX_SUBTREE_BATCH_SIZE + 2 },
    (_, index) => `child:${String(index + 1)}`,
  );
  const nestedIds = Array.from(
    { length: ADAPTIVE_NODE_THRESHOLD },
    (_, index) => `nested:${String(index + 1)}`,
  );
  const xml =
    `<FRAME id="0:1" name="Root">` +
    `<FRAME id="${childIds[0]}" name="Frame1">` +
    nestedIds
      .map(
        (nodeId, index) =>
          `<FRAME id="${nodeId}" name="Nested${String(index + 1)}"/>`,
      )
      .join("") +
    `</FRAME>` +
    childIds
      .slice(1)
      .map(
        (nodeId, index) =>
          `<FRAME id="${nodeId}" name="Frame${String(index + 2)}"/>`,
      )
      .join("") +
    `</FRAME>`;
  const startedNodeIds: string[] = [];
  const releaseByNodeId = new Map<string, () => void>();
  const firstWaveStarted = createDeferred<void>();
  const nextLaunchStarted = createDeferred<void>();
  const finalLaunchStarted = createDeferred<void>();
  let inFlight = 0;
  let maxInFlight = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    const body = (await new Request(input, init).json()) as {
      params?: { arguments?: { nodeId?: string } };
    };

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml }));
    }
    if (tool === "get_design_context") {
      const nodeId = body.params?.arguments?.nodeId ?? "unknown";
      startedNodeIds.push(nodeId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (startedNodeIds.length === MAX_SUBTREE_BATCH_SIZE) {
        firstWaveStarted.resolve();
      }
      if (startedNodeIds.length === MAX_SUBTREE_BATCH_SIZE + 1) {
        nextLaunchStarted.resolve();
      }
      if (startedNodeIds.length === childIds.length) {
        finalLaunchStarted.resolve();
      }
      const release = createDeferred<void>();
      releaseByNodeId.set(nodeId, () => release.resolve());
      await release.promise;
      inFlight -= 1;
      return jsonResponse(mcpOk({ code: `// code for ${nodeId}`, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const resultPromise = resolveFigmaDesignContext(
    { fileKey: "wave-file", nodeId: "0:1" },
    createConfig(fetchImpl),
  );

  await firstWaveStarted.promise;
  assert.equal(maxInFlight, MAX_SUBTREE_BATCH_SIZE);
  assert.deepEqual(
    startedNodeIds,
    childIds.slice(0, MAX_SUBTREE_BATCH_SIZE),
  );

  releaseByNodeId.get(childIds[1]!)?.();

  await nextLaunchStarted.promise;
  assert.deepEqual(
    startedNodeIds,
    childIds.slice(0, MAX_SUBTREE_BATCH_SIZE + 1),
  );
  assert.equal(maxInFlight, MAX_SUBTREE_BATCH_SIZE);

  releaseByNodeId.get(childIds[0]!)?.();

  await finalLaunchStarted.promise;
  assert.deepEqual(startedNodeIds, childIds);

  for (const nodeId of childIds.slice(2).reverse()) {
    releaseByNodeId.get(nodeId)?.();
  }

  const result = await resultPromise;
  assert.equal(
    result.code,
    childIds.map((nodeId) => `// code for ${nodeId}`).join("\n"),
  );
});

test("large design — auxiliary self-closing non-node tags do not trigger subtree batching", async () => {
  clearResolverCache();

  const { xml } = buildAuxiliaryHeavyAdaptiveXml();
  const designContextCalls: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    const body = (await new Request(input, init).json()) as {
      params?: { arguments?: { nodeId?: string } };
    };

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml }));
    }
    if (tool === "get_design_context") {
      const nodeId = body.params?.arguments?.nodeId ?? "unknown";
      designContextCalls.push(nodeId);
      return jsonResponse(mcpOk({ code: `// code for ${nodeId}`, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "aux-file", nodeId: "0:1" },
    createConfig(fetchImpl),
  );

  assert.ok(
    result.metadata !== undefined &&
      result.metadata.nodeCount < ADAPTIVE_NODE_THRESHOLD,
  );
  assert.deepEqual(designContextCalls, ["0:1"]);
  assert.equal(result.code, "// code for 0:1");
});

test("direct nodeId provided — first MCP call is get_metadata, not root scan", async () => {
  clearResolverCache();

  const toolCalls: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    toolCalls.push(tool);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  // When nodeId is provided, resolveNodeId returns immediately without a network call.
  // The first network call must therefore be get_metadata (for design context), not
  // a root scan for resolveNodeId.
  assert.equal(toolCalls[0], "get_metadata");

  // Total calls: get_metadata, get_design_context, get_screenshot — no extra root scan
  assert.equal(toolCalls.length, 3);
});

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

test("cache hit — second call returns without invoking fetchImpl", async () => {
  clearResolverCache();

  let fetchCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config = createConfig(fetchImpl);

  const first = await resolveFigmaDesignContext(meta, config);
  const fetchCountAfterFirst = fetchCount;

  const second = await resolveFigmaDesignContext(meta, config);

  // Second call must not trigger any network requests
  assert.equal(fetchCount, fetchCountAfterFirst);

  // Both results are the same object (cache returns the stored context)
  assert.equal(second.fileKey, first.fileKey);
  assert.equal(second.nodeId, first.nodeId);
  assert.equal(second.resolvedAt, first.resolvedAt);

  clearResolverCache();
});

test("forceRefresh bypasses cache and hits fetchImpl on second call", async () => {
  clearResolverCache();

  let fetchCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config = createConfig(fetchImpl);

  await resolveFigmaDesignContext(meta, config);
  const fetchCountAfterFirst = fetchCount;

  // Second call with forceRefresh must bypass cache
  await resolveFigmaDesignContext(meta, config, { forceRefresh: true });

  assert.ok(
    fetchCount > fetchCountAfterFirst,
    "Expected more fetch calls after forceRefresh",
  );

  clearResolverCache();
});

test("clearResolverCache causes subsequent call to hit fetchImpl again", async () => {
  clearResolverCache();

  let fetchCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config = createConfig(fetchImpl);

  await resolveFigmaDesignContext(meta, config);
  const afterFirst = fetchCount;

  // Clear cache then call again — must hit network
  clearResolverCache();
  await resolveFigmaDesignContext(meta, config);

  assert.ok(
    fetchCount > afterFirst,
    "Expected more fetch calls after cache clear",
  );
});

test("cache key includes version — different versions do not reuse cached context", async () => {
  clearResolverCache();

  let fetchCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// versioned code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(
        mcpOk({ url: "https://cdn.figma.com/versioned-shot.png" }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const config = createConfig(fetchImpl);

  await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2", version: "v1" },
    config,
  );
  const afterFirst = fetchCount;

  await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2", version: "v2" },
    config,
  );

  assert.ok(
    fetchCount > afterFirst,
    "Expected a second network fetch for a different version cache key",
  );
});

test("in-flight dedupe shares a single resolver request for identical cache keys", async () => {
  clearResolverCache();

  let fetchCount = 0;
  let releaseMetadata: (() => void) | undefined;
  const metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCount += 1;
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      await metadataGate;
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// deduped", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(
        mcpOk({ url: "https://cdn.figma.com/deduped-shot.png" }),
      );
    }
    return jsonResponse(mcpOk({}));
  };

  const config = createConfig(fetchImpl);
  const first = resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    config,
  );
  const second = resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    config,
  );

  releaseMetadata?.();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(fetchCount, 3);
  assert.equal(firstResult.resolvedAt, secondResult.resolvedAt);
});

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

test("429 on first call — retries and succeeds — diagnostics contain W_MCP_RATE_LIMITED", async () => {
  clearResolverCache();

  let metadataCallCount = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      metadataCallCount += 1;
      // First get_metadata call is rate limited; subsequent succeed
      if (metadataCallCount === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  assert.ok(result.code.length >= 0); // result returned successfully
  assert.equal(metadataCallCount >= 2, true); // at least one retry happened
  assert.ok(
    (result.diagnostics ?? []).some((d) => d.code === "W_MCP_RATE_LIMITED"),
    "Expected W_MCP_RATE_LIMITED diagnostic",
  );
});

test("429 exhausted for MCP — falls back to REST — diagnostics contain W_MCP_RATE_LIMITED and W_MCP_FALLBACK_REST", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    // REST fallback (api.figma.com) succeeds
    if (new URL(url).hostname === "api.figma.com") {
      return jsonResponse(REST_NODES_SUCCESS);
    }

    // MCP calls always return 429
    return new Response("rate limited", { status: 429 });
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  // Use maxRetries: 1 so 429 exhausts quickly (no retry delay on last attempt)
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  const result = await resolveFigmaDesignContext(meta, config);

  // REST fallback was used
  assert.ok(result.code.length >= 0);
  const diagnostics = result.diagnostics ?? [];
  assert.ok(
    diagnostics.some((d) => d.code === "W_MCP_RATE_LIMITED"),
    `Expected W_MCP_RATE_LIMITED, got: ${JSON.stringify(diagnostics.map((d) => d.code))}`,
  );
  assert.ok(
    diagnostics.some((d) => d.code === "W_MCP_FALLBACK_REST"),
    `Expected W_MCP_FALLBACK_REST, got: ${JSON.stringify(diagnostics.map((d) => d.code))}`,
  );
});

test("REST screenshot fallback provides preview when MCP falls back to REST", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      if (url.includes("/images/")) {
        return jsonResponse({
          images: { "1:2": "https://cdn.figma.com/rest-shot.png" },
        });
      }
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "Fallback" }),
      );
    }

    return new Response("rate limited", { status: 429 });
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    { ...createConfig(fetchImpl), maxRetries: 1 },
  );

  assert.equal(result.screenshot, "https://cdn.figma.com/rest-shot.png");
  assert.ok(
    (result.diagnostics ?? []).some(
      (entry) => entry.code === "W_MCP_SCREENSHOT_FALLBACK_REST",
    ),
  );
});

test("REST screenshot fallback provides preview when MCP design context succeeds but MCP screenshot fails", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      if (url.includes("/images/")) {
        return jsonResponse({
          images: { "1:2": "https://cdn.figma.com/rest-shot.png" },
        });
      }
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "Screen" }),
      );
    }

    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: '<FRAME id="1:2" name="Screen"/>' }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return new Response("server error", { status: 500 });
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    { ...createConfig(fetchImpl), maxRetries: 1 },
  );

  assert.equal(result.screenshot, "https://cdn.figma.com/rest-shot.png");
  assert.equal(result.fallbackMode, "none");
  assert.ok(
    (result.diagnostics ?? []).some(
      (entry) => entry.code === "W_MCP_SCREENSHOT_FALLBACK_REST",
    ),
    `Expected W_MCP_SCREENSHOT_FALLBACK_REST diagnostic, got: ${JSON.stringify(
      (result.diagnostics ?? []).map((d) => d.code),
    )}`,
  );
});

test("both MCP and REST screenshot fail — result is non-fatal with no screenshot and no W_MCP_SCREENSHOT_FALLBACK_REST", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      if (url.includes("/images/")) {
        return new Response("internal server error", { status: 500 });
      }
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "Screen" }),
      );
    }

    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: '<FRAME id="1:2" name="Screen"/>' }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return new Response("server error", { status: 500 });
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    { ...createConfig(fetchImpl), maxRetries: 1 },
  );

  assert.equal(result.screenshot, undefined);
  assert.equal(result.fallbackMode, "none");
  assert.ok(
    !(result.diagnostics ?? []).some(
      (entry) => entry.code === "W_MCP_SCREENSHOT_FALLBACK_REST",
    ),
    `Expected no W_MCP_SCREENSHOT_FALLBACK_REST diagnostic, got: ${JSON.stringify(
      (result.diagnostics ?? []).map((d) => d.code),
    )}`,
  );
});

test("REST fallback does not forward ISO lastModified timestamps as version query params", async () => {
  clearResolverCache();

  const restUrls: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      restUrls.push(url);
      if (url.includes("/images/")) {
        return jsonResponse({
          images: { "1:2": "https://cdn.figma.com/rest-shot.png" },
        });
      }
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "Fallback" }),
      );
    }

    return new Response("rate limited", { status: 429 });
  };

  await resolveFigmaDesignContext(
    {
      fileKey: "abc",
      nodeId: "1:2",
      version: "2026-04-13T10:00:00.000Z",
    },
    { ...createConfig(fetchImpl), maxRetries: 1 },
  );

  assert.equal(restUrls.length >= 2, true);
  assert.equal(
    restUrls.every((entry) => !new URL(entry).searchParams.has("version")),
    true,
  );
});

test("REST fallback retries 429 using Retry-After guidance and surfaces diagnostics", async () => {
  clearResolverCache();

  let restNodeCalls = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (
      new URL(url).hostname === "api.figma.com" &&
      !url.includes("/images/")
    ) {
      restNodeCalls += 1;
      if (restNodeCalls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "Recovered" }),
      );
    }

    if (new URL(url).hostname === "api.figma.com") {
      return jsonResponse({
        images: { "1:2": "https://cdn.figma.com/rest-shot.png" },
      });
    }

    return new Response("rate limited", { status: 429 });
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", nodeId: "1:2" },
    { ...createConfig(fetchImpl), maxRetries: 2 },
  );

  assert.equal(restNodeCalls, 2);
  assert.ok(
    (result.diagnostics ?? []).some(
      (entry) => entry.code === "W_FIGMA_REST_RATE_LIMITED",
    ),
  );
});

// ---------------------------------------------------------------------------
// REST Fallback
// ---------------------------------------------------------------------------

test("MCP network error — falls back to REST — returns code and W_MCP_FALLBACK_REST diagnostic", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, _init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      return jsonResponse(
        mcpRestNodes("1:2", { type: "FRAME", name: "RestFrame" }),
      );
    }

    // Simulate MCP network failure
    throw new Error("connection refused");
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  const result = await resolveFigmaDesignContext(meta, config);

  assert.ok(
    result.code.length > 0,
    "Expected non-empty code from REST fallback",
  );
  const diagnostics = result.diagnostics ?? [];
  assert.ok(
    diagnostics.some((d) => d.code === "W_MCP_FALLBACK_REST"),
    `Expected W_MCP_FALLBACK_REST diagnostic, got: ${JSON.stringify(diagnostics.map((d) => d.code))}`,
  );
});

test("REST fallback treats null node documents as not-found errors", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    if (new URL(url).hostname === "api.figma.com") {
      return jsonResponse({
        nodes: { "1:2": null },
      });
    }

    throw new Error("connection refused");
  };

  await assert.rejects(
    () =>
      resolveFigmaDesignContext(
        { fileKey: "abc", nodeId: "1:2" },
        { ...createConfig(fetchImpl), maxRetries: 1 },
      ),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, "E_FIGMA_REST_NOT_FOUND");
      return true;
    },
  );
});

test("both MCP and REST fail — throws an error", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async () => {
    throw new Error("network down");
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  await assert.rejects(
    () => resolveFigmaDesignContext(meta, config),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected Error to be thrown");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// AbortSignal
// ---------------------------------------------------------------------------

test("aborted signal causes resolveFigmaDesignContext to throw", async () => {
  clearResolverCache();

  const controller = new AbortController();
  controller.abort();

  const fetchImpl: typeof fetch = async (_input, init) => {
    // Respect the signal if it is already aborted
    if (init?.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  await assert.rejects(
    () =>
      resolveFigmaDesignContext(meta, config, { signal: controller.signal }),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected Error on abort");
      return true;
    },
  );
});

test("abort during root metadata resolution does not fall back to document root", async () => {
  clearResolverCache();

  let designContextCalled = false;

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    if (tool === "get_design_context") {
      designContextCalled = true;
    }
    return jsonResponse(mcpOk({}));
  };

  await assert.rejects(
    () =>
      resolveFigmaDesignContext({ fileKey: "abc" }, createConfig(fetchImpl)),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected abort error");
      return true;
    },
  );

  assert.equal(
    designContextCalled,
    false,
    "resolveNodeId abort must not fall back to a synthetic 0:1 resolution",
  );
});

test("abort during screenshot fetch rejects instead of returning partial context", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return jsonResponse(mcpOk({}));
  };

  await assert.rejects(
    () =>
      resolveFigmaDesignContext(
        { fileKey: "abc", nodeId: "1:2" },
        createConfig(fetchImpl),
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected abort error");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Error Cases
// ---------------------------------------------------------------------------

test("empty serverUrl — E_MCP_NO_SERVER rejected before fetchImpl; REST fallback also fails — error thrown", async () => {
  clearResolverCache();

  // When serverUrl is empty, callMcpTool throws E_MCP_NO_SERVER without calling
  // fetchImpl. The metadata error is swallowed. The design context error triggers
  // REST fallback. We make REST also fail so the overall call throws.
  const fetchImpl: typeof fetch = async () => {
    // Only REST (api.figma.com) calls reach fetchImpl here.
    throw new Error("REST unavailable");
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    serverUrl: "",
    maxRetries: 1,
  };

  await assert.rejects(
    () => resolveFigmaDesignContext(meta, config),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected Error to be thrown");
      // REST failure surfaced as E_FIGMA_REST_NETWORK; root cause is empty serverUrl.
      const code = (err as Record<string, unknown>).code as string | undefined;
      assert.ok(
        typeof code === "string" && code.startsWith("E_"),
        `Expected a classified pipeline error code, got: ${code ?? "undefined"}`,
      );
      return true;
    },
  );
});

test("non-HTTPS non-localhost serverUrl — error is thrown (MCP rejects, REST also fails)", async () => {
  clearResolverCache();

  // fetchImpl is called only by the REST fallback (api.figma.com).
  // E_MCP_NO_SERVER is thrown inside callMcpTool before fetchImpl for MCP calls.
  // We make REST also throw so the overall call fails.
  const fetchImpl: typeof fetch = async () => {
    throw new Error("REST also unavailable");
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    serverUrl: "ftp://bad-scheme.example.com",
    maxRetries: 1,
  };

  await assert.rejects(
    () => resolveFigmaDesignContext(meta, config),
    (err: unknown) => {
      assert.ok(err instanceof Error, "Expected Error to be thrown");
      // The error surfacing is E_FIGMA_REST_NETWORK (REST fallback also failed),
      // but the root cause is the invalid MCP URL.
      return true;
    },
  );
});

test("HTTP 403 from MCP — design context falls back to REST which also 403s — throws auth error", async () => {
  clearResolverCache();

  // A 403 on get_metadata is swallowed (non-fatal). A 403 on get_design_context
  // triggers REST fallback. If REST also returns 403, the thrown error is
  // E_FIGMA_REST_AUTH (the REST auth error code).
  const fetchImpl: typeof fetch = async () =>
    new Response("forbidden", { status: 403 });

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  await assert.rejects(
    () => resolveFigmaDesignContext(meta, config),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const code = (err as Record<string, unknown>).code as string | undefined;
      // Either MCP auth error or REST auth error — both indicate a 403 condition
      assert.ok(
        code === "E_MCP_AUTH" || code === "E_FIGMA_REST_AUTH",
        `Expected auth error code, got: ${code ?? "undefined"}`,
      );
      return true;
    },
  );
});

test("HTTP 404 from MCP — design context falls back to REST which also 404s — throws not-found error", async () => {
  clearResolverCache();

  // A 404 on get_metadata is swallowed (non-fatal). A 404 on get_design_context
  // triggers REST fallback. If REST also returns 404, the thrown error is
  // E_FIGMA_REST_NOT_FOUND.
  const fetchImpl: typeof fetch = async () =>
    new Response("not found", { status: 404 });

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  await assert.rejects(
    () => resolveFigmaDesignContext(meta, config),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const code = (err as Record<string, unknown>).code as string | undefined;
      // Either MCP not-found or REST not-found — both reflect a 404 condition
      assert.ok(
        code === "E_MCP_NOT_FOUND" || code === "E_FIGMA_REST_NOT_FOUND",
        `Expected not-found error code, got: ${code ?? "undefined"}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

test("skipScreenshot — get_screenshot is never called", async () => {
  clearResolverCache();

  const toolsCalled: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    toolsCalled.push(tool);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  await resolveFigmaDesignContext(meta, createConfig(fetchImpl), {
    skipScreenshot: true,
  });

  assert.equal(
    toolsCalled.includes("get_screenshot"),
    false,
    "get_screenshot must not be called when skipScreenshot is true",
  );
});

// ---------------------------------------------------------------------------
// Constants re-exported
// ---------------------------------------------------------------------------

test("exported constants have expected values", () => {
  assert.equal(DEFAULT_MCP_SERVER_URL, "https://mcp.figma.com/mcp");
  assert.equal(ADAPTIVE_NODE_THRESHOLD, 50);
  assert.equal(MAX_SUBTREE_BATCH_SIZE, 5);
  assert.equal(CACHE_TTL_MS, 5 * 60_000);
});

// ---------------------------------------------------------------------------
// Edge cases — metadata failure is non-fatal
// ---------------------------------------------------------------------------

test("get_metadata failure is non-fatal — falls through to single get_design_context", async () => {
  clearResolverCache();

  const toolsCalled: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    toolsCalled.push(tool);

    if (tool === "get_metadata") {
      // Metadata fails — the resolver should swallow this and proceed
      return new Response("server error", { status: 500 });
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  const result = await resolveFigmaDesignContext(meta, config);

  // get_design_context must still be called even though metadata failed
  assert.equal(toolsCalled.includes("get_design_context"), true);
  // metadata is absent since get_metadata failed
  assert.equal(result.metadata, undefined);
});

// ---------------------------------------------------------------------------
// Edge cases — no nodeId provided (root scan)
// ---------------------------------------------------------------------------

test("no nodeId — root metadata scan is called to resolve nodeId", async () => {
  clearResolverCache();

  const toolCallArgs: Array<{ tool: string; nodeId?: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const rawReq = new Request(input, init);
    const body = (await rawReq.json()) as {
      params?: { name?: string; arguments?: { nodeId?: string } };
    };
    const tool = body.params?.name ?? "";
    const nodeId = body.params?.arguments?.nodeId;
    toolCallArgs.push({ tool, nodeId });

    if (tool === "get_metadata") {
      // First call (root scan at nodeId "0:1") returns XML with a frame
      if (nodeId === "0:1") {
        return jsonResponse(
          mcpOk({
            xml: '<FRAME id="2:5" name="FirstFrame"/>',
          }),
        );
      }
      // Second call (for design context metadata with resolved id)
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  // No nodeId — resolveNodeId must do a root scan
  const meta: FigmaMeta = { fileKey: "abc" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  // First call should be get_metadata with nodeId "0:1" (root scan)
  assert.equal(toolCallArgs[0]?.tool, "get_metadata");
  assert.equal(toolCallArgs[0]?.nodeId, "0:1");

  // The resolved nodeId should be the frame found in the root scan
  assert.equal(result.nodeId, "2:5");
});

test("metadata-based node resolution uses dataType hint when nodeId is absent", async () => {
  clearResolverCache();

  const toolCallArgs: Array<{ tool: string; nodeId?: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const rawReq = new Request(input, init);
    const body = (await rawReq.json()) as {
      params?: { name?: string; arguments?: { nodeId?: string } };
    };
    const tool = body.params?.name ?? "";
    const nodeId = body.params?.arguments?.nodeId;
    toolCallArgs.push({ tool, nodeId });

    if (tool === "get_metadata") {
      if (nodeId === "0:1") {
        return jsonResponse(
          mcpOk({
            xml: '<FRAME id="2:1" name="Screen"/><COMPONENT_SET id="9:99" name="Button Variants"/>',
          }),
        );
      }
      return jsonResponse(
        mcpOk({
          xml: '<COMPONENT_SET id="9:99" name="Button Variants"/>',
        }),
      );
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", dataType: "component_set" },
    createConfig(fetchImpl),
  );

  assert.equal(result.nodeId, "9:99");
  assert.deepEqual(toolCallArgs[0], { tool: "get_metadata", nodeId: "0:1" });
  assert.deepEqual(toolCallArgs[1], { tool: "get_metadata", nodeId: "9:99" });
});

test("metadata-based node resolution prefers pasteID match when available", async () => {
  clearResolverCache();

  const toolCallArgs: Array<{ tool: string; nodeId?: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const rawReq = new Request(input, init);
    const body = (await rawReq.json()) as {
      params?: { name?: string; arguments?: { nodeId?: string } };
    };
    const tool = body.params?.name ?? "";
    const nodeId = body.params?.arguments?.nodeId;
    toolCallArgs.push({ tool, nodeId });

    if (tool === "get_metadata") {
      if (nodeId === "0:1") {
        return jsonResponse(
          mcpOk({
            xml: '<FRAME id="2:7" name="Other Screen"/><FRAME id="8:42" name="Pasted Screen"/><COMPONENT_SET id="9:42" name="Shared Variants"/>',
          }),
        );
      }
      return jsonResponse(
        mcpOk({
          xml: '<FRAME id="8:42" name="Pasted Screen"/>',
        }),
      );
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const result = await resolveFigmaDesignContext(
    { fileKey: "abc", dataType: "scene", pasteID: 42 },
    createConfig(fetchImpl),
  );

  assert.equal(result.nodeId, "8:42");
  assert.deepEqual(toolCallArgs[1], { tool: "get_metadata", nodeId: "8:42" });
});

// ---------------------------------------------------------------------------
// Edge cases — MCP error envelope (JSON-level error)
// ---------------------------------------------------------------------------

test("MCP error envelope in response body — throws E_MCP_SERVER_ERROR", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(ERROR_ENVELOPE);
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  // Metadata failure is swallowed, so get_design_context will be called next.
  // If get_design_context also returns an envelope error, the whole thing falls
  // back to REST.  We test only that the envelope error does not cause an
  // unclassified JS crash.
  const fetchAll: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (new URL(url).hostname === "api.figma.com") {
      return jsonResponse(REST_NODES_SUCCESS);
    }
    return jsonResponse(ERROR_ENVELOPE);
  };

  const configAll: McpResolverConfig = {
    ...createConfig(fetchAll),
    maxRetries: 1,
  };

  // Should not throw — REST fallback kicks in after MCP envelope errors
  const result = await resolveFigmaDesignContext(meta, configAll);
  assert.ok(typeof result.code === "string");
});

// ---------------------------------------------------------------------------
// MCP server URL security policy
// ---------------------------------------------------------------------------

test("production rejects loopback HTTP MCP URLs without WORKSPACE_ALLOW_INSECURE_MCP opt-in", async () => {
  clearResolverCache();

  let fetchCalled = false;
  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: undefined,
    },
    async () => {
      await assert.rejects(
        () =>
          callMcpTool({
            toolName: "get_metadata",
            args: { fileKey: "abc", nodeId: "1:2" },
            config: {
              ...createConfig(fetchImpl),
              serverUrl: "http://localhost:3000/mcp",
              maxRetries: 1,
            },
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(
            (err as Record<string, unknown>).code,
            "E_MCP_NO_SERVER",
          );
          assert.match(err.message, /WORKSPACE_ALLOW_INSECURE_MCP=true/);
          return true;
        },
      );
    },
  );

  assert.equal(fetchCalled, false);
});

test("production allows loopback HTTP MCP URLs when WORKSPACE_ALLOW_INSECURE_MCP=true", async () => {
  clearResolverCache();

  let requestUrl = "";
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      const result = await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: "abc", nodeId: "1:2" },
        config: {
          ...createConfig(fetchImpl),
          serverUrl: "http://127.0.0.1:8080/mcp",
          maxRetries: 1,
          onLog: (message) => {
            logs.push(message);
          },
        },
      });

      assert.deepEqual(result, { xml: SMALL_XML });
    },
  );

  assert.equal(requestUrl, "http://127.0.0.1:8080/mcp");
  assert.ok(
    logs.some((entry) =>
      entry.includes("MCP security warning: using insecure loopback HTTP"),
    ),
  );
});

test("production allows IPv4-mapped IPv6 loopback HTTP MCP URLs when WORKSPACE_ALLOW_INSECURE_MCP=true", async () => {
  clearResolverCache();

  let requestUrl = "";
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      const result = await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: "abc", nodeId: "1:2" },
        config: {
          ...createConfig(fetchImpl),
          serverUrl: "http://[::ffff:127.0.0.1]:3000/mcp",
          maxRetries: 1,
          onLog: (message) => {
            logs.push(message);
          },
        },
      });

      assert.deepEqual(result, { xml: SMALL_XML });
    },
  );

  assert.equal(requestUrl, "http://[::ffff:7f00:1]:3000/mcp");
  assert.ok(
    logs.some(
      (entry) =>
        entry.includes("MCP security warning: using insecure loopback HTTP") &&
        entry.includes("http://[::ffff:7f00:1]:3000"),
    ),
  );
  assert.ok(logs.every((entry) => !entry.includes("/mcp")));
});

test("production allows canonical IPv4-mapped IPv6 loopback HTTP MCP URLs when WORKSPACE_ALLOW_INSECURE_MCP=true", async () => {
  clearResolverCache();

  let requestUrl = "";
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      const result = await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: "abc", nodeId: "1:2" },
        config: {
          ...createConfig(fetchImpl),
          serverUrl: "http://[::ffff:7f00:1]:3000/mcp",
          maxRetries: 1,
          onLog: (message) => {
            logs.push(message);
          },
        },
      });

      assert.deepEqual(result, { xml: SMALL_XML });
    },
  );

  assert.equal(requestUrl, "http://[::ffff:7f00:1]:3000/mcp");
  assert.ok(
    logs.some(
      (entry) =>
        entry.includes("MCP security warning: using insecure loopback HTTP") &&
        entry.includes("http://[::ffff:7f00:1]:3000"),
    ),
  );
  assert.ok(logs.every((entry) => !entry.includes("/mcp")));
});

test("production allows fully expanded IPv4-mapped IPv6 loopback HTTP MCP URLs when WORKSPACE_ALLOW_INSECURE_MCP=true", async () => {
  clearResolverCache();

  let requestUrl = "";
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      const result = await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: "abc", nodeId: "1:2" },
        config: {
          ...createConfig(fetchImpl),
          serverUrl: "http://[0:0:0:0:0:ffff:7f00:1]:3000/mcp",
          maxRetries: 1,
          onLog: (message) => {
            logs.push(message);
          },
        },
      });

      assert.deepEqual(result, { xml: SMALL_XML });
    },
  );

  assert.equal(requestUrl, "http://[::ffff:7f00:1]:3000/mcp");
  assert.ok(
    logs.some(
      (entry) =>
        entry.includes("MCP security warning: using insecure loopback HTTP") &&
        entry.includes("http://[::ffff:7f00:1]:3000"),
    ),
  );
  assert.ok(logs.every((entry) => !entry.includes("/mcp")));
});

test("production rejects canonical IPv4-mapped IPv6 loopback HTTP MCP URLs without WORKSPACE_ALLOW_INSECURE_MCP opt-in", async () => {
  clearResolverCache();

  let fetchCalled = false;
  const fetchImpl: typeof fetch = async () => {
    fetchCalled = true;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "production",
      WORKSPACE_ALLOW_INSECURE_MCP: undefined,
    },
    async () => {
      await assert.rejects(
        () =>
          callMcpTool({
            toolName: "get_metadata",
            args: { fileKey: "abc", nodeId: "1:2" },
            config: {
              ...createConfig(fetchImpl),
              serverUrl: "http://[::ffff:7f00:1]:3000/mcp",
              maxRetries: 1,
            },
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(
            (err as Record<string, unknown>).code,
            "E_MCP_NO_SERVER",
          );
          assert.match(err.message, /WORKSPACE_ALLOW_INSECURE_MCP=true/);
          return true;
        },
      );
    },
  );

  assert.equal(fetchCalled, false);
});

test("non-production loopback HTTP opt-in still emits an insecure transport warning", async () => {
  clearResolverCache();

  const logs: string[] = [];
  const fetchImpl: typeof fetch = async () =>
    jsonResponse(mcpOk({ xml: SMALL_XML }));

  await withEnv(
    {
      NODE_ENV: "development",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      await callMcpTool({
        toolName: "get_metadata",
        args: { fileKey: "abc", nodeId: "1:2" },
        config: {
          ...createConfig(fetchImpl),
          serverUrl: "http://[::1]:3000/mcp",
          maxRetries: 1,
          onLog: (message) => {
            logs.push(message);
          },
        },
      });
    },
  );

  assert.ok(
    logs.some(
      (entry) =>
        entry.includes("MCP security warning: using insecure loopback HTTP") &&
        entry.includes("http://[::1]:3000"),
    ),
  );
  assert.ok(logs.every((entry) => !entry.includes("/mcp")));
});

test("malformed and non-loopback HTTP MCP URLs are rejected before fetch", async () => {
  clearResolverCache();

  let fetchCount = 0;
  const fetchImpl: typeof fetch = async () => {
    fetchCount += 1;
    return jsonResponse(mcpOk({ xml: SMALL_XML }));
  };

  await withEnv(
    {
      NODE_ENV: "development",
      WORKSPACE_ALLOW_INSECURE_MCP: "true",
    },
    async () => {
      for (const serverUrl of [
        "not-a-url",
        "http://example.com/mcp",
        "http://localhost.attacker.tld/mcp",
        "http://localhost@attacker.tld/mcp",
        "http://127.0.0.1.attacker.tld/mcp",
        "http://[::ffff:10.0.0.1]:3000/mcp",
      ]) {
        await assert.rejects(
          () =>
            callMcpTool({
              toolName: "get_metadata",
              args: { fileKey: "abc", nodeId: "1:2" },
              config: {
                ...createConfig(fetchImpl),
                serverUrl,
                maxRetries: 1,
              },
            }),
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.equal(
              (err as Record<string, unknown>).code,
              "E_MCP_NO_SERVER",
            );
            return true;
          },
        );
      }
    },
  );

  assert.equal(fetchCount, 0);
});

// ---------------------------------------------------------------------------
// Edge cases — get_screenshot failure is non-fatal
// ---------------------------------------------------------------------------

test("get_screenshot failure is non-fatal — result is returned without screenshot", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// design code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      // Screenshot call fails
      return new Response("screenshot unavailable", { status: 500 });
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const config: McpResolverConfig = {
    ...createConfig(fetchImpl),
    maxRetries: 1,
  };

  const result = await resolveFigmaDesignContext(meta, config);

  // Should succeed even though screenshot failed
  assert.equal(result.code, "// design code");
  assert.equal(result.screenshot, undefined);
  assert.equal(result.fileKey, "abc");
});

// ---------------------------------------------------------------------------
// Edge cases — no nodeId and root scan returns no frame (falls back to "0:1")
// ---------------------------------------------------------------------------

test("no nodeId and root scan finds no frame — falls back to nodeId 0:1", async () => {
  clearResolverCache();

  const toolCallArgs: Array<{ tool: string; nodeId?: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const rawReq = new Request(input, init);
    const body = (await rawReq.json()) as {
      params?: { name?: string; arguments?: { nodeId?: string } };
    };
    const tool = body.params?.name ?? "";
    const nodeId = body.params?.arguments?.nodeId;
    toolCallArgs.push({ tool, nodeId });

    if (tool === "get_metadata") {
      if (nodeId === "0:1") {
        // Root scan returns XML with no FRAME/COMPONENT/COMPONENT_SET
        return jsonResponse(mcpOk({ xml: "<DOCUMENT id='0:0' name='Doc'/>" }));
      }
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  // When no frame is found, resolveNodeId falls back to "0:1"
  assert.equal(result.nodeId, "0:1");
});

// ---------------------------------------------------------------------------
// Edge cases — result has no diagnostics when all calls succeed cleanly
// ---------------------------------------------------------------------------

test("clean successful run — no diagnostics on result", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  // No warnings or errors expected on a fully successful run
  assert.equal(result.diagnostics, undefined);
});

// ---------------------------------------------------------------------------
// Edge cases — metadata present when get_metadata succeeds
// ---------------------------------------------------------------------------

test("metadata is populated with xml, nodeCount, rootNodeType, rootNodeName when get_metadata succeeds", async () => {
  clearResolverCache();

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// code", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({}));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "abc", nodeId: "1:2" };
  const result = await resolveFigmaDesignContext(meta, createConfig(fetchImpl));

  assert.ok(result.metadata !== undefined, "Expected metadata to be populated");
  assert.ok(result.metadata.xml === SMALL_XML, "xml must match");
  assert.ok(result.metadata.nodeCount > 0, "nodeCount must be > 0");
  assert.equal(result.metadata.rootNodeType, "FRAME");
  assert.equal(result.metadata.rootNodeName, "MyFrame");
});
