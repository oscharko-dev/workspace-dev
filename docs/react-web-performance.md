# React Web Performance

The bundled React templates ship with release-grade web performance gates. Each template measures its approved route and profile matrix, compares the results against the checked-in baseline, and fails release-path workflows when approved budgets regress.

## Source Of Truth

- MUI template budgets and regression tolerance: `template/react-mui-app/perf-budget.json`
- MUI template approved release baseline: `template/react-mui-app/perf-baseline.json`
- Tailwind template budgets and regression tolerance: `template/react-tailwind-app/perf-budget.json`
- Tailwind template approved release baseline: `template/react-tailwind-app/perf-baseline.json`
- Ephemeral CI and local artifacts: `template/<template-name>/artifacts/performance`
- Assertion runner: `template/<template-name>/scripts/perf-runner.mjs`

The committed baseline is the canonical release reference. CI keeps `FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP=false`, so missing baselines fail instead of being silently recreated during release or dev gate runs.
The Tailwind template uses Playwright browser-timing collection so the default
template does not ship Lighthouse's transitive telemetry SDK packages.

## Gate Policy

- `pnpm --dir template/react-mui-app run perf:baseline` refreshes the approved MUI template baseline.
- `pnpm --dir template/react-mui-app run perf:assert` is the authoritative MUI template assertion command.
- `pnpm --dir template/react-tailwind-app run perf:baseline` refreshes the approved Tailwind template baseline.
- `pnpm --dir template/react-tailwind-app run perf:assert` is the authoritative Tailwind template assertion command.
- `pnpm run perf:web:tailwind:baseline:gate` captures a Tailwind measured-baseline artifact for release gates without overwriting the committed baseline.
- `.github/workflows/dev-quality-gate.yml` keeps the matrixed `performance-web` job non-blocking so teams can iterate without the dev gate failing on every approved baseline refresh.
- `.github/workflows/release-gate.yml` and `.github/workflows/changesets-release.yml` treat the same assertions as blocking.
- The MUI template currently covers `["/","/overview","/checkout"]`; the Tailwind seed covers `["/"]` until the default pipeline emits routed output. Both templates use the `["mobile","desktop"]` profile matrix.

Workflow gates first run `perf:baseline` with
`FIGMAPIPE_PERF_BASELINE_PATH=artifacts/performance/perf-measured-baseline.json`
so reviewers get current run evidence in uploaded artifacts. They then run
`perf:assert` with `FIGMAPIPE_PERF_BASELINE_PATH=perf-baseline.json` and
`FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP=false`, so blocking checks still
compare against the reviewed baseline committed beside the template.

At minimum, release reviewers must treat regressions in `lcp_p75_ms` and `cls_p75` as release blockers unless the baseline change is explicitly approved.

## Ownership And Review Expectations

Baseline and budget changes follow the repository CODEOWNERS policy. In this repository that means `@oscharko-dev` owns:

- `.github/workflows/`
- `scripts/`
- release-critical package metadata

When a PR changes a template `perf-baseline.json` or `perf-budget.json`, reviewers should verify:

- the product or template change intentionally altered performance characteristics
- the route/profile matrix still matches the template's approved budget file unless a separate issue approved expansion
- the attached `perf:assert` or `perf:baseline` output shows the expected movement, especially for `lcp_p75_ms` and `cls_p75`
- the refreshed baseline is committed in the same PR as the code that caused the change

## Refresh Procedure

Refresh the baseline only after the new numbers are intentional and approved.

1. Build the template app, for example `pnpm --dir template/react-tailwind-app run build`
2. Recompute the approved baseline, for example `pnpm --dir template/react-tailwind-app run perf:baseline`
3. Review the generated `perf-baseline.json`
4. Re-run the assertion against the refreshed baseline, for example `pnpm --dir template/react-tailwind-app run perf:assert`
5. Commit the baseline update with the code change that required it

Do not enable baseline bootstrap in CI to refresh the file implicitly. Release-path workflows must keep the baseline reviewable in git history.
