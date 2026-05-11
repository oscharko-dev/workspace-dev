import { describe, expect, it } from "vitest";

import {
  JOB_HISTORY_STRIP_DEFAULT_LIMIT,
  buildJobHistoryRow,
  buildJobHistoryRows,
  truncateJobId,
} from "./job-history-strip-model";
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

describe("truncateJobId", () => {
  it("returns ids shorter than the cap unchanged", () => {
    expect(truncateJobId("abc")).toBe("abc");
  });

  it("slices longer ids to 8 chars by default", () => {
    expect(truncateJobId("abcdefghij")).toBe("abcdefgh");
  });

  it("respects a custom max length", () => {
    expect(truncateJobId("abcdefghij", 4)).toBe("abcd");
  });
});

describe("buildJobHistoryRow", () => {
  it("derives shortId, artifactCount, total, and ready", () => {
    const row = buildJobHistoryRow(
      summary("job-1234567890", {
        generatedTestCases: true,
        policyReport: true,
        coverageReport: true,
      }),
    );
    expect(row.jobId).toBe("job-1234567890");
    expect(row.shortId).toBe("job-1234");
    expect(row.artifactCount).toBe(3);
    expect(row.artifactTotal).toBe(10);
    expect(row.ready).toBe(true);
  });

  it("flags ready=false when the generated-test-cases artifact is missing", () => {
    const row = buildJobHistoryRow(summary("job-x", { policyReport: true }));
    expect(row.ready).toBe(false);
    expect(row.artifactCount).toBe(1);
  });
});

describe("buildJobHistoryRows", () => {
  it("returns at most `limit` rows", () => {
    const summaries = Array.from({ length: 15 }, (_, i) =>
      summary(`job-${String(i).padStart(3, "0")}`),
    );
    const rows = buildJobHistoryRows(summaries, 5);
    expect(rows).toHaveLength(5);
  });

  it("defaults to the JOB_HISTORY_STRIP_DEFAULT_LIMIT", () => {
    const summaries = Array.from({ length: 25 }, (_, i) =>
      summary(`job-${String(i).padStart(3, "0")}`),
    );
    const rows = buildJobHistoryRows(summaries);
    expect(rows).toHaveLength(JOB_HISTORY_STRIP_DEFAULT_LIMIT);
  });

  it("returns empty when limit <= 0", () => {
    expect(buildJobHistoryRows([summary("a")], 0)).toEqual([]);
    expect(buildJobHistoryRows([summary("a")], -1)).toEqual([]);
  });

  it("orders newest-first by reversing the server's lexicographic sort", () => {
    const rows = buildJobHistoryRows(
      [summary("job-001"), summary("job-002"), summary("job-003")],
      10,
    );
    expect(rows.map((r) => r.jobId)).toEqual(["job-003", "job-002", "job-001"]);
  });

  it("does not mutate the input array", () => {
    const summaries = [summary("job-001"), summary("job-002")];
    const before = [...summaries];
    buildJobHistoryRows(summaries);
    expect(summaries).toEqual(before);
  });
});
