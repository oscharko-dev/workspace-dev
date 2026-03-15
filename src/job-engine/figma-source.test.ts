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

const createRequest = (fetchImpl: typeof fetch) => {
  return {
    fileKey: "abc",
    accessToken: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    bootstrapDepth: 5,
    nodeBatchSize: 4,
    maxScreenCandidates: 40,
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

test("fetchFigmaFile returns direct geometry payload when request succeeds", async () => {
  const result = await fetchFigmaFile(
    createRequest(async () => {
      return jsonResponse({ name: "Demo", document: { id: "0:0", type: "DOCUMENT" } });
    })
  );

  assert.equal(result.file.name, "Demo");
  assert.equal(result.diagnostics.sourceMode, "geometry-paths");
  assert.equal(result.diagnostics.fetchedNodes, 0);
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
      return jsonResponse({ name: "Retried", document: { id: "0:0", type: "DOCUMENT" } });
    })
  );

  assert.equal(result.file.name, "Retried");
  assert.equal(call, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[0], "X-Figma-Token"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(headersSeen[1], "Authorization"), true);
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
