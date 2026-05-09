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
