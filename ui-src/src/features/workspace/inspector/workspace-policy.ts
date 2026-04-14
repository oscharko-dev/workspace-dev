/**
 * Workspace quality policy — Issue #993.
 *
 * Small, shape-only policy hook that lets repos/projects tune the severity
 * thresholds of the Pre-flight Quality Score, token-mapping intelligence,
 * and post-gen accessibility nudges without forcing a schema on them yet.
 *
 * The policy is intentionally conservative: defaults are baked in, and
 * overrides are optional and additive. Server-delivered policies can be
 * plugged in by `resolveWorkspacePolicy()` once a backend endpoint exists.
 */

import type { QualityRiskSeverity } from "./import-quality-score";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceQualityBandThresholds {
  excellent: number;
  good: number;
  fair: number;
}

export interface WorkspaceQualityWeights {
  structure: number;
  semantic: number;
  codegen: number;
}

export interface WorkspaceQualityPolicy {
  bandThresholds?: Partial<WorkspaceQualityBandThresholds>;
  weights?: Partial<WorkspaceQualityWeights>;
  maxAcceptableDepth?: number;
  maxAcceptableNodes?: number;
  /** Map of risk id → override severity (e.g. `"deep-nesting": "high"`). */
  riskSeverityOverrides?: Record<string, QualityRiskSeverity>;
}

export interface WorkspaceTokenPolicy {
  /** Auto-accept token suggestions at or above this confidence (0–100). */
  autoAcceptConfidence?: number;
  /** Reject any Figma value that differs from existing by more than N % (color distance). */
  maxConflictDelta?: number;
  /** Disable token suggestions entirely. */
  disabled?: boolean;
}

export interface WorkspaceA11yPolicy {
  /** Minimum WCAG level to enforce in post-gen nudges: "AA" | "AAA". */
  wcagLevel?: "AA" | "AAA";
  /** Disable specific nudge rule ids. */
  disabledRules?: string[];
}

export interface WorkspacePolicy {
  quality?: WorkspaceQualityPolicy;
  tokens?: WorkspaceTokenPolicy;
  a11y?: WorkspaceA11yPolicy;
}

// ---------------------------------------------------------------------------
// Resolved (fully-populated) policy shapes — used internally after merge.
// ---------------------------------------------------------------------------

export interface ResolvedWorkspaceQualityPolicy {
  bandThresholds: WorkspaceQualityBandThresholds;
  weights: WorkspaceQualityWeights;
  maxAcceptableDepth: number;
  maxAcceptableNodes: number;
  riskSeverityOverrides: Record<string, QualityRiskSeverity>;
}

export interface ResolvedWorkspaceTokenPolicy {
  autoAcceptConfidence: number;
  maxConflictDelta: number;
  disabled: boolean;
}

export interface ResolvedWorkspaceA11yPolicy {
  wcagLevel: "AA" | "AAA";
  disabledRules: string[];
}

export interface ResolvedWorkspacePolicy {
  quality: ResolvedWorkspaceQualityPolicy;
  tokens: ResolvedWorkspaceTokenPolicy;
  a11y: ResolvedWorkspaceA11yPolicy;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_WORKSPACE_POLICY: ResolvedWorkspacePolicy = {
  quality: {
    bandThresholds: { excellent: 85, good: 70, fair: 50 },
    weights: { structure: 0.35, semantic: 0.4, codegen: 0.25 },
    maxAcceptableDepth: 6,
    maxAcceptableNodes: 120,
    riskSeverityOverrides: {},
  },
  tokens: {
    autoAcceptConfidence: 90,
    maxConflictDelta: 15,
    disabled: false,
  },
  a11y: {
    wcagLevel: "AA",
    disabledRules: [],
  },
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided policy against the baked-in defaults.
 *
 * Any omitted fields keep the default value. Unknown keys are preserved on
 * re-export so that future policy additions survive downstream consumers.
 */
export function resolveWorkspacePolicy(
  input?: WorkspacePolicy | null,
): ResolvedWorkspacePolicy {
  const source = input ?? {};
  return {
    quality: mergeQualityPolicy(source.quality),
    tokens: mergeTokenPolicy(source.tokens),
    a11y: mergeA11yPolicy(source.a11y),
  };
}

function mergeQualityPolicy(
  override: WorkspaceQualityPolicy | undefined,
): ResolvedWorkspaceQualityPolicy {
  if (!override) return DEFAULT_WORKSPACE_POLICY.quality;
  return {
    bandThresholds: {
      ...DEFAULT_WORKSPACE_POLICY.quality.bandThresholds,
      ...override.bandThresholds,
    },
    weights: {
      ...DEFAULT_WORKSPACE_POLICY.quality.weights,
      ...override.weights,
    },
    maxAcceptableDepth:
      override.maxAcceptableDepth ??
      DEFAULT_WORKSPACE_POLICY.quality.maxAcceptableDepth,
    maxAcceptableNodes:
      override.maxAcceptableNodes ??
      DEFAULT_WORKSPACE_POLICY.quality.maxAcceptableNodes,
    riskSeverityOverrides: {
      ...DEFAULT_WORKSPACE_POLICY.quality.riskSeverityOverrides,
      ...override.riskSeverityOverrides,
    },
  };
}

function mergeTokenPolicy(
  override: WorkspaceTokenPolicy | undefined,
): ResolvedWorkspaceTokenPolicy {
  if (!override) return DEFAULT_WORKSPACE_POLICY.tokens;
  return {
    autoAcceptConfidence:
      override.autoAcceptConfidence ??
      DEFAULT_WORKSPACE_POLICY.tokens.autoAcceptConfidence,
    maxConflictDelta:
      override.maxConflictDelta ??
      DEFAULT_WORKSPACE_POLICY.tokens.maxConflictDelta,
    disabled: override.disabled ?? DEFAULT_WORKSPACE_POLICY.tokens.disabled,
  };
}

function mergeA11yPolicy(
  override: WorkspaceA11yPolicy | undefined,
): ResolvedWorkspaceA11yPolicy {
  if (!override) return DEFAULT_WORKSPACE_POLICY.a11y;
  return {
    wcagLevel: override.wcagLevel ?? DEFAULT_WORKSPACE_POLICY.a11y.wcagLevel,
    disabledRules:
      override.disabledRules ?? DEFAULT_WORKSPACE_POLICY.a11y.disabledRules,
  };
}
