# Contract Changelog - workspace-dev

All changes to the public contract surface of `workspace-dev` are documented here.

## Versioning Rules

| Change Type                 | Version Bump  | Example                                  |
| --------------------------- | ------------- | ---------------------------------------- |
| New optional field          | Minor (x.Y.0) | Add `projectName` to `WorkspaceJobInput` |
| New endpoint                | Minor (x.Y.0) | Add `GET /workspace/version`             |
| New exported type           | Minor (x.Y.0) | Export `WorkspaceVersionInfo`            |
| Remove field or type        | Major (X.0.0) | Remove `WorkspaceJobResult.error`        |
| Rename field or type        | Major (X.0.0) | Rename `figmaFileKey` to `fileKey`       |
| Change field type           | Major (X.0.0) | Change `port` from `number` to `string`  |
| Change response status code | Major (X.0.0) | Change `501` to `202` on submit          |
| Change error code string    | Major (X.0.0) | Rename `MODE_LOCK_VIOLATION`             |

### Package alignment policy

- `CONTRACT_VERSION` and the npm package version are intentionally independent version tracks.
- A contract bump requires a `CONTRACT_CHANGELOG.md` entry before merge, but it does not require the checked-in `package.json` version to change immediately.
- Package version bumps are produced by Changesets and the publish workflow when a release is cut.
- Consumers pin the package version from npm, not `CONTRACT_VERSION`.
- See `VERSIONING.md` for the full package-versus-contract versioning policy.

## Enforcement

- `contract-version.test.ts` guards runtime export surface.
- `pnpm typecheck` guards type compatibility.
- Every contract change must add an entry in this file before merge.

---

## [3.18.0] - 2026-04-24

### Added (Issue #1360)

- `WorkspaceStartOptions.testIntelligence?: { enabled: boolean }` — opt-in startup feature gate for Figma-to-QC test case generation.
- `WorkspaceJobInput.jobType?: WorkspaceJobType` with values `"figma_to_code"` (default) and `"figma_to_qc_test_cases"`.
- `WorkspaceJobInput.testIntelligenceMode?: WorkspaceTestIntelligenceMode` — separate mode namespace with values `"deterministic_llm" | "offline_eval" | "dry_run"`, isolated from `llmCodegenMode`.
- `ALLOWED_WORKSPACE_JOB_TYPES` and `ALLOWED_TEST_INTELLIGENCE_MODES` runtime-exported `readonly` arrays, consumed by `src/schemas.ts` to keep the submit parser allowlist in lockstep with the exported types.
- `TEST_INTELLIGENCE_CONTRACT_VERSION`, `GENERATED_TEST_CASE_SCHEMA_VERSION`, `TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION` constants — version stamps for the opt-in surface.
- `TEST_INTELLIGENCE_ENV` constant naming the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` environment gate.
- `FEATURE_DISABLED` error code. `POST /workspace/submit` with `jobType="figma_to_qc_test_cases"` returns `503 FEATURE_DISABLED` when the startup option or environment gate is not enabled and performs no side effects.

### Unchanged (Issue #1360)

- `llmCodegenMode=deterministic` mode-lock validation is unchanged and isolated from the test-intelligence namespace.
- All existing `figma_to_code` submission behavior (including mode-lock, schema validation, and engine submission) is preserved.

### Planned (not in this wave)

- Optional subpath export `workspace-dev/test-intelligence` for the full test-intelligence surface. The current wave exposes the contract surface from the root entry point only.

---

## [3.17.0] - 2026-04-18

### Changed (Issue #638)

- Added `GET /readyz` as a readiness probe. It returns `200` only when the server is fully ready and `503` during startup and graceful shutdown drain.
- Changed `GET /healthz` to return a lifecycle-aware JSON payload `{ status, uptime }` instead of the legacy static shape.
- Added optional `WorkspaceStartOptions.shutdownTimeoutMs` to control graceful shutdown drain timing.

## [3.16.0] - 2026-04-18

### Changed (Issue #1104)

- `WorkspaceJobInput.figmaSourceMode` is now typed as `WorkspaceFigmaSourceMode` (previously loosely `string`).
- `WorkspaceJobInput.llmCodegenMode` is now typed as `WorkspaceLlmCodegenMode` (previously loosely `string`).
- Removed `WorkspaceJobInput.requestSourceMode`. The submit-origin marker was internal metadata; it never belonged on the public submit surface and is now set server-side during ingress normalization. `WorkspaceJobRequestMetadata.requestSourceMode` is unchanged and continues to be persisted for replayable import sessions.

### Added (Issue #1104)

- `ALLOWED_FIGMA_SOURCE_MODES` — runtime-exported `readonly` source-of-truth array for `WorkspaceFigmaSourceMode`. Consumed by `src/schemas.ts` so the submit parser allowlist cannot drift from the exported type.
- `ALLOWED_LLM_CODEGEN_MODES` — runtime-exported `readonly` source-of-truth array for `WorkspaceLlmCodegenMode`. Consumed by `src/schemas.ts` for the same reason.

---

## [3.15.0] - 2026-04-16

### Added

- `WorkspaceStartOptions.importSessionEventBearerToken?: string` to configure authenticated writes for `POST /workspace/import-sessions/:id/events`.

### Changed

- `POST /workspace/import-sessions/:id/events` is bearer-only and now requires `Authorization: Bearer <token>` matching the configured import-session event token.
- Unauthenticated or invalidly authenticated import-session event writes now return `401` without reading the request body or mutating persisted session state.
- When no import-session event bearer token is configured, `POST /workspace/import-sessions/:id/events` fails closed with `503`.
- Local sync apply and create-PR requests accept optional `reviewerNote` fields so review context can travel with trusted mutation requests; successful local sync writes persist that note on the trusted `applied` event, and successful create-PR writes fold it into the persisted server-authored import-session `note` event.

---

## [3.14.0] - 2026-04-15

### Import session governance scaffolding (Issue #994)

Added (additive only — no `CONTRACT_VERSION` bump beyond the prior `3.14.0`):

- `WorkspaceImportSessionStatus` union (`imported` | `reviewing` | `approved` | `applied` | `rejected`) for the review lifecycle of a persisted import session.
- `WorkspaceImportSessionEventKind` union (`imported` | `review_started` | `approved` | `applied` | `rejected` | `apply_blocked` | `note`) for the audit event taxonomy.
- `WorkspaceImportSessionEvent` carrying `id`, `sessionId`, `kind`, `at`, optional `actor`, optional `note`, and optional JSON-safe `metadata` map.
- `WorkspaceImportSessionEventsResponse` returning an ordered `events` list.
- `WorkspaceImportSession.qualityScore?: number` (integer 0–100) for the persisted Pre-flight Quality Score.
- `WorkspaceImportSession.status?: WorkspaceImportSessionStatus` for the persisted review state.
- `WorkspaceImportSession.reviewRequired?: boolean` for the governance-policy-driven review gate at save time.

Backwards compatibility: legacy `import-sessions.json` envelopes without the new fields continue to round-trip unchanged.

### Audit-trail endpoints (Issue #994)

Added (additive only):

- `GET  /workspace/import-sessions/:id/events` returns `WorkspaceImportSessionEventsResponse` with the ordered audit trail. Responds `404` when the session does not exist.
- `POST /workspace/import-sessions/:id/events` appends one event. Accepts `{ id?, kind, note?, metadata? }`; the server fills `id` when omitted and always stamps `at`. Responds `201` on success, `404` when the session does not exist, `422` on malformed bodies (missing `kind`, unknown `kind`, or nested `metadata`), `405` on other verbs.

Events are persisted under `<outputRoot>/import-session-events/<sessionId>.json`, append-only, rotated at 200 entries, with `note` truncated at 1024 characters. Deleting a session via `DELETE /workspace/import-sessions/:id` also purges the corresponding event file.

---

## [3.13.0] - 2026-04-14

### Added

- `WorkspaceJobRequestMetadata.importMode` so polling surfaces the requested paste delta mode.
- `WorkspaceJobStatus.pasteDeltaSummary` and `WorkspaceJobResult.pasteDeltaSummary` so final job polling reflects the authoritative delta/full execution outcome instead of only the submit-accepted response.

### Changed

- `WorkspaceJobLineage.kind` now also allows `"delta"` for submission jobs that safely reused a prior compatible paste import.
- `CONTRACT_VERSION` from `3.12.0` to `3.13.0`.

## [3.12.0] - 2026-04-14

### Incremental delta import scaffolding (Issue #992)

Added:

- `WorkspacePasteDeltaStrategy` union (`baseline_created` | `no_changes` | `delta` | `structural_break`) classifying the tree diff between a prior paste and the current one.
- `WorkspaceImportMode` union (`full` | `delta` | `auto`) for selecting the paste regeneration strategy.
- `WorkspacePasteDeltaSummary` surfacing `mode`, `strategy`, `totalNodes`, `nodesReused`, `nodesReprocessed`, `structuralChangeRatio`, `pasteIdentityKey`, `priorManifestMissing`.
- `WorkspaceJobInput.importMode?: WorkspaceImportMode` for submit-time mode selection.
- `WorkspaceSubmitAccepted.pasteDeltaSummary?: WorkspacePasteDeltaSummary` returned on accepted Figma paste submissions when diff compute succeeds.

Changed:

- `CONTRACT_VERSION` from `3.11.1` to `3.12.0`.

---

## [3.11.1] - 2026-04-13

### Plugin ingress contract alignment

Changed:

- Inspector bootstrap submissions now emit `figmaSourceMode="figma_plugin"` for confirmed plugin-envelope imports instead of collapsing them into `figma_paste`.
- `WorkspaceStatus` schema and public mode documentation now recognize `figma_paste` and `figma_plugin` consistently alongside `rest`, `hybrid`, and `local_json`.
- `figma_plugin` unknown-envelope validation now surfaces `UNSUPPORTED_FORMAT`, while the clipboard-first `figma_paste` path keeps `UNSUPPORTED_CLIPBOARD_KIND` for legacy envelope-version handling.
- Submit acceptance audit logs now expose issue-aligned telemetry aliases `payload_size`, `node_count`, and `runtime_ms` in addition to the existing ingress tracing fields.
- `CONTRACT_VERSION` from `3.11.0` to `3.11.1`.

---

## [3.11.0] - 2026-04-12

### Inspector-initiated Figma paste import

Added:

- `WorkspaceFigmaSourceMode` union member `"figma_paste"` for inline Figma `JSON_REST_V1` payload submission.
- `WorkspaceJobInput.figmaJsonPayload?: string` carrying the inline payload when `figmaSourceMode === "figma_paste"`.
- Submit-time validation surfacing `INVALID_PAYLOAD` / `TOO_LARGE` / `SCHEMA_MISMATCH` error codes for malformed, oversize, or structurally incompatible `figma_paste` payloads before they queue.
- `WORKSPACE_FIGMA_PASTE_MAX_BYTES` env knob (default 6 MiB) for the per-payload cap, still bounded by the submit transport budget.
- `MAX_SUBMIT_BODY_BYTES` constant (8 MiB) scoping the larger body limit to `/workspace/submit`.

Changed:

- `CONTRACT_VERSION` from `3.10.0` to `3.11.0`.

---

## [3.10.0] - 2026-04-09

- Added `WorkspaceConfidenceLevel`, `WorkspaceConfidenceContributor`, `WorkspaceComponentConfidence`, `WorkspaceScreenConfidence`, `WorkspaceJobConfidence` types.
- Added optional `confidence` field to `WorkspaceJobStatus` and `WorkspaceJobResult`.
- Added `confidenceReportFile` to `WorkspaceJobArtifacts`.

## [3.9.0] - 2026-04-09

### Visual quality validation contract

Added:

- `WorkspaceVisualQualityReferenceMode` for selecting `figma_api` or `frozen_fixture` visual references.
- `WorkspaceJobInput.enableVisualQualityValidation?: boolean` for first-class visual quality opt-in.
- `WorkspaceJobInput.visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode` for submit-time reference source selection.
- `WorkspaceJobInput.visualQualityViewportWidth?: number` for submit-time viewport width overrides.
- Matching `WorkspaceJobRequestMetadata` fields so public job metadata preserves the visual quality request contract.
- `WorkspaceVisualReferenceFixtureMetadata` for persisted frozen visual reference metadata.
- `WorkspaceVisualQualityReport.status`, `referenceSource`, and `capturedAt` for the issue-defined visual quality envelope.
- `WorkspaceVisualQualityReport.message?: string` for non-blocking visual quality failure details.

Changed:

- `WorkspaceVisualQualityReport` now represents an envelope that can report `completed`, `failed`, or `not_requested`.
- `WorkspaceJobInput.visualAudit` remains supported as a deprecated compatibility alias for legacy visual-audit callers.
- `CONTRACT_VERSION` from `3.8.0` to `3.9.0`.

---

## [3.8.0] - 2026-04-09

### Per-job visual quality report integration

Added:

- `WorkspaceJobStatus.visualQuality?: WorkspaceVisualQualityReport` for inline visual quality scores on job polling payloads.
- `WorkspaceJobResult.visualQuality?: WorkspaceVisualQualityReport` for the same on terminal job result payloads.
- `WorkspaceJobArtifacts.visualQualityReportFile?: string` for the visual quality report artifact path.

Changed:

- `CONTRACT_VERSION` from `3.7.0` to `3.8.0`.

---

## [3.7.0] - 2026-04-09

### Visual quality report hardening and metadata completion

Added:

- `WorkspaceVisualQualityReport.diffImagePath` for the persisted visual diff overlay path.
- `WorkspaceVisualComparisonMetadata.viewport` for the capture viewport used during comparison.
- `WorkspaceVisualComparisonMetadata.versions` for the package and contract versions that produced the report.

Changed:

- `CONTRACT_VERSION` from `3.6.0` to `3.7.0`.

---

## [3.6.0] - 2026-04-09

### Visual quality scoring surface

Added:

- `WorkspaceVisualScoringWeights` for configurable scoring dimension weights.
- `WorkspaceVisualDimensionScore` for per-dimension quality scores.
- `WorkspaceVisualDeviationHotspot` for deviation hotspot detection results.
- `WorkspaceVisualComparisonMetadata` for comparison run metadata.
- `WorkspaceVisualQualityReport` for the full visual quality scoring report.

Runtime:

- `DEFAULT_SCORING_WEIGHTS` — default scoring weights (layout 30%, color 25%, typography 20%, component 15%, spacing 10%).
- `DEFAULT_SCORING_CONFIG` — default scoring configuration with weights and hotspot count.
- `computeVisualQualityReport` — produces a structured visual quality report from diff results.
- `interpretScore` — maps a 0–100 score to a human-readable interpretation string.

Changed:

- `CONTRACT_VERSION` from `3.5.0` to `3.6.0`.

---

## [3.5.0] - 2026-04-08

### Public visual audit surface

Added:

- `WorkspaceVisualCaptureConfig` for optional screenshot-capture overrides.
- `WorkspaceVisualDiffConfig` for optional pixel-diff tuning.
- `WorkspaceVisualDiffRegion` for named comparison regions.
- `WorkspaceVisualAuditRegionResult` for region-level visual audit results.
- `WorkspaceVisualAuditStatus` for the runtime state of the optional visual audit flow.
- `WorkspaceVisualAuditInput` as the opt-in submit-time visual audit payload.
- `WorkspaceVisualAuditResult` for the public visual audit outcome exposed on job status/result payloads.
- `WorkspaceJobInput.visualAudit?: WorkspaceVisualAuditInput` for opt-in visual auditing at submit time.
- `WorkspaceJobRequestMetadata.visualAudit?: WorkspaceVisualAuditInput` so public job metadata retains the submitted visual audit settings.
- `WorkspaceJobArtifacts.visualAuditReferenceImageFile?: string` for the copied reference image artifact path.
- `WorkspaceJobArtifacts.visualAuditActualImageFile?: string` for the captured screenshot artifact path.
- `WorkspaceJobArtifacts.visualAuditDiffImageFile?: string` for the generated diff image artifact path.
- `WorkspaceJobArtifacts.visualAuditReportFile?: string` for the structured visual audit report artifact path.
- `WorkspaceJobStatus.visualAudit?: WorkspaceVisualAuditResult` for the public visual audit outcome on job polling payloads.
- `WorkspaceJobResult.visualAudit?: WorkspaceVisualAuditResult` for the same outcome on terminal job result payloads.

Changed:

- `CONTRACT_VERSION` from `3.4.0` to `3.5.0`.

---

## [3.4.0] - 2026-04-02

### Public component mapping override rules

Added:

- `WorkspaceComponentMappingSource` for explicit manual-override rule provenance.
- `WorkspaceComponentMappingRule` as the public component mapping override rule contract shared by submit and regeneration flows.
- `WorkspaceJobInput.componentMappings?: WorkspaceComponentMappingRule[]` for submit-time exact or pattern-based component mapping overrides.
- `WorkspaceJobRequestMetadata.componentMappings?: WorkspaceComponentMappingRule[]` so persisted public job metadata retains submitted component mapping rules.
- `WorkspaceRegenerationInput.componentMappings?: WorkspaceComponentMappingRule[]` so regeneration jobs can replace inherited component mapping overrides.

Changed:

- `CONTRACT_VERSION` from `3.3.0` to `3.4.0`.

---

## [3.3.0] - 2026-03-31

### Storybook-first submit metadata and artifact paths

Added:

- `WorkspaceJobInput.storybookStaticDir?: string` for supplying an optional local Storybook static build directory during submission.
- `WorkspaceJobRequestMetadata.storybookStaticDir?: string` so public job metadata preserves the submitted Storybook static directory without exposing secrets.
- `WorkspaceJobArtifacts.storybookTokensFile?: string` for the curated `storybook.tokens` artifact path.
- `WorkspaceJobArtifacts.storybookThemesFile?: string` for the curated `storybook.themes` artifact path.
- `WorkspaceJobArtifacts.storybookComponentsFile?: string` for the curated `storybook.components` artifact path.
- `WorkspaceJobArtifacts.figmaLibraryResolutionFile?: string` for the public `figma.library_resolution` artifact path when present.
- `WorkspaceJobArtifacts.componentMatchReportFile?: string` for the public `component.match_report` artifact path when present.
- `WorkspaceJobArtifacts.validationSummaryFile?: string` for the structured `validation-summary.json` artifact path produced by `validate.project`.

Changed:

- Submit-time `storybookStaticDir` values are trimmed before they enter persisted request metadata.

---

## [3.2.0] - 2026-03-31

### Public figma.analysis artifact

Added:

- `WorkspaceJobArtifacts.figmaAnalysisFile?: string` for the curated `figma.analysis` artifact path produced by `ir.derive`.
- `GET /workspace/jobs/{jobId}/figma-analysis` to fetch the public `figma.analysis` artifact for completed jobs.

---

## [3.1.0] - 2026-03-31

### Customer profile submit metadata

Added:

- `WorkspaceJobInput.customerProfilePath?: string` for supplying an optional customer profile file path during submission.
- `WorkspaceJobRequestMetadata.customerProfilePath?: string` so public job metadata preserves the submitted customer profile path without exposing secrets.

Changed:

- Submit-time `customerProfilePath` values are trimmed before they enter persisted request metadata.

---

## [3.0.0] - 2026-03-29

### Submit schema validation for codegen mode and generation locale

Changed:

- `POST /workspace/submit` now rejects unsupported `llmCodegenMode` values at the submit schema boundary with `VALIDATION_ERROR` instead of deferring malformed values to downstream mode-lock handling.
- `POST /workspace/submit` now rejects invalid or unsupported `generationLocale` values at the submit schema boundary with `VALIDATION_ERROR` instead of silently falling back at request ingestion time.
- Accepted submit-time locale overrides are canonicalized before they enter the job engine request payload.

---

## [2.29.0] - 2026-03-29

### Command output cap runtime controls

Added:

- `WorkspaceStartOptions.commandStdoutMaxBytes?: number` (default `1048576`) to configure the retained stdout byte budget per pnpm/git command before deterministic truncation and artifact spooling.
- `WorkspaceStartOptions.commandStderrMaxBytes?: number` (default `1048576`) to configure the retained stderr byte budget per pnpm/git command before deterministic truncation and artifact spooling.

---

## [2.28.0] - 2026-03-27

### Configurable pipeline diagnostic limits

Added:

- `WorkspaceStartOptions.pipelineDiagnosticMaxCount?: number` (default `25`) to configure how many structured diagnostics are retained per pipeline error.
- `WorkspaceStartOptions.pipelineDiagnosticTextMaxLength?: number` (default `320`) to configure the maximum message and suggestion length retained per structured diagnostic.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxKeys?: number` (default `30`) to configure how many keys are retained per structured diagnostic details object.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxItems?: number` (default `20`) to configure how many items are retained per structured diagnostic details array.
- `WorkspaceStartOptions.pipelineDiagnosticDetailsMaxDepth?: number` (default `4`) to configure how deeply structured diagnostic details are traversed before deterministic truncation.

---

## [2.27.0] - 2026-03-27

### Configurable structured runtime logging

Added:

- `WorkspaceLogFormat = "text" | "json"` for selecting human-readable or newline-delimited JSON operational logs.
- `WorkspaceStartOptions.logFormat?: WorkspaceLogFormat` (default `text`) to configure runtime log emission for CLI and programmatic server starts.

---

## [2.26.0] - 2026-03-27

### Configurable Figma REST circuit breaker

Added:

- `WorkspaceStartOptions.figmaCircuitBreakerFailureThreshold?: number` (default `3`) to configure how many consecutive transient Figma REST failures open the in-memory circuit breaker.
- `WorkspaceStartOptions.figmaCircuitBreakerResetTimeoutMs?: number` (default `30000`) to configure how long the breaker remains open before allowing a half-open probe request.

---

## [2.25.0] - 2026-03-26

### Per-IP submission rate limiting

Added:

- `WorkspaceStartOptions.rateLimitPerMinute?: number` (default `10`, `0` disables) for per-client job submission throttling across `POST /workspace/submit` and `POST /workspace/jobs/{jobId}/regenerate`.

---

## [2.24.0] - 2026-03-24

### Selectable hybrid Figma source mode

Added:

- `WorkspaceFigmaSourceMode = "rest" | "hybrid" | "local_json"` so clients can explicitly request hybrid REST + MCP-enrichment derivation in addition to pure REST and local JSON modes.

---

## [2.23.0] - 2026-03-23

### Guided remap suggestions for stale draft recovery

Added:

- `WorkspaceStaleDraftDecisionExtended = WorkspaceStaleDraftDecision | "remap"` for stale-draft flows that branch into guided remapping instead of only continue/discard/carry-forward.
- `WorkspaceRemapConfidence`, `WorkspaceRemapRule`, `WorkspaceRemapSuggestion`, `WorkspaceRemapRejection`, `WorkspaceRemapSuggestInput`, `WorkspaceRemapSuggestResult`, and `WorkspaceRemapDecisionEntry` for typed remap-suggestion request/response handling.
- `POST /workspace/jobs/{jobId}/remap-suggest` to generate deterministic remap suggestions between a stale source job and a newer completed job.

---

## [2.22.0] - 2026-03-23

### Advanced validation rule DSL and cross-field editor

Added:

- `validationMin`, `validationMax`, `validationMinLength`, `validationMaxLength`, `validationPattern` — Five new optional override fields for `WorkspaceRegenerationOverrideEntry` enabling advanced per-field validation rules (min/max numeric bounds, string length constraints, regex pattern matching).
- `ValidationRule` / `ValidationRuleType` — New types in `generator-forms.ts` defining the advanced validation rule DSL.
- `validationRules` — New optional field on `InteractiveFieldModel` carrying an array of `ValidationRule` entries.

---

## [2.21.0] - 2026-03-22

### Stale draft detection and carry-forward

Added:

- `WorkspaceStaleDraftDecision` — User decision type for handling a stale draft (`"continue" | "discard" | "carry-forward"`).
- `WorkspaceStaleDraftCheckResult` — Result of a stale-draft check for a given job.
- `POST /workspace/jobs/{jobId}/stale-check` — Endpoint to check whether a draft's source job has been superseded by a newer completed job for the same board key, with carry-forward validation.

---

## [2.20.0] - 2026-03-22

### PR creation from regenerated jobs

Added:

- `WorkspaceCreatePrInput` — Input payload for creating a PR from a completed regeneration job.
- `WorkspaceCreatePrResult` — Result payload returned after PR creation.
- `WorkspaceGitPrPrerequisites` — Prerequisites check result for PR creation.
- `POST /workspace/jobs/{jobId}/create-pr` — Endpoint to create a GitHub PR from regenerated output.

---

## [2.19.0] - 2026-03-22

### Regenerated local sync dry-run/apply contract

Added:

- `WorkspaceLocalSyncMode = "dry_run" | "apply"`
- `WorkspaceLocalSyncDryRunRequest`
- `WorkspaceLocalSyncApplyRequest`
- `WorkspaceLocalSyncRequest`
- `WorkspaceLocalSyncFilePlanEntry`
- `WorkspaceLocalSyncSummary`
- `WorkspaceLocalSyncDryRunResult`
- `WorkspaceLocalSyncApplyResult`

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
