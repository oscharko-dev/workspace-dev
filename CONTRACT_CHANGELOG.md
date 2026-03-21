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
| Change response status code | Major (X.0.0) | Change `501` to `202` on submit |
| Change error code string | Major (X.0.0) | Rename `MODE_LOCK_VIOLATION` |

## Enforcement

- `contract-version.test.ts` guards runtime export surface.
- `pnpm typecheck` guards type compatibility.
- Every contract change must add an entry in this file before merge.

---

## [2.17.0] - 2026-03-21

### Generation diff report for design iteration cycles

Added:
- `WorkspaceGenerationDiffModifiedFile` type for modified file entries in diff report.
- `WorkspaceGenerationDiffReport` type for full generation diff report.
- `generationDiffFile?: string` to `WorkspaceJobArtifacts` for the diff report file path.
- `generationDiff?: WorkspaceGenerationDiffReport` to `WorkspaceJobStatus` for diff in job status.
- `generationDiff?: WorkspaceGenerationDiffReport` to `WorkspaceJobResult` for diff in job result.

## [2.16.0] - 2026-03-20

### Structured pipeline diagnostics on failed jobs

Added:

- `WorkspaceJobDiagnosticSeverity = "error" | "warning" | "info"`
- `WorkspaceJobDiagnosticValue` recursive JSON-safe value union for diagnostic details
- `WorkspaceJobDiagnostic` payload shape for actionable stage diagnostics
- `WorkspaceJobError.diagnostics?: WorkspaceJobDiagnostic[]` (optional structured diagnostics)

## [2.15.0] - 2026-03-19

### Form handling mode selection for generated forms

Added:

- `WorkspaceFormHandlingMode = "react_hook_form" | "legacy_use_state"`
- `WorkspaceJobInput.formHandlingMode?: WorkspaceFormHandlingMode`
- `WorkspaceJobRequestMetadata.formHandlingMode: WorkspaceFormHandlingMode` (resolved effective mode)

## [2.14.0] - 2026-03-18

### Job cancellation endpoint and queue backpressure controls

Added:

- `WorkspaceStartOptions.maxConcurrentJobs?: number` (default `1`)
- `WorkspaceStartOptions.maxQueuedJobs?: number` (default `20`)
- `WorkspaceJobRuntimeStatus` now also supports `"canceled"`.
- `WorkspaceJobQueueState` and `WorkspaceJobStatus.queue`
- `WorkspaceJobCancellation` and `WorkspaceJobStatus.cancellation`
- `WorkspaceJobResult.cancellation`

## [2.13.0] - 2026-03-18

### Optional unit-test validation gate in runtime configuration

Added:

- `WorkspaceStartOptions.enableUnitTestValidation?: boolean` (default `false`)

## [2.12.0] - 2026-03-18

### Design system config file path for runtime code generation

Added:

- `WorkspaceStartOptions.designSystemFilePath?: string` (default `<outputRoot>/design-system.json`)

## [2.11.0] - 2026-03-17

### Local Figma JSON submit mode

Added:

- `WorkspaceFigmaSourceMode` now also supports `"local_json"`.
- `WorkspaceJobInput.figmaJsonPath?: string` for local JSON ingestion runs.

Changed:

- `WorkspaceJobInput.figmaFileKey` and `figmaAccessToken` are now optional and validated conditionally by `figmaSourceMode`.
- `WorkspaceJobRequestMetadata.figmaFileKey` is now optional and `figmaJsonPath?: string` was added.

## [2.10.0] - 2026-03-17

### Configurable generated app router mode

Added:

- `WorkspaceRouterMode = "browser" | "hash"`
- `WorkspaceStartOptions.routerMode?: WorkspaceRouterMode` (default `browser`)

## [2.9.0] - 2026-03-17

### Configurable generation locale for deterministic select-option derivation

Added:

- `WorkspaceStartOptions.generationLocale?: string` (default `de-DE`)
- `WorkspaceJobInput.generationLocale?: string` (optional per-job override)
- `WorkspaceJobRequestMetadata.generationLocale: string` (resolved effective locale)

## [2.8.0] - 2026-03-17

### Deterministic image export runtime switch

Added:

- `WorkspaceStartOptions.exportImages?: boolean` (default `true`)

## [2.7.0] - 2026-03-17

### Configurable icon fallback map path

Added:

- `WorkspaceStartOptions.iconMapFilePath?: string` (default `<outputRoot>/icon-fallback-map.json`)

## [2.6.0] - 2026-03-16

### Skip-install runtime switch for validate.project

Added:

- `WorkspaceStartOptions.skipInstall?: boolean` (default `false`)

## [2.5.0] - 2026-03-16

### Dynamic IR depth traversal baseline configuration

Added:

- `WorkspaceStartOptions.figmaScreenElementMaxDepth?: number` (default `14`)

## [2.4.0] - 2026-03-16

### Brand theme policy for IR token derivation

Added:

- `WorkspaceBrandTheme = "derived" | "sparkasse"`
- `WorkspaceStartOptions.brandTheme?: WorkspaceBrandTheme` (default `derived`)
- `WorkspaceJobInput.brandTheme?: WorkspaceBrandTheme` (optional per-job override)
- `WorkspaceJobRequestMetadata.brandTheme: WorkspaceBrandTheme` (resolved effective policy)

## [2.3.0] - 2026-03-16

### Staged screen candidate name filter

Added:

- `WorkspaceStartOptions.figmaScreenNamePattern?: string` (default `undefined`)

## [2.2.0] - 2026-03-16

### Figma source cache controls

Added:

- `WorkspaceStartOptions.figmaCacheEnabled?: boolean` (default `true`)
- `WorkspaceStartOptions.figmaCacheTtlMs?: number` (default `900000`)

## [2.1.0] - 2026-03-12

### Parity pipeline + optional git.pr contract

Added:

- New stage names:
  - `template.prepare`
  - `validate.project`
  - `git.pr`
- `WorkspaceJobInput.enableGitPr?: boolean` (`false` by default)
- `WorkspaceGitPrStatus` payload on `WorkspaceJobStatus` and `WorkspaceJobResult`

Changed:

- `WorkspaceJobInput.repoUrl` and `repoToken` are now optional by default.
- `repoUrl`/`repoToken` are required only when `enableGitPr=true`.
- Removed `project.build` stage from public stage contract.

## [2.0.0] - 2026-03-12

### Autonomous generation contract

Breaking changes:

- `POST /workspace/submit` now returns `202 Accepted` and enqueues a real local generation job.
- `WorkspaceJobInput` now requires:
  - `figmaAccessToken`
  - `repoUrl`
  - `repoToken`
- `WorkspaceJobResult` changed from static `not_implemented` envelope to compact job result payload.
- `WorkspaceStatus` now includes:
  - `outputRoot`
  - `previewEnabled`

Added:

- `WorkspaceJobRuntimeStatus`
- `WorkspaceJobStageStatus`
- `WorkspaceJobStageName`
- `WorkspaceSubmitAccepted`
- `WorkspaceJobRequestMetadata`
- `WorkspaceJobStage`
- `WorkspaceJobLog`
- `WorkspaceJobArtifacts`
- `WorkspaceJobError`
- `WorkspaceJobStatus`

New endpoints:

- `GET /workspace/jobs/:id`
- `GET /workspace/jobs/:id/result`
- `GET /workspace/repros/:id/*`

Mode lock remains unchanged:

- `figmaSourceMode=rest`
- `llmCodegenMode=deterministic`

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
