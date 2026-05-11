import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { JobHistoryStrip } from "./JobHistoryStrip";
import type { TestIntelligenceJobSummary } from "./types";

const summary = (
  jobId: string,
  hasArtifacts: Record<string, boolean> = {},
): TestIntelligenceJobSummary => ({
  jobId,
  hasArtifacts: {
    generatedTestCases: false,
    validationReport: false,
    policyReport: false,
    coverageReport: false,
    visualSidecarReport: false,
    qcMappingPreview: false,
    exportReport: false,
    reviewSnapshot: false,
    reviewEvents: false,
    multiSourceReconciliation: false,
    ...hasArtifacts,
  },
});

afterEach(() => {
  cleanup();
});

describe("JobHistoryStrip", () => {
  it("renders the empty state when no jobs are passed in", () => {
    render(
      <JobHistoryStrip
        jobs={[]}
        selectedJobId={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByTestId("ti-job-history-strip-empty")).toBeInstanceOf(
      HTMLElement,
    );
  });

  it("renders one row per job (newest first)", () => {
    render(
      <JobHistoryStrip
        jobs={[summary("job-001"), summary("job-002"), summary("job-003")]}
        selectedJobId={null}
        onSelect={() => undefined}
      />,
    );
    const list = screen.getByTestId("ti-job-history-strip-list");
    expect(list.children).toHaveLength(3);
    const firstRow = screen.getByTestId("ti-job-history-strip-row-job-003");
    expect(firstRow).toBeInstanceOf(HTMLButtonElement);
  });

  it("respects the limit prop", () => {
    const jobs = Array.from({ length: 15 }, (_, i) =>
      summary(`job-${String(i).padStart(3, "0")}`),
    );
    render(
      <JobHistoryStrip
        jobs={jobs}
        selectedJobId={null}
        onSelect={() => undefined}
        limit={5}
      />,
    );
    const list = screen.getByTestId("ti-job-history-strip-list");
    expect(list.children).toHaveLength(5);
  });

  it("shows the green ready icon for jobs with the generated-test-cases artifact", () => {
    render(
      <JobHistoryStrip
        jobs={[summary("ready-job", { generatedTestCases: true })]}
        selectedJobId={null}
        onSelect={() => undefined}
      />,
    );
    const row = screen.getByTestId("ti-job-history-strip-row-ready-job");
    expect(
      row.querySelector('[data-testid="ti-job-history-strip-status-ready"]'),
    ).not.toBeNull();
  });

  it("shows the pending dot when generated-test-cases is missing", () => {
    render(
      <JobHistoryStrip
        jobs={[summary("pending-job", { policyReport: true })]}
        selectedJobId={null}
        onSelect={() => undefined}
      />,
    );
    const row = screen.getByTestId("ti-job-history-strip-row-pending-job");
    expect(
      row.querySelector('[data-testid="ti-job-history-strip-status-pending"]'),
    ).not.toBeNull();
  });

  it("shows the artifact-count badge", () => {
    render(
      <JobHistoryStrip
        jobs={[
          summary("count-job", {
            generatedTestCases: true,
            policyReport: true,
            coverageReport: true,
          }),
        ]}
        selectedJobId={null}
        onSelect={() => undefined}
      />,
    );
    const badge = screen.getByTestId(
      "ti-job-history-strip-row-count-job-artifacts",
    );
    expect(badge.textContent).toBe("3/10");
    expect(badge.getAttribute("aria-label")).toContain("3 of 10");
  });

  it("calls onSelect with the job id when a row is clicked", () => {
    const onSelect = vi.fn();
    render(
      <JobHistoryStrip
        jobs={[summary("alpha"), summary("beta")]}
        selectedJobId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("ti-job-history-strip-row-alpha"));
    expect(onSelect).toHaveBeenCalledWith("alpha");
  });

  it("marks the selected row with aria-pressed=true", () => {
    render(
      <JobHistoryStrip
        jobs={[summary("alpha"), summary("beta")]}
        selectedJobId="alpha"
        onSelect={() => undefined}
      />,
    );
    const selected = screen.getByTestId("ti-job-history-strip-row-alpha");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    const other = screen.getByTestId("ti-job-history-strip-row-beta");
    expect(other.getAttribute("aria-pressed")).toBe("false");
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(
      <JobHistoryStrip
        jobs={[summary("alpha", { generatedTestCases: true }), summary("beta")]}
        selectedJobId="alpha"
        onSelect={() => undefined}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
