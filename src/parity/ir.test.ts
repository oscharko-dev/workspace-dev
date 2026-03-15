import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIr, figmaToDesignIrWithOptions } from "./ir.js";

const countElements = (elements: Array<{ children?: unknown[] }>): number => {
  let total = 0;
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop() as { children?: unknown[] } | undefined;
    if (!current) {
      continue;
    }
    total += 1;
    if (Array.isArray(current.children)) {
      stack.push(...(current.children as Array<{ children?: unknown[] }>));
    }
  }
  return total;
};

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
            id: "section-1",
            type: "SECTION",
            name: "Main Section",
            children: [
              {
                id: "screen-1",
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
                    id: "b1",
                    type: "FRAME",
                    name: "Primary Button",
                    fills: [{ type: "SOLID", color: { r: 0.9, g: 0.0, b: 0.1, a: 1 } }],
                    absoluteBoundingBox: { x: 20, y: 230, width: 200, height: 48 },
                    children: []
                  },
                  {
                    id: "hidden-subtree",
                    type: "FRAME",
                    name: "Hidden subtree",
                    visible: false,
                    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
                    children: [
                      {
                        id: "hidden-text",
                        type: "TEXT",
                        name: "Hidden text",
                        characters: "Should not appear",
                        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 }
                      }
                    ]
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

test("figmaToDesignIr maps SECTION-contained screens and prunes hidden subtrees", () => {
  const ir = figmaToDesignIr(createSampleFigmaFile());

  assert.equal(ir.sourceName, "Demo File");
  assert.equal(ir.screens.length, 1);
  assert.equal(ir.screens[0].name.length > 0, true);
  assert.equal(ir.screens[0].children.length >= 3, true);

  const flattenedNames = JSON.stringify(ir.screens[0].children);
  assert.equal(flattenedNames.includes("Should not appear"), false);
  assert.ok((ir.metrics?.skippedHidden ?? 0) >= 1);
});

test("figmaToDesignIrWithOptions removes placeholder text only in instance/component-set context", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Placeholder Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-1",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
              children: [
                {
                  id: "instance-1",
                  type: "INSTANCE",
                  name: "Instance Root",
                  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
                  children: [
                    {
                      id: "ph-1",
                      type: "TEXT",
                      name: "Placeholder",
                      characters: "Swap Component",
                      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 }
                    },
                    {
                      id: "keep-1",
                      type: "TEXT",
                      name: "Keep",
                      characters: "Visible Value",
                      absoluteBoundingBox: { x: 0, y: 24, width: 100, height: 20 }
                    }
                  ]
                },
                {
                  id: "plain-1",
                  type: "FRAME",
                  name: "Plain Frame",
                  absoluteBoundingBox: { x: 0, y: 120, width: 200, height: 100 },
                  children: [
                    {
                      id: "plain-text",
                      type: "TEXT",
                      name: "Text",
                      characters: "Swap Component",
                      absoluteBoundingBox: { x: 0, y: 120, width: 100, height: 20 }
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

  const serialized = JSON.stringify(ir.screens[0].children);
  assert.equal(serialized.includes('"id":"ph-1"'), false);
  assert.equal(serialized.includes('"id":"plain-text"'), true);
  assert.ok((ir.metrics?.skippedPlaceholders ?? 0) >= 1);
});

test("figmaToDesignIrWithOptions applies deterministic screen element budget truncation", () => {
  const buildLargeScreen = (prefix: string) => ({
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-budget",
            type: "FRAME",
            name: "Budget Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
            children: Array.from({ length: 8 }, (_, index) => ({
              id: `${prefix}-node-${index + 1}`,
              type: "TEXT",
              name: `Node ${index + 1}`,
              characters: `Node ${index + 1}`,
              absoluteBoundingBox: { x: 0, y: index * 24, width: 100, height: 20 }
            }))
          }
        ]
      }
    ]
  });

  const first = figmaToDesignIrWithOptions(
    {
      name: "Budget Demo",
      document: buildLargeScreen("first")
    },
    {
      screenElementBudget: 3
    }
  );

  const second = figmaToDesignIrWithOptions(
    {
      name: "Budget Demo",
      document: buildLargeScreen("first")
    },
    {
      screenElementBudget: 3
    }
  );

  assert.equal(countElements(first.screens[0].children as Array<{ children?: unknown[] }>), 3);
  assert.equal(countElements(second.screens[0].children as Array<{ children?: unknown[] }>), 3);

  assert.equal(first.metrics?.truncatedScreens.length, 1);
  assert.equal(first.metrics?.truncatedScreens[0]?.retainedElements, 3);
  assert.deepEqual(first.screens[0].children, second.screens[0].children);
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
