# Local Test Intelligence benchmark protocol

This document defines the deterministic local benchmark used to score
test-intelligence releases. It is the local-equivalent of the Wave-2
evaluation harness: a fixed input set, a fixed deployment matrix, and a
canonical scorecard that includes the production hard gates plus the
new release-grade KPIs (`mutationKillRate`, negative-case lift, judge
panel agreement).

The scorecard is referenced by
[`cross-family-judges.md`](./cross-family-judges.md),
[`adversarial-critic.md`](./adversarial-critic.md), and
[`mutation-eval.md`](./mutation-eval.md); all three modules expect
benchmark runs to surface their KPIs in this file's "Scorecard" section.

> Historical note: prior changelog entries (Issues #2038 and #2053)
> reference the earlier path
> `sandbox/benchmarks/test-intelligence/LOCAL_BENCHMARK_PROTOCOL.md`.
> The protocol now lives in the docs tree because the `sandbox/`
> directory is gitignored (and blocked by the repository's
> tenant-metadata secret guard). Run output continues to land under
> `sandbox/benchmarks/` locally; the protocol document itself is the
> source of truth for the scorecard template.

## Input set

The benchmark input set is the
`src/test-intelligence/fixtures/eval-baseline-*.json` archetype suite
(simple form, calculation-heavy, validation-heavy, optional-fields,
ambiguous-rules, multi-context, complex-mask). The fixtures are
checked-in canonical-JSON; they are not regenerated as part of this
protocol.

## Deployment matrix

Benchmark runs use the operator's vetted deployment matrix
(`workspace-dev test-intelligence doctor` confirms the resolved roles).
A benchmark run that degrades into a single-model topology fails the
gate before the LLM call dispatches; see
[`cross-family-judges.md`](./cross-family-judges.md).
When `--require-multi-agent-topology` is enabled, the preflight now requires
the full production lane set: generator, dedicated logic judge,
coverage planner, risk ranker, visual primary, visual fallback, and
a11y judge. Deprecated deployment env aliases also fail the gate.

## Invocation

```sh
workspace-dev test-intelligence run \
  --figma-url <fixture-url> \
  --output ./benchmark-out \
  --enable-mutation-eval \
  --harness-mode shadow_eval \
  --diversity-passes 2
```

Benchmark runs always pass `--enable-mutation-eval` so the scorecard
can read the persisted `mutation-report.json`. The evaluator is fully
deterministic and never calls the LLM gateway, so enabling it does not
consume any token budget.

## Scorecard

For every run the protocol records the following deterministic outputs:

| KPI | Source artifact | Pass threshold |
| --- | --- | --- |
| Hard gates G1–G7 | `policy-report.json#jobLevelViolations` | All `passed` (no `error`-severity job-level violations) |
| `G-NEG-CASE` adversarial-critic lift | `policy-report.json#gateResults[?gateId=="G-NEG-CASE"]` | `status === "passed"` and `observedRatio >= 0.30` |
| `mutationKillRate` | `policy-report.json#mutationKillRate.killRate` and `mutation-report.json` | `>= 0.85` (the documented Issue #1753 KPI) |
| `invariantCoverage` | `coverage-report.json#invariantCoverage.ratio` | `>= 0.75` (Wave-2 active-dataset target) |
| `fieldLifecycleCoverage` | `coverage-report.json#fieldLifecycleCoverage.ratio` | `>= 0.80` (Issue #2072 active-dataset target) |
| Judge-panel agreement | `judge-consensus.json#agreement` | `agree` for at least 80 % of cases |
| `negativeCaseRatio` | `coverage-report.json#negativeCaseCount / totalTestCases` | `>= 0.30` after the adversarial-critic loop |

A benchmark run is considered "release-grade" iff every KPI in the
table meets its pass threshold. A run that misses any KPI is recorded
in the scorecard with the unkilled mutation ids
(`mutation-report.json#unkilledMutations`), the failed gate ids
(`policy-report.json#gateResults`), and the per-class kill-rate breakdown
(`mutation-report.json#byClass`) so the next iteration can target the
weakest signal.

## Reproducibility

Every benchmark artifact is byte-stable: `mutation-report.json`,
`policy-report.json`, `coverage-report.json`, and
`validation-report.json` use canonical-JSON with sorted keys and
six-digit ratio rounding. Two benchmark runs with the same input set
and deployment matrix produce identical artifact bytes (cache hits
notwithstanding); a tampered artifact fails the post-write evidence
verification.

## Out-of-scope

- Real-SUT mutation testing — the local benchmark uses the synthetic
  SUT stub described in [`mutation-eval.md`](./mutation-eval.md).
- Higher-order mutations (combinations of catalog entries) — first-order
  only.
- Cross-tenant baselines — the benchmark scorecard is per-tenant; the
  production-runner replay cache is bound to the tenant scope at
  construction time.

## References

- [`mutation-eval.md`](./mutation-eval.md) — mutation-killing eval
  suite + `mutationKillRate` KPI (Issue #2041).
- [`adversarial-critic.md`](./adversarial-critic.md) — adversarial-critic
  loop + `G-NEG-CASE` hard gate (Issue #2053).
- [`property-based-layer.md`](./property-based-layer.md) —
  domain-invariant registry + `invariantCoverage` (Issue #2040).
- [`cross-family-judges.md`](./cross-family-judges.md) — judge ensemble
  + human review (Issue #2038).
