import assert from "node:assert/strict";
import test from "node:test";
import {
  createLlmCircuitBreaker,
  type LlmCircuitTransitionEvent,
} from "./llm-circuit-breaker.js";

const fakeClock = (
  initial: number = 0,
): { now: () => number; advance: (delta: number) => void } => {
  let value = initial;
  return {
    now: () => value,
    advance: (delta) => {
      value += delta;
    },
  };
};

test("circuit-breaker: starts closed and admits requests", () => {
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 1000,
  });
  const decision = breaker.beforeRequest();
  assert.equal(decision.allowRequest, true);
  assert.equal(decision.snapshot.state, "closed");
});

test("circuit-breaker: opens after failureThreshold transient failures", () => {
  const transitions: LlmCircuitTransitionEvent[] = [];
  const clock = fakeClock();
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 1000,
    clock,
    onStateTransition: (event) => transitions.push(event),
  });
  breaker.recordTransientFailure();
  assert.equal(breaker.getSnapshot().state, "closed");
  breaker.recordTransientFailure();
  assert.equal(breaker.getSnapshot().state, "open");
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0]?.toState, "open");
  assert.equal(transitions[0]?.trigger, "failure_threshold_reached");
});

test("circuit-breaker: rejects requests while open", () => {
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 1000,
  });
  breaker.recordTransientFailure();
  const decision = breaker.beforeRequest();
  assert.equal(decision.allowRequest, false);
  assert.equal(decision.snapshot.state, "open");
});

test("circuit-breaker: transitions to half_open after reset timeout", () => {
  const clock = fakeClock();
  const transitions: LlmCircuitTransitionEvent[] = [];
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 100,
    clock,
    onStateTransition: (event) => transitions.push(event),
  });
  breaker.recordTransientFailure();
  clock.advance(150);
  const decision = breaker.beforeRequest();
  assert.equal(decision.allowRequest, true);
  assert.equal(decision.snapshot.state, "half_open");
  assert.equal(decision.snapshot.probeInFlight, true);
  // half_open second request must wait for the probe to settle
  const second = breaker.beforeRequest();
  assert.equal(second.allowRequest, false);
  assert.equal(transitions.map((t) => t.toState).includes("half_open"), true);
});

test("circuit-breaker: half_open success closes; half_open failure re-opens", () => {
  const clock = fakeClock();
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 100,
    clock,
  });
  breaker.recordTransientFailure();
  clock.advance(200);
  breaker.beforeRequest();
  breaker.recordSuccess();
  assert.equal(breaker.getSnapshot().state, "closed");

  // Re-open and probe-fail
  breaker.recordTransientFailure();
  clock.advance(200);
  breaker.beforeRequest();
  breaker.recordTransientFailure();
  assert.equal(breaker.getSnapshot().state, "open");
});

test("circuit-breaker: non-transient outcome resets the breaker", () => {
  const breaker = createLlmCircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 1000,
  });
  breaker.recordTransientFailure();
  breaker.recordTransientFailure();
  assert.equal(breaker.getSnapshot().consecutiveFailures, 2);
  breaker.recordNonTransientOutcome();
  assert.equal(breaker.getSnapshot().consecutiveFailures, 0);
  assert.equal(breaker.getSnapshot().state, "closed");
});

test("circuit-breaker: rejects invalid configuration", () => {
  assert.throws(
    () => createLlmCircuitBreaker({ failureThreshold: 0, resetTimeoutMs: 1 }),
    RangeError,
  );
  assert.throws(
    () => createLlmCircuitBreaker({ failureThreshold: 1.5, resetTimeoutMs: 1 }),
    RangeError,
  );
  assert.throws(
    () => createLlmCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: -1 }),
    RangeError,
  );
});
