import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryChart } from "./history-chart";
import { type HistoryRuns } from "../data/types";

describe("HistoryChart", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the empty state when there is no history", () => {
    render(<HistoryChart history={null} />);
    expect(screen.getByTestId("history-chart-empty")).toBeVisible();
  });

  it("renders the empty state when entries exist but none have scores", () => {
    const history: HistoryRuns = {
      version: 2,
      entries: [{ runAt: "2026-04-10T00:00:00Z", scores: [] }],
    };
    render(<HistoryChart history={history} />);
    expect(screen.getByTestId("history-chart-empty")).toBeVisible();
  });

  it("renders a chart with viewBox and a data dot for a single run", () => {
    const history: HistoryRuns = {
      version: 2,
      entries: [
        { runAt: "2026-04-10T00:00:00Z", overallScore: 99, scores: [] },
      ],
    };
    render(<HistoryChart history={history} />);
    const chart = screen.getByTestId("history-chart");
    const svg = chart.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 320 120");
    expect(svg?.querySelectorAll("circle")).toHaveLength(1);
  });

  it("renders a line path and multiple dots for multiple runs", () => {
    const history: HistoryRuns = {
      version: 2,
      entries: [
        { runAt: "2026-04-08T00:00:00Z", overallScore: 95, scores: [] },
        { runAt: "2026-04-09T00:00:00Z", overallScore: 97, scores: [] },
        { runAt: "2026-04-10T00:00:00Z", overallScore: 99, scores: [] },
      ],
    };
    render(<HistoryChart history={history} />);
    const chart = screen.getByTestId("history-chart");
    const svg = chart.querySelector("svg");
    expect(svg?.querySelector("path")).not.toBeNull();
    expect(svg?.querySelectorAll("circle")).toHaveLength(3);
  });
});
