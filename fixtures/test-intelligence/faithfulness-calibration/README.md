# Faithfulness calibration anchors (Issue #2066)

This directory persists the calibration anchors that the
faithfulness-tier rubric was tuned against. Each anchor is a
hand-reviewed historical step from the existing benchmark corpus
(`sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/<accepted-runs>/` and the
`G0` / `I0` / `J0` regression runs).

The corpus mirrors the acceptance criteria of #2066:

- Thirty `label_only` anchors from accepted runs that the v1 prompt
  collapsed into partial-mismatches and that the v2 prompt must
  resolve as `match` or `evidence_partial`.
- Thirty `concrete_data` anchors with positive numeric or copy
  contradictions that must remain `mismatch` under the v2 rubric so
  the cross-modal score still penalizes hallucinated payloads.

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
