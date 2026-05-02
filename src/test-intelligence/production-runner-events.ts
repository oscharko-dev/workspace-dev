/**
 * Production-runner progress event taxonomy (Issue #1738).
 *
 * The runner emits typed events at every phase boundary so consumers
 * (request handler, UI timeline, audit recorder) can render real-time
 * progress without reaching into runner internals. Events carry only
 * non-PII, non-secret metadata — token counts, monotonic timestamps,
 * deployment names, validation summaries — and never raw LLM bodies or
 * Figma payloads.
 *
 * The event channel is local to the in-process runner; it is exposed
 * over the wire by the SSE route in `production-runner-events-route.ts`
 * which subscribes to a per-job in-memory event bus.
 */

/**
 * The closed set of phase identifiers a runner emits. Adding a new phase
 * is a contract change — bump CONTRACT_VERSION.
 */
export const PRODUCTION_RUNNER_EVENT_PHASES = [
  "intent_derivation_started",
  "intent_derivation_complete",
  "visual_sidecar_started",
  "visual_sidecar_skipped",
  "visual_sidecar_complete",
  "prompt_compiled",
  "llm_gateway_request",
  "llm_gateway_response",
  "validation_started",
  "validation_complete",
  "policy_decision",
  "export_started",
  "export_complete",
  "evidence_sealed",
  "finops_recorded",
] as const;

export type ProductionRunnerEventPhase =
  (typeof PRODUCTION_RUNNER_EVENT_PHASES)[number];

/**
 * Detail payload allowed on a runner event. Only primitives, plain
 * arrays, and plain records — no class instances, no functions, no
 * `unknown`. The serializer (`serializeRunnerEvent`) walks the payload
 * and rejects anything that wouldn't survive `JSON.stringify`.
 */
export type ProductionRunnerEventDetailValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<ProductionRunnerEventDetailValue>
  | { readonly [key: string]: ProductionRunnerEventDetailValue };

export interface ProductionRunnerEvent {
  /** Phase identifier — see {@link PRODUCTION_RUNNER_EVENT_PHASES}. */
  phase: ProductionRunnerEventPhase;
  /**
   * Monotonic timestamp in milliseconds (resolution: 1 ms). Suitable
   * for elapsed-time math; NOT a wall-clock epoch.
   */
  timestamp: number;
  /**
   * Optional non-PII details. Caller is responsible for not putting
   * raw LLM bodies, Figma payloads, secrets, or operator input here —
   * the runner only emits aggregated counts and discrete enums.
   */
  details?: { readonly [key: string]: ProductionRunnerEventDetailValue };
}

/**
 * Sink callback. Called synchronously from the runner pipeline; throws
 * propagate to the caller. UI consumers should swallow + log their own
 * errors (the runner should not be liable for sink misbehaviour).
 */
export type ProductionRunnerEventSink = (event: ProductionRunnerEvent) => void;

/**
 * Serialize an event to a JSON string suitable for an SSE `data:` line.
 * Strips `undefined` values and produces stable key ordering so two
 * runs of the same event produce byte-identical payloads.
 */
export const serializeRunnerEvent = (event: ProductionRunnerEvent): string => {
  const cleanDetails =
    event.details === undefined ? undefined : stripUndefined(event.details);
  const ordered: Record<string, unknown> = {
    phase: event.phase,
    timestamp: event.timestamp,
  };
  if (cleanDetails !== undefined) ordered.details = cleanDetails;
  return JSON.stringify(ordered);
};

const stripUndefined = (
  value: ProductionRunnerEventDetailValue,
): ProductionRunnerEventDetailValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, ProductionRunnerEventDetailValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, ProductionRunnerEventDetailValue>)[
        key
      ];
      if (entry === undefined) continue;
      out[key] = stripUndefined(entry);
    }
    return out;
  }
  return value;
};

/**
 * Per-job in-memory event bus. Subscribers receive every event emitted
 * to a given jobId. Bounded — drops the oldest event when the buffer is
 * full so the bus cannot OOM the server under a stuck consumer.
 */
export interface RunnerEventBus {
  publish(jobId: string, event: ProductionRunnerEvent): void;
  subscribe(jobId: string, listener: ProductionRunnerEventSink): () => void;
  /** Snapshot of the events buffered for a job (for late subscribers). */
  snapshot(jobId: string): ReadonlyArray<ProductionRunnerEvent>;
  /** Drop a job's buffered events (after final state). */
  evict(jobId: string): void;
}

/** Maximum events buffered per job before the oldest is evicted. */
export const RUNNER_EVENT_BUS_BUFFER_LIMIT = 256 as const;

/** Create a fresh in-memory event bus. */
export const createRunnerEventBus = (): RunnerEventBus => {
  const buffers = new Map<string, ProductionRunnerEvent[]>();
  const listeners = new Map<string, Set<ProductionRunnerEventSink>>();
  return {
    publish(jobId, event) {
      let buffer = buffers.get(jobId);
      if (buffer === undefined) {
        buffer = [];
        buffers.set(jobId, buffer);
      }
      buffer.push(event);
      if (buffer.length > RUNNER_EVENT_BUS_BUFFER_LIMIT) {
        buffer.shift();
      }
      const subscriberSet = listeners.get(jobId);
      if (subscriberSet === undefined) return;
      for (const listener of subscriberSet) {
        try {
          listener(event);
        } catch {
          // Listener misbehaviour must not corrupt other listeners.
        }
      }
    },
    subscribe(jobId, listener) {
      let subscriberSet = listeners.get(jobId);
      if (subscriberSet === undefined) {
        subscriberSet = new Set();
        listeners.set(jobId, subscriberSet);
      }
      subscriberSet.add(listener);
      return () => {
        const set = listeners.get(jobId);
        if (set === undefined) return;
        set.delete(listener);
        if (set.size === 0) listeners.delete(jobId);
      };
    },
    snapshot(jobId) {
      return buffers.get(jobId) ?? [];
    },
    evict(jobId) {
      buffers.delete(jobId);
      listeners.delete(jobId);
    },
  };
};
