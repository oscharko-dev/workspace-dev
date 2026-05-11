import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { FinOpsCostCard } from "./FinOpsCostCard";

afterEach(() => {
  cleanup();
});

describe("FinOpsCostCard", () => {
  it("renders tokens-used / budget with thousands separators", () => {
    render(<FinOpsCostCard tokensUsed={12_500} tokensBudget={50_000} />);
    const tokens = screen.getByTestId("ti-finops-cost-card-tokens");
    expect(tokens.textContent).toContain("12,500");
    expect(tokens.textContent).toContain("50,000");
  });

  it("colour-bands the bar green at low usage", () => {
    render(<FinOpsCostCard tokensUsed={10} tokensBudget={1000} />);
    const root = screen.getByTestId("ti-finops-cost-card");
    expect(root.getAttribute("data-usage-band")).toBe("green");
  });

  it("colour-bands the bar amber at warning usage", () => {
    render(<FinOpsCostCard tokensUsed={750} tokensBudget={1000} />);
    const root = screen.getByTestId("ti-finops-cost-card");
    expect(root.getAttribute("data-usage-band")).toBe("amber");
  });

  it("colour-bands the bar red at critical usage", () => {
    render(<FinOpsCostCard tokensUsed={950} tokensBudget={1000} />);
    const root = screen.getByTestId("ti-finops-cost-card");
    expect(root.getAttribute("data-usage-band")).toBe("red");
  });

  it("sets aria-valuetext that combines tokens, percent, and band", () => {
    render(<FinOpsCostCard tokensUsed={500} tokensBudget={1000} />);
    const bar = screen.getByTestId("ti-finops-cost-card-bar");
    expect(bar.getAttribute("aria-valuetext")).toContain("500");
    expect(bar.getAttribute("aria-valuetext")).toContain("50%");
    expect(bar.getAttribute("aria-valuetext")).toContain("within budget");
  });

  it("clamps the bar to 100% when usage exceeds the budget", () => {
    render(<FinOpsCostCard tokensUsed={2000} tokensBudget={1000} />);
    const fill = screen.getByTestId(
      "ti-finops-cost-card-bar-fill",
    ) as HTMLElement;
    expect(fill.style.width).toBe("100%");
  });

  it("shows the optional cost-estimate label when provided", () => {
    render(
      <FinOpsCostCard
        tokensUsed={500}
        tokensBudget={1000}
        estimatedCostLabel="$0.42"
      />,
    );
    const estimate = screen.getByTestId("ti-finops-cost-card-estimate");
    expect(estimate.textContent).toContain("$0.42");
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(
      <FinOpsCostCard tokensUsed={500} tokensBudget={1000} />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
