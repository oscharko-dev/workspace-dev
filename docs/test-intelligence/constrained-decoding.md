# Constrained decoding (Issue #2065)

> Wave 4 quality-and-stability closeout — contract bump
> `TEST_INTELLIGENCE_CONTRACT_VERSION` 1.17.0 → 1.18.0
> (additive; no breaking changes to standard runs).

The constrained-decoding subsystem is the source of truth for how the
LLM gateway delegates JSON-schema enforcement to the upstream provider
(or, for transports without provider-side support, falls back to the
prompt-only path). On the `openai_chat` compatibility mode, both
Outlines-style (FSM-bound, schema reified into a token-level automaton
inside a co-located runtime) and llguidance-style (provider-bound,
schema forwarded verbatim and the upstream grammar engine enforces it)
integrations sit behind the same internal adapter contract.

## Why

Before #2065, the operator config could request `preferredAdapter:
"llguidance"`, but the registry entry returned a hard-coded `ok:
false` for every transport. Every generator and judge call therefore
landed on the prompt-only fallback, which:

- left `polarity` and `category` `null` on the K0 dataset (#2030),
- forced the post-hoc parsing branch in repair-loop that #2036 was
  meant to retire,
- prevented L6 self-consistency multi-sample voting from running on
  schema-stable outputs.

K0 (`scorecards/K0-2026-05-08T18-17-37-630Z.md`) recorded:

```jsonc
"constrainedDecoding": {
  "activeCallCount": 0,
  "adapterId": "prompt_only",
  "enforcement": "prompt_only",
  "fallbackCallCount": 2,
  "fallbackReasons": [
    "llguidance adapter is not yet available on the openai_chat transport; falling back to prompt-only generation"
  ]
}
```

After #2065, the same operator config resolves to:

```jsonc
"constrainedDecoding": {
  "adapterId": "llguidance",
  "enforcement": "provider",
  "activeCallCount": 2,
  "fallbackCallCount": 0,
  "adapterVersion": "1"
}
```

## What ships

- `src/test-intelligence/constrained-decoding/openai-chat-adapter.ts`
  — transport-specific adapter implementations for the openai_chat
  compatibility mode. Exports
  `buildOpenAiChatLlguidanceAdapter`,
  `buildOpenAiChatOutlinesAdapter`, and a deterministic
  `getOpenAiChatAdapter(adapterId)` resolver. Both adapters declare
  `enforcement: "provider"` because the on-the-wire posture is
  identical: the JSON schema is forwarded via
  `response_format: { type: "json_schema", ... }` (and equivalently,
  via tool-calling: a single `function` tool whose `parameters` carry
  the schema, with `tool_choice` pinned). The adapter version is
  surfaced as
  {@link LlmConstrainedDecodingMetadata.adapterVersion} on every
  resolved metadata record.
- `src/test-intelligence/constrained-decoding.ts` — the registry now
  takes the deployment's `compatibilityMode` into account. When the
  preferred adapter id has an openai_chat-bound variant and the
  deployment is reachable via `openai_chat`, the new adapter is used.
  Otherwise the legacy registry entry resolves (e.g.
  `openai_json_schema` for the default path; `prompt_only` for
  transports with no provider-side schema enforcement).
- The graceful fallback for transports that have no constrained mode
  is preserved verbatim — the resolved metadata still carries
  `fallback: true` and a redacted `fallbackReason` that downstream
  FinOps and provenance graphs already consume.

## Adapter selection

Selection is deterministic and runs once per gateway call. There is
no runtime probing or branching:

```
operator config        config.compatibilityMode      resolved adapter
─────────────────      ──────────────────────────    ──────────────────
preferredAdapter:      openai_chat                   openai-chat-bound
  llguidance                                          llguidance
                                                     (enforcement=provider,
                                                      adapterVersion=1)

preferredAdapter:      openai_chat                   openai-chat-bound
  outlines                                            outlines
                                                     (enforcement=provider,
                                                      adapterVersion=1)

preferredAdapter:      openai_chat                   openai_json_schema
  openai_json_schema                                  (legacy registry)

preferredAdapter:      <future-mode>                 fallback adapter
  llguidance                                          (with redacted
                                                      fallbackReason)
```

The schema source of truth comes from
[`src/contracts/index.ts`](../../src/contracts/index.ts). The gateway
derives the JSON-schema artifact at compile time from the
`LlmGenerationRequest.responseSchema` field that the generator and
judge call sites already populate; the openai-chat adapter does not
hand-write schemas.

## Acceptance-criteria coverage

| Criterion (Issue #2065)                                                      | Where                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Transport-specific adapter under the new path                                | [`openai-chat-adapter.ts`](../../src/test-intelligence/constrained-decoding/openai-chat-adapter.ts) |
| Outlines + llguidance integrations behind the same internal contract         | `buildOpenAiChatLlguidanceAdapter` and `buildOpenAiChatOutlinesAdapter`              |
| Automatic adapter selection on openai_chat                                   | `resolveAdapter` in [`constrained-decoding.ts`](../../src/test-intelligence/constrained-decoding.ts) |
| Records `enforcement: "provider"` on the active dataset                      | Adapter `enforcement` field; verified in `constrained-decoding.test.ts`              |
| Adapter version + enforcement recorded per call                              | `adapterVersion` always populated on resolved metadata; FinOps already consumes it   |
| Graceful fallback preserved for transports without constrained mode          | Fallback path in `resolveConstrainedDecodingMetadata`                                |
| Deterministic given fixed seeds                                              | Adapter is a pure value with no per-call state; covered by determinism test          |
| No regression on hard gates G1–G7                                            | Type-check + the existing gateway, repair-loop, and finops test suites               |

## Out of scope

- Cross-cutting refactor of the prompt template registry (handled
  outside this issue).
- Generation-time enforcement of *semantic* invariants — the
  property-based layer (#2040) owns that.
- Streaming-mode constrained decoding. Batch-mode is the source of
  truth for Wave 4; streaming is gated on a separate capability probe.
