import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

function ThrowingRoute(): never {
  throw new Error("Route render failed");
}

describe("ErrorBoundary", () => {
  it("renders the fallback UI when a route throws", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingRoute />
      </ErrorBoundary>
    );

    expect(screen.getByText("This route failed to render.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recoverable rendering failure" })).toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalledWith("[runtime-error]", expect.anything());
  });
});
