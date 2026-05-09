# Case Confidence

Issue #2074 adds a calibrated per-case confidence score to the Test Intelligence export surface. Every generated test case can now carry:

- `confidence`: calibrated acceptance probability in `[0, 1]`
- `confidenceComponents`: auditable raw inputs used to derive that probability

The goal is operational, not cosmetic: reviewers should be able to sort low-confidence cases first, while auditors can inspect both the calibrated output and the underlying uncertainty signals.

## Surface Area

The runner now emits confidence in three places:

- `generated-testcases.json`
- `customer-markdown/testfaelle.md` when `--show-confidence` is enabled
- `policy-report.json` summary percentiles:
  - `confidenceMean`
  - `confidenceP10`
  - `confidenceP50`
  - `confidenceP90`

Customer markdown keeps confidence hidden by default in customer mode. Technical/internal renders default it on.

## Raw Inputs

`confidenceComponents` records the exact signals used to build the pre-calibration score:

- `judgePanelAgreement`
- `faithfulnessScore`
- `selfConsistencyAgreement`
- `ragHitStrength`
- `oracleResolved`
- `rawScore`

`rawScore` is a deterministic weighted blend of the preceding fields. The runner does not call any LLM to compute confidence.

## Calibration Flow

Runtime calibration is dataset-scoped and offline-fit:

1. The runner scans the dataset-local benchmark corpus under `sandbox/test-case/<dataset>/`.
2. If `accepted-runs/case-confidence-labels.json` exists, those labels are treated as the calibration source of truth.
3. Otherwise the runner falls back to historical `policy-report.json` decisions from prior local runs:
   - `approved` -> positive label
   - `needs_review` / `blocked` -> negative label
4. A Platt-scaling sigmoid is fit over the historical raw scores.
5. The resulting curve is persisted to `sandbox/calibration/case-confidence-curve.json`.

The persisted artifact includes:

- calibration source
- sample counts
- sigmoid coefficients (`intercept`, `slope`)
- training Brier score
- held-out Brier score when enough historical samples exist

If the local corpus does not contain enough positive and negative examples, the runner falls back to a documented default sigmoid and still emits non-null confidence for every case.

## Operational Guidance

- Use `--show-confidence` for internal review bundles or benchmark debugging.
- Leave confidence hidden in customer-facing exports unless the consumer explicitly wants uncertainty surfaced.
- Treat confidence as prioritization guidance, not as a replacement for hard gates. Policy, validation, faithfulness, and judge consensus still own release blocking.

## Label Manifest

Optional manual labels can be supplied at:

`sandbox/test-case/<dataset>/accepted-runs/case-confidence-labels.json`

Recommended shape:

```json
{
  "labels": [
    { "runId": "2026-05-07T18-46-01-344Z", "testCaseId": "tc-123", "label": "accepted" },
    { "runId": "2026-05-09T10-48-48-149Z", "testCaseId": "tc-456", "label": "needs_review" }
  ]
}
```

The file is local-only benchmark state and should remain under `sandbox/`.
