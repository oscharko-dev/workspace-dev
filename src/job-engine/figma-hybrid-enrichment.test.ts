import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultFigmaMcpEnrichmentLoader } from "./figma-hybrid-enrichment.js";

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
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

  const enrichment = await loader({
    figmaFileKey: "demo-file",
    figmaAccessToken: "test-token",
    cleanedFile: {
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
    },
    rawFile: {
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
    },
    jobDir: "/tmp/workspace-dev-job",
    fetchImpl,
  });

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
