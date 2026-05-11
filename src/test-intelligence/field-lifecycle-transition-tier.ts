/**
 * Field-lifecycle transition tier classifier (Issue #2168).
 *
 * The Issue #2111 state-machine validator declares the canonical six-state
 * field lifecycle (`initial → focused → in_progress → validated | error →
 * terminal`) and demanded full per-field coverage. On generated suites with
 * 10–100 cases the LLM does not exercise every transition for every field,
 * so the validator emitted 30–139 `uncovered_field_lifecycle_transition`
 * errors per dataset on the M0 multi-dataset benchmark
 * (`sandbox/benchmarks/test-intelligence/comparisons/M0-multi-dataset-2026-05-10.md`),
 * drowning real defects and blocking the G4 quality gate.
 *
 * Issue #2168 tightens the validator scope by classifying every
 * `(fromState, toState)` pair into one of three tiers. Only
 * `mandatory_negative_path` transitions block the run; the rest are either
 * non-blocking warnings or completely silent unless the run explicitly
 * carries a `state_transition`-technique case.
 *
 * Tier definitions (see `docs/test-intelligence/state-machine-validator.md`):
 *
 * - `mandatory_negative_path` — entry transitions out of `initial` and the
 *   `validation_pass` / `validation_fail` outcomes
 *   (`in_progress → validated`, `in_progress → error`). These exercise
 *   negative-path coverage and MUST be covered; missing them blocks the
 *   run with `uncovered_field_lifecycle_transition` (severity `error`).
 * - `recommended_positive_path` — positive-path completion transitions
 *   (`focused → in_progress`, `validated → terminal`, retries from
 *   `error`). They SHOULD be covered, but missing them only emits a
 *   `uncovered_field_lifecycle_transition_recommended` warning.
 * - `state_transition_test_only` — reset/edit/restart transitions
 *   (e.g., `terminal → initial`, `validated → focused`,
 *   `error → focused`). They are only material when the run explicitly
 *   carries a `technique === "state_transition"` case; otherwise the
 *   classifier and validator stay silent.
 *
 * The classifier is deterministic and table-driven (one row per
 * `(fromState, toState)` pair). Adding a new state to
 * `ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES` triggers the
 * `assertTransitionTierTableIsExhaustive` assertion at module load so the
 * compiler immediately surfaces any unclassified pairs.
 */

import {
  ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES,
  type WorkflowFieldLifecycleState,
  type WorkflowFieldLifecycleTransition,
} from "../contracts/index.js";

/** Coverage tier assigned to a single field-lifecycle transition. */
export type FieldLifecycleTransitionTier =
  | "mandatory_negative_path"
  | "recommended_positive_path"
  | "state_transition_test_only";

/** One row of the classifier table. */
export interface FieldLifecycleTransitionTierRow {
  readonly from: WorkflowFieldLifecycleState;
  readonly to: WorkflowFieldLifecycleState;
  readonly tier: FieldLifecycleTransitionTier;
}

const M: FieldLifecycleTransitionTier = "mandatory_negative_path";
const R: FieldLifecycleTransitionTier = "recommended_positive_path";
const S: FieldLifecycleTransitionTier = "state_transition_test_only";

/**
 * Deterministic table mapping every `(from, to)` pair across the
 * canonical six-state lifecycle to a tier. Exhaustive over the cartesian
 * product (36 rows) so an unknown transition never falls through to a
 * heuristic default; if the lifecycle state set ever grows the
 * exhaustiveness assertion below fails fast.
 */
export const FIELD_LIFECYCLE_TRANSITION_TIER_TABLE: ReadonlyArray<FieldLifecycleTransitionTierRow> =
  [
    // Entry transitions: Wave-A audit follow-up (2026-05-11) — the
    // previous classifier treated ALL `initial → X` edges as mandatory.
    // P0 multi-dataset benchmark showed this over-fires (30-60 errors
    // per run on LATyw/xr6Nf even after the tier-split) because the
    // `initial → validated/error/terminal` "skip-state" transitions are
    // unusual in practice (no realistic UI hops a field straight from
    // empty to validated/error/terminal without passing through
    // in_progress first). The tightened classification keeps the entry
    // requirement enforceable but only on the realistic entry edge.
    { from: "initial", to: "initial", tier: S },
    { from: "initial", to: "focused", tier: R }, // was M — positive-path entry, demoted to recommended
    { from: "initial", to: "in_progress", tier: M }, // unchanged — the realistic entry edge
    { from: "initial", to: "validated", tier: S }, // was M — skip-state, only for state-transition test
    { from: "initial", to: "error", tier: S }, // was M — skip-state, only for state-transition test
    { from: "initial", to: "terminal", tier: S }, // was M — skip-state, only for state-transition test

    // From `focused`: typing into the field is the recommended positive
    // completion; everything else is a state-transition-test artifact
    // (refocus, abandon, jump straight to terminal).
    { from: "focused", to: "initial", tier: S },
    { from: "focused", to: "focused", tier: S },
    { from: "focused", to: "in_progress", tier: R },
    { from: "focused", to: "validated", tier: R },
    { from: "focused", to: "error", tier: R },
    { from: "focused", to: "terminal", tier: S },

    // From `in_progress`: validation outcomes are the negative-path
    // anchors (`validation_pass` ⇒ `validated`, `validation_fail`
    // ⇒ `error`). Self-loops and non-validation jumps are recommended at
    // best.
    { from: "in_progress", to: "initial", tier: S },
    { from: "in_progress", to: "focused", tier: S },
    { from: "in_progress", to: "in_progress", tier: R },
    { from: "in_progress", to: "validated", tier: M },
    { from: "in_progress", to: "error", tier: M },
    { from: "in_progress", to: "terminal", tier: R },

    // From `validated`: `form_commit` is the recommended positive close;
    // any backwards jump is reset/edit territory.
    { from: "validated", to: "initial", tier: S },
    { from: "validated", to: "focused", tier: S },
    { from: "validated", to: "in_progress", tier: S },
    { from: "validated", to: "validated", tier: S },
    { from: "validated", to: "error", tier: S },
    { from: "validated", to: "terminal", tier: R },

    // From `error`: a retry into `in_progress` is recommended; a forced
    // commit to terminal is recommended; everything else is reset/edit.
    { from: "error", to: "initial", tier: S },
    { from: "error", to: "focused", tier: S },
    { from: "error", to: "in_progress", tier: R },
    { from: "error", to: "validated", tier: S },
    { from: "error", to: "error", tier: S },
    { from: "error", to: "terminal", tier: R },

    // From `terminal`: every outgoing edge is an explicit re-open / edit
    // workflow — covered only when a state-transition test asks for it.
    { from: "terminal", to: "initial", tier: S },
    { from: "terminal", to: "focused", tier: S },
    { from: "terminal", to: "in_progress", tier: S },
    { from: "terminal", to: "validated", tier: S },
    { from: "terminal", to: "error", tier: S },
    { from: "terminal", to: "terminal", tier: S },
  ];

const TIER_LOOKUP: ReadonlyMap<string, FieldLifecycleTransitionTier> = new Map(
  FIELD_LIFECYCLE_TRANSITION_TIER_TABLE.map((row) => [
    `${row.from}->${row.to}`,
    row.tier,
  ]),
);

const assertTransitionTierTableIsExhaustive = (): void => {
  const states = ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES;
  const expected = states.length * states.length;
  if (TIER_LOOKUP.size !== expected) {
    throw new Error(
      `FIELD_LIFECYCLE_TRANSITION_TIER_TABLE is not exhaustive: ` +
        `expected ${String(expected)} rows for the ${String(states.length)}-state lifecycle, ` +
        `got ${String(TIER_LOOKUP.size)}`,
    );
  }
  for (const from of states) {
    for (const to of states) {
      if (!TIER_LOOKUP.has(`${from}->${to}`)) {
        throw new Error(
          `FIELD_LIFECYCLE_TRANSITION_TIER_TABLE is missing row "${from}->${to}"`,
        );
      }
    }
  }
};
assertTransitionTierTableIsExhaustive();

/**
 * Classify a `(from, to)` lifecycle transition into its coverage tier.
 *
 * Defaults to `state_transition_test_only` for any pair not present in
 * the table; the exhaustiveness assertion above prevents that branch in
 * the normal lifecycle but keeps the function total for forward
 * compatibility if the state universe ever grows.
 */
export const classifyFieldLifecycleTransitionPair = (
  from: WorkflowFieldLifecycleState,
  to: WorkflowFieldLifecycleState,
): FieldLifecycleTransitionTier =>
  TIER_LOOKUP.get(`${from}->${to}`) ?? "state_transition_test_only";

/** Classify a {@link WorkflowFieldLifecycleTransition} record. */
export const classifyFieldLifecycleTransition = (
  transition: Pick<WorkflowFieldLifecycleTransition, "from" | "to">,
): FieldLifecycleTransitionTier =>
  classifyFieldLifecycleTransitionPair(transition.from, transition.to);
