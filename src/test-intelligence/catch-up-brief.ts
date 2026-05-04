/**
 * Catch-Up Brief composer (Issue #1797).
 *
 * When a reviewer is mid-decision and the harness has been idle past
 * `idleThresholdMs`, the runner generates a short brief (1–3 sentences,
 * <= 512 chars) summarizing the events that happened during the idle
 * window. The brief is persisted at `<runDir>/briefs/<ts>.json` and
 * surfaced by the Inspector UI as the "Catch-Up Brief" tab.
 *
 * Two generator modes:
 *
 *   - `"deterministic"` (default) — the production runner composes the
 *     summary directly from event counts and significant-id lists. No
 *     LLM call. Pure function: same inputs ⇒ byte-identical output.
 *   - `"no_tools_llm"` (opt-in) — a no-tools LLM gateway call produces
 *     the summary text. The gateway must refuse any response that
 *     contains tool-call blocks; this module enforces that contract by
 *     re-scanning the candidate summary and falling back to the
 *     deterministic composer if a tool-call shape is detected, the
 *     output is empty, exceeds the length cap, fails the
 *     semantic-content sanitizer, or the generator throws.
 *
 * The brief content runs through `semantic-content-sanitization` before
 * it is ever returned to display callers, so a poisoned tool result
 * cannot surface unsanitized in the UI.
 *
 * Storage layout:
 *
 *   <runDir>/
 *     briefs/
 *       2026-05-04T10-32-43-123Z.json
 *       2026-05-04T10-37-44-456Z.json
 *
 * The directory name is stable; filenames are derived from `generatedAt`
 * with `:` and `.` replaced so they are safe on every supported file
 * system. Files are atomically written (tmp + rename) and end in a
 * single trailing newline, matching the rest of the harness artifact
 * conventions.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256Hex } from "./content-hash.js";
import { detectSuspiciousContent } from "./semantic-content-sanitization.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const CATCH_UP_BRIEF_SCHEMA_VERSION = "1.0.0" as const;

/** Subdirectory under `<runDir>` where briefs are persisted. */
export const CATCH_UP_BRIEF_DIRECTORY = "briefs" as const;

/** Default reviewer-idle window before a brief should be regenerated. */
export const CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS: number = 5 * 60 * 1_000;

/** Hard cap on `summary` length, including the trailing period. */
export const CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH: number = 512;

/** Cap on the number of `significant` ids retained per event group. */
export const CATCH_UP_BRIEF_MAX_SIGNIFICANT_IDS: number = 16;

/** Closed set of event-group kinds covered by a brief. */
export const CATCH_UP_BRIEF_EVENT_KINDS = [
  "judge_panel",
  "gap_finder",
  "ir_mutation",
  "repair",
  "policy",
  "evidence",
] as const;

export type CatchUpBriefEventKind =
  (typeof CATCH_UP_BRIEF_EVENT_KINDS)[number];

/** Closed set of generator modes. */
export const CATCH_UP_BRIEF_GENERATOR_MODES = [
  "deterministic",
  "no_tools_llm",
] as const;

export type CatchUpBriefGeneratorMode =
  (typeof CATCH_UP_BRIEF_GENERATOR_MODES)[number];

export interface CatchUpBriefEventGroup {
  readonly kind: CatchUpBriefEventKind;
  readonly count: number;
  readonly significant: readonly string[];
}

export interface CatchUpBrief {
  readonly schemaVersion: typeof CATCH_UP_BRIEF_SCHEMA_VERSION;
  readonly jobId: string;
  /** 1–3 sentence reviewer summary, <= {@link CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH} chars. */
  readonly summary: string;
  readonly eventsCovered: readonly CatchUpBriefEventGroup[];
  /** Length of the idle window in milliseconds (>= 0). */
  readonly sinceMs: number;
  /** ISO-8601 wall-clock timestamp at which the brief was composed. */
  readonly generatedAt: string;
  readonly generatorMode: CatchUpBriefGeneratorMode;
  /**
   * sha256 of `canonicalJson({jobId, eventsCovered, sinceMs, generatorMode, summary})`.
   * Excludes `generatedAt` so reruns over the same inputs hash identically.
   */
  readonly contentHash: string;
}

// ---------------------------------------------------------------------------
// Trigger predicate
// ---------------------------------------------------------------------------

export interface ShouldGenerateCatchUpBriefInput {
  readonly nowMs: number;
  readonly lastInteractionTimeMs: number;
  readonly idleThresholdMs?: number;
}

/**
 * Pure: returns true when the reviewer-idle gap is strictly greater than
 * the threshold. A non-positive threshold falls back to the default so a
 * caller misconfiguration cannot disable the trigger silently.
 */
export const shouldGenerateCatchUpBrief = (
  input: ShouldGenerateCatchUpBriefInput,
): boolean => {
  if (!Number.isFinite(input.nowMs) || !Number.isFinite(input.lastInteractionTimeMs)) {
    return false;
  }
  const threshold =
    input.idleThresholdMs !== undefined &&
    Number.isFinite(input.idleThresholdMs) &&
    input.idleThresholdMs > 0
      ? input.idleThresholdMs
      : CATCH_UP_BRIEF_DEFAULT_IDLE_THRESHOLD_MS;
  return input.nowMs - input.lastInteractionTimeMs > threshold;
};

// ---------------------------------------------------------------------------
// Source counts → event groups
// ---------------------------------------------------------------------------

export interface CatchUpBriefSourceGroup {
  readonly count: number;
  readonly significant: readonly string[];
}

/**
 * Per-kind counts and significant-id lists that the runner extracts from
 * the on-disk artifacts during the idle window. Every entry is optional
 * so callers can omit kinds with zero activity. Empty groups are dropped
 * by the composer, except for `policy` and `evidence` which the runner
 * reports even with zero counts so reviewers can see "no policy or
 * evidence change in the idle window" explicitly.
 */
export interface CatchUpBriefSourceCounts {
  readonly judge_panel?: CatchUpBriefSourceGroup;
  readonly gap_finder?: CatchUpBriefSourceGroup;
  readonly ir_mutation?: CatchUpBriefSourceGroup;
  readonly repair?: CatchUpBriefSourceGroup;
  readonly policy?: CatchUpBriefSourceGroup;
  readonly evidence?: CatchUpBriefSourceGroup;
}

const sortedDedupeStrings = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    seen.add(value);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
};

const normalizeGroup = (
  kind: CatchUpBriefEventKind,
  group: CatchUpBriefSourceGroup | undefined,
): CatchUpBriefEventGroup | undefined => {
  if (group === undefined) return undefined;
  if (!Number.isInteger(group.count) || group.count < 0) return undefined;
  if (group.count === 0 && group.significant.length === 0) {
    return undefined;
  }
  const significant = sortedDedupeStrings(group.significant).slice(
    0,
    CATCH_UP_BRIEF_MAX_SIGNIFICANT_IDS,
  );
  return { kind, count: group.count, significant };
};

const buildEventGroups = (
  sources: CatchUpBriefSourceCounts,
): readonly CatchUpBriefEventGroup[] => {
  const groups: CatchUpBriefEventGroup[] = [];
  for (const kind of CATCH_UP_BRIEF_EVENT_KINDS) {
    const group = normalizeGroup(kind, sources[kind]);
    if (group !== undefined) groups.push(group);
  }
  return groups;
};

// ---------------------------------------------------------------------------
// Deterministic composer
// ---------------------------------------------------------------------------

const KIND_LABEL: Readonly<Record<CatchUpBriefEventKind, string>> = {
  judge_panel: "judge-panel verdict",
  gap_finder: "gap-finder finding",
  ir_mutation: "IR mutation",
  repair: "repair iteration",
  policy: "policy decision",
  evidence: "evidence event",
};

const pluralize = (count: number, singular: string): string => {
  if (count === 1) return `1 ${singular}`;
  return `${count} ${singular}s`;
};

const ensureTerminator = (sentence: string): string => {
  const trimmed = sentence.trimEnd();
  if (trimmed.length === 0) return trimmed;
  const last = trimmed.slice(-1);
  if (last === "." || last === "!" || last === "?") return trimmed;
  return `${trimmed}.`;
};

const clampSummary = (summary: string): string => {
  if (summary.length <= CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH) return summary;
  // Reserve one char for the trailing ellipsis dot so the summary still
  // ends with a `.` punctuation reviewers can scan.
  const head = summary.slice(0, CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH - 1);
  return `${head}.`;
};

/**
 * Deterministic, allocation-light summary composer. Produces 1–3
 * sentences:
 *
 *   1. Idle-window length and per-kind counts.
 *   2. (optional) Up to 3 significant ids per non-empty kind.
 *   3. (optional) "No new activity in the idle window." if every group
 *      reported zero counts.
 *
 * The output is not user-controlled — every interpolated value is a
 * count or a significant id which itself comes from validated
 * artifacts. We still feed the result through the sanitizer in
 * `composeCatchUpBrief` for defense-in-depth.
 */
export const composeDeterministicSummary = (input: {
  readonly sinceMs: number;
  readonly events: readonly CatchUpBriefEventGroup[];
}): string => {
  const minutes = Math.max(0, Math.round(input.sinceMs / 60_000));
  const idleSentence = ensureTerminator(
    `Idle ${minutes} minute${minutes === 1 ? "" : "s"} since last interaction`,
  );

  if (input.events.length === 0) {
    const empty = `${idleSentence} No new activity in the idle window.`;
    return clampSummary(empty);
  }

  const summaryParts: string[] = [];
  for (const group of input.events) {
    summaryParts.push(pluralize(group.count, KIND_LABEL[group.kind]));
  }
  const countsSentence = ensureTerminator(
    `${idleSentence.replace(/\.$/, "")} — ${summaryParts.join(", ")}`,
  );

  const highlights: string[] = [];
  for (const group of input.events) {
    if (group.significant.length === 0) continue;
    const sample = group.significant.slice(0, 3).join(", ");
    highlights.push(`${KIND_LABEL[group.kind]}: ${sample}`);
  }

  if (highlights.length === 0) {
    return clampSummary(countsSentence);
  }

  const detailSentence = ensureTerminator(`Notable: ${highlights.join("; ")}`);
  return clampSummary(`${countsSentence} ${detailSentence}`);
};

export interface BuildDeterministicCatchUpBriefInput {
  readonly jobId: string;
  readonly sources: CatchUpBriefSourceCounts;
  readonly sinceMs: number;
  readonly generatedAt: string;
}

const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const validateBuildInput = (input: BuildDeterministicCatchUpBriefInput): void => {
  if (typeof input.jobId !== "string" || input.jobId.length === 0) {
    throw new TypeError(
      "buildDeterministicCatchUpBrief: jobId must be a non-empty string",
    );
  }
  if (typeof input.generatedAt !== "string" || !ISO_8601_PATTERN.test(input.generatedAt)) {
    throw new TypeError(
      "buildDeterministicCatchUpBrief: generatedAt must be ISO-8601",
    );
  }
  if (!Number.isFinite(input.sinceMs) || input.sinceMs < 0) {
    throw new TypeError(
      "buildDeterministicCatchUpBrief: sinceMs must be a non-negative finite number",
    );
  }
};

const finalizeBrief = (params: {
  readonly jobId: string;
  readonly summary: string;
  readonly eventsCovered: readonly CatchUpBriefEventGroup[];
  readonly sinceMs: number;
  readonly generatedAt: string;
  readonly generatorMode: CatchUpBriefGeneratorMode;
}): CatchUpBrief => {
  const contentHash = sha256Hex({
    jobId: params.jobId,
    eventsCovered: params.eventsCovered,
    sinceMs: params.sinceMs,
    generatorMode: params.generatorMode,
    summary: params.summary,
  });
  return {
    schemaVersion: CATCH_UP_BRIEF_SCHEMA_VERSION,
    jobId: params.jobId,
    summary: params.summary,
    eventsCovered: params.eventsCovered,
    sinceMs: params.sinceMs,
    generatedAt: params.generatedAt,
    generatorMode: params.generatorMode,
    contentHash,
  };
};

/**
 * Build a deterministic brief from per-kind source counts. Pure;
 * always succeeds for valid input. The returned summary has already
 * been sanitized — no caller-side sanitization is required.
 */
export const buildDeterministicCatchUpBrief = (
  input: BuildDeterministicCatchUpBriefInput,
): CatchUpBrief => {
  validateBuildInput(input);
  const eventsCovered = buildEventGroups(input.sources);
  const summary = composeDeterministicSummary({
    sinceMs: input.sinceMs,
    events: eventsCovered,
  });
  // Defense-in-depth: refuse to emit a deterministic summary that trips
  // the sanitizer. This should be unreachable since the composer only
  // interpolates counts and validated ids, but the assertion is cheap
  // and the failure surface (a poisoned reviewer brief) is high-blast.
  if (detectSuspiciousContent(summary) !== null) {
    throw new Error(
      "buildDeterministicCatchUpBrief: composer produced a sanitizer-flagged summary",
    );
  }
  return finalizeBrief({
    jobId: input.jobId,
    summary,
    eventsCovered,
    sinceMs: input.sinceMs,
    generatedAt: input.generatedAt,
    generatorMode: "deterministic",
  });
};

// ---------------------------------------------------------------------------
// no_tools_llm composer
// ---------------------------------------------------------------------------

/** Refusal codes raised by the no_tools_llm path before falling back. */
export const CATCH_UP_BRIEF_NO_TOOLS_REFUSAL_CODES = [
  "no_tools_llm_tool_call_blocks_present",
  "no_tools_llm_summary_empty",
  "no_tools_llm_summary_too_long",
  "no_tools_llm_suspicious_content",
  "no_tools_llm_generator_error",
  "no_tools_llm_generator_refused",
] as const;

export type CatchUpBriefNoToolsRefusalCode =
  (typeof CATCH_UP_BRIEF_NO_TOOLS_REFUSAL_CODES)[number];

export type CatchUpBriefNoToolsLlmResult =
  | { readonly ok: true; readonly summary: string }
  | { readonly ok: false; readonly code: CatchUpBriefNoToolsRefusalCode };

export type CatchUpBriefNoToolsLlmGenerator = (input: {
  readonly jobId: string;
  readonly events: readonly CatchUpBriefEventGroup[];
  readonly sinceMs: number;
}) =>
  | CatchUpBriefNoToolsLlmResult
  | Promise<CatchUpBriefNoToolsLlmResult>;

/**
 * Tool-call shapes the no_tools_llm gateway must NEVER let through.
 * Catches both Anthropic Claude API JSON `"type":"tool_use"` blocks,
 * Anthropic XML `<function_calls>` / `<invoke>` / `<tool_use>` markup,
 * and OpenAI-style `"tool_calls"` / `"function_call"` JSON shapes.
 *
 * Patterns are case-insensitive and tolerate whitespace inside JSON
 * because gateway responses can be either pretty-printed or compact.
 */
const TOOL_CALL_BLOCK_PATTERNS: readonly RegExp[] = [
  /"type"\s*:\s*"tool_use"/iu,
  /"tool_use_id"\s*:/iu,
  /"tool_calls"\s*:\s*\[/iu,
  /"function_call"\s*:\s*\{/iu,
  /<\s*function_calls\b/iu,
  /<\s*\/?\s*tool_use\b/iu,
  /<\s*invoke\b[^>]*\bname\s*=/iu,
];

/**
 * Returns true when `text` contains any shape that the no-tools gateway
 * is required to refuse. Exposed for tests so the contract is auditable.
 */
export const containsToolCallBlocks = (text: string): boolean => {
  if (typeof text !== "string" || text.length === 0) return false;
  return TOOL_CALL_BLOCK_PATTERNS.some((pattern) => pattern.test(text));
};

const validateNoToolsLlmSummary = (
  raw: string,
): CatchUpBriefNoToolsRefusalCode | undefined => {
  if (containsToolCallBlocks(raw)) {
    return "no_tools_llm_tool_call_blocks_present";
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "no_tools_llm_summary_empty";
  if (trimmed.length > CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH) {
    return "no_tools_llm_summary_too_long";
  }
  if (detectSuspiciousContent(trimmed) !== null) {
    return "no_tools_llm_suspicious_content";
  }
  return undefined;
};

export interface ComposeCatchUpBriefInput
  extends BuildDeterministicCatchUpBriefInput {
  readonly mode?: CatchUpBriefGeneratorMode;
  /**
   * Required when `mode === "no_tools_llm"`. The generator must return a
   * candidate summary or a structured refusal — it must never throw to
   * signal refusal. Throws are caught and treated as
   * `no_tools_llm_generator_error`.
   */
  readonly noToolsLlmGenerator?: CatchUpBriefNoToolsLlmGenerator;
}

export interface ComposeCatchUpBriefResult {
  readonly brief: CatchUpBrief;
  /**
   * When set, the composer requested `no_tools_llm` mode but fell back
   * to deterministic. The code identifies why so the runner can record
   * a structured event and the operator runbook can document the
   * pattern.
   */
  readonly noToolsLlmFallback?: {
    readonly code: CatchUpBriefNoToolsRefusalCode;
    readonly detail?: string;
  };
}

/**
 * Compose a brief in the requested mode, with deterministic fallback.
 *
 * Contract:
 *   - `mode = "deterministic"` (default) → never calls the generator.
 *   - `mode = "no_tools_llm"` → calls the generator, validates the
 *     candidate summary, and returns a `no_tools_llm` brief if it
 *     passes; otherwise falls back to a `deterministic` brief and
 *     reports the refusal code on `noToolsLlmFallback`.
 *
 * The returned brief always has a sanitized summary and a stable
 * `contentHash` over `(jobId, eventsCovered, sinceMs, generatorMode,
 * summary)` — the hash distinguishes a deterministic brief from a
 * no_tools_llm brief with the same source data, which is the desired
 * audit behavior.
 */
export const composeCatchUpBrief = async (
  input: ComposeCatchUpBriefInput,
): Promise<ComposeCatchUpBriefResult> => {
  validateBuildInput(input);
  const eventsCovered = buildEventGroups(input.sources);
  const mode: CatchUpBriefGeneratorMode = input.mode ?? "deterministic";

  const fallback = (
    code: CatchUpBriefNoToolsRefusalCode,
    detail?: string,
  ): ComposeCatchUpBriefResult => {
    const deterministic = buildDeterministicCatchUpBrief({
      jobId: input.jobId,
      sources: input.sources,
      sinceMs: input.sinceMs,
      generatedAt: input.generatedAt,
    });
    return {
      brief: deterministic,
      noToolsLlmFallback: detail !== undefined ? { code, detail } : { code },
    };
  };

  if (mode === "deterministic") {
    return {
      brief: buildDeterministicCatchUpBrief({
        jobId: input.jobId,
        sources: input.sources,
        sinceMs: input.sinceMs,
        generatedAt: input.generatedAt,
      }),
    };
  }

  if (input.noToolsLlmGenerator === undefined) {
    return fallback(
      "no_tools_llm_generator_error",
      "no_tools_llm mode requested without a generator",
    );
  }

  let candidate: CatchUpBriefNoToolsLlmResult;
  try {
    candidate = await input.noToolsLlmGenerator({
      jobId: input.jobId,
      events: eventsCovered,
      sinceMs: input.sinceMs,
    });
  } catch (err) {
    return fallback(
      "no_tools_llm_generator_error",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!candidate.ok) {
    return fallback("no_tools_llm_generator_refused", candidate.code);
  }

  const refusal = validateNoToolsLlmSummary(candidate.summary);
  if (refusal !== undefined) {
    return fallback(refusal);
  }

  const summary = candidate.summary.trim();
  return {
    brief: finalizeBrief({
      jobId: input.jobId,
      summary,
      eventsCovered,
      sinceMs: input.sinceMs,
      generatedAt: input.generatedAt,
      generatorMode: "no_tools_llm",
    }),
  };
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const HEX_64_PATTERN = /^[0-9a-f]{64}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCatchUpBriefEventKind = (
  value: unknown,
): value is CatchUpBriefEventKind =>
  typeof value === "string" &&
  (CATCH_UP_BRIEF_EVENT_KINDS as readonly string[]).includes(value);

const isCatchUpBriefGeneratorMode = (
  value: unknown,
): value is CatchUpBriefGeneratorMode =>
  typeof value === "string" &&
  (CATCH_UP_BRIEF_GENERATOR_MODES as readonly string[]).includes(value);

const isCatchUpBriefEventGroup = (
  value: unknown,
): value is CatchUpBriefEventGroup => {
  if (!isRecord(value)) return false;
  if (!isCatchUpBriefEventKind(value["kind"])) return false;
  if (!Number.isInteger(value["count"])) return false;
  if ((value["count"] as number) < 0) return false;
  const significant = value["significant"];
  if (!Array.isArray(significant)) return false;
  return significant.every((entry) => typeof entry === "string");
};

/** Hand-rolled validator. Returns true when `value` is a valid CatchUpBrief. */
export const isCatchUpBrief = (value: unknown): value is CatchUpBrief => {
  if (!isRecord(value)) return false;
  if (value["schemaVersion"] !== CATCH_UP_BRIEF_SCHEMA_VERSION) return false;
  if (typeof value["jobId"] !== "string" || (value["jobId"]).length === 0) {
    return false;
  }
  const summary = value["summary"];
  if (typeof summary !== "string") return false;
  if (summary.length === 0) return false;
  if (summary.length > CATCH_UP_BRIEF_MAX_SUMMARY_LENGTH) return false;
  const eventsCovered = value["eventsCovered"];
  if (!Array.isArray(eventsCovered)) return false;
  if (!(eventsCovered as readonly unknown[]).every(isCatchUpBriefEventGroup)) {
    return false;
  }
  const sinceMs = value["sinceMs"];
  if (typeof sinceMs !== "number" || !Number.isFinite(sinceMs)) return false;
  if (sinceMs < 0) return false;
  const generatedAt = value["generatedAt"];
  if (typeof generatedAt !== "string" || !ISO_8601_PATTERN.test(generatedAt)) {
    return false;
  }
  if (!isCatchUpBriefGeneratorMode(value["generatorMode"])) return false;
  const contentHash = value["contentHash"];
  if (typeof contentHash !== "string" || !HEX_64_PATTERN.test(contentHash)) {
    return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Filesystem-safe filename derived from a brief's `generatedAt`. ISO
 * `:` and `.` are replaced with `-` so the filename is portable across
 * macOS/Linux/Windows. The trailing `Z` (or `±HH-MM` offset) is
 * preserved so chronological sort matches wall-clock order.
 */
export const catchUpBriefFilename = (generatedAt: string): string => {
  if (typeof generatedAt !== "string" || !ISO_8601_PATTERN.test(generatedAt)) {
    throw new TypeError(
      "catchUpBriefFilename: generatedAt must be ISO-8601",
    );
  }
  const safe = generatedAt.replace(/[:.]/gu, "-");
  return `${safe}.json`;
};

export interface WriteCatchUpBriefInput {
  readonly runDir: string;
  readonly brief: CatchUpBrief;
}

export interface WriteCatchUpBriefResult {
  readonly artifactPath: string;
  readonly serialized: string;
}

/**
 * Atomically write a brief to `<runDir>/briefs/<filename>.json`. Tmp
 * file + rename. Trailing newline. Validates the brief once more so a
 * caller cannot persist a malformed payload (e.g., when integrating
 * with a future generator that bypasses {@link composeCatchUpBrief}).
 */
export const writeCatchUpBrief = async (
  input: WriteCatchUpBriefInput,
): Promise<WriteCatchUpBriefResult> => {
  if (typeof input.runDir !== "string" || input.runDir.length === 0) {
    throw new TypeError(
      "writeCatchUpBrief: runDir must be a non-empty string",
    );
  }
  if (!isCatchUpBrief(input.brief)) {
    throw new TypeError("writeCatchUpBrief: brief failed schema validation");
  }
  const briefsDir = join(input.runDir, CATCH_UP_BRIEF_DIRECTORY);
  await mkdir(briefsDir, { recursive: true });
  const filename = catchUpBriefFilename(input.brief.generatedAt);
  const artifactPath = join(briefsDir, filename);
  const serialized = `${canonicalJson(input.brief)}\n`;
  const tmpPath = `${artifactPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, serialized, "utf8");
  await rename(tmpPath, artifactPath);
  return { artifactPath, serialized };
};

/**
 * Read every brief in `<runDir>/briefs/`. Returns parse errors per
 * file rather than throwing so the inspector bundle can surface partial
 * results — one corrupt brief never hides the rest.
 */
export interface ReadCatchUpBriefsInput {
  readonly runDir: string;
}

export interface CatchUpBriefParseError {
  readonly filename: string;
  readonly reason: "invalid_json" | "schema_mismatch" | "io_error";
  readonly message: string;
}

export interface ReadCatchUpBriefsResult {
  /** Briefs sorted by `generatedAt` ascending (chronological). */
  readonly briefs: readonly CatchUpBrief[];
  readonly parseErrors: readonly CatchUpBriefParseError[];
}

const BRIEF_FILENAME_PATTERN = /^[0-9A-Za-z+-]+\.json$/u;

const isEnoent = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "ENOENT";

export const readCatchUpBriefs = async (
  input: ReadCatchUpBriefsInput,
): Promise<ReadCatchUpBriefsResult> => {
  const briefsDir = join(input.runDir, CATCH_UP_BRIEF_DIRECTORY);
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(briefsDir);
  } catch (err) {
    if (isEnoent(err)) return { briefs: [], parseErrors: [] };
    throw err;
  }
  if (!stats.isDirectory()) return { briefs: [], parseErrors: [] };

  let entries: readonly string[];
  try {
    entries = await readdir(briefsDir);
  } catch (err) {
    if (isEnoent(err)) return { briefs: [], parseErrors: [] };
    throw err;
  }

  const briefs: CatchUpBrief[] = [];
  const parseErrors: CatchUpBriefParseError[] = [];
  for (const filename of entries) {
    if (!BRIEF_FILENAME_PATTERN.test(filename)) continue;
    const filePath = join(briefsDir, filename);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      parseErrors.push({
        filename,
        reason: "io_error",
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseErrors.push({
        filename,
        reason: "invalid_json",
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!isCatchUpBrief(parsed)) {
      parseErrors.push({
        filename,
        reason: "schema_mismatch",
        message: `${filename} did not match the CatchUpBrief schema.`,
      });
      continue;
    }
    briefs.push(parsed);
  }

  briefs.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  parseErrors.sort((a, b) => a.filename.localeCompare(b.filename));
  return { briefs, parseErrors };
};
