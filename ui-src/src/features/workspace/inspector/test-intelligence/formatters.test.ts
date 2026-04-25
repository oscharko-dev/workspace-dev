import { describe, expect, it } from "vitest";
import {
  formatConfidence,
  formatPercent,
  formatPolicyDecisionBadge,
  formatPriorityBadge,
  formatReviewStateBadge,
  formatRiskCategoryLabel,
  formatTestTypeLabel,
  formatVisualSidecarOutcomeBadge,
  qualityScoreClass,
  resolveEffectiveReviewState,
} from "./formatters";

describe("formatReviewStateBadge", () => {
  it("returns the good tier for approved/exported/transferred", () => {
    expect(formatReviewStateBadge("approved").tier).toBe("good");
    expect(formatReviewStateBadge("exported").tier).toBe("good");
    expect(formatReviewStateBadge("transferred").tier).toBe("good");
  });

  it("returns block tier for rejected", () => {
    expect(formatReviewStateBadge("rejected").tier).toBe("block");
  });

  it("returns warn tier for needs_review", () => {
    expect(formatReviewStateBadge("needs_review").tier).toBe("warn");
  });

  it("returns info tier for edited", () => {
    expect(formatReviewStateBadge("edited").tier).toBe("info");
  });

  it("returns neutral tier for generated", () => {
    expect(formatReviewStateBadge("generated").tier).toBe("neutral");
  });
});

describe("formatPolicyDecisionBadge", () => {
  it("maps blocked to block tier and approved to good tier", () => {
    expect(formatPolicyDecisionBadge("blocked").tier).toBe("block");
    expect(formatPolicyDecisionBadge("approved").tier).toBe("good");
    expect(formatPolicyDecisionBadge("needs_review").tier).toBe("warn");
  });
});

describe("formatPriorityBadge", () => {
  it("ranks p0 as block and p3 as neutral", () => {
    expect(formatPriorityBadge("p0").tier).toBe("block");
    expect(formatPriorityBadge("p1").tier).toBe("warn");
    expect(formatPriorityBadge("p2").tier).toBe("info");
    expect(formatPriorityBadge("p3").tier).toBe("neutral");
  });

  it("renders the upper-cased label", () => {
    expect(formatPriorityBadge("p0").label).toBe("P0");
    expect(formatPriorityBadge("p2").label).toBe("P2");
  });
});

describe("formatRiskCategoryLabel", () => {
  it("maps known categories to display labels", () => {
    expect(formatRiskCategoryLabel("regulated_data")).toBe("Regulated data");
    expect(formatRiskCategoryLabel("financial_transaction")).toBe(
      "Financial transaction",
    );
    expect(formatRiskCategoryLabel("medium")).toBe("Medium risk");
  });
});

describe("formatTestTypeLabel", () => {
  it("returns title-cased labels for the well-known types", () => {
    expect(formatTestTypeLabel("functional")).toBe("Functional");
    expect(formatTestTypeLabel("accessibility")).toBe("Accessibility");
  });
});

describe("formatVisualSidecarOutcomeBadge", () => {
  it("ranks schema_invalid and prompt_injection_like_text as block", () => {
    expect(formatVisualSidecarOutcomeBadge("schema_invalid").tier).toBe(
      "block",
    );
    expect(
      formatVisualSidecarOutcomeBadge("prompt_injection_like_text").tier,
    ).toBe("block");
    expect(formatVisualSidecarOutcomeBadge("primary_unavailable").tier).toBe(
      "block",
    );
  });

  it("ranks low_confidence and possible_pii as warn", () => {
    expect(formatVisualSidecarOutcomeBadge("low_confidence").tier).toBe("warn");
    expect(formatVisualSidecarOutcomeBadge("possible_pii").tier).toBe("warn");
  });

  it("returns good tier for ok", () => {
    expect(formatVisualSidecarOutcomeBadge("ok").tier).toBe("good");
  });

  it("returns info tier for fallback_used", () => {
    expect(formatVisualSidecarOutcomeBadge("fallback_used").tier).toBe("info");
  });
});

describe("formatPercent", () => {
  it("returns a percent string with the requested fraction digits", () => {
    expect(formatPercent(0.123, 1)).toBe("12.3%");
    expect(formatPercent(1)).toBe("100%");
  });

  it("returns '—' for non-finite values", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatConfidence", () => {
  it("returns two-decimal strings", () => {
    expect(formatConfidence(0.567)).toBe("0.57");
    expect(formatConfidence(0)).toBe("0.00");
  });

  it("returns '—' for non-finite values", () => {
    expect(formatConfidence(Number.NaN)).toBe("—");
  });
});

describe("qualityScoreClass", () => {
  it("returns red below 0.6", () => {
    expect(qualityScoreClass(0.4)).toBe("text-rose-200");
  });

  it("returns amber for 0.6..0.79", () => {
    expect(qualityScoreClass(0.7)).toBe("text-amber-200");
  });

  it("returns emerald for >= 0.8", () => {
    expect(qualityScoreClass(0.85)).toBe("text-emerald-200");
  });

  it("falls back to neutral for NaN", () => {
    expect(qualityScoreClass(Number.NaN)).toBe("text-white/65");
  });
});

describe("resolveEffectiveReviewState", () => {
  it("prefers the snapshot state when present", () => {
    expect(resolveEffectiveReviewState("approved", "needs_review")).toBe(
      "approved",
    );
  });

  it("falls back to a sensible default when no snapshot exists", () => {
    expect(resolveEffectiveReviewState(undefined, "auto_approved")).toBe(
      "approved",
    );
    expect(resolveEffectiveReviewState(undefined, "rejected")).toBe("rejected");
    expect(resolveEffectiveReviewState(undefined, "needs_review")).toBe(
      "needs_review",
    );
    expect(resolveEffectiveReviewState(undefined, "draft")).toBe("generated");
  });
});
