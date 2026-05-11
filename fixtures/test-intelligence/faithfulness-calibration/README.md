# Faithfulness calibration anchors (Issue #2066, extended for #2170)

This directory persists the calibration anchors that the
faithfulness-tier rubric was tuned against. Each anchor is a
hand-reviewed historical step from the existing benchmark corpus
(`sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/<accepted-runs>/`, the
`G0` / `I0` / `J0` regression runs, plus the `M0` / `E5h5` runs
captured for Issue #2170).

The corpus mirrors the acceptance criteria of #2066 + #2170:

- **Anchors 001-030 — `label_only`.** Thirty mixed `match` /
  `evidence_partial` anchors from accepted runs that the v1 prompt
  collapsed into partial-mismatches and that the v2 prompt must
  resolve correctly.
- **Anchors 031-060 — `concrete_data` mismatches.** Thirty anchors
  with positive numeric or copy contradictions that must remain
  `mismatch` under the v2 rubric so the cross-modal score still
  penalizes hallucinated payloads.
- **Anchors 061-075 — `label_only` partial-evidence-only (Issue
  #2170).** Fifteen additional reviewer-confirmed `evidence_partial`
  anchors from the `E5h5` and `M0` runs. Together with the fifteen
  `evidence_partial` rows in 001-030 these bring the total
  partial-evidence corpus to **30 reviewer-confirmed positives**, the
  number Issue #2170 acceptance criteria require for the v3 rubric
  recalibration.
- **Anchors 076-085 — `state_transition` (Issue #2170).** Ten
  workflow steps from `technique === "state_transition"` test cases.
  Intermediate workflow frames are inherently hard to verify
  end-to-end from a single screenshot, so the v3 rubric resolves them
  as `evidence_partial`; final-frame anchors are labeled `match`.

Each anchor records:

- `anchorId` — stable id used by reviewer tooling.
- `sourceRunId` — the benchmark run the anchor was captured from.
- `testCaseId` and `stepIndex` — coordinates inside that run.
- `step` — the step shape (mirrors `GeneratedTestCaseStep`).
- `tier` — the tier classification produced by
  `classifyFaithfulnessStepTier`. Reviewers must agree with the
  classification before the anchor is committed.
- `expectedStepVerdict` — the verdict the v2 rubric should emit.
- `humanVerdict` — the reviewer's verdict for the same step.
- `humanReviewNotes` — short reviewer-readable rationale.

The anchors are loaded by the offline calibration harness (see
`docs/test-intelligence/cross-modal-faithfulness-tier.md`). They are
NOT used to auto-tune thresholds at runtime — calibration is
offline-only.
