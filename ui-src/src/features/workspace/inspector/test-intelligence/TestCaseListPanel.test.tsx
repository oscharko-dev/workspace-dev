import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestCaseListPanel } from "./TestCaseListPanel";
import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { buildTestCase } from "./test-fixtures";

afterEach(() => {
  cleanup();
});

describe("TestCaseListPanel — empty state", () => {
  it("renders the empty placeholder when no entries are present", () => {
    render(
      <TestCaseListPanel
        entries={[]}
        selectedTestCaseId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-test-case-list-empty")).toBeInTheDocument();
  });
});

describe("TestCaseListPanel — listing", () => {
  it("renders one row per entry with the right testIDs", () => {
    render(
      <TestCaseListPanel
        entries={[
          {
            testCase: buildTestCase({ id: "tc-1" }),
            policyBlocked: false,
            approverCount: 0,
            reviewState: "needs_review",
            policyDecision: "needs_review",
          },
          {
            testCase: buildTestCase({
              id: "tc-2",
              title: "Reject the user when password is empty",
            }),
            policyBlocked: false,
            approverCount: 0,
            reviewState: "approved",
            policyDecision: "approved",
          },
        ]}
        selectedTestCaseId="tc-2"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-test-case-row-tc-1")).toBeInTheDocument();
    expect(screen.getByTestId("ti-test-case-row-tc-2")).toBeInTheDocument();
    expect(
      screen.getByTestId("ti-test-case-row-tc-2").getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByTestId("ti-test-case-row-tc-1").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("invokes onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <TestCaseListPanel
        entries={[
          {
            testCase: buildTestCase({ id: "tc-1" }),
            policyBlocked: false,
            approverCount: 0,
          },
        ]}
        selectedTestCaseId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("ti-test-case-row-tc-1"));
    expect(onSelect).toHaveBeenCalledWith("tc-1");
  });

  it("flags policy-blocked rows with a data attribute", () => {
    render(
      <TestCaseListPanel
        entries={[
          {
            testCase: buildTestCase({ id: "tc-1" }),
            policyBlocked: true,
            policyDecision: "blocked",
            approverCount: 0,
          },
        ]}
        selectedTestCaseId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen
        .getByTestId("ti-test-case-row-tc-1")
        .getAttribute("data-policy-blocked"),
    ).toBe("true");
  });

  it("renders approver count when above zero", () => {
    render(
      <TestCaseListPanel
        entries={[
          {
            testCase: buildTestCase({ id: "tc-1" }),
            policyBlocked: false,
            approverCount: 2,
          },
        ]}
        selectedTestCaseId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("ti-test-case-approvers-tc-1").textContent).toBe(
      "2 approvers",
    );
  });
});

describe("TestCaseListPanel — accessibility", () => {
  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <TestCaseListPanel
        entries={[
          {
            testCase: buildTestCase({ id: "tc-1" }),
            policyBlocked: false,
            approverCount: 0,
            reviewState: "needs_review",
          },
        ]}
        selectedTestCaseId="tc-1"
        onSelect={vi.fn()}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
