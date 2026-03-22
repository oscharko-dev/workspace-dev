/**
 * Durable Inspector state model for hierarchical drilldown scope.
 *
 * Represents selected node, active scope stack, effective file target,
 * and committed navigation history. Selection and scope entry are
 * intentionally separate actions.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A manifest mapping for a node — null when the node has no manifest entry. */
export interface ManifestMapping {
  file: string;
  startLine: number;
  endLine: number;
  extractedComponent?: true;
}

/** A committed history entry representing a previous scope navigation. */
export interface ScopeHistoryEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  file: string | null;
}

/** A scope stack entry representing an active scope level. */
export interface ScopeStackEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
}

/** Full inspector scope state. */
export interface InspectorScopeState {
  /** Currently selected node id (selection only, not scope). */
  selectedNodeId: string | null;

  /** Active scope stack — the chain of explicitly entered scopes. */
  scopeStack: ScopeStackEntry[];

  /** Committed navigation history entries. */
  history: ScopeHistoryEntry[];

  /**
   * Effective file target derived from the current scope/selection.
   * null when no file mapping is available.
   */
  effectiveFileTarget: string | null;

  /**
   * Whether the currently selected node has a manifest mapping.
   * When false, code-specific affordances should show a fallback.
   */
  selectedNodeMapped: boolean;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface SelectNodeAction {
  type: "SELECT_NODE";
  payload: {
    nodeId: string;
    nodeName: string;
    nodeType: string;
    /** Manifest mapping for this node, or null if unmapped. */
    mapping: ManifestMapping | null;
  };
}

export interface EnterScopeAction {
  type: "ENTER_SCOPE";
  payload: {
    nodeId: string;
    nodeName: string;
    nodeType: string;
    mapping: ManifestMapping | null;
  };
}

export interface ExitScopeAction {
  type: "EXIT_SCOPE";
}

export interface ResetAction {
  type: "RESET";
}

export type InspectorScopeAction =
  | SelectNodeAction
  | EnterScopeAction
  | ExitScopeAction
  | ResetAction;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const INITIAL_INSPECTOR_SCOPE_STATE: InspectorScopeState = {
  selectedNodeId: null,
  scopeStack: [],
  history: [],
  effectiveFileTarget: null,
  selectedNodeMapped: false
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileFromMapping(mapping: ManifestMapping | null): string | null {
  if (!mapping) return null;
  return mapping.file;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function inspectorScopeReducer(
  state: InspectorScopeState,
  action: InspectorScopeAction
): InspectorScopeState {
  switch (action.type) {
    case "SELECT_NODE": {
      const { nodeId, mapping } = action.payload;
      return {
        ...state,
        selectedNodeId: nodeId,
        selectedNodeMapped: mapping !== null,
        effectiveFileTarget: fileFromMapping(mapping) ?? state.effectiveFileTarget
      };
    }

    case "ENTER_SCOPE": {
      const { nodeId, nodeName, nodeType, mapping } = action.payload;

      // Don't push duplicate if already the top of the scope stack
      const topScope = state.scopeStack.length > 0
        ? state.scopeStack[state.scopeStack.length - 1]
        : null;
      if (topScope && topScope.nodeId === nodeId) {
        return state;
      }

      // Commit current scope top to history if there is one
      const nextHistory = [...state.history];
      if (topScope) {
        nextHistory.push({
          nodeId: topScope.nodeId,
          nodeName: topScope.nodeName,
          nodeType: topScope.nodeType,
          file: state.effectiveFileTarget
        });
      }

      const effectiveFile = fileFromMapping(mapping) ?? state.effectiveFileTarget;

      return {
        ...state,
        selectedNodeId: nodeId,
        selectedNodeMapped: mapping !== null,
        scopeStack: [
          ...state.scopeStack,
          { nodeId, nodeName, nodeType }
        ],
        history: nextHistory,
        effectiveFileTarget: effectiveFile
      };
    }

    case "EXIT_SCOPE": {
      if (state.scopeStack.length === 0) {
        return state;
      }

      const nextStack = state.scopeStack.slice(0, -1);
      const newTop = nextStack.length > 0
        ? nextStack[nextStack.length - 1]
        : null;

      // Pop the most recent history entry to restore file target
      const nextHistory = [...state.history];
      const restoredEntry = nextHistory.pop();

      return {
        ...state,
        selectedNodeId: newTop?.nodeId ?? null,
        selectedNodeMapped: newTop !== null,
        scopeStack: nextStack,
        history: nextHistory,
        effectiveFileTarget: restoredEntry?.file ?? null
      };
    }

    case "RESET": {
      return INITIAL_INSPECTOR_SCOPE_STATE;
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Derived selectors
// ---------------------------------------------------------------------------

/** Returns the depth of the current scope (0 = no scope active). */
export function selectScopeDepth(state: InspectorScopeState): number {
  return state.scopeStack.length;
}

/** Returns the currently active (top) scope entry, or null. */
export function selectActiveScope(state: InspectorScopeState): ScopeStackEntry | null {
  if (state.scopeStack.length === 0) return null;
  return state.scopeStack[state.scopeStack.length - 1] ?? null;
}

/** Returns whether a scope is currently active. */
export function selectHasActiveScope(state: InspectorScopeState): boolean {
  return state.scopeStack.length > 0;
}

/** Returns the full scope stack (for breadcrumb rendering). */
export function selectScopeStack(state: InspectorScopeState): readonly ScopeStackEntry[] {
  return state.scopeStack;
}
