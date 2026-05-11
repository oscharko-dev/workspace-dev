import { describe, expect, it } from "vitest";
import {
  deriveNodeDiagnosticsMap,
  getNodeDiagnostics,
  getNodeDiagnosticBadge,
  getPrimaryDiagnosticCategory,
  hasNodeDiagnostics,
  type DeriveNodeDiagnosticsInput,
  type NodeDiagnosticCategory
} from "./node-diagnostics";

function makeBaseInput(): DeriveNodeDiagnosticsInput {
  return {
    metricsNodeDiagnostics: [
      {
        nodeId: "node-hidden-1",
        category: "hidden",
        reason: "Node is marked as not visible in the design source."
      },
      {
        nodeId: "node-placeholder-1",
        category: "placeholder",
        reason: "Technical placeholder node skipped inside component instance."
      },
      {
        nodeId: "screen-home",
        category: "truncated",
        reason: "Screen exceeded element budget (800). 12 element(s) dropped.",
        screenId: "screen-home"
      },
      {
        nodeId: "node-fallback-1",
        category: "classification-fallback",
        reason: "Element type classification used fallback rule for Figma node type 'GROUP'.",
        screenId: "screen-home"
      }
    ],
    designIrStatus: "ready",
    designIrScreens: [
      {
        id: "screen-home",
        children: [
          { id: "node-header", children: [] },
          { id: "node-content", children: [{ id: "node-content-body", children: [] }] }
        ]
      }
    ],
    manifestStatus: "ready",
    manifest: {
      screens: [
        {
          screenId: "screen-home",
          components: [{ irNodeId: "node-header" }]
        }
      ]
    }
  };
}

describe("deriveNodeDiagnosticsMap", () => {
  it("builds a map from runtime node diagnostics", () => {
    const map = deriveNodeDiagnosticsMap(makeBaseInput());

    expect(map.size).toBeGreaterThan(0);
    expect(getNodeDiagnostics(map, "node-hidden-1")).toEqual([
      {
        nodeId: "node-hidden-1",
        category: "hidden",
        reason: "Node is marked as not visible in the design source."
      }
    ]);
    expect(getNodeDiagnostics(map, "node-placeholder-1")).toHaveLength(1);
    expect(getNodeDiagnostics(map, "screen-home")[0]?.category).toBe("truncated");
  });

  it("derives unmapped diagnostics from IR vs manifest cross-reference", () => {
    const map = deriveNodeDiagnosticsMap(makeBaseInput());

    // node-content and node-content-body are in IR but not in manifest
    expect(hasNodeDiagnostics(map, "node-content")).toBe(true);
    expect(getNodeDiagnostics(map, "node-content")[0]?.category).toBe("unmapped");

    expect(hasNodeDiagnostics(map, "node-content-body")).toBe(true);
    expect(getNodeDiagnostics(map, "node-content-body")[0]?.category).toBe("unmapped");

    // node-header IS in manifest, should not be unmapped
    const headerDiags = getNodeDiagnostics(map, "node-header");
    expect(headerDiags.every((d) => d.category !== "unmapped")).toBe(true);
  });

  it("does not add unmapped diagnostics if a node already has explicit diagnostics", () => {
    const input = makeBaseInput();
    // screen-home already has a "truncated" diagnostic
    const map = deriveNodeDiagnosticsMap(input);
    const homeDiags = getNodeDiagnostics(map, "screen-home");
    // Should NOT have both "truncated" AND "unmapped"
    expect(homeDiags.some((d) => d.category === "unmapped")).toBe(false);
  });

  it("handles null/empty diagnostics gracefully", () => {
    const map = deriveNodeDiagnosticsMap({
      ...makeBaseInput(),
      metricsNodeDiagnostics: null
    });

    // Should still have unmapped entries from IR vs manifest
    expect(map.size).toBeGreaterThan(0);
  });

  it("handles empty array diagnostics without errors", () => {
    const map = deriveNodeDiagnosticsMap({
      ...makeBaseInput(),
      metricsNodeDiagnostics: []
    });

    expect(map.size).toBeGreaterThan(0);
  });

  it("skips entries with invalid nodeId or category", () => {
    const map = deriveNodeDiagnosticsMap({
      ...makeBaseInput(),
      metricsNodeDiagnostics: [
        { nodeId: "", category: "hidden", reason: "test" },
        { nodeId: "valid", category: "invalid-cat", reason: "test" },
        { nodeId: 123, category: "hidden", reason: "test" },
        { category: "hidden", reason: "test" },
        null as unknown as { nodeId: string; category: string; reason: string }
      ]
    });

    expect(hasNodeDiagnostics(map, "")).toBe(false);
    expect(hasNodeDiagnostics(map, "valid")).toBe(false);
  });

  it("does not derive unmapped nodes when design IR or manifest is not ready", () => {
    const map = deriveNodeDiagnosticsMap({
      ...makeBaseInput(),
      metricsNodeDiagnostics: [],
      designIrStatus: "loading"
    });

    expect(map.size).toBe(0);
  });
});

describe("getNodeDiagnosticBadge", () => {
  it("returns correct badge config for each category", () => {
    const categories: NodeDiagnosticCategory[] = [
      "hidden",
      "placeholder",
      "truncated",
      "depth-truncated",
      "classification-fallback",
      "degraded-geometry",
      "unmapped"
    ];

    for (const category of categories) {
      const badge = getNodeDiagnosticBadge(category);
      expect(badge.abbr).toBeTruthy();
      expect(badge.color).toBeTruthy();
      expect(badge.label).toBeTruthy();
      expect(badge.title).toBeTruthy();
    }
  });
});

describe("getPrimaryDiagnosticCategory", () => {
  it("returns null for empty array", () => {
    expect(getPrimaryDiagnosticCategory([])).toBeNull();
  });

  it("returns the highest-priority category", () => {
    expect(
      getPrimaryDiagnosticCategory([
        { nodeId: "a", category: "unmapped", reason: "test" },
        { nodeId: "a", category: "hidden", reason: "test" }
      ])
    ).toBe("hidden");
  });

  it("returns truncated over placeholder", () => {
    expect(
      getPrimaryDiagnosticCategory([
        { nodeId: "a", category: "placeholder", reason: "test" },
        { nodeId: "a", category: "truncated", reason: "test" }
      ])
    ).toBe("truncated");
  });
});

describe("hasNodeDiagnostics", () => {
  it("returns false for non-existent node", () => {
    const map = deriveNodeDiagnosticsMap({
      ...makeBaseInput(),
      metricsNodeDiagnostics: []
    });
    expect(hasNodeDiagnostics(map, "non-existent")).toBe(false);
  });
});
