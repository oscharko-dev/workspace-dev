# Generator self-consistency voting (Issue #2070)

Issue #2070 adds a generator-stage self-consistency path to the
`figma_to_qc_test_cases` production runner. For the default
`eu-banking-default` policy profile, the runner now requests three
generator samples, votes the overlapping structural fields, and persists
the vote audit as a first-class artifact.

The goal is narrow: improve generator reliability before the logic-judge,
faithfulness-judge, repair loop, or adversarial critic see the case list.
This is not a replacement for the downstream judge stages; it is an
earlier consensus filter on the generator output itself.

## Default policy

The built-in `eu-banking-default` profile now carries:

```ts
rules: {
  selfConsistency: { sampleCount: 3 }
}
```

That means the runner defaults to:

- `1` pass when the operator explicitly sets
  `generation.diversityPasses = 1`
- `2` passes when the operator explicitly sets
  `generation.diversityPasses = 2` and wants the legacy dual-pass merge
- `3` passes when no explicit override is supplied and the active policy
  profile enables self-consistency voting

If the selected generator deployment does not declare seed support, the
runner fails closed only for explicit multi-pass operator overrides. For
policy-default self-consistency, it degrades to a single pass instead of
breaking the run.

## Seeds and pass identities

The three generator diversity passes are deterministic and use the seeded
profiles:

| Pass | Role-run artifact          | Seed |
| ---- | -------------------------- | ---- |
| `a`  | `generator-run-a.json`     | `11` |
| `b`  | `generator-run-b.json`     | `29` |
| `c`  | `generator-run-c.json`     | `47` |

The pass prompts keep the same contract surface and only vary the
generation bias so the runner can probe alternate but valid candidate
test suites.

## Voting model

The runner groups generated cases by a structural target key derived from:

- `figmaTraceRefs[].screenId`
- `qualitySignals.coveredFieldIds`
- `qualitySignals.coveredActionIds`
- `qualitySignals.coveredValidationIds`
- `qualitySignals.coveredNavigationIds`

Within each target, the voter currently elects a majority for:

- `type`
- `technique`
- `riskCategory`
- `steps[*].action`
- `steps[*].expected`

Agreement is calculated per field as `majorityCount / sampleCount`, and
the target-level agreement is the mean of all field agreements.

## Disagreement handling

When every voted field reaches majority, the merged case stays on the
normal path.

When any voted field fails to reach majority:

- the merged case is marked `reviewState = "needs_review"`
- an open-question marker with the prefix
  `self_consistency_disagreement:` is appended
- the per-target report records `disagreement: true`
- the disagreement route is persisted as `human_review`

The merged case's `qualitySignals.confidence` is also capped by the
target agreement so downstream reviewers can see the generator-side
stability signal directly in the exported case list.

## Persisted artifact

Every 3-sample run writes:

`self-consistency-report.json`

The artifact is canonical JSON and includes:

- `schemaVersion`
- `contractVersion`
- `generatedAt`
- `jobId`
- `sampleCount`
- `selfConsistencyAgreement`
- `targets[]`

Each `targets[]` entry records:

- the derived `targetKey`
- the selected `testCaseId`
- `samplePresenceCount`
- target-level `agreement`
- `disagreement`
- optional `disagreementRoute`
- `votes[]` with per-field majority metadata

The run-quality artifact now also exposes
`selfConsistencyAgreement` so operators can correlate overall run health
with the generator-side voting signal without opening the full report.

## FinOps impact

Three generator samples raise the default production generator budget.
The production envelope now reserves enough aggregate input/output tokens
and attempts for the default 3-sample path while preserving the existing
fail-closed wall-clock and retry controls.

This is a deliberate calibration change, not an invitation to increase
sample count beyond `3`. The current contract keeps the allowed count
closed to `1 | 3` at the policy level and `1 | 2 | 3` at the operator
override level so the runner stays predictable and auditable.

## Operator guidance

- Use the policy default (`3`) for banking and insurance production runs
  where generator drift is materially expensive.
- Force `generation.diversityPasses = 1` for fixture-style tests or
  narrow investigations where exact single-pass request counts matter.
- Use `generation.diversityPasses = 2` only when validating the legacy
  dual-pass merge path or comparing issue #1936 behavior.
- Review `self-consistency-report.json` whenever the exported case list
  contains `self_consistency_disagreement:` markers.

## References

- `src/test-intelligence/self-consistency-voter.ts`
- `src/test-intelligence/production-runner.ts`
- `src/test-intelligence/policy-profile.ts`
- `src/test-intelligence/agent-role-profile.ts`
