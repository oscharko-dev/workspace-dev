# EU AI Act — Human Oversight Addendum (Wave 4 Multi-Source)

**Scope:** This document explains how the Wave 4 multi-source conflict-
resolution gate (Wave 4.F) and the four-eyes review trigger on
`multi_source_conflict_present` (Issue #1376) discharge the EU AI Act
Article 14 human oversight requirements for the test-intelligence
QA-assistance system.

**Regulation:** REGULATION (EU) 2024/1689 (EU AI Act), specifically
Article 14 (Human oversight).

**Last reviewed:** 2026-05-09

---

## 1. Regulatory context

Article 14 of the EU AI Act requires that high-risk AI systems be designed
and developed to allow effective human oversight. Specifically, Art. 14(4)
requires that human overseers be able to:

- (a) Fully understand the capabilities and limitations of the AI system.
- (b) Monitor its operation for signs of anomalous behaviour.
- (c) Remain aware of the possible tendency to over-rely on the output.
- (d) Interpret outputs correctly.
- (e) Decide in specific situations not to use the output.
- (f) Intervene on the operation of the AI system or interrupt it.

---

## 2. Classification note

The package does not assert that the test-intelligence subsurface is a
high-risk AI system under Annex III. That determination depends on the
operator's deployment context, the business process it supports, and the
operator's own risk classification.

Where an operator does classify the subsurface as high-risk, or where the
operator applies Art. 14 obligations as a matter of internal policy, the
controls documented here provide a technical basis for demonstrating
compliance.

---

## 3. Human oversight mechanisms

### 3.1 Reviewer-driven review gate (Art. 14(4)(d)(e)(f))

Every AI-generated test case must pass through the reviewer-driven review
gate before it can reach the export pipeline. The gate state machine enforces:

- No test case can be exported without at least one `approved` event from an
  authenticated reviewer.
- Terminal states (`rejected`, `approved`) refuse further transitions;
  re-editing an approved case invalidates its approval chain.
- The reviewer can add notes, reject cases, or request clarification at any
  point before or after the AI generation step.

This satisfies Art. 14(4)(e) (decide not to use the output) and
Art. 14(4)(f) (intervene on the operation).

### 3.2 Four-eyes review for high-risk cases (Art. 14(4)(d)(f))

Issue #1376 introduced four-eyes review enforcement. The
`EU_BANKING_DEFAULT_FOUR_EYES_POLICY` requires a second reviewer for cases
with risk categories in `["financial_transaction", "regulated_data", "high"]`
and for cases where the visual sidecar triggers outcomes in
`["low_confidence", "fallback_used", "possible_pii", "prompt_injection_like_text", "conflicts_with_figma_metadata"]`.

Wave 4 extends the four-eyes trigger to fire on **multi-source conflict**:

```
fourEyesVisualSidecarTriggerOutcomes: [
  ...,
  "multi_source_conflict_present"
]
```

When a reconciliation conflict is present (`conflict_present` outcome in
the conflict-resolution gate), the case is automatically flagged for
four-eyes review. A second reviewer — distinct from the first — must
independently approve the case before export.

This directly addresses Art. 14(4)(d) (interpreting AI output correctly when
conflicting source evidence is present) and Art. 14(4)(f) (interrupting the
system when source confidence is insufficient).

### 3.3 Conflict-resolution policy gate (Art. 14(4)(a)(b)(c))

The Wave 4 conflict-resolution gate surfaces conflicts as structured evidence
in the `multi-source-conflicts.json` artifact. Each conflict record
includes:

- The conflicting sources (e.g. Figma-derived intent vs. Jira acceptance
  criteria).
- The specific fields that conflict.
- The applied resolution policy (`priority`, `reviewer_decides`, or
  `keep_both`).
- The resolved intent used for prompt compilation (after policy application).

Reviewers can read this artifact via `GET /workspace/test-intelligence/jobs/<jobId>`
to understand exactly where AI-generated test cases diverged from one source
vs. the other. This satisfies Art. 14(4)(a) (understand capabilities and
limitations) and Art. 14(4)(c) (remain aware of potential over-reliance).

### 3.4 Policy-gate blocking (Art. 14(4)(e)(f))

The policy gate (Issue #1364) blocks export when any of the following apply:

- `policy_blocked_cases_present` — cases whose policy decision is `blocked`
  prevent the entire export.
- `visual_sidecar_blocked` — visual evidence is insufficient and blocked.
- `unapproved_test_cases_present` — human approval is missing.
- `review_state_inconsistent` — the review state machine is in an
  inconsistent state.

These blocks are non-circumventable from the export pipeline; the only way
forward is human reviewer action. This satisfies Art. 14(4)(f) (interrupt
the system).

### 3.5 Inter-rater agreement protocol on the calibration gold set (Art. 14(4)(a)(b))

Issue #2109 lifts the judge-calibration gold set from single-annotator
labels to an inter-rater agreement protocol. Without this lift, the
calibration thresholds (`accuracy ≥ 0.85`, `FPR ≤ 0.10`) are calibrated
against a single reviewer's labels — a methodological weakness for
high-stakes regulated AI because Art. 14(4)(a)(b) implicitly requires
that the human-in-the-loop produces consistent, monitorable decisions.

**Two-reviewer rule.** Every gold case under
`src/test-intelligence/fixtures/judge-calibration/<id>.gold.json`
carries a `goldVerdicts` array with **at least two distinct reviewer
entries**. Each entry records:

- `reviewer` — stable principal label (e.g. `reviewer:banking-sme:alpha`).
- `verdict` — one of `accept` / `repair` / `reject`.
- `findingCodes` — the codes the reviewer would emit on the case.
- `rationale` — free-text reviewer note.
- `timestamp` — ISO-8601 instant the verdict was recorded.

Schema enforcement: the gold-set parser
([`src/test-intelligence/judge-calibration-eval.ts`](../../src/test-intelligence/judge-calibration-eval.ts))
rejects fixtures with fewer than `JUDGE_CALIBRATION_MIN_REVIEWERS_PER_CASE`
(currently `2`) reviewer entries, duplicate reviewers, or a top-level
`humanVerdict` that disagrees with the consensus or adjudication
resolution.

**Adjudication workflow.** When the two reviewers disagree on either
the verdict or the finding-code set:

- The case is marked `adjudicated: true`.
- A third reviewer (the **arbiter**, distinct from both original
  reviewers) records an `adjudication` block with the same
  `verdict` / `findingCodes` / `rationale` / `timestamp` shape.
- The top-level `humanVerdict` / `humanFindingCodes` reflect the
  **arbiter's** resolution and are the authoritative labels the
  calibration math consumes.
- Conversely, when the two reviewers agree, `adjudicated` is `false`
  and no `adjudication` block is present; the parser rejects any
  inconsistency between `adjudicated` and the actual
  agreement/disagreement state.

**Cohen's κ on the calibration set.**
[`src/test-intelligence/inter-rater-agreement.ts`](../../src/test-intelligence/inter-rater-agreement.ts)
computes Cohen's κ (Cohen, 1960) between the first two reviewer
verdicts, both **per judge type** (logic / faithfulness) and **per
judge × per scenario class** (`happy` / `adversarial` / `edge`). The
artifact also persists:

- The 3-class confusion matrix and observed/expected agreement.
- The list of `disagreementFixtureIds` and `adjudicatedFixtureIds`.
- A reviewer-rotation log per judge with each reviewer's
  fixture-count and share so a single reviewer cannot dominate the
  calibration set silently.

**Gate severity.** The runner
[`scripts/run-judge-calibration-eval.ts`](../../scripts/run-judge-calibration-eval.ts)
applies the gate at:

| Severity | Condition                                                     | Effect                                |
| -------- | ------------------------------------------------------------- | ------------------------------------- |
| `fail`   | Per-judge κ < `0.7` (`INTER_RATER_KAPPA_HARD_FLOOR`)           | Non-zero exit; CI red.                |
| `warn`   | Per-judge κ < `0.8` (`INTER_RATER_KAPPA_WARN_FLOOR`)           | Logged to stdout; no exit-code change. |
| `fail`   | Reviewer-share > `0.6` (`INTER_RATER_REVIEWER_SHARE_HARD_CAP`) | Non-zero exit.                        |
| `warn`   | Reviewer-share > `0.45` (`INTER_RATER_REVIEWER_SHARE_WARN_CAP`)| Logged to stdout.                     |
| `warn`   | Per-scenario κ below floor when paired-rating count < `8`     | Logged; the per-scenario hard-fail is suppressed below `INTER_RATER_PER_SCENARIO_GATE_MIN_PAIRS` because the κ point estimate is too unstable to gate against on small N. |

The gate runs in every CI pipeline that already exercises
`pnpm run test:ti-judge-calibration` (PR, dev-merge, release) — see
[`docs/test-intelligence-judge-calibration.md`](../test-intelligence-judge-calibration.md).

**Reviewer staffing (operator responsibility).** The package ships an
example reviewer pool of two banking-domain SMEs, one insurance-domain
SME, and one senior arbiter. Operators MUST configure their own pool
of at least two banking-domain SMEs plus one senior arbiter for
production use, rotating the secondary reviewer so no single SME
exceeds the share thresholds above.

**Evidence for Art. 14 audit.** The persisted artifact at
`storybook-static/eval-reports/judge-calibration-inter-rater-agreement.json`
documents per-judge κ, per-scenario κ, the rotation log, the
adjudicated fixture ids, and the gate verdict. This artifact is the
auditable record that the human-in-the-loop produces consistent
decisions on the calibration set — the prerequisite for relying on
human-overridden judge thresholds under Art. 14.

### 3.6 Semantic content sanitization (Art. 14(4)(b))

Wave 2 Issue #1413 introduced semantic content sanitization. The validator
detects suspicious content categories (`shell_metacharacters`,
`command_substitution`, `jndi_log4shell`, `encoded_payload_base64`,
`encoded_payload_hex`, `script_tag`, `html_event_handler`,
`dangerous_url_scheme`) in generated test steps and flags them as
`semantic_suspicious_content` errors.

Cases with suspicious content are blocked from export until a reviewer
explicitly overrides the finding with a justification (≤ 512 chars). This
provides Art. 14(4)(b) monitoring for anomalous AI output.

---

## 4. Evidence for Art. 14 audit

The following per-job artifacts provide evidence of human oversight controls:

| Artifact                                  | Art. 14 evidence                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `review-events.json`                      | Complete audit log of reviewer handles, actions, and timestamps for every approved/rejected/noted case |
| `multi-source-conflicts.json`             | Documents source conflicts, the applied resolution policy, and the final reconciled intent used for AI generation |
| `policy-report.json`                      | Per-case policy decisions, including four-eyes flags and conflict-triggered escalations                |
| `wave1-validation-evidence-manifest.json`        | SHA-256 hashes for every artifact plus model deployment names and prompt template version              |
| `validation-report.json`                  | Per-case AI output validation, including semantic-suspicious-content findings                          |
| `judge-calibration-inter-rater-agreement.json` | Cohen's κ per judge / per scenario, reviewer-rotation log, and adjudicated-fixture ids; demonstrates that the human-in-the-loop produces consistent calibration labels (Issue #2109) |

---

## 5. Operator responsibilities

The package provides the technical infrastructure for human oversight. The
operator is responsible for:

1. **Configuring reviewer principals.** At least one bearer-token principal
   must be configured for review-gate write routes to function. For four-eyes
   enforcement, two distinct principals must be configured.
2. **Defining four-eyes policy.** The default policy requires four-eyes for
   `financial_transaction`, `regulated_data`, and `high` risk categories, plus
   visual sidecar anomalies. The operator may extend this list via
   `WorkspaceStartOptions.testIntelligence.fourEyesRequiredRiskCategories`
   and `fourEyesVisualSidecarTriggerOutcomes`.
3. **Defining the conflict-resolution policy.** For multi-source jobs, the
   operator chooses `priority` (deterministic precedence), `reviewer_decides`
   (always requires human resolution), or `keep_both` (surfaces both
   interpretations) via the envelope's `conflictResolutionPolicy` field.
4. **Retaining review evidence.** The operator is responsible for retaining
   `review-events.json`, `policy-report.json`, and the evidence manifest as
   part of their Art. 14 audit trail. The package never deletes artifacts.
5. **Training reviewers.** Reviewers must understand the conflict-resolution
   policies and the four-eyes trigger conditions to exercise meaningful
   oversight rather than rubber-stamping AI output.

---

## 6. Limitations

- The package does not classify the test-intelligence system as high-risk.
- The package does not provide AI monitoring infrastructure beyond the
  per-job artifacts described above; production monitoring requires additional
  tooling on the operator's side.
- Human oversight controls are only effective if the operator configures
  bearer principals, review policies, and conflict-resolution policies
  appropriately.
- The operator remains solely responsible for determining whether the
  generated test cases are correct and suitable for use in their QA process.

---

## 7. Cross-references

- `COMPLIANCE.md` — top-level DORA/GDPR/EU AI Act control mapping
- `docs/test-intelligence.md` §14 — Wave 4 multi-source gate
- `docs/dora/multi-source.md` — DORA Art. 6/8/9/28 mapping
- `CONTRACT_CHANGELOG.md` — contract surface history (Wave 4 range)
- Issue #1376 — four-eyes review enforcement
- Issue #1364 — policy gate
- Issue #1413 — semantic content sanitization
- Issue #2109 — inter-rater agreement protocol on the calibration gold set
