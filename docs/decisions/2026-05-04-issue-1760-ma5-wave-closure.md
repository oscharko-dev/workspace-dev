# ADR: Issue #1760 Wave MA-5 — Eval Gates and Release Quality (Closure)

- Status: Accepted
- Date: 2026-05-04
- Issue: #1760 (Wave MA-5)
- Parent Epic: #1753 (Multi-Agent Harness for Figma-to-QC Test Case Intelligence)

## Context

Wave MA-5 closes the eval-and-release-quality slice of the multi-agent harness
epic (#1753). The wave brief (Issue #1760) defined 13 acceptance criteria that
together prove the harness measurably outperforms the single-pass baseline and
lock that win against regression with CI- and release-enforced gates.

The wave was sliced into five sub-stories so each gate could land with its own
test surface, contract bumps, and review trail rather than a single monolithic
PR. All five sub-stories shipped between 2026-05-03 and 2026-05-04:

- #1800 — A/B eval lane and human-review calibration with bias controls
  (PR [#1857](https://github.com/oscharko-dev/workspace-dev/pull/1857))
- #1801 — Quality gates: mutation-kill-rate, prompt-cache-hit-rate,
  tamper-detection, cache-break-rate
  (PR [#1858](https://github.com/oscharko-dev/workspace-dev/pull/1858))
- #1802 — Evidence + library-coverage + architecture-fit self-test gates
  (PR [#1859](https://github.com/oscharko-dev/workspace-dev/pull/1859))
- #1803 — Release pipeline integration with consolidated release-readiness
  report (PR [#1860](https://github.com/oscharko-dev/workspace-dev/pull/1860))
- #1804 — Online evaluator (production trace sampler), air-gapped default
  (PR [#1861](https://github.com/oscharko-dev/workspace-dev/pull/1861))

This ADR records the wave-level closure decision and the AC-by-AC traceability
matrix so DORA / EU-AI-Act / banking-profile reviewers can audit the wave
without re-walking five PR threads.

## Decision

Close Issue #1760 as `Done`. The 13 acceptance criteria are implemented,
tested, threshold-enforced via `src/contracts/index.ts`, and wired into
`pnpm run release:quality-gates` → `pnpm run release:readiness`.

No `CONTRACT_VERSION` bump is required for this closure ADR — every contract
surface used by the wave was bumped in the originating sub-story PRs and is
already reflected in `CONTRACT_CHANGELOG.md` and `COMPATIBILITY.md`.

This wave does not introduce a LangGraph / LangSmith adapter; that work is
explicitly Out-of-Scope per the issue brief and is tracked as Wave MA-6
(#1761), gated by a separate ADR.

## Acceptance-Criteria Traceability Matrix

| # | Acceptance criterion | Implementation | Tests | Threshold (contract) | Wired into |
|---|----------------------|----------------|-------|----------------------|------------|
| 1 | A/B eval lane (single-pass vs multi-agent harness; canonical-JSON) | `src/test-intelligence/eval-ab.ts` | `eval-ab.test.ts` | n/a (canonical-JSON byte-stable) | `test:ti-eval` |
| 2 | Human-review calibration (curated reviewer-truth sample) | `src/test-intelligence/human-review-calibration.ts` | `human-review-calibration.test.ts` | n/a | `test:ti-eval` |
| 3 | Bias controls (CalibraEval position-bias calibration; no length normalization; cross-family panel) | `src/test-intelligence/semantic-judge-panel.ts` | `semantic-judge-panel.test.ts` | `hardLengthNormalizationApplied: false`; cross-family panel (gpt-oss-120b + phi-4-multimodal-instruct) | `test:ti-eval` |
| 4 | Context-budget regression (budget + compaction + quality reported together) | `src/test-intelligence/context-budget-analyzer.ts` | `context-budget-analyzer.test.ts` | `contextBudget.defaultMaxBloatRatio: 1.20` | `release:quality-gates` (Gate 9) |
| 5 | `mutationKillRate >= 0.85` | `src/test-intelligence/ir-mutation-oracle.ts`, `release-quality-gates.ts` | `ir-mutation-oracle.test.ts`, `release-quality-gates.test.ts` | `minMutationKillRate: 0.85` | `release:quality-gates` (Gate 1) |
| 6 | `promptCacheHitRate >= 0.7` across repair iterations 2..N | `src/test-intelligence/release-quality-gates.ts` | `release-quality-gates.test.ts` | `minPromptCacheHitRate: 0.7` | `release:quality-gates` (Gate 2) |
| 7 | Tamper-detection round-trip: Merkle chain + `headOfChainHash` + ML-BOM hash verified offline | `src/test-intelligence/agent-harness-checkpoint.ts`, `scripts/release-merkle-roundtrip.ts`, `scripts/release-ml-bom-emit.ts` | `agent-harness-checkpoint.test.ts` | `headOfChainHashVerified === true` (boolean gate) | `release:readiness` (Gate `release_merkle_roundtrip`) |
| 8 | `cacheBreakRate <= 5%` with diff-artifact attribution | `src/test-intelligence/cache-break-detector.ts`, `cache-break-events-log.ts` | `cache-break-detector.test.ts`, `cache-break-events-log.test.ts` | `maxCacheBreakRate: 0.05` | `release:quality-gates` (Gate 4) |
| 9 | Per-source-cost plausibility (`bySource` sealed; mutation invalidates Sigstore) | `src/test-intelligence/per-source-cost.ts` | covered via release-quality-gates fixtures + sealing tests | `allowedFailures: 0` | `release:quality-gates` (Gate 5) |
| 10 | Memdir-manifest consistency (90-day refresh; path-validator coverage 100%) | `src/test-intelligence/agent-lessons-memdir.ts` | `agent-lessons-memdir.test.ts` | `MEMDIR_MAX_AGE_MS: 7_776_000_000` (90 days) | `release:quality-gates` (Gate 6) |
| 11 | Library-coverage report (LangGraph 1.0 + LangSmith primitive map; every entry `COVERED` / `PARITY-PATH` / `NICHT-UEBERNOMMEN` with justification) | `src/test-intelligence/library-coverage-report.ts`, `scripts/release-library-coverage-report.ts` | `library-coverage-report.test.ts` | `fixtures/release-readiness/library-coverage-baseline.json` (committed) | `release:readiness` (Gate `release_library_coverage_report`) |
| 12 | Architecture-fit self-test (`lint:agent-boundaries` blocks new files outside allowed paths) | `scripts/check-agent-boundaries.mjs` | `scripts/check-agent-boundaries.test.mjs` | n/a (boundary lint) | `release:quality-gates` → `lint:boundaries`; `release:readiness` (Gate `lint_agent_boundaries`) |
| 13 | Release Gate composition (typecheck + lint + tests + ti-eval + ti-live-e2e (opt-in, mandatory pre-merge) + secrets/no-telemetry + ML-BOM + Merkle round-trip) | `scripts/check-release-quality-gates.ts`, `scripts/run-release-readiness.ts` | `release-quality-gates.test.ts`, `release-readiness-report.test.ts` | n/a (orchestration) | `package.json` `release:quality-gates` and `release:quality-gates:publish-lifecycle` |

The allowed top-level paths enforced by `lint:agent-boundaries`
(`src/test-intelligence/`,
`ui-src/src/features/workspace/inspector/test-intelligence/`,
`docs/test-intelligence-*`) match the wave brief verbatim.

## Out of Scope (recorded explicitly)

- LangGraph / LangSmith adapter — explicitly excluded; Wave MA-6 (#1761),
  ADR-gated.
- New runtime dependencies — workspace-dev remains zero-runtime-deps; every
  validator in this wave is hand-written (per repo guard).

## Consequences

- **DORA / EU-AI-Act audit trail.** A reviewer can verify all 13 ACs from one
  ADR and one canonical-JSON readiness report, without traversing five PR
  threads.
- **Regression resistance.** Every quantitative threshold is enforced by
  contract constants in `src/contracts/index.ts`; lowering a threshold
  triggers a `CONTRACT_VERSION` bump and a four-eyes review.
- **Live-E2E discipline.** `pnpm run test:ti-live-e2e` is opt-in (gated by
  `WORKSPACE_TEST_SPACE_LIVE_E2E=1`) but mandatory pre-merge per the release
  pipeline; this preserves the air-gapped default while keeping the live path
  exercised against a real Azure-hosted endpoint before each release.
- **Wave order preserved.** Closing MA-5 unblocks the optional MA-6 LangGraph
  adapter ADR but does not require it; the harness is production-ready as it
  stands.
- **No customer-visible API change.** This ADR is documentation-only; no
  contract surface, runtime behavior, or default mode (`shadow_eval`) changes
  on closure.

## References

- Issue #1760 (this wave)
- Epic #1753 (parent)
- Sub-issues #1800, #1801, #1802, #1803, #1804 (all closed)
- Sub-PRs #1857, #1858, #1859, #1860, #1861 (all merged)
- `docs/test-intelligence.md` — operator-facing surface
- `docs/test-intelligence-operator-runbook.md` — runbook including MA-5 hooks
- `docs/test-intelligence-dpia-production-runner.md` — DPIA context
- `CONTRACT_CHANGELOG.md` — contract bumps for the wave
