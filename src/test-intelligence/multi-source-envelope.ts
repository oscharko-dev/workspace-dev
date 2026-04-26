/**
 * Multi-source test-intent envelope (Issue #1431, Wave 4.A).
 *
 * Hand-rolled validators and pure builders for the multi-source aggregate
 * envelope. The module is intentionally side-effect-free: no IO, no
 * logging, no telemetry, no fetch. Downstream Wave 4 issues compose these
 * helpers into the real ingestion / reconciliation / orchestration paths.
 *
 * Design invariants enforced here:
 *
 *   1. At least one source.
 *   2. At least one primary source — a custom-only envelope is rejected
 *      before any source artifact is persisted.
 *   3. Source IDs are unique within an envelope and shaped as
 *      `^[A-Za-z0-9._-]{1,64}$`.
 *   4. Content hashes are lowercase 64-hex SHA-256 strings.
 *   5. `capturedAt` is a strict, real ISO-8601 UTC timestamp ending in `Z`.
 *   6. `inputFormat` is required for `custom_text` / `custom_structured`
 *      and forbidden for primary kinds.
 *   7. Markdown-section metadata (`markdownSectionPath`, `noteEntryId`)
 *      may only appear on `custom_text` / `custom_structured` sources
 *      with `inputFormat = "markdown"`.
 *   8. Markdown sources carry redacted Markdown and plain-text derivative
 *      hashes; raw Markdown never enters the envelope.
 *   9. When two `jira_*` sources share a duplicate canonical issue key,
 *      route them to the paste-collision path instead of silently
 *      deduplicating.
 *  10. `priority` policy requires a `priorityOrder` covering exactly the
 *      kinds present in the envelope, no extras and no duplicates.
 *  11. `aggregateContentHash` is reproducible from the inputs and is
 *      invariant under source reordering when the policy is not
 *      `priority`. When the policy IS `priority`, the priority list is
 *      mixed in so swapping it forces a cache miss.
 *
 * The validator returns a discriminated union (`{ ok: true, envelope } |
 * { ok: false, issues }`) — never throws.
 */

import {
  ALLOWED_CONFLICT_RESOLUTION_POLICIES,
  ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES,
  ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES,
  ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS,
  ALLOWED_TEST_INTENT_SOURCE_KINDS,
  MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
  SUPPORTING_TEST_INTENT_SOURCE_KINDS,
  TEST_INTELLIGENCE_MULTISOURCE_ENV,
  type BusinessTestIntentIrSource,
  type ConflictResolutionPolicy,
  type MultiSourceEnvelopeIssue,
  type MultiSourceEnvelopeRefusalCode,
  type MultiSourceEnvelopeValidationResult,
  type MultiSourceModeGateDecision,
  type MultiSourceModeGateInput,
  type MultiSourceModeGateRefusal,
  type MultiSourceModeGateRefusalCode,
  type MultiSourceTestIntentEnvelope,
  type PrimaryTestIntentSourceKind,
  type SupportingTestIntentSourceKind,
  type TestIntentCustomInputFormat,
  type TestIntentSourceKind,
  type TestIntentSourceRef,
} from "../contracts/index.js";
import { canonicalJson, sha256Hex } from "./content-hash.js";

const HEX64 = /^[0-9a-f]{64}$/;
const SOURCE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9]+-[1-9][0-9]*$/;
const ISO_UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/;
const AUTHOR_HANDLE = /^[A-Za-z0-9._-]{1,64}$/;

const PRIMARY_KINDS: ReadonlySet<TestIntentSourceKind> = new Set(
  PRIMARY_TEST_INTENT_SOURCE_KINDS,
);
const SUPPORTING_KINDS: ReadonlySet<TestIntentSourceKind> = new Set(
  SUPPORTING_TEST_INTENT_SOURCE_KINDS,
);
const ALL_KINDS: ReadonlySet<TestIntentSourceKind> = new Set(
  ALLOWED_TEST_INTENT_SOURCE_KINDS,
);
const ALL_POLICIES: ReadonlySet<ConflictResolutionPolicy> = new Set(
  ALLOWED_CONFLICT_RESOLUTION_POLICIES,
);
const ALL_FORMATS: ReadonlySet<TestIntentCustomInputFormat> = new Set(
  ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS,
);

/** Predicate identifying primary source kinds. */
export const isPrimaryTestIntentSourceKind = (
  kind: TestIntentSourceKind,
): kind is PrimaryTestIntentSourceKind => PRIMARY_KINDS.has(kind);

/** Predicate identifying supporting (non-primary) source kinds. */
export const isSupportingTestIntentSourceKind = (
  kind: TestIntentSourceKind,
): kind is SupportingTestIntentSourceKind => SUPPORTING_KINDS.has(kind);

/**
 * Compute the deterministic aggregate content hash for an envelope.
 *
 * The hash MUST be invariant under source reordering when the policy is
 * not `priority`, and MUST encode the priority list when it is.
 */
export const computeAggregateContentHash = (input: {
  sources: readonly TestIntentSourceRef[];
  conflictResolutionPolicy: ConflictResolutionPolicy;
  priorityOrder?: readonly TestIntentSourceKind[];
}): string => {
  const sortedSources = input.sources
    .map((ref) => ({
      kind: ref.kind,
      contentHash: ref.contentHash,
    }))
    .sort((a, b) => {
      if (a.contentHash !== b.contentHash) {
        return a.contentHash < b.contentHash ? -1 : 1;
      }
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    });
  const priorityComponent =
    input.conflictResolutionPolicy === "priority" && input.priorityOrder
      ? [...input.priorityOrder]
      : [];
  return sha256Hex({
    schema: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: sortedSources,
    conflictResolutionPolicy: input.conflictResolutionPolicy,
    priorityOrder: priorityComponent,
  });
};

/**
 * Build a multi-source envelope. The function trusts its inputs
 * structurally (use {@link validateMultiSourceTestIntentEnvelope} for
 * untrusted input) but always recomputes the aggregate hash.
 */
export const buildMultiSourceTestIntentEnvelope = (input: {
  sources: readonly TestIntentSourceRef[];
  conflictResolutionPolicy: ConflictResolutionPolicy;
  priorityOrder?: readonly TestIntentSourceKind[];
  sourceMixPlan?: MultiSourceTestIntentEnvelope["sourceMixPlan"];
}): MultiSourceTestIntentEnvelope => {
  const sources = input.sources.map(cloneSourceRef);
  const aggregateContentHash = computeAggregateContentHash(
    input.priorityOrder !== undefined
      ? {
          sources,
          conflictResolutionPolicy: input.conflictResolutionPolicy,
          priorityOrder: input.priorityOrder,
        }
      : {
          sources,
          conflictResolutionPolicy: input.conflictResolutionPolicy,
        },
  );
  const envelope: MultiSourceTestIntentEnvelope = {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources,
    aggregateContentHash,
    conflictResolutionPolicy: input.conflictResolutionPolicy,
    ...(input.conflictResolutionPolicy === "priority" &&
    input.priorityOrder !== undefined
      ? { priorityOrder: [...input.priorityOrder] }
      : {}),
    ...(input.sourceMixPlan !== undefined
      ? { sourceMixPlan: { ...input.sourceMixPlan } }
      : {}),
  };
  return envelope;
};

const cloneSourceRef = (ref: TestIntentSourceRef): TestIntentSourceRef => {
  const next: TestIntentSourceRef = {
    sourceId: ref.sourceId,
    kind: ref.kind,
    contentHash: ref.contentHash,
    capturedAt: ref.capturedAt,
  };
  if (ref.authorHandle !== undefined) {
    next.authorHandle = ref.authorHandle;
  }
  if (ref.inputFormat !== undefined) {
    next.inputFormat = ref.inputFormat;
  }
  if (ref.noteEntryId !== undefined) {
    next.noteEntryId = ref.noteEntryId;
  }
  if (ref.markdownSectionPath !== undefined) {
    next.markdownSectionPath = ref.markdownSectionPath;
  }
  if (ref.canonicalIssueKey !== undefined) {
    next.canonicalIssueKey = ref.canonicalIssueKey;
  }
  if (ref.redactedMarkdownHash !== undefined) {
    next.redactedMarkdownHash = ref.redactedMarkdownHash;
  }
  if (ref.plainTextDerivativeHash !== undefined) {
    next.plainTextDerivativeHash = ref.plainTextDerivativeHash;
  }
  return next;
};

const REFUSAL_CODE_SET: ReadonlySet<MultiSourceEnvelopeRefusalCode> = new Set(
  ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES,
);

/**
 * Validate an untrusted candidate envelope against the multi-source
 * contract (Issue #1431). The function never throws — every refusal is
 * reported via the issue list.
 */
export const validateMultiSourceTestIntentEnvelope = (
  candidate: unknown,
): MultiSourceEnvelopeValidationResult => {
  const issues: MultiSourceEnvelopeIssue[] = [];
  if (!isPlainObject(candidate)) {
    issues.push({ code: "envelope_missing" });
    return { ok: false, issues };
  }
  if (candidate.version !== MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION) {
    issues.push({
      code: "envelope_version_mismatch",
      path: "version",
      detail: `expected ${MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION}`,
    });
  }
  const policy = candidate.conflictResolutionPolicy;
  let policyValid = false;
  if (
    typeof policy === "string" &&
    ALL_POLICIES.has(policy as ConflictResolutionPolicy)
  ) {
    policyValid = true;
  } else {
    issues.push({
      code: "invalid_conflict_resolution_policy",
      path: "conflictResolutionPolicy",
    });
  }
  const sourcesRawValue: unknown = candidate.sources;
  if (!Array.isArray(sourcesRawValue)) {
    issues.push({ code: "sources_empty", path: "sources" });
    return finalize(candidate, issues);
  }
  const sourcesRaw: readonly unknown[] = sourcesRawValue as readonly unknown[];
  if (sourcesRaw.length === 0) {
    issues.push({ code: "sources_empty", path: "sources" });
    return finalize(candidate, issues);
  }
  const validatedSourceEntries: Array<{
    ref: TestIntentSourceRef;
    originalIndex: number;
  }> = [];
  const sourceIdSeen = new Set<string>();
  for (let index = 0; index < sourcesRaw.length; index += 1) {
    const ref: unknown = sourcesRaw[index];
    if (!isPlainObject(ref)) {
      issues.push({
        code: "invalid_source_kind",
        path: `sources[${index}]`,
        detail: "not_an_object",
      });
      continue;
    }
    const refIssues = validateSourceRef(ref, index);
    if (refIssues.length > 0) {
      for (const issue of refIssues) {
        issues.push(issue);
      }
    } else {
      const accepted: TestIntentSourceRef = {
        sourceId: ref.sourceId as string,
        kind: ref.kind as TestIntentSourceKind,
        contentHash: ref.contentHash as string,
        capturedAt: ref.capturedAt as string,
      };
      if (typeof ref.authorHandle === "string") {
        accepted.authorHandle = ref.authorHandle;
      }
      if (typeof ref.inputFormat === "string") {
        accepted.inputFormat = ref.inputFormat as TestIntentCustomInputFormat;
      }
      if (typeof ref.noteEntryId === "string") {
        accepted.noteEntryId = ref.noteEntryId;
      }
      if (typeof ref.markdownSectionPath === "string") {
        accepted.markdownSectionPath = ref.markdownSectionPath;
      }
      if (typeof ref.canonicalIssueKey === "string") {
        accepted.canonicalIssueKey = ref.canonicalIssueKey;
      }
      if (typeof ref.redactedMarkdownHash === "string") {
        accepted.redactedMarkdownHash = ref.redactedMarkdownHash;
      }
      if (typeof ref.plainTextDerivativeHash === "string") {
        accepted.plainTextDerivativeHash = ref.plainTextDerivativeHash;
      }
      if (sourceIdSeen.has(accepted.sourceId)) {
        issues.push({
          code: "duplicate_source_id",
          path: `sources[${index}].sourceId`,
          detail: accepted.sourceId,
        });
      } else {
        sourceIdSeen.add(accepted.sourceId);
      }
      validatedSourceEntries.push({ ref: accepted, originalIndex: index });
    }
  }
  const validatedSources = validatedSourceEntries.map(({ ref }) => ref);
  if (
    validatedSources.length > 0 &&
    !validatedSources.some((ref) => PRIMARY_KINDS.has(ref.kind))
  ) {
    issues.push({ code: "primary_source_required", path: "sources" });
  }
  detectDuplicateJiraPasteCollision(validatedSourceEntries, issues);
  if (policyValid) {
    const policyTyped = policy as ConflictResolutionPolicy;
    validatePriorityOrder(
      policyTyped,
      candidate.priorityOrder,
      validatedSources,
      issues,
    );
  }
  const sourceMixPlanIssues = validateSourceMixPlan(candidate.sourceMixPlan);
  for (const issue of sourceMixPlanIssues) {
    issues.push(issue);
  }
  if (
    issues.length === 0 &&
    typeof candidate.aggregateContentHash === "string"
  ) {
    const expected = computeAggregateContentHash(
      Array.isArray(candidate.priorityOrder)
        ? {
            sources: validatedSources,
            conflictResolutionPolicy: policy as ConflictResolutionPolicy,
            priorityOrder: candidate.priorityOrder as TestIntentSourceKind[],
          }
        : {
            sources: validatedSources,
            conflictResolutionPolicy: policy as ConflictResolutionPolicy,
          },
    );
    if (expected !== candidate.aggregateContentHash) {
      issues.push({
        code: "aggregate_hash_mismatch",
        path: "aggregateContentHash",
        detail: expected,
      });
    }
  } else if (
    issues.length === 0 &&
    typeof candidate.aggregateContentHash !== "string"
  ) {
    issues.push({
      code: "aggregate_hash_mismatch",
      path: "aggregateContentHash",
      detail: "missing",
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const envelope: MultiSourceTestIntentEnvelope = {
    version: MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION,
    sources: validatedSources,
    aggregateContentHash: candidate.aggregateContentHash as string,
    conflictResolutionPolicy: policy as ConflictResolutionPolicy,
    ...(Array.isArray(candidate.priorityOrder)
      ? {
          priorityOrder: [
            ...(candidate.priorityOrder as TestIntentSourceKind[]),
          ],
        }
      : {}),
    ...(isValidSourceMixPlan(candidate.sourceMixPlan)
      ? { sourceMixPlan: { ...candidate.sourceMixPlan } }
      : {}),
  };
  return { ok: true, envelope };
};

const validateSourceRef = (
  ref: Record<string, unknown>,
  index: number,
): MultiSourceEnvelopeIssue[] => {
  const result: MultiSourceEnvelopeIssue[] = [];
  if (typeof ref.sourceId !== "string" || !SOURCE_ID.test(ref.sourceId)) {
    result.push({
      code: "invalid_source_id",
      path: `sources[${index}].sourceId`,
    });
  }
  if (
    typeof ref.kind !== "string" ||
    !ALL_KINDS.has(ref.kind as TestIntentSourceKind)
  ) {
    result.push({
      code: "invalid_source_kind",
      path: `sources[${index}].kind`,
    });
  }
  if (typeof ref.contentHash !== "string" || !HEX64.test(ref.contentHash)) {
    result.push({
      code: "invalid_content_hash",
      path: `sources[${index}].contentHash`,
    });
  }
  if (typeof ref.capturedAt !== "string" || !isStrictIsoUtc(ref.capturedAt)) {
    result.push({
      code: "invalid_captured_at",
      path: `sources[${index}].capturedAt`,
    });
  }
  if (ref.authorHandle !== undefined) {
    if (
      typeof ref.authorHandle !== "string" ||
      !AUTHOR_HANDLE.test(ref.authorHandle)
    ) {
      result.push({
        code: "invalid_author_handle",
        path: `sources[${index}].authorHandle`,
      });
    }
  }
  const kindOk =
    typeof ref.kind === "string" &&
    ALL_KINDS.has(ref.kind as TestIntentSourceKind);
  if (kindOk) {
    const kind = ref.kind as TestIntentSourceKind;
    const isCustom = SUPPORTING_KINDS.has(kind);
    if (isCustom) {
      if (ref.inputFormat === undefined) {
        result.push({
          code: "custom_input_format_required",
          path: `sources[${index}].inputFormat`,
        });
      } else if (
        typeof ref.inputFormat !== "string" ||
        !ALL_FORMATS.has(ref.inputFormat as TestIntentCustomInputFormat)
      ) {
        result.push({
          code: "custom_input_format_invalid",
          path: `sources[${index}].inputFormat`,
        });
      }
      const isMarkdown = ref.inputFormat === "markdown";
      if (!isMarkdown) {
        if (ref.markdownSectionPath !== undefined) {
          result.push({
            code: "markdown_metadata_only_for_custom",
            path: `sources[${index}].markdownSectionPath`,
            detail: "markdown_format_required",
          });
        }
        if (ref.noteEntryId !== undefined) {
          result.push({
            code: "markdown_metadata_only_for_custom",
            path: `sources[${index}].noteEntryId`,
            detail: "markdown_format_required",
          });
        }
        if (ref.redactedMarkdownHash !== undefined) {
          result.push({
            code: "markdown_hash_only_for_markdown",
            path: `sources[${index}].redactedMarkdownHash`,
          });
        }
        if (ref.plainTextDerivativeHash !== undefined) {
          result.push({
            code: "markdown_hash_only_for_markdown",
            path: `sources[${index}].plainTextDerivativeHash`,
          });
        }
      } else {
        if (
          typeof ref.redactedMarkdownHash !== "string" ||
          !HEX64.test(ref.redactedMarkdownHash)
        ) {
          result.push({
            code: "markdown_hash_required",
            path: `sources[${index}].redactedMarkdownHash`,
          });
        }
        if (
          typeof ref.plainTextDerivativeHash !== "string" ||
          !HEX64.test(ref.plainTextDerivativeHash)
        ) {
          result.push({
            code: "markdown_hash_required",
            path: `sources[${index}].plainTextDerivativeHash`,
          });
        }
      }
    } else {
      if (ref.inputFormat !== undefined) {
        result.push({
          code: "primary_source_input_format_invalid",
          path: `sources[${index}].inputFormat`,
        });
      }
      if (ref.markdownSectionPath !== undefined) {
        result.push({
          code: "markdown_metadata_only_for_custom",
          path: `sources[${index}].markdownSectionPath`,
        });
      }
      if (ref.noteEntryId !== undefined) {
        result.push({
          code: "markdown_metadata_only_for_custom",
          path: `sources[${index}].noteEntryId`,
        });
      }
      if (ref.redactedMarkdownHash !== undefined) {
        result.push({
          code: "markdown_hash_only_for_markdown",
          path: `sources[${index}].redactedMarkdownHash`,
        });
      }
      if (ref.plainTextDerivativeHash !== undefined) {
        result.push({
          code: "markdown_hash_only_for_markdown",
          path: `sources[${index}].plainTextDerivativeHash`,
        });
      }
    }
    const isJira = kind === "jira_rest" || kind === "jira_paste";
    if (isJira) {
      if (
        ref.canonicalIssueKey !== undefined &&
        (typeof ref.canonicalIssueKey !== "string" ||
          !JIRA_ISSUE_KEY.test(ref.canonicalIssueKey))
      ) {
        result.push({
          code: "jira_issue_key_invalid",
          path: `sources[${index}].canonicalIssueKey`,
        });
      }
    } else if (ref.canonicalIssueKey !== undefined) {
      result.push({
        code: "jira_issue_key_only_for_jira",
        path: `sources[${index}].canonicalIssueKey`,
      });
    }
  }
  return result;
};

const detectDuplicateJiraPasteCollision = (
  sources: readonly {
    ref: TestIntentSourceRef;
    originalIndex: number;
  }[],
  issues: MultiSourceEnvelopeIssue[],
): void => {
  const jiraSources = sources.filter(
    ({ ref }) => ref.kind === "jira_rest" || ref.kind === "jira_paste",
  );
  if (jiraSources.length < 2) {
    return;
  }
  const seen = new Map<string, number>();
  jiraSources.forEach(({ ref, originalIndex }) => {
    const key = ref.canonicalIssueKey;
    if (key === undefined) {
      return;
    }
    if (seen.has(key)) {
      const firstIdx = seen.get(key);
      issues.push({
        code: "duplicate_jira_paste_collision",
        path: `sources[${originalIndex}].canonicalIssueKey`,
        detail: `collides_with_sources[${firstIdx}]`,
      });
    } else {
      seen.set(key, originalIndex);
    }
  });
};

const isStrictIsoUtc = (value: string): boolean => {
  const match = ISO_UTC.exec(value);
  if (match === null) {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const canonical = new Date(parsed).toISOString();
  const normalized = value.includes(".")
    ? value.replace(
        /\.(\d{1,3})Z$/,
        (_fraction, digits: string) => `.${digits.padEnd(3, "0")}Z`,
      )
    : value.replace("Z", ".000Z");
  return canonical === normalized;
};

const isValidSourceMixPlan = (
  value: unknown,
): value is NonNullable<MultiSourceTestIntentEnvelope["sourceMixPlan"]> =>
  isPlainObject(value) &&
  value.ownerIssue === "#1441" &&
  typeof value.planHash === "string" &&
  HEX64.test(value.planHash);

const validateSourceMixPlan = (value: unknown): MultiSourceEnvelopeIssue[] => {
  if (value === undefined) {
    return [];
  }
  if (!isValidSourceMixPlan(value)) {
    return [
      {
        code: "source_mix_plan_invalid",
        path: "sourceMixPlan",
      },
    ];
  }
  return [];
};

const validatePriorityOrder = (
  policy: ConflictResolutionPolicy,
  raw: unknown,
  sources: readonly TestIntentSourceRef[],
  issues: MultiSourceEnvelopeIssue[],
): void => {
  if (policy !== "priority") {
    if (raw !== undefined) {
      // priorityOrder is meaningless for non-priority policies; treat as
      // a soft refusal so callers cannot ship cache-poisoning hashes.
      issues.push({
        code: "priority_order_required",
        path: "priorityOrder",
        detail: "only_for_priority_policy",
      });
    }
    return;
  }
  if (!Array.isArray(raw)) {
    issues.push({ code: "priority_order_required", path: "priorityOrder" });
    return;
  }
  const rawArr: readonly unknown[] = raw as readonly unknown[];
  const seen = new Set<string>();
  for (let i = 0; i < rawArr.length; i += 1) {
    const value: unknown = rawArr[i];
    if (
      typeof value !== "string" ||
      !ALL_KINDS.has(value as TestIntentSourceKind)
    ) {
      issues.push({
        code: "priority_order_invalid_kind",
        path: `priorityOrder[${i}]`,
      });
      continue;
    }
    if (seen.has(value)) {
      issues.push({
        code: "priority_order_duplicate",
        path: `priorityOrder[${i}]`,
        detail: value,
      });
    }
    seen.add(value);
  }
  const present = new Set(sources.map((ref) => ref.kind));
  for (const kind of present) {
    if (!seen.has(kind)) {
      issues.push({
        code: "priority_order_incomplete",
        path: "priorityOrder",
        detail: kind,
      });
    }
  }
  for (const value of seen) {
    if (!present.has(value as TestIntentSourceKind)) {
      issues.push({
        code: "priority_order_invalid_kind",
        path: "priorityOrder",
        detail: `not_in_sources:${value}`,
      });
    }
  }
};

const finalize = (
  candidate: Record<string, unknown>,
  issues: MultiSourceEnvelopeIssue[],
): MultiSourceEnvelopeValidationResult => {
  // Use parameter to avoid lint complaint about unused destructure.
  void candidate;
  return { ok: false, issues };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Project the multi-source envelope down to the legacy single-source
 * shape used by `BusinessTestIntentIr.source`. The projection picks the
 * first primary Figma source if any, otherwise the first primary source
 * of any kind, otherwise the first source in the envelope. This keeps
 * the legacy artifact stable for one minor cycle while downstream
 * consumers migrate to {@link MultiSourceTestIntentEnvelope}.
 */
export const legacySourceFromMultiSourceEnvelope = (
  envelope: MultiSourceTestIntentEnvelope,
): BusinessTestIntentIrSource | null => {
  if (envelope.sources.length === 0) {
    return null;
  }
  const figma = envelope.sources.find(
    (ref) =>
      ref.kind === "figma_local_json" ||
      ref.kind === "figma_plugin" ||
      ref.kind === "figma_rest",
  );
  const primary =
    figma ?? envelope.sources.find((ref) => PRIMARY_KINDS.has(ref.kind));
  const chosen = primary ?? envelope.sources[0];
  if (chosen === undefined) {
    return null;
  }
  if (
    chosen.kind === "figma_local_json" ||
    chosen.kind === "figma_plugin" ||
    chosen.kind === "figma_rest"
  ) {
    return {
      kind: chosen.kind,
      contentHash: chosen.contentHash,
    };
  }
  // Non-Figma primary source — collapse to the legacy `hybrid` discriminant
  // so existing callers never see an unknown literal.
  return {
    kind: "hybrid",
    contentHash: chosen.contentHash,
  };
};

const REFUSAL_DETAIL: Record<MultiSourceModeGateRefusalCode, string> = {
  test_intelligence_disabled:
    "FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE env var or testIntelligence.enabled startup option is not enabled.",
  multi_source_env_disabled:
    "FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE env var is not enabled.",
  multi_source_startup_option_disabled:
    "testIntelligence.multiSourceEnabled startup option is not enabled.",
  llm_codegen_mode_locked:
    "Multi-source ingestion requires llmCodegenMode=deterministic; refused.",
};

/**
 * Evaluate the multi-source mode gate (Issue #1431). The gate is fail-closed:
 * any single failed predicate refuses the request and emits a structured
 * diagnostic. The function is pure — no IO, no side effects — and the
 * caller is responsible for producing the user-facing 503 / refusal.
 */
export const evaluateMultiSourceModeGate = (
  input: MultiSourceModeGateInput,
): MultiSourceModeGateDecision => {
  const refusals: MultiSourceModeGateRefusal[] = [];
  if (
    !input.testIntelligenceEnvEnabled ||
    !input.testIntelligenceStartupEnabled
  ) {
    refusals.push({
      code: "test_intelligence_disabled",
      detail: REFUSAL_DETAIL.test_intelligence_disabled,
    });
  }
  if (!input.multiSourceEnvEnabled) {
    refusals.push({
      code: "multi_source_env_disabled",
      detail: REFUSAL_DETAIL.multi_source_env_disabled,
    });
  }
  if (!input.multiSourceStartupEnabled) {
    refusals.push({
      code: "multi_source_startup_option_disabled",
      detail: REFUSAL_DETAIL.multi_source_startup_option_disabled,
    });
  }
  const mode = (input.llmCodegenMode ?? "deterministic").trim().toLowerCase();
  if (mode !== "deterministic") {
    refusals.push({
      code: "llm_codegen_mode_locked",
      detail: REFUSAL_DETAIL.llm_codegen_mode_locked,
    });
  }
  return {
    allowed: refusals.length === 0,
    refusals,
  };
};

/**
 * Convenience: enforce the multi-source mode gate, throwing on refusal.
 * Server callers should prefer {@link evaluateMultiSourceModeGate} so the
 * response can carry a structured `refusals` payload.
 */
export const enforceMultiSourceModeGate = (
  input: MultiSourceModeGateInput,
): void => {
  const decision = evaluateMultiSourceModeGate(input);
  if (decision.allowed) {
    return;
  }
  const summary = decision.refusals
    .map((refusal) => `${refusal.code}: ${refusal.detail}`)
    .join("; ");
  throw new MultiSourceModeGateError(
    `Multi-source ingestion refused: ${summary}`,
    decision.refusals,
  );
};

/** Error thrown by {@link enforceMultiSourceModeGate} on refusal. */
export class MultiSourceModeGateError extends Error {
  public readonly refusals: readonly MultiSourceModeGateRefusal[];
  public override readonly name = "MultiSourceModeGateError";
  constructor(
    message: string,
    refusals: readonly MultiSourceModeGateRefusal[],
  ) {
    super(message);
    this.refusals = refusals;
  }
}

/**
 * Resolve the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` env
 * gate. Mirrors the existing test-intelligence env-var resolver and
 * accepts the same truthy values (`1` / `true` / `yes` / `on`).
 */
export const resolveTestIntelligenceMultiSourceEnvEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const raw = env[TEST_INTELLIGENCE_MULTISOURCE_ENV];
  if (raw === undefined) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
};

/**
 * Reproducibility helper exposed for tests: returns the canonical JSON
 * encoding of an envelope (with sorted keys). Useful when asserting
 * byte-identical artifacts across runs.
 */
export const canonicalizeMultiSourceEnvelope = (
  envelope: MultiSourceTestIntentEnvelope,
): string => canonicalJson(envelope);

/** Type-guard helper exposed for tests. */
export const isMultiSourceEnvelopeRefusalCode = (
  value: unknown,
): value is MultiSourceEnvelopeRefusalCode =>
  typeof value === "string" &&
  REFUSAL_CODE_SET.has(value as MultiSourceEnvelopeRefusalCode);

/** Type-guard helper exposed for tests. */
export const isMultiSourceModeGateRefusalCode = (
  value: unknown,
): value is MultiSourceModeGateRefusalCode =>
  typeof value === "string" &&
  (ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES as readonly string[]).includes(
    value,
  );
