/**
 * Tests for the workflow state-machine step-sequence validator
 * (Issue #2111).
 *
 * Covers:
 *
 *   - clean per-case walks pass through with `clean: true` and the
 *     correct `transitionIdsExercised` / `statePath`.
 *   - duplicate / out-of-order step indices fire `error` issues.
 *   - first step starting at a non-entry state fires
 *     `first_step_not_from_entry`.
 *   - consecutive `to ≠ from` gaps that are bridgeable by exactly one
 *     intermediate transition fire `missing_intermediate_step` at
 *     `warning` severity, including the bridging transition path.
 *   - consecutive gaps that have no path fire
 *     `consecutive_states_unreachable` at `error` severity.
 *   - `transition_unknown` fires for unknown transitionId references.
 *   - `requireTerminalExit` fires when the last step lands non-terminal.
 *   - The gate aggregates per-case rows + per-state-machine coverage
 *     deterministically; unmatched cases produce a warning.
 *   - The artifact filename constant is canonical.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkflowStateMachine,
  createWorkflowStateMachineRegistry,
  indexWorkflowStateMachine,
} from "./workflow-state-machine.js";
import {
  evaluateWorkflowStateMachineGate,
  validateStepSequenceAgainstStateMachine,
  WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME,
} from "./workflow-state-machine-validator.js";

const GENERATED_AT = "2026-05-09T10:00:00.000Z";

const buildSimpleMachine = () =>
  createWorkflowStateMachine({
    id: "simple",
    label: "Simple",
    states: [
      { stateId: "ready", entry: true },
      { stateId: "filled" },
      { stateId: "validated" },
      { stateId: "submitted", terminal: true },
    ],
    transitions: [
      {
        transitionId: "t01.fill",
        from: "ready",
        to: "filled",
        guard: "g",
        action: "act",
      },
      {
        transitionId: "t02.validate",
        from: "filled",
        to: "validated",
        guard: "g",
        action: "act",
      },
      {
        transitionId: "t03.submit",
        from: "validated",
        to: "submitted",
        guard: "g",
        action: "act",
      },
    ],
  });

void test("artifact filename constant is canonical", () => {
  assert.equal(
    WORKFLOW_STATE_MACHINE_REPORT_ARTIFACT_FILENAME,
    "workflow-state-machine-report.json",
  );
});

void test("clean walk through every transition passes with no issues", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-1",
    steps: [
      { stepIndex: 1, transitionId: "t01.fill" },
      { stepIndex: 2, transitionId: "t02.validate" },
      { stepIndex: 3, transitionId: "t03.submit" },
    ],
  });
  assert.equal(row.clean, true);
  assert.equal(row.blocked, false);
  assert.deepEqual(row.transitionIdsExercised, [
    "t01.fill",
    "t02.validate",
    "t03.submit",
  ]);
  assert.deepEqual(row.statePath, ["ready", "filled", "validated", "submitted"]);
  assert.deepEqual(row.issues, []);
});

void test("duplicate step indices fire duplicate_step_index error", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-dup",
    steps: [
      { stepIndex: 1, transitionId: "t01.fill" },
      { stepIndex: 1, transitionId: "t02.validate" },
    ],
  });
  assert.equal(row.blocked, true);
  assert.ok(
    row.issues.some((issue) => issue.code === "duplicate_step_index"),
    "expected duplicate_step_index issue",
  );
});

void test("non-strictly-increasing step indices fire ordering error", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-ord",
    steps: [
      { stepIndex: 2, transitionId: "t01.fill" },
      { stepIndex: 1, transitionId: "t02.validate" },
    ],
  });
  assert.ok(
    row.issues.some((issue) => issue.code === "step_indices_out_of_order"),
  );
  assert.equal(row.blocked, true);
});

void test("first step from non-entry state fires error", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
      { stateId: "c", terminal: true },
    ],
    transitions: [
      { transitionId: "t1", from: "a", to: "b", guard: "g", action: "act" },
      { transitionId: "t2", from: "b", to: "c", guard: "g", action: "act" },
    ],
  });
  const index = indexWorkflowStateMachine(machine);
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-non-entry",
    steps: [{ stepIndex: 1, transitionId: "t2" }],
  });
  const issue = row.issues.find(
    (current) => current.code === "first_step_not_from_entry",
  );
  assert.ok(issue !== undefined);
  assert.equal(row.blocked, true);
  assert.deepEqual(issue?.statePath, ["b"]);
});

void test("missing intermediate step fires warning with bridging path", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-skip",
    // `t01.fill` lands on `filled`; jumping straight to `t03.submit`
    // requires `t02.validate` as an intermediate.
    steps: [
      { stepIndex: 1, transitionId: "t01.fill" },
      { stepIndex: 2, transitionId: "t03.submit" },
    ],
  });
  const issue = row.issues.find(
    (current) => current.code === "missing_intermediate_step",
  );
  assert.ok(issue !== undefined);
  assert.equal(issue?.severity, "warning");
  assert.deepEqual(issue?.transitionPath, ["t02.validate"]);
  assert.deepEqual(issue?.statePath, ["filled", "validated"]);
  // The case is NOT blocked — a warning does not flip the gate.
  assert.equal(row.blocked, false);
});

void test("consecutive states with no path fire error", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
      { stateId: "isolated" },
    ],
    transitions: [
      { transitionId: "t1", from: "a", to: "b", guard: "g", action: "act" },
      // No edge from `b` to `isolated`, no edge into `isolated` at all.
    ],
  });
  // A degenerate case: imagine a buggy generator that asserts a step
  // landing on a state with no incoming edges — the gate must reject.
  const isolatedMachine = createWorkflowStateMachine({
    id: "demo2",
    label: "Demo2",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
      { stateId: "c" },
      { stateId: "d" },
    ],
    transitions: [
      { transitionId: "t1", from: "a", to: "b", guard: "g", action: "act" },
      // separate component
      { transitionId: "t2", from: "c", to: "d", guard: "g", action: "act" },
    ],
  });
  const index = indexWorkflowStateMachine(isolatedMachine);
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-iso",
    steps: [
      { stepIndex: 1, transitionId: "t1" },
      { stepIndex: 2, transitionId: "t2" },
    ],
  });
  const issue = row.issues.find(
    (current) => current.code === "consecutive_states_unreachable",
  );
  assert.ok(issue !== undefined);
  assert.equal(row.blocked, true);
  assert.deepEqual(issue?.statePath, ["b", "c"]);
  // Suppress unused-variable lint for the local `machine` constant.
  void machine;
});

void test("unknown transition id fires error", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-unknown",
    steps: [{ stepIndex: 1, transitionId: "nope" }],
  });
  assert.ok(row.issues.some((issue) => issue.code === "transition_unknown"));
  assert.equal(row.blocked, true);
});

void test("requireTerminalExit blocks when last state is non-terminal", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-nonterminal",
    steps: [
      { stepIndex: 1, transitionId: "t01.fill" },
      { stepIndex: 2, transitionId: "t02.validate" },
    ],
    requireTerminalExit: true,
  });
  const issue = row.issues.find(
    (current) => current.code === "last_state_not_terminal",
  );
  assert.ok(issue !== undefined);
  assert.equal(row.blocked, true);
});

void test("requireTerminalExit accepts a sequence ending in a terminal", () => {
  const index = indexWorkflowStateMachine(buildSimpleMachine());
  const row = validateStepSequenceAgainstStateMachine({
    index,
    testCaseId: "case-terminal",
    steps: [
      { stepIndex: 1, transitionId: "t01.fill" },
      { stepIndex: 2, transitionId: "t02.validate" },
      { stepIndex: 3, transitionId: "t03.submit" },
    ],
    requireTerminalExit: true,
  });
  assert.equal(row.clean, true);
  assert.equal(row.blocked, false);
});

void test("gate aggregates per-case + per-state-machine rows deterministically", () => {
  const registry = createWorkflowStateMachineRegistry();
  registry.register(buildSimpleMachine());

  const report = evaluateWorkflowStateMachineGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: [
      {
        testCaseId: "case-z",
        stateMachineId: "simple",
        steps: [
          { stepIndex: 1, transitionId: "t01.fill" },
          { stepIndex: 2, transitionId: "t02.validate" },
          { stepIndex: 3, transitionId: "t03.submit" },
        ],
      },
      {
        testCaseId: "case-a",
        stateMachineId: "simple",
        steps: [
          { stepIndex: 1, transitionId: "t01.fill" },
          { stepIndex: 2, transitionId: "t02.validate" },
        ],
      },
    ],
  });

  assert.equal(report.blocked, false);
  // Per-case rows sorted by id.
  assert.deepEqual(
    report.perCase.map((row) => row.testCaseId),
    ["case-a", "case-z"],
  );
  const perMachine = report.perStateMachine.find(
    (row) => row.stateMachineId === "simple",
  );
  assert.deepEqual(perMachine?.exercisedTransitionIds, [
    "t01.fill",
    "t02.validate",
    "t03.submit",
  ]);
  assert.deepEqual(perMachine?.unexercisedTransitionIds, []);
  assert.equal(perMachine?.coverageRatio, 1);
});

void test("gate emits warning when the case state machine is unknown", () => {
  const registry = createWorkflowStateMachineRegistry();
  registry.register(buildSimpleMachine());
  const report = evaluateWorkflowStateMachineGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: [
      {
        testCaseId: "case-x",
        stateMachineId: "ghost",
        steps: [{ stepIndex: 1, transitionId: "t01.fill" }],
      },
    ],
  });
  assert.equal(report.blocked, false);
  assert.equal(report.unmatchedCases, 1);
  const issue = report.issues.find(
    (current) => current.code === "case_state_machine_unknown",
  );
  assert.ok(issue !== undefined);
  assert.equal(issue?.severity, "warning");
});

void test("gate computes correct coverage ratio", () => {
  const registry = createWorkflowStateMachineRegistry();
  registry.register(buildSimpleMachine());
  const report = evaluateWorkflowStateMachineGate({
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: [
      {
        testCaseId: "case-1",
        stateMachineId: "simple",
        steps: [{ stepIndex: 1, transitionId: "t01.fill" }],
      },
    ],
  });
  const row = report.perStateMachine[0];
  assert.equal(row?.totalTransitions, 3);
  assert.deepEqual(row?.exercisedTransitionIds, ["t01.fill"]);
  assert.deepEqual(row?.unexercisedTransitionIds, [
    "t02.validate",
    "t03.submit",
  ]);
  // 1 / 3 = 0.333333…
  assert.equal(row?.coverageRatio, 0.333333);
});

void test("gate is fully deterministic", () => {
  const registry = createWorkflowStateMachineRegistry();
  registry.register(buildSimpleMachine());
  const input = {
    jobId: "job-1",
    generatedAt: GENERATED_AT,
    registry,
    caseClaims: [
      {
        testCaseId: "case-1",
        stateMachineId: "simple",
        steps: [
          { stepIndex: 1, transitionId: "t01.fill" },
          { stepIndex: 2, transitionId: "t02.validate" },
        ],
      },
    ],
  };
  const report1 = evaluateWorkflowStateMachineGate(input);
  const report2 = evaluateWorkflowStateMachineGate(input);
  assert.deepEqual(report1, report2);
});
