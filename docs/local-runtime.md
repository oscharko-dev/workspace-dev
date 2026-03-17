# No-K8s Local Runtime Path

## Overview

`workspace-dev` runs as a local Node.js runtime without Kubernetes or external backend infrastructure.

## Capabilities

- Start local runtime on localhost
- Serve reduced workspace UI on `/workspace/ui` and `/workspace/:figmaFileKey`
- Enforce mode lock (`rest` + `deterministic`)
- Execute autonomous job lifecycle (`queued -> running -> completed|failed`)
- Fetch Figma file over REST
- Derive deterministic IR and generate local code artifacts
- Auto-bootstrap deterministic icon fallback mapping at `<outputRoot>/icon-fallback-map.json`
- Export and serve local preview from `.workspace-dev/repros/<jobId>`

## Explicit Non-Goals

- No MCP mode
- No hybrid mode
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
| Queue | None | Redis/BullMQ |
| Source modes | REST only | REST + MCP + Hybrid |
| Codegen modes | Deterministic only | Deterministic + LLM |
| Preview | Local static export | Full platform preview |
| Git automation | Optional `git.pr` (opt-in) | Available in full stack |
