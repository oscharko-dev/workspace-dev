# Test-Intelligence Field Lifecycle State Machine

Status: shipped (Issue #2072)

Issue #2072 extends the deterministic `workflow-topology.json` artifact with a
per-field lifecycle envelope. The goal is to make field interactions auditable
as explicit state transitions instead of relying on flat `init -> input ->
result` steps.

## Artifact Shape

`workflow-topology.json` now carries a `fieldLifecycles` array next to the
existing workflow actions, states, and transitions.

Each lifecycle is keyed by `fieldId` and emits a fixed state universe:

- `initial`
- `focused`
- `in_progress`
- `validated`
- `error`
- `terminal`

The deterministic transition chain is:

- `initial -> focused` via `user_focus`
- `focused -> in_progress` via `user_input`
- `in_progress -> validated` via `validation_pass`
- `in_progress -> error` via `validation_fail`
- `validated -> terminal` via `form_commit`

Every lifecycle transition receives a stable `FLT-...` id. Generated test-case
steps anchor those ids through `steps[*].fieldLifecycleTransitionId`.

## Pipeline Wiring

The field-lifecycle surface is consumed in five places:

1. `action-topology-agent.ts` derives `workflowTopology.fieldLifecycles` for
   coverage-relevant input and selection fields.
2. `coverage-planner.ts` adds lifecycle-backed `state_transition` requirements
   and mandatory `error_guessing` requirements for `to === "error"`
   transitions.
3. `prompt-compiler.ts` instructs test generation to emit
   `steps[*].fieldLifecycleTransitionId` and to cover every `error`
   transition with at least one negative or validation case.
4. `test-case-validation.ts` blocks runs when a step omits a lifecycle
   transition id or when an uncovered transition is classified as
   `mandatory_negative_path` by the Issue #2168 tier classifier
   (entry transitions out of `initial` and the
   `validation_pass` / `validation_fail` outcomes). Recommended-tier and
   state-transition-only transitions surface as non-blocking warnings —
   see `docs/test-intelligence/state-machine-validator.md`.
5. `customer-markdown-renderer.ts` renders lifecycle transitions explicitly as
   `→ Feld erreicht Zustand "..."`.

## Coverage Reporting

`coverage-report.json` now includes:

- `fieldLifecycleCoverage.total`
- `fieldLifecycleCoverage.covered`
- `fieldLifecycleCoverage.ratio`
- `fieldLifecycleCoverage.uncoveredIds`

The coverage universe is defined by
`workflowTopology.fieldLifecycles[*].transitions[*].transitionId`. A run is
considered release-grade for this axis when the active dataset reaches
`fieldLifecycleCoverage.ratio >= 0.80`.

## Verification Surface

The focused regression suite for Issue #2072 is:

```bash
pnpm exec tsx --test \
  src/test-intelligence/action-topology-agent.test.ts \
  src/test-intelligence/test-case-validation.test.ts \
  src/test-intelligence/test-case-coverage.test.ts \
  src/test-intelligence/customer-markdown-renderer.test.ts \
  src/test-intelligence/validation-pipeline.test.ts \
  src/test-intelligence/validation-pipeline.golden.test.ts
```

These tests pin:

- deterministic `fieldLifecycles` emission,
- step-level lifecycle transition validation,
- transition-coverage enforcement,
- `coverage-report.json#fieldLifecycleCoverage`,
- explicit lifecycle rendering in customer Markdown,
- golden artifact stability for the validation pipeline.
