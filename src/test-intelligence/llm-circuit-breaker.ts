/**
 * Circuit breaker for outbound LLM gateway requests (Issue #1363).
 *
 * Mirrors the algorithm in `src/job-engine/figma-rest-circuit-breaker.ts`
 * but is owned by the test-intelligence subsurface so the gateway clients
 * do not depend on the Figma pipeline. Three states:
 *
 *   - `closed`     — pass requests through.
 *   - `open`       — reject requests until the reset timeout has elapsed.
 *   - `half_open`  — admit a single in-flight probe; success closes, failure
 *                    re-opens.
 *
 * Only transient/transport failures (timeout, transport, rate limit) feed
 * `recordTransientFailure`. Refusals, schema-invalid responses, and the
 * image-payload guard rejection are policy outcomes and reset the breaker
 * via `recordNonTransientOutcome` so a misbehaving caller cannot trip the
 * breaker and starve other roles.
 */

export type LlmCircuitState = "closed" | "open" | "half_open";

export type LlmCircuitTransitionTrigger =
  | "failure_threshold_reached"
  | "reset_timeout_elapsed"
  | "probe_failed"
  | "probe_succeeded"
  | "non_transient_outcome";

export interface LlmCircuitClock {
  now: () => number;
}

export interface LlmCircuitSnapshot {
  state: LlmCircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  nextProbeAt?: number;
  probeInFlight: boolean;
}

export interface LlmCircuitDecision {
  allowRequest: boolean;
  snapshot: LlmCircuitSnapshot;
}

export interface LlmCircuitTransitionEvent {
  fromState: LlmCircuitState;
  toState: LlmCircuitState;
  trigger: LlmCircuitTransitionTrigger;
  atMs: number;
  snapshot: LlmCircuitSnapshot;
}

export interface LlmCircuitBreaker {
  beforeRequest: () => LlmCircuitDecision;
  recordSuccess: () => LlmCircuitSnapshot;
  recordTransientFailure: () => LlmCircuitSnapshot;
  recordNonTransientOutcome: () => LlmCircuitSnapshot;
  getSnapshot: () => LlmCircuitSnapshot;
}

const DEFAULT_CLOCK: LlmCircuitClock = {
  now: () => Date.now(),
};

interface InternalState {
  state: LlmCircuitState;
  consecutiveFailures: number;
  openedAt: number | undefined;
  probeInFlight: boolean;
  version: number;
}

interface TransitionResult {
  committed: boolean;
  snapshot: LlmCircuitSnapshot;
}

export const createLlmCircuitBreaker = ({
  failureThreshold,
  resetTimeoutMs,
  clock = DEFAULT_CLOCK,
  onStateTransition,
}: {
  failureThreshold: number;
  resetTimeoutMs: number;
  clock?: LlmCircuitClock;
  onStateTransition?: (event: LlmCircuitTransitionEvent) => void;
}): LlmCircuitBreaker => {
  if (!Number.isInteger(failureThreshold) || failureThreshold < 1) {
    throw new RangeError(
      "createLlmCircuitBreaker: failureThreshold must be a positive integer",
    );
  }
  if (!Number.isFinite(resetTimeoutMs) || resetTimeoutMs < 0) {
    throw new RangeError(
      "createLlmCircuitBreaker: resetTimeoutMs must be a non-negative finite number",
    );
  }

  let current: InternalState = {
    state: "closed",
    consecutiveFailures: 0,
    openedAt: undefined,
    probeInFlight: false,
    version: 0,
  };

  const toNextProbeAt = (candidate: InternalState): number | undefined => {
    if (candidate.openedAt === undefined) return undefined;
    return candidate.openedAt + resetTimeoutMs;
  };

  const toSnapshot = (
    candidate: InternalState = current,
  ): LlmCircuitSnapshot => {
    const nextProbeAt = toNextProbeAt(candidate);
    return {
      state: candidate.state,
      consecutiveFailures: candidate.consecutiveFailures,
      failureThreshold,
      resetTimeoutMs,
      ...(nextProbeAt !== undefined ? { nextProbeAt } : {}),
      probeInFlight: candidate.probeInFlight,
    };
  };

  const transitionTo = ({
    expectedVersion,
    nextState,
    atMs,
    trigger,
  }: {
    expectedVersion: number;
    nextState: Omit<InternalState, "version">;
    atMs?: number;
    trigger?: LlmCircuitTransitionTrigger;
  }): TransitionResult => {
    if (current.version !== expectedVersion) {
      return { committed: false, snapshot: toSnapshot() };
    }
    const previous = current;
    const stateChanged =
      previous.state !== nextState.state ||
      previous.consecutiveFailures !== nextState.consecutiveFailures ||
      previous.openedAt !== nextState.openedAt ||
      previous.probeInFlight !== nextState.probeInFlight;
    if (!stateChanged) {
      return { committed: true, snapshot: toSnapshot(previous) };
    }
    current = { ...nextState, version: previous.version + 1 };
    const snapshot = toSnapshot();
    if (previous.state !== current.state && trigger) {
      onStateTransition?.({
        fromState: previous.state,
        toState: current.state,
        trigger,
        atMs: atMs ?? clock.now(),
        snapshot,
      });
    }
    return { committed: true, snapshot };
  };

  const reset = ({
    resolveTrigger,
  }: {
    resolveTrigger: (observed: InternalState) => LlmCircuitTransitionTrigger;
  }): LlmCircuitSnapshot => {
    for (;;) {
      const observed = current;
      const nowMs = clock.now();
      const transition = transitionTo({
        expectedVersion: observed.version,
        nextState: {
          state: "closed",
          consecutiveFailures: 0,
          openedAt: undefined,
          probeInFlight: false,
        },
        atMs: nowMs,
        trigger: resolveTrigger(observed),
      });
      if (transition.committed) return transition.snapshot;
    }
  };

  return {
    beforeRequest: (): LlmCircuitDecision => {
      for (;;) {
        const observed = current;

        if (observed.state === "open") {
          const nextProbeAt = toNextProbeAt(observed);
          const nowMs = clock.now();
          if (nextProbeAt !== undefined && nowMs >= nextProbeAt) {
            const transition = transitionTo({
              expectedVersion: observed.version,
              nextState: {
                state: "half_open",
                consecutiveFailures: observed.consecutiveFailures,
                openedAt: observed.openedAt,
                probeInFlight: false,
              },
              atMs: nowMs,
              trigger: "reset_timeout_elapsed",
            });
            if (!transition.committed) continue;
            continue;
          }
          return { allowRequest: false, snapshot: toSnapshot(observed) };
        }

        if (observed.state === "half_open") {
          if (observed.probeInFlight) {
            return { allowRequest: false, snapshot: toSnapshot(observed) };
          }
          const transition = transitionTo({
            expectedVersion: observed.version,
            nextState: {
              state: observed.state,
              consecutiveFailures: observed.consecutiveFailures,
              openedAt: observed.openedAt,
              probeInFlight: true,
            },
          });
          if (!transition.committed) continue;
          return { allowRequest: true, snapshot: transition.snapshot };
        }

        return { allowRequest: true, snapshot: toSnapshot(observed) };
      }
    },
    recordSuccess: (): LlmCircuitSnapshot => {
      return reset({
        resolveTrigger: (observed) =>
          observed.state === "half_open"
            ? "probe_succeeded"
            : "non_transient_outcome",
      });
    },
    recordTransientFailure: (): LlmCircuitSnapshot => {
      for (;;) {
        const observed = current;
        const consecutiveFailures = observed.consecutiveFailures + 1;

        if (observed.state === "half_open") {
          const nowMs = clock.now();
          const transition = transitionTo({
            expectedVersion: observed.version,
            nextState: {
              state: "open",
              consecutiveFailures,
              openedAt: nowMs,
              probeInFlight: false,
            },
            atMs: nowMs,
            trigger: "probe_failed",
          });
          if (transition.committed) return transition.snapshot;
          continue;
        }

        if (consecutiveFailures >= failureThreshold) {
          const nowMs = clock.now();
          const transition = transitionTo({
            expectedVersion: observed.version,
            nextState: {
              state: "open",
              consecutiveFailures,
              openedAt: nowMs,
              probeInFlight: false,
            },
            atMs: nowMs,
            trigger: "failure_threshold_reached",
          });
          if (transition.committed) return transition.snapshot;
          continue;
        }

        const transition = transitionTo({
          expectedVersion: observed.version,
          nextState: {
            state: observed.state,
            consecutiveFailures,
            openedAt: observed.openedAt,
            probeInFlight: false,
          },
        });
        if (transition.committed) return transition.snapshot;
      }
    },
    recordNonTransientOutcome: (): LlmCircuitSnapshot => {
      return reset({ resolveTrigger: () => "non_transient_outcome" });
    },
    getSnapshot: (): LlmCircuitSnapshot => toSnapshot(),
  };
};
