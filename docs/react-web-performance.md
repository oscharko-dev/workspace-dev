# React Web Performance

The bundled React template (`template/react-mui-app`) ships with a release-grade web performance gate. It measures the approved route and profile matrix, compares the results against the checked-in baseline, and fails release-path workflows when approved budgets regress.

## Source Of Truth

- Budgets and regression tolerance: `template/react-mui-app/perf-budget.json`
- Approved release baseline: `template/react-mui-app/perf-baseline.json`
- Ephemeral CI and local artifacts: `template/react-mui-app/artifacts/performance`
- Assertion runner: `template/react-mui-app/scripts/perf-runner.mjs`

The committed baseline is the canonical release reference. CI keeps `FIGMAPIPE_PERF_ALLOW_BASELINE_BOOTSTRAP=false`, so missing baselines fail instead of being silently recreated during release or dev gate runs.

## Gate Policy

- `pnpm --dir template/react-mui-app run perf:assert` is the authoritative assertion command.
- `.github/workflows/dev-quality-gate.yml` keeps the `performance-web` job non-blocking so teams can iterate without the dev gate failing on every approved baseline refresh.
- `.github/workflows/release-gate.yml` and `.github/workflows/changesets-release.yml` treat the same assertion as blocking.

At minimum, release reviewers must treat regressions in `lcp_p75_ms` and `cls_p75` as release blockers unless the baseline change is explicitly approved.

## Ownership And Review Expectations

Baseline and budget changes follow the repository CODEOWNERS policy. In this repository that means `@oscharko-dev` owns:

- `.github/workflows/`
- `scripts/`
- release-critical package metadata

When a PR changes `template/react-mui-app/perf-baseline.json` or `template/react-mui-app/perf-budget.json`, reviewers should verify:

- the product or template change intentionally altered performance characteristics
- the route/profile matrix is still limited to `["/","/overview","/checkout"]` and `["mobile","desktop"]` unless a separate issue approved expansion
- the attached `perf:assert` or `perf:baseline` output shows the expected movement, especially for `lcp_p75_ms` and `cls_p75`
- the refreshed baseline is committed in the same PR as the code that caused the change

## Refresh Procedure

Refresh the baseline only after the new numbers are intentional and approved.

1. Build the template app: `pnpm --dir template/react-mui-app run build`
2. Recompute the approved baseline: `pnpm --dir template/react-mui-app run perf:baseline`
3. Review the generated `template/react-mui-app/perf-baseline.json`
4. Re-run the assertion against the refreshed baseline: `pnpm --dir template/react-mui-app run perf:assert`
5. Commit the baseline update with the code change that required it

Do not enable baseline bootstrap in CI to refresh the file implicitly. Release-path workflows must keep the baseline reviewable in git history.
