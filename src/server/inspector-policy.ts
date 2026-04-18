import { readFile } from "node:fs/promises";
import path from "node:path";

export const INSPECTOR_POLICY_FILE_NAME = ".workspace-inspector-policy.json";
const INSPECTOR_POLICY_ROOT_PATH = "$";
const VALUE_PREVIEW_MAX_LENGTH = 160;

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
  validation: InspectorPolicyValidation;
  warning?: string;
}

export interface InspectorPolicyValidationDiagnostic {
  severity: "warning" | "error";
  code: string;
  path: string;
  message: string;
  valuePreview?: string;
}

export interface InspectorPolicyValidation {
  state: "absent" | "loaded" | "degraded" | "rejected";
  diagnostics: InspectorPolicyValidationDiagnostic[];
}

interface ParsedSectionResult<T> {
  policy: T;
  diagnostics: InspectorPolicyValidationDiagnostic[];
}

interface ParseInspectorPolicyResult {
  policy: InspectorWorkspacePolicy | null;
  validation: InspectorPolicyValidation;
}

const INVALID = Symbol("invalid");

interface InvalidPolicyParse {
  [INVALID]: true;
  fatalDiagnostic: InspectorPolicyValidationDiagnostic;
  diagnostics: InspectorPolicyValidationDiagnostic[];
}

type ParseSectionOutcome<T> = ParsedSectionResult<T> | undefined | InvalidPolicyParse;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function previewValue(value: unknown): string {
  let preview: string;
  try {
    const serialized = JSON.stringify(value) as string | undefined;
    preview = serialized === undefined ? String(value) : serialized;
  } catch {
    preview = String(value);
  }

  if (preview.length <= VALUE_PREVIEW_MAX_LENGTH) {
    return preview;
  }

  return `${preview.slice(0, VALUE_PREVIEW_MAX_LENGTH - 1)}…`;
}

function createValidationDiagnostic({
  severity,
  code,
  path,
  message,
  value,
}: {
  severity: "warning" | "error";
  code: string;
  path: string;
  message: string;
  value?: unknown;
}): InspectorPolicyValidationDiagnostic {
  return {
    severity,
    code,
    path,
    message,
    ...(value !== undefined ? { valuePreview: previewValue(value) } : {}),
  };
}

function createUnknownKeyDiagnostic(
  path: string,
): InspectorPolicyValidationDiagnostic {
  return createValidationDiagnostic({
    severity: "warning",
    code: "unknown_key_ignored",
    path,
    message: "Ignored unknown inspector policy key.",
  });
}

function createInvalidParse(
  fatalDiagnostic: InspectorPolicyValidationDiagnostic,
  diagnostics: InspectorPolicyValidationDiagnostic[] = [],
): InvalidPolicyParse {
  return {
    [INVALID]: true,
    fatalDiagnostic,
    diagnostics,
  };
}

function isInvalidParse(value: unknown): value is InvalidPolicyParse {
  return typeof value === "object" && value !== null && INVALID in value;
}

function createInvalidTypeDiagnostic(
  path: string,
  expected: string,
  value: unknown,
): InspectorPolicyValidationDiagnostic {
  return createValidationDiagnostic({
    severity: "error",
    code: "invalid_type",
    path,
    message: `Expected ${expected}.`,
    value,
  });
}

function createInvalidEnumDiagnostic(
  path: string,
  allowedValues: readonly string[],
  value: unknown,
): InspectorPolicyValidationDiagnostic {
  return createValidationDiagnostic({
    severity: "error",
    code: "invalid_enum",
    path,
    message: `Expected one of: ${allowedValues.join(", ")}.`,
    value,
  });
}

function createOutOfRangeDiagnostic(
  path: string,
  min: number,
  max: number | null,
  value: unknown,
): InspectorPolicyValidationDiagnostic {
  return createValidationDiagnostic({
    severity: "error",
    code: "out_of_range",
    path,
    message:
      max === null
        ? `Expected a finite number greater than or equal to ${min}.`
        : `Expected a finite number between ${min} and ${max}.`,
    value,
  });
}

function validateFiniteNumberInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
): InspectorPolicyValidationDiagnostic | null {
  if (!isFiniteNumber(value)) {
    return createInvalidTypeDiagnostic(
      path,
      `a finite number between ${min} and ${max}`,
      value,
    );
  }
  if (value < min || value > max) {
    return createOutOfRangeDiagnostic(path, min, max, value);
  }
  return null;
}

function validateFiniteNumberAtLeast(
  value: unknown,
  path: string,
  min: number,
): InspectorPolicyValidationDiagnostic | null {
  if (!isFiniteNumber(value)) {
    return createInvalidTypeDiagnostic(
      path,
      `a finite number greater than or equal to ${min}`,
      value,
    );
  }
  if (value < min) {
    return createOutOfRangeDiagnostic(path, min, null, value);
  }
  return null;
}

function validateFiniteNumber(
  value: unknown,
  path: string,
): InspectorPolicyValidationDiagnostic | null {
  if (!isFiniteNumber(value)) {
    return createInvalidTypeDiagnostic(path, "a finite number", value);
  }
  return null;
}

function validateStringArray(
  value: unknown,
  path: string,
): string[] | InvalidPolicyParse {
  if (!Array.isArray(value)) {
    return createInvalidParse(
      createInvalidTypeDiagnostic(path, "an array of strings", value),
    );
  }

  const out: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      return createInvalidParse(
        createInvalidTypeDiagnostic(`${path}[${index}]`, "a string", entry),
      );
    }
    out.push(entry);
  }

  return out;
}

function parseQualityPolicy(
  value: unknown,
): ParseSectionOutcome<InspectorWorkspaceQualityPolicy> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    return createInvalidParse(
      createInvalidTypeDiagnostic("quality", "an object", value),
    );
  }

  const diagnostics = collectUnknownKeys(
    value,
    QUALITY_KNOWN_KEYS,
    "quality",
  ).map((path) => createUnknownKeyDiagnostic(path));
  const out: InspectorWorkspaceQualityPolicy = {};

  if (value.bandThresholds !== undefined) {
    if (!isRecord(value.bandThresholds)) {
      return createInvalidParse(
        createInvalidTypeDiagnostic(
          "quality.bandThresholds",
          "an object",
          value.bandThresholds,
        ),
      );
    }
    diagnostics.push(
      ...collectUnknownKeys(
        value.bandThresholds,
        QUALITY_BAND_THRESHOLDS_KNOWN_KEYS,
        "quality.bandThresholds",
      ).map((path) => createUnknownKeyDiagnostic(path)),
    );
    const thresholds: NonNullable<InspectorWorkspaceQualityPolicy["bandThresholds"]> =
      {};
    for (const key of QUALITY_BAND_THRESHOLDS_KNOWN_KEYS) {
      const candidate = value.bandThresholds[key];
      if (candidate === undefined) continue;
      const diagnostic = validateFiniteNumberInRange(
        candidate,
        `quality.bandThresholds.${key}`,
        0,
        100,
      );
      if (diagnostic) {
        return createInvalidParse(diagnostic);
      }
      const threshold = candidate as number;
      thresholds[key] = threshold;
    }
    out.bandThresholds = thresholds;
  }

  if (value.weights !== undefined) {
    if (!isRecord(value.weights)) {
      return createInvalidParse(
        createInvalidTypeDiagnostic("quality.weights", "an object", value.weights),
      );
    }
    diagnostics.push(
      ...collectUnknownKeys(
        value.weights,
        QUALITY_WEIGHTS_KNOWN_KEYS,
        "quality.weights",
      ).map((path) => createUnknownKeyDiagnostic(path)),
    );
    const weights: NonNullable<InspectorWorkspaceQualityPolicy["weights"]> = {};
    for (const key of QUALITY_WEIGHTS_KNOWN_KEYS) {
      const candidate = value.weights[key];
      if (candidate === undefined) continue;
      const diagnostic = validateFiniteNumberAtLeast(
        candidate,
        `quality.weights.${key}`,
        0,
      );
      if (diagnostic) {
        return createInvalidParse(diagnostic);
      }
      const weight = candidate as number;
      weights[key] = weight;
    }
    out.weights = weights;
  }

  if (value.maxAcceptableDepth !== undefined) {
    const diagnostic = validateFiniteNumberAtLeast(
      value.maxAcceptableDepth,
      "quality.maxAcceptableDepth",
      0,
    );
    if (diagnostic) {
      return createInvalidParse(diagnostic);
    }
    const maxAcceptableDepth = value.maxAcceptableDepth as number;
    out.maxAcceptableDepth = maxAcceptableDepth;
  }
  if (value.maxAcceptableNodes !== undefined) {
    const diagnostic = validateFiniteNumberAtLeast(
      value.maxAcceptableNodes,
      "quality.maxAcceptableNodes",
      0,
    );
    if (diagnostic) {
      return createInvalidParse(diagnostic);
    }
    const maxAcceptableNodes = value.maxAcceptableNodes as number;
    out.maxAcceptableNodes = maxAcceptableNodes;
  }

  if (value.riskSeverityOverrides !== undefined) {
    if (!isRecord(value.riskSeverityOverrides)) {
      return createInvalidParse(
        createInvalidTypeDiagnostic(
          "quality.riskSeverityOverrides",
          "an object",
          value.riskSeverityOverrides,
        ),
      );
    }
    const overrides: Record<string, Severity> = {};
    for (const [key, candidate] of Object.entries(value.riskSeverityOverrides)) {
      if (
        candidate !== "high" &&
        candidate !== "medium" &&
        candidate !== "low"
      ) {
        return createInvalidParse(
          createInvalidEnumDiagnostic(
            `quality.riskSeverityOverrides.${key}`,
            ["high", "medium", "low"],
            candidate,
          ),
        );
      }
      overrides[key] = candidate;
    }
    out.riskSeverityOverrides = overrides;
  }

  return { policy: out, diagnostics };
}

function parseTokenPolicy(
  value: unknown,
): ParseSectionOutcome<InspectorWorkspaceTokenPolicy> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    return createInvalidParse(
      createInvalidTypeDiagnostic("tokens", "an object", value),
    );
  }

  const diagnostics = collectUnknownKeys(value, TOKENS_KNOWN_KEYS, "tokens").map(
    (path) => createUnknownKeyDiagnostic(path),
  );
  const out: InspectorWorkspaceTokenPolicy = {};

  if (value.autoAcceptConfidence !== undefined) {
    const diagnostic = validateFiniteNumberInRange(
      value.autoAcceptConfidence,
      "tokens.autoAcceptConfidence",
      0,
      100,
    );
    if (diagnostic) {
      return createInvalidParse(diagnostic);
    }
    const autoAcceptConfidence = value.autoAcceptConfidence as number;
    out.autoAcceptConfidence = autoAcceptConfidence;
  }
  if (value.maxConflictDelta !== undefined) {
    const diagnostic = validateFiniteNumber(
      value.maxConflictDelta,
      "tokens.maxConflictDelta",
    );
    if (diagnostic) {
      return createInvalidParse(diagnostic);
    }
    const maxConflictDelta = value.maxConflictDelta as number;
    out.maxConflictDelta = maxConflictDelta;
  }
  if (value.disabled !== undefined) {
    if (typeof value.disabled !== "boolean") {
      return createInvalidParse(
        createInvalidTypeDiagnostic("tokens.disabled", "a boolean", value.disabled),
      );
    }
    out.disabled = value.disabled;
  }

  return { policy: out, diagnostics };
}

function parseA11yPolicy(
  value: unknown,
): ParseSectionOutcome<InspectorWorkspaceA11yPolicy> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    return createInvalidParse(
      createInvalidTypeDiagnostic("a11y", "an object", value),
    );
  }

  const diagnostics = collectUnknownKeys(value, A11Y_KNOWN_KEYS, "a11y").map(
    (path) => createUnknownKeyDiagnostic(path),
  );
  const out: InspectorWorkspaceA11yPolicy = {};

  if (value.wcagLevel !== undefined) {
    if (value.wcagLevel !== "AA" && value.wcagLevel !== "AAA") {
      return createInvalidParse(
        createInvalidEnumDiagnostic("a11y.wcagLevel", ["AA", "AAA"], value.wcagLevel),
      );
    }
    out.wcagLevel = value.wcagLevel;
  }
  if (value.disabledRules !== undefined) {
    const disabledRules = validateStringArray(
      value.disabledRules,
      "a11y.disabledRules",
    );
    if (isInvalidParse(disabledRules)) {
      return disabledRules;
    }
    out.disabledRules = [...disabledRules];
  }

  return { policy: out, diagnostics };
}

function parseGovernancePolicy(
  value: unknown,
): ParseSectionOutcome<InspectorWorkspaceGovernancePolicy> {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    return createInvalidParse(
      createInvalidTypeDiagnostic("governance", "an object", value),
    );
  }

  const unknownKeyDiagnostics = collectUnknownKeys(
    value,
    GOVERNANCE_KNOWN_KEYS,
    "governance",
  ).map((path) => createUnknownKeyDiagnostic(path));
  const regexDiagnostics: InspectorPolicyValidationDiagnostic[] = [];
  const out: InspectorWorkspaceGovernancePolicy = {};

  if (value.minQualityScoreToApply !== undefined) {
    if (value.minQualityScoreToApply !== null) {
      const diagnostic = validateFiniteNumberInRange(
        value.minQualityScoreToApply,
        "governance.minQualityScoreToApply",
        0,
        100,
      );
      if (diagnostic) {
        return createInvalidParse(diagnostic, regexDiagnostics);
      }
    }
    const minQualityScoreToApply =
      value.minQualityScoreToApply as number | null;
    out.minQualityScoreToApply = minQualityScoreToApply;
  }
  if (value.securitySensitivePatterns !== undefined) {
    const stringPatterns = validateStringArray(
      value.securitySensitivePatterns,
      "governance.securitySensitivePatterns",
    );
    if (isInvalidParse(stringPatterns)) {
      return createInvalidParse(
        stringPatterns.fatalDiagnostic,
        regexDiagnostics.concat(stringPatterns.diagnostics),
      );
    }
    const securitySensitivePatterns: string[] = [];
    for (const [index, pattern] of stringPatterns.entries()) {
      if (hasLikelyRegexStyleGovernancePattern(pattern)) {
        regexDiagnostics.push(
          createValidationDiagnostic({
            severity: "warning",
            code: "regex_like_pattern_dropped",
            path: `governance.securitySensitivePatterns[${index}]`,
            message:
              "Dropped regex-like governance pattern; only literal string matches are allowed.",
            value: pattern,
          }),
        );
        continue;
      }
      securitySensitivePatterns.push(pattern);
    }
    out.securitySensitivePatterns = securitySensitivePatterns;
  }
  if (value.requireNoteOnOverride !== undefined) {
    if (typeof value.requireNoteOnOverride !== "boolean") {
      return createInvalidParse(
        createInvalidTypeDiagnostic(
          "governance.requireNoteOnOverride",
          "a boolean",
          value.requireNoteOnOverride,
        ),
        regexDiagnostics,
      );
    }
    out.requireNoteOnOverride = value.requireNoteOnOverride;
  }

  return {
    policy: out,
    diagnostics: [...unknownKeyDiagnostics, ...regexDiagnostics],
  };
}

function parseInspectorPolicyResult(
  value: unknown,
): ParseInspectorPolicyResult {
  if (!isRecord(value)) {
    return {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [
          createValidationDiagnostic({
            severity: "error",
            code: "invalid_shape",
            path: INSPECTOR_POLICY_ROOT_PATH,
            message: "Expected the policy document root to be an object.",
          }),
        ],
      },
    };
  }

  const topLevelDiagnostics = collectUnknownKeys(
    value,
    TOP_LEVEL_KNOWN_KEYS,
    "",
  ).map((path) => createUnknownKeyDiagnostic(path));

  const quality = parseQualityPolicy(value.quality);
  if (isInvalidParse(quality)) {
    return {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [quality.fatalDiagnostic, ...quality.diagnostics],
      },
    };
  }
  const tokens = parseTokenPolicy(value.tokens);
  if (isInvalidParse(tokens)) {
    return {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [tokens.fatalDiagnostic, ...tokens.diagnostics],
      },
    };
  }
  const a11y = parseA11yPolicy(value.a11y);
  if (isInvalidParse(a11y)) {
    return {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [a11y.fatalDiagnostic, ...a11y.diagnostics],
      },
    };
  }
  const governance = parseGovernancePolicy(value.governance);
  if (isInvalidParse(governance)) {
    return {
      policy: null,
      validation: {
        state: "rejected",
        diagnostics: [governance.fatalDiagnostic, ...governance.diagnostics],
      },
    };
  }

  const diagnostics = [
    ...topLevelDiagnostics,
    ...(quality?.diagnostics ?? []),
    ...(tokens?.diagnostics ?? []),
    ...(a11y?.diagnostics ?? []),
    ...(governance?.diagnostics ?? []),
  ];

  return {
    policy: {
      ...(quality !== undefined ? { quality: quality.policy } : {}),
      ...(tokens !== undefined ? { tokens: tokens.policy } : {}),
      ...(a11y !== undefined ? { a11y: a11y.policy } : {}),
      ...(governance !== undefined ? { governance: governance.policy } : {}),
    },
    validation: {
      state: diagnostics.length > 0 ? "degraded" : "loaded",
      diagnostics,
    },
  };
}

export function parseInspectorPolicy(
  value: unknown,
): InspectorWorkspacePolicy | null {
  return parseInspectorPolicyResult(value).policy;
}

function formatUnknownKeysWarning(
  diagnostics: InspectorPolicyValidationDiagnostic[],
): string {
  const formattedEntries = diagnostics
    .map((diagnostic) => JSON.stringify(diagnostic.path))
    .join(", ");
  return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' ignored unknown keys: ${formattedEntries}.`;
}

function formatDroppedGovernanceSecuritySensitivePatternsWarning(
  diagnostics: InspectorPolicyValidationDiagnostic[],
): string {
  const formattedEntries = diagnostics
    .map((diagnostic) => {
      const index = diagnostic.path.match(/\[\d+\]$/)?.[0] ?? diagnostic.path;
      return `${index} ${diagnostic.valuePreview ?? '""'}`;
    })
    .join(", ");

  return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' dropped regex-style governance.securitySensitivePatterns entries: ${formattedEntries}.`;
}

function trimTrailingPeriod(value: string): string {
  return value.endsWith(".") ? value.slice(0, -1) : value;
}

function formatRejectedPolicyWarning(
  diagnostics: InspectorPolicyValidationDiagnostic[],
): string {
  const fatalDiagnostic = diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (!fatalDiagnostic) {
    return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' was rejected.`;
  }

  if (fatalDiagnostic.code === "invalid_json") {
    return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' is not valid JSON and was ignored.`;
  }

  if (fatalDiagnostic.code === "file_unreadable") {
    return `Failed to load inspector policy '${INSPECTOR_POLICY_FILE_NAME}': ${trimTrailingPeriod(fatalDiagnostic.message)}.`;
  }

  const valueSummary =
    fatalDiagnostic.valuePreview !== undefined
      ? ` Received ${fatalDiagnostic.valuePreview}.`
      : "";
  const droppedDiagnostics = diagnostics.filter(
    (diagnostic) => diagnostic.code === "regex_like_pattern_dropped",
  );
  const droppedSummary =
    droppedDiagnostics.length > 0
      ? ` Dropped regex-style governance.securitySensitivePatterns entries before rejection: ${droppedDiagnostics
          .map((diagnostic) => {
            const index = diagnostic.path.match(/\[\d+\]$/)?.[0] ?? diagnostic.path;
            return `${index} ${diagnostic.valuePreview ?? '""'}`;
          })
          .join(", ")}.`
      : "";

  return `Inspector policy '${INSPECTOR_POLICY_FILE_NAME}' was rejected at ${fatalDiagnostic.path}: ${trimTrailingPeriod(fatalDiagnostic.message)}.${valueSummary}${droppedSummary}`;
}

function formatInspectorPolicyWarning(
  validation: InspectorPolicyValidation,
): string | undefined {
  if (validation.state === "degraded") {
    const warnings: string[] = [];
    const unknownKeyDiagnostics = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "unknown_key_ignored",
    );
    if (unknownKeyDiagnostics.length > 0) {
      warnings.push(formatUnknownKeysWarning(unknownKeyDiagnostics));
    }
    const regexDiagnostics = validation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "regex_like_pattern_dropped",
    );
    if (regexDiagnostics.length > 0) {
      warnings.push(
        formatDroppedGovernanceSecuritySensitivePatternsWarning(
          regexDiagnostics,
        ),
      );
    }
    return warnings.length > 0 ? warnings.join(" ") : undefined;
  }
  if (validation.state === "rejected") {
    return formatRejectedPolicyWarning(validation.diagnostics);
  }
  return undefined;
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
      return {
        policy: null,
        validation: {
          state: "absent",
          diagnostics: [],
        },
      };
    }
    const validation: InspectorPolicyValidation = {
      state: "rejected",
      diagnostics: [
        createValidationDiagnostic({
          severity: "error",
          code: "file_unreadable",
          path: INSPECTOR_POLICY_ROOT_PATH,
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
    const warning = formatInspectorPolicyWarning(validation);
    return {
      policy: null,
      validation,
      ...(warning !== undefined ? { warning } : {}),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    const validation: InspectorPolicyValidation = {
      state: "rejected",
      diagnostics: [
        createValidationDiagnostic({
          severity: "error",
          code: "invalid_json",
          path: INSPECTOR_POLICY_ROOT_PATH,
          message: "The file contains invalid JSON.",
        }),
      ],
    };
    const warning = formatInspectorPolicyWarning(validation);
    return {
      policy: null,
      validation,
      ...(warning !== undefined ? { warning } : {}),
    };
  }

  const result = parseInspectorPolicyResult(parsed);
  const warning = formatInspectorPolicyWarning(result.validation);
  return {
    policy: result.policy,
    validation: result.validation,
    ...(warning !== undefined ? { warning } : {}),
  };
}
