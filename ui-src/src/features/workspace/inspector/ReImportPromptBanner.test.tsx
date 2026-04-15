import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReImportPromptBanner } from "./ReImportPromptBanner";
import type { PasteImportSession } from "./paste-import-history";

afterEach(() => {
  cleanup();
});

function makeSession(
  overrides: Partial<PasteImportSession> = {},
): PasteImportSession {
  return {
    id: "paste-import-1000",
    fileKey: "file-key-1",
    nodeId: "1:2",
    nodeName: "HomePage",
    importedAt: "2026-04-15T10:00:00.000Z",
    nodeCount: 42,
    fileCount: 7,
    selectedNodes: [],
    scope: "all",
    componentMappings: 3,
    version: "",
    pasteIdentityKey: null,
    jobId: "job-1",
    ...overrides,
  };
}

describe("ReImportPromptBanner — rendering", () => {
  it("renders the message containing the locale-stable date", () => {
    const session = makeSession({ importedAt: "2026-04-15T10:00:00.000Z" });
    const expectedLabel = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(session.importedAt));
    render(
      <ReImportPromptBanner
        previousSession={session}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const banner = screen.getByTestId("reimport-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent ?? "").toContain(expectedLabel);
    expect(banner.textContent ?? "").toContain(
      "This design was previously imported on",
    );
  });
});

describe("ReImportPromptBanner — interactions", () => {
  it("invokes onRegenerateChanged when the changed button is clicked", () => {
    const onRegenerateChanged = vi.fn();
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={onRegenerateChanged}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("reimport-regenerate-changed"));

    expect(onRegenerateChanged).toHaveBeenCalledTimes(1);
  });

  it("invokes onRegenerateSelected when the selected button is clicked", () => {
    const onRegenerateSelected = vi.fn();
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={onRegenerateSelected}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
        changedCount={3}
        selectedChangedCount={2}
        keepExistingCount={1}
      />,
    );

    fireEvent.click(screen.getByTestId("reimport-regenerate-selected"));

    expect(onRegenerateSelected).toHaveBeenCalledTimes(1);
  });

  it("invokes onCreateNew when the Create new button is clicked", () => {
    const onCreateNew = vi.fn();
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={onCreateNew}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("reimport-create-new"));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("invokes onDismiss when the dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByTestId("reimport-dismiss"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not invoke any action buttons when the dismiss button is clicked", () => {
    const onRegenerateChanged = vi.fn();
    const onRegenerateSelected = vi.fn();
    const onCreateNew = vi.fn();
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={onRegenerateChanged}
        onRegenerateSelected={onRegenerateSelected}
        onCreateNew={onCreateNew}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("reimport-dismiss"));

    expect(onRegenerateChanged).not.toHaveBeenCalled();
    expect(onRegenerateSelected).not.toHaveBeenCalled();
    expect(onCreateNew).not.toHaveBeenCalled();
  });

  it("disables regenerate selected when no changed components are selected", () => {
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
        changedCount={3}
        selectedChangedCount={0}
        keepExistingCount={3}
      />,
    );

    expect(screen.getByTestId("reimport-regenerate-selected")).toBeDisabled();
    expect(screen.getByTestId("reimport-selection-hint")).toHaveTextContent(
      "3 changed components will keep existing code.",
    );
  });
});

describe("ReImportPromptBanner — accessibility", () => {
  it("has role='status' with aria-live and a non-empty aria-label", () => {
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const banner = screen.getByTestId("reimport-banner");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveAttribute("aria-live", "polite");
    const label = banner.getAttribute("aria-label") ?? "";
    expect(label.length).toBeGreaterThan(0);
  });

  it("exposes the dismiss button with aria-label 'Dismiss'", () => {
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    expect(dismiss).toHaveAttribute("data-testid", "reimport-dismiss");
  });

  it("renders the diff hint when deltaSummary has changed nodes", () => {
    render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
        deltaSummary={{
          totalNodes: 30,
          nodesReused: 18,
          nodesReprocessed: 12,
        }}
      />,
    );

    expect(
      screen.getByTestId("reimport-diff-hint").textContent ?? "",
    ).toContain("12 of 30");
  });

  it("omits the diff hint when deltaSummary is null or empty", () => {
    const { rerender } = render(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
        deltaSummary={null}
      />,
    );
    expect(screen.queryByTestId("reimport-diff-hint")).toBeNull();

    rerender(
      <ReImportPromptBanner
        previousSession={makeSession()}
        onRegenerateChanged={vi.fn()}
        onRegenerateSelected={vi.fn()}
        onCreateNew={vi.fn()}
        onDismiss={vi.fn()}
        deltaSummary={{ totalNodes: 0, nodesReused: 0, nodesReprocessed: 0 }}
      />,
    );
    expect(screen.queryByTestId("reimport-diff-hint")).toBeNull();
  });
});
