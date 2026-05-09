# Judge-Calibration-Eval

> Closes #1906. Calibration gate for the
> [Logic-Judge](../src/test-intelligence/logic-judge.ts) (Issue #1898) and the
> [Faithfulness-Judge](../src/test-intelligence/faithfulness-judge.ts) (Issue #1899).

The Judge-Calibration-Eval is an offline gate that measures **how
reliable each judge is** — not how reliable the generator is — by
running the judges' predictions against a small, hand-curated
human-labeled calibration set and emitting accuracy, false-positive
rate, false-negative rate, and finding precision/recall metrics.

Without this gate, a "strict" judge could reject harmless cases (FNs
cost only repair iterations) or — far worse — a "lenient" judge could
let hallucinated cases through (FPs ship broken artefacts to QC). The
calibration set is the objective measurement that catches both
failure modes before a judge regression reaches production.

## Calibration set

Twenty fixtures live under
[`src/test-intelligence/fixtures/judge-calibration/`](../src/test-intelligence/fixtures/judge-calibration):

- **10 logic-judge cases** (4 happy + 3 adversarial + 3 edge)
- **10 faithfulness-judge cases** (4 happy + 3 adversarial + 3 edge)

Each case is a pair of sibling JSON files:

| File                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `<id>.input.json`     | Judge input — `TestDesignModel + CoveragePlan + GeneratedTestCaseList` for the logic judge, captures + generated cases for the faithfulness judge. Carried verbatim so the live runner can replay against a real LLM gateway. |
| `<id>.gold.json`      | Human verdict (`accept` / `repair` / `reject`), expected finding-code list, scenario kind, free-form rationale, and the recorded `mockJudgeResponse` baseline (`predictedVerdict` + `predictedFindingCodes`) the deterministic suite replays. |

The closed list of fixture ids is the source-of-truth in
[`JUDGE_CALIBRATION_FIXTURE_INDEX`](../src/test-intelligence/judge-calibration-eval.ts).
Adding a fixture means: drop both JSON files, append the id with its
`judge` and `scenarioKind` to the index. The unit suite asserts the
mix stays at 4 + 3 + 3 per judge.

### Scenario kinds

| Kind          | What it covers                                                                 | Example fixture                                |
| ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `happy`       | Generator output is sound; reviewer accepted as production-ready.              | `logic-happy-loan-form-accept`                 |
| `adversarial` | Output contains a deliberate hallucination, mismatch, or missing evidence.     | `logic-adversarial-hallucinated-id`            |
| `edge`        | Boundary case — narrow coverage, terse cases, locale formatting, etc. Tests the judges' calibration on the gray zone where over-strict and under-strict behaviour both happen. | `logic-edge-single-step-tc`                    |

## Hard-gate thresholds

Both judges are evaluated independently against the same thresholds,
exported as `JUDGE_CALIBRATION_HARD_THRESHOLDS`:

| Metric                    | Threshold | Severity            | Rationale                                                                                                                  |
| ------------------------- | --------: | ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `accuracy`                |   `≥ 0.85` | hard gate (error)   | Below this the judge is below the noise floor of human reviewers and cannot be trusted to gate the release pipeline.       |
| `falsePositiveRate`       |   `≤ 0.10` | hard gate (error)   | **Critical** — a FP means the judge said `accept` while the human said `repair`/`reject`. That ships hallucinations to QC. |
| `falseNegativeRate`       |   `≤ 0.20` | hard gate (error)   | Tolerated — a FN means the judge over-rejected; the only cost is an extra repair iteration. Looser bound by design.        |
| `findingPrecision/Recall` |  reported  | dashboard signal    | Surfaced in the per-judge artefact for trend analysis but **not** part of the hard gate; finding-text drift is recoverable. |

### Confusion matrix

The artefact persists every cell of the 3×3 verdict matrix
(`accept`/`repair`/`reject` predicted vs. human). Special cells:

- `falsePositive`: predicted `accept` while human said `repair`/`reject`.
- `falseNegative`: predicted `reject` while human said `accept`.
- `overRepair`: predicted `repair` while human said `accept` — recoverable, separate from FP.
- `underReject`: predicted `repair` while human said `reject`, or predicted `reject` while human said `repair` — over-strict, separate from FN.

## Run modes

| Mode      | Trigger                                                                                          | What it does                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **mock**  | Default — `pnpm run test:ti-judge-calibration` or `tsx scripts/run-judge-calibration-eval.ts`.   | Replays the recorded `mockJudgeResponse` baseline from each `<id>.gold.json`. Deterministic, free. |
| **live**  | `WORKSPACE_TEST_SPACE_JUDGE_CALIBRATION_LIVE=1` or `--mode=live`.                                | Reserved for the live LLM gateway wiring. The runner exits with a clear failure until that wiring lands. |

The mock baseline is intentionally **not perfect**: the recorded
predictions diverge from the human gold on one edge case per judge so
the calibration math actually exercises the FPR / FNR / precision /
recall formulas. A uniformly correct mock would make the gate
vacuous — running the suite would always print 100% accuracy and the
math would never be measured against real failure modes.

## Drift history

Every successful run appends a row to
`storybook-static/eval-reports/judge-calibration-history.json`
(`JUDGE_CALIBRATION_HISTORY_FILENAME`). Each row carries:

```json
{
  "recordedAt": "2026-05-05T12:34:56.000Z",
  "judge": "logic",
  "accuracy": 0.9,
  "falsePositiveRate": 0,
  "falseNegativeRate": 0,
  "findingPrecision": 0.833333,
  "findingRecall": 1,
  "sampleCount": 10,
  "passed": true
}
```

The file keeps at most `JUDGE_CALIBRATION_HISTORY_MAX_ENTRIES` (200)
rows so model-update regressions are visible across several months of
nightly runs without bloating the deployed Storybook bundle.

`storybook-static/` is gitignored (artefacts ship via the deployed
Storybook bundle, not the repo), so the history file accumulates per
CI runner. The drift signal is most useful in the long-running CI
artefact store and the deployed Storybook static build.

## Per-judge artefact

Each run also writes one artefact per judge:

- `storybook-static/eval-reports/judge-calibration-logic.json`
- `storybook-static/eval-reports/judge-calibration-faithfulness.json`

These contain the full `JudgeCalibrationEvalArtifact` shape — every
sample, every divergence, the confusion matrix, finding precision /
recall, the per-scenario-kind accuracy breakdown, and the structured
verdict listing every threshold that tripped (if any).

When a hard gate trips the runner exits non-zero with one bullet per
failing judge, e.g.:

```
judge-calibration-eval gate failed for 1 judge(s):
  - logic: accuracy_below_threshold(threshold=0.85,observed=0.7), false_positive_rate_above_threshold(threshold=0.1,observed=0.2)
```

The full per-judge artefact lists every divergent fixture so the
operator can tell whether the regression is concentrated in a single
scenario kind or distributed across the calibration set.

## CI wiring

`pnpm run test:ti-judge-calibration` is exercised in:

- the `test-intelligence` job of [`pr-quality-gate.yml`](../.github/workflows/pr-quality-gate.yml);
- a dedicated step of [`dev-quality-gate.yml`](../.github/workflows/dev-quality-gate.yml) on `main`/`dev` merges;
- [`release-gate.yml`](../.github/workflows/release-gate.yml) (shard 0) before a release tag is cut;
- [`pnpm run release:quality-gates`](../package.json) and
  [`pnpm run release:quality-gates:publish-lifecycle`](../package.json),
  alongside the existing `test:ti-faithfulness`, `test:ti-hallucination`,
  and `test:ti-a11y` gates.

The eval costs zero gateway calls in mock mode and no extra wall
clock budget on top of the existing `test:ti-*` gate suite.

## Inter-rater agreement (Issue #2109)

Single-annotator gold labels are the largest methodological weakness in
a regulated calibration suite. Issue #2109 layers an inter-rater
protocol on top of the gold set:

- Every `<id>.gold.json` carries a `goldVerdicts` array with at least
  two distinct reviewer entries (`reviewer`, `verdict`, `findingCodes`,
  `rationale`, `timestamp`).
- When the two reviewers disagree on either verdict or finding codes,
  `adjudicated: true` and an `adjudication` block records the arbiter's
  resolution. The top-level `humanVerdict` / `humanFindingCodes` always
  reflect the consensus (or the arbiter's call if adjudicated) and are
  the authoritative labels the calibration math reads.
- Cohen's κ (Cohen, 1960) is computed per judge type and per
  judge × scenario class; the report also persists a reviewer-rotation
  log so a single reviewer cannot silently dominate the gold set.

The runner emits one row per judge to stdout with `cohens_kappa`,
`observed_agreement`, `expected_agreement`, and the
`adjudicated`-fixture count, plus a rotation row with `assignments`,
`distinct_reviewers`, and `max_share`.

The artifact lands at
`storybook-static/eval-reports/judge-calibration-inter-rater-agreement.json`
([`INTER_RATER_AGREEMENT_ARTIFACT_FILENAME`](../src/test-intelligence/inter-rater-agreement.ts)).

| Severity | Condition                                              | Constant                                         |
| -------- | ------------------------------------------------------ | ------------------------------------------------ |
| fail     | per-judge κ < 0.7                                      | `INTER_RATER_KAPPA_HARD_FLOOR`                   |
| warn     | per-judge κ < 0.8                                      | `INTER_RATER_KAPPA_WARN_FLOOR`                   |
| fail     | reviewer share > 0.6                                   | `INTER_RATER_REVIEWER_SHARE_HARD_CAP`            |
| warn     | reviewer share > 0.45                                  | `INTER_RATER_REVIEWER_SHARE_WARN_CAP`            |
| warn     | per-scenario paired-rating count < 8 with κ < target   | `INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS`        |

The per-scenario hard-fail is suppressed below the paired-rating floor
because Cohen's κ is too unstable to gate against on N < 8.

See [`docs/eu-ai-act/human-oversight.md`](./eu-ai-act/human-oversight.md)
§3.5 for the regulatory rationale.

## Out of scope

- **Automatic model auto-selection** based on calibration drift — left
  for a follow-up issue if drift becomes problematic.
- **Crowd-sourced calibration sets** — a fixed internal set is enough
  for the demo. Adding cases later is a one-line index append plus the
  two JSON files; no code change required.
