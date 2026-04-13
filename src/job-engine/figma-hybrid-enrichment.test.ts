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
  assert.equal(enrichment.tailwindExtension?.colors?.["color-primary"], "#3B82F6");
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
