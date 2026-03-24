/**
 * React context for the Inspector hierarchical drilldown scope state.
 *
 * Provides the scope reducer state and dispatch to all Inspector subtrees.
 * Keeps pane layout, hover overlays, async query state, and transient UI
 * affordances local — this context is strictly for durable drilldown state.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/442
 */
import {
  createContext,
  useReducer,
  useMemo,
  type JSX,
  type Dispatch,
  type ReactNode
} from "react";
import {
  inspectorScopeReducer,
  INITIAL_INSPECTOR_SCOPE_STATE,
  selectActiveScope,
  selectCanReturnToParentFile,
  selectHasActiveScope,
  selectParentFile,
  selectScopeDepth,
  type InspectorScopeState,
  type InspectorScopeAction,
  type ScopeStackEntry
} from "./inspector-scope-state";

// ---------------------------------------------------------------------------
// Context value type
// ---------------------------------------------------------------------------

export interface InspectorScopeContextValue {
  state: InspectorScopeState;
  dispatch: Dispatch<InspectorScopeAction>;

  // Pre-computed derived values for convenience
  activeScope: ScopeStackEntry | null;
  hasActiveScope: boolean;
  scopeDepth: number;
  canReturnToParentFile: boolean;
  parentFile: string | null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const InspectorScopeCtx = createContext<InspectorScopeContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface InspectorScopeProviderProps {
  children: ReactNode;
}

export function InspectorScopeProvider({ children }: InspectorScopeProviderProps): JSX.Element {
  const [state, dispatch] = useReducer(inspectorScopeReducer, INITIAL_INSPECTOR_SCOPE_STATE);

  const value = useMemo<InspectorScopeContextValue>(() => ({
    state,
    dispatch,
    activeScope: selectActiveScope(state),
    hasActiveScope: selectHasActiveScope(state),
    scopeDepth: selectScopeDepth(state),
    canReturnToParentFile: selectCanReturnToParentFile(state),
    parentFile: selectParentFile(state)
  }), [state]);

  return (
    <InspectorScopeCtx.Provider value={value}>
      {children}
    </InspectorScopeCtx.Provider>
  );
}
