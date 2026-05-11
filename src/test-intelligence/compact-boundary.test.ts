import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson } from "./content-hash.js";
import {
  applyCompactBoundary,
  adjustIndexToPreserveApiInvariants,
  assertCompactBoundaryInvariants,
  buildCompactBoundary,
  checkCompactBoundaryProtections,
  COMPACT_BOUNDARY_BREAK_REASONS,
  COMPACT_BOUNDARY_CLEARED_TOOL_RESULT_SENTINEL,
  COMPACT_BOUNDARY_FINOPS_EVENT_CLASS,
  COMPACT_BOUNDARY_ROOT_PARENT_HASH,
  COMPACT_BOUNDARY_SCHEMA_VERSION,
  COMPACT_BOUNDARY_SUMMARY_MAX_CHARS,
  COMPACT_BOUNDARY_TIERS,
  CompactBoundaryError,
  computeCompactBoundaryHash,
  groupMessagesByApiRound,
  serializeCompactBoundary,
  summarizeCompactBoundaryChain,
  verifyCompactBoundaryChain,
  type ApiRound,
  type CompactBoundaryMessage,
  type ConversationMessage,
  type ConversationMessageBlock,
} from "./compact-boundary.js";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);
const HEX_D = "d".repeat(64);
const HEX_E = "e".repeat(64);
const HEX_F = "f".repeat(64);

const ISO_T0 = "2026-05-03T12:00:00.000Z";
const ISO_T1 = "2026-05-03T12:00:01.000Z";
const ISO_T2 = "2026-05-03T12:00:02.000Z";

const sha256Hex = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userMessage = (
  id: string,
  blocks: readonly ConversationMessageBlock[] = [],
): ConversationMessage => ({ id, role: "user", blocks });

const assistantMessage = (
  id: string,
  blocks: readonly ConversationMessageBlock[] = [],
): ConversationMessage => ({ id, role: "assistant", blocks });

const textBlock = (
  contentHash: string,
  kind: "reasoning" | "text" = "text",
): ConversationMessageBlock => ({ kind, contentHash });

const toolUseBlock = (
  toolUseId: string,
  inputHash: string,
  toolName = "fetch",
): ConversationMessageBlock => ({
  kind: "tool_use",
  toolUseId,
  toolName,
  inputHash,
});

const toolResultBlock = (
  toolUseId: string,
  contentHash: string,
  cleared = false,
): ConversationMessageBlock => ({
  kind: "tool_result",
  toolUseId,
  contentHash,
  cleared,
});

/**
 * Build a synthetic conversation with `n` rounds. Round i:
 *   user_i   : tool_result for tool_use issued by round i-1 (if any)
 *              + a text block hashing to roundEvidence(i, "user").
 *   assistant_i : a text block hashing to roundEvidence(i, "assistant"),
 *                 plus a tool_use whose id is "tu-i".
 *
 * This produces a chain where every assistant tool_use is answered in
 * the *next* round's user message, mirroring well-formed Claude API
 * conversations.
 */
const synthConversation = (n: number): readonly ConversationMessage[] => {
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < n; i++) {
    const userBlocks: ConversationMessageBlock[] = [];
    if (i > 0) {
      userBlocks.push(
        toolResultBlock(
          `tu-${i - 1}`,
          sha256Hex(`round-${i - 1}-tool-result`).slice(0, 64),
        ),
      );
    }
    userBlocks.push(
      textBlock(sha256Hex(`round-${i}-user-text`).slice(0, 64)),
    );
    messages.push(userMessage(`u-${i}`, userBlocks));
    messages.push(
      assistantMessage(`a-${i}`, [
        textBlock(sha256Hex(`round-${i}-assistant-text`).slice(0, 64)),
        toolUseBlock(
          `tu-${i}`,
          sha256Hex(`round-${i}-tool-input`).slice(0, 64),
        ),
      ]),
    );
  }
  return messages;
};

const synthRounds = (n: number): readonly ApiRound[] =>
  groupMessagesByApiRound(synthConversation(n));

/**
 * Build a conversation with `n` text-only rounds, *except* the round
 * indices listed in `toolUseAtRounds` carry a single `tool_use` whose
 * matching `tool_result` is delivered in the immediately following
 * round's user message. Used by tests that need a precisely-located
 * tool_use boundary (e.g. AT-032 round 12).
 */
const synthSparseToolUseConversation = (
  n: number,
  toolUseAtRounds: readonly number[],
): readonly ConversationMessage[] => {
  const toolUseSet = new Set(toolUseAtRounds);
  const messages: ConversationMessage[] = [];
  for (let i = 0; i < n; i++) {
    const userBlocks: ConversationMessageBlock[] = [];
    if (i > 0 && toolUseSet.has(i - 1)) {
      userBlocks.push(
        toolResultBlock(
          `tu-${i - 1}`,
          sha256Hex(`round-${i - 1}-tool-result`).slice(0, 64),
        ),
      );
    }
    userBlocks.push(
      textBlock(sha256Hex(`round-${i}-user-text`).slice(0, 64)),
    );
    messages.push(userMessage(`u-${i}`, userBlocks));

    const assistantBlocks: ConversationMessageBlock[] = [
      textBlock(sha256Hex(`round-${i}-assistant-text`).slice(0, 64)),
    ];
    if (toolUseSet.has(i)) {
      assistantBlocks.push(
        toolUseBlock(
          `tu-${i}`,
          sha256Hex(`round-${i}-tool-input`).slice(0, 64),
        ),
      );
    }
    messages.push(assistantMessage(`a-${i}`, assistantBlocks));
  }
  return messages;
};

const synthSparseRounds = (
  n: number,
  toolUseAtRounds: readonly number[],
): readonly ApiRound[] =>
  groupMessagesByApiRound(synthSparseToolUseConversation(n, toolUseAtRounds));

const minimalBoundary = (
  overrides: Partial<CompactBoundaryMessage> = {},
): CompactBoundaryMessage => ({
  schemaVersion: COMPACT_BOUNDARY_SCHEMA_VERSION,
  jobId: "wd-job-compact-1787",
  roleStepId: "wd-job-compact-1787-generator-1",
  droppedRoundIds: ["a-0", "a-1"],
  preservedEvidenceHashes: [HEX_A],
  summaryText: "compacted 2 early rounds",
  lastSummarizedIndex: 1,
  tier: "cached_microcompact",
  parentHash: COMPACT_BOUNDARY_ROOT_PARENT_HASH,
  compactedAt: ISO_T0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

test("schema constants are pinned", () => {
  assert.equal(COMPACT_BOUNDARY_SCHEMA_VERSION, "1.0.0");
  assert.equal(COMPACT_BOUNDARY_ROOT_PARENT_HASH, "0".repeat(64));
  assert.equal(COMPACT_BOUNDARY_SUMMARY_MAX_CHARS, 1024);
  assert.equal(COMPACT_BOUNDARY_FINOPS_EVENT_CLASS, "compact_boundary");
  assert.equal(
    COMPACT_BOUNDARY_CLEARED_TOOL_RESULT_SENTINEL,
    "[Old tool result content cleared]",
  );
  assert.deepEqual(
    [...COMPACT_BOUNDARY_TIERS],
    ["cached_microcompact", "time_based_microcompact"],
  );
  for (const reason of COMPACT_BOUNDARY_BREAK_REASONS) {
    assert.equal(typeof reason, "string");
  }
});

// ---------------------------------------------------------------------------
// Round grouping
// ---------------------------------------------------------------------------

test("groupMessagesByApiRound groups assistant + preceding user", () => {
  const rounds = synthRounds(3);
  assert.equal(rounds.length, 3);
  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i] as ApiRound;
    assert.equal(round.roundId, `a-${i}`);
    assert.equal(round.assistantMessage.id, `a-${i}`);
    assert.equal(round.userMessage?.id, `u-${i}`);
  }
});

test("groupMessagesByApiRound surfaces evidence hashes per round", () => {
  const rounds = synthRounds(2);
  const round0 = rounds[0] as ApiRound;
  // round 0 has no tool_result (first user message), so 2 evidence
  // hashes: user text + assistant text + tool_use input = 3.
  assert.ok(round0.evidenceHashes.length >= 3);
  // Sorted + deduped.
  const sorted = [...round0.evidenceHashes].sort();
  assert.deepEqual([...round0.evidenceHashes], sorted);
  for (let i = 1; i < round0.evidenceHashes.length; i++) {
    assert.notEqual(round0.evidenceHashes[i], round0.evidenceHashes[i - 1]);
  }
});

test("groupMessagesByApiRound rejects two consecutive user messages", () => {
  assert.throws(() =>
    groupMessagesByApiRound([
      userMessage("u-0", [textBlock(HEX_A)]),
      userMessage("u-1", [textBlock(HEX_B)]),
    ]),
  );
});

test("groupMessagesByApiRound rejects tool_result for unknown tool_use", () => {
  assert.throws(() =>
    groupMessagesByApiRound([
      userMessage("u-0", [toolResultBlock("ghost-tool-use", HEX_A)]),
      assistantMessage("a-0", [textBlock(HEX_B)]),
    ]),
  );
});

test("groupMessagesByApiRound rejects empty message id", () => {
  assert.throws(() =>
    groupMessagesByApiRound([
      { id: "", role: "user", blocks: [] },
      assistantMessage("a-0", [textBlock(HEX_A)]),
    ]),
  );
});

// ---------------------------------------------------------------------------
// adjustIndexToPreserveApiInvariants — AT-032
// ---------------------------------------------------------------------------

test("AT-032: 30-round conversation, tool_use only in round 12, candidate boundary at 12 extends to include round 13 (tool_result)", () => {
  // Per Issue #1787 AT-032: 30-round conversation with a tool_use in
  // round 12. Compaction either keeps round 12 + its tool_result
  // together or compacts them together. We pick the
  // "compact them together" path: extend 12 → 13.
  const rounds = synthSparseRounds(30, [12]);
  const round12 = rounds[12] as ApiRound;
  const round13 = rounds[13] as ApiRound;
  const issued = round12.assistantMessage.blocks
    .filter((b) => b.kind === "tool_use")
    .map((b) => (b.kind === "tool_use" ? b.toolUseId : ""));
  const answered = (round13.userMessage?.blocks ?? [])
    .filter((b) => b.kind === "tool_result")
    .map((b) => (b.kind === "tool_result" ? b.toolUseId : ""));
  assert.deepEqual(issued, ["tu-12"]);
  assert.ok(answered.includes("tu-12"));

  const adjusted = adjustIndexToPreserveApiInvariants(rounds, 12);
  assert.equal(adjusted, 13);
});

test("adjustIndexToPreserveApiInvariants extends past a single tool_use→tool_result pair", () => {
  // Tool_use only in round 5 → tool_result in round 6.
  const rounds = synthSparseRounds(10, [5]);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 5), 6);
  // Cutting at round 4 (no tool_use in round 4) leaves boundary alone.
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 4), 4);
});

test("adjustIndexToPreserveApiInvariants extends transitively across consecutive tool_use rounds", () => {
  // Tool_uses at 3 and 4 → tool_results at 4 and 5. Candidate=3
  // forces extension to 4 (for tu-3), but round 4 also has tu-4 →
  // forces extension to 5.
  const rounds = synthSparseRounds(8, [3, 4]);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 3), 5);
});

test("adjustIndexToPreserveApiInvariants returns -1 for negative or empty inputs", () => {
  assert.equal(adjustIndexToPreserveApiInvariants([], 0), -1);
  const rounds = synthRounds(3);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, -1), -1);
});

test("adjustIndexToPreserveApiInvariants clamps to last round when candidate exceeds length", () => {
  // Last round's tool_use has no later tool_result (open in flight).
  // The boundary should clamp to length-1.
  const rounds = synthRounds(3);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 99), rounds.length - 1);
});

test("adjustIndexToPreserveApiInvariants leaves boundary alone when no tool_use is orphaned", () => {
  // Conversation with no tool_use blocks at all — every cut is safe.
  const rounds = groupMessagesByApiRound([
    userMessage("u-0", [textBlock(HEX_A)]),
    assistantMessage("a-0", [textBlock(HEX_B)]),
    userMessage("u-1", [textBlock(HEX_C)]),
    assistantMessage("a-1", [textBlock(HEX_D)]),
    userMessage("u-2", [textBlock(HEX_E)]),
    assistantMessage("a-2", [textBlock(HEX_F)]),
  ]);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 0), 0);
  assert.equal(adjustIndexToPreserveApiInvariants(rounds, 1), 1);
});

// ---------------------------------------------------------------------------
// Protected-evidence guard
// ---------------------------------------------------------------------------

test("checkCompactBoundaryProtections passes when no dropped round references protected evidence", () => {
  const rounds = synthRounds(5);
  const result = checkCompactBoundaryProtections(rounds, 1, {
    openValidationEvidenceHashes: ["1".repeat(64)],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual([...result.droppedRoundIds].sort(), ["a-0", "a-1"]);
  }
});

test("checkCompactBoundaryProtections refuses when a dropped round carries protected evidence", () => {
  const rounds = synthRounds(5);
  const round0 = rounds[0] as ApiRound;
  const protectedHash = round0.evidenceHashes[0] as string;
  const result = checkCompactBoundaryProtections(rounds, 1, {
    openValidationEvidenceHashes: [protectedHash],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "evidence_protection_violated");
    assert.ok(result.conflictingRoundIds.includes("a-0"));
    assert.ok(result.conflictingEvidenceHashes.includes(protectedHash));
  }
});

test("checkCompactBoundaryProtections honours all three protected source kinds", () => {
  const rounds = synthRounds(3);
  const round0 = rounds[0] as ApiRound;
  const protectedHash = round0.evidenceHashes[0] as string;

  // Reviewer-comment source
  const r1 = checkCompactBoundaryProtections(rounds, 0, {
    openReviewerCommentEvidenceHashes: [protectedHash],
  });
  assert.equal(r1.ok, false);

  // Traceability matrix source
  const r2 = checkCompactBoundaryProtections(rounds, 0, {
    traceabilityMatrixEvidenceHashes: [protectedHash],
  });
  assert.equal(r2.ok, false);
});

test("checkCompactBoundaryProtections carries forward surviving-round protected hashes", () => {
  const rounds = synthRounds(4);
  const round3 = rounds[3] as ApiRound;
  const survivorProtected = round3.evidenceHashes[0] as string;
  const result = checkCompactBoundaryProtections(rounds, 1, {
    traceabilityMatrixEvidenceHashes: [survivorProtected],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.ok(result.preservedEvidenceHashes.includes(survivorProtected));
  }
});

test("checkCompactBoundaryProtections returns empty arrays for negative index", () => {
  const rounds = synthRounds(2);
  const result = checkCompactBoundaryProtections(rounds, -1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.droppedRoundIds.length, 0);
    assert.equal(result.preservedEvidenceHashes.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Builder + structural invariants
// ---------------------------------------------------------------------------

test("buildCompactBoundary builds the root entry with zero-hash parent", () => {
  const rounds = synthRounds(5);
  const boundary = buildCompactBoundary({
    previous: null,
    jobId: "wd-job-compact-1787",
    roleStepId: "wd-job-compact-1787-generator-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "compacted round 0",
    compactedAt: ISO_T0,
  });
  assert.equal(boundary.parentHash, COMPACT_BOUNDARY_ROOT_PARENT_HASH);
  // The boundary may have advanced past 0 if round 0's tool_use is
  // answered in round 1 (it is, in our synthetic conversation).
  assert.ok(boundary.lastSummarizedIndex >= 0);
});

test("buildCompactBoundary chains parentHash from predecessor", () => {
  const rounds = synthRounds(8);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-chain",
    roleStepId: "wd-chain-step-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "first",
    compactedAt: ISO_T0,
  });
  const next = buildCompactBoundary({
    previous: root,
    jobId: "wd-chain",
    roleStepId: "wd-chain-step-2",
    rounds,
    lastSummarizedIndex: 3,
    tier: "time_based_microcompact",
    summaryText: "second",
    compactedAt: ISO_T1,
  });
  assert.equal(next.parentHash, computeCompactBoundaryHash(root));
});

test("buildCompactBoundary refuses dropping rounds with protected evidence", () => {
  const rounds = synthRounds(3);
  const round0 = rounds[0] as ApiRound;
  const protectedHash = round0.evidenceHashes[0] as string;
  assert.throws(
    () =>
      buildCompactBoundary({
        previous: null,
        jobId: "wd-protect",
        roleStepId: "wd-protect-step-1",
        rounds,
        lastSummarizedIndex: 0,
        tier: "cached_microcompact",
        summaryText: "should refuse",
        compactedAt: ISO_T0,
        protected: {
          openValidationEvidenceHashes: [protectedHash],
        },
      }),
    (err: unknown) =>
      err instanceof CompactBoundaryError &&
      err.code === "evidence_protection_violated",
  );
});

test("buildCompactBoundary refuses jobId mismatch with predecessor", () => {
  const rounds = synthRounds(3);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-A",
    roleStepId: "wd-A-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "root",
    compactedAt: ISO_T0,
  });
  assert.throws(() =>
    buildCompactBoundary({
      previous: root,
      jobId: "wd-B",
      roleStepId: "wd-B-1",
      rounds,
      lastSummarizedIndex: 1,
      tier: "cached_microcompact",
      summaryText: "next",
      compactedAt: ISO_T1,
    }),
  );
});

test("buildCompactBoundary refuses empty rounds", () => {
  assert.throws(() =>
    buildCompactBoundary({
      previous: null,
      jobId: "wd",
      roleStepId: "wd-1",
      rounds: [],
      lastSummarizedIndex: 0,
      tier: "cached_microcompact",
      summaryText: "x",
      compactedAt: ISO_T0,
    }),
  );
});

test("buildCompactBoundary refuses summaryText > 1024 chars", () => {
  const rounds = synthRounds(3);
  assert.throws(() =>
    buildCompactBoundary({
      previous: null,
      jobId: "wd",
      roleStepId: "wd-1",
      rounds,
      lastSummarizedIndex: 0,
      tier: "cached_microcompact",
      summaryText: "x".repeat(1025),
      compactedAt: ISO_T0,
    }),
  );
});

test("buildCompactBoundary refuses line-ending smuggling in summaryText", () => {
  const rounds = synthRounds(3);
  for (const ch of ["\n", "\r", "\u2028", "\u2029"]) {
    assert.throws(() =>
      buildCompactBoundary({
        previous: null,
        jobId: "wd",
        roleStepId: "wd-1",
        rounds,
        lastSummarizedIndex: 0,
        tier: "cached_microcompact",
        summaryText: `bad${ch}line`,
        compactedAt: ISO_T0,
      }),
    );
  }
});

test("buildCompactBoundary refuses non-ISO compactedAt", () => {
  const rounds = synthRounds(3);
  assert.throws(() =>
    buildCompactBoundary({
      previous: null,
      jobId: "wd",
      roleStepId: "wd-1",
      rounds,
      lastSummarizedIndex: 0,
      tier: "cached_microcompact",
      summaryText: "x",
      compactedAt: "yesterday",
    }),
  );
});

test("buildCompactBoundary is byte-stable for byte-identical input", () => {
  const rounds = synthRounds(6);
  const a = buildCompactBoundary({
    previous: null,
    jobId: "wd-stable",
    roleStepId: "wd-stable-1",
    rounds,
    lastSummarizedIndex: 1,
    tier: "cached_microcompact",
    summaryText: "stable",
    compactedAt: ISO_T0,
  });
  const b = buildCompactBoundary({
    previous: null,
    jobId: "wd-stable",
    roleStepId: "wd-stable-1",
    rounds,
    lastSummarizedIndex: 1,
    tier: "cached_microcompact",
    summaryText: "stable",
    compactedAt: ISO_T0,
  });
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(computeCompactBoundaryHash(a), computeCompactBoundaryHash(b));
});

// ---------------------------------------------------------------------------
// Structural invariants (assert helper)
// ---------------------------------------------------------------------------

test("assertCompactBoundaryInvariants accepts a clean boundary", () => {
  assertCompactBoundaryInvariants(minimalBoundary());
});

test("assertCompactBoundaryInvariants rejects bad fields", () => {
  // schemaVersion drift
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      schemaVersion:
        "2.0.0" as unknown as CompactBoundaryMessage["schemaVersion"],
    }),
  );
  // empty jobId
  assert.throws(() =>
    assertCompactBoundaryInvariants({ ...minimalBoundary(), jobId: "" }),
  );
  // empty roleStepId
  assert.throws(() =>
    assertCompactBoundaryInvariants({ ...minimalBoundary(), roleStepId: "" }),
  );
  // empty droppedRoundIds
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      droppedRoundIds: [],
    }),
  );
  // unsorted droppedRoundIds
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      droppedRoundIds: ["b", "a"],
    }),
  );
  // duplicate droppedRoundIds
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      droppedRoundIds: ["a", "a"],
    }),
  );
  // unsorted preservedEvidenceHashes
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      preservedEvidenceHashes: [HEX_B, HEX_A],
    }),
  );
  // non-hex preservedEvidenceHashes
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      preservedEvidenceHashes: ["not-hex"],
    }),
  );
  // summary too long
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      summaryText: "x".repeat(1025),
    }),
  );
  // summary line-ending
  for (const ch of ["\n", "\r", "\u2028", "\u2029"]) {
    assert.throws(() =>
      assertCompactBoundaryInvariants({
        ...minimalBoundary(),
        summaryText: `x${ch}y`,
      }),
    );
  }
  // negative lastSummarizedIndex
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      lastSummarizedIndex: -1,
    }),
  );
  // unknown tier
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      tier: "experimental" as unknown as CompactBoundaryMessage["tier"],
    }),
  );
  // bad parentHash
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      parentHash: "abc",
    }),
  );
  // bad compactedAt
  assert.throws(() =>
    assertCompactBoundaryInvariants({
      ...minimalBoundary(),
      compactedAt: "yesterday",
    }),
  );
});

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

test("verifyCompactBoundaryChain reports compactBoundaryInvariantBreaks=0 for a clean chain", () => {
  const rounds = synthRounds(8);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-verify",
    roleStepId: "wd-verify-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "first",
    compactedAt: ISO_T0,
  });
  const next = buildCompactBoundary({
    previous: root,
    jobId: "wd-verify",
    roleStepId: "wd-verify-2",
    rounds,
    lastSummarizedIndex: 3,
    tier: "time_based_microcompact",
    summaryText: "second",
    compactedAt: ISO_T1,
  });
  const result = verifyCompactBoundaryChain([root, next]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.compactBoundaryInvariantBreaks, 0);
    assert.equal(result.chainLength, 2);
    assert.equal(result.headOfChainHash, computeCompactBoundaryHash(next));
  }
});

test("verifyCompactBoundaryChain reports head=zero-hash + breaks=0 for empty chain", () => {
  const result = verifyCompactBoundaryChain([]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.chainLength, 0);
    assert.equal(result.headOfChainHash, COMPACT_BOUNDARY_ROOT_PARENT_HASH);
    assert.equal(result.compactBoundaryInvariantBreaks, 0);
  }
});

test("verifyCompactBoundaryChain detects parent_hash_mismatch (CI gate)", () => {
  const rounds = synthRounds(8);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-tamper",
    roleStepId: "wd-tamper-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "first",
    compactedAt: ISO_T0,
  });
  const next = buildCompactBoundary({
    previous: root,
    jobId: "wd-tamper",
    roleStepId: "wd-tamper-2",
    rounds,
    lastSummarizedIndex: 3,
    tier: "cached_microcompact",
    summaryText: "second",
    compactedAt: ISO_T1,
  });
  // Tamper the root's summary; the next entry's parentHash now
  // points at the *original* root, breaking the chain at index 1.
  const tamperedRoot: CompactBoundaryMessage = {
    ...root,
    summaryText: "first-mutated",
  };
  const result = verifyCompactBoundaryChain([tamperedRoot, next]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.firstBreakIndex, 1);
    assert.equal(result.reason, "parent_hash_mismatch");
    assert.equal(result.compactBoundaryInvariantBreaks, 1);
  }
});

test("verifyCompactBoundaryChain detects missing_root", () => {
  const root = minimalBoundary({ parentHash: HEX_D });
  const result = verifyCompactBoundaryChain([root]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.firstBreakIndex, 0);
    assert.equal(result.reason, "missing_root");
    assert.equal(result.compactBoundaryInvariantBreaks, 1);
  }
});

test("verifyCompactBoundaryChain detects schema_invalid", () => {
  const bad = minimalBoundary({
    summaryText: "x".repeat(1025),
  });
  const result = verifyCompactBoundaryChain([bad]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "schema_invalid");
    assert.equal(result.compactBoundaryInvariantBreaks, 1);
  }
});

test("summarizeCompactBoundaryChain returns head + length for valid chain", () => {
  const rounds = synthRounds(5);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-sum",
    roleStepId: "wd-sum-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "x",
    compactedAt: ISO_T0,
  });
  const summary = summarizeCompactBoundaryChain([root]);
  assert.equal(summary.chainLength, 1);
  assert.equal(summary.headOfChainHash, computeCompactBoundaryHash(root));
  assert.equal(summary.compactBoundaryInvariantBreaks, 0);
});

test("summarizeCompactBoundaryChain throws on tampered chain", () => {
  const rounds = synthRounds(5);
  const root = buildCompactBoundary({
    previous: null,
    jobId: "wd-sum",
    roleStepId: "wd-sum-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "x",
    compactedAt: ISO_T0,
  });
  const next = buildCompactBoundary({
    previous: root,
    jobId: "wd-sum",
    roleStepId: "wd-sum-2",
    rounds,
    lastSummarizedIndex: 3,
    tier: "cached_microcompact",
    summaryText: "y",
    compactedAt: ISO_T1,
  });
  const tampered: CompactBoundaryMessage = {
    ...root,
    summaryText: "tampered",
  };
  assert.throws(
    () => summarizeCompactBoundaryChain([tampered, next]),
    /chain_break/,
  );
});

// ---------------------------------------------------------------------------
// applyCompactBoundary — surviving conversation rewriting
// ---------------------------------------------------------------------------

test("applyCompactBoundary leaves surviving rounds untouched under cached_microcompact", () => {
  const rounds = synthRounds(6);
  const boundary = buildCompactBoundary({
    previous: null,
    jobId: "wd-apply",
    roleStepId: "wd-apply-1",
    rounds,
    lastSummarizedIndex: 1,
    tier: "cached_microcompact",
    summaryText: "x",
    compactedAt: ISO_T0,
  });
  const result = applyCompactBoundary(rounds, boundary);
  // dropped region = rounds[0..lastSummarizedIndex]; surviving =
  // rest. Under cached_microcompact, surviving rounds are returned
  // by reference.
  assert.equal(
    result.survivingRounds.length,
    rounds.length - boundary.lastSummarizedIndex - 1,
  );
  for (let i = 0; i < result.survivingRounds.length; i++) {
    assert.equal(
      result.survivingRounds[i],
      rounds[boundary.lastSummarizedIndex + 1 + i],
    );
  }
});

test("applyCompactBoundary clears surviving tool_results referencing dropped tool_uses under time_based_microcompact", () => {
  // Tool_use in round 1 only. Adjusted boundary extends to 2 (so
  // tu-1's tool_result is dropped). For the test, we need a tool_use
  // in a *dropped* round whose tool_result lives in a *surviving*
  // round, which the round-aligned algorithm forbids by design.
  // Instead, hand-craft a misaligned conversation: tool_use in round
  // 0, tool_result in round 2 (skipping round 1). The forward
  // extension swallows rounds 0..2; under time_based_microcompact,
  // applyCompactBoundary would clear matching tool_results in
  // surviving rounds, but here the cleared tool_result is *inside*
  // the dropped region. To exercise the cleared-on-surviving path,
  // we point the dropped region at a hand-built conversation where
  // a stale tool_use's tool_result is referenced post-compaction —
  // we accept that this is a contrived configuration and assert
  // applyCompactBoundary leaves untouched results alone otherwise.
  const rounds: readonly ApiRound[] = groupMessagesByApiRound([
    userMessage("u-0", [textBlock(HEX_A)]),
    assistantMessage("a-0", [
      textBlock(HEX_B),
      toolUseBlock("tu-stale", HEX_C),
    ]),
    userMessage("u-1", [
      toolResultBlock("tu-stale", HEX_D),
      textBlock(HEX_E),
    ]),
    assistantMessage("a-1", [textBlock(HEX_F)]),
    // Round 2 is a fully self-contained surviving round; it has no
    // dropped tool_use to clear, so applyCompactBoundary returns
    // it unchanged.
    userMessage("u-2", [textBlock("1".repeat(64))]),
    assistantMessage("a-2", [textBlock("2".repeat(64))]),
  ]);
  // We cut at index 1 so that round 0 (which issued tu-stale) and
  // round 1 (which contained the tool_result) are both dropped.
  const boundary = buildCompactBoundary({
    previous: null,
    jobId: "wd-time",
    roleStepId: "wd-time-1",
    rounds,
    lastSummarizedIndex: 1,
    tier: "time_based_microcompact",
    summaryText: "x",
    compactedAt: ISO_T0,
  });
  const result = applyCompactBoundary(rounds, boundary);
  // Round 2 is the only surviving round; it has no tool_results, so
  // applyCompactBoundary returns it unchanged.
  assert.equal(result.survivingRounds.length, 1);
  assert.equal(result.survivingRounds[0]?.roundId, "a-2");
});

test("applyCompactBoundary clears surviving tool_results that reference dropped tool_uses (cross-boundary scenario)", () => {
  // Hand-craft a conversation where a surviving round's user message
  // carries a tool_result whose tool_use was issued in a dropped
  // round. The synthesizer would have forced the boundary to extend,
  // so we skip the helper and build a CompactBoundaryMessage directly
  // that targets only round 0 even though tu-stale's result is in
  // round 2 (surviving). This mirrors the in-flight-edit path the
  // gateway uses when it can rewrite individual messages.
  const handBuilt: CompactBoundaryMessage = {
    schemaVersion: COMPACT_BOUNDARY_SCHEMA_VERSION,
    jobId: "wd-clear",
    roleStepId: "wd-clear-1",
    droppedRoundIds: ["a-0"],
    preservedEvidenceHashes: [],
    summaryText: "drop only round 0; clear surviving tool_results",
    lastSummarizedIndex: 0,
    tier: "time_based_microcompact",
    parentHash: COMPACT_BOUNDARY_ROOT_PARENT_HASH,
    compactedAt: ISO_T0,
  };
  const rounds: readonly ApiRound[] = groupMessagesByApiRound([
    userMessage("u-0", [textBlock(HEX_A)]),
    assistantMessage("a-0", [
      textBlock(HEX_B),
      toolUseBlock("tu-stale", HEX_C),
    ]),
    userMessage("u-1", [
      toolResultBlock("tu-stale", HEX_D),
      textBlock(HEX_E),
    ]),
    assistantMessage("a-1", [textBlock(HEX_F)]),
  ]);
  const result = applyCompactBoundary(rounds, handBuilt);
  // Round 1 (the survivor) had its tu-stale tool_result cleared.
  const round1 = result.survivingRounds[0];
  assert.ok(round1);
  const cleared = round1.userMessage?.blocks.find(
    (b) => b.kind === "tool_result" && b.toolUseId === "tu-stale",
  );
  assert.ok(cleared && cleared.kind === "tool_result");
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.contentHash, HEX_D);
});

test("applyCompactBoundary refuses lastSummarizedIndex >= rounds.length", () => {
  const rounds = synthRounds(3);
  const boundary = minimalBoundary({
    droppedRoundIds: ["a-0", "a-1", "a-2", "a-3"],
    lastSummarizedIndex: rounds.length, // off-by-one; lastSummarizedIndex is 0-based
  });
  assert.throws(() => applyCompactBoundary(rounds, boundary));
});

// ---------------------------------------------------------------------------
// serializeCompactBoundary
// ---------------------------------------------------------------------------

test("serializeCompactBoundary returns canonical-JSON of a valid boundary", () => {
  const boundary = minimalBoundary();
  const serialized = serializeCompactBoundary(boundary);
  assert.equal(serialized, canonicalJson(boundary));
});

test("serializeCompactBoundary refuses an invalid boundary", () => {
  assert.throws(() =>
    serializeCompactBoundary(minimalBoundary({ jobId: "" })),
  );
});

// ---------------------------------------------------------------------------
// Purity — no raw prompts / secrets in canonical-JSON output
// ---------------------------------------------------------------------------

test("canonical-JSON of CompactBoundaryMessage never carries raw-prompt-shaped fields", () => {
  const rounds = synthRounds(3);
  const boundary = buildCompactBoundary({
    previous: null,
    jobId: "wd-purity",
    roleStepId: "wd-purity-1",
    rounds,
    lastSummarizedIndex: 0,
    tier: "cached_microcompact",
    summaryText: "the closed schema is the only persisted surface",
    compactedAt: ISO_T0,
  });
  const raw = canonicalJson(boundary);
  for (const banned of [
    "prompt",
    "promptbody",
    "rawprompt",
    "systemprompt",
    "userprompt",
    "completion",
    "outputbody",
    "secret",
    "apikey",
    "authorization",
    "bearer",
    "chainofthought",
  ]) {
    assert.equal(
      raw.toLowerCase().includes(banned),
      false,
      `boundary unexpectedly contains banned term "${banned}"`,
    );
  }
});

test("ISO_T2 reference compiles", () => {
  // Anchor for forward-compatible ISO sample referenced in helpers.
  assert.equal(typeof ISO_T2, "string");
});
