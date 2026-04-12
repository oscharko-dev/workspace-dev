import type { JSX } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorScopeProvider } from "./InspectorScopeContext";
import { useInspectorScope } from "./useInspectorScope";

function ScopeProbe(): JSX.Element {
  const { hasActiveScope, scopeDepth, canReturnToParentFile, parentFile } =
    useInspectorScope();

  return (
    <div data-testid="scope-probe">
      {String(hasActiveScope)}|{scopeDepth}|{String(canReturnToParentFile)}|
      {parentFile ?? "none"}
    </div>
  );
}

describe("InspectorScopeProvider", () => {
  it("provides the derived initial scope state", () => {
    render(
      <InspectorScopeProvider>
        <ScopeProbe />
      </InspectorScopeProvider>,
    );

    expect(screen.getByTestId("scope-probe")).toHaveTextContent(
      "false|0|false|none",
    );
  });
});
