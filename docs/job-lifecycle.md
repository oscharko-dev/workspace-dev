# Job Lifecycle

This document records the public lifecycle invariants for workspace jobs.
`src/job-engine/stage-state.ts`, `src/job-engine.ts`, and the canonical
pipeline plan must stay aligned with the rules below.

## Canonical Stages

Every public job uses the same stage order:

1. `figma.source`
2. `ir.derive`
3. `template.prepare`
4. `codegen.generate`
5. `validate.project`
6. `repro.export`
7. `git.pr`

Jobs may skip stages by plan rule, but they may not insert, reorder, or remove
public stages.

## Runtime Statuses

Public job statuses are:

- `queued`
- `running`
- `completed`
- `partial`
- `failed`
- `canceled`

Submission jobs start as `queued`. The only legal forward transitions are:

- `queued -> running`
- `queued -> canceled`
- `running -> completed`
- `running -> partial`
- `running -> failed`
- `running -> canceled`

Terminal statuses are `completed`, `partial`, `failed`, and `canceled`.
Canceling a terminal job is idempotent and returns the existing terminal state.

## Cancel

Cancel is valid only for `queued` and `running` jobs.

For queued jobs:

- cancellation is terminal immediately
- `finishedAt` is set
- `cancellation.requestedAt` and `cancellation.completedAt` are set
- `currentStage` is cleared
- remaining queued stages are marked `skipped` with the cancellation reason
- queue bookkeeping removes the job from the relevant queued-input store

For running jobs:

- cancellation intent is recorded immediately
- the active runner aborts cooperatively
- the job eventually reaches terminal `canceled`
- stages after the active boundary are marked `skipped`

## Retry

Retry creates a fresh child job from a persisted source job.

- only `failed` and `partial` source jobs may be retried
- the child job keeps the source pipeline and pipeline metadata
- the child job records lineage with `kind: "retry"`, `sourceJobId`,
  `overrideCount: 0`, and the selected `retryStage`
- `retryTargets` are valid only when `retryStage === "codegen.generate"`
- stages before the retry boundary reuse persisted artifacts and therefore end
  as `skipped` with a reuse message
- the retry boundary and all later stages execute again in canonical order
- creating or canceling a retry child must not mutate the terminal source job

The only public retry boundaries are:

- `figma.source`
- `ir.derive`
- `template.prepare`
- `codegen.generate`

## Regeneration

Regeneration creates a fresh child job from a completed source job.

- only `completed` source jobs may regenerate
- the child job stays on the source pipeline
- the child job records lineage with `kind: "regeneration"`, `sourceJobId`,
  `overrideCount`, and optional `draftId` / `baseFingerprint`
- `figma.source` is skipped because regeneration reuses the source IR inputs
- `git.pr` is skipped because PR creation is a follow-up operation, not part of
  regeneration execution
- creating or canceling a regeneration child must not mutate the terminal
  source job

## Diagnostics

Terminal failures surface public error metadata through `error`.

- `error.code`, `error.stage`, and `error.message` identify the terminal
  failure
- `error.diagnostics` carries structured pipeline diagnostics when available
- the public projection must preserve diagnostic payloads verbatim
- callers receive detached copies of lineage and diagnostics so mutating a
  returned projection cannot mutate the live in-memory job record
