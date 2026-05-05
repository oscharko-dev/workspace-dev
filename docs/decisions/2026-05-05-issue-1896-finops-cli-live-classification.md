# ADR: Issue #1896 FinOps CLI Live Classification

- Status: Accepted
- Date: 2026-05-05
- Issue: #1896
- Parent Epic: #1892

## Context

The production runner persists a FinOps report for every
`figma_to_qc_test_cases` job. Before this change, the `test_generation`
attempt recorder classified every non-mock deployment as `liveSmoke`.

That rule worked for opt-in smoke lanes, but it misclassified normal
operator-driven CLI live runs against Azure AI Foundry. The production
default FinOps envelope intentionally sets
`roles.test_generation.maxLiveSmokeCalls = 0`, so a real CLI run always
stamped a FinOps breach:

- the job itself could succeed;
- the FinOps report still ended with `outcome = "budget_exceeded"`;
- policy/validation-blocked runs could additionally be masked by the same
  FinOps outcome, making the terminal reason ambiguous.

## Decision

Adopt Issue #1896 Option A.

`liveSmoke` classification is now reserved for explicitly smoke-tagged
gateway releases, not for all real deployments. The production runner
recognizes the current smoke markers (`live-smoke`, `live-e2e`) and only
increments the live-smoke counter for those lanes.

Normal operator-driven CLI runs keep using real deployments, but they are
classified as standard live generation traffic. As a result, the
production-default envelope no longer self-reports `budget_exceeded` for a
successful CLI run solely because it contacted Azure.

The FinOps report also now applies the same terminal-outcome precedence
already used by the validation harness:

1. `visual_sidecar_failed`
2. `policy_blocked`
3. `validation_blocked`
4. otherwise the derived budget/completion outcome

This prevents a blocked compliance outcome from being double-labeled as
`budget_exceeded`.

## Consequences

- Successful CLI live runs can finish with a success FinOps outcome instead
  of an always-on `budget_exceeded`.
- Smoke lanes still have a budget hook: a smoke-tagged gateway release can
  continue to be capped by `maxLiveSmokeCalls`.
- FinOps outcomes now align with the job's real terminal state when the
  validation or policy gate blocks the run.

## Alternatives Considered

- Option B: raise `maxLiveSmokeCalls` in the production-default envelope.
  Rejected because it preserves the wrong semantic model and only hides the
  misclassification.
- Option C: add a separate CLI-specific FinOps profile.
  Rejected because the bug is classification, not lack of a profile.
