# 2026-05-10 — Issue #2119: Active-learning sample-selection loop

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2119](https://github.com/oscharkowski/workspace-dev/issues/2119) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Closes audit finding:** Throughput — _"Gold-set growth is hand-curated; manual labeling is a bottleneck as the bench scales past 50 fixtures."_

## Context

The judge calibration gold set (`fixtures/test-intelligence/faithfulness-calibration/`) and the inter-rater agreement protocol (Issue [#2109](https://github.com/oscharkowski/workspace-dev/issues/2109)) together define the floor on calibration validity (Cohen's κ ≥ 0.8 target, ≥ 0.7 hard floor). Once the bench moves past 50 fixtures, hand-picking which production cases deserve a human label becomes the throughput bottleneck — and the choices SMEs make are biased toward easy cases ("interesting" cases tend to land in incidents rather than the calibration set).

Active learning fixes the routing problem. Three signals already exist in the repo and identify the cases where a human label is most informative:

1. **Predictive uncertainty.** Each judge in the cross-family panel ([judge-consensus.ts](../../src/test-intelligence/judge-consensus.ts)) carries an optional `confidence` ∈ [0, 1]. A confidence near 0.5 is the canonical active-learning signal — the judge is least decisive there, so a human label moves the calibration the most.
2. **Cross-judge disagreement.** Issue #2102 already produces a `JudgeConsensusVerdict` with `agreementShape: "unanimous" | "majority" | "split" | "vetoed"` and an optional `vetoBy`. Disagreement cases are by construction the ones our consensus rule cannot fully resolve, and are exactly the cases worth a human ground truth.
3. **Drift-flagged cases.** The drift canary from Issue #2103 (`drift-report.json`) flags fixtures where Brier / ECE / faithfulness shifted > 2σ from the rolling 30-day baseline. Drift = our calibration is becoming stale; queueing the drift-flagged case for SME relabel lands the new ground truth at the same time as the drift signal, instead of weeks later.

Without an explicit loop these three signals exist but are never composed: the audit finding is "no automation routes them into the gold set."

## Decision

We add a single new pure module, [src/test-intelligence/active-learning-sampler.ts](../../src/test-intelligence/active-learning-sampler.ts), and wire its κ-tracking gate to the existing inter-rater agreement contract. The module owns four artifacts and three CI gates.

### 1. Composite scoring

Each candidate case is scored on three components, every component in [0, 1]:

| Component | Formula | Source |
| --- | --- | --- |
| `uncertainty` | `max over panel of 1 − 2·|c − 0.5|`, plateaued at `1` for `|c − 0.5| ≤ 0.10` | [`computeUncertaintyScore`](../../src/test-intelligence/active-learning-sampler.ts) |
| `disagreement` | Lookup on `agreementShape` (`unanimous→0`, `majority→0.5`, `split→1`, `vetoed→1`); upgraded to `1` when `vetoBy` is set or any panel entry rejects with `confidence ≥ 0.8` | [`computeDisagreementScore`](../../src/test-intelligence/active-learning-sampler.ts) |
| `drift` | `1` when the case is flagged in `drift-report.json`, else `0` | [`computeDriftScore`](../../src/test-intelligence/active-learning-sampler.ts) |

The composite is the weighted sum with default weights `{uncertainty: 0.5, disagreement: 0.3, drift: 0.2}`. The weights must sum to 1; the builder rejects malformed weights at runtime.

### 2. Mandatory-risk override

The active-learning loop respects the #2102 escalation rule: any `regulated_data` or `financial_transaction` candidate is queued first, regardless of composite score. The active-learning queue cannot become a way to silently down-prioritise high-risk cases.

### 3. Queue artifact (the "admin portal" surface)

Each cycle persists [`active-learning-queue.json`](../../src/test-intelligence/active-learning-sampler.ts) under the run directory. The artifact is canonical-JSON, byte-stable for identical inputs, and consumed by the admin portal as the SME labeling queue. Every queue item carries:

- `caseId`, `judge`, `scenarioKind`, `riskCategory`, `observedAt`
- `agreementShape`
- `score: { uncertainty, disagreement, drift, composite }` (every value rounded to 1e-6)
- `reasons: ("drift" | "high_confidence_veto" | "mandatory_risk_override" | "uncertainty" | "vote_split")[]`
- `mandatoryOverride: boolean`

The aggregate block surfaces per-judge counts and per-reason counts so an operator can spot a queue dominated by one signal (e.g., 25/25 drift) without reading the items.

### 4. Growth log + quarterly CI gate

Cases that complete SME labeling are appended to [`active-learning-growth-log.json`](../../src/test-intelligence/active-learning-sampler.ts) (one record per cycle: `cycleId`, `addedAt`, `addedCaseIds`). [`evaluateActiveLearningQuarterlyGate`](../../src/test-intelligence/active-learning-sampler.ts) computes the trailing-quarter unique-case count and throws when the count is below `ACTIVE_LEARNING_QUARTERLY_GROWTH_FLOOR = 20`. Re-queued cases (a case that re-enters a later cycle in the same quarter) count once via the dedupe in `summariseActiveLearningQuarterlyGrowth`.

### 5. κ tracking on newly added cases

[`evaluateActiveLearningKappaGate`](../../src/test-intelligence/active-learning-sampler.ts) routes the paired SME ratings on the newly admitted cases back through [`buildInterRaterAgreementReport`](../../src/test-intelligence/inter-rater-agreement.ts). Re-using the existing builder is deliberate: there is **one κ contract** for the gold set, and it must apply identically to cases added by hand and cases added by the active-learning loop. `INTER_RATER_KAPPA_HARD_FLOOR = 0.7` and `INTER_RATER_KAPPA_WARN_FLOOR = 0.8` continue to apply unchanged. This closes the acceptance bar "κ tracking on newly added cases verifies inter-rater quality holds."

### 6. CI wiring

The 24 unit tests in [src/test-intelligence/active-learning-sampler.test.ts](../../src/test-intelligence/active-learning-sampler.test.ts) cover:

- The three component-scoring functions (plateau, taper, panel-max, ignored confidence-less entries).
- The agreement-shape table and the `vetoBy` / high-confidence-reject upgrade rules.
- Queue selection: top-N by composite, mandatory-risk override, deterministic tie-break, duplicate rejection, weight validation, confidence range validation.
- Byte-stable canonical-JSON write of both the queue and the growth-log artifact.
- Quarterly growth gate: unique-case count inside the as-of quarter, deficit error message, threshold-met pass.
- κ gate: pass on a unanimous gold set, fail on a sub-floor logic-judge κ.

These run in the existing `pnpm run test` glob (`src/**/*.test.ts`), so no new workflow wiring is required — every PR that touches `src/test-intelligence/` now exercises the loop.

## Consequences

### Wins

- **Throughput.** SMEs label the cases that move the calibration most, not the cases that happen to land in inboxes. The 20-cases-per-quarter gate keeps the loop load-bearing rather than decorative.
- **No κ regression.** Every active-learning admit goes through the same κ ≥ 0.7 gate as a hand-picked admit. The active-learning loop cannot launder a low-quality reviewer pair into the gold set.
- **Mandatory-risk safety.** `regulated_data` and `financial_transaction` cases keep their #2102 escalation priority; the loop cannot deprioritise them by composite score alone.
- **Audit trail.** Every queue item carries its scoring breakdown and reasons, and the growth log is the single source of truth for "what did the loop add this quarter." Both are byte-stable canonical-JSON, so an auditor can replay a quarter without re-running the harness.

### Costs

- One more JSON artifact per cycle (`active-learning-queue.json`) and one append-only file (`active-learning-growth-log.json`). Both are < 50 KB at expected cycle sizes.
- Default weights are policy choices, not derived ones. Tuning them in a future cycle requires a re-evaluation of the κ-and-growth gates against historical fixtures; no automatic retuning is provided.

### Non-goals

- The loop does not auto-label cases. Every admit requires SME ratings routed through the existing inter-rater protocol — the human-oversight bar from EU AI Act Art. 14 is not relaxed.
- The loop does not pick reviewers; the existing reviewer-rotation cap in `inter-rater-agreement.ts` (max share 60 %, warn at 45 %) continues to govern.
- The drift signal is consumed as a boolean. Per-metric weighting is left for a follow-up if the binary signal proves too coarse in practice.
