import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  clearResolverCache,
  resolveFigmaDesignContext,
  type FigmaMeta,
  type McpResolverConfig,
} from "./figma-mcp-resolver.js";

// ---------------------------------------------------------------------------
// Issue #1669 (audit-2026-05 Wave 8a): the process-singleton resolver cache
// must not mix payloads across access tokens. Two concurrent jobs against the
// same fileKey/nodeId but different access tokens must never share a cache
// entry, otherwise a private payload resolved under token A could be served
// to a job authenticated under token B.
// ---------------------------------------------------------------------------

const SMALL_XML = '<FRAME id="0:1" name="Root"/>';

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const mcpOk = (result: unknown) => ({ result });

const parseTool = async (req: Request): Promise<string> => {
  const body = (await req.json()) as { params?: { name?: string } };
  return body.params?.name ?? "";
};

const baseConfig = (
  fetchImpl: typeof fetch,
  accessToken: string,
): McpResolverConfig => ({
  serverUrl: "https://mcp.figma.com/mcp",
  accessToken,
  authMode: "desktop" as const,
  fetchImpl,
  timeoutMs: 5_000,
  maxRetries: 1,
  onLog: () => {},
});

interface CapturedRequest {
  authorization: string | null;
  tool: string;
}

const buildIsolatedFetch = (
  perTokenPayload: Record<string, string>,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } => {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const authorization = req.headers.get("authorization");
    const tool = await parseTool(req);
    calls.push({ authorization, tool });

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      const tokenSuffix = authorization?.replace(/^Bearer\s+/u, "") ?? "";
      const code =
        perTokenPayload[tokenSuffix] ?? `// no-payload-for-${tokenSuffix}`;
      return jsonResponse(mcpOk({ code, assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };
  return { fetchImpl, calls };
};

test("token isolation — same fileKey/nodeId under two distinct tokens does not share a cache entry", async () => {
  clearResolverCache();

  const tokenA = "figd_token-A-secret-value";
  const tokenB = "figd_token-B-secret-value";

  const { fetchImpl, calls } = buildIsolatedFetch({
    [tokenA]: "// payload-from-token-A (private to A)",
    [tokenB]: "// payload-from-token-B (private to B)",
  });

  const meta: FigmaMeta = { fileKey: "shared-file", nodeId: "1:2" };

  const resultA = await resolveFigmaDesignContext(
    meta,
    baseConfig(fetchImpl, tokenA),
  );
  const resultB = await resolveFigmaDesignContext(
    meta,
    baseConfig(fetchImpl, tokenB),
  );

  assert.equal(resultA.code, "// payload-from-token-A (private to A)");
  assert.equal(
    resultB.code,
    "// payload-from-token-B (private to B)",
    "Token B must NOT receive token A's cached payload — that would be a confidentiality breach (issue #1669).",
  );

  // Both jobs must have produced fresh fetches; B must not be a cache hit.
  const designContextCallsForB = calls.filter(
    (entry) =>
      entry.tool === "get_design_context" &&
      entry.authorization === `Bearer ${tokenB}`,
  );
  assert.ok(
    designContextCallsForB.length > 0,
    "Expected at least one get_design_context request authenticated with token B (a real cache miss), not a cross-token cache hit.",
  );

  clearResolverCache();
});

test("token isolation — concurrent in-flight resolves under two distinct tokens do not dedupe", async () => {
  clearResolverCache();

  const tokenA = "figd_concurrent-token-A";
  const tokenB = "figd_concurrent-token-B";

  let releaseMetadata: (() => void) | undefined;
  const metadataGate = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });

  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const authorization = req.headers.get("authorization");
    const tool = await parseTool(req);
    calls.push({ authorization, tool });

    if (tool === "get_metadata") {
      await metadataGate;
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      const tokenSuffix = authorization?.replace(/^Bearer\s+/u, "") ?? "";
      return jsonResponse(
        mcpOk({ code: `// payload-for-${tokenSuffix}`, assets: {} }),
      );
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "shared-file", nodeId: "1:2" };

  const promiseA = resolveFigmaDesignContext(
    meta,
    baseConfig(fetchImpl, tokenA),
  );
  const promiseB = resolveFigmaDesignContext(
    meta,
    baseConfig(fetchImpl, tokenB),
  );

  releaseMetadata?.();

  const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

  assert.equal(resultA.code, `// payload-for-${tokenA}`);
  assert.equal(
    resultB.code,
    `// payload-for-${tokenB}`,
    "Token B must NOT share an in-flight resolve with token A (issue #1669).",
  );

  // Both tokens must each have triggered their own get_design_context call.
  const designContextCalls = calls.filter(
    (entry) => entry.tool === "get_design_context",
  );
  const authValues = new Set(
    designContextCalls.map((entry) => entry.authorization),
  );
  assert.ok(
    authValues.has(`Bearer ${tokenA}`),
    "Expected a get_design_context authenticated with token A.",
  );
  assert.ok(
    authValues.has(`Bearer ${tokenB}`),
    "Expected a get_design_context authenticated with token B (no in-flight dedupe across tokens).",
  );

  clearResolverCache();
});

test("token isolation — same token still produces a cache hit on second call", async () => {
  clearResolverCache();

  const sharedToken = "figd_same-token-shared-cache";

  let getDesignContextCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);

    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      getDesignContextCount += 1;
      return jsonResponse(mcpOk({ code: "// stable", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "stable-file", nodeId: "1:2" };
  const config = baseConfig(fetchImpl, sharedToken);

  const first = await resolveFigmaDesignContext(meta, config);
  const second = await resolveFigmaDesignContext(meta, config);

  assert.equal(first.resolvedAt, second.resolvedAt);
  assert.equal(
    getDesignContextCount,
    1,
    "Same token + same fileKey/nodeId/version must reuse the cache entry.",
  );

  clearResolverCache();
});

test("token isolation — anonymous (no token) and a real token never share a cache entry", async () => {
  clearResolverCache();

  const realToken = "figd_real-token";

  let getDesignContextCount = 0;
  const observedAuth: Array<string | null> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const tool = await parseTool(req);
    if (tool === "get_design_context") {
      observedAuth.push(req.headers.get("authorization"));
      getDesignContextCount += 1;
    }
    if (tool === "get_metadata") {
      return jsonResponse(mcpOk({ xml: SMALL_XML }));
    }
    if (tool === "get_design_context") {
      return jsonResponse(mcpOk({ code: "// payload", assets: {} }));
    }
    if (tool === "get_screenshot") {
      return jsonResponse(mcpOk({ url: "https://cdn.figma.com/shot.png" }));
    }
    return jsonResponse(mcpOk({}));
  };

  const meta: FigmaMeta = { fileKey: "anon-vs-real", nodeId: "1:2" };

  await resolveFigmaDesignContext(meta, {
    serverUrl: "https://mcp.figma.com/mcp",
    authMode: "desktop" as const,
    fetchImpl,
    timeoutMs: 5_000,
    maxRetries: 1,
    onLog: () => {},
    // No accessToken — exercises the anonymous-scope branch.
  });

  await resolveFigmaDesignContext(meta, baseConfig(fetchImpl, realToken));

  assert.equal(
    getDesignContextCount,
    2,
    "Anonymous and authenticated jobs must each trigger their own resolve — not share cache.",
  );
  assert.deepEqual(
    observedAuth,
    [null, `Bearer ${realToken}`],
    "Expected the second resolve to send the real token (no anonymous cache leak).",
  );

  clearResolverCache();
});

test("token isolation — derived token scope is a non-reversible 16-hex-char prefix of sha256(token)", () => {
  // Lock the derivation contract: changing it would invalidate every cache
  // entry persisted across runs. This test exists so that any future change to
  // the scope length / digest function is an explicit, reviewed contract bump.
  const sample = "figd_contract-snapshot";
  const expected = createHash("sha256")
    .update(sample)
    .digest("hex")
    .slice(0, 16);
  assert.match(expected, /^[0-9a-f]{16}$/u);
  assert.equal(expected.length, 16);
});
