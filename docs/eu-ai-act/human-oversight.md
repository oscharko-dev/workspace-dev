# EU AI Act — Human Oversight Addendum (Wave 4 Multi-Source)

**Scope:** This document explains how the Wave 4 multi-source conflict-
resolution gate (Wave 4.F) and the four-eyes review trigger on
`multi_source_conflict_present` (Issue #1376) discharge the EU AI Act
Article 14 human oversight requirements for the test-intelligence
QA-assistance system.

**Regulation:** REGULATION (EU) 2024/1689 (EU AI Act), specifically
Article 14 (Human oversight).

**Last reviewed:** 2026-04-27

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

### 3.5 Semantic content sanitization (Art. 14(4)(b))

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
| `wave1-poc-evidence-manifest.json`        | SHA-256 hashes for every artifact plus model deployment names and prompt template version              |
| `validation-report.json`                  | Per-case AI output validation, including semantic-suspicious-content findings                          |

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
