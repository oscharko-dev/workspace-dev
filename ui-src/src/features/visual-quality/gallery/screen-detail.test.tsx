import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScreenDetail } from "./screen-detail";
import { type MergedScreen } from "../data/types";

vi.mock("./overlay-side-by-side", () => ({
  OverlaySideBySide: () => <div data-testid="overlay-side-by-side">side-by-side</div>,
}));

vi.mock("./overlay-onion-skin", () => ({
  OverlayOnionSkin: () => <div data-testid="overlay-onion-skin">onion-skin</div>,
}));

vi.mock("./overlay-heatmap", () => ({
  OverlayHeatmap: () => <div data-testid="overlay-heatmap">heatmap</div>,
}));

vi.mock("./overlay-confidence-view", () => ({
  OverlayConfidenceView: () => <div data-testid="overlay-confidence">confidence</div>,
}));

vi.mock("./zoom-modal", () => ({
  ZoomModal: () => <div data-testid="zoom-modal">zoom</div>,
}));

const sampleScreen: MergedScreen = {
  key: "fixture-1/screen-1/desktop",
  fixtureId: "fixture-1",
  screenId: "screen-1",
  screenName: "Primary screen",
  viewportId: "desktop",
  viewportLabel: "Desktop",
  score: 96.8,
  report: {
    status: "completed",
    overallScore: 96.8,
    dimensions: [],
    hotspots: [],
  },
  referenceUrl: "/reference.png",
  actualUrl: "/actual.png",
  diffUrl: "/diff.png",
  worstSeverity: null,
  confidence: {
    screenId: "screen-1",
    screenName: "Primary screen",
    level: "medium",
    score: 80,
    contributors: [],
    components: [],
  },
};

describe("ScreenDetail", () => {
  it("renders confidence overlay when confidence mode is selected", () => {
    render(<ScreenDetail screen={sampleScreen} />);

    fireEvent.click(screen.getByTestId("overlay-mode-confidence"));
    expect(screen.getByTestId("overlay-confidence")).toBeVisible();
  });
});
