import assert from "node:assert/strict";
import test from "node:test";
import { createFigmaRestCircuitBreaker } from "./figma-rest-circuit-breaker.js";

test("figma rest circuit breaker stays closed on success", () => {
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000
  });

  const decision = breaker.beforeRequest();
  assert.equal(decision.allowRequest, true);

  const snapshot = breaker.recordSuccess();
  assert.equal(snapshot.state, "closed");
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.probeInFlight, false);
});

test("figma rest circuit breaker opens after reaching failure threshold", () => {
  let nowMs = 1_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  const snapshot = breaker.recordTransientFailure();

  assert.equal(snapshot.state, "open");
  assert.equal(snapshot.consecutiveFailures, 3);
  assert.equal(snapshot.nextProbeAt, nowMs + 30_000);
});

test("figma rest circuit breaker fails fast while open before reset timeout", () => {
  let nowMs = 5_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 30_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 15_000;
  const decision = breaker.beforeRequest();

  assert.equal(decision.allowRequest, false);
  assert.equal(decision.snapshot.state, "open");
  assert.equal(decision.snapshot.probeInFlight, false);
});

test("figma rest circuit breaker transitions open to half-open after reset timeout", () => {
  let nowMs = 10_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 5_000;
  const decision = breaker.beforeRequest();

  assert.equal(decision.allowRequest, true);
  assert.equal(decision.snapshot.state, "half-open");
  assert.equal(decision.snapshot.probeInFlight, true);
});

test("figma rest circuit breaker allows only one half-open probe", () => {
  let nowMs = 10_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 5_000;
  const firstDecision = breaker.beforeRequest();
  const secondDecision = breaker.beforeRequest();

  assert.equal(firstDecision.allowRequest, true);
  assert.equal(secondDecision.allowRequest, false);
  assert.equal(secondDecision.snapshot.state, "half-open");
  assert.equal(secondDecision.snapshot.probeInFlight, true);
});

test("figma rest circuit breaker closes after a successful half-open probe", () => {
  let nowMs = 1_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 5_000;
  breaker.beforeRequest();
  const snapshot = breaker.recordSuccess();

  assert.equal(snapshot.state, "closed");
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.probeInFlight, false);
  assert.equal("nextProbeAt" in snapshot, false);
});

test("figma rest circuit breaker reopens after a failed half-open probe", () => {
  let nowMs = 2_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 4_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 4_000;
  breaker.beforeRequest();
  const snapshot = breaker.recordTransientFailure();

  assert.equal(snapshot.state, "open");
  assert.equal(snapshot.consecutiveFailures, 3);
  assert.equal(snapshot.nextProbeAt, nowMs + 4_000);
  assert.equal(snapshot.probeInFlight, false);
});

test("figma rest circuit breaker resets on non-transient outcomes", () => {
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  const snapshot = breaker.recordNonTransientOutcome();

  assert.equal(snapshot.state, "closed");
  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.probeInFlight, false);
});
