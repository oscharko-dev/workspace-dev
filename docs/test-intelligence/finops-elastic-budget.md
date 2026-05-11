# FinOps Elastic Wall-Clock Budget

Issue #2169 makes the `test_generation` role's `maxTotalWallClockMs`
budget elastic instead of pinning a single constant for every run.

## Goal

The old fixed cap was calibrated for small K0-style runs. M0 multi-section
datasets now carry:

- more generated cases,
- a larger active judge panel,
- adversarial-critic passes, and
- optional visual-sidecar work that increases review latency.

The elastic policy keeps small runs tighter while letting wider runs stay
inside the audit budget without masking regressions behind a large static cap.

## Default Policy

The built-in `eu-banking-default` policy profile resolves the
`test_generation.maxTotalWallClockMs` threshold with this formula:

```text
resolvedMs =
  90_000
  + (1_800 * caseCount)
  + (12_000 * max(0, judgePanelSize - 1))
  + (18_000 * adversarialRounds)
  + (15_000 when visualSidecarEnabled)
```

Then clamp the result to a hard ceiling of `360_000 ms`.

## Inputs

- `caseCount`: final generated test-case count for the run.
- `judgePanelSize`: number of active judge entries in `judge-consensus.json`.
- `adversarialRounds`: number of persisted adversarial-critic rounds.
- `visualSidecarEnabled`: `true` when the run emitted a visual-sidecar result.

The runtime computes the resolved threshold after the run shape is known and
uses that value for the final FinOps breach check and the persisted report.

## Overrides

Policy profiles may override the coefficient block through
`TestCasePolicyProfile.rules.finopsWallClockBudget`.

When an operator explicitly sets
`finopsBudget.roles.test_generation.maxTotalWallClockMs`, that constant wins
outright. The report still records the formula inputs for audit, but the
effective threshold stays pinned to the operator-supplied value.

## Audit Trail

`finops/budget-report.json` now carries:

- `budget.roles.test_generation.maxTotalWallClockMs`: the effective threshold
  used for breach detection.
- `resolvedBudget.testGenerationWallClock`: the resolution mode, runtime
  inputs, coefficients, and full breakdown used to derive the threshold.

This keeps the report self-contained for post-run review without requiring
operators to reconstruct the policy from source code.
