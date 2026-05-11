import { useState, type JSX } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorErrorBoundary } from "./InspectorErrorBoundary";

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) {
    throw new Error("Inspector render failed");
  }
  return <div data-testid="inspector-safe-child">Inspector ready</div>;
}

describe("InspectorErrorBoundary", () => {
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it("renders children when no error occurs", () => {
    render(
      <InspectorErrorBoundary>
        <div data-testid="inspector-child">Healthy inspector</div>
      </InspectorErrorBoundary>
    );

    expect(screen.getByTestId("inspector-child")).toHaveTextContent("Healthy inspector");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders fallback UI and resets after retry", () => {
    function Harness(): JSX.Element {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <InspectorErrorBoundary onRetry={() => {
          setShouldThrow(false);
        }}>
          <ThrowingChild shouldThrow={shouldThrow} />
        </InspectorErrorBoundary>
      );
    }

    render(<Harness />);

    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.getByText("Inspector encountered an error")).toBeVisible();
    expect(screen.getByText("Inspector render failed")).toBeVisible();
    expect(consoleErrorSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByTestId("inspector-safe-child")).toHaveTextContent("Inspector ready");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
