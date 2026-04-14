/**
 * Token Suggestion Model — Issue #993.
 *
 * Builds a 1-click accept/reject UI model on top of the server's
 * `TokenBridgeResult` conflicts + unmapped variables. Pure logic, no React.
 *
 * The input shape is the JSON-safe subset of `TokenBridgeResult` that the
 * server can surface to the UI. Where a field is optional, the model falls
 * back to a best-effort default so the UI always has something to render.
 */

import type { WorkspaceTokenPolicy } from "./workspace-policy";

// ---------------------------------------------------------------------------
// Input — mirrors the JSON subset of the server TokenBridgeResult
// ---------------------------------------------------------------------------

export interface TokenConflictInput {
  name: string;
  figmaValue: string;
  existingValue: string;
  /** Server-chosen resolution. UI treats this as the default user choice. */
  resolution: "figma" | "existing";
}

export interface UnmappedVariableInput {
  /** Variable name (e.g. `color/accent/500`). */
  name: string;
  /** Optional raw value captured by the bridge for display. */
  rawValue?: string;
}

export interface TokenIntelligencePayload {
  conflicts?: TokenConflictInput[];
  unmappedVariables?: string[];
  libraryKeys?: string[];
  /** Optional CSS custom properties block from the bridge. */
  cssCustomProperties?: string | null;
}

export interface DeriveTokenSuggestionModelInput {
  intelligence?: TokenIntelligencePayload | null;
  policy?: WorkspaceTokenPolicy;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type TokenSuggestionKind = "conflict" | "unmapped";

export type TokenSuggestionRecommendation = "accept" | "reject" | "review";

export interface TokenSuggestion {
  id: string;
  kind: TokenSuggestionKind;
  tokenName: string;
  figmaValue: string;
  existingValue?: string | undefined;
  /**
   * Suggested action computed from the server resolution and workspace
   * policy (auto-accept confidence + max conflict delta). `review` flags
   * items where a human decision is safer than auto-applying.
   */
  recommendation: TokenSuggestionRecommendation;
  /**
   * True if accepting means replacing the existing value with the Figma
   * value. `false` means the existing value already wins.
   */
  autoAccepted: boolean;
  detail: string;
  /**
   * Crude normalized confidence (0–100) derived from the input shape.
   * Used only to surface high/low badges in the UI.
   */
  confidence: number;
}

export interface TokenSuggestionSummary {
  conflicts: number;
  unmapped: number;
  autoAccepted: number;
  needsReview: number;
}

export interface TokenSuggestionModel {
  available: boolean;
  disabled: boolean;
  libraryKeys: string[];
  cssPreview?: string | undefined;
  suggestions: TokenSuggestion[];
  summary: TokenSuggestionSummary;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function deriveTokenSuggestionModel(
  input: DeriveTokenSuggestionModelInput,
): TokenSuggestionModel {
  const disabled = input.policy?.disabled === true;
  const intelligence = input.intelligence ?? null;
  const available = Boolean(
    intelligence &&
    ((intelligence.conflicts?.length ?? 0) > 0 ||
      (intelligence.unmappedVariables?.length ?? 0) > 0 ||
      (intelligence.cssCustomProperties?.trim().length ?? 0) > 0),
  );

  if (!intelligence || disabled || !available) {
    return {
      available,
      disabled,
      libraryKeys: intelligence?.libraryKeys ?? [],
      ...(intelligence?.cssCustomProperties
        ? { cssPreview: intelligence.cssCustomProperties }
        : {}),
      suggestions: [],
      summary: { conflicts: 0, unmapped: 0, autoAccepted: 0, needsReview: 0 },
    };
  }

  const autoAcceptConfidence = input.policy?.autoAcceptConfidence ?? 90;
  const maxConflictDelta = input.policy?.maxConflictDelta ?? 15;

  const conflicts = (intelligence.conflicts ?? []).map((conflict, index) =>
    buildConflictSuggestion({
      conflict,
      index,
      autoAcceptConfidence,
      maxConflictDelta,
    }),
  );
  const unmapped = (intelligence.unmappedVariables ?? []).map((name, index) =>
    buildUnmappedSuggestion({ name, index }),
  );

  const suggestions = [...conflicts, ...unmapped];
  const summary: TokenSuggestionSummary = {
    conflicts: conflicts.length,
    unmapped: unmapped.length,
    autoAccepted: suggestions.filter((s) => s.autoAccepted).length,
    needsReview: suggestions.filter((s) => s.recommendation === "review")
      .length,
  };

  return {
    available: true,
    disabled: false,
    libraryKeys: intelligence.libraryKeys ?? [],
    ...(intelligence.cssCustomProperties
      ? { cssPreview: intelligence.cssCustomProperties }
      : {}),
    suggestions,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConflictSuggestion(args: {
  conflict: TokenConflictInput;
  index: number;
  autoAcceptConfidence: number;
  maxConflictDelta: number;
}): TokenSuggestion {
  const { conflict, index, autoAcceptConfidence, maxConflictDelta } = args;
  const delta = computeValueDelta(conflict.figmaValue, conflict.existingValue);
  const confidence = clamp(
    conflict.resolution === "figma" ? 100 - delta : 60 - delta,
  );

  const exceedsDelta = delta > maxConflictDelta;
  const recommendation: TokenSuggestionRecommendation = exceedsDelta
    ? "review"
    : confidence >= autoAcceptConfidence
      ? "accept"
      : conflict.resolution === "existing"
        ? "reject"
        : "review";

  const autoAccepted =
    recommendation === "accept" && conflict.resolution === "figma";

  const detail = exceedsDelta
    ? `Figma value '${conflict.figmaValue}' differs from '${conflict.existingValue}' by ${delta}% — review before applying.`
    : conflict.resolution === "figma"
      ? `Figma token '${conflict.name}' will replace the existing '${conflict.existingValue}'.`
      : `Existing workspace token wins for '${conflict.name}'; Figma value kept as reference.`;

  return {
    id: `conflict:${conflict.name}:${index}`,
    kind: "conflict",
    tokenName: conflict.name,
    figmaValue: conflict.figmaValue,
    existingValue: conflict.existingValue,
    recommendation,
    autoAccepted,
    detail,
    confidence,
  };
}

function buildUnmappedSuggestion(args: {
  name: string;
  index: number;
}): TokenSuggestion {
  const { name, index } = args;
  return {
    id: `unmapped:${name}:${index}`,
    kind: "unmapped",
    tokenName: name,
    figmaValue: "",
    existingValue: undefined,
    recommendation: "review",
    autoAccepted: false,
    detail: `Figma variable '${name}' does not match any existing token family. Map it manually or extend the workspace token set.`,
    confidence: 40,
  };
}

function computeValueDelta(figma: string, existing: string): number {
  if (figma === existing) return 0;
  const figmaHex = extractHex(figma);
  const existingHex = extractHex(existing);
  if (figmaHex && existingHex) {
    return Math.round(colorDistance(figmaHex, existingHex) * 100);
  }
  const figmaNumber = extractNumber(figma);
  const existingNumber = extractNumber(existing);
  if (figmaNumber !== null && existingNumber !== null) {
    const denominator = Math.max(Math.abs(existingNumber), 1);
    return Math.round(
      Math.min(1, Math.abs(figmaNumber - existingNumber) / denominator) * 100,
    );
  }
  return figma.trim() === existing.trim() ? 0 : 100;
}

function extractHex(value: string): [number, number, number] | null {
  const match = /#([0-9a-fA-F]{6})/.exec(value.trim());
  if (!match) return null;
  const hex = match[1] ?? "";
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return [r, g, b];
}

function colorDistance(
  a: [number, number, number],
  b: [number, number, number],
): number {
  const dr = (a[0] - b[0]) / 255;
  const dg = (a[1] - b[1]) / 255;
  const db = (a[2] - b[2]) / 255;
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

function extractNumber(value: string): number | null {
  const match = /-?\d+(?:\.\d+)?/.exec(value.trim());
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Decision application
// ---------------------------------------------------------------------------

export interface TokenSuggestionDecisionEntry {
  id: string;
  action: "accept" | "reject";
}

export interface TokenSuggestionDecisionSet {
  entries: TokenSuggestionDecisionEntry[];
  acceptedTokenNames: string[];
  rejectedTokenNames: string[];
}

export function resolveTokenDecisions(
  model: TokenSuggestionModel,
  acceptedIds: ReadonlySet<string>,
): TokenSuggestionDecisionSet {
  const entries: TokenSuggestionDecisionEntry[] = [];
  const acceptedTokenNames: string[] = [];
  const rejectedTokenNames: string[] = [];
  for (const suggestion of model.suggestions) {
    const accepted = acceptedIds.has(suggestion.id);
    entries.push({
      id: suggestion.id,
      action: accepted ? "accept" : "reject",
    });
    if (accepted) {
      acceptedTokenNames.push(suggestion.tokenName);
    } else {
      rejectedTokenNames.push(suggestion.tokenName);
    }
  }
  return { entries, acceptedTokenNames, rejectedTokenNames };
}
