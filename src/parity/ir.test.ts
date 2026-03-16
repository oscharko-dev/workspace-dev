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
                primaryAxisAlignItems: "MIN",
                counterAxisAlignItems: "CENTER",
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
                    layoutMode: "HORIZONTAL",
                    primaryAxisAlignItems: "SPACE_BETWEEN",
                    counterAxisAlignItems: "CENTER",
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

const createElementTypeMatrixFigmaFile = () => ({
  name: "Type Matrix",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-matrix",
            type: "FRAME",
            name: "Matrix",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 1600 },
            children: [
              {
                id: "node-text",
                type: "TEXT",
                name: "Headline",
                characters: "Titel",
                absoluteBoundingBox: { x: 10, y: 10, width: 200, height: 24 }
              },
              {
                id: "node-input",
                type: "FRAME",
                name: "MuiFormControlRoot",
                absoluteBoundingBox: { x: 10, y: 50, width: 320, height: 56 },
                children: []
              },
              {
                id: "node-switch",
                type: "FRAME",
                name: "MuiSwitch Root",
                absoluteBoundingBox: { x: 10, y: 120, width: 56, height: 32 },
                children: []
              },
              {
                id: "node-checkbox",
                type: "FRAME",
                name: "MuiCheckbox",
                absoluteBoundingBox: { x: 10, y: 170, width: 24, height: 24 },
                children: []
              },
              {
                id: "node-radio",
                type: "FRAME",
                name: "MuiRadio",
                absoluteBoundingBox: { x: 10, y: 210, width: 24, height: 24 },
                children: []
              },
              {
                id: "node-chip",
                type: "FRAME",
                name: "MuiChip - Filter",
                absoluteBoundingBox: { x: 10, y: 250, width: 130, height: 32 },
                children: []
              },
              {
                id: "node-tab",
                type: "FRAME",
                name: "MuiTabs Root",
                absoluteBoundingBox: { x: 10, y: 290, width: 300, height: 48 },
                children: []
              },
              {
                id: "node-progress",
                type: "FRAME",
                name: "LinearProgress",
                absoluteBoundingBox: { x: 10, y: 350, width: 220, height: 8 },
                children: []
              },
              {
                id: "node-avatar",
                type: "FRAME",
                name: "MuiAvatar",
                absoluteBoundingBox: { x: 10, y: 380, width: 40, height: 40 },
                children: []
              },
              {
                id: "node-badge",
                type: "FRAME",
                name: "MuiBadge",
                absoluteBoundingBox: { x: 10, y: 430, width: 48, height: 24 },
                children: []
              },
              {
                id: "node-divider",
                type: "RECTANGLE",
                name: "Divider",
                fills: [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8, a: 1 } }],
                absoluteBoundingBox: { x: 10, y: 470, width: 320, height: 1 }
              },
              {
                id: "node-appbar",
                type: "FRAME",
                name: "MuiAppBar",
                absoluteBoundingBox: { x: 10, y: 490, width: 360, height: 64 },
                children: []
              },
              {
                id: "node-navigation",
                type: "FRAME",
                name: "BottomNavigation",
                absoluteBoundingBox: { x: 10, y: 565, width: 360, height: 64 },
                children: []
              },
              {
                id: "node-dialog",
                type: "FRAME",
                name: "Dialog Modal",
                absoluteBoundingBox: { x: 10, y: 640, width: 360, height: 220 },
                children: []
              },
              {
                id: "node-stepper",
                type: "FRAME",
                name: "MuiStepper",
                absoluteBoundingBox: { x: 10, y: 870, width: 360, height: 80 },
                children: []
              },
              {
                id: "node-list",
                type: "FRAME",
                name: "MuiList Root",
                layoutMode: "VERTICAL",
                absoluteBoundingBox: { x: 10, y: 960, width: 280, height: 120 },
                children: [
                  {
                    id: "node-list-text-1",
                    type: "TEXT",
                    name: "Item 1",
                    characters: "Eintrag 1",
                    absoluteBoundingBox: { x: 14, y: 964, width: 120, height: 20 }
                  },
                  {
                    id: "node-list-text-2",
                    type: "TEXT",
                    name: "Item 2",
                    characters: "Eintrag 2",
                    absoluteBoundingBox: { x: 14, y: 990, width: 120, height: 20 }
                  }
                ]
              },
              {
                id: "node-card",
                type: "FRAME",
                name: "Offer Card",
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                cornerRadius: 12,
                absoluteBoundingBox: { x: 10, y: 1090, width: 320, height: 180 },
                children: [
                  {
                    id: "node-card-title",
                    type: "TEXT",
                    name: "Card Title",
                    characters: "Karte",
                    absoluteBoundingBox: { x: 18, y: 1100, width: 120, height: 20 }
                  }
                ]
              },
              {
                id: "node-button",
                type: "FRAME",
                name: "Primary Button",
                fills: [{ type: "SOLID", color: { r: 0.9, g: 0.1, b: 0.1, a: 1 } }],
                absoluteBoundingBox: { x: 10, y: 1280, width: 220, height: 48 },
                children: []
              },
              {
                id: "node-image",
                type: "RECTANGLE",
                name: "Hero Image",
                absoluteBoundingBox: { x: 10, y: 1340, width: 360, height: 200 }
              },
              {
                id: "node-container",
                type: "FRAME",
                name: "Plain Wrapper",
                absoluteBoundingBox: { x: 10, y: 1550, width: 200, height: 40 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createSemanticHintOverrideFigmaFile = () => ({
  name: "Semantic Hints",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-hints",
            type: "FRAME",
            name: "Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 },
            children: [
              { id: "hint-chip", type: "FRAME", name: "Frame 1", absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 } },
              { id: "hint-dialog", type: "FRAME", name: "Frame 2", absoluteBoundingBox: { x: 0, y: 50, width: 300, height: 200 } },
              { id: "hint-navigation", type: "FRAME", name: "Frame 3", absoluteBoundingBox: { x: 0, y: 260, width: 320, height: 64 } },
              { id: "hint-stepper", type: "FRAME", name: "Frame 4", absoluteBoundingBox: { x: 0, y: 334, width: 320, height: 80 } },
              { id: "hint-badge", type: "FRAME", name: "Frame 5", absoluteBoundingBox: { x: 0, y: 424, width: 64, height: 32 } },
              { id: "hint-progress", type: "FRAME", name: "Frame 6", absoluteBoundingBox: { x: 0, y: 468, width: 200, height: 8 } }
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
  assert.equal(ir.screens[0].primaryAxisAlignItems, "MIN");
  assert.equal(ir.screens[0].counterAxisAlignItems, "CENTER");

  const inputNode = ir.screens[0].children.find((child) => child.id === "i1");
  assert.equal(inputNode?.primaryAxisAlignItems, "SPACE_BETWEEN");
  assert.equal(inputNode?.counterAxisAlignItems, "CENTER");

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

test("figmaToDesignIrWithOptions classifies extended element types deterministically", () => {
  const ir = figmaToDesignIrWithOptions(createElementTypeMatrixFigmaFile());
  const byId = new Map(ir.screens[0]?.children.map((child) => [child.id, child.type]));

  assert.equal(byId.get("node-text"), "text");
  assert.equal(byId.get("node-input"), "input");
  assert.equal(byId.get("node-switch"), "switch");
  assert.equal(byId.get("node-checkbox"), "checkbox");
  assert.equal(byId.get("node-radio"), "radio");
  assert.equal(byId.get("node-chip"), "chip");
  assert.equal(byId.get("node-tab"), "tab");
  assert.equal(byId.get("node-progress"), "progress");
  assert.equal(byId.get("node-avatar"), "avatar");
  assert.equal(byId.get("node-badge"), "badge");
  assert.equal(byId.get("node-divider"), "divider");
  assert.equal(byId.get("node-appbar"), "appbar");
  assert.equal(byId.get("node-navigation"), "navigation");
  assert.equal(byId.get("node-dialog"), "dialog");
  assert.equal(byId.get("node-stepper"), "stepper");
  assert.equal(byId.get("node-list"), "list");
  assert.equal(byId.get("node-card"), "card");
  assert.equal(byId.get("node-button"), "button");
  assert.equal(byId.get("node-image"), "image");
  assert.equal(byId.get("node-container"), "container");
});

test("figmaToDesignIrWithOptions maps new semantic MCP hints to extended types", () => {
  const ir = figmaToDesignIrWithOptions(createSemanticHintOverrideFigmaFile(), {
    mcpEnrichment: {
      sourceMode: "mcp",
      toolNames: ["figma-mcp"],
      nodeHints: [
        {
          nodeId: "hint-chip",
          semanticName: "Status Chip",
          semanticType: "chip",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-dialog",
          semanticName: "Bestätigung Dialog",
          semanticType: "dialog modal",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-navigation",
          semanticName: "Hauptnavigation",
          semanticType: "bottom navigation",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-stepper",
          semanticName: "Antrag Stepper",
          semanticType: "stepper flow",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-badge",
          semanticName: "Counter Badge",
          semanticType: "badge indicator",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-progress",
          semanticName: "Ladefortschritt",
          semanticType: "progress indicator",
          sourceTools: ["figma-mcp"]
        }
      ]
    }
  });

  const byId = new Map(ir.screens[0]?.children.map((child) => [child.id, child]));
  assert.equal(byId.get("hint-chip")?.type, "chip");
  assert.equal(byId.get("hint-dialog")?.type, "dialog");
  assert.equal(byId.get("hint-navigation")?.type, "navigation");
  assert.equal(byId.get("hint-stepper")?.type, "stepper");
  assert.equal(byId.get("hint-badge")?.type, "badge");
  assert.equal(byId.get("hint-progress")?.type, "progress");
  assert.equal(byId.get("hint-chip")?.name, "Status Chip");
});
