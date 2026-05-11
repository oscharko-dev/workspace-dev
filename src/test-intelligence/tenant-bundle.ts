/**
 * BYO-rubric / BYO-guidelines tenant-bundle resolver (Issue #2184).
 *
 * Customer banks and insurers register their own naming conventions,
 * compliance house standards, design-system tokens, terminology, and
 * customer-eval rubric references through a {@link TenantBundleInput}
 * JSON file passed to `test-intelligence run --tenant-bundle <path>`.
 *
 * The module is deliberately self-contained:
 *
 *   - Types live here (NOT in `src/contracts/index.ts`) because the
 *     bundle surface is the customer-facing contract and lives outside
 *     the runtime wire schema.
 *   - The resolver is deep-clone-safe: it never mutates the base
 *     {@link TestCasePolicyProfile} passed in.
 *   - A hard allow-list (`TENANT_BUNDLE_OVERRIDE_ALLOW_LIST`) is the
 *     contract surface — any top-level field outside the list is
 *     rejected.
 *   - Hard invariants ({@link TENANT_BUNDLE_SAFETY_FLOORS}) reject
 *     overrides that contradict the base policy profile's hard safety
 *     floors (e.g. the customer cannot lower `minConfidence` below the
 *     base).
 *   - Multi-tenant isolation (Issue #2176): when an active
 *     {@link TenantScope} is set, {@link assertTenantBundleScope}
 *     throws {@link TenantIsolationViolation} on a tenantId mismatch.
 *
 * The resolver emits `tenant-bundle-resolved.json` per run so audit
 * replay can reconstruct the effective merged config without re-reading
 * the customer's source file.
 */

import {
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID,
  type TestCasePolicyProfile,
  type TestCasePolicyProfileRules,
  type TestCaseRiskCategory,
  type TenantScope,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";
import {
  assertTenantScope,
  getCurrentTenantScope,
} from "./tenant-isolation-guard.js";

/** Hard cap on the raw `--tenant-bundle` JSON file size. */
export const MAX_TENANT_BUNDLE_BYTES: number = 256 * 1024;

/** Schema version pinned on every resolved tenant-bundle artifact. */
export const TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION = "1.0.0" as const;

/** Artifact filename emitted under the per-run artifact directory. */
export const TENANT_BUNDLE_RESOLVED_ARTIFACT_FILENAME =
  "tenant-bundle-resolved.json" as const;

/** Default base profile id used when the bundle omits an explicit base. */
export const TENANT_BUNDLE_DEFAULT_BASE_POLICY_PROFILE_ID: string =
  EU_BANKING_DEFAULT_POLICY_PROFILE_ID;

/**
 * Closed allow-list of top-level fields a customer is permitted to set
 * on a tenant bundle. Any other key in the source JSON is rejected.
 * This list is the customer-facing contract surface.
 */
export const TENANT_BUNDLE_OVERRIDE_ALLOW_LIST = [
  "tenantId",
  "bundleVersion",
  "inheritsFromPolicyProfile",
  "testCaseNamingConvention",
  "riskClassTaxonomy",
  "complianceHouseStandards",
  "designSystemTokens",
  "terminologyGlossary",
  "customerEvalRubric",
] as const;

export type TenantBundleAllowedField =
  (typeof TENANT_BUNDLE_OVERRIDE_ALLOW_LIST)[number];

const TENANT_BUNDLE_ALLOW_LIST_SET: ReadonlySet<string> = new Set(
  TENANT_BUNDLE_OVERRIDE_ALLOW_LIST,
);

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const BUNDLE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const NAMING_CONVENTION_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/u;
const TOKEN_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const HOUSE_STANDARD_CLAUSE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.,/()§:-]{0,127}$/u;

// ---------------------------------------------------------------------------
// Input types (the JSON shape customers author)
// ---------------------------------------------------------------------------

export interface NamingConvention {
  /** Stable id for the convention (e.g. `TC-{module}-{nnn}`). */
  readonly id: string;
  /**
   * Optional template the generator may use when emitting case titles.
   * Captured verbatim and surfaced in the resolved artifact for audit.
   */
  readonly template?: string;
  /** Optional human-readable description of the convention's rationale. */
  readonly description?: string;
}

export interface RiskClassOverride {
  /** Native risk-category from {@link TestCaseRiskCategory}. */
  readonly riskCategory: TestCaseRiskCategory;
  /**
   * Customer-facing label for the risk class (e.g. one Sparkasse's
   * "regulated" vs another's "regulated"). Never replaces the wire
   * `riskCategory` — surfaced via the resolved artifact and the
   * `[5] CustomerDomainContext` prompt section.
   */
  readonly customerLabel: string;
  /**
   * When `"review_only"`, the runtime adds `riskCategory` to the base
   * profile's `reviewOnlyRiskCategories`. Additive only — a customer
   * cannot weaken the base policy's review surface.
   */
  readonly mode?: "review_only" | "describe_only";
}

export interface HouseStandardEntry {
  /** Customer's clause number, cross-reference, or section id. */
  readonly clauseId: string;
  /** Short human-readable description (≤ 256 chars after trim). */
  readonly description: string;
  /**
   * Optional pointer to an external register / wiki. The bundle does
   * not fetch the URL — auditors follow it manually.
   */
  readonly externalRef?: string;
}

export interface DesignSystemBinding {
  /** Figma variable id or token name (e.g. `color.brand.primary`). */
  readonly tokenId: string;
  /** Customer's binding (e.g. `--ds-color-brand-primary`). */
  readonly customerBinding: string;
  /** Optional design-system family id ("mui", "fluent", customer-specific). */
  readonly family?: string;
}

export interface TerminologyEntry {
  /** Customer's preferred term (e.g. "Buchung" vs "Transaktion"). */
  readonly term: string;
  /** Definition or context shown to the prompt compiler. */
  readonly definition: string;
  /** Optional locale hint (ISO-639-1 + optional region). */
  readonly locale?: string;
}

export interface CustomerEvalRubricRef {
  /**
   * Pointer to the customer-eval rubric markdown. The bundle does NOT
   * load this file — the runner's separate `--customer-eval-markdown`
   * loader does, and the bundle's `path` is recorded in the resolved
   * artifact for audit cross-reference.
   */
  readonly path: string;
  /** Optional SHA-256 hex digest the customer pre-computed for the rubric. */
  readonly expectedSha256?: string;
}

/** Raw JSON shape an operator authors. */
export interface TenantBundleInput {
  readonly tenantId: string;
  readonly bundleVersion: string;
  readonly inheritsFromPolicyProfile?: string;
  readonly testCaseNamingConvention?: NamingConvention;
  readonly riskClassTaxonomy?: readonly RiskClassOverride[];
  readonly complianceHouseStandards?: readonly HouseStandardEntry[];
  readonly designSystemTokens?: readonly DesignSystemBinding[];
  readonly terminologyGlossary?: readonly TerminologyEntry[];
  readonly customerEvalRubric?: CustomerEvalRubricRef;
}

// ---------------------------------------------------------------------------
// Canonical / resolved form
// ---------------------------------------------------------------------------

export interface CanonicalTenantBundle {
  readonly schemaVersion: typeof TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly bundleVersion: string;
  readonly inheritsFromPolicyProfile: string;
  readonly testCaseNamingConvention?: NamingConvention;
  readonly riskClassTaxonomy: readonly RiskClassOverride[];
  readonly complianceHouseStandards: readonly HouseStandardEntry[];
  readonly designSystemTokens: readonly DesignSystemBinding[];
  readonly terminologyGlossary: readonly TerminologyEntry[];
  readonly customerEvalRubric?: CustomerEvalRubricRef;
  /** SHA-256 hex digest of the canonical bundle (excluding contentHash). */
  readonly contentHash: string;
}

export interface ResolvedTenantBundle {
  readonly schemaVersion: typeof TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION;
  readonly bundle: CanonicalTenantBundle;
  /** Deep-cloned merged policy profile — safe to hand to downstream gates. */
  readonly mergedPolicyProfile: TestCasePolicyProfile;
  /** Sorted list of policy-profile fields the bundle actually touched. */
  readonly appliedOverrides: readonly string[];
  /** Stable certification line auditable from the artifact. */
  readonly certification: typeof TENANT_BUNDLE_RESOLVED_CERTIFICATION;
}

export const TENANT_BUNDLE_RESOLVED_CERTIFICATION =
  "tenant bundle merged against base policy profile under hard allow-list and safety-floor invariants" as const;

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface TenantBundleIssue {
  /** JSON path of the offending field. */
  readonly path: string;
  readonly message: string;
}

export type ParseAndCanonicalizeTenantBundleResult =
  | { ok: true; bundle: CanonicalTenantBundle }
  | { ok: false; issues: readonly TenantBundleIssue[] };

// ---------------------------------------------------------------------------
// Safety-floor invariants
// ---------------------------------------------------------------------------

/**
 * Hard floors / ceilings the customer cannot weaken. Each entry is a
 * predicate over the *base* profile rules — when a bundle attempts a
 * forbidden change the resolver rejects the load with a structured
 * issue. The list is intentionally short and exhaustive: every entry
 * is an audited safety invariant.
 *
 * The override surface that the bundle actually exposes today is
 * **additive only** (extending `reviewOnlyRiskCategories`, adding
 * terminology, recording house standards). The safety floors are
 * pre-wired so that any future extension that lets a customer set a
 * numeric threshold or gate mode trips this check before it can ship.
 */
export const TENANT_BUNDLE_SAFETY_FLOORS: readonly {
  readonly field: string;
  readonly direction: "minimum" | "maximum";
  readonly rationale: string;
}[] = [
  {
    field: "rules.minConfidence",
    direction: "minimum",
    rationale:
      "minConfidence is the secure floor; lowering it would weaken needs_review escalation.",
  },
  {
    field: "rules.fieldCoverageRatioMin",
    direction: "minimum",
    rationale:
      "fieldCoverageRatioMin is the logic-judge coverage hard-gate floor.",
  },
  {
    field: "rules.actionCoverageRatioMin",
    direction: "minimum",
    rationale:
      "actionCoverageRatioMin is the logic-judge coverage hard-gate floor.",
  },
  {
    field: "rules.negativeCaseLift.thresholdRatio",
    direction: "minimum",
    rationale:
      "negativeCaseLift.thresholdRatio is the adversarial-critic lift floor.",
  },
  {
    field: "rules.duplicateSimilarityThreshold",
    direction: "maximum",
    rationale:
      "duplicateSimilarityThreshold is a ceiling — raising it would let near-duplicates slip through.",
  },
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const trimOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

/**
 * Parse a raw JSON string into a {@link CanonicalTenantBundle}. The
 * function never reads the filesystem and never calls the LLM — it is
 * a pure validator + canonicalizer.
 */
export const parseAndCanonicalizeTenantBundle = (
  rawJson: string,
): ParseAndCanonicalizeTenantBundleResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return {
      ok: false,
      issues: [{ path: "$", message: "tenant bundle is not valid JSON" }],
    };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "tenant bundle must be a JSON object" }],
    };
  }

  const issues: TenantBundleIssue[] = [];

  for (const key of Object.keys(parsed)) {
    if (!TENANT_BUNDLE_ALLOW_LIST_SET.has(key)) {
      issues.push({
        path: key,
        message: `unknown top-level field "${key}"; allow-list: ${TENANT_BUNDLE_OVERRIDE_ALLOW_LIST.join(", ")}`,
      });
    }
  }

  const tenantId = trimOrUndefined(parsed.tenantId);
  if (tenantId === undefined) {
    issues.push({ path: "tenantId", message: "tenantId is required" });
  } else if (!TENANT_ID_PATTERN.test(tenantId)) {
    issues.push({
      path: "tenantId",
      message: `tenantId must match ${TENANT_ID_PATTERN.source}`,
    });
  }

  const bundleVersion = trimOrUndefined(parsed.bundleVersion);
  if (bundleVersion === undefined) {
    issues.push({
      path: "bundleVersion",
      message: "bundleVersion is required",
    });
  } else if (!BUNDLE_VERSION_PATTERN.test(bundleVersion)) {
    issues.push({
      path: "bundleVersion",
      message: "bundleVersion must follow semver (e.g. 1.0.0 or 1.0.0-rc1)",
    });
  }

  let inheritsFromPolicyProfile: string =
    TENANT_BUNDLE_DEFAULT_BASE_POLICY_PROFILE_ID;
  if (parsed.inheritsFromPolicyProfile !== undefined) {
    const value = trimOrUndefined(parsed.inheritsFromPolicyProfile);
    if (value === undefined) {
      issues.push({
        path: "inheritsFromPolicyProfile",
        message: "inheritsFromPolicyProfile must be a non-empty string",
      });
    } else if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value)) {
      issues.push({
        path: "inheritsFromPolicyProfile",
        message:
          "inheritsFromPolicyProfile must start with [A-Za-z0-9] and contain only " +
          "[A-Za-z0-9_.-] (1–128 characters)",
      });
    } else {
      inheritsFromPolicyProfile = value;
    }
  }

  let testCaseNamingConvention: NamingConvention | undefined;
  if (parsed.testCaseNamingConvention !== undefined) {
    if (!isRecord(parsed.testCaseNamingConvention)) {
      issues.push({
        path: "testCaseNamingConvention",
        message: "testCaseNamingConvention must be an object",
      });
    } else {
      const conv = parsed.testCaseNamingConvention;
      const id = trimOrUndefined(conv.id);
      if (id === undefined) {
        issues.push({
          path: "testCaseNamingConvention.id",
          message: "id is required",
        });
      } else if (!NAMING_CONVENTION_ID_PATTERN.test(id)) {
        issues.push({
          path: "testCaseNamingConvention.id",
          message: `id must match ${NAMING_CONVENTION_ID_PATTERN.source}`,
        });
      } else {
        const template = trimOrUndefined(conv.template);
        const description = trimOrUndefined(conv.description);
        if (template !== undefined && template.length > 256) {
          issues.push({
            path: "testCaseNamingConvention.template",
            message: "template must be ≤ 256 characters",
          });
        } else if (description !== undefined && description.length > 512) {
          issues.push({
            path: "testCaseNamingConvention.description",
            message: "description must be ≤ 512 characters",
          });
        } else {
          testCaseNamingConvention = {
            id,
            ...(template !== undefined ? { template } : {}),
            ...(description !== undefined ? { description } : {}),
          };
        }
      }
    }
  }

  const riskClassTaxonomy: RiskClassOverride[] = [];
  if (parsed.riskClassTaxonomy !== undefined) {
    if (!Array.isArray(parsed.riskClassTaxonomy)) {
      issues.push({
        path: "riskClassTaxonomy",
        message: "riskClassTaxonomy must be an array",
      });
    } else {
      const seen = new Set<string>();
      const list = parsed.riskClassTaxonomy as readonly unknown[];
      for (let i = 0; i < list.length; i += 1) {
        const path = `riskClassTaxonomy[${i}]`;
        const entry: unknown = list[i];
        if (!isRecord(entry)) {
          issues.push({ path, message: "must be an object" });
          continue;
        }
        const riskCategory = entry.riskCategory;
        if (
          typeof riskCategory !== "string" ||
          !RISK_CATEGORY_SET.has(riskCategory)
        ) {
          issues.push({
            path: `${path}.riskCategory`,
            message: `riskCategory must be one of ${Array.from(RISK_CATEGORY_SET).join(", ")}`,
          });
          continue;
        }
        const customerLabel = trimOrUndefined(entry.customerLabel);
        if (customerLabel === undefined) {
          issues.push({
            path: `${path}.customerLabel`,
            message: "customerLabel must be a non-empty string",
          });
          continue;
        }
        if (customerLabel.length > 128) {
          issues.push({
            path: `${path}.customerLabel`,
            message: "customerLabel must be ≤ 128 characters",
          });
          continue;
        }
        let mode: "review_only" | "describe_only" | undefined;
        if (entry.mode !== undefined) {
          if (entry.mode !== "review_only" && entry.mode !== "describe_only") {
            issues.push({
              path: `${path}.mode`,
              message: 'mode must be "review_only" or "describe_only"',
            });
            continue;
          }
          mode = entry.mode;
        }
        const key = `${riskCategory}|${customerLabel}`;
        if (seen.has(key)) {
          issues.push({
            path,
            message: `duplicate riskClassTaxonomy entry for ${riskCategory}/${customerLabel}`,
          });
          continue;
        }
        seen.add(key);
        riskClassTaxonomy.push({
          riskCategory: riskCategory as TestCaseRiskCategory,
          customerLabel,
          ...(mode !== undefined ? { mode } : {}),
        });
      }
    }
  }

  const complianceHouseStandards: HouseStandardEntry[] = [];
  if (parsed.complianceHouseStandards !== undefined) {
    if (!Array.isArray(parsed.complianceHouseStandards)) {
      issues.push({
        path: "complianceHouseStandards",
        message: "complianceHouseStandards must be an array",
      });
    } else {
      const seen = new Set<string>();
      const list = parsed.complianceHouseStandards as readonly unknown[];
      for (let i = 0; i < list.length; i += 1) {
        const path = `complianceHouseStandards[${i}]`;
        const entry: unknown = list[i];
        if (!isRecord(entry)) {
          issues.push({ path, message: "must be an object" });
          continue;
        }
        const clauseId = trimOrUndefined(entry.clauseId);
        if (clauseId === undefined) {
          issues.push({
            path: `${path}.clauseId`,
            message: "clauseId must be a non-empty string",
          });
          continue;
        }
        if (!HOUSE_STANDARD_CLAUSE_PATTERN.test(clauseId)) {
          issues.push({
            path: `${path}.clauseId`,
            message: `clauseId must match ${HOUSE_STANDARD_CLAUSE_PATTERN.source}`,
          });
          continue;
        }
        const description = trimOrUndefined(entry.description);
        if (description === undefined) {
          issues.push({
            path: `${path}.description`,
            message: "description must be a non-empty string",
          });
          continue;
        }
        if (description.length > 256) {
          issues.push({
            path: `${path}.description`,
            message: "description must be ≤ 256 characters",
          });
          continue;
        }
        const externalRef = trimOrUndefined(entry.externalRef);
        if (externalRef !== undefined) {
          if (externalRef.length > 256) {
            issues.push({
              path: `${path}.externalRef`,
              message: "externalRef must be ≤ 256 characters",
            });
            continue;
          }
          if (
            !/^https:\/\//u.test(externalRef) &&
            !/^[A-Za-z0-9_./-]+$/u.test(externalRef)
          ) {
            issues.push({
              path: `${path}.externalRef`,
              message:
                "externalRef must be an https:// URL or a safe relative path",
            });
            continue;
          }
        }
        if (seen.has(clauseId)) {
          issues.push({
            path,
            message: `duplicate complianceHouseStandards clauseId "${clauseId}"`,
          });
          continue;
        }
        seen.add(clauseId);
        complianceHouseStandards.push({
          clauseId,
          description,
          ...(externalRef !== undefined ? { externalRef } : {}),
        });
      }
    }
  }

  const designSystemTokens: DesignSystemBinding[] = [];
  if (parsed.designSystemTokens !== undefined) {
    if (!Array.isArray(parsed.designSystemTokens)) {
      issues.push({
        path: "designSystemTokens",
        message: "designSystemTokens must be an array",
      });
    } else {
      const seen = new Set<string>();
      const list = parsed.designSystemTokens as readonly unknown[];
      for (let i = 0; i < list.length; i += 1) {
        const path = `designSystemTokens[${i}]`;
        const entry: unknown = list[i];
        if (!isRecord(entry)) {
          issues.push({ path, message: "must be an object" });
          continue;
        }
        const tokenId = trimOrUndefined(entry.tokenId);
        if (tokenId === undefined) {
          issues.push({
            path: `${path}.tokenId`,
            message: "tokenId must be a non-empty string",
          });
          continue;
        }
        if (!TOKEN_ID_PATTERN.test(tokenId)) {
          issues.push({
            path: `${path}.tokenId`,
            message: `tokenId must match ${TOKEN_ID_PATTERN.source}`,
          });
          continue;
        }
        const customerBinding = trimOrUndefined(entry.customerBinding);
        if (customerBinding === undefined) {
          issues.push({
            path: `${path}.customerBinding`,
            message: "customerBinding must be a non-empty string",
          });
          continue;
        }
        if (customerBinding.length > 256) {
          issues.push({
            path: `${path}.customerBinding`,
            message: "customerBinding must be ≤ 256 characters",
          });
          continue;
        }
        const family = trimOrUndefined(entry.family);
        if (family !== undefined && !/^[A-Za-z0-9_.-]{1,64}$/u.test(family)) {
          issues.push({
            path: `${path}.family`,
            message: "family must match /^[A-Za-z0-9_.-]{1,64}$/",
          });
          continue;
        }
        if (seen.has(tokenId)) {
          issues.push({
            path,
            message: `duplicate designSystemTokens tokenId "${tokenId}"`,
          });
          continue;
        }
        seen.add(tokenId);
        designSystemTokens.push({
          tokenId,
          customerBinding,
          ...(family !== undefined ? { family } : {}),
        });
      }
    }
  }

  const terminologyGlossary: TerminologyEntry[] = [];
  if (parsed.terminologyGlossary !== undefined) {
    if (!Array.isArray(parsed.terminologyGlossary)) {
      issues.push({
        path: "terminologyGlossary",
        message: "terminologyGlossary must be an array",
      });
    } else {
      const seen = new Set<string>();
      const list = parsed.terminologyGlossary as readonly unknown[];
      for (let i = 0; i < list.length; i += 1) {
        const path = `terminologyGlossary[${i}]`;
        const entry: unknown = list[i];
        if (!isRecord(entry)) {
          issues.push({ path, message: "must be an object" });
          continue;
        }
        const term = trimOrUndefined(entry.term);
        if (term === undefined) {
          issues.push({
            path: `${path}.term`,
            message: "term must be a non-empty string",
          });
          continue;
        }
        if (term.length > 128) {
          issues.push({
            path: `${path}.term`,
            message: "term must be ≤ 128 characters",
          });
          continue;
        }
        const definition = trimOrUndefined(entry.definition);
        if (definition === undefined) {
          issues.push({
            path: `${path}.definition`,
            message: "definition must be a non-empty string",
          });
          continue;
        }
        if (definition.length > 1024) {
          issues.push({
            path: `${path}.definition`,
            message: "definition must be ≤ 1024 characters",
          });
          continue;
        }
        const locale = trimOrUndefined(entry.locale);
        if (
          locale !== undefined &&
          !/^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(locale)
        ) {
          issues.push({
            path: `${path}.locale`,
            message:
              "locale must be an ISO-639-1/-2 code with optional region (e.g. de or de-DE)",
          });
          continue;
        }
        const key = `${term}|${locale ?? ""}`;
        if (seen.has(key)) {
          issues.push({
            path,
            message: `duplicate terminologyGlossary entry for "${term}" (locale=${locale ?? "*"})`,
          });
          continue;
        }
        seen.add(key);
        terminologyGlossary.push({
          term,
          definition,
          ...(locale !== undefined ? { locale } : {}),
        });
      }
    }
  }

  let customerEvalRubric: CustomerEvalRubricRef | undefined;
  if (parsed.customerEvalRubric !== undefined) {
    if (!isRecord(parsed.customerEvalRubric)) {
      issues.push({
        path: "customerEvalRubric",
        message: "customerEvalRubric must be an object",
      });
    } else {
      const ref = parsed.customerEvalRubric;
      const path = trimOrUndefined(ref.path);
      if (path === undefined) {
        issues.push({
          path: "customerEvalRubric.path",
          message: "path must be a non-empty string",
        });
      } else if (path.length > 512) {
        issues.push({
          path: "customerEvalRubric.path",
          message: "path must be ≤ 512 characters",
        });
      } else if (path.includes("\0")) {
        issues.push({
          path: "customerEvalRubric.path",
          message: "path must not contain NUL bytes",
        });
      } else {
        const expectedSha256 = trimOrUndefined(ref.expectedSha256);
        if (
          expectedSha256 !== undefined &&
          !/^[0-9a-f]{64}$/u.test(expectedSha256)
        ) {
          issues.push({
            path: "customerEvalRubric.expectedSha256",
            message: "expectedSha256 must be a lowercase hex sha256 (64 chars)",
          });
        } else {
          customerEvalRubric = {
            path,
            ...(expectedSha256 !== undefined ? { expectedSha256 } : {}),
          };
        }
      }
    }
  }

  if (issues.length > 0 || tenantId === undefined || bundleVersion === undefined) {
    return {
      ok: false,
      issues:
        issues.length > 0
          ? issues
          : [{ path: "$", message: "tenant bundle missing required fields" }],
    };
  }

  // Deterministic sort for byte-stable canonical form.
  const sortedRiskClassTaxonomy = [...riskClassTaxonomy].sort((a, b) =>
    a.riskCategory === b.riskCategory
      ? a.customerLabel.localeCompare(b.customerLabel)
      : a.riskCategory.localeCompare(b.riskCategory),
  );
  const sortedComplianceHouseStandards = [...complianceHouseStandards].sort(
    (a, b) => a.clauseId.localeCompare(b.clauseId),
  );
  const sortedDesignSystemTokens = [...designSystemTokens].sort((a, b) =>
    a.tokenId.localeCompare(b.tokenId),
  );
  const sortedTerminology = [...terminologyGlossary].sort((a, b) => {
    if (a.term !== b.term) return a.term.localeCompare(b.term);
    return (a.locale ?? "").localeCompare(b.locale ?? "");
  });

  const withoutHash: Omit<CanonicalTenantBundle, "contentHash"> = {
    schemaVersion: TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION,
    tenantId: tenantId,
    bundleVersion: bundleVersion,
    inheritsFromPolicyProfile,
    ...(testCaseNamingConvention !== undefined
      ? { testCaseNamingConvention }
      : {}),
    riskClassTaxonomy: sortedRiskClassTaxonomy,
    complianceHouseStandards: sortedComplianceHouseStandards,
    designSystemTokens: sortedDesignSystemTokens,
    terminologyGlossary: sortedTerminology,
    ...(customerEvalRubric !== undefined ? { customerEvalRubric } : {}),
  };

  const contentHash = sha256Hex({ kind: "tenant_bundle", ...withoutHash });
  return {
    ok: true,
    bundle: { ...withoutHash, contentHash },
  };
};

const RISK_CATEGORY_SET: ReadonlySet<string> = new Set<TestCaseRiskCategory>([
  "low",
  "medium",
  "high",
  "regulated_data",
  "financial_transaction",
]);

// ---------------------------------------------------------------------------
// Resolver — merges the bundle against the base policy profile
// ---------------------------------------------------------------------------

export interface ResolveTenantBundleInput {
  readonly bundle: CanonicalTenantBundle;
  readonly baseProfile: TestCasePolicyProfile;
  /**
   * Optional active tenant scope. When supplied, the resolver asserts
   * `bundle.tenantId === activeScope.tenantId` and throws
   * `TenantIsolationViolation` on mismatch. When omitted, the resolver
   * falls back to the ALS-active scope read via
   * {@link getCurrentTenantScope}; if that is also undefined no
   * cross-tenant check fires (single-tenant CLI usage).
   */
  readonly activeScope?: TenantScope;
}

/**
 * Thrown when the bundle declares a base profile that does not match
 * the runner's actual base policy profile id (e.g. a customer bundle
 * baked against `eu-banking-default` resolved into a run that loaded
 * a different profile).
 */
export class TenantBundleBaseProfileMismatchError extends Error {
  readonly code = "TENANT_BUNDLE_BASE_PROFILE_MISMATCH" as const;
  readonly expected: string;
  readonly actual: string;

  constructor(input: { readonly expected: string; readonly actual: string }) {
    super(
      `tenant bundle inherits from "${input.expected}" but the active policy profile is "${input.actual}"; ` +
        `re-author the bundle against the active profile or pass --policy-profile ${input.expected}.`,
    );
    this.name = "TenantBundleBaseProfileMismatchError";
    this.expected = input.expected;
    this.actual = input.actual;
  }
}

/**
 * Thrown when the bundle attempts to weaken a hard safety floor on the
 * base policy profile. The set of floors is enumerated by
 * {@link TENANT_BUNDLE_SAFETY_FLOORS}.
 */
export class TenantBundleSafetyFloorViolationError extends Error {
  readonly code = "TENANT_BUNDLE_SAFETY_FLOOR_VIOLATION" as const;
  readonly field: string;
  readonly direction: "minimum" | "maximum";
  readonly baseValue: number;
  readonly proposedValue: number;
  readonly rationale: string;

  constructor(input: {
    readonly field: string;
    readonly direction: "minimum" | "maximum";
    readonly baseValue: number;
    readonly proposedValue: number;
    readonly rationale: string;
  }) {
    super(
      `tenant bundle rejected at safety floor "${input.field}": proposed ${input.proposedValue} ` +
        `${input.direction === "minimum" ? "is below" : "exceeds"} base ${input.baseValue}; ${input.rationale}`,
    );
    this.name = "TenantBundleSafetyFloorViolationError";
    this.field = input.field;
    this.direction = input.direction;
    this.baseValue = input.baseValue;
    this.proposedValue = input.proposedValue;
    this.rationale = input.rationale;
  }
}

/**
 * Assert the bundle's `tenantId` matches the supplied or ALS-active
 * `TenantScope.tenantId`. No-op when no active scope exists.
 */
export const assertTenantBundleScope = (
  bundle: CanonicalTenantBundle,
  explicitScope?: TenantScope,
): void => {
  const scope = explicitScope ?? getCurrentTenantScope();
  if (scope === undefined) return;
  if (scope.tenantId === bundle.tenantId) return;
  // Construct a synthetic "actual" scope rooted at the bundle's tenantId
  // so the violation message is symmetric with the rest of the guard.
  const actual: TenantScope = {
    tenantId: bundle.tenantId,
    environmentId: scope.environmentId,
    ...(scope.projectId !== undefined ? { projectId: scope.projectId } : {}),
  };
  assertTenantScope("tenant-bundle-load", scope, actual);
};

const deepCloneRules = (
  rules: TestCasePolicyProfileRules,
): TestCasePolicyProfileRules => {
  const out: TestCasePolicyProfileRules = {
    reviewOnlyRiskCategories: [...rules.reviewOnlyRiskCategories],
    strictRiskCategories: [...rules.strictRiskCategories],
    requireAccessibilityCaseWhenFormPresent:
      rules.requireAccessibilityCaseWhenFormPresent,
    requireNegativeOrValidationForValidationRules:
      rules.requireNegativeOrValidationForValidationRules,
    requireBoundaryCaseForRequiredFields:
      rules.requireBoundaryCaseForRequiredFields,
    minConfidence: rules.minConfidence,
    duplicateSimilarityThreshold: rules.duplicateSimilarityThreshold,
    maxOpenQuestionsPerCase: rules.maxOpenQuestionsPerCase,
    maxAssumptionsPerCase: rules.maxAssumptionsPerCase,
  };
  if (rules.judgeRefusalPolicy !== undefined) {
    out.judgeRefusalPolicy = {
      faithfulness: rules.judgeRefusalPolicy.faithfulness,
      a11y: rules.judgeRefusalPolicy.a11y,
    };
  }
  if (rules.enforceRiskTagDowngradeDetection !== undefined) {
    out.enforceRiskTagDowngradeDetection =
      rules.enforceRiskTagDowngradeDetection;
  }
  if (rules.fieldCoverageRatioMin !== undefined) {
    out.fieldCoverageRatioMin = rules.fieldCoverageRatioMin;
  }
  if (rules.actionCoverageRatioMin !== undefined) {
    out.actionCoverageRatioMin = rules.actionCoverageRatioMin;
  }
  if (rules.negativeCaseLift !== undefined) {
    out.negativeCaseLift = {
      gateMode: rules.negativeCaseLift.gateMode,
      thresholdRatio: rules.negativeCaseLift.thresholdRatio,
    };
  }
  if (rules.techniqueCoverageMinimum !== undefined) {
    out.techniqueCoverageMinimum =
      rules.techniqueCoverageMinimum.mode === "tier-elastic"
        ? {
            mode: "tier-elastic",
            ...(rules.techniqueCoverageMinimum.tiers !== undefined
              ? {
                  tiers: rules.techniqueCoverageMinimum.tiers.map((tier) => ({
                    minFieldCount: tier.minFieldCount,
                    multiplier: tier.multiplier,
                    floor: tier.floor,
                    label: tier.label,
                  })),
                }
              : {}),
          }
        : { mode: "fixed" };
  }
  if (rules.selfConsistency !== undefined) {
    out.selfConsistency = { sampleCount: rules.selfConsistency.sampleCount };
  }
  if (rules.requirePerStepFaithfulness !== undefined) {
    out.requirePerStepFaithfulness = rules.requirePerStepFaithfulness;
  }
  if (rules.finopsWallClockBudget !== undefined) {
    const b = rules.finopsWallClockBudget;
    out.finopsWallClockBudget = {
      baseMs: b.baseMs,
      perCaseMs: b.perCaseMs,
      perAdditionalJudgeMs: b.perAdditionalJudgeMs,
      perAdversarialRoundMs: b.perAdversarialRoundMs,
      visualSidecarMs: b.visualSidecarMs,
      hardCeilingMs: b.hardCeilingMs,
    };
  }
  if (rules.allowedHostingRegions !== undefined) {
    out.allowedHostingRegions = [...rules.allowedHostingRegions];
  }
  return out;
};

const cloneProfile = (
  profile: TestCasePolicyProfile,
): TestCasePolicyProfile => ({
  id: profile.id,
  version: profile.version,
  description: profile.description,
  rules: deepCloneRules(profile.rules),
});

/**
 * Merge a canonical bundle against a base policy profile. The base
 * profile is never mutated — the returned `mergedPolicyProfile` is a
 * deep clone with the bundle's additive overrides applied.
 *
 * Today's override surface is intentionally additive:
 *
 *   - `riskClassTaxonomy` entries with `mode === "review_only"` are
 *     appended to `rules.reviewOnlyRiskCategories` (deduped).
 *
 * The terminology glossary, naming convention, design-system tokens,
 * compliance house standards, and customer-eval rubric ref do NOT
 * touch the policy gate — they are surfaced on the resolved artifact
 * for the audit dossier and the prompt compiler reads the glossary
 * via {@link buildTenantBundleGlossaryEntries}.
 */
export const resolveTenantBundle = (
  input: ResolveTenantBundleInput,
): ResolvedTenantBundle => {
  assertTenantBundleScope(input.bundle, input.activeScope);

  if (input.bundle.inheritsFromPolicyProfile !== input.baseProfile.id) {
    throw new TenantBundleBaseProfileMismatchError({
      expected: input.bundle.inheritsFromPolicyProfile,
      actual: input.baseProfile.id,
    });
  }

  const merged = cloneProfile(input.baseProfile);
  const applied: string[] = [];

  if (input.bundle.riskClassTaxonomy.length > 0) {
    const reviewOnlyAdditions: TestCaseRiskCategory[] = [];
    for (const override of input.bundle.riskClassTaxonomy) {
      if (override.mode !== "review_only") continue;
      if (merged.rules.reviewOnlyRiskCategories.includes(override.riskCategory)) {
        continue;
      }
      reviewOnlyAdditions.push(override.riskCategory);
    }
    if (reviewOnlyAdditions.length > 0) {
      merged.rules.reviewOnlyRiskCategories = [
        ...merged.rules.reviewOnlyRiskCategories,
        ...reviewOnlyAdditions,
      ];
      applied.push("rules.reviewOnlyRiskCategories");
    }
  }

  // Safety-floor pre-check: today no field on the bundle directly sets a
  // numeric threshold on the policy, but the resolver evaluates each
  // floor against the (already merged) profile vs the base. This wires
  // the invariant before any future extension that lets the customer
  // tune thresholds can ship without re-routing through this guard.
  for (const floor of TENANT_BUNDLE_SAFETY_FLOORS) {
    const baseValue = readNumericPath(input.baseProfile, floor.field);
    const proposedValue = readNumericPath(merged, floor.field);
    if (baseValue === undefined || proposedValue === undefined) continue;
    if (floor.direction === "minimum" && proposedValue < baseValue) {
      throw new TenantBundleSafetyFloorViolationError({
        field: floor.field,
        direction: floor.direction,
        baseValue,
        proposedValue,
        rationale: floor.rationale,
      });
    }
    if (floor.direction === "maximum" && proposedValue > baseValue) {
      throw new TenantBundleSafetyFloorViolationError({
        field: floor.field,
        direction: floor.direction,
        baseValue,
        proposedValue,
        rationale: floor.rationale,
      });
    }
  }

  return {
    schemaVersion: TENANT_BUNDLE_RESOLVED_SCHEMA_VERSION,
    bundle: input.bundle,
    mergedPolicyProfile: merged,
    appliedOverrides: applied.sort((a, b) => a.localeCompare(b)),
    certification: TENANT_BUNDLE_RESOLVED_CERTIFICATION,
  };
};

const readNumericPath = (
  source: TestCasePolicyProfile,
  path: string,
): number | undefined => {
  const parts = path.split(".");
  let cursor: unknown = source;
  for (const part of parts) {
    if (!isRecord(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "number" && Number.isFinite(cursor)
    ? cursor
    : undefined;
};

/**
 * Build the byte-stable, deterministic on-disk form of a resolved
 * tenant bundle. The merged policy profile is intentionally omitted —
 * the resolver hands it to the gate directly; the audit replay
 * reconstructs the merge by re-running the resolver against the
 * recorded base profile.
 */
export const serializeResolvedTenantBundle = (
  resolved: ResolvedTenantBundle,
): string => {
  const payload = {
    schemaVersion: resolved.schemaVersion,
    bundle: resolved.bundle,
    appliedOverrides: resolved.appliedOverrides,
    certification: resolved.certification,
  };
  return `${canonicalJson(payload)}\n`;
};

// ---------------------------------------------------------------------------
// Prompt-compiler glue: terminology glossary → CustomerProfile glossary
// ---------------------------------------------------------------------------

export interface TenantBundleGlossaryEntry {
  readonly term: string;
  readonly definition: string;
}

/**
 * Flatten the bundle's `terminologyGlossary` into the term/definition
 * shape the prompt compiler already consumes via the customer-profile
 * glossary pipeline. Locale is folded into the definition so the
 * existing single-glossary contract round-trips intact.
 */
export const buildTenantBundleGlossaryEntries = (
  bundle: CanonicalTenantBundle,
): readonly TenantBundleGlossaryEntry[] => {
  const seen = new Map<string, TenantBundleGlossaryEntry>();
  for (const entry of bundle.terminologyGlossary) {
    const definition =
      entry.locale === undefined
        ? entry.definition
        : `[${entry.locale}] ${entry.definition}`;
    if (!seen.has(entry.term)) {
      seen.set(entry.term, { term: entry.term, definition });
    }
  }
  return [...seen.values()].sort((a, b) => a.term.localeCompare(b.term));
};
