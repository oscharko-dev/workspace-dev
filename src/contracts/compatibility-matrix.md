# Compatibility Matrix

## Package Version History

Package version and contract version are intentionally independent, so this section documents historical release examples instead of an exhaustive 1:1 mapping.

| Example package release line | Contract API at release time | Min Node | Notes |
|------------------------------|------------------------------|----------|-------|
| 0.1.x                        | 1.0.0                        | 22.0.0   | Initial local mode-locked runtime |
| 0.2.x                        | 2.0.0                        | 22.0.0   | Autonomous local generation |
| 0.3.x                        | 2.1.0                        | 22.0.0   | Parity pipeline + optional `git.pr` |
| 1.x and later                | See `CHANGELOG.md` and `CONTRACT_CHANGELOG.md` | 22.0.0 | Package releases and contract versions evolve on separate tracks |

## Runtime Matrix

| Runtime | Status |
|---------|--------|
| Node 22.x | Supported |
| Node 24.x | Supported |
| ESM import | Supported |
| CJS require | Supported |

## Mode Support

| Mode | workspace-dev | Full Workspace Dev Platform |
|------|---------------|----------------|
| `figmaSourceMode=rest` | Supported | Supported |
| `figmaSourceMode=local_json` | Supported | Supported |
| `figmaSourceMode=hybrid` | Supported | Supported |
| `figmaSourceMode=mcp` | Blocked | Supported |
| `llmCodegenMode=deterministic` | Supported | Supported |
| `llmCodegenMode=hybrid` | Blocked | Supported |
| `llmCodegenMode=llm_strict` | Blocked | Supported |

## Breaking Change Policy

See [CONTRACT_CHANGELOG.md](../../CONTRACT_CHANGELOG.md) for contract bump rules and [VERSIONING.md](../../VERSIONING.md) for the package-versus-contract policy.

| Change Type | Version Impact | Example |
|-------------|----------------|---------|
| New optional field | Minor bump | Add `projectName` to `WorkspaceJobInput` |
| New endpoint | Minor bump | Add `GET /workspace/version` |
| Remove or rename field | Major bump | Remove `figmaFileKey` |
| Change response code | Major bump | Change `501` to `202` |
| Change error code | Major bump | Rename `MODE_LOCK_VIOLATION` |

## Enforcement

- Runtime export guard: `contract-version.test.ts`
- Type-level guard: `pnpm typecheck`
- Process gate: every contract change requires a `CONTRACT_CHANGELOG.md` entry

## Migration Guide

1. Install `workspace-dev` as a dev dependency.
2. Replace API calls with local `workspace-dev start`.
3. Use mode configuration `rest`, `hybrid`, or `local_json` with `deterministic`.
4. `workspace-dev` runs autonomous local fetch/IR/codegen/validation/export without Workspace Dev platform API services.
