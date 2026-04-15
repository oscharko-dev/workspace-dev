/**
 * Unit tests for the tri-state Inspector node selection model.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/1010
 */
import { describe, expect, it } from "vitest";
import {
  createSelectionWithAllSelected,
  deselectAll,
  EMPTY_SELECTION,
  getNodeCheckState,
  getSelectedNodeIds,
  getSelectedScreens,
  getSelectionCounts,
  isAllSelected,
  isNoneSelected,
  selectAll,
  selectAllScreens,
  selectChangedNodes,
  selectOnlyNode,
  selectSubtree,
  toggleNode,
} from "./node-selection-state";
import type { TreeNode } from "./component-tree";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * HomePage (id="1")
 *   Header (id="2")
 *     Logo (id="3")
 *     Navigation (id="4")
 *   HeroSection (id="5")
 *   FeaturesGrid (id="6")
 *     Card1 (id="7")
 *     Card2 (id="8")
 */
function makeFixtureScreens(): TreeNode[] {
  return [
    {
      id: "1",
      name: "HomePage",
      type: "screen",
      children: [
        {
          id: "2",
          name: "Header",
          type: "container",
          children: [
            { id: "3", name: "Logo", type: "image" },
            { id: "4", name: "Navigation", type: "container" },
          ],
        },
        { id: "5", name: "HeroSection", type: "container" },
        {
          id: "6",
          name: "FeaturesGrid",
          type: "container",
          children: [
            { id: "7", name: "Card1", type: "container" },
            { id: "8", name: "Card2", type: "container" },
          ],
        },
      ],
    },
  ];
}

function findNode(screens: readonly TreeNode[], id: string): TreeNode {
  function walk(list: readonly TreeNode[]): TreeNode | null {
    for (const n of list) {
      if (n.id === id) return n;
      if (n.children) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  const node = walk(screens);
  if (!node) throw new Error(`fixture missing node ${id}`);
  return node;
}

// ---------------------------------------------------------------------------
// Defaults & factories
// ---------------------------------------------------------------------------

describe("default state", () => {
  it("EMPTY_SELECTION has no excluded ids", () => {
    expect(EMPTY_SELECTION.excluded.size).toBe(0);
  });

  it("createSelectionWithAllSelected returns the all-selected state", () => {
    const state = createSelectionWithAllSelected();
    expect(isAllSelected(state)).toBe(true);
  });

  it("getSelectionCounts returns {selected: total, total} when all selected", () => {
    const screens = makeFixtureScreens();
    const counts = getSelectionCounts(EMPTY_SELECTION, screens);
    expect(counts.selected).toBe(8);
    expect(counts.total).toBe(8);
  });

  it("every node is checked by default", () => {
    const screens = makeFixtureScreens();
    for (const id of ["1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(getNodeCheckState(EMPTY_SELECTION, findNode(screens, id))).toBe(
        "checked",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Toggle propagation
// ---------------------------------------------------------------------------

describe("toggleNode", () => {
  it("toggling off a parent excludes the parent and all descendants", () => {
    const screens = makeFixtureScreens();
    const header = findNode(screens, "2");
    const next = toggleNode(EMPTY_SELECTION, header, false);

    expect(next.excluded.has("2")).toBe(true);
    expect(next.excluded.has("3")).toBe(true);
    expect(next.excluded.has("4")).toBe(true);
    expect(next.excluded.has("1")).toBe(false);
    expect(next.excluded.has("5")).toBe(false);
  });

  it("toggling off Header makes the root partial", () => {
    const screens = makeFixtureScreens();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "2"), false);
    expect(getNodeCheckState(next, findNode(screens, "1"))).toBe("partial");
    expect(getNodeCheckState(next, findNode(screens, "2"))).toBe("unchecked");
  });

  it("toggling a leaf flips just that leaf", () => {
    const screens = makeFixtureScreens();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "3"), false);
    expect(next.excluded.has("3")).toBe(true);
    expect(next.excluded.has("4")).toBe(false);
    expect(next.excluded.has("2")).toBe(false);
  });

  it("leaf toggle off bubbles parent to partial, re-toggle restores checked", () => {
    const screens = makeFixtureScreens();
    const off = toggleNode(EMPTY_SELECTION, findNode(screens, "3"), false);
    expect(getNodeCheckState(off, findNode(screens, "2"))).toBe("partial");

    const back = toggleNode(off, findNode(screens, "3"), true);
    expect(getNodeCheckState(back, findNode(screens, "2"))).toBe("checked");
    expect(getNodeCheckState(back, findNode(screens, "1"))).toBe("checked");
  });

  it("toggling a parent back on re-includes all descendants", () => {
    const screens = makeFixtureScreens();
    const header = findNode(screens, "2");
    const off = toggleNode(EMPTY_SELECTION, header, false);
    const on = toggleNode(off, header, true);

    expect(on.excluded.has("2")).toBe(false);
    expect(on.excluded.has("3")).toBe(false);
    expect(on.excluded.has("4")).toBe(false);
    expect(getNodeCheckState(on, findNode(screens, "1"))).toBe("checked");
  });

  it("does not mutate the input state", () => {
    const screens = makeFixtureScreens();
    const before = EMPTY_SELECTION;
    const sizeBefore = before.excluded.size;
    toggleNode(before, findNode(screens, "2"), false);
    expect(before.excluded.size).toBe(sizeBefore);
  });
});

// ---------------------------------------------------------------------------
// isAllSelected / isNoneSelected
// ---------------------------------------------------------------------------

describe("isAllSelected / isNoneSelected", () => {
  it("isAllSelected on empty exclusion set", () => {
    expect(isAllSelected(EMPTY_SELECTION)).toBe(true);
  });

  it("isAllSelected false after a toggle off", () => {
    const screens = makeFixtureScreens();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "3"), false);
    expect(isAllSelected(next)).toBe(false);
  });

  it("isNoneSelected after deselectAll", () => {
    const screens = makeFixtureScreens();
    expect(isNoneSelected(deselectAll(screens), screens)).toBe(true);
  });

  it("isNoneSelected false on default state", () => {
    const screens = makeFixtureScreens();
    expect(isNoneSelected(EMPTY_SELECTION, screens)).toBe(false);
  });

  it("isNoneSelected false on empty tree", () => {
    expect(isNoneSelected(EMPTY_SELECTION, [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSelectedNodeIds depth-first ordering
// ---------------------------------------------------------------------------

describe("getSelectedNodeIds", () => {
  it("returns depth-first order for the full tree", () => {
    const screens = makeFixtureScreens();
    const ids = getSelectedNodeIds(EMPTY_SELECTION, screens);
    expect(ids).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });

  it("omits excluded ids while preserving order", () => {
    const screens = makeFixtureScreens();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "2"), false);
    const ids = getSelectedNodeIds(next, screens);
    expect(ids).toEqual(["1", "5", "6", "7", "8"]);
  });

  it("returns [] when nothing is selected", () => {
    const screens = makeFixtureScreens();
    expect(getSelectedNodeIds(deselectAll(screens), screens)).toEqual([]);
  });

  it("returns [] for an empty tree", () => {
    expect(getSelectedNodeIds(EMPTY_SELECTION, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getSelectedScreens
// ---------------------------------------------------------------------------

describe("getSelectedScreens", () => {
  it("includes screens with a fully-selected subtree", () => {
    const screens = makeFixtureScreens();
    expect(getSelectedScreens(EMPTY_SELECTION, screens)).toEqual(screens);
  });

  it("includes screens with a partially-selected subtree", () => {
    const screens = makeFixtureScreens();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "3"), false);
    expect(getSelectedScreens(next, screens).map((s) => s.id)).toEqual(["1"]);
  });

  it("returns [] after deselectAll", () => {
    const screens = makeFixtureScreens();
    expect(getSelectedScreens(deselectAll(screens), screens)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scope presets
// ---------------------------------------------------------------------------

describe("scope presets", () => {
  it("selectAll returns the EMPTY_SELECTION", () => {
    expect(selectAll()).toBe(EMPTY_SELECTION);
  });

  it("selectAllScreens returns the EMPTY_SELECTION", () => {
    expect(selectAllScreens()).toBe(EMPTY_SELECTION);
  });

  it("selectOnlyNode excludes everything outside the chosen subtree", () => {
    const screens = makeFixtureScreens();
    const state = selectOnlyNode(findNode(screens, "2"), screens);

    expect(getNodeCheckState(state, findNode(screens, "2"))).toBe("checked");
    expect(getNodeCheckState(state, findNode(screens, "3"))).toBe("checked");
    expect(getNodeCheckState(state, findNode(screens, "4"))).toBe("checked");
    expect(getNodeCheckState(state, findNode(screens, "5"))).toBe("unchecked");
    expect(getNodeCheckState(state, findNode(screens, "6"))).toBe("unchecked");
    expect(getNodeCheckState(state, findNode(screens, "1"))).toBe("partial");
  });

  it("selectSubtree behaves identically to selectOnlyNode", () => {
    const screens = makeFixtureScreens();
    const node = findNode(screens, "2");
    const a = selectOnlyNode(node, screens);
    const b = selectSubtree(node, screens);
    expect(Array.from(b.excluded).sort()).toEqual(
      Array.from(a.excluded).sort(),
    );
  });

  it("selectChangedNodes keeps only the listed ids; ancestors become partial", () => {
    const screens = makeFixtureScreens();
    const state = selectChangedNodes(["7", "8"], screens);

    expect(getSelectedNodeIds(state, screens)).toEqual(["7", "8"]);
    // FeaturesGrid (6) itself is excluded but its leaves 7,8 are selected → partial.
    expect(getNodeCheckState(state, findNode(screens, "6"))).toBe("partial");
    expect(getNodeCheckState(state, findNode(screens, "1"))).toBe("partial");
    expect(getNodeCheckState(state, findNode(screens, "2"))).toBe("unchecked");
    expect(getNodeCheckState(state, findNode(screens, "5"))).toBe("unchecked");
    expect(getNodeCheckState(state, findNode(screens, "7"))).toBe("checked");
    expect(getNodeCheckState(state, findNode(screens, "8"))).toBe("checked");
  });
});

// ---------------------------------------------------------------------------
// Skeleton handling
// ---------------------------------------------------------------------------

describe("skeleton nodes", () => {
  function screensWithSkeletons(): TreeNode[] {
    return [
      {
        id: "1",
        name: "HomePage",
        type: "screen",
        children: [
          { id: "sk-1", name: "", type: "skeleton" },
          {
            id: "2",
            name: "Header",
            type: "container",
            children: [
              { id: "3", name: "Logo", type: "image" },
              { id: "sk-2", name: "", type: "skeleton" },
            ],
          },
        ],
      },
    ];
  }

  it("are skipped in totals", () => {
    const screens = screensWithSkeletons();
    const counts = getSelectionCounts(EMPTY_SELECTION, screens);
    expect(counts.total).toBe(3);
    expect(counts.selected).toBe(3);
  });

  it("are not selectable via toggleNode", () => {
    const screens = screensWithSkeletons();
    const skeleton = findNode(screens, "sk-1");
    const next = toggleNode(EMPTY_SELECTION, skeleton, false);
    expect(next).toBe(EMPTY_SELECTION);
  });

  it("deselectAll does not include skeletons in excluded", () => {
    const screens = screensWithSkeletons();
    const state = deselectAll(screens);
    expect(state.excluded.has("sk-1")).toBe(false);
    expect(state.excluded.has("sk-2")).toBe(false);
    expect(state.excluded.has("1")).toBe(true);
    expect(state.excluded.has("2")).toBe(true);
    expect(state.excluded.has("3")).toBe(true);
  });

  it("toggling off a parent with a skeleton child only excludes real descendants", () => {
    const screens = screensWithSkeletons();
    const next = toggleNode(EMPTY_SELECTION, findNode(screens, "2"), false);
    expect(next.excluded.has("2")).toBe(true);
    expect(next.excluded.has("3")).toBe(true);
    expect(next.excluded.has("sk-2")).toBe(false);
  });

  it("getSelectedNodeIds omits skeletons", () => {
    const screens = screensWithSkeletons();
    expect(getSelectedNodeIds(EMPTY_SELECTION, screens)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Empty-tree edge cases
// ---------------------------------------------------------------------------

describe("empty input handling", () => {
  it("getSelectionCounts on empty tree returns zeros", () => {
    expect(getSelectionCounts(EMPTY_SELECTION, [])).toEqual({
      selected: 0,
      total: 0,
    });
  });

  it("getSelectedScreens on empty tree returns []", () => {
    expect(getSelectedScreens(EMPTY_SELECTION, [])).toEqual([]);
  });

  it("deselectAll on empty tree returns an empty exclusion set", () => {
    expect(deselectAll([]).excluded.size).toBe(0);
  });

  it("getNodeCheckState on a node with no children is checked when not excluded", () => {
    const leaf: TreeNode = { id: "x", name: "X", type: "container" };
    expect(getNodeCheckState(EMPTY_SELECTION, leaf)).toBe("checked");
  });

  it("getNodeCheckState on a skeleton node returns checked (vacuous)", () => {
    const skel: TreeNode = { id: "sk", name: "", type: "skeleton" };
    expect(getNodeCheckState(EMPTY_SELECTION, skel)).toBe("checked");
  });
});
