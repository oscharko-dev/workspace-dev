import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VisualSidecarPanel } from "./VisualSidecarPanel";
import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { buildVisualSidecarReport } from "./test-fixtures";

afterEach(() => {
  cleanup();
});

describe("VisualSidecarPanel", () => {
  it("renders the empty placeholder when no report is supplied", () => {
    render(<VisualSidecarPanel report={undefined} />);
    expect(screen.getByTestId("ti-visual-sidecar-panel")).toHaveTextContent(
      /No visual sidecar report/i,
    );
  });

  it("shows OK status when report is unblocked", () => {
    render(<VisualSidecarPanel report={buildVisualSidecarReport()} />);
    expect(screen.getByTestId("ti-visual-sidecar-status").textContent).toMatch(
      /OK/,
    );
  });

  it("renders one row per record with deployment + outcome badges", () => {
    render(
      <VisualSidecarPanel
        report={buildVisualSidecarReport({
          screensWithFindings: 1,
          records: [
            {
              screenId: "screen-login",
              deployment: "phi-4-multimodal-poc",
              outcomes: ["fallback_used", "low_confidence"],
              issues: [],
              meanConfidence: 0.55,
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByTestId("ti-visual-sidecar-row-screen-login"),
    ).toHaveTextContent("phi-4-multimodal-poc");
    expect(
      screen.getByTestId(
        "ti-visual-sidecar-outcome-screen-login-fallback_used",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "ti-visual-sidecar-outcome-screen-login-low_confidence",
      ),
    ).toBeInTheDocument();
  });

  it("flags blocked sidecar reports with the warn status badge and row data attribute", () => {
    render(
      <VisualSidecarPanel
        report={buildVisualSidecarReport({
          blocked: true,
          records: [
            {
              screenId: "screen-login",
              deployment: "mock",
              outcomes: ["possible_pii"],
              issues: [
                {
                  code: "visible_pii",
                  severity: "error",
                  message: "Possible PII visible in the sidecar output",
                  path: "$.screens[0]",
                },
              ],
              meanConfidence: 0,
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("ti-visual-sidecar-status").textContent).toMatch(
      /blocked/i,
    );
    expect(
      screen
        .getByTestId("ti-visual-sidecar-row-screen-login")
        .getAttribute("data-row-blocked"),
    ).toBe("true");
    expect(
      screen.getByTestId("ti-visual-sidecar-issue-screen-login-0"),
    ).toHaveTextContent("visible_pii");
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <VisualSidecarPanel report={buildVisualSidecarReport()} />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
