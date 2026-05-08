# Cross-modal faithfulness — tiered scoring

> Issue [#2066](https://github.com/oscharko-dev/workspace-dev/issues/2066) — closes the
> **G3** cross-modal-faithfulness gate on the K0 benchmark by tiering
> the per-step threshold and recalibrating the cross-family judge.

## Why

Before #2066 the cross-family faithfulness judge
(`llama-4-maverick-vision`, sourced via #2038) emitted partial-evidence
diagnoses such as

> "The label matches the expectation but the step description is not
> fully visible in the screenshot."

The v1 rubric collapsed these into the same penalty bucket as a
positive contradiction. A run with five label-only steps and zero
mismatches landed at `score = 0.5` — well below the `0.80` cross-modal
floor — even though every label assertion was visible in the Figma
capture. The K0 benchmark therefore failed `G3` with

```
outcome: "cross_modal_faithfulness_score_below_threshold"
reason : "cross-modal faithfulness score 0.500000 is below threshold 0.80
          (below gray-zone floor 0.75)"
rule   : "policy:cross-modal-faithfulness-score"
```

even though no step contradicted the visible UI.

## What changed

The faithfulness rubric now distinguishes **three** per-step verdicts:

| Verdict             | Score | Meaning                                                 |
|---------------------|------:|---------------------------------------------------------|
| `match`             |  1.00 | Positive visual evidence for the step                   |
| `evidence_partial`  |  0.85 | Label consistent with capture, full description not visible — **no contradiction** |
| `mismatch`          |  0.00 | Capture positively contradicts the step                 |

The `0.85` weight is the calibration anchor of #2066 — it sits comfortably
above the `0.80` floor for label-only steps but below the `0.95`
strictness ceiling, so a run made entirely of `evidence_partial` steps
still passes the gate while the score difference vs. an all-`match` run
remains visible to reviewers.

The policy gate aggregates per-step scores into the case-level
faithfulness score using **tiered thresholds**:

| Tier             | `match` passes at | `evidence_partial` passes at | Otherwise |
|------------------|------------------:|-----------------------------:|-----------|
| `concrete_data`  |          `>= 0.80`|                     `>= 0.80`|`mismatch` |
| `label_only`     |          `>= 0.95`|                     `>= 0.80`|`mismatch` |

Step tier is derived deterministically by `classifyFaithfulnessStepTier`:

- If `step.data` carries a digit, or
- If `step.expected` carries a digit, or
- If `step.data` is at least four characters long,

then the step is `concrete_data`. Otherwise it is `label_only`. The
`tierReason` is recorded on every entry of the persisted tier report so
reviewers can audit the choice.

## Persisted artifacts

Every run that produces a non-refused `faithfulness_judge.json` now
also persists `faithfulness-tier-report.json` next to it. The artifact
schema is `FAITHFULNESS_TIER_REPORT_SCHEMA_VERSION = "1.0.0"` and the
entry shape is:

```jsonc
{
  "schemaVersion": "1.0.0",
  "contractVersion": "1.19.0",
  "generatedAt": "2026-05-08T18:17:37.630Z",
  "jobId": "K0-…",
  "aggregateScore": 0.95,
  "aggregateThreshold": 0.8,
  "aggregatePasses": true,
  "stepCount": 12,
  "matchCount": 9,
  "evidencePartialCount": 3,
  "mismatchCount": 0,
  "entries": [
    {
      "testCaseId": "tc-loan-form-open",
      "stepIndex": 2,
      "tier": "label_only",
      "tierReason": "step has no concrete input or expected data",
      "verdict": "evidence_partial",
      "score": 0.85,
      "passesThreshold": true,
      "message": "label visible; description below the fold"
    }
  ]
}
```

The report is byte-stable: entries are sorted by `(testCaseId, stepIndex)`
and the JSON is canonicalised through `canonicalJson`.

## Calibration anchors

Sixty calibration anchors live under
[`fixtures/test-intelligence/faithfulness-calibration/`][1]:

- 30 `label_only` anchors from accepted runs that the v1 rubric mis-flagged.
- 30 `concrete_data` anchors with positive contradictions that must
  remain `mismatch`.

The anchors are loaded by the offline calibration harness through the
existing `judge-calibration-eval` framework — calibration math is
**offline-only** by design. The runtime tier thresholds are pinned to
the issue's acceptance criteria; only profile-scoped overrides
(`policyOverrides`) can move the aggregate floor.

[1]: ../../fixtures/test-intelligence/faithfulness-calibration

## Profile compatibility

`eu-banking-default` keeps the strict `0.80` cross-modal floor. Any
future profile may override the floor through the existing
`policyOverrides` payload — the override moves the aggregate threshold,
the per-step tier thresholds remain pinned because they encode the
*meaning* of the verdicts, not policy strictness.

## Backwards compatibility

`FaithfulnessVerdict.stepVerdicts` is **optional**. Verdicts persisted
under the old `FAITHFULNESS_VERDICT_SCHEMA_VERSION = "1.0.0"` continue
to load without changes; the policy gate falls back to the legacy
case-level pass/fail aggregation in that case. New verdicts emitted
under `1.1.0` carry both the legacy `hallucinations` /
`mismatches` arrays AND the per-step rubric, so consumers can
upgrade incrementally.

## FinOps

The new schema adds at most one short JSON record per generated step
(`{testCaseId, stepIndex, verdict, message}`). On a benchmark with the
K0 distribution (≈ 60 cases × ≈ 6 steps) this adds an upper bound of
~360 short records to the structured-output payload, which under
provider tokenization measures as a single-digit-percent increase
against the K0 prompt-and-response total. The +10 % FinOps headroom
required by the acceptance criteria is preserved.
