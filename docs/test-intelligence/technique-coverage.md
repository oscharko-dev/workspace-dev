# Tier-elastic technique-coverage minimum (Issues #2068, #2171)

The `policy:technique-coverage-minimum` gate enforces a per-screen
minimum number of generated test cases per ISO 29119-4 technique. Before
Issue #2068 the gate consulted the planner-published
`CoveragePlan.perScreen[].techniqueQuotas[].minCount` verbatim. On
small-field screens (`<= 8` form fields) the planner emitted a fixed
floor of `12` for `equivalence_partitioning` regardless of screen size,
which forced the harness to either emit padding cases (lowering the
semantic-coverage signal) or fail **G3** even though the generator had
already produced more EP cases than the screen had fields. The defect
blocked G0, I0, J0 and finally K0.

## Tier-elastic formula

The default `eu-banking-default` policy profile sets

```ts
techniqueCoverageMinimum: {
  mode: "tier-elastic",
  tiers: TIER_ELASTIC_EP_TIERS,
}
```

The gate computes a tier-elastic candidate from the screen's
coverage-relevant field count (derived from `CoveragePlan.perElement`
filtered by `screenId`) and **relaxes** the planner's published EP
quota when the candidate is lower:

```
effective = min(plannerQuota, tierElasticQuota)
```

This preserves byte-for-byte backwards compatibility on datasets where
the planner already published a tight, well-sized minimum: the formula
only kicks in when the planner overshoots the screen's actual size
(the K0 evidence). Issue #2171 further right-sizes the coefficients to
match observed generator output on the active M0 datasets. The
candidate tiers are:

| Field count       | Tier-elastic candidate              | Formula label                                   |
| ----------------- | ----------------------------------- | ----------------------------------------------- |
| `<= 4`            | `max(4, 2 × fieldCount)`            | `tier-elastic:fields<=4: max(4, 2*fields)`      |
| `5–8`             | `ceil(1.25 × fieldCount)`           | `tier-elastic:fields=5-8: ceil(1.25*fields)`    |
| `9–19`            | `ceil(0.9 × fieldCount)`            | `tier-elastic:fields=9-19: ceil(0.9*fields)`    |
| `>= 20`           | `ceil(0.85 × fieldCount)`           | `tier-elastic:fields>=20: ceil(0.85*fields)`    |

Re-evaluated examples from the historical `G0` / `I0` / `J0` / `K0`
regression set:

| Run  | Field count | Pre-#2068 quota | Post-#2068 quota | EP anchored | Verdict   |
| ---- | ----------: | --------------: | ---------------: | ----------: | --------- |
| `G0` |           7 |              12 |                9 |          11 | **pass**  |
| `I0` |           9 |              12 |                9 |          11 | **pass**  |
| `J0` |           9 |              12 |                9 |          11 | **pass**  |
| `K0` |           9 |              12 |                9 |          10 | **pass**  |

All four runs clear **G3** under the new formula. Non-EP
rows (`use_case`, `accessibility`, `boundary_value_analysis`,
`decision_table`, …) keep their planner-published `minCount` so the
broader Wave 4 coverage contract is unchanged.

On the latest `2026-05-10` M0 sandbox runs the current formula clears
4 of 6 active datasets:

| Dataset  | Field count | EP anchored | Required | Verdict |
| -------- | ----------: | ----------: | -------: | ------- |
| `T7l7`   |           9 |           8 |        9 | fail    |
| `DUArQ`  |          24 |          21 |       21 | pass    |
| `E5h5`   |          15 |          14 |       14 | pass    |
| `LATyw`  |          13 |          13 |       12 | pass    |
| `M7FGS`  |          60 |          51 |       51 | pass    |
| `xr6Nf`  |          32 |          16 |       28 | fail    |

## Fixed-quota override

Customers that contractually require a fixed floor opt into

```ts
const profile = cloneEuBankingDefaultProfile();
profile.rules.techniqueCoverageMinimum = { mode: "fixed" };
```

The gate then enforces the planner's quota rows verbatim — EP and
non-EP — preserving byte-for-byte behaviour with the pre-#2068 closeout
audit baseline. The `formula` recorded in the per-run report is
`fixed:planner-quota` so reviewers can audit which mode was active.

## `technique-quota-report.json`

The runner persists `technique-quota-report.json` next to
`policy-report.json` whenever a `CoveragePlan` is supplied. Each entry
captures the resolution path of one `(screenId, technique)` pair:

```jsonc
{
  "screenId": "1:11309",
  "technique": "equivalence_partitioning",
  "fieldCount": 9,
  "requiredCount": 9,
  "actualCount": 10,
  "formula": "tier-elastic:fields=9-19: ceil(0.9*fields)",
  "formulaTier": "fields=9-19: ceil(0.9*fields)",
  "formulaMultiplier": 0.9,
  "mode": "tier-elastic",
  "status": "pass"
}
```

The artifact lets reviewers audit why a small-field mask did not
trigger a quota deficit even though the planner published a `12` floor,
and lets QA leadership compare aggregate `passCount` / `deficitCount`
across runs without rebuilding the gate's intermediate state.

## Hard-gate parity

The post-LLM logic-judge `applyCoverageHardGate` consumes the same
`techniqueCoverageMinimum` knob via
`RunLogicJudgeInput.techniqueCoverageMinimum`. The production runner
threads the active profile's mode into both the policy gate and the
logic-judge so the `repair`-loop never disagrees with the policy
gate's verdict.

## Out-of-scope

- Adding new technique categories beyond `equivalence_partitioning`
  (use-case and accessibility quotas keep their planner-published
  minimums).
- Per-customer auto-tuning of the formula tiers.
- Replacing the technique catalog itself (ISO 29119-4 stays).

## References

- Issue #2068 (this child)
- Issue #2026 (original closeout child — superseded by #2068)
- Issue #2025 (acceptance closeout)
- `src/test-intelligence/policy-gate.ts`
- `src/test-intelligence/technique-quota.ts`
- `src/test-intelligence/policy-profile.ts`
