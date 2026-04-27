import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { ConflictResolutionPanel } from "./conflict-resolution-panel";
import type {
  InspectorConflictDecisionSnapshot,
  InspectorSourceRecord,
  MultiSourceConflict,
} from "./types";

const sourceRefs: InspectorSourceRecord[] = [
  {
    sourceId: "figma-primary",
    kind: "figma_local_json",
    capturedAt: "2026-04-27T10:00:00.000Z",
    contentHash: "a".repeat(64),
    role: "primary",
    label: "Figma local JSON",
  },
  {
    sourceId: "jira-primary",
    kind: "jira_paste",
    capturedAt: "2026-04-27T10:05:00.000Z",
    contentHash: "b".repeat(64),
    role: "primary",
    label: "Jira paste PAY-1437",
  },
];

const conflicts: MultiSourceConflict[] = [
  {
    conflictId: "conflict-title",
    kind: "title",
    participatingSourceIds: ["figma-primary", "jira-primary"],
    normalizedValues: ["Login", "Sign in"],
    resolution: "deferred_to_reviewer",
    detail: "Titles diverged across sources.",
  },
  {
    conflictId: "conflict-priority",
    kind: "priority",
    participatingSourceIds: ["jira-primary"],
    normalizedValues: ["p1"],
    resolution: "deferred_to_reviewer",
  },
];

const decisions: Record<string, InspectorConflictDecisionSnapshot> = {
  "conflict-title": {
    conflictId: "conflict-title",
    state: "approved",
    lastEventId: "evt-1",
    lastEventAt: "2026-04-27T12:00:00.000Z",
    actor: "alice",
    selectedSourceId: "jira-primary",
  },
};

afterEach(() => {
  cleanup();
});

describe("ConflictResolutionPanel", () => {
  it("renders the empty state when no conflicts are present", () => {
    render(
      <ConflictResolutionPanel
        conflicts={[]}
        sourceRefs={sourceRefs}
        decisions={undefined}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-multisource-conflicts")).toHaveTextContent(
      "No multi-source conflicts were emitted for this job.",
    );
  });

  it("filters conflicts by kind", () => {
    render(
      <ConflictResolutionPanel
        conflicts={conflicts}
        sourceRefs={sourceRefs}
        decisions={decisions}
        onResolve={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Filter conflicts by kind"), {
      target: { value: "priority" },
    });
    expect(screen.queryByText("Titles diverged across sources.")).not.toBeInTheDocument();
    expect(screen.getByText("conflict-p")).toBeInTheDocument();
  });

  it("submits reviewer approval with the selected source id", async () => {
    const onResolve = vi.fn().mockResolvedValue(undefined);
    render(
      <ConflictResolutionPanel
        conflicts={conflicts}
        sourceRefs={sourceRefs}
        decisions={decisions}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Approve jira-primary for conflict-title",
      }),
    );
    await waitFor(() => {
      expect(onResolve).toHaveBeenCalledWith({
        conflictId: "conflict-title",
        action: "approve",
        selectedSourceId: "jira-primary",
      });
    });
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <ConflictResolutionPanel
        conflicts={conflicts}
        sourceRefs={sourceRefs}
        decisions={decisions}
        onResolve={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
