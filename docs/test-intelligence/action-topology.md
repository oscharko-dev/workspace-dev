# Test-Intelligence Workflow Action Topology

Status: shipped (Issue #2035, PR #2045 merged into `dev`; live benchmark delta recorded 2026-05-08)

This note describes the deterministic workflow-action topology that augments the
test-intelligence pipeline with an explicit action universe. The goal is to make
action coverage measurable end to end instead of relying on sparse or missing
`BusinessTestIntentIr.detectedActions` entries.

## Purpose

Issue #2035 adds a deterministic `action_topology` role and a persisted
`workflow-topology.json` artifact. The topology gives the pipeline a stable
action vocabulary that is reused by:

- coverage planning,
- prompt compilation,
- generated-case validation,
- logic-judge hard-gate checks,
- coverage reporting,
- customer Markdown rendering,
- evidence sealing and harness manifests.

Without this artifact, the active benchmark dataset could complete with
`coverage-report.json.actionCoverage = { total: 0, covered: 0, ratio: 0 }`
because no reliable action universe was present upstream.

## Artifact Contract

The artifact is written as:

- `workflow-topology.json`

Its contract lives in `workspace-dev/contracts`:

- `WORKFLOW_TOPOLOGY_SCHEMA_VERSION`
- `WORKFLOW_TOPOLOGY_ARTIFACT_FILENAME`
- `WorkflowTopology`
- `WorkflowTopologyAction`
- `WorkflowTopologyState`
- `WorkflowTopologyTransition`

The deterministic shape is:

```json
{
  "schemaVersion": "1.0.0",
  "jobId": "job-2035",
  "actions": [
    {
      "actionId": "ACT-001",
      "screenId": "screen-1",
      "label": "Submit payment",
      "kind": "confirm_state",
      "targetIds": ["screen-1::action::submit"],
      "sourceRefs": ["figma-node:submit"]
    }
  ],
  "states": [
    {
      "stateId": "STATE-001",
      "screenId": "screen-1",
      "label": "Payment form visible",
      "sourceRefs": ["figma-screen:screen-1"]
    }
  ],
  "transitions": [
    {
      "transitionId": "TRANS-001",
      "from": "STATE-001",
      "to": "STATE-002",
      "guard": "Submit is activated",
      "actions": ["ACT-001"]
    }
  ],
  "entryStates": ["STATE-001"],
  "exitStates": ["STATE-002"]
}
```

## Stable `ACT-*` IDs

Workflow actions are emitted as stable `ACT-###` identifiers.

These IDs are intentionally separate from raw Figma-derived action ids such as
`screen::action::node`. The workflow ids represent the customer-meaningful
action topology, while `targetIds` keeps the trace back to concrete screen
elements.

The production runner enriches accepted generated cases so that:

- `qualitySignals.coveredActionIds` contains the matching `ACT-*` ids,
- the first actionable step gets a single `[ACT-###]` prefix when the case
  exercises a topology action,
- customer Markdown surfaces the action refs under `Workflow-Aktionen`.

## Pipeline Wiring

The topology is consumed in five places:

1. Coverage planning adds `action_transition` requirements with
   `technique: "state_transition"` and `targetIds` containing the stable
   `ACT-*` ids.
2. Prompt compilation persists the topology in the compiled prompt artifact and
   instructs the generator to cite `ACT-*` ids in `coveredActionIds` when the
   workflow action is exercised.
3. Validation accepts `ACT-*` ids as known action coverage ids when they are
   present in `workflowTopology.actions`.
4. The logic-judge hard gate accepts `ACT-*` ids only when they are declared in
   the coverage-plan targets and rejects undeclared `ACT-*` ids as
   hallucinations.
5. Coverage reporting uses `workflowTopology.actions` as the action universe
   when available, so `actionCoverage.total` is meaningful even when the
   upstream intent IR has no detected actions.

Issue #2072 builds on the same artifact by adding
`workflowTopology.fieldLifecycles`. The per-field lifecycle envelope is
documented in [`field-lifecycle-state-machine.md`](./field-lifecycle-state-machine.md)
and reuses the same persistence, prompt-compilation, validation, coverage, and
evidence-sealing path instead of introducing a parallel artifact family.

## Evidence And Manifests

`workflow-topology.json` is part of the production evidence surface. A runner
produced bundle now includes it in:

- `agent-participation.json` under the `action_topology` role,
- `wave1-validation-evidence-manifest.json`,
- the harness artifact manifest,
- the production-runner evidence seal filename set.

This keeps the topology verifiable offline alongside the other deterministic
artifacts.

## Benchmark Notes

Reference dataset:

- `T7l7m8T8501lxLZZFQrwJC`

Authenticated benchmark delta for Issue #2035 (recorded 2026-05-08):

| Metric                          | B0 (pre-topology)        | C-2026-05-08 (post-topology) |
|---------------------------------|--------------------------|------------------------------|
| `coverage-report.actionCoverage`| `{ covered:0, total:0, ratio:0 }` | `{ covered:4, total:4, ratio:1.0 }` |
| `workflow-topology.json`        | absent                   | present, 4 actions, 5 states, 4 transitions |
| `customer-markdown` ACT refs    | none                     | 12 occurrences across cases  |
| Stable IDs emitted              | none                     | `ACT-001`…`ACT-004`          |

Run folders:

- B0: `sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/2026-05-08T07-33-20-053Z`
  (pre-topology snapshot, `actionCoverage = 0/0`).
- C-current: `sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/2026-05-08T11-43-40-060Z`
  (post-topology, `actionCoverage = 4/4 = 1.0`).

Reproduction:

```bash
cd /Users/oscharko-dev/Projects/workspace-dev && \
set -a && source .env && set +a && \
FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1 \
WORKSPACE_TEST_SPACE_ALLOW_POLICY_BLOCKED=1 \
pnpm exec tsx src/cli.ts test-intelligence run \
  --figma-url "https://www.figma.com/design/T7l7m8T8501lxLZZFQrwJC/TestForSimpleComponent?node-id=1-11309" \
  --custom-context-markdown "sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/Jira-Story.md" \
  --customer-eval-markdown  "fixtures/test-intelligence/customer-evals/Testfall-eines-Anwendungstests.md" \
  --output                  "sandbox/test-case/T7l7m8T8501lxLZZFQrwJC" \
  --ict-register-ref        "workspace-dev-local-test-intelligence" \
  --enable-visual-sidecar --allow-policy-blocked
```

Required environment (from `.env`):

- `FIGMA_ACCESS_TOKEN`
- `WORKSPACE_TEST_SPACE_LLM_API_KEY` (canonical key; see
  [`visual-sidecar-client.live-env.ts`](../../src/test-intelligence/visual-sidecar-client.live-env.ts))

Hard-gate observation in C-current: `G1`, `G2` pass. `G3`, `G4`, `G7` failures
in this single live run trace back to unrelated Epics (LLM-side validation
hallucinations under #1987, visual-sidecar fallback under #1989, and a
test_generation wall-clock breach), not to the action-topology change. The
deterministic hard-gate suite for topology-relevant logic
(`logic-judge.coverage-hard-gate.test.ts`) remains 15/15 green on this commit.

## Verification Surfaces

The focused regression suite for Issue #2035 covers:

- topology derivation and invariant failure on invalid transition guards,
- validator acceptance of topology-backed `ACT-*` ids,
- validation-pipeline passthrough of topology-backed `ACT-*` ids,
- logic-judge acceptance of declared `ACT-*` ids and rejection of undeclared
  `ACT-*` ids,
- coverage-report action-universe override,
- customer Markdown action-ref rendering,
- manifest and production-runner artifact filename inclusion.
