# No-K8s Local Runtime Path

## Overview

`workspace-dev` runs without Kubernetes or container orchestration.
It is a local-first Node.js server that provides status and request validation.

## Capabilities

- Start local server on localhost
- Serve local workspace UI on `/workspace/ui`
- Enforce mode lock (`rest` + `deterministic`)
- Validate submit request payloads at runtime with internal zero-dependency validators
- Provide per-project isolation using child processes

## Explicit Non-Goals

- No Figma fetch execution
- No code generation execution
- No filesystem output writes
- No Redis/Postgres dependency for this package runtime
- No MCP or LLM runtime integration

## On-Prem Boundary

`workspace-dev` is scoped to a developer workstation process boundary:

1. Binds to localhost by default (`127.0.0.1`).
2. Requires no backend infrastructure.
3. Validates and rejects unsupported runtime modes.
4. Does not perform external execution stages.

## Separation from Full FigmaPipe

| Aspect | workspace-dev | Full FigmaPipe |
| ------ | ------------- | -------------- |
| Runtime | Local Node.js process | Multi-service runtime |
| Database | None | PostgreSQL |
| Queue | None | Redis/BullMQ |
| Codegen | Not implemented | Deterministic + LLM |
| Figma | Validation only | REST + MCP |
| Isolation | child process per project | platform-managed |
