/**
 * Hand-rolled validator for the provider-neutral QC mapping profile
 * (Issue #1368).
 *
 * The validator follows the `ValidationIssue[]` pattern used elsewhere in
 * test-intelligence (e.g. `policy-profile.ts`, `test-case-validation.ts`):
 * one issue per problem, severity-tagged, with a JSON-pointer-style path
 * so callers can attach diagnostics to a UI form without re-walking the
 * structure.
 *
 * Hard invariants enforced (issue's non-goals):
 *   - The profile MUST NOT carry any credential-shaped field. Any field
 *     name that looks like a token, password, secret, api key, or bearer
 *     fails validation with `credential_like_field_present`. This guards
 *     the contract that QC credentials never flow through artifact
 *     pipelines.
 *
 * Design steps mapping:
 *   - `action` → required QC field name.
 *   - `expected` → required QC field name.
 *   - `data` → optional, may be omitted; when present, must be a non-empty
 *     string.
 *
 * The validator is pure: no IO, no clocks, no globals.
 */

import {
  type QcAdapterProvider,
  type QcMappingProfile,
  type QcMappingProfileIssue,
  type QcMappingProfileIssueCode,
  type QcMappingProfileValidationResult,
  type TestCaseValidationSeverity,
} from "../contracts/index.js";

/**
 * Heuristic — names that imply a credential-shaped value. These are
 * matched case-insensitively as substrings of any string field name on
 * the profile. Hits are blocking errors, never warnings.
 */
const CREDENTIAL_LIKE_NAME_PATTERNS: readonly RegExp[] = [
  /token/i,
  /secret/i,
  /password/i,
  /\bapi[-_ ]?key\b/i,
  /\bbearer\b/i,
  /credential/i,
  /\bauthz?\b/i,
];

const FOLDER_PATH_REGEX = /^\/Subject(?:\/[A-Za-z0-9._-][A-Za-z0-9._ -]*)+$/;

const MAX_REQUIRED_FIELDS = 64;
const MAX_FIELD_NAME_LENGTH = 64;

const SUPPORTED_TEST_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "MANUAL",
  "AUTOMATED",
  "BUSINESS-PROCESS",
]);

const looksCredentialLike = (raw: string): boolean => {
  for (const pattern of CREDENTIAL_LIKE_NAME_PATTERNS) {
    if (pattern.test(raw)) return true;
  }
  return false;
};

const hasDotOnlyFolderSegment = (path: string): boolean =>
  path.split("/").some((segment) => segment === "." || segment === "..");

const issue = (
  path: string,
  code: QcMappingProfileIssueCode,
  message: string,
  severity: TestCaseValidationSeverity = "error",
): QcMappingProfileIssue => ({ path, code, severity, message });

const validateBaseUrlAlias = (alias: unknown): QcMappingProfileIssue[] => {
  if (typeof alias !== "string" || alias.trim().length === 0) {
    return [
      issue(
        "/baseUrlAlias",
        "missing_base_url_alias",
        "baseUrlAlias is required and must be a non-empty alias string",
      ),
    ];
  }
  // Reject anything that looks like a real URL or contains userinfo —
  // credentials must never flow through the alias.
  if (/^[a-z]+:\/\//i.test(alias) || /:[^/@]*@/.test(alias)) {
    return [
      issue(
        "/baseUrlAlias",
        "invalid_base_url_alias",
        "baseUrlAlias must be a symbolic alias, not a URL or credential-bearing string",
      ),
    ];
  }
  if (looksCredentialLike(alias)) {
    return [
      issue(
        "/baseUrlAlias",
        "credential_like_field_present",
        "baseUrlAlias must not look like a credential (token/secret/password/api-key)",
      ),
    ];
  }
  return [];
};

const validateScalarPresence = (
  value: unknown,
  path: string,
  code: QcMappingProfileIssueCode,
  label: string,
): QcMappingProfileIssue[] => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [issue(path, code, `${label} is required`)];
  }
  return [];
};

const validateFolderPath = (path: unknown): QcMappingProfileIssue[] => {
  if (typeof path !== "string" || path.trim().length === 0) {
    return [
      issue(
        "/targetFolderPath",
        "missing_target_folder_path",
        "targetFolderPath is required",
      ),
    ];
  }
  if (!FOLDER_PATH_REGEX.test(path) || hasDotOnlyFolderSegment(path)) {
    return [
      issue(
        "/targetFolderPath",
        "invalid_target_folder_path",
        `targetFolderPath must match /Subject/<segment>(/<segment>)* (got: ${path})`,
      ),
    ];
  }
  return [];
};

const validateTestEntityType = (raw: unknown): QcMappingProfileIssue[] => {
  if (typeof raw !== "string" || raw.length === 0) {
    return [
      issue(
        "/testEntityType",
        "missing_test_entity_type",
        "testEntityType is required",
      ),
    ];
  }
  if (!SUPPORTED_TEST_ENTITY_TYPES.has(raw)) {
    return [
      issue(
        "/testEntityType",
        "unsupported_test_entity_type",
        `testEntityType "${raw}" is not supported (allowed: ${Array.from(
          SUPPORTED_TEST_ENTITY_TYPES,
        )
          .sort()
          .join(", ")})`,
        "warning",
      ),
    ];
  }
  return [];
};

const validateRequiredFields = (raw: unknown): QcMappingProfileIssue[] => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      issue(
        "/requiredFields",
        "missing_required_fields",
        "requiredFields must list at least one field name",
      ),
    ];
  }
  const issues: QcMappingProfileIssue[] = [];
  const seen = new Set<string>();
  const arr: unknown[] = raw;
  for (let i = 0; i < arr.length; i += 1) {
    const value = arr[i];
    const path = `/requiredFields/${i}`;
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(
        issue(
          path,
          "missing_required_fields",
          `requiredFields[${i}] must be a non-empty string`,
        ),
      );
      continue;
    }
    if (value.length > MAX_FIELD_NAME_LENGTH) {
      issues.push(
        issue(
          path,
          "missing_required_fields",
          `requiredFields[${i}] exceeds ${MAX_FIELD_NAME_LENGTH} chars`,
        ),
      );
      continue;
    }
    if (looksCredentialLike(value)) {
      issues.push(
        issue(
          path,
          "credential_like_field_present",
          `requiredFields[${i}] "${value}" looks like a credential field — credentials must not be persisted in mapping profiles`,
        ),
      );
      continue;
    }
    if (seen.has(value)) {
      issues.push(
        issue(
          path,
          "duplicate_required_field",
          `requiredFields[${i}] "${value}" is duplicated`,
        ),
      );
      continue;
    }
    seen.add(value);
  }
  if (arr.length > MAX_REQUIRED_FIELDS) {
    issues.push(
      issue(
        "/requiredFields",
        "missing_required_fields",
        `requiredFields exceeds the ${MAX_REQUIRED_FIELDS} entry cap`,
      ),
    );
  }
  return issues;
};

const validateDesignStepMapping = (raw: unknown): QcMappingProfileIssue[] => {
  if (raw === null || typeof raw !== "object") {
    return [
      issue(
        "/designStepMapping",
        "missing_design_step_mapping",
        "designStepMapping is required",
      ),
    ];
  }
  const map = raw as Record<string, unknown>;
  const issues: QcMappingProfileIssue[] = [];
  for (const required of ["action", "expected"] as const) {
    const value = map[required];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(
        issue(
          `/designStepMapping/${required}`,
          "missing_design_step_mapping",
          `designStepMapping.${required} is required`,
        ),
      );
      continue;
    }
    if (value.length > MAX_FIELD_NAME_LENGTH) {
      issues.push(
        issue(
          `/designStepMapping/${required}`,
          "design_step_mapping_field_invalid",
          `designStepMapping.${required} exceeds ${MAX_FIELD_NAME_LENGTH} chars`,
        ),
      );
      continue;
    }
    if (looksCredentialLike(value)) {
      issues.push(
        issue(
          `/designStepMapping/${required}`,
          "credential_like_field_present",
          `designStepMapping.${required} looks like a credential field`,
        ),
      );
    }
  }
  if (map["data"] !== undefined) {
    const data = map["data"];
    if (typeof data !== "string" || data.trim().length === 0) {
      issues.push(
        issue(
          "/designStepMapping/data",
          "design_step_mapping_field_invalid",
          "designStepMapping.data, when present, must be a non-empty string",
        ),
      );
    } else if (data.length > MAX_FIELD_NAME_LENGTH) {
      issues.push(
        issue(
          "/designStepMapping/data",
          "design_step_mapping_field_invalid",
          `designStepMapping.data exceeds ${MAX_FIELD_NAME_LENGTH} chars`,
        ),
      );
    } else if (looksCredentialLike(data)) {
      issues.push(
        issue(
          "/designStepMapping/data",
          "credential_like_field_present",
          "designStepMapping.data looks like a credential field",
        ),
      );
    }
  }
  return issues;
};

export interface ValidateQcMappingProfileInput {
  profile: QcMappingProfile;
  /** Provider expected by the calling adapter; used to detect mismatch. */
  expectedProvider?: QcAdapterProvider;
  /** Profile id expected by the calling adapter, when known (`opentext-alm-default`). */
  expectedProfileId?: string;
}

/**
 * Validate a QC mapping profile structurally and semantically.
 *
 * Returns a `QcMappingProfileValidationResult` with `ok = true` only when
 * the profile carries zero error-severity issues. Warnings do not block
 * the dry-run path but are surfaced in the report so reviewers can act.
 */
export const validateQcMappingProfile = (
  input: ValidateQcMappingProfileInput,
): QcMappingProfileValidationResult => {
  const profile = input.profile;
  const issues: QcMappingProfileIssue[] = [];

  // Identity / discriminator checks.
  if (
    input.expectedProvider !== undefined &&
    profile.provider !== input.expectedProvider
  ) {
    issues.push(
      issue(
        "/provider",
        "provider_mismatch",
        `Adapter expects provider "${input.expectedProvider}" but profile declares "${profile.provider}"`,
      ),
    );
  }
  if (
    input.expectedProfileId !== undefined &&
    profile.id !== input.expectedProfileId
  ) {
    issues.push(
      issue(
        "/id",
        "profile_id_mismatch",
        `Adapter expects profile id "${input.expectedProfileId}" but profile declares "${profile.id}"`,
        "warning",
      ),
    );
  }

  issues.push(...validateBaseUrlAlias(profile.baseUrlAlias));
  issues.push(
    ...validateScalarPresence(
      profile.domain,
      "/domain",
      "missing_domain",
      "domain",
    ),
  );
  issues.push(
    ...validateScalarPresence(
      profile.project,
      "/project",
      "missing_project",
      "project",
    ),
  );
  issues.push(...validateFolderPath(profile.targetFolderPath));
  issues.push(...validateTestEntityType(profile.testEntityType));
  issues.push(...validateRequiredFields(profile.requiredFields));
  issues.push(...validateDesignStepMapping(profile.designStepMapping));

  let errorCount = 0;
  let warningCount = 0;
  for (const it of issues) {
    if (it.severity === "error") errorCount += 1;
    else warningCount += 1;
  }
  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
};

const OPENTEXT_ALM_DEFAULT_REQUIRED_FIELDS: readonly string[] = Object.freeze([
  "name",
  "subtype-id",
  "user-template-id",
  "description",
  "owner",
]);

const OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING: Readonly<
  QcMappingProfile["designStepMapping"]
> = Object.freeze({
  action: "description",
  expected: "expected",
  data: "data",
});

/**
 * Built-in OpenText ALM reference mapping profile suitable for `dry_run`.
 * The profile carries no credentials; operators supply the actual base URL
 * via secret resolution at adapter invocation time.
 */
const OPENTEXT_ALM_DEFAULT_PROFILE: Readonly<QcMappingProfile> = Object.freeze({
  id: "opentext-alm-default",
  version: "1.0.0",
  provider: "opentext_alm",
  baseUrlAlias: "primary",
  domain: "DEFAULT",
  project: "default",
  targetFolderPath: "/Subject/Imported",
  testEntityType: "MANUAL",
  // Mutable contract for the public type — frozen at runtime, the deep
  // clone returned to callers is a fresh array.
  requiredFields: OPENTEXT_ALM_DEFAULT_REQUIRED_FIELDS as string[],
  designStepMapping: OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING,
});

/** Return a deep-cloned, mutable copy of the built-in mapping profile. */
export const cloneOpenTextAlmDefaultMappingProfile = (): QcMappingProfile => ({
  id: OPENTEXT_ALM_DEFAULT_PROFILE.id,
  version: OPENTEXT_ALM_DEFAULT_PROFILE.version,
  provider: OPENTEXT_ALM_DEFAULT_PROFILE.provider,
  baseUrlAlias: OPENTEXT_ALM_DEFAULT_PROFILE.baseUrlAlias,
  domain: OPENTEXT_ALM_DEFAULT_PROFILE.domain,
  project: OPENTEXT_ALM_DEFAULT_PROFILE.project,
  targetFolderPath: OPENTEXT_ALM_DEFAULT_PROFILE.targetFolderPath,
  testEntityType: OPENTEXT_ALM_DEFAULT_PROFILE.testEntityType,
  requiredFields: [...OPENTEXT_ALM_DEFAULT_REQUIRED_FIELDS],
  designStepMapping: {
    action: OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING.action,
    expected: OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING.expected,
    ...(OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING.data !== undefined
      ? { data: OPENTEXT_ALM_DEFAULT_DESIGN_STEP_MAPPING.data }
      : {}),
  },
});

/** Frozen reference profile for callers who only need to inspect it. */
export const OPENTEXT_ALM_DEFAULT_MAPPING_PROFILE: Readonly<QcMappingProfile> =
  OPENTEXT_ALM_DEFAULT_PROFILE;
