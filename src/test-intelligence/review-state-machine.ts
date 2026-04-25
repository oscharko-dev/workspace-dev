/**
 * Review-gate state machine (Issues #1365 / #1376).
 *
 * Pure, side-effect-free transitions between review states. The state
 * machine is shared by the in-process review handler and the file-system
 * review store; both rely on this module for legality checks before
 * persisting an event.
 *
 * Single-reviewer transitions (Wave 1, #1365):
 *
 *   generated      → needs_review            (when policy demands review)
 *   generated      → approved                (when policy auto-approves)
 *   generated      → rejected                (terminal, never re-opened)
 *   needs_review   → approved
 *   needs_review   → rejected
 *   needs_review   → edited
 *   edited         → approved
 *   edited         → rejected
 *   edited         → needs_review            (when an edit re-introduces risk)
 *   approved       → exported                (only via the export pipeline)
 *   approved       → needs_review            (re-open on operator request)
 *   exported       → transferred             (Wave 2 surface; legal here for forward compat)
 *
 * Four-eyes transitions (Wave 2, #1376):
 *
 *   needs_review                  → pending_secondary_approval   (primary_approved)
 *   edited                        → pending_secondary_approval   (primary_approved)
 *   pending_secondary_approval    → approved                     (secondary_approved)
 *   pending_secondary_approval    → rejected
 *   pending_secondary_approval    → edited                       (re-edit after primary)
 *   pending_secondary_approval    → needs_review                 (re-open via review_started)
 *
 * Any other (from, kind) pair is invalid and the transition is rejected
 * fail-closed. The state machine never raises — callers receive a
 * `{ ok: false, code }` object so they can persist a refusal log.
 */

import type {
  ReviewEventKind,
  ReviewState,
  TestCasePolicyDecision,
} from "../contracts/index.js";

export type ReviewTransitionRefusalCode =
  | "transition_not_allowed"
  | "policy_blocks_approval"
  | "policy_requires_review";

export interface ReviewTransitionInputBase {
  from: ReviewState;
  kind: ReviewEventKind;
}

export interface ReviewTransitionInput extends ReviewTransitionInputBase {
  /** Policy decision attached to this case at the moment of transition. */
  policyDecision?: TestCasePolicyDecision;
}

export type ReviewTransitionResult =
  | { ok: true; to: ReviewState }
  | { ok: false; code: ReviewTransitionRefusalCode };

const TRANSITIONS: Record<
  ReviewEventKind,
  Partial<Record<ReviewState, ReviewState>>
> = {
  generated: {
    // Seeding the machine; only legal as the very first event when state is
    // undefined. The store handles the seeding; the state machine accepts a
    // self-loop for idempotency on replay.
    generated: "generated",
  },
  review_started: {
    generated: "needs_review",
    needs_review: "needs_review",
    approved: "needs_review",
    edited: "needs_review",
    pending_secondary_approval: "needs_review",
  },
  approved: {
    generated: "approved",
    needs_review: "approved",
    edited: "approved",
  },
  primary_approved: {
    needs_review: "pending_secondary_approval",
    edited: "pending_secondary_approval",
  },
  secondary_approved: {
    pending_secondary_approval: "approved",
  },
  rejected: {
    generated: "rejected",
    needs_review: "rejected",
    edited: "rejected",
    pending_secondary_approval: "rejected",
  },
  edited: {
    needs_review: "edited",
    edited: "edited",
    approved: "edited",
    pending_secondary_approval: "edited",
  },
  exported: {
    approved: "exported",
  },
  transferred: {
    exported: "transferred",
  },
  note: {
    // Notes do not transition state; legal from any non-terminal state.
    generated: "generated",
    needs_review: "needs_review",
    pending_secondary_approval: "pending_secondary_approval",
    approved: "approved",
    rejected: "rejected",
    edited: "edited",
    exported: "exported",
    transferred: "transferred",
  },
};

/** Compute the destination state for a given (from, kind, policyDecision) triple. */
export const transitionReviewState = (
  input: ReviewTransitionInput,
): ReviewTransitionResult => {
  const map = TRANSITIONS[input.kind];
  const to = map[input.from];
  if (!to) {
    return { ok: false, code: "transition_not_allowed" };
  }

  if (
    (input.kind === "approved" ||
      input.kind === "primary_approved" ||
      input.kind === "secondary_approved") &&
    input.policyDecision === "blocked"
  ) {
    return { ok: false, code: "policy_blocks_approval" };
  }
  if (
    input.kind === "approved" &&
    input.policyDecision === "needs_review" &&
    input.from === "generated"
  ) {
    return { ok: false, code: "policy_requires_review" };
  }

  return { ok: true, to };
};

/**
 * Map a policy decision to the seed review state for a freshly generated
 * case. `approved` policy → `approved` review state (auto-approval);
 * everything else seeds as `needs_review` so the operator must intervene.
 */
export const seedReviewStateFromPolicy = (
  decision: TestCasePolicyDecision,
): ReviewState => {
  if (decision === "approved") return "approved";
  return "needs_review";
};

/** Reverse helper: which event kinds are legal from a given state? */
export const legalEventKindsFrom = (from: ReviewState): ReviewEventKind[] => {
  const kinds: ReviewEventKind[] = [];
  for (const kind of Object.keys(TRANSITIONS) as ReviewEventKind[]) {
    if (TRANSITIONS[kind][from] !== undefined) {
      kinds.push(kind);
    }
  }
  return kinds;
};

/** Whether a state is terminal (no outgoing transition leaves it). */
export const isTerminalReviewState = (state: ReviewState): boolean => {
  return state === "rejected" || state === "transferred";
};
