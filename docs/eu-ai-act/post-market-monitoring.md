# Post-Market Monitoring

Issue #2103 adds a dedicated drift-canary lane for the test-intelligence stack. The purpose is narrow: detect silent model-behavior drift even when the configured `modelDeployment`, `modelRevision`, and `gatewayRelease` values remain unchanged.

## Scope

The canary runs once per day and can also be triggered manually. It exercises a deterministic five-fixture holdout set:

- `baseline-simple-form`
- `baseline-calculation`
- `baseline-optional-fields`
- `baseline-multi-context`
- `baseline-ambiguous-rules`

The lane runs the holdout set through the production runner and records:

- Brier score per risk category
- Expected calibration error (ECE) per risk category
- Faithfulness field coverage
- Faithfulness action coverage
- Faithfulness trace fidelity
- Hallucination rate
- Logic-judge accuracy / false-positive rate / false-negative rate
- Faithfulness-judge accuracy / false-positive rate / false-negative rate
- Provider-response fingerprints for the configured deployments

## Alert policy

The canary stores a rolling 30-day baseline under `.workspace-dev/drift-canaries/`. For each metric it alerts when either condition is true:

- the current value moves more than `2σ` from the rolling mean
- the Brier score moves by more than `0.05` in absolute terms
- per-risk-category ECE breaches its hard ceiling:
  - `regulated_data <= 0.05`
  - `financial_transaction <= 0.05`
  - all other categories `<= 0.10`

Provider-fingerprint alerts are immediate. If the response hash or output-token count changes while `modelRevision` and `gatewayRelease` stay constant, the canary raises an alert because that is the signature of silent provider drift.

Cross-family canaries are classified separately. When the same metric moves across both the `mistral-large-3` family and the `gpt-oss-120b` family in the same run, the report emits `cross_family_correlated_drift` so operators can distinguish provider-local changes from prompt or fixture drift.

## Artifacts

Each run writes:

- `artifacts/testing/drift-canary/<timestamp>/drift-report.json`
- `artifacts/testing/drift-canary/<timestamp>/drift-alerts.json`

The default `DriftAlertSink` is file-backed. CI treats any non-empty `drift-alerts.json` as a failing tail condition after the report is written and the rolling baseline is updated.

## Operations

Manual run:

```bash
pnpm run test:ti-drift-canary
```

Nightly automation:

- `.github/workflows/test-intelligence-drift-canary.yml`

Required environment:

- `WORKSPACE_TEST_SPACE_LLM_API_KEY`
- `WORKSPACE_TEST_SPACE_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_TESTCASE_MODEL_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_MODEL_ENDPOINT`
- `WORKSPACE_TEST_SPACE_VISUAL_PRIMARY_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_VISUAL_FALLBACK_DEPLOYMENT`

Optional overrides:

- `WORKSPACE_TEST_SPACE_LOGIC_JUDGE_DEPLOYMENT`
- `WORKSPACE_TEST_SPACE_DRIFT_CANARY_CROSS_FAMILY_DEPLOYMENT`

## Re-baselining

No manual “approve” mode exists for drift-canary history. The rolling baseline is append-only and automatically trims to the last 30 daily records. If operators need to re-seed after an intentional deployment reset, remove the relevant `.workspace-dev/drift-canaries/.../baseline.json` file and let the next run warm the baseline again.

## Distribution-shift detection (Issue #2120)

Drift-canary detects shifts on the **output** side (ECE / Brier / faithfulness / hallucination) on a five-fixture holdout set. Issue #2120 adds a sibling lane on the **input** side so concept drift surfaces before downstream metrics move. Both lanes are EU AI Act Art. 9 ongoing post-market monitoring controls.

### Recorded per evaluation window

Per fixture suite, one record per evaluation window (one per day, 30-day rolling) captures:

- **Token-distribution histogram.** A 256-bucket histogram of FNV-1a hashed lowercase word tokens taken from the canonical input text (screen names + node text + node names). Only the bucket counts are persisted; no raw input crosses the boundary.
- **Label distribution.** Counts per `TestCaseRiskCategory` (`low`, `medium`, `high`, `regulated_data`, `financial_transaction`) across all generated test cases in the window.
- **IR-shape distribution.** Counts per Figma `nodeType`, plus screen and test-case totals.
- **Embedding centroid (optional).** When an embedding provider is configured (typical production binding: `phi-4-mini-instruct` from Issue #2099 in embedding-only mode — cheap, no generation), the detector embeds each screen and averages the vectors into a single per-record centroid.

### Alert policy

The detector compares the current snapshot against the rolling-mean of past records and fires when either condition holds:

- **KL divergence** on any of the three histograms exceeds `0.3` (Laplace-smoothed symmetric KL, so the metric is order-independent and stable for sparse buckets).
- **Embedding-centroid drift** in σ-units of the historical L2-distance distribution between past consecutive centroids exceeds `2σ`. This requires at least two past consecutive centroids; while the σ-history is warming, the L2-distance is recorded but does not alert.

KL findings are emitted as `warning`. Embedding-centroid findings are emitted as `error` because — given a configured embedding provider — they signal that the input semantic space itself moved, not just surface vocabulary.

### Artifacts

Each run writes:

- `artifacts/testing/distribution-shift/<suite>/<timestamp>/distribution-shift-report.json` — snapshot, KL measurements, centroid measurement, findings.
- `artifacts/testing/distribution-shift/<suite>/<timestamp>/distribution-shift-alerts.json` — published findings (file-backed `DistributionShiftAlertSink`; CI treats any non-empty file as a tail-fail).
- `artifacts/testing/distribution-shift/<suite>/<timestamp>/distribution-shift-dashboard.json` — per-fixture-suite dashboard with the latest snapshot, the per-record KL/centroid trend, and the current findings. The admin portal reads this file to render the per-suite distribution-shift board.

Rolling baseline lives at `.workspace-dev/distribution-shift/<tenantId>/<policyProfileId>/<fixtureSuiteId>.baseline.json` and trims to the last 30 records (30-day rolling window when run daily).

### Re-baselining (distribution-shift)

Same append-only model as drift-canary. To re-seed after an intentional fixture-suite re-scoping, remove the relevant `<fixtureSuiteId>.baseline.json` file; the next run warms the baseline. Until at least two records exist the report carries `baselineStatus: "warming"` and KL findings are still emitted (the rolling mean is well-defined from one record), but centroid-σ findings stay suppressed until the σ-history has at least two L2 deltas.
