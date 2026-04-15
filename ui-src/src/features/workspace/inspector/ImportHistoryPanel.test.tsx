import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImportHistoryPanel } from "./ImportHistoryPanel";
import type { PasteImportSession } from "./paste-import-history";

const FIXED_NOW = new Date("2026-04-15T12:00:00Z");

function buildSession(
  overrides: Partial<PasteImportSession> = {},
): PasteImportSession {
  return {
    id: "paste-import-1",
    fileKey: "file-abc",
    nodeId: "1:2",
    nodeName: "HomePage",
    importedAt: FIXED_NOW.toISOString(),
    nodeCount: 10,
    fileCount: 3,
    selectedNodes: [],
    componentMappings: 0,
    version: "1",
    pasteIdentityKey: null,
    jobId: "job-1",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ImportHistoryPanel — empty state", () => {
  it("renders the empty state when there are no sessions", () => {
    render(
      <ImportHistoryPanel
        sessions={[]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("import-history-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No imports yet. Pasted designs will appear here."),
    ).toBeInTheDocument();
  });
});

describe("ImportHistoryPanel — list rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  it("renders one row per session in the order given", () => {
    const sessions = [
      buildSession({ id: "paste-import-1", nodeName: "Home" }),
      buildSession({ id: "paste-import-2", nodeName: "Checkout" }),
      buildSession({ id: "paste-import-3", nodeName: "Profile" }),
    ];
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const rows = screen.getAllByTestId(/^import-history-row-/);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute(
      "data-testid",
      "import-history-row-paste-import-1",
    );
    expect(rows[1]).toHaveAttribute(
      "data-testid",
      "import-history-row-paste-import-2",
    );
    expect(rows[2]).toHaveAttribute(
      "data-testid",
      "import-history-row-paste-import-3",
    );
  });

  it("uses fileKey as the primary label when nodeName is empty", () => {
    const sessions = [
      buildSession({ id: "paste-import-1", nodeName: "", fileKey: "file-xyz" }),
    ];
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("file-xyz")).toBeInTheDocument();
  });

  it("renders node/file metrics when any count is > 0", () => {
    const sessions = [
      buildSession({ id: "paste-import-1", nodeCount: 10, fileCount: 3 }),
    ];
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("10 nodes, 3 files")).toBeInTheDocument();
  });

  it("hides the metrics line when both counts are 0", () => {
    const sessions = [
      buildSession({ id: "paste-import-1", nodeCount: 0, fileCount: 0 }),
    ];
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(/nodes,.*files/)).not.toBeInTheDocument();
  });
});

describe("ImportHistoryPanel — row action callbacks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  it("invokes onReImport with the matching session when Re-import is clicked", () => {
    const sessions = [
      buildSession({ id: "paste-import-a" }),
      buildSession({ id: "paste-import-b" }),
    ];
    const onReImport = vi.fn();
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={onReImport}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByTestId("import-history-reimport-paste-import-b"),
    );

    expect(onReImport).toHaveBeenCalledTimes(1);
    expect(onReImport).toHaveBeenCalledWith(sessions[1]);
  });

  it("invokes onDelete with the matching session when Delete is clicked", () => {
    const sessions = [
      buildSession({ id: "paste-import-a" }),
      buildSession({ id: "paste-import-b" }),
    ];
    const onDelete = vi.fn();
    render(
      <ImportHistoryPanel
        sessions={sessions}
        onReImport={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("import-history-delete-paste-import-a"));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith(sessions[0]);
  });
});

describe("ImportHistoryPanel — close behavior", () => {
  it("invokes onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <ImportHistoryPanel
        sessions={[]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId("import-history-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <ImportHistoryPanel
        sessions={[]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImportHistoryPanel — relative time formatting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  it("shows 'just now' for imports within the last 30 seconds", () => {
    const importedAt = new Date(FIXED_NOW.getTime() - 15_000).toISOString();
    render(
      <ImportHistoryPanel
        sessions={[buildSession({ importedAt })]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("shows minutes for imports 5 minutes old", () => {
    const importedAt = new Date(
      FIXED_NOW.getTime() - 5 * 60 * 1000,
    ).toISOString();
    render(
      <ImportHistoryPanel
        sessions={[buildSession({ importedAt })]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/5 minutes ago/i)).toBeInTheDocument();
  });

  it("shows hours for imports 2 hours old", () => {
    const importedAt = new Date(
      FIXED_NOW.getTime() - 2 * 60 * 60 * 1000,
    ).toISOString();
    render(
      <ImportHistoryPanel
        sessions={[buildSession({ importedAt })]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/2 hours ago/i)).toBeInTheDocument();
  });

  it("shows days for imports 3 days old", () => {
    const importedAt = new Date(
      FIXED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    render(
      <ImportHistoryPanel
        sessions={[buildSession({ importedAt })]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/3 days ago/i)).toBeInTheDocument();
  });

  it("falls back to a locale date string for imports older than 7 days", () => {
    const importedAt = new Date(
      FIXED_NOW.getTime() - 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const expected = new Date(importedAt).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    render(
      <ImportHistoryPanel
        sessions={[buildSession({ importedAt })]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});

describe("ImportHistoryPanel — accessibility", () => {
  it("exposes role='dialog' with the 'Import history' label", () => {
    render(
      <ImportHistoryPanel
        sessions={[]}
        onReImport={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Import history" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("data-testid", "import-history-panel");
  });
});
