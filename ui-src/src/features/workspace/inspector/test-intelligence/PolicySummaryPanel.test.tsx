import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PolicySummaryPanel } from "./PolicySummaryPanel";
import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { buildPolicyReport, buildValidationReport } from "./test-fixtures";

afterEach(() => {
  cleanup();
});

describe("PolicySummaryPanel", () => {
  it("renders the empty placeholder when neither report is supplied", () => {
    render(<PolicySummaryPanel policy={undefined} validation={undefined} />);
    expect(screen.getByTestId("ti-policy-summary")).toHaveTextContent(
      /No policy or validation report/i,
    );
  });

  it("renders aggregate counts and the profile identity when a policy report is supplied", () => {
    render(
      <PolicySummaryPanel
        policy={buildPolicyReport({
          approvedCount: 3,
          needsReviewCount: 1,
          blockedCount: 0,
        })}
        validation={buildValidationReport()}
      />,
    );
    expect(screen.getByTestId("ti-policy-approved")).toHaveTextContent("3");
    expect(screen.getByTestId("ti-policy-needs-review")).toHaveTextContent("1");
    expect(screen.getByTestId("ti-policy-blocked")).toHaveTextContent("0");
    expect(screen.getByTestId("ti-validation-errors")).toHaveTextContent("0");
    expect(screen.getByTestId("ti-policy-summary")).toHaveTextContent(
      "eu-banking-default",
    );
  });

  it("renders job-level violations when present", () => {
    render(
      <PolicySummaryPanel
        policy={buildPolicyReport({
          jobLevelViolations: [
            {
              rule: "duplicate-fingerprint",
              outcome: "duplicate_test_case",
              severity: "warning",
              reason: "Identical fingerprint detected across two test cases",
            },
          ],
        })}
        validation={undefined}
      />,
    );
    expect(screen.getByTestId("ti-policy-job-violations")).toHaveTextContent(
      "duplicate_test_case",
    );
  });

  it("renders validation issues when validation reports them", () => {
    render(
      <PolicySummaryPanel
        policy={undefined}
        validation={buildValidationReport({
          errorCount: 2,
          blocked: true,
          issues: [
            {
              code: "missing_trace",
              path: "$.testCases[0]",
              severity: "error",
              message: "tc-1 has no Figma trace ref",
              testCaseId: "tc-1",
            },
          ],
        })}
      />,
    );
    expect(screen.getByTestId("ti-validation-issue-list")).toHaveTextContent(
      "missing_trace",
    );
  });

  it("has no blocking a11y violations", async () => {
    const { container } = render(
      <PolicySummaryPanel
        policy={buildPolicyReport()}
        validation={buildValidationReport()}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
