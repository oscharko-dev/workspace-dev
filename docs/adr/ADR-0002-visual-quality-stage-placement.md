# ADR-0002: Visual quality validation runs inside the `validate.project` stage

- **Status**: Accepted
- **Date**: 2026-04-12
- **Issue**: #826
- **Deciders**: Lead session (autonomous workflow)

## Context

The visual quality assessment plan (`PR-Wellen-Visual-Regression.md`, Welle 0) asks a design-level question: should the visual-quality computation be a new dedicated pipeline stage after `repro.export`, or an extension of the existing `validate.project` stage?

The workspace-dev pipeline stages are fixed at 7 entries in `src/job-engine/stage-state.ts`:
`figma.source → ir.derive → template.prepare → codegen → validate.project → repro.export → git.pr`.

Two options were considered:

1. Introduce a new 8th stage `validate.visual` between `repro.export` and `git.pr`.
2. Run visual capture + diff + scoring inside the existing `validate.project` stage.

## Decision

Option 2: visual quality lives inside `validate.project`.

## Consequences

### Positive

- No change to `STAGE_ORDER`, `STAGE_ORDER_SET`, or the public pipeline contract surfaced via `WorkspaceJobStatus.stages`. Adding an 8th stage would be a breaking public-API change.
- `validate.project` already has access to the built project directory (it validates it) — visual capture needs the same directory. No new data plumbing required.
- The warn-only error envelope inside `validate.project` (see `src/job-engine/services/validate-project-service.ts`) already handles partial failures without tearing down the pipeline.

### Negative / Trade-offs

- The plan explicitly says "Capture und Vergleich erst nach erzeugtem Repro". Strictly, our capture runs before `repro.export`. In practice the captured artifact is the built React/MUI app (available before `repro.export`), not the repro bundle. The repro bundle is a tarball of the same files. This deviation is semantic, not functional.
- `validate-project-service.ts` is large (~3000 LOC). Adding visual-quality as a sub-concern increases that file's surface. Mitigated by keeping the standalone block (`runStandaloneVisualQuality`) logically isolated.

## Alternatives considered

- **Separate post-`repro.export` stage**: would require a public contract extension and new stage artifacts wiring. Too invasive for V1 scope, and offers no functional gain because the captured output is the same.
- **Post-pipeline hook**: would break the "visual quality is a first-class validation signal" framing.

## Follow-ups

- If `validate-project-service.ts` grows past ~3500 LOC, consider extracting visual-quality into its own service file (still inside `validate.project`).
- Revisit if a future change makes the build artifact materially different between `validate.project` and `repro.export`.
