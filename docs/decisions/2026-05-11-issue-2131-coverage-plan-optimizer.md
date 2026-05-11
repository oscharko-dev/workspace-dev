# 2026-05-11 — Issue #2131: Multi-modal coverage optimizer (NSGA-II Pareto-frontier quota allocation)

- **Status:** Accepted
- **Date:** 2026-05-11
- **Issue:** [#2131](https://github.com/oscharkowski/workspace-dev/issues/2131) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 4 — P4 above SOTA (differentiator)
- **Effort:** L (2 sprints)

## Context

Per-screen coverage quotas (`policy:technique-coverage-minimum`) are tier-elastic since Issue #2068 — equivalence-partitioning quota scales with the coverage-relevant field count via [`TIER_ELASTIC_EP_TIERS`](../../src/contracts/index.ts) — but the multipliers themselves are operator-tuned. Every other technique (boundary-value-analysis, decision-table, use-case, accessibility, …) still carries a static, hand-picked floor. Two failure modes follow:

1. The static floors are routinely set too high on small fixtures: the harness spends tokens generating cases that don't measurably move the mutation kill rate, because the surrogate-kill curve has long since saturated.
2. The static floors are routinely set too low on large fixtures: the harness misses kills that one or two more cases per technique would have caught, because the operator picked the floor based on a small-fixture sample.

A single scalar weighting cannot fix this — different fixtures sit on different points of the cost / quality trade-off. The right object to publish is the *Pareto frontier* per fixture, plus a recommended point chosen against a contractual constraint (here: AC #4 — `>=` 95 % of the best-known kill rate at `<=` 80 % of the current static token cost). NSGA-II (Deb, Pratap, Agarwal, Meyarivan; IEEE TEC 2002) is the canonical multi-objective evolutionary algorithm for this kind of frontier search.

## Decision

We add a dependency-light `coverage-plan-optimizer` module under `src/test-intelligence/`, a deterministic per-run benchmark artifact at `<runDir>/coverage-optimizer/coverage-plan-optimizer.json`, a committed baseline fixture under `fixtures/test-intelligence/coverage-plan-optimizer/`, and a CI gate that regenerates the baseline on every PR and asserts byte-equality. The optimizer ships as a LIBRARY SURFACE — pure functions an operator can call on benchmark refresh — not as an auto-wired runtime hook, mirroring the pattern from Issue #2128 ([`training-influence-dp-budget`](../../src/test-intelligence/training-influence-dp-budget.ts)).

### 1. Module layout — [`src/test-intelligence/coverage-plan-optimizer.ts`](../../src/test-intelligence/coverage-plan-optimizer.ts)

- `evaluatePlan(plan, fixture)` — pure surrogate-model evaluator. Maps a per-technique quota allocation to an `ObjectiveVector` with four objectives:
  - **Maximize** `mutationKillRate` — `Σ_t coeff_t · (1 − exp(−quota_t / saturation_t)) / Σ_t coeff_t`. The saturated `1 − exp(−q/s)` form reproduces the diminishing-returns shape observed in the historical `mutation-killing-eval` corpus.
  - **Maximize** `techniqueCoverage` — fraction of techniques exercised at quota `> 0`, weighted by `coverageCoefficient`.
  - **Minimize** `tokenCost` — `Σ_t tokensPerUnit_t · quota_t`.
  - **Minimize** `latencyMs` — `Σ_t latencyMsPerUnit_t · quota_t`.
  - Numbers are rounded to a stable 9-decimal-place precision so identical inputs produce byte-identical artifacts.
- `optimizeFixture({fixture, config, seed})` — runs the NSGA-II loop on a single fixture:
  - Mulberry32 PRNG seeded with `sha256("${topSeed}|${fixtureId}")[0..4]` (same primitive as [`cost-routing-quality-sampler.ts`](../../src/test-intelligence/cost-routing-quality-sampler.ts)).
  - Population seeded with the fixture's `currentQuota` plus `populationSize − 1` uniformly-random valid plans.
  - Each generation: binary tournament selection on `(rank, crowdingDistance)`, uniform crossover (`crossoverRate = 0.9`), per-gene polynomial-like perturbation mutation (`mutationRate = 0.15`), `(parents + offspring)` elitist replacement.
  - Returns the first Pareto front, the AC-#4-compliant `recommendedPlan` (or `null` with a `selectionReason` explaining why), and an SVG Pareto-frontier plot.
- `selectRecommendedPlan({front, fixture})` — pure contract enforcement of AC #4:
  - `mutationKillRate >= 0.95 · fixture.bestKnownKillRate`
  - `tokenCost <= 0.80 · fixture.currentTokenCost`
  - Picks the lowest-cost compliant member; ties broken by maximum kill rate, then canonical plan string.
- `buildCoveragePlanOptimizerReport({fixtures, config, seed, generatedAt})` — orchestrator. Sorts fixtures by id, rejects duplicates / empty input / negative seeds, sets `satisfiesAcceptanceCriteria = ∧ fixtures.satisfiesAcceptanceCriteria`.
- `writeCoveragePlanOptimizerReport({report, runDir})` — atomic `${path}.${pid}.${uuid}.tmp` rename, identical pattern to [`writeCarbonFootprintReport`](../../src/test-intelligence/carbon-footprint.ts).
- `renderParetoFrontierSvg({fixture, front, recommendedPlan})` — pure SVG plot of the `(tokenCost, mutationKillRate)` projection, with the AC-#4 floor / ceiling as dashed reference lines and the recommended point ringed.

### 2. Reference benchmark corpus

The committed baseline ships three reference fixtures derived from the historical `mutation-killing-eval` and `finops-report` corpus:

- `reference-login-form` — 2 techniques (equivalence_partitioning, boundary_value_analysis). Small-fixture archetype.
- `reference-search-results` — 3 techniques. Medium-fixture archetype.
- `reference-checkout-flow` — 5 techniques (incl. decision-table, use-case, accessibility). Large-fixture archetype.

The coefficients are baked into source ([`REFERENCE_BENCHMARK_FIXTURES`](../../src/test-intelligence/coverage-plan-optimizer.ts)) so the baseline is reproducible from a clean checkout. Operators with their own fixture corpora call `buildCoveragePlanOptimizerReport(...)` directly — the reference corpus is just the CI baseline, not a contract.

### 3. Determinism / byte stability

The optimizer is fully deterministic in `(fixtures, config, seed, generatedAt)`:

- Mulberry32 PRNG; per-fixture seeds derived via SHA-256 so adding / removing fixtures from the top-level run does not perturb the others.
- Every objective number rounded to `1e-9` precision before publication.
- Pareto front sorted by `(tokenCost ↑, mutationKillRate ↓, canonical-plan-string)` before serialization.
- Plans serialized with sorted keys via `canonicalJson`.
- SVG plot coordinates truncated to two decimal places via a fixed `toFixed(2)` formatter.

The committed baseline carries `generatedAt = "1970-01-01T00:00:00.000Z"` so the artifact bytes do not drift with wall-clock time, mirroring the convention from Issue #2130.

### 4. CI gate

`G_COVERAGE_OPTIMIZER_BASELINE_PASS` (in [`pr-quality-gate.yml`](../../.github/workflows/pr-quality-gate.yml)) runs [`scripts/check-coverage-plan-optimizer-baseline.mjs`](../../scripts/check-coverage-plan-optimizer-baseline.mjs) on every PR. The check:

1. Regenerates the baseline from source.
2. Byte-compares the regenerated JSON against the committed `fixtures/test-intelligence/coverage-plan-optimizer/baseline.json`.
3. Byte-compares each regenerated SVG against the committed `pareto-<fixtureId>.svg`.
4. Asserts that every reference fixture's recommended plan satisfies AC #4 (no fixture may regress past the kill-rate floor or the cost ceiling).

Any change to the surrogate model, the NSGA-II implementation, the default config, or the reference corpus that affects the baseline bytes will fail the gate until the operator regenerates the artifacts via `pnpm run generate:coverage-plan-optimizer-baseline` and lands an ADR review for the regenerated baseline.

### 5. AC #4 — `>= 95 % kill at <= 80 % cost`

The acceptance criterion is intentionally a two-objective contract (kill-rate floor + cost ceiling) rather than a scalar weighted sum, so the recommendation is interpretable without an operator-supplied weight. `selectRecommendedPlan` enforces the contract as a hard filter on the Pareto front. When no front member is compliant, `recommendedPlan` is `null` and `selectionReason` carries one of three diagnostic values:

- `"empty_front"` — degenerate (cannot happen for a well-formed fixture but defensive).
- `"no_kill_rate_above_floor"` — the surrogate cannot reach `0.95 · bestKnownKillRate` under any quota plan; the operator must re-tune coefficients or re-measure `bestKnownKillRate`.
- `"no_cost_below_ceiling"` — every compliant plan costs more than `0.80 · currentTokenCost`; the operator must either raise the static baseline cost or accept a lower kill-rate floor.

### 6. Pareto-frontier plots (AC #5)

Each `FixtureOptimizationResult` carries `paretoPlotSvg: string` so the plot ships with the JSON report — no second artifact to attest, no second hash to maintain. The plot uses the `(tokenCost, mutationKillRate)` projection because those are the two objectives AC #4 constrains; the `(techniqueCoverage, latencyMs)` projection is implicit in the JSON for downstream tooling.

The SVG is deterministic, ARIA-labeled, and inlines no fonts (uses `font-family="monospace"`) — it renders in any browser, in evidence-replay tooling, and as a static image in compliance dossiers.

### 7. What this is NOT

- **Not a runtime override.** The optimizer is offline planning. It never invokes a gateway, never executes an LLM call, never inspects a live job. The recommended plan is intended for the *next* benchmark refresh — the operator updates the policy-profile quotas (or a derived profile) on benchmark cadence, not mid-run.
- **Not a reproducibility guarantee.** The surrogate-model coefficients are *estimates* derived from a historical corpus. Two operators with different benchmark corpora will land on different recommendations — this is expected and is the point. The committed reference corpus is a CI baseline, not a global contract.
- **Not a global-optimum claim.** NSGA-II returns a *Pareto frontier*, not a global optimum. The recommended plan is the cheapest plan on the frontier that satisfies AC #4 — it is not the unique best plan, and an operator who weights latency or coverage more heavily would pick a different point on the same frontier.

The methodology disclaimer (`COVERAGE_PLAN_OPTIMIZER_METHODOLOGY_DISCLAIMER`) is stamped verbatim on every produced report.

## Consequences

**Closes acceptance criteria:**

- ✅ `CoveragePlanOptimizer` with NSGA-II implementation — `optimizeFixture(...)` runs the canonical generational loop: non-dominated sorting + crowding-distance + binary-tournament selection + crossover + mutation + elitist `(parents + offspring)` replacement.
- ✅ Objectives: maximize (mutation kill rate, technique coverage), minimize (token cost, latency) — `COVERAGE_PLAN_OPTIMIZER_OBJECTIVES` is the closed four-element ordered list and `COVERAGE_PLAN_OPTIMIZER_OBJECTIVE_DIRECTIONS` pins the direction per objective.
- ✅ Per-fixture optimal quota plan recomputed on benchmark refresh — `buildCoveragePlanOptimizerReport(...)` is the operator entry point. The deterministic seed means re-running with the same fixtures produces the same plan; changing the corpus (a "benchmark refresh") produces a new plan.
- ✅ CI baseline: optimizer holds at `>= 95 %` of best-known kill rate at `<= 80 %` of current token cost — `selectRecommendedPlan(...)` enforces the contract; `G_COVERAGE_OPTIMIZER_BASELINE_PASS` fails the build if any reference fixture regresses past either threshold.
- ✅ Pareto-frontier plot per fixture published in benchmark report — `FixtureOptimizationResult.paretoPlotSvg` carries the SVG; the committed `pareto-<fixtureId>.svg` files publish them out-of-band as well.
- ✅ Documented in `docs/decisions/` ADR — this file.

**Backwards compatibility.** The optimizer is purely additive: it does not touch any existing contract type, manifest, fixture, or policy profile. The technique-quota gate ([`technique-quota.ts`](../../src/test-intelligence/technique-quota.ts)) is unchanged — quotas are still resolved against the operator-tuned `policy:technique-coverage-minimum` rule. Operators wire the optimizer's recommended plan back into the policy profile out-of-band, not via a runtime hook.

**Surface change.** New exports under `src/test-intelligence/coverage-plan-optimizer.ts`. CONTRACT_CHANGELOG entry `[1.42.0]` documents the additive minor bump.

**Performance.** The NSGA-II loop is `O(populationSize² · generations · objectives)` per fixture (the non-dominated sort dominates). For the default `(populationSize=40, generations=60, 4 objectives, 3 reference fixtures)` it completes in well under a second on commodity hardware. Larger corpora scale linearly in fixture count — each fixture is independent.

**Operational risk.** The surrogate-model coefficients are *estimates*. An operator who trusts them blindly may land on a recommendation that performs worse than the static baseline on the real corpus. The recommended workflow is to (a) refresh the corpus from current production data, (b) re-fit coefficients, (c) run the optimizer, (d) A/B the recommended plan against the static baseline before promoting it. The ADR + the methodology disclaimer make this explicit; a future Issue may automate steps (a)+(b) into a feedback loop.

## Alternatives considered

- **Single-objective scalar GA with operator weights.** Rejected: forces the operator to commit to a weight before they have seen the trade-off curve. The Pareto-frontier output makes the trade-off legible *first*, then asks the operator to pick a point.
- **MOEA/D (decomposition-based) instead of NSGA-II.** Rejected: more parameters to tune (reference-vector distribution), harder to explain in an ADR, no measurable advantage on a 4-objective surface this small. NSGA-II is the textbook choice for `<= 4` objectives.
- **Analytical optimum via Lagrange multipliers.** Rejected: the surrogate model is concave in quota but the per-technique `minQuota / maxQuota` integer constraints make the closed-form derivation tractable only on degenerate fixtures. The GA handles the integer constraints natively.
- **Wire the optimizer into the runtime job-engine.** Rejected: same reason as Issue #2128's accountant — until customers commit to per-fixture coefficients, auto-wiring would force every deployment to either set a corpus or carry the burden of explicitly disabling the gate. Ship the library now, wire the runtime entry-point in a future Issue once the operator-facing knob has stabilized.

## References

- Deb, Pratap, Agarwal, Meyarivan (2002), "A Fast and Elitist Multiobjective Genetic Algorithm: NSGA-II", IEEE Transactions on Evolutionary Computation, 6(2), 182–197.
- Issue #2068 — tier-elastic equivalence-partitioning quota (the static-quota predecessor this work optimizes against).
- Issue #2128 — training-influence DP budget accountant (the same library-surface pattern this work follows).
- Issue #2130 — cross-tenant isolation proof artifact (the same `generate / check / committed-fixture / G* gate` pattern this work follows).
