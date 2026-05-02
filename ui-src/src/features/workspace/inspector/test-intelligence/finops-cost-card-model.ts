/**
 * Pure model + helpers for the FinOps cost card.
 *
 * Kept separate from the React component so the band-thresholds and
 * formatter are unit-testable in isolation.
 */

export type UsageBand = "green" | "amber" | "red";

/** Lower bound (exclusive) for the amber band. */
export const FINOPS_AMBER_THRESHOLD = 0.6;
/** Lower bound (exclusive) for the red band. */
export const FINOPS_RED_THRESHOLD = 0.85;

/**
 * Map a usage ratio (used / budget) to a colour band.
 *
 *   - <= 60%  → green
 *   - <= 85%  → amber
 *   - >  85%  → red
 *
 * Inputs outside `[0, 1]` are clamped (negative → 0, > 1 → 1).
 */
export const classifyUsageBand = (ratio: number): UsageBand => {
  const clamped = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  if (clamped > FINOPS_RED_THRESHOLD) return "red";
  if (clamped > FINOPS_AMBER_THRESHOLD) return "amber";
  return "green";
};

/**
 * Format a token count with thousands separators. Negative values are
 * coerced to 0; non-finite to "0".
 */
export const formatTokens = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return "0";
  return Math.round(value).toLocaleString("en-US");
};
