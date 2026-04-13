import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapFigmaNodeTypeToIrElementType,
  transformNodeToScreenElement,
  transformDesignContextToScreens,
  transformDesignContextToDesignIr,
} from "./ir-design-context.js";
import type { ScreenElementIR, ScreenIR } from "./types.js";

// ---------------------------------------------------------------------------
// mapFigmaNodeTypeToIrElementType
// ---------------------------------------------------------------------------

describe("mapFigmaNodeTypeToIrElementType", () => {
  it("maps FRAME with auto-layout to container", () => {
    assert.equal(
      mapFigmaNodeTypeToIrElementType("FRAME", "VERTICAL"),
      "container",
    );
    assert.equal(
      mapFigmaNodeTypeToIrElementType("FRAME", "HORIZONTAL"),
      "container",
    );
  });

  it("maps FRAME without auto-layout to frame", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("FRAME", "NONE"), "frame");
    assert.equal(mapFigmaNodeTypeToIrElementType("FRAME", undefined), "frame");
  });

  it("maps COMPONENT to component", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("COMPONENT"), "component");
  });

  it("maps INSTANCE to instance", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("INSTANCE"), "instance");
  });

  it("maps TEXT to text", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("TEXT"), "text");
  });

  it("maps RECTANGLE to shape", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("RECTANGLE"), "shape");
  });

  it("maps VECTOR to vector", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("VECTOR"), "vector");
  });

  it("maps ELLIPSE to vector", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("ELLIPSE"), "vector");
  });

  it("maps STAR to vector", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("STAR"), "vector");
  });

  it("maps LINE to vector", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("LINE"), "vector");
  });

  it("maps BOOLEAN_OPERATION to vector", () => {
    assert.equal(
      mapFigmaNodeTypeToIrElementType("BOOLEAN_OPERATION"),
      "vector",
    );
  });

  it("maps GROUP to group", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("GROUP"), "group");
  });

  it("maps SECTION to section", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("SECTION"), "section");
  });

  it("maps COMPONENT_SET to componentSet", () => {
    assert.equal(
      mapFigmaNodeTypeToIrElementType("COMPONENT_SET"),
      "componentSet",
    );
  });

  it("maps unknown type to container", () => {
    assert.equal(mapFigmaNodeTypeToIrElementType("CANVAS"), "container");
    assert.equal(mapFigmaNodeTypeToIrElementType("UNKNOWN_THING"), "container");
  });
});

// ---------------------------------------------------------------------------
// transformNodeToScreenElement
// ---------------------------------------------------------------------------

describe("transformNodeToScreenElement", () => {
  it("transforms a TEXT node and extracts characters", () => {
    const node = {
      id: "10:1",
      name: "Title",
      type: "TEXT",
      characters: "Hello World",
      style: {
        fontSize: 24,
        fontWeight: 700,
        fontFamily: "Inter",
        lineHeightPx: 32,
        letterSpacing: 0.5,
        textAlignHorizontal: "CENTER" as const,
      },
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.type, "text");
    assert.equal(element.id, "10:1");
    assert.equal(element.name, "Title");
    assert.equal(element.nodeType, "TEXT");
    assert.equal(element.semanticSource, "board");
    if (element.type === "text") {
      assert.equal(element.text, "Hello World");
    }
    assert.equal(element.fontSize, 24);
    assert.equal(element.fontWeight, 700);
    assert.equal(element.fontFamily, "Inter");
    assert.equal(element.lineHeight, 32);
    assert.equal(element.letterSpacing, 0.5);
    assert.equal(element.textAlign, "CENTER");
  });

  it("transforms a FRAME with auto-layout as container", () => {
    const node = {
      id: "20:1",
      name: "Card",
      type: "FRAME",
      layoutMode: "VERTICAL" as const,
      itemSpacing: 16,
      paddingTop: 12,
      paddingRight: 16,
      paddingBottom: 12,
      paddingLeft: 16,
      primaryAxisAlignItems: "CENTER" as const,
      counterAxisAlignItems: "MIN" as const,
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 400 },
      children: [],
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.type, "container");
    assert.equal(element.layoutMode, "VERTICAL");
    assert.equal(element.gap, 16);
    assert.deepEqual(element.padding, {
      top: 12,
      right: 16,
      bottom: 12,
      left: 16,
    });
    assert.equal(element.primaryAxisAlignItems, "CENTER");
    assert.equal(element.counterAxisAlignItems, "MIN");
    assert.equal(element.width, 300);
    assert.equal(element.height, 400);
  });

  it("transforms a FRAME without auto-layout as frame", () => {
    const node = {
      id: "20:2",
      name: "Canvas",
      type: "FRAME",
      children: [],
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.type, "frame");
  });

  it("extracts fill color from first visible solid paint", () => {
    const node = {
      id: "30:1",
      name: "Box",
      type: "RECTANGLE",
      fills: [
        { type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0 } },
        { type: "SOLID", visible: true, color: { r: 0, g: 0.5, b: 1 } },
      ],
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.type, "shape");
    assert.ok(typeof element.fillColor === "string");
    assert.ok(element.fillColor!.startsWith("#"));
  });

  it("extracts stroke color and width", () => {
    const node = {
      id: "30:2",
      name: "Bordered",
      type: "RECTANGLE",
      strokes: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 2,
    };
    const element = transformNodeToScreenElement(node);
    assert.ok(typeof element.strokeColor === "string");
    assert.equal(element.strokeWidth, 2);
  });

  it("extracts corner radius and opacity", () => {
    const node = {
      id: "30:3",
      name: "Rounded",
      type: "RECTANGLE",
      cornerRadius: 8,
      opacity: 0.75,
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.cornerRadius, 8);
    assert.equal(element.opacity, 0.75);
  });

  it("recursively transforms children", () => {
    const node = {
      id: "40:1",
      name: "Parent",
      type: "FRAME",
      layoutMode: "VERTICAL" as const,
      children: [
        { id: "40:2", name: "Child1", type: "TEXT", characters: "A" },
        {
          id: "40:3",
          name: "Child2",
          type: "FRAME",
          layoutMode: "HORIZONTAL" as const,
          children: [
            { id: "40:4", name: "GrandChild", type: "TEXT", characters: "B" },
          ],
        },
      ],
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.children?.length, 2);
    const first = element.children![0]!;
    assert.equal(first.type, "text");
    assert.equal(first.id, "40:2");
    const second = element.children![1]!;
    assert.equal(second.type, "container");
    assert.equal(second.children?.length, 1);
    assert.equal(second.children![0]!.id, "40:4");
  });

  it("handles missing children gracefully", () => {
    const node = {
      id: "50:1",
      name: "Leaf",
      type: "RECTANGLE",
    };
    const element = transformNodeToScreenElement(node);
    assert.ok(element.children === undefined || element.children.length === 0);
  });

  it("handles empty children array", () => {
    const node = {
      id: "50:2",
      name: "Empty",
      type: "FRAME",
      children: [],
    };
    const element = transformNodeToScreenElement(node);
    assert.ok(element.children === undefined || element.children.length === 0);
  });

  it("uses size fallback when absoluteBoundingBox is absent", () => {
    const node = {
      id: "60:1",
      name: "Sized",
      type: "FRAME",
      size: { x: 200, y: 150 },
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.width, 200);
    assert.equal(element.height, 150);
  });

  it("handles non-object document input gracefully", () => {
    const element = transformNodeToScreenElement(null);
    assert.equal(element.id, "unknown");
    assert.equal(element.type, "frame");

    const element2 = transformNodeToScreenElement("not an object");
    assert.equal(element2.id, "unknown");
  });

  it("handles TEXT node without style property", () => {
    const node = {
      id: "70:1",
      name: "Plain",
      type: "TEXT",
      characters: "No style",
    };
    const element = transformNodeToScreenElement(node);
    assert.equal(element.type, "text");
    if (element.type === "text") {
      assert.equal(element.text, "No style");
    }
    assert.equal(element.fontSize, undefined);
    assert.equal(element.fontWeight, undefined);
  });
});

// ---------------------------------------------------------------------------
// transformDesignContextToScreens
// ---------------------------------------------------------------------------

describe("transformDesignContextToScreens", () => {
  it("converts a single authoritative subtree to one ScreenIR", () => {
    const subtrees = [
      {
        nodeId: "1:1",
        document: {
          id: "1:1",
          name: "Login Screen",
          type: "FRAME",
          layoutMode: "VERTICAL",
          itemSpacing: 24,
          paddingTop: 32,
          paddingRight: 24,
          paddingBottom: 32,
          paddingLeft: 24,
          absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
          fills: [
            {
              type: "SOLID",
              visible: true,
              color: { r: 1, g: 1, b: 1 },
            },
          ],
          children: [
            { id: "1:2", name: "Title", type: "TEXT", characters: "Login" },
          ],
        },
      },
    ];
    const screens = transformDesignContextToScreens({
      authoritativeSubtrees: subtrees,
    });
    assert.equal(screens.length, 1);
    const screen = screens[0]!;
    assert.equal(screen.id, "1:1");
    assert.equal(screen.name, "Login Screen");
    assert.equal(screen.layoutMode, "VERTICAL");
    assert.equal(screen.gap, 24);
    assert.equal(screen.width, 390);
    assert.equal(screen.height, 844);
    assert.deepEqual(screen.padding, {
      top: 32,
      right: 24,
      bottom: 32,
      left: 24,
    });
    assert.equal(screen.children.length, 1);
    assert.equal(screen.children[0]!.type, "text");
  });

  it("converts multi-selection to multiple ScreenIR entries", () => {
    const subtrees = [
      {
        nodeId: "1:1",
        document: {
          id: "1:1",
          name: "Screen A",
          type: "FRAME",
          children: [],
        },
      },
      {
        nodeId: "2:1",
        document: {
          id: "2:1",
          name: "Screen B",
          type: "FRAME",
          children: [],
        },
      },
    ];
    const screens = transformDesignContextToScreens({
      authoritativeSubtrees: subtrees,
    });
    assert.equal(screens.length, 2);
    assert.equal(screens[0]!.id, "1:1");
    assert.equal(screens[1]!.id, "2:1");
  });

  it("extracts screen fill color", () => {
    const subtrees = [
      {
        nodeId: "5:1",
        document: {
          id: "5:1",
          name: "Colored",
          type: "FRAME",
          fills: [
            {
              type: "SOLID",
              visible: true,
              color: { r: 0.96, g: 0.96, b: 0.96 },
            },
          ],
          children: [],
        },
      },
    ];
    const screens = transformDesignContextToScreens({
      authoritativeSubtrees: subtrees,
    });
    assert.ok(typeof screens[0]!.fillColor === "string");
  });

  it("handles empty subtree list", () => {
    const screens = transformDesignContextToScreens({
      authoritativeSubtrees: [],
    });
    assert.equal(screens.length, 0);
  });

  it("defaults layout to NONE when layoutMode is absent", () => {
    const subtrees = [
      {
        nodeId: "7:1",
        document: {
          id: "7:1",
          name: "Flat",
          type: "FRAME",
          children: [],
        },
      },
    ];
    const screens = transformDesignContextToScreens({
      authoritativeSubtrees: subtrees,
    });
    assert.equal(screens[0]!.layoutMode, "NONE");
  });
});

// ---------------------------------------------------------------------------
// transformDesignContextToDesignIr
// ---------------------------------------------------------------------------

describe("transformDesignContextToDesignIr", () => {
  it("produces a valid DesignIR with screens, tokens, and metrics", () => {
    const result = transformDesignContextToDesignIr({
      authoritativeSubtrees: [
        {
          nodeId: "1:1",
          document: {
            id: "1:1",
            name: "Home",
            type: "FRAME",
            layoutMode: "VERTICAL",
            children: [
              {
                id: "1:2",
                name: "Header",
                type: "TEXT",
                characters: "Welcome",
              },
              {
                id: "1:3",
                name: "Body",
                type: "FRAME",
                layoutMode: "VERTICAL",
                children: [
                  {
                    id: "1:4",
                    name: "Paragraph",
                    type: "TEXT",
                    characters: "Content",
                  },
                ],
              },
            ],
          },
        },
      ],
      sourceName: "Test File",
    });

    assert.equal(result.sourceName, "Test File");
    assert.equal(result.screens.length, 1);
    assert.ok(result.tokens);
    assert.ok(result.metrics);
    assert.equal(result.metrics!.screenElementCounts.length, 1);
    assert.equal(result.metrics!.screenElementCounts[0]!.elements, 3);
    assert.equal(result.metrics!.screenElementCounts[0]!.screenId, "1:1");
  });

  it("uses default sourceName when not provided", () => {
    const result = transformDesignContextToDesignIr({
      authoritativeSubtrees: [
        {
          nodeId: "1:1",
          document: {
            id: "1:1",
            name: "S",
            type: "FRAME",
            children: [],
          },
        },
      ],
    });
    assert.equal(result.sourceName, "Figma Design Context");
  });

  it("counts elements recursively in metrics", () => {
    const result = transformDesignContextToDesignIr({
      authoritativeSubtrees: [
        {
          nodeId: "1:1",
          document: {
            id: "1:1",
            name: "Root",
            type: "FRAME",
            layoutMode: "VERTICAL",
            children: [
              {
                id: "1:2",
                name: "A",
                type: "FRAME",
                layoutMode: "HORIZONTAL",
                children: [
                  { id: "1:3", name: "B", type: "TEXT", characters: "x" },
                  { id: "1:4", name: "C", type: "TEXT", characters: "y" },
                ],
              },
            ],
          },
        },
      ],
    });
    assert.equal(result.metrics!.screenElementCounts[0]!.elements, 3);
  });
});
