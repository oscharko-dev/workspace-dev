/**
 * Compliance-as-code rule packs (Issue #2042).
 *
 * Encodes EU banking and insurance regulatory obligations as
 * machine-readable rules. Each rule pinpoints one regulation article and
 * declares the test classes that must be present for a generated test
 * suite to be considered "covered" against that article.
 *
 * The schema is Zod-validated at module load so adding a new pack cannot
 * break the harness — any malformed file raises before downstream
 * consumers see it. Rules are deep-frozen so accidental mutation is
 * caught synchronously.
 *
 * The rule packs themselves live under `compliance-rules/<framework>.ts`
 * and are loaded by the static registry below; both the registry and
 * the loader are pure and produce identical artifacts on identical
 * inputs.
 */

import * as z from "zod";

import { PSD2_RULE_PACK } from "../compliance-rules/psd2.js";
import { MIFID_II_RULE_PACK } from "../compliance-rules/mifid-ii.js";
import { IDD_RULE_PACK } from "../compliance-rules/idd.js";
import { SOLVENCY_II_RULE_PACK } from "../compliance-rules/solvency-ii.js";
import { DORA_RULE_PACK } from "../compliance-rules/dora.js";
import { EU_AI_ACT_RULE_PACK } from "../compliance-rules/eu-ai-act.js";
import { GDPR_RULE_PACK } from "../compliance-rules/gdpr.js";

/** Schema version for serialised rule packs. Bump on breaking schema changes. */
export const COMPLIANCE_RULE_PACK_SCHEMA_VERSION = "1.0.0" as const;

/** Stable identifier of a supported compliance framework. */
export const COMPLIANCE_FRAMEWORK_IDS = [
  "PSD2",
  "MIFID_II",
  "IDD",
  "SOLVENCY_II",
  "DORA",
  "EU_AI_ACT",
  "GDPR",
] as const;
export type ComplianceFrameworkId = (typeof COMPLIANCE_FRAMEWORK_IDS)[number];

/** Applicable industry domain for a compliance rule. */
export const COMPLIANCE_RULE_DOMAINS = [
  "banking",
  "insurance",
  "both",
] as const;
export type ComplianceRuleDomain = (typeof COMPLIANCE_RULE_DOMAINS)[number];

/**
 * Severity bands surfaced when a generated test suite fails to cover a
 * given rule. `error` blocks audit-grade exports; `warning` is recorded
 * in the coverage report but does not block.
 */
export const COMPLIANCE_RULE_SEVERITIES = ["error", "warning"] as const;
export type ComplianceRuleSeverity = (typeof COMPLIANCE_RULE_SEVERITIES)[number];

/**
 * Mandatory test classes a covering test case must declare on its
 * `type` field. Subset of {@link TestCaseType} taxonomy from the
 * contracts module — copied here as a free-standing list so the rule
 * packs do not introduce a contract-version coupling.
 */
export const COMPLIANCE_MANDATORY_TEST_CLASSES = [
  "functional",
  "negative",
  "boundary",
  "validation",
  "navigation",
  "regression",
  "exploratory",
  "accessibility",
] as const;
export type ComplianceMandatoryTestClass =
  (typeof COMPLIANCE_MANDATORY_TEST_CLASSES)[number];

/** Single rule belonging to a {@link ComplianceRulePack}. */
export interface ComplianceRule {
  readonly id: string;
  readonly citation: string;
  readonly description: string;
  readonly domain: ComplianceRuleDomain;
  readonly mandatoryTestClasses: readonly ComplianceMandatoryTestClass[];
  readonly severity: ComplianceRuleSeverity;
  readonly keywords: readonly string[];
}

/** Schema-validated compliance rule pack for one regulatory framework. */
export interface ComplianceRulePack {
  readonly schemaVersion: typeof COMPLIANCE_RULE_PACK_SCHEMA_VERSION;
  readonly framework: ComplianceFrameworkId;
  readonly title: string;
  readonly citationRoot: string;
  readonly description: string;
  readonly rules: readonly ComplianceRule[];
}

const ComplianceRuleSchema: z.ZodType<ComplianceRule> = z
  .object({
    id: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[A-Z][A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+$/u, {
        message:
          'compliance rule id must look like "FRAMEWORK-Subject-...", e.g. "PSD2-SCA-Art-97"',
      }),
    citation: z.string().min(3).max(240),
    description: z.string().min(8).max(480),
    domain: z.enum(COMPLIANCE_RULE_DOMAINS),
    mandatoryTestClasses: z
      .array(z.enum(COMPLIANCE_MANDATORY_TEST_CLASSES))
      .min(1)
      .max(COMPLIANCE_MANDATORY_TEST_CLASSES.length),
    severity: z.enum(COMPLIANCE_RULE_SEVERITIES),
    keywords: z.array(z.string().min(2).max(64)).min(1).max(32),
  })
  .strict();

const ComplianceRulePackSchema: z.ZodType<ComplianceRulePack> = z
  .object({
    schemaVersion: z.literal(COMPLIANCE_RULE_PACK_SCHEMA_VERSION),
    framework: z.enum(COMPLIANCE_FRAMEWORK_IDS),
    title: z.string().min(3).max(120),
    citationRoot: z.string().min(3).max(240),
    description: z.string().min(8).max(480),
    rules: z.array(ComplianceRuleSchema).min(1).max(64),
  })
  .strict()
  .superRefine((pack, ctx) => {
    const ids = new Set<string>();
    for (const rule of pack.rules) {
      if (ids.has(rule.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate rule id "${rule.id}" in framework ${pack.framework}`,
        });
      }
      ids.add(rule.id);
      if (!rule.id.startsWith(`${pack.framework}-`)) {
        ctx.addIssue({
          code: "custom",
          message: `rule id "${rule.id}" must start with framework prefix "${pack.framework}-"`,
        });
      }
    }
  });

const deepFreezeRulePack = (pack: ComplianceRulePack): ComplianceRulePack =>
  Object.freeze({
    schemaVersion: pack.schemaVersion,
    framework: pack.framework,
    title: pack.title,
    citationRoot: pack.citationRoot,
    description: pack.description,
    rules: Object.freeze(
      pack.rules.map((rule) =>
        Object.freeze({
          id: rule.id,
          citation: rule.citation,
          description: rule.description,
          domain: rule.domain,
          mandatoryTestClasses: Object.freeze([...rule.mandatoryTestClasses]),
          severity: rule.severity,
          keywords: Object.freeze([...rule.keywords]),
        }),
      ),
    ),
  });

/**
 * Validate a candidate rule pack against the schema and contract
 * invariants. Throws a `TypeError` on failure; returns a deep-frozen
 * `ComplianceRulePack` on success.
 */
export const validateComplianceRulePack = (
  candidate: unknown,
): ComplianceRulePack => {
  const parsed = ComplianceRulePackSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new TypeError(`invalid compliance rule pack: ${detail}`);
  }
  return deepFreezeRulePack(parsed.data);
};

const RULE_PACK_REGISTRY_OBJECT: Record<
  ComplianceFrameworkId,
  ComplianceRulePack
> = {
  PSD2: validateComplianceRulePack(PSD2_RULE_PACK),
  MIFID_II: validateComplianceRulePack(MIFID_II_RULE_PACK),
  IDD: validateComplianceRulePack(IDD_RULE_PACK),
  SOLVENCY_II: validateComplianceRulePack(SOLVENCY_II_RULE_PACK),
  DORA: validateComplianceRulePack(DORA_RULE_PACK),
  EU_AI_ACT: validateComplianceRulePack(EU_AI_ACT_RULE_PACK),
  GDPR: validateComplianceRulePack(GDPR_RULE_PACK),
};

/**
 * Frozen registry of every shipped compliance rule pack. Keys cover
 * {@link COMPLIANCE_FRAMEWORK_IDS} exhaustively.
 */
export const COMPLIANCE_RULE_PACK_REGISTRY: Readonly<
  Record<ComplianceFrameworkId, ComplianceRulePack>
> = Object.freeze(RULE_PACK_REGISTRY_OBJECT);

/**
 * Default frameworks active for a given policy profile. The
 * `eu-banking-default` profile activates the full pack so banking +
 * insurance + cross-cutting (DORA, EU AI Act, GDPR) regulations are
 * all evaluated. Operators override the default with the
 * `--compliance-frameworks` CLI flag.
 */
export const DEFAULT_FRAMEWORKS_FOR_POLICY_PROFILE: Readonly<
  Record<string, readonly ComplianceFrameworkId[]>
> = Object.freeze({
  "eu-banking-default": Object.freeze<ComplianceFrameworkId[]>([
    "PSD2",
    "MIFID_II",
    "IDD",
    "SOLVENCY_II",
    "DORA",
    "EU_AI_ACT",
    "GDPR",
  ]),
});

/** Return every registered rule pack sorted by framework id (stable). */
export const listComplianceRulePacks = (): readonly ComplianceRulePack[] =>
  COMPLIANCE_FRAMEWORK_IDS.map((id) => COMPLIANCE_RULE_PACK_REGISTRY[id]);

/** Return the rule pack for `framework`. */
export const getComplianceRulePack = (
  framework: ComplianceFrameworkId,
): ComplianceRulePack => COMPLIANCE_RULE_PACK_REGISTRY[framework];

/** Type guard for {@link ComplianceFrameworkId}. */
export const isComplianceFrameworkId = (
  value: unknown,
): value is ComplianceFrameworkId =>
  typeof value === "string" &&
  (COMPLIANCE_FRAMEWORK_IDS as readonly string[]).includes(value);

/**
 * Resolve the active framework set for a run. When `selected` is
 * `undefined`, the active set is derived from the policy-profile
 * default. Unknown profiles fall back to the full registry so callers
 * never silently lose coverage.
 */
export const resolveActiveFrameworks = (
  selected: readonly ComplianceFrameworkId[] | undefined,
  policyProfileId: string,
): readonly ComplianceFrameworkId[] => {
  if (selected !== undefined) {
    if (selected.length === 0) {
      throw new RangeError(
        "resolveActiveFrameworks: explicit selection must include at least one framework",
      );
    }
    const seen = new Set<ComplianceFrameworkId>();
    for (const framework of selected) {
      if (!isComplianceFrameworkId(framework)) {
        throw new RangeError(
          `resolveActiveFrameworks: unknown framework "${String(framework)}"`,
        );
      }
      seen.add(framework);
    }
    return Object.freeze(
      COMPLIANCE_FRAMEWORK_IDS.filter((id) => seen.has(id)),
    );
  }
  const fromProfile = DEFAULT_FRAMEWORKS_FOR_POLICY_PROFILE[policyProfileId];
  if (fromProfile !== undefined) {
    return fromProfile;
  }
  return Object.freeze([...COMPLIANCE_FRAMEWORK_IDS]);
};

/**
 * Parse a comma-separated CLI value into a deduplicated, validated
 * framework list. Used by the CLI parser to convert the raw
 * `--compliance-frameworks` argument before forwarding it to
 * {@link resolveActiveFrameworks}. Throws a `RangeError` on unknown
 * tokens or empty input so the operator gets a clean error before any
 * LLM call.
 */
export const parseComplianceFrameworksFlag = (
  raw: string,
): readonly ComplianceFrameworkId[] => {
  const tokens = raw
    .split(",")
    .map((token) => token.trim().toUpperCase().replaceAll("-", "_"))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    throw new RangeError(
      "--compliance-frameworks requires a non-empty comma-separated list",
    );
  }
  const ids: ComplianceFrameworkId[] = [];
  for (const token of tokens) {
    if (!isComplianceFrameworkId(token)) {
      throw new RangeError(
        `--compliance-frameworks: unknown framework "${token}"; ` +
          `known: ${COMPLIANCE_FRAMEWORK_IDS.join(",")}`,
      );
    }
    if (!ids.includes(token)) ids.push(token);
  }
  return Object.freeze(ids);
};
