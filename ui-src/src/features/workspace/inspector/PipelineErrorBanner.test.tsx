import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PipelineErrorBanner } from "./PipelineErrorBanner";
import { PASTE_ERROR_CATALOG } from "./paste-error-catalog";
import type { PipelineError } from "./paste-pipeline";

afterEach(() => {
  cleanup();
});

function buildError(overrides: Partial<PipelineError> = {}): PipelineError {
  return {
    stage: "resolving",
    code: "MCP_UNAVAILABLE",
    message: "MCP unavailable",
    retryable: true,
    ...overrides,
  };
}

describe("PipelineErrorBanner — catalog lookup", () => {
  it("renders title, description, and action from the catalog for a known error code", () => {
    const error = buildError({ code: "MCP_UNAVAILABLE", retryable: true });
    render(<PipelineErrorBanner error={error} />);

    const entry = PASTE_ERROR_CATALOG.MCP_UNAVAILABLE;
    expect(screen.getByText(entry.title)).toBeInTheDocument();
    expect(screen.getByText(entry.description)).toBeInTheDocument();
    expect(screen.getByText(entry.action)).toBeInTheDocument();
  });

  it("falls back to STAGE_FAILED copy for an unknown error code", () => {
    const error = buildError({ code: "SOMETHING_TOTALLY_UNKNOWN" });
    render(<PipelineErrorBanner error={error} />);

    const fallback = PASTE_ERROR_CATALOG.STAGE_FAILED;
    expect(screen.getByText(fallback.title)).toBeInTheDocument();
    expect(screen.getByText(fallback.description)).toBeInTheDocument();
    expect(screen.getByText(fallback.action)).toBeInTheDocument();

    // Sanity: should NOT be rendering MCP_UNAVAILABLE copy
    expect(
      screen.queryByText(PASTE_ERROR_CATALOG.MCP_UNAVAILABLE.title),
    ).not.toBeInTheDocument();
  });
});

describe("PipelineErrorBanner — retry button visibility", () => {
  it("shows the retry button when error.retryable === true AND onRetry is provided", () => {
    const error = buildError({ retryable: true });
    render(<PipelineErrorBanner error={error} onRetry={vi.fn()} />);

    expect(
      screen.getByTestId("pipeline-error-banner-retry"),
    ).toBeInTheDocument();
  });

  it("does not show the retry button when error.retryable === false", () => {
    const error = buildError({ retryable: false });
    render(<PipelineErrorBanner error={error} onRetry={vi.fn()} />);

    expect(
      screen.queryByTestId("pipeline-error-banner-retry"),
    ).not.toBeInTheDocument();
  });

  it("does not show the retry button when onRetry is not provided, even if retryable === true", () => {
    const error = buildError({ retryable: true });
    render(<PipelineErrorBanner error={error} />);

    expect(
      screen.queryByTestId("pipeline-error-banner-retry"),
    ).not.toBeInTheDocument();
  });
});

describe("PipelineErrorBanner — retry interaction", () => {
  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    const error = buildError({ retryable: true });
    render(<PipelineErrorBanner error={error} onRetry={onRetry} />);

    fireEvent.click(screen.getByTestId("pipeline-error-banner-retry"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("PipelineErrorBanner — retry countdown", () => {
  it("shows the retry countdown text when retryAfterMs is set (5000ms → '5s')", () => {
    const error = buildError({ retryAfterMs: 5000 });
    render(<PipelineErrorBanner error={error} />);

    expect(screen.getByText(/Retry available in 5s/)).toBeInTheDocument();
  });

  it("rounds retryAfterMs up to the nearest second (4200ms → '5s')", () => {
    const error = buildError({ retryAfterMs: 4200 });
    render(<PipelineErrorBanner error={error} />);

    expect(screen.getByText(/Retry available in 5s/)).toBeInTheDocument();
  });

  it("does not show the countdown text when retryAfterMs is undefined", () => {
    const error = buildError();
    render(<PipelineErrorBanner error={error} />);

    expect(screen.queryByText(/Retry available in/)).not.toBeInTheDocument();
  });
});

describe("PipelineErrorBanner — accessibility", () => {
  it("has role='alert' on the root container", () => {
    const error = buildError();
    render(<PipelineErrorBanner error={error} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute("data-testid", "pipeline-error-banner");
  });
});
