/**
 * Inspector scope context object and consumer hook.
 *
 * The context is created here (not in InspectorScopeContext.tsx) so that
 * the provider component file only exports components, satisfying
 * react-refresh/only-export-components.
 *
 * @see ./InspectorScopeContext.tsx for the provider component
 */
import { createContext, useContext } from "react";
import type { InspectorScopeContextValue } from "./InspectorScopeContext";

export const InspectorScopeCtx = createContext<InspectorScopeContextValue | null>(null);

/**
 * Access the Inspector scope context value.
 * Throws if used outside an `InspectorScopeProvider`.
 */
export function useInspectorScope(): InspectorScopeContextValue {
  const ctx = useContext(InspectorScopeCtx);
  if (!ctx) {
    throw new Error("useInspectorScope must be used within an InspectorScopeProvider");
  }
  return ctx;
}
