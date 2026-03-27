export type FigmaRestCircuitState = "closed" | "open" | "half-open";

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

export const createFigmaRestCircuitBreaker = ({
  failureThreshold,
  resetTimeoutMs,
  clock = DEFAULT_CLOCK
}: {
  failureThreshold: number;
  resetTimeoutMs: number;
  clock?: FigmaRestCircuitBreakerClock;
}): FigmaRestCircuitBreaker => {
  let state: FigmaRestCircuitState = "closed";
  let consecutiveFailures = 0;
  let openedAt: number | undefined;
  let probeInFlight = false;

  const toNextProbeAt = (): number | undefined => {
    if (openedAt === undefined) {
      return undefined;
    }
    return openedAt + resetTimeoutMs;
  };

  const snapshot = (): FigmaRestCircuitBreakerSnapshot => {
    const nextProbeAt = toNextProbeAt();
    return {
      state,
      consecutiveFailures,
      failureThreshold,
      resetTimeoutMs,
      ...(nextProbeAt !== undefined ? { nextProbeAt } : {}),
      probeInFlight
    };
  };

  const reset = (): FigmaRestCircuitBreakerSnapshot => {
    state = "closed";
    consecutiveFailures = 0;
    openedAt = undefined;
    probeInFlight = false;
    return snapshot();
  };

  const open = (): FigmaRestCircuitBreakerSnapshot => {
    state = "open";
    openedAt = clock.now();
    probeInFlight = false;
    return snapshot();
  };

  return {
    beforeRequest: (): FigmaRestCircuitBreakerDecision => {
      if (state === "open") {
        const nextProbeAt = toNextProbeAt();
        if (nextProbeAt !== undefined && clock.now() >= nextProbeAt) {
          state = "half-open";
        }
      }

      if (state === "half-open") {
        if (probeInFlight) {
          return {
            allowRequest: false,
            snapshot: snapshot()
          };
        }

        probeInFlight = true;
        return {
          allowRequest: true,
          snapshot: snapshot()
        };
      }

      if (state === "open") {
        return {
          allowRequest: false,
          snapshot: snapshot()
        };
      }

      return {
        allowRequest: true,
        snapshot: snapshot()
      };
    },
    recordSuccess: (): FigmaRestCircuitBreakerSnapshot => {
      return reset();
    },
    recordTransientFailure: (): FigmaRestCircuitBreakerSnapshot => {
      consecutiveFailures += 1;

      if (state === "half-open" || consecutiveFailures >= failureThreshold) {
        return open();
      }

      probeInFlight = false;
      return snapshot();
    },
    recordNonTransientOutcome: (): FigmaRestCircuitBreakerSnapshot => {
      return reset();
    },
    getSnapshot: (): FigmaRestCircuitBreakerSnapshot => {
      return snapshot();
    }
  };
};
