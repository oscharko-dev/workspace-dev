import assert from "node:assert/strict";
import test from "node:test";
import { deriveTokensForTesting, figmaToDesignIr, figmaToDesignIrWithOptions } from "./ir.js";
import { applySparkasseThemeDefaults } from "./sparkasse-theme.js";

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

const collectElementIds = (elements: Array<{ id: string; children?: unknown[] }>): string[] => {
  const ids: string[] = [];
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop() as { id: string; children?: unknown[] } | undefined;
    if (!current) {
      continue;
    }
    ids.push(current.id);
    if (Array.isArray(current.children)) {
      stack.push(...(current.children as Array<{ id: string; children?: unknown[] }>));
    }
  }
  return ids;
};

const findElementById = (
  elements: Array<{ id: string; children?: unknown[] }>,
  id: string
): { id: string; children?: unknown[] } | undefined => {
  const stack = [...elements];
  while (stack.length > 0) {
    const current = stack.pop() as { id: string; children?: unknown[] } | undefined;
    if (!current) {
      continue;
    }
    if (current.id === id) {
      return current;
    }
    if (Array.isArray(current.children)) {
      stack.push(...(current.children as Array<{ id: string; children?: unknown[] }>));
    }
  }
  return undefined;
};

const toFigmaColor = (hex: string): { r: number; g: number; b: number; a: number } => {
  const normalized = hex.replace("#", "");
  const toChannel = (start: number): number => Number.parseInt(normalized.slice(start, start + 2), 16) / 255;
  return {
    r: toChannel(0),
    g: toChannel(2),
    b: toChannel(4),
    a: 1
  };
};

const contrastRatio = (firstHex: string, secondHex: string): number => {
  const toLuminance = (hex: string): number => {
    const { r, g, b } = toFigmaColor(hex);
    const transform = (value: number): number => {
      if (value <= 0.03928) {
        return value / 12.92;
      }
      return ((value + 0.055) / 1.055) ** 2.4;
    };
    const rl = transform(r);
    const gl = transform(g);
    const bl = transform(b);
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  };

  const first = toLuminance(firstHex);
  const second = toLuminance(secondHex);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
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

const createPriorityRetentionFigmaFile = () => ({
  name: "Priority Truncation",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-priority",
            type: "FRAME",
            name: "Priority Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 900 },
            children: [
              {
                id: "decorative-bg",
                type: "FRAME",
                name: "Decor Background",
                fills: [{ type: "SOLID", color: toFigmaColor("#d1d5db") }],
                absoluteBoundingBox: { x: 0, y: 0, width: 1180, height: 260 },
                children: []
              },
              {
                id: "decorative-shape",
                type: "FRAME",
                name: "Vector Shape",
                fills: [{ type: "SOLID", color: toFigmaColor("#94a3b8") }],
                absoluteBoundingBox: { x: 0, y: 280, width: 300, height: 220 },
                children: []
              },
              {
                id: "form-shell",
                type: "FRAME",
                name: "Form Shell",
                absoluteBoundingBox: { x: 24, y: 520, width: 560, height: 260 },
                children: [
                  {
                    id: "form-section",
                    type: "FRAME",
                    name: "Section",
                    absoluteBoundingBox: { x: 32, y: 528, width: 540, height: 240 },
                    children: [
                      {
                        id: "input-node",
                        type: "FRAME",
                        name: "MuiFormControlRoot",
                        absoluteBoundingBox: { x: 40, y: 540, width: 320, height: 56 },
                        children: []
                      },
                      {
                        id: "action-row",
                        type: "FRAME",
                        name: "Action Row",
                        absoluteBoundingBox: { x: 40, y: 630, width: 500, height: 72 },
                        children: [
                          {
                            id: "cta-node",
                            type: "FRAME",
                            name: "Primary Button",
                            fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                            absoluteBoundingBox: { x: 40, y: 640, width: 260, height: 56 },
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
        ]
      }
    ]
  }
});

const createAncestorChainBudgetFigmaFile = () => ({
  name: "Ancestor Chain Budget",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-ancestor-budget",
            type: "FRAME",
            name: "Ancestor Budget Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 900, height: 600 },
            children: [
              {
                id: "decor-node",
                type: "FRAME",
                name: "Decor Shape",
                fills: [{ type: "SOLID", color: toFigmaColor("#cbd5e1") }],
                absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 200 },
                children: []
              },
              {
                id: "ancestor-root",
                type: "FRAME",
                name: "Ancestor Root",
                absoluteBoundingBox: { x: 20, y: 220, width: 500, height: 220 },
                children: [
                  {
                    id: "ancestor-middle",
                    type: "FRAME",
                    name: "Ancestor Middle",
                    absoluteBoundingBox: { x: 24, y: 230, width: 460, height: 180 },
                    children: [
                      {
                        id: "ancestor-button",
                        type: "FRAME",
                        name: "Primary Button",
                        fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                        absoluteBoundingBox: { x: 30, y: 250, width: 220, height: 56 },
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
    ]
  }
});

const createTextVsDecorativeFigmaFile = () => ({
  name: "Text Priority",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-text-priority",
            type: "FRAME",
            name: "Text Priority Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 },
            children: [
              {
                id: "decor-one",
                type: "FRAME",
                name: "Decor Layer",
                fills: [{ type: "SOLID", color: toFigmaColor("#94a3b8") }],
                absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 180 },
                children: []
              },
              {
                id: "decor-two",
                type: "FRAME",
                name: "Background Shape",
                fills: [{ type: "SOLID", color: toFigmaColor("#64748b") }],
                absoluteBoundingBox: { x: 0, y: 200, width: 400, height: 180 },
                children: []
              },
              {
                id: "meaningful-text",
                type: "TEXT",
                name: "Headline",
                characters: "Kreditübersicht",
                style: { fontSize: 28, fontWeight: 700, fontFamily: "Inter" },
                absoluteBoundingBox: { x: 20, y: 420, width: 300, height: 44 }
              }
            ]
          }
        ]
      }
    ]
  }
});

const createDynamicDepthFigmaFile = () => ({
  name: "Dynamic Depth",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-depth-dynamic",
            type: "FRAME",
            name: "Dynamic Depth Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1024, height: 768 },
            children: [
              {
                id: "decor-root",
                type: "FRAME",
                name: "Decor Wrapper",
                absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 160 },
                children: [
                  {
                    id: "decor-mid",
                    type: "FRAME",
                    name: "Decor Layer",
                    absoluteBoundingBox: { x: 0, y: 0, width: 280, height: 140 },
                    children: [
                      {
                        id: "decor-leaf",
                        type: "FRAME",
                        name: "Decor Shape",
                        absoluteBoundingBox: { x: 0, y: 0, width: 260, height: 120 },
                        children: []
                      }
                    ]
                  }
                ]
              },
              {
                id: "semantic-root",
                type: "FRAME",
                name: "Form Root",
                absoluteBoundingBox: { x: 0, y: 200, width: 500, height: 320 },
                children: [
                  {
                    id: "semantic-step",
                    type: "FRAME",
                    name: "Step Content",
                    absoluteBoundingBox: { x: 0, y: 220, width: 480, height: 280 },
                    children: [
                      {
                        id: "semantic-action",
                        type: "FRAME",
                        name: "Action Container",
                        absoluteBoundingBox: { x: 0, y: 240, width: 440, height: 120 },
                        children: [
                          {
                            id: "deep-cta",
                            type: "FRAME",
                            name: "Primary Button",
                            fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                            absoluteBoundingBox: { x: 0, y: 260, width: 240, height: 56 },
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
        ]
      }
    ]
  }
});

const createDepthPressureFigmaFile = () => ({
  name: "Depth Pressure",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-depth-pressure",
            type: "FRAME",
            name: "Depth Pressure Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 900 },
            children: [
              {
                id: "pressure-root",
                type: "FRAME",
                name: "Pressure Root",
                absoluteBoundingBox: { x: 0, y: 0, width: 1100, height: 800 },
                children: Array.from({ length: 26 }, (_, index) => ({
                  id: `pressure-branch-${index + 1}`,
                  type: "FRAME",
                  name: index === 0 ? "Semantic Branch" : `Decor Branch ${index + 1}`,
                  absoluteBoundingBox: { x: 0, y: index * 24, width: 500, height: 24 },
                  children: [
                    {
                      id: `pressure-inner-${index + 1}`,
                      type: "FRAME",
                      name: index === 0 ? "Semantic Inner" : `Decor Inner ${index + 1}`,
                      absoluteBoundingBox: { x: 0, y: index * 24, width: 220, height: 20 },
                      children: [
                        index === 0
                          ? {
                              id: "pressure-cta",
                              type: "FRAME",
                              name: "Primary Button",
                              fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                              absoluteBoundingBox: { x: 0, y: index * 24, width: 200, height: 20 },
                              children: []
                            }
                          : {
                              id: `pressure-leaf-${index + 1}`,
                              type: "FRAME",
                              name: "Decor Shape",
                              absoluteBoundingBox: { x: 0, y: index * 24, width: 200, height: 20 },
                              children: []
                            }
                      ]
                    }
                  ]
                }))
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
  assert.equal(ir.screens[0].primaryAxisAlignItems, "MIN");
  assert.equal(ir.screens[0].counterAxisAlignItems, "CENTER");

  const inputNode = ir.screens[0].children.find((child) => child.id === "i1");
  assert.equal(inputNode?.primaryAxisAlignItems, "SPACE_BETWEEN");
  assert.equal(inputNode?.counterAxisAlignItems, "CENTER");

  const flattenedNames = JSON.stringify(ir.screens[0].children);
  assert.equal(flattenedNames.includes("Should not appear"), false);
  assert.ok((ir.metrics?.skippedHidden ?? 0) >= 1);
});

test("figmaToDesignIrWithOptions applies brand theme policy deterministically", () => {
  const sample = createSampleFigmaFile();
  const derivedTokens = deriveTokensForTesting(sample);

  const derivedIr = figmaToDesignIrWithOptions(sample, {
    brandTheme: "derived"
  });
  const sparkasseIr = figmaToDesignIrWithOptions(sample, {
    brandTheme: "sparkasse"
  });

  assert.deepEqual(derivedIr.tokens, derivedTokens);
  assert.deepEqual(sparkasseIr.tokens, applySparkasseThemeDefaults(derivedTokens));
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

test("figmaToDesignIrWithOptions maps variant metadata on INSTANCE nodes", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Instance Variants",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-instance-variants",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 480 },
              children: [
                {
                  id: "instance-variant-1",
                  type: "INSTANCE",
                  name: "Variant=Text, Size=Small, State=Disabled",
                  componentProperties: {
                    Variant: { type: "VARIANT", value: "Outlined" },
                    Size: { type: "VARIANT", value: "Small" },
                    State: { type: "VARIANT", value: "Disabled" }
                  },
                  absoluteBoundingBox: { x: 16, y: 32, width: 220, height: 48 },
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const variantNode = ir.screens[0]?.children.find((child) => child.id === "instance-variant-1");
  assert.ok(variantNode);
  assert.deepEqual(variantNode?.variantMapping?.properties, {
    size: "Small",
    state: "Disabled",
    variant: "Outlined"
  });
  assert.deepEqual(variantNode?.variantMapping?.muiProps, {
    variant: "outlined",
    size: "small",
    disabled: true
  });
  assert.equal(variantNode?.variantMapping?.state, "disabled");
});

test("figmaToDesignIrWithOptions compacts COMPONENT_SET variants into default plus state overrides", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Component Set Variants",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-component-set",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 720 },
              children: [
                {
                  id: "btn-set",
                  type: "COMPONENT_SET",
                  name: "Primary Button",
                  componentPropertyDefinitions: {
                    State: {
                      type: "VARIANT",
                      defaultValue: "Disabled",
                      variantOptions: ["Enabled", "Hover", "Pressed", "Disabled"]
                    }
                  },
                  absoluteBoundingBox: { x: 48, y: 96, width: 260, height: 56 },
                  children: [
                    {
                      id: "variant-default",
                      type: "COMPONENT",
                      name: "State=Enabled, Size=Medium, Variant=Contained",
                      componentProperties: {
                        State: { type: "VARIANT", value: "Enabled" },
                        Size: { type: "VARIANT", value: "Medium" },
                        Variant: { type: "VARIANT", value: "Contained" }
                      },
                      fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                      absoluteBoundingBox: { x: 48, y: 96, width: 260, height: 56 },
                      children: [
                        {
                          id: "variant-default-text",
                          type: "TEXT",
                          name: "Label",
                          characters: "Weiter",
                          fills: [{ type: "SOLID", color: toFigmaColor("#ffffff") }],
                          absoluteBoundingBox: { x: 128, y: 114, width: 68, height: 20 }
                        }
                      ]
                    },
                    {
                      id: "variant-hover",
                      type: "COMPONENT",
                      name: "State=Hover, Size=Medium, Variant=Contained",
                      componentProperties: {
                        State: { type: "VARIANT", value: "Hover" },
                        Size: { type: "VARIANT", value: "Medium" },
                        Variant: { type: "VARIANT", value: "Contained" }
                      },
                      fills: [{ type: "SOLID", color: toFigmaColor("#b00018") }],
                      absoluteBoundingBox: { x: 48, y: 160, width: 260, height: 56 },
                      children: [
                        {
                          id: "variant-hover-text",
                          type: "TEXT",
                          name: "Label",
                          characters: "Weiter",
                          fills: [{ type: "SOLID", color: toFigmaColor("#ffffff") }],
                          absoluteBoundingBox: { x: 128, y: 178, width: 68, height: 20 }
                        }
                      ]
                    },
                    {
                      id: "variant-active",
                      type: "COMPONENT",
                      name: "State=Pressed, Size=Medium, Variant=Contained",
                      componentProperties: {
                        State: { type: "VARIANT", value: "Pressed" },
                        Size: { type: "VARIANT", value: "Medium" },
                        Variant: { type: "VARIANT", value: "Contained" }
                      },
                      fills: [{ type: "SOLID", color: toFigmaColor("#8f0013") }],
                      absoluteBoundingBox: { x: 48, y: 224, width: 260, height: 56 },
                      children: [
                        {
                          id: "variant-active-text",
                          type: "TEXT",
                          name: "Label",
                          characters: "Weiter",
                          fills: [{ type: "SOLID", color: toFigmaColor("#ffffff") }],
                          absoluteBoundingBox: { x: 128, y: 242, width: 68, height: 20 }
                        }
                      ]
                    },
                    {
                      id: "variant-disabled",
                      type: "COMPONENT",
                      name: "State=Disabled, Size=Medium, Variant=Contained",
                      componentProperties: {
                        State: { type: "VARIANT", value: "Disabled" },
                        Size: { type: "VARIANT", value: "Medium" },
                        Variant: { type: "VARIANT", value: "Contained" }
                      },
                      fills: [{ type: "SOLID", color: toFigmaColor("#d1d5db") }],
                      absoluteBoundingBox: { x: 48, y: 288, width: 260, height: 56 },
                      children: [
                        {
                          id: "variant-disabled-text",
                          type: "TEXT",
                          name: "Label",
                          characters: "Weiter",
                          fills: [{ type: "SOLID", color: toFigmaColor("#6b7280") }],
                          absoluteBoundingBox: { x: 128, y: 306, width: 68, height: 20 }
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

  const componentSetNode = ir.screens[0]?.children.find((child) => child.id === "btn-set");
  assert.ok(componentSetNode);
  assert.equal(componentSetNode?.children?.length, 1);
  assert.equal(componentSetNode?.children?.[0]?.id, "variant-default");
  assert.equal(componentSetNode?.variantMapping?.defaultVariantNodeId, "variant-default");
  assert.equal(componentSetNode?.variantMapping?.state, "default");
  assert.deepEqual(componentSetNode?.variantMapping?.muiProps, {
    variant: "contained",
    size: "medium"
  });
  assert.equal(componentSetNode?.variantMapping?.states?.length, 4);
  assert.equal(componentSetNode?.variantMapping?.stateOverrides?.hover?.backgroundColor, "#b00018");
  assert.equal(componentSetNode?.variantMapping?.stateOverrides?.active?.backgroundColor, "#8f0013");
  assert.equal(componentSetNode?.variantMapping?.stateOverrides?.disabled?.backgroundColor, "#d1d5db");
  assert.equal(componentSetNode?.variantMapping?.stateOverrides?.disabled?.color, "#6b7280");
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

test("figmaToDesignIrWithOptions keeps deep interactive nodes over early decorative nodes under tight budget", () => {
  const ir = figmaToDesignIrWithOptions(createPriorityRetentionFigmaFile(), {
    screenElementBudget: 4
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const ids = new Set(collectElementIds(screenChildren));
  assert.equal(ids.has("cta-node"), true);
  assert.equal(ids.has("form-shell"), true);
  assert.equal(ids.has("form-section"), true);
  assert.equal(ids.has("action-row"), true);
  assert.equal(ids.has("decorative-bg"), false);
  assert.equal(ids.has("decorative-shape"), false);
  assert.equal(countElements(screenChildren), 4);
});

test("figmaToDesignIrWithOptions keeps required ancestor chain without exceeding budget", () => {
  const ir = figmaToDesignIrWithOptions(createAncestorChainBudgetFigmaFile(), {
    screenElementBudget: 3
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const ids = new Set(collectElementIds(screenChildren));
  assert.equal(ids.has("ancestor-root"), true);
  assert.equal(ids.has("ancestor-middle"), true);
  assert.equal(ids.has("ancestor-button"), true);
  assert.equal(ids.has("decor-node"), false);
  assert.equal(countElements(screenChildren), 3);
});

test("figmaToDesignIrWithOptions prioritizes meaningful text over decorative containers", () => {
  const ir = figmaToDesignIrWithOptions(createTextVsDecorativeFigmaFile(), {
    screenElementBudget: 1
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  assert.equal(countElements(screenChildren), 1);
  assert.equal(screenChildren[0]?.id, "meaningful-text");
});

test("figmaToDesignIrWithOptions remains deterministic for mixed-priority truncation", () => {
  const first = figmaToDesignIrWithOptions(createPriorityRetentionFigmaFile(), {
    screenElementBudget: 4
  });
  const second = figmaToDesignIrWithOptions(createPriorityRetentionFigmaFile(), {
    screenElementBudget: 4
  });

  assert.deepEqual(first.screens[0].children, second.screens[0].children);
  assert.deepEqual(first.metrics?.truncatedScreens, second.metrics?.truncatedScreens);
});

test("figmaToDesignIrWithOptions reports retainedElements matching actual truncated tree size", () => {
  const ir = figmaToDesignIrWithOptions(createPriorityRetentionFigmaFile(), {
    screenElementBudget: 4
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const retainedMetric = ir.metrics?.truncatedScreens.find((entry) => entry.screenId === "screen-priority")?.retainedElements;
  assert.equal(retainedMetric, countElements(screenChildren));
  assert.equal((retainedMetric ?? 0) <= 4, true);
  assert.ok(findElementById(screenChildren, "cta-node"));
});

test("figmaToDesignIrWithOptions applies configurable dynamic depth and keeps semantic deep nodes", () => {
  const ir = figmaToDesignIrWithOptions(createDynamicDepthFigmaFile(), {
    screenElementBudget: 200,
    screenElementMaxDepth: 1
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const ids = new Set(collectElementIds(screenChildren));
  assert.equal(ids.has("deep-cta"), true);
  assert.equal(ids.has("decor-leaf"), false);

  const depthMetrics = ir.metrics?.depthTruncatedScreens ?? [];
  assert.equal(depthMetrics.length, 1);
  assert.equal(depthMetrics[0]?.screenId, "screen-depth-dynamic");
  assert.equal((depthMetrics[0]?.truncatedBranchCount ?? 0) >= 1, true);
  assert.equal((depthMetrics[0]?.firstTruncatedDepth ?? 0) >= 2, true);
});

test("figmaToDesignIrWithOptions tightens depth traversal under level pressure and low remaining budget", () => {
  const ir = figmaToDesignIrWithOptions(createDepthPressureFigmaFile(), {
    screenElementBudget: 1,
    screenElementMaxDepth: 1
  });

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const ids = new Set(collectElementIds(screenChildren));
  assert.equal(ids.has("pressure-cta"), false);

  const depthMetrics = ir.metrics?.depthTruncatedScreens ?? [];
  assert.equal(depthMetrics.length, 1);
  assert.equal(depthMetrics[0]?.screenId, ir.screens[0]?.id);
  assert.equal((depthMetrics[0]?.truncatedBranchCount ?? 0) >= 1, true);
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

const createResponsiveVariantFigmaFile = () => ({
  name: "Responsive Variants Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "screen-login-mobile",
            type: "FRAME",
            name: "Login - Mobile",
            layoutMode: "VERTICAL",
            itemSpacing: 8,
            absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
            children: [
              {
                id: "login-mobile-form",
                type: "FRAME",
                name: "Form Area",
                layoutMode: "VERTICAL",
                itemSpacing: 8,
                absoluteBoundingBox: { x: 16, y: 120, width: 358, height: 240 },
                children: []
              },
              {
                id: "login-mobile-actions",
                type: "FRAME",
                name: "CTA Stack",
                layoutMode: "VERTICAL",
                itemSpacing: 8,
                absoluteBoundingBox: { x: 16, y: 380, width: 358, height: 120 },
                children: []
              }
            ]
          },
          {
            id: "screen-login-tablet",
            type: "FRAME",
            name: "Login / Tablet",
            layoutMode: "VERTICAL",
            itemSpacing: 16,
            absoluteBoundingBox: { x: 450, y: 0, width: 768, height: 1024 },
            children: [
              {
                id: "login-tablet-form",
                type: "FRAME",
                name: "Form Area",
                layoutMode: "VERTICAL",
                itemSpacing: 12,
                absoluteBoundingBox: { x: 498, y: 140, width: 672, height: 240 },
                children: []
              },
              {
                id: "login-tablet-actions",
                type: "FRAME",
                name: "CTA Stack",
                layoutMode: "HORIZONTAL",
                itemSpacing: 12,
                absoluteBoundingBox: { x: 498, y: 420, width: 672, height: 56 },
                children: []
              }
            ]
          },
          {
            id: "screen-login-desktop-lite",
            type: "FRAME",
            name: "Login - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 20,
            absoluteBoundingBox: { x: 1300, y: 0, width: 1200, height: 900 },
            children: [
              {
                id: "login-desktop-lite-form",
                type: "FRAME",
                name: "Form Area",
                layoutMode: "VERTICAL",
                itemSpacing: 16,
                absoluteBoundingBox: { x: 1360, y: 160, width: 1080, height: 240 },
                children: []
              },
              {
                id: "login-desktop-lite-actions",
                type: "FRAME",
                name: "CTA Stack",
                layoutMode: "HORIZONTAL",
                itemSpacing: 16,
                absoluteBoundingBox: { x: 1360, y: 440, width: 1080, height: 56 },
                children: []
              }
            ]
          },
          {
            id: "screen-login-desktop",
            type: "FRAME",
            name: "Login - Desktop",
            layoutMode: "VERTICAL",
            itemSpacing: 24,
            absoluteBoundingBox: { x: 2600, y: 0, width: 1336, height: 900 },
            children: [
              {
                id: "login-desktop-form",
                type: "FRAME",
                name: "Form Area",
                layoutMode: "VERTICAL",
                itemSpacing: 16,
                absoluteBoundingBox: { x: 2660, y: 160, width: 1216, height: 240 },
                children: []
              },
              {
                id: "login-desktop-actions",
                type: "FRAME",
                name: "CTA Stack",
                layoutMode: "HORIZONTAL",
                itemSpacing: 16,
                absoluteBoundingBox: { x: 2660, y: 440, width: 1216, height: 56 },
                children: []
              },
              {
                id: "login-desktop-footer",
                type: "FRAME",
                name: "Legal Footer",
                layoutMode: "HORIZONTAL",
                itemSpacing: 8,
                absoluteBoundingBox: { x: 2660, y: 532, width: 1216, height: 24 },
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createGradientFillFigmaFile = () => ({
  name: "Gradient Fill Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "gradient-screen",
            type: "FRAME",
            name: "Gradient Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 900 },
            fills: [
              {
                type: "LINEAR_GRADIENT",
                gradientStops: [
                  { position: 0, color: toFigmaColor("#d4001a") },
                  { position: 1, color: toFigmaColor("#f0b400") }
                ],
                gradientHandlePositions: [
                  { x: 0, y: 0 },
                  { x: 1, y: 0 }
                ]
              }
            ],
            children: [
              {
                id: "gradient-linear-node",
                type: "FRAME",
                name: "Linear Card",
                absoluteBoundingBox: { x: 48, y: 120, width: 560, height: 220 },
                fills: [
                  {
                    type: "GRADIENT_LINEAR",
                    gradientStops: [
                      { position: 0, color: toFigmaColor("#d4001a") },
                      { position: 1, color: toFigmaColor("#c26f00") }
                    ],
                    gradientHandlePositions: [
                      { x: 0, y: 0 },
                      { x: 0.8, y: 0.4 }
                    ]
                  }
                ],
                children: []
              },
              {
                id: "gradient-radial-node",
                type: "FRAME",
                name: "Radial Card",
                absoluteBoundingBox: { x: 640, y: 120, width: 560, height: 220 },
                fills: [
                  {
                    type: "GRADIENT_RADIAL",
                    gradientStops: [
                      { position: 0, color: toFigmaColor("#fff5d6") },
                      { position: 1, color: toFigmaColor("#d4001a") }
                    ]
                  }
                ],
                children: []
              }
            ]
          }
        ]
      }
    ]
  }
});

const createShadowEffectsFigmaFile = () => ({
  name: "Shadow Effects Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "shadow-screen",
            type: "FRAME",
            name: "Shadow Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
            children: [
              {
                id: "shadow-elevation-bands",
                type: "FRAME",
                name: "Shadow Elevation Bands",
                absoluteBoundingBox: { x: 40, y: 120, width: 600, height: 420 },
                children: [
                  {
                    id: "shadow-elev-0",
                    type: "FRAME",
                    name: "Shadow Elevation 0",
                    absoluteBoundingBox: { x: 56, y: 140, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 1,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.2 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-elev-2",
                    type: "FRAME",
                    name: "Shadow Elevation 2",
                    absoluteBoundingBox: { x: 56, y: 224, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 4,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.24 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-elev-5",
                    type: "FRAME",
                    name: "Shadow Elevation 5",
                    absoluteBoundingBox: { x: 56, y: 308, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 10,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.24 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-elev-14",
                    type: "FRAME",
                    name: "Shadow Elevation 14",
                    absoluteBoundingBox: { x: 260, y: 140, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 24,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.28 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-elev-21",
                    type: "FRAME",
                    name: "Shadow Elevation 21",
                    absoluteBoundingBox: { x: 260, y: 224, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 40,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.3 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-elev-24",
                    type: "FRAME",
                    name: "Shadow Elevation 24",
                    absoluteBoundingBox: { x: 260, y: 308, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 90,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.35 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-max-drop",
                    type: "FRAME",
                    name: "Shadow Max Drop",
                    absoluteBoundingBox: { x: 472, y: 140, width: 180, height: 72 },
                    effects: [
                      {
                        type: "DROP_SHADOW",
                        radius: 8,
                        offset: { x: 0, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.2 }
                      },
                      {
                        type: "DROP_SHADOW",
                        radius: 40,
                        offset: { x: 4, y: 3 },
                        color: { ...toFigmaColor("#000000"), a: 0.3 }
                      }
                    ],
                    children: []
                  },
                  {
                    id: "shadow-inner",
                    type: "FRAME",
                    name: "Inner Shadow Surface",
                    absoluteBoundingBox: { x: 472, y: 224, width: 180, height: 72 },
                    effects: [
                      {
                        type: "INNER_SHADOW",
                        radius: 6,
                        offset: { x: 2, y: 4 },
                        color: { ...toFigmaColor("#112233"), a: 0.25 }
                      },
                      {
                        type: "INNER_SHADOW",
                        radius: 3,
                        offset: { x: -1, y: 0 },
                        color: { ...toFigmaColor("#000000"), a: 0.5 }
                      }
                    ],
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

test("figmaToDesignIrWithOptions groups responsive screen variants and emits breakpoint metadata", () => {
  const ir = figmaToDesignIrWithOptions(createResponsiveVariantFigmaFile());

  assert.equal(ir.screens.length, 1);
  const screen = ir.screens[0];
  assert.equal(screen?.id, "screen-login-desktop");
  assert.equal(screen?.responsive?.groupKey, "login");
  assert.equal(screen?.responsive?.baseBreakpoint, "lg");
  assert.deepEqual(
    screen?.responsive?.variants.map((variant) => variant.breakpoint),
    ["xs", "sm", "lg"]
  );
  assert.equal(
    screen?.responsive?.variants.find((variant) => variant.breakpoint === "lg")?.isBase,
    true
  );
  assert.equal(screen?.responsive?.rootLayoutOverrides?.xs?.gap, 8);
  assert.equal(screen?.responsive?.rootLayoutOverrides?.sm?.gap, 16);

  const desktopActions = screen?.children.find((child) => child.id === "login-desktop-actions");
  if (!desktopActions) {
    throw new Error("Expected desktop actions node");
  }
  assert.equal(screen?.responsive?.topLevelLayoutOverrides?.[desktopActions.id]?.xs?.layoutMode, "VERTICAL");
});

test("figmaToDesignIrWithOptions derives responsive metadata deterministically", () => {
  const first = figmaToDesignIrWithOptions(createResponsiveVariantFigmaFile());
  const second = figmaToDesignIrWithOptions(createResponsiveVariantFigmaFile());

  assert.deepEqual(first.screens, second.screens);
  assert.deepEqual(first.metrics?.screenElementCounts, second.metrics?.screenElementCounts);
});

test("figmaToDesignIrWithOptions maps linear and radial gradient fills on screen and elements", () => {
  const ir = figmaToDesignIrWithOptions(createGradientFillFigmaFile());
  const screen = ir.screens[0];
  assert.ok(screen);
  assert.equal(screen?.id, "gradient-screen");
  assert.equal(typeof screen?.fillGradient, "string");
  assert.equal(screen?.fillGradient?.startsWith("linear-gradient("), true);

  const linearNode = screen?.children.find((child) => child.id === "gradient-linear-node");
  const radialNode = screen?.children.find((child) => child.id === "gradient-radial-node");
  assert.ok(linearNode);
  assert.ok(radialNode);
  assert.equal(linearNode?.fillGradient?.startsWith("linear-gradient("), true);
  assert.equal(radialNode?.fillGradient?.startsWith("radial-gradient("), true);
});

test("figmaToDesignIrWithOptions derives gradient fill metadata deterministically", () => {
  const first = figmaToDesignIrWithOptions(createGradientFillFigmaFile());
  const second = figmaToDesignIrWithOptions(createGradientFillFigmaFile());
  assert.deepEqual(first.screens, second.screens);
});

test("figmaToDesignIrWithOptions maps drop shadows to deterministic elevation bands", () => {
  const ir = figmaToDesignIrWithOptions(createShadowEffectsFigmaFile());
  const screen = ir.screens[0];
  assert.ok(screen);

  const elevationByNodeId = new Map(
    (screen?.children ?? [])
      .flatMap((node) => [node, ...(node.children ?? [])])
      .map((node) => [node.id, node.elevation] as const)
  );
  assert.equal(elevationByNodeId.get("shadow-elev-0"), 0);
  assert.equal(elevationByNodeId.get("shadow-elev-2"), 2);
  assert.equal(elevationByNodeId.get("shadow-elev-5"), 5);
  assert.equal(elevationByNodeId.get("shadow-elev-14"), 14);
  assert.equal(elevationByNodeId.get("shadow-elev-21"), 21);
  assert.equal(elevationByNodeId.get("shadow-elev-24"), 24);
});

test("figmaToDesignIrWithOptions picks the maximum elevation across multiple drop shadows", () => {
  const ir = figmaToDesignIrWithOptions(createShadowEffectsFigmaFile());
  const nested = ir.screens[0]?.children.flatMap((entry) => [entry, ...(entry.children ?? [])]) ?? [];
  const node = nested.find((entry) => entry.id === "shadow-max-drop");
  assert.ok(node);
  assert.equal(node?.elevation, 21);
});

test("figmaToDesignIrWithOptions maps inner shadows to CSS inset shadow strings", () => {
  const ir = figmaToDesignIrWithOptions(createShadowEffectsFigmaFile());
  const nested = ir.screens[0]?.children.flatMap((entry) => [entry, ...(entry.children ?? [])]) ?? [];
  const node = nested.find((entry) => entry.id === "shadow-inner");
  assert.ok(node);
  assert.equal(
    node?.insetShadow,
    "inset 2px 4px 6px rgba(17, 34, 51, 0.25), inset -1px 0px 3px rgba(0, 0, 0, 0.5)"
  );
});

test("figmaToDesignIrWithOptions derives shadow metadata deterministically", () => {
  const first = figmaToDesignIrWithOptions(createShadowEffectsFigmaFile());
  const second = figmaToDesignIrWithOptions(createShadowEffectsFigmaFile());
  assert.deepEqual(first.screens, second.screens);
});

test("deriveTokensForTesting prioritizes semantic button and heading colors over decorative fills", () => {
  const tokens = deriveTokensForTesting({
    name: "Token Demo",
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
              name: "Overview Screen",
              fills: [{ type: "SOLID", color: toFigmaColor("#f4f5f8") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 900 },
              children: [
                {
                  id: "decorative-bg",
                  type: "RECTANGLE",
                  name: "Decorative Glow",
                  fills: [{ type: "SOLID", color: toFigmaColor("#3b82f6") }],
                  absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 500 }
                },
                {
                  id: "title",
                  type: "TEXT",
                  name: "Headline",
                  characters: "Finanzübersicht",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                  style: { fontSize: 34, fontWeight: 700, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 48, y: 36, width: 420, height: 52 }
                },
                {
                  id: "cta",
                  type: "FRAME",
                  name: "Primary Button",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                  absoluteBoundingBox: { x: 60, y: 640, width: 280, height: 56 },
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.palette.primary, "#d4001a");
  assert.equal(tokens.palette.secondary !== tokens.palette.primary, true);
});

test("deriveTokensForTesting chooses text/background candidates with robust contrast", () => {
  const tokens = deriveTokensForTesting({
    name: "Contrast Demo",
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
              name: "Contrast Screen",
              fills: [{ type: "SOLID", color: toFigmaColor("#f8f9fb") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1180, height: 900 },
              children: [
                {
                  id: "body-light",
                  type: "TEXT",
                  name: "Body Light",
                  characters: "Leichter Text",
                  fills: [{ type: "SOLID", color: toFigmaColor("#9ca3af") }],
                  style: { fontSize: 16, fontWeight: 400, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 120, width: 260, height: 24 }
                },
                {
                  id: "headline-dark",
                  type: "TEXT",
                  name: "Headline Dark",
                  characters: "Starker Kontrast",
                  fills: [{ type: "SOLID", color: toFigmaColor("#111827") }],
                  style: { fontSize: 30, fontWeight: 700, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 40, width: 340, height: 40 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const ratio = contrastRatio(tokens.palette.text, tokens.palette.background);
  assert.equal(ratio >= 4.5, true);
});

test("deriveTokensForTesting uses median spacing and border radius", () => {
  const tokens = deriveTokensForTesting({
    name: "Metrics Demo",
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
              absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 800 },
              children: [
                { id: "n1", type: "FRAME", name: "A", itemSpacing: 4, cornerRadius: 2 },
                { id: "n2", type: "FRAME", name: "B", itemSpacing: 8, cornerRadius: 8 },
                { id: "n3", type: "FRAME", name: "C", itemSpacing: 8, cornerRadius: 12 },
                { id: "n4", type: "FRAME", name: "D", itemSpacing: 12, cornerRadius: 12 },
                { id: "n5", type: "FRAME", name: "E", itemSpacing: 40, cornerRadius: 20 }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.spacingBase, 8);
  assert.equal(tokens.borderRadius, 12);
});

test("deriveTokensForTesting builds stable font stack from heading and body families", () => {
  const tokens = deriveTokensForTesting({
    name: "Font Demo",
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
              absoluteBoundingBox: { x: 0, y: 0, width: 900, height: 700 },
              children: [
                {
                  id: "title",
                  type: "TEXT",
                  name: "Title",
                  characters: "Titel",
                  style: { fontSize: 34, fontWeight: 700, fontFamily: "Roboto Slab" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#1f2937") }],
                  absoluteBoundingBox: { x: 24, y: 24, width: 200, height: 40 }
                },
                {
                  id: "body-1",
                  type: "TEXT",
                  name: "Body 1",
                  characters: "Text",
                  style: { fontSize: 16, fontWeight: 400, fontFamily: "Inter" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#374151") }],
                  absoluteBoundingBox: { x: 24, y: 80, width: 280, height: 22 }
                },
                {
                  id: "body-2",
                  type: "TEXT",
                  name: "Body 2",
                  characters: "Weiterer Text",
                  style: { fontSize: 16, fontWeight: 400, fontFamily: "Inter" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#374151") }],
                  absoluteBoundingBox: { x: 24, y: 110, width: 320, height: 22 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.fontFamily.includes("Inter"), true);
  assert.equal(tokens.fontFamily.includes("Roboto Slab"), true);
  assert.equal(tokens.fontFamily.includes("sans-serif"), true);
  assert.equal(tokens.headingSize > tokens.bodySize, true);
});

test("deriveTokensForTesting boosts style-tagged brand colors", () => {
  const tokens = deriveTokensForTesting({
    name: "Style Boost Demo",
    styles: {
      "S:PRIMARY": {
        name: "Brand Primary Main",
        styleType: "FILL"
      }
    },
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
              fills: [{ type: "SOLID", color: toFigmaColor("#f7f8fb") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1000, height: 800 },
              children: [
                {
                  id: "button-red",
                  type: "FRAME",
                  name: "Primary Button",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                  absoluteBoundingBox: { x: 40, y: 620, width: 280, height: 56 }
                },
                {
                  id: "button-brand",
                  type: "FRAME",
                  name: "Secondary CTA",
                  styles: { fill: "S:PRIMARY" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#0b84f3") }],
                  absoluteBoundingBox: { x: 360, y: 620, width: 260, height: 56 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.palette.primary, "#0b84f3");
});

test("deriveTokensForTesting stays stable with sparse token signals", () => {
  const tokens = deriveTokensForTesting({
    name: "Sparse Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: []
        }
      ]
    }
  });

  assert.equal(/^#[0-9a-f]{6}$/i.test(tokens.palette.primary), true);
  assert.equal(/^#[0-9a-f]{6}$/i.test(tokens.palette.secondary), true);
  assert.equal(/^#[0-9a-f]{6}$/i.test(tokens.palette.background), true);
  assert.equal(/^#[0-9a-f]{6}$/i.test(tokens.palette.text), true);
  assert.equal(tokens.spacingBase >= 1, true);
  assert.equal(tokens.borderRadius >= 1, true);
  assert.equal(tokens.headingSize >= tokens.bodySize, true);
  assert.equal(tokens.fontFamily.includes("sans-serif"), true);
});
