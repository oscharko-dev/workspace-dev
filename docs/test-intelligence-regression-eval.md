# Regression-Eval — baseline-drift detection

> Closes #1907. Re-pinned-baseline drift gate for the seven archetype
> fixtures from
> [`baseline-fixtures.ts`](../src/test-intelligence/baseline-fixtures.ts).

The Regression-Eval is an offline gate that pins a hand-approved
snapshot per archetype fixture and fails CI when a candidate run drifts
beyond the documented tolerances. It complements the existing baseline
suites (`baseline-eval`, `faithfulness-eval`, `hallucination-eval`,
`a11y-coverage-eval`) by detecting **shape changes** in the generator
output that pass each individual gate but together signal a behavioural
regression: e.g. case counts collapsing onto a single `riskCategory`,
coverage ratios slowly migrating downward, or one of the eval verdicts
silently flipping.

## Snapshot layout

One canonical-JSON snapshot per archetype lives under
[`src/test-intelligence/fixtures/regression-baselines/`](../src/test-intelligence/fixtures/regression-baselines):

```
src/test-intelligence/fixtures/regression-baselines/
  baseline-simple-form.snapshot.json
  baseline-calculation.snapshot.json
  baseline-optional-fields.snapshot.json
  baseline-multi-context.snapshot.json
  baseline-ambiguous-rules.snapshot.json
  baseline-complex-mask.snapshot.json
  baseline-validation-heavy.snapshot.json
```

Every snapshot carries:

| Field                       | What it pins                                                                                              |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `coverageRatios`            | `field`, `action`, `validation`, `navigation` ratios from `computeFaithfulnessMetrics`.                   |
| `caseCounts.total`          | Total emitted test cases for the fixture.                                                                 |
| `caseCounts.byRiskCategory` | Per-`TestCaseRiskCategory` count (`low`, `medium`, `high`, `regulated_data`, `financial_transaction`).    |
| `caseCounts.byTechnique`    | Per-`TestCaseTechnique29119` count (all nine ISO/IEC/IEEE 29119-4 techniques).                            |
| `evalOutcomes.faithfulness` | `passed` flag plus sorted failure-reason set from `evaluateFaithfulnessVerdict`.                          |
| `evalOutcomes.hallucination`| `passed` flag plus sorted failure-reason set from `evaluateHallucinationVerdict`.                         |
| `evalOutcomes.a11yCoverage` | `passed` flag plus sorted *error*-severity failure reasons from `computeA11yCoverage` (warnings ignored). |
| `methodology.mode`          | Generator mode the snapshot was pinned in (`with-repair`).                                                |
| `schemaVersion`             | `1.0.0` — bump when the snapshot shape changes.                                                           |
| `contractVersion`           | `TEST_INTELLIGENCE_CONTRACT_VERSION` at pin time.                                                         |

The closed list of risk categories and 29119 techniques lives next to
the eval implementation as `REGRESSION_EVAL_RISK_CATEGORIES` and
`REGRESSION_EVAL_TECHNIQUES`. Every snapshot enumerates every key with
a zero count when no case lands in that bucket so adding a generator
case to a previously-empty bucket trips the drift gate at +N rather
than going unnoticed.

## Tolerances

Documented in `REGRESSION_EVAL_TOLERANCES`:

| Dimension              | Tolerance                                  | Why                                                                                  |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Coverage ratios        | `±0.05` absolute                           | Absorbs rounding-stable changes; anything bigger is a real shift in coverage shape.  |
| Case counts (per key)  | `±2` per `riskCategory` and per `technique` | Lets the synthesiser add or drop one or two cases per bucket without a CI fire.      |
| Eval outcomes          | identical `passed` flag and failure-reason set | A flipped verdict is a hard regression — never absorbed.                          |
| Identity fields        | exact match                                | `archetype`, `intent`, `schemaVersion`, `contractVersion` must match exactly.        |

Out-of-tolerance findings are reported with the absolute delta, the
percentage delta against the baseline (or `n/a (baseline=0)`), and the
applicable tolerance. See `RegressionDriftFinding` for the full shape.

## Approve workflow

The pattern mirrors `FIGMAPIPE_GOLDEN_APPROVE` for golden fixtures.

```sh
# Run the gate — fails on any drift.
pnpm run test:ti-regression

# Intentionally re-pin all seven snapshots from the current pipeline.
FIGMAPIPE_REGRESSION_APPROVE=true pnpm run test:ti-regression
```

Approve mode is **rejected when `CI=true`** so approved snapshots can
only be produced locally and committed via PR review. The runner exits
with code `2` if both flags are set together.

After approving, review the snapshot diff (`git diff --stat
src/test-intelligence/fixtures/regression-baselines/`), commit it as
part of the PR that motivates the drift, and reference Issue #1907 in
the message:

```
chore(test-intelligence): re-pin regression-eval snapshots after Wave-3 generator updates

The Wave-3 changes shift case counts upward across every archetype.
Snapshots were re-approved with FIGMAPIPE_REGRESSION_APPROVE=true.

Refs #1907
```

## Drift report

When a candidate run drifts the runner writes a human-readable
Markdown report to:

```
storybook-static/eval-reports/regression-drift-<timestamp>.md
```

The report lists per-finding the snapshot path, the before/after
values, the absolute delta, the percentage delta, and the tolerance
band. The footer always points back at the approve command so the
on-call engineer can re-pin without re-reading this document.

## CI integration

`test:ti-regression` runs in:

- [`pr-quality-gate.yml`](../.github/workflows/pr-quality-gate.yml)
  next to the other `test:ti-*` gates.
- [`dev-quality-gate.yml`](../.github/workflows/dev-quality-gate.yml)
  on every `dev` push.
- [`release-gate.yml`](../.github/workflows/release-gate.yml) on the
  release-cutter shard so the gate runs at least once before each
  release.

The runner is byte-deterministic when invoked twice in a row against an
unchanged tree (asserted by `regression-eval.test.ts`); the only
non-determinism is the `<timestamp>` in the drift-report filename
which is only written when drift is detected.

## When to bump `schemaVersion`

Bump `REGRESSION_EVAL_SCHEMA_VERSION` and re-approve every snapshot
when:

- A new dimension is added to the snapshot (a new metrics field, a new
  eval-outcome key).
- A risk category or 29119 technique is added or removed in the
  contracts.
- The tolerance band changes such that the meaning of a value would
  silently shift.

Pure metric drift (coverage rises after a generator improvement, case
counts shift by more than ±2) does **not** require a schema bump — only
a fresh approve.

## Related modules

- [`regression-eval.ts`](../src/test-intelligence/regression-eval.ts) —
  the snapshot builder, differ, and Markdown renderer.
- [`baseline-fixtures.ts`](../src/test-intelligence/baseline-fixtures.ts) —
  the seven archetype fixtures the gate runs against.
- [`faithfulness-eval.ts`](../src/test-intelligence/faithfulness-eval.ts),
  [`hallucination-eval.ts`](../src/test-intelligence/hallucination-eval.ts),
  [`a11y-coverage-eval.ts`](../src/test-intelligence/a11y-coverage-eval.ts) —
  the underlying eval gates whose outcomes feed the snapshot.
