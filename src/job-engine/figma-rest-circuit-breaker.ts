export type FigmaRestCircuitState = "closed" | "open" | "half-open";

export type FigmaRestCircuitTransitionTrigger =
  | "failure-threshold-reached"
  | "reset-timeout-elapsed"
  | "probe-failed"
  | "probe-succeeded"
  | "non-transient-outcome";

export interface FigmaRestCircuitBreakerClock {
  now: () => number;
}

export interface FigmaRestCircuitBreakerSnapshot {
  state: FigmaRestCircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  nextProbeAt?: number;
  probeInFlight: boolean;
}

export interface FigmaRestCircuitBreakerDecision {
  allowRequest: boolean;
  snapshot: FigmaRestCircuitBreakerSnapshot;
}

export interface FigmaRestCircuitTransitionEvent {
  fromState: FigmaRestCircuitState;
  toState: FigmaRestCircuitState;
  trigger: FigmaRestCircuitTransitionTrigger;
  atMs: number;
  snapshot: FigmaRestCircuitBreakerSnapshot;
}

export interface FigmaRestCircuitBreaker {
  beforeRequest: () => FigmaRestCircuitBreakerDecision;
  recordSuccess: () => FigmaRestCircuitBreakerSnapshot;
  recordTransientFailure: () => FigmaRestCircuitBreakerSnapshot;
  recordNonTransientOutcome: () => FigmaRestCircuitBreakerSnapshot;
  getSnapshot: () => FigmaRestCircuitBreakerSnapshot;
}

const DEFAULT_CLOCK: FigmaRestCircuitBreakerClock = {
  now: () => Date.now()
};

interface FigmaRestCircuitInternalState {
  state: FigmaRestCircuitState;
  consecutiveFailures: number;
  openedAt: number | undefined;
  probeInFlight: boolean;
  version: number;
}

interface FigmaRestCircuitTransitionResult {
  committed: boolean;
  snapshot: FigmaRestCircuitBreakerSnapshot;
}

export const createFigmaRestCircuitBreaker = ({
  failureThreshold,
  resetTimeoutMs,
  clock = DEFAULT_CLOCK,
  onStateTransition
}: {
  failureThreshold: number;
  resetTimeoutMs: number;
  clock?: FigmaRestCircuitBreakerClock;
  onStateTransition?: (event: FigmaRestCircuitTransitionEvent) => void;
}): FigmaRestCircuitBreaker => {
  let current: FigmaRestCircuitInternalState = {
    state: "closed",
    consecutiveFailures: 0,
    openedAt: undefined,
    probeInFlight: false,
    version: 0
  };

  const toNextProbeAt = (candidate: FigmaRestCircuitInternalState): number | undefined => {
    if (candidate.openedAt === undefined) {
      return undefined;
    }
    return candidate.openedAt + resetTimeoutMs;
  };

  const toSnapshot = (candidate: FigmaRestCircuitInternalState = current): FigmaRestCircuitBreakerSnapshot => {
    const nextProbeAt = toNextProbeAt(candidate);
    return {
      state: candidate.state,
      consecutiveFailures: candidate.consecutiveFailures,
      failureThreshold,
      resetTimeoutMs,
      ...(nextProbeAt !== undefined ? { nextProbeAt } : {}),
      probeInFlight: candidate.probeInFlight
    };
  };

  const transitionTo = ({
    expectedVersion,
    nextState,
    atMs,
    trigger
  }: {
    expectedVersion: number;
    nextState: Omit<FigmaRestCircuitInternalState, "version">;
    atMs?: number;
    trigger?: FigmaRestCircuitTransitionTrigger;
  }): FigmaRestCircuitTransitionResult => {
    if (current.version !== expectedVersion) {
      return {
        committed: false,
        snapshot: toSnapshot()
      };
    }

    const previous = current;
    const stateChanged =
      previous.state !== nextState.state ||
      previous.consecutiveFailures !== nextState.consecutiveFailures ||
      previous.openedAt !== nextState.openedAt ||
      previous.probeInFlight !== nextState.probeInFlight;

    if (!stateChanged) {
      return {
        committed: true,
        snapshot: toSnapshot(previous)
      };
    }

    current = {
      ...nextState,
      version: previous.version + 1
    };

    const snapshot = toSnapshot();
    if (previous.state !== current.state && trigger) {
      onStateTransition?.({
        fromState: previous.state,
        toState: current.state,
        trigger,
        atMs: atMs ?? clock.now(),
        snapshot
      });
    }

    return {
      committed: true,
      snapshot
    };
  };

  const reset = ({
    resolveTrigger
  }: {
    resolveTrigger: (observed: FigmaRestCircuitInternalState) => FigmaRestCircuitTransitionTrigger;
  }): FigmaRestCircuitBreakerSnapshot => {
    for (;;) {
      const observed = current;
      const nowMs = clock.now();
      const transition = transitionTo({
        expectedVersion: observed.version,
        nextState: {
          state: "closed",
          consecutiveFailures: 0,
          openedAt: undefined,
          probeInFlight: false
        },
        atMs: nowMs,
        trigger: resolveTrigger(observed)
      });
      if (transition.committed) {
        return transition.snapshot;
      }
    }
  };

  return {
    beforeRequest: (): FigmaRestCircuitBreakerDecision => {
      for (;;) {
        const observed = current;

        if (observed.state === "open") {
          const nextProbeAt = toNextProbeAt(observed);
          const nowMs = clock.now();
          if (nextProbeAt !== undefined && nowMs >= nextProbeAt) {
            const transition = transitionTo({
              expectedVersion: observed.version,
              nextState: {
                state: "half-open",
                consecutiveFailures: observed.consecutiveFailures,
                openedAt: observed.openedAt,
                probeInFlight: false
              },
              atMs: nowMs,
              trigger: "reset-timeout-elapsed"
            });
            if (!transition.committed) {
              continue;
            }
            // Re-enter the loop to evaluate the new half-open state.
            continue;
          }

          return {
            allowRequest: false,
            snapshot: toSnapshot(observed)
          };
        }

        if (observed.state === "half-open") {
          if (observed.probeInFlight) {
            return {
              allowRequest: false,
              snapshot: toSnapshot(observed)
            };
          }

          const transition = transitionTo({
            expectedVersion: observed.version,
            nextState: {
              state: observed.state,
              consecutiveFailures: observed.consecutiveFailures,
              openedAt: observed.openedAt,
              probeInFlight: true
            }
          });
          if (!transition.committed) {
            continue;
          }
          return {
            allowRequest: true,
            snapshot: transition.snapshot
          };
        }

        return {
          allowRequest: true,
          snapshot: toSnapshot(observed)
        };
      }
    },
    recordSuccess: (): FigmaRestCircuitBreakerSnapshot => {
      return reset({
        resolveTrigger: (observed) => (observed.state === "half-open" ? "probe-succeeded" : "non-transient-outcome")
      });
    },
    recordTransientFailure: (): FigmaRestCircuitBreakerSnapshot => {
      for (;;) {
        const observed = current;
        const consecutiveFailures = observed.consecutiveFailures + 1;

        if (observed.state === "half-open") {
          const nowMs = clock.now();
          const transition = transitionTo({
            expectedVersion: observed.version,
            nextState: {
              state: "open",
              consecutiveFailures,
              openedAt: nowMs,
              probeInFlight: false
            },
            atMs: nowMs,
            trigger: "probe-failed"
          });
          if (transition.committed) {
            return transition.snapshot;
          }
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
              probeInFlight: false
            },
            atMs: nowMs,
            trigger: "failure-threshold-reached"
          });
          if (transition.committed) {
            return transition.snapshot;
          }
          continue;
        }

        const transition = transitionTo({
          expectedVersion: observed.version,
          nextState: {
            state: observed.state,
            consecutiveFailures,
            openedAt: observed.openedAt,
            probeInFlight: false
          }
        });
        if (transition.committed) {
          return transition.snapshot;
        }
      }
    },
    recordNonTransientOutcome: (): FigmaRestCircuitBreakerSnapshot => {
      return reset({
        resolveTrigger: () => "non-transient-outcome"
      });
    },
    getSnapshot: (): FigmaRestCircuitBreakerSnapshot => {
      return toSnapshot();
    }
  };
};
