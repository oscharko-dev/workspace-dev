/**
 * Unit tests for the Pre-flight Import Quality Score derivation.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/993
 */

import { describe, expect, it } from "vitest";
import {
  deriveQualityScore,
  type DeriveQualityScoreInput,
  type QualityScoreElementInput,
  type QualityScoreScreenInput,
} from "./import-quality-score";

function screen(
  id: string,
  children: QualityScoreElementInput[],
): QualityScoreScreenInput {
  return { id, name: id, children };
}

function node(
  overrides: Partial<QualityScoreElementInput>,
): QualityScoreElementInput {
  return {
    id: overrides.id ?? "n",
    name: overrides.name ?? "node",
    type: overrides.type ?? "Frame",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<DeriveQualityScoreInput> = {},
): DeriveQualityScoreInput {
  return {
    screens: [screen("s1", [node({ id: "n1", type: "Frame" })])],
    diagnostics: [],
    manifest: { screens: [{ components: [{ irNodeId: "n1" }] }] },
    errors: [],
    ...overrides,
  };
}

describe("deriveQualityScore", () => {
  it("returns score 0 and an empty-ir risk when no nodes are present", () => {
    const result = deriveQualityScore({
      screens: [screen("empty", [])],
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe("poor");
    expect(result.risks.some((risk) => risk.id === "empty-ir")).toBe(true);
    expect(result.summary.totalNodes).toBe(0);
  });

  it("awards high scores to small, well-mapped, well-semantic trees", () => {
    const result = deriveQualityScore(
      baseInput({
        screens: [
          screen("home", [
            node({
              id: "n1",
              type: "Button",
              semanticType: "Button",
              onClick: () => undefined,
              ariaLabel: "Primary CTA",
            }),
          ]),
        ],
        manifest: { screens: [{ components: [{ irNodeId: "n1" }] }] },
      }),
    );

    expect(result.band).toBe("excellent");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.summary.unmappedNodes).toBe(0);
    expect(result.summary.interactiveWithoutSemantics).toBe(0);
  });

  it("raises a high-severity risk when interactive nodes lack semantics", () => {
    const result = deriveQualityScore(
      baseInput({
        screens: [
          screen("home", [
            node({
              id: "n1",
              type: "Rectangle",
              onClick: () => undefined,
            }),
          ]),
        ],
      }),
    );

    const risk = result.risks.find((entry) => entry.category === "interaction");
    expect(risk?.severity).toBe("high");
    expect(result.summary.interactiveWithoutSemantics).toBe(1);
    expect(result.breakdown.semantic).toBeLessThan(100);
  });

  it("penalises diagnostics with errors more than warnings or info", () => {
    const withErrors = deriveQualityScore(
      baseInput({
        diagnostics: [{ severity: "error" }, { severity: "error" }],
      }),
    );
    const withWarnings = deriveQualityScore(
      baseInput({
        diagnostics: [{ severity: "warning" }, { severity: "warning" }],
      }),
    );
    expect(withErrors.breakdown.codegen).toBeLessThan(
      withWarnings.breakdown.codegen,
    );
    expect(
      withErrors.risks.some((risk) => risk.id === "figma-diagnostics-errors"),
    ).toBe(true);
  });

  it("flags deep nesting and large subtrees as structural risks", () => {
    let tree: QualityScoreElementInput = node({ id: "leaf" });
    for (let depth = 0; depth < 10; depth += 1) {
      tree = node({ id: `n${depth}`, children: [tree] });
    }
    const result = deriveQualityScore(
      baseInput({ screens: [screen("deep", [tree])], manifest: null }),
    );

    expect(result.summary.maxDepth).toBeGreaterThan(6);
    expect(result.risks.some((risk) => risk.id === "deep-nesting")).toBe(true);
  });

  it("honours policy overrides for band thresholds and risk severity", () => {
    const strictResult = deriveQualityScore(
      baseInput({
        policy: {
          bandThresholds: { excellent: 99, good: 90, fair: 80 },
          riskSeverityOverrides: { "deep-nesting": "low" },
        },
      }),
    );
    expect(strictResult.policyApplied).toBe(true);
    expect(["good", "fair", "poor", "excellent"]).toContain(strictResult.band);
  });

  it("counts pipeline errors and caps codegen subscore accordingly", () => {
    const result = deriveQualityScore(
      baseInput({
        errors: [
          { stage: "generating", code: "X" },
          { stage: "mapping", code: "Y" },
        ],
      }),
    );
    expect(result.risks.some((risk) => risk.id === "pipeline-errors")).toBe(
      true,
    );
    expect(result.breakdown.codegen).toBeLessThanOrEqual(80);
  });
});
