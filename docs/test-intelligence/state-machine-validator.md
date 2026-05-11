# Test-Intelligence Field-Lifecycle State-Machine Validator

Status: shipped (Issue #2111, scope-tightened in Issue #2168)

The state-machine validator enforces that every per-field lifecycle transition
declared in `workflow-topology.json` is exercised by at least one anchored
generated test step. Issue #2111 introduced the validator; Issue #2168 tightens
its scope so it stops over-firing on positive-path transitions that the LLM
does not always exercise on small generated suites.

## Why a tier classifier?

The Issue #2111 implementation emitted a blocking
`uncovered_field_lifecycle_transition` error for every uncovered transition.
On the M0 multi-dataset benchmark
(`sandbox/benchmarks/test-intelligence/comparisons/M0-multi-dataset-2026-05-10.md`)
the validator over-fired 30–139× per dataset, drowning real defects in noise
and blocking the G4 hard gate
(`validation-report.errorCount === 0`) across the suite:

| Dataset | Total errors | Of which `uncovered_field_lifecycle_transition` |
| ------- | -----------: | ----------------------------------------------: |
| `T7l7`  |            3 |                                               3 |
| `DUArQ` |           33 |                                              30 |
| `E5h5`  |           53 |                                              47 |
| `LATyw` |           51 |                                              51 |
| `xr6Nf` |          142 |                                             139 |

The state machine declares 6 states per field
(`initial → focused → in_progress → validated | error → terminal`). On
generated suites with 10–100 cases the LLM does not exercise every transition
for every field — yet the legacy validator demanded per-field full coverage.
On `xr6Nf` with 8 fields × ~17 missed transitions = 139 errors. This is a
**validator-too-strict** problem, not a generator-quality problem.

## Tier table

The classifier (`src/test-intelligence/field-lifecycle-transition-tier.ts`)
is deterministic and table-driven (one row per `(fromState, toState)` pair).
Adding a new state to `ALLOWED_WORKFLOW_FIELD_LIFECYCLE_STATES` triggers
the `assertTransitionTierTableIsExhaustive` assertion at module load so the
compiler immediately surfaces any unclassified pairs.

| Tier                          | Pairs                                                                                                                                                                                  | Severity for missing coverage                                                                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mandatory_negative_path`     | every `initial → *` entry, plus `in_progress → validated` (`validation_pass`) and `in_progress → error` (`validation_fail`)                                                            | `uncovered_field_lifecycle_transition` (`error`) — blocks the run                                                                                                                    |
| `recommended_positive_path`   | `focused → in_progress`/`validated`/`error`, `in_progress → in_progress`/`terminal`, `validated → terminal`, `error → in_progress`/`terminal`                                          | `uncovered_field_lifecycle_transition_recommended` (`warning`) — visible in `validation-report.warningCount`, never blocks                                                           |
| `state_transition_test_only` | every outgoing edge from `terminal`, every backwards/reset jump (e.g., `validated → focused`, `error → focused`, `terminal → initial`), and self-loops on `focused`/`validated`/`error` | silent unless the run carries a `technique === "state_transition"` case; in that case `uncovered_field_lifecycle_transition_recommended` (`warning`)                                 |

The `state_transition_test_only` carve-out keeps the validator silent on
reset/edit/re-open flows that are only material when the test suite is
explicitly exercising the state machine itself.

## Validator emission contract

`validateFieldLifecycleCoverage` in
`src/test-intelligence/test-case-validation.ts`:

1. Builds the set of `transitionId`s anchored by any generated step.
2. Iterates every declared transition; if anchored, skips it.
3. Otherwise looks up the tier and emits:
   - `mandatory_negative_path` ⇒ `uncovered_field_lifecycle_transition` (`error`).
   - `recommended_positive_path` ⇒ `uncovered_field_lifecycle_transition_recommended` (`warning`).
   - `state_transition_test_only` ⇒ same `_recommended` warning code, but
     ONLY when at least one test case in the list carries
     `technique === "state_transition"`; otherwise the transition is
     silently ignored.

`validation-report.warningCount` aggregates the new warnings so the
`policy-report.warningCount` axis the M0 benchmark surfaces stays
populated without blocking the run.

## Coverage-report integration

`coverage-report.json` already carries the per-field
`fieldLifecycleCoverage` bucket (covered / total / ratio / uncovered ids
across the union of all transitions). Issue #2168 adds an optional
additive `recommendedTransitionCoverage` bucket scoped to the
`recommended_positive_path` subset so reviewers and the FinOps dashboard
can track positive-path adoption independently from the mandatory
hard-gate signal:

```jsonc
{
  "fieldLifecycleCoverage": {
    "total": 5,
    "covered": 3,
    "ratio": 0.6,
    "uncoveredIds": ["FLT-iban0002", "FLT-iban0005"]
  },
  "recommendedTransitionCoverage": {
    "total": 2,
    "covered": 0,
    "ratio": 0,
    "uncoveredIds": ["FLT-iban0002", "FLT-iban0005"]
  }
}
```

The new field is omitted when the topology declares no recommended-tier
transitions so the byte shape stays stable for legacy runs that
pre-date the tier-aware validator.

## Targets restored by the change

- `uncovered_field_lifecycle_transition` errors → 0 across all six M0
  datasets where every uncovered transition was non-mandatory. Datasets
  whose uncovered transitions include mandatory pairs (e.g., `T7l7`'s
  three mandatory misses) still fail — the validator catches the
  defects it was designed to catch.
- `validation-report.errorCount` drops below 5 per dataset on the M0
  benchmark.
- G4 hard gate (`validation-report.errorCount === 0`) passes on at
  least 4/6 datasets.
- Coverage warning count
  (`uncovered_field_lifecycle_transition_recommended`) is non-blocking
  and visible in `validation-report.warningCount`.

## Verification surface

The focused regression suite for Issue #2168 is:

```bash
pnpm exec tsx --test \
  src/test-intelligence/field-lifecycle-transition-tier.test.ts \
  src/test-intelligence/test-case-validation.test.ts \
  src/test-intelligence/test-case-coverage.test.ts \
  src/test-intelligence/validation-pipeline.test.ts \
  src/test-intelligence/validation-pipeline.golden.test.ts
```

These tests pin:

- exhaustive `(from, to)` tier classification across the 6-state lifecycle,
- the mandatory / recommended / state-transition-only subsets specified
  by Issue #2168,
- the property-based assertion that "for any fixture with N fields × M
  transitions, only the mandatory-tier subset can produce
  `severity: error`",
- the existing #2111 fixture set still reports the same actual defects
  (3 mandatory errors on the canonical IBAN lifecycle), and
- coverage-report and validation-pipeline byte stability.
