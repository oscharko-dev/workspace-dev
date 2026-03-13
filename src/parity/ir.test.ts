import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIr, figmaToDesignIrWithOptions } from "./ir.js";

const createSampleFigmaFile = () => ({
  name: "Demo File",
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
            name: "Frame 1",
            absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 900 },
            children: [
              {
                id: "1:2",
                type: "FRAME",
                name: "T1",
                layoutMode: "VERTICAL",
                itemSpacing: 12,
                paddingTop: 16,
                paddingRight: 16,
                paddingBottom: 16,
                paddingLeft: 16,
                fills: [{ type: "SOLID", color: { r: 0.97, g: 0.98, b: 0.99, a: 1 } }],
                absoluteBoundingBox: { x: 10, y: 10, width: 1180, height: 880 },
                children: [
                  {
                    id: "t1",
                    type: "TEXT",
                    name: "Title",
                    characters: "Kreditübersicht",
                    style: {
                      fontSize: 32,
                      fontWeight: 700,
                      fontFamily: "Sparkasse Sans",
                      lineHeightPx: 40,
                      textAlignHorizontal: "LEFT"
                    },
                    fills: [{ type: "SOLID", color: { r: 0.1, g: 0.11, b: 0.12, a: 1 } }],
                    absoluteBoundingBox: { x: 20, y: 20, width: 300, height: 40 }
                  },
                  {
                    id: "i1",
                    type: "FRAME",
                    name: "MuiFormControlRoot",
                    absoluteBoundingBox: { x: 20, y: 90, width: 400, height: 56 },
                    children: []
                  },
                  {
                    id: "s1",
                    type: "FRAME",
                    name: "MuiSelectSelect",
                    absoluteBoundingBox: { x: 20, y: 160, width: 400, height: 56 },
                    children: []
                  },
                  {
                    id: "b1",
                    type: "FRAME",
                    name: "Primary Button",
                    fills: [{ type: "SOLID", color: { r: 0.9, g: 0.0, b: 0.1, a: 1 } }],
                    absoluteBoundingBox: { x: 20, y: 230, width: 200, height: 48 },
                    children: []
                  },
                  {
                    id: "img1",
                    type: "RECTANGLE",
                    name: "Hero Image",
                    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }],
                    absoluteBoundingBox: { x: 500, y: 100, width: 200, height: 160 },
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
});

test("figmaToDesignIr throws when no top-level screen nodes exist", () => {
  assert.throws(
    () => figmaToDesignIr({ name: "Empty", document: { id: "0:0", type: "DOCUMENT", children: [] } }),
    /No top-level frames\/components found/
  );
});

test("figmaToDesignIr maps screens/elements/tokens from Figma payload", () => {
  const ir = figmaToDesignIr(createSampleFigmaFile());

  assert.equal(ir.sourceName, "Demo File");
  assert.equal(ir.screens.length, 1);
  assert.equal(ir.screens[0].name.length > 0, true);
  assert.equal(ir.screens[0].children.length >= 4, true);

  const elementTypes = ir.screens[0].children.map((entry) => entry.type);
  assert.ok(elementTypes.includes("text"));
  assert.ok(elementTypes.includes("input") || elementTypes.includes("container"));
  assert.ok(ir.tokens.palette.primary.startsWith("#"));
  assert.ok(ir.tokens.palette.background.startsWith("#"));
  assert.ok(ir.tokens.fontFamily.length > 0);
});

test("figmaToDesignIrWithOptions applies MCP enrichment hints", () => {
  const ir = figmaToDesignIrWithOptions(createSampleFigmaFile(), {
    mcpEnrichment: {
      sourceMode: "mcp",
      toolNames: ["figma-mcp"],
      nodeHints: [
        {
          nodeId: "i1",
          semanticName: "Kontonummer Eingabefeld",
          semanticType: "input field",
          sourceTools: ["figma-mcp"]
        }
      ]
    }
  });

  const flattened = ir.screens.flatMap((screen) => screen.children);
  const node = flattened.find((entry) => entry.id === "i1");
  assert.ok(node);
  assert.equal(node?.name, "Kontonummer Eingabefeld");
  assert.equal(node?.type, "input");
});
