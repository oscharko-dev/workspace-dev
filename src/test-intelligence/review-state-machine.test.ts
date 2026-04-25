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

test("review-state-machine: edited can come from needs_review, approved, edited, or pending_secondary_approval", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    const r = transitionReviewState({
      from,
      kind: "edited",
    });
    if (
      from === "needs_review" ||
      from === "approved" ||
      from === "edited" ||
      from === "pending_secondary_approval"
    ) {
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

test("review-state-machine: primary_approved transitions needs_review → pending_secondary_approval", () => {
  const r = transitionReviewState({
    from: "needs_review",
    kind: "primary_approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "pending_secondary_approval");
});

test("review-state-machine: primary_approved transitions edited → pending_secondary_approval", () => {
  const r = transitionReviewState({
    from: "edited",
    kind: "primary_approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "pending_secondary_approval");
});

test("review-state-machine: primary_approved is refused from generated", () => {
  const r = transitionReviewState({
    from: "generated",
    kind: "primary_approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, false);
});

test("review-state-machine: primary_approved is refused from approved", () => {
  const r = transitionReviewState({
    from: "approved",
    kind: "primary_approved",
    policyDecision: "approved",
  });
  assert.equal(r.ok, false);
});

test("review-state-machine: secondary_approved transitions pending_secondary_approval → approved", () => {
  const r = transitionReviewState({
    from: "pending_secondary_approval",
    kind: "secondary_approved",
    policyDecision: "needs_review",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "approved");
});

test("review-state-machine: secondary_approved is refused from any non-pending state", () => {
  for (const from of ALLOWED_REVIEW_STATES) {
    if (from === "pending_secondary_approval") continue;
    const r = transitionReviewState({
      from,
      kind: "secondary_approved",
      policyDecision: "needs_review",
    });
    assert.equal(
      r.ok,
      false,
      `secondary_approved from ${from} must be refused`,
    );
  }
});

test("review-state-machine: primary_approved is blocked when policy is blocked", () => {
  const r = transitionReviewState({
    from: "needs_review",
    kind: "primary_approved",
    policyDecision: "blocked",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "policy_blocks_approval");
});

test("review-state-machine: secondary_approved is blocked when policy is blocked", () => {
  const r = transitionReviewState({
    from: "pending_secondary_approval",
    kind: "secondary_approved",
    policyDecision: "blocked",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "policy_blocks_approval");
});

test("review-state-machine: pending_secondary_approval is non-terminal and reachable from edited/needs_review", () => {
  assert.equal(isTerminalReviewState("pending_secondary_approval"), false);
  const fromNeeds = transitionReviewState({
    from: "needs_review",
    kind: "primary_approved",
    policyDecision: "needs_review",
  });
  assert.equal(fromNeeds.ok, true);
});

test("review-state-machine: pending_secondary_approval can be rejected", () => {
  const r = transitionReviewState({
    from: "pending_secondary_approval",
    kind: "rejected",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "rejected");
});

test("review-state-machine: pending_secondary_approval can be re-edited", () => {
  const r = transitionReviewState({
    from: "pending_secondary_approval",
    kind: "edited",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "edited");
});

test("review-state-machine: pending_secondary_approval supports notes", () => {
  const r = transitionReviewState({
    from: "pending_secondary_approval",
    kind: "note",
  });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.to, "pending_secondary_approval");
});
