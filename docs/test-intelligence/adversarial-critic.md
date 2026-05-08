# Adversarial Critic

Issue #2039 adds a bounded `adversarial_critic` lane to the
test-intelligence production runner. Its job is not to approve the
generated suite, but to attack it: "what would a malicious, careless, or
rushed user do that this suite still misses?"

## Execution Model

- The critic runs before the final judge pass.
- It is bounded to at most `2` rounds.
- One critic round is budget-capped at `25%` of the generator budget via
  `resolveAdversarialCriticBudgetLimits(...)`.
- The runner only enables the critic when a dedicated judge lane is
  configured (`llm.logicJudge` or `llm.bundle.logicJudge`). Legacy
  single-model runs keep their previous call shape.

## Domain Grounding

The critic prompt is parameterized by `regulatoryRelevance.domain` and
selects a curated playbook from:

- `src/test-intelligence/adversarial-playbooks/banking.json`
- `src/test-intelligence/adversarial-playbooks/insurance.json`

Each playbook entry encodes a reusable adversarial class such as:

- Boundary abuse
- State-transition violations
- Regulatory evasion
- Workflow bypass
- Rounding or calculation exploits
- Access-control or data-leak style blind spots

## Finding Shape

Each round returns structured `AdversarialFinding[]` entries with:

- `category`
- `title`
- `rationale`
- optional affected target ids such as `affectedFieldId`
- `minimumReproducibleTestData`
- `suggestedTestType`
- `repairInstruction`

The runner de-duplicates findings by category plus affected target before
feeding them back into the next generation pass.

## Regeneration Loop

For each round with unique findings, the generator receives three bounded
suffix sections:

1. `AdversarialFindings`
2. `AdversarialRepairInstructions`
3. `NegativeCoverageAccounting`

The regeneration path must not inflate total case count beyond the
baseline generated count. The runner trims overflow by preferring
negative, boundary, and validation coverage first.

## Artifacts

When the critic is enabled, the runner persists:

- `agent-role-runs/adversarial_critic_round_1.json`
- `agent-role-runs/adversarial_critic_round_2.json` when needed
- `adversarial-critic-trace.json`

`provenance.jsonld` aggregates each persisted round as a dedicated
`adversarial_critic_round_K` activity so downstream evidence tooling can
trace which blind spots were surfaced and integrated.

## Negative Coverage Accounting

The trace artifact records baseline vs. final negative-case ratios and the
relative ratio increase. The target from Issue #1753 is encoded as a
`>= 30%` relative improvement threshold, while preserving overall suite
size.
