/**
 * Memdir-style agent-lessons storage (Issue #1789, Story MA-3 #1758).
 *
 * Lessons are append-only Markdown files with hand-parsed YAML
 * frontmatter, persisted under `<runDir>/agent-lessons/`. Mutating an
 * existing lesson (same `name`) requires the new lesson to declare
 * `supersedes: <priorContentHash>` so the chain of edits is auditable.
 *
 * Hard invariants enforced by this module:
 *
 *   - Schema is fixed at v1.0.0; the field set is closed.
 *   - Path validator rejects every traversal shape we have ever seen
 *     (`..`, null bytes, `%2e`, full-width Unicode dots/slashes,
 *     backslashes, absolute paths). Containment is checked twice:
 *     first by `path.resolve` lexically, then by walking the deepest
 *     existing parent and resolving it through `realpath`.
 *   - `scanLessons` reads at most the first 30 lines of each file so
 *     a corrupted lesson cannot exhaust memory.
 *   - `selectRelevantLessons` is deterministic: same inputs → same
 *     ordering, with stable tie-breaks. No randomness, no Date.now().
 *   - `lessonsStorage = "memdir"` is the default; `flat_json` is
 *     deprecated and only retained as a closed enum value so existing
 *     callers can migrate without a hard break.
 *
 * The module does no network I/O, no telemetry, and no dependency on
 * any third-party YAML or markdown library.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

/** Schema version for {@link AgentLessonFrontmatter}. */
export const AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION = "1.0.0" as const;

/** Filename of the per-runDir lessons directory. */
export const AGENT_LESSONS_DIRECTORY = "agent-lessons" as const;

/** File extension for a single lesson record. */
export const AGENT_LESSON_FILE_EXTENSION = ".md" as const;

/** Frontmatter fence used in canonical lesson files. */
export const AGENT_LESSON_FRONTMATTER_FENCE = "---" as const;

/** Maximum lines `scanLessons` reads from a single lesson. */
export const AGENT_LESSON_SCAN_MAX_LINES = 30 as const;

/** Threshold above which a lesson is considered stale. */
export const AGENT_LESSON_FRESHNESS_THRESHOLD_MS: number = 24 * 60 * 60 * 1000;

/** Closed list of allowed lesson kinds. */
export const AGENT_LESSON_TYPES = [
  "feedback",
  "project",
  "reference",
  "regulatory",
  "user",
] as const;

export type AgentLessonType = (typeof AGENT_LESSON_TYPES)[number];

/** Type guard for {@link AgentLessonType}. */
export const isAgentLessonType = (value: unknown): value is AgentLessonType =>
  typeof value === "string" &&
  (AGENT_LESSON_TYPES as readonly string[]).includes(value);

/**
 * Only `reviewer_approved` lessons may be persisted. The reviewer
 * gate runs *before* this module: the only valid value here is the
 * single literal.
 */
export const AGENT_LESSON_REVIEW_STATE_APPROVED = "reviewer_approved" as const;

export type AgentLessonReviewState = typeof AGENT_LESSON_REVIEW_STATE_APPROVED;

/** Closed list of supported lessons-storage backends. */
export const AGENT_LESSON_STORAGE_BACKENDS = ["flat_json", "memdir"] as const;

export type AgentLessonStorageBackend =
  (typeof AGENT_LESSON_STORAGE_BACKENDS)[number];

/** Default backend per Story MA-3. */
export const AGENT_LESSON_STORAGE_DEFAULT: AgentLessonStorageBackend = "memdir";

/** Backends marked deprecated. New code must not select these. */
export const AGENT_LESSON_STORAGE_DEPRECATED_BACKENDS: readonly AgentLessonStorageBackend[] =
  Object.freeze(["flat_json"]);

/** True when `backend` is a deprecated lessons-storage backend. */
export const isAgentLessonStorageDeprecated = (
  backend: AgentLessonStorageBackend,
): boolean => AGENT_LESSON_STORAGE_DEPRECATED_BACKENDS.includes(backend);

/**
 * Closed list of refusal codes returned by
 * {@link validateLessonWritePath} and lesson-write helpers.
 */
export const AGENT_LESSON_REFUSAL_CODES = [
  "lesson_frontmatter_invalid",
  "lesson_path_absolute_refused",
  "lesson_path_backslash_refused",
  "lesson_path_empty_refused",
  "lesson_path_null_byte_refused",
  "lesson_path_outside_root_refused",
  "lesson_path_percent_encoded_refused",
  "lesson_path_symlink_escape_refused",
  "lesson_path_traversal_refused",
  "lesson_path_unicode_traversal_refused",
  "lesson_supersedes_required",
  "lesson_supersedes_unknown_predecessor",
] as const;

export type AgentLessonRefusalCode =
  (typeof AGENT_LESSON_REFUSAL_CODES)[number];

// ---------------------------------------------------------------------------
// Frontmatter shape
// ---------------------------------------------------------------------------

export interface AgentLessonFrontmatter {
  readonly schemaVersion: typeof AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: AgentLessonType;
  readonly policyProfileScope: readonly string[];
  readonly mtimeMs: number;
  readonly supersedes?: string;
  readonly reviewState: AgentLessonReviewState;
  readonly approvedBy: readonly string[];
  readonly contentHash: string;
}

/** Lesson record as returned by {@link scanLessons}. */
export interface AgentLessonRecord {
  readonly frontmatter: AgentLessonFrontmatter;
  readonly bodyPreviewLines: readonly string[];
  readonly bodyTruncated: boolean;
  readonly filePath: string;
  readonly freshnessNote?: string;
}

// ---------------------------------------------------------------------------
// Validators (frontmatter)
// ---------------------------------------------------------------------------

const HEX_64 = /^[0-9a-f]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._-]+$/u;
const NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;

const isHex64 = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const dedupSortedStrings = (
  values: readonly string[],
  where: string,
  field: string,
): readonly string[] => {
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(
        `${where}: ${field} entries must be non-empty strings`,
      );
    }
  }
  const sorted = [...values].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1]) {
      throw new RangeError(
        `${where}: duplicate ${field} entry "${sorted[i] ?? ""}"`,
      );
    }
  }
  return Object.freeze(sorted);
};

/**
 * Throws `TypeError` or `RangeError` if `frontmatter` does not satisfy
 * every structural invariant of the schema. Callers in the read path
 * use this defensively before trusting any on-disk frontmatter.
 */
export const assertAgentLessonFrontmatterInvariants = (
  frontmatter: AgentLessonFrontmatter,
  where = "assertAgentLessonFrontmatterInvariants",
): void => {
  if (
    (frontmatter.schemaVersion as string) !==
    (AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION as string)
  ) {
    throw new TypeError(
      `${where}: schemaVersion must equal "${AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION}"`,
    );
  }
  if (!isNonEmptyString(frontmatter.id) || !ID_PATTERN.test(frontmatter.id)) {
    throw new TypeError(
      `${where}: id must be a non-empty string matching ${ID_PATTERN.source}`,
    );
  }
  if (
    !isNonEmptyString(frontmatter.name) ||
    !NAME_PATTERN.test(frontmatter.name)
  ) {
    throw new TypeError(
      `${where}: name must be a non-empty string matching ${NAME_PATTERN.source}`,
    );
  }
  if (typeof frontmatter.description !== "string") {
    throw new TypeError(`${where}: description must be a string`);
  }
  if (!isAgentLessonType(frontmatter.type)) {
    throw new TypeError(
      `${where}: type must be one of [${AGENT_LESSON_TYPES.join(", ")}]`,
    );
  }
  if (!Array.isArray(frontmatter.policyProfileScope)) {
    throw new TypeError(`${where}: policyProfileScope must be an array`);
  }
  const dedupedScope = dedupSortedStrings(
    frontmatter.policyProfileScope,
    where,
    "policyProfileScope",
  );
  for (let i = 0; i < frontmatter.policyProfileScope.length; i++) {
    if (frontmatter.policyProfileScope[i] !== dedupedScope[i]) {
      throw new RangeError(
        `${where}: policyProfileScope must be sorted alphabetically and unique`,
      );
    }
  }
  if (!isFiniteNonNegative(frontmatter.mtimeMs)) {
    throw new RangeError(
      `${where}: mtimeMs must be a finite non-negative number`,
    );
  }
  if (
    frontmatter.supersedes !== undefined &&
    !isHex64(frontmatter.supersedes)
  ) {
    throw new TypeError(
      `${where}: supersedes must be a 64-char lowercase hex digest when present`,
    );
  }
  // Defensive widen: callers may hand us untrusted JSON; the literal
  // type would normally fold this comparison.
  if (
    (frontmatter.reviewState as string) !==
    (AGENT_LESSON_REVIEW_STATE_APPROVED as string)
  ) {
    throw new RangeError(
      `${where}: reviewState must equal "${AGENT_LESSON_REVIEW_STATE_APPROVED}"`,
    );
  }
  if (!Array.isArray(frontmatter.approvedBy) || frontmatter.approvedBy.length === 0) {
    throw new RangeError(
      `${where}: approvedBy must be a non-empty array of reviewer ids`,
    );
  }
  const dedupedApprovedBy = dedupSortedStrings(
    frontmatter.approvedBy,
    where,
    "approvedBy",
  );
  for (let i = 0; i < frontmatter.approvedBy.length; i++) {
    if (frontmatter.approvedBy[i] !== dedupedApprovedBy[i]) {
      throw new RangeError(
        `${where}: approvedBy must be sorted alphabetically and unique`,
      );
    }
  }
  if (!isHex64(frontmatter.contentHash)) {
    throw new TypeError(
      `${where}: contentHash must be a 64-char lowercase hex digest`,
    );
  }
};

// ---------------------------------------------------------------------------
// Hand-rolled YAML frontmatter parser/emitter
// ---------------------------------------------------------------------------

/**
 * The parser intentionally accepts only the small subset of YAML 1.1
 * we emit ourselves. Any input we did not produce — flow collections,
 * tags, anchors, multiline scalars, custom indentation — is rejected
 * with a clear error rather than silently coerced.
 */
const QUOTED_DOUBLE = /^"((?:[^"\\]|\\["\\nrt0])*)"$/u;
const QUOTED_SINGLE = /^'((?:[^']|'')*)'$/u;
const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

const decodeDoubleQuoted = (raw: string): string =>
  raw.replace(/\\(["\\nrt0])/gu, (_, esc: string) => {
    switch (esc) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "0":
        return "\0";
      default:
        return esc;
    }
  });

const decodeSingleQuoted = (raw: string): string => raw.replace(/''/gu, "'");

const parseScalar = (raw: string): string | number | boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";
  const dq = QUOTED_DOUBLE.exec(trimmed);
  if (dq) return decodeDoubleQuoted(dq[1] ?? "");
  const sq = QUOTED_SINGLE.exec(trimmed);
  if (sq) return decodeSingleQuoted(sq[1] ?? "");
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/u.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (Number.isFinite(n)) return n;
  }
  if (/^-?\d+\.\d+$/u.test(trimmed)) {
    const n = Number.parseFloat(trimmed);
    if (Number.isFinite(n)) return n;
  }
  return trimmed;
};

const encodeScalar = (value: string | number | boolean): string => {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value.length === 0) return '""';
  if (/^[A-Za-z0-9._:/+-][A-Za-z0-9 ._:/+-]*$/u.test(value) && !/^\s|\s$/u.test(value)) {
    // Plain scalar, but escape leading reserved indicators.
    if (/^[?*&!|>%@`#-]/u.test(value)) {
      return `"${value.replace(/[\\"]/gu, (m) => `\\${m}`)}"`;
    }
    return value;
  }
  return `"${value.replace(/[\\"\n\r\t\0]/gu, (m) => {
    switch (m) {
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      case "\0":
        return "\\0";
      default:
        return `\\${m}`;
    }
  })}"`;
};

type FrontmatterValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];

interface FrontmatterParseResult {
  readonly fields: ReadonlyMap<string, FrontmatterValue>;
  readonly bodyStartLineIndex: number;
}

const splitLines = (text: string): readonly string[] => {
  // Strict: only LF separator. CR not allowed inside frontmatter we
  // emit, so its presence is a tell-tale sign the file was edited
  // by a non-canonical writer; reject up front.
  if (text.includes("\r")) {
    throw new TypeError(
      "agent-lesson frontmatter: CR characters are not allowed (LF-only)",
    );
  }
  return text.split("\n");
};

/**
 * Parse the frontmatter block at the top of `text`. Returns the
 * scalar/array fields plus the (0-based) line index where the body
 * begins. Throws on any structural deviation from the canonical
 * shape we emit.
 */
export const parseAgentLessonFrontmatterBlock = (
  text: string,
): FrontmatterParseResult => {
  const lines = splitLines(text);
  if (lines.length === 0 || lines[0] !== AGENT_LESSON_FRONTMATTER_FENCE) {
    throw new TypeError(
      `agent-lesson frontmatter: expected opening "${AGENT_LESSON_FRONTMATTER_FENCE}" fence on line 1`,
    );
  }
  const fields = new Map<string, FrontmatterValue>();
  let i = 1;
  let closed = false;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line === AGENT_LESSON_FRONTMATTER_FENCE) {
      closed = true;
      i += 1;
      break;
    }
    if (line.length === 0) {
      i += 1;
      continue;
    }
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new TypeError(
        `agent-lesson frontmatter: unexpected indentation at line ${i + 1}`,
      );
    }
    const colonAt = line.indexOf(":");
    if (colonAt < 0) {
      throw new TypeError(
        `agent-lesson frontmatter: missing ":" at line ${i + 1}`,
      );
    }
    const key = line.slice(0, colonAt).trim();
    if (!BARE_KEY.test(key)) {
      throw new TypeError(
        `agent-lesson frontmatter: invalid key "${key}" at line ${i + 1}`,
      );
    }
    if (fields.has(key)) {
      throw new TypeError(
        `agent-lesson frontmatter: duplicate key "${key}" at line ${i + 1}`,
      );
    }
    const remainder = line.slice(colonAt + 1);
    if (remainder.trim().length === 0) {
      // Block sequence: collect lines starting with "  - "
      const items: (string | number | boolean)[] = [];
      i += 1;
      while (i < lines.length) {
        const itemLine = lines[i] ?? "";
        if (itemLine.startsWith("  - ")) {
          items.push(parseScalar(itemLine.slice(4)));
          i += 1;
          continue;
        }
        if (itemLine === "  -") {
          items.push("");
          i += 1;
          continue;
        }
        break;
      }
      fields.set(key, Object.freeze(items));
      continue;
    }
    if (remainder[0] !== " ") {
      throw new TypeError(
        `agent-lesson frontmatter: expected single space after ":" at line ${i + 1}`,
      );
    }
    fields.set(key, parseScalar(remainder.slice(1)));
    i += 1;
  }
  if (!closed) {
    throw new TypeError(
      `agent-lesson frontmatter: missing closing "${AGENT_LESSON_FRONTMATTER_FENCE}" fence`,
    );
  }
  return { fields, bodyStartLineIndex: i };
};

const requireScalar = <T extends string | number | boolean>(
  fields: ReadonlyMap<string, FrontmatterValue>,
  key: string,
  predicate: (value: FrontmatterValue) => value is T,
): T => {
  const value = fields.get(key);
  if (value === undefined) {
    throw new TypeError(`agent-lesson frontmatter: missing field "${key}"`);
  }
  if (!predicate(value)) {
    throw new TypeError(
      `agent-lesson frontmatter: field "${key}" has unexpected type`,
    );
  }
  return value;
};

const isStringValue = (value: FrontmatterValue): value is string =>
  typeof value === "string";
const isNumberValue = (value: FrontmatterValue): value is number =>
  typeof value === "number";
const isStringArray = (
  value: FrontmatterValue,
): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

/**
 * Parse and validate the canonical frontmatter at the top of a lesson
 * file. Returns both the typed frontmatter and the line index where
 * the body begins.
 */
export const parseAgentLessonFrontmatter = (
  text: string,
): { readonly frontmatter: AgentLessonFrontmatter; readonly bodyStartLineIndex: number } => {
  const { fields, bodyStartLineIndex } = parseAgentLessonFrontmatterBlock(text);
  const policyProfileScopeRaw = fields.get("policyProfileScope");
  if (policyProfileScopeRaw === undefined) {
    throw new TypeError(
      `agent-lesson frontmatter: missing field "policyProfileScope"`,
    );
  }
  if (!isStringArray(policyProfileScopeRaw)) {
    throw new TypeError(
      `agent-lesson frontmatter: policyProfileScope must be an array of strings`,
    );
  }
  const approvedByRaw = fields.get("approvedBy");
  if (approvedByRaw === undefined) {
    throw new TypeError(`agent-lesson frontmatter: missing field "approvedBy"`);
  }
  if (!isStringArray(approvedByRaw)) {
    throw new TypeError(
      `agent-lesson frontmatter: approvedBy must be an array of strings`,
    );
  }
  const supersedes = fields.has("supersedes")
    ? requireScalar(fields, "supersedes", isStringValue)
    : undefined;
  const schemaVersion = requireScalar(fields, "schemaVersion", isStringValue);
  if (schemaVersion !== AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION) {
    throw new TypeError(
      `agent-lesson frontmatter: unsupported schemaVersion "${schemaVersion}"`,
    );
  }
  const candidate: AgentLessonFrontmatter = {
    schemaVersion: AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION,
    id: requireScalar(fields, "id", isStringValue),
    name: requireScalar(fields, "name", isStringValue),
    description: requireScalar(fields, "description", isStringValue),
    type: requireScalar(fields, "type", isStringValue) as AgentLessonType,
    policyProfileScope: Object.freeze([...policyProfileScopeRaw]),
    mtimeMs: requireScalar(fields, "mtimeMs", isNumberValue),
    ...(supersedes !== undefined ? { supersedes } : {}),
    reviewState: requireScalar(
      fields,
      "reviewState",
      isStringValue,
    ) as AgentLessonReviewState,
    approvedBy: Object.freeze([...approvedByRaw]),
    contentHash: requireScalar(fields, "contentHash", isStringValue),
  };
  assertAgentLessonFrontmatterInvariants(candidate, "parseAgentLessonFrontmatter");
  return { frontmatter: candidate, bodyStartLineIndex };
};

/** Emit canonical YAML frontmatter for `frontmatter`, fences included. */
export const serializeAgentLessonFrontmatter = (
  frontmatter: AgentLessonFrontmatter,
): string => {
  assertAgentLessonFrontmatterInvariants(
    frontmatter,
    "serializeAgentLessonFrontmatter",
  );
  // Field order is fixed to keep canonical bytes byte-stable across
  // writers. Order matches the spec; missing optional `supersedes` is
  // only emitted when present.
  const fixedOrder: readonly (keyof AgentLessonFrontmatter)[] = [
    "schemaVersion",
    "id",
    "name",
    "description",
    "type",
    "policyProfileScope",
    "mtimeMs",
    "supersedes",
    "reviewState",
    "approvedBy",
    "contentHash",
  ];
  const lines: string[] = [AGENT_LESSON_FRONTMATTER_FENCE];
  for (const key of fixedOrder) {
    const value = frontmatter[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      const arr = value as readonly (string | number | boolean)[];
      if (arr.length === 0) {
        lines.push(`${key}:`);
        continue;
      }
      lines.push(`${key}:`);
      for (const entry of arr) {
        lines.push(`  - ${encodeScalar(entry)}`);
      }
      continue;
    }
    lines.push(`${key}: ${encodeScalar(value as string | number | boolean)}`);
  }
  lines.push(AGENT_LESSON_FRONTMATTER_FENCE);
  lines.push("");
  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/** Successful result of {@link validateLessonWritePath}. */
export interface ValidateLessonWritePathOk {
  readonly ok: true;
  readonly resolvedPath: string;
}

/** Refusal result of {@link validateLessonWritePath}. */
export interface ValidateLessonWritePathRefusal {
  readonly ok: false;
  readonly code: AgentLessonRefusalCode;
  readonly detail: string;
}

export type ValidateLessonWritePathResult =
  | ValidateLessonWritePathOk
  | ValidateLessonWritePathRefusal;

const FULLWIDTH_DOT = "\u{ff0e}";
const FULLWIDTH_SLASH = "\u{ff0f}";

const containsTraversalSegment = (name: string): boolean => {
  const normalized = name.replace(/\\/gu, "/");
  for (const segment of normalized.split("/")) {
    if (segment === ".." || segment === ".") return true;
  }
  return false;
};

const realpathDeepestExisting = async (
  candidate: string,
): Promise<string> => {
  let probe = candidate;
  for (let guard = 0; guard < 4096; guard++) {
    try {
      return await realpath(probe);
    } catch (err) {
      if (
        typeof err !== "object" ||
        err === null ||
        (err as { code?: string }).code !== "ENOENT"
      ) {
        throw err;
      }
    }
    const idx = probe.lastIndexOf(sep);
    if (idx <= 0) {
      // Reached filesystem root or single segment: the realpath of the
      // root is the root itself, so resolving lexically is safe.
      return probe.length === 0 ? sep : probe.slice(0, idx + 1) || sep;
    }
    probe = probe.slice(0, idx);
  }
  throw new Error(
    `realpathDeepestExisting: parent walk exceeded 4096 iterations for "${candidate}"`,
  );
};

const isWithin = (parent: string, child: string): boolean => {
  if (child === parent) return true;
  const parentWithSep = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(parentWithSep);
};

/**
 * Reject any `name` that escapes the lessons directory by traversal
 * (`..`), null bytes, percent-encoded dot, full-width Unicode dot or
 * slash, backslashes, or absolute path. After lexical containment
 * passes, the validator walks the deepest-existing parent through
 * `realpath` so a planted symlink inside an existing subdirectory
 * cannot escape `lessonsDir` either.
 *
 * `lessonsDir` itself must already exist; the validator resolves it
 * through `realpath` once and uses that as the containment anchor.
 */
export const validateLessonWritePath = async (input: {
  readonly lessonsDir: string;
  readonly name: string;
}): Promise<ValidateLessonWritePathResult> => {
  const name = input.name;
  if (typeof name !== "string" || name.length === 0) {
    return {
      ok: false,
      code: "lesson_path_empty_refused",
      detail: "name must be a non-empty string",
    };
  }
  if (name.includes("\0")) {
    return {
      ok: false,
      code: "lesson_path_null_byte_refused",
      detail: "name contains a null byte",
    };
  }
  if (/%2e/iu.test(name)) {
    return {
      ok: false,
      code: "lesson_path_percent_encoded_refused",
      detail: "name contains a percent-encoded dot",
    };
  }
  if (name.includes(FULLWIDTH_DOT) || name.includes(FULLWIDTH_SLASH)) {
    return {
      ok: false,
      code: "lesson_path_unicode_traversal_refused",
      detail: "name contains a full-width Unicode dot or slash",
    };
  }
  if (name.includes("\\")) {
    return {
      ok: false,
      code: "lesson_path_backslash_refused",
      detail: "name contains a backslash",
    };
  }
  if (isAbsolute(name) || /^[A-Za-z]:/u.test(name)) {
    return {
      ok: false,
      code: "lesson_path_absolute_refused",
      detail: "name must be a relative path",
    };
  }
  if (containsTraversalSegment(name)) {
    return {
      ok: false,
      code: "lesson_path_traversal_refused",
      detail: 'name contains a ".." or "." segment',
    };
  }
  const lessonsDirReal = await realpath(input.lessonsDir);
  const lexical = resolve(lessonsDirReal, name);
  if (!isWithin(lessonsDirReal, lexical)) {
    return {
      ok: false,
      code: "lesson_path_outside_root_refused",
      detail: `resolved path "${lexical}" escapes lessonsDir "${lessonsDirReal}"`,
    };
  }
  const realParent = await realpathDeepestExisting(lexical);
  if (!isWithin(lessonsDirReal, realParent)) {
    return {
      ok: false,
      code: "lesson_path_symlink_escape_refused",
      detail: `realpath of deepest existing parent "${realParent}" escapes lessonsDir "${lessonsDirReal}"`,
    };
  }
  return { ok: true, resolvedPath: lexical };
};

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

const sha256HexBytes = (input: string | Uint8Array): string =>
  createHash("sha256").update(input).digest("hex");

const lessonFilename = (id: string): string => {
  if (!ID_PATTERN.test(id)) {
    throw new TypeError(
      `agent-lessons-memdir: id "${id}" contains unsafe characters`,
    );
  }
  return `${id}${AGENT_LESSON_FILE_EXTENSION}`;
};

const lessonsDirPath = (runDir: string): string => {
  if (!isNonEmptyString(runDir)) {
    throw new TypeError(
      "agent-lessons-memdir: runDir must be a non-empty string",
    );
  }
  return join(runDir, AGENT_LESSONS_DIRECTORY);
};

/** Resolve `<runDir>/agent-lessons/`, creating it if needed. */
export const ensureLessonsDir = async (runDir: string): Promise<string> => {
  const dir = lessonsDirPath(runDir);
  await mkdir(dir, { recursive: true });
  return dir;
};

// ---------------------------------------------------------------------------
// scanLessons / freshness
// ---------------------------------------------------------------------------

const readFirstLines = async (
  filePath: string,
  maxLines: number,
): Promise<{ readonly lines: readonly string[]; readonly truncated: boolean }> => {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let collected = "";
    let totalRead = 0;
    while (collected.split("\n").length <= maxLines + 1) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, totalRead);
      if (bytesRead === 0) break;
      totalRead += bytesRead;
      collected += buffer.subarray(0, bytesRead).toString("utf8");
    }
    const allLines = collected.split("\n");
    const truncated = allLines.length > maxLines + 1;
    const lines = allLines.slice(0, maxLines);
    return { lines: Object.freeze(lines), truncated };
  } finally {
    await handle.close();
  }
};

/**
 * Compute a freshness annotation for a lesson based on `mtimeMs`.
 * Returns a short note when the lesson is older than
 * {@link AGENT_LESSON_FRESHNESS_THRESHOLD_MS}, `undefined` otherwise.
 */
export const freshnessNote = (input: {
  readonly mtimeMs: number;
  readonly nowMs: number;
}): string | undefined => {
  if (!Number.isFinite(input.mtimeMs) || !Number.isFinite(input.nowMs)) {
    return undefined;
  }
  const ageMs = input.nowMs - input.mtimeMs;
  if (ageMs < AGENT_LESSON_FRESHNESS_THRESHOLD_MS) return undefined;
  const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
  return `[freshness] lesson is ${ageHours}h old (>24h); reviewer-approved but consider refreshing`;
};

/**
 * Scan every lesson file in `<runDir>/agent-lessons/`, parsing
 * frontmatter and the first {@link AGENT_LESSON_SCAN_MAX_LINES} body
 * lines. Hidden files and dot-prefixed control files (consolidate
 * lock, lock-events directory) are skipped. Returns a manifest
 * sorted alphabetically by id for deterministic ordering.
 */
export const scanLessons = async (input: {
  readonly runDir: string;
  readonly nowMs: number;
}): Promise<readonly AgentLessonRecord[]> => {
  const dir = lessonsDirPath(input.runDir);
  let entries: readonly string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return Object.freeze([]);
    }
    throw err;
  }
  const lessons: AgentLessonRecord[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (!name.endsWith(AGENT_LESSON_FILE_EXTENSION)) continue;
    const filePath = join(dir, name);
    const { lines, truncated } = await readFirstLines(
      filePath,
      AGENT_LESSON_SCAN_MAX_LINES,
    );
    const fenceClose = lines.indexOf(AGENT_LESSON_FRONTMATTER_FENCE, 1);
    if (lines[0] !== AGENT_LESSON_FRONTMATTER_FENCE || fenceClose < 0) {
      throw new TypeError(
        `scanLessons: ${name} has malformed frontmatter (no closing fence in first ${AGENT_LESSON_SCAN_MAX_LINES} lines)`,
      );
    }
    const fmText = `${lines.slice(0, fenceClose + 1).join("\n")}\n`;
    const { frontmatter, bodyStartLineIndex } =
      parseAgentLessonFrontmatter(fmText);
    const bodyPreviewLines = Object.freeze(
      lines.slice(Math.max(bodyStartLineIndex, fenceClose + 1)),
    );
    const note = freshnessNote({
      mtimeMs: frontmatter.mtimeMs,
      nowMs: input.nowMs,
    });
    lessons.push(
      Object.freeze({
        frontmatter,
        bodyPreviewLines,
        bodyTruncated: truncated,
        filePath,
        ...(note !== undefined ? { freshnessNote: note } : {}),
      }),
    );
  }
  lessons.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
  return Object.freeze(lessons);
};

// ---------------------------------------------------------------------------
// selectRelevantLessons (deterministic, Coverage-Planner driven)
// ---------------------------------------------------------------------------

const TOKEN_PATTERN = /[A-Za-z0-9]+/gu;

const tokenize = (text: string): readonly string[] => {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(TOKEN_PATTERN)) {
    if (match[0].length >= 2) out.push(match[0]);
  }
  return Object.freeze(out);
};

/** Query envelope accepted by {@link selectRelevantLessons}. */
export interface SelectRelevantLessonsQuery {
  readonly tokens: readonly string[];
  readonly policyProfileId?: string;
}

/** Inputs for {@link selectRelevantLessons}. */
export interface SelectRelevantLessonsInput {
  readonly query: SelectRelevantLessonsQuery | string;
  readonly manifest: readonly AgentLessonRecord[];
  readonly max?: number;
}

const buildQueryTokens = (
  query: SelectRelevantLessonsQuery | string,
): { readonly tokens: ReadonlySet<string>; readonly policyProfileId?: string } => {
  if (typeof query === "string") {
    return { tokens: new Set(tokenize(query)) };
  }
  const tokens = new Set<string>();
  for (const token of query.tokens) {
    for (const part of tokenize(token)) tokens.add(part);
  }
  return {
    tokens,
    ...(query.policyProfileId !== undefined
      ? { policyProfileId: query.policyProfileId }
      : {}),
  };
};

const lessonTokenSet = (record: AgentLessonRecord): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const part of tokenize(record.frontmatter.name)) set.add(part);
  for (const part of tokenize(record.frontmatter.description)) set.add(part);
  for (const part of tokenize(record.frontmatter.type)) set.add(part);
  for (const part of tokenize(record.frontmatter.id)) set.add(part);
  return set;
};

/**
 * Deterministically rank lessons by overlap with `query.tokens`, with
 * stable tie-breaks: higher Jaccard score → newer mtime → smaller id.
 *
 * When `query.policyProfileId` is set, lessons whose
 * `policyProfileScope` does not include `"*"` and does not list the
 * policy id are excluded.
 */
export const selectRelevantLessons = (
  input: SelectRelevantLessonsInput,
): readonly AgentLessonRecord[] => {
  const max = input.max ?? 5;
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError("selectRelevantLessons: max must be a positive integer");
  }
  const { tokens: queryTokens, policyProfileId } = buildQueryTokens(input.query);
  const scored: {
    readonly record: AgentLessonRecord;
    readonly score: number;
  }[] = [];
  for (const record of input.manifest) {
    if (policyProfileId !== undefined) {
      const scope = record.frontmatter.policyProfileScope;
      if (!scope.includes("*") && !scope.includes(policyProfileId)) continue;
    }
    const lessonTokens = lessonTokenSet(record);
    if (queryTokens.size === 0 || lessonTokens.size === 0) {
      scored.push({ record, score: 0 });
      continue;
    }
    let intersection = 0;
    for (const token of queryTokens) {
      if (lessonTokens.has(token)) intersection += 1;
    }
    const union = queryTokens.size + lessonTokens.size - intersection;
    const score = union === 0 ? 0 : intersection / union;
    scored.push({ record, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.record.frontmatter.mtimeMs !== b.record.frontmatter.mtimeMs) {
      return b.record.frontmatter.mtimeMs - a.record.frontmatter.mtimeMs;
    }
    return a.record.frontmatter.id.localeCompare(b.record.frontmatter.id);
  });
  return Object.freeze(scored.slice(0, max).map((entry) => entry.record));
};

// ---------------------------------------------------------------------------
// writeAgentLesson (atomic, supersedes-required for mutations)
// ---------------------------------------------------------------------------

/** Inputs accepted by {@link writeAgentLesson}. */
export interface WriteAgentLessonInput {
  readonly runDir: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: AgentLessonType;
  readonly policyProfileScope: readonly string[];
  readonly approvedBy: readonly string[];
  readonly body: string;
  readonly nowMs: number;
  readonly supersedes?: string;
}

/** Successful result of {@link writeAgentLesson}. */
export interface WriteAgentLessonOk {
  readonly ok: true;
  readonly filePath: string;
  readonly frontmatter: AgentLessonFrontmatter;
  readonly bytes: Uint8Array;
}

/** Refusal result of {@link writeAgentLesson}. */
export interface WriteAgentLessonRefusal {
  readonly ok: false;
  readonly code: AgentLessonRefusalCode;
  readonly detail: string;
}

export type WriteAgentLessonResult =
  | WriteAgentLessonOk
  | WriteAgentLessonRefusal;

/**
 * Persist a lesson atomically.
 *
 * Refuses with `lesson_supersedes_required` if a lesson with the
 * same `name` already exists and the caller did not declare
 * `supersedes`. Refuses with `lesson_supersedes_unknown_predecessor`
 * if `supersedes` does not match the contentHash of any existing
 * lesson with that name.
 */
export const writeAgentLesson = async (
  input: WriteAgentLessonInput,
): Promise<WriteAgentLessonResult> => {
  const dir = await ensureLessonsDir(input.runDir);
  const filename = lessonFilename(input.id);
  const validated = await validateLessonWritePath({
    lessonsDir: dir,
    name: filename,
  });
  if (!validated.ok) return validated;

  const existing = await scanLessons({
    runDir: input.runDir,
    nowMs: input.nowMs,
  });
  const sameName = existing.filter(
    (lesson) => lesson.frontmatter.name === input.name,
  );
  if (sameName.length > 0) {
    if (input.supersedes === undefined) {
      return {
        ok: false,
        code: "lesson_supersedes_required",
        detail: `name "${input.name}" already exists; mutation requires supersedes: <priorContentHash>`,
      };
    }
    const known = new Set(sameName.map((lesson) => lesson.frontmatter.contentHash));
    if (!known.has(input.supersedes)) {
      return {
        ok: false,
        code: "lesson_supersedes_unknown_predecessor",
        detail: `supersedes "${input.supersedes}" does not match any existing contentHash for name "${input.name}"`,
      };
    }
  }

  const contentHash = sha256HexBytes(input.body);
  const policyProfileScope = Object.freeze(
    [...input.policyProfileScope].sort(),
  );
  const approvedBy = Object.freeze([...input.approvedBy].sort());
  const frontmatter: AgentLessonFrontmatter = {
    schemaVersion: AGENT_LESSON_FRONTMATTER_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    description: input.description,
    type: input.type,
    policyProfileScope,
    mtimeMs: input.nowMs,
    ...(input.supersedes !== undefined ? { supersedes: input.supersedes } : {}),
    reviewState: AGENT_LESSON_REVIEW_STATE_APPROVED,
    approvedBy,
    contentHash,
  };
  assertAgentLessonFrontmatterInvariants(frontmatter, "writeAgentLesson");

  const fmText = serializeAgentLessonFrontmatter(frontmatter);
  const body = input.body.endsWith("\n") ? input.body : `${input.body}\n`;
  const serialized = `${fmText}${body}`;
  const bytes = new TextEncoder().encode(serialized);
  const tempPath = `${validated.resolvedPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, validated.resolvedPath);
  return {
    ok: true,
    filePath: validated.resolvedPath,
    frontmatter,
    bytes,
  };
};

/**
 * Read a lesson file completely (frontmatter + body). Used by
 * downstream consumers; `scanLessons` is preferred for listing
 * because it caps memory at the first 30 lines.
 */
export const readAgentLesson = async (
  filePath: string,
): Promise<{
  readonly frontmatter: AgentLessonFrontmatter;
  readonly body: string;
}> => {
  const text = await readFile(filePath, "utf8");
  const { frontmatter, bodyStartLineIndex } =
    parseAgentLessonFrontmatter(text);
  const body = splitLines(text).slice(bodyStartLineIndex).join("\n");
  return { frontmatter, body };
};

/** Returns true when a path is the `<runDir>/agent-lessons/` directory. */
export const getAgentLessonsDir = (runDir: string): string =>
  lessonsDirPath(runDir);

/** Returns the absolute file path of a given lesson `id`. */
export const getAgentLessonPath = (runDir: string, id: string): string =>
  join(lessonsDirPath(runDir), lessonFilename(id));

/** Lightweight existence probe — returns null on ENOENT. */
export const statAgentLesson = async (
  filePath: string,
): Promise<{ readonly mtimeMs: number; readonly size: number } | null> => {
  try {
    const s = await stat(filePath);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw err;
  }
};
