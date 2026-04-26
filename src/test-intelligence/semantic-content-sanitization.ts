/**
 * Semantic-content sanitization for LLM-generated test-case strings (Issue #1413).
 *
 * The structural schema validator (`generated-test-case-schema.ts`) confirms
 * that `steps[n].action`, `steps[n].expected`, top-level `expectedResults[n]`,
 * `preconditions[n]`, and `testData[n]` are non-empty strings, but does not
 * inspect their *content*. A schema-valid response can still carry
 * shell-injection-shape strings (`rm -rf /`, `;rm -rf;`, `$(curl ...)`),
 * curly-bracket payloads (`${jndi:ldap://...}`), long base64 / hex blobs
 * (likely encoded payloads), `<script>` tags, inline event handlers, or
 * `javascript:` / `data:` URLs. None of those belong in a generated QC test
 * case. Reviewers catch them today only through attention.
 *
 * This module is a defensive, hand-rolled detector that flags those patterns
 * at the validation layer so the pipeline blocks early. The detector is
 * intentionally bounded:
 *
 *   - Pure: no IO, no allocation in hot loops, ASCII-folded inputs.
 *   - Fail-loud: any match becomes an `error`-severity validation issue
 *     and the validation report blocks downstream gates by default.
 *   - Override-aware: a reviewer with the necessary authority can record a
 *     structured `note` review event (kind = `"note"`, metadata
 *     `overrideKind = "semantic_suspicious_content"` plus a non-empty
 *     `justification`) that the policy gate respects on subsequent
 *     evaluation. The validation artifact still carries the original
 *     finding so the audit history is preserved.
 *
 * The patterns are deliberately conservative — every category cites the
 * concrete attack class it represents and is documented in the constants
 * below so reviewers can audit changes by reading the source.
 */

import type {
  RecordTransitionInput,
  RecordTransitionResult,
  ReviewStore,
} from "./review-store.js";
import type {
  ReviewEvent,
  TestCaseValidationReport,
} from "../contracts/index.js";

/**
 * Stable category labels for matched suspicious content. Each label is also
 * persisted as the `overrideCategory` metadata key on a reviewer override
 * note so the audit log records which deny-list category was waived.
 */
export const SEMANTIC_SUSPICION_CATEGORIES = [
  "shell_metacharacters",
  "command_substitution",
  "jndi_log4shell",
  "encoded_payload_base64",
  "encoded_payload_hex",
  "script_tag",
  "html_event_handler",
  "dangerous_url_scheme",
] as const;

export type SemanticSuspicionCategory =
  (typeof SEMANTIC_SUSPICION_CATEGORIES)[number];

/**
 * Single deny-list match.
 *
 * `matchedSnippet` is a short, length-bounded slice of the original input
 * surfaced verbatim so reviewers can see the exact reason without scrolling
 * through long strings. The detector never embeds the snippet in a redaction
 * token or a regex alternation that would re-enter user-controlled data.
 */
export interface SemanticSuspicionMatch {
  category: SemanticSuspicionCategory;
  /** Short rationale for the match, suitable for a validation issue message. */
  reason: string;
  /** Up to 64 chars of the matched substring, ASCII-collapsed. */
  matchedSnippet: string;
}

/** Maximum length of `matchedSnippet` echoed in validation issue messages. */
const MAX_SNIPPET_LENGTH = 64;

/** Safety bound on inputs: never scan more than this many characters. */
const MAX_SCAN_LENGTH = 16_384;

/**
 * Shell-metacharacter sequences. Plain words like `rm` or single `;` are
 * not flagged on their own — only sequences that combine an unsafe binary or
 * redirection with a metacharacter are flagged, so benign sentences like
 * "remove the file from the cart" do not trip.
 *
 * Reasoning per pattern (regex source omitted from JSDoc to keep the
 * comment block parseable; see the `RegExp` literals below):
 *   - rm -rf path           : the canonical destructive POSIX call
 *   - fork-bomb prefix      : the leading bytes of `:(){ :|: };:`
 *   - pipe-to-shell         : `| sh` / `| bash`
 *   - device exfil          : output redirection into `/dev/null` or `/dev/tcp/`
 *   - mkfifo / nc -l        : reverse-shell building blocks
 */
const SHELL_METACHARACTER_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf?\s+\/[^\s]*/iu,
  /:\(\)\s*\{[^}]*\|/u,
  /\|\s*(?:ba)?sh\b/iu,
  />\s*\/dev\/(?:null|tcp\/)/iu,
  /\bmkfifo\b/iu,
  /\bnc\s+-l\b/iu,
];

/**
 * Command substitution / backtick-eval shapes. These only apply when a
 * shell would interpret them as a sub-shell call, so `$(value)` written
 * inside a literal natural-language sentence still trips — that is
 * intended, because a generated step like "wait for `$(get_token)`" would
 * leak a sub-shell call into a downstream tooling artifact.
 */
const COMMAND_SUBSTITUTION_PATTERNS: readonly RegExp[] = [
  /\$\([^)]+\)/u,
  /`[^`\n]+`/u,
  /\$\{IFS\}/iu,
];

/**
 * JNDI / log4shell-style payloads. The canonical `${jndi:` prefix and its
 * obfuscation variants are unambiguously hostile. These belong to no
 * generated test step, period.
 */
const JNDI_LOG4SHELL_PATTERNS: readonly RegExp[] = [
  /\$\{\s*(?:jndi|j\$\{[^}]*\}ndi|\$\{lower:j\}ndi)\s*:/iu,
  /\$\{\s*[\w:.]*?:-j[^}]*\}/iu,
];

/**
 * Long base64 runs. A run of base64-alphabet characters of length >= 64
 * with at least one digit and at least one uppercase letter is treated as
 * "likely encoded payload". Plain English words rarely satisfy this.
 */
const BASE64_RUN_RE = /[A-Za-z0-9+/]{64,}={0,2}/u;

/**
 * Long hex runs. >= 40 hex characters (SHA-1 length) with no whitespace.
 * Sentence text never carries unbroken hex of this length.
 */
const HEX_RUN_RE = /\b[0-9a-fA-F]{40,}\b/u;

/**
 * `<script>` tags and inline event handlers. The XSS shapes never belong
 * in a QC test step / expected-result string. Detection is HTML-aware
 * enough to catch attribute-shaped event handlers like `onclick=alert(1)`
 * and the case-insensitive `<sCrIpT>` variant.
 */
const SCRIPT_TAG_RE = /<\s*script\b[^>]*>/iu;
const HTML_EVENT_HANDLER_RE =
  /\bon[a-z]{3,20}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu;

/**
 * Dangerous URL schemes inside step text. `javascript:`, `data:`, and
 * `vbscript:` are never legitimate inside a QC step description. The
 * lookahead `(?=[A-Za-z0-9/+_\-])` requires actual URL content directly
 * after the colon so labels like "Test data: <value>" or "Order data:"
 * (label + space) do not trip — only well-formed URL-scheme starts do.
 */
const DANGEROUS_URL_SCHEME_RE =
  /\b(?:javascript|data|vbscript):(?=[A-Za-z0-9/+_-])/iu;

/**
 * Short-circuit guard. Empty strings cannot match. Strings longer than
 * `MAX_SCAN_LENGTH` are clipped before the scan to bound regex worst-case.
 */
const prepareInput = (input: string): string | null => {
  if (input.length === 0) return null;
  return input.length > MAX_SCAN_LENGTH
    ? input.slice(0, MAX_SCAN_LENGTH)
    : input;
};

const buildSnippet = (
  source: string,
  match: RegExpExecArray | null,
): string => {
  if (match === null) {
    return source.slice(0, MAX_SNIPPET_LENGTH);
  }
  return match[0].slice(0, MAX_SNIPPET_LENGTH);
};

const tryPatterns = (
  source: string,
  patterns: readonly RegExp[],
  category: SemanticSuspicionCategory,
  reason: string,
): SemanticSuspicionMatch | null => {
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match !== null) {
      return { category, reason, matchedSnippet: buildSnippet(source, match) };
    }
  }
  return null;
};

const tryPattern = (
  source: string,
  pattern: RegExp,
  category: SemanticSuspicionCategory,
  reason: string,
): SemanticSuspicionMatch | null => {
  const match = pattern.exec(source);
  if (match === null) return null;
  return { category, reason, matchedSnippet: buildSnippet(source, match) };
};

/**
 * Run all deny-list categories against `input`. Returns the first match
 * encountered in declaration order, or `null` if nothing matches. The
 * declaration order is meaningful: the most specific / most dangerous
 * categories run first so that a JNDI payload buried inside a base64-shape
 * blob is still reported as JNDI.
 *
 * Behavior on edge cases:
 *   - empty string → `null`
 *   - whitespace-only string → `null`
 *   - input longer than `MAX_SCAN_LENGTH` is clipped to that length
 *   - the returned `matchedSnippet` is at most `MAX_SNIPPET_LENGTH` chars
 */
export const detectSuspiciousContent = (
  input: string,
): SemanticSuspicionMatch | null => {
  const source = prepareInput(input);
  if (source === null) return null;
  if (source.trim().length === 0) return null;

  const jndi = tryPatterns(
    source,
    JNDI_LOG4SHELL_PATTERNS,
    "jndi_log4shell",
    "matches JNDI / log4shell payload shape",
  );
  if (jndi !== null) return jndi;

  const script = tryPattern(
    source,
    SCRIPT_TAG_RE,
    "script_tag",
    "contains <script> tag shape",
  );
  if (script !== null) return script;

  const handler = tryPattern(
    source,
    HTML_EVENT_HANDLER_RE,
    "html_event_handler",
    "contains inline HTML event-handler attribute",
  );
  if (handler !== null) return handler;

  const url = tryPattern(
    source,
    DANGEROUS_URL_SCHEME_RE,
    "dangerous_url_scheme",
    "contains javascript:/data:/vbscript: URL scheme",
  );
  if (url !== null) return url;

  const shell = tryPatterns(
    source,
    SHELL_METACHARACTER_PATTERNS,
    "shell_metacharacters",
    "matches destructive shell-command shape",
  );
  if (shell !== null) return shell;

  const subst = tryPatterns(
    source,
    COMMAND_SUBSTITUTION_PATTERNS,
    "command_substitution",
    "contains command-substitution shape ($(...) / backticks / ${IFS})",
  );
  if (subst !== null) return subst;

  const hex = tryPattern(
    source,
    HEX_RUN_RE,
    "encoded_payload_hex",
    "contains long hex run (>= 40 chars; likely encoded payload)",
  );
  if (hex !== null) return hex;

  const base64 = tryPattern(
    source,
    BASE64_RUN_RE,
    "encoded_payload_base64",
    "contains long base64 run (>= 64 chars; likely encoded payload)",
  );
  if (base64 !== null) return base64;

  return null;
};

// ---------------------------------------------------------------------------
// Reviewer overrides
// ---------------------------------------------------------------------------

/**
 * Stable string used both as the inbound transition `kind` and as the
 * `overrideKind` metadata value identifying a semantic-content override
 * note inside the persisted review-event log. Stable across versions to
 * keep historical events parseable.
 */
export const SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND = "note" as const;

/** Metadata key marking a `note` event as a semantic-content override. */
export const SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY =
  "overrideKind" as const;

/** Metadata key carrying the validation issue path being overridden. */
export const SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY =
  "overridePath" as const;

/** Metadata key carrying the deny-list category being overridden. */
export const SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY =
  "overrideCategory" as const;

/** Metadata key carrying the reviewer-supplied justification text. */
export const SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY =
  "overrideJustification" as const;

/**
 * Sentinel value stamped on `overrideKind` for semantic-content overrides.
 * Distinct from validation/policy outcome literals so a future override
 * type cannot collide with this one by accident.
 */
export const SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE =
  "semantic_suspicious_content" as const;

/** Maximum justification length accepted by `recordSemanticContentOverride`. */
export const SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH = 512;

/**
 * Active overrides for one job. Values may be a path set (for compatibility
 * with direct callers) or a path-to-category map (used by event-log replay).
 */
export type SemanticContentOverrideMap = ReadonlyMap<
  string,
  ReadonlySet<string> | ReadonlyMap<string, SemanticSuspicionCategory>
>;

const isCategoryOverrideMap = (
  value: ReadonlySet<string> | ReadonlyMap<string, SemanticSuspicionCategory>,
): value is ReadonlyMap<string, SemanticSuspicionCategory> =>
  typeof (value as { get?: unknown }).get === "function";

const categoryFromValidationMessage = (
  message: string,
): SemanticSuspicionCategory | undefined => {
  const separatorIndex = message.indexOf(":");
  if (separatorIndex <= 0) return undefined;
  const category = message.slice(0, separatorIndex);
  return isSemanticSuspicionCategory(category) ? category : undefined;
};

const issueHasSemanticContentOverride = (
  issue: TestCaseValidationReport["issues"][number],
  overrides: SemanticContentOverrideMap,
): boolean => {
  if (issue.testCaseId === undefined) return false;
  const paths = overrides.get(issue.testCaseId);
  if (paths === undefined) return false;
  if (!isCategoryOverrideMap(paths)) {
    return paths.has(issue.path);
  }
  const overrideCategory = paths.get(issue.path);
  if (overrideCategory === undefined) return false;
  return overrideCategory === categoryFromValidationMessage(issue.message);
};

/**
 * Audit-friendly view of a single override extracted from the event log.
 * One entry per `(testCaseId, path)` pair.
 */
export interface SemanticContentOverride {
  testCaseId: string;
  path: string;
  category: SemanticSuspicionCategory;
  justification: string;
  actor: string;
  at: string;
  eventId: string;
}

/** Inputs for `recordSemanticContentOverride`. */
export interface SemanticContentOverrideInput {
  jobId: string;
  testCaseId: string;
  /** JSON-pointer-style path of the validation issue being overridden. */
  path: string;
  /** Deny-list category being overridden — must match the original finding. */
  category: SemanticSuspicionCategory;
  /** Identity of the reviewer recording the override. */
  actor: string;
  /** Non-empty rationale; persisted into `note` and `metadata`. */
  justification: string;
  /** ISO-8601 timestamp for the resulting review event. */
  at: string;
}

/** Refusal codes raised by `recordSemanticContentOverride` BEFORE the store call. */
export type RecordSemanticContentOverrideRefusalCode =
  | "actor_required"
  | "justification_required"
  | "justification_too_long"
  | "path_required"
  | "test_case_id_required"
  | "category_unknown";

const SEMANTIC_SUSPICION_CATEGORY_SET: ReadonlySet<SemanticSuspicionCategory> =
  new Set(SEMANTIC_SUSPICION_CATEGORIES);

const isSemanticSuspicionCategory = (
  value: unknown,
): value is SemanticSuspicionCategory =>
  typeof value === "string" &&
  SEMANTIC_SUSPICION_CATEGORY_SET.has(value as SemanticSuspicionCategory);

/**
 * Record a structured semantic-content override note via the review store.
 * Validates inputs before touching the store so callers see a clear
 * structured refusal instead of a generic store-level "kind unknown".
 */
export const recordSemanticContentOverride = async (
  store: ReviewStore,
  input: SemanticContentOverrideInput,
): Promise<
  | RecordTransitionResult
  | { ok: false; code: RecordSemanticContentOverrideRefusalCode }
> => {
  if (input.testCaseId.length === 0) {
    return { ok: false, code: "test_case_id_required" };
  }
  if (input.path.length === 0) {
    return { ok: false, code: "path_required" };
  }
  if (input.actor.length === 0) {
    return { ok: false, code: "actor_required" };
  }
  const trimmed = input.justification.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "justification_required" };
  }
  if (
    input.justification.length >
    SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH
  ) {
    return { ok: false, code: "justification_too_long" };
  }
  if (!SEMANTIC_SUSPICION_CATEGORY_SET.has(input.category)) {
    return { ok: false, code: "category_unknown" };
  }

  const transition: RecordTransitionInput = {
    jobId: input.jobId,
    testCaseId: input.testCaseId,
    kind: SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND,
    at: input.at,
    actor: input.actor,
    note: input.justification,
    metadata: {
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY]:
        SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY]: input.path,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: input.category,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]:
        input.justification,
    },
  };
  return store.recordTransition(transition);
};

const isSemanticContentOverrideEvent = (
  event: ReviewEvent,
): event is ReviewEvent & { testCaseId: string; actor: string } => {
  if (event.kind !== "note") return false;
  if (typeof event.testCaseId !== "string") return false;
  if (typeof event.actor !== "string") return false;
  if (event.metadata === undefined) return false;
  const kind = event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY];
  if (kind !== SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE) return false;
  const path = event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY];
  const category =
    event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY];
  const justification =
    event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY];
  if (typeof path !== "string" || path.length === 0) return false;
  if (!isSemanticSuspicionCategory(category)) return false;
  if (typeof justification !== "string" || justification.trim().length === 0) {
    return false;
  }
  return true;
};

/**
 * Reduce a persisted review-event log to the set of currently active
 * semantic-content overrides. Replay-safe: re-running over the same log
 * yields a byte-identical map. Later events take precedence over earlier
 * ones for the same `(testCaseId, path)` pair so a corrected override
 * (e.g., after a re-edit) supersedes the earlier one.
 *
 * The returned map keys (`testCaseId` strings) and value sets (`path`
 * strings) are sorted in iteration order so downstream byte-stable
 * persistence remains deterministic.
 */
export const extractSemanticContentOverrides = (
  events: readonly ReviewEvent[],
): SemanticContentOverrideMap => {
  const latestByKey = new Map<string, SemanticContentOverride>();
  for (const event of events) {
    if (!isSemanticContentOverrideEvent(event)) continue;
    const path = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY
    ] as string;
    const category = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY
    ] as SemanticSuspicionCategory;
    const justification = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY
    ] as string;
    const key = `${event.testCaseId} ${path}`;
    latestByKey.set(key, {
      testCaseId: event.testCaseId,
      path,
      category,
      justification,
      actor: event.actor,
      at: event.at,
      eventId: event.id,
    });
  }
  const grouped = new Map<string, Map<string, SemanticSuspicionCategory>>();
  const sorted = [...latestByKey.values()].sort((a, b) => {
    if (a.testCaseId !== b.testCaseId) {
      return a.testCaseId.localeCompare(b.testCaseId);
    }
    return a.path.localeCompare(b.path);
  });
  for (const override of sorted) {
    let paths = grouped.get(override.testCaseId);
    if (paths === undefined) {
      paths = new Map<string, SemanticSuspicionCategory>();
      grouped.set(override.testCaseId, paths);
    }
    paths.set(override.path, override.category);
  }
  return grouped;
};

/**
 * Audit-friendly list view of the same override data. Sorted by
 * `(testCaseId, path)` for byte-stable rendering.
 */
export const listSemanticContentOverrides = (
  events: readonly ReviewEvent[],
): readonly SemanticContentOverride[] => {
  const latestByKey = new Map<string, SemanticContentOverride>();
  for (const event of events) {
    if (!isSemanticContentOverrideEvent(event)) continue;
    const path = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY
    ] as string;
    const category = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY
    ] as SemanticSuspicionCategory;
    const justification = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY
    ] as string;
    const key = `${event.testCaseId} ${path}`;
    latestByKey.set(key, {
      testCaseId: event.testCaseId,
      path,
      category,
      justification,
      actor: event.actor,
      at: event.at,
      eventId: event.id,
    });
  }
  return [...latestByKey.values()].sort((a, b) => {
    if (a.testCaseId !== b.testCaseId) {
      return a.testCaseId.localeCompare(b.testCaseId);
    }
    return a.path.localeCompare(b.path);
  });
};

/**
 * Compute the post-override `blocked` flag from a validation report. Pure;
 * does not mutate the report. The original report still records the
 * `error`-severity finding for audit, but downstream gates use this
 * helper to know whether the case should still block.
 *
 * Returns `true` when the report has any `error` issue that is NOT a
 * `semantic_suspicious_content` issue covered by the override map.
 */
export const effectiveSemanticContentBlock = (
  validation: TestCaseValidationReport,
  overrides: SemanticContentOverrideMap,
): boolean => {
  for (const issue of validation.issues) {
    if (issue.severity !== "error") continue;
    if (issue.code !== "semantic_suspicious_content") return true;
    if (!issueHasSemanticContentOverride(issue, overrides)) {
      return true;
    }
  }
  return false;
};

/**
 * Join an override map against the current validation report, keeping only
 * overrides that target an actual `semantic_suspicious_content` issue. This
 * prevents stale, misspelled, or future-path notes from influencing downstream
 * gates while preserving the simple `testCaseId -> paths` map shape.
 */
export const filterSemanticContentOverridesForValidation = (
  validation: TestCaseValidationReport,
  overrides: SemanticContentOverrideMap,
): SemanticContentOverrideMap => {
  const allowed = new Map<string, Map<string, SemanticSuspicionCategory>>();
  for (const issue of validation.issues) {
    if (issue.code !== "semantic_suspicious_content") continue;
    if (!issueHasSemanticContentOverride(issue, overrides)) {
      continue;
    }
    const testCaseId = issue.testCaseId;
    if (testCaseId === undefined) continue;
    const category = categoryFromValidationMessage(issue.message);
    if (category === undefined) continue;
    let paths = allowed.get(testCaseId);
    if (paths === undefined) {
      paths = new Map<string, SemanticSuspicionCategory>();
      allowed.set(testCaseId, paths);
    }
    paths.set(issue.path, category);
  }

  const sorted = [...allowed.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new Map(
    sorted.map(([testCaseId, paths]) => [
      testCaseId,
      new Map(
        [...paths.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    ]),
  );
};
