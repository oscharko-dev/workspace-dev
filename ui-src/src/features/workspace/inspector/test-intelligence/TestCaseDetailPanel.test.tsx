import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestCaseDetailPanel } from "./TestCaseDetailPanel";
import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import {
  buildQcMappingPreview,
  buildReviewSnapshotEntry,
  buildTestCase,
  buildVisualSidecarReport,
} from "./test-fixtures";

afterEach(() => {
  cleanup();
});

const baseProps = {
  testCase: buildTestCase(),
  reviewSnapshot: buildReviewSnapshotEntry(),
  policyDecision: "needs_review" as const,
  policyViolations: [],
  bearerTokenAvailable: true,
  pendingAction: null,
  actionError: null,
  reviewerHandle: "alice",
  visualRecords: [] as const,
  fourEyesEnforced: false,
  approvers: [] as string[],
};

describe("TestCaseDetailPanel — content rendering", () => {
  it("renders title, objective, preconditions, steps, expected results, and figma trace", () => {
    render(<TestCaseDetailPanel {...baseProps} onAction={vi.fn()} />);
    expect(screen.getByTestId("ti-detail-preconditions")).toHaveTextContent(
      "User has an active account",
    );
    expect(screen.getByTestId("ti-detail-steps")).toHaveTextContent(
      "Open the login form",
    );
    expect(screen.getByTestId("ti-detail-expected-results")).toHaveTextContent(
      "The user is authenticated",
    );
    expect(screen.getByTestId("ti-detail-figma-trace")).toHaveTextContent(
      "screen-login",
    );
  });

  it("renders the four-eyes notice when enforced", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        fourEyesEnforced
        onAction={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("ti-detail-four-eyes-notice"),
    ).toBeInTheDocument();
  });

  it("renders policy violations when present", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        policyDecision="blocked"
        policyViolations={[
          {
            rule: "missing-trace",
            outcome: "missing_trace",
            severity: "error",
            reason: "No trace ref recorded",
            path: "$.testCases[0]",
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("ti-detail-policy-violations"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("ti-detail-policy-violation-0"),
    ).toHaveTextContent("missing_trace");
  });

  it("renders linked visual observations and QC provenance", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        visualRecords={
          buildVisualSidecarReport({
            records: [
              {
                screenId: "screen-login",
                deployment: "phi-4-multimodal-poc",
                outcomes: ["fallback_used", "low_confidence"],
                issues: [
                  {
                    code: "ambiguous_claim",
                    severity: "warning",
                    message: "Sidecar confidence below threshold",
                    path: "$.screens[0]",
                    testCaseId: "tc-1",
                  },
                ],
                meanConfidence: 0.55,
              },
            ],
          }).records
        }
        qcMappingEntry={buildQcMappingPreview().entries[0]!}
        onAction={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("ti-detail-visual-observations"),
    ).toHaveTextContent("visual_sidecar");
    expect(
      screen.getByTestId("ti-detail-visual-record-screen-login"),
    ).toHaveTextContent("phi-4-multimodal-poc");
    expect(
      screen.getByTestId("ti-detail-qc-visual-provenance"),
    ).toHaveTextContent("abcdef123456");
  });
});

describe("TestCaseDetailPanel — actions", () => {
  it("disables every action when bearer token is missing", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        bearerTokenAvailable={false}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toBeDisabled();
    expect(screen.getByTestId("ti-detail-action-reject")).toBeDisabled();
    expect(
      screen.getByTestId("ti-detail-action-needs-clarification"),
    ).toBeDisabled();
    expect(screen.getByTestId("ti-detail-actions-disabled")).toHaveTextContent(
      /bearer token/i,
    );
  });

  it("disables approve when policy is blocked", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        policyDecision="blocked"
        policyViolations={[
          {
            rule: "missing-trace",
            outcome: "missing_trace",
            severity: "error",
            reason: "No trace ref",
          },
        ]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toBeDisabled();
    expect(screen.getByTestId("ti-detail-actions-disabled")).toHaveTextContent(
      /policy violations/i,
    );
  });

  it("invokes onAction with approve when the approve button is clicked", () => {
    const onAction = vi.fn();
    render(<TestCaseDetailPanel {...baseProps} onAction={onAction} />);
    fireEvent.click(screen.getByTestId("ti-detail-action-approve"));
    expect(onAction).toHaveBeenCalledWith({ action: "approve" });
  });

  it("attaches the typed note when present and clears the textarea on submit", () => {
    const onAction = vi.fn();
    render(<TestCaseDetailPanel {...baseProps} onAction={onAction} />);
    const textarea = screen.getByTestId(
      "ti-detail-note-input",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByTestId("ti-detail-action-approve"));
    expect(onAction).toHaveBeenCalledWith({
      action: "approve",
      note: "Looks good",
    });
    expect(textarea.value).toBe("");
  });

  it("disables the standalone note button until a note is typed", () => {
    render(<TestCaseDetailPanel {...baseProps} onAction={vi.fn()} />);
    expect(screen.getByTestId("ti-detail-action-note")).toBeDisabled();
    fireEvent.change(screen.getByTestId("ti-detail-note-input"), {
      target: { value: "Need more info" },
    });
    expect(screen.getByTestId("ti-detail-action-note")).not.toBeDisabled();
  });

  it("renders the inline action error when supplied", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        actionError="UNAUTHORIZED: token rejected"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-actions-error")).toHaveTextContent(
      "token rejected",
    );
  });
});

describe("TestCaseDetailPanel — four-eyes (Issue #1376)", () => {
  it("renders enforcement reasons and the awaiting-secondary message after a primary approval", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        fourEyesEnforced
        fourEyesReasons={["risk_category", "visual_low_confidence"]}
        primaryReviewer="alice"
        reviewSnapshot={buildReviewSnapshotEntry({
          state: "pending_secondary_approval",
          fourEyesEnforced: true,
          approvers: ["alice"],
        })}
        reviewerHandle="bob"
        approvers={["alice"]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-four-eyes-notice")).toHaveTextContent(
      /Four-eyes review enforced/i,
    );
    expect(screen.getByTestId("ti-detail-four-eyes-reasons")).toHaveTextContent(
      "risk_category, visual_low_confidence",
    );
    expect(screen.getByTestId("ti-detail-four-eyes-primary")).toHaveTextContent(
      "alice",
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toHaveTextContent(
      /Approve as second reviewer/i,
    );
  });

  it("disables the approve button when the reviewer is the same as the primary", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        fourEyesEnforced
        primaryReviewer="alice"
        reviewSnapshot={buildReviewSnapshotEntry({
          state: "pending_secondary_approval",
          fourEyesEnforced: true,
          approvers: ["alice"],
        })}
        reviewerHandle="alice"
        approvers={["alice"]}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toBeDisabled();
    expect(screen.getByTestId("ti-detail-actions-disabled")).toHaveTextContent(
      /different reviewer/i,
    );
  });

  it("disables the approve button when the reviewer is the most recent editor", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        fourEyesEnforced
        lastEditor="alice"
        reviewSnapshot={buildReviewSnapshotEntry({
          state: "needs_review",
          fourEyesEnforced: true,
        })}
        reviewerHandle="alice"
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toBeDisabled();
  });

  it("renders the first-reviewer label before any approval", () => {
    render(
      <TestCaseDetailPanel
        {...baseProps}
        fourEyesEnforced
        reviewSnapshot={buildReviewSnapshotEntry({
          state: "needs_review",
          fourEyesEnforced: true,
        })}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-detail-action-approve")).toHaveTextContent(
      /Approve as first reviewer/i,
    );
  });
});

describe("TestCaseDetailPanel — accessibility", () => {
  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <TestCaseDetailPanel {...baseProps} onAction={vi.fn()} />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
