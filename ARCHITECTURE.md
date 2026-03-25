# ARCHITECTURE

## Purpose

`workspace-dev` is an autonomous local generator runtime for a reduced Workspace Dev workspace flow.

It provides deterministic HTTP behavior for:

- `GET /workspace`
- `GET /workspace/ui` and `GET /workspace/:figmaFileKey`
- `GET /healthz`
- `POST /workspace/submit` (starts real job execution)
- `GET /workspace/jobs/:id`
- `GET /workspace/jobs/:id/result`
- `GET /workspace/repros/:id/*`

## Runtime Architecture (No Workspace Dev platform backend dependency)

`workspace-dev` runs as a single Node.js process with:

- local in-process job engine (no Redis, no Postgres, no external worker)
- pipeline kernel (`src/job-engine/pipeline/`) with:
  - `PipelineOrchestrator` for stage ordering, skip logic, cancellation, status/log updates, and pipeline error mapping
  - `StageArtifactStore` for filesystem-backed stage artifact references under each job directory
  - public job projection that syncs artifact-backed outputs back into compatibility fields such as `artifacts.*`, `generationDiff`, and `gitPr`
- seven internal stage services (`src/job-engine/services/`):
  - `figma.source` (Figma fetch/local JSON, cleaning, optional authoritative subtree merge)
  - `ir.derive` (IR derivation, IR cache, diagnostics, regeneration from seeded source-IR artifacts)
  - `template.prepare` (template reset/copy)
  - `codegen.generate` (deterministic generation stream, optional image export, manifest/diff)
  - `validate.project` (validation gate and feedback loop)
  - `repro.export` (generated `dist` export)
  - `git.pr` (optional git/pr automation)
- integrated preview file serving from generated artifacts

Execution plans:

- `submission`: all seven stages in canonical order
- `regeneration`: same order with `figma.source` and `git.pr` skipped by plan rules; `ir.derive` reads seeded regeneration artifacts (`regeneration.source_ir`, `regeneration.overrides`) from the current job store

## Hard mode lock

The runtime enforces:

- `figmaSourceMode=rest|hybrid|local_json`
- `llmCodegenMode=deterministic`

Blocked modes (`mcp`, `llm_strict`) fail with `MODE_LOCK_VIOLATION`.

## Artifact model

Default output root is `.workspace-dev` in the current project.

- `.workspace-dev/jobs/<jobId>/figma.json`
- `.workspace-dev/jobs/<jobId>/design-ir.json`
- `.workspace-dev/jobs/<jobId>/generated-app/*`
- `.workspace-dev/jobs/<jobId>/.stage-store/*` (artifact reference index and per-key refs)
- `.workspace-dev/repros/<jobId>/*`

## Security boundaries

- Server binds to localhost by default (`127.0.0.1`).
- Secrets are accepted at submit-time and used in-memory.
- Job APIs expose only sanitized request metadata.
- No core imports from `services/api` or `services/web`.

## Operational model

- Source repository: standalone `workspace-dev` repository
- Distribution: npm package publish via OIDC trusted publishing
- On-prem Workspace Dev platform runtime remains independent and out of package scope
- Cutover procedure: `docs/hard-split-cutover.md`
