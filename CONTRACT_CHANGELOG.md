# Contract Changelog - workspace-dev

All changes to the public contract surface of `workspace-dev` are documented here.

## Versioning Rules

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| New optional field | Minor (x.Y.0) | Add `projectName` to `WorkspaceJobInput` |
| New endpoint | Minor (x.Y.0) | Add `GET /workspace/version` |
| New exported type | Minor (x.Y.0) | Export `WorkspaceVersionInfo` |
| Remove field or type | Major (X.0.0) | Remove `WorkspaceJobResult.error` |
| Rename field or type | Major (X.0.0) | Rename `figmaFileKey` to `fileKey` |
| Change field type | Major (X.0.0) | Change `port` from `number` to `string` |
| Change response status code | Major (X.0.0) | Change `501` to `200` on submit |
| Change error code string | Major (X.0.0) | Rename `MODE_LOCK_VIOLATION` |

## Enforcement

- `contract-version.test.ts` guards runtime export surface.
- `pnpm typecheck` guards type compatibility.
- Every contract change must add an entry in this file before merge.

---

## [1.0.0] - 2026-03-11

### Initial stable contract baseline

Exported types:
- `WorkspaceFigmaSourceMode`
- `WorkspaceLlmCodegenMode`
- `WorkspaceStartOptions`
- `WorkspaceStatus`
- `WorkspaceJobInput`
- `WorkspaceJobResult`
- `WorkspaceVersionInfo`

Exported values:
- `CONTRACT_VERSION` (`"1.0.0"`)

Added:
- `CONTRACT_VERSION` constant for programmatic version checks
- Runtime schema validation on `POST /workspace/submit`
- `VALIDATION_ERROR` envelope for schema validation failures
