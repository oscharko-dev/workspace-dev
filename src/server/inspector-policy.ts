import { readFile } from "node:fs/promises";
import path from "node:path";

export const INSPECTOR_POLICY_FILE_NAME = ".workspace-inspector-policy.json";

type Severity = "high" | "medium" | "low";

export interface InspectorWorkspaceQualityPolicy {
  bandThresholds?: Partial<{
    excellent: number;
    good: number;
    fair: number;
  }>;
  weights?: Partial<{
    structure: number;
    semantic: number;
    codegen: number;
  }>;
  maxAcceptableDepth?: number;
  maxAcceptableNodes?: number;
  riskSeverityOverrides?: Record<string, Severity>;
}

export interface InspectorWorkspaceTokenPolicy {
  autoAcceptConfidence?: number;
  maxConflictDelta?: number;
  disabled?: boolean;
}

export interface InspectorWorkspaceA11yPolicy {
  wcagLevel?: "AA" | "AAA";
  disabledRules?: string[];
}

export interface InspectorWorkspaceGovernancePolicy {
  minQualityScoreToApply?: number | null;
  securitySensitivePatterns?: string[];
  requireNoteOnOverride?: boolean;
}

export interface InspectorWorkspacePolicy {
  quality?: InspectorWorkspaceQualityPolicy;
  tokens?: InspectorWorkspaceTokenPolicy;
  a11y?: InspectorWorkspaceA11yPolicy;
  governance?: InspectorWorkspaceGovernancePolicy;
}

export interface LoadInspectorPolicyResult {
  policy: InspectorWorkspacePolicy | null;
  warning?: string;
}

const INVALID = Symbol("invalid");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseQualityPolicy(
  value: unknown,
): InspectorWorkspaceQualityPolicy | typeof INVALID | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const out: InspectorWorkspaceQualityPolicy = {};
  if (value.bandThresholds !== undefined) {
    if (!isRecord(value.bandThresholds)) return INVALID;
    const thresholds: NonNullable<InspectorWorkspaceQualityPolicy["bandThresholds"]> =
      {};
    for (const key of ["excellent", "good", "fair"] as const) {
      const candidate = value.bandThresholds[key];
      if (candidate === undefined) continue;
      if (!isFiniteNumber(candidate)) return INVALID;
      thresholds[key] = candidate;
    }
    out.bandThresholds = thresholds;
  }

  if (value.weights !== undefined) {
    if (!isRecord(value.weights)) return INVALID;
    const weights: NonNullable<InspectorWorkspaceQualityPolicy["weights"]> = {};
    for (const key of ["structure", "semantic", "codegen"] as const) {
      const candidate = value.weights[key];
      if (candidate === undefined) continue;
      if (!isFiniteNumber(candidate)) return INVALID;
      weights[key] = candidate;
    }
    out.weights = weights;
  }

  if (value.maxAcceptableDepth !== undefined) {
    if (!isFiniteNumber(value.maxAcceptableDepth)) return INVALID;
    out.maxAcceptableDepth = value.maxAcceptableDepth;
  }
  if (value.maxAcceptableNodes !== undefined) {
    if (!isFiniteNumber(value.maxAcceptableNodes)) return INVALID;
    out.maxAcceptableNodes = value.maxAcceptableNodes;
  }

  if (value.riskSeverityOverrides !== undefined) {
    if (!isRecord(value.riskSeverityOverrides)) return INVALID;
    const overrides: Record<string, Severity> = {};
    for (const [key, candidate] of Object.entries(value.riskSeverityOverrides)) {
      if (
        candidate !== "high" &&
        candidate !== "medium" &&
        candidate !== "low"
      ) {
        return INVALID;
      }
      overrides[key] = candidate;
    }
    out.riskSeverityOverrides = overrides;
  }

  return out;
}

function parseTokenPolicy(
  value: unknown,
): InspectorWorkspaceTokenPolicy | typeof INVALID | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const out: InspectorWorkspaceTokenPolicy = {};
  if (value.autoAcceptConfidence !== undefined) {
    if (!isFiniteNumber(value.autoAcceptConfidence)) return INVALID;
    out.autoAcceptConfidence = value.autoAcceptConfidence;
  }
  if (value.maxConflictDelta !== undefined) {
    if (!isFiniteNumber(value.maxConflictDelta)) return INVALID;
    out.maxConflictDelta = value.maxConflictDelta;
  }
  if (value.disabled !== undefined) {
    if (typeof value.disabled !== "boolean") return INVALID;
    out.disabled = value.disabled;
  }
  return out;
}

function parseA11yPolicy(
  value: unknown,
): InspectorWorkspaceA11yPolicy | typeof INVALID | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const out: InspectorWorkspaceA11yPolicy = {};
  if (value.wcagLevel !== undefined) {
    if (value.wcagLevel !== "AA" && value.wcagLevel !== "AAA") return INVALID;
    out.wcagLevel = value.wcagLevel;
  }
  if (value.disabledRules !== undefined) {
    if (!isStringArray(value.disabledRules)) return INVALID;
    out.disabledRules = [...value.disabledRules];
  }
  return out;
}

function parseGovernancePolicy(
  value: unknown,
): InspectorWorkspaceGovernancePolicy | typeof INVALID | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const out: InspectorWorkspaceGovernancePolicy = {};
  if (value.minQualityScoreToApply !== undefined) {
    if (value.minQualityScoreToApply !== null) {
      if (!isFiniteNumber(value.minQualityScoreToApply)) return INVALID;
    }
    out.minQualityScoreToApply = value.minQualityScoreToApply;
  }
  if (value.securitySensitivePatterns !== undefined) {
    if (!isStringArray(value.securitySensitivePatterns)) return INVALID;
    out.securitySensitivePatterns = [...value.securitySensitivePatterns];
  }
  if (value.requireNoteOnOverride !== undefined) {
    if (typeof value.requireNoteOnOverride !== "boolean") return INVALID;
    out.requireNoteOnOverride = value.requireNoteOnOverride;
  }
  return out;
}

export function parseInspectorPolicy(
  value: unknown,
): InspectorWorkspacePolicy | null {
  if (!isRecord(value)) return null;

  const quality = parseQualityPolicy(value.quality);
  if (quality === INVALID) return null;
  const tokens = parseTokenPolicy(value.tokens);
  if (tokens === INVALID) return null;
  const a11y = parseA11yPolicy(value.a11y);
  if (a11y === INVALID) return null;
  const governance = parseGovernancePolicy(value.governance);
  if (governance === INVALID) return null;

  return {
    ...(quality !== undefined ? { quality } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
    ...(a11y !== undefined ? { a11y } : {}),
    ...(governance !== undefined ? { governance } : {}),
  };
}

export async function loadInspectorPolicy({
  workspaceRoot,
}: {
  workspaceRoot: string;
}): Promise<LoadInspectorPolicyResult> {
  const policyPath = path.join(workspaceRoot, INSPECTOR_POLICY_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(policyPath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { policy: null };
    }
    return {
      policy: null,
      warning: `Failed to load inspector policy '${INSPECTOR_POLICY_FILE_NAME}': ${
        error instanceof Error ? error.message : String(error)
      }.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      policy: null,
      warning: `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' is not valid JSON and was ignored.`,
    };
  }

  const policy = parseInspectorPolicy(parsed);
  if (policy === null) {
    return {
      policy: null,
      warning: `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' has an invalid shape and was ignored.`,
    };
  }

  return { policy };
}
