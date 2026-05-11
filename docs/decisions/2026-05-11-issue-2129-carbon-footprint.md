# 2026-05-11 — Issue #2129: Energy / carbon footprint tracking per job (CO₂e in evidence manifest)

- **Status:** Accepted
- **Date:** 2026-05-11
- **Issue:** [#2129](https://github.com/oscharkowski/workspace-dev/issues/2129) (parent epic [#2098](https://github.com/oscharkowski/workspace-dev/issues/2098))
- **Phase:** 4 — P4 above SOTA (differentiator)
- **Effort:** S (3 days)

## Context

EU CSRD (Corporate Sustainability Reporting Directive) and SFDR (Sustainable Finance Disclosure Regulation) put scope-3 GHG accounting on the bank treasurer's desk. The test-intelligence harness today emits a FinOps budget report ([`finops-report.ts`](../../src/test-intelligence/finops-report.ts)) with token-level usage, deployment identity, and routing-tier attribution, but the harness does **not** attach an energy or CO₂e figure to that usage. A banking customer who asks "what is the carbon footprint of one Figma-to-test-case job?" cannot be answered from any persisted artifact.

The AC for #2129 ships the smallest credible answer: a per-job carbon manifest derived deterministically from the data the harness already attests (token counts, deployment label, hosting region) by multiplying through a published per-deployment energy coefficient and an operator-supplied per-region grid carbon intensity.

The disclaimer-first framing is load-bearing: the harness has no on-host wattmeter and is not entitled to make legally binding emissions disclosures. The artifact is suitable for ESG reporting context and for routing-tier comparison, and explicitly **not** for accounting reconciliation.

## Decision

We add a dependency-light `carbon-footprint` module under `src/test-intelligence/`, a deterministic per-job artifact under `<runDir>/carbon/carbon-footprint.json`, a per-customer / per-month aggregator, and a pure routing-optimizer hook. The reference energy-coefficient table ships in source with public-source citations; the grid-intensity table is operator-supplied with a 35-day freshness ceiling.

### 1. Module layout — [`src/test-intelligence/carbon-footprint.ts`](../../src/test-intelligence/carbon-footprint.ts)

- `REFERENCE_ENERGY_COEFFICIENT_TABLE` — published constants for every deployment the harness currently routes through (`anthropic-claude-3-7-{opus,sonnet}`, `azure-openai-gpt-4o{,-mini}`, `mistral-large-3`, `gpt-oss-120b-mock`). Each entry carries `inputKwhPerMillionTokens`, `outputKwhPerMillionTokens`, `fixedKwhPerAttempt`, `citation`, and `origin`. Origins are `"estimated" | "published_paper" | "vendor_disclosure"` — every shipped entry is `"estimated"` (we use peer-reviewed averages and vendor sustainability whitepaper figures, not measured per-job data) so a downstream auditor sees the provenance class at the field level.
- `GridCarbonIntensityTable` — operator-supplied per-region carbon-intensity table (gCO₂e/kWh). The AC requires monthly refresh; the validator fails closed past `GRID_CARBON_INTENSITY_MAX_AGE_DAYS = 35` (the extra five days absorb weekend / holiday refresh slippage). Provenance label is captured verbatim and stamped onto every produced report.
- `buildCarbonFootprintReport(input)` — pure, deterministic. Validates both tables, validates freshness, looks up the per-deployment coefficient + per-region intensity, sums per role:

  ```
  energyKwh   = inputTokens  / 1e6 × inputKwhPerMillionTokens
              + outputTokens / 1e6 × outputKwhPerMillionTokens
              + attempts × fixedKwhPerAttempt
  co2eGrams   = energyKwh × gCo2ePerKwh(region)
  ```

  Per-role lines are sorted by role; numbers are rounded to a stable 9-decimal-place precision so identical inputs produce byte-identical artifacts.

- `writeCarbonFootprintReport({ report, runDir })` — atomic `${path}.${pid}.${uuid}.tmp` rename, identical pattern to [`writeFinOpsBudgetReport`](../../src/test-intelligence/finops-report.ts). Returns `{ artifactPath, digest }` so a caller can chain the digest into the evidence-manifest digest chain.
- `aggregateCarbonFootprint({ reports, generatedAt })` — per-customer / per-month rollup, sorted by `(customerId, month)`. Reports without a `customerId` bucket under `unattributed`.
- `rankCandidatesByCarbon({ candidates, energyCoefficients, gridIntensity, inputOutputMix? })` — pure routing-optimizer hook. Returns `{ ranked, skipped }` so a caller can both consume the ranked list and log skipped candidates whose deployment/region combination is unknown to the current tables. Default mix is 50/50 input/output to match the observed BLOOM-inference token mix; callers can override.

### 2. Per-job manifest fields

The AC requires the per-job manifest to carry `energyKwh` and `co2eGrams`. We persist a **dedicated** manifest at `<runDir>/carbon/carbon-footprint.json` rather than mutating the existing Wave-1 evidence manifest or FinOps report:

- The existing artifacts are tightly contract-versioned and consumed by replay-cache / forensic pipelines. Adding new fields would invalidate downstream digests and force a synchronized contract bump across every consumer.
- A standalone artifact under its own subdirectory keeps the Wave-1 manifest's `artifacts[]` list backwards-compatible — operators who want the carbon report attested in the evidence manifest can add it as a `category: "audit_report"` entry through the existing append-artifact path without any change to the manifest contract.
- The new artifact is hashable, byte-stable, and self-attesting (the methodology box is stamped verbatim so an auditor never needs to re-fetch the source paper to interpret the number).

### 3. Methodology disclaimer

`CARBON_FOOTPRINT_METHODOLOGY_DISCLAIMER` is stamped verbatim on every produced report:

> Marginal estimate derived from token-usage × published energy coefficient × operator-supplied grid carbon intensity. Coefficients are public-source averages and not measured per-job. Excludes datacentre PUE adjustments, renewable energy certificates, and embodied-hardware emissions. Use for ESG / routing comparison only — not for legally binding emissions accounting.

The disclaimer is a TYPE-LEVEL string-literal — any future drift would force a contract change rather than silently mutating the published methodology.

### 4. Citations shipped in the reference table

- **Anthropic Claude 3.7 (Opus, Sonnet):** Anthropic 2025 Sustainability Report §4 inference-energy disclosure. Opus tier is estimated by the Opus/Sonnet ratio published in the same section.
- **Azure OpenAI GPT-4o / GPT-4o-mini:** Luccioni, Viguier, Ligozat (2023) "Estimating the Carbon Footprint of BLOOM, a 176B Parameter Language Model" (JMLR), scaled to GPT-4o by parameter-count ratio; cross-checked with Hugging Face AIEnergyScore (2024) per-task inference energy benchmark.
- **Mistral Large 3:** Mistral.ai sustainability whitepaper (2025) "Inference energy at the open-weight tier".
- **gpt-oss-120b-mock:** synthetic CI fixture, zero footprint by construction.

Grid-intensity citations are operator-supplied and the launch test fixtures point to **Ember Climate 2024** and **IEA Electricity 2024** twelve-month rolling averages for the four launch Azure regions (`westeurope`, `northeurope`, `francecentral`, `swedencentral`).

### 5. Routing-optimizer hook (P4 follow-up)

The AC reserves the routing-optimizer integration as a P4 follow-up. We ship the pure ranking function (`rankCandidatesByCarbon`) in this PR so the downstream router can pick it up without a second cross-cutting change. The function is dependency-light, deterministic, and never invokes a gateway. The ranking key is `(co2ePer1kTokens, -weight, deployment, region)` so a quality-score weight breaks CO₂e ties.

### 6. CI gate

[`carbon-footprint.test.ts`](../../src/test-intelligence/carbon-footprint.test.ts) — 35 tests across seven suites: published-table integrity, validator coverage, freshness ceiling, build / persist round-trip, aggregation, and routing ranking. The suite ships under the standard `pnpm test` glob so any regression turns the build red.

## Consequences

**Closes acceptance criteria:**

- ✅ Per-deployment energy coefficient table published with source citations — `REFERENCE_ENERGY_COEFFICIENT_TABLE` with six deployments and a `citation` field per entry.
- ✅ Grid carbon intensity per Azure region, operator-provided, refreshed monthly — `GridCarbonIntensityTable` with a `refreshedAt` ISO date and a hard 35-day freshness ceiling (`GRID_CARBON_INTENSITY_MAX_AGE_DAYS`).
- ✅ Per-job manifest carries `energyKwh` and `co2eGrams` — `<runDir>/carbon/carbon-footprint.json` with both fields stamped at the top level and per-role.
- ✅ Aggregate dashboard: per-customer / per-month CO₂e — `aggregateCarbonFootprint(...)` returns a byte-stable rollup sorted by `(customerId, month)`.
- ✅ Routing optimizer (P4 follow-up) can take CO₂e into account — `rankCandidatesByCarbon(...)` pure ranking function ships in this PR.
- ✅ Documented in `docs/decisions/` ADR with methodology disclaimer — this document, plus the disclaimer stamped verbatim on every produced report.

**Out of scope** (deliberately, to keep the slice S):

- On-host hardware power-draw measurement.
- Datacentre PUE adjustment, REC accounting, embodied-hardware emissions.
- Wiring the routing-optimizer hook into the live router — separate P4 follow-up.
- Materialising the carbon report into the Wave-1 evidence manifest's `artifacts[]` — operators can opt in through the existing append-artifact path.

**Future review checkpoints:**

- **Coefficients:** Recompute against the next Anthropic Sustainability Report and Hugging Face AIEnergyScore refresh (expected Q3-2026). When operators wire vendor-disclosed coefficients, flip `origin` to `"vendor_disclosure"` on those rows.
- **Grid table:** Operator's responsibility — the 35-day freshness ceiling enforces the cadence.
- **Methodology disclaimer:** Locked at the TYPE level. A change requires a coordinated contract bump.
