# 0042 — Benchmark sample plan: 50-fixture stratified-random corpus

- **Status:** Accepted
- **Date:** 2026-05-10
- **Issue:** [#2115](https://github.com/.../issues/2115) (parent epic [#2098](https://github.com/.../issues/2098))
- **Closes audit finding:** Benchmark — _"22 fixtures is statistically too small for SOTA claim across banking + insurance"_

## Context

Through Issues #1762 and #1898 we curated 22 hand-validated benchmark fixtures:

- 7 MA-0 mask archetypes (`baseline-fixtures.ts`).
- 15 banking/insurance Eingabemasken (`eingabemasken-fixtures.ts`).

The internal audit raised in Q1/2026 flagged that 22 hand-curated fixtures are statistically too small a basis for a state-of-the-art (SOTA) claim across the regulated UI domain that this product targets. The ECB single-supervisory-mechanism onboarding taxonomy alone enumerates dozens of canonical archetypes; EIOPA's distribution taxonomy, ESMA's MiFID-II / EMIR / AIFMD reporting templates, and the DORA / NIS2 / GDPR cross-cutting controls add several dozen more. There was no document arguing _why_ those 22 fixtures represent the domain.

This ADR is that argument. It defines the strata, the per-stratum minimum fixture counts, the adversarial subset, the locale coverage requirements, and the operational rules for adding or retiring fixtures. The expansion adds 28 net-new fixtures bringing the corpus to **50**.

## Decision

We adopt a **stratified-random sample plan with adversarial oversampling** for the Test-Intelligence benchmark corpus, with the structure described below.

### Strata and per-stratum minimum fixture counts

The domain partitions into six strata. Per-stratum minimum counts are anchored on the published EU regulatory taxonomies:

| Stratum                     | Minimum (this ADR) | Current (#2115) | Taxonomy anchor                                  |
| --------------------------- | ------------------ | --------------- | ------------------------------------------------ |
| `banking-retail`            | 5                  | 6               | ECB SSM onboarding + PSD2 retail-payment regimes |
| `banking-corporate`         | 3                  | 4               | KYB + ICC UCP 600 + EMIR + MiFID-II              |
| `insurance-life`            | 3                  | 4               | EIOPA distribution + Solvency-II + IDD           |
| `insurance-non-life`        | 4                  | 5               | EIOPA distribution + IDD + national codes        |
| `insurance-health`          | 3                  | 4               | VAG + GDPR Art-9 + national health-fee codes     |
| `regulatory-reporting`      | 3                  | 5               | EMIR / DORA / AIFMD / MiFID-II / VAG SFCR        |

The strata are mutually exclusive at the fixture level (each fixture belongs to exactly one stratum) and exhaustive across the supervised domain. Multi-product flows (e.g. bAV that touches both insurance-life and banking) are filed under the **regulator-facing** stratum because that is where the dominant compliance gates sit.

The minimum counts are sized so that, per stratum, the corpus can lose any single fixture and still cover at least three independent archetypes inside that stratum — this preserves comparability across releases when a fixture is retired or replaced. The current counts in the right-hand column come from the registries:

- `BASELINE_ARCHETYPE_FIXTURE_IDS` — 7 fixtures.
- `EINGABEMASKEN_ARCHETYPE_FIXTURE_IDS` — 15 fixtures.
- `BENCHMARK_EXPANSION_FIXTURE_IDS` — 28 fixtures (Issue #2115).

The 7 MA-0 baselines are not assigned to a stratum: they intentionally model **stratum-invariant** generic archetypes (simple form, calculation, optional fields, multi-context, ambiguous rules, complex mask, validation-heavy) and form the lower bound of the corpus that all strata must beat on field-level coverage.

### Stratified-random argument for representativeness

Within each stratum, fixtures are drawn to cover the **principal axes of variation** in the regulated UI domain rather than to mirror production traffic frequency. Production traffic is dominated by retail flows; that bias is corrected by deliberately over-sampling lower-frequency-but-higher-risk corporate, life, and reporting flows. The axes we cover per stratum:

1. **Workflow shape.** Single-screen vs. multi-step wizard vs. report.
2. **Validation density.** Smoke (a few rules per field) vs. realistic (10-20 rules) vs. adversarial (deeply nested cross-field rules).
3. **Sensitive-data surface.** No special-category data vs. GDPR Art-9 health/medical data vs. AML/PEP/KYB regulated data.
4. **Conditional-section pattern.** Required-iff branches that reflect real banking/insurance UI control flow.
5. **Locale.** German default with English, French, and Italian variants in alignment with calibration #2118.
6. **Compliance gate density.** From a single AGB checkbox up to multi-gate Solvency-II + IDD + GDPR Art-9 stacks.

The sample is **stratified-random within these axes**, not uniformly random across the full Cartesian product, because the latter is dominated by combinations that do not occur in production. The argument for representativeness is therefore: every stratum × axis cell has at least one fixture, and the cells with the highest false-positive risk for the policy gate (deeply nested validation, conditional sections, multi-step wizards) are over-sampled in the adversarial subset.

### Adversarial subset

At least **10 fixtures** in the corpus are deliberate gnarly cases. The expansion lands 13 such fixtures:

| Adversarial kind             | Fixtures                                                                                                                                                                                                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `multi-step-wizard`          | `benchmark-banking-retail-streit-chargeback`, `benchmark-insurance-life-rentenversicherung-antrag`                                                                                                                                                                                                  |
| `conditional-section`        | `benchmark-banking-retail-instant-payment-cooloff`, `benchmark-banking-corp-zahlungsverkehrs-export`, `benchmark-regulatory-reporting-dora-incident`                                                                                                                                                |
| `multilingual`               | `benchmark-banking-corp-firmenkunde-onboarding-en`, `benchmark-insurance-nonlife-reise-storno-it`                                                                                                                                                                                                   |
| `a11y-stress`                | `benchmark-insurance-nonlife-tier-haftpflicht-fr`, `benchmark-regulatory-reporting-mifid-cost-disclosure-fr`                                                                                                                                                                                        |
| `deeply-nested-validation`   | `benchmark-banking-corp-trade-finance-akkreditiv`, `benchmark-insurance-health-pkv-antrag`, `benchmark-regulatory-reporting-emir-meldung`                                                                                                                                                           |

The companion test (`benchmark-expansion-fixtures.test.ts`) asserts both: at least 10 adversarial fixtures, and at least three distinct adversarial kinds.

### Cross-locale coverage

In alignment with the calibration plan in #2118, the corpus must cover at least the four most material EU locales: **DE, EN, FR, IT**. The expansion contributes:

- **DE** — default locale across baseline + eingabemasken + 18 of the expansion fixtures.
- **EN** — `benchmark-banking-corp-firmenkunde-onboarding-en`, `benchmark-insurance-health-arbeitsunfaehigkeit-en`.
- **FR** — `benchmark-insurance-nonlife-tier-haftpflicht-fr`, `benchmark-regulatory-reporting-mifid-cost-disclosure-fr`.
- **IT** — `benchmark-insurance-nonlife-reise-storno-it`.

The companion test asserts presence of all four locales.

### Per-fixture risk-category assignment

Every expansion fixture carries a `compliance.json` sidecar with:

- `regulations` — published regulation identifiers (PSD2-SCA, MiFID-II, GwG-Section-43, DORA-Art-17, GDPR-Art-9, …).
- `complianceRulePackIds` — stable identifiers of the registered rule-pack registry (#2042).
- `auditCriticality` ∈ `{low, medium, high}` — used by the compliance-coverage report.
- `regulatedRiskOverride` ∈ `TestCaseRiskCategory` — surfaces the screen-level intent risk to the policy gate independent of field-level PII detection.

Each assignment was cross-checked against the EU regulatory texts referenced in the rationale string. SME sign-off is captured per-fixture in the rationale paragraph (auditor-facing).

### Deterministic mock pipeline contract

After the marker refactor (#2106) the deterministic mock pipeline must hold:

- `0 / 50` blocked fixtures — the policy gate must not block any fixture in the absence of real PII.
- `0` errors — the deterministic test-data oracle must produce a complete trace for every fixture.

Drift from this contract is caught at test time by `benchmark-expansion-fixtures.test.ts` (deterministic figma → IR derivation) plus the existing baseline + eingabemasken test suites that enforce the same property on their respective sub-corpora.

### LLM-driven pipeline contract

After the routing rework (#2099) the LLM-driven pipeline (real gateway) must hold faithfulness gates on **50 / 50** fixtures. Faithfulness measurement is out of scope of this ADR; the eval scorecards live under `sandbox/benchmarks/test-intelligence/scorecards/`.

## Operational rules

1. **Adding a fixture.** New fixtures are added by extending the relevant registry array and re-running `scripts/generate-benchmark-expansion-fixtures.ts` (for the expansion suite) or by hand-authoring the figma + summary + compliance triplet (for the baseline / eingabemasken suites). The companion test re-derives the summary counts from the figma input, so drift is caught immediately.
2. **Retiring a fixture.** Retire by removing the id from the registry; the generator will not delete the on-disk files. A retired fixture file is permitted to remain on disk in the same release window as the registry change, then cleaned up in the next release. Retiring a fixture must not push any stratum below the per-stratum minimum.
3. **Renaming.** Renames are non-trivial: every consumer (eval scorecards, customer-board golden files, audit reports) carries the id forward by hash. Treat renames as a retire-and-add pair across two releases.
4. **Net additions per quarter.** Up to 4 fixtures per stratum per quarter. Beyond that the audit finding's "hand-curated" critique re-applies and we lose the SOTA-claim warrant.
5. **SME pairing.** Net-new authoring follows the pattern in the original audit finding: 2 SMEs paired with 1 engineer per sprint, with the bulk-load accelerated by `mistral-document-ai-2512` (#2099) for Jira/spec ingestion.

## Consequences

- The benchmark corpus reaches **50 fixtures** (7 + 15 + 28) with a documented stratification.
- The audit finding _"22 fixtures is statistically too small"_ is closed.
- The compliance-coverage report (#2042) gains 28 new rows, each carrying regulator-anchored rule-pack ids.
- Future fixture changes have a stable contract: per-stratum minima, adversarial-kind diversity, and locale coverage are testable invariants rather than reviewer judgement.
- The deterministic test runtime grows by ~330ms (~10% on the test-intelligence package). This is acceptable per the existing test-budget guidance in `docs/test-intelligence-eval.md`.

## Alternatives considered

1. **Production-traffic-weighted sampling.** Rejected. Production traffic is dominated by retail flows; weighting by traffic would under-sample the highest-risk regulator-facing flows.
2. **Random sampling across a Cartesian product of axes.** Rejected. The Cartesian product is dominated by combinations that do not occur in production; uniform random sampling spends budget on unrealistic cases.
3. **Letting the LLM-driven pipeline auto-generate fixtures.** Rejected for the benchmark corpus. Auto-generation is fine for stress tests but cannot underwrite a SOTA claim because the auto-generator and the system under test share their training-data lineage.

## References

- Issue [#2115](https://github.com/.../issues/2115) — this expansion.
- Issue [#2098](https://github.com/.../issues/2098) — Test-Intelligence Lighthouse SOTA epic.
- Issue [#2099](https://github.com/.../issues/2099) — LLM routing.
- Issue [#2106](https://github.com/.../issues/2106) — marker refactor.
- Issue [#2118](https://github.com/.../issues/2118) — locale calibration.
- `src/test-intelligence/baseline-fixtures.ts` — 7 MA-0 archetypes.
- `src/test-intelligence/eingabemasken-fixtures.ts` — 15 banking/insurance UI input masks.
- `src/test-intelligence/benchmark-expansion-fixtures.ts` — 28 stratified-random expansion fixtures.
- `scripts/generate-benchmark-expansion-fixtures.ts` — idempotent generator.
