# React Web Performance Gate

`workspace-dev` bundles a template-level performance workflow under `template/react-mui-app`:

- `pnpm run perf:baseline`
- `pnpm run perf:assert`

The workflow measures Lighthouse performance for configured routes/profiles, computes p75 metrics, and enforces:

- INP p75 (`inp_p75_ms`)
- LCP p75 (`lcp_p75_ms`)
- CLS p75 (`cls_p75`)
- Initial JavaScript transfer (`initial_js_kb`)
- Route transition proxy (`route_transition_ms`)

Lighthouse JSON parsing supports both legacy (`report.lhr.audits`) and current (`report.audits`) schemas.
When INP is unavailable, the runner records explicit proxy sources (`total-blocking-time` / `interactive`) in report metadata.

## Budget policy

Budgets and route/profile scope are defined in:

- `template/react-mui-app/perf-budget.json`

Regression threshold defaults to `10%` (`regressionTolerancePct`).

## Artifacts

By default:

- `artifacts/performance/perf-baseline.json`
- `artifacts/performance/perf-baseline-report.json`
- `artifacts/performance/perf-assert-report.json`
- `artifacts/performance/lighthouse-*.json`

The output location can be overridden with `FIGMAPIPE_PERF_ARTIFACT_DIR`.

## Runtime opt-in validation

`validate.project` can execute template `perf:assert` after build when enabled:

- `FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION=true`
- `FIGMAPIPE_ENABLE_PERF_VALIDATION=true` (legacy alias)
