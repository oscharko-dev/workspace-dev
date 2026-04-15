import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImportReviewStepper } from "./ImportReviewStepper";
import type {
  ApplyGate,
  ImportReviewStage,
  ImportReviewState,
  WorkspaceImportSessionStatus,
} from "./import-review-state";

function buildState(
  stage: ImportReviewStage,
  overrides: Partial<ImportReviewState> = {},
): ImportReviewState {
  const statusByStage: Record<ImportReviewStage, WorkspaceImportSessionStatus> =
    {
      import: "imported",
      review: "reviewing",
      approve: "approved",
      apply: "applied",
    };
  return {
    stage,
    status: statusByStage[stage],
    reviewerNote: "",
    ...overrides,
  };
}

function buildGate(overrides: Partial<ApplyGate> = {}): ApplyGate {
  return {
    allowed: true,
    reason: null,
    requiresNote: false,
    ...overrides,
  };
}

interface RenderOptions {
  state: ImportReviewState;
  gate?: ApplyGate;
  onAdvance?: (target: ImportReviewStage) => void;
  onReviewerNoteChange?: (note: string) => void;
  onApply?: () => void;
  disabled?: boolean;
}

function renderStepper(options: RenderOptions) {
  const onAdvance = options.onAdvance ?? vi.fn();
  const onReviewerNoteChange = options.onReviewerNoteChange ?? vi.fn();
  const onApply = options.onApply ?? vi.fn();
  const gate = options.gate ?? buildGate();
  const disabled = options.disabled ?? false;
  const utils = render(
    <ImportReviewStepper
      state={options.state}
      gate={gate}
      onAdvance={onAdvance}
      onReviewerNoteChange={onReviewerNoteChange}
      onApply={onApply}
      disabled={disabled}
    />,
  );
  return { ...utils, onAdvance, onReviewerNoteChange, onApply };
}

afterEach(() => {
  cleanup();
});

describe("ImportReviewStepper — stage rendering", () => {
  const stages: readonly ImportReviewStage[] = [
    "import",
    "review",
    "approve",
    "apply",
  ];

  for (const stage of stages) {
    it(`renders all four pills for stage=${stage}`, () => {
      renderStepper({ state: buildState(stage) });
      expect(
        screen.getByTestId("import-review-stepper-pill-import"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("import-review-stepper-pill-review"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("import-review-stepper-pill-approve"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("import-review-stepper-pill-apply"),
      ).toBeInTheDocument();
    });
  }

  it("marks the current pill with aria-current='step'", () => {
    renderStepper({ state: buildState("review") });
    expect(
      screen.getByTestId("import-review-stepper-pill-review"),
    ).toHaveAttribute("aria-current", "step");
    expect(
      screen.getByTestId("import-review-stepper-pill-import"),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByTestId("import-review-stepper-pill-approve"),
    ).not.toHaveAttribute("aria-current");
  });

  it("enables completed pills and disables future pills", () => {
    renderStepper({ state: buildState("approve") });
    expect(
      screen.getByTestId("import-review-stepper-pill-import"),
    ).toBeEnabled();
    expect(
      screen.getByTestId("import-review-stepper-pill-review"),
    ).toBeEnabled();
    expect(
      screen.getByTestId("import-review-stepper-pill-approve"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("import-review-stepper-pill-apply"),
    ).toBeDisabled();
  });
});

describe("ImportReviewStepper — primary button per stage", () => {
  it("renders 'Start review' on the import stage and calls onAdvance('review')", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("import"), onAdvance });
    const button = screen.getByTestId("import-review-stepper-primary");
    expect(button).toHaveTextContent("Start review");
    fireEvent.click(button);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith("review");
  });

  it("renders 'Approve' on the review stage and calls onAdvance('approve')", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("review"), onAdvance });
    const button = screen.getByTestId("import-review-stepper-primary");
    expect(button).toHaveTextContent("Approve");
    fireEvent.click(button);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith("approve");
  });

  it("renders 'Apply' on the approve stage and calls onApply when gate allows", () => {
    const onApply = vi.fn();
    const onAdvance = vi.fn();
    renderStepper({
      state: buildState("approve"),
      gate: buildGate({ allowed: true }),
      onApply,
      onAdvance,
    });
    const button = screen.getByTestId("import-review-stepper-primary");
    expect(button).toHaveTextContent("Apply");
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("disables Apply and does NOT call onApply when gate.allowed=false", () => {
    const onApply = vi.fn();
    renderStepper({
      state: buildState("approve"),
      gate: buildGate({
        allowed: false,
        requiresNote: true,
        reason:
          "Score 40 is below minimum 70. A reviewer note is required to override.",
      }),
      onApply,
    });
    const button = screen.getByTestId("import-review-stepper-primary");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("sets the Apply button title to gate.reason when provided", () => {
    renderStepper({
      state: buildState("approve"),
      gate: buildGate({
        allowed: false,
        requiresNote: true,
        reason: "Quality score not yet available.",
      }),
    });
    expect(screen.getByTestId("import-review-stepper-primary")).toHaveAttribute(
      "title",
      "Quality score not yet available.",
    );
  });

  it("renders no primary button on the apply stage", () => {
    renderStepper({ state: buildState("apply") });
    expect(
      screen.queryByTestId("import-review-stepper-primary"),
    ).not.toBeInTheDocument();
  });
});

describe("ImportReviewStepper — gate reason surface", () => {
  it("renders the gate reason when requiresNote=true, note is empty, and stage=approve", () => {
    renderStepper({
      state: buildState("approve", { reviewerNote: "" }),
      gate: buildGate({
        allowed: false,
        requiresNote: true,
        reason:
          "Score 55 is below minimum 70. A reviewer note is required to override.",
      }),
    });
    expect(
      screen.getByTestId("import-review-stepper-gate-reason"),
    ).toHaveTextContent(
      "Score 55 is below minimum 70. A reviewer note is required to override.",
    );
  });

  it("hides the gate reason when the reviewer note is non-empty", () => {
    renderStepper({
      state: buildState("approve", { reviewerNote: "ack" }),
      gate: buildGate({
        allowed: true,
        requiresNote: true,
        reason: null,
      }),
    });
    expect(
      screen.queryByTestId("import-review-stepper-gate-reason"),
    ).not.toBeInTheDocument();
  });

  it("hides the gate reason on non-approve stages even when requiresNote=true", () => {
    renderStepper({
      state: buildState("review"),
      gate: buildGate({
        allowed: false,
        requiresNote: true,
        reason: "Review first.",
      }),
    });
    expect(
      screen.queryByTestId("import-review-stepper-gate-reason"),
    ).not.toBeInTheDocument();
  });
});

describe("ImportReviewStepper — reviewer note textarea", () => {
  it("wires the textarea value to state.reviewerNote", () => {
    renderStepper({
      state: buildState("approve", { reviewerNote: "existing text" }),
    });
    const textarea = screen.getByTestId("import-review-stepper-note");
    expect(textarea).toHaveValue("existing text");
  });

  it("invokes onReviewerNoteChange with the new value on change", () => {
    const onReviewerNoteChange = vi.fn();
    renderStepper({
      state: buildState("approve"),
      onReviewerNoteChange,
    });
    fireEvent.change(screen.getByTestId("import-review-stepper-note"), {
      target: { value: "looks good" },
    });
    expect(onReviewerNoteChange).toHaveBeenCalledTimes(1);
    expect(onReviewerNoteChange).toHaveBeenCalledWith("looks good");
  });
});

describe("ImportReviewStepper — completed pill navigation", () => {
  it("calls onAdvance with the pill's stage when a completed pill is clicked", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("approve"), onAdvance });
    fireEvent.click(screen.getByTestId("import-review-stepper-pill-review"));
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith("review");
  });

  it("does not call onAdvance when a future pill is clicked", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("import"), onAdvance });
    fireEvent.click(screen.getByTestId("import-review-stepper-pill-approve"));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("does not call onAdvance when the current pill is clicked", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("review"), onAdvance });
    fireEvent.click(screen.getByTestId("import-review-stepper-pill-review"));
    expect(onAdvance).not.toHaveBeenCalled();
  });
});

describe("ImportReviewStepper — back button", () => {
  it("renders the back button on the review stage and calls onAdvance('import')", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("review"), onAdvance });
    const back = screen.getByTestId("import-review-stepper-back");
    fireEvent.click(back);
    expect(onAdvance).toHaveBeenCalledWith("import");
  });

  it("renders the back button on the approve stage and calls onAdvance('review')", () => {
    const onAdvance = vi.fn();
    renderStepper({ state: buildState("approve"), onAdvance });
    const back = screen.getByTestId("import-review-stepper-back");
    fireEvent.click(back);
    expect(onAdvance).toHaveBeenCalledWith("review");
  });

  it("does not render the back button on the import stage", () => {
    renderStepper({ state: buildState("import") });
    expect(
      screen.queryByTestId("import-review-stepper-back"),
    ).not.toBeInTheDocument();
  });

  it("does not render the back button on the apply stage", () => {
    renderStepper({ state: buildState("apply") });
    expect(
      screen.queryByTestId("import-review-stepper-back"),
    ).not.toBeInTheDocument();
  });
});

describe("ImportReviewStepper — disabled prop", () => {
  it("disables the primary button on the import stage when disabled=true", () => {
    renderStepper({ state: buildState("import"), disabled: true });
    expect(screen.getByTestId("import-review-stepper-primary")).toBeDisabled();
  });

  it("disables the primary button on the approve stage when disabled=true (even if gate allows)", () => {
    renderStepper({
      state: buildState("approve"),
      gate: buildGate({ allowed: true }),
      disabled: true,
    });
    expect(screen.getByTestId("import-review-stepper-primary")).toBeDisabled();
  });

  it("disables the reviewer-note textarea when disabled=true", () => {
    renderStepper({ state: buildState("approve"), disabled: true });
    expect(screen.getByTestId("import-review-stepper-note")).toBeDisabled();
  });

  it("hides the back button when disabled=true", () => {
    renderStepper({ state: buildState("approve"), disabled: true });
    expect(
      screen.queryByTestId("import-review-stepper-back"),
    ).not.toBeInTheDocument();
  });
});

describe("ImportReviewStepper — stage-specific content", () => {
  it("shows the import hint on the import stage", () => {
    renderStepper({ state: buildState("import") });
    expect(
      screen.getByText("Review the import when you're ready."),
    ).toBeInTheDocument();
  });

  it("renders parent-provided children only on the review stage", () => {
    const { rerender } = render(
      <ImportReviewStepper
        state={buildState("review")}
        gate={buildGate()}
        onAdvance={vi.fn()}
        onReviewerNoteChange={vi.fn()}
        onApply={vi.fn()}
      >
        <span data-testid="review-summary">Score: 72 · 6 files · 48 nodes</span>
      </ImportReviewStepper>,
    );
    expect(screen.getByTestId("review-summary")).toBeInTheDocument();

    rerender(
      <ImportReviewStepper
        state={buildState("approve")}
        gate={buildGate()}
        onAdvance={vi.fn()}
        onReviewerNoteChange={vi.fn()}
        onApply={vi.fn()}
      >
        <span data-testid="review-summary">Score: 72 · 6 files · 48 nodes</span>
      </ImportReviewStepper>,
    );
    expect(screen.queryByTestId("review-summary")).not.toBeInTheDocument();
  });

  it("shows 'Applied' on the apply stage with no interactive primary button", () => {
    renderStepper({ state: buildState("apply") });
    expect(screen.getByText("Applied")).toBeInTheDocument();
    expect(
      screen.queryByTestId("import-review-stepper-primary"),
    ).not.toBeInTheDocument();
  });
});

describe("ImportReviewStepper — accessibility", () => {
  it("exposes role='region' with the 'Import review stepper' label", () => {
    renderStepper({ state: buildState("import") });
    const region = screen.getByRole("region", {
      name: "Import review stepper",
    });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("data-testid", "import-review-stepper");
  });
});
