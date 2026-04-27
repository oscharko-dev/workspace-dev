/**
 * Source-mix planner (Issue #1441, Wave 4.K).
 *
 * Accepts a validated {@link MultiSourceTestIntentEnvelope}, inspects the
 * source kinds present, and emits a deterministic {@link SourceMixPlan} that
 * downstream orchestrators (prompt compiler, validation pipeline, evidence
 * manifest, FinOps report) can rely on without re-inspecting the envelope.
 *
 * Design invariants enforced here:
 *
 *   1. At least one primary source is required (`primary_source_required`).
 *   2. Source IDs are unique within the plan (derived from envelope validation).
 *   3. Duplicate Jira issue keys across REST + paste sources surface as
 *      `duplicate_jira_issue_key` rather than silently merging.
 *   4. `custom_markdown` sources always carry `redactedMarkdownHash` +
 *      `plainTextDerivativeHash`; missing hashes surface as
 *      `custom_markdown_hash_required`.
 *   5. `custom_markdown` sources MUST NOT carry `inputFormat`; if present,
 *      the error `custom_markdown_input_format_invalid` is raised.
 *   6. `sourceMixPlanHash` is SHA-256 of the canonical plan payload and
 *      participates in the replay-cache key so any source-mix change forces
 *      a cache miss.
 *   7. The planner is pure and synchronous: identical envelopes always produce
 *      identical plans.
 *
 * The module is intentionally side-effect-free. {@link writeSourceMixPlan} is
 * the only function with IO.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS,
  SOURCE_MIX_PLAN_ARTIFACT_FILENAME,
  SOURCE_MIX_PLAN_SCHEMA_VERSION,
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
  SUPPORTING_TEST_INTENT_SOURCE_KINDS,
  type MultiSourceTestIntentEnvelope,
  type SourceMixPlan,
  type SourceMixPlannerIssue,
  type SourceMixPlannerRefusalCode,
  type SourceMixPlannerResult,
  type SourceMixPlanPromptSection,
  type SourceMixPlanSourceDigest,
  type TestIntentSourceKind,
  type TestIntentSourceMixKind,
  type TestIntentSourceRef,
} from "../contracts/index.js";

export type { SourceMixPlan } from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

export interface SourceMixPlannerOptions {
  /**
   * Permit duplicate Jira REST/paste issue keys only when the caller routes
   * the duplicate into the paste-collision conflict path.
   */
  allowDuplicateJiraIssueKeysForConflictEvidence?: boolean;
}

const HEX64 = /^[0-9a-f]{64}$/;

const PRIMARY_KINDS: ReadonlySet<TestIntentSourceKind> = new Set(
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
);
const SUPPORTING_KINDS: ReadonlySet<TestIntentSourceKind> = new Set(
  SUPPORTING_TEST_INTENT_SOURCE_KINDS,
);
const SUPPORTED_MIX_KINDS: ReadonlySet<TestIntentSourceMixKind> = new Set(
  ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS,
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Plan the source mix for a validated envelope. Returns a discriminated
 * result; never throws. Callers MUST pass a pre-validated envelope — the
 * planner trusts source IDs and content hashes are well-formed.
 */
export const planSourceMix = (
  envelope: MultiSourceTestIntentEnvelope,
  options: SourceMixPlannerOptions = {},
): SourceMixPlannerResult => {
  const issues = collectPlannerIssues(envelope, options);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const plan = buildPlan(envelope);
  return { ok: true, plan };
};

/** Write a `source-mix-plan.json` artifact atomically under `runDir`. */
export const writeSourceMixPlan = async (
  plan: SourceMixPlan,
  runDir: string,
): Promise<{ artifactPath: string }> => {
  if (typeof runDir !== "string" || runDir.length === 0) {
    throw new TypeError(
      "writeSourceMixPlan: runDir must be a non-empty string",
    );
  }
  await mkdir(runDir, { recursive: true });
  const artifactPath = join(runDir, SOURCE_MIX_PLAN_ARTIFACT_FILENAME);
  const tempPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, canonicalJson(plan), { encoding: "utf8" });
  await rename(tempPath, artifactPath);
  return { artifactPath };
};

/**
 * Compute a stable SHA-256 hash covering the plan identity fields.
 * The hash is invariant to field ordering; `sourceMixPlanHash` itself is
 * not included in the hash input to avoid circular dependency.
 */
export const computeSourceMixPlanHash = (input: {
  kind: TestIntentSourceMixKind;
  primarySourceIds: readonly string[];
  supportingSourceIds: readonly string[];
  visualSidecarRequirement: SourceMixPlan["visualSidecarRequirement"];
  promptSections: readonly SourceMixPlanPromptSection[];
  sourceDigests?: readonly SourceMixPlanSourceDigest[];
}): string =>
  sha256Hex({
    schema: SOURCE_MIX_PLAN_SCHEMA_VERSION,
    kind: input.kind,
    primarySourceIds: [...input.primarySourceIds].sort(),
    supportingSourceIds: [...input.supportingSourceIds].sort(),
    visualSidecarRequirement: input.visualSidecarRequirement,
    promptSections: [...input.promptSections],
    sourceDigests:
      input.sourceDigests === undefined
        ? []
        : normalizeSourceDigestsForHash(input.sourceDigests),
  });

/** Predicate: is this refusal code a known source-mix planner code? */
export const isSourceMixPlannerRefusalCode = (
  value: unknown,
): value is SourceMixPlannerRefusalCode =>
  typeof value === "string" &&
  ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES_SET.has(
    value as SourceMixPlannerRefusalCode,
  );

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES_SET: ReadonlySet<SourceMixPlannerRefusalCode> =
  new Set([
    "primary_source_required",
    "unsupported_source_mix",
    "duplicate_source_id",
    "duplicate_jira_issue_key",
    "custom_markdown_hash_required",
    "custom_markdown_input_format_invalid",
    "source_mix_plan_hash_mismatch",
    "mode_gate_not_satisfied",
  ] satisfies SourceMixPlannerRefusalCode[]);

const collectPlannerIssues = (
  envelope: MultiSourceTestIntentEnvelope,
  options: SourceMixPlannerOptions,
): SourceMixPlannerIssue[] => {
  const issues: SourceMixPlannerIssue[] = [];

  const hasPrimary = envelope.sources.some((s) => PRIMARY_KINDS.has(s.kind));
  if (!hasPrimary) {
    issues.push({ code: "primary_source_required" });
    return issues;
  }

  for (const [index, source] of envelope.sources.entries()) {
    if (source.kind === "custom_markdown") {
      if (source.inputFormat !== undefined) {
        issues.push({
          code: "custom_markdown_input_format_invalid",
          path: `sources[${index}].inputFormat`,
          detail: "custom_markdown_kind_does_not_use_inputFormat",
        });
      }
      if (
        typeof source.redactedMarkdownHash !== "string" ||
        !HEX64.test(source.redactedMarkdownHash)
      ) {
        issues.push({
          code: "custom_markdown_hash_required",
          path: `sources[${index}].redactedMarkdownHash`,
        });
      }
      if (
        typeof source.plainTextDerivativeHash !== "string" ||
        !HEX64.test(source.plainTextDerivativeHash)
      ) {
        issues.push({
          code: "custom_markdown_hash_required",
          path: `sources[${index}].plainTextDerivativeHash`,
        });
      }
    }
  }

  const jiraIssueKeys = collectJiraIssueKeys(envelope.sources);
  for (const [key, sourceIds] of jiraIssueKeys.entries()) {
    if (sourceIds.length > 1) {
      const restCount = envelope.sources.filter(
        (s) => s.kind === "jira_rest" && s.canonicalIssueKey === key,
      ).length;
      const pasteCount = envelope.sources.filter(
        (s) => s.kind === "jira_paste" && s.canonicalIssueKey === key,
      ).length;
      if (
        restCount > 0 &&
        pasteCount > 0 &&
        options.allowDuplicateJiraIssueKeysForConflictEvidence !== true
      ) {
        issues.push({
          code: "duplicate_jira_issue_key",
          path: "sources",
          detail: key,
        });
      }
    }
  }

  const mixKind = deriveMixKind(envelope.sources);
  if (!SUPPORTED_MIX_KINDS.has(mixKind)) {
    issues.push({
      code: "unsupported_source_mix",
      detail: mixKind,
    });
  }

  return issues;
};

const buildPlan = (envelope: MultiSourceTestIntentEnvelope): SourceMixPlan => {
  const primarySourceIds = envelope.sources
    .filter((s) => PRIMARY_KINDS.has(s.kind))
    .map((s) => s.sourceId);

  const supportingSourceIds = envelope.sources
    .filter((s) => SUPPORTING_KINDS.has(s.kind))
    .map((s) => s.sourceId);

  const mixKind = deriveMixKind(envelope.sources);
  const visualSidecarRequirement = deriveVisualSidecarRequirement(
    envelope.sources,
  );
  const promptSections = derivePromptSections(envelope.sources);
  const sourceDigests = deriveSourceDigests(envelope.sources);

  const sourceMixPlanHash = computeSourceMixPlanHash({
    kind: mixKind,
    primarySourceIds,
    supportingSourceIds,
    visualSidecarRequirement,
    promptSections,
    sourceDigests,
  });

  return {
    version: SOURCE_MIX_PLAN_SCHEMA_VERSION,
    kind: mixKind,
    primarySourceIds,
    supportingSourceIds,
    visualSidecarRequirement,
    promptSections,
    sourceDigests,
    sourceMixPlanHash,
    rawJiraResponsePersisted: false,
    rawPasteBytesPersisted: false,
  };
};

/** Derive the canonical mix kind from the source list. */
const deriveMixKind = (
  sources: readonly TestIntentSourceRef[],
): TestIntentSourceMixKind => {
  const hasFigma = sources.some(isFigmaKind);
  const hasJiraRest = sources.some((s) => s.kind === "jira_rest");
  const hasJiraPaste = sources.some((s) => s.kind === "jira_paste");

  if (hasFigma && !hasJiraRest && !hasJiraPaste) {
    return "figma_only";
  }
  if (!hasFigma && hasJiraRest && !hasJiraPaste) {
    return "jira_rest_only";
  }
  if (!hasFigma && !hasJiraRest && hasJiraPaste) {
    return "jira_paste_only";
  }
  if (hasFigma && hasJiraRest && !hasJiraPaste) {
    return "figma_jira_rest";
  }
  if (hasFigma && !hasJiraRest && hasJiraPaste) {
    return "figma_jira_paste";
  }
  if (hasFigma && hasJiraRest && hasJiraPaste) {
    return "figma_jira_mixed";
  }
  if (!hasFigma && hasJiraRest && hasJiraPaste) {
    return "jira_mixed";
  }
  return "figma_only";
};

/** Determine the visual sidecar requirement for the plan. */
const deriveVisualSidecarRequirement = (
  sources: readonly TestIntentSourceRef[],
): SourceMixPlan["visualSidecarRequirement"] => {
  const hasFigma = sources.some(isFigmaKind);
  return hasFigma ? "optional" : "not_applicable";
};

/**
 * Build the ordered prompt sections list. The order here is the canonical
 * order the prompt compiler must emit them; never vary the order so
 * `sourceMixPlanHash` stays byte-stable across equivalent plans.
 */
const derivePromptSections = (
  sources: readonly TestIntentSourceRef[],
): SourceMixPlanPromptSection[] => {
  const sections: SourceMixPlanPromptSection[] = [];

  const hasFigma = sources.some(isFigmaKind);
  const hasJira = sources.some(isJiraKind);
  const hasCustom = sources.some(isLegacyCustomKind);
  const hasMarkdown = sources.some((s) => s.kind === "custom_markdown");
  const hasMultiPrimary = hasFigma && hasJira;

  if (hasFigma) {
    sections.push("figma_intent");
  }
  if (hasJira) {
    sections.push("jira_requirements");
  }
  if (hasCustom) {
    sections.push("custom_context");
  }
  if (hasMarkdown) {
    sections.push("custom_context_markdown");
  }
  if (hasMultiPrimary) {
    sections.push("reconciliation_report");
  }

  return sections;
};

const isFigmaKind = (s: TestIntentSourceRef): boolean =>
  s.kind === "figma_local_json" ||
  s.kind === "figma_plugin" ||
  s.kind === "figma_rest";

const isJiraKind = (s: TestIntentSourceRef): boolean =>
  s.kind === "jira_rest" || s.kind === "jira_paste";

const isLegacyCustomKind = (s: TestIntentSourceRef): boolean =>
  s.kind === "custom_text" || s.kind === "custom_structured";

/** Build hash-only source fingerprints for the source-mix plan. */
const deriveSourceDigests = (
  sources: readonly TestIntentSourceRef[],
): SourceMixPlanSourceDigest[] =>
  sources
    .map((source) => {
      const digest: SourceMixPlanSourceDigest = {
        sourceId: source.sourceId,
        kind: source.kind,
        contentHash: source.contentHash,
      };
      if (source.canonicalIssueKey !== undefined) {
        digest.canonicalIssueKey = source.canonicalIssueKey;
      }
      if (source.redactedMarkdownHash !== undefined) {
        digest.redactedMarkdownHash = source.redactedMarkdownHash;
      }
      if (source.plainTextDerivativeHash !== undefined) {
        digest.plainTextDerivativeHash = source.plainTextDerivativeHash;
      }
      return digest;
    })
    .sort(compareSourceDigests);

const normalizeSourceDigestsForHash = (
  digests: readonly SourceMixPlanSourceDigest[],
): SourceMixPlanSourceDigest[] =>
  digests
    .map((digest) => {
      const normalized: SourceMixPlanSourceDigest = {
        sourceId: digest.sourceId,
        kind: digest.kind,
        contentHash: digest.contentHash,
      };
      if (digest.canonicalIssueKey !== undefined) {
        normalized.canonicalIssueKey = digest.canonicalIssueKey;
      }
      if (digest.redactedMarkdownHash !== undefined) {
        normalized.redactedMarkdownHash = digest.redactedMarkdownHash;
      }
      if (digest.plainTextDerivativeHash !== undefined) {
        normalized.plainTextDerivativeHash = digest.plainTextDerivativeHash;
      }
      return normalized;
    })
    .sort(compareSourceDigests);

const compareSourceDigests = (
  a: SourceMixPlanSourceDigest,
  b: SourceMixPlanSourceDigest,
): number => {
  if (a.sourceId !== b.sourceId) {
    return a.sourceId < b.sourceId ? -1 : 1;
  }
  return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
};

/** Collect Jira issue keys grouped by canonical key value. */
const collectJiraIssueKeys = (
  sources: readonly TestIntentSourceRef[],
): Map<string, string[]> => {
  const keys = new Map<string, string[]>();
  for (const source of sources) {
    if (!isJiraKind(source)) continue;
    const key = source.canonicalIssueKey;
    if (typeof key !== "string" || key.length === 0) continue;
    const list = keys.get(key);
    if (list !== undefined) {
      list.push(source.sourceId);
    } else {
      keys.set(key, [source.sourceId]);
    }
  }
  return keys;
};
