# Test-Intelligence Observability Contract

Issue #1945 adds an optional, operator-supplied OpenTelemetry sink to the
test-intelligence production runner. The default remains zero telemetry:
the runner emits no spans, metrics, exports, beacons, or network traffic
unless the operator passes an `otelTracer` and/or `otelMeter` into
`runFigmaToQcTestCases(...)`.

## Scope

- Covered surface: `src/test-intelligence/production-runner.ts`
- Trigger: each emitted `ProductionRunnerEventPhase`
- Opt-in only: the runner never constructs an exporter, provider, or network
  client on its own

## Span names

Each phase emits a span named:

`workspace.test_intelligence.production_runner.<phase>`

The `<phase>` token is one of the stable `ProductionRunnerEventPhase`
identifiers:

- `intent_derivation_started`
- `intent_derivation_complete`
- `visual_sidecar_started`
- `visual_sidecar_skipped`
- `visual_sidecar_complete`
- `prompt_compiled`
- `llm_gateway_request`
- `llm_gateway_response`
- `validation_started`
- `validation_complete`
- `policy_decision`
- `export_started`
- `export_complete`
- `evidence_sealed`
- `finops_recorded`
- `cache_break`
- `replay_cache_hit`
- `cancelled`
- `repair_loop_iteration`

## Metric name

When `otelMeter` is supplied, the runner increments a counter for every phase:

`workspace.test_intelligence.production_runner.phase_total`

Unit: `{event}`

## Stable attributes

Every emitted span and counter increment carries the following stable
attributes:

- `workspace.test_intelligence.phase`
- `workspace.test_intelligence.severity`
- `workspace.test_intelligence.agent_role`
- `workspace.test_intelligence.model_deployment`
- `workspace.test_intelligence.prompt_hash`
- `workspace.test_intelligence.verdict`
- `workspace.test_intelligence.attempt_no`

Attribute semantics:

- `workspace.test_intelligence.phase`
  The exact `ProductionRunnerEventPhase` value.
- `workspace.test_intelligence.severity`
  One of `info`, `warn`, or `error` per the mapping below.
- `workspace.test_intelligence.agent_role`
  One of `pipeline`, `test_generation`, `visual_generation`, or
  `repair_loop`.
- `workspace.test_intelligence.model_deployment`
  The most recently resolved deployment id for the active pipeline branch.
  Before a model is known, the value is `none`.
- `workspace.test_intelligence.prompt_hash`
  The most recently resolved compiled prompt hash. Before prompt compilation,
  the value is `none`.
- `workspace.test_intelligence.verdict`
  The most recently resolved pipeline verdict. Initial value: `pending`.
  Later spans may carry values such as `success`, `refusal`, `accepted`,
  `blocked`, or a judge verdict surfaced by the repair loop.
- `workspace.test_intelligence.attempt_no`
  The current 1-based attempt index. The initial generation path starts at
  `1`; diversity pass `b` maps to `2`; repair-loop iterations surface their
  own iteration numbers.

## Event detail attributes

Primitive event details are mirrored as additional attributes under:

`workspace.test_intelligence.event.<detail_key>`

Examples:

- `workspace.test_intelligence.event.blocked`
- `workspace.test_intelligence.event.deployment`
- `workspace.test_intelligence.event.outputTokens`
- `workspace.test_intelligence.event.refusalCode`

Only primitive values and primitive arrays are mirrored. Nested objects are
not flattened into telemetry attributes.

## Severity mapping

- Default severity: `info`
- `warn`
  - `cancelled`
  - `repair_loop_iteration`
  - `visual_sidecar_complete` when `outcome=refusal`
  - `validation_complete` when `blocked=true`
  - `policy_decision` when `blocked=true`
- `error`
  - `llm_gateway_response` when `outcome != success`

## Zero-telemetry guarantee

- No spans are started when `otelTracer` is omitted.
- No counters are incremented when `otelMeter` is omitted.
- No exporter dependency is bundled by the runner.
- The runner swallows sink failures the same way it swallows legacy progress
  sink failures, so observability hooks cannot crash the pipeline.
