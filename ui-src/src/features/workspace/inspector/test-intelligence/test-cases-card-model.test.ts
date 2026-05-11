import { describe, expect, it } from "vitest";

import { buildEmptyFilter, filterTestCases } from "./test-cases-card-model";
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

describe("filterTestCases", () => {
  const cases: GeneratedTestCase[] = [
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
      objective: "Cancel an active policy",
      type: "negative",
      priority: "p1",
      regulatoryRelevance: { domain: "insurance" },
    }),
    baseCase({
      id: "tc-003",
      title: "Profil ändern",
      objective: "Edit account profile",
      type: "validation",
      priority: "p2",
    }),
  ];

  it("returns all cases when the filter is empty", () => {
    expect(filterTestCases(cases, buildEmptyFilter())).toHaveLength(3);
  });

  it("filters by query against title", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      query: "antrag",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-001"]);
  });

  it("filters by query against objective", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      query: "loan",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-001"]);
  });

  it("filters by query against id", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      query: "tc-002",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-002"]);
  });

  it("trims and lower-cases the query", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      query: "  ANTRAG  ",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-001"]);
  });

  it("filters by domain chip", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      domain: "banking",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-001"]);
  });

  it("filters by type chip", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      type: "validation",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-003"]);
  });

  it("filters by priority chip", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      priority: "p0",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-001"]);
  });

  it("combines multiple filters with AND semantics", () => {
    const filtered = filterTestCases(cases, {
      query: "police",
      domain: "insurance",
      type: "negative",
      priority: "p1",
    });
    expect(filtered.map((c) => c.id)).toEqual(["tc-002"]);
  });

  it("returns an empty array when no case matches", () => {
    const filtered = filterTestCases(cases, {
      ...buildEmptyFilter(),
      query: "no-such-thing",
    });
    expect(filtered).toEqual([]);
  });

  it("does not mutate the input list", () => {
    const before = [...cases];
    filterTestCases(cases, { ...buildEmptyFilter(), query: "antrag" });
    expect(cases).toEqual(before);
  });
});
