# 2026-05-10 — Issue #2120: Distribution-shift detection (input-side drift sentinel)

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2120](https://github.com/oscharkowski/workspace-dev/issues/2120) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 3 — P3 reach SOTA bar

## Context

Issue [#2103](https://github.com/oscharkowski/workspace-dev/issues/2103) shipped a drift canary that compares **output**-side metrics (ECE, Brier, faithfulness, hallucination, judge accuracy, provider fingerprints) against a rolling 30-day baseline. That lane fires once the model's behavior on the holdout set has already drifted.

Concept drift typically shows up at the **input** distribution first — new component families in upstream Figma, a new locale dominating the suite, a regulator-mandated re-categorisation that pushes more cases into `regulated_data`. By the time the holdout's calibration moves, the underlying input distribution has already shifted for several days. Issue #2120 closes that lag: an input-side sentinel that reads the same job stream the production runner already processes and fires before the metric lane does.

## Decision

We add a single new pure module, [src/test-intelligence/distribution-shift-detector.ts](../../src/test-intelligence/distribution-shift-detector.ts), wired into the existing test-intelligence index. The module records a deterministic per-evaluation-window snapshot, compares against a rolling 30-day baseline, and emits findings through a sibling `DistributionShiftAlertSink` shape that mirrors the existing `DriftAlertSink` from #2103 so the alert pipeline can consume both lanes uniformly.

### 1. Per-evaluation-window snapshot

The runner caller builds a `JobDistributionInput[]` from the jobs that ran in the window and calls `recordInputDistributionSnapshot`. The snapshot captures three histograms plus an optional embedding centroid:

| Dimension | Shape | Source |
| --- | --- | --- |
| `tokenHistogram` | 256-bucket integer array | FNV-1a hash of lowercase word tokens from screen names + node text + node names |
| `labelHistogram` | five-cell `TestCaseRiskCategory` record | Counts across all `GeneratedTestCase.riskCategory` in the window |
| `irShapeHistogram` | sorted `Record<string, number>` | Counts per Figma `nodeType` across all screens in the window |
| `embeddingCentroid` (optional) | 1D vector | Average of caller-supplied per-screen embeddings (`phi-4-mini-instruct` from #2099 in embedding-only mode) |

The snapshot is byte-stable for byte-identical inputs. Token text never crosses the boundary — only bucket counts are persisted, which keeps the artifact safe to land alongside compliance-bound runs.

### 2. KL divergence with Laplace smoothing

The detector computes symmetric KL divergence with add-1 smoothing:

```
P(i) = (current[i] + 1) / (sum(current) + N)
Q(i) = (baseline[i] + 1) / (sum(baseline) + N)
KL_sym = ½ · ( Σ P(i)·log(P(i)/Q(i)) + Σ Q(i)·log(Q(i)/P(i)) )
```

Symmetric KL is order-independent so the metric is stable when baseline-vs-current asymmetry would otherwise dominate, and add-1 smoothing avoids the `log(0)` trap when current-only or baseline-only buckets exist. The threshold is fixed at `0.3` (per AC) — fires as `warning` severity.

The `baseline` in the formula is the **sum** of past records' histograms, not the mean. Under add-1 smoothing, scaling the baseline-side counts changes only the denominator, so summing rather than averaging is mathematically equivalent for KL but cheaper to compute (one pass over records).

### 3. Embedding-centroid drift in σ-units

When the caller supplies an embedding provider, the detector embeds each screen, averages the per-screen vectors into a single centroid per snapshot, and tracks centroid drift as L2 distance from the **rolling-mean centroid** of past records. The σ scale is the standard deviation of past centroids' L2 distances from the rolling-mean centroid.

```
μ        = mean of past centroids
hist[i]  = ‖c_i − μ‖₂   for each past centroid c_i
σ        = stddev(hist)
shift    = ‖current − μ‖₂
sigma_z  = (shift − mean(hist)) / σ
```

Alert fires as `error` severity when `sigma_z > 2`. When `σ ≈ 0` (perfectly stable historical centroids) the σ-z metric is undefined — the detector falls back to "alert when shift > epsilon" so genuinely sudden shifts on a previously stable baseline still surface. The σ-arm requires at least `DISTRIBUTION_SHIFT_MIN_HISTORY_FOR_SIGMA = 2` past centroids; below that the report records the L2 measurement but suppresses the alert.

### 4. Per-fixture-suite dashboard

Each run also emits `distribution-shift-dashboard.json` per fixture suite: latest snapshot + per-record KL/centroid trend + current findings + the documented thresholds. The admin portal reads that artifact directly to render the per-suite distribution-shift board (closes the AC "distribution-shift dashboard published per fixture suite").

### 5. Persistence

- Rolling baseline at `.workspace-dev/distribution-shift/<tenantId>/<policyProfileId>/<fixtureSuiteId>.baseline.json`. Append-only with `slice(-30)` trim, mirrors the drift-canary pattern from #2103.
- Per-run report `distribution-shift-report.json`, alerts `distribution-shift-alerts.json`, dashboard `distribution-shift-dashboard.json` — all canonical-JSON, written via `tmp + rename` atomic-replace.
- Identifier segments (`tenantId`, `policyProfileId`, `fixtureSuiteId`) are validated against `/^[A-Za-z0-9._-]+$/` before any path is built, so a malformed segment can never escape the runtime root.

## Consequences

**Closes acceptance criteria:**

- ✅ Per-job: token-distribution histogram, label-distribution, IR-shape distribution recorded
- ✅ Rolling 30-day baseline + KL-divergence shift detection
- ✅ Embedding-space drift via `phi-4-mini-instruct` (caller-supplied `DistributionShiftEmbeddingProvider`)
- ✅ Alert when KL > 0.3 OR embedding-centroid shift > 2σ
- ✅ Distribution-shift dashboard published per fixture suite
- ✅ Documented in `docs/eu-ai-act/post-market-monitoring.md` as Art. 9 ongoing monitoring

**Net surface change:** new file `src/test-intelligence/distribution-shift-detector.ts` (+ `.test.ts`) and additive re-exports from `src/test-intelligence/index.ts`. No public API in `src/index.ts` changes — the surface remains operator-facing inside the test-intelligence namespace. No `CONTRACT_VERSION` bump because no `src/contracts/index.ts` types changed.

**Trade-offs:**

- *256-bucket FNV-1a token histogram, not a real tokenizer.* Independent of any LLM tokenizer, deterministic, no PII risk. The trade-off is that two semantically identical token shapes from different vocabularies hash to different buckets — that's fine, the detector's job is to flag distribution change, and a vocabulary swap *is* a distribution change.
- *Embedding provider is operator-supplied.* The detector itself never makes a network call. This keeps the air-gapped flow unchanged when no provider is configured (then only the three histogram-KL findings can fire).
- *σ-arm needs two historical centroids.* While warming, the centroid alert is suppressed even if a sharp shift fires KL. This is intentional — σ-units are meaningless without historical scatter.
