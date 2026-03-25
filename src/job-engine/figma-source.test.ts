import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fetchAuthoritativeFigmaSubtrees, fetchFigmaFile } from "./figma-source.js";

const jsonResponse = (payload: unknown, init?: ResponseInit): Response => {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
};

const createRequest = (fetchImpl: typeof fetch) => {
  return {
    fileKey: "abc",
    accessToken: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    bootstrapDepth: 5,
    nodeBatchSize: 4,
    nodeFetchConcurrency: 2,
    adaptiveBatchingEnabled: true,
    maxScreenCandidates: 40,
    cacheEnabled: false,
    cacheTtlMs: 15 * 60_000,
    cacheDir: path.join(os.tmpdir(), "workspace-dev-figma-source-cache-disabled"),
    fetchImpl,
    onLog: () => {
      // no-op
    }
  };
};

const createBootstrapDocument = () => ({
  name: "Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "1:1",
            type: "FRAME",
            name: "Screen A",
            absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
            children: []
          },
          {
            id: "1:2",
            type: "FRAME",
            name: "Screen B",
            absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
            children: []
          }
        ]
      }
    ]
  }
});

const createBootstrapDocumentWithScreens = (count: number) => ({
  name: "Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: Array.from({ length: count }, (_, index) => ({
          id: `1:${index + 1}`,
          type: "FRAME",
          name: `Screen ${index + 1}`,
          absoluteBoundingBox: { x: index * 420, y: 0, width: 400, height: 800 },
          children: []
        }))
      }
    ]
  }
});

const createLowFidelityDirectGeometryDocument = () => ({
  name: "Instance Heavy Board",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-heavy",
            type: "FRAME",
            name: "Heavy Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
            children: [
              ...Array.from({ length: 12 }, (_, index) => ({
                id: `instance-${index + 1}`,
                type: "INSTANCE",
                name: index % 3 === 0 ? "<Card>" : "<Button>",
                absoluteBoundingBox: { x: (index % 3) * 220, y: Math.floor(index / 3) * 120, width: 200, height: 96 },
                children: []
              })),
              {
                id: "vector-logo",
                type: "VECTOR",
                name: "Sparkasse S",
                absoluteBoundingBox: { x: 24, y: 24, width: 24, height: 24 }
              },
              {
                id: "vector-dot",
                type: "VECTOR",
                name: "Ellipse 4",
                absoluteBoundingBox: { x: 52, y: 24, width: 12, height: 12 }
              },
              {
                id: "text-1",
                type: "TEXT",
                name: "Heading",
                characters: "Finanzierungsplaner",
                absoluteBoundingBox: { x: 24, y: 200, width: 240, height: 24 }
              },
              {
                id: "text-2",
                type: "TEXT",
                name: "Body",
                characters: "Bitte prüfen",
                absoluteBoundingBox: { x: 24, y: 232, width: 120, height: 20 }
              },
              {
                id: "text-3",
                type: "TEXT",
                name: "Meta",
                characters: "Meyer Technology GmbH",
                absoluteBoundingBox: { x: 24, y: 264, width: 160, height: 20 }
              },
              {
                id: "text-4",
                type: "TEXT",
                name: "Hint",
                characters: "Bearbeitung gesperrt",
                absoluteBoundingBox: { x: 24, y: 296, width: 160, height: 20 }
              }
            ]
          }
        ]
      }
    ]
  }
});

const findNodeById = (node: unknown, targetId: string): Record<string, unknown> | undefined => {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (record.id === targetId) {
    return record;
  }
  if (!Array.isArray(record.children)) {
    return undefined;
  }

  for (const child of record.children) {
    const nested = findNodeById(child, targetId);
    if (nested) {
      return nested;
    }
  }

  return undefined;
};

const createTempCacheDir = async (): Promise<string> => {
  return await mkdtemp(path.join(os.tmpdir(), "workspace-dev-figma-cache-"));
};

const toCacheFilePath = ({
  cacheDir,
  fileKey,
  lastModified
}: {
  cacheDir: string;
  fileKey: string;
  lastModified: string;
}): string => {
  const hash = createHash("sha256").update(`${fileKey}:${lastModified}`).digest("hex");
  return path.join(cacheDir, `${hash}.json`);
};

const toLatestIndexPath = ({
  cacheDir,
  fileKey
}: {
  cacheDir: string;
  fileKey: string;
}): string => {
  const hash = createHash("sha256").update(fileKey).digest("hex");
  return path.join(cacheDir, `${hash}.latest.json`);
};

test("fetchFigmaFile returns direct geometry payload when request succeeds", async () => {
  const result = await fetchFigmaFile(
    createRequest(async () => {
      return jsonResponse({ name: "Demo", document: { id: "0:0", type: "DOCUMENT", children: [] } });
    })
  );

  assert.equal(result.file.name, "Demo");
  assert.equal(result.diagnostics.sourceMode, "geometry-paths");
  assert.equal(result.diagnostics.fetchedNodes, 0);
});

test("fetchFigmaFile flags low-fidelity direct geometry payloads for instance-heavy explicit boards", async () => {
  const result = await fetchFigmaFile(
    createRequest(async () => {
      return jsonResponse(createLowFidelityDirectGeometryDocument());
    })
  );

  assert.equal(result.diagnostics.sourceMode, "geometry-paths");
  assert.equal(result.diagnostics.lowFidelityDetected, true);
  assert.equal((result.diagnostics.lowFidelityReasons?.length ?? 0) >= 2, true);
  assert.equal(
    (result.diagnostics.lowFidelityReasons ?? []).some((reason) => reason.includes("instance-heavy")),
    true
  );
  assert.equal(
    (result.diagnostics.lowFidelityReasons ?? []).some((reason) => reason.includes("vector nodes")),
    true
  );
});

test("fetchAuthoritativeFigmaSubtrees recovers screen subtrees for low-fidelity direct geometry payloads", async () => {
  const subtrees = await fetchAuthoritativeFigmaSubtrees({
    fileKey: "abc",
    accessToken: "token",
    file: createLowFidelityDirectGeometryDocument(),
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 4,
    fetchImpl: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      assert.match(url, /\/nodes\?/);
      return jsonResponse({
        nodes: {
          "screen-heavy": {
            document: {
              id: "screen-heavy",
              type: "FRAME",
              name: "Heavy Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
              children: [
                {
                  id: "screen-heavy-title",
                  type: "TEXT",
                  name: "Title",
                  characters: "Finanzierungsplaner",
                  absoluteBoundingBox: { x: 24, y: 24, width: 240, height: 24 }
                },
                {
                  id: "screen-heavy-action",
                  type: "TEXT",
                  name: "Action",
                  characters: "Druckcenter",
                  absoluteBoundingBox: { x: 24, y: 56, width: 160, height: 20 }
                }
              ]
            }
          }
        }
      });
    },
    onLog: () => {},
    screenNamePattern: undefined
  });

  assert.deepEqual(subtrees.map((subtree) => subtree.nodeId), ["screen-heavy"]);
  assert.equal(JSON.stringify(subtrees[0]).includes("Druckcenter"), true);
});

test("fetchFigmaFile retries with Bearer header when PAT is rejected", async () => {
  const headersSeen: Array<Record<string, string>> = [];
  let call = 0;

  const result = await fetchFigmaFile(
    createRequest(async (_url, init) => {
      call += 1;
      headersSeen.push(init?.headers as Record<string, string>);
      if (call === 1) {
        return new Response("invalid token", { status: 403 });
      }
      return jsonResponse({ name: "Retried", document: { id: "0:0", type: "DOCUMENT", children: [] } });
    })
  );

  assert.equal(result.file.name, "Retried");
  assert.equal(call, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[0], "X-Figma-Token"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[1], "Authorization"), true);
});

test("fetchFigmaFile retries timed-out response parsing before succeeding", async () => {
  let call = 0;
  const logs: string[] = [];

  const fetchImpl: typeof fetch = async () => {
    call += 1;
    if (call === 1) {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("The operation was aborted due to timeout"));
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    return jsonResponse({
      name: "Recovered After Parse Timeout",
      document: { id: "0:0", type: "DOCUMENT", children: [] }
    });
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    onLog: (message) => {
      logs.push(message);
    }
  });

  assert.equal(result.file.name, "Recovered After Parse Timeout");
  assert.equal(call, 2);
  assert.equal(logs.some((entry) => entry.includes("response parse timed out")), true);
});

test("fetchFigmaFile does not retry true malformed JSON parse errors", async () => {
  let call = 0;

  await assert.rejects(
    () =>
      fetchFigmaFile(
        createRequest(async () => {
          call += 1;
          return new Response("{not valid json", {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        })
      ),
    (error: unknown) => (error as { code?: string }).code === "E_FIGMA_PARSE"
  );

  assert.equal(call, 1);
});

test("fetchFigmaFile falls back to staged fetch when direct request is too large", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 400 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocument());
    }
    if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Loaded Screen A",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          },
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "Loaded Screen B",
              absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(
    createRequest(fetchImpl)
  );

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, []);

  const canvasChildren = (
    (result.file.document as { children?: Array<{ children?: Array<{ name?: string }> }> })?.children?.[0]?.children ?? []
  ).map((node) => node.name);
  assert.deepEqual(canvasChildren, ["Loaded Screen A", "Loaded Screen B"]);
});

test("fetchFigmaFile bisects oversized node batches and falls back to single-node no-geometry", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocument());
    }
    if (asString.includes("/nodes?ids=1%3A1,1%3A2&geometry=paths")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("/nodes?ids=1%3A1") && !asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A (No Geometry)",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A2&geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "Screen B (Geometry)",
              absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(
    {
      ...createRequest(fetchImpl),
      nodeBatchSize: 2
    }
  );

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, ["1:1"]);
});

test("fetchFigmaFile bisects timeout node batches and falls back to single-node no-geometry", async () => {
  const logs: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocument());
    }
    if (asString.includes("/nodes?ids=1%3A1,1%3A2&geometry=paths")) {
      throw new Error("The operation was aborted due to timeout");
    }
    if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
      throw new Error("The operation was aborted due to timeout");
    }
    if (asString.includes("/nodes?ids=1%3A1") && !asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A (No Geometry)",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A2&geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "Screen B (Geometry)",
              absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    nodeBatchSize: 2,
    onLog: (message) => {
      logs.push(message);
    }
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, ["1:1"]);
  assert.equal(logs.some((entry) => entry.includes("timed out with geometry")), true);
});

test("fetchFigmaFile treats parser overflow as too-large and switches to staged fetch", async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async (url) => {
    call += 1;
    const asString = String(url);

    if (call === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("ERR_STRING_TOO_LONG");
        },
        text: async () => "",
        clone: () => {
          return {
            text: async () => ""
          } as Response;
        }
      } as Response;
    }

    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocument());
    }

    if (asString.includes("/nodes?")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          },
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "Screen B",
              absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }

    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(
    createRequest(fetchImpl)
  );

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
});

test("fetchFigmaFile treats undici string-limit parse error as oversized node payload", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Screen A",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                  children: []
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
      return {
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Cannot create a string longer than 0x1fffffe8 characters");
        },
        text: async () => "",
        clone: () => ({ text: async () => "" } as Response)
      } as Response;
    }
    if (asString.includes("/nodes?ids=1%3A1") && !asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A (No Geometry)",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(createRequest(fetchImpl));
  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, ["1:1"]);
});

test("fetchFigmaFile uses byte-limit guard to avoid oversized geometry JSON parsing", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Screen A",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                  children: []
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(70 * 1024 * 1024)
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A1") && !asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A (No Geometry)",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(createRequest(fetchImpl));
  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, ["1:1"]);
});

test("fetchFigmaFile reduces staged batch size adaptively after repeated oversized responses", async () => {
  const requestedGeometryIds: string[][] = [];

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocumentWithScreens(12));
    }
    if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
      const decoded = decodeURIComponent(asString);
      const idsParam = decoded.split("ids=")[1]?.split("&")[0] ?? "";
      const ids = idsParam.split(",").filter((entry) => entry.length > 0);
      requestedGeometryIds.push(ids);
      if (ids.length >= 4) {
        return new Response("Request too large", { status: 413 });
      }
      return jsonResponse({
        nodes: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              document: {
                id,
                type: "FRAME",
                name: `Loaded ${id}`,
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          ])
        )
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(
    {
      ...createRequest(fetchImpl),
      nodeBatchSize: 4,
      nodeFetchConcurrency: 1,
      adaptiveBatchingEnabled: true,
      maxScreenCandidates: 12
    }
  );

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 12);
  assert.equal(
    requestedGeometryIds.some((ids) => ids.length === 4 && ids[0] === "1:9"),
    false
  );
  assert.equal(
    requestedGeometryIds.some((ids) => ids.length === 2 && ids[0] === "1:9"),
    true
  );
});

test("fetchFigmaFile runs staged node geometry batches concurrently", async () => {
  let activeGeometryRequests = 0;
  let maxActiveGeometryRequests = 0;

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocumentWithScreens(6));
    }
    if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
      const decoded = decodeURIComponent(asString);
      const idsParam = decoded.split("ids=")[1]?.split("&")[0] ?? "";
      const ids = idsParam.split(",").filter((entry) => entry.length > 0);

      activeGeometryRequests += 1;
      maxActiveGeometryRequests = Math.max(maxActiveGeometryRequests, activeGeometryRequests);
      try {
        await new Promise((resolve) => {
          setTimeout(resolve, 25);
        });
      } finally {
        activeGeometryRequests -= 1;
      }

      return jsonResponse({
        nodes: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              document: {
                id,
                type: "FRAME",
                name: `Loaded ${id}`,
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          ])
        )
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    nodeBatchSize: 1,
    nodeFetchConcurrency: 3,
    adaptiveBatchingEnabled: false,
    maxScreenCandidates: 6
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 6);
  assert.equal(maxActiveGeometryRequests >= 2, true);
});

test("fetchFigmaFile excludes staged candidates by name and page context", async () => {
  const logs: string[] = [];
  const requestedGeometryUrls: string[] = [];

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "Components",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Profile Screen",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                }
              ]
            },
            {
              id: "0:2",
              type: "CANVAS",
              name: "App",
              children: [
                {
                  id: "2:1",
                  type: "FRAME",
                  name: "icon/home",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                },
                {
                  id: "2:2",
                  type: "FRAME",
                  name: "atom/card",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                },
                {
                  id: "2:3",
                  type: "FRAME",
                  name: "_hidden/debug",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                },
                {
                  id: "2:4",
                  type: "FRAME",
                  name: "Checkout Screen",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?ids=2%3A4&geometry=paths")) {
      requestedGeometryUrls.push(asString);
      return jsonResponse({
        nodes: {
          "2:4": {
            document: {
              id: "2:4",
              type: "FRAME",
              name: "Loaded Checkout",
              absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    onLog: (message: string) => {
      logs.push(message);
    }
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 1);
  assert.equal(requestedGeometryUrls.length, 1);
  assert.equal(logs.some((entry) => entry.includes("excludedByPage=1")), true);
  assert.equal(logs.some((entry) => entry.includes("excludedByName=3")), true);
});

test("fetchFigmaFile prioritizes content-rich staged screen candidates", async () => {
  const requestedGeometryUrls: string[] = [];

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "App",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Decorative Banner",
                  absoluteBoundingBox: { x: 0, y: 0, width: 1800, height: 500 },
                  children: []
                },
                {
                  id: "1:2",
                  type: "FRAME",
                  name: "Login Screen",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: [
                    {
                      id: "1:2:1",
                      type: "TEXT",
                      name: "Welcome",
                      children: []
                    },
                    {
                      id: "1:2:2",
                      type: "FRAME",
                      name: "email input",
                      children: []
                    }
                  ]
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A2&geometry=paths")) {
      requestedGeometryUrls.push(asString);
      return jsonResponse({
        nodes: {
          "1:2": {
            document: {
              id: "1:2",
              type: "FRAME",
              name: "Loaded Login Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    maxScreenCandidates: 1
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 1);
  assert.equal(requestedGeometryUrls.length, 1);
  const selectedScreen = findNodeById(result.file.document, "1:2");
  assert.equal(selectedScreen?.name, "Loaded Login Screen");
});

test("fetchFigmaFile applies screenNamePattern include filter for staged candidates", async () => {
  const requestedGeometryIds: string[][] = [];

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              name: "App",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Auth/Login",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                },
                {
                  id: "1:2",
                  type: "FRAME",
                  name: "Settings",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                },
                {
                  id: "1:3",
                  type: "FRAME",
                  name: "Auth/Register",
                  absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                  children: []
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
      const decoded = decodeURIComponent(asString);
      const idsParam = decoded.split("ids=")[1]?.split("&")[0] ?? "";
      const ids = idsParam.split(",").filter((entry) => entry.length > 0);
      requestedGeometryIds.push(ids);
      return jsonResponse({
        nodes: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              document: {
                id,
                type: "FRAME",
                name: `Loaded ${id}`,
                absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
                children: []
              }
            }
          ])
        )
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    screenNamePattern: "^auth/"
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
  assert.deepEqual(requestedGeometryIds, [["1:1", "1:3"]]);
});

test("fetchFigmaFile ignores invalid screenNamePattern and continues staged fetch", async () => {
  const logs: string[] = [];
  const requestedGeometryIds: string[][] = [];

  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse(createBootstrapDocument());
    }
    if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
      const decoded = decodeURIComponent(asString);
      const idsParam = decoded.split("ids=")[1]?.split("&")[0] ?? "";
      const ids = idsParam.split(",").filter((entry) => entry.length > 0);
      requestedGeometryIds.push(ids);
      return jsonResponse({
        nodes: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              document: {
                id,
                type: "FRAME",
                name: `Loaded ${id}`,
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          ])
        )
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile({
    ...createRequest(fetchImpl),
    screenNamePattern: "(",
    onLog: (message: string) => {
      logs.push(message);
    }
  });

  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 2);
  assert.deepEqual(requestedGeometryIds, [["1:1", "1:2"]]);
  assert.equal(logs.some((entry) => entry.includes("Invalid figmaScreenNamePattern")), true);
});

test("fetchFigmaFile uses cache for repeated direct geometry requests", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let metadataRequests = 0;
  let geometryRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        return jsonResponse({
          name: "Demo",
          lastModified: "2026-03-16T05:00:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        geometryRequests += 1;
        return jsonResponse({
          name: `Demo-${geometryRequests}`,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    };

    const first = await fetchFigmaFile(request);
    const second = await fetchFigmaFile(request);

    assert.equal(first.diagnostics.sourceMode, "geometry-paths");
    assert.equal(second.diagnostics.sourceMode, "geometry-paths");
    assert.equal(first.file.name, "Demo-1");
    assert.equal(second.file.name, "Demo-1");
    assert.equal(metadataRequests, 2);
    assert.equal(geometryRequests, 1);
    assert.equal(logs.some((entry) => entry.includes("cache hit")), true);
    assert.equal(logs.some((entry) => entry.includes("cache write completed")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile bypasses cache when metadata lastModified changes", async () => {
  const cacheDir = await createTempCacheDir();
  let metadataRequests = 0;
  let geometryRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        return jsonResponse({
          name: "Demo",
          lastModified: metadataRequests === 1 ? "2026-03-16T05:10:00Z" : "2026-03-16T05:11:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        geometryRequests += 1;
        return jsonResponse({
          name: `Demo-${geometryRequests}`,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir
    };

    const first = await fetchFigmaFile(request);
    const second = await fetchFigmaFile(request);
    assert.equal(first.file.name, "Demo-1");
    assert.equal(second.file.name, "Demo-2");
    assert.equal(geometryRequests, 2);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile invalidates stale cache entries based on TTL", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let geometryRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        return jsonResponse({
          name: "Demo",
          lastModified: "2026-03-16T05:20:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        geometryRequests += 1;
        return jsonResponse({
          name: `Demo-${geometryRequests}`,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 5,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    };

    await fetchFigmaFile(request);
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await fetchFigmaFile(request);

    assert.equal(geometryRequests, 2);
    assert.equal(logs.some((entry) => entry.includes("cache stale")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile skips metadata/cache IO when cache is disabled", async () => {
  const cacheDir = await createTempCacheDir();
  let metadataRequests = 0;
  let geometryRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        throw new Error("Metadata endpoint must not be called when cache is disabled.");
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        geometryRequests += 1;
        return jsonResponse({
          name: `Demo-${geometryRequests}`,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    await fetchFigmaFile({
      ...createRequest(fetchImpl),
      cacheEnabled: false,
      cacheDir
    });
    await fetchFigmaFile({
      ...createRequest(fetchImpl),
      cacheEnabled: false,
      cacheDir
    });

    assert.equal(metadataRequests, 0);
    assert.equal(geometryRequests, 2);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile falls back to fresh fetch when metadata request fails", async () => {
  const cacheDir = await createTempCacheDir();
  let metadataRequests = 0;
  let geometryRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        return new Response("metadata failure", { status: 500 });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        geometryRequests += 1;
        return jsonResponse({
          name: "Demo",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const result = await fetchFigmaFile({
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheDir
    });

    assert.equal(result.diagnostics.sourceMode, "geometry-paths");
    assert.equal(metadataRequests >= 1, true);
    assert.equal(geometryRequests, 1);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile reuses cached staged result on repeated runs", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let metadataRequests = 0;
  let directGeometryRequests = 0;
  let versionsRequests = 0;
  let bootstrapRequests = 0;
  let nodeRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        return jsonResponse({
          name: "Demo",
          lastModified: "2026-03-16T05:30:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        directGeometryRequests += 1;
        return new Response("Request too large", { status: 413 });
      }
      if (asString.includes("/versions?page_size=1")) {
        versionsRequests += 1;
        return jsonResponse({
          versions: [{ id: "2331244008983733558" }]
        });
      }
      if (asString.includes("?depth=5")) {
        bootstrapRequests += 1;
        return jsonResponse(createBootstrapDocument());
      }
      if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
        nodeRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: "Loaded Screen A",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Loaded Screen B",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    };

    const first = await fetchFigmaFile(request);
    const second = await fetchFigmaFile(request);

    assert.equal(first.diagnostics.sourceMode, "staged-nodes");
    assert.equal(second.diagnostics.sourceMode, "staged-nodes");
    assert.equal(first.diagnostics.fetchedNodes, 2);
    assert.equal(second.diagnostics.fetchedNodes, 2);
    assert.equal(metadataRequests, 2);
    assert.equal(directGeometryRequests, 1);
    assert.equal(versionsRequests, 1);
    assert.equal(bootstrapRequests, 1);
    assert.equal(nodeRequests, 1);
    assert.equal(logs.some((entry) => entry.includes("cache hit")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile incrementally refetches only changed staged candidates", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let metadataRequests = 0;
  let currentLastModified = "";
  let snapshotRequests = 0;
  const geometryNodeUrls: string[] = [];

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        currentLastModified =
          metadataRequests === 1 ? "2026-03-16T09:00:00Z" : "2026-03-16T09:10:00Z";
        return jsonResponse({
          name: "Demo",
          lastModified: currentLastModified,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        return new Response("Request too large", { status: 413 });
      }
      if (asString.includes("/versions?page_size=1")) {
        return jsonResponse({
          versions: [{ id: currentLastModified.endsWith("10:00Z") ? "v2" : "v1" }]
        });
      }
      if (asString.includes("?depth=5")) {
        return jsonResponse(createBootstrapDocument());
      }
      if (asString.includes("/nodes?ids=1%3A1,1%3A2") && !asString.includes("geometry=paths")) {
        snapshotRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: currentLastModified.endsWith("10:00Z") ? "Screen A Changed" : "Screen A",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Screen B",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
        geometryNodeUrls.push(asString);
        if (asString.includes("/nodes?ids=1%3A1,1%3A2&geometry=paths")) {
          return jsonResponse({
            nodes: {
              "1:1": {
                document: {
                  id: "1:1",
                  type: "FRAME",
                  name: "Loaded Screen A v1",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                  children: []
                }
              },
              "1:2": {
                document: {
                  id: "1:2",
                  type: "FRAME",
                  name: "Loaded Screen B v1",
                  absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                  children: []
                }
              }
            }
          });
        }
        if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
          return jsonResponse({
            nodes: {
              "1:1": {
                document: {
                  id: "1:1",
                  type: "FRAME",
                  name: "Loaded Screen A v2",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                  children: []
                }
              }
            }
          });
        }
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    };

    const first = await fetchFigmaFile(request);
    const second = await fetchFigmaFile(request);

    assert.equal(first.diagnostics.sourceMode, "staged-nodes");
    assert.equal(second.diagnostics.sourceMode, "staged-nodes");
    assert.equal(first.diagnostics.fetchedNodes, 2);
    assert.equal(second.diagnostics.fetchedNodes, 1);
    assert.equal(snapshotRequests, 1);
    assert.equal(geometryNodeUrls.length, 2);
    assert.equal(
      geometryNodeUrls.some((entry) => entry.includes("/nodes?ids=1%3A1,1%3A2&geometry=paths")),
      true
    );
    assert.equal(
      geometryNodeUrls.some((entry) => entry.includes("/nodes?ids=1%3A1&geometry=paths")),
      true
    );
    assert.equal(logs.some((entry) => entry.includes("incremental reuse=1, changed=1")), true);

    const screenA = findNodeById(second.file.document, "1:1");
    const screenB = findNodeById(second.file.document, "1:2");
    assert.equal(screenA?.name, "Loaded Screen A v2");
    assert.equal(screenB?.name, "Loaded Screen B v1");
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile incrementally reuses all staged candidates when subtree hashes match", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let metadataRequests = 0;
  let currentLastModified = "";
  let snapshotRequests = 0;
  let geometryNodeRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        metadataRequests += 1;
        currentLastModified =
          metadataRequests === 1 ? "2026-03-16T10:00:00Z" : "2026-03-16T10:10:00Z";
        return jsonResponse({
          name: "Demo",
          lastModified: currentLastModified,
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        return new Response("Request too large", { status: 413 });
      }
      if (asString.includes("/versions?page_size=1")) {
        return jsonResponse({
          versions: [{ id: currentLastModified.endsWith("10:10:00Z") ? "v2" : "v1" }]
        });
      }
      if (asString.includes("?depth=5")) {
        return jsonResponse(createBootstrapDocument());
      }
      if (asString.includes("/nodes?ids=1%3A1,1%3A2") && !asString.includes("geometry=paths")) {
        snapshotRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: "Screen A",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Screen B",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
        geometryNodeRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: "Loaded Screen A v1",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Loaded Screen B v1",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const request = {
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    };

    const first = await fetchFigmaFile(request);
    const second = await fetchFigmaFile(request);
    assert.equal(first.diagnostics.fetchedNodes, 2);
    assert.equal(second.diagnostics.fetchedNodes, 0);
    assert.equal(snapshotRequests, 1);
    assert.equal(geometryNodeRequests, 1);
    assert.equal(logs.some((entry) => entry.includes("incremental reuse=2, changed=0")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile falls back to full staged fetch when versions endpoint fails", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let nodeRequests = 0;

  try {
    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        return jsonResponse({
          name: "Demo",
          lastModified: "2026-03-16T11:00:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        return new Response("Request too large", { status: 413 });
      }
      if (asString.includes("/versions?page_size=1")) {
        return new Response("not found", { status: 404 });
      }
      if (asString.includes("?depth=5")) {
        return jsonResponse(createBootstrapDocument());
      }
      if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
        nodeRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: "Loaded Screen A",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Loaded Screen B",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const result = await fetchFigmaFile({
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    });

    assert.equal(result.diagnostics.sourceMode, "staged-nodes");
    assert.equal(result.diagnostics.fetchedNodes, 2);
    assert.equal(nodeRequests, 1);
    assert.equal(logs.some((entry) => entry.includes("versions check failed")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile treats missing previous subtree snapshot as changed candidates", async () => {
  const cacheDir = await createTempCacheDir();
  const logs: string[] = [];
  let geometryNodeRequests = 0;

  try {
    const previousLastModified = "2026-03-16T12:00:00Z";
    const previousCachePath = toCacheFilePath({
      cacheDir,
      fileKey: "abc",
      lastModified: previousLastModified
    });
    const previousEntry = {
      version: 1,
      fileKey: "abc",
      lastModified: previousLastModified,
      cachedAt: Date.now(),
      ttlMs: 60_000,
      diagnostics: {
        sourceMode: "staged-nodes",
        fetchedNodes: 2,
        degradedGeometryNodes: []
      },
      file: createBootstrapDocument()
    };
    await writeFile(previousCachePath, `${JSON.stringify(previousEntry, null, 2)}\n`, "utf8");

    const latestIndexPath = toLatestIndexPath({ cacheDir, fileKey: "abc" });
    await writeFile(
      latestIndexPath,
      `${JSON.stringify(
        {
          version: 1,
          fileKey: "abc",
          lastModified: previousLastModified,
          updatedAt: Date.now()
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const fetchImpl: typeof fetch = async (url) => {
      const asString = String(url);
      if (asString.includes("?depth=1") && !asString.includes("/nodes?")) {
        return jsonResponse({
          name: "Demo",
          lastModified: "2026-03-16T12:10:00Z",
          document: { id: "0:0", type: "DOCUMENT", children: [] }
        });
      }
      if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
        return new Response("Request too large", { status: 413 });
      }
      if (asString.includes("/versions?page_size=1")) {
        return jsonResponse({
          versions: [{ id: "v2" }]
        });
      }
      if (asString.includes("?depth=5")) {
        return jsonResponse(createBootstrapDocument());
      }
      if (asString.includes("/nodes?") && asString.includes("geometry=paths")) {
        geometryNodeRequests += 1;
        return jsonResponse({
          nodes: {
            "1:1": {
              document: {
                id: "1:1",
                type: "FRAME",
                name: "Loaded Screen A",
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                children: []
              }
            },
            "1:2": {
              document: {
                id: "1:2",
                type: "FRAME",
                name: "Loaded Screen B",
                absoluteBoundingBox: { x: 420, y: 0, width: 400, height: 800 },
                children: []
              }
            }
          }
        });
      }
      throw new Error(`Unexpected URL: ${asString}`);
    };

    const result = await fetchFigmaFile({
      ...createRequest(fetchImpl),
      cacheEnabled: true,
      cacheTtlMs: 60_000,
      cacheDir,
      onLog: (message: string) => {
        logs.push(message);
      }
    });

    assert.equal(result.diagnostics.sourceMode, "staged-nodes");
    assert.equal(result.diagnostics.fetchedNodes, 2);
    assert.equal(geometryNodeRequests, 1);
    assert.equal(logs.some((entry) => entry.includes("previous subtree hashes missing")), true);
  } finally {
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fetchFigmaFile recovers icon descendant geometry after no-geometry fallback", async () => {
  const observedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
    const asString = String(url);
    observedUrls.push(asString);

    if (asString.includes("?geometry=paths") && !asString.includes("/nodes?")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("?depth=5")) {
      return jsonResponse({
        name: "Demo",
        document: {
          id: "0:0",
          type: "DOCUMENT",
          children: [
            {
              id: "0:1",
              type: "CANVAS",
              children: [
                {
                  id: "1:1",
                  type: "FRAME",
                  name: "Screen A",
                  absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
                  children: []
                }
              ]
            }
          ]
        }
      });
    }
    if (asString.includes("/nodes?ids=1%3A1&geometry=paths")) {
      return new Response("Request too large", { status: 413 });
    }
    if (asString.includes("/nodes?ids=1%3A1") && !asString.includes("geometry=paths")) {
      return jsonResponse({
        nodes: {
          "1:1": {
            document: {
              id: "1:1",
              type: "FRAME",
              name: "Screen A (No Geometry)",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: [
                {
                  id: "2:1",
                  type: "INSTANCE",
                  name: "ic_home",
                  absoluteBoundingBox: { x: 4, y: 4, width: 24, height: 24 },
                  children: []
                },
                {
                  id: "2:2",
                  type: "INSTANCE",
                  name: "MuiSvgIconRoot",
                  absoluteBoundingBox: { x: 32, y: 4, width: 20, height: 20 },
                  children: []
                },
                {
                  id: "2:3",
                  type: "INSTANCE",
                  name: "ic_too_large",
                  absoluteBoundingBox: { x: 56, y: 4, width: 200, height: 200 },
                  children: []
                }
              ]
            }
          }
        }
      });
    }
    if (asString.includes("/nodes?ids=2%3A1,2%3A2&geometry=paths")) {
      return jsonResponse({
        nodes: {
          "2:1": {
            document: {
              id: "2:1",
              type: "INSTANCE",
              name: "ic_home",
              vectorPaths: ["M1 1L12 12Z"],
              children: []
            }
          },
          "2:2": {
            document: {
              id: "2:2",
              type: "INSTANCE",
              name: "MuiSvgIconRoot",
              vectorPaths: ["M0 0H10V10H0Z"],
              children: []
            }
          }
        }
      });
    }
    throw new Error(`Unexpected URL: ${asString}`);
  };

  const result = await fetchFigmaFile(createRequest(fetchImpl));
  assert.equal(result.diagnostics.sourceMode, "staged-nodes");
  assert.equal(result.diagnostics.fetchedNodes, 3);
  assert.deepEqual(result.diagnostics.degradedGeometryNodes, ["1:1"]);
  assert.equal(observedUrls.some((url) => url.includes("/nodes?ids=2%3A1,2%3A2&geometry=paths")), true);

  const recoveredIconA = findNodeById(result.file.document, "2:1");
  const recoveredIconB = findNodeById(result.file.document, "2:2");
  assert.deepEqual(recoveredIconA?.vectorPaths, ["M1 1L12 12Z"]);
  assert.deepEqual(recoveredIconB?.vectorPaths, ["M0 0H10V10H0Z"]);
});

test("fetchFigmaFile classifies http failures and parse errors", async () => {
  await assert.rejects(
    () =>
      fetchFigmaFile(
        createRequest(async () => {
          return new Response("not found", { status: 404 });
        })
      ),
    (error: unknown) => (error as { code?: string }).code === "E_FIGMA_NOT_FOUND"
  );

  await assert.rejects(
    () =>
      fetchFigmaFile(
        createRequest(async () => {
          return jsonResponse(["not-an-object"]);
        })
      ),
    (error: unknown) => (error as { code?: string }).code === "E_FIGMA_PARSE"
  );
});

test("fetchFigmaFile returns path-aware schema validation errors for malformed payloads", async () => {
  await assert.rejects(
    () =>
      fetchFigmaFile(
        createRequest(async () => {
          return jsonResponse({
            name: "Malformed",
            document: {
              id: "0:0",
              type: "DOCUMENT",
              children: [
                {
                  type: "CANVAS",
                  children: []
                }
              ]
            }
          });
        })
      ),
    (error: unknown) => {
      const candidate = error as { code?: string; message?: string };
      return candidate.code === "E_FIGMA_PARSE" && (candidate.message?.includes("document.children[0].id") ?? false);
    }
  );
});
