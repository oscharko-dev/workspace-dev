import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoBlockingAccessibilityViolations } from "../../../test/accessibility";
import { InspectorBootstrap } from "./InspectorBootstrap";
import type { InspectorBootstrapState } from "./inspector-bootstrap-state";

afterEach(() => {
  cleanup();
});

function renderBootstrap({
  state,
  onPaste = vi.fn(),
  onRetry = vi.fn(),
  onFigmaUrl = vi.fn(),
  availablePipelines,
  selectedPipelineId,
  onPipelineIdChange = vi.fn(),
}: {
  state: InspectorBootstrapState;
  onPaste?: (text: string) => void;
  onRetry?: () => void;
  onFigmaUrl?: (fileKey: string, nodeId: string | null) => void;
  availablePipelines?: Array<{ id: string; displayName: string }>;
  selectedPipelineId?: string;
  onPipelineIdChange?: (pipelineId: string) => void;
}): void {
  render(
    <MemoryRouter>
      <InspectorBootstrap
        state={state}
        onPaste={onPaste}
        onRetry={onRetry}
        onFigmaUrl={onFigmaUrl}
        availablePipelines={availablePipelines}
        selectedPipelineId={selectedPipelineId}
        onPipelineIdChange={onPipelineIdChange}
      />
    </MemoryRouter>,
  );
}

describe("InspectorBootstrap — layout", () => {
  it("renders a three-column shell and the bootstrap test id", () => {
    renderBootstrap({ state: { kind: "idle" } });

    expect(screen.getByTestId("inspector-bootstrap")).toBeInTheDocument();
    expect(screen.getByTestId("inspector-bootstrap-left")).toBeInTheDocument();
    expect(
      screen.getByTestId("inspector-bootstrap-center"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("inspector-bootstrap-right")).toBeInTheDocument();
  });

  it("renders the header with a disabled Back link and the Inspector title", () => {
    renderBootstrap({ state: { kind: "idle" } });

    expect(screen.getByText("Inspector")).toBeInTheDocument();
  });

  it("does not render the disabled Review/Sync/PR/Coverage placeholder buttons", () => {
    renderBootstrap({ state: { kind: "idle" } });

    for (const label of ["Review", "Sync", "PR", "Coverage"]) {
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("renders a pipeline selector only when more than one pipeline is available", () => {
    renderBootstrap({
      state: { kind: "idle" },
      availablePipelines: [{ id: "pipe-a", displayName: "Pipeline A" }],
      selectedPipelineId: "pipe-a",
    });

    expect(screen.queryByLabelText("Pipeline")).not.toBeInTheDocument();

    cleanup();

    const onPipelineIdChange = vi.fn();
    renderBootstrap({
      state: { kind: "idle" },
      availablePipelines: [
        { id: "pipe-a", displayName: "Pipeline A" },
        { id: "pipe-b", displayName: "Pipeline B" },
      ],
      selectedPipelineId: "pipe-a",
      onPipelineIdChange,
    });

    const selector = screen.getByLabelText("Pipeline");
    expect(selector).toBeInTheDocument();

    fireEvent.change(selector, { target: { value: "pipe-b" } });
    expect(onPipelineIdChange).toHaveBeenCalledWith("pipe-b");
  });
});

describe("InspectorBootstrap — state-aware copy", () => {
  it("shows idle copy when idle", () => {
    renderBootstrap({ state: { kind: "idle" } });

    expect(
      screen.getAllByText(/waiting for import/i).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows focused copy when focused", () => {
    renderBootstrap({ state: { kind: "focused" } });

    expect(
      screen.getAllByText(/waiting for import/i).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows pasting copy when pasting — center says Pasting, left/right say Submitting", () => {
    renderBootstrap({ state: { kind: "pasting" } });

    const center = screen.getByTestId("inspector-bootstrap-center");
    const left = screen.getByTestId("inspector-bootstrap-left");
    expect(center).toHaveTextContent(/pasting/i);
    expect(left).toHaveTextContent(/submitting import/i);
  });

  it("shows queued copy when queued — center says Import queued", () => {
    renderBootstrap({ state: { kind: "queued", jobId: "job-1" } });

    const center = screen.getByTestId("inspector-bootstrap-center");
    expect(center).toHaveTextContent(/import queued/i);
    expect(screen.getAllByText(/queued/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows processing copy when processing, distinct left/right", () => {
    renderBootstrap({ state: { kind: "processing", jobId: "job-1" } });

    const left = screen.getByTestId("inspector-bootstrap-left");
    const right = screen.getByTestId("inspector-bootstrap-right");
    expect(left).toHaveTextContent(/mapping/i);
    expect(right).toHaveTextContent(/generating code/i);
  });

  it("shows failed copy when failed", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "SCHEMA_MISMATCH", retryable: false },
    });

    expect(screen.getAllByText(/import failed/i).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("shows the updated size limit when the payload is too large", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "TOO_LARGE", retryable: false },
    });

    expect(screen.getByText(/limit is 6 MiB/i)).toBeInTheDocument();
  });

  it("shows SECURE_CONTEXT_MISSING error message", () => {
    renderBootstrap({
      state: {
        kind: "failed",
        reason: "SECURE_CONTEXT_MISSING",
        retryable: false,
      },
    });

    expect(
      screen.getByText(/clipboard access requires a secure/i),
    ).toBeInTheDocument();
  });

  it("shows UNSUPPORTED_FILE error message", () => {
    renderBootstrap({
      state: {
        kind: "failed",
        reason: "UNSUPPORTED_FILE",
        retryable: true,
      },
    });

    expect(
      screen.getByText(
        /unsupported file\. please drop or upload a \.json file/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows EMPTY_INPUT error message", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "EMPTY_INPUT", retryable: true },
    });

    expect(
      screen.getByText(/please paste, drop, or upload a figma json export/i),
    ).toBeInTheDocument();
  });

  it("shows UNSUPPORTED_FORMAT error message", () => {
    renderBootstrap({
      state: {
        kind: "failed",
        reason: "UNSUPPORTED_FORMAT",
        retryable: false,
      },
    });

    expect(
      screen.getByText(/clipboard envelope version is not supported yet/i),
    ).toBeInTheDocument();
  });

  it("shows PasteExample snippet in the center column when failed", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "INVALID_PAYLOAD", retryable: true },
    });

    const center = screen.getByTestId("inspector-bootstrap-center");
    expect(center).toHaveTextContent(/schemaVersion/);
  });

  it("has no blocking accessibility violations in a retryable failure state", async () => {
    renderBootstrap({
      state: { kind: "failed", reason: "SUBMIT_FAILED", retryable: true },
    });

    await expectNoBlockingAccessibilityViolations(
      screen.getByTestId("inspector-bootstrap"),
    );
  });
});

describe("InspectorBootstrap — paste wiring", () => {
  it("forwards paste events to onPaste", () => {
    const onPaste = vi.fn();
    renderBootstrap({ state: { kind: "idle" }, onPaste });

    const textarea = screen.getByLabelText(/figma clipboard paste target/i);
    const clipboardData = {
      getData: (type: string) =>
        type === "text" || type === "text/plain" ? '{"doc":true}' : "",
    } as unknown as DataTransfer;
    fireEvent.paste(textarea, { clipboardData });

    expect(onPaste).toHaveBeenCalledWith('{"doc":true}');
  });

  it("disables paste capture while pasting/queued/processing/ready", () => {
    const states: InspectorBootstrapState[] = [
      { kind: "pasting" },
      { kind: "queued", jobId: "j" },
      { kind: "processing", jobId: "j" },
      { kind: "ready", jobId: "j", previewUrl: "http://x" },
    ];
    for (const state of states) {
      cleanup();
      renderBootstrap({ state });
      const textarea = screen.getByLabelText(/figma json paste target/i);
      expect(textarea).toBeDisabled();
    }
  });
});

describe("InspectorBootstrap — PasteDropZone integration", () => {
  it("renders PasteDropZone in idle state with Figma URL input", () => {
    renderBootstrap({ state: { kind: "idle" } });

    expect(
      screen.getByLabelText(/figma clipboard paste target/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/figma design url/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open design/i }),
    ).toBeInTheDocument();
  });

  it("calls onFigmaUrl when a valid Figma URL is submitted", () => {
    const onFigmaUrl = vi.fn();
    render(
      <MemoryRouter>
        <InspectorBootstrap
          state={{ kind: "idle" }}
          onPaste={vi.fn()}
          onRetry={vi.fn()}
          onFigmaUrl={onFigmaUrl}
        />
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/figma design url/i);
    fireEvent.change(input, {
      target: {
        value: "https://figma.com/design/ABC123/My-Design?node-id=1-2",
      },
    });
    fireEvent.submit(input.closest("form")!);

    expect(onFigmaUrl).toHaveBeenCalledWith("ABC123", "1-2");
  });
});

describe("InspectorBootstrap — retry", () => {
  it("renders a Try again button only when failed and retryable", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "SUBMIT_FAILED", retryable: true },
    });

    expect(screen.getByRole("button", { name: /try again/i })).toBeVisible();
  });

  it("does not render the Try again button when failed but not retryable", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "SCHEMA_MISMATCH", retryable: false },
    });

    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onRetry when Try again is clicked", () => {
    const onRetry = vi.fn();
    renderBootstrap({
      state: { kind: "failed", reason: "SUBMIT_FAILED", retryable: true },
      onRetry,
    });

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
