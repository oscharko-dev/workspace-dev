import assert from "node:assert/strict";
import test from "node:test";
import {
  runIrVisitorEnterPhase,
  runIrVisitorExitPhase,
  visitIrNode
} from "./ir-visitor.js";
import type {
  IrVisitContext,
  IrVisitor
} from "./ir-visitor.js";

interface TestState {
  calls: string[];
}

type TestVisitor = IrVisitor<{ id: string }, TestState>;
type TestContext = IrVisitContext<{ id: string }, TestState>;

test("runIrVisitorEnterPhase executes visitors in declaration order", () => {
  const state: TestState = { calls: [] };
  const context: TestContext = {
    node: { id: "root" },
    depth: 0,
    state
  };
  const visitors: TestVisitor[] = [
    { name: "v1", enter: ({ state }) => state.calls.push("enter:v1") },
    { name: "v2", enter: ({ state }) => state.calls.push("enter:v2") },
    { name: "v3", enter: ({ state }) => state.calls.push("enter:v3") }
  ];

  runIrVisitorEnterPhase({
    visitors,
    context
  });

  assert.deepEqual(state.calls, ["enter:v1", "enter:v2", "enter:v3"]);
});

test("runIrVisitorExitPhase executes visitors in reverse declaration order", () => {
  const state: TestState = { calls: [] };
  const context: TestContext = {
    node: { id: "root" },
    depth: 0,
    state
  };
  const visitors: TestVisitor[] = [
    { name: "v1", exit: ({ state }) => state.calls.push("exit:v1") },
    { name: "v2", exit: ({ state }) => state.calls.push("exit:v2") },
    { name: "v3", exit: ({ state }) => state.calls.push("exit:v3") }
  ];

  runIrVisitorExitPhase({
    visitors,
    context
  });

  assert.deepEqual(state.calls, ["exit:v3", "exit:v2", "exit:v1"]);
});

test("visitIrNode runs enter hooks, then children, then exit hooks deterministically", () => {
  const recordRun = (): string[] => {
    const state: TestState = { calls: [] };
    const visitors: TestVisitor[] = [
      {
        name: "skip",
        enter: ({ state }) => state.calls.push("enter:skip"),
        exit: ({ state }) => state.calls.push("exit:skip")
      },
      {
        name: "map",
        enter: ({ state }) => state.calls.push("enter:map"),
        exit: ({ state }) => state.calls.push("exit:map")
      }
    ];

    visitIrNode({
      node: { id: "root" },
      depth: 2,
      state,
      visitors,
      traverseChildren: (): void => {
        state.calls.push("children");
      }
    });

    return state.calls;
  };

  const first = recordRun();
  const second = recordRun();

  assert.deepEqual(first, ["enter:skip", "enter:map", "children", "exit:map", "exit:skip"]);
  assert.deepEqual(second, first);
});
