/**
 * Customer-profile input module (Issue #1946).
 *
 * Provides the `CustomerProfileInput` type, its canonical form, a
 * structured parse+canonicalize function with operator-friendly error
 * reporting, and a 256 KiB hard cap on raw file bytes.
 *
 * DO NOT confuse with `src/customer-profile.ts` — that module handles
 * design-system bindings. This module is specific to the test-intelligence
 * pipeline's DORA Art. 9 / ICT-Register-Ref + customer domain context
 * feature.
 */

import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";
import { sha256Hex } from "./content-hash.js";

export const MAX_CUSTOMER_PROFILE_BYTES: number = 256 * 1024;

// ---------------------------------------------------------------------------
// Input type (matches the required schema verbatim)
// ---------------------------------------------------------------------------

export interface CustomerProfileGlossaryEntry {
  term: string;
  definition: string;
}

export interface CustomerProfileRiskTaxonomyOverride {
  class: string;
  weight: number;
}

export interface CustomerProfilePolicyOverride {
  ruleId: string;
  severity: "error" | "warning" | "info";
  threshold?: number;
}

export interface CustomerProfileFewShotExample {
  caseTitle: string;
  description: string;
  technique: string;
}

export interface CustomerProfileInput {
  ictRegisterRef?: string;
  glossary?: CustomerProfileGlossaryEntry[];
  riskTaxonomyOverrides?: CustomerProfileRiskTaxonomyOverride[];
  policyOverrides?: CustomerProfilePolicyOverride[];
  fewShotExamples?: CustomerProfileFewShotExample[];
}

// ---------------------------------------------------------------------------
// Canonical form (sanitised, sorted, hashed)
// ---------------------------------------------------------------------------

export interface CanonicalCustomerProfileGlossaryEntry {
  term: string;
  definition: string;
}

export interface CanonicalCustomerProfileFewShotExample {
  caseTitle: string;
  description: string;
  technique: string;
}

export interface CanonicalCustomerProfile {
  ictRegisterRef?: string;
  glossary: CanonicalCustomerProfileGlossaryEntry[];
  riskTaxonomyOverrides: CustomerProfileRiskTaxonomyOverride[];
  policyOverrides: CustomerProfilePolicyOverride[];
  fewShotExamples: CanonicalCustomerProfileFewShotExample[];
  /** SHA-256 hex digest of the canonical profile for content-addressing. */
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export interface CustomerProfileIssue {
  /** JSON path of the offending field, e.g. `glossary[0].definition`. */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ParseAndCanonicalizeCustomerProfileResult =
  | { ok: true; profile: CanonicalCustomerProfile }
  | { ok: false; issues: CustomerProfileIssue[] };

// ---------------------------------------------------------------------------
// Parse + canonicalize
// ---------------------------------------------------------------------------

const SEVERITY_VALUES: ReadonlySet<string> = new Set([
  "error",
  "warning",
  "info",
]);

/**
 * Parse a raw JSON string that should conform to {@link CustomerProfileInput}
 * and return a fully canonicalized profile or a structured list of
 * operator-friendly validation errors.
 *
 * Free-text fields (`glossary.definition`, `fewShotExamples.caseTitle`,
 * `fewShotExamples.description`) are run through the same PII-redaction +
 * prompt-injection-scrub pipeline as `customContextMarkdown` via
 * {@link canonicalizeCustomContextMarkdown}. The resulting text is the
 * _canonicalized_ value stored in the profile — raw values are never retained.
 *
 * Arrays are sorted for determinism:
 *  - glossary: alphabetically by `term`
 *  - fewShotExamples: alphabetically by `caseTitle`
 *  - riskTaxonomyOverrides: alphabetically by `class`
 *  - policyOverrides: alphabetically by `ruleId`
 */
export const parseAndCanonicalizeCustomerProfile = (
  rawJson: string,
): ParseAndCanonicalizeCustomerProfileResult => {
  // --- JSON parse ---
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return {
      ok: false,
      issues: [{ path: "$", message: "Customer profile is not valid JSON" }],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [
        { path: "$", message: "Customer profile must be a JSON object" },
      ],
    };
  }

  const raw = parsed as Record<string, unknown>;
  const issues: CustomerProfileIssue[] = [];

  // --- ictRegisterRef ---
  let ictRegisterRef: string | undefined;
  if (raw.ictRegisterRef !== undefined) {
    if (typeof raw.ictRegisterRef !== "string") {
      issues.push({
        path: "ictRegisterRef",
        message: "ictRegisterRef must be a string",
      });
    } else if (raw.ictRegisterRef.trim().length === 0) {
      issues.push({
        path: "ictRegisterRef",
        message: "ictRegisterRef must not be empty when supplied",
      });
    } else {
      ictRegisterRef = raw.ictRegisterRef.trim();
    }
  }

  // --- glossary ---
  const glossary: CanonicalCustomerProfileGlossaryEntry[] = [];
  if (raw.glossary !== undefined) {
    if (!Array.isArray(raw.glossary)) {
      issues.push({ path: "glossary", message: "glossary must be an array" });
    } else {
      for (let i = 0; i < raw.glossary.length; i += 1) {
        const entry = raw.glossary[i] as unknown;
        const path = `glossary[${i}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push({ path, message: "glossary entry must be an object" });
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e.term !== "string" || e.term.trim().length === 0) {
          issues.push({ path: `${path}.term`, message: "term must be a non-empty string" });
          continue;
        }
        if (typeof e.definition !== "string") {
          issues.push({ path: `${path}.definition`, message: "definition must be a string" });
          continue;
        }
        const term = e.term.trim();
        const canonDef = canonicalizeFreeText(e.definition, `${path}.definition`, issues);
        if (canonDef !== undefined) {
          glossary.push({ term, definition: canonDef });
        }
      }
    }
  }

  // --- riskTaxonomyOverrides ---
  const riskTaxonomyOverrides: CustomerProfileRiskTaxonomyOverride[] = [];
  if (raw.riskTaxonomyOverrides !== undefined) {
    if (!Array.isArray(raw.riskTaxonomyOverrides)) {
      issues.push({
        path: "riskTaxonomyOverrides",
        message: "riskTaxonomyOverrides must be an array",
      });
    } else {
      for (let i = 0; i < raw.riskTaxonomyOverrides.length; i += 1) {
        const entry = raw.riskTaxonomyOverrides[i] as unknown;
        const path = `riskTaxonomyOverrides[${i}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push({ path, message: "riskTaxonomyOverrides entry must be an object" });
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e.class !== "string" || e.class.trim().length === 0) {
          issues.push({ path: `${path}.class`, message: "class must be a non-empty string" });
          continue;
        }
        if (typeof e.weight !== "number" || !Number.isFinite(e.weight)) {
          issues.push({ path: `${path}.weight`, message: "weight must be a finite number" });
          continue;
        }
        riskTaxonomyOverrides.push({ class: e.class.trim(), weight: e.weight });
      }
    }
  }

  // --- policyOverrides ---
  const policyOverrides: CustomerProfilePolicyOverride[] = [];
  if (raw.policyOverrides !== undefined) {
    if (!Array.isArray(raw.policyOverrides)) {
      issues.push({
        path: "policyOverrides",
        message: "policyOverrides must be an array",
      });
    } else {
      for (let i = 0; i < raw.policyOverrides.length; i += 1) {
        const entry = raw.policyOverrides[i] as unknown;
        const path = `policyOverrides[${i}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push({ path, message: "policyOverrides entry must be an object" });
          continue;
        }
        const e = entry as Record<string, unknown>;
        if (typeof e.ruleId !== "string" || e.ruleId.trim().length === 0) {
          issues.push({ path: `${path}.ruleId`, message: "ruleId must be a non-empty string" });
          continue;
        }
        if (typeof e.severity !== "string" || !SEVERITY_VALUES.has(e.severity)) {
          issues.push({
            path: `${path}.severity`,
            message: `severity must be one of "error", "warning", "info"`,
          });
          continue;
        }
        let threshold: number | undefined;
        if (e.threshold !== undefined) {
          if (
            typeof e.threshold !== "number" ||
            !Number.isFinite(e.threshold) ||
            e.threshold < 0 ||
            e.threshold > 1
          ) {
            issues.push({
              path: `${path}.threshold`,
              message: "threshold must be a finite number in [0, 1]",
            });
            continue;
          }
          threshold = e.threshold;
        }
        policyOverrides.push({
          ruleId: e.ruleId.trim(),
          severity: e.severity as "error" | "warning" | "info",
          ...(threshold !== undefined ? { threshold } : {}),
        });
      }
    }
  }

  // --- fewShotExamples ---
  const fewShotExamples: CanonicalCustomerProfileFewShotExample[] = [];
  if (raw.fewShotExamples !== undefined) {
    if (!Array.isArray(raw.fewShotExamples)) {
      issues.push({
        path: "fewShotExamples",
        message: "fewShotExamples must be an array",
      });
    } else {
      for (let i = 0; i < raw.fewShotExamples.length; i += 1) {
        const entry = raw.fewShotExamples[i] as unknown;
        const path = `fewShotExamples[${i}]`;
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          issues.push({ path, message: "fewShotExamples entry must be an object" });
          continue;
        }
        const e = entry as Record<string, unknown>;
        const hasErrors = issues.length;

        const canonTitle =
          typeof e.caseTitle === "string"
            ? canonicalizeFreeText(e.caseTitle, `${path}.caseTitle`, issues)
            : undefined;
        if (typeof e.caseTitle !== "string") {
          issues.push({ path: `${path}.caseTitle`, message: "caseTitle must be a string" });
        }

        const canonDesc =
          typeof e.description === "string"
            ? canonicalizeFreeText(e.description, `${path}.description`, issues)
            : undefined;
        if (typeof e.description !== "string") {
          issues.push({ path: `${path}.description`, message: "description must be a string" });
        }

        if (typeof e.technique !== "string" || e.technique.trim().length === 0) {
          issues.push({ path: `${path}.technique`, message: "technique must be a non-empty string" });
        }

        if (
          issues.length === hasErrors &&
          canonTitle !== undefined &&
          canonDesc !== undefined &&
          typeof e.technique === "string"
        ) {
          fewShotExamples.push({
            caseTitle: canonTitle,
            description: canonDesc,
            technique: e.technique.trim(),
          });
        }
      }
    }
  }

  // --- unknown top-level keys are allowed (forward-compat) ---

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // --- sort for determinism ---
  const sortedGlossary = [...glossary].sort((a, b) =>
    a.term.localeCompare(b.term),
  );
  const sortedRiskOverrides = [...riskTaxonomyOverrides].sort((a, b) =>
    a.class.localeCompare(b.class),
  );
  const sortedPolicyOverrides = [...policyOverrides].sort((a, b) =>
    a.ruleId.localeCompare(b.ruleId),
  );
  const sortedFewShot = [...fewShotExamples].sort((a, b) =>
    a.caseTitle.localeCompare(b.caseTitle),
  );

  const profile: Omit<CanonicalCustomerProfile, "contentHash"> = {
    ...(ictRegisterRef !== undefined ? { ictRegisterRef } : {}),
    glossary: sortedGlossary,
    riskTaxonomyOverrides: sortedRiskOverrides,
    policyOverrides: sortedPolicyOverrides,
    fewShotExamples: sortedFewShot,
  };

  const contentHash = sha256Hex({
    kind: "customer_profile",
    ...profile,
  });

  return {
    ok: true,
    profile: { ...profile, contentHash },
  };
};

/**
 * Canonicalize a single free-text field by running it through
 * {@link canonicalizeCustomContextMarkdown} and extracting the plain-text
 * derivative. If the markdown canonicalizer rejects the text (e.g. HTML
 * injection, unsafe URLs) the issues list is populated and `undefined` is
 * returned so the caller can skip the entry.
 *
 * We treat each free-text value as a single-line markdown body so the same
 * PII-redaction + prompt-injection defenses apply uniformly.
 */
const canonicalizeFreeText = (
  text: string,
  path: string,
  issues: CustomerProfileIssue[],
): string | undefined => {
  const result = canonicalizeCustomContextMarkdown(text);
  if (!result.ok) {
    for (const issue of result.issues) {
      issues.push({
        path,
        message: issue.detail !== undefined
          ? `${issue.code}: ${issue.detail}`
          : issue.code,
      });
    }
    return undefined;
  }
  // Return bodyPlain so we get the PII-redacted, link-stripped plain form.
  return result.value.bodyPlain.trim();
};
