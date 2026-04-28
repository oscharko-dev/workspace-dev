import assert from "node:assert/strict";
import test from "node:test";
import { applyIrOverrides } from "./ir-overrides.js";
import type {
  DesignIR,
  ScreenElementIR,
  ScreenIR,
  TextElementIR,
} from "../parity/types-ir.js";

const createTestElement = (
  overrides: Partial<ScreenElementIR> & { id: string; name: string },
): ScreenElementIR =>
  ({
    type: "container",
    nodeType: "FRAME",
    ...overrides,
  }) as ScreenElementIR;

const createTextElement = (
  overrides: Partial<TextElementIR> & {
    id: string;
    name: string;
    text: string;
  },
): TextElementIR => ({
  id: overrides.id,
  name: overrides.name,
  type: "text",
  nodeType: "TEXT",
  text: overrides.text,
  ...overrides,
});

const createTestScreen = (
  overrides: Partial<ScreenIR> & { id: string; name: string },
): ScreenIR => ({
  layoutMode: "VERTICAL",
  gap: 8,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [],
  ...overrides,
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
        focus: "#1976d21f",
      },
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
      overline: { fontSizePx: 12, fontWeight: 400, lineHeightPx: 32 },
    },
  },
});

test("applyIrOverrides returns original IR when no overrides provided", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Box" })],
    }),
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
      children: [
        createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "e1", field: "fillColor", value: "#00ff00" }],
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
          gap: 8,
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "opacity", value: 0.5 },
      { nodeId: "e1", field: "fontSize", value: 18 },
      { nodeId: "e1", field: "cornerRadius", value: 12 },
      { nodeId: "e1", field: "fontWeight", value: 700 },
      { nodeId: "e1", field: "gap", value: 16 },
    ],
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
      children: [
        createTestElement({ id: "e1", name: "Text", fontFamily: "Roboto" }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "e1", field: "fontFamily", value: "Inter" }],
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.children[0]?.fontFamily, "Inter");
});

test("applyIrOverrides applies supported layout and dimension overrides to container elements", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "e1",
          name: "Stack",
          width: 360,
          height: 240,
          layoutMode: "VERTICAL",
          primaryAxisAlignItems: "MIN",
          counterAxisAlignItems: "CENTER",
          children: [createTestElement({ id: "e1-child", name: "Child" })],
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "width", value: 420 },
      { nodeId: "e1", field: "height", value: 300 },
      { nodeId: "e1", field: "layoutMode", value: "HORIZONTAL" },
      { nodeId: "e1", field: "primaryAxisAlignItems", value: "SPACE_BETWEEN" },
      { nodeId: "e1", field: "counterAxisAlignItems", value: "MAX" },
    ],
  });

  assert.equal(result.appliedCount, 5);
  const element = result.ir.screens[0]?.children[0] as
    | ScreenElementIR
    | undefined;
  assert.equal(element?.width, 420);
  assert.equal(element?.height, 300);
  assert.equal(element?.layoutMode, "HORIZONTAL");
  assert.equal(element?.primaryAxisAlignItems, "SPACE_BETWEEN");
  assert.equal(element?.counterAxisAlignItems, "MAX");
});

test("applyIrOverrides clears alignment fields after layoutMode NONE and skips incompatible layout overrides", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "container-1",
          name: "Container",
          layoutMode: "VERTICAL",
          primaryAxisAlignItems: "CENTER",
          counterAxisAlignItems: "MAX",
          children: [createTestElement({ id: "child-1", name: "Child" })],
        }),
        {
          id: "text-1",
          name: "Heading",
          type: "text",
          nodeType: "TEXT",
          width: 240,
          height: 40,
          text: "Welcome",
        } as ScreenElementIR,
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "container-1", field: "layoutMode", value: "NONE" },
      {
        nodeId: "container-1",
        field: "primaryAxisAlignItems",
        value: "SPACE_BETWEEN",
      },
      { nodeId: "text-1", field: "width", value: 320 },
    ],
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 2);
  const container = result.ir.screens[0]?.children[0] as
    | ScreenElementIR
    | undefined;
  assert.equal(container?.layoutMode, "NONE");
  assert.equal(container?.primaryAxisAlignItems, undefined);
  assert.equal(container?.counterAxisAlignItems, undefined);
  const text = result.ir.screens[0]?.children[1] as ScreenElementIR | undefined;
  assert.equal(text?.width, 240);
});

test("applyIrOverrides applies padding override to element", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "e1",
          name: "Box",
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      {
        nodeId: "e1",
        field: "padding",
        value: { top: 16, right: 24, bottom: 16, left: 24 },
      },
    ],
  });

  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.ir.screens[0]?.children[0]?.padding, {
    top: 16,
    right: 24,
    bottom: 16,
    left: 24,
  });
});

test("applyIrOverrides applies form validation overrides", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Input" })],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "required", value: true },
      { nodeId: "e1", field: "validationType", value: "email" },
      { nodeId: "e1", field: "validationMessage", value: "Please enter email" },
    ],
  });

  assert.equal(result.appliedCount, 3);
  const element = result.ir.screens[0]?.children[0] as unknown as Record<
    string,
    unknown
  >;
  assert.equal(element.required, true);
  assert.equal(element.validationType, "email");
  assert.equal(element.validationMessage, "Please enter email");
});

test("applyIrOverrides applies screen-level fillColor override", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1", fillColor: "#ffffff" }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "s1", field: "fillColor", value: "#000000" }],
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.fillColor, "#000000");
});

test("applyIrOverrides applies screen-level gap override", () => {
  const ir = createTestIr([
    createTestScreen({ id: "s1", name: "Screen 1", gap: 8 }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "s1", field: "gap", value: 24 }],
  });

  assert.equal(result.appliedCount, 1);
  assert.equal(result.ir.screens[0]?.gap, 24);
});

test("applyIrOverrides applies screen-level padding override", () => {
  const ir = createTestIr([createTestScreen({ id: "s1", name: "Screen 1" })]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      {
        nodeId: "s1",
        field: "padding",
        value: { top: 32, right: 32, bottom: 32, left: 32 },
      },
    ],
  });

  assert.equal(result.appliedCount, 1);
  assert.deepEqual(result.ir.screens[0]?.padding, {
    top: 32,
    right: 32,
    bottom: 32,
    left: 32,
  });
});

test("applyIrOverrides skips override when node not found", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [createTestElement({ id: "e1", name: "Box" })],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "nonexistent", field: "fillColor", value: "#ff0000" },
    ],
  });

  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 1);
});

test("applyIrOverrides skips invalid override payloads defensively", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "e1",
          name: "Box",
          width: 200,
          children: [createTestElement({ id: "c1", name: "Child" })],
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "layoutMode", value: "row" },
      { nodeId: "e1", field: "unknownField", value: "x" },
    ],
  });

  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 2);
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
                createTestElement({
                  id: "deep",
                  name: "Deep",
                  fillColor: "#aaaaaa",
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "deep", field: "fillColor", value: "#bbbbbb" }],
  });

  assert.equal(result.appliedCount, 1);
  const deep = result.ir.screens[0]?.children[0]?.children?.[0]?.children?.[0];
  assert.equal(deep?.fillColor, "#bbbbbb");
});

test("applyIrOverrides clones text elements and nested children without mutating the source tree", () => {
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      children: [
        createTestElement({
          id: "parent",
          name: "Parent",
          children: [
            createTextElement({
              id: "text-1",
              name: "Headline",
              text: "Welcome",
              fontFamily: "Roboto",
            }),
            createTestElement({
              id: "nested-container",
              name: "Nested container",
              children: [
                createTestElement({
                  id: "deep-child",
                  name: "Deep child",
                  fillColor: "#111111",
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "text-1", field: "fontFamily", value: "Inter" },
      { nodeId: "deep-child", field: "fillColor", value: "#222222" },
    ],
  });

  const originalParent = ir.screens[0]?.children[0];
  const clonedParent = result.ir.screens[0]?.children[0];
  const originalText = originalParent?.children?.[0];
  const clonedText = clonedParent?.children?.[0];
  const originalDeepChild = originalParent?.children?.[1]?.children?.[0];
  const clonedDeepChild = clonedParent?.children?.[1]?.children?.[0];

  assert.notEqual(clonedParent, originalParent);
  assert.notEqual(clonedText, originalText);
  assert.notEqual(clonedDeepChild, originalDeepChild);
  assert.equal(clonedText?.type, "text");
  assert.equal(clonedText?.text, "Welcome");
  assert.equal(clonedText?.fontFamily, "Inter");
  assert.equal(originalText?.fontFamily, "Roboto");
  assert.equal(clonedDeepChild?.fillColor, "#222222");
  assert.equal(originalDeepChild?.fillColor, "#111111");
});

test("applyIrOverrides does not mutate source IR", () => {
  const originalPadding = { top: 8, right: 8, bottom: 8, left: 8 };
  const ir = createTestIr([
    createTestScreen({
      id: "s1",
      name: "Screen 1",
      padding: { ...originalPadding },
      children: [
        createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" }),
      ],
    }),
  ]);

  applyIrOverrides({
    ir,
    overrides: [
      {
        nodeId: "s1",
        field: "padding",
        value: { top: 99, right: 99, bottom: 99, left: 99 },
      },
      { nodeId: "e1", field: "fillColor", value: "#00ff00" },
    ],
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
      children: [
        createTestElement({ id: "e1", name: "Box", fillColor: "#ff0000" }),
      ],
    }),
  ]);

  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "e1", field: "fillColor", value: "#00ff00" },
      { nodeId: "missing", field: "opacity", value: 0.5 },
      { nodeId: "e1", field: "fontSize", value: 20 },
    ],
  });

  assert.equal(result.appliedCount, 2);
  assert.equal(result.skippedCount, 1);
});

function buildLargeIr(nodeCount: number, branching = 10): DesignIR {
  let remaining = nodeCount;
  let counter = 0;
  const nextId = () => `node-${counter++}`;

  const build = (): ScreenElementIR | undefined => {
    if (remaining <= 0) return undefined;
    remaining -= 1;
    const id = nextId();
    const children: ScreenElementIR[] = [];
    if (remaining > 0 && counter % 3 !== 0) {
      const childCount = Math.min(branching, remaining);
      for (let i = 0; i < childCount; i++) {
        const child = build();
        if (child) children.push(child);
      }
    }
    return createTestElement({
      id,
      name: id,
      fillColor: "#000000",
      children: children.length > 0 ? children : undefined,
    });
  };

  const rootChildren: ScreenElementIR[] = [];
  while (remaining > 0) {
    const child = build();
    if (child) rootChildren.push(child);
  }

  return createTestIr([
    createTestScreen({ id: "s1", name: "Large", children: rootChildren }),
  ]);
}

function collectAllIds(ir: DesignIR): string[] {
  const ids: string[] = [];
  const walk = (elements: readonly ScreenElementIR[]) => {
    for (const el of elements) {
      ids.push(el.id);
      if (el.children?.length) walk(el.children);
    }
  };
  for (const screen of ir.screens) walk(screen.children);
  return ids;
}

test("applyIrOverrides handles 1000+ nodes with 50+ overrides correctly (O(n+m) lookup map)", () => {
  const ir = buildLargeIr(1500);
  const allIds = collectAllIds(ir);
  assert.ok(
    allIds.length >= 1000,
    `expected >=1000 nodes, got ${allIds.length}`,
  );

  const step = Math.floor(allIds.length / 60);
  const targetIds = Array.from(
    { length: 60 },
    (_, i) => allIds[i * step] ?? allIds[allIds.length - 1],
  );
  const overrides = targetIds.map((nodeId) => ({
    nodeId,
    field: "fillColor" as const,
    value: "#abcdef",
  }));

  const result = applyIrOverrides({ ir, overrides });

  assert.equal(result.appliedCount, overrides.length);
  assert.equal(result.skippedCount, 0);

  const resultIds = new Set(collectAllIds(result.ir));
  for (const id of targetIds) {
    assert.ok(resultIds.has(id));
  }
});

test("applyIrOverrides scales sub-quadratically in (nodes + overrides)", () => {
  const measure = (nodeCount: number, overrideCount: number): number => {
    const ir = buildLargeIr(nodeCount);
    const allIds = collectAllIds(ir);
    const step = Math.max(1, Math.floor(allIds.length / overrideCount));
    const overrides = Array.from({ length: overrideCount }, (_, i) => ({
      nodeId: allIds[Math.min(i * step, allIds.length - 1)] as string,
      field: "fillColor" as const,
      value: "#112233",
    }));

    // Warm up JIT
    for (let i = 0; i < 3; i++) applyIrOverrides({ ir, overrides });

    const start = process.hrtime.bigint();
    const iterations = 5;
    for (let i = 0; i < iterations; i++) {
      applyIrOverrides({ ir, overrides });
    }
    const end = process.hrtime.bigint();
    return Number(end - start) / iterations;
  };

  const smallNs = measure(500, 50);
  const largeNs = measure(2000, 200);

  // Scaling both n and m by 4x: O(n+m) predicts ~4x; O(n*m) predicts ~16x.
  // Assert ratio < 12 to catch the old quadratic behavior while tolerating
  // clone/GC noise on CI machines.
  const ratio = largeNs / Math.max(smallNs, 1);
  assert.ok(
    ratio < 12,
    `expected sub-quadratic scaling (ratio < 12), got ratio=${ratio.toFixed(2)} small=${smallNs}ns large=${largeNs}ns`,
  );
});
