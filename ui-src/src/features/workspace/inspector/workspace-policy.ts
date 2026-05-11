/**
 * Workspace quality policy — Issue #993.
 *
 * Small, shape-only policy hook that lets repos/projects tune the severity
 * thresholds of the Pre-flight Quality Score, token-mapping intelligence,
 * and post-gen accessibility nudges without forcing a schema on them yet.
 *
 * The policy is intentionally conservative: defaults are baked in, and
 * overrides are optional and additive. Repo-backed or server-delivered
 * policies can be merged in by `resolveWorkspacePolicy()`.
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

export interface WorkspaceGovernancePolicy {
  minQualityScoreToApply?: number | null;
  securitySensitivePatterns?: string[];
  requireNoteOnOverride?: boolean;
}

export interface WorkspacePolicy {
  quality?: WorkspaceQualityPolicy;
  tokens?: WorkspaceTokenPolicy;
  a11y?: WorkspaceA11yPolicy;
  governance?: WorkspaceGovernancePolicy;
}

export interface WorkspacePolicyPayload {
  policy: WorkspacePolicy | null;
  warning?: string;
  validation?: WorkspacePolicyValidationPayload;
}

export type WorkspacePolicyValidationState =
  | "absent"
  | "loaded"
  | "degraded"
  | "rejected";

export interface WorkspacePolicyValidationDiagnostic {
  severity: string;
  code: string;
  path: string;
  message: string;
  valuePreview?: unknown;
}

export interface WorkspacePolicyValidationPayload {
  state: WorkspacePolicyValidationState;
  diagnostics: WorkspacePolicyValidationDiagnostic[];
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

export interface ResolvedWorkspaceGovernancePolicy {
  minQualityScoreToApply: number | null;
  securitySensitivePatterns: string[];
  requireNoteOnOverride: boolean;
}

export interface ResolvedWorkspacePolicy {
  quality: ResolvedWorkspaceQualityPolicy;
  tokens: ResolvedWorkspaceTokenPolicy;
  a11y: ResolvedWorkspaceA11yPolicy;
  governance: ResolvedWorkspaceGovernancePolicy;
}

export type WorkspacePolicySource =
  | "defaults"
  | "server"
  | "rejected-server-policy"
  | "invalid-server-payload";

export interface ParsedWorkspacePolicyResult {
  policy: ResolvedWorkspacePolicy;
  source: WorkspacePolicySource;
  warning: string | null;
  validation: WorkspacePolicyValidationPayload;
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
  governance: {
    minQualityScoreToApply: null,
    securitySensitivePatterns: [],
    requireNoteOnOverride: true,
  },
};

const INVALID_WORKSPACE_POLICY_WARNING =
  "Workspace inspector policy payload is invalid and was ignored. Default policy thresholds are in effect.";
const REJECTED_WORKSPACE_POLICY_WARNING =
  "Workspace inspector policy file was rejected and ignored. Default policy thresholds are in effect.";

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided policy against the baked-in defaults.
 *
 * Any omitted fields keep the default value.
 */
export function resolveWorkspacePolicy(
  input?: WorkspacePolicy | null,
): ResolvedWorkspacePolicy {
  const source = input ?? {};
  return {
    quality: mergeQualityPolicy(source.quality),
    tokens: mergeTokenPolicy(source.tokens),
    a11y: mergeA11yPolicy(source.a11y),
    governance: mergeGovernancePolicy(source.governance),
  };
}

export function parseWorkspacePolicyPayload(
  input: unknown,
): ParsedWorkspacePolicyResult {
  if (!isRecord(input) || !("policy" in input)) {
    return invalidWorkspacePolicyResult();
  }

  if (
    "warning" in input &&
    input.warning !== undefined &&
    typeof input.warning !== "string"
  ) {
    return invalidWorkspacePolicyResult();
  }

  const warning = normalizeWorkspacePolicyWarning(input.warning);
  const validationFallback = {
    hasPolicy: input.policy !== null,
    hasWarning: warning !== null,
  };
  const validation =
    parseWorkspacePolicyValidationPayload(input.validation, validationFallback) ??
    inferWorkspacePolicyValidationPayload(validationFallback);

  if (validation.state === "absent") {
    if (input.policy !== null) {
      return invalidWorkspacePolicyResult();
    }

    return {
      policy: DEFAULT_WORKSPACE_POLICY,
      source: "defaults",
      warning: null,
      validation,
    };
  }

  if (validation.state === "rejected") {
    return {
      policy: DEFAULT_WORKSPACE_POLICY,
      source: "rejected-server-policy",
      warning: warning ?? REJECTED_WORKSPACE_POLICY_WARNING,
      validation,
    };
  }

  const parsedPolicy = parseWorkspacePolicy(input.policy);
  if (parsedPolicy === null) {
    return invalidWorkspacePolicyResult();
  }

  return {
    policy: resolveWorkspacePolicy(parsedPolicy),
    source: "server",
    warning,
    validation,
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

function mergeGovernancePolicy(
  override: WorkspaceGovernancePolicy | undefined,
): ResolvedWorkspaceGovernancePolicy {
  if (!override) return DEFAULT_WORKSPACE_POLICY.governance;
  return {
    minQualityScoreToApply:
      override.minQualityScoreToApply === undefined
        ? DEFAULT_WORKSPACE_POLICY.governance.minQualityScoreToApply
        : override.minQualityScoreToApply,
    securitySensitivePatterns:
      override.securitySensitivePatterns ??
      DEFAULT_WORKSPACE_POLICY.governance.securitySensitivePatterns,
    requireNoteOnOverride:
      override.requireNoteOnOverride ??
      DEFAULT_WORKSPACE_POLICY.governance.requireNoteOnOverride,
  };
}

function invalidWorkspacePolicyResult(): ParsedWorkspacePolicyResult {
  return {
    policy: DEFAULT_WORKSPACE_POLICY,
    source: "invalid-server-payload",
    warning: INVALID_WORKSPACE_POLICY_WARNING,
    validation: {
      state: "rejected",
      diagnostics: [],
    },
  };
}

function normalizeWorkspacePolicyWarning(input: unknown): string | null {
  if (typeof input !== "string" || input.trim().length === 0) {
    return null;
  }

  return input;
}

function parseWorkspacePolicyValidationPayload(
  input: unknown,
  fallback: {
    hasPolicy: boolean;
    hasWarning: boolean;
  },
): WorkspacePolicyValidationPayload | null {
  if (input === undefined) {
    return inferWorkspacePolicyValidationPayload(fallback);
  }

  if (!isRecord(input)) {
    return null;
  }

  if (
    input.state !== "absent" &&
    input.state !== "loaded" &&
    input.state !== "degraded" &&
    input.state !== "rejected"
  ) {
    return null;
  }

  if (!Array.isArray(input.diagnostics)) {
    return null;
  }

  const diagnostics: WorkspacePolicyValidationDiagnostic[] = [];
  for (const diagnostic of input.diagnostics) {
    const parsed = parseWorkspacePolicyValidationDiagnostic(diagnostic);
    if (parsed === null) {
      return null;
    }
    diagnostics.push(parsed);
  }

  return {
    state: input.state,
    diagnostics,
  };
}

function inferWorkspacePolicyValidationPayload(input: {
  hasPolicy: boolean;
  hasWarning: boolean;
}): WorkspacePolicyValidationPayload {
  return {
    state: inferLegacyWorkspacePolicyValidationState(input),
    diagnostics: [],
  };
}

function inferLegacyWorkspacePolicyValidationState(input: {
  hasPolicy: boolean;
  hasWarning: boolean;
}): WorkspacePolicyValidationState {
  if (!input.hasPolicy) {
    return input.hasWarning ? "rejected" : "absent";
  }

  return input.hasWarning ? "degraded" : "loaded";
}

function parseWorkspacePolicyValidationDiagnostic(
  input: unknown,
): WorkspacePolicyValidationDiagnostic | null {
  if (!isRecord(input)) {
    return null;
  }

  if (
    typeof input.severity !== "string" ||
    typeof input.code !== "string" ||
    typeof input.path !== "string" ||
    typeof input.message !== "string"
  ) {
    return null;
  }

  return {
    severity: input.severity,
    code: input.code,
    path: input.path,
    message: input.message,
    ...("valuePreview" in input ? { valuePreview: input.valuePreview } : {}),
  };
}

function parseWorkspacePolicy(input: unknown): WorkspacePolicy | null {
  if (!isRecord(input)) {
    return null;
  }

  const policy: WorkspacePolicy = {};

  if ("quality" in input) {
    const quality = parseWorkspaceQualityPolicy(input.quality);
    if (quality === null) {
      return null;
    }
    policy.quality = quality;
  }

  if ("tokens" in input) {
    const tokens = parseWorkspaceTokenPolicy(input.tokens);
    if (tokens === null) {
      return null;
    }
    policy.tokens = tokens;
  }

  if ("a11y" in input) {
    const a11y = parseWorkspaceA11yPolicy(input.a11y);
    if (a11y === null) {
      return null;
    }
    policy.a11y = a11y;
  }

  if ("governance" in input) {
    const governance = parseWorkspaceGovernancePolicy(input.governance);
    if (governance === null) {
      return null;
    }
    policy.governance = governance;
  }

  return policy;
}

function parseWorkspaceQualityPolicy(
  input: unknown,
): WorkspaceQualityPolicy | null {
  if (!isRecord(input)) {
    return null;
  }

  const policy: WorkspaceQualityPolicy = {};

  if ("bandThresholds" in input) {
    const bandThresholds = parsePartialNumberRecord(input.bandThresholds, [
      "excellent",
      "good",
      "fair",
    ]);
    if (bandThresholds === null) {
      return null;
    }
    policy.bandThresholds = bandThresholds;
  }

  if ("weights" in input) {
    const weights = parsePartialNumberRecord(input.weights, [
      "structure",
      "semantic",
      "codegen",
    ]);
    if (weights === null) {
      return null;
    }
    policy.weights = weights;
  }

  if ("maxAcceptableDepth" in input) {
    const maxAcceptableDepth = parseFiniteNumber(input.maxAcceptableDepth);
    if (maxAcceptableDepth === null) {
      return null;
    }
    policy.maxAcceptableDepth = maxAcceptableDepth;
  }

  if ("maxAcceptableNodes" in input) {
    const maxAcceptableNodes = parseFiniteNumber(input.maxAcceptableNodes);
    if (maxAcceptableNodes === null) {
      return null;
    }
    policy.maxAcceptableNodes = maxAcceptableNodes;
  }

  if ("riskSeverityOverrides" in input) {
    const riskSeverityOverrides = parseRiskSeverityOverrides(
      input.riskSeverityOverrides,
    );
    if (riskSeverityOverrides === null) {
      return null;
    }
    policy.riskSeverityOverrides = riskSeverityOverrides;
  }

  return policy;
}

function parseWorkspaceTokenPolicy(input: unknown): WorkspaceTokenPolicy | null {
  if (!isRecord(input)) {
    return null;
  }

  const policy: WorkspaceTokenPolicy = {};

  if ("autoAcceptConfidence" in input) {
    const autoAcceptConfidence = parseFiniteNumber(input.autoAcceptConfidence);
    if (autoAcceptConfidence === null) {
      return null;
    }
    policy.autoAcceptConfidence = autoAcceptConfidence;
  }

  if ("maxConflictDelta" in input) {
    const maxConflictDelta = parseFiniteNumber(input.maxConflictDelta);
    if (maxConflictDelta === null) {
      return null;
    }
    policy.maxConflictDelta = maxConflictDelta;
  }

  if ("disabled" in input) {
    if (typeof input.disabled !== "boolean") {
      return null;
    }
    policy.disabled = input.disabled;
  }

  return policy;
}

function parseWorkspaceA11yPolicy(input: unknown): WorkspaceA11yPolicy | null {
  if (!isRecord(input)) {
    return null;
  }

  const policy: WorkspaceA11yPolicy = {};

  if ("wcagLevel" in input) {
    if (input.wcagLevel !== "AA" && input.wcagLevel !== "AAA") {
      return null;
    }
    policy.wcagLevel = input.wcagLevel;
  }

  if ("disabledRules" in input) {
    const disabledRules = parseStringArray(input.disabledRules);
    if (disabledRules === null) {
      return null;
    }
    policy.disabledRules = disabledRules;
  }

  return policy;
}

function parseWorkspaceGovernancePolicy(
  input: unknown,
): WorkspaceGovernancePolicy | null {
  if (!isRecord(input)) {
    return null;
  }

  const policy: WorkspaceGovernancePolicy = {};

  if ("minQualityScoreToApply" in input) {
    if (input.minQualityScoreToApply === null) {
      policy.minQualityScoreToApply = null;
    } else {
      const minQualityScoreToApply = parseFiniteNumber(
        input.minQualityScoreToApply,
      );
      if (minQualityScoreToApply === null) {
        return null;
      }
      policy.minQualityScoreToApply = minQualityScoreToApply;
    }
  }

  if ("securitySensitivePatterns" in input) {
    const securitySensitivePatterns = parseStringArray(
      input.securitySensitivePatterns,
    );
    if (securitySensitivePatterns === null) {
      return null;
    }
    policy.securitySensitivePatterns = securitySensitivePatterns;
  }

  if ("requireNoteOnOverride" in input) {
    if (typeof input.requireNoteOnOverride !== "boolean") {
      return null;
    }
    policy.requireNoteOnOverride = input.requireNoteOnOverride;
  }

  return policy;
}

function parsePartialNumberRecord<TKeys extends string>(
  input: unknown,
  keys: readonly TKeys[],
): Partial<Record<TKeys, number>> | null {
  if (!isRecord(input)) {
    return null;
  }

  const record: Partial<Record<TKeys, number>> = {};
  for (const key of keys) {
    if (!(key in input)) {
      continue;
    }

    const value = parseFiniteNumber(input[key]);
    if (value === null) {
      return null;
    }
    record[key] = value;
  }

  return record;
}

function parseRiskSeverityOverrides(
  input: unknown,
): Record<string, QualityRiskSeverity> | null {
  if (!isRecord(input)) {
    return null;
  }

  const overrides: Record<string, QualityRiskSeverity> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      value !== "high" &&
      value !== "medium" &&
      value !== "low"
    ) {
      return null;
    }
    overrides[key] = value;
  }

  return overrides;
}

function parseStringArray(input: unknown): string[] | null {
  if (!Array.isArray(input)) {
    return null;
  }

  if (!input.every((value) => typeof value === "string")) {
    return null;
  }

  return [...input];
}

function parseFiniteNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
