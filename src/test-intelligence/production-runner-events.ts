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
import type {
  Attributes,
  AttributeValue,
  Meter,
  Tracer,
} from "@opentelemetry/api";

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
  "cache_break",
  "replay_cache_hit",
  "cancelled",
  "repair_loop_iteration",
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

export interface ProductionRunnerOpenTelemetrySinkOptions {
  tracer?: Tracer;
  meter?: Meter;
}

export const PRODUCTION_RUNNER_OTEL_SPAN_NAME_PREFIX =
  "workspace.test_intelligence.production_runner";
export const PRODUCTION_RUNNER_OTEL_PHASE_COUNTER_NAME =
  "workspace.test_intelligence.production_runner.phase_total";

type ProductionRunnerOtelSeverity = "info" | "warn" | "error";
type ProductionRunnerOtelAgentRole =
  | "pipeline"
  | "test_generation"
  | "visual_generation"
  | "repair_loop";

interface ProductionRunnerOtelContext {
  readonly modelDeployment: string;
  readonly promptHash: string;
  readonly verdict: string;
  readonly attemptNo: number;
}

const DEFAULT_OTEL_CONTEXT: ProductionRunnerOtelContext = {
  modelDeployment: "none",
  promptHash: "none",
  verdict: "pending",
  attemptNo: 1,
};

const primitiveToAttribute = (
  value: ProductionRunnerEventDetailValue,
): AttributeValue | undefined => {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const serialized = value.flatMap((entry) => {
      if (
        typeof entry === "string" ||
        typeof entry === "number" ||
        typeof entry === "boolean"
      ) {
        return [String(entry)];
      }
      return [];
    });
    return serialized.length > 0 ? serialized : undefined;
  }
  return undefined;
};

const toAttemptNo = (
  value: ProductionRunnerEventDetailValue | undefined,
): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.trunc(value));
  }
  if (value === "a") return 1;
  if (value === "b") return 2;
  return undefined;
};

const toVerdict = (
  value: ProductionRunnerEventDetailValue | undefined,
): string | undefined => {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "accepted" : "blocked";
  }
  return undefined;
};

const resolveAgentRole = (
  phase: ProductionRunnerEventPhase,
): ProductionRunnerOtelAgentRole => {
  if (
    phase === "visual_sidecar_started" ||
    phase === "visual_sidecar_complete" ||
    phase === "visual_sidecar_skipped"
  ) {
    return "visual_generation";
  }
  if (phase === "repair_loop_iteration") {
    return "repair_loop";
  }
  if (
    phase === "prompt_compiled" ||
    phase === "llm_gateway_request" ||
    phase === "llm_gateway_response" ||
    phase === "replay_cache_hit" ||
    phase === "cancelled" ||
    phase === "validation_started" ||
    phase === "validation_complete" ||
    phase === "policy_decision" ||
    phase === "export_started" ||
    phase === "export_complete" ||
    phase === "evidence_sealed" ||
    phase === "finops_recorded"
  ) {
    return "test_generation";
  }
  return "pipeline";
};

const resolveSeverity = (
  event: ProductionRunnerEvent,
): ProductionRunnerOtelSeverity => {
  if (event.phase === "cancelled") return "warn";
  if (
    event.phase === "visual_sidecar_complete" &&
    event.details?.outcome === "refusal"
  ) {
    return "warn";
  }
  if (
    event.phase === "llm_gateway_response" &&
    typeof event.details?.outcome === "string" &&
    event.details.outcome !== "success"
  ) {
    return "error";
  }
  if (
    (event.phase === "validation_complete" || event.phase === "policy_decision") &&
    event.details?.blocked === true
  ) {
    return "warn";
  }
  if (event.phase === "repair_loop_iteration") return "warn";
  return "info";
};

const nextOtelContext = (
  previous: ProductionRunnerOtelContext,
  event: ProductionRunnerEvent,
): ProductionRunnerOtelContext => {
  const promptHash =
    typeof event.details?.promptHash === "string"
      ? event.details.promptHash
      : previous.promptHash;
  const modelDeployment =
    (typeof event.details?.selectedDeployment === "string"
      ? event.details.selectedDeployment
      : undefined) ??
    (typeof event.details?.deployment === "string"
      ? event.details.deployment
      : undefined) ??
    previous.modelDeployment;
  const verdict =
    toVerdict(event.details?.verdict) ??
    (event.phase === "policy_decision"
      ? event.details?.blocked === true
        ? "blocked"
        : event.details?.blocked === false
          ? "accepted"
          : undefined
      : undefined) ??
    (event.phase === "visual_sidecar_complete"
      ? toVerdict(event.details?.outcome)
      : undefined) ??
    (event.phase === "llm_gateway_response"
      ? toVerdict(event.details?.outcome)
      : undefined) ??
    previous.verdict;
  const attemptNo =
    toAttemptNo(event.details?.attemptNo) ??
    toAttemptNo(event.details?.iteration) ??
    toAttemptNo(event.details?.passId) ??
    previous.attemptNo;
  return {
    modelDeployment,
    promptHash,
    verdict,
    attemptNo,
  };
};

export const createProductionRunnerOpenTelemetrySink = (
  options: ProductionRunnerOpenTelemetrySinkOptions,
): ProductionRunnerEventSink | undefined => {
  if (options.tracer === undefined && options.meter === undefined) {
    return undefined;
  }
  const phaseCounter =
    options.meter?.createCounter(PRODUCTION_RUNNER_OTEL_PHASE_COUNTER_NAME, {
      description:
        "Count of emitted test-intelligence production-runner pipeline phase events.",
      unit: "{event}",
    }) ?? undefined;
  let context = DEFAULT_OTEL_CONTEXT;
  return (event) => {
    context = nextOtelContext(context, event);
    const attributes: Attributes = {
      "workspace.test_intelligence.phase": event.phase,
      "workspace.test_intelligence.severity": resolveSeverity(event),
      "workspace.test_intelligence.agent_role": resolveAgentRole(event.phase),
      "workspace.test_intelligence.model_deployment": context.modelDeployment,
      "workspace.test_intelligence.prompt_hash": context.promptHash,
      "workspace.test_intelligence.verdict": context.verdict,
      "workspace.test_intelligence.attempt_no": context.attemptNo,
    };
    for (const [key, value] of Object.entries(event.details ?? {})) {
      const attributeValue = primitiveToAttribute(value);
      if (attributeValue === undefined) continue;
      attributes[`workspace.test_intelligence.event.${key}`] = attributeValue;
    }

    if (options.tracer !== undefined) {
      const span = options.tracer.startSpan(
        `${PRODUCTION_RUNNER_OTEL_SPAN_NAME_PREFIX}.${event.phase}`,
        {
          attributes,
          startTime: event.timestamp,
        },
      );
      span.end(event.timestamp);
    }
    phaseCounter?.add(1, attributes);
  };
};

export const composeProductionRunnerEventSinks = (
  ...sinks: Array<ProductionRunnerEventSink | undefined>
): ProductionRunnerEventSink | undefined => {
  const activeSinks = sinks.filter(
    (sink): sink is ProductionRunnerEventSink => sink !== undefined,
  );
  if (activeSinks.length === 0) return undefined;
  return (event) => {
    for (const sink of activeSinks) {
      sink(event);
    }
  };
};

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
    return (value as ReadonlyArray<ProductionRunnerEventDetailValue>).map((entry) => stripUndefined(entry));
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
