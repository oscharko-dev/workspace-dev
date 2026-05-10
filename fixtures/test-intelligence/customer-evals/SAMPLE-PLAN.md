# Customer-Eval Rubric Sample Plan

**Scope:** This sample plan governs the customer-eval rubrics under
`fixtures/test-intelligence/customer-evals/`.

**Rubrics covered:**

- `Testfall-eines-Anwendungstests.md`
- `Eingabemasken-Testfallrubrik.md`

**Last reviewed:** 2026-05-10
**Parent epic:** #2098
**Issue:** #2124

## 1. Objective

This document records how the customer-eval rubrics were constructed, what
domain slices they cover, which reviewer protocol was used, and where the
coverage intentionally stops. The goal is auditability: a reviewer should be
able to explain why a rubric clause exists, what evidence supports it, and
when the clause must be revisited.

## 2. Sampling unit

The sampling unit is a rubric entry cluster, not a single test case.
Customer-eval clauses were drafted against representative evidence bundles
made of:

- one or more Figma-derived fixture archetypes;
- one regulatory or standards source that constrains the expected behavior;
- one operator or customer-facing QA concern surfaced during review;
- one calibration or audit signal showing where generic generation tends to
  under-cover or hallucinate behavior.

The generic rubric is sampled at the level of scoring section and acceptance
criterion family. The Eingabemasken rubric is sampled at the level of
tier-specific obligation family and hard-rejection rule family.

## 3. Participants

The rubric build and refresh protocol assumes the following reviewer roles:

- 2 banking-domain SMEs
- 1 insurance-domain SME
- 1 QA/test-architecture reviewer
- 1 accessibility or UX-quality reviewer
- 1 compliance reviewer
- 1 arbiter for disagreements

The names of individual participants are intentionally kept out of the
checked-in artifact; the release evidence bundle stores reviewer handles and
timestamps where the runtime already persists them. This file records the
required role mix, not personal data.

## 4. Domain Stratification

The rubric corpus is stratified across form type, jurisdiction family, and
complexity tier so the evaluation guidance does not collapse into a
retail-banking happy-path bias.

| Stratum ID | Form types | Jurisdiction focus | Complexity tier | Sampling target | Construction mode |
| --- | --- | --- | --- | --- | --- |
| `banking-retail-smoke` | login, payment, simple onboarding | EU-wide banking baseline with DACH wording | Tier 1 / low | At least 3 evidence bundles | stratified purposive |
| `banking-retail-realistic` | KYC, consumer credit, securities order | EU banking + DACH compliance overlays | Tier 2 / medium | At least 4 evidence bundles | stratified purposive |
| `banking-retail-adversarial` | wizard, multilingual, accessibility-heavy flows | EU banking + EAA | Tier 3 / high | At least 2 evidence bundles | SME-curated oversample |
| `insurance-nonlife` | tariff calculator, FNOL, damage workflows | DACH insurance + EU consumer rights | Tier 1-2 | At least 3 evidence bundles | stratified purposive |
| `insurance-life-health` | beneficiary, BU, health-related forms | DACH insurance + GDPR Art. 9 | Tier 2-3 | At least 3 evidence bundles | SME-curated |
| `aml-compliance` | suspicious-activity / sanctions-adjacent flows | Germany + EU AML obligations | Tier 3 / high | At least 2 evidence bundles | purposive high-risk |
| `cross-modal-a11y` | tooltip-heavy, high-contrast, keyboard-first masks | EU-wide + EAA / WCAG | Tier 3 / high | At least 2 evidence bundles | adversarial oversample |
| `generic-rubric-baseline` | structure, traceability, test-data hygiene | EU-wide cross-domain | low / medium / high | At least 1 bundle per scoring section | section census |

### Stratification rationale

- `Testfall-eines-Anwendungstests.md` is a section census: every numbered
  section was backed by at least one evidence bundle from the strata above.
- `Eingabemasken-Testfallrubrik.md` is a fixture-family census: all fifteen
  Eingabemasken fixtures were reviewed, then the most failure-prone Tier-3
  slices were oversampled during clause drafting.
- The sampling plan is intentionally not traffic-weighted. Low-frequency but
  regulator-sensitive flows are oversampled because false confidence on those
  paths is more damaging than over-testing common happy paths.

## 5. Sampling Method

The sampling method is mixed by artifact type:

- **Generic rubric:** stratified purposive sampling. Each scoring section was
  drafted only after reviewers inspected at least one representative
  low-complexity, one medium-complexity, and one high-complexity evidence
  bundle.
- **Eingabemasken rubric:** full-corpus review for the fifteen committed
  Eingabemasken fixtures, plus purposive oversampling of adversarial cases
  (multilingual, accessibility, AML-sensitive, tooltip-heavy, and
  stateful-wizard flows).
- **Failure-mode prioritization:** SME-curated. When reviewers saw recurring
  misses in hallucinative validations, synthetic-data hygiene, or missing
  accessibility expectations, those patterns were promoted into explicit
  rubric entries even if they were not the most common production flow.

### Prioritized failure modes

- invented validation rules or concrete calculation results where the source
  is silent;
- real or realistic personal/account data in generated test data;
- missing negative paths for required consent, compliance, or cross-field
  rules;
- missing keyboard / live-region / focus behavior on accessibility-relevant
  flows;
- false certainty on tooltip-defined semantics or state transitions.

## 6. Inter-Rater Protocol

Rubric construction follows the same two-reviewer discipline already used by
the broader test-intelligence calibration process.

- Two reviewers independently label each candidate rubric clause as
  `keep`, `revise`, or `drop`.
- Reviewer notes must cite the supporting source family
  (regulation, fixture evidence, customer interview, audit finding, or
  standards source).
- Cohen's kappa (`κ`) is tracked on the first-pass `keep/revise/drop`
  decisions.
- `κ < 0.7` is a hard stop for publishing a refreshed rubric slice.
- `0.7 <= κ < 0.8` is allowed only with arbiter review and an explicit note in
  the refresh record.
- Disagreements are adjudicated by the arbiter; the adjudicated decision is
  the one that may appear in the checked-in rubric.

This protocol mirrors the repository's human-oversight calibration posture:
independent review first, arbitration second, and no silent single-reviewer
promotion of rubric clauses.

## 7. Coverage Statement

### Covered

- EU banking and insurance customer-facing and staff-facing input masks.
- German-first wording with EU-wide regulatory framing.
- Low, medium, and adversarially high-complexity application-test scenarios.
- Accessibility, resilience, privacy, and traceability expectations when they
  are visible in the source or directly implied by the regulated context.

### Not Covered

- Non-EU jurisdictions such as UK FCA, FINRA/FFIEC, FINMA, MAS, or ASIC.
  Rationale: the committed fixture set and compliance rule packs are EU/DACH
  scoped.
- Native-mobile-only interaction patterns, right-to-left locales, and voice-
  only surfaces. Rationale: the current fixture corpus is screen/UI-form
  oriented and left-to-right.
- Pure back-office batch processing and regulator-submission screens without a
  user-operated input-mask workflow. Rationale: these are better covered by
  separate benchmark and reporting fixtures, not the customer-eval rubrics.
- Product-specific payout, tax, premium, or pricing formulas whose exact rule
  is not visible in source artifacts. Rationale: the rubric explicitly
  forbids inventing missing normative rules.

## 8. Refresh Cadence

- Quarterly checkpoint: review the sample-plan coverage and the rubric-entry
  traceability matrix once per quarter.
- Event-driven refresh: review immediately when any of the following change:
  - a committed customer-eval rubric changes;
  - a new Eingabemasken fixture or new fixture tier is introduced;
  - the active compliance/regulatory guidance materially changes;
  - calibration or audit evidence shows a repeated blind spot.

Rubric-only changes MUST either update this file or append a rationale to
`SAMPLE-PLAN-NON-UPDATE.md`.

## 9. Rubric Entry Traceability Matrix

### 9.1 `Testfall-eines-Anwendungstests.md`

| Rubric entry | Source type | Source references | Why this source justifies the entry |
| --- | --- | --- | --- |
| Section 1 `Zielbild` | customer-review synthesis | accepted customer-facing test-case review criteria from the test-intelligence QA workflow | establishes that generated cases must be executable, auditable, and customer-facing rather than prompt-internal |
| Section 2 `Mindestformat` | QA architecture + fixture evidence | generated-case export format, customer markdown renderer expectations, review feedback on missing preconditions/traceability | locks the minimum structure so cases remain reproducible and reviewable |
| Section 3 `Umfang und Schnitt` | SME review + fixture decomposition | multi-screen and multi-role Eingabemasken fixtures | prevents over-large compound cases that hide failures |
| Section 4 `Inhaltliche Abdeckung` | stratified fixture evidence | baseline fixtures plus banking/insurance Eingabemasken coverage gaps | ensures the suite covers positive, negative, boundary, state, role, and resilience paths |
| Section 5 `Banken- und Versicherungsleitplanken` | regulation / standards | DORA, GDPR, EAA, ISO 29119 references already cited in Section 10 | turns regulated-domain expectations into explicit test obligations |
| Section 6 `Umgang mit unklaren Anforderungen` | audit finding + calibration evidence | repeated hallucination / invented-rule failure mode during fixture review | forces uncertainty to remain explicit instead of becoming invented certainty |
| Section 7 `Qualitaetskriterien und Scoring` | rubric-construction workshop | reviewer scoring calibration across low/medium/high complexity evidence bundles | creates a stable scorecard and release threshold |
| Section 8 `Harte Ablehnungskriterien` | compliance and safety review | data-hygiene, missing-expected-result, and contradiction findings surfaced in review | defines non-negotiable rejection triggers |
| Section 9 `Gute Formulierungen` | customer review | examples from accepted vs. rejected case phrasing | keeps the published style professional and precise |
| Section 10 `Grounding Stand 2026` | primary source list | DORA, EBA/EIOPA guidance, EAA, WCAG 2.2, GDPR, ISO 29119 | records the published grounding frame for the rubric |

### 9.2 `Eingabemasken-Testfallrubrik.md`

| Rubric entry | Source type | Source references | Why this source justifies the entry |
| --- | --- | --- | --- |
| Section 1 `Geltungsbereich` | fixture census | all fifteen Eingabemasken fixtures + master rubric linkage | defines that this rubric tightens, rather than replaces, the master rubric |
| Section 2 Tier 1 | fixture evidence | smoke / baseline masks: login, transfer, simple tariff, simple FNOL | encodes the minimum suite for common low-complexity masks |
| Section 2 Tier 2 | fixture evidence + SME review | KYC, credit, MiFID, BU, LV, and repeating-row fixtures | covers cross-field rules, conditional requiredness, computed fields, and compliance gates |
| Section 2 Tier 3 | adversarial oversample | wizard, AML, multilingual, accessibility, tooltip-heavy fixtures | captures the high-risk failure modes that generic form testing missed |
| Section 3 `Pflicht-Techniken` | standards source + fixture synthesis | ISO/IEC/IEEE 29119-4:2021 plus observed mask structures | maps abstract test-design techniques to mask-specific obligations |
| Section 4 `Cross-Modal Faithfulness-Anker` | calibration evidence | visual-sidecar / faithfulness calibration expectations for labels, results, and tooltip semantics | ensures multimodal evidence is handled explicitly instead of inferred |
| Section 5 `Harte Ablehnungskriterien` | compliance review + audit findings | PII hygiene, invented sanctions logic, invented classification claims, invented WCAG references | blocks unsafe or hallucinative outputs even when the rest of the case is plausible |
| Section 6 `Pflege` | governance workflow | issue-driven maintenance model across fixtures, policy profiles, and faithfulness tiers | ties rubric updates to concrete change triggers rather than ad hoc edits |

## 10. Source Catalog

The traceability matrix uses the following source families:

- **Regulation / standards:** DORA, GDPR, EAA, WCAG 2.2, ISO/IEC/IEEE
  29119-4:2021, plus the banking/insurance references already named inside the
  rubrics.
- **Fixture evidence:** the committed baseline and Eingabemasken fixture
  corpus, including summary sidecars and derived IR structure.
- **Customer interview / operator review:** reviewer comments collected during
  customer-facing test-case evaluation and release-readiness review.
- **Audit finding / calibration evidence:** repeated hallucination, trace, or
  evidence-quality failures that justified hardening a clause into the rubric.
