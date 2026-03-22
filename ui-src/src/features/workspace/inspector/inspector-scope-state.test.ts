/**
 * Unit tests for the Inspector hierarchical drilldown scope reducer.
 *
 * Covers: SELECT_NODE, ENTER_SCOPE, EXIT_SCOPE, RESET, derived selectors,
 * and fallback behavior for unmapped nodes.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
 */
import { describe, it, expect } from "vitest";
import {
  inspectorScopeReducer,
  INITIAL_INSPECTOR_SCOPE_STATE,
  selectScopeDepth,
  selectActiveScope,
  selectHasActiveScope,
  selectScopeStack,
  type InspectorScopeState,
  type InspectorScopeAction,
  type ManifestMapping
} from "./inspector-scope-state";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SELECT_NODE
// ---------------------------------------------------------------------------

describe("SELECT_NODE", () => {
  it("sets the selected node id", () => {
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
  });

  it("marks selectedNodeMapped true when mapping is provided", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    expect(state.selectedNodeMapped).toBe(true);
  });

  it("marks selectedNodeMapped false when mapping is null (unmapped node)", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "unmapped-1",
        nodeName: "Decorative",
        nodeType: "container",
        mapping: null
      }
    });

    expect(state.selectedNodeMapped).toBe(false);
  });

  it("updates effectiveFileTarget from mapping", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });

  it("preserves previous effectiveFileTarget when mapping is null", () => {
    const withFile = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    const afterUnmapped = dispatch(withFile, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "unmapped-1",
        nodeName: "Decorative",
        nodeType: "container",
        mapping: null
      }
    });

    expect(afterUnmapped.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });

  it("does not alter scope stack", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    expect(state.scopeStack).toHaveLength(0);
  });

  it("does not alter history", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "SELECT_NODE",
      payload: {
        nodeId: "node-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: mappedNode
      }
    });

    expect(state.history).toHaveLength(0);
  });

  it("allows changing selection multiple times", () => {
    const state = dispatchAll([
      {
        type: "SELECT_NODE",
        payload: { nodeId: "a", nodeName: "A", nodeType: "text", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "b", nodeName: "B", nodeType: "button", mapping: null }
      }
    ]);

    expect(state.selectedNodeId).toBe("b");
    expect(state.scopeStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ENTER_SCOPE
// ---------------------------------------------------------------------------

describe("ENTER_SCOPE", () => {
  it("pushes a scope entry onto the stack", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: {
        nodeId: "card-1",
        nodeName: "PriceCard",
        nodeType: "card",
        mapping: mappedNode
      }
    });

    expect(state.scopeStack).toHaveLength(1);
    expect(state.scopeStack[0]).toEqual({
      nodeId: "card-1",
      nodeName: "PriceCard",
      nodeType: "card"
    });
  });

  it("also sets selectedNodeId to the scoped node", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: {
        nodeId: "card-1",
        nodeName: "PriceCard",
        nodeType: "card",
        mapping: mappedNode
      }
    });

    expect(state.selectedNodeId).toBe("card-1");
  });

  it("updates effectiveFileTarget from mapping", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: {
        nodeId: "header-1",
        nodeName: "HeaderBar",
        nodeType: "appbar",
        mapping: extractedMapping
      }
    });

    expect(state.effectiveFileTarget).toBe("src/components/HeaderBar.tsx");
  });

  it("does not push duplicate when already at top of scope stack", () => {
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
  });

  it("supports nested scope entry (multi-level drilldown)", () => {
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
    expect(state.scopeStack[0]?.nodeId).toBe("card-1");
    expect(state.scopeStack[1]?.nodeId).toBe("button-1");
  });

  it("commits previous scope top to history on nested entry", () => {
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

    expect(state.history).toHaveLength(1);
    expect(state.history[0]).toEqual({
      nodeId: "card-1",
      nodeName: "PriceCard",
      nodeType: "card",
      file: "src/pages/Home.tsx"
    });
  });

  it("works with unmapped nodes (mapping=null)", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: {
        nodeId: "decorative-1",
        nodeName: "Ornament",
        nodeType: "container",
        mapping: null
      }
    });

    expect(state.scopeStack).toHaveLength(1);
    expect(state.selectedNodeMapped).toBe(false);
    expect(state.effectiveFileTarget).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EXIT_SCOPE
// ---------------------------------------------------------------------------

describe("EXIT_SCOPE", () => {
  it("pops the top scope entry", () => {
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
    expect(state.scopeStack[0]?.nodeId).toBe("card-1");
  });

  it("sets selectedNodeId to the new top of the stack", () => {
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

    expect(state.selectedNodeId).toBe("card-1");
  });

  it("restores effectiveFileTarget from history", () => {
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

    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });

  it("clears selectedNodeId when exiting the last scope", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      { type: "EXIT_SCOPE" }
    ]);

    expect(state.selectedNodeId).toBeNull();
    expect(state.scopeStack).toHaveLength(0);
  });

  it("is a no-op when scope stack is empty", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, { type: "EXIT_SCOPE" });

    expect(state).toBe(INITIAL_INSPECTOR_SCOPE_STATE);
  });

  it("handles full cycle: enter → enter → exit → exit", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "button-1", nodeName: "BuyButton", nodeType: "button", mapping: extractedMapping }
      },
      { type: "EXIT_SCOPE" },
      { type: "EXIT_SCOPE" }
    ]);

    expect(state.scopeStack).toHaveLength(0);
    expect(state.selectedNodeId).toBeNull();
    expect(state.history).toHaveLength(0);
    expect(state.effectiveFileTarget).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RESET
// ---------------------------------------------------------------------------

describe("RESET", () => {
  it("returns to initial state from any state", () => {
    const modified = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "node-2", nodeName: "Title", nodeType: "text", mapping: extractedMapping }
      }
    ]);

    const state = dispatch(modified, { type: "RESET" });
    expect(state).toEqual(INITIAL_INSPECTOR_SCOPE_STATE);
  });
});

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

describe("selectScopeDepth", () => {
  it("returns 0 for initial state", () => {
    expect(selectScopeDepth(INITIAL_INSPECTOR_SCOPE_STATE)).toBe(0);
  });

  it("returns the scope stack length", () => {
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
  });
});

describe("selectActiveScope", () => {
  it("returns null when no scope is active", () => {
    expect(selectActiveScope(INITIAL_INSPECTOR_SCOPE_STATE)).toBeNull();
  });

  it("returns the top scope entry", () => {
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

    expect(selectActiveScope(state)).toEqual({
      nodeId: "b",
      nodeName: "B",
      nodeType: "button"
    });
  });
});

describe("selectHasActiveScope", () => {
  it("returns false for initial state", () => {
    expect(selectHasActiveScope(INITIAL_INSPECTOR_SCOPE_STATE)).toBe(false);
  });

  it("returns true when scope is active", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: { nodeId: "a", nodeName: "A", nodeType: "card", mapping: mappedNode }
    });

    expect(selectHasActiveScope(state)).toBe(true);
  });
});

describe("selectScopeStack", () => {
  it("returns empty array for initial state", () => {
    expect(selectScopeStack(INITIAL_INSPECTOR_SCOPE_STATE)).toEqual([]);
  });

  it("returns the full scope stack", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "a", nodeName: "A", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "b", nodeName: "B", nodeType: "button", mapping: null }
      }
    ]);

    const stack = selectScopeStack(state);
    expect(stack).toHaveLength(2);
    expect(stack[0]?.nodeId).toBe("a");
    expect(stack[1]?.nodeId).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// Fallback behavior (unmapped nodes)
// ---------------------------------------------------------------------------

describe("fallback for unmapped nodes", () => {
  it("supports selection of unmapped nodes while preserving scope state", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "card-1", nodeName: "PriceCard", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "SELECT_NODE",
        payload: { nodeId: "unmapped-1", nodeName: "Decorative", nodeType: "container", mapping: null }
      }
    ]);

    expect(state.selectedNodeId).toBe("unmapped-1");
    expect(state.selectedNodeMapped).toBe(false);
    expect(state.scopeStack).toHaveLength(1);
    expect(state.effectiveFileTarget).toBe("src/pages/Home.tsx");
  });

  it("supports entering scope on unmapped nodes", () => {
    const state = dispatch(INITIAL_INSPECTOR_SCOPE_STATE, {
      type: "ENTER_SCOPE",
      payload: { nodeId: "unmapped-1", nodeName: "Decorative", nodeType: "container", mapping: null }
    });

    expect(state.scopeStack).toHaveLength(1);
    expect(state.scopeStack[0]?.nodeId).toBe("unmapped-1");
    expect(state.selectedNodeMapped).toBe(false);
  });

  it("can exit scope from an unmapped node", () => {
    const state = dispatchAll([
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "mapped-1", nodeName: "Card", nodeType: "card", mapping: mappedNode }
      },
      {
        type: "ENTER_SCOPE",
        payload: { nodeId: "unmapped-1", nodeName: "Decorative", nodeType: "container", mapping: null }
      },
      { type: "EXIT_SCOPE" }
    ]);

    expect(state.scopeStack).toHaveLength(1);
    expect(state.selectedNodeId).toBe("mapped-1");
  });
});
