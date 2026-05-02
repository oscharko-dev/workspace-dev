import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { expectNoBlockingAccessibilityViolations } from "../../../../test/accessibility";
import { TestCasesCardGrid } from "./TestCasesCardGrid";
import type { GeneratedTestCase } from "./types";

const baseCase = (
  overrides: Partial<GeneratedTestCase>,
): GeneratedTestCase => ({
  id: "tc-001",
  sourceJobId: "job-1",
  title: "Antrag absenden",
  objective: "User submits the loan application",
  level: "system",
  type: "functional",
  priority: "p1",
  riskCategory: "high",
  technique: "equivalence_partitioning",
  preconditions: [],
  testData: [],
  steps: [],
  expectedResults: [],
  figmaTraceRefs: [],
  assumptions: [],
  openQuestions: [],
  qcMappingPreview: { exportable: true },
  qualitySignals: {
    coveredFieldIds: [],
    coveredActionIds: [],
    coveredValidationIds: [],
    coveredNavigationIds: [],
    confidence: 0.8,
  },
  reviewState: "draft",
  ...overrides,
});

const sampleCases: GeneratedTestCase[] = [
  baseCase({
    id: "tc-001",
    title: "Antrag absenden",
    type: "functional",
    priority: "p0",
    regulatoryRelevance: { domain: "banking", rationale: "BIC field" },
  }),
  baseCase({
    id: "tc-002",
    title: "Police kündigen",
    type: "negative",
    priority: "p1",
    regulatoryRelevance: { domain: "insurance" },
  }),
  baseCase({
    id: "tc-003",
    title: "Profil ändern",
    type: "validation",
    priority: "p2",
  }),
];

afterEach(() => {
  cleanup();
});

describe("TestCasesCardGrid", () => {
  it("renders one card per test case", () => {
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={() => undefined}
      />,
    );
    for (const tc of sampleCases) {
      expect(screen.getByTestId(`ti-test-cases-card-${tc.id}`)).toBeInstanceOf(
        HTMLButtonElement,
      );
    }
  });

  it("renders the regulatoryRelevance domain badge with the correct domain", () => {
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={() => undefined}
      />,
    );
    const banking = screen.getByTestId(
      "ti-test-cases-card-tc-001-domain-badge",
    );
    expect(banking.getAttribute("data-domain")).toBe("banking");
    const insurance = screen.getByTestId(
      "ti-test-cases-card-tc-002-domain-badge",
    );
    expect(insurance.getAttribute("data-domain")).toBe("insurance");
    expect(
      screen.queryByTestId("ti-test-cases-card-tc-003-domain-badge"),
    ).toBeNull();
  });

  it("the banking badge title carries the rationale tooltip", () => {
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={() => undefined}
      />,
    );
    const banking = screen.getByTestId(
      "ti-test-cases-card-tc-001-domain-badge",
    );
    expect(banking.getAttribute("title")).toBe("BIC field");
    expect(banking.getAttribute("aria-label")).toContain("BIC field");
  });

  it("filters by domain chip", () => {
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByTestId("ti-test-cases-card-grid-chip-domain-banking"),
    );
    expect(screen.getByTestId("ti-test-cases-card-tc-001")).toBeInstanceOf(
      HTMLButtonElement,
    );
    expect(screen.queryByTestId("ti-test-cases-card-tc-002")).toBeNull();
    expect(screen.queryByTestId("ti-test-cases-card-tc-003")).toBeNull();
  });

  it("debounces the search input before filtering", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TestCasesCardGrid
          testCases={sampleCases}
          selectedTestCaseId={null}
          onSelect={() => undefined}
          searchDebounceMs={150}
        />,
      );
      const input = screen.getByTestId("ti-test-cases-card-grid-search");
      fireEvent.change(input, { target: { value: "antrag" } });
      // Mid-debounce: still showing all cards.
      expect(screen.getByTestId("ti-test-cases-card-tc-002")).toBeInstanceOf(
        HTMLButtonElement,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(screen.queryByTestId("ti-test-cases-card-tc-002")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the empty state when no card matches", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TestCasesCardGrid
          testCases={sampleCases}
          selectedTestCaseId={null}
          onSelect={() => undefined}
          searchDebounceMs={50}
        />,
      );
      fireEvent.change(screen.getByTestId("ti-test-cases-card-grid-search"), {
        target: { value: "xyzz" },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(
        screen.getByTestId("ti-test-cases-card-grid-empty"),
      ).toBeInstanceOf(HTMLElement);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls onSelect when a card is clicked", () => {
    const onSelect = vi.fn();
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByTestId("ti-test-cases-card-tc-002"));
    expect(onSelect).toHaveBeenCalledWith("tc-002");
  });

  it("expands the selected card to show the objective", () => {
    render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId="tc-001"
        onSelect={() => undefined}
      />,
    );
    const objective = screen.getByTestId("ti-test-cases-card-tc-001-objective");
    expect(objective.textContent).toContain("loan application");
    expect(
      screen.queryByTestId("ti-test-cases-card-tc-002-objective"),
    ).toBeNull();
  });

  it("passes axe accessibility audit", async () => {
    const { container } = render(
      <TestCasesCardGrid
        testCases={sampleCases}
        selectedTestCaseId={null}
        onSelect={() => undefined}
      />,
    );
    await expectNoBlockingAccessibilityViolations(container);
  });
});
