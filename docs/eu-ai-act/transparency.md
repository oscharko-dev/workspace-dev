# EU AI Act — Transparency Summary For Customer-Eval Rubrics

**Scope:** This note explains how the customer-eval rubrics disclose their
construction logic, coverage limits, and refresh cadence in support of the
repository's transparency posture.

**Regulation:** Regulation (EU) 2024/1689 (EU AI Act), especially Article 13
on transparency to deployers and reviewers.

**Last reviewed:** 2026-05-10

## 1. What is being disclosed

The customer-eval rubrics under
`fixtures/test-intelligence/customer-evals/` now publish a checked-in sample
plan at `fixtures/test-intelligence/customer-evals/SAMPLE-PLAN.md`.

That sample plan discloses:

- which domain slices were sampled;
- which sampling method was used;
- which reviewer protocol governed rubric construction;
- which coverage gaps remain intentional;
- when the rubric must be reviewed again;
- how each rubric entry traces back to a source family.

## 2. Why this matters for transparency

Article 13 requires deployers and reviewers to understand the system's
capabilities, constraints, and operating assumptions. For the customer-eval
rubrics, the key transparency risk was hidden provenance: a reviewer could see
the scoring rules but not the evidence and sampling logic behind them.

Publishing the sample plan closes that gap by making the following visible:

- the rubrics are EU/DACH customer-eval guidance, not universal QA doctrine;
- regulator-sensitive and adversarial flows are intentionally oversampled;
- unresolved rules must remain unresolved and may not be hallucinated into
  concrete expectations;
- coverage exclusions are explicit rather than silently implied.

## 3. Known limits disclosed to reviewers

The published sample plan states that the customer-eval rubrics do **not**
claim coverage for:

- non-EU regulatory regimes;
- right-to-left, voice-only, or native-mobile-only interaction models;
- pure back-office batch/reporting workflows with no input-mask flow;
- exact pricing, tax, or benefits formulas that are not visible in source
  artifacts.

These limits are part of the transparency surface: a reviewer should know
where the rubric is strong and where additional local guidance is required.

## 4. Refresh model

The transparency commitment is not one-time. The sample-plan artifact is
reviewed quarterly and whenever:

- a customer-eval rubric changes;
- a new fixture tier or archetype materially changes the domain;
- calibration or audit evidence shows a repeated blind spot;
- the regulatory grounding changes materially.

Rubric-only changes must update the sample plan or record an explicit
justification in `SAMPLE-PLAN-NON-UPDATE.md`.

## 5. Relationship to the broader EU AI Act documentation

This note is intentionally short. It complements, rather than replaces:

- `docs/eu-ai-act/human-oversight.md` for Article 14 controls;
- `docs/eu-ai-act/model-cards/` for deployment-level transparency and
  calibration disclosures;
- `fixtures/test-intelligence/customer-evals/SAMPLE-PLAN.md` for the concrete
  rubric-construction evidence model.
