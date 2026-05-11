import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StaleDraftWarning } from "./StaleDraftWarning";
import type { StaleDraftCheckResult } from "./inspector-override-draft";

const makeStaleDraftResult = (overrides?: Partial<StaleDraftCheckResult>): StaleDraftCheckResult => ({
  stale: true,
  latestJobId: "job-latest-1",
  sourceJobId: "job-source-1",
  boardKey: "board-abc",
  carryForwardAvailable: false,
  unmappedNodeIds: [],
  message: "A newer job exists for this board.",
  ...overrides
});

describe("StaleDraftWarning", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the stale draft warning alert", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult()}
        onDecision={onDecision}
      />
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Stale draft detected")).toBeDefined();
    expect(screen.getByText("A newer job exists for this board.")).toBeDefined();
  });

  it("renders continue and discard buttons", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult()}
        onDecision={onDecision}
      />
    );

    expect(screen.getByRole("button", { name: "Continue with original" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeDefined();
  });

  it("does not render carry-forward button when not available", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({ carryForwardAvailable: false })}
        onDecision={onDecision}
      />
    );

    expect(screen.queryByRole("button", { name: "Carry forward to latest" })).toBeNull();
  });

  it("renders carry-forward button when available", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({ carryForwardAvailable: true })}
        onDecision={onDecision}
      />
    );

    expect(screen.getByRole("button", { name: "Carry forward to latest" })).toBeDefined();
  });

  it("fires 'continue' decision when continue button is clicked", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult()}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with original" }));
    expect(onDecision).toHaveBeenCalledWith("continue");
  });

  it("fires 'discard' decision when discard button is clicked", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult()}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDecision).toHaveBeenCalledWith("discard");
  });

  it("fires 'carry-forward' decision when carry-forward button is clicked", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({ carryForwardAvailable: true })}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Carry forward to latest" }));
    expect(onDecision).toHaveBeenCalledWith("carry-forward");
  });

  it("renders remap guidance when unmapped nodes block carry-forward", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({
          carryForwardAvailable: false,
          unmappedNodeIds: ["node-1"]
        })}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Suggest remaps" }));
    expect(onDecision).toHaveBeenCalledWith("remap");
  });

  it("shows the remap loading state and disables the remap action while pending", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({
          carryForwardAvailable: false,
          unmappedNodeIds: ["node-1"]
        })}
        onDecision={onDecision}
        remapPending
      />
    );

    const button = screen.getByRole("button", { name: "Loading suggestions…" });
    expect(button).toBeDisabled();
  });

  it("shows unmapped node count when nodes are unresolvable", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({
          unmappedNodeIds: ["node-1", "node-2", "node-3"]
        })}
        onDecision={onDecision}
      />
    );

    expect(screen.getByText("3 node(s) could not be mapped to the latest output.")).toBeDefined();
  });

  it("disables all buttons when disabled prop is true", () => {
    const onDecision = vi.fn();
    render(
      <StaleDraftWarning
        checkResult={makeStaleDraftResult({ carryForwardAvailable: true })}
        onDecision={onDecision}
        disabled
      />
    );

    const buttons = screen.getAllByRole("button");
    for (const button of buttons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
