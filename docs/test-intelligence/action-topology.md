# Test-Intelligence Workflow Action Topology

Status: production candidate (Issue #2035)

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

Observed pre-topology baseline on disk:

- run dir:
  `/Users/oscharko-dev/Projects/workspace-dev/sandbox/test-case/T7l7m8T8501lxLZZFQrwJC/2026-05-08T07-33-20-053Z`
- `coverage-report.json.actionCoverage`:
  `{ "covered": 0, "ratio": 0, "total": 0, "uncoveredIds": [] }`
- `workflow-topology.json`: absent
- `customer-markdown/testfaelle.md`: no `ACT-*` refs

Fresh rerun status on 2026-05-08:

- the protocol's customer-eval path is stale in this checkout; the current
  file is
  `/Users/oscharko-dev/Projects/workspace-dev/sandbox/evals/Testfall-eines-Anwendungstests.md`
- after correcting the path, the authenticated live rerun remained blocked
  because neither `WORKSPACE_TEST_SPACE_API_KEY` nor
  `WORKSPACE_TEST_SPACE_MODEL_API_KEY` was present after sourcing `.env`

Result:

- a new authenticated benchmark delta for Issue #2035 could not be produced in
  this environment
- the code-level verification for the topology handoff is covered by targeted
  tests, but the live-dataset action-coverage improvement still requires a
  fresh authenticated rerun

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
