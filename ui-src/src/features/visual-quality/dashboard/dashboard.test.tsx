import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ScoreDashboard } from "./score-dashboard";
import { DimensionBreakdown } from "./dimension-breakdown";
import { mergeReport } from "../data/report-loader";
import { type LastRunAggregate, type ScreenReport } from "../data/types";

afterEach(() => {
  cleanup();
});

const aggregate: LastRunAggregate = {
  version: 2,
  ranAt: "2026-04-11T18:00:40.698Z",
  overallScore: 97.5,
  overallBaseline: 95,
  overallCurrent: 97.5,
  overallDelta: 2.5,
  scores: [
    {
      fixtureId: "alpha",
      score: 99,
      screenId: "1:1",
      screenName: "Alpha",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
    {
      fixtureId: "bravo",
      score: 96,
      screenId: "2:2",
      screenName: "Bravo",
      viewportId: "desktop",
      viewportLabel: "Desktop",
    },
  ],
  warnings: ["headline uses full-page results"],
};

function dimReport(score: number): ScreenReport {
  return {
    status: "completed",
    overallScore: score,
    dimensions: [
      { name: "Layout Accuracy", weight: 0.3, score: score - 0.1 },
      { name: "Color Fidelity", weight: 0.25, score: score + 0.1 },
    ],
    hotspots: [],
  };
}

describe("ScoreDashboard", () => {
  it("renders overall score, delta, fixtures count, and per-fixture rows", () => {
    const merged = mergeReport(
      aggregate,
      {
        "alpha/1_1/desktop": { report: dimReport(99) },
        "bravo/2_2/desktop": { report: dimReport(96) },
      },
      null,
    );
    render(<ScoreDashboard report={merged} />);

    expect(screen.getByTestId("score-dashboard")).toBeVisible();
    expect(screen.getByText("Overall score")).toBeVisible();
    expect(screen.getByText("97.50")).toBeVisible();
    expect(screen.getByText("Δ vs baseline")).toBeVisible();
    expect(screen.getByText("+2.50")).toBeVisible();

    const fixtures = screen.getByTestId("dashboard-fixtures");
    expect(fixtures).toHaveTextContent("alpha");
    expect(fixtures).toHaveTextContent("bravo");
    expect(fixtures).toHaveTextContent("99.00%");
    expect(fixtures).toHaveTextContent("96.00%");
  });

  it("renders warnings when present", () => {
    const merged = mergeReport(aggregate, {}, null);
    render(<ScoreDashboard report={merged} />);
    expect(screen.getByTestId("dashboard-warnings")).toHaveTextContent(
      "headline uses full-page results",
    );
  });

  it("omits the delta stat when overallDelta is missing", () => {
    const { overallDelta: _delta, ...rest } = aggregate;
    void _delta;
    const merged = mergeReport(rest, {}, null);
    render(<ScoreDashboard report={merged} />);
    expect(screen.queryByText("Δ vs baseline")).toBeNull();
  });
});

describe("DimensionBreakdown", () => {
  it("aggregates dimensions across merged screens", () => {
    const merged = mergeReport(
      aggregate,
      {
        "alpha/1_1/desktop": { report: dimReport(99) },
        "bravo/2_2/desktop": { report: dimReport(96) },
      },
      null,
    );
    render(<DimensionBreakdown report={merged} />);
    const panel = screen.getByTestId("dashboard-dimensions");
    expect(panel).toHaveTextContent("Layout Accuracy");
    expect(panel).toHaveTextContent("Color Fidelity");
  });

  it("renders a placeholder when no per-screen reports are attached", () => {
    const merged = mergeReport(aggregate, {}, null);
    render(<DimensionBreakdown report={merged} />);
    expect(screen.getByTestId("dashboard-dimensions")).toHaveTextContent(
      "No dimension data available",
    );
  });
});
