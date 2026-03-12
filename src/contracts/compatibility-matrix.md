# Compatibility Matrix

## Package Versions

| workspace-dev | Contract API | Min Node | Supports |
|---------------|--------------|----------|----------|
| 0.1.x         | 1.0.0        | 22.0.0   | rest + deterministic |

## Runtime Matrix

| Runtime | Status |
|---------|--------|
| Node 22.x | Supported |
| Node 24.x | Supported |
| ESM import | Supported |
| CJS require | Supported |

## Mode Support

| Mode | workspace-dev | Full FigmaPipe |
|------|---------------|----------------|
| `figmaSourceMode=rest` | Supported | Supported |
| `figmaSourceMode=mcp` | Blocked | Supported |
| `figmaSourceMode=hybrid` | Blocked | Supported |
| `llmCodegenMode=deterministic` | Supported | Supported |
| `llmCodegenMode=hybrid` | Blocked | Supported |
| `llmCodegenMode=llm_strict` | Blocked | Supported |

## Breaking Change Policy

See [CONTRACT_CHANGELOG.md](../../CONTRACT_CHANGELOG.md) for authoritative versioning rules.

| Change Type | Version Impact | Example |
|-------------|----------------|---------|
| New optional field | Minor bump | Add `projectName` to `WorkspaceJobInput` |
| New endpoint | Minor bump | Add `GET /workspace/version` |
| Remove or rename field | Major bump | Remove `figmaFileKey` |
| Change response code | Major bump | Change `501` to `200` |
| Change error code | Major bump | Rename `MODE_LOCK_VIOLATION` |

## Enforcement

- Runtime export guard: `contract-version.test.ts`
- Type-level guard: `pnpm typecheck`
- Process gate: every contract change requires a `CONTRACT_CHANGELOG.md` entry

## Migration Guide

1. Install `workspace-dev` as a dev dependency.
2. Replace API calls with local `workspace-dev start`.
3. Use mode configuration `rest` + `deterministic` only.
4. `workspace-dev` validates requests but does not execute fetch/codegen/output.
