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

interface DroppedGovernanceSecuritySensitivePattern {
  index: number;
  value: string;
}

interface ParsedSectionResult<T> {
  policy: T;
  unknownKeys: string[];
}

interface ParsedGovernancePolicyResult {
  policy: InspectorWorkspaceGovernancePolicy;
  unknownKeys: string[];
  droppedSecuritySensitivePatterns: DroppedGovernanceSecuritySensitivePattern[];
}

interface ParseInspectorPolicyResult {
  policy: InspectorWorkspacePolicy | null;
  unknownKeys: string[];
  droppedGovernanceSecuritySensitivePatterns: DroppedGovernanceSecuritySensitivePattern[];
}

const INVALID = Symbol("invalid");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function isFiniteNumberAtLeast(value: unknown, min: number): value is number {
  return isFiniteNumber(value) && value >= min;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function collectUnknownKeys(
  value: Record<string, unknown>,
  knownKeys: readonly string[],
  pathPrefix: string,
): string[] {
  const known = new Set<string>(knownKeys);
  const unknown: string[] = [];
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      unknown.push(pathPrefix === "" ? key : `${pathPrefix}.${key}`);
    }
  }
  return unknown;
}

const TOP_LEVEL_KNOWN_KEYS = [
  "quality",
  "tokens",
  "a11y",
  "governance",
] as const;
const QUALITY_KNOWN_KEYS = [
  "bandThresholds",
  "weights",
  "maxAcceptableDepth",
  "maxAcceptableNodes",
  "riskSeverityOverrides",
] as const;
const QUALITY_BAND_THRESHOLDS_KNOWN_KEYS = [
  "excellent",
  "good",
  "fair",
] as const;
const QUALITY_WEIGHTS_KNOWN_KEYS = [
  "structure",
  "semantic",
  "codegen",
] as const;
const TOKENS_KNOWN_KEYS = [
  "autoAcceptConfidence",
  "maxConflictDelta",
  "disabled",
] as const;
const A11Y_KNOWN_KEYS = ["wcagLevel", "disabledRules"] as const;
const GOVERNANCE_KNOWN_KEYS = [
  "minQualityScoreToApply",
  "securitySensitivePatterns",
  "requireNoteOnOverride",
] as const;

const GOVERNANCE_REGEX_STYLE_PATTERNS = [
  /\\/,
  /[\^$|]/,
  /\[[^\]]*\]/,
  /\(\?/,
  /\{\d+(,\d*)?\}/,
  /(?:^|[^\\])\.(?:$|[*+?]|\{\d+(,\d*)?\})/,
  /\([^)]*\)(?:[*+?]|\{\d+(,\d*)?\})/,
  /\([^)]*[\\.^$|*?[\]{}][^)]*\)/,
] as const;

function hasLikelyRegexStyleGovernancePattern(pattern: string): boolean {
  return GOVERNANCE_REGEX_STYLE_PATTERNS.some((candidate) =>
    candidate.test(pattern),
  );
}

function parseQualityPolicy(
  value: unknown,
):
  | ParsedSectionResult<InspectorWorkspaceQualityPolicy>
  | typeof INVALID
  | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const unknownKeys = collectUnknownKeys(value, QUALITY_KNOWN_KEYS, "quality");
  const out: InspectorWorkspaceQualityPolicy = {};
  if (value.bandThresholds !== undefined) {
    if (!isRecord(value.bandThresholds)) return INVALID;
    unknownKeys.push(
      ...collectUnknownKeys(
        value.bandThresholds,
        QUALITY_BAND_THRESHOLDS_KNOWN_KEYS,
        "quality.bandThresholds",
      ),
    );
    const thresholds: NonNullable<
      InspectorWorkspaceQualityPolicy["bandThresholds"]
    > = {};
    for (const key of QUALITY_BAND_THRESHOLDS_KNOWN_KEYS) {
      const candidate = value.bandThresholds[key];
      if (candidate === undefined) continue;
      if (!isFiniteNumberInRange(candidate, 0, 100)) return INVALID;
      thresholds[key] = candidate;
    }
    out.bandThresholds = thresholds;
  }

  if (value.weights !== undefined) {
    if (!isRecord(value.weights)) return INVALID;
    unknownKeys.push(
      ...collectUnknownKeys(
        value.weights,
        QUALITY_WEIGHTS_KNOWN_KEYS,
        "quality.weights",
      ),
    );
    const weights: NonNullable<InspectorWorkspaceQualityPolicy["weights"]> = {};
    for (const key of QUALITY_WEIGHTS_KNOWN_KEYS) {
      const candidate = value.weights[key];
      if (candidate === undefined) continue;
      if (!isFiniteNumberAtLeast(candidate, 0)) return INVALID;
      weights[key] = candidate;
    }
    out.weights = weights;
  }

  if (value.maxAcceptableDepth !== undefined) {
    if (!isFiniteNumberAtLeast(value.maxAcceptableDepth, 0)) return INVALID;
    out.maxAcceptableDepth = value.maxAcceptableDepth;
  }
  if (value.maxAcceptableNodes !== undefined) {
    if (!isFiniteNumberAtLeast(value.maxAcceptableNodes, 0)) return INVALID;
    out.maxAcceptableNodes = value.maxAcceptableNodes;
  }

  if (value.riskSeverityOverrides !== undefined) {
    if (!isRecord(value.riskSeverityOverrides)) return INVALID;
    const overrides: Record<string, Severity> = {};
    for (const [key, candidate] of Object.entries(
      value.riskSeverityOverrides,
    )) {
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

  return { policy: out, unknownKeys };
}

function parseTokenPolicy(
  value: unknown,
):
  | ParsedSectionResult<InspectorWorkspaceTokenPolicy>
  | typeof INVALID
  | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const unknownKeys = collectUnknownKeys(value, TOKENS_KNOWN_KEYS, "tokens");
  const out: InspectorWorkspaceTokenPolicy = {};
  if (value.autoAcceptConfidence !== undefined) {
    if (!isFiniteNumberInRange(value.autoAcceptConfidence, 0, 100)) {
      return INVALID;
    }
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
  return { policy: out, unknownKeys };
}

function parseA11yPolicy(
  value: unknown,
):
  | ParsedSectionResult<InspectorWorkspaceA11yPolicy>
  | typeof INVALID
  | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const unknownKeys = collectUnknownKeys(value, A11Y_KNOWN_KEYS, "a11y");
  const out: InspectorWorkspaceA11yPolicy = {};
  if (value.wcagLevel !== undefined) {
    if (value.wcagLevel !== "AA" && value.wcagLevel !== "AAA") return INVALID;
    out.wcagLevel = value.wcagLevel;
  }
  if (value.disabledRules !== undefined) {
    if (!isStringArray(value.disabledRules)) return INVALID;
    out.disabledRules = [...value.disabledRules];
  }
  return { policy: out, unknownKeys };
}

function parseGovernancePolicy(
  value: unknown,
): ParsedGovernancePolicyResult | typeof INVALID | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return INVALID;

  const unknownKeys = collectUnknownKeys(
    value,
    GOVERNANCE_KNOWN_KEYS,
    "governance",
  );
  const out: InspectorWorkspaceGovernancePolicy = {};
  const droppedSecuritySensitivePatterns: DroppedGovernanceSecuritySensitivePattern[] =
    [];
  if (value.minQualityScoreToApply !== undefined) {
    if (value.minQualityScoreToApply !== null) {
      if (!isFiniteNumberInRange(value.minQualityScoreToApply, 0, 100)) {
        return INVALID;
      }
    }
    out.minQualityScoreToApply = value.minQualityScoreToApply;
  }
  if (value.securitySensitivePatterns !== undefined) {
    if (!isStringArray(value.securitySensitivePatterns)) return INVALID;
    const securitySensitivePatterns: string[] = [];
    for (const [index, pattern] of value.securitySensitivePatterns.entries()) {
      if (hasLikelyRegexStyleGovernancePattern(pattern)) {
        droppedSecuritySensitivePatterns.push({ index, value: pattern });
        continue;
      }
      securitySensitivePatterns.push(pattern);
    }
    out.securitySensitivePatterns = securitySensitivePatterns;
  }
  if (value.requireNoteOnOverride !== undefined) {
    if (typeof value.requireNoteOnOverride !== "boolean") return INVALID;
    out.requireNoteOnOverride = value.requireNoteOnOverride;
  }
  return { policy: out, unknownKeys, droppedSecuritySensitivePatterns };
}

function parseInspectorPolicyResult(
  value: unknown,
): ParseInspectorPolicyResult {
  if (!isRecord(value)) {
    return {
      policy: null,
      unknownKeys: [],
      droppedGovernanceSecuritySensitivePatterns: [],
    };
  }

  const unknownKeys = collectUnknownKeys(value, TOP_LEVEL_KNOWN_KEYS, "");

  const quality = parseQualityPolicy(value.quality);
  if (quality === INVALID) {
    return {
      policy: null,
      unknownKeys: [],
      droppedGovernanceSecuritySensitivePatterns: [],
    };
  }
  const tokens = parseTokenPolicy(value.tokens);
  if (tokens === INVALID) {
    return {
      policy: null,
      unknownKeys: [],
      droppedGovernanceSecuritySensitivePatterns: [],
    };
  }
  const a11y = parseA11yPolicy(value.a11y);
  if (a11y === INVALID) {
    return {
      policy: null,
      unknownKeys: [],
      droppedGovernanceSecuritySensitivePatterns: [],
    };
  }
  const governance = parseGovernancePolicy(value.governance);
  if (governance === INVALID) {
    return {
      policy: null,
      unknownKeys: [],
      droppedGovernanceSecuritySensitivePatterns: [],
    };
  }

  if (quality !== undefined) unknownKeys.push(...quality.unknownKeys);
  if (tokens !== undefined) unknownKeys.push(...tokens.unknownKeys);
  if (a11y !== undefined) unknownKeys.push(...a11y.unknownKeys);
  if (governance !== undefined) unknownKeys.push(...governance.unknownKeys);

  return {
    policy: {
      ...(quality !== undefined ? { quality: quality.policy } : {}),
      ...(tokens !== undefined ? { tokens: tokens.policy } : {}),
      ...(a11y !== undefined ? { a11y: a11y.policy } : {}),
      ...(governance !== undefined ? { governance: governance.policy } : {}),
    },
    unknownKeys,
    droppedGovernanceSecuritySensitivePatterns:
      governance?.droppedSecuritySensitivePatterns ?? [],
  };
}

export function parseInspectorPolicy(
  value: unknown,
): InspectorWorkspacePolicy | null {
  return parseInspectorPolicyResult(value).policy;
}

function formatDroppedGovernanceSecuritySensitivePatternsWarning(
  droppedPatterns: DroppedGovernanceSecuritySensitivePattern[],
): string {
  const formattedEntries = droppedPatterns
    .map(({ index, value }) => `[${index}] ${JSON.stringify(value)}`)
    .join(", ");

  return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' dropped regex-style governance.securitySensitivePatterns entries: ${formattedEntries}.`;
}

function formatUnknownKeysWarning(unknownKeys: string[]): string {
  const formattedEntries = unknownKeys
    .map((entry) => JSON.stringify(entry))
    .join(", ");
  return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' ignored unknown keys: ${formattedEntries}.`;
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

  const result = parseInspectorPolicyResult(parsed);
  if (result.policy === null) {
    return {
      policy: null,
      warning: `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' has an invalid shape and was ignored.`,
    };
  }

  const warnings: string[] = [];
  if (result.unknownKeys.length > 0) {
    warnings.push(formatUnknownKeysWarning(result.unknownKeys));
  }
  if (result.droppedGovernanceSecuritySensitivePatterns.length > 0) {
    warnings.push(
      formatDroppedGovernanceSecuritySensitivePatternsWarning(
        result.droppedGovernanceSecuritySensitivePatterns,
      ),
    );
  }

  return {
    policy: result.policy,
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
  };
}
