# No-K8s Local Runtime Path

## Overview

`workspace-dev` runs as a local Node.js runtime without Kubernetes or external backend infrastructure.

## Capabilities

- Start local runtime on localhost
- Serve reduced workspace UI on `/workspace/ui` and `/workspace/:figmaFileKey`
- Enforce mode lock (`rest|hybrid|local_json` + `deterministic`)
- Execute autonomous job lifecycle (`queued -> running -> completed|failed|canceled`)
- Enforce in-memory queue backpressure caps (`maxConcurrentJobs`, `maxQueuedJobs`)
- Fetch Figma file over REST
- Recover authoritative screen subtrees in `hybrid` mode when direct REST geometry payloads are structurally weak
- Derive deterministic IR and generate local code artifacts
- Auto-bootstrap deterministic icon fallback mapping at `<outputRoot>/icon-fallback-map.json`
- Export and serve local preview from `.workspace-dev/repros/<jobId>`

## Workspace UI CSP

The workspace UI document responses served from `/workspace/ui` and `/workspace/:figmaFileKey` enforce this Content-Security-Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Notes:

- `style-src 'unsafe-inline'` is currently required because the workspace UI and inspector still render inline React `style={{...}}` attributes in several components.
- `script-src` stays locked to `'self'`; `unsafe-eval`, external origins, and other relaxed script directives are not allowed.
- `connect-src`, `img-src`, and `font-src` remain same-origin only, except `data:` images already used by the UI.
- Preview routes under `/workspace/repros/*` are excluded from this CSP so generated previews can still be embedded inside the inspector iframe.

## Explicit Non-Goals

- No MCP mode
- No `llm_strict`
- No Redis/Postgres queueing stack
- No dependency on Workspace Dev platform API services

## On-Prem Boundary

`workspace-dev` is scoped to a developer workstation process boundary:

1. Binds to localhost by default (`127.0.0.1`).
2. Requires no backend infrastructure.
3. Executes deterministic generation only.
4. Writes output under project-local `.workspace-dev`.

## Separation from Full Workspace Dev Platform

| Aspect | workspace-dev | Full Workspace Dev Platform |
| ------ | ------------- | -------------- |
| Runtime | Local Node.js process | Multi-service runtime |
| Database | None | PostgreSQL |
| Queue | In-memory capped queue | Redis/BullMQ |
| Source modes | REST + Hybrid + local_json | REST + MCP + Hybrid |
| Codegen modes | Deterministic only | Deterministic + LLM |
| Preview | Local static export | Full platform preview |
| Git automation | Optional `git.pr` (opt-in) | Available in full stack |
