import { describe, expect, it } from "vitest";
import {
  buildCodeBoundaryLayout,
  resolveBoundaryColor,
  stableBoundaryHue,
  type CodeBoundaryEntry
} from "./code-boundaries";

describe("code-boundaries", () => {
  it("assigns deterministic hue and theme-aware colors per irNodeId", () => {
    const hueA1 = stableBoundaryHue("node-a");
    const hueA2 = stableBoundaryHue("node-a");
    const hueB = stableBoundaryHue("node-b");

    expect(hueA1).toBe(hueA2);
    expect(hueA1).toBeGreaterThanOrEqual(0);
    expect(hueA1).toBeLessThan(360);
    expect(hueB).toBeGreaterThanOrEqual(0);
    expect(hueB).toBeLessThan(360);

    const lightColor = resolveBoundaryColor({ irNodeId: "node-a", isDark: false });
    const darkColor = resolveBoundaryColor({ irNodeId: "node-a", isDark: true });

    expect(lightColor).toMatch(/^hsl\(/);
    expect(darkColor).toMatch(/^hsl\(/);
    expect(lightColor).not.toBe(darkColor);
  });

  it("assigns stable lanes and limits visible overlaps with overflow indicator", () => {
    const entries: CodeBoundaryEntry[] = [
      { irNodeId: "node-1", irNodeName: "Node 1", irNodeType: "container", startLine: 2, endLine: 6 },
      { irNodeId: "node-2", irNodeName: "Node 2", irNodeType: "text", startLine: 2, endLine: 6 },
      { irNodeId: "node-3", irNodeName: "Node 3", irNodeType: "button", startLine: 2, endLine: 6 },
      { irNodeId: "node-4", irNodeName: "Node 4", irNodeType: "image", startLine: 2, endLine: 6 }
    ];

    const layout = buildCodeBoundaryLayout({
      entries,
      totalLines: 10,
      isDark: false,
      maxVisibleLanes: 3
    });

    const lanes = layout.boundaries
      .slice()
      .sort((left, right) => left.entry.irNodeId.localeCompare(right.entry.irNodeId))
      .map((boundary) => boundary.lane);
    expect(lanes).toEqual([0, 1, 2, 3]);

    const lineThree = layout.byLine.get(3);
    expect(lineThree).toBeDefined();
    expect(lineThree?.visible).toHaveLength(3);
    expect(lineThree?.overflowCount).toBe(1);
  });

  it("clamps invalid ranges and ignores out-of-file entries", () => {
    const entries: CodeBoundaryEntry[] = [
      { irNodeId: "clamp-start", irNodeName: "Clamp Start", irNodeType: "container", startLine: -20, endLine: 2 },
      { irNodeId: "swap", irNodeName: "Swap", irNodeType: "text", startLine: 5, endLine: 3 },
      { irNodeId: "skip", irNodeName: "Skip", irNodeType: "button", startLine: 100, endLine: 120 }
    ];

    const layout = buildCodeBoundaryLayout({
      entries,
      totalLines: 6,
      isDark: true
    });

    expect(layout.boundaries.map((value) => value.entry.irNodeId).sort()).toEqual(["clamp-start", "swap"]);

    const firstLine = layout.byLine.get(1);
    expect(firstLine?.visible[0]?.entry.irNodeId).toBe("clamp-start");

    const thirdLine = layout.byLine.get(3);
    expect(thirdLine?.visible.map((value) => value.entry.irNodeId)).toContain("swap");
    expect(layout.byLine.has(6)).toBe(false);
  });
});
