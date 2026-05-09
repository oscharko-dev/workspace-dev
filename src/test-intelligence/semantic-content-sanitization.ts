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

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  ReviewEvent,
  TestCaseValidationReport,
} from "../contracts/index.js";
import { canonicalJson } from "./content-hash.js";
import type {
  RecordTransitionInput,
  RecordTransitionResult,
  ReviewStore,
} from "./review-store.js";

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

export type PrincipalRef = string;
export type ISO8601 = string;

export const SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM =
  "hmac-sha256" as const;

export interface HmacBlock {
  algorithm: typeof SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM;
  digest: string;
  keyId?: string;
}

export type OverrideAuthoritySecretProvider = string | (() => string);

export interface OverrideAuthorityProvider {
  /** Operator-managed verification secret. Never persisted. */
  hmacSecret: OverrideAuthoritySecretProvider;
  /** Optional key identifier stamped into signed entries. */
  keyId?: string;
  /** Optional deterministic clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface SemanticContentOverrideEntry {
  category: SemanticSuspicionCategory;
  justification: string;
  actor: PrincipalRef;
  signedAt: ISO8601;
  signature: HmacBlock;
  expiresAt?: ISO8601;
  verifiedSignature: boolean;
}

export interface CreateSignedSemanticContentOverrideEntryInput {
  jobId: string;
  testCaseId: string;
  path: string;
  category: SemanticSuspicionCategory;
  justification: string;
  actor: PrincipalRef;
  signedAt: ISO8601;
  expiresAt?: ISO8601;
  authority: OverrideAuthorityProvider;
}

/**
 * Active overrides for one job. Entries are keyed by `testCaseId → path`,
 * with each value carrying the reviewer identity plus the signed audit data
 * needed to verify the override before policy-gate may honor it.
 */
export type SemanticContentOverrideMap = ReadonlyMap<
  string,
  ReadonlyMap<string, SemanticContentOverrideEntry>
>;

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
  const entry = paths.get(issue.path);
  if (entry === undefined) return false;
  const category = categoryFromValidationMessage(issue.message);
  if (category === undefined) return false;
  return entry.category === category;
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
  actor: PrincipalRef;
  signedAt: ISO8601;
  expiresAt?: ISO8601;
  signature: HmacBlock;
  verifiedSignature: boolean;
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
  actor: PrincipalRef;
  /** Non-empty rationale; persisted into `note` and `metadata`. */
  justification: string;
  /** ISO-8601 timestamp for the resulting review event. */
  at: ISO8601;
  /** Optional override expiry. Expired entries are rejected fail-closed. */
  expiresAt?: ISO8601;
  /** Caller-supplied authority provider used to sign the entry. */
  authority: OverrideAuthorityProvider;
}

/** Refusal codes raised by `recordSemanticContentOverride` BEFORE the store call. */
export type RecordSemanticContentOverrideRefusalCode =
  | "actor_required"
  | "justification_required"
  | "justification_too_long"
  | "path_required"
  | "test_case_id_required"
  | "category_unknown"
  | "override_authority_required";

export const SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY =
  "overrideSignedAt" as const;

export const SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY =
  "overrideSignature" as const;

export const SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY =
  "overrideSignatureKeyId" as const;

export const SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY =
  "overrideExpiresAt" as const;

export const SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY =
  "verifiedSignature" as const;

export interface InvalidSemanticContentOverride {
  testCaseId: string;
  path: string;
  reason: string;
}

export type InvalidSemanticContentOverrideMap = ReadonlyMap<
  string,
  ReadonlyMap<string, string>
>;

const SEMANTIC_SUSPICION_CATEGORY_SET: ReadonlySet<SemanticSuspicionCategory> =
  new Set(SEMANTIC_SUSPICION_CATEGORIES);

const isSemanticSuspicionCategory = (
  value: unknown,
): value is SemanticSuspicionCategory =>
  typeof value === "string" &&
  SEMANTIC_SUSPICION_CATEGORY_SET.has(value as SemanticSuspicionCategory);

const HMAC_DIGEST_RE = /^[0-9a-f]{64}$/u;

const resolveOverrideAuthoritySecret = (
  provider: OverrideAuthorityProvider,
): string => {
  const secret =
    typeof provider.hmacSecret === "function"
      ? provider.hmacSecret()
      : provider.hmacSecret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new RangeError(
      "semantic-content override authority must resolve to a non-empty string",
    );
  }
  return secret;
};

const buildOverrideSignaturePayload = (input: {
  jobId: string;
  testCaseId: string;
  path: string;
  category: SemanticSuspicionCategory;
  justification: string;
  actor: PrincipalRef;
  signedAt: ISO8601;
  expiresAt?: ISO8601;
}): string => {
  return canonicalJson({
    overrideKind: SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE,
    jobId: input.jobId,
    testCaseId: input.testCaseId,
    path: input.path,
    category: input.category,
    justification: input.justification,
    actor: input.actor,
    signedAt: input.signedAt,
    expiresAt: input.expiresAt ?? null,
  });
};

const signOverrideSignaturePayload = (
  payload: string,
  authority: OverrideAuthorityProvider,
): HmacBlock => {
  const secret = resolveOverrideAuthoritySecret(authority);
  return {
    algorithm: SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM,
    digest: createHmac("sha256", secret).update(payload).digest("hex"),
    ...(authority.keyId !== undefined ? { keyId: authority.keyId } : {}),
  };
};

const signaturesMatch = (expected: string, candidate: string): boolean => {
  if (!HMAC_DIGEST_RE.test(expected) || !HMAC_DIGEST_RE.test(candidate)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(candidate, "hex"),
  );
};

const buildOverrideEntryReason = (
  entry: SemanticContentOverrideEntry,
): string | null => {
  if (entry.actor.length === 0) {
    return "override entry is missing actor";
  }
  if (entry.signedAt.length === 0) {
    return "override entry is missing signedAt";
  }
  if (entry.justification.trim().length === 0) {
    return "override entry is missing justification";
  }
  if (!isSemanticSuspicionCategory(entry.category)) {
    return "override entry has unknown category";
  }
  if (entry.signature.algorithm !== SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM) {
    return "override entry uses unsupported signature algorithm";
  }
  if (!HMAC_DIGEST_RE.test(entry.signature.digest)) {
    return "override entry is missing signature";
  }
  if (entry.verifiedSignature !== true) {
    return "override entry is missing verifiedSignature audit stamp";
  }
  if (entry.expiresAt !== undefined) {
    const expiresAtMs = Date.parse(entry.expiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      return "override entry has invalid expiresAt";
    }
  }
  return null;
};

const verifyOverrideEntry = (
  input: {
    jobId: string;
    testCaseId: string;
    path: string;
    entry: SemanticContentOverrideEntry;
  },
  authority: OverrideAuthorityProvider | undefined,
): string | null => {
  const structuralReason = buildOverrideEntryReason(input.entry);
  if (structuralReason !== null) {
    return structuralReason;
  }
  if (authority === undefined) {
    return "override authority provider missing";
  }
  if (input.entry.expiresAt !== undefined) {
    const nowMs = (authority.now ?? Date.now)();
    if (Date.parse(input.entry.expiresAt) <= nowMs) {
      return "override entry has expired";
    }
  }
  const payload = buildOverrideSignaturePayload({
    jobId: input.jobId,
    testCaseId: input.testCaseId,
    path: input.path,
    category: input.entry.category,
    justification: input.entry.justification,
    actor: input.entry.actor,
    signedAt: input.entry.signedAt,
    ...(input.entry.expiresAt !== undefined
      ? { expiresAt: input.entry.expiresAt }
      : {}),
  });
  const expected = signOverrideSignaturePayload(payload, authority);
  return signaturesMatch(expected.digest, input.entry.signature.digest)
    ? null
    : "override signature failed verification";
};

const setOverrideEntry = (
  target: Map<string, Map<string, SemanticContentOverrideEntry>>,
  testCaseId: string,
  path: string,
  entry: SemanticContentOverrideEntry,
): void => {
  let paths = target.get(testCaseId);
  if (paths === undefined) {
    paths = new Map<string, SemanticContentOverrideEntry>();
    target.set(testCaseId, paths);
  }
  paths.set(path, entry);
};

const setInvalidOverrideReason = (
  target: Map<string, Map<string, string>>,
  testCaseId: string,
  path: string,
  reason: string,
): void => {
  let paths = target.get(testCaseId);
  if (paths === undefined) {
    paths = new Map<string, string>();
    target.set(testCaseId, paths);
  }
  paths.set(path, reason);
};

export const createSignedSemanticContentOverrideEntry = (
  input: CreateSignedSemanticContentOverrideEntryInput,
): SemanticContentOverrideEntry => {
  const payload = buildOverrideSignaturePayload({
    jobId: input.jobId,
    testCaseId: input.testCaseId,
    path: input.path,
    category: input.category,
    justification: input.justification,
    actor: input.actor,
    signedAt: input.signedAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
  });
  const signature = signOverrideSignaturePayload(payload, input.authority);
  return {
    category: input.category,
    justification: input.justification,
    actor: input.actor,
    signedAt: input.signedAt,
    signature,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    verifiedSignature: true,
  };
};

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
  if (input.authority === undefined) {
    return { ok: false, code: "override_authority_required" };
  }

  const entry = createSignedSemanticContentOverrideEntry({
    jobId: input.jobId,
    testCaseId: input.testCaseId,
    path: input.path,
    category: input.category,
    justification: input.justification,
    actor: input.actor,
    signedAt: input.at,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    authority: input.authority,
  });

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
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY]: entry.category,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY]:
        entry.justification,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY]: entry.signedAt,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY]:
        entry.signature.digest,
      [SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY]:
        entry.verifiedSignature,
      ...(entry.signature.keyId !== undefined
        ? {
            [SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY]:
              entry.signature.keyId,
          }
        : {}),
      ...(entry.expiresAt !== undefined
        ? {
            [SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY]:
              entry.expiresAt,
          }
        : {}),
    },
  };
  return store.recordTransition(transition);
};

const isSemanticContentOverrideEvent = (
  event: ReviewEvent,
): event is ReviewEvent & { testCaseId: string } => {
  if (event.kind !== "note") return false;
  if (typeof event.testCaseId !== "string") return false;
  if (event.metadata === undefined) return false;
  const kind = event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_KIND_KEY];
  if (kind !== SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE) return false;
  const path = event.metadata[SEMANTIC_CONTENT_OVERRIDE_METADATA_PATH_KEY];
  return typeof path === "string" && path.length > 0;
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
    const rawCategory = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY
    ];
    if (!isSemanticSuspicionCategory(rawCategory)) continue;
    const rawJustification = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY
    ];
    if (typeof rawJustification !== "string") continue;
    const rawSignedAt =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY];
    const rawSignature =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY];
    const rawKeyId =
      event.metadata?.[
        SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY
      ];
    const rawExpiresAt =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY];
    const rawVerified =
      event.metadata?.[
        SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY
      ];
    const key = `${event.testCaseId}\u0000${path}`;
    latestByKey.set(key, {
      testCaseId: event.testCaseId,
      path,
      category: rawCategory,
      justification: rawJustification,
      actor: typeof event.actor === "string" ? event.actor : "",
      signedAt: typeof rawSignedAt === "string" ? rawSignedAt : "",
      signature: {
        algorithm: SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM,
        digest: typeof rawSignature === "string" ? rawSignature : "",
        ...(typeof rawKeyId === "string" ? { keyId: rawKeyId } : {}),
      },
      ...(typeof rawExpiresAt === "string" ? { expiresAt: rawExpiresAt } : {}),
      verifiedSignature: rawVerified === true,
      eventId: event.id,
    });
  }
  const grouped = new Map<string, Map<string, SemanticContentOverrideEntry>>();
  const sorted = [...latestByKey.values()].sort((a, b) => {
    if (a.testCaseId !== b.testCaseId) {
      return a.testCaseId.localeCompare(b.testCaseId);
    }
    return a.path.localeCompare(b.path);
  });
  for (const override of sorted) {
    let paths = grouped.get(override.testCaseId);
    if (paths === undefined) {
      paths = new Map<string, SemanticContentOverrideEntry>();
      grouped.set(override.testCaseId, paths);
    }
    paths.set(override.path, {
      category: override.category,
      justification: override.justification,
      actor: override.actor,
      signedAt: override.signedAt,
      signature: override.signature,
      ...(override.expiresAt !== undefined
        ? { expiresAt: override.expiresAt }
        : {}),
      verifiedSignature: override.verifiedSignature,
    });
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
    const rawCategory = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_CATEGORY_KEY
    ];
    if (!isSemanticSuspicionCategory(rawCategory)) continue;
    const rawJustification = event.metadata?.[
      SEMANTIC_CONTENT_OVERRIDE_METADATA_JUSTIFICATION_KEY
    ];
    if (typeof rawJustification !== "string") continue;
    const rawSignedAt =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNED_AT_KEY];
    const rawSignature =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY];
    const rawKeyId =
      event.metadata?.[
        SEMANTIC_CONTENT_OVERRIDE_METADATA_SIGNATURE_KEY_ID_KEY
      ];
    const rawExpiresAt =
      event.metadata?.[SEMANTIC_CONTENT_OVERRIDE_METADATA_EXPIRES_AT_KEY];
    const rawVerified =
      event.metadata?.[
        SEMANTIC_CONTENT_OVERRIDE_METADATA_VERIFIED_SIGNATURE_KEY
      ];
    const key = `${event.testCaseId}\u0000${path}`;
    latestByKey.set(key, {
      testCaseId: event.testCaseId,
      path,
      category: rawCategory,
      justification: rawJustification,
      actor: typeof event.actor === "string" ? event.actor : "",
      signedAt: typeof rawSignedAt === "string" ? rawSignedAt : "",
      signature: {
        algorithm: SEMANTIC_CONTENT_OVERRIDE_HMAC_ALGORITHM,
        digest: typeof rawSignature === "string" ? rawSignature : "",
        ...(typeof rawKeyId === "string" ? { keyId: rawKeyId } : {}),
      },
      ...(typeof rawExpiresAt === "string" ? { expiresAt: rawExpiresAt } : {}),
      verifiedSignature: rawVerified === true,
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
  return partitionSemanticContentOverridesForValidation(
    validation,
    overrides,
    undefined,
  ).valid;
};

export const partitionSemanticContentOverridesForValidation = (
  validation: TestCaseValidationReport,
  overrides: SemanticContentOverrideMap,
  authority: OverrideAuthorityProvider | undefined,
): {
  valid: SemanticContentOverrideMap;
  invalid: InvalidSemanticContentOverrideMap;
} => {
  const allowed = new Map<string, Map<string, SemanticContentOverrideEntry>>();
  const invalid = new Map<string, Map<string, string>>();

  for (const issue of validation.issues) {
    if (issue.code !== "semantic_suspicious_content") continue;
    const testCaseId = issue.testCaseId;
    if (testCaseId === undefined) continue;
    const paths = overrides.get(testCaseId);
    if (paths === undefined) continue;
    const entry = paths.get(issue.path);
    if (entry === undefined) continue;
    const category = categoryFromValidationMessage(issue.message);
    if (category === undefined || entry.category !== category) {
      continue;
    }
    const reason = verifyOverrideEntry(
      {
        jobId: validation.jobId,
        testCaseId,
        path: issue.path,
        entry,
      },
      authority,
    );
    if (reason !== null) {
      setInvalidOverrideReason(invalid, testCaseId, issue.path, reason);
      continue;
    }
    setOverrideEntry(allowed, testCaseId, issue.path, entry);
  }

  const sortPathMap = <T>(paths: Map<string, T>): Map<string, T> =>
    new Map([...paths.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const sortOuterMap = <T>(value: Map<string, Map<string, T>>): Map<string, Map<string, T>> =>
    new Map(
      [...value.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([testCaseId, paths]) => [testCaseId, sortPathMap(paths)]),
    );

  return {
    valid: sortOuterMap(allowed),
    invalid: sortOuterMap(invalid),
  };
};
