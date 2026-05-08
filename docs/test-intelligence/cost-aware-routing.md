# Cost-aware smart routing for tiered model deployments

> Issue [#2043](https://github.com/oscharko-dev/workspace-dev/issues/2043) —
> Test Intelligence 2026-Q3 Innovation Roadmap, Wave-3 Specialization.

The cost-aware routing layer classifies each task in the multi-agent
workflow into a complexity tier (`tier-low`, `tier-mid`, `tier-high`)
and routes it to the appropriate model deployment for that tier. The
goal is a **>= 50%** reduction in LLM cost compared to the
"every task on the flagship" baseline, with a hard quality guard that
fails CI if a sampled tier-low subset regresses.

## Why

The static `agent-role-profile.ts` matrix binds each role to a fixed
deployment regardless of the difficulty of the input. A trivial label
validation call uses the same model as a multi-step calculation
inference. For SaaS deployments that generate thousands of cases per
portfolio, this is the difference between viable per-run unit cost and
"internal tool only".

## Architecture

```
                 ┌─────────────────────────────┐
   task input → │      task_classifier        │  (deterministic, zero LLM)
                 │   classifyTask(input)       │
                 └──────────────┬──────────────┘
                                │
                                ▼
                 TaskClassificationDecision
                 { tier, rationale, signals } 
                                │
                                ▼
                 ┌─────────────────────────────┐
                 │       routing-table         │
                 │  resolveRoutingBinding(...) │
                 └──────────────┬──────────────┘
                                │
                                ▼
                 AgentModelBinding
                 { providerId, modelId, family, region }
                                │
                                ▼
                       (existing gateway)
```

Three new modules and one extension to an existing artifact ship the
feature:

| Module | Role |
| --- | --- |
| [`task-classifier-agent.ts`](../../src/test-intelligence/task-classifier-agent.ts) | Deterministic classifier — maps input signals to a tier + rationale. |
| [`routing-table.ts`](../../src/test-intelligence/routing-table.ts) | Tier-to-deployment routing table per environment + profile. |
| [`routing-savings-report.ts`](../../src/test-intelligence/routing-savings-report.ts) | Pre- vs post-routing cost report (the auditable savings number). |
| [`cost-routing-quality-sampler.ts`](../../src/test-intelligence/cost-routing-quality-sampler.ts) | Wave-2 cross-family judge sampling for tier-low quality regression. |
| [`agent-participation.ts`](../../src/test-intelligence/agent-participation.ts) (extended) | Persists routing decisions in `agent-participation.json`. |

The classifier is implemented as a `deterministic_service` in the
style of the [`compliance_annotator`](./compliance-as-code.md), so the
harness's hard invariants on `AgentHarnessRole` profiles remain
unchanged. The registered identifier is `task_classifier`.

## Tiers

| Tier | Default purpose | Default deployment (eu-banking-default) | Default deployment (standard-default) |
| --- | --- | --- | --- |
| `tier-low` | Simple UI validation, label checks, small assertions. | `phi-4` (in-house) | `claude-haiku-4-5-20251001` |
| `tier-mid` | Standard business logic, judges, vision sidecars, repair planning. | `gpt-oss-120b` (in-house) | `claude-sonnet-4-6` |
| `tier-high` | Regulatory inference, complex calculation, audit-grade reasoning. | `gpt-oss-120b` (in-house) | `claude-opus-4-7` |

Tiers are ordered from cheapest to most capable; consumers that need
a max-tier comparison can rely on `compareTaskComplexityTier` and
`maxTaskComplexityTier`.

## Classification rules

The classifier is a deterministic ruleset (no LLM call — the
"classifier itself runs at tier-low" requirement is satisfied by
running zero LLM cost). Inputs are signal flags + token estimates;
outputs carry a one-line rationale.

| Signal | Effect |
| --- | --- |
| `taskKind = "simple_ui_validation"` + small input tokens | `tier-low` |
| `taskKind = "standard_business_logic"` | `tier-mid` |
| `taskKind = "complex_calculation"` | force `tier-high` |
| `taskKind = "regulatory_inference"` | force `tier-high` |
| `isRegulatoryInference: true` | force `tier-high` |
| `isCalculationLogic: true` | force `tier-high` |
| `hasVisualInput: true` | escalate to `≥ tier-mid` |
| `estimatedInputTokens > 16,000` | escalate to `≥ tier-mid` |
| `estimatedOutputTokens > 4,000` | escalate to `≥ tier-mid` |
| `constrainedDecodingAvailable: false` | never pick `tier-low` |

When a task carries conflicting signals, the classifier picks the
*higher* tier so a regulatory check is never silently routed to a
cheap model. The savings target is hit by the bulk of tier-low
traffic, not by trimming high-stakes calls.

## Routing tables

Three default routing tables ship in-tree:

- `eu-banking-default` — EU-resident, in-house only. Every binding has
  `region: "eu"`; `validateEuResidencyConstraint` enforces this.
- `standard-default` — Anthropic Haiku/Sonnet/Opus tiering for
  global deployments.
- `permissive-default` — OpenAI gpt-4o-mini / gpt-4o.

Each table has one entry per environment (`dev`, `staging`, `prod`)
and one binding per tier. Operators can override any binding by
passing a custom table to `resolveRoutingBinding`:

```ts
import {
  cloneRoutingTable,
  freezeRoutingTableExternal,
  EU_BANKING_DEFAULT_ROUTING_TABLE,
  resolveRoutingBinding,
} from "@workspace/test-intelligence";

const custom = cloneRoutingTable(EU_BANKING_DEFAULT_ROUTING_TABLE);
custom.environments.prod["tier-low"] = {
  providerId: "in-house",
  modelId: "phi-4-mini",
  region: "eu",
};
const table = freezeRoutingTableExternal(custom);
```

The table can be passed environment-by-environment so the same
profile can resolve to different deployments in `dev` / `staging` /
`prod`.

## Composition with constrained decoding (B.2)

Tier-low deployments often have weaker schema adherence. The
classifier exposes a `constrainedDecodingAvailable` flag — when set
to `false` the classifier never selects `tier-low`, so the routing
layer composes cleanly with the project's existing constrained
decoding adapters (`openai_json_schema`, `outlines`, …). The default
is `true`; production deployments must keep constrained decoding
enabled when running `tier-low`.

## Persistence

Routing decisions are stored in the run's
[`agent-participation.json`](../../src/test-intelligence/agent-participation.ts)
under `routingDecisions`. The schema version was bumped from `1.0.0`
to `1.1.0` for this addition; the field is optional, so legacy runs
without classification keep their byte-shape.

```json
{
  "schemaVersion": "1.1.0",
  "contractVersion": "1.16.0",
  "jobId": "job-...",
  "generatedAt": "2026-05-08T00:00:00Z",
  "roles": [...],
  "routingDecisions": [
    {
      "taskId": "t-1",
      "tier": "tier-low",
      "resolvedTaskKind": "simple_ui_validation",
      "rationale": "task_kind=simple_ui_validation tier=tier-low via=simpleUiValidation+smallTokens→tier-low",
      "classifierVersion": "1.0.0",
      "classifierRoleId": "task_classifier",
      "signals": ["taskKind=simple_ui_validation", "baseTier=tier-low", "simpleUiValidation+smallTokens→tier-low"]
    }
  ]
}
```

The pre- vs post-routing cost report is persisted separately at
`<runDir>/finops/routing-savings-report.json` so an auditor can
reconcile per-tier savings without reading the FinOps usage block.

## Quality guard

The cost win must not come at the price of quality. The
`cost-routing-quality-sampler` module ships:

1. `sampleTierLowDecisions({ decisions, sampleRate, seed })` — pick a
   deterministic sample of tier-low decisions for re-judging. The
   default sample rate is 10%.
2. `evaluateTierLowRegression({ verdicts, tolerance, threshold })` —
   compare baseline (higher-tier) and routed (tier-low) scores;
   compute a regression rate; produce a structured report.
3. `assertRoutingQualityNotRegressed(report)` — CI-gate convenience.
   Throws when the regression rate is above the configured threshold.

Default tolerance and threshold are both `0.05` (5 quality points,
5% regression rate).

The sampler is wired to the existing Wave-2 cross-family judge
panel via the operator-side integration (the project's
`cross-family-judge-policy.ts`). The sampler does not pick judges
itself — that responsibility stays with the existing policy module so
the family-diversity guarantees keep their single source of truth.

## CI gates

The feature ships two CI gates beyond the existing G1–G7:

- **Savings gate** — `assertRoutingSavingsAtLeast(report, 0.5)` fails
  the run when the realised savings are below 50%.
- **Quality gate** — `assertRoutingQualityNotRegressed(report)` fails
  the run when the tier-low regression rate strictly exceeds 5%.

Operators wire these into their per-run pipeline; both helpers throw
with self-explanatory messages so a failure is actionable directly
from the CI log.

## Out of scope

- Per-token streaming routing (the decision is per call, not
  per token).
- Reinforcement-learning routing (heuristic classification first; the
  RL router belongs in a follow-up issue).
- Cross-customer routing optimisation (single-tenant first).

## References

- [Issue #2043](https://github.com/oscharko-dev/workspace-dev/issues/2043) — primary issue.
- [Issue #2042](./compliance-as-code.md) — compliance-as-code rule packs (template for the deterministic-service pattern).
- [`agent-role-profile.ts`](../../src/test-intelligence/agent-role-profile.ts) — static role profile registry the routing layer composes with.
- [`finops-budget.ts`](../../src/test-intelligence/finops-budget.ts) — FinOps budget envelopes, source of the per-role cost rates.
- [`finops-report.ts`](../../src/test-intelligence/finops-report.ts) — base FinOps report; the routing-savings report is a sibling artifact.
- [`constrained-decoding.ts`](../../src/test-intelligence/constrained-decoding.ts) — constrained-decoding adapter resolution.
- [`cross-family-judge-policy.ts`](../../src/test-intelligence/cross-family-judge-policy.ts) — Wave-2 cross-family judge panel used by the sampler.
