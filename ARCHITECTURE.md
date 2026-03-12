# ARCHITECTURE

## Purpose

`workspace-dev` is an autonomous local generator runtime for a reduced FigmaPipe workspace flow.

It provides deterministic HTTP behavior for:

- `GET /workspace`
- `GET /workspace/ui` and `GET /workspace/:figmaFileKey`
- `GET /healthz`
- `POST /workspace/submit` (starts real job execution)
- `GET /workspace/jobs/:id`
- `GET /workspace/jobs/:id/result`
- `GET /workspace/repros/:id/*`

## Runtime Architecture (No FigmaPipe backend dependency)

`workspace-dev` runs as a single Node.js process with:

- local in-process job engine (no Redis, no Postgres, no external worker)
- Figma REST fetch (`figma.source`) with retry + timeout
- deterministic IR derivation (`ir.derive`)
- template bootstrap from bundled React+TypeScript+MUI v7 template (`template.prepare`)
- deterministic local code generation (`codegen.generate`)
- project validation (`validate.project`: install, lint, typecheck, build)
- local repro export (`repro.export`)
- optional git/pr stage (`git.pr`) when enabled explicitly
- integrated preview file serving from generated artifacts

## Hard mode lock

The runtime enforces:

- `figmaSourceMode=rest`
- `llmCodegenMode=deterministic`

Blocked modes (`mcp`, `hybrid`, `llm_strict`) fail with `MODE_LOCK_VIOLATION`.

## Artifact model

Default output root is `.workspace-dev` in the current project.

- `.workspace-dev/jobs/<jobId>/figma.json`
- `.workspace-dev/jobs/<jobId>/design-ir.json`
- `.workspace-dev/jobs/<jobId>/generated-app/*`
- `.workspace-dev/repros/<jobId>/*`

## Security boundaries

- Server binds to localhost by default (`127.0.0.1`).
- Secrets are accepted at submit-time and used in-memory.
- Job APIs expose only sanitized request metadata.
- No core imports from `services/api` or `services/web`.

## Operational model

- Package source: private monorepo (`packages/workspace-dev`)
- Public distribution: mirrored public repository + npm package publish
- On-prem FigmaPipe runtime remains independent
