import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineStatusBar } from "./PipelineStatusBar";
import {
  createInitialPipelineState,
  type PartialImportStats,
  type PipelineError,
  type PipelinePasteDeltaSummary,
  type PipelineStage,
  type StageStatus,
} from "./paste-pipeline";
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

function baseStageProgress(
  overrides: Partial<Record<PipelineStage, StageStatus>> = {},
): Record<PipelineStage, StageStatus> {
  return { ...createInitialPipelineState().stageProgress, ...overrides };
}

function buildError(overrides: Partial<PipelineError> = {}): PipelineError {
  return {
    stage: "resolving",
    code: "STAGE_FAILED",
    message: "stage failed",
    retryable: true,
    ...overrides,
  };
}

interface RenderOverrides {
  stage?: PipelineStage;
  errors?: readonly PipelineError[];
  stageProgress?: Record<PipelineStage, StageStatus>;
  partialStats?: PartialImportStats;
  canRetry?: boolean;
  onRetry?: () => void;
  onCopyReport?: () => void;
  fallbackMode?: "rest";
  pasteDeltaSummary?: PipelinePasteDeltaSummary;
}

function renderBar(overrides: RenderOverrides = {}) {
  const {
    stage = "error",
    errors = [],
    stageProgress = baseStageProgress(),
    partialStats,
    canRetry = false,
    onRetry,
    onCopyReport,
    fallbackMode,
    pasteDeltaSummary,
  } = overrides;

  return render(
    <PipelineStatusBar
      stage={stage}
      errors={errors}
      stageProgress={stageProgress}
      {...(partialStats !== undefined ? { partialStats } : {})}
      canRetry={canRetry}
      {...(fallbackMode !== undefined ? { fallbackMode } : {})}
      {...(pasteDeltaSummary !== undefined ? { pasteDeltaSummary } : {})}
      {...(onRetry !== undefined ? { onRetry } : {})}
      {...(onCopyReport !== undefined ? { onCopyReport } : {})}
    />,
  );
}

function buildPasteDeltaSummary(
  overrides: Partial<PipelinePasteDeltaSummary> = {},
): PipelinePasteDeltaSummary {
  return {
    mode: "auto_resolved_to_delta",
    strategy: "delta",
    totalNodes: 10,
    nodesReused: 3,
    nodesReprocessed: 7,
    structuralChangeRatio: 0.25,
    pasteIdentityKey: "abc123",
    priorManifestMissing: false,
    ...overrides,
  };
}

describe("PipelineStatusBar — summary text (partial stage)", () => {
  it("shows partial-stats summary when stage='partial' and partialStats is set", () => {
    renderBar({
      stage: "partial",
      partialStats: { resolvedStages: 2, totalStages: 4, errorCount: 1 },
    });

    expect(
      screen.getByText("Partially imported: 2/4 stages resolved · 1 error"),
    ).toBeInTheDocument();
  });

  it("uses the singular word 'error' when errorCount === 1", () => {
    renderBar({
      stage: "partial",
      partialStats: { resolvedStages: 2, totalStages: 4, errorCount: 1 },
    });

    const el = screen.getByText(/Partially imported: 2\/4 stages resolved/);
    expect(el.textContent).toMatch(/\b1 error\b(?!s)/);
  });

  it("uses the plural word 'errors' when errorCount > 1", () => {
    renderBar({
      stage: "partial",
      partialStats: { resolvedStages: 2, totalStages: 4, errorCount: 3 },
    });

    expect(
      screen.getByText("Partially imported: 2/4 stages resolved · 3 errors"),
    ).toBeInTheDocument();
  });

  it("shows 'Partially imported' only (no counts) when partialStats is undefined", () => {
    renderBar({ stage: "partial" });

    expect(screen.getByText("Partially imported")).toBeInTheDocument();
    // Ensure the detailed summary is NOT rendered
    expect(screen.queryByText(/stages resolved/)).not.toBeInTheDocument();
  });
});

describe("PipelineStatusBar — summary text (error stage)", () => {
  it("shows 'Import failed · N errors' summary when stage='error' with multiple errors", () => {
    const errors = [buildError(), buildError({ stage: "transforming" })];
    renderBar({ stage: "error", errors });

    expect(screen.getByText("Import failed · 2 errors")).toBeInTheDocument();
  });

  it("uses singular 'error' when stage='error' and exactly 1 error", () => {
    renderBar({ stage: "error", errors: [buildError()] });

    expect(screen.getByText("Import failed · 1 error")).toBeInTheDocument();
    expect(
      screen.queryByText("Import failed · 1 errors"),
    ).not.toBeInTheDocument();
  });
});

describe("PipelineStatusBar — retry button", () => {
  it("shows the retry button when canRetry=true AND onRetry is provided", () => {
    renderBar({ stage: "error", canRetry: true, onRetry: vi.fn() });

    expect(screen.getByTestId("pipeline-status-bar-retry")).toBeInTheDocument();
  });

  it("does not show the retry button when canRetry=false", () => {
    renderBar({ stage: "error", canRetry: false, onRetry: vi.fn() });

    expect(
      screen.queryByTestId("pipeline-status-bar-retry"),
    ).not.toBeInTheDocument();
  });

  it("does not show the retry button when onRetry is not provided (even if canRetry=true)", () => {
    renderBar({ stage: "error", canRetry: true });

    expect(
      screen.queryByTestId("pipeline-status-bar-retry"),
    ).not.toBeInTheDocument();
  });

  it("calls onRetry when the retry button is clicked", () => {
    const onRetry = vi.fn();
    renderBar({ stage: "error", canRetry: true, onRetry });

    fireEvent.click(screen.getByTestId("pipeline-status-bar-retry"));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a countdown and disables retry while cooldown is active", () => {
    const onRetry = vi.fn();
    renderBar({
      stage: "error",
      canRetry: true,
      onRetry,
      errors: [buildError({ retryAfterMs: 4200 })],
    });

    const retryButton = screen.getByTestId("pipeline-status-bar-retry");
    expect(retryButton).toBeDisabled();
    expect(
      screen.getByTestId("pipeline-status-bar-retry-countdown"),
    ).toHaveTextContent("Retry available in 5s");

    fireEvent.click(retryButton);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("PipelineStatusBar — fallback mode", () => {
  it("shows the REST fallback badge when fallbackMode='rest'", () => {
    renderBar({
      stage: "partial",
      fallbackMode: "rest",
      partialStats: { resolvedStages: 2, totalStages: 4, errorCount: 1 },
    });

    expect(
      screen.getByTestId("pipeline-status-bar-fallback-mode"),
    ).toHaveTextContent("Figma REST fallback active");
  });
});

describe("PipelineStatusBar — paste delta summary", () => {
  it("renders the 'Delta Update' badge and detail text when mode resolves to delta", () => {
    renderBar({
      stage: "error",
      pasteDeltaSummary: buildPasteDeltaSummary({
        mode: "auto_resolved_to_delta",
        nodesReused: 3,
        totalNodes: 10,
      }),
    });

    const badge = screen.getByTestId("pipeline-status-bar-paste-delta");
    expect(badge).toHaveTextContent("Delta Update");
    expect(
      screen.getByTestId("pipeline-status-bar-paste-delta-detail"),
    ).toHaveTextContent("3/10 reused");
  });

  it("renders the 'Full Build' badge when mode resolves to full", () => {
    renderBar({
      stage: "error",
      pasteDeltaSummary: buildPasteDeltaSummary({
        mode: "auto_resolved_to_full",
        strategy: "structural_break",
      }),
    });

    expect(
      screen.getByTestId("pipeline-status-bar-paste-delta"),
    ).toHaveTextContent("Full Build");
  });

  it("renders no paste-delta badge when pasteDeltaSummary is undefined", () => {
    renderBar({ stage: "error" });

    expect(
      screen.queryByTestId("pipeline-status-bar-paste-delta"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pipeline-status-bar-paste-delta-detail"),
    ).not.toBeInTheDocument();
  });

  it("exposes accessible title '{N} of {M} nodes reused'", () => {
    renderBar({
      stage: "error",
      pasteDeltaSummary: buildPasteDeltaSummary({
        nodesReused: 3,
        totalNodes: 10,
      }),
    });

    expect(
      screen.getByTestId("pipeline-status-bar-paste-delta"),
    ).toHaveAttribute("title", "3 of 10 nodes reused");
  });

  it("hides detail and falls back to 'Paste summary unavailable' when totalNodes is 0", () => {
    renderBar({
      stage: "error",
      pasteDeltaSummary: buildPasteDeltaSummary({
        mode: "full",
        totalNodes: 0,
        nodesReused: 0,
        nodesReprocessed: 0,
      }),
    });

    expect(
      screen.queryByTestId("pipeline-status-bar-paste-delta-detail"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("pipeline-status-bar-paste-delta"),
    ).toHaveAttribute("title", "Paste summary unavailable");
  });
});

describe("PipelineStatusBar — details toggle", () => {
  it("hides the details panel initially; clicking the toggle shows it", () => {
    renderBar({ stage: "error" });

    // Panel not rendered initially
    expect(
      screen.queryByTestId("pipeline-status-bar-details"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("pipeline-status-bar-details-toggle"));

    expect(
      screen.getByTestId("pipeline-status-bar-details"),
    ).toBeInTheDocument();
  });

  it("clicking the toggle again collapses the details panel", () => {
    renderBar({ stage: "error" });

    const toggle = screen.getByTestId("pipeline-status-bar-details-toggle");
    fireEvent.click(toggle);
    expect(
      screen.getByTestId("pipeline-status-bar-details"),
    ).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(
      screen.queryByTestId("pipeline-status-bar-details"),
    ).not.toBeInTheDocument();
  });

  it("shows per-stage status icons for all backend stages when expanded", () => {
    const stageProgress = baseStageProgress({
      resolving: { state: "done", duration: 120 },
      extracting: { state: "pending" },
      transforming: { state: "running" },
      mapping: { state: "failed" },
      generating: { state: "pending" },
    });

    renderBar({ stage: "error", stageProgress });

    fireEvent.click(screen.getByTestId("pipeline-status-bar-details-toggle"));

    const panel = screen.getByTestId("pipeline-status-bar-details");
    expect(panel).toHaveTextContent("Resolving");
    expect(panel).toHaveTextContent("Extracting");
    expect(panel).toHaveTextContent("Transforming");
    expect(panel).toHaveTextContent("Mapping");
    expect(panel).toHaveTextContent("Generating");

    // Each backend stage renders its corresponding status icon
    expect(panel.querySelector('[aria-label="done"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="running"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="failed"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="pending"]')).not.toBeNull();
  });
});

describe("PipelineStatusBar — copy report button", () => {
  it("shows the copy-report button only when onCopyReport is provided", () => {
    const { rerender } = renderBar({ stage: "error" });
    expect(
      screen.queryByTestId("pipeline-status-bar-copy-report"),
    ).not.toBeInTheDocument();

    const onCopyReport = vi.fn();
    rerender(
      <PipelineStatusBar
        stage="error"
        errors={[]}
        stageProgress={baseStageProgress()}
        canRetry={false}
        onCopyReport={onCopyReport}
      />,
    );

    expect(
      screen.getByTestId("pipeline-status-bar-copy-report"),
    ).toBeInTheDocument();
  });

  it("calls onCopyReport when the copy-report button is clicked", () => {
    const onCopyReport = vi.fn();
    renderBar({ stage: "error", onCopyReport });

    fireEvent.click(screen.getByTestId("pipeline-status-bar-copy-report"));

    expect(onCopyReport).toHaveBeenCalledTimes(1);
  });
});

describe("PipelineStatusBar — accessibility", () => {
  it("has role='status' on the root element", () => {
    renderBar({ stage: "error" });

    const root = screen.getByTestId("pipeline-status-bar");
    expect(root).toHaveAttribute("role", "status");
  });

  it("details toggle has aria-expanded='false' initially and 'true' after click", () => {
    renderBar({ stage: "error" });

    const toggle = screen.getByTestId("pipeline-status-bar-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("PipelineStatusBar — MCP budget banner integration (#1093)", () => {
  it("renders the RateLimitBudgetBanner when the MCP quota threshold is crossed", () => {
    for (let i = 0; i < 5; i += 1) {
      recordMcpCall();
    }

    renderBar({ stage: "error" });

    expect(screen.getByTestId("rate-limit-budget-banner")).toBeInTheDocument();
  });

  it("does not render the banner when below threshold", () => {
    for (let i = 0; i < 3; i += 1) {
      recordMcpCall();
    }

    renderBar({ stage: "error" });

    expect(
      screen.queryByTestId("rate-limit-budget-banner"),
    ).not.toBeInTheDocument();
  });
});
