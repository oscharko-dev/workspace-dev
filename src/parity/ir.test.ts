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
                id: "node-grid",
                type: "FRAME",
                name: "Grid Layout",
                absoluteBoundingBox: { x: 10, y: 340, width: 340, height: 180 },
                children: [
                  {
                    id: "node-grid-a",
                    type: "FRAME",
                    name: "Tile A",
                    absoluteBoundingBox: { x: 10, y: 340, width: 160, height: 80 },
                    children: []
                  },
                  {
                    id: "node-grid-b",
                    type: "FRAME",
                    name: "Tile B",
                    absoluteBoundingBox: { x: 190, y: 340, width: 160, height: 80 },
                    children: []
                  },
                  {
                    id: "node-grid-c",
                    type: "FRAME",
                    name: "Tile C",
                    absoluteBoundingBox: { x: 10, y: 440, width: 160, height: 80 },
                    children: []
                  },
                  {
                    id: "node-grid-d",
                    type: "FRAME",
                    name: "Tile D",
                    absoluteBoundingBox: { x: 190, y: 440, width: 160, height: 80 },
                    children: []
                  }
                ]
              },
              {
                id: "node-stack",
                type: "FRAME",
                name: "Stack Group",
                layoutMode: "VERTICAL",
                absoluteBoundingBox: { x: 370, y: 340, width: 200, height: 120 },
                children: [
                  {
                    id: "node-stack-child-1",
                    type: "TEXT",
                    name: "Stack Item 1",
                    characters: "Item 1",
                    absoluteBoundingBox: { x: 372, y: 344, width: 80, height: 20 }
                  },
                  {
                    id: "node-stack-child-2",
                    type: "TEXT",
                    name: "Stack Item 2",
                    characters: "Item 2",
                    absoluteBoundingBox: { x: 372, y: 372, width: 80, height: 20 }
                  }
                ]
              },
              {
                id: "node-paper",
                type: "FRAME",
                name: "Paper Surface",
                fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
                absoluteBoundingBox: { x: 370, y: 470, width: 260, height: 110 },
                children: [
                  {
                    id: "node-paper-text",
                    type: "TEXT",
                    name: "Paper Title",
                    characters: "Paper",
                    absoluteBoundingBox: { x: 382, y: 482, width: 80, height: 20 }
                  }
                ]
              },
              {
                id: "node-table",
                type: "FRAME",
                name: "Customer Table",
                absoluteBoundingBox: { x: 650, y: 340, width: 360, height: 160 },
                children: [
                  {
                    id: "node-table-row-1",
                    type: "FRAME",
                    name: "Table Row 1",
                    absoluteBoundingBox: { x: 650, y: 340, width: 360, height: 40 },
                    children: [
                      {
                        id: "node-table-row-1-col-1",
                        type: "TEXT",
                        name: "Col 1",
                        characters: "Name",
                        absoluteBoundingBox: { x: 656, y: 350, width: 80, height: 18 }
                      },
                      {
                        id: "node-table-row-1-col-2",
                        type: "TEXT",
                        name: "Col 2",
                        characters: "Value",
                        absoluteBoundingBox: { x: 836, y: 350, width: 80, height: 18 }
                      }
                    ]
                  },
                  {
                    id: "node-table-row-2",
                    type: "FRAME",
                    name: "Table Row 2",
                    absoluteBoundingBox: { x: 650, y: 384, width: 360, height: 40 },
                    children: [
                      {
                        id: "node-table-row-2-col-1",
                        type: "TEXT",
                        name: "Col 1",
                        characters: "Anna",
                        absoluteBoundingBox: { x: 656, y: 394, width: 80, height: 18 }
                      },
                      {
                        id: "node-table-row-2-col-2",
                        type: "TEXT",
                        name: "Col 2",
                        characters: "42",
                        absoluteBoundingBox: { x: 836, y: 394, width: 80, height: 18 }
                      }
                    ]
                  }
                ]
              },
              {
                id: "node-tooltip",
                type: "FRAME",
                name: "Tooltip Info",
                absoluteBoundingBox: { x: 650, y: 520, width: 120, height: 44 },
                children: []
              },
              {
                id: "node-drawer",
                type: "FRAME",
                name: "Side Drawer",
                absoluteBoundingBox: { x: 790, y: 520, width: 220, height: 260 },
                children: []
              },
              {
                id: "node-breadcrumbs",
                type: "FRAME",
                name: "Breadcrumbs",
                absoluteBoundingBox: { x: 650, y: 570, width: 220, height: 36 },
                children: []
              },
              {
                id: "node-select",
                type: "FRAME",
                name: "Select Field",
                absoluteBoundingBox: { x: 650, y: 620, width: 280, height: 56 },
                children: []
              },
              {
                id: "node-slider",
                type: "FRAME",
                name: "MuiSlider",
                absoluteBoundingBox: { x: 650, y: 690, width: 280, height: 40 },
                children: []
              },
              {
                id: "node-rating",
                type: "FRAME",
                name: "Star Rating",
                absoluteBoundingBox: { x: 650, y: 738, width: 180, height: 36 },
                children: []
              },
              {
                id: "node-snackbar",
                type: "FRAME",
                name: "Snackbar Alert",
                absoluteBoundingBox: { x: 650, y: 782, width: 320, height: 64 },
                children: []
              },
              {
                id: "node-skeleton",
                type: "FRAME",
                name: "Loading Skeleton",
                absoluteBoundingBox: { x: 650, y: 856, width: 320, height: 20 },
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
              { id: "hint-progress", type: "FRAME", name: "Frame 6", absoluteBoundingBox: { x: 0, y: 468, width: 200, height: 8 } },
              { id: "hint-grid", type: "FRAME", name: "Frame 7", absoluteBoundingBox: { x: 0, y: 486, width: 260, height: 120 } },
              { id: "hint-table", type: "FRAME", name: "Frame 8", absoluteBoundingBox: { x: 0, y: 616, width: 260, height: 120 } },
              { id: "hint-slider", type: "FRAME", name: "Frame 9", absoluteBoundingBox: { x: 0, y: 746, width: 240, height: 32 } },
              { id: "hint-select", type: "FRAME", name: "Frame 10", absoluteBoundingBox: { x: 0, y: 786, width: 280, height: 56 } },
              { id: "hint-rating", type: "FRAME", name: "Frame 11", absoluteBoundingBox: { x: 0, y: 852, width: 180, height: 32 } },
              { id: "hint-snackbar", type: "FRAME", name: "Frame 12", absoluteBoundingBox: { x: 0, y: 894, width: 300, height: 64 } },
              { id: "hint-skeleton", type: "FRAME", name: "Frame 13", absoluteBoundingBox: { x: 0, y: 968, width: 300, height: 20 } },
              { id: "hint-paper", type: "FRAME", name: "Frame 14", absoluteBoundingBox: { x: 0, y: 998, width: 280, height: 120 } },
              { id: "hint-stack", type: "FRAME", name: "Frame 15", absoluteBoundingBox: { x: 0, y: 1128, width: 280, height: 120 } },
              { id: "hint-drawer", type: "FRAME", name: "Frame 16", absoluteBoundingBox: { x: 0, y: 1258, width: 280, height: 240 } },
              { id: "hint-breadcrumbs", type: "FRAME", name: "Frame 17", absoluteBoundingBox: { x: 0, y: 1508, width: 280, height: 40 } },
              { id: "hint-tooltip", type: "FRAME", name: "Frame 18", absoluteBoundingBox: { x: 0, y: 1558, width: 120, height: 40 } }
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

test("figmaToDesignIr maps explicit margin fields on ScreenElementIR nodes", () => {
  const ir = figmaToDesignIr({
    name: "Margin Mapping",
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
              absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
              children: [
                {
                  id: "margin-node",
                  type: "FRAME",
                  name: "Margin Node",
                  marginTop: 8,
                  marginRight: 12,
                  marginBottom: 16,
                  marginLeft: 20,
                  absoluteBoundingBox: { x: 20, y: 20, width: 200, height: 80 },
                  children: []
                },
                {
                  id: "sibling-node",
                  type: "FRAME",
                  name: "Sibling Node",
                  absoluteBoundingBox: { x: 20, y: 120, width: 200, height: 80 },
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const marginNode = ir.screens[0]?.children.find((child) => child.id === "margin-node");
  assert.deepEqual(marginNode?.margin, {
    top: 8,
    right: 12,
    bottom: 16,
    left: 20
  });
});

test("figmaToDesignIr omits margin when absent and explicit fields are not provided", () => {
  const ir = figmaToDesignIr(createSampleFigmaFile());
  const inputNode = ir.screens[0]?.children.find((child) => child.id === "i1");
  assert.equal(inputNode?.margin, undefined);
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

test("figmaToDesignIrWithOptions keeps generic placeholders in instance input context and marks textRole", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Generic Placeholder Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-generic-placeholder",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 640, height: 960 },
              children: [
                {
                  id: "instance-root",
                  type: "INSTANCE",
                  name: "Instance Root",
                  absoluteBoundingBox: { x: 24, y: 24, width: 420, height: 300 },
                  children: [
                    {
                      id: "input-root",
                      type: "FRAME",
                      name: "TextField Root",
                      absoluteBoundingBox: { x: 24, y: 24, width: 320, height: 64 },
                      children: [
                        {
                          id: "input-label",
                          type: "TEXT",
                          name: "Label",
                          characters: "Amount",
                          absoluteBoundingBox: { x: 32, y: 30, width: 120, height: 16 }
                        },
                        {
                          id: "input-placeholder",
                          type: "TEXT",
                          name: "Placeholder",
                          characters: "Type here",
                          absoluteBoundingBox: { x: 32, y: 52, width: 140, height: 20 }
                        }
                      ]
                    },
                    {
                      id: "content-card",
                      type: "FRAME",
                      name: "Card",
                      absoluteBoundingBox: { x: 24, y: 120, width: 320, height: 120 },
                      children: [
                        {
                          id: "card-placeholder",
                          type: "TEXT",
                          name: "Placeholder",
                          characters: "Type here",
                          absoluteBoundingBox: { x: 32, y: 132, width: 140, height: 20 }
                        }
                      ]
                    }
                  ]
                },
                {
                  id: "plain-frame",
                  type: "FRAME",
                  name: "Plain",
                  absoluteBoundingBox: { x: 24, y: 360, width: 320, height: 120 },
                  children: [
                    {
                      id: "plain-placeholder",
                      type: "TEXT",
                      name: "Placeholder",
                      characters: "Type here",
                      absoluteBoundingBox: { x: 32, y: 372, width: 140, height: 20 }
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

  const screenChildren = ir.screens[0].children as Array<{ id: string; children?: unknown[] }>;
  const ids = new Set(collectElementIds(screenChildren));
  assert.equal(ids.has("input-placeholder"), true);
  assert.equal(ids.has("card-placeholder"), false);
  assert.equal(ids.has("plain-placeholder"), true);

  const inputPlaceholderNode = findElementById(screenChildren, "input-placeholder") as
    | { textRole?: string; text?: string }
    | undefined;
  assert.equal(inputPlaceholderNode?.textRole, "placeholder");
  assert.equal(inputPlaceholderNode?.text, "Type here");
});

test("figmaToDesignIrWithOptions applies placeholder allowlist and blocklist deterministically", () => {
  const file = {
    name: "Placeholder Rules Demo",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-placeholder-rules",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 480, height: 640 },
              children: [
                {
                  id: "instance-rules",
                  type: "INSTANCE",
                  name: "Instance Rules",
                  absoluteBoundingBox: { x: 24, y: 24, width: 280, height: 200 },
                  children: [
                    {
                      id: "allow-candidate",
                      type: "TEXT",
                      name: "Allow Candidate",
                      characters: "Type here",
                      absoluteBoundingBox: { x: 32, y: 36, width: 120, height: 20 }
                    },
                    {
                      id: "block-candidate",
                      type: "TEXT",
                      name: "Block Candidate",
                      characters: "Visible Value",
                      absoluteBoundingBox: { x: 32, y: 64, width: 120, height: 20 }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const allowlisted = figmaToDesignIrWithOptions(file, {
    placeholderRules: {
      allowlist: ["Type Here"]
    }
  });
  const allowlistedIds = new Set(collectElementIds(allowlisted.screens[0].children as Array<{ id: string; children?: unknown[] }>));
  assert.equal(allowlistedIds.has("allow-candidate"), true);

  const blocklistedFirst = figmaToDesignIrWithOptions(file, {
    placeholderRules: {
      blocklist: ["visible value"]
    }
  });
  const blocklistedSecond = figmaToDesignIrWithOptions(file, {
    placeholderRules: {
      blocklist: ["visible value"]
    }
  });
  assert.deepEqual(blocklistedFirst, blocklistedSecond);

  const blocklistedIds = new Set(
    collectElementIds(blocklistedFirst.screens[0].children as Array<{ id: string; children?: unknown[] }>)
  );
  assert.equal(blocklistedIds.has("block-candidate"), false);
  assert.ok((blocklistedFirst.metrics?.skippedPlaceholders ?? 0) >= 1);
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
  assert.equal(byId.get("node-grid"), "grid");
  assert.equal(byId.get("node-stack"), "stack");
  assert.equal(byId.get("node-paper"), "paper");
  assert.equal(byId.get("node-table"), "table");
  assert.equal(byId.get("node-tooltip"), "tooltip");
  assert.equal(byId.get("node-drawer"), "drawer");
  assert.equal(byId.get("node-breadcrumbs"), "breadcrumbs");
  assert.equal(byId.get("node-select"), "select");
  assert.equal(byId.get("node-slider"), "slider");
  assert.equal(byId.get("node-rating"), "rating");
  assert.equal(byId.get("node-snackbar"), "snackbar");
  assert.equal(byId.get("node-skeleton"), "skeleton");
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

test("figmaToDesignIrWithOptions classifies visible IMAGE-paint nodes as image", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Image Paint",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-image-paint",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "image-paint-node",
                  type: "RECTANGLE",
                  name: "Hero",
                  fills: [{ type: "IMAGE" }],
                  absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 120 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const typeById = new Map(ir.screens[0]?.children.map((child) => [child.id, child.type]));
  assert.equal(typeById.get("image-paint-node"), "image");
});

test("figmaToDesignIrWithOptions classifies explicit VECTOR image nodes and keeps icon helpers unchanged", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Vector Images",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-vector-image",
              type: "FRAME",
              name: "Screen",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "vector-image-node",
                  type: "VECTOR",
                  name: "Photo Illustration",
                  absoluteBoundingBox: { x: 0, y: 0, width: 64, height: 64 }
                },
                {
                  id: "vector-icon-node",
                  type: "VECTOR",
                  name: "icon/photo",
                  absoluteBoundingBox: { x: 80, y: 0, width: 24, height: 24 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const typeById = new Map(ir.screens[0]?.children.map((child) => [child.id, child.type]));
  assert.equal(typeById.get("vector-image-node"), "image");
  assert.equal(typeById.get("vector-icon-node"), "container");
});

test("figmaToDesignIrWithOptions maps ON_CLICK NODE prototype interactions to deterministic screen navigation", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Prototype Navigation",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-a",
              type: "FRAME",
              name: "Screen A",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "nav-push",
                  type: "FRAME",
                  name: "Navigate Button",
                  absoluteBoundingBox: { x: 16, y: 16, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "target-b", navigation: "NAVIGATE" }]
                    }
                  ],
                  children: []
                },
                {
                  id: "nav-replace",
                  type: "FRAME",
                  name: "Replace Button",
                  absoluteBoundingBox: { x: 16, y: 64, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "screen-b", navigation: "SWAP" }]
                    }
                  ],
                  children: []
                },
                {
                  id: "nav-overlay",
                  type: "FRAME",
                  name: "Overlay Button",
                  absoluteBoundingBox: { x: 16, y: 112, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", transitionNodeId: "target-b", navigation: "OVERLAY" }]
                    }
                  ],
                  children: []
                },
                {
                  id: "nav-change-to",
                  type: "FRAME",
                  name: "Variant Toggle",
                  absoluteBoundingBox: { x: 16, y: 160, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "target-b", navigation: "CHANGE_TO" }]
                    }
                  ],
                  children: []
                },
                {
                  id: "nav-hover",
                  type: "FRAME",
                  name: "Hover Interaction",
                  absoluteBoundingBox: { x: 16, y: 208, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_HOVER" },
                      actions: [{ type: "NODE", destinationId: "target-b", navigation: "NAVIGATE" }]
                    }
                  ],
                  children: []
                }
              ]
            },
            {
              id: "screen-b",
              type: "FRAME",
              name: "Screen B",
              absoluteBoundingBox: { x: 500, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "target-b",
                  type: "TEXT",
                  name: "Target",
                  characters: "Target",
                  absoluteBoundingBox: { x: 520, y: 24, width: 100, height: 24 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  const screenA = ir.screens.find((screen) => screen.id === "screen-a");
  assert.ok(screenA);
  const pushNode = findElementById(screenA?.children ?? [], "nav-push") as { prototypeNavigation?: unknown } | undefined;
  const replaceNode = findElementById(screenA?.children ?? [], "nav-replace") as { prototypeNavigation?: unknown } | undefined;
  const overlayNode = findElementById(screenA?.children ?? [], "nav-overlay") as { prototypeNavigation?: unknown } | undefined;
  const changeToNode = findElementById(screenA?.children ?? [], "nav-change-to") as { prototypeNavigation?: unknown } | undefined;
  const hoverNode = findElementById(screenA?.children ?? [], "nav-hover") as { prototypeNavigation?: unknown } | undefined;

  assert.deepEqual(pushNode?.prototypeNavigation, { targetScreenId: "screen-b", mode: "push" });
  assert.deepEqual(replaceNode?.prototypeNavigation, { targetScreenId: "screen-b", mode: "replace" });
  assert.deepEqual(overlayNode?.prototypeNavigation, { targetScreenId: "screen-b", mode: "overlay" });
  assert.equal(changeToNode?.prototypeNavigation, undefined);
  assert.equal(hoverNode?.prototypeNavigation, undefined);
  assert.equal(ir.metrics?.prototypeNavigationDetected, 3);
  assert.equal(ir.metrics?.prototypeNavigationResolved, 3);
  assert.equal(ir.metrics?.prototypeNavigationUnresolved, 0);
});

test("figmaToDesignIrWithOptions ignores unresolved prototype targets and records unresolved metrics", () => {
  const ir = figmaToDesignIrWithOptions({
    name: "Prototype Navigation Unresolved",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          children: [
            {
              id: "screen-a",
              type: "FRAME",
              name: "Screen A",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
              children: [
                {
                  id: "nav-missing-destination",
                  type: "FRAME",
                  name: "Missing Destination",
                  absoluteBoundingBox: { x: 16, y: 16, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", navigation: "NAVIGATE" }]
                    }
                  ],
                  children: []
                },
                {
                  id: "nav-unknown-target",
                  type: "FRAME",
                  name: "Unknown Target",
                  absoluteBoundingBox: { x: 16, y: 64, width: 120, height: 40 },
                  interactions: [
                    {
                      trigger: { type: "ON_CLICK" },
                      actions: [{ type: "NODE", destinationId: "not-a-screen-node", navigation: "REPLACE" }]
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

  const screen = ir.screens.find((entry) => entry.id === "screen-a");
  assert.ok(screen);
  const missingDestinationNode = findElementById(screen?.children ?? [], "nav-missing-destination") as {
    prototypeNavigation?: unknown;
  };
  const unknownTargetNode = findElementById(screen?.children ?? [], "nav-unknown-target") as {
    prototypeNavigation?: unknown;
  };
  assert.equal(missingDestinationNode.prototypeNavigation, undefined);
  assert.equal(unknownTargetNode.prototypeNavigation, undefined);
  assert.equal(ir.metrics?.prototypeNavigationDetected, 2);
  assert.equal(ir.metrics?.prototypeNavigationResolved, 0);
  assert.equal(ir.metrics?.prototypeNavigationUnresolved, 2);
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
        },
        {
          nodeId: "hint-grid",
          semanticName: "Kachel Raster",
          semanticType: "grid layout",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-table",
          semanticName: "Daten Tabelle",
          semanticType: "table",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-slider",
          semanticName: "Betrag Slider",
          semanticType: "slider range",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-select",
          semanticName: "Laufzeit Select",
          semanticType: "select dropdown",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-rating",
          semanticName: "Sterne Bewertung",
          semanticType: "rating stars",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-snackbar",
          semanticName: "Status Snackbar",
          semanticType: "snackbar alert",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-skeleton",
          semanticName: "Lade Skeleton",
          semanticType: "loading skeleton",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-paper",
          semanticName: "Surface Paper",
          semanticType: "paper surface",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-stack",
          semanticName: "Vertical Stack",
          semanticType: "stack layout",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-drawer",
          semanticName: "Seitliche Navigation",
          semanticType: "drawer sidebar",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-breadcrumbs",
          semanticName: "Navigation Pfad",
          semanticType: "breadcrumbs",
          sourceTools: ["figma-mcp"]
        },
        {
          nodeId: "hint-tooltip",
          semanticName: "Info Tooltip",
          semanticType: "tooltip",
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
  assert.equal(byId.get("hint-grid")?.type, "grid");
  assert.equal(byId.get("hint-table")?.type, "table");
  assert.equal(byId.get("hint-slider")?.type, "slider");
  assert.equal(byId.get("hint-select")?.type, "select");
  assert.equal(byId.get("hint-rating")?.type, "rating");
  assert.equal(byId.get("hint-snackbar")?.type, "snackbar");
  assert.equal(byId.get("hint-skeleton")?.type, "skeleton");
  assert.equal(byId.get("hint-paper")?.type, "paper");
  assert.equal(byId.get("hint-stack")?.type, "stack");
  assert.equal(byId.get("hint-drawer")?.type, "drawer");
  assert.equal(byId.get("hint-breadcrumbs")?.type, "breadcrumbs");
  assert.equal(byId.get("hint-tooltip")?.type, "tooltip");
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

const createOpacityFigmaFile = () => ({
  name: "Opacity Demo",
  document: {
    id: "0:0",
    type: "DOCUMENT",
    children: [
      {
        id: "0:1",
        type: "CANVAS",
        children: [
          {
            id: "opacity-screen",
            type: "FRAME",
            name: "Opacity Screen",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 900 },
            children: [
              {
                id: "opacity-node-valid",
                type: "FRAME",
                name: "Opacity Valid",
                opacity: 0.42,
                absoluteBoundingBox: { x: 48, y: 80, width: 420, height: 120 },
                children: []
              },
              {
                id: "opacity-node-zero",
                type: "FRAME",
                name: "Opacity Zero",
                opacity: 0,
                absoluteBoundingBox: { x: 48, y: 220, width: 420, height: 120 },
                children: []
              },
              {
                id: "opacity-node-one",
                type: "FRAME",
                name: "Opacity One",
                opacity: 1,
                absoluteBoundingBox: { x: 48, y: 360, width: 420, height: 120 },
                children: []
              },
              {
                id: "opacity-node-negative",
                type: "FRAME",
                name: "Opacity Negative",
                opacity: -0.2,
                absoluteBoundingBox: { x: 48, y: 500, width: 420, height: 120 },
                children: []
              },
              {
                id: "opacity-node-over",
                type: "FRAME",
                name: "Opacity Over",
                opacity: 1.4,
                absoluteBoundingBox: { x: 48, y: 640, width: 420, height: 120 },
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
  assert.equal(screen?.responsive?.topLevelLayoutOverrides?.[desktopActions.id]?.xs?.widthRatio, undefined);
  assert.equal(screen?.responsive?.topLevelLayoutOverrides?.[desktopActions.id]?.xs?.minHeight, 120);
  assert.equal(screen?.responsive?.topLevelLayoutOverrides?.[desktopActions.id]?.sm?.widthRatio, 0.875);
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

test("figmaToDesignIrWithOptions maps node opacity to ScreenElementIR.opacity for values in [0,1)", () => {
  const ir = figmaToDesignIrWithOptions(createOpacityFigmaFile());
  const screen = ir.screens[0];
  assert.ok(screen);

  const validNode = screen?.children.find((entry) => entry.id === "opacity-node-valid");
  const zeroNode = screen?.children.find((entry) => entry.id === "opacity-node-zero");
  const oneNode = screen?.children.find((entry) => entry.id === "opacity-node-one");
  const negativeNode = screen?.children.find((entry) => entry.id === "opacity-node-negative");
  const overNode = screen?.children.find((entry) => entry.id === "opacity-node-over");

  assert.equal(validNode?.opacity, 0.42);
  assert.equal(zeroNode?.opacity, 0);
  assert.equal(oneNode?.opacity, undefined);
  assert.equal(negativeNode?.opacity, undefined);
  assert.equal(overNode?.opacity, undefined);
});

test("figmaToDesignIrWithOptions derives opacity metadata deterministically", () => {
  const first = figmaToDesignIrWithOptions(createOpacityFigmaFile());
  const second = figmaToDesignIrWithOptions(createOpacityFigmaFile());
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

test("deriveTokensForTesting derives semantic palette colors from explicit figma signals", () => {
  const tokens = deriveTokensForTesting({
    name: "Semantic Demo",
    styles: {
      "S:SUCCESS": { name: "System Success", styleType: "FILL" },
      "S:WARNING": { name: "System Warning", styleType: "FILL" },
      "S:ERROR": { name: "System Error", styleType: "FILL" },
      "S:INFO": { name: "System Info", styleType: "FILL" },
      "S:DIVIDER": { name: "Divider Border", styleType: "FILL" }
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
              name: "Semantic Screen",
              fills: [{ type: "SOLID", color: toFigmaColor("#f8fafc") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 900 },
              children: [
                {
                  id: "heading",
                  type: "TEXT",
                  name: "Headline",
                  characters: "Statusübersicht",
                  fills: [{ type: "SOLID", color: toFigmaColor("#111827") }],
                  style: { fontSize: 32, fontWeight: 700, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 40, width: 340, height: 40 }
                },
                {
                  id: "primary-cta",
                  type: "FRAME",
                  name: "Primary Button",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                  absoluteBoundingBox: { x: 40, y: 760, width: 260, height: 56 }
                },
                {
                  id: "success-message",
                  type: "TEXT",
                  name: "Success Message",
                  characters: "Erfolgreich validiert",
                  styles: { fill: "S:SUCCESS" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#16a34a") }],
                  style: { fontSize: 16, fontWeight: 500, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 120, width: 260, height: 24 }
                },
                {
                  id: "warning-message",
                  type: "TEXT",
                  name: "Warning Banner",
                  characters: "Prüfung empfohlen",
                  styles: { fill: "S:WARNING" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#d97706") }],
                  style: { fontSize: 16, fontWeight: 500, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 160, width: 260, height: 24 }
                },
                {
                  id: "error-message",
                  type: "TEXT",
                  name: "Error Text",
                  characters: "Ungültige Eingabe",
                  styles: { fill: "S:ERROR" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#f05d6c") }],
                  style: { fontSize: 16, fontWeight: 500, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 200, width: 220, height: 24 }
                },
                {
                  id: "info-message",
                  type: "TEXT",
                  name: "Info Hint",
                  characters: "Weitere Informationen",
                  styles: { fill: "S:INFO" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#0288d1") }],
                  style: { fontSize: 16, fontWeight: 500, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 240, width: 260, height: 24 }
                },
                {
                  id: "divider",
                  type: "RECTANGLE",
                  name: "Divider Horizontal",
                  styles: { fill: "S:DIVIDER" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#cbd5e1") }],
                  absoluteBoundingBox: { x: 40, y: 300, width: 520, height: 1 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.palette.success, "#16a34a");
  assert.equal(tokens.palette.warning, "#d97706");
  assert.equal(tokens.palette.error, "#f05d6c");
  assert.equal(tokens.palette.info, "#0288d1");
  assert.equal(tokens.palette.divider, "#cbd5e1");
  assert.equal(tokens.palette.action.active, `${tokens.palette.text}8a`);
});

test("deriveTokensForTesting keeps info distinct when primary is already blue", () => {
  const tokens = deriveTokensForTesting({
    name: "Blue Primary Demo",
    styles: {
      "S:PRIMARY": { name: "Brand Primary", styleType: "FILL" },
      "S:INFO": { name: "System Info", styleType: "FILL" }
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
              name: "Blue Screen",
              fills: [{ type: "SOLID", color: toFigmaColor("#f8fafc") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1080, height: 720 },
              children: [
                {
                  id: "title",
                  type: "TEXT",
                  name: "Headline",
                  characters: "Blue primary",
                  fills: [{ type: "SOLID", color: toFigmaColor("#111827") }],
                  style: { fontSize: 30, fontWeight: 700, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 40, width: 240, height: 36 }
                },
                {
                  id: "primary-button",
                  type: "FRAME",
                  name: "Primary Button",
                  styles: { fill: "S:PRIMARY" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#0b84f3") }],
                  absoluteBoundingBox: { x: 40, y: 620, width: 260, height: 56 }
                },
                {
                  id: "info-banner",
                  type: "TEXT",
                  name: "Info Banner",
                  characters: "Zusätzliche Informationen",
                  styles: { fill: "S:INFO" },
                  fills: [{ type: "SOLID", color: toFigmaColor("#36a2eb") }],
                  style: { fontSize: 16, fontWeight: 500, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 120, width: 280, height: 24 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.palette.primary, "#0b84f3");
  assert.equal(tokens.palette.info !== tokens.palette.primary, true);
});

test("deriveTokensForTesting falls back to semantic defaults when boards have no semantic signals", () => {
  const tokens = deriveTokensForTesting({
    name: "No Semantic Signals Demo",
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
              fills: [{ type: "SOLID", color: toFigmaColor("#fdfdfd") }],
              absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 900 },
              children: [
                {
                  id: "headline",
                  type: "TEXT",
                  name: "Headline",
                  characters: "Kontenübersicht",
                  fills: [{ type: "SOLID", color: toFigmaColor("#272727") }],
                  style: { fontSize: 28, fontWeight: 700, fontFamily: "Inter" },
                  absoluteBoundingBox: { x: 40, y: 40, width: 320, height: 36 }
                },
                {
                  id: "primary-cta",
                  type: "FRAME",
                  name: "Primary Button",
                  fills: [{ type: "SOLID", color: toFigmaColor("#d4001a") }],
                  absoluteBoundingBox: { x: 40, y: 760, width: 260, height: 56 }
                },
                {
                  id: "generic-green",
                  type: "RECTANGLE",
                  name: "Promo Tile",
                  fills: [{ type: "SOLID", color: toFigmaColor("#2e7d32") }],
                  absoluteBoundingBox: { x: 40, y: 140, width: 240, height: 120 }
                },
                {
                  id: "generic-orange",
                  type: "RECTANGLE",
                  name: "Metric Tile",
                  fills: [{ type: "SOLID", color: toFigmaColor("#ed6c02") }],
                  absoluteBoundingBox: { x: 320, y: 140, width: 240, height: 120 }
                },
                {
                  id: "generic-blue",
                  type: "RECTANGLE",
                  name: "Side Panel",
                  fills: [{ type: "SOLID", color: toFigmaColor("#1976d2") }],
                  absoluteBoundingBox: { x: 600, y: 140, width: 240, height: 120 }
                },
                {
                  id: "generic-line",
                  type: "RECTANGLE",
                  name: "Thin Line",
                  fills: [{ type: "SOLID", color: toFigmaColor("#565656") }],
                  absoluteBoundingBox: { x: 40, y: 320, width: 560, height: 1 }
                }
              ]
            }
          ]
        }
      ]
    }
  });

  assert.equal(tokens.palette.success, "#16A34A");
  assert.equal(tokens.palette.warning, "#D97706");
  assert.equal(tokens.palette.error, "#DC2626");
  assert.equal(tokens.palette.info, "#0288D1");
  assert.equal(tokens.palette.divider, "#2727271f");
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
  assert.equal(tokens.palette.success, "#16A34A");
  assert.equal(tokens.palette.warning, "#D97706");
  assert.equal(tokens.palette.error, "#DC2626");
  assert.equal(tokens.palette.info, "#0288D1");
  assert.equal(tokens.palette.divider, "#1f29371f");
  assert.equal(tokens.palette.action.disabledBackground, "#1f29371f");
  assert.equal(tokens.palette.action.focus, "#d4001a1f");
  assert.equal(tokens.spacingBase >= 1, true);
  assert.equal(tokens.borderRadius >= 1, true);
  assert.equal(tokens.headingSize >= tokens.bodySize, true);
  assert.equal(tokens.fontFamily.includes("sans-serif"), true);
});
