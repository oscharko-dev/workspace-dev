/**
 * Step-sequence validator (Issue #2111).
 *
 * Walks each test case's step claims through the matching workflow state
 * machine and reports the first divergence with the concrete state path
 * that fails to close.
 *
 * Severity policy:
 *
 *   - `error`  — hard infeasibility:
 *       - the first step references a transition whose `from` is not an
 *         entry state of the state machine;
 *       - a consecutive pair `step[i]`/`step[i+1]` cannot be bridged at
 *         all (no path from `step[i].to` to `step[i+1].from` in the
 *         state machine — the sequence is unreachable);
 *       - a step references a `transitionId` not present in the state
 *         machine;
 *       - a state machine declares `requireTerminalExit: true` and the
 *         last step does not land in a terminal state.
 *
 *   - `warning` — "missing intermediate step":
 *       - a consecutive pair has a non-zero shortest path between them
 *         (≥ 1 intermediate transition is required to bridge the gap).
 *         The walker reports the intermediate transition ids so a
 *         reviewer can see exactly which steps are missing.
 *
 * The walker is deterministic: identical inputs produce identical
 * outputs byte-for-byte. The reachability search uses
 * {@link findShortestTransitionPath}, which orders outgoing edges by
 * `transitionId` lexicographically.
 *
 * Coverage gate (in addition to per-case feasibility):
 *
 *   The gate also enforces a *coverage* contract: every test case that
 *   names a screen with a registered state machine must declare step
 *   claims for that machine, and the union of declared transitions
 *   should reach every reachable transition. The acceptance criterion
 *   only requires per-fixture state machines to *exist* — coverage is
 *   reported as a metric, not a hard error, so opt-in fixtures stay
 *   green.
 */

import type {
  WorkflowStateMachine,
  WorkflowStateMachineIndex,
  WorkflowStateMachineRegistry,
} from "./workflow-state-machine.js";
import {
  findShortestTransitionPath,
  indexWorkflowStateMachine,
} from "./workflow-state-machine.js";

/* -------------------------------------------------------------------- */
/*  Inputs                                                                */
/* -------------------------------------------------------------------- */

/** One step claim — names the transition that step exercises. */
export interface WorkflowStateMachineStepClaim {
  /** 1-based step index within the test case. */
  readonly stepIndex: number;
  /** Transition id this step exercises. */
  readonly transitionId: string;
}

/** All step claims for one test case. */
export interface WorkflowStateMachineCaseClaims {
  /** Stable test-case id. */
  readonly testCaseId: string;
  /**
   * State-machine id this case exercises (matches
   * {@link WorkflowStateMachine.id} — typically a screenId / fixture
   * id). When the registry has no matching machine, the case is
   * reported as `unmatched` and contributes no per-case findings.
   */
  readonly stateMachineId: string;
  /** Ordered step claims; MUST have unique `stepIndex` values. */
  readonly steps: ReadonlyArray<WorkflowStateMachineStepClaim>;
  /**
   * When true, the validator enforces that the last step lands in a
   * terminal state. Off by default — a fixture might intentionally
   * test partial flows (e.g. a stop-after-validation negative case).
   */
  readonly requireTerminalExit?: boolean;
}

export type WorkflowStateMachineSeverity = "error" | "warning";

/* -------------------------------------------------------------------- */
/*  Output                                                                */
/* -------------------------------------------------------------------- */

export type WorkflowStateMachineIssueCode =
  | "transition_unknown"
  | "step_indices_out_of_order"
  | "duplicate_step_index"
  | "first_step_not_from_entry"
  | "consecutive_states_unreachable"
  | "missing_intermediate_step"
  | "last_state_not_terminal"
  | "case_state_machine_unknown";

/** One finding emitted by the gate. */
export interface WorkflowStateMachineIssue {
  readonly code: WorkflowStateMachineIssueCode;
  readonly severity: WorkflowStateMachineSeverity;
  readonly testCaseId?: string;
  readonly stateMachineId?: string;
  readonly stepIndex?: number;
  /**
   * Concrete state path that fails to close — anchored on the offending
   * step pair. For `consecutive_states_unreachable` this is
   * `[priorTo, currentFrom]`; for `missing_intermediate_step` this is
   * the bridging path including endpoints. Empty when not applicable.
   */
  readonly statePath: ReadonlyArray<string>;
  /**
   * Concrete transition ids related to the issue. For
   * `missing_intermediate_step` this is the ordered intermediate
   * transition ids that would close the gap. Empty when not applicable.
   */
  readonly transitionPath: ReadonlyArray<string>;
  readonly message: string;
}

/** Per-case validation row. */
export interface WorkflowStateMachineCaseRow {
  readonly testCaseId: string;
  readonly stateMachineId: string;
  /** True when the registry has no matching state machine for this case. */
  readonly unmatched: boolean;
  /** True when the case ran without any errors AND no warnings. */
  readonly clean: boolean;
  /** True when at least one issue at `error` severity fired. */
  readonly blocked: boolean;
  /** Issue rows that fired for this case (sorted by stepIndex, then code). */
  readonly issues: ReadonlyArray<WorkflowStateMachineIssue>;
  /**
   * Ordered transitionIds the case exercised — useful for
   * downstream coverage views. Empty when the case is `unmatched`.
   */
  readonly transitionIdsExercised: ReadonlyArray<string>;
  /**
   * Ordered states the walker traversed (`fromState` of step 1, then
   * `toState` of every step). Empty when the case is `unmatched` or the
   * first step is unknown.
   */
  readonly statePath: ReadonlyArray<string>;
}

/** Per-state-machine coverage row. */
export interface WorkflowStateMachineCoverageRow {
  readonly stateMachineId: string;
  /** Sorted, deduplicated transition ids exercised across all cases. */
  readonly exercisedTransitionIds: ReadonlyArray<string>;
  /** Sorted, deduplicated transition ids NOT exercised by any case. */
  readonly unexercisedTransitionIds: ReadonlyArray<string>;
  /** Total transitions registered on the state machine. */
  readonly totalTransitions: number;
  /** 0..1 coverage ratio rounded to 6 digits. */
  readonly coverageRatio: number;
}

/** Full report emitted by the gate. */
export interface WorkflowStateMachineReport {
  readonly schemaVersion: "1.0.0";
  readonly jobId: string;
  readonly generatedAt: string;
  readonly perCase: ReadonlyArray<WorkflowStateMachineCaseRow>;
  readonly perStateMachine: ReadonlyArray<WorkflowStateMachineCoverageRow>;
  /** Issues aggregated across every case (deterministic order). */
  readonly issues: ReadonlyArray<WorkflowStateMachineIssue>;
  /** True when ANY issue carries `severity: "error"`. */
  readonly blocked: boolean;
  /** Total cases evaluated. */
  readonly totalCases: number;
  /** Cases where the registry had no matching state machine. */
  readonly unmatchedCases: number;
  /** Cases that ran clean (no errors, no warnings). */
  readonly cleanCases: number;
  /** Total state machines visible to the gate. */
  readonly totalStateMachines: number;
}

/** Canonical artifact filename for the persisted report. */
export const WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME =
  "workflow-state-machine-report.json" as const;

/* -------------------------------------------------------------------- */
/*  Validator                                                             */
/* -------------------------------------------------------------------- */

/**
 * Validate one test case against one state machine.
 *
 * Pure: takes the indexed state machine + the case's step claims,
 * returns the per-case row. Used directly by tests; the public gate
 * loops over this function.
 */
export const validateStepSequenceAgainstStateMachine = (input: {
  readonly index: WorkflowStateMachineIndex;
  readonly testCaseId: string;
  readonly steps: ReadonlyArray<WorkflowStateMachineStepClaim>;
  readonly requireTerminalExit?: boolean;
}): WorkflowStateMachineCaseRow => {
  const issues: WorkflowStateMachineIssue[] = [];
  const stateMachineId = input.index.stateMachine.id;
  const transitionIdsExercised: string[] = [];
  const statePath: string[] = [];

  // Validate step ordering and uniqueness up-front.
  const seenIndices = new Set<number>();
  let lastStepIndex = 0;
  let orderingClean = true;
  for (const step of input.steps) {
    if (seenIndices.has(step.stepIndex)) {
      issues.push({
        code: "duplicate_step_index",
        severity: "error",
        testCaseId: input.testCaseId,
        stateMachineId,
        stepIndex: step.stepIndex,
        statePath: [],
        transitionPath: [],
        message: `Test case "${input.testCaseId}" declares duplicate step index ${step.stepIndex}.`,
      });
      orderingClean = false;
    } else if (step.stepIndex <= lastStepIndex) {
      issues.push({
        code: "step_indices_out_of_order",
        severity: "error",
        testCaseId: input.testCaseId,
        stateMachineId,
        stepIndex: step.stepIndex,
        statePath: [],
        transitionPath: [],
        message: `Test case "${input.testCaseId}" step indices are not strictly increasing (step ${step.stepIndex} after step ${lastStepIndex}).`,
      });
      orderingClean = false;
    }
    seenIndices.add(step.stepIndex);
    lastStepIndex = step.stepIndex;
  }

  if (orderingClean && input.steps.length > 0) {
    // Walk the steps, chaining transitions.
    let cursorState: string | undefined;
    let firstStepHandled = false;
    const orderedSteps = [...input.steps].sort(
      (left, right) => left.stepIndex - right.stepIndex,
    );

    for (const step of orderedSteps) {
      const transition = input.index.transitionsById.get(step.transitionId);
      if (transition === undefined) {
        issues.push({
          code: "transition_unknown",
          severity: "error",
          testCaseId: input.testCaseId,
          stateMachineId,
          stepIndex: step.stepIndex,
          statePath: [],
          transitionPath: [step.transitionId],
          message: `Test case "${input.testCaseId}" step ${step.stepIndex} references unknown transition "${step.transitionId}" on state machine "${stateMachineId}".`,
        });
        // Reset the cursor — downstream gap-detection would be noise.
        cursorState = undefined;
        firstStepHandled = true;
        continue;
      }

      if (!firstStepHandled) {
        firstStepHandled = true;
        const fromState = input.index.statesById.get(transition.from);
        if (fromState === undefined || fromState.entry !== true) {
          issues.push({
            code: "first_step_not_from_entry",
            severity: "error",
            testCaseId: input.testCaseId,
            stateMachineId,
            stepIndex: step.stepIndex,
            statePath: [transition.from],
            transitionPath: [transition.transitionId],
            message: `Test case "${input.testCaseId}" first step starts at non-entry state "${transition.from}".`,
          });
        }
        statePath.push(transition.from);
      } else if (cursorState !== undefined && cursorState !== transition.from) {
        // Look for a bridging path.
        const path = findShortestTransitionPath(
          input.index,
          cursorState,
          transition.from,
        );
        if (path.kind === "none") {
          issues.push({
            code: "consecutive_states_unreachable",
            severity: "error",
            testCaseId: input.testCaseId,
            stateMachineId,
            stepIndex: step.stepIndex,
            statePath: [cursorState, transition.from],
            transitionPath: [],
            message: `Test case "${input.testCaseId}" step ${step.stepIndex} cannot be reached from the prior step's post-state. Concrete failing path: ${cursorState} ↛ ${transition.from}.`,
          });
        } else if (path.kind === "path") {
          issues.push({
            code: "missing_intermediate_step",
            severity: "warning",
            testCaseId: input.testCaseId,
            stateMachineId,
            stepIndex: step.stepIndex,
            statePath: [cursorState, transition.from],
            transitionPath: path.transitionIds,
            message: `Test case "${input.testCaseId}" step ${step.stepIndex} is reachable from the prior step's post-state but ${path.transitionIds.length} intermediate transition(s) are missing: ${path.transitionIds.join(" → ")}.`,
          });
        }
      }

      transitionIdsExercised.push(transition.transitionId);
      statePath.push(transition.to);
      cursorState = transition.to;
    }

    if (input.requireTerminalExit === true && cursorState !== undefined) {
      const finalState = input.index.statesById.get(cursorState);
      if (finalState === undefined || finalState.terminal !== true) {
        const finalStepIndex =
          orderedSteps[orderedSteps.length - 1]?.stepIndex;
        issues.push({
          code: "last_state_not_terminal",
          severity: "error",
          testCaseId: input.testCaseId,
          stateMachineId,
          ...(finalStepIndex !== undefined ? { stepIndex: finalStepIndex } : {}),
          statePath: [cursorState],
          transitionPath: [],
          message: `Test case "${input.testCaseId}" requires a terminal final state but ended at non-terminal state "${cursorState}".`,
        });
      }
    }
  }

  // Stable per-case issue ordering — by stepIndex, then code.
  issues.sort((left, right) => {
    const leftIndex = left.stepIndex ?? -1;
    const rightIndex = right.stepIndex ?? -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.code.localeCompare(right.code);
  });

  const blocked = issues.some((issue) => issue.severity === "error");
  const clean = issues.length === 0;
  return {
    testCaseId: input.testCaseId,
    stateMachineId,
    unmatched: false,
    blocked,
    clean,
    issues,
    transitionIdsExercised,
    statePath,
  };
};

/* -------------------------------------------------------------------- */
/*  Gate                                                                  */
/* -------------------------------------------------------------------- */

/** Compute the workflow-state-machine report for one pipeline run. */
export const evaluateWorkflowStateMachineGate = (input: {
  readonly jobId: string;
  readonly generatedAt: string;
  readonly registry: WorkflowStateMachineRegistry;
  readonly caseClaims: ReadonlyArray<WorkflowStateMachineCaseClaims>;
}): WorkflowStateMachineReport => {
  const allMachines = input.registry.list();
  const indexCache = new Map<string, WorkflowStateMachineIndex>();
  const indexFor = (
    stateMachine: WorkflowStateMachine,
  ): WorkflowStateMachineIndex => {
    const cached = indexCache.get(stateMachine.id);
    if (cached !== undefined) return cached;
    const fresh = indexWorkflowStateMachine(stateMachine);
    indexCache.set(stateMachine.id, fresh);
    return fresh;
  };

  const perCase: WorkflowStateMachineCaseRow[] = [];
  const exercisedByMachine = new Map<string, Set<string>>();

  for (const caseClaim of input.caseClaims) {
    const stateMachine = input.registry.get(caseClaim.stateMachineId);
    if (stateMachine === undefined) {
      perCase.push({
        testCaseId: caseClaim.testCaseId,
        stateMachineId: caseClaim.stateMachineId,
        unmatched: true,
        clean: true,
        blocked: false,
        issues: [
          {
            code: "case_state_machine_unknown",
            severity: "warning",
            testCaseId: caseClaim.testCaseId,
            stateMachineId: caseClaim.stateMachineId,
            statePath: [],
            transitionPath: [],
            message: `Test case "${caseClaim.testCaseId}" references state machine "${caseClaim.stateMachineId}" which is not in the registry.`,
          },
        ],
        transitionIdsExercised: [],
        statePath: [],
      });
      continue;
    }
    const index = indexFor(stateMachine);
    const row = validateStepSequenceAgainstStateMachine({
      index,
      testCaseId: caseClaim.testCaseId,
      steps: caseClaim.steps,
      ...(caseClaim.requireTerminalExit !== undefined
        ? { requireTerminalExit: caseClaim.requireTerminalExit }
        : {}),
    });
    perCase.push(row);
    const bucket = exercisedByMachine.get(stateMachine.id) ?? new Set<string>();
    for (const transitionId of row.transitionIdsExercised) {
      bucket.add(transitionId);
    }
    exercisedByMachine.set(stateMachine.id, bucket);
  }

  // Stable per-case ordering — by testCaseId then stateMachineId.
  perCase.sort((left, right) => {
    const caseOrder = left.testCaseId.localeCompare(right.testCaseId);
    if (caseOrder !== 0) return caseOrder;
    return left.stateMachineId.localeCompare(right.stateMachineId);
  });

  const perStateMachine: WorkflowStateMachineCoverageRow[] = [];
  for (const machine of allMachines) {
    const exercised = exercisedByMachine.get(machine.id) ?? new Set<string>();
    const total = machine.transitions.length;
    const exercisedSorted = [...exercised].sort((left, right) =>
      left.localeCompare(right),
    );
    const unexercised = machine.transitions
      .map((transition) => transition.transitionId)
      .filter((id) => !exercised.has(id))
      .sort((left, right) => left.localeCompare(right));
    const coverageRatio =
      total === 0
        ? 1
        : Math.round((exercisedSorted.length / total) * 1_000_000) / 1_000_000;
    perStateMachine.push({
      stateMachineId: machine.id,
      exercisedTransitionIds: exercisedSorted,
      unexercisedTransitionIds: unexercised,
      totalTransitions: total,
      coverageRatio,
    });
  }
  perStateMachine.sort((left, right) =>
    left.stateMachineId.localeCompare(right.stateMachineId),
  );

  // Aggregate issues — deterministic ordering anchored on (testCaseId, stepIndex, code).
  const issues: WorkflowStateMachineIssue[] = [];
  for (const row of perCase) {
    for (const issue of row.issues) issues.push(issue);
  }
  issues.sort((left, right) => {
    const caseOrder = (left.testCaseId ?? "").localeCompare(
      right.testCaseId ?? "",
    );
    if (caseOrder !== 0) return caseOrder;
    const leftIndex = left.stepIndex ?? -1;
    const rightIndex = right.stepIndex ?? -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.code.localeCompare(right.code);
  });

  const blocked = issues.some((issue) => issue.severity === "error");
  const cleanCases = perCase.filter((row) => row.clean).length;
  const unmatchedCases = perCase.filter((row) => row.unmatched).length;

  return {
    schemaVersion: "1.0.0",
    jobId: input.jobId,
    generatedAt: input.generatedAt,
    perCase,
    perStateMachine,
    issues,
    blocked,
    totalCases: perCase.length,
    unmatchedCases,
    cleanCases,
    totalStateMachines: allMachines.length,
  };
};
