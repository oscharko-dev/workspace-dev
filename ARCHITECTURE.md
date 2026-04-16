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
  - `codegen.generate` (deterministic generation stream, optional image export, manifest, diff context)
  - `validate.project` (validation gate, feedback loop, canonical final diff persistence)
  - `repro.export` (generated `dist` export)
  - `git.pr` (optional git/pr automation)
- integrated preview file serving from generated artifacts

Execution plans:

- `submission`: all seven stages in canonical order
- `regeneration`: same order with `figma.source` and `git.pr` skipped by plan rules; `ir.derive` reads seeded regeneration artifacts (`regeneration.source_ir`, `regeneration.overrides`) from the current job store

### Isolation model

- Each project instance runs in its own child process, forked and owned by the parent runtime.
- The parent process tracks child lifecycle state in the module-level `activeInstances` registry in `src/isolation.ts`.
- That registry relies on a single-threaded Node.js event loop invariant inside one process. It is not safe for `worker_threads` or any concurrent mutation model without synchronization or an ownership redesign.
- Targeted instance removal uses graceful IPC shutdown first, waits up to 3 seconds for process exit, then falls back to `SIGKILL`.
- Host-process cleanup hooks use best-effort `SIGTERM` because they run during parent shutdown and prioritize deterministic teardown over additional coordination state.

## Hard mode lock

The runtime enforces:

- `figmaSourceMode=rest|hybrid|local_json|figma_paste|figma_plugin`
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

### Template packaging invariants

- The published npm package intentionally includes `template/react-mui-app/pnpm-lock.yaml` alongside `template/react-mui-app/package.json`.
- The rationale is deterministic template installs for the shipped generated-app baseline and air-gap-friendly reproducibility when consumers install the published package offline.
- Root package inclusion is controlled by `package.json` `files`; that allowlist intentionally keeps the `template/` subtree while excluding template `node_modules` directories and template test files.
- Maintainers update `template/react-mui-app/pnpm-lock.yaml` only in this repository when template dependencies or template scripts change, then keep `pnpm run template:install` (`pnpm --dir template/react-mui-app install --frozen-lockfile`) and the release quality gates green.
- Consumers should treat the bundled template lockfile as package-owned metadata shipped inside the tarball, not as a file to hand-edit under `node_modules`.
- `pnpm run verify:airgap` validates that the packed tarball installs offline with the bundled template assets, while `pnpm run verify:reproducible-build` separately validates repeatable `dist/` build artifacts across consecutive builds.

## Import session governance (#994)

Every paste-import pipeline can emit `WorkspaceImportSessionEvent` entries whenever the Inspector walks a completed session through its review stages. Events are persisted server-side under `<outputRoot>/import-session-events/<sessionId>.json` (append-only, 200-entry rotation, note truncated at 1024 chars) and exposed via:

- `GET  /workspace/import-sessions/:id/events` — ordered audit trail.
- `POST /workspace/import-sessions/:id/events` — append one event. Body shape: `{ id?, kind, note?, metadata? }`. `kind` must be one of `imported`, `review_started`, `approved`, `applied`, `rejected`, `apply_blocked`, `note`; `metadata` is a flat record of string/number/boolean/null. This route is bearer-only and accepts `Authorization: Bearer <token>` matching the server startup setting (`WorkspaceStartOptions.importSessionEventBearerToken` or `FIGMAPIPE_WORKSPACE_IMPORT_SESSION_EVENT_BEARER_TOKEN`). Missing or invalid auth returns `401` before the request body is parsed; when the server is not configured with a token, the route fails closed with `503`. The server derives integrity fields for persisted events: `id` is preserved when supplied and otherwise generated at append time, `at` is always stamped at append time, and `actor` is only attached when a trusted server-side caller supplies an authenticated principal.

The Inspector renders `ImportReviewStepper` above the suggestions panel whenever a pipeline reaches `ready` or `partial`. The stepper walks the user through four stages — Import → Review → Approve → Apply — and enforces the workspace governance policy:

- `policy.governance.minQualityScoreToApply` (optional) blocks `Apply` until the derived quality score meets the threshold.
- `policy.governance.requireNoteOnOverride` forces the reviewer to supply a note when overriding the gate.
- `policy.governance.securitySensitivePatterns` (reserved for a follow-up) lets repos mark high-risk components that require explicit review even when the score is high.

Server-owned mutations now persist only defensible governance events. Import-session creation records `imported`, local sync records `applied` after a successful write, and PR creation keeps the existing server-authored `note` entry, incorporating the request `reviewerNote` when one is supplied. Approval remains an explicit authenticated event-route action, but it is not a prerequisite for the built-in browser sync/create-PR flow in the current architecture; browser-only review telemetry such as `review_started` and `apply_blocked` remains in-memory UI behavior unless a trusted server path explicitly persists it. `ImportHistoryPanel` renders the per-session audit trail inline when a row is expanded.
