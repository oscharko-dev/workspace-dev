import assert from "node:assert/strict";
import test from "node:test";
import { applyIrOverrides } from "./ir-overrides.js";
import type { DesignIR, ScreenElementIR, ScreenIR } from "../parity/types-ir.js";

const createTestElement = (overrides: Partial<ScreenElementIR> & { id: string; name: string }): ScreenElementIR => ({
  type: "container",
  nodeType: "FRAME",
  ...overrides
} as ScreenElementIR);

const createTestScreen = (overrides: Partial<ScreenIR> & { id: string; name: string }): ScreenIR => ({
  layoutMode: "VERTICAL",
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [],
  ...overrides
});

const createTestIr = (screens: ScreenIR[]): DesignIR => ({
  sourceName: "test",
  screens,
  tokens: {
    palette: {
      primary: "#1976d2",
      secondary: "#9c27b0",
      background: "#ffffff",
      text: "#000000",
      success: "#2e7d32",
      warning: "#ed6c02",
      error: "#d32f2f",
      info: "#0288d1",
      divider: "#e0e0e0",
      action: {
        active: "#1976d2",
        hover: "#1976d21a",
        selected: "#1976d214",
        disabled: "#00000042",
        disabledBackground: "#0000001f",
        focus: "#1976d21f"
      }
    },
    borderRadius: 4,
    spacingBase: 8,
    fontFamily: "Roboto",
    headingSize: 24,
    bodySize: 14,
    typography: {
      h1: { fontSizePx: 96, fontWeight: 300, lineHeightPx: 112 },
      h2: { fontSizePx: 60, fontWeight: 300, lineHeightPx: 72 },
      h3: { fontSizePx: 48, fontWeight: 400, lineHeightPx: 56 },
      h4: { fontSizePx: 34, fontWeight: 400, lineHeightPx: 42 },
      h5: { fontSizePx: 24, fontWeight: 400, lineHeightPx: 32 },
      h6: { fontSizePx: 20, fontWeight: 500, lineHeightPx: 32 },
      subtitle1: { fontSizePx: 16, fontWeight: 400, lineHeightPx: 28 },
      subtitle2: { fontSizePx: 14, fontWeight: 500, lineHeightPx: 22 },
      body1: { fontSizePx: 16, fontWeight: 400, lineHeightPx: 24 },
      body2: { fontSizePx: 14, fontWeight: 400, lineHeightPx: 20 },
      button: { fontSizePx: 14, fontWeight: 500, lineHeightPx: 24 },
      caption: { fontSizePx: 12, fontWeight: 400, lineHeightPx: 20 },
      overline: { fontSizePx: 12, fontWeight: 400, lineHeightPx: 32 }
    }
  }
});

test("applyIrOverrides returns original IR when no overrides provided", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1", children: [createTestElement({ id: "e1", name: "Box" })] })
  ]);

  const result = applyIrOverrides({ ir, overrides: [] });

  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.ir, ir);
});

test("applyIrOverrides applies fillColor override to matching element", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" })]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "e1", field: "fillColor", value: "#00ff00" }]
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.ir.screens[0]?.children[0]?.fillColor, "#00ff00");
  // Original unchanged
  assert.equal(ir.screens[0]?.children[0]?.fillColor, "#ff0000");
});

test("applyIrOverrides applies numeric overrides (opacity, fontSize, cornerRadius, fontWeight, gap)", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "e1",
          name: "Box",
          opacity: 1,
          fontSize: 14,
          cornerRadius: 4,
          fontWeight: 400,
          gap: 8
        })
      ]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "opacity", value: 0.5 },
      { nodeId: "e1", field: "fontSize", value: 18 },
      { nodeId: "e1", field: "cornerRadius", value: 12 },
      { nodeId: "e1", field: "fontWeight", value: 700 },
      { nodeId: "e1", field: "gap", value: 16 }
    ]
  });

  assert.equal(result.appliedCount, 5);
  const element = result.ir.screens[0]?.children[0];
  assert.equal(element?.opacity, 0.5);
  assert.equal(element?.fontSize, 18);
  assert.equal(element?.cornerRadius, 12);
  assert.equal(element?.fontWeight, 700);
  assert.equal(element?.gap, 16);
});

test("applyIrOverrides applies fontFamily override", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Text", fontFamily: "Roboto" })]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "e1", field: "fontFamily", value: "Inter" }]
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.children[0]?.fontFamily, "Inter");
});

test("applyIrOverrides applies padding override to element", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({ id: "e1", name: "Box", padding: { top: 8, right: 8, bottom: 8, left: 8 } })
      ]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "e1", field: "padding", value: { top: 16, right: 24, bottom: 16, left: 24 } }]
  });

  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.ir.screens[0]?.children[0]?.padding, { top: 16, right: 24, bottom: 16, left: 24 });
});

test("applyIrOverrides applies form validation overrides", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Input" })]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "required", value: true },
      { nodeId: "e1", field: "validationType", value: "email" },
      { nodeId: "e1", field: "validationMessage", value: "Please enter email" }
    ]
  });

  assert.equal(result.appliedCount, 3);
  const element = result.ir.screens[0]?.children[0] as unknown as Record<string, unknown>;
  assert.equal(element.required, true);
  assert.equal(element.validationType, "email");
  assert.equal(element.validationMessage, "Please enter email");
});

test("applyIrOverrides applies screen-level fillColor override", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1", fillColor: "#ffffff" })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "s1", field: "fillColor", value: "#000000" }]
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.fillColor, "#000000");
});

test("applyIrOverrides applies screen-level gap override", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1", gap: 8 })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "s1", field: "gap", value: 24 }]
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.gap, 24);
});

test("applyIrOverrides applies screen-level padding override", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1" })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "s1", field: "padding", value: { top: 32, right: 32, bottom: 32, left: 32 } }]
  });

  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.ir.screens[0]?.padding, { top: 32, right: 32, bottom: 32, left: 32 });
});

test("applyIrOverrides skips override when node not found", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Box" })]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "nonexistent", field: "fillColor", value: "#ff0000" }]
  });

  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 1);
});

test("applyIrOverrides finds deeply nested elements", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "parent",
          name: "Parent",
          children: [
            createTestElement({
              id: "child",
              name: "Child",
              children: [
                createTestElement({ id: "deep", name: "Deep", fillColor: "#aaaaaa" })
              ]
            })
          ]
        })
      ]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "deep", field: "fillColor", value: "#bbbbbb" }]
  });

  assert.equal(result.appliedCount, 1);
  const deep = result.ir.screens[0]?.children[0]?.children?.[0]?.children?.[0];
  assert.equal(deep?.fillColor, "#bbbbbb");
});

test("applyIrOverrides does not mutate source IR", () => {
  const originalPadding = { top: 8, right: 8, bottom: 8, left: 8 };
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      padding: { ...originalPadding },
      children: [createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" })]
    })
  ]);

  applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "s1", field: "padding", value: { top: 99, right: 99, bottom: 99, left: 99 } },
      { nodeId: "e1", field: "fillColor", value: "#00ff00" }
    ]
  });

  // Source IR should remain unchanged
  assert.deepEqual(ir.screens[0]?.padding, originalPadding);
  assert.equal(ir.screens[0]?.children[0]?.fillColor, "#ff0000");
});

test("applyIrOverrides handles mixed applied and skipped overrides", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" })]
    })
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "fillColor", value: "#00ff00" },
      { nodeId: "missing", field: "opacity", value: 0.5 },
      { nodeId: "e1", field: "fontSize", value: 20 }
    ]
  });

  assert.equal(result.appliedCount, 2);
  assert.equal(result.skippedCount, 1);
});
