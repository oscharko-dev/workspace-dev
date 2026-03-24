/**
 * Unit tests for the Inspector drilldown navigation reducer.
 *
 * Covers selection/scope commits, back/forward/level-up traversal,
 * history truncation when branching, bounded history size, selectors,
 * and edit-mode entry/exit behavior.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
 * @see https://github.com/oscharko-dev/workspace-dev/issues/445
 * @see https://github.com/oscharko-dev/workspace-dev/issues/446
 * @see https://github.com/oscharko-dev/workspace-dev/issues/451
 */
import { describe, expect, it } from "vitest";
import {
  inspectorScopeReducer,
  INITIAL_INSPECTOR_SCOPE_STATE,
  MAX_NAV_ENTRIES,
  selectActiveScope,
  selectCanLevelUp,
  selectCanNavigateBack,
  selectCanNavigateForward,
  selectCanReturnToParentFile,
  selectEditModeActive,
  selectEditCapability,
  selectCanEnterEditMode,
  selectFileContextStack,
  selectHasActiveScope,
  selectParentFile,
  selectScopeDepth,
  selectScopeStack,
  type InspectorScopeAction,
  type InspectorScopeState,
  type ManifestMapping
} from "./inspector-scope-state";
import type { EditCapabilityResult } from "./edit-capability-detection";

function dispatch(state: InspectorScopeState, action: InspectorScopeAction): InspectorScopeState {
  return inspectorScopeReducer(state, action);
}

function dispatchAll(actions: InspectorScopeAction[]): InspectorScopeState {
  let state = INITIAL_INSPECTOR_SCOPE_STATE;
  for (const action of actions) {
    state = dispatch(state, action);
  }
  return state;
}

const mappedNode: ManifestMapping = {
  file: "src/pages/Home.tsx",
  startLine: 10,
  endLine: 25
};

const extractedMapping: ManifestMapping = {
  file: "src/components/HeaderBar.tsx",
  startLine: 1,
  endLine: 40,
  extractedComponent: true
};

describe("initial state", () => {
  it("starts with a committed root snapshot", () => {
    expect(INITIAL_INSPECTOR_SCOPE_STATE.history).toHaveLength(1);
    expect(INITIAL_INSPECTOR_SCOPE_STATE.historyIndex).toBe(0);
    expect(INITIAL_INSPECTOR_SCOPE_STATE.history[0]).toEqual({
      selectedNodeId: null,
      selectedNodeMapped: false,
      scopeStack: [],
      effectiveFileTarget: null,
      fileContextStack: []
    });
  });
});

describe("SELECT_NODE", () => {
  it("commits selected node and mapping state", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    expect(state.selectedNodeId).toBe("node-1");
    expect(state.selectedNodeMapped).toBe(true);
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  it("does not commit duplicate state when selecting the same node twice", () => {
    const state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      }
    ]);

    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  it("preserves effectiveFileTarget when selecting an unmapped node", () => {
    const state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "unmapped-1", nodeName: "Decorative", nodeType: "container", mapping: null }
      }
    ]);

    expect(state.selectedNodeId).toBe("unmapped-1");
    expect(state.selectedNodeMapped).toBe(false);
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
    expect(state.history).toHaveLength(3);
    expect(state.historyIndex).toBe(2);
  });
});

describe("ENTER_SCOPE and level-up", () => {
  it("commits nested scope entries with mapped metadata", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "button-1", nodeName: "BuyButton", nodeType: "button", mapping: extractedMapping }
      }
    ]);

    expect(state.scopeStack).toHaveLength(2);
    expect(state.scopeStack[0]).toEqual({
      nodeId: "card-1",
      nodeName: "PriceCard",
      nodeType: "card",
      mapped: true,
      file: "src/pages/Home.tsx"
    });
    expect(state.scopeStack[1]).toEqual({
      nodeId: "button-1",
      nodeName: "BuyButton",
      nodeType: "button",
      mapped: true,
      file: "src/components/HeaderBar.tsx"
    });
    expect(state.history).toHaveLength(3);
    expect(state.historyIndex).toBe(2);
  });

  it("does not push duplicate scope entry when entering the current top scope", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      }
    ]);

    expect(state.scopeStack).toHaveLength(1);
    expect(state.history).toHaveLength(2);
  });

  it("LEVEL_UP commits one scope-level pop", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "button-1", nodeName: "BuyButton", nodeType: "button", mapping: extractedMapping }
      },
      { type: "LEVEL_UP" }
    ]);

    expect(state.scopeStack).toHaveLength(1);
    expect(state.selectedNodeId).toBe("card-1");
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
    expect(state.history).toHaveLength(4);
    expect(state.historyIndex).toBe(3);
  });

  it("EXIT_SCOPE remains an alias of one-level-up behavior", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "button-1", nodeName: "BuyButton", nodeType: "button", mapping: extractedMapping }
      },
      { type: "EXIT_SCOPE" }
    ]);

    expect(state.scopeStack).toHaveLength(1);
    expect(state.selectedNodeId).toBe("card-1");
  });
});

describe("NAVIGATE_BACK and NAVIGATE_FORWARD", () => {
  it("moves cursor backward and forward across committed snapshots", () => {
    const committed = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "button-1", nodeName: "BuyButton", nodeType: "button", mapping: extractedMapping }
      }
    ]);

    const backOnce = dispatch(committed, { type: "NAVIGATE_BACK" });
    const backTwice = dispatch(backOnce, { type: "NAVIGATE_BACK" });
    const forward = dispatch(backTwice, { type: "NAVIGATE_FORWARD" });

    expect(backOnce.selectedNodeId).toBe("card-1");
    expect(backOnce.historyIndex).toBe(committed.historyIndex - 1);
    expect(backTwice.selectedNodeId).toBe("node-1");
    expect(forward.selectedNodeId).toBe("card-1");
    expect(forward.scopeStack).toHaveLength(1);
    expect(forward.history).toHaveLength(committed.history.length);
  });

  it("is a no-op when navigating beyond cursor bounds", () => {
    const atStart = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "NAVIGATE_BACK" });
    const committed = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
    });
    const atEnd = dispatch(committed, { type: "NAVIGATE_FORWARD" });

    expect(atStart).toBe(INITIAL_INSPECTOR_SCOPE_STATE);
    expect(atEnd).toBe(committed);
  });

  it("truncates forward branch when a new commit happens after going back", () => {
    const committed = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-a", nodeName: "A", nodeType: "text", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-b", nodeName: "B", nodeType: "button", mapping: extractedMapping }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-c", nodeName: "C", nodeType: "image", mapping: mappedNode }
      }
    ]);
    const back = dispatch(committed, { type: "NAVIGATE_BACK" });
    const branchCommit = dispatch(back, {
      type: "SELECT_NODE",
      payload: { nodeId: "node-d", nodeName: "D", nodeType: "chip", mapping: mappedNode }
    });

    expect(branchCommit.historyIndex).toBe(branchCommit.history.length - 1);
    expect(selectCanNavigateForward(branchCommit)).toBe(false);
    expect(branchCommit.selectedNodeId).toBe("node-d");
    expect(branchCommit.history.some((entry) => entry.selectedNodeId === "node-c")).toBe(false);
  });
});

describe("bounded history", () => {
  it("caps committed snapshots to MAX_NAV_ENTRIES", () => {
    let state = INITIAL_INSPECTOR_SCOPE_STATE;
    for (let idx = 0; idx < MAX_NAV_ENTRIES + 25; idx += 1) {
      state = dispatch(state, {
        type: "SELECT_NODE",
        payload: {
          nodeId: `node-${String(idx)}`,
          nodeName: `Node ${String(idx)}`,
          nodeType: "container",
          mapping: mappedNode
        }
      });
    }

    expect(state.history).toHaveLength(MAX_NAV_ENTRIES);
    expect(state.historyIndex).toBe(MAX_NAV_ENTRIES - 1);
    expect(state.history[0]?.selectedNodeId).not.toBeNull();
    expect(state.history[MAX_NAV_ENTRIES - 1]?.selectedNodeId).toBe(`node-${String(MAX_NAV_ENTRIES + 24)}`);
  });
});

describe("fallback/unmapped behavior", () => {
  it("preserves unmapped scope metadata and restores mapped parent after level-up", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "mapped-1", nodeName: "Mapped", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "unmapped-1", nodeName: "Unmapped", nodeType: "container", mapping: null }
      },
      { type: "LEVEL_UP" }
    ]);

    expect(state.selectedNodeId).toBe("mapped-1");
    expect(state.selectedNodeMapped).toBe(true);
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });

  it("restores unmapped snapshot correctly with back navigation", () => {
    const committed = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "mapped-1", nodeName: "Mapped", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "unmapped-1", nodeName: "Unmapped", nodeType: "container", mapping: null }
      }
    ]);
    const back = dispatch(committed, { type: "NAVIGATE_BACK" });
    const forward = dispatch(back, { type: "NAVIGATE_FORWARD" });

    expect(forward.selectedNodeId).toBe("unmapped-1");
    expect(forward.selectedNodeMapped).toBe(false);
    expect(forward.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });
});

describe("derived selectors", () => {
  it("returns scope depth and active scope", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "a", nodeName: "A", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "b", nodeName: "B", nodeType: "button", mapping: extractedMapping }
      }
    ]);

    expect(selectScopeDepth(state)).toBe(2);
    expect(selectHasActiveScope(state)).toBe(true);
    expect(selectActiveScope(state)?.nodeId).toBe("b");
    expect(selectScopeStack(state)).toHaveLength(2);
  });

  it("returns back/forward/level-up capabilities from cursor and stack", () => {
    const committed = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      }
    ]);
    const afterBack = dispatch(committed, { type: "NAVIGATE_BACK" });

    expect(selectCanNavigateBack(committed)).toBe(true);
    expect(selectCanNavigateForward(committed)).toBe(false);
    expect(selectCanLevelUp(committed)).toBe(true);

    expect(selectCanNavigateBack(afterBack)).toBe(true);
    expect(selectCanNavigateForward(afterBack)).toBe(true);
  });
});

describe("cross-file drilldown continuity", () => {
  const homeFileMapping: ManifestMapping = {
    file: "src/pages/Home.tsx",
    startLine: 10,
    endLine: 25
  };

  const extractedButtonMapping: ManifestMapping = {
    file: "src/components/Button.tsx",
    startLine: 1,
    endLine: 30,
    extractedComponent: true
  };

  const extractedIconMapping: ManifestMapping = {
    file: "src/components/Icon.tsx",
    startLine: 1,
    endLine: 15,
    extractedComponent: true
  };

  it("pushes file context when entering scope crosses file boundary", () => {
    const state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      }
    ]);

    expect(state.fileContextStack).toHaveLength(1);
    expect(state.fileContextStack[0]).toEqual({
      parentFile: "src/pages/Home.tsx",
      triggerNodeId: "btn-1",
      triggerNodeName: "Button"
    });
    expect(state.effectiveFileTarget).toBe("src/components/Button.tsx");
    expect(selectCanReturnToParentFile(state)).toBe(true);
    expect(selectParentFile(state)).toBe("src/pages/Home.tsx");
  });

  it("does not push file context for same-file scope entry", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "Card", nodeType: "card", mapping: homeFileMapping }
      }
    ]);

    expect(state.fileContextStack).toHaveLength(0);
    expect(selectCanReturnToParentFile(state)).toBe(false);
  });

  it("stacks multiple cross-file boundary crossings", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "icon-1", nodeName: "Icon", nodeType: "icon", mapping: extractedIconMapping }
      }
    ]);

    expect(state.fileContextStack).toHaveLength(2);
    expect(state.fileContextStack[0]?.parentFile).toBe("src/pages/Home.tsx");
    expect(state.fileContextStack[1]?.parentFile).toBe("src/components/Button.tsx");
    expect(state.effectiveFileTarget).toBe("src/components/Icon.tsx");
    expect(selectParentFile(state)).toBe("src/components/Button.tsx");
  });

  it("pops file context when level-up crosses back over file boundary", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      },
      { type: "LEVEL_UP" }
    ]);

    expect(state.fileContextStack).toHaveLength(0);
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
    expect(selectCanReturnToParentFile(state)).toBe(false);
  });

  it("RETURN_TO_PARENT_FILE restores parent file without unwinding scope", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      }
    ]);

    const returned = dispatch(state, { type: "RETURN_TO_PARENT_FILE" });

    expect(returned.effectiveFileTarget).toBe("src/pages/Home.tsx");
    expect(returned.scopeStack).toHaveLength(2);
    expect(returned.fileContextStack).toHaveLength(0);
    expect(selectCanReturnToParentFile(returned)).toBe(false);
  });

  it("RETURN_TO_PARENT_FILE is a no-op when file context stack is empty", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      }
    ]);

    const returned = dispatch(state, { type: "RETURN_TO_PARENT_FILE" });
    expect(returned).toBe(state);
  });

  it("preserves file context stack in history snapshots", () => {
    const committed = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      }
    ]);

    const back = dispatch(committed, { type: "NAVIGATE_BACK" });
    expect(back.fileContextStack).toHaveLength(0);
    expect(back.effectiveFileTarget).toBe("src/pages/Home.tsx");

    const forward = dispatch(back, { type: "NAVIGATE_FORWARD" });
    expect(forward.fileContextStack).toHaveLength(1);
    expect(forward.effectiveFileTarget).toBe("src/components/Button.tsx");
  });

  it("selectFileContextStack returns the full file context stack", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "home-1", nodeName: "Home", nodeType: "screen", mapping: homeFileMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: extractedButtonMapping }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "icon-1", nodeName: "Icon", nodeType: "icon", mapping: extractedIconMapping }
      }
    ]);

    const stack = selectFileContextStack(state);
    expect(stack).toHaveLength(2);
    expect(stack[0]?.parentFile).toBe("src/pages/Home.tsx");
    expect(stack[1]?.parentFile).toBe("src/components/Button.tsx");
  });
});

describe("RESET", () => {
  it("returns the canonical initial state", () => {
    const modified = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "HeaderBar", nodeType: "appbar", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      }
    ]);
    const reset = dispatch(modified, { type: "RESET" });

    expect(reset).toEqual(INITIAL_INSPECTOR_SCOPE_STATE);
  });
});

// ---------------------------------------------------------------------------
// Edit mode (issue #451)
// ---------------------------------------------------------------------------

const editableCapability: EditCapabilityResult = {
  editable: true,
  reason: null,
  editableFields: ["fontSize", "fillColor"]
};

const notEditableCapability: EditCapabilityResult = {
  editable: false,
  reason: "Node is not editable.",
  editableFields: []
};

describe("ENTER_EDIT_MODE and EXIT_EDIT_MODE", () => {
  it("initial state has edit mode inactive", () => {
    expect(INITIAL_INSPECTOR_SCOPE_STATE.editModeActive).toBe(false);
    expect(INITIAL_INSPECTOR_SCOPE_STATE.editCapability).toBeNull();
  });

  it("ENTER_EDIT_MODE activates edit mode", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "ENTER_EDIT_MODE" });

    expect(state.editModeActive).toBe(true);
    expect(selectEditModeActive(state)).toBe(true);
  });

  it("EXIT_EDIT_MODE deactivates edit mode", () => {
    let state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "ENTER_EDIT_MODE" });
    state = dispatch(state, { type: "EXIT_EDIT_MODE" });

    expect(state.editModeActive).toBe(false);
    expect(selectEditModeActive(state)).toBe(false);
  });

  it("EXIT_EDIT_MODE preserves the last computed capability for the current node", () => {
    let state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: editableCapability }
    });
    state = dispatch(state, { type: "ENTER_EDIT_MODE" });
    state = dispatch(state, { type: "EXIT_EDIT_MODE" });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toEqual(editableCapability);
    expect(selectCanEnterEditMode(state)).toBe(true);
  });

  it("ENTER_EDIT_MODE is idempotent when already active", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "ENTER_EDIT_MODE" });
    const again = dispatch(state, { type: "ENTER_EDIT_MODE" });

    expect(again).toBe(state); // Reference equality — no change
  });

  it("EXIT_EDIT_MODE is idempotent when already inactive", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "EXIT_EDIT_MODE" });

    expect(state).toBe(INITIAL_INSPECTOR_SCOPE_STATE);
  });
});

describe("SET_EDIT_CAPABILITY", () => {
  it("stores the capability result in state", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: editableCapability }
    });

    expect(state.editCapability).toEqual(editableCapability);
    expect(selectEditCapability(state)).toEqual(editableCapability);
    expect(selectCanEnterEditMode(state)).toBe(true);
  });

  it("returns false for selectCanEnterEditMode when not editable", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: notEditableCapability }
    });

    expect(selectCanEnterEditMode(state)).toBe(false);
  });

  it("returns false for selectCanEnterEditMode when capability is null", () => {
    expect(selectCanEnterEditMode(INITIAL_INSPECTOR_SCOPE_STATE)).toBe(false);
  });
});

describe("edit mode exits on navigation", () => {
  function enterEditMode(state: InspectorScopeState): InspectorScopeState {
    return dispatch(state, { type: "ENTER_EDIT_MODE" });
  }

  it("exits edit mode on SELECT_NODE", () => {
    let state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: { nodeId: "node-1", nodeName: "A", nodeType: "button", mapping: mappedNode }
    });
    state = enterEditMode(state);
    expect(state.editModeActive).toBe(true);

    state = dispatch(state, {
      type: "SELECT_NODE",
      payload: { nodeId: "node-2", nodeName: "B", nodeType: "card", mapping: mappedNode }
    });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toBeNull();
  });

  it("exits edit mode on ENTER_SCOPE", () => {
    let state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: { nodeId: "node-1", nodeName: "A", nodeType: "button", mapping: mappedNode }
    });
    state = enterEditMode(state);

    state = dispatch(state, {
      type: "ENTER_SCOPE",
      payload: { nodeId: "card-1", nodeName: "Card", nodeType: "card", mapping: mappedNode }
    });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toBeNull();
  });

  it("exits edit mode on EXIT_SCOPE / LEVEL_UP", () => {
    let state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "Card", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "btn-1", nodeName: "Button", nodeType: "button", mapping: mappedNode }
      }
    ]);
    state = enterEditMode(state);
    expect(state.editModeActive).toBe(true);

    state = dispatch(state, { type: "LEVEL_UP" });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toBeNull();
  });

  it("exits edit mode on NAVIGATE_BACK", () => {
    let state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "A", nodeType: "button", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-2", nodeName: "B", nodeType: "card", mapping: mappedNode }
      }
    ]);
    state = enterEditMode(state);

    state = dispatch(state, { type: "NAVIGATE_BACK" });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toBeNull();
  });

  it("exits edit mode on NAVIGATE_FORWARD", () => {
    let state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-1", nodeName: "A", nodeType: "button", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-2", nodeName: "B", nodeType: "card", mapping: mappedNode }
      }
    ]);
    state = dispatch(state, { type: "NAVIGATE_BACK" });
    state = enterEditMode(state);
    expect(state.editModeActive).toBe(true);

    state = dispatch(state, { type: "NAVIGATE_FORWARD" });

    expect(state.editModeActive).toBe(false);
  });

  it("RESET clears edit mode", () => {
    let state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "ENTER_EDIT_MODE" });
    state = dispatch(state, {
      type: "SET_EDIT_CAPABILITY",
      payload: { capability: editableCapability }
    });

    state = dispatch(state, { type: "RESET" });

    expect(state.editModeActive).toBe(false);
    expect(state.editCapability).toBeNull();
  });
});
