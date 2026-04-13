import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultFigmaMcpEnrichmentLoader } from "./figma-hybrid-enrichment.js";

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

const demoRawFile = {
  name: "Demo File",
  lastModified: "2026-04-13T10:00:00.000Z",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    name: "Root",
    children: [
      {
        id: "1:1",
        type: "CANVAS",
        name: "Page 1",
        children: [
          {
            id: "2:1",
            type: "FRAME",
            name: "Checkout",
            children: [],
          },
        ],
      },
    ],
  },
};

const createLoaderInput = (fetchImpl: typeof fetch) => ({
  figmaFileKey: "demo-file",
  figmaAccessToken: "test-token",
  cleanedFile: demoRawFile,
  rawFile: demoRawFile,
  jobDir: "/tmp/workspace-dev-job",
  fetchImpl,
});

test("default hybrid loader resolves MCP context into enrichment coverage", async () => {
  const toolCalls: Array<{ tool: string; nodeId?: string }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname === "mcp.figma.com") {
      const body = (await request.json()) as {
        params?: { name?: string; arguments?: { nodeId?: string } };
      };
      toolCalls.push({
        tool: body.params?.name ?? "",
        nodeId: body.params?.arguments?.nodeId,
      });

      if (body.params?.name === "get_metadata") {
        return jsonResponse({
          result: {
            xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
          },
        });
      }
      if (body.params?.name === "get_design_context") {
        return jsonResponse({
          result: {
            code: "export default function Checkout() {}",
            assets: { "2:9": "https://cdn.figma.com/assets/hero.png" },
          },
        });
      }
      if (body.params?.name === "get_screenshot") {
        return jsonResponse({
          result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
        });
      }
      if (body.params?.name === "get_variable_defs") {
        return jsonResponse({
          result: {
            variables: [
              {
                name: "color/primary",
                resolvedValue: "#3B82F6",
                type: "COLOR",
                collection: "Colors",
              },
            ],
          },
        });
      }
      if (body.params?.name === "search_design_system") {
        return jsonResponse({
          result: {
            components: [],
            styles: [{ name: "Heading/H1", styleType: "TEXT", fontSizePx: 32 }],
            variables: [],
          },
        });
      }
    }

    throw new Error(`Unexpected request: ${request.url}`);
  };

  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader(createLoaderInput(fetchImpl));

  assert.deepEqual(
    toolCalls.map((entry) => entry.tool),
    [
      "get_metadata",
      "get_design_context",
      "get_screenshot",
      "get_variable_defs",
      "search_design_system",
    ],
  );
  assert.deepEqual(
    toolCalls.map((entry) => entry.nodeId),
    ["2:1", "2:1", "2:1", "2:1", undefined],
  );
  assert.equal(enrichment.sourceMode, "hybrid");
  assert.deepEqual(enrichment.toolNames, [
    "get_design_context",
    "get_metadata",
    "get_screenshot",
    "get_variable_defs",
    "search_design_system",
  ]);
  assert.equal(enrichment.metadataHints?.[0]?.nodeId, "2:1");
  assert.equal(enrichment.metadataHints?.[0]?.layerName, "Checkout");
  assert.equal(
    enrichment.assets?.[0]?.source,
    "https://cdn.figma.com/assets/hero.png",
  );
  assert.equal(
    enrichment.screenshots?.[0]?.url,
    "https://cdn.figma.com/screenshots/checkout.png",
  );
  assert.ok(
    enrichment.cssCustomProperties?.includes("--color-primary: #3B82F6;"),
  );
  assert.deepEqual(enrichment.libraryKeys, []);
  assert.deepEqual(enrichment.modeAlternatives, {});
  assert.deepEqual(enrichment.conflicts, []);
  assert.deepEqual(enrichment.unmappedVariables, []);
});

test("default hybrid loader propagates safe bridge side outputs", async () => {
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader(
    createLoaderInput(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      if (url.hostname !== "mcp.figma.com") {
        throw new Error(`Unexpected request: ${request.url}`);
      }

      const body = (await request.json()) as {
        params?: { name?: string; arguments?: { nodeId?: string } };
      };
      const toolName = body.params?.name;

      if (toolName === "get_metadata") {
        return jsonResponse({
          result: {
            xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
          },
        });
      }
      if (toolName === "get_design_context") {
        return jsonResponse({
          result: {
            code: "export default function Checkout() {}",
            assets: {},
          },
        });
      }
      if (toolName === "get_screenshot") {
        return jsonResponse({
          result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
        });
      }
      if (toolName === "get_variable_defs") {
        return jsonResponse({
          result: {
            variables: [
              {
                name: "color/primary",
                resolvedValue: "#3B82F6",
                type: "COLOR",
                collection: "Colors",
                mode: "Light",
              },
              {
                name: "color/primary",
                resolvedValue: "#111827",
                type: "COLOR",
                collection: "Colors",
                mode: "Dark",
              },
              {
                name: "feature/darkMode",
                resolvedValue: true,
                type: "BOOLEAN",
              },
            ],
          },
        });
      }
      if (toolName === "search_design_system") {
        return jsonResponse({
          result: {
            components: [{ libraryKey: "lib-1" }],
            styles: [],
            variables: [],
          },
        });
      }

      throw new Error(`Unexpected tool: ${String(toolName)}`);
    }),
  );

  assert.ok(
    enrichment.cssCustomProperties?.includes("--color-primary: #3B82F6;"),
  );
  assert.deepEqual(enrichment.libraryKeys, ["lib-1"]);
  assert.deepEqual(enrichment.modeAlternatives, {
    "color-primary": {
      Dark: "#111827",
      Light: "#3B82F6",
    },
  });
  assert.ok(enrichment.tailwindExtension);
  assert.equal(
    enrichment.tailwindExtension?.colors?.["color-primary"],
    "#3B82F6",
  );
  assert.deepEqual(enrichment.conflicts, []);
  assert.deepEqual(enrichment.unmappedVariables, ["feature/darkMode"]);
});

test("default hybrid loader records successful bridge tools even when results are empty", async () => {
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader(
    createLoaderInput(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      if (url.hostname !== "mcp.figma.com") {
        throw new Error(`Unexpected request: ${request.url}`);
      }

      const body = (await request.json()) as {
        params?: { name?: string; arguments?: { nodeId?: string } };
      };
      const toolName = body.params?.name;

      if (toolName === "get_metadata") {
        return jsonResponse({
          result: {
            xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
          },
        });
      }
      if (toolName === "get_design_context") {
        return jsonResponse({
          result: {
            code: "export default function Checkout() {}",
            assets: {},
          },
        });
      }
      if (toolName === "get_screenshot") {
        return jsonResponse({
          result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
        });
      }
      if (toolName === "get_variable_defs") {
        return jsonResponse({
          result: {
            variables: [],
          },
        });
      }
      if (toolName === "search_design_system") {
        return jsonResponse({
          result: {
            components: [],
            styles: [],
            variables: [],
          },
        });
      }

      throw new Error(`Unexpected tool: ${String(toolName)}`);
    }),
  );

  assert.deepEqual(enrichment.toolNames, [
    "get_design_context",
    "get_metadata",
    "get_screenshot",
    "get_variable_defs",
    "search_design_system",
  ]);
  assert.equal(enrichment.variables, undefined);
  assert.equal(enrichment.styleCatalog, undefined);
  assert.equal(enrichment.cssCustomProperties, "");
  assert.deepEqual(enrichment.libraryKeys, []);
  assert.deepEqual(enrichment.modeAlternatives, {});
  assert.deepEqual(enrichment.conflicts, []);
  assert.deepEqual(enrichment.unmappedVariables, []);
});

test("default hybrid loader only marks bridge tools successful when the respective call succeeds", async () => {
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader(
    createLoaderInput(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      if (url.hostname !== "mcp.figma.com") {
        throw new Error(`Unexpected request: ${request.url}`);
      }

      const body = (await request.json()) as {
        params?: { name?: string; arguments?: { nodeId?: string } };
      };
      const toolName = body.params?.name;

      if (toolName === "get_metadata") {
        return jsonResponse({
          result: {
            xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
          },
        });
      }
      if (toolName === "get_design_context") {
        return jsonResponse({
          result: {
            code: "export default function Checkout() {}",
            assets: {},
          },
        });
      }
      if (toolName === "get_screenshot") {
        return jsonResponse({
          result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
        });
      }
      if (toolName === "get_variable_defs") {
        throw new Error("variables unavailable");
      }
      if (toolName === "search_design_system") {
        return jsonResponse({
          result: {
            components: [],
            styles: [],
            variables: [],
          },
        });
      }

      throw new Error(`Unexpected tool: ${String(toolName)}`);
    }),
  );

  assert.deepEqual(enrichment.toolNames, [
    "get_design_context",
    "get_metadata",
    "get_screenshot",
    "search_design_system",
  ]);
  assert.ok(
    enrichment.diagnostics?.some(
      (entry) => entry.code === "W_TOKEN_BRIDGE_VARIABLES_SKIPPED",
    ),
  );
});

test("default hybrid loader falls back to REST-only enrichment when MCP resolution fails", async () => {
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader({
    figmaFileKey: "demo-file",
    figmaAccessToken: "test-token",
    cleanedFile: {
      document: {
        id: "2:1",
        type: "FRAME",
        name: "Checkout",
        children: [],
      },
    },
    rawFile: {
      document: {
        id: "2:1",
        type: "FRAME",
        name: "Checkout",
        children: [],
      },
    },
    jobDir: "/tmp/workspace-dev-job",
    fetchImpl: async () => {
      throw new Error("mcp unavailable");
    },
  });

  assert.equal(enrichment.sourceMode, "hybrid");
  assert.equal(enrichment.toolNames.length, 0);
  assert.equal(enrichment.diagnostics?.[0]?.code, "W_MCP_ENRICHMENT_SKIPPED");
});

// ---------------------------------------------------------------------------
// nodeHints population via authoritative subtrees (issue #1002)
// ---------------------------------------------------------------------------

// A rawFile that triggers the low-fidelity detection path in
// fetchAuthoritativeFigmaSubtrees. Needs >= 12 INSTANCE nodes with explicit
// board component names (e.g. <Card>, <Button>) and some text/vector children.
const createLowFidelityRawFile = () => ({
  name: "Low Fidelity Board",
  lastModified: "2026-04-13T10:00:00.000Z",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    name: "Root",
    children: [
      {
        id: "1:1",
        type: "CANVAS",
        name: "Page 1",
        children: [
          {
            id: "2:1",
            type: "FRAME",
            name: "Checkout",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
            children: [
              // 12 INSTANCE nodes with explicit board component names
              ...Array.from({ length: 12 }, (_, i) => ({
                id: `inst-${i + 1}`,
                type: "INSTANCE",
                name: i % 3 === 0 ? "<Card>" : "<Button>",
                absoluteBoundingBox: {
                  x: (i % 3) * 220,
                  y: Math.floor(i / 3) * 120,
                  width: 200,
                  height: 96,
                },
                children: [],
              })),
              // Vector nodes for fallback-prone detection
              {
                id: "vec-1",
                type: "VECTOR",
                name: "Sparkasse S",
                absoluteBoundingBox: { x: 24, y: 24, width: 24, height: 24 },
              },
              {
                id: "vec-2",
                type: "VECTOR",
                name: "Ellipse 4",
                absoluteBoundingBox: { x: 52, y: 24, width: 12, height: 12 },
              },
              // Text nodes (low ratio to instance count)
              {
                id: "txt-1",
                type: "TEXT",
                name: "Heading",
                characters: "Title",
                absoluteBoundingBox: { x: 24, y: 200, width: 240, height: 24 },
              },
              {
                id: "txt-2",
                type: "TEXT",
                name: "Body",
                characters: "Subtitle",
                absoluteBoundingBox: { x: 24, y: 232, width: 120, height: 20 },
              },
            ],
          },
        ],
      },
    ],
  },
});

// Simulated authoritative subtree response from Figma REST /nodes endpoint.
// Contains a node hierarchy that should produce multiple FigmaMcpNodeHint entries.
const authoritativeNodesResponse = {
  nodes: {
    "2:1": {
      document: {
        id: "2:1",
        type: "FRAME",
        name: "Checkout",
        absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1200 },
        children: [
          {
            id: "2:2",
            type: "TEXT",
            name: "Headline",
            characters: "Order Summary",
            absoluteBoundingBox: { x: 24, y: 24, width: 240, height: 24 },
          },
          {
            id: "2:3",
            type: "INSTANCE",
            name: "CartItem",
            absoluteBoundingBox: { x: 24, y: 56, width: 400, height: 80 },
            children: [
              {
                id: "2:4",
                type: "TEXT",
                name: "ItemName",
                characters: "Widget",
              },
            ],
          },
        ],
      },
    },
  },
};

test("default hybrid loader populates nodeHints from authoritative subtrees", async () => {
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const lowFidelityFile = createLowFidelityRawFile();

  const enrichment = await loader({
    figmaFileKey: "demo-file",
    figmaAccessToken: "test-token",
    cleanedFile: lowFidelityFile,
    rawFile: lowFidelityFile,
    jobDir: "/tmp/workspace-dev-job",
    fetchImpl: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      // --- Figma REST API: authoritative subtree fetch ---
      if (url.hostname === "api.figma.com") {
        return jsonResponse(authoritativeNodesResponse);
      }

      // --- Figma MCP bridge ---
      if (url.hostname === "mcp.figma.com") {
        const body = (await request.json()) as {
          params?: { name?: string; arguments?: { nodeId?: string } };
        };
        const toolName = body.params?.name;

        if (toolName === "get_metadata") {
          return jsonResponse({
            result: {
              xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
            },
          });
        }
        if (toolName === "get_design_context") {
          return jsonResponse({
            result: {
              code: "export default function Checkout() {}",
              assets: {},
            },
          });
        }
        if (toolName === "get_screenshot") {
          return jsonResponse({
            result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
          });
        }
        if (toolName === "get_variable_defs") {
          return jsonResponse({ result: { variables: [] } });
        }
        if (toolName === "search_design_system") {
          return jsonResponse({
            result: { components: [], styles: [], variables: [] },
          });
        }
      }

      throw new Error(`Unexpected request: ${request.url}`);
    },
  });

  // nodeHints must be populated from the authoritative subtree documents
  assert.ok(Array.isArray(enrichment.nodeHints), "nodeHints must be an array");
  assert.ok(enrichment.nodeHints.length > 0, "nodeHints must not be empty");

  // Verify the hint for the root FRAME node
  const rootHint = enrichment.nodeHints.find((h) => h.nodeId === "2:1");
  assert.ok(rootHint, "must include a hint for the root FRAME node 2:1");
  assert.equal(rootHint.semanticName, "Checkout");
  assert.equal(rootHint.semanticType, "FRAME");
  assert.deepEqual(rootHint.sourceTools, ["figma-rest-authoritative-subtrees"]);

  // Verify hints for child nodes (recursive collection)
  const headlineHint = enrichment.nodeHints.find((h) => h.nodeId === "2:2");
  assert.ok(headlineHint, "must include a hint for child TEXT node 2:2");
  assert.equal(headlineHint.semanticName, "Headline");
  assert.equal(headlineHint.semanticType, "TEXT");

  const instanceHint = enrichment.nodeHints.find((h) => h.nodeId === "2:3");
  assert.ok(instanceHint, "must include a hint for child INSTANCE node 2:3");
  assert.equal(instanceHint.semanticName, "CartItem");
  assert.equal(instanceHint.semanticType, "INSTANCE");

  // Verify deeply nested child within the INSTANCE
  const nestedTextHint = enrichment.nodeHints.find((h) => h.nodeId === "2:4");
  assert.ok(nestedTextHint, "must include a hint for deeply nested TEXT 2:4");
  assert.equal(nestedTextHint.semanticName, "ItemName");
  assert.equal(nestedTextHint.semanticType, "TEXT");

  // All hints must carry the correct sourceTools tag
  for (const hint of enrichment.nodeHints) {
    assert.deepEqual(
      hint.sourceTools,
      ["figma-rest-authoritative-subtrees"],
      `hint ${hint.nodeId} must have correct sourceTools`,
    );
  }

  // toolNames must include the REST subtree source marker
  assert.ok(
    enrichment.toolNames.includes("figma-rest-authoritative-subtrees"),
    "toolNames must list figma-rest-authoritative-subtrees",
  );
});

test("default hybrid loader returns empty nodeHints when no authoritative subtrees are returned", async () => {
  // Use the simple demoRawFile which has no low-fidelity triggers,
  // so fetchAuthoritativeFigmaSubtrees returns [].
  const loader = createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: 1_000,
    maxRetries: 1,
    maxScreenCandidates: 5,
  });

  const enrichment = await loader(
    createLoaderInput(async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);

      if (url.hostname !== "mcp.figma.com") {
        throw new Error(`Unexpected request: ${request.url}`);
      }

      const body = (await request.json()) as {
        params?: { name?: string; arguments?: { nodeId?: string } };
      };
      const toolName = body.params?.name;

      if (toolName === "get_metadata") {
        return jsonResponse({
          result: {
            xml: '<FRAME id="2:1" name="Checkout"><TEXT id="2:2" name="Headline"/></FRAME>',
          },
        });
      }
      if (toolName === "get_design_context") {
        return jsonResponse({
          result: {
            code: "export default function Checkout() {}",
            assets: {},
          },
        });
      }
      if (toolName === "get_screenshot") {
        return jsonResponse({
          result: { url: "https://cdn.figma.com/screenshots/checkout.png" },
        });
      }
      if (toolName === "get_variable_defs") {
        return jsonResponse({ result: { variables: [] } });
      }
      if (toolName === "search_design_system") {
        return jsonResponse({
          result: { components: [], styles: [], variables: [] },
        });
      }

      throw new Error(`Unexpected tool: ${String(toolName)}`);
    }),
  );

  // With the simple rawFile, authoritative subtrees are empty, so nodeHints
  // must be an empty array (not undefined, not populated).
  assert.ok(Array.isArray(enrichment.nodeHints), "nodeHints must be an array");
  assert.equal(enrichment.nodeHints.length, 0, "nodeHints must be empty");
  assert.ok(
    !enrichment.toolNames.includes("figma-rest-authoritative-subtrees"),
    "toolNames must not list figma-rest-authoritative-subtrees",
  );
});
