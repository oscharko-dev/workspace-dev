/**
 * Durable Inspector state model for hierarchical drilldown scope.
 *
 * Represents selected node, active scope stack, effective file target,
 * and committed navigation history. Selection and scope entry are
 * intentionally separate actions.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
 * @see https://github.com/oscharko-dev/workspace-dev/issues/445
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

/** Hard cap for committed drilldown snapshots retained in memory. */
export const MAX_NAV_ENTRIES = 100;

/** A committed history snapshot representing a full drilldown navigation state. */
export interface ScopeHistoryEntry {
  selectedNodeId: string | null;
  selectedNodeMapped: boolean;
  scopeStack: ScopeStackEntry[];
  effectiveFileTarget: string | null;
}

/** A scope stack entry representing an active scope level. */
export interface ScopeStackEntry {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  mapped: boolean;
  file: string | null;
}

/** Full inspector scope state. */
export interface InspectorScopeState {
  /** Currently selected node id (selection only, not scope). */
  selectedNodeId: string | null;

  /** Active scope stack — the chain of explicitly entered scopes. */
  scopeStack: ScopeStackEntry[];

  /** Committed navigation snapshots. */
  history: ScopeHistoryEntry[];

  /** Index of the currently active snapshot in `history`. */
  historyIndex: number;

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

export interface NavigateBackAction {
  type: "NAVIGATE_BACK";
}

export interface NavigateForwardAction {
  type: "NAVIGATE_FORWARD";
}

export interface LevelUpAction {
  type: "LEVEL_UP";
}

export interface ResetAction {
  type: "RESET";
}

export type InspectorScopeAction =
  | SelectNodeAction
  | EnterScopeAction
  | ExitScopeAction
  | NavigateBackAction
  | NavigateForwardAction
  | LevelUpAction
  | ResetAction;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

interface ScopeCoreState {
  selectedNodeId: string | null;
  selectedNodeMapped: boolean;
  scopeStack: ScopeStackEntry[];
  effectiveFileTarget: string | null;
}

const INITIAL_SCOPE_CORE_STATE: ScopeCoreState = {
  selectedNodeId: null,
  selectedNodeMapped: false,
  scopeStack: [],
  effectiveFileTarget: null
};

export const INITIAL_INSPECTOR_SCOPE_STATE: InspectorScopeState = {
  ...INITIAL_SCOPE_CORE_STATE,
  history: [toSnapshot(INITIAL_SCOPE_CORE_STATE)],
  historyIndex: 0
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileFromMapping(mapping: ManifestMapping | null): string | null {
  if (!mapping) return null;
  return mapping.file;
}

function cloneScopeStack(stack: readonly ScopeStackEntry[]): ScopeStackEntry[] {
  return stack.map((entry) => ({ ...entry }));
}

function toScopeCoreState(state: InspectorScopeState): ScopeCoreState {
  return {
    selectedNodeId: state.selectedNodeId,
    selectedNodeMapped: state.selectedNodeMapped,
    scopeStack: cloneScopeStack(state.scopeStack),
    effectiveFileTarget: state.effectiveFileTarget
  };
}

function toSnapshot(state: ScopeCoreState): ScopeHistoryEntry {
  return {
    selectedNodeId: state.selectedNodeId,
    selectedNodeMapped: state.selectedNodeMapped,
    scopeStack: cloneScopeStack(state.scopeStack),
    effectiveFileTarget: state.effectiveFileTarget
  };
}

function areScopeEntriesEqual(a: ScopeStackEntry, b: ScopeStackEntry): boolean {
  return a.nodeId === b.nodeId
    && a.nodeName === b.nodeName
    && a.nodeType === b.nodeType
    && a.mapped === b.mapped
    && a.file === b.file;
}

function areScopeStacksEqual(a: readonly ScopeStackEntry[], b: readonly ScopeStackEntry[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let idx = 0; idx < a.length; idx += 1) {
    const entryA = a[idx];
    const entryB = b[idx];
    if (!entryA || !entryB || !areScopeEntriesEqual(entryA, entryB)) {
      return false;
    }
  }

  return true;
}

function areSnapshotsEqual(a: ScopeHistoryEntry, b: ScopeHistoryEntry): boolean {
  return a.selectedNodeId === b.selectedNodeId
    && a.selectedNodeMapped === b.selectedNodeMapped
    && a.effectiveFileTarget === b.effectiveFileTarget
    && areScopeStacksEqual(a.scopeStack, b.scopeStack);
}

function areScopeCoreStatesEqual(a: ScopeCoreState, b: ScopeCoreState): boolean {
  return a.selectedNodeId === b.selectedNodeId
    && a.selectedNodeMapped === b.selectedNodeMapped
    && a.effectiveFileTarget === b.effectiveFileTarget
    && areScopeStacksEqual(a.scopeStack, b.scopeStack);
}

function commitNavigationState(
  state: InspectorScopeState,
  nextCoreState: ScopeCoreState
): InspectorScopeState {
  if (areScopeCoreStatesEqual(toScopeCoreState(state), nextCoreState)) {
    return state;
  }

  const truncatedHistory = state.history.slice(0, state.historyIndex + 1);
  const nextSnapshot = toSnapshot(nextCoreState);
  const tailSnapshot = truncatedHistory[truncatedHistory.length - 1];

  if (tailSnapshot && areSnapshotsEqual(tailSnapshot, nextSnapshot)) {
    return {
      ...state,
      ...nextCoreState,
      history: truncatedHistory,
      historyIndex: truncatedHistory.length - 1
    };
  }

  const withAppendedSnapshot = [...truncatedHistory, nextSnapshot];
  const boundedHistory = withAppendedSnapshot.length > MAX_NAV_ENTRIES
    ? withAppendedSnapshot.slice(withAppendedSnapshot.length - MAX_NAV_ENTRIES)
    : withAppendedSnapshot;

  return {
    ...state,
    ...nextCoreState,
    history: boundedHistory,
    historyIndex: boundedHistory.length - 1
  };
}

function restoreSnapshotAtIndex(
  state: InspectorScopeState,
  nextHistoryIndex: number
): InspectorScopeState {
  const snapshot = state.history[nextHistoryIndex];
  if (!snapshot) {
    return state;
  }

  return {
    ...state,
    selectedNodeId: snapshot.selectedNodeId,
    selectedNodeMapped: snapshot.selectedNodeMapped,
    scopeStack: cloneScopeStack(snapshot.scopeStack),
    effectiveFileTarget: snapshot.effectiveFileTarget,
    historyIndex: nextHistoryIndex
  };
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
      const nextCoreState: ScopeCoreState = {
        selectedNodeId: nodeId,
        selectedNodeMapped: mapping !== null,
        scopeStack: state.scopeStack,
        effectiveFileTarget: fileFromMapping(mapping) ?? state.effectiveFileTarget
      };

      return commitNavigationState(state, nextCoreState);
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

      const effectiveFile = fileFromMapping(mapping) ?? state.effectiveFileTarget;
      const nextScopeEntry: ScopeStackEntry = {
        nodeId,
        nodeName,
        nodeType,
        mapped: mapping !== null,
        file: effectiveFile
      };
      const nextCoreState: ScopeCoreState = {
        selectedNodeId: nodeId,
        selectedNodeMapped: mapping !== null,
        scopeStack: [...state.scopeStack, nextScopeEntry],
        effectiveFileTarget: effectiveFile
      };

      return commitNavigationState(state, nextCoreState);
    }

    case "EXIT_SCOPE":
    case "LEVEL_UP": {
      if (state.scopeStack.length === 0) {
        return state;
      }

      const nextStack = state.scopeStack.slice(0, -1);
      const newTop = nextStack.length > 0
        ? nextStack[nextStack.length - 1]
        : null;
      const nextCoreState: ScopeCoreState = {
        selectedNodeId: newTop?.nodeId ?? null,
        selectedNodeMapped: newTop?.mapped ?? false,
        scopeStack: nextStack,
        effectiveFileTarget: newTop?.file ?? null
      };

      return commitNavigationState(state, nextCoreState);
    }

    case "NAVIGATE_BACK": {
      if (state.historyIndex <= 0) {
        return state;
      }

      return restoreSnapshotAtIndex(state, state.historyIndex - 1);
    }

    case "NAVIGATE_FORWARD": {
      if (state.historyIndex >= state.history.length - 1) {
        return state;
      }

      return restoreSnapshotAtIndex(state, state.historyIndex + 1);
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

/** Returns whether a committed drilldown snapshot exists behind the cursor. */
export function selectCanNavigateBack(state: InspectorScopeState): boolean {
  return state.historyIndex > 0;
}

/** Returns whether a committed drilldown snapshot exists ahead of the cursor. */
export function selectCanNavigateForward(state: InspectorScopeState): boolean {
  return state.historyIndex < state.history.length - 1;
}

/** Returns whether an explicit level-up action can be applied. */
export function selectCanLevelUp(state: InspectorScopeState): boolean {
  return state.scopeStack.length > 0;
}
