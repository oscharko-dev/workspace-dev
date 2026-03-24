import type { JSX } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InspectorScopeCtx } from "./useInspectorScope";
import { useInspectorScope } from "./useInspectorScope";
import { INITIAL_INSPECTOR_SCOPE_STATE } from "./inspector-scope-state";

function ScopeConsumer(): JSX.Element {
  const { hasActiveScope, scopeDepth } = useInspectorScope();
  return (
    <div data-testid="scope-consumer">
      {String(hasActiveScope)}:{String(scopeDepth)}
    </div>
  );
}

describe("useInspectorScope", () => {
  it("returns the active context value inside the provider", () => {
    render(
      <InspectorScopeCtx.Provider
        value={{
          state: INITIAL_INSPECTOR_SCOPE_STATE,
          dispatch: vi.fn(),
          activeScope: null,
          hasActiveScope: false,
          scopeDepth: 0,
          canReturnToParentFile: false,
          parentFile: null
        }}
      >
        <ScopeConsumer />
      </InspectorScopeCtx.Provider>
    );

    expect(screen.getByTestId("scope-consumer")).toHaveTextContent("false:0");
  });

  it("throws a clear error outside the provider", () => {
    expect(() => {
      render(<ScopeConsumer />);
    }).toThrow("useInspectorScope must be used within an InspectorScopeProvider");
  });
});
