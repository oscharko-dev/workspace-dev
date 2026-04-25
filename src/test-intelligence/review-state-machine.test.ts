import assert from "node:assert/strict";
import test from "node:test";
import {
  ALLOWED_REVIEW_EVENT_KINDS,
  ALLOWED_REVIEW_STATES,
} from "../contracts/index.js";
import {
  isTerminalReviewState,
  legalEventKindsFrom,
  seedReviewStateFromPolicy,
  transitionReviewState,
} from "./review-state-machine.js";

test("review-state-machine: seed from policy approved -> approved", () => {
  assert.equal(seedReviewStateFromPolicy("approved"), "approved");
});

test("review-state-machine: seed from policy needs_review -> needs_review", () => {
  assert.equal(seedReviewStateFromPolicy("needs_review"), "needs_review");
});

test("review-state-machine: seed from policy blocked -> needs_review (operator must reject)", () => {
  assert.equal(seedReviewStateFromPolicy("blocked"), "needs_review");
});

test("review-state-machine: needs_review -> approved (no policy block)", () => {
  const r = transitionReviewState({
    from: "needs_review",
    kind: "approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "approved");
});

test("review-state-machine: approved is refused when policy is blocked", () => {
  const r = transitionReviewState({
    from: "needs_review",
    kind: "approved",
    policyDecision: "blocked",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "policy_blocks_approval");
});

test("review-state-machine: approve from `generated` is refused when policy says needs_review", () => {
  const r = transitionReviewState({
    from: "generated",
    kind: "approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, false);
});

test("review-state-machine: rejected is terminal", () => {
  assert.equal(isTerminalReviewState("rejected"), true);
  const r = transitionReviewState({
    from: "rejected",
    kind: "approved",
    policyDecision: "approved",
  });
  assert.equal(r.ok, false);
});

test("review-state-machine: transferred is terminal", () => {
  assert.equal(isTerminalReviewState("transferred"), true);
});

test("review-state-machine: only approved -> exported", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    const r = transitionReviewState({
      from,
      kind: "exported",
    });
    if (from === "approved") {
      assert.equal(r.ok, true);
    } else {
      assert.equal(r.ok, false);
    }
  }
});

test("review-state-machine: only exported -> transferred", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    const r = transitionReviewState({
      from,
      kind: "transferred",
    });
    if (from === "exported") {
      assert.equal(r.ok, true);
    } else {
      assert.equal(r.ok, false);
    }
  }
});

test("review-state-machine: edited can come from needs_review or approved", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    const r = transitionReviewState({
      from,
      kind: "edited",
    });
    if (from === "needs_review" || from === "approved" || from === "edited") {
      assert.equal(r.ok, true);
    } else {
      assert.equal(r.ok, false);
    }
  }
});

test("review-state-machine: legal event kinds from generated include approved/rejected/review_started/note", () => {
  const kinds = new Set(legalEventKindsFrom("generated"));
  assert.equal(kinds.has("approved"), true);
  assert.equal(kinds.has("rejected"), true);
  assert.equal(kinds.has("review_started"), true);
  assert.equal(kinds.has("note"), true);
});

test("review-state-machine: every event kind is exposed via legalEventKindsFrom for at least one state", () => {
  const seen = new Set<string>();
  for (const from of ALLOWED_REVIEW_STATES) {
    for (const kind of legalEventKindsFrom(from)) {
      seen.add(kind);
    }
  }
  for (const kind of ALLOWED_REVIEW_EVENT_KINDS) {
    assert.equal(
      seen.has(kind),
      true,
      `kind ${kind} should be reachable from at least one state`,
    );
  }
});

test("review-state-machine: note never changes state", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    const r = transitionReviewState({ from, kind: "note" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.to, from);
  }
});
