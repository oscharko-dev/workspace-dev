import { describe, expect, it } from "vitest";
import { diffDesignIrTrees, type IrDiffTree } from "./inspector-ir-diff";

function tree(
  screens: { id: string; name: string; children: ChildSpec[] }[],
): IrDiffTree {
  return { screens };
}

interface ChildSpec {
  id: string;
  name?: string;
  type?: string;
  children?: ChildSpec[];
  [key: string]: unknown;
}

describe("diffDesignIrTrees", () => {
  it("flags new ids as added", () => {
    const a: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [
          { id: "1", name: "A" },
          { id: "2", name: "B" },
        ],
      },
    ]);
    const b: IrDiffTree = tree([
      { id: "s", name: "S", children: [{ id: "1", name: "A" }] },
    ]);
    const result = diffDesignIrTrees(a, b);
    expect(result.statusByNodeId.get("2")).toBe("added");
    expect(result.addedNodeIds).toEqual(["2"]);
  });

  it("flags missing ids as removed", () => {
    const a: IrDiffTree = tree([
      { id: "s", name: "S", children: [{ id: "1", name: "A" }] },
    ]);
    const b: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [
          { id: "1", name: "A" },
          { id: "9", name: "Z" },
        ],
      },
    ]);
    const result = diffDesignIrTrees(a, b);
    expect(result.statusByNodeId.get("9")).toBe("removed");
    expect(result.removedNodeIds).toEqual(["9"]);
  });

  it("flags property changes as modified, ignoring children differences", () => {
    const a: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [
          {
            id: "1",
            name: "Header",
            children: [{ id: "1.1", name: "Logo" }],
          },
        ],
      },
    ]);
    const b: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [{ id: "1", name: "HeaderOld", children: [] }],
      },
    ]);
    const result = diffDesignIrTrees(a, b);
    expect(result.statusByNodeId.get("1")).toBe("modified");
    expect(result.modifiedNodeIds).toContain("1");
  });

  it("treats deep-equal nodes as unchanged", () => {
    const a: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [{ id: "1", name: "A", type: "frame" }],
      },
    ]);
    const b: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [{ id: "1", name: "A", type: "frame" }],
      },
    ]);
    const result = diffDesignIrTrees(a, b);
    expect(result.statusByNodeId.get("1")).toBe("unchanged");
    expect(result.unchangedNodeIds).toContain("1");
  });

  it("handles empty trees on either side", () => {
    expect(diffDesignIrTrees(tree([]), tree([])).statusByNodeId.size).toBe(0);
    const result = diffDesignIrTrees(
      tree([{ id: "s", name: "S", children: [] }]),
      tree([]),
    );
    expect(result.statusByNodeId.get("s")).toBe("added");
  });

  it("ignores nodes with empty/non-string ids", () => {
    const a: IrDiffTree = {
      screens: [
        {
          id: "s",
          name: "S",
          children: [{ id: "" } as unknown as ChildSpec],
        },
      ],
    };
    expect(diffDesignIrTrees(a, tree([])).statusByNodeId.size).toBe(1);
  });

  it("detects added properties as a modification", () => {
    const a: IrDiffTree = tree([
      { id: "s", name: "S", children: [{ id: "1", name: "A" }] },
    ]);
    const b: IrDiffTree = tree([
      {
        id: "s",
        name: "S",
        children: [{ id: "1", name: "A", extra: 1 } as ChildSpec],
      },
    ]);
    const result = diffDesignIrTrees(a, b);
    expect(result.statusByNodeId.get("1")).toBe("modified");
  });
});
