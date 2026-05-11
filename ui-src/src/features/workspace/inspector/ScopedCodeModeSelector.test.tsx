import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScopedCodeModeSelector } from "./ScopedCodeModeSelector";

describe("ScopedCodeModeSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders three radio options with snippet active for mapped nodes", () => {
    render(
      <ScopedCodeModeSelector
        activeMode="snippet"
        onModeChange={() => {}}
        isMapped
      />
    );

    expect(screen.getByRole("radiogroup", { name: "Code viewing mode" })).toBeVisible();
    expect(screen.getByTestId("scoped-mode-snippet")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("scoped-mode-focused")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("scoped-mode-full")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByTestId("scoped-mode-unmapped-hint")).toBeNull();
  });

  it("disables snippet and focused modes for unmapped nodes and shows the fallback hint", () => {
    render(
      <ScopedCodeModeSelector
        activeMode="full"
        onModeChange={() => {}}
        isMapped={false}
      />
    );

    expect(screen.getByTestId("scoped-mode-snippet")).toBeDisabled();
    expect(screen.getByTestId("scoped-mode-focused")).toBeDisabled();
    expect(screen.getByTestId("scoped-mode-full")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("scoped-mode-unmapped-hint")).toHaveTextContent("No mapping");
  });

  it("invokes onModeChange when clicking an available inactive mode", () => {
    const onModeChange = vi.fn();

    render(
      <ScopedCodeModeSelector
        activeMode="snippet"
        onModeChange={onModeChange}
        isMapped
      />
    );

    fireEvent.click(screen.getByTestId("scoped-mode-focused"));
    expect(onModeChange).toHaveBeenCalledWith("focused");
  });

  it("does not re-dispatch when clicking the active mode", () => {
    const onModeChange = vi.fn();

    render(
      <ScopedCodeModeSelector
        activeMode="full"
        onModeChange={onModeChange}
        isMapped
      />
    );

    fireEvent.click(screen.getByTestId("scoped-mode-full"));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("supports keyboard navigation across available mapped modes", () => {
    const onModeChange = vi.fn();

    render(
      <ScopedCodeModeSelector
        activeMode="snippet"
        onModeChange={onModeChange}
        isMapped
      />
    );

    const radioGroup = screen.getByRole("radiogroup", { name: "Code viewing mode" });
    fireEvent.keyDown(radioGroup, { key: "ArrowRight" });
    fireEvent.keyDown(radioGroup, { key: "End" });
    fireEvent.keyDown(radioGroup, { key: "Home" });

    expect(onModeChange).toHaveBeenNthCalledWith(1, "focused");
    expect(onModeChange).toHaveBeenNthCalledWith(2, "full");
    expect(onModeChange).toHaveBeenNthCalledWith(3, "snippet");
  });

  it("navigates only among enabled modes when the node is unmapped", () => {
    const onModeChange = vi.fn();

    render(
      <ScopedCodeModeSelector
        activeMode="full"
        onModeChange={onModeChange}
        isMapped={false}
      />
    );

    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "Code viewing mode" }), { key: "ArrowLeft" });
    expect(onModeChange).toHaveBeenCalledWith("full");
  });
});
