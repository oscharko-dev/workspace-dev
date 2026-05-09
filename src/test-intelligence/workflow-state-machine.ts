/**
 * Workflow state-machine engine (Issue #2111).
 *
 * Complements the structural step-sequence checker (1..N sequential, no
 * duplicates) with **semantic** state-machine validation: a typed
 * description of the form's workflow states + transitions, plus a
 * deterministic walker that verifies a generated test case's step
 * sequence is *reachable* under that state machine.
 *
 * Why this exists:
 *
 *   The optional `workflowTopology` lifecycle anchoring (Issues #2072 /
 *   #2095) verifies that step-level `fieldLifecycleTransitionId`
 *   references exist and that *coverage* of declared transitions reaches
 *   a quota. It does NOT verify that the order in which transitions are
 *   exercised respects the form's actual workflow state machine. A test
 *   case can carry a structurally clean sequence that nevertheless
 *   declares "submit before validation completes" or "navigate to review
 *   before all required fields filled". Issue #2111 closes that gap.
 *
 * Design choices:
 *
 *   - The schema is **typed**, not free-text: `{ states, transitions: { from,
 *     to, guard, action } }`. The walker is total (every state has a
 *     deterministic outgoing-transition table) and side-effect-free.
 *   - The state machine is **derived** from the deterministic
 *     {@link WorkflowTopology} when one is available: every topology
 *     state becomes a state-machine state, and every topology transition
 *     becomes a transition. Manual overrides per fixture are first-class
 *     citizens — see {@link createWorkflowStateMachine}.
 *   - Reachability uses the test case's **step claims**:
 *     `{ testCaseId, stepIndex, transitionId }`. The walker chains
 *     consecutive transitions (`step[i].to === step[i+1].from`) and
 *     reports the first divergence with the concrete state path that
 *     fails to close.
 *   - Severity follows the issue: `error` for hard infeasibility (no
 *     transition exists, gap is not bridgeable), `warning` for
 *     "missing intermediate step" (gap closes via exactly one
 *     intermediate transition).
 *   - The engine is **deterministic**: no randomness, no wall clock,
 *     identical inputs (state machine + step claims) yield identical
 *     outputs byte-for-byte. The graph search is breadth-first with a
 *     stable `transitionId` ordering so the reported intermediate path
 *     is reproducible.
 *
 * Out of scope (kept narrow on purpose):
 *
 *   - LLM-driven state-machine generation. Issue #2111 references
 *     `mistral-large-3` (#2099) as a *design-time* suggestion path
 *     reviewed by an SME before fixture commit; the engine itself stays
 *     deterministic and the catalog only accepts human-reviewed entries.
 *   - Free-text guards / actions. `guard` and `action` are opaque
 *     strings the engine carries through; it does NOT evaluate them.
 *     Their job is auditor-facing traceability.
 *   - Per-field validation evaluation. That responsibility lives with
 *     the per-field oracle (Issue #2071) and the cross-field invariant
 *     engine (Issue #2110). This module checks the *order* in which
 *     transitions can fire, not whether the data they carry is correct.
 */

import type {
  WorkflowTopology,
  WorkflowTopologyState,
  WorkflowTopologyTransition,
} from "../contracts/index.js";

/* -------------------------------------------------------------------- */
/*  Schema                                                                */
/* -------------------------------------------------------------------- */

/** One workflow-state-machine state. */
export interface WorkflowStateMachineState {
  /** Stable identifier (snake-or-kebab case recommended). */
  readonly stateId: string;
  /** Optional auditor-facing label. */
  readonly label?: string;
  /** True when the walker may start at this state. */
  readonly entry?: boolean;
  /** True when the walker may stop at this state. */
  readonly terminal?: boolean;
}

/** One transition between two state-machine states. */
export interface WorkflowStateMachineTransition {
  readonly transitionId: string;
  readonly from: string;
  readonly to: string;
  /** Auditor-facing guard description (opaque to the engine). */
  readonly guard: string;
  /** Auditor-facing action description (opaque to the engine). */
  readonly action: string;
  /** Optional human-readable label, displayed in audit reports. */
  readonly label?: string;
}

/** One typed state machine that constrains a generated step sequence. */
export interface WorkflowStateMachine {
  /** Stable identifier — usually the screenId / fixture id. */
  readonly id: string;
  /** Auditor-facing label. */
  readonly label: string;
  /** Ordered, deduplicated state list. */
  readonly states: ReadonlyArray<WorkflowStateMachineState>;
  /** Ordered, deduplicated transition list. */
  readonly transitions: ReadonlyArray<WorkflowStateMachineTransition>;
  /** Optional provenance string — `"workflow-topology"`, `"manual"`, … */
  readonly provenance: WorkflowStateMachineProvenance;
}

/** How a state machine entered the catalog. */
export type WorkflowStateMachineProvenance =
  | "manual"
  | "workflow-topology"
  | "manual-override";

/* -------------------------------------------------------------------- */
/*  Construction                                                          */
/* -------------------------------------------------------------------- */

/**
 * Build and validate a workflow state machine from raw inputs. The
 * builder rejects:
 *
 *   - empty state list
 *   - duplicate state ids
 *   - duplicate transition ids
 *   - transitions that reference unknown states
 *   - state machines without at least one entry state
 *
 * The validator is total — once a state machine is accepted, the
 * walker can rely on every transition's `from`/`to` pointing into
 * `states`.
 */
export const createWorkflowStateMachine = (input: {
  readonly id: string;
  readonly label: string;
  readonly states: ReadonlyArray<WorkflowStateMachineState>;
  readonly transitions: ReadonlyArray<WorkflowStateMachineTransition>;
  readonly provenance?: WorkflowStateMachineProvenance;
}): WorkflowStateMachine => {
  if (input.id.trim().length === 0) {
    throw new Error("WorkflowStateMachine.id must be a non-empty string.");
  }
  if (input.label.trim().length === 0) {
    throw new Error("WorkflowStateMachine.label must be a non-empty string.");
  }
  if (input.states.length === 0) {
    throw new Error(
      `WorkflowStateMachine "${input.id}" must declare at least one state.`,
    );
  }
  const stateIds = new Set<string>();
  for (const state of input.states) {
    if (state.stateId.trim().length === 0) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" has a state with an empty id.`,
      );
    }
    if (stateIds.has(state.stateId)) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" declares duplicate state "${state.stateId}".`,
      );
    }
    stateIds.add(state.stateId);
  }
  const entryStateCount = input.states.filter(
    (state) => state.entry === true,
  ).length;
  if (entryStateCount === 0) {
    throw new Error(
      `WorkflowStateMachine "${input.id}" must declare at least one entry state.`,
    );
  }
  const transitionIds = new Set<string>();
  for (const transition of input.transitions) {
    if (transition.transitionId.trim().length === 0) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" has a transition with an empty id.`,
      );
    }
    if (transitionIds.has(transition.transitionId)) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" declares duplicate transition "${transition.transitionId}".`,
      );
    }
    transitionIds.add(transition.transitionId);
    if (!stateIds.has(transition.from)) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" transition "${transition.transitionId}" references unknown source state "${transition.from}".`,
      );
    }
    if (!stateIds.has(transition.to)) {
      throw new Error(
        `WorkflowStateMachine "${input.id}" transition "${transition.transitionId}" references unknown target state "${transition.to}".`,
      );
    }
  }
  // Stable ordering — sort by id for deterministic artifact emission.
  const sortedStates = [...input.states].sort((left, right) =>
    left.stateId.localeCompare(right.stateId),
  );
  const sortedTransitions = [...input.transitions].sort((left, right) =>
    left.transitionId.localeCompare(right.transitionId),
  );
  return {
    id: input.id,
    label: input.label,
    states: sortedStates,
    transitions: sortedTransitions,
    provenance: input.provenance ?? "manual",
  };
};

/**
 * Derive a workflow state machine from a deterministic
 * {@link WorkflowTopology}.
 *
 * The mapping is mechanical:
 *   - `WorkflowTopologyState.stateId` → state-machine state with the
 *     same id; `entry`/`terminal` flags are taken from the topology's
 *     `entryStates` / `exitStates` arrays.
 *   - `WorkflowTopologyTransition.transitionId` → state-machine
 *     transition with the same id, `from`, `to`, and `guard`.
 *     Multiple `actions` are joined with `;` as the auditor-facing
 *     `action` string (the engine itself does not evaluate actions).
 *
 * The provenance is stamped as `"workflow-topology"`. A caller wishing
 * to override one transition can deep-copy the result, mutate the
 * relevant entries (or rebuild via {@link createWorkflowStateMachine}),
 * and stamp `"manual-override"` themselves.
 */
export const buildStateMachineFromWorkflowTopology = (input: {
  readonly id: string;
  readonly label: string;
  readonly topology: WorkflowTopology;
  /** Restrict to transitions whose `from` and `to` are listed here. */
  readonly stateFilter?: ReadonlyArray<string>;
}): WorkflowStateMachine => {
  const filterSet =
    input.stateFilter === undefined ? undefined : new Set(input.stateFilter);
  const allowState = (state: WorkflowTopologyState): boolean =>
    filterSet === undefined || filterSet.has(state.stateId);
  const allowTransition = (
    transition: WorkflowTopologyTransition,
  ): boolean =>
    filterSet === undefined ||
    (filterSet.has(transition.from) && filterSet.has(transition.to));

  const entryIds = new Set(input.topology.entryStates);
  const exitIds = new Set(input.topology.exitStates);

  const states: WorkflowStateMachineState[] = [];
  for (const topologyState of input.topology.states) {
    if (!allowState(topologyState)) continue;
    states.push({
      stateId: topologyState.stateId,
      label: topologyState.label,
      entry: entryIds.has(topologyState.stateId),
      terminal: exitIds.has(topologyState.stateId),
    });
  }

  // Always promote at least one entry — if the topology forgot to mark
  // any of the surviving states as an entry, the first-by-id state is
  // promoted so the builder accepts the result. This mirrors the
  // engine's "stable, deterministic, never throws on a complete
  // topology" contract.
  if (!states.some((state) => state.entry === true) && states.length > 0) {
    const orderedFirst = [...states].sort((left, right) =>
      left.stateId.localeCompare(right.stateId),
    )[0];
    if (orderedFirst === undefined) {
      throw new Error(
        `Workflow topology produced no states for "${input.id}".`,
      );
    }
    const promotedId = orderedFirst.stateId;
    for (let index = 0; index < states.length; index += 1) {
      const current = states[index];
      if (current === undefined) continue;
      if (current.stateId === promotedId) {
        states[index] = { ...current, entry: true };
      }
    }
  }

  const transitions: WorkflowStateMachineTransition[] = [];
  for (const topologyTransition of input.topology.transitions) {
    if (!allowTransition(topologyTransition)) continue;
    transitions.push({
      transitionId: topologyTransition.transitionId,
      from: topologyTransition.from,
      to: topologyTransition.to,
      guard: topologyTransition.guard,
      action: topologyTransition.actions.join(";"),
    });
  }

  return createWorkflowStateMachine({
    id: input.id,
    label: input.label,
    states,
    transitions,
    provenance: "workflow-topology",
  });
};

/* -------------------------------------------------------------------- */
/*  Lookup helpers                                                       */
/* -------------------------------------------------------------------- */

/** Index a state machine for fast `(transitionId | from-state)` lookups. */
export interface WorkflowStateMachineIndex {
  readonly stateMachine: WorkflowStateMachine;
  readonly statesById: ReadonlyMap<string, WorkflowStateMachineState>;
  readonly transitionsById: ReadonlyMap<
    string,
    WorkflowStateMachineTransition
  >;
  readonly outgoingByState: ReadonlyMap<
    string,
    ReadonlyArray<WorkflowStateMachineTransition>
  >;
}

/**
 * Build a deterministic lookup index for one state machine. Outgoing
 * transitions are sorted by `transitionId` so any reachability search
 * yields the same path across runs / hosts.
 */
export const indexWorkflowStateMachine = (
  stateMachine: WorkflowStateMachine,
): WorkflowStateMachineIndex => {
  const statesById = new Map<string, WorkflowStateMachineState>();
  for (const state of stateMachine.states) {
    statesById.set(state.stateId, state);
  }
  const transitionsById = new Map<string, WorkflowStateMachineTransition>();
  const outgoingBuckets = new Map<string, WorkflowStateMachineTransition[]>();
  for (const transition of stateMachine.transitions) {
    transitionsById.set(transition.transitionId, transition);
    const bucket =
      outgoingBuckets.get(transition.from) ??
      ([] as WorkflowStateMachineTransition[]);
    bucket.push(transition);
    outgoingBuckets.set(transition.from, bucket);
  }
  const outgoingByState = new Map<
    string,
    ReadonlyArray<WorkflowStateMachineTransition>
  >();
  for (const [stateId, bucket] of outgoingBuckets) {
    bucket.sort((left, right) =>
      left.transitionId.localeCompare(right.transitionId),
    );
    outgoingByState.set(stateId, bucket);
  }
  return { stateMachine, statesById, transitionsById, outgoingByState };
};

/* -------------------------------------------------------------------- */
/*  Reachability search                                                   */
/* -------------------------------------------------------------------- */

/**
 * Find the shortest path of transition ids from `fromState` to
 * `toState`, using breadth-first search over the indexed state
 * machine. Returns:
 *
 *   - `{ kind: "same" }` when `fromState === toState` (zero-step path).
 *   - `{ kind: "path", transitionIds }` when at least one path exists
 *     (sorted-by-id lexicographic shortest path).
 *   - `{ kind: "none" }` when `toState` is unreachable.
 *
 * The search is deterministic: outgoing edges are visited in
 * `transitionId` order, ties are broken by the predecessor edge id.
 */
export const findShortestTransitionPath = (
  index: WorkflowStateMachineIndex,
  fromState: string,
  toState: string,
): { kind: "same" } | { kind: "path"; transitionIds: ReadonlyArray<string> } | { kind: "none" } => {
  if (!index.statesById.has(fromState) || !index.statesById.has(toState)) {
    return { kind: "none" };
  }
  if (fromState === toState) return { kind: "same" };
  const visited = new Set<string>();
  visited.add(fromState);
  const predecessor = new Map<string, { state: string; transitionId: string }>();
  const queue: string[] = [fromState];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const outgoing = index.outgoingByState.get(current) ?? [];
    for (const transition of outgoing) {
      if (visited.has(transition.to)) continue;
      visited.add(transition.to);
      predecessor.set(transition.to, {
        state: current,
        transitionId: transition.transitionId,
      });
      if (transition.to === toState) {
        const path: string[] = [];
        let cursor: string = toState;
        while (cursor !== fromState) {
          const previous = predecessor.get(cursor);
          if (previous === undefined) break;
          path.unshift(previous.transitionId);
          cursor = previous.state;
        }
        return { kind: "path", transitionIds: path };
      }
      queue.push(transition.to);
    }
  }
  return { kind: "none" };
};

/* -------------------------------------------------------------------- */
/*  Catalog                                                               */
/* -------------------------------------------------------------------- */

/** Registry that maps `screenId` (or fixture id) to its state machine. */
export interface WorkflowStateMachineRegistry {
  has(id: string): boolean;
  get(id: string): WorkflowStateMachine | undefined;
  list(): ReadonlyArray<WorkflowStateMachine>;
}

/** Mutable builder used by `createWorkflowStateMachineRegistry`. */
export interface WorkflowStateMachineRegistryBuilder
  extends WorkflowStateMachineRegistry {
  register(stateMachine: WorkflowStateMachine): void;
  override(stateMachine: WorkflowStateMachine): void;
}

export const createWorkflowStateMachineRegistry =
  (): WorkflowStateMachineRegistryBuilder => {
    const map = new Map<string, WorkflowStateMachine>();
    return {
      register(stateMachine) {
        if (map.has(stateMachine.id)) {
          throw new Error(
            `WorkflowStateMachineRegistry already has "${stateMachine.id}". Use .override() to replace it.`,
          );
        }
        map.set(stateMachine.id, stateMachine);
      },
      override(stateMachine) {
        // Manual overrides re-stamp the provenance for downstream audits.
        const stamped: WorkflowStateMachine =
          stateMachine.provenance === "manual"
            ? stateMachine
            : { ...stateMachine, provenance: "manual-override" };
        map.set(stamped.id, stamped);
      },
      has(id) {
        return map.has(id);
      },
      get(id) {
        return map.get(id);
      },
      list() {
        return [...map.values()].sort((left, right) =>
          left.id.localeCompare(right.id),
        );
      },
    };
  };
