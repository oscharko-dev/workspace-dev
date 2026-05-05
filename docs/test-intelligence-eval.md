# Test-Intelligence — Faithfulness Evaluation Gate

Status: production (Issue #1903)

This document describes the **Faithfulness-Eval** suite that measures how
faithfully the generator output mirrors the Figma Intermediate
Representation (IR) and gates pre-release quality. The gate complements
the existing baseline (Issue #1762), Wave-1 validation (Issue #1366), and
Wave-4 multi-source (Issue #1431) eval gates.

## Run

```sh
pnpm test:ti-faithfulness
```

The script runs against the seven baseline archetype fixtures shipped
under `src/test-intelligence/fixtures/baseline-*.figma.json`. The eval
is deterministic: identical inputs produce byte-identical reports and the
suite finishes in well under one second.

The script is **not** part of the default `pnpm test` run — by design,
since coverage/hallucination evaluation is a separate quality gate. It
**is** part of `pnpm release:quality-gates` and
`pnpm release:quality-gates:publish-lifecycle`, so every pre-release
must pass it.

## Metrics

For every fixture the suite computes:

| Metric                     | Definition                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `fieldCoverageRatio`       | `unique(coveredFieldIds) / detectedFields.length` in the IR                                                           |
| `actionCoverageRatio`      | `unique(coveredActionIds) / detectedActions.length` in the IR                                                         |
| `validationCoverageRatio`  | `unique(coveredValidationIds) / detectedValidations.length` in the IR                                                 |
| `navigationCoverageRatio`  | `unique(coveredNavigationIds) / detectedNavigation.length` in the IR                                                  |
| `traceFidelityScore`       | Fraction of `figmaTraceRefs` entries with `nodeId !== undefined`                                                      |
| `hallucinatedIdRate`       | Fraction of cited IDs (covered\* IDs **and** trace `nodeId`/`screenId`) that do not exist in the source Figma input   |

Coverage ratios use the convention `0/0 → 1` so an IR that legitimately
contains no validations or navigation does not trip the gate. The
hallucination rate uses `0/0 → 0` so an artefact with no citations is
reported as having no hallucinations.

## Hard-gate thresholds — `production-baseline` profile

The thresholds are exported as a frozen const at
`FAITHFULNESS_PRODUCTION_BASELINE_THRESHOLDS` in
[`src/test-intelligence/faithfulness-eval.ts`](../src/test-intelligence/faithfulness-eval.ts):

| Threshold                | Value | Direction | Failure reason code                       |
| ------------------------ | ----- | --------- | ----------------------------------------- |
| `fieldCoverageRatio`     | ≥ 0.4 | min       | `field_coverage_below_threshold`          |
| `actionCoverageRatio`    | ≥ 0.5 | min       | `action_coverage_below_threshold`         |
| `traceFidelityScore`     | ≥ 0.95| min       | `trace_fidelity_below_threshold`          |
| `hallucinatedIdRate`     | ≤ 0.0 | max       | `hallucinated_id_above_threshold`         |

`validationCoverageRatio` and `navigationCoverageRatio` are emitted to
the report but **not** gated, since validation/navigation density varies
by fixture archetype. They are intended as observability signals for
operators reading per-fixture reports.

## Per-fixture report artefact

For every fixture the suite produces a structured artefact:

```text
storybook-static/eval-reports/faithfulness-<fixture>.json
```

Each artefact contains the metrics, the active thresholds, the verdict
(`passed: boolean` plus a list of failures with `reason`, `threshold`,
`observed`), and methodology metadata (deterministic synthesis, citation
sources). The shape is `FaithfulnessEvalArtifact` from
[`src/test-intelligence/faithfulness-eval.ts`](../src/test-intelligence/faithfulness-eval.ts);
schema version `1.0.0`.

The default output directory matches the Storybook static-build dir so
operators reading the deployed Storybook can inspect the latest
production-baseline report alongside the rest of the eval-reports
bundle. CI jobs that do not build Storybook can pass an explicit
`outputDir` to `writeFaithfulnessEvalArtifact` to redirect the report.

## Repair-loop interaction

The hard gate is calibrated so the deterministic synthesiser passes
every threshold **with** the repair loop (Issue #1900). The suite also
exercises a `no-repair` mode that simulates a generator forced into
single-pass output by trimming the synthesised list with
`degradeListForNoRepair`. The trimmed list always trips at least the
`trace_fidelity_below_threshold` failure on every baseline fixture,
which is the suite's negative signal that the gate is wired correctly.

A separate hallucination test injects a citation that does not exist in
the IR and asserts that `hallucinated_id_above_threshold` fires.

## Fixture coverage

The baseline fixtures span ≥5 variants across small/medium screens,
forms with and without validation, with and without navigation:

- `baseline-simple-form` — small form, required fields, no navigation.
- `baseline-calculation` — calculation-heavy fields, multiple validations.
- `baseline-optional-fields` — sparse validations, optional inputs.
- `baseline-multi-context` — Jira + custom-context source mix.
- `baseline-ambiguous-rules` — overlapping validation rules.
- `baseline-complex-mask` — masked inputs, complex format rules.
- `baseline-validation-heavy` — dense validations, cross-field rules.

## Related issues

- Parent epic: #1892 (audit-2026-05, Welle 4).
- Prerequisite: #1898 (logic-judge), #1900 (repair loop), #1901 (coverage hard-gate).
- This gate: #1903.
