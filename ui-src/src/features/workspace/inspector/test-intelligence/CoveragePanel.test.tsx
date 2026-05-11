import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CoveragePanel } from "./CoveragePanel";
import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { buildCoverageReport } from "./test-fixtures";

afterEach(() => {
  cleanup();
});

describe("CoveragePanel", () => {
  it("renders the empty state when no coverage report is supplied", () => {
    const { container } = render(<CoveragePanel coverage={undefined} />);
    expect(screen.getByTestId("ti-coverage-panel")).toHaveTextContent(
      /No coverage report/i,
    );
    expect(container).toBeTruthy();
  });

  it("renders coverage stats and per-bucket rows when a report is supplied", () => {
    render(<CoveragePanel coverage={buildCoverageReport()} />);
    expect(screen.getByTestId("ti-coverage-total-cases")).toHaveTextContent(
      "1",
    );
    expect(screen.getByTestId("ti-coverage-trace")).toHaveTextContent("100%");
    expect(
      screen.getByTestId("ti-coverage-row-field-coverage"),
    ).toHaveTextContent("50%");
    expect(
      screen.getByTestId("ti-coverage-row-action-coverage"),
    ).toHaveTextContent("100%");
  });

  it("renders the empty duplicate findings hint when there are no duplicates", () => {
    render(<CoveragePanel coverage={buildCoverageReport()} />);
    expect(
      screen.getByTestId("ti-coverage-duplicates-empty"),
    ).toBeInTheDocument();
  });

  it("renders duplicate findings when present", () => {
    render(
      <CoveragePanel
        coverage={buildCoverageReport({
          duplicatePairs: [
            {
              leftTestCaseId: "tc-1",
              rightTestCaseId: "tc-2",
              similarity: 0.93,
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("ti-coverage-duplicates")).toHaveTextContent(
      "tc-1",
    );
    expect(screen.getByTestId("ti-coverage-duplicate-0")).toHaveTextContent(
      "0.93",
    );
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <CoveragePanel coverage={buildCoverageReport()} />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
