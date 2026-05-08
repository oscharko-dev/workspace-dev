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

## G-NEG-CASE Quality Gate (Issue #2053)

The `>= 30 %` lift target is enforced as a release-grade hard gate
(`G-NEG-CASE`) by the production runner. The gate consumes the per-run
`AdversarialCriticTraceArtifact.negativeCoverage` block and persists its
result in `policy-report.json` under `gateResults` for audit. Skip is an
explicit, audit-visible status — it is never silently a pass.

### Statuses

- `passed` — `relativeRatioIncrease >= thresholdRatio`.
- `failed` — `relativeRatioIncrease < thresholdRatio` and the gate is
  configured to enforce. The runner exits with the
  `NEGATIVE_CASE_LIFT_BELOW_THRESHOLD` failure class **after** every
  artifact (policy report, evidence seal, provenance graph) is sealed, so
  a failure still leaves a complete, auditable evidence bundle on disk.
- `advisory` — same below-threshold observation as `failed`, but the
  operator configured the gate as record-only. The run completes
  successfully.
- `skipped` — the gate could not be evaluated. Possible `skipReason`
  values:
  - `adversarial_critic_disabled`: no `logicJudge` client wired.
  - `adversarial_critic_failed`: the critic loop exited with
    `stopReason === "critic_failed"`; the negative-coverage accounting
    cannot be trusted.
  - `gate_disabled`: the operator set `gateMode: "off"`.

### Configuration

The gate threshold and mode are sourced from, in priority order:

1. `RunFigmaToQcTestCasesInput.qualityGates.negativeCaseLift` — the
   per-run CLI escape hatch. Use this for fast iterative local runs.
2. `TestCasePolicyProfile.rules.negativeCaseLift` — the policy-profile
   default. The `eu-banking-default` profile sets the secure default
   `{ gateMode: "enforce", thresholdRatio: 0.30 }`.
3. The documented fallback `{ gateMode: "enforce", thresholdRatio: 0.30 }`
   when neither source provides a value.

### Baseline source

The baseline used for the comparison is the per-run
`baselineGeneratedList` snapshot taken right after the initial generation
pass and before any critic round. This is deterministic per run and
embedded into provenance via the regeneration activity, so the gate
result and the baseline it compared against can always be replayed from
the persisted artifact bundle.

### Wire shape

```json
{
  "gateResults": [
    {
      "gateId": "G-NEG-CASE",
      "status": "passed",
      "ruleRef": "ti:rule:adversarial-critic-negative-case-lift",
      "thresholdRatio": 0.3,
      "observedRatio": 0.5,
      "message": "G-NEG-CASE passed: relativeRatioIncrease=0.5 >= threshold=0.3."
    }
  ]
}
```

`skipped` entries omit `observedRatio` and add a `skipReason`:

```json
{
  "gateId": "G-NEG-CASE",
  "status": "skipped",
  "ruleRef": "ti:rule:adversarial-critic-negative-case-lift",
  "thresholdRatio": 0.3,
  "skipReason": "adversarial_critic_disabled",
  "message": "G-NEG-CASE skipped: adversarial-critic loop did not run for this job."
}
```
