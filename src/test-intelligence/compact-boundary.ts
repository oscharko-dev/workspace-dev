/**
 * CompactBoundary markers with API-round-aligned compaction
 * (Issue #1787, Story MA-3 #1758).
 *
 * Long-running multi-agent runs accumulate many tool-call rounds that
 * eventually exceed the gateway's context budget. Compaction drops or
 * rewrites earlier rounds while preserving every API invariant that
 * the gateway enforces — most importantly, no `tool_use` may be left
 * without its matching `tool_result`. A dropped region is replaced by
 * a single synthetic {@link CompactBoundaryMessage}, which is itself a
 * canonical-JSON entry chained via `parentHash` to the previous
 * compaction so that any byte-level mutation is detectable offline.
 *
 * Two-tier fall-through, per spec:
 *
 *   1. `cached_microcompact` — the API edits historical `tool_result`
 *      blocks in-place (clearing their content) while keeping their
 *      `tool_use` peers + reasoning visible. Used when the gateway
 *      cache is still warm.
 *
 *   2. `time_based_microcompact` — the cache is already cold, so we
 *      additionally rewrite tool-result content with the closed
 *      sentinel `[Old tool result content cleared]`. Picked by callers
 *      when the cached tier is unavailable.
 *
 * Hard invariants enforced by this module:
 *
 *   - The schema is fixed at v1.0.0; the field set is closed.
 *   - `parentHash` is a 64-char lowercase hex digest; the root
 *     compaction uses {@link COMPACT_BOUNDARY_ROOT_PARENT_HASH}.
 *   - `summaryText` is `<= 1024` chars, refuses LF / CR / U+2028 / U+2029
 *     line-ending smuggling, and is treated as already-redacted by the
 *     caller.
 *   - `droppedRoundIds` and `preservedEvidenceHashes` are sorted +
 *     duplicate-free so canonical-JSON of byte-identical inputs
 *     yields byte-identical bytes — the prerequisite for chain
 *     byte-stability.
 *   - A round whose `evidenceHashes` intersect any protected set
 *     (open validations, open reviewer comments, traceability matrix)
 *     is never dropped: {@link buildCompactBoundary} refuses with a
 *     structured error and the chain is never advanced.
 *   - {@link adjustIndexToPreserveApiInvariants} extends the boundary
 *     forward whenever the candidate position would orphan a
 *     `tool_use` from its `tool_result` in the next round, so AT-032
 *     ("round 12 + its tool_result are kept or compacted together")
 *     is mechanically guaranteed.
 *
 * The module is purely local: no network I/O, no telemetry, no raw
 * prompts, no chain-of-thought, no model logits, no secrets.
 */

import { canonicalJson, sha256Hex } from "./content-hash.js";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

/** Schema version for {@link CompactBoundaryMessage}. */
export const COMPACT_BOUNDARY_SCHEMA_VERSION = "1.0.0" as const;

/**
 * 64-char lowercase hex zero hash used as the `parentHash` of the
 * root compaction. Picking a literal sentinel keeps the verification
 * rule uniform: every entry's `parentHash` is a 64-char lowercase
 * hex digest.
 */
export const COMPACT_BOUNDARY_ROOT_PARENT_HASH: string = "0".repeat(64);

/** Hard cap on `summaryText` length, in UTF-16 code units, per spec. */
export const COMPACT_BOUNDARY_SUMMARY_MAX_CHARS = 1024 as const;

/** Closed list of compaction tiers in fall-through order. */
export const COMPACT_BOUNDARY_TIERS = [
  "cached_microcompact",
  "time_based_microcompact",
] as const;

export type CompactBoundaryTier = (typeof COMPACT_BOUNDARY_TIERS)[number];

/**
 * FinOps event class emitted by the harness when compaction runs.
 * Distinct from `replay_cache_hit` and `gateway_idempotent_replay`.
 * Surfaced as a constant so callers can reference it without the
 * compaction module reaching into the FinOps recorder directly.
 */
export const COMPACT_BOUNDARY_FINOPS_EVENT_CLASS =
  "compact_boundary" as const;

/**
 * Sentinel that replaces tool-result content under the cold-cache
 * `time_based_microcompact` tier. Closed string so canonical-JSON
 * stays byte-stable.
 */
export const COMPACT_BOUNDARY_CLEARED_TOOL_RESULT_SENTINEL =
  "[Old tool result content cleared]" as const;

// ---------------------------------------------------------------------------
// Conversation message model
// ---------------------------------------------------------------------------

export type ConversationMessageRole = "assistant" | "user";

export type ConversationMessageBlockKind =
  | "reasoning"
  | "text"
  | "tool_result"
  | "tool_use";

export interface ConversationMessageTextBlock {
  readonly kind: "reasoning" | "text";
  readonly contentHash: string;
}

export interface ConversationMessageToolUseBlock {
  readonly kind: "tool_use";
  readonly toolUseId: string;
  readonly toolName: string;
  readonly inputHash: string;
}

export interface ConversationMessageToolResultBlock {
  readonly kind: "tool_result";
  readonly toolUseId: string;
  readonly contentHash: string;
  /** True when the content has been replaced with the cold-cache sentinel. */
  readonly cleared: boolean;
}

export type ConversationMessageBlock =
  | ConversationMessageTextBlock
  | ConversationMessageToolResultBlock
  | ConversationMessageToolUseBlock;

export interface ConversationMessage {
  readonly id: string;
  readonly role: ConversationMessageRole;
  readonly blocks: readonly ConversationMessageBlock[];
}

/**
 * One API round groups an `assistant` message with the `user` message
 * that immediately preceded it (which carries `tool_result` blocks for
 * the *previous* round's `tool_use`s). The root round may have
 * `userMessage = null` when the conversation started with the
 * assistant turn (rare, but allowed).
 *
 * `evidenceHashes` is the sorted, duplicate-free union of every
 * content/input hash referenced by the round's blocks — the surface
 * the protected-evidence guard scans.
 */
export interface ApiRound {
  readonly roundId: string;
  readonly userMessage: ConversationMessage | null;
  readonly assistantMessage: ConversationMessage;
  readonly evidenceHashes: readonly string[];
}

// ---------------------------------------------------------------------------
// Compact boundary message
// ---------------------------------------------------------------------------

export interface CompactBoundaryMessage {
  readonly schemaVersion: typeof COMPACT_BOUNDARY_SCHEMA_VERSION;
  readonly jobId: string;
  readonly roleStepId: string;
  readonly droppedRoundIds: readonly string[];
  readonly preservedEvidenceHashes: readonly string[];
  readonly summaryText: string;
  readonly lastSummarizedIndex: number;
  readonly tier: CompactBoundaryTier;
  readonly parentHash: string;
  readonly compactedAt: string;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const HEX_64 = /^[0-9a-f]{64}$/u;
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;
const SUMMARY_FORBIDDEN_CHARS = /[\n\r\u2028\u2029]/u;

const isHex64 = (value: unknown): value is string =>
  typeof value === "string" && HEX_64.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_8601.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isCompactBoundaryTier = (value: unknown): value is CompactBoundaryTier =>
  typeof value === "string" &&
  (COMPACT_BOUNDARY_TIERS as readonly string[]).includes(value);

const assertSortedHex64 = (
  values: readonly string[],
  where: string,
  field: string,
): void => {
  for (const value of values) {
    if (!isHex64(value)) {
      throw new TypeError(
        `${where}: ${field} entries must be 64-char lowercase hex digests`,
      );
    }
  }
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] as string;
    const b = values[i] as string;
    if (a >= b) {
      throw new RangeError(
        `${where}: ${field} must be sorted ascending and duplicate-free`,
      );
    }
  }
};

const assertSortedNonEmpty = (
  values: readonly string[],
  where: string,
  field: string,
): void => {
  for (const value of values) {
    if (!isNonEmptyString(value)) {
      throw new TypeError(
        `${where}: ${field} entries must be non-empty strings`,
      );
    }
  }
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1] as string;
    const b = values[i] as string;
    if (a >= b) {
      throw new RangeError(
        `${where}: ${field} must be sorted ascending and duplicate-free`,
      );
    }
  }
};

/**
 * Throws {@link TypeError} or {@link RangeError} if `boundary` does not
 * satisfy every structural invariant of the schema.
 */
export const assertCompactBoundaryInvariants = (
  boundary: CompactBoundaryMessage,
  where = "assertCompactBoundaryInvariants",
): void => {
  if (
    (boundary.schemaVersion as string) !==
    (COMPACT_BOUNDARY_SCHEMA_VERSION as string)
  ) {
    throw new TypeError(
      `${where}: schemaVersion must equal "${COMPACT_BOUNDARY_SCHEMA_VERSION}"`,
    );
  }
  if (!isNonEmptyString(boundary.jobId)) {
    throw new TypeError(`${where}: jobId must be a non-empty string`);
  }
  if (!isNonEmptyString(boundary.roleStepId)) {
    throw new TypeError(`${where}: roleStepId must be a non-empty string`);
  }
  if (!Array.isArray(boundary.droppedRoundIds)) {
    throw new TypeError(`${where}: droppedRoundIds must be an array`);
  }
  if (boundary.droppedRoundIds.length === 0) {
    throw new RangeError(
      `${where}: droppedRoundIds must contain at least one round id`,
    );
  }
  assertSortedNonEmpty(boundary.droppedRoundIds, where, "droppedRoundIds");
  if (!Array.isArray(boundary.preservedEvidenceHashes)) {
    throw new TypeError(`${where}: preservedEvidenceHashes must be an array`);
  }
  assertSortedHex64(
    boundary.preservedEvidenceHashes,
    where,
    "preservedEvidenceHashes",
  );
  if (typeof boundary.summaryText !== "string") {
    throw new TypeError(`${where}: summaryText must be a string`);
  }
  if (boundary.summaryText.length > COMPACT_BOUNDARY_SUMMARY_MAX_CHARS) {
    throw new RangeError(
      `${where}: summaryText must be <= ${COMPACT_BOUNDARY_SUMMARY_MAX_CHARS} chars (got ${boundary.summaryText.length})`,
    );
  }
  if (SUMMARY_FORBIDDEN_CHARS.test(boundary.summaryText)) {
    throw new RangeError(
      `${where}: summaryText must not contain LF, CR, U+2028, or U+2029`,
    );
  }
  if (!isNonNegativeInteger(boundary.lastSummarizedIndex)) {
    throw new RangeError(
      `${where}: lastSummarizedIndex must be a non-negative integer`,
    );
  }
  if (!isCompactBoundaryTier(boundary.tier)) {
    throw new TypeError(
      `${where}: tier must be one of [${COMPACT_BOUNDARY_TIERS.join(", ")}]`,
    );
  }
  if (!isHex64(boundary.parentHash)) {
    throw new TypeError(
      `${where}: parentHash must be a 64-char lowercase hex digest`,
    );
  }
  if (!isIsoTimestamp(boundary.compactedAt)) {
    throw new TypeError(
      `${where}: compactedAt must be an ISO-8601 timestamp`,
    );
  }
};

// ---------------------------------------------------------------------------
// Round grouping
// ---------------------------------------------------------------------------

const collectRoundEvidenceHashes = (
  ...messages: readonly (ConversationMessage | null)[]
): readonly string[] => {
  const seen = new Set<string>();
  for (const message of messages) {
    if (message === null) continue;
    for (const block of message.blocks) {
      switch (block.kind) {
        case "tool_use":
          if (isHex64(block.inputHash)) seen.add(block.inputHash);
          break;
        case "tool_result":
          if (isHex64(block.contentHash)) seen.add(block.contentHash);
          break;
        case "reasoning":
        case "text":
          if (isHex64(block.contentHash)) seen.add(block.contentHash);
          break;
      }
    }
  }
  return Object.freeze([...seen].sort());
};

/**
 * Group a flat conversation message list into API rounds.
 *
 * A round is `(optional preceding user message, assistant message)`.
 * The function scans messages in order, accumulating user messages
 * until it hits an assistant message, which closes the round. A
 * trailing user message with no following assistant turn is *not*
 * a round (compaction operates on completed rounds only) — callers
 * should treat the dangling user message as the next-round prefix
 * after they apply the compaction.
 *
 * Throws if a `tool_result` references a `toolUseId` that no preceding
 * round emitted; this is a structural error in the conversation, not
 * something compaction should silently absorb.
 */
export const groupMessagesByApiRound = (
  messages: readonly ConversationMessage[],
): readonly ApiRound[] => {
  const where = "groupMessagesByApiRound";
  const rounds: ApiRound[] = [];
  const knownToolUseIds = new Set<string>();

  let pendingUser: ConversationMessage | null = null;

  for (const message of messages) {
    if (
      typeof message.id !== "string" ||
      message.id.length === 0
    ) {
      throw new TypeError(
        `${where}: every message must carry a non-empty id`,
      );
    }

    if (message.role === "user") {
      // Validate every tool_result references a known prior tool_use.
      for (const block of message.blocks) {
        if (
          block.kind === "tool_result" &&
          !knownToolUseIds.has(block.toolUseId)
        ) {
          throw new RangeError(
            `${where}: tool_result references unknown toolUseId "${block.toolUseId}"`,
          );
        }
      }
      if (pendingUser !== null) {
        throw new RangeError(
          `${where}: two consecutive user messages without an intervening assistant turn (ids ${pendingUser.id}, ${message.id})`,
        );
      }
      pendingUser = message;
      continue;
    }

    // assistant message closes a round
    for (const block of message.blocks) {
      if (block.kind === "tool_use") {
        knownToolUseIds.add(block.toolUseId);
      }
    }

    rounds.push({
      roundId: message.id,
      userMessage: pendingUser,
      assistantMessage: message,
      evidenceHashes: collectRoundEvidenceHashes(pendingUser, message),
    });
    pendingUser = null;
  }

  return Object.freeze(rounds);
};

// ---------------------------------------------------------------------------
// API-invariant-preserving boundary adjustment
// ---------------------------------------------------------------------------

const collectToolUseIds = (
  message: ConversationMessage | null,
): readonly string[] => {
  if (message === null) return [];
  const ids: string[] = [];
  for (const block of message.blocks) {
    if (block.kind === "tool_use") ids.push(block.toolUseId);
  }
  return ids;
};

const collectToolResultIds = (
  message: ConversationMessage | null,
): readonly string[] => {
  if (message === null) return [];
  const ids: string[] = [];
  for (const block of message.blocks) {
    if (block.kind === "tool_result") ids.push(block.toolUseId);
  }
  return ids;
};

/**
 * Returns the largest valid `lastSummarizedIndex` such that no
 * `tool_use` in any dropped round (`rounds[0..adjustedIndex]`) has its
 * matching `tool_result` in a surviving round (`rounds[adjustedIndex+1..]`).
 *
 * If the candidate index would orphan a tool_use, the function walks
 * forward to swallow the orphaned tool_result's round, repeating until
 * either every dropped tool_use has its result inside the dropped
 * region or the boundary reaches the end of the conversation.
 *
 * `candidateIndex < 0` returns `-1` (nothing to drop).
 * `candidateIndex >= rounds.length` is clamped to `rounds.length - 1`.
 */
export const adjustIndexToPreserveApiInvariants = (
  rounds: readonly ApiRound[],
  candidateIndex: number,
): number => {
  if (rounds.length === 0) return -1;
  if (candidateIndex < 0) return -1;

  let safeIndex =
    candidateIndex >= rounds.length ? rounds.length - 1 : candidateIndex;

  // For each round in the dropped region, every tool_use it issues
  // must have its tool_result in a round that is also inside the
  // dropped region. We walk forward, extending the boundary, until the
  // condition holds for every dropped round.
  // Linear bound: we never revisit rounds; worst case extends to the
  // last round in the conversation.
  for (;;) {
    let extended = false;
    for (let i = 0; i <= safeIndex; i++) {
      const round = rounds[i];
      if (round === undefined) continue;
      const issuedIds = collectToolUseIds(round.assistantMessage);
      if (issuedIds.length === 0) continue;
      for (const toolUseId of issuedIds) {
        // Search for the matching tool_result. Tool results live in
        // the *next* round's user message in well-formed
        // conversations, but we scan forward defensively.
        let matchIndex = -1;
        for (let j = i + 1; j < rounds.length; j++) {
          const candidateRound = rounds[j];
          if (candidateRound === undefined) continue;
          const resultIds = collectToolResultIds(candidateRound.userMessage);
          if (resultIds.includes(toolUseId)) {
            matchIndex = j;
            break;
          }
        }
        if (matchIndex === -1) {
          // No matching tool_result anywhere — the conversation is
          // either still in flight (pending tool execution) or
          // structurally malformed. Either way, dropping the round
          // would not orphan a *surviving* result, so we let the
          // boundary stand here. The producer is responsible for
          // matching tool_use+result before requesting compaction.
          continue;
        }
        if (matchIndex > safeIndex) {
          safeIndex = matchIndex;
          extended = true;
        }
      }
      if (extended) break;
    }
    if (!extended) break;
  }

  if (safeIndex >= rounds.length) safeIndex = rounds.length - 1;
  return safeIndex;
};

// ---------------------------------------------------------------------------
// Protected-evidence guard
// ---------------------------------------------------------------------------

export interface CompactBoundaryProtectedEvidenceInput {
  /** Evidence hashes referenced by an open validation. */
  readonly openValidationEvidenceHashes?: readonly string[];
  /** Evidence hashes referenced by an open reviewer comment. */
  readonly openReviewerCommentEvidenceHashes?: readonly string[];
  /** Evidence hashes anchored in the traceability matrix. */
  readonly traceabilityMatrixEvidenceHashes?: readonly string[];
}

export type CompactBoundaryProtectionCheckResult =
  | {
      readonly ok: true;
      readonly droppedRoundIds: readonly string[];
      readonly preservedEvidenceHashes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "evidence_protection_violated";
      readonly conflictingRoundIds: readonly string[];
      readonly conflictingEvidenceHashes: readonly string[];
    };

const collectProtectedSet = (
  input: CompactBoundaryProtectedEvidenceInput,
): ReadonlySet<string> => {
  const set = new Set<string>();
  for (const source of [
    input.openValidationEvidenceHashes,
    input.openReviewerCommentEvidenceHashes,
    input.traceabilityMatrixEvidenceHashes,
  ]) {
    if (source === undefined) continue;
    for (const value of source) {
      if (isHex64(value)) set.add(value);
    }
  }
  return set;
};

/**
 * Walk every round in the dropped region (`rounds[0..lastSummarizedIndex]`)
 * and refuse if any of its `evidenceHashes` is a member of the
 * protected union (open validations + open reviewer comments +
 * traceability matrix).
 *
 * On success, returns the sorted, duplicate-free `droppedRoundIds`
 * and the sorted, duplicate-free `preservedEvidenceHashes` (the union
 * of evidence hashes from rounds that *survive* the cut, intersected
 * with the protected set — these are the hashes the caller must carry
 * forward in the boundary message so verifiers can re-anchor them).
 */
export const checkCompactBoundaryProtections = (
  rounds: readonly ApiRound[],
  lastSummarizedIndex: number,
  input: CompactBoundaryProtectedEvidenceInput = {},
): CompactBoundaryProtectionCheckResult => {
  if (lastSummarizedIndex < 0 || rounds.length === 0) {
    return {
      ok: true,
      droppedRoundIds: Object.freeze([]),
      preservedEvidenceHashes: Object.freeze([]),
    };
  }

  const upperBound = Math.min(lastSummarizedIndex, rounds.length - 1);
  const protectedSet = collectProtectedSet(input);

  const droppedRoundIds: string[] = [];
  const conflictingRoundIds: string[] = [];
  const conflictingEvidenceHashes = new Set<string>();
  const preservedEvidenceHashes = new Set<string>();

  for (let i = 0; i <= upperBound; i++) {
    const round = rounds[i];
    if (round === undefined) continue;
    droppedRoundIds.push(round.roundId);
    for (const hash of round.evidenceHashes) {
      if (protectedSet.has(hash)) {
        if (!conflictingRoundIds.includes(round.roundId)) {
          conflictingRoundIds.push(round.roundId);
        }
        conflictingEvidenceHashes.add(hash);
      }
    }
  }

  if (conflictingRoundIds.length > 0) {
    return {
      ok: false,
      code: "evidence_protection_violated",
      conflictingRoundIds: Object.freeze([...conflictingRoundIds].sort()),
      conflictingEvidenceHashes: Object.freeze(
        [...conflictingEvidenceHashes].sort(),
      ),
    };
  }

  // Surviving rounds may also reference protected evidence; we carry
  // those forward in `preservedEvidenceHashes` so the boundary entry
  // explicitly anchors what the dropped region would otherwise have
  // attested to. Drops never reference protected evidence (we just
  // refused above), but a survivor that *does* reference protected
  // evidence is exactly the data the verifier wants to see anchored.
  for (let i = upperBound + 1; i < rounds.length; i++) {
    const round = rounds[i];
    if (round === undefined) continue;
    for (const hash of round.evidenceHashes) {
      if (protectedSet.has(hash)) preservedEvidenceHashes.add(hash);
    }
  }

  return {
    ok: true,
    droppedRoundIds: Object.freeze([...droppedRoundIds].sort()),
    preservedEvidenceHashes: Object.freeze(
      [...preservedEvidenceHashes].sort(),
    ),
  };
};

// ---------------------------------------------------------------------------
// Boundary builder
// ---------------------------------------------------------------------------

export interface BuildCompactBoundaryInput {
  readonly previous: CompactBoundaryMessage | null;
  readonly jobId: string;
  readonly roleStepId: string;
  readonly rounds: readonly ApiRound[];
  readonly lastSummarizedIndex: number;
  readonly tier: CompactBoundaryTier;
  readonly summaryText: string;
  readonly compactedAt: string;
  readonly protected?: CompactBoundaryProtectedEvidenceInput;
}

export class CompactBoundaryError extends Error {
  public readonly code: "evidence_protection_violated";
  public readonly conflictingRoundIds: readonly string[];
  public readonly conflictingEvidenceHashes: readonly string[];

  public constructor(input: {
    readonly code: "evidence_protection_violated";
    readonly conflictingRoundIds: readonly string[];
    readonly conflictingEvidenceHashes: readonly string[];
    readonly message: string;
  }) {
    super(input.message);
    this.name = "CompactBoundaryError";
    this.code = input.code;
    this.conflictingRoundIds = input.conflictingRoundIds;
    this.conflictingEvidenceHashes = input.conflictingEvidenceHashes;
  }
}

/**
 * Build the next {@link CompactBoundaryMessage} for `rounds[0..lastSummarizedIndex]`.
 *
 * `previous === null` for the root entry; otherwise `parentHash` is
 * derived from the predecessor's canonical-JSON hash. The function
 *
 *   1. Adjusts `lastSummarizedIndex` forward to preserve API
 *      invariants (`adjustIndexToPreserveApiInvariants`),
 *   2. Refuses if any dropped round references protected evidence,
 *   3. Sorts + dedupes `droppedRoundIds` and `preservedEvidenceHashes`,
 *   4. Validates structural invariants before returning.
 */
export const buildCompactBoundary = (
  input: BuildCompactBoundaryInput,
): CompactBoundaryMessage => {
  const where = "buildCompactBoundary";

  if (!isNonEmptyString(input.jobId)) {
    throw new TypeError(`${where}: jobId must be a non-empty string`);
  }
  if (!isNonEmptyString(input.roleStepId)) {
    throw new TypeError(`${where}: roleStepId must be a non-empty string`);
  }
  if (!Array.isArray(input.rounds)) {
    throw new TypeError(`${where}: rounds must be an array`);
  }
  if (input.rounds.length === 0) {
    throw new RangeError(`${where}: rounds must not be empty`);
  }
  if (!Number.isInteger(input.lastSummarizedIndex)) {
    throw new TypeError(`${where}: lastSummarizedIndex must be an integer`);
  }
  if (!isCompactBoundaryTier(input.tier)) {
    throw new TypeError(
      `${where}: tier must be one of [${COMPACT_BOUNDARY_TIERS.join(", ")}]`,
    );
  }
  if (typeof input.summaryText !== "string") {
    throw new TypeError(`${where}: summaryText must be a string`);
  }
  if (input.summaryText.length > COMPACT_BOUNDARY_SUMMARY_MAX_CHARS) {
    throw new RangeError(
      `${where}: summaryText must be <= ${COMPACT_BOUNDARY_SUMMARY_MAX_CHARS} chars (got ${input.summaryText.length})`,
    );
  }
  if (SUMMARY_FORBIDDEN_CHARS.test(input.summaryText)) {
    throw new RangeError(
      `${where}: summaryText must not contain LF, CR, U+2028, or U+2029`,
    );
  }
  if (!isIsoTimestamp(input.compactedAt)) {
    throw new TypeError(
      `${where}: compactedAt must be an ISO-8601 timestamp`,
    );
  }

  const adjustedIndex = adjustIndexToPreserveApiInvariants(
    input.rounds,
    input.lastSummarizedIndex,
  );
  if (adjustedIndex < 0) {
    throw new RangeError(
      `${where}: adjusted lastSummarizedIndex < 0 (nothing to compact)`,
    );
  }

  const protectionCheck = checkCompactBoundaryProtections(
    input.rounds,
    adjustedIndex,
    input.protected ?? {},
  );
  if (!protectionCheck.ok) {
    throw new CompactBoundaryError({
      code: protectionCheck.code,
      conflictingRoundIds: protectionCheck.conflictingRoundIds,
      conflictingEvidenceHashes: protectionCheck.conflictingEvidenceHashes,
      message: `${where}: refused to drop ${protectionCheck.conflictingRoundIds.length} round(s) referencing protected evidence`,
    });
  }

  if (input.previous !== null) {
    assertCompactBoundaryInvariants(input.previous, `${where}: previous`);
    if (input.previous.jobId !== input.jobId) {
      throw new RangeError(
        `${where}: jobId mismatch (previous=${input.previous.jobId}, next=${input.jobId})`,
      );
    }
  }

  const parentHash =
    input.previous === null
      ? COMPACT_BOUNDARY_ROOT_PARENT_HASH
      : computeCompactBoundaryHash(input.previous);

  // The protection check already produced sorted, deduped lists.
  const boundary: CompactBoundaryMessage = {
    schemaVersion: COMPACT_BOUNDARY_SCHEMA_VERSION,
    jobId: input.jobId,
    roleStepId: input.roleStepId,
    droppedRoundIds: protectionCheck.droppedRoundIds,
    preservedEvidenceHashes: protectionCheck.preservedEvidenceHashes,
    summaryText: input.summaryText,
    lastSummarizedIndex: adjustedIndex,
    tier: input.tier,
    parentHash,
    compactedAt: input.compactedAt,
  };

  assertCompactBoundaryInvariants(boundary, where);
  return boundary;
};

// ---------------------------------------------------------------------------
// Hash + chain verification
// ---------------------------------------------------------------------------

/**
 * Returns the sha256 hex digest of the canonical-JSON serialisation of
 * `boundary`. Used both as the predecessor's `parentHash` for the next
 * compaction and as the chain's `headOfChainHash`.
 */
export const computeCompactBoundaryHash = (
  boundary: CompactBoundaryMessage,
): string => sha256Hex(boundary);

/** Diagnostic taxonomy for compact-boundary chain breaks. */
export const COMPACT_BOUNDARY_BREAK_REASONS = [
  "evidence_protection_violated",
  "missing_root",
  "parent_hash_mismatch",
  "schema_invalid",
  "tool_use_orphaned",
] as const;

export type CompactBoundaryBreakReason =
  (typeof COMPACT_BOUNDARY_BREAK_REASONS)[number];

export type VerifyCompactBoundaryChainResult =
  | {
      readonly ok: true;
      readonly headOfChainHash: string;
      readonly chainLength: number;
      readonly compactBoundaryInvariantBreaks: 0;
    }
  | {
      readonly ok: false;
      readonly code: "chain_break";
      readonly firstBreakIndex: number;
      readonly reason: CompactBoundaryBreakReason;
      readonly detail: string;
      readonly compactBoundaryInvariantBreaks: number;
    };

/**
 * Recompute the chain offline. Any byte-level mutation surfaces as
 * `chain_break` at the first affected position; the function never
 * throws on bad input.
 *
 * `compactBoundaryInvariantBreaks` is the CI-gate counter mandated by
 * Issue #1787: a passing chain reports `0`, a failing chain reports
 * the count of detected breaks (`>= 1`).
 */
export const verifyCompactBoundaryChain = (
  boundaries: readonly CompactBoundaryMessage[],
): VerifyCompactBoundaryChainResult => {
  if (boundaries.length === 0) {
    return {
      ok: true,
      headOfChainHash: COMPACT_BOUNDARY_ROOT_PARENT_HASH,
      chainLength: 0,
      compactBoundaryInvariantBreaks: 0,
    };
  }

  let previousHash = COMPACT_BOUNDARY_ROOT_PARENT_HASH;
  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i];
    if (current === undefined) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "schema_invalid",
        detail: `boundary at position ${i} is undefined`,
        compactBoundaryInvariantBreaks: 1,
      };
    }

    try {
      assertCompactBoundaryInvariants(
        current,
        `verifyCompactBoundaryChain[${i}]`,
      );
    } catch (err) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "schema_invalid",
        detail: err instanceof Error ? err.message : String(err),
        compactBoundaryInvariantBreaks: 1,
      };
    }

    if (i === 0) {
      if (current.parentHash !== COMPACT_BOUNDARY_ROOT_PARENT_HASH) {
        return {
          ok: false,
          code: "chain_break",
          firstBreakIndex: 0,
          reason: "missing_root",
          detail:
            "root compaction must reference the zero-hash sentinel as parentHash",
          compactBoundaryInvariantBreaks: 1,
        };
      }
    } else if (current.parentHash !== previousHash) {
      return {
        ok: false,
        code: "chain_break",
        firstBreakIndex: i,
        reason: "parent_hash_mismatch",
        detail: `parentHash mismatch at index ${i}: expected ${previousHash}, found ${current.parentHash}`,
        compactBoundaryInvariantBreaks: 1,
      };
    }

    previousHash = computeCompactBoundaryHash(current);
  }

  return {
    ok: true,
    headOfChainHash: previousHash,
    chainLength: boundaries.length,
    compactBoundaryInvariantBreaks: 0,
  };
};

// ---------------------------------------------------------------------------
// Conversation rewriting helpers
// ---------------------------------------------------------------------------

/**
 * Result of replacing the dropped region with a synthetic
 * `<compact_summary>` block. `survivingRounds` retains the original
 * ordering; if the active tier is `time_based_microcompact`, every
 * surviving `tool_result` whose `toolUseId` was issued by a *dropped*
 * round has its `contentHash` left intact but its `cleared` flag
 * flipped to `true` and its content semantically replaced by the
 * cold-cache sentinel at gateway-edit time.
 */
export interface ApplyCompactBoundaryResult {
  readonly compactBoundary: CompactBoundaryMessage;
  readonly survivingRounds: readonly ApiRound[];
}

const clearedToolResultBlock = (
  block: ConversationMessageToolResultBlock,
): ConversationMessageToolResultBlock => ({
  kind: "tool_result",
  toolUseId: block.toolUseId,
  contentHash: block.contentHash,
  cleared: true,
});

const rewriteSurvivingMessage = (
  message: ConversationMessage | null,
  droppedToolUseIds: ReadonlySet<string>,
): ConversationMessage | null => {
  if (message === null) return null;
  let mutated = false;
  const blocks: ConversationMessageBlock[] = [];
  for (const block of message.blocks) {
    if (
      block.kind === "tool_result" &&
      droppedToolUseIds.has(block.toolUseId) &&
      !block.cleared
    ) {
      blocks.push(clearedToolResultBlock(block));
      mutated = true;
      continue;
    }
    blocks.push(block);
  }
  if (!mutated) return message;
  return {
    id: message.id,
    role: message.role,
    blocks: Object.freeze(blocks),
  };
};

/**
 * Apply the compaction described by `boundary` to `rounds`, returning
 * the surviving rounds with `tool_result` blocks for dropped tool_uses
 * cleared in-place when the tier is `time_based_microcompact`. Under
 * `cached_microcompact`, surviving messages are returned unchanged
 * (the gateway clears tool-result content via API edits while the
 * cache is still warm — that path is the caller's responsibility).
 */
export const applyCompactBoundary = (
  rounds: readonly ApiRound[],
  boundary: CompactBoundaryMessage,
): ApplyCompactBoundaryResult => {
  const where = "applyCompactBoundary";
  assertCompactBoundaryInvariants(boundary, where);

  if (boundary.lastSummarizedIndex >= rounds.length) {
    throw new RangeError(
      `${where}: lastSummarizedIndex ${boundary.lastSummarizedIndex} exceeds rounds.length ${rounds.length}`,
    );
  }

  const droppedToolUseIds = new Set<string>();
  for (let i = 0; i <= boundary.lastSummarizedIndex; i++) {
    const round = rounds[i];
    if (round === undefined) continue;
    for (const id of collectToolUseIds(round.assistantMessage)) {
      droppedToolUseIds.add(id);
    }
  }

  const surviving: ApiRound[] = [];
  for (let i = boundary.lastSummarizedIndex + 1; i < rounds.length; i++) {
    const round = rounds[i];
    if (round === undefined) continue;
    if (boundary.tier === "cached_microcompact") {
      surviving.push(round);
      continue;
    }
    const rewrittenUser = rewriteSurvivingMessage(
      round.userMessage,
      droppedToolUseIds,
    );
    if (rewrittenUser === round.userMessage) {
      surviving.push(round);
      continue;
    }
    surviving.push({
      roundId: round.roundId,
      userMessage: rewrittenUser,
      assistantMessage: round.assistantMessage,
      evidenceHashes: round.evidenceHashes,
    });
  }

  return {
    compactBoundary: boundary,
    survivingRounds: Object.freeze(surviving),
  };
};

/**
 * Convenience canonicaliser for the final evidence manifest. Returns
 * `{ headOfChainHash, chainLength, compactBoundaryInvariantBreaks }`
 * for a verified chain; throws if verification fails (callers that
 * want a structured failure should use {@link verifyCompactBoundaryChain}).
 */
export interface CompactBoundaryChainSummary {
  readonly headOfChainHash: string;
  readonly chainLength: number;
  readonly compactBoundaryInvariantBreaks: 0;
}

export const summarizeCompactBoundaryChain = (
  boundaries: readonly CompactBoundaryMessage[],
): CompactBoundaryChainSummary => {
  const result = verifyCompactBoundaryChain(boundaries);
  if (!result.ok) {
    throw new Error(
      `summarizeCompactBoundaryChain: chain_break at ${result.firstBreakIndex} (${result.reason}): ${result.detail}`,
    );
  }
  return {
    headOfChainHash: result.headOfChainHash,
    chainLength: result.chainLength,
    compactBoundaryInvariantBreaks: 0,
  };
};

/**
 * Canonical-JSON byte serialisation of `boundary`, used by callers
 * that persist the compaction alongside other Merkle artifacts.
 */
export const serializeCompactBoundary = (
  boundary: CompactBoundaryMessage,
): string => {
  assertCompactBoundaryInvariants(boundary, "serializeCompactBoundary");
  return canonicalJson(boundary);
};
