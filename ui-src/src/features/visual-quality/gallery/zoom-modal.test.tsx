import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type JSX } from "react";
import { describe, expect, it, vi } from "vitest";
import { ZoomModal } from "./zoom-modal";
import { type MergedScreen } from "../data/types";

vi.mock("./overlay-side-by-side", () => ({
  OverlaySideBySide: () => <div data-testid="overlay-side-by-side">side-by-side</div>
}));

vi.mock("./overlay-onion-skin", () => ({
  OverlayOnionSkin: () => <div data-testid="overlay-onion-skin">onion-skin</div>
}));

vi.mock("./overlay-heatmap", () => ({
  OverlayHeatmap: () => <div data-testid="overlay-heatmap">heatmap</div>
}));

vi.mock("./overlay-confidence-view", () => ({
  OverlayConfidenceView: () => <div data-testid="overlay-confidence">confidence</div>
}));

const sampleScreen: MergedScreen = {
  key: "fixture-1:screen-1:desktop",
  fixtureId: "fixture-1",
  screenId: "screen-1",
  screenName: "Primary screen",
  viewportId: "desktop",
  viewportLabel: "Desktop",
  score: 99.2,
  report: null,
  referenceUrl: "/reference.png",
  actualUrl: "/actual.png",
  diffUrl: "/diff.png",
  worstSeverity: null,
  confidence: {
    screenId: "screen-1",
    screenName: "Primary screen",
    level: "high",
    score: 99,
    contributors: [],
    components: [],
  },
};

function ZoomModalHarness(): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Open modal
      </button>
      {open ? (
        <ZoomModal
          screen={sampleScreen}
          mode="heatmap"
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

describe("ZoomModal", () => {
  it("traps Tab navigation and restores focus after close", async () => {
    render(<ZoomModalHarness />);

    const trigger = screen.getByRole("button", { name: "Open modal" });
    trigger.focus();
    fireEvent.click(trigger);

    const resetButton = await screen.findByRole("button", { name: "Reset zoom (100%)" });
    const closeButton = screen.getByRole("button", { name: "Close zoom view" });

    await waitFor(() => {
      expect(resetButton).toHaveFocus();
    });

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab" });
    expect(resetButton).toHaveFocus();

    fireEvent.keyDown(resetButton, { key: "Tab", shiftKey: true });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(closeButton, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("zoom-modal")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("renders confidence overlay in confidence mode", () => {
    render(<ZoomModal screen={sampleScreen} mode="confidence" onClose={() => {}} />);

    expect(screen.getByTestId("overlay-confidence")).toBeVisible();
  });
});
