import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InspectorBootstrap } from "./InspectorBootstrap";
import type { InspectorBootstrapState } from "./inspector-bootstrap-state";

afterEach(() => {
  cleanup();
});

function renderBootstrap({
  state,
  onPaste = vi.fn(),
  onRetry = vi.fn(),
}: {
  state: InspectorBootstrapState;
  onPaste?: (text: string) => void;
  onRetry?: () => void;
}): void {
  render(
    <MemoryRouter>
      <InspectorBootstrap state={state} onPaste={onPaste} onRetry={onRetry} />
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
      screen.getByText(/unsupported file\. please drop a \.json file/i),
    ).toBeInTheDocument();
  });

  it("shows EMPTY_INPUT error message", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "EMPTY_INPUT", retryable: true },
    });

    expect(
      screen.getByText(/please paste or drop a figma json export/i),
    ).toBeInTheDocument();
  });

  it("shows PasteExample snippet in the center column when failed", () => {
    renderBootstrap({
      state: { kind: "failed", reason: "INVALID_PAYLOAD", retryable: true },
    });

    const center = screen.getByTestId("inspector-bootstrap-center");
    expect(center).toHaveTextContent(/schemaVersion/);
  });
});

describe("InspectorBootstrap — paste wiring", () => {
  it("forwards paste events to onPaste", () => {
    const onPaste = vi.fn();
    renderBootstrap({ state: { kind: "idle" }, onPaste });

    const textarea = screen.getByLabelText(/figma json paste target/i);
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
