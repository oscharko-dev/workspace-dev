/**
 * Tests for the workflow state-machine schema, builder, and topology
 * derivation (Issue #2111).
 *
 * Covers:
 *
 *   - schema validation: empty / duplicate / dangling / no-entry rejection
 *   - deterministic state + transition ordering
 *   - registry register / override semantics + provenance stamping
 *   - factory `buildStateMachineFromWorkflowTopology`:
 *       * topology states map 1:1 to state-machine states
 *       * `entryStates` / `exitStates` flags propagate
 *       * `stateFilter` restricts states + transitions
 *       * `actions` join with `;` as the auditor-facing action string
 *       * topology with no entry promotes the lex-first state to entry
 *   - shortest-path search: same-state, direct edge, multi-step,
 *     unreachable.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { WorkflowTopology } from "../contracts/index.js";
import {
  buildStateMachineFromWorkflowTopology,
  createWorkflowStateMachine,
  createWorkflowStateMachineRegistry,
  findShortestTransitionPath,
  indexWorkflowStateMachine,
} from "./workflow-state-machine.js";

const STATES_MIN = [
  { stateId: "a", entry: true },
  { stateId: "b" },
];
const TRANSITIONS_MIN = [
  {
    transitionId: "a-to-b",
    from: "a",
    to: "b",
    guard: "guard-a-b",
    action: "act-a-b",
  },
];

void test("createWorkflowStateMachine sorts states + transitions deterministically", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "z", entry: true },
      { stateId: "a" },
      { stateId: "m" },
    ],
    transitions: [
      { transitionId: "t-c", from: "z", to: "a", guard: "g", action: "act" },
      { transitionId: "t-a", from: "a", to: "m", guard: "g", action: "act" },
      { transitionId: "t-b", from: "m", to: "z", guard: "g", action: "act" },
    ],
  });
  assert.deepEqual(
    machine.states.map((state) => state.stateId),
    ["a", "m", "z"],
  );
  assert.deepEqual(
    machine.transitions.map((transition) => transition.transitionId),
    ["t-a", "t-b", "t-c"],
  );
  assert.equal(machine.provenance, "manual");
});

void test("createWorkflowStateMachine rejects empty id", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "",
        label: "Demo",
        states: STATES_MIN,
        transitions: TRANSITIONS_MIN,
      }),
    /must be a non-empty string/,
  );
});

void test("createWorkflowStateMachine rejects empty label", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "",
        states: STATES_MIN,
        transitions: TRANSITIONS_MIN,
      }),
    /label must be a non-empty string/,
  );
});

void test("createWorkflowStateMachine rejects empty state list", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: [],
        transitions: [],
      }),
    /at least one state/,
  );
});

void test("createWorkflowStateMachine rejects duplicate state ids", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: [
          { stateId: "a", entry: true },
          { stateId: "a" },
        ],
        transitions: [],
      }),
    /duplicate state "a"/,
  );
});

void test("createWorkflowStateMachine rejects no-entry state list", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: [{ stateId: "a" }, { stateId: "b" }],
        transitions: [],
      }),
    /at least one entry state/,
  );
});

void test("createWorkflowStateMachine rejects duplicate transition ids", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: STATES_MIN,
        transitions: [
          { transitionId: "t", from: "a", to: "b", guard: "g", action: "act" },
          { transitionId: "t", from: "b", to: "a", guard: "g", action: "act" },
        ],
      }),
    /duplicate transition "t"/,
  );
});

void test("createWorkflowStateMachine rejects dangling source state", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: STATES_MIN,
        transitions: [
          {
            transitionId: "t",
            from: "ghost",
            to: "b",
            guard: "g",
            action: "act",
          },
        ],
      }),
    /unknown source state "ghost"/,
  );
});

void test("createWorkflowStateMachine rejects dangling target state", () => {
  assert.throws(
    () =>
      createWorkflowStateMachine({
        id: "x",
        label: "Demo",
        states: STATES_MIN,
        transitions: [
          {
            transitionId: "t",
            from: "a",
            to: "ghost",
            guard: "g",
            action: "act",
          },
        ],
      }),
    /unknown target state "ghost"/,
  );
});

void test("registry register / override stamps provenance", () => {
  const registry = createWorkflowStateMachineRegistry();
  const initial = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: STATES_MIN,
    transitions: TRANSITIONS_MIN,
  });
  registry.register(initial);
  assert.ok(registry.has("demo"));
  assert.equal(registry.get("demo")?.provenance, "manual");
  assert.throws(() => registry.register(initial), /already has "demo"/);

  const overridden = createWorkflowStateMachine({
    id: "demo",
    label: "Demo Override",
    states: STATES_MIN,
    transitions: TRANSITIONS_MIN,
    provenance: "workflow-topology",
  });
  registry.override(overridden);
  assert.equal(registry.get("demo")?.provenance, "manual-override");
  assert.equal(registry.get("demo")?.label, "Demo Override");

  // Re-overriding with provenance manual keeps it manual.
  const manualReplacement = createWorkflowStateMachine({
    id: "demo",
    label: "Manual",
    states: STATES_MIN,
    transitions: TRANSITIONS_MIN,
    provenance: "manual",
  });
  registry.override(manualReplacement);
  assert.equal(registry.get("demo")?.provenance, "manual");
});

void test("registry list is sorted by id", () => {
  const registry = createWorkflowStateMachineRegistry();
  registry.register(
    createWorkflowStateMachine({
      id: "z",
      label: "Z",
      states: STATES_MIN,
      transitions: TRANSITIONS_MIN,
    }),
  );
  registry.register(
    createWorkflowStateMachine({
      id: "a",
      label: "A",
      states: STATES_MIN,
      transitions: TRANSITIONS_MIN,
    }),
  );
  registry.register(
    createWorkflowStateMachine({
      id: "m",
      label: "M",
      states: STATES_MIN,
      transitions: TRANSITIONS_MIN,
    }),
  );
  assert.deepEqual(
    registry.list().map((row) => row.id),
    ["a", "m", "z"],
  );
});

const TOPOLOGY_DEMO: WorkflowTopology = {
  schemaVersion: "1.0.0",
  jobId: "demo-job",
  actions: [],
  states: [
    {
      stateId: "ready",
      screenId: "screen-1",
      label: "Ready",
      sourceRefs: [],
    },
    {
      stateId: "filled",
      screenId: "screen-1",
      label: "Filled",
      sourceRefs: [],
    },
    {
      stateId: "submitted",
      screenId: "screen-1",
      label: "Submitted",
      sourceRefs: [],
    },
  ],
  transitions: [
    {
      transitionId: "topo.t01.fill",
      from: "ready",
      to: "filled",
      guard: "fields filled",
      actions: ["stage", "validate"],
    },
    {
      transitionId: "topo.t02.submit",
      from: "filled",
      to: "submitted",
      guard: "submit accepted",
      actions: ["persist"],
    },
  ],
  fieldLifecycles: [],
  entryStates: ["ready"],
  exitStates: ["submitted"],
};

void test("buildStateMachineFromWorkflowTopology maps states + transitions 1:1", () => {
  const machine = buildStateMachineFromWorkflowTopology({
    id: "demo",
    label: "Demo",
    topology: TOPOLOGY_DEMO,
  });
  assert.equal(machine.id, "demo");
  assert.equal(machine.provenance, "workflow-topology");
  const ready = machine.states.find((state) => state.stateId === "ready");
  const submitted = machine.states.find(
    (state) => state.stateId === "submitted",
  );
  assert.equal(ready?.entry, true);
  assert.equal(submitted?.terminal, true);
  const transitionFill = machine.transitions.find(
    (transition) => transition.transitionId === "topo.t01.fill",
  );
  assert.equal(transitionFill?.action, "stage;validate");
});

void test("buildStateMachineFromWorkflowTopology supports state filter", () => {
  const machine = buildStateMachineFromWorkflowTopology({
    id: "demo",
    label: "Demo",
    topology: TOPOLOGY_DEMO,
    stateFilter: ["ready", "filled"],
  });
  assert.deepEqual(
    machine.states.map((state) => state.stateId),
    ["filled", "ready"],
  );
  // Transition referencing `submitted` was filtered out.
  assert.equal(machine.transitions.length, 1);
  assert.equal(machine.transitions[0]?.transitionId, "topo.t01.fill");
});

void test("buildStateMachineFromWorkflowTopology promotes lex-first when no entry survives", () => {
  const topology: WorkflowTopology = {
    ...TOPOLOGY_DEMO,
    entryStates: [],
  };
  const machine = buildStateMachineFromWorkflowTopology({
    id: "demo",
    label: "Demo",
    topology,
  });
  // `filled` is lexicographically first among the survivors.
  const promoted = machine.states.find(
    (state) => state.entry === true,
  );
  assert.equal(promoted?.stateId, "filled");
});

void test("findShortestTransitionPath finds direct edge", () => {
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
  const result = findShortestTransitionPath(index, "a", "b");
  assert.equal(result.kind, "path");
  if (result.kind === "path") {
    assert.deepEqual(result.transitionIds, ["t1"]);
  }
});

void test("findShortestTransitionPath finds a multi-step path", () => {
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
  const result = findShortestTransitionPath(index, "a", "c");
  assert.equal(result.kind, "path");
  if (result.kind === "path") {
    assert.deepEqual(result.transitionIds, ["t1", "t2"]);
  }
});

void test("findShortestTransitionPath returns same when from === to", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
    ],
    transitions: TRANSITIONS_MIN,
  });
  const index = indexWorkflowStateMachine(machine);
  const result = findShortestTransitionPath(index, "a", "a");
  assert.equal(result.kind, "same");
});

void test("findShortestTransitionPath returns none for unreachable target", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
      { stateId: "c" },
    ],
    transitions: [
      { transitionId: "t", from: "a", to: "b", guard: "g", action: "act" },
    ],
  });
  const index = indexWorkflowStateMachine(machine);
  const result = findShortestTransitionPath(index, "a", "c");
  assert.equal(result.kind, "none");
});

void test("findShortestTransitionPath returns none for unknown state", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: STATES_MIN,
    transitions: TRANSITIONS_MIN,
  });
  const index = indexWorkflowStateMachine(machine);
  const result = findShortestTransitionPath(index, "ghost", "b");
  assert.equal(result.kind, "none");
});

void test("indexWorkflowStateMachine sorts outgoing edges by transitionId", () => {
  const machine = createWorkflowStateMachine({
    id: "demo",
    label: "Demo",
    states: [
      { stateId: "a", entry: true },
      { stateId: "b" },
      { stateId: "c" },
    ],
    transitions: [
      { transitionId: "t-z", from: "a", to: "b", guard: "g", action: "act" },
      { transitionId: "t-a", from: "a", to: "c", guard: "g", action: "act" },
    ],
  });
  const index = indexWorkflowStateMachine(machine);
  const outgoing = index.outgoingByState.get("a") ?? [];
  assert.deepEqual(
    outgoing.map((row) => row.transitionId),
    ["t-a", "t-z"],
  );
});
