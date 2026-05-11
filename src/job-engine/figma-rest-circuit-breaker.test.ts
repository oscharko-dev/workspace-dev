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

test("figma rest circuit breaker allows exactly one probe across 100 concurrent microtask callers", async () => {
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
  const decisions = await Promise.all(
    Array.from({ length: 100 }, () => Promise.resolve().then(() => breaker.beforeRequest()))
  );

  assert.equal(
    decisions.filter((decision) => decision.allowRequest).length,
    1
  );
  assert.equal(decisions.every((decision) => decision.snapshot.state === "half-open"), true);
  assert.equal(decisions.every((decision) => decision.snapshot.probeInFlight), true);
});

test("figma rest circuit breaker version guard ignores stale half-open transitions after a reset cycle", () => {
  let nowMs = 1_000;
  let reentered = false;
  let breaker: ReturnType<typeof createFigmaRestCircuitBreaker>;

  breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => {
        if (nowMs === 6_000 && !reentered) {
          reentered = true;
          const resetSnapshot = breaker.recordNonTransientOutcome();
          assert.equal(resetSnapshot.state, "closed");

          breaker.beforeRequest();
          const reopenedSnapshot = breaker.recordTransientFailure();
          assert.equal(reopenedSnapshot.state, "open");

          nowMs = 11_000;
        }
        return nowMs;
      }
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs = 6_000;
  const decision = breaker.beforeRequest();

  assert.equal(reentered, true);
  assert.equal(decision.allowRequest, true);
  assert.equal(decision.snapshot.state, "half-open");
  assert.equal(decision.snapshot.probeInFlight, true);
  assert.equal(decision.snapshot.nextProbeAt, 11_000);
  assert.equal(breaker.getSnapshot().probeInFlight, true);
});

test("figma rest circuit breaker emits transition callbacks in order", () => {
  let nowMs = 2_000;
  const transitions: Array<{ fromState: string; toState: string; trigger: string; atMs: number }> = [];
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 4_000,
    clock: {
      now: () => nowMs
    },
    onStateTransition: (event) => {
      transitions.push({
        fromState: event.fromState,
        toState: event.toState,
        trigger: event.trigger,
        atMs: event.atMs
      });
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 4_000;
  breaker.beforeRequest();
  breaker.recordTransientFailure();

  nowMs += 4_000;
  breaker.beforeRequest();
  breaker.recordSuccess();

  assert.deepEqual(transitions, [
    {
      fromState: "closed",
      toState: "open",
      trigger: "failure-threshold-reached",
      atMs: 2_000
    },
    {
      fromState: "open",
      toState: "half-open",
      trigger: "reset-timeout-elapsed",
      atMs: 6_000
    },
    {
      fromState: "half-open",
      toState: "open",
      trigger: "probe-failed",
      atMs: 6_000
    },
    {
      fromState: "open",
      toState: "half-open",
      trigger: "reset-timeout-elapsed",
      atMs: 10_000
    },
    {
      fromState: "half-open",
      toState: "closed",
      trigger: "probe-succeeded",
      atMs: 10_000
    }
  ]);
});

test("figma rest circuit breaker snapshots remain internally consistent under concurrent callers", async () => {
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
  const decisions = await Promise.all(
    Array.from({ length: 100 }, () => Promise.resolve().then(() => breaker.beforeRequest()))
  );

  const snapshots = decisions.map((decision) => decision.snapshot);
  assert.equal(
    snapshots.every((snapshot) => {
      if (snapshot.state === "closed") {
        return snapshot.probeInFlight === false && snapshot.nextProbeAt === undefined;
      }
      if (snapshot.state === "open") {
        return snapshot.probeInFlight === false && snapshot.nextProbeAt !== undefined;
      }
      return snapshot.probeInFlight === true && snapshot.nextProbeAt !== undefined;
    }),
    true
  );
});

test("figma rest circuit breaker recovers correctly after a full open-halfopen-close cycle", () => {
  let nowMs = 1_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 2,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => nowMs
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  breaker.recordTransientFailure();

  assert.equal(breaker.getSnapshot().state, "open");

  nowMs += 5_000;
  breaker.beforeRequest();
  breaker.recordSuccess();

  assert.equal(breaker.getSnapshot().state, "closed");
  assert.equal(breaker.getSnapshot().consecutiveFailures, 0);

  const decision = breaker.beforeRequest();
  assert.equal(decision.allowRequest, true);
  assert.equal(decision.snapshot.state, "closed");
});

test("figma rest circuit breaker getSnapshot reflects current state without side effects", () => {
  let nowMs = 1_000;
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 1,
    resetTimeoutMs: 5_000,
    clock: {
      now: () => nowMs
    }
  });

  const before = breaker.getSnapshot();
  assert.equal(before.state, "closed");
  assert.equal(before.probeInFlight, false);

  breaker.beforeRequest();
  breaker.recordTransientFailure();

  const afterOpen = breaker.getSnapshot();
  assert.equal(afterOpen.state, "open");
  assert.equal(afterOpen.consecutiveFailures, 1);

  nowMs += 5_000;
  // getSnapshot does NOT trigger the open→half-open transition — only beforeRequest does
  const stillOpen = breaker.getSnapshot();
  assert.equal(stillOpen.state, "open");
});

test("figma rest circuit breaker does not emit transition event for same-state mutations", () => {
  const transitions: Array<{ fromState: string; toState: string }> = [];
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000,
    onStateTransition: (event) => {
      transitions.push({ fromState: event.fromState, toState: event.toState });
    }
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  breaker.recordTransientFailure();

  // Two failures below threshold should not emit any transition
  assert.equal(transitions.length, 0);
  assert.equal(breaker.getSnapshot().state, "closed");
  assert.equal(breaker.getSnapshot().consecutiveFailures, 2);
});

test("figma rest circuit breaker recordSuccess resets failures in closed state", () => {
  const breaker = createFigmaRestCircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 30_000
  });

  breaker.beforeRequest();
  breaker.recordTransientFailure();
  breaker.beforeRequest();
  breaker.recordTransientFailure();

  assert.equal(breaker.getSnapshot().consecutiveFailures, 2);

  breaker.beforeRequest();
  const snapshot = breaker.recordSuccess();

  assert.equal(snapshot.consecutiveFailures, 0);
  assert.equal(snapshot.state, "closed");
});
