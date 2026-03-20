// ---------------------------------------------------------------------------
// css-grid-layout.e2e.test.ts — E2E test for CSS Grid layout detection and generation
// Validates CSS Grid detection, spanning, asymmetric columns, and rendering (#306)
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import test from "node:test";
import { figmaToDesignIrWithOptions } from "./ir.js";
import {
  detectCssGridLayout,
  clusterAxisValues,
  toNearestClusterIndex,
  createDeterministicScreenFile
} from "./generator-core.js";
import type { ScreenElementIR, ScreenIR } from "./types.js";

const FIGMA_FILE_KEY = process.env["FIGMA_FILE_KEY"] ?? "xZkvYk9KOezMsi9LmPEFGX";
const FIGMA_ACCESS_TOKEN = process.env["FIGMA_ACCESS_TOKEN"] ?? "";

const skipReason =
  FIGMA_ACCESS_TOKEN.length === 0
    ? "FIGMA_ACCESS_TOKEN not set – skipping real Figma E2E tests"
    : undefined;

let cachedFigmaFile: unknown;

const fetchFigmaFileOnce = async (): Promise<unknown> => {
  if (cachedFigmaFile) {
    return cachedFigmaFile;
  }
  const response = await fetch(`https://api.figma.com/v1/files/${FIGMA_FILE_KEY}?geometry=paths`, {
    headers: {
      "X-Figma-Token": FIGMA_ACCESS_TOKEN
    }
  });
  assert.equal(response.ok, true, `Figma API responded with status ${response.status}`);
  cachedFigmaFile = await response.json();
  return cachedFigmaFile;
};

const collectAllElements = (children: ScreenElementIR[]): ScreenElementIR[] => {
  const elements: ScreenElementIR[] = [];
  const stack = [...children];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    elements.push(current);
    if (Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }
  return elements;
};

// ---------------------------------------------------------------------------
// Unit tests for CSS Grid detection (no Figma API required)
// ---------------------------------------------------------------------------

test("detectCssGridLayout returns null for elements with fewer than 3 children", () => {
  const element: ScreenElementIR = {
    id: "test-1",
    name: "small-grid",
    nodeType: "FRAME",
    type: "grid",
    layoutMode: "NONE",
    children: [
      { id: "c1", name: "child1", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 100, height: 50 },
      { id: "c2", name: "child2", nodeType: "FRAME", type: "container", x: 110, y: 0, width: 100, height: 50 }
    ]
  };
  assert.equal(detectCssGridLayout(element), null);
});

test("detectCssGridLayout returns null for HORIZONTAL layout containers", () => {
  const element: ScreenElementIR = {
    id: "test-2",
    name: "flex-row",
    nodeType: "FRAME",
    type: "container",
    layoutMode: "HORIZONTAL",
    children: [
      { id: "c1", name: "child1", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 100, height: 50 },
      { id: "c2", name: "child2", nodeType: "FRAME", type: "container", x: 110, y: 0, width: 100, height: 50 },
      { id: "c3", name: "child3", nodeType: "FRAME", type: "container", x: 220, y: 0, width: 100, height: 50 },
      { id: "c4", name: "child4", nodeType: "FRAME", type: "container", x: 0, y: 60, width: 100, height: 50 }
    ]
  };
  assert.equal(detectCssGridLayout(element), null);
});

test("detectCssGridLayout returns null for a simple equal-width grid (no spanning)", () => {
  // 2x2 grid with equal-sized children — no spanning or asymmetry
  const element: ScreenElementIR = {
    id: "test-3",
    name: "simple-grid",
    nodeType: "FRAME",
    type: "grid",
    layoutMode: "NONE",
    children: [
      { id: "c1", name: "child1", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 100, height: 50 },
      { id: "c2", name: "child2", nodeType: "FRAME", type: "container", x: 110, y: 0, width: 100, height: 50 },
      { id: "c3", name: "child3", nodeType: "FRAME", type: "container", x: 0, y: 60, width: 100, height: 50 },
      { id: "c4", name: "child4", nodeType: "FRAME", type: "container", x: 110, y: 60, width: 100, height: 50 }
    ]
  };
  // Equal widths, no spanning → should return null (MUI Grid is sufficient)
  assert.equal(detectCssGridLayout(element), null);
});

test("detectCssGridLayout detects spanning children in a 2D grid", () => {
  // Header spans full width (2 columns), then 2x2 grid below
  const element: ScreenElementIR = {
    id: "test-4",
    name: "spanning-grid",
    nodeType: "FRAME",
    type: "grid",
    layoutMode: "NONE",
    children: [
      // Header spans both columns
      { id: "header", name: "Header", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 220, height: 50 },
      // Two cells in second row
      { id: "left", name: "Left", nodeType: "FRAME", type: "container", x: 0, y: 60, width: 100, height: 100 },
      { id: "right", name: "Right", nodeType: "FRAME", type: "container", x: 110, y: 60, width: 100, height: 100 },
      // Footer spans both columns
      { id: "footer", name: "Footer", nodeType: "FRAME", type: "container", x: 0, y: 170, width: 220, height: 50 }
    ]
  };
  const result = detectCssGridLayout(element);
  assert.ok(result !== null, "Should detect CSS Grid for spanning layout");
  assert.equal(result.mode, "css-grid");
  assert.ok(result.gridTemplateColumns !== undefined, "Should have gridTemplateColumns");
  assert.ok(result.gridTemplateRows !== undefined, "Should have gridTemplateRows");
  assert.ok(result.childSpans !== undefined, "Should have childSpans");
  assert.equal(result.columnCount, 2);
});

test("detectCssGridLayout detects asymmetric column widths", () => {
  // 3 columns: narrow, wide, narrow (1:3:1 ratio)
  const element: ScreenElementIR = {
    id: "test-5",
    name: "asymmetric-grid",
    nodeType: "FRAME",
    type: "grid",
    layoutMode: "NONE",
    children: [
      // Row 1: narrow | wide | narrow
      { id: "c1", name: "nav", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 60, height: 50 },
      { id: "c2", name: "main", nodeType: "FRAME", type: "container", x: 70, y: 0, width: 200, height: 50 },
      { id: "c3", name: "aside", nodeType: "FRAME", type: "container", x: 280, y: 0, width: 60, height: 50 },
      // Row 2: narrow | wide | narrow
      { id: "c4", name: "nav2", nodeType: "FRAME", type: "container", x: 0, y: 60, width: 60, height: 50 },
      { id: "c5", name: "main2", nodeType: "FRAME", type: "container", x: 70, y: 60, width: 200, height: 50 },
      { id: "c6", name: "aside2", nodeType: "FRAME", type: "container", x: 280, y: 60, width: 60, height: 50 }
    ]
  };
  const result = detectCssGridLayout(element);
  assert.ok(result !== null, "Should detect CSS Grid for asymmetric layout");
  assert.equal(result.mode, "css-grid");
  assert.equal(result.columnCount, 3);
  // The middle column should have a larger fr value
  assert.ok(result.gridTemplateColumns !== undefined);
  assert.equal(result.gridTemplateColumns.length, 3);
});

test("detectCssGridLayout detects named grid area patterns", () => {
  const element: ScreenElementIR = {
    id: "test-6",
    name: "named-areas-grid",
    nodeType: "FRAME",
    type: "grid",
    layoutMode: "NONE",
    children: [
      { id: "c1", name: "header", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 100, height: 50 },
      { id: "c2", name: "sidebar", nodeType: "FRAME", type: "container", x: 0, y: 60, width: 100, height: 100 },
      { id: "c3", name: "content", nodeType: "FRAME", type: "container", x: 110, y: 60, width: 100, height: 100 },
      { id: "c4", name: "footer", nodeType: "FRAME", type: "container", x: 0, y: 170, width: 100, height: 50 }
    ]
  };
  const result = detectCssGridLayout(element);
  // Named areas with header/sidebar/footer → should detect CSS Grid
  assert.ok(result !== null, "Should detect CSS Grid for named area layout");
  assert.equal(result.mode, "css-grid");
});

test("clusterAxisValues groups nearby positions into clusters", () => {
  const clusters = clusterAxisValues({
    values: [0, 2, 100, 102, 200, 201],
    tolerance: 18
  });
  assert.equal(clusters.length, 3, "Should produce 3 clusters from 3 groups");
});

test("toNearestClusterIndex returns correct cluster for value", () => {
  const clusters = [0, 100, 200];
  assert.equal(toNearestClusterIndex({ value: 5, clusters }), 0);
  assert.equal(toNearestClusterIndex({ value: 95, clusters }), 1);
  assert.equal(toNearestClusterIndex({ value: 195, clusters }), 2);
});

test("renderGrid generates CSS Grid output for spanning layouts", () => {
  // Each child has multiple sub-children so simplification doesn't promote them
  const screen: ScreenIR = {
    id: "screen-1",
    name: "GridScreen",
    layoutMode: "VERTICAL",
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "grid-1",
        name: "css-grid-container",
        nodeType: "FRAME",
        type: "grid",
        layoutMode: "NONE",
        gap: 16,
        children: [
          // Header spans both columns (width significantly exceeds avg column width)
          { id: "header", name: "Header", nodeType: "FRAME", type: "container", x: 0, y: 0, width: 400, height: 60,
            children: [
              { id: "t1a", name: "logo", nodeType: "FRAME", type: "image", x: 0, y: 0, width: 40, height: 40 },
              { id: "t1b", name: "title", nodeType: "TEXT", type: "text", text: "Dashboard", fontSize: 24, fontWeight: 700 }
            ]
          },
          // Left panel
          { id: "left", name: "Left Panel", nodeType: "FRAME", type: "container", x: 0, y: 70, width: 150, height: 200,
            children: [
              { id: "t2a", name: "nav-title", nodeType: "TEXT", type: "text", text: "Menu", fontSize: 16, fontWeight: 600 },
              { id: "t2b", name: "nav-item", nodeType: "TEXT", type: "text", text: "Home", fontSize: 14, fontWeight: 400 }
            ]
          },
          // Right content
          { id: "right", name: "Right Content", nodeType: "FRAME", type: "container", x: 160, y: 70, width: 240, height: 200,
            children: [
              { id: "t3a", name: "content-title", nodeType: "TEXT", type: "text", text: "Welcome", fontSize: 20, fontWeight: 600 },
              { id: "t3b", name: "content-body", nodeType: "TEXT", type: "text", text: "Content here", fontSize: 14, fontWeight: 400 }
            ]
          },
          // Footer spans both columns
          { id: "footer", name: "Footer", nodeType: "FRAME", type: "container", x: 0, y: 280, width: 400, height: 40,
            children: [
              { id: "t4a", name: "copyright", nodeType: "TEXT", type: "text", text: "2024 Company", fontSize: 12, fontWeight: 400 },
              { id: "t4b", name: "links", nodeType: "TEXT", type: "text", text: "Privacy | Terms", fontSize: 12, fontWeight: 400 }
            ]
          }
        ]
      }
    ]
  };

  const result = createDeterministicScreenFile(screen);
  assert.ok(result.content.includes('display: "grid"'), "Output should contain display: grid");
  assert.ok(result.content.includes("gridTemplateColumns"), "Output should contain gridTemplateColumns");
});

test("renderGrid falls back to MUI Grid for simple equal-column layouts", () => {
  const screen: ScreenIR = {
    id: "screen-2",
    name: "SimpleGridScreen",
    layoutMode: "VERTICAL",
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [
      {
        id: "grid-2",
        name: "mui-grid-container",
        nodeType: "FRAME",
        type: "grid",
        layoutMode: "HORIZONTAL",
        gap: 16,
        children: [
          { id: "c1", name: "Card 1", nodeType: "FRAME", type: "card", width: 200, height: 150,
            children: [{ id: "t1", name: "title", nodeType: "TEXT", type: "text", text: "Card One" }]
          },
          { id: "c2", name: "Card 2", nodeType: "FRAME", type: "card", width: 200, height: 150,
            children: [{ id: "t2", name: "title", nodeType: "TEXT", type: "text", text: "Card Two" }]
          },
          { id: "c3", name: "Card 3", nodeType: "FRAME", type: "card", width: 200, height: 150,
            children: [{ id: "t3", name: "title", nodeType: "TEXT", type: "text", text: "Card Three" }]
          }
        ]
      }
    ]
  };

  const result = createDeterministicScreenFile(screen);
  // HORIZONTAL layout with equal widths → should NOT use CSS Grid
  assert.ok(!result.content.includes('display: "grid"'), "Simple grid should use MUI Grid, not CSS Grid");
});

// ---------------------------------------------------------------------------
// E2E tests with real Figma board
// ---------------------------------------------------------------------------

test("E2E: IR derivation from real Figma board generates valid grid classifications", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  assert.ok(ir.screens.length > 0, "Should derive at least one screen");

  // Collect all elements
  const allElements = ir.screens.flatMap((screen) => collectAllElements(screen.children));

  // Check that grid-classified elements exist
  const gridElements = allElements.filter((el) => el.type === "grid");

  // All elements should have valid types
  for (const element of allElements) {
    assert.ok(typeof element.type === "string" && element.type.length > 0, `Element ${element.id} has a valid type`);
  }

  // If grid elements exist, verify they have children
  for (const gridEl of gridElements) {
    assert.ok(
      Array.isArray(gridEl.children) && gridEl.children.length > 0,
      `Grid element ${gridEl.id} (${gridEl.name}) should have children`
    );
  }
});

test("E2E: CSS Grid detection produces valid metadata for grid elements", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  const allElements = ir.screens.flatMap((screen) => collectAllElements(screen.children));
  const gridElements = allElements.filter((el) => el.type === "grid");

  for (const gridEl of gridElements) {
    const cssGridResult = detectCssGridLayout(gridEl);
    // cssGridResult may be null (not all grids need CSS Grid)
    if (cssGridResult !== null) {
      assert.equal(cssGridResult.mode, "css-grid", `CSS Grid detection mode should be "css-grid"`);
      assert.ok(cssGridResult.columnCount >= 2, `CSS Grid should have at least 2 columns`);
      assert.ok(
        Array.isArray(cssGridResult.gridTemplateColumns) && cssGridResult.gridTemplateColumns.length > 0,
        "gridTemplateColumns should be a non-empty array"
      );
      assert.ok(
        Array.isArray(cssGridResult.gridTemplateRows) && cssGridResult.gridTemplateRows.length > 0,
        "gridTemplateRows should be a non-empty array"
      );
      // Verify all template values are valid CSS grid track sizes
      for (const col of cssGridResult.gridTemplateColumns) {
        assert.match(col, /^\d+fr$|^auto$|^\d+px$/, `Column template "${col}" should be a valid CSS grid track size`);
      }
      for (const row of cssGridResult.gridTemplateRows) {
        assert.match(row, /^\d+fr$|^auto$|^\d+px$/, `Row template "${row}" should be a valid CSS grid track size`);
      }
    }
  }
});

test("E2E: generated screen files contain valid JSX with CSS Grid when applicable", { skip: skipReason }, async () => {
  const figmaFile = await fetchFigmaFileOnce();
  const ir = figmaToDesignIrWithOptions(figmaFile);

  for (const screen of ir.screens) {
    const generated = createDeterministicScreenFile(screen);
    assert.ok(generated.path.endsWith(".tsx"), `Generated file ${generated.path} should be a TSX file`);
    assert.ok(generated.content.length > 0, `Generated file ${generated.path} should have content`);

    // Verify the generated code is syntactically valid
    // Basic checks: balanced braces, no broken JSX
    const openBraces = (generated.content.match(/{/g) ?? []).length;
    const closeBraces = (generated.content.match(/}/g) ?? []).length;
    assert.equal(openBraces, closeBraces, `Balanced braces in ${generated.path}`);

    // If CSS Grid is used, verify the required properties
    if (generated.content.includes('display: "grid"')) {
      assert.ok(
        generated.content.includes("gridTemplateColumns"),
        `${generated.path}: CSS Grid output must include gridTemplateColumns`
      );
    }
  }
});
