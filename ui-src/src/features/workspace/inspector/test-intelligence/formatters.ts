// ---------------------------------------------------------------------------
// Test Intelligence Inspector — formatters and label helpers (Issue #1367)
//
// Pure helpers exercised by the panel components. Kept in a separate module
// so unit tests can target label resolution and badge selection without
// having to render a full React tree.
// ---------------------------------------------------------------------------

import type {
  PolicyDecision,
  ReviewState,
  TestCasePriority,
  TestCaseRiskCategory,
  TestCaseType,
  VisualSidecarOutcome,
} from "./types";

export interface BadgeStyle {
  /** Tailwind background+text classes for the badge pill. */
  className: string;
  /** Human-readable label rendered inside the badge. */
  label: string;
  /**
   * Severity tier — informational only; tests use it to assert the right
   * mapping was chosen without depending on exact Tailwind classnames.
   */
  tier: "neutral" | "info" | "good" | "warn" | "block";
}

export function formatReviewStateBadge(state: ReviewState): BadgeStyle {
  switch (state) {
    case "approved":
      return {
        className: "bg-emerald-950/40 text-emerald-200 border-emerald-500/30",
        label: "Approved",
        tier: "good",
      };
    case "exported":
      return {
        className: "bg-emerald-950/40 text-emerald-200 border-emerald-500/30",
        label: "Exported",
        tier: "good",
      };
    case "transferred":
      return {
        className: "bg-emerald-950/40 text-emerald-200 border-emerald-500/30",
        label: "Transferred",
        tier: "good",
      };
    case "needs_review":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Needs review",
        tier: "warn",
      };
    case "pending_secondary_approval":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Awaiting 2nd approver",
        tier: "warn",
      };
    case "edited":
      return {
        className: "bg-sky-950/40 text-sky-200 border-sky-500/30",
        label: "Edited",
        tier: "info",
      };
    case "rejected":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Rejected",
        tier: "block",
      };
    case "generated":
      return {
        className: "bg-white/5 text-white/65 border-white/10",
        label: "Generated",
        tier: "neutral",
      };
  }
}

export function formatPolicyDecisionBadge(
  decision: PolicyDecision,
): BadgeStyle {
  switch (decision) {
    case "approved":
      return {
        className: "bg-emerald-950/40 text-emerald-200 border-emerald-500/30",
        label: "Policy approved",
        tier: "good",
      };
    case "needs_review":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Needs review",
        tier: "warn",
      };
    case "blocked":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Policy blocked",
        tier: "block",
      };
  }
}

export function formatPriorityBadge(priority: TestCasePriority): BadgeStyle {
  switch (priority) {
    case "p0":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "P0",
        tier: "block",
      };
    case "p1":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "P1",
        tier: "warn",
      };
    case "p2":
      return {
        className: "bg-sky-950/40 text-sky-200 border-sky-500/30",
        label: "P2",
        tier: "info",
      };
    case "p3":
      return {
        className: "bg-white/5 text-white/65 border-white/10",
        label: "P3",
        tier: "neutral",
      };
  }
}

export function formatRiskCategoryLabel(value: TestCaseRiskCategory): string {
  switch (value) {
    case "regulated_data":
      return "Regulated data";
    case "financial_transaction":
      return "Financial transaction";
    case "high":
      return "High risk";
    case "medium":
      return "Medium risk";
    case "low":
      return "Low risk";
  }
}

export function formatTestTypeLabel(value: TestCaseType): string {
  switch (value) {
    case "functional":
      return "Functional";
    case "negative":
      return "Negative";
    case "boundary":
      return "Boundary";
    case "validation":
      return "Validation";
    case "navigation":
      return "Navigation";
    case "regression":
      return "Regression";
    case "exploratory":
      return "Exploratory";
    case "accessibility":
      return "Accessibility";
  }
}

export function formatVisualSidecarOutcomeBadge(
  outcome: VisualSidecarOutcome,
): BadgeStyle {
  switch (outcome) {
    case "ok":
      return {
        className: "bg-emerald-950/40 text-emerald-200 border-emerald-500/30",
        label: "OK",
        tier: "good",
      };
    case "fallback_used":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Fallback used",
        tier: "warn",
      };
    case "low_confidence":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Low confidence",
        tier: "warn",
      };
    case "possible_pii":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Possible PII",
        tier: "block",
      };
    case "schema_invalid":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Schema invalid",
        tier: "block",
      };
    case "prompt_injection_like_text":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Prompt-injection text",
        tier: "block",
      };
    case "conflicts_with_figma_metadata":
      return {
        className: "bg-rose-950/40 text-rose-200 border-rose-500/30",
        label: "Conflicts with Figma",
        tier: "block",
      };
    case "primary_unavailable":
      return {
        className: "bg-amber-950/40 text-amber-200 border-amber-500/30",
        label: "Primary unavailable",
        tier: "warn",
      };
  }
}

export function formatPercent(value: number, fractionDigits = 0): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "—";
  }
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatConfidence(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(2);
}

/**
 * Resolve a quality-score color class from a confidence value.
 *
 * < 0.6 — block tier (red).
 * 0.6–0.79 — warn tier (amber).
 * >= 0.8 — good tier (emerald).
 */
export function qualityScoreClass(value: number): string {
  if (Number.isNaN(value)) return "text-white/65";
  if (value >= 0.8) return "text-emerald-200";
  if (value >= 0.6) return "text-amber-200";
  return "text-rose-200";
}

/**
 * Resolve the effective per-case review state from the snapshot, falling
 * back to the test case's own `reviewState` when the snapshot is absent
 * (e.g. validation pipeline ran but the review store has not been seeded).
 */
export function resolveEffectiveReviewState(
  snapshotState: ReviewState | undefined,
  fallback: "draft" | "auto_approved" | "needs_review" | "rejected",
): ReviewState {
  if (snapshotState !== undefined) return snapshotState;
  if (fallback === "auto_approved") return "approved";
  if (fallback === "rejected") return "rejected";
  if (fallback === "needs_review") return "needs_review";
  return "generated";
}
