import { describe, expect, it } from "vitest";
import {
  deriveInspectabilitySummary,
  INSPECTABILITY_AGGREGATE_ONLY_NOTE,
  type DeriveInspectabilitySummaryInput
} from "./inspectability-summary";

function makeBaseInput(): DeriveInspectabilitySummaryInput {
  return {
    designIrStatus: "ready",
    designIrScreens: [
      {
        id: "screen-home",
        children: [
          {
            id: "node-header",
            children: []
          },
          {
            id: "node-content",
            children: [
              {
                id: "node-content-body",
                children: []
              }
            ]
          }
        ]
      }
    ],
    manifestStatus: "ready",
    manifest: {
      screens: [
        {
          screenId: "screen-home",
          components: [
            { irNodeId: "node-header" },
            { irNodeId: "node-header" },
            { irNodeId: "node-not-in-ir" }
          ]
        }
      ]
    },
    metricsStatus: "ready",
    metrics: {
      skippedHidden: 2,
      skippedPlaceholders: 3,
      truncatedScreens: [
        {
          originalElements: 12,
          retainedElements: 8
        },
        {
          originalElements: 4,
          retainedElements: 5
        }
      ],
      depthTruncatedScreens: [
        { truncatedBranchCount: 2 },
        { truncatedBranchCount: -1 }
      ],
      classificationFallbacks: [{ nodeId: "a" }, { nodeId: "b" }],
      degradedGeometryNodes: ["1:1", "1:2", "1:3"]
    }
  };
}

describe("deriveInspectabilitySummary", () => {
  it("derives mapped/unmapped coverage and omission counters from aggregate runtime data", () => {
    const summary = deriveInspectabilitySummary(makeBaseInput());

    expect(summary.aggregateOnlyNote).toBe(INSPECTABILITY_AGGREGATE_ONLY_NOTE);

    expect(summary.manifestCoverage).toEqual({
      status: "ready",
      mappedNodes: 2,
      unmappedNodes: 2,
      totalNodes: 4,
      mappedPercent: 50,
      message: null
    });

    expect(summary.omissionMetrics).toEqual({
      status: "ready",
      skippedHidden: 2,
      skippedPlaceholders: 3,
      truncatedByBudget: 4,
      depthTruncatedBranches: 2,
      classificationFallbacks: 2,
      degradedGeometryNodes: 3,
      message: null
    });
  });

  it("treats optional metrics arrays as zero-value aggregates", () => {
    const summary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      metrics: {
        skippedHidden: 0,
        skippedPlaceholders: 1
      }
    });

    expect(summary.omissionMetrics).toEqual({
      status: "ready",
      skippedHidden: 0,
      skippedPlaceholders: 1,
      truncatedByBudget: 0,
      depthTruncatedBranches: 0,
      classificationFallbacks: 0,
      degradedGeometryNodes: 0,
      message: null
    });
  });

  it("gracefully degrades when metrics are unavailable", () => {
    const summary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      metricsStatus: "unavailable",
      metrics: null
    });

    expect(summary.omissionMetrics.status).toBe("unavailable");
    expect(summary.omissionMetrics.message).toContain("unavailable");
    expect(summary.omissionMetrics.truncatedByBudget).toBe(0);
    expect(summary.omissionMetrics.classificationFallbacks).toBe(0);
  });

  it("marks coverage as unavailable when manifest data is unavailable", () => {
    const summary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      manifestStatus: "error",
      manifest: null
    });

    expect(summary.manifestCoverage.status).toBe("unavailable");
    expect(summary.manifestCoverage.message).toContain("component manifest");
    expect(summary.manifestCoverage.totalNodes).toBe(0);
  });

  it("marks coverage as loading when Design IR or manifest source is still loading", () => {
    const loadingDesignIrSummary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      designIrStatus: "loading"
    });
    expect(loadingDesignIrSummary.manifestCoverage.status).toBe("loading");

    const loadingManifestSummary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      manifestStatus: "loading"
    });
    expect(loadingManifestSummary.manifestCoverage.status).toBe("loading");
  });

  it("normalizes malformed numeric metrics without throwing", () => {
    const summary = deriveInspectabilitySummary({
      ...makeBaseInput(),
      metrics: {
        skippedHidden: "bad-value",
        skippedPlaceholders: Number.NaN,
        truncatedScreens: [{ originalElements: "x", retainedElements: 2 }],
        depthTruncatedScreens: [{ truncatedBranchCount: "y" }],
        classificationFallbacks: "not-array",
        degradedGeometryNodes: null
      }
    });

    expect(summary.omissionMetrics.skippedHidden).toBe(0);
    expect(summary.omissionMetrics.skippedPlaceholders).toBe(0);
    expect(summary.omissionMetrics.truncatedByBudget).toBe(0);
    expect(summary.omissionMetrics.depthTruncatedBranches).toBe(0);
    expect(summary.omissionMetrics.classificationFallbacks).toBe(0);
    expect(summary.omissionMetrics.degradedGeometryNodes).toBe(0);
  });
});
