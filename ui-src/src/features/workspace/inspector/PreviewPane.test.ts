import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { PreviewPane } from "./PreviewPane";

vi.mock("./InspectOverlay", () => ({
  InspectOverlay: ({
    activeScopeNodeId,
    iframeLoadVersion,
    inspectEnabled
  }: {
    activeScopeNodeId: string | null;
    iframeLoadVersion: number;
    inspectEnabled: boolean;
  }) =>
    createElement("div", {
      "data-testid": "inspect-overlay",
      "data-active-scope-node-id": activeScopeNodeId ?? "",
      "data-iframe-load-version": String(iframeLoadVersion),
      "data-inspect-enabled": String(inspectEnabled)
    })
}));

afterEach(() => {
  cleanup();
});

describe("PreviewPane", () => {
  it("renders the preview controls and hides the loading overlay after iframe load", () => {
    const onToggleInspect = vi.fn();
    const onInspectSelect = vi.fn();

    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: false,
        activeScopeNodeId: "node-7",
        onToggleInspect,
        onInspectSelect
      })
    );

    expect(screen.getByText("Loading preview…")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "http://127.0.0.1:4010/preview");
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute("data-inspect-enabled", "false");
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute("data-active-scope-node-id", "node-7");

    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(onToggleInspect).toHaveBeenCalledTimes(1);

    fireEvent.load(screen.getByTitle("Live preview"));
    expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument();
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute("data-iframe-load-version", "1");
  });

  it("reflects active inspect mode on the toggle button", () => {
    render(
      createElement(PreviewPane, {
        previewUrl: "http://127.0.0.1:4010/preview",
        inspectEnabled: true,
        activeScopeNodeId: null,
        onToggleInspect: () => {
          // no-op
        },
        onInspectSelect: () => {
          // no-op
        }
      })
    );

    expect(screen.getByRole("button", { name: "Inspect" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("inspect-overlay")).toHaveAttribute("data-inspect-enabled", "true");
  });
});
