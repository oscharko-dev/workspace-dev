import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitBudgetBanner } from "./RateLimitBudgetBanner";
import {
  __resetFigmaMcpCallCounterForTests,
  recordMcpCall,
} from "./figma-mcp-call-counter";

beforeEach(() => {
  __resetFigmaMcpCallCounterForTests();
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  cleanup();
  __resetFigmaMcpCallCounterForTests();
  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }
});

describe("RateLimitBudgetBanner — visibility", () => {
  it("is hidden at 0/6 (0%)", () => {
    render(<RateLimitBudgetBanner />);
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();
  });

  it("is hidden at 4/6 (67%)", () => {
    for (let i = 0; i < 4; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();
  });

  it("renders at 5/6 (83%, first crossing)", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    const banner = screen.getByTestId("rate-limit-budget-banner");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("5 of 6");
  });

  it("renders at 6/6 (100%)", () => {
    for (let i = 0; i < 6; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    expect(screen.getByTestId("rate-limit-budget-banner")).toHaveTextContent(
      "6 of 6",
    );
  });
});

describe("RateLimitBudgetBanner — dismissal", () => {
  it("hides the banner after clicking the dismiss button", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    const banner = screen.getByTestId("rate-limit-budget-banner");
    expect(banner).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("rate-limit-budget-banner-dismiss"));
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();
  });

  it("stays hidden on re-render in the same session (sessionStorage)", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    const { unmount } = render(<RateLimitBudgetBanner />);
    fireEvent.click(screen.getByTestId("rate-limit-budget-banner-dismiss"));
    unmount();

    render(<RateLimitBudgetBanner />);
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();
  });
});

describe("RateLimitBudgetBanner — accessibility + link", () => {
  it("has role='status' and aria-live='polite'", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    const banner = screen.getByTestId("rate-limit-budget-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
  });

  it("links to the Figma pricing page with rel='noreferrer noopener' and target='_blank'", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    const link = screen.getByTestId("rate-limit-budget-banner-link");
    expect(link).toHaveAttribute("href", "https://www.figma.com/pricing/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("shows the 'Upgrade your plan' copy when visible", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }
    render(<RateLimitBudgetBanner />);
    expect(screen.getByTestId("rate-limit-budget-banner")).toHaveTextContent(
      /Upgrade your plan/,
    );
  });
});

describe("cross-month re-enablement", () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetFigmaMcpCallCounterForTests();
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  it("re-shows the banner on month rollover even if dismissed in the prior month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));

    // Seed 5/6 calls in April so threshold is crossed.
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }

    // Render — banner should be visible.
    const { unmount, rerender } = render(<RateLimitBudgetBanner />);
    expect(screen.getByTestId("rate-limit-budget-banner")).toBeInTheDocument();

    // Dismiss — banner should hide.
    fireEvent.click(screen.getByTestId("rate-limit-budget-banner-dismiss"));
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();

    // Same clock — still hidden on rerender.
    rerender(<RateLimitBudgetBanner />);
    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();

    // Unmount before rolling to May.
    unmount();

    // Roll forward to May and seed 5/6 calls for the new month.
    vi.setSystemTime(new Date("2026-05-02T12:00:00Z"));
    __resetFigmaMcpCallCounterForTests();
    try {
      window.sessionStorage.clear();
    } catch {
      // ignore
    }
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }

    // Remount — banner must be visible again for May.
    render(<RateLimitBudgetBanner />);
    expect(screen.getByTestId("rate-limit-budget-banner")).toBeInTheDocument();
  });
});
