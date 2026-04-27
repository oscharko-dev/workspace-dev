import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { SourceListPanel } from "./source-list-panel";
import type { InspectorSourceRecord } from "./types";

const FIXED_NOW = new Date("2026-04-27T12:00:00.000Z").getTime();

const sources: InspectorSourceRecord[] = [
  {
    sourceId: "jira-primary",
    kind: "jira_paste",
    capturedAt: "2026-04-27T11:00:00.000Z",
    contentHash: "a".repeat(64),
    role: "primary",
    label: "Jira paste PAY-1437",
    authorHandle: "alice",
  },
  {
    sourceId: "custom-note",
    kind: "custom_text",
    capturedAt: "2026-04-27T10:58:00.000Z",
    contentHash: "b".repeat(64),
    role: "supporting",
    label: "Custom text",
    authorHandle: "alice",
    inputFormat: "markdown",
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(FIXED_NOW);
});

describe("SourceListPanel", () => {
  it("renders the empty state when no sources exist", () => {
    render(<SourceListPanel sources={[]} />);
    expect(screen.getByTestId("ti-multisource-source-list")).toHaveTextContent(
      "No sources have been attached to this job yet.",
    );
  });

  it("renders ordered sources with UTC and relative capture times", () => {
    render(<SourceListPanel sources={sources} />);
    expect(screen.getByText("Jira paste PAY-1437")).toBeInTheDocument();
    expect(screen.getByText(/2026-04-27T11:00:00Z/)).toBeInTheDocument();
    expect(screen.getAllByText(/1h ago/)).toHaveLength(2);
    expect(screen.queryByText(/2h ago/)).not.toBeInTheDocument();
  });

  it("copies the full content hash to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });
    render(<SourceListPanel sources={sources} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Copy content hash for Jira paste PAY-1437",
      }),
    );
    expect(writeText).toHaveBeenCalledWith("a".repeat(64));
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Copy content hash for Jira paste PAY-1437",
        }),
      ).toHaveTextContent("Copied");
    });
  });

  it("renders a governance-gated remove action", async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <SourceListPanel sources={sources} canRemove={true} onRemove={onRemove} />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove source Custom text",
      }),
    );
    await waitFor(() => {
      expect(onRemove).toHaveBeenCalledWith("custom-note");
    });
  });

  it("disables source removal without bearer governance", () => {
    render(
      <SourceListPanel sources={sources} canRemove={false} onRemove={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", {
        name: "Remove source Jira paste PAY-1437",
      }),
    ).toBeDisabled();
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(<SourceListPanel sources={sources} />);
    await expectNoBlockingAccessibilityViolations(container);
  });
});
