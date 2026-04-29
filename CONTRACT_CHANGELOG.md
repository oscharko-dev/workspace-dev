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

## [4.22.0] - 2026-04-29

### Changed (Issue #1553)

Pipeline compatibility guards now fail closed when Rocket-specific inputs are
submitted to the OSS `default` pipeline or when regeneration attempts to change
pipeline identity. The combined `default,rocket` profile still preserves the
legacy omitted-`pipelineId` Rocket auto-selection path, but explicit
`pipelineId: "default"` plus customer profile, brand, or component mapping
inputs is rejected with a structured pipeline request error.

**Validation behavior:**

- `WorkspacePipelineRequestErrorCode` adds `PIPELINE_INPUT_UNSUPPORTED`.
- Submit and regeneration pipeline compatibility failures return structured
  `400` responses with top-level `error`, `message`, `pipelineId`, and
  `issues: [{ path: "pipelineId", message }]` fields.
- `WorkspaceRegenerationInput.pipelineId` is accepted only as a compatibility
  assertion. It must match the completed source job pipeline; cross-pipeline
  regeneration is rejected until an explicit migration path exists.

---

## [4.21.0] - 2026-04-28

### Changed (Issue #1539)

Contract-version evidence now reflects the completed pipeline selection and
runtime-metadata public contract slice from Issues #1537 and #1538. This bump
updates the canonical `CONTRACT_VERSION`, compatibility matrix, committed API
reference, and contract-version process checks without changing the canonical
stage order or introducing additional runtime behavior.

**Evidence updated:**

- `CONTRACT_VERSION` — bumped from `4.20.0` to `4.21.0`.
- `COMPATIBILITY.md` — current contract matrix updated to `4.21.0`.
- `docs/api` — regenerated committed API reference for the updated runtime
  constant.
- `src/contract-version.test.ts` and `src/docs-alignment.test.ts` — existing
  gates continue to require a changelog heading for the current runtime
  contract and a compatibility-matrix entry matching `CONTRACT_VERSION`.

## [4.20.0] - 2026-04-28

### Added (Issue #1538)

Pipeline runtime metadata now follows the selected pipeline through execution
contexts, persisted job records, terminal snapshots, public projections,
regeneration lineage, and retry lineage. This is additive for wire consumers and
keeps the canonical stage order unchanged.

**New types:**

- `WorkspaceJobPipelineMetadata` — selected pipeline id, display name, template
  bundle id, active build profile, and deterministic execution guarantee.

**Extended types (additive fields only):**

- `WorkspaceSubmitAccepted.pipelineMetadata`
- `WorkspaceJobRequestMetadata.pipelineMetadata`
- `WorkspaceJobStatus.pipelineMetadata`
- `WorkspaceJobResult.pipelineMetadata`
- `WorkspaceJobInspector.pipelineMetadata`
- `WorkspaceRegenerationAccepted.pipelineMetadata`
- `WorkspaceRetryAccepted.pipelineMetadata`
- `WorkspaceJobLineage.pipelineMetadata`

Legacy terminal snapshots that predate this field continue to rehydrate with the
existing `rocket` compatibility pipeline metadata.

## [4.19.0] - 2026-04-28

### Added (Issue #1537)

Pipeline identity projection across public job lifecycle contracts. Additive for
wire consumers; accepted submissions already returned the selected pipeline, and
this release extends the same audit field to polling, result, Inspector,
regeneration, and retry payloads.

**Extended types (additive fields only):**

- `WorkspaceJobStatus.pipelineId` — selected pipeline surfaced at the top level
  of job polling payloads.
- `WorkspaceJobResult.pipelineId` — selected pipeline surfaced on compact
  terminal result payloads.
- `WorkspaceJobInspector.pipelineId` — selected pipeline surfaced on
  Inspector-facing recovery metadata.
- `WorkspaceRegenerationAccepted.pipelineId` — inherited source-job pipeline
  echoed on regeneration acceptance.
- `WorkspaceRetryAccepted.pipelineId` — inherited source-job pipeline echoed on
  retry acceptance.

**Validation behavior:**

- Submit-time pipeline selection errors now include a structured
  `issues: [{ path: "pipelineId", message }]` array while preserving their
  existing top-level pipeline error codes.

---

## [4.18.0] - 2026-04-28

### Added (Issue #1535)

Pipeline descriptor manifest metadata for conformance and runtime inspection.
The runtime now includes additive pipeline descriptor fields that identify the
registered pipeline visibility, deterministic execution guarantee, and template
bundle stack.

**New types:**

- `WorkspacePipelineVisibility` — pipeline visibility class: `oss`,
  `customer`, or `internal`.
- `WorkspacePipelineStackDescriptor` — public framework, language, styling, and
  bundler identity for a pipeline template.
- `WorkspacePipelineTemplateMetadata` — public template bundle id, path, and
  stack identity for a pipeline.

**Extended types (additive fields only):**

- `WorkspacePipelineDescriptor.visibility`
- `WorkspacePipelineDescriptor.deterministic`
- `WorkspacePipelineDescriptor.template`

---

## [4.17.0] - 2026-04-28

### Added (Issue #1534)

Pipeline registry foundation for deterministic pipeline selection. Purely
additive for existing callers; submissions without `pipelineId` continue to use
the single available compatibility pipeline in the current build profile.

**New constants:**

- `ALLOWED_PIPELINE_REQUEST_ERROR_CODES` — four structured submit-time pipeline
  request error codes.

**New types:**

- `WorkspacePipelineId` — pipeline identifier string.
- `WorkspacePipelineScope` — resolved input scope: `board`, `node`, or
  `selection`.
- `WorkspacePipelineRequestErrorCode` — union of structured pipeline request
  error codes.
- `WorkspacePipelineDescriptor` — runtime descriptor for pipelines included in
  the current package profile.

**Extended types (additive fields only):**

- `WorkspaceJobInput.pipelineId` — optional explicit pipeline selector.
- `WorkspaceStatus.availablePipelines` and `WorkspaceStatus.defaultPipelineId`
  — runtime pipeline availability metadata.
- `WorkspaceSubmitAccepted.pipelineId` — selected pipeline echoed on accepted
  submissions.
- `WorkspaceJobRequestMetadata.pipelineId` — selected pipeline persisted on job
  request metadata.

---

## [4.16.0] - 2026-04-27

### Added (Issue #1482, Wave 5)

Jira write workflow — approved test cases written back to Jira as sub-tasks. Purely additive.

**New constants:**

- `JIRA_WRITE_REPORT_SCHEMA_VERSION` — schema version "1.0.0" for the Jira write report artifact.
- `JIRA_WRITE_REPORT_ARTIFACT_FILENAME` — artifact filename "jira-write-report.json".
- `JIRA_WRITE_REPORT_ARTIFACT_DIRECTORY` — sub-directory "jira-write" under the run dir.
- `JIRA_CREATED_SUBTASKS_SCHEMA_VERSION` — schema version "1.0.0" for the created-subtasks artifact.
- `JIRA_CREATED_SUBTASKS_ARTIFACT_FILENAME` — artifact filename "jira-created-subtasks.json".
- `ALLOWED_JIRA_WRITE_MODE_VALUES` — `["jira_subtasks"]` discriminant array.
- `ALLOWED_JIRA_WRITE_REFUSAL_CODES` — 8 structured refusal codes for the Jira write pipeline.
- `ALLOWED_JIRA_WRITE_ENTITY_OUTCOMES` — 4 per-case outcome strings.
- `ALLOWED_JIRA_WRITE_FAILURE_CLASSES` — 8 failure class strings.

**New types:**

- `JiraWriteMode` — discriminated union of write mode strings.
- `JiraWriteRefusalCode` — union of refusal code strings.
- `JiraWriteEntityOutcome` — union of per-case outcome strings.
- `JiraWriteFailureClass` — union of failure class strings.
- `JiraSubTaskRecord` — per-case sub-task outcome record.
- `JiraCreatedSubtasksArtifact` — artifact type for jira-created-subtasks.json.
- `JiraWriteAuditMetadata` — audit metadata embedded in the write report.
- `JiraWriteReportArtifact` — artifact type for jira-write-report.json.

**Extended types (additive fields only):**

- `WorkspaceStartOptions.testIntelligence` — optional `allowJiraWrite?: boolean` and `jiraWriteBearerToken?: string`.

**TEST_INTELLIGENCE_CONTRACT_VERSION bump:** `1.4.0` → `1.5.0`

## [4.15.0] - 2026-04-27

### Added (Issue #1441, Wave 4.K)

Source-mix orchestration and Jira-only generation path. Purely additive —
all existing consumers are unaffected.

**New constants:**

- `SOURCE_MIX_PLAN_SCHEMA_VERSION` — schema version "1.0.0" for the source-mix plan artifact.
- `SOURCE_MIX_PLAN_ARTIFACT_FILENAME` — artifact filename "source-mix-plan.json".
- `ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS` — 7 supported source-mix kind identifiers.
- `ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES` — 8 structured refusal codes for the source-mix planner.

**New types:**

- `TestIntentSourceMixKind` — discriminated union of 7 source-mix kind strings.
- `SourceMixPlanPromptSection` — role-tagged prompt section emitted by the planner.
- `SourceMixPlanSourceDigest` — hash-only source fingerprint material sealed into emitted source-mix plans.
- `SourceMixPlan` — deterministic plan with `sourceMixPlanHash`, `visualSidecarRequirement`, and hard `false` privacy invariants.
- `SourceMixPlannerRefusalCode` — union of planner refusal code strings.
- `SourceMixPlannerIssue` — structured issue record returned on refusal.
- `SourceMixPlannerResult` — discriminated union `{ ok: true; plan } | { ok: false; issues }`.

**Extended types (additive fields only):**

- `SourceMixPlan` — added optional `sourceDigests` so planner-emitted plans seal source content hashes, canonical Jira issue keys, and redacted Markdown/plain-text derivative hashes into `sourceMixPlanHash` without persisting raw Jira responses, paste bytes, or editor input.
- `ReplayCacheKey` — added optional `sourceMixPlanHash` to match the runtime replay key emitted for multi-source jobs.
- `CompiledPromptArtifacts.payload` — added optional `sourceMixPlan` so persisted prompt artifacts can explain which source-mix path compiled the prompt.

**New `ALLOWED_TEST_INTENT_SOURCE_KINDS` member:** `"custom_markdown"` (intrinsically-Markdown supporting source; requires `redactedMarkdownHash` + `plainTextDerivativeHash`; forbids `inputFormat`).

**New `SUPPORTING_TEST_INTENT_SOURCE_KINDS` member:** `"custom_markdown"`.

**`TEST_INTELLIGENCE_CONTRACT_VERSION` bumped:** `1.3.0` → `1.4.0`.

---

## [4.14.0] - 2026-04-27

### Added (Issue #1439, Wave 4.I)

Multi-source production-readiness fixtures, CI eval gate, FinOps source
quotas, and extended evidence manifest. Purely additive — all existing
consumers are unaffected.

**New constants:**

- `MAX_JIRA_API_REQUESTS_PER_JOB` — hard cap on Jira REST calls per job (20).
- `MAX_JIRA_PASTE_BYTES_PER_JOB` — hard cap on paste ingest size (524 288 B).
- `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB` — hard cap on custom-context size (262 144 B).
- `WAVE4_PRODUCTION_READINESS_EVAL_REPORT_ARTIFACT_FILENAME` — artifact filename for the Wave 4.I CI eval report.
- `WAVE4_PRODUCTION_READINESS_EVAL_REPORT_SCHEMA_VERSION` — schema version "1.0.0" for the eval report.

**New types:**

- `Wave4SourceMixId` — discriminated union of all supported source-mix identifiers.
- `Wave4ProductionReadinessEvalThresholds` — pass/fail threshold configuration for the CI eval gate.
- `Wave4SourceMixCoverageEntry` — per-fixture coverage record within the eval report.
- `MultiSourceSourceProvenanceRecord` — per-source provenance record for the evidence manifest.
- `Wave4ProductionReadinessEvalReport` — top-level eval report artifact type.

**Extended types (additive fields only):**

- `FinOpsBudgetEnvelope` — added `sourceQuotas?` block (`maxJiraApiRequestsPerJob`, `maxJiraPasteBytesPerJob`, `maxCustomContextBytesPerJob`).
- `FinOpsRoleBudget` — added `maxIngestBytesPerJob?: number`.
- `FinOpsRoleUsage` — added `ingestBytes: number`.
- `Wave1PocEvidenceManifest` — added `sourceProvenanceRecords?`, `multiSourceEnabled?`, `rawJiraResponsePersisted?`, `rawPasteBytesPersisted?`.
- `Wave1PocEvidenceArtifactCategory` — added `"jira_issue_ir"`, `"jira_paste_provenance"`, `"custom_context_ir"`, `"multi_source_reconciliation"`.

**New `ALLOWED_FINOPS_ROLES` members:** `"jira_api_requests"`, `"jira_paste_ingest"`, `"custom_context_ingest"`.

**New `ALLOWED_FINOPS_BUDGET_BREACH_REASONS` members:** `"jira_api_request_quota_exceeded"`, `"jira_paste_quota_exceeded"`, `"custom_context_quota_exceeded"`.

**`TEST_INTELLIGENCE_CONTRACT_VERSION` bumped:** `1.2.0` → `1.3.0`.

---

## [4.13.0] - 2026-04-26

### Added (Issue #1432, Wave 4.B)

Jira issue intermediate representation, hand-rolled Atlassian Document
Format (ADF) parser, and Jira-specific PII detection / redaction
extensions. Purely additive — existing single-source Figma jobs and
Wave 4.A multi-source consumers are unchanged.

- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped from `1.1.0` to `1.2.0`.
- New schema constant `JIRA_ISSUE_IR_SCHEMA_VERSION = "1.0.0"`.
- New artifact constants `JIRA_ISSUE_IR_ARTIFACT_DIRECTORY = "sources"` and
  `JIRA_ISSUE_IR_ARTIFACT_FILENAME = "jira-issue-ir.json"`. The Jira IR is
  persisted at `<runDir>/sources/<sourceId>/jira-issue-ir.json` per
  contributing source.
- New byte-cap constants: `MAX_JIRA_ADF_INPUT_BYTES = 1 MiB` (pre-parse
  hard cap on raw ADF JSON), `MAX_JIRA_DESCRIPTION_PLAIN_BYTES = 32 KiB`,
  `MAX_JIRA_COMMENT_BODY_BYTES = 4 KiB`, `MAX_JIRA_CUSTOM_FIELD_VALUE_BYTES = 2 KiB`.
- New count-cap constants: `MAX_JIRA_COMMENT_COUNT = 50`,
  `MAX_JIRA_ATTACHMENT_COUNT = 50`, `MAX_JIRA_LINK_COUNT = 50`,
  `MAX_JIRA_CUSTOM_FIELD_COUNT = 50`.
- New runtime enums:
    - `ALLOWED_JIRA_ISSUE_TYPES` (`story|task|bug|epic|subtask|other`).
    - `ALLOWED_JIRA_ADF_NODE_TYPES` (24 allow-listed ADF node types).
    - `ALLOWED_JIRA_ADF_MARK_TYPES` (8 allow-listed ADF mark types).
    - `ALLOWED_JIRA_ADF_REJECTION_CODES` (11 codes including
      `jira_adf_payload_too_large`, `jira_adf_unknown_node_type`).
    - `ALLOWED_JIRA_IR_REFUSAL_CODES` (19 codes including
      `jira_issue_key_invalid`, `jira_jql_fragment_disallowed_token`,
      `jira_field_unknown_excluded`).
- New types: `JiraIssueIr`, `JiraAcceptanceCriterion`, `JiraComment`,
  `JiraAttachmentRef`, `JiraLinkRef`, `JiraIssueIrCustomField`,
  `JiraFieldSelectionProfile`, `JiraIssueIrDataMinimization`,
  `JiraAdfNodeType`, `JiraAdfMarkType`, `JiraAdfRejectionCode`,
  `JiraIrRefusalCode`, `JiraIssueType`.
- New value-typed `DEFAULT_JIRA_FIELD_SELECTION_PROFILE` — comments,
  attachments, linked issues, and unknown custom fields are excluded by
  default. Inclusion of each opt-in group is recorded in the IR's
  `dataMinimization` audit metadata.
- `PiiKind` extended (additive) with `internal_hostname`, `jira_mention`,
  `customer_name_placeholder`. `PiiMatchLocation` extended with
  Jira-specific locations (`jira_summary`, `jira_description`,
  `jira_acceptance_criterion`, `jira_comment_body`,
  `jira_custom_field_name`, `jira_custom_field_value`,
  `jira_attachment_filename`, `jira_link_relationship`, `jira_label`,
  `jira_component`).
- New module `src/test-intelligence/jira-adf-parser.ts` —
  `parseJiraAdfDocument` (pure, fail-closed, allow-list-only). Strips
  `mention` / `inlineCard` / `media` / `mediaSingle` / `mediaGroup` to
  text-only stubs (`@user`, `[link]`, `[attachment:filename.ext]`).
  Bounds traversal depth (32) and node count (5_000). Byte-stable across
  runs.
- New module `src/test-intelligence/jira-issue-ir.ts` — `buildJiraIssueIr`
  (pure builder), `writeJiraIssueIr` (atomic temp-rename persistence),
  `isValidJiraIssueKey`, `sanitizeJqlFragment` (rejects `;`, backticks,
  `--`, control characters, `OR 1=1` / `AND 1=1` hijack patterns,
  oversize keys).
- New PII-detection helpers: `detectCustomerNameInLabelledField`,
  `isCustomerNameShapedFieldName`. The Jira-specific detectors fire on
  internal-hostname-like strings (`*.intranet.*`, `*.corp.*`,
  `*.internal`, `*.local`, `*.lan`, `*.atlassian.net`, `*.jira.com`),
  Confluence/Jira `[~accountid:...]` markup + bare account ids, and
  customer-name-shaped placeholders inside well-known customer-name Jira
  custom-field labels.
- Zero new runtime dependencies. No telemetry. No fetch. The parser and
  the IR builder are both pure value-object code.

## [4.12.0] - 2026-04-26

### Added (Issue #1431, Wave 4.A)

Wave 4 multi-source Test Intent ingestion contracts, feature gate, and
mode-lock isolation. Purely additive — single-source Figma jobs that have
not opted into the multi-source gate keep producing bit-identical artifacts
and replay-cache hits.

- New env var `TEST_INTELLIGENCE_MULTISOURCE_ENV` (literal
  `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE`) gating Wave 4
  multi-source ingestion. Strictly nested behind `TEST_INTELLIGENCE_ENV`:
  the gate fails closed unless _both_ env vars and the parent
  `WorkspaceStartOptions.testIntelligence.enabled` startup option are set.
- New optional startup option
  `WorkspaceStartOptions.testIntelligence.multiSourceEnabled?: boolean`
  (default `false`). Provides operator runtime toggle without redeploys.
- New optional status field
  `WorkspaceStatus.testIntelligenceMultiSourceEnabled?: boolean`. True only
  when all three nested gates are satisfied.
- `TEST_INTELLIGENCE_CONTRACT_VERSION` bumped `1.0.0` → `1.1.0`.
- New schema-version constant
  `MULTI_SOURCE_TEST_INTENT_ENVELOPE_SCHEMA_VERSION = "1.0.0"`.
- New runtime enums:
    - `ALLOWED_TEST_INTENT_SOURCE_KINDS` — `figma_local_json`,
      `figma_plugin`, `figma_rest`, `jira_rest`, `jira_paste`, `custom_text`,
      `custom_structured`. Type alias `TestIntentSourceKind`.
    - `PRIMARY_TEST_INTENT_SOURCE_KINDS` — the five kinds (Figma trio plus
      `jira_rest`, `jira_paste`) at least one of which must be present in
      every envelope. Type alias `PrimaryTestIntentSourceKind`.
    - `SUPPORTING_TEST_INTENT_SOURCE_KINDS` — `custom_text`,
      `custom_structured`. Type alias `SupportingTestIntentSourceKind`.
    - `ALLOWED_CONFLICT_RESOLUTION_POLICIES` — `priority`,
      `reviewer_decides`, `keep_both`. Type alias `ConflictResolutionPolicy`.
    - `ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS` — `plain_text`, `markdown`,
      `structured_json`. Type alias `TestIntentCustomInputFormat`.
    - `ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES` — 26 stable refusal
      codes covering envelope shape, source-mix, conflict policy, priority
      order, Markdown hash, Jira issue-key, source-mix-plan, and
      aggregate-hash mismatch checks.
    - `ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES` — four stable refusal
      codes for the runtime mode gate (parent gate, env, startup option,
      `llmCodegenMode` lock).
- New types:
    - `TestIntentSourceRef` (`sourceId`, `kind`, `contentHash`, `capturedAt`,
      optional `authorHandle`, `inputFormat`, `noteEntryId`,
      `markdownSectionPath`, `canonicalIssueKey`, `redactedMarkdownHash`,
      `plainTextDerivativeHash`).
    - `MultiSourceTestIntentEnvelope` (`version`, `sources`,
      `aggregateContentHash`, `conflictResolutionPolicy`, optional
      `priorityOrder`, `sourceMixPlan`).
    - `MultiSourceTestIntentSourceMixPlanRef` (`ownerIssue`, `planHash`) as the
      #1441-owned source-mix orchestration hook.
    - `MultiSourceEnvelopeIssue`, `MultiSourceEnvelopeRefusalCode`,
      `MultiSourceEnvelopeValidationResult`.
    - `MultiSourceModeGateInput`, `MultiSourceModeGateRefusal`,
      `MultiSourceModeGateRefusalCode`, `MultiSourceModeGateDecision`.
- New optional `BusinessTestIntentIr.sourceEnvelope?: MultiSourceTestIntentEnvelope`.
  Legacy `source: BusinessTestIntentIrSource`
  is preserved for one minor cycle.
- Per-element provenance types extended additively with
  `sourceRefs?: TestIntentSourceRef[]` on `IntentTraceRef`, `DetectedField`,
  `DetectedAction`, `DetectedValidation`, `DetectedNavigation`, and
  `InferredBusinessObject`. Existing single-source fields (`trace`,
  `provenance`) keep working unchanged for legacy single-source jobs.
- New module `src/test-intelligence/multi-source-envelope.ts` with
  hand-rolled validators (zero new runtime deps). Public exports:
  `buildMultiSourceTestIntentEnvelope`, `computeAggregateContentHash`,
  `validateMultiSourceTestIntentEnvelope`, `evaluateMultiSourceModeGate`,
  `enforceMultiSourceModeGate`, `MultiSourceModeGateError`,
  `legacySourceFromMultiSourceEnvelope`,
  `resolveTestIntelligenceMultiSourceEnvEnabled`,
  `canonicalizeMultiSourceEnvelope`, `isPrimaryTestIntentSourceKind`,
  `isSupportingTestIntentSourceKind`, `isMultiSourceEnvelopeRefusalCode`,
  `isMultiSourceModeGateRefusalCode`.
- New env-var resolver `resolveTestIntelligenceMultiSourceEnvEnabled` in
  `src/server/constants.ts` mirroring the existing test-intelligence
  resolver.

### Source-mix contract hardening (2026-04-26 addendum)

The validator enforces the customer-facing source matrix explicitly:

- At least one primary source per envelope. A custom-only envelope is
  rejected with `primary_source_required` before any artifact is persisted.
- Figma is optional. Jira-REST-only and Jira-paste-only envelopes are valid
  when the multi-source gate is enabled.
- Jira REST and Jira paste may both appear in one envelope; duplicate
  canonical issue keys route through `duplicate_jira_paste_collision` rather than
  silently deduplicating.
- Optional `sourceMixPlan` references are shape-validated only; #1441 owns
  orchestration and reconciliation.
- The `priority` policy requires a `priorityOrder` covering exactly the
  kinds present in the envelope (no extras, no duplicates, no missing).

### Markdown-aware custom source contract (2026-04-26 addendum)

`custom_text` / `custom_structured` sources may carry
`inputFormat: "markdown"` and (only then) `markdownSectionPath` /
`noteEntryId` provenance hints. Markdown sources must also carry
`redactedMarkdownHash` and `plainTextDerivativeHash` so downstream prompt
isolation can audit canonical redacted Markdown and the deterministic
plain-text derivative without storing raw Markdown. Markdown is treated as
user-provided supporting evidence and is never trusted as instructions to the
model or runtime — downstream issues are responsible for the prompt-isolation
plumbing.

### Production-ready baseline (2026-04-26 addendum)

This issue ships as production-ready enterprise software for regulated
financial deployment: hand-rolled validators, fail-closed gates, zero
runtime deps, no telemetry, and full byte-stable backward compatibility.

---

## [4.11.0] - 2026-04-26

### Added (Issue #1374)

Wave 3 stabilizes the provider-neutral QC/ALM adapter surface so non-ALM
providers and caller-registered custom adapters plug in without coupling the
core test-intelligence pipeline to OpenText ALM.

- New runtime enum `ALLOWED_QC_PROVIDER_OPERATIONS` with members
  `validate_profile`, `resolve_target_folder`, `dry_run`, `export_only`,
  `api_transfer`, `register_custom`. Type alias `QcProviderOperation`.
  Re-exported from the package root.
- New types `QcProviderCapabilities` (closed product type, six boolean
  flags mirroring `QcProviderOperation`) and `QcProviderDescriptor`
  (`provider`, `label`, `version`, `builtin`, `capabilities`,
  `mappingProfileSeedId?`).
- New refusal-code literal `provider_not_implemented` appended to the end
  of `ALLOWED_DRY_RUN_REFUSAL_CODES`. Existing ordinal positions of prior
  codes are preserved byte-for-byte.
- New optional fields on `DryRunPlannedEntityPayload` exposing normalized
  visual provenance per the 2026-04-24 multimodal addendum:
  `visualConfidence?: number` (mean sidecar confidence, rounded to four
  decimals), `visualAmbiguityFlags?: VisualSidecarValidationOutcome[]`
  (sorted, deduplicated non-`ok` outcomes), `visualFallbackUsed?: boolean`
  (true when a matching record carries `fallback_used`), and
  `visualEvidenceRefs?: { screenId; modelDeployment; evidenceHash }[]`
  (sorted by `screenId`, `modelDeployment`, then `evidenceHash`;
  `evidenceHash` is the canonical
  `(screenId|deployment|sortedOutcomes|roundedConfidence)` SHA-256, never
  a screenshot-byte hash). All four keys are absent — not `undefined` —
  on payloads without sidecar coverage and on stub-adapter output, so
  pre-#1374 byte-stable artifacts remain byte-stable.
- New module `src/test-intelligence/qc-provider-registry.ts` shipping
  `BUILTIN_QC_PROVIDER_DESCRIPTORS` (frozen, sorted by provider id),
  `createQcProviderRegistry`, `registerQcProviderAdapter`,
  `resolveQcProviderAdapter`, `getQcProviderDescriptor`,
  `getQcProviderEntry`, `listQcProviderDescriptors`, plus the structured
  refusal enum `ALLOWED_QC_PROVIDER_REGISTRATION_REFUSAL_CODES` (members:
  `duplicate_provider_id`, `custom_descriptor_required`,
  `unknown_provider_id`, `provider_mismatch_on_adapter`,
  `register_custom_not_supported`).
  Eight builtin descriptors are wired up: `opentext_alm` exposes the full
  matrix and binds the existing `openTextAlmDryRunAdapter`; the six
  non-ALM providers (`opentext_octane`, `opentext_valueedge`, `xray`,
  `testrail`, `azure_devops_test_plans`, `qtest`) advertise
  `validateProfile` + `dryRun` only and bind the dry-run-only stub; the
  reserved `custom` slot publishes every flag `false` until a caller
  registers a concrete adapter and descriptor via
  `registerQcProviderAdapter`. Registry snapshots expose only read
  operations and clone entries on read so caller mutation cannot bypass
  registration checks.
- New module `src/test-intelligence/qc-provider-stub.ts` shipping
  `createDryRunStubAdapter`, `DEFAULT_DRY_RUN_STUB_ID_SOURCE`, and
  `DRY_RUN_STUB_ADAPTER_VERSION = "1.0.0"`. The stub honors the
  `QcAdapter` interface, refuses every dry-run with the new
  `provider_not_implemented` code, throws
  `QcAdapterModeNotImplementedError` for non-`dry_run` modes, performs no
  I/O, and emits a deterministic `reportId` so replay/evidence pipelines
  remain byte-stable.
- Existing `openTextAlmDryRunAdapter` populates the four new visual
  provenance fields on every planned payload whose case has matching
  sidecar records. Cases without matching records continue to emit the
  prior shape unchanged (no extra keys).

### Backward compatibility

- All public exports retain prior names and signatures. New types,
  enum members, and fields are additive only.
- `provider_not_implemented` is appended to the end of
  `ALLOWED_DRY_RUN_REFUSAL_CODES`; pre-#1374 ordinals are stable.
- ALM dry-run reports for cases without sidecar coverage are byte-stable
  with 4.10.0 output; the new visual provenance fields are omitted (not
  set to `undefined`).

## [4.10.0] - 2026-04-26

### Added (Issue #1373 follow-up)

- `TEST_CASE_DELTA_REPORT_ARTIFACT_FILENAME = "test-case-delta-report.json"`
  is now exported from the public contract surface alongside the other Wave 3
  artifact filenames.
- `TraceabilityMatrixRow.steps` records ordered per-step traceability rows.
  Each row carries inherited Figma screen/node metadata, matching QC design-step
  index when available, visual-sidecar observations, and the validation/policy
  outcomes that governed the parent test case.
- The persisted export pipeline now emits `dedupe-report.json` and
  `traceability-matrix.json` for successful export runs so duplicate evidence
  and export-only traceability are produced by the normal workflow, not only by
  manually composing helper functions.
- The controlled OpenText ALM API transfer pipeline accepts optional
  traceability lineage inputs and persists a transfer-aware
  `traceability-matrix.json` beside `transfer-report.json` when those inputs and
  an artifact root are supplied.
- `DedupeExternalProbeState` now includes `partial_failure` for runs where an
  external duplicate probe produced at least one usable lookup but one or more
  case lookups failed. This keeps partial external coverage fail-closed while
  preserving sanitized findings for operator evidence.

## [4.9.0] - 2026-04-26

### Added (Issue #1373)

- New schema constants for the Wave 3 delta + dedupe + traceability surface:
    - `INTENT_DELTA_REPORT_SCHEMA_VERSION = "1.0.0"`,
    - `INTENT_DELTA_REPORT_ARTIFACT_FILENAME = "intent-delta-report.json"`,
    - `TEST_CASE_DELTA_REPORT_SCHEMA_VERSION = "1.0.0"`,
    - `DEDUPE_REPORT_SCHEMA_VERSION = "1.0.0"`,
    - `DEDUPE_REPORT_ARTIFACT_FILENAME = "dedupe-report.json"`,
    - `TRACEABILITY_MATRIX_SCHEMA_VERSION = "1.0.0"`,
    - `TRACEABILITY_MATRIX_ARTIFACT_FILENAME = "traceability-matrix.json"`.
- New enums (additive):
    - `ALLOWED_INTENT_DELTA_KINDS` / `IntentDeltaKind`: `screen`, `field`,
      `action`, `validation`, `navigation`, `visual_screen`.
    - `ALLOWED_INTENT_DELTA_CHANGE_TYPES` / `IntentDeltaChangeType`: `added`,
      `removed`, `changed`, `confidence_dropped`, `ambiguity_increased`.
    - `ALLOWED_TEST_CASE_DELTA_VERDICTS` / `TestCaseDeltaVerdict`: `new`,
      `unchanged`, `changed`, `obsolete`, `requires_review`.
    - `ALLOWED_TEST_CASE_DELTA_REASONS` / `TestCaseDeltaReason`:
      `absent_in_current`, `absent_in_prior`, `fingerprint_changed`,
      `trace_screen_changed`, `trace_screen_removed`,
      `visual_ambiguity_increased`, `visual_confidence_dropped`,
      `reconciliation_conflict`.
    - `ALLOWED_DEDUPE_SIMILARITY_SOURCES` / `DedupeSimilaritySource`:
      `lexical`, `embedding`, `external_lookup`.
    - `ALLOWED_DEDUPE_EXTERNAL_PROBE_STATES` / `DedupeExternalProbeState`:
      `disabled`, `unconfigured`, `executed`.
- New artifact types (additive):
    - `IntentDeltaReport` + `IntentDeltaEntry` + `TestCaseDeltaReport` +
      `TestCaseDeltaRow` carrying type-level invariants
      `rawScreenshotsIncluded: false`, `secretsIncluded: false`.
    - `TestCaseDedupeReport` + `DedupeInternalFinding` +
      `DedupeExternalFinding` + `DedupeCaseVerdict` carrying the same
      type-level invariants.
    - `TraceabilityMatrix` + `TraceabilityMatrixRow` +
      `TraceabilityVisualObservation` + `TraceabilityReconciliationDecision`
      carrying the same type-level invariants.
- Extended `Wave1PocEvidenceArtifactCategory` union (additive) with three
  new literal categories: `intent_delta`, `dedupe_report`,
  `traceability_matrix`. Existing manifests continue to validate.
- New public modules under `src/test-intelligence/`:
    - `intent-delta.ts` exporting `computeIntentDelta`,
      `writeIntentDeltaReport`, `INTENT_DELTA_DEFAULT_CONFIDENCE_DRIFT`.
    - `test-case-delta.ts` exporting `classifyTestCaseDelta`,
      `writeTestCaseDeltaReport`.
    - `test-case-dedupe.ts` exporting `detectTestCaseDuplicatesExtended`,
      `cosineSimilarity`, `writeTestCaseDedupeReport`,
      `createDisabledExternalDedupeProbe`,
      `createUnconfiguredExternalDedupeProbe`, plus the
      `EmbeddingProvider` and `ExternalDedupeProbe` interfaces.
    - `traceability-matrix.ts` exporting `buildTraceabilityMatrix`,
      `writeTraceabilityMatrix`.

### Behaviour notes

- All new surfaces are OPT-IN: existing pipelines (`runValidationPipeline`,
  `runExportPipeline`, `runOpenTextAlmApiTransfer`) keep their pre-#1373
  behaviour byte-for-byte. A caller invokes the new helpers explicitly to
  produce the artifacts.
- Air-gapped flow is preserved: `EmbeddingProvider` defaults to absent,
  `ExternalDedupeProbe` defaults to `disabled`. When the embedding path is
  unavailable the lexical fingerprint path still surfaces duplicates.
- Obsolete cases are reported via `TestCaseDeltaVerdict = "obsolete"` only
  — never destructively removed from QC (per AC3).
- Visual hashes participate in delta detection so unchanged screens avoid
  unnecessary visual-sidecar calls (per the 2026-04-24 multimodal
  addendum).

## [4.8.0] - 2026-04-26

### Added (Issue #1372)

- New schema constants for the controlled OpenText ALM API transfer pipeline:
    - `TRANSFER_REPORT_SCHEMA_VERSION = "1.1.0"`,
    - `TRANSFER_REPORT_ARTIFACT_FILENAME = "transfer-report.json"`,
    - `QC_CREATED_ENTITIES_SCHEMA_VERSION = "1.0.0"`,
    - `QC_CREATED_ENTITIES_ARTIFACT_FILENAME = "qc-created-entities.json"`.
- New enums (additive):
    - `ALLOWED_TRANSFER_REFUSAL_CODES` / `TransferRefusalCode` covering
      `feature_disabled`, `admin_gate_disabled`, `bearer_token_missing`,
      `mapping_profile_invalid`, `provider_mismatch`, `no_mapped_test_cases`,
      `no_approved_test_cases`, `unapproved_test_cases_present`,
      `policy_blocked_cases_present`, `schema_invalid_cases_present`,
      `visual_sidecar_blocked`, `visual_sidecar_evidence_missing`,
      `review_state_inconsistent`, `four_eyes_pending`, `dry_run_refused`,
      `dry_run_missing`, `folder_resolution_failed`, `mode_not_implemented`.
    - `ALLOWED_TRANSFER_ENTITY_OUTCOMES` / `TransferEntityOutcome`:
      `created`, `skipped_duplicate`, `failed`, `refused`.
    - `ALLOWED_TRANSFER_FAILURE_CLASSES` / `TransferFailureClass`:
      `transport_error`, `auth_failed`, `permission_denied`,
      `validation_rejected`, `conflict_unresolved`, `rate_limited`,
      `server_error`, `unknown`.
- New artifact types (additive):
    - `TransferReportArtifact` with type-level invariants
      `rawScreenshotsIncluded: false`, `credentialsIncluded: false`,
      `transferUrlIncluded: false`, plus deterministic counts
      (`createdCount`, `skippedDuplicateCount`, `failedCount`,
      `refusedCount`) and `audit: TransferAuditMetadata`.
    - `QcCreatedEntitiesArtifact` with type-level invariant
      `transferUrlIncluded: false`.
    - `TransferEntityRecord`, `QcCreatedEntity`, `TransferAuditMetadata`,
      and `TransferEvidenceReferences`.
- New optional fields on `WorkspaceStartOptions.testIntelligence`:
    - `allowApiTransfer?: boolean` (default `false` — fail-closed admin gate),
    - `transferBearerToken?: string` (legacy single-principal token),
    - `transferPrincipals?: TestIntelligenceTransferPrincipal[]`
      (multi-principal idempotent audit lineage).
- New exported type `TestIntelligenceTransferPrincipal`.
- New public module `src/test-intelligence/qc-alm-api-transfer.ts`
  exporting `runOpenTextAlmApiTransfer`, `buildTransferRollbackGuidance`,
  `createUnconfiguredQcApiTransferClient`, `isApiTransferMode`,
  `QcApiTransferError`, plus the `QcApiTransferClient` interface.

### Changed (Issue #1372)

- `TRANSFER_REPORT_SCHEMA_VERSION` is `"1.1.0"` because transfer audit
  metadata now includes required hash-only `evidenceReferences`. Consumers of
  schema `"1.0.0"` reports should treat missing `audit.evidenceReferences` as
  a legacy artifact and should not infer Wave 3 evidence binding from it.

### Behaviour notes

- The `api_transfer` mode is fail-closed by default. Every gate
  (feature flag, admin flag, bearer token, mapping profile, dry-run
  report, review state, four-eyes, visual sidecar, policy decisions)
  must succeed before any write leaves the process. Refusal codes are
  recorded together so an operator can address them in one cycle.
- Idempotency is enforced via `lookupByExternalId` against the resolved
  folder path before any create call. Re-running on an unchanged approved
  set never produces duplicate entities; distinct target folders are
  resolved deterministically before any entity write starts.
- Transfer audit metadata carries hash-only evidence references for the
  mapping preview, dry-run report, visual-sidecar validation report, and
  optional generated test-case / reconciled intent artifacts. Raw prompts,
  screenshots, bearer tokens, and transfer URLs are never embedded.
- The pipeline writes `transfer-report.json` and
  `qc-created-entities.json` atomically using
  `${pid}.${randomUUID()}.tmp` so concurrent transfers on the same
  artifact root cannot tear a JSON file. Failure detail strings are
  redacted through the same secret + URL strip used by the dry-run
  report.

## [4.7.0] - 2026-04-26

### Added (Issue #1414)

- New `LlmGatewayErrorClass` literal `"response_too_large"` added to `ALLOWED_LLM_GATEWAY_ERROR_CLASSES`. Surfaced by `LlmGatewayClient.generate` when the gateway response body exceeds the configured `maxResponseBytes` cap. The failure is `retryable: false` (re-issuing the request would by definition breach the same cap); the transport cancels the underlying `ReadableStream` so the socket is released without buffering the remaining bytes.
- New optional `maxResponseBytes?: number` field on `LlmGatewayClientConfig`. Defaults to `8 * 1024 * 1024` (8 MiB) when omitted. Accepts any positive safe integer; invalid values (zero, negative, non-integer, `NaN`, infinite) throw `RangeError` at client construction. The mock gateway has no transport and ignores the field — fixtures that need to model this failure mode emit it directly through a `responder`.
- The transport enforces the cap via two layers: a `Content-Length` header pre-read short-circuit (so a header-declared oversized body never even pulls bytes from the socket) and a chunk-by-chunk byte counter against the streaming reader (so a missing or mendacious header still cannot exhaust memory). Both oversized paths cancel the underlying response body so the socket is released without buffering the remaining bytes.

### Changed

- Consumers that switch on `errorClass` should extend their handling to cover `"response_too_large"`. Behavior is `retryable: false`; `llm-capability-probe` classifies the outcome as `unsupported` (the gateway responded but its body shape is incompatible with the cap), and `visual-sidecar-client` treats it as `primary_unavailable` so the multimodal fallback chain still fires.
- The previous internal `MAX_RESPONSE_BYTES = 1 MiB` constant in `llm-gateway.ts` and its `errorClass: "schema_invalid"` failure are replaced by the configurable cap and the dedicated `response_too_large` discriminant. Clients that did not override the cap see the default raised from 1 MiB to 8 MiB; callers that previously matched on `errorClass === "schema_invalid"` plus the `/response body exceeds/` message must now match `errorClass === "response_too_large"` (the human-readable message remains `/response body exceeds maxResponseBytes \d+/`).
- Retryable early-status responses (`408`, `429`, and `5xx`) preserve their existing `timeout`, `rate_limited`, and `transport` classifications, but now cancel unread response bodies before retrying. `LLM_GATEWAY_CONTRACT_VERSION` remains `1.0.0` because it stamps persisted gateway evidence artifacts; this additive client-surface change is tracked by `CONTRACT_VERSION` `4.7.0`.

---

## [4.6.0] - 2026-04-26

### Added (Issue #1415)

- New `LlmGatewayErrorClass` literal `"input_budget_exceeded"` added to `ALLOWED_LLM_GATEWAY_ERROR_CLASSES`. Surfaced by `LlmGatewayClient.generate` (real and mock) when an outgoing `LlmGenerationRequest` carries a `maxInputTokens` cap and the client-side estimate of the prompt size (system prompt + user prompt + structured-output schema + image base64 payloads, divided by 4 bytes/token) exceeds that cap. The failure is `retryable: false`; the pre-transport guard returns before circuit-breaker dispatch because retrying would by definition violate the same budget.
- The `maxInputTokens` field on `LlmGenerationRequest` (introduced in 3.29.0 as a FinOps surface) is now load-bearing on the gateway transport: the cap is evaluated **before** any network call, before `apiKeyProvider` is invoked, and before the request body is serialized. Mock gateway honours the same guard so CI fixtures observe identical fail-closed semantics. Negative, zero, non-integer, or non-safe-integer values continue to be rejected as `schema_invalid` (structurally invalid budgets, distinct from a budget breach).
- `runWave1Poc` recognises the new error class as a FinOps gateway-budget failure and routes it through the existing `Wave1PocFinOpsBudgetExceededError` path (no downstream artifacts emitted).

### Changed

- Consumers that switch on `errorClass` must extend their handling to cover `"input_budget_exceeded"`. Behavior continues to be `retryable: false`; treat it as a non-transient policy outcome (operator-set cap was breached). Existing matchers that key on the human-readable message (`/estimated input tokens \d+ exceeds maxInputTokens \d+/`) still apply unchanged — only the `errorClass` discriminant moved from `"schema_invalid"` to `"input_budget_exceeded"`.

## [4.5.0] - 2026-04-26

### Added (Issue #1412)

- New `TestCasePolicyOutcome` literal `"risk_tag_downgrade_detected"` added to `ALLOWED_TEST_CASE_POLICY_OUTCOMES`. Emitted by `evaluatePolicyGate` (per-case and job-level) when the case-level `riskCategory` is outside the active profile's `reviewOnlyRiskCategories` set while the Business Test Intent IR derives a review-only classification for a screen referenced in the case's `figmaTraceRefs`. Per-case violations carry `severity: "warning"` and force the per-case decision to `needs_review`; a deduplicated set of job-level violations records the same drift for audit. The `risk_tag_downgrade_detected` outcome is additive to the existing `regulated_risk_review_required` violation, which continues to fire so per-case review tooling preserves its prior behavior.
- New optional field `enforceRiskTagDowngradeDetection?: boolean` on `TestCasePolicyProfileRules`. The secure default is `true` (treat `undefined` as `true`); the `eu-banking-default` profile sets the flag explicitly. Setting it to `false` disables the new gate behavior so legacy consumers remain backward-compatible.

### Changed

- `evaluatePolicyGate` now derives an effective intent risk classification per generated test case by intersecting `BusinessTestIntentIr.piiIndicators` with the case's `figmaTraceRefs.screenId` set (PII indicators without a `screenId` continue to be treated as global, fail-closed). Top-level `intent.risks` strings continue to be considered globally because the intent IR does not yet model per-screen risk strings.

## [4.4.0] - 2026-04-26

### Added (Issue #1413)

- New `TestCaseValidationIssueCode` literal `"semantic_suspicious_content"` added to `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`. Emitted by `validateGeneratedTestCases` when a deny-list pattern (shell metacharacters in suspicious sequences, JNDI / log4shell payloads, long base64 / hex runs, `<script>` tags, inline event handlers, `javascript:` / `data:` URLs) is found inside `steps[n].action`, `steps[n].data`, `steps[n].expected`, top-level `expectedResults[n]`, `preconditions[n]`, or `testData[n]`. Severity is `error`, so the validation report blocks the pipeline by default.
- New `TestCasePolicyOutcome` literal `"semantic_suspicious_content"` added to `ALLOWED_TEST_CASE_POLICY_OUTCOMES`. Mapped from the matching validation issue code by `evaluatePolicyGate`.
- New module `src/test-intelligence/semantic-content-sanitization.ts` with documented deny-list patterns, the pure detector `detectSuspiciousContent`, the runtime constants `SEMANTIC_SUSPICION_CATEGORIES` and `SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND`, the per-case override types `SemanticContentOverride` / `SemanticContentOverrideInput` / `SemanticContentOverrideMap`, the operator entry point `recordSemanticContentOverride` (records a structured `note` review event with `metadata.overrideKind = "semantic_suspicious_content"` plus a non-empty justification), the auditor entry point `extractSemanticContentOverrides` (rebuilds the active override map from a persisted review-event log so it is replay-safe and carries the reviewed category), the pure helper `filterSemanticContentOverridesForValidation` (joins override maps against the current validation report so stale/unknown/category-mismatched paths remain fail-closed), and the pure helper `effectiveSemanticContentBlock` (computes the post-override `blocked` flag for downstream gates without mutating the validation report).
- New optional input `evaluatePolicyGate({ ..., semanticContentOverrides })`. When a `(testCaseId, path)` pair is in the override map, the corresponding `semantic_suspicious_content` validation finding is recorded as a `warning`-severity violation rather than a blocking `error`, the per-case decision is downgraded from `blocked` to `needs_review`, and the violation `rule` is annotated with `:overridden`. Cases with no override behave exactly as before. The validation report itself is preserved unchanged so the audit history carries the original finding.
- New optional input `runValidationPipeline({ ..., semanticContentOverrides })`. Forwards overrides into the policy gate and recomputes the pipeline-level `blocked` flag using `effectiveSemanticContentBlock`, so an overridden case no longer blocks downstream review/export gates while the validation artifact retains the original error finding.
- New optional input `runExportPipeline({ ..., semanticContentOverrides })`. Export still refuses raw validation errors by default, but when supplied with the same validated override map and an override-aware policy report it uses the effective validation block calculation so reviewed semantic findings do not permanently block export.
- New `ReviewStore.refreshPolicyDecisions({ jobId, at, policy })` entry point. It refreshes persisted per-case `policyDecision` values from an override-aware policy report, appends an audit note when anything changes, and preserves review state so a previously blocked semantic case can be approved after the explicit override is recorded and policy is re-evaluated. Refreshes fail closed when the policy report belongs to another job or references test-case ids outside the current review snapshot.

### Compatibility (Issue #1413)

- Additive only. Existing call sites that omit `semanticContentOverrides` see no behavior change for any test case that does not contain semantically suspicious content. Test cases that previously passed validation continue to pass; only newly detected injection-shape content blocks where it would have previously slipped through.
- New runtime exports surface through `src/test-intelligence/index.ts` only (the test-intelligence sub-module entry point): `SEMANTIC_SUSPICION_CATEGORIES`, `SEMANTIC_CONTENT_OVERRIDE_KIND_VALUE`, `SEMANTIC_CONTENT_OVERRIDE_MAX_JUSTIFICATION_LENGTH`, `SEMANTIC_CONTENT_OVERRIDE_METADATA_*` keys, `SEMANTIC_CONTENT_OVERRIDE_NOTE_KIND`, `detectSuspiciousContent`, `recordSemanticContentOverride`, `extractSemanticContentOverrides`, `listSemanticContentOverrides`, `filterSemanticContentOverridesForValidation`, and `effectiveSemanticContentBlock`. The root `src/index.ts` snapshot in `contract-version.test.ts` is unchanged because the root module re-exports only from `src/contracts/index.ts`.

## [4.3.0] - 2026-04-26

### Added (Issue #1411)

- `Wave1PocEvidenceManifest.manifestIntegrity?: { algorithm: "sha256"; hash: string }` — new optional self-attestation field for Wave 1 evidence manifests. New manifests stamp `algorithm: "sha256"` plus the SHA-256 of the canonical manifest JSON with `manifestIntegrity` omitted, so metadata-only rewrites to fields such as `modelDeployments`, `rawScreenshotsIncluded`, `promptHash`, or `policyProfileId` are detected by `verifyWave1PocEvidenceManifest` without requiring artifact-byte changes.
- `Wave1PocEvidenceVerificationResult.manifestIntegrity?` — structured verification details for the self-attestation check (`algorithm`, `actualHash`, optional `expectedHash`, `ok`). Current-version manifests that omit `manifestIntegrity` fail closed; legacy manifests remain parseable and continue to rely on the existing digest witness / trusted digest path.

### Unchanged (Issue #1411)

- The sibling `wave1-poc-evidence-manifest.sha256` digest witness remains in place and is still used by `verifyWave1PocEvidenceFromDisk`. The self-attestation field is additive defense-in-depth for direct manifest verification, not a replacement for external digest witnesses or signed in-toto attestations.
- No runtime dependency, telemetry, network call, signer, or external schema library is introduced. Hashing continues to use `node:crypto` and the existing canonical JSON helper.

## [4.2.0] - 2026-04-26

### Added (Issue #1380)

- New endpoint `GET /workspace/jobs/:jobId/evidence/verify` exposing the local Wave 1 POC evidence-verification capability (#1366) as a read-only HTTP route so operators and auditors can verify a completed job's evidence integrity without touching artifacts directly on disk. Status codes: `404` for unknown job IDs, `409` when no evidence has been written yet, `200` on verification completion regardless of pass/fail outcome (the body carries `ok`). The route is feature-gated by the same dual `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` + `WorkspaceStartOptions.testIntelligence.enabled` check as `/workspace/test-intelligence/...`. Bearer-protected per the existing governance-route convention (fail-closed `503 AUTHENTICATION_UNAVAILABLE` when `testIntelligence.reviewBearerToken` is unset, `401 UNAUTHORIZED` on missing/invalid token). Per-IP rate limiter `evidence-verify-reads.json` consumed per `(client, jobId)`. Method-locked to `GET` (returns `405 METHOD_NOT_ALLOWED` with `Allow: GET` for other methods). Invocations are audit-logged.
- New constant `EVIDENCE_VERIFY_RESPONSE_SCHEMA_VERSION` (`"1.0.0"`).
- New exported types `EvidenceVerifyResponse`, `EvidenceVerifyCheck`, `EvidenceVerifyFailure`, `EvidenceVerifyCheckKind`, `EvidenceVerifyFailureCode` describing the `200` response body. The body carries `schemaVersion`, `verifiedAt`, `jobId`, `ok`, `manifestSha256`, `manifestSchemaVersion`, `testIntelligenceContractVersion`, `modelDeployments`, optional `visualSidecar` summary (`selectedDeployment`, `fallbackUsed`, `resultArtifactSha256`), optional `attestation` summary (`present`, `signingMode`, `signatureCount`, `signaturesVerified`), and the deterministic `checks[]` + `failures[]` arrays. `checks[]` is sorted by `(kind, reference)`; `failures[]` is sorted by `(reference, code)` so consecutive verifications of the same on-disk run produce byte-stable bodies (modulo `verifiedAt`).
- New module `src/test-intelligence/evidence-verify.ts` exporting `verifyJobEvidence({ artifactsRoot, jobId, verifiedAt })` plus the discriminated `EvidenceVerifyResult` (`{ status: "ok"; body }` | `{ status: "job_not_found" }` | `{ status: "no_evidence" }`). The orchestrator wraps `verifyWave1PocEvidenceFromDisk` (per-artifact SHA-256 + manifest digest witness) and, when an in-toto attestation is present at `<runDir>/evidence/attestations/wave1-poc-attestation.intoto.json`, also calls `verifyWave1PocAttestationFromDisk` with the signing mode auto-detected from the on-disk presence of the matching Sigstore bundle. Visual-sidecar evidence is detected as missing when the manifest carries a `visualSidecar` summary but the on-disk result artifact is absent / failed, when the manifest attests the result artifact but never wires the summary block, or when `generated-testcases.json` references screen-only `visualEvidenceRefs` without a backing `visualSidecar` summary.
- New module `src/test-intelligence/evidence-verify-route.ts` exporting `parseEvidenceVerifyRoute` plus the `EvidenceVerifyRoute` / `EvidenceVerifyParseResult` / `EvidenceVerifyParseError` types. Path parser is method-agnostic; the request handler dispatches on method and applies bearer + rate-limit guards.

### Unchanged (Issue #1380)

- Read-only route: no write side effects, no artifact mutation, no attestation re-signing or manifest patching.
- Response body never contains tokens, prompt bodies, reasoning traces, raw test-case payloads, environment values, signer secret material, or absolute paths — only safe manifest-relative filenames, SHA-256 digests, and identity stamps surface.
- The route is HTTP-level only; the underlying `verifyWave1PocEvidenceFromDisk` / `verifyWave1PocAttestationFromDisk` primitives from #1366 / #1377 are unchanged. No new dependency, telemetry, or external schema library is introduced.

## [4.1.0] - 2026-04-26

### Added (Issue #1379)

- New optional self-verify rubric pass (Issue #1379) that sits between `testcase.validate` and `testcase.policy` in the validation pipeline. The pass scores every validated test case against a fixed rubric (six dimensions: schema conformance, source-trace completeness, assumption / open-question marking, expected-result coverage, negative / boundary case presence, duplication flag consistency) and, when a `VisualScreenDescription[]` is supplied, four multimodal subscores (visible-control coverage, state / validation coverage, ambiguity handling, unsupported-visual-claims penalty per the 2026-04-24 multimodal addendum). Per-case rubric scores are rounded to 6 digits and the job-level aggregate is the arithmetic mean of the per-case scores; the same job-level aggregate is mirrored onto `coverage-report.json#rubricScore`.
- New constants: `SELF_VERIFY_RUBRIC_REPORT_SCHEMA_VERSION` (`"1.0.0"`), `SELF_VERIFY_RUBRIC_REPORT_ARTIFACT_FILENAME` (`"self-verify-rubric.json"`), `SELF_VERIFY_RUBRIC_ARTIFACT_DIRECTORY` (`"testcases"`), `SELF_VERIFY_RUBRIC_PROMPT_TEMPLATE_VERSION` (`"1.0.0"`), `SELF_VERIFY_RUBRIC_RESPONSE_SCHEMA_NAME` (`"SelfVerifyRubricReport"`), `ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS`, `ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES`, `ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES`.
- New exported types: `SelfVerifyRubricDimension`, `SelfVerifyRubricVisualSubscoreKind`, `SelfVerifyRubricRefusalCode`, `SelfVerifyRubricDimensionScore`, `SelfVerifyRubricVisualSubscore`, `SelfVerifyRubricRuleCitation`, `SelfVerifyRubricCaseEvaluation`, `SelfVerifyRubricAggregateScores`, `SelfVerifyRubricRefusal`, `SelfVerifyRubricReport`, `SelfVerifyRubricReplayCacheKey`, `SelfVerifyRubricReplayCacheEntry`, `SelfVerifyRubricReplayCacheLookupResult`, `TestCaseQualitySignalRubric` (per-case quality-signal projection of the rubric report).
- New module `src/test-intelligence/self-verify-rubric.ts` exporting `runSelfVerifyRubricPass`, `projectSelfVerifyRubricToTestCaseQualitySignals`, `aggregateSelfVerifyRubricScores`, `buildSelfVerifyRubricResponseSchema`, `buildSelfVerifyRubricUserPrompt`, `validateSelfVerifyRubricResponse`, `computeSelfVerifyRubricCacheKeyDigest`, `computeSelfVerifyRubricPromptHash`, `computeSelfVerifyRubricSchemaHash`, `createMemorySelfVerifyRubricReplayCache`, `createFileSystemSelfVerifyRubricReplayCache`, `writeSelfVerifyRubricReportArtifact`, `SELF_VERIFY_RUBRIC_SYSTEM_PROMPT`, `SELF_VERIFY_RUBRIC_USER_PROMPT_PREAMBLE`. The pass calls the same `LlmGatewayClient` (role `test_generation`) that the generator uses (per Issue #1379 non-goal "no second model"); image inputs are refused at the gateway boundary so the rubric never receives screenshot bytes.
- Rubric replay-cache keys include `modelDeployment` and `compatibilityMode` in addition to model revision and gateway release, and the rubric pass refuses with `model_binding_mismatch` before cache lookup or LLM invocation when the supplied model binding does not match the gateway client or the client is not in `openai_chat` compatibility mode.
- Per-case rubric scores are reported via the `self-verify-rubric.json` artifact's `caseEvaluations[].rubricScore` field and the `TestCaseQualitySignalRubric[]` projection (`projectSelfVerifyRubricToTestCaseQualitySignals`). The strict generated-test-case JSON schema is intentionally NOT widened — the cached `GeneratedTestCase` payload remains byte-identical, the replay-cache key for the test-generation pass is unchanged, and downstream consumers that already validate cached payloads keep working without a schema-version migration.
- New `RunValidationPipelineInput.selfVerifyRubric?: SelfVerifyRubricPipelineOptions` (additive, opt-in). When set, callers use the new async `runValidationPipelineWithSelfVerify` (or `runAndPersistValidationPipelineWithSelfVerify`) which threads the rubric pass between validation and policy. When omitted, the synchronous `runValidationPipeline` path is byte-stable with the pre-#1379 behavior — no rubric artifact is emitted, `coverage-report.json#rubricScore` is left unset, and downstream policy / visual gates are unchanged.
- New `ValidationPipelineArtifacts.rubric?: SelfVerifyRubricReport` (additive, optional). Persisted at `<destinationDir>/testcases/self-verify-rubric.json` via `writeValidationPipelineArtifacts` when present.
- `runWave1Poc` accepts optional `selfVerifyRubric: { enabled: true; cache?, mockResponder?, maxOutputTokens?, maxRetries?, ... }` (additive). When enabled the harness builds an in-process deterministic mock LLM client (role `test_generation`, deployment `gpt-oss-120b-mock`) and threads the rubric pass through the validation pipeline; the resulting `<runDir>/testcases/self-verify-rubric.json` is attested by the evidence manifest under category `self_verify_rubric`. When omitted the Wave 1 POC fixtures remain byte-identical to the pre-#1379 baseline.
- `Wave1PocRunResult.selfVerifyRubric?: SelfVerifyRubricReport` and `Wave1PocRunResult.selfVerifyRubricArtifactPath?: string` (additive, optional).
- `Wave1PocEvidenceArtifactCategory` adds `"self_verify_rubric"` for the new artifact attestation slot.
- `Wave1PocEvalThresholds.minJobRubricScore?: number` and `Wave1PocEvalThresholds.requireRubricPass?: boolean` (additive). When set, the eval gate fails the run if the rubric `jobLevelRubricScore` is strictly below the threshold or if the rubric pass attached a `refusal` to its report.
- `Wave1PocEvalFixtureMetrics.jobRubricScore?: number` and `Wave1PocEvalFixtureMetrics.rubricRefused?: boolean` (additive). Populated by the eval gate when the rubric pass ran for the fixture.
- `Wave1PocEvalFailure.rule` extended with `"min_job_rubric_score"` and `"rubric_pass_refused"` (additive — new accepted rule strings, no rule rename).

### Unchanged (Issue #1379)

- The pre-#1379 default fixture-only POC path is byte-identical: rubric pass is opt-in and the deterministic harness emits the same `wave1-poc-evidence-manifest.json` digest for every existing fixture. The strict generated-test-case JSON schema is unchanged so every replay-cache file and persisted `generated-testcases.json` written before this change remains valid (zero migration burden for replay caches and on-disk artifacts).
- No new runtime dependency, telemetry, or external schema library is introduced. The rubric pass uses the existing `LlmGatewayClient` surface from #1363, the existing `LlmGatewayClientBundle.testGeneration` client, the same `openai_chat` compatibility mode, and hand-rolled JSON validation (workspace-dev zero-runtime-deps policy — see `repo_zero_deps.md`). Image payloads are refused for the test_generation role so the rubric never receives screenshot bytes (`imagePayloadSentToTestGeneration: false` invariant from #1366 holds).
- API keys, bearer tokens, and prompt text are NEVER persisted by the rubric pass. The persisted report carries dimension scores, short rule citations (sanitized + truncated), the cache-key digest, and the deployment / model-revision identity — never raw prompts and never chain-of-thought.
- Replay-cache identity for the test-generation pass is unchanged (the rubric cache uses a separate key shape with `passKind: "self_verify_rubric"` so the two caches cannot collide).

## [4.0.0] - 2026-04-26

### Changed (Issue #1378 follow-up — schema conformance) — BREAKING

- `CONTRACT_VERSION` from `3.32.0` to `4.0.0` (Major bump: field removals +
  type change per the versioning rules table above).
- **Removed** `Wave1PocLbomDocument.secretsIncluded`, `rawPromptsIncluded`,
  and `rawScreenshotsIncluded` (non-standard top-level fields). The same
  invariants are now carried as CycloneDX `metadata.properties`:
  `workspace-dev:secretsIncluded`, `workspace-dev:rawPromptsIncluded`, and
  `workspace-dev:rawScreenshotsIncluded`. Consumers that read these fields
  must switch to `metadata.properties`.
- **Changed** `LbomModelConsiderations.ethicalConsiderations` from
  `string[]` to `Array<{ name: string; mitigationStrategy?: string }>`,
  matching the CycloneDX 1.6 model-card risk-object schema.
- Per-job LBOM documents now validate directly against the pinned CycloneDX
  1.6 JSON schema family (`bom-1.6`, SPDX, and JSF).
- New CI-covered schema test validates both emitted LBOM artifacts and
  `docs/figma-to-test/lbom-template.cdx.json` against pinned local
  CycloneDX 1.6 + SPDX + JSF schemas.

## [3.32.0] - 2026-04-26

### Added (Issue #1378)

- New per-job CycloneDX 1.6 ML-BOM (LBOM) artifact emitted by `runWave1Poc` under `<runDir>/lbom/ai-bom.cdx.json`. The artifact inventories the model chain (`gpt-oss-120b` test-generation, `llama-4-maverick-vision` visual primary, `phi-4-multimodal-poc` visual fallback), the curated few-shot prompt bundle (hashed via the prompt compiler's `promptHash` + `schemaHash`), and the active policy profile (hashed via canonical SHA-256). The visual sidecar fallback usage is recorded as a metadata + per-component property so an operator can detect degraded paths without re-parsing the visual sidecar result.
- New constants: `LBOM_CYCLONEDX_SPEC_VERSION` (`"1.6"`), `LBOM_ARTIFACT_SCHEMA_VERSION` (`"1.0.0"`), `LBOM_ARTIFACT_DIRECTORY` (`"lbom"`), `LBOM_ARTIFACT_FILENAME` (`"ai-bom.cdx.json"`), and `ALLOWED_LBOM_MODEL_ROLES` (`["test_generation", "visual_primary", "visual_fallback"]`).
- New exported types describing the persisted LBOM document: `Wave1PocLbomDocument`, `LbomMetadata`, `LbomToolComponent`, `LbomSubjectComponent`, `LbomModelComponent`, `LbomDataComponent`, `LbomDependency`, `LbomHash`, `LbomProperty`, `LbomExternalReference`, `LbomLicenseEntry`, `LbomModelCard`, `LbomModelParameters`, `LbomModelConsiderations`, `LbomPerformanceMetric`, `LbomModelRole`, `LbomDataKind`.
- New exported types `Wave1PocLbomSummary`, `LbomValidationIssue`, `LbomValidationResult` for audit-timeline summary + structured validator diagnostics.
- New module `src/test-intelligence/lbom-emitter.ts` with `buildLbomDocument`, `validateLbomDocument`, `writeLbomArtifact`, `summarizeLbomArtifact`, `lbomDataKindFromBomRef`, and `isAllowedVisualFallbackReason`. Validator is hand-rolled (workspace-dev zero-runtime-deps policy — see `repo_zero_deps.md`) and enforces CycloneDX 1.6 structural shape, single-algorithm hash entries (`SHA-256` only), unique `bom-ref` set, dependency-graph closure, RFC-4122 serial number, ISO-8601 timestamp, no raw `contents` payloads on data components, and no high-risk secret patterns in any property value.
- `Wave1PocEvidenceArtifactCategory` adds `"lbom"`. The `runWave1Poc` evidence manifest now attests `lbom/ai-bom.cdx.json` with SHA-256 + byte length, so the existing in-toto attestation transitively covers the LBOM through the manifest digest.
- `Wave1PocRunResult` adds `lbom: Wave1PocLbomDocument`, `lbomSummary: Wave1PocLbomSummary`, and `lbomArtifactPath: string`. All three are always present — the LBOM emit is part of the evidence-seal flow on every completed Wave 1 POC run.
- New documentation template at `docs/figma-to-test/lbom-template.cdx.json` referenced from `docs/test-intelligence.md`. The template describes the document shape an operator should expect to find under each run directory.
- The visual-sidecar-failure path also emits `lbom/ai-bom.cdx.json`. Even on a refused run an operator can audit the model chain (test-generation deployment, primary + fallback visual sidecars) and the active policy profile that were attempted before the sidecar exhaustion. The failure-mode LBOM uses the same identity-hash convention as the failure evidence manifest (deterministic SHA-256 over fixture / job / sidecar identity, `failureHash:not-generated` for prompt/schema fields) and is attested by the failure manifest under category `lbom`.

## [3.31.0] - 2026-04-26

### Added (Issue #1377 follow-up — quality-gate)

- New exported type `Wave1PocAttestationCertificateChainMaterial` (`hint`, `certificateChainPem`, `algorithm: "ecdsa-p256-sha256"`, optional `rekorLogIndex`) and discriminated union `Wave1PocAttestationVerificationMaterial = { publicKey } | { x509CertificateChain }` so signed bundles can carry either an in-line public key (key-bound flow) or an X.509 certificate chain (Sigstore keyless flow). Existing key-bound bundles continue to round-trip unchanged.
- `Wave1PocAttestationBundle.verificationMaterial` widens from `{ publicKey: ... }` to `Wave1PocAttestationVerificationMaterial`. The verifier extracts the leaf certificate's subject public key automatically when keyless material is present; trust-root validation (chain → operator-pinned root) remains operator-managed and is OUT OF SCOPE for this module.
- `Wave1PocAttestationSigner.publicKeyMaterial` is renamed to `verificationMaterial` (same union type) so a single field carries either form. Built-in `createKeyBoundSigstoreSigner` now exposes `verificationMaterial: { publicKey: ... }`.
- New module exports: `createKeylessSigstoreSignerScaffold`, `Wave1PocKeylessSignerCallback`, `CreateKeylessSigstoreSignerInput` — operator-pluggable scaffold for Sigstore keyless signing. The repo never invokes Fulcio / Rekor itself; the operator-supplied callback is the only place network egress can occur. The scaffold is exercised end-to-end by tests via a self-signed leaf cert generated entirely in `node:crypto`.
- Atomic-write idiom in `persistWave1PocAttestation` strengthened to `${path}.${pid}.${randomUUID()}.tmp` so concurrent same-pid same-millisecond writers cannot collide on the temp filename. Mirrors the FinOps writer idiom in #1371.
- `evidence-manifest.ts` filename validator (`validateArtifactPath`) now returns a discriminated `{ ok, reason }` so the builder can throw a specific diagnostic (`control_characters`, `path_traversal`, `absolute`, `backslash`, `segment_exceeds_byte_length`, `exceeds_total_byte_length`, `empty`) instead of a generic message.
- 14 new tests across `evidence-attestation.keyless.test.ts` (5), `evidence-attestation.fuzz.test.ts` (8), `evidence-attestation.concurrency.test.ts` (1). The 4 stale filename-injection tests in `evidence-tampering.test.ts` are repaired (test 10's assertion is updated to reflect the post-#1371 multi-segment path policy).

### Added (Issue #1377)

- `WAVE1_POC_ATTESTATION_SCHEMA_VERSION` (`"1.0.0"`) — schema version stamp for the in-toto v1 attestation produced per job by the Wave 1 POC harness.
- `WAVE1_POC_ATTESTATION_STATEMENT_TYPE` (`"https://in-toto.io/Statement/v1"`) and `WAVE1_POC_ATTESTATION_PREDICATE_TYPE` (`"https://workspace-dev.figmapipe.dev/test-intelligence/wave1-poc-evidence/v1"`) — pinned URIs identifying the attestation envelope and predicate shape.
- `WAVE1_POC_ATTESTATION_PAYLOAD_TYPE` (`"application/vnd.in-toto+json"`) — DSSE `payloadType` bound into the pre-authentication encoding (PAE) so a signature cannot be replayed against a different payload type.
- `WAVE1_POC_ATTESTATION_ARTIFACT_FILENAME` (`"wave1-poc-attestation.intoto.json"`) and `WAVE1_POC_ATTESTATION_BUNDLE_FILENAME` (`"wave1-poc-attestation.bundle.json"`) — canonical filenames for the persisted DSSE envelope and the optional Sigstore bundle.
- `WAVE1_POC_ATTESTATIONS_DIRECTORY` (`"evidence/attestations"`) and `WAVE1_POC_SIGNATURES_DIRECTORY` (`"evidence/signatures"`) — run-dir-relative subdirectories where the envelope and (when signed) the Sigstore bundle are written.
- `WAVE1_POC_ATTESTATION_BUNDLE_MEDIA_TYPE` (`"application/vnd.dev.sigstore.bundle.v0.3+json"`) — pinned Sigstore bundle media type embedded in every signed bundle.
- `ALLOWED_WAVE1_POC_ATTESTATION_SIGNING_MODES` (`unsigned`, `sigstore`) and discriminant `Wave1PocAttestationSigningMode` — `unsigned` is the default and is the only mode exercised by the POC fixture path; `sigstore` requires an operator-supplied signer.
- New exported types: `Wave1PocAttestationStatement`, `Wave1PocAttestationSubject`, `Wave1PocAttestationPredicate`, `Wave1PocAttestationVisualSidecarIdentity`, `Wave1PocAttestationDsseEnvelope`, `Wave1PocAttestationSignature`, `Wave1PocAttestationBundle`, `Wave1PocAttestationPublicKeyMaterial`, `Wave1PocAttestationSummary`, `Wave1PocAttestationVerificationFailure`, `Wave1PocAttestationVerificationResult`. Hard invariants on the predicate: `rawScreenshotsIncluded: false`, `secretsIncluded: false`, `imagePayloadSentToTestGeneration: false` (TYPE-LEVEL `false` literals).
- `Wave1PocEvidenceArtifactCategory` gains two new variants: `"attestation"` and `"signature"` — reserved so future verifiers may attest the envelope and bundle inside the existing manifest. The default Wave 1 manifest keeps the attestation as a sibling artifact under `evidence/attestations/...` and `evidence/signatures/...`; the manifest's basename-driven `unexpected` check is unaffected.
- New module `src/test-intelligence/evidence-attestation.ts` — `buildWave1PocAttestationStatement` (canonical statement builder), `encodeWave1PocAttestationPayload` (canonical JSON + UTF-8 encode), `encodeDssePreAuth` (PAE bytes), `buildUnsignedWave1PocAttestationEnvelope`, `buildSignedWave1PocAttestation`, `createKeyBoundSigstoreSigner` (ECDSA P-256 signer using `node:crypto`, no network), `generateWave1PocAttestationKeyPair`, `persistWave1PocAttestation` (atomic `${pid}.${ts}.tmp` rename), `summarizeWave1PocAttestation`, `listWave1PocAttestationArtifactPaths`, `verifyWave1PocAttestation`, `verifyWave1PocAttestationFromDisk`, `computeWave1PocAttestationEnvelopeDigest`. The verifier returns a structured `Wave1PocAttestationVerificationResult` with per-failure `code` + `reference` + `message`; tampered subjects fail with `subject_digest_mismatch` and the mismatched artifact path under `reference`.
- `runWave1Poc` accepts optional `attestationSigningMode` and `attestationSigner`. Always emits `<runDir>/evidence/attestations/wave1-poc-attestation.intoto.json`; when the signing mode is `sigstore`, also emits `<runDir>/evidence/signatures/wave1-poc-attestation.bundle.json`. Result type extended with `attestation: Wave1PocAttestationSummary` so the audit timeline surfaces signing mode, signer reference, and artifact SHA-256 without re-reading the on-disk envelope.

### Unchanged (Issue #1377)

- The Wave 1 evidence manifest from #1366 (`Wave1PocEvidenceManifest`) and its on-disk verification (`verifyWave1PocEvidenceManifest`, `verifyWave1PocEvidenceFromDisk`) continue to behave exactly as before. The attestation is a sibling layer; existing Merkle-style hash + byte-length checks, manifest-mutation detection, and digest-witness validation are preserved bit-identically.
- The default signing mode is `unsigned` and never invokes a signer. The unsigned path is fully air-gapped: no network calls, no private-key operations, deterministic byte output for byte-stable fixture replays.
- No new runtime dependency, telemetry, or external schema library is introduced. DSSE encoding and ECDSA P-256 signing/verification use `node:crypto` only; the canonical JSON helper is the existing `canonicalJson` from `content-hash.ts`.
- API keys, bearer tokens, OIDC tokens, prompt text, and response bytes are NEVER attested. Predicate fields carry only identity hashes, deployment names, and version stamps.

---

## [3.30.0] - 2026-04-25

### Added (Issue #1376)

- `pending_secondary_approval` — new value appended to `ALLOWED_REVIEW_STATES` for cases that have received their first distinct approval and are awaiting a second under four-eyes enforcement. Cases not subject to four-eyes never enter this state.
- `primary_approved` and `secondary_approved` — new values appended to `ALLOWED_REVIEW_EVENT_KINDS`. The store records each four-eyes approval as one of these wire-level kinds for governance auditability; clients may continue to send the generic `approved` action and the store routes it based on snapshot state.
- `ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS` (`risk_category`, `visual_low_confidence`, `visual_fallback_used`, `visual_possible_pii`, `visual_prompt_injection`, `visual_metadata_conflict`) and discriminant `FourEyesEnforcementReason`.
- `DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES` (`financial_transaction`, `regulated_data`, `high`) — operator-overridable default mapping the issue's `payment / authorization / identity / regulatory` surface onto the existing `TestCaseRiskCategory` taxonomy.
- `DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS` (`low_confidence`, `fallback_used`, `possible_pii`, `prompt_injection_like_text`, `conflicts_with_figma_metadata`) — visual-sidecar outcomes that trigger four-eyes regardless of risk category, per the 2026-04-24 multimodal addendum.
- New exported type `FourEyesPolicy` — `{ requiredRiskCategories, visualSidecarTriggerOutcomes }`. The policy is resolved at startup from `WorkspaceStartOptions.testIntelligence` and stamped into each `ReviewGateSnapshot.fourEyesPolicy`.
- New exported type `TestIntelligenceReviewPrincipal` — `{ principalId, bearerToken }`. Review-gate writes may derive the persisted actor from a server-configured principal-bound bearer token instead of trusting a request-body `actor`.
- New optional fields on `WorkspaceStartOptions.testIntelligence`: `reviewPrincipals?: TestIntelligenceReviewPrincipal[]`, `fourEyesRequiredRiskCategories?: TestCaseRiskCategory[]`, and `fourEyesVisualSidecarTriggerOutcomes?: VisualSidecarValidationOutcome[]`.
- New optional fields on `ReviewSnapshot`: `fourEyesReasons?`, `primaryReviewer?`, `primaryApprovalAt?`, `secondaryReviewer?`, `secondaryApprovalAt?`, `lastEditor?`. The previously-required `fourEyesEnforced: boolean` field now actually drives enforcement; older snapshots that emitted `false` continue to validate.
- New optional fields on `ReviewGateSnapshot`: `pendingSecondaryApprovalCount?: number`, `fourEyesPolicy?: FourEyesPolicy`.
- New module `src/test-intelligence/four-eyes-policy.ts` — `EU_BANKING_DEFAULT_FOUR_EYES_POLICY`, `cloneFourEyesPolicy`, `resolveFourEyesPolicy` (normalizes operator config), `evaluateFourEyesEnforcement` (returns `{ enforced, reasons }` per case), `validateFourEyesPolicy` (returns `ValidationIssue[]` for invalid risk categories or outcomes).
- The review store extends `seedSnapshot` with optional `fourEyesPolicy` and `visual` inputs so each test case is stamped at seed time. `recordTransition` now refuses self-approval, duplicate-principal approval, and approving one's own edit with structured codes (`self_approval_refused`, `duplicate_principal_refused`); approving a four-eyes case routes through the `primary_approved` / `secondary_approved` kinds based on current state.
- The review handler maps two new actions, `primary-approve` and `secondary-approve`, to the matching event kinds for callers that want explicit semantics. The legacy `approve` action remains valid and is auto-routed for four-eyes-enforced cases. When `reviewPrincipals` are configured, the matched bearer token supplies the authoritative reviewer identity; the legacy `reviewBearerToken` is treated as one principal for backward compatibility.
- The export pipeline refuses on `unapproved_test_cases_present`; `pending_secondary_approval` is treated as not-approved-not-rejected, so a four-eyes case with only one approval blocks export deterministically. It also refuses `approved`/`exported`/`transferred` four-eyes snapshots missing distinct primary/secondary reviewers, timestamps, or approver membership with `review_state_inconsistent`.

### Unchanged (Issue #1376)

- The Wave 1 single-reviewer flow (#1365) is preserved bit-identically when `fourEyesEnforced=false` for every case in the snapshot. Existing operator profiles, legacy snapshots, and Wave 1 fixture replays are untouched.
- No new runtime dependency, telemetry, or external schema library is introduced; validators remain hand-rolled and atomic writes continue to use `${path}.${pid}.tmp` rename.
- The pre-existing forward-compatibility hint on `ReviewSnapshot.fourEyesEnforced` is honored: prior snapshots that emitted the field default-false validate against the new schema unchanged.

---

## [3.29.0] - 2026-04-25

### Added (Issue #1371)

- `FINOPS_BUDGET_REPORT_SCHEMA_VERSION` (`"1.0.0"`) and `FINOPS_BUDGET_REPORT_ARTIFACT_FILENAME` (`budget-report.json`) — version stamp and canonical filename for the persisted FinOps budget report. The artifact lives under `<runDir>/finops/` (constant `FINOPS_ARTIFACT_DIRECTORY`) so an operator can browse cost reports separately from the Wave 1 evidence artifacts.
- `ALLOWED_FINOPS_ROLES` (`test_generation`, `visual_primary`, `visual_fallback`) and discriminant `FinOpsRole` — per-role split that the report attests in lockstep with the gateway's role-separated bundle.
- `ALLOWED_FINOPS_BUDGET_BREACH_REASONS` and discriminant `FinOpsBudgetBreachReason` — policy-readable reasons (`max_input_tokens`, `max_output_tokens`, `max_wall_clock_ms`, `max_retries`, `max_attempts`, `max_image_bytes`, `max_total_input_tokens`, `max_total_output_tokens`, `max_total_wall_clock_ms`, `max_replay_cache_miss_rate`, `max_fallback_attempts`, `max_live_smoke_calls`, `max_estimated_cost`).
- `ALLOWED_FINOPS_JOB_OUTCOMES` and discriminant `FinOpsJobOutcome` — terminal outcomes the report stamps (`completed`, `completed_cache_hit`, `budget_exceeded`, `policy_blocked`, `validation_blocked`, `visual_sidecar_failed`, `export_refused`, `gateway_failed`).
- New exported types: `FinOpsRoleBudget`, `FinOpsBudgetEnvelope`, `FinOpsCostRate`, `FinOpsCostRateMap`, `FinOpsRoleUsage`, `FinOpsBudgetBreach`, `FinOpsBudgetReport`. Hard invariants on the report: `secretsIncluded: false`, `rawPromptsIncluded: false`, `rawScreenshotsIncluded: false` (TYPE-LEVEL `false` literals).
- New optional fields on `LlmGenerationRequest`: `maxWallClockMs` (fail-closed when exceeded — returns `retryable: false`) and `maxRetries` (per-request override capped against the static client config). Both were previously not configurable per request.
- `Wave1PocEvidenceArtifactCategory` gains a new variant `"finops"` so future Wave 2 manifests can attest the FinOps report category if a verifier extends the manifest's path-resolution surface.
- New module `src/test-intelligence/finops-budget.ts` — envelope factory, deep-clone, validator (`validateFinOpsBudgetEnvelope`), `EU_BANKING_DEFAULT_FINOPS_BUDGET` profile, `DEFAULT_FINOPS_BUDGET_ENVELOPE` permissive baseline, and `resolveFinOpsRequestLimits` helper that maps a role budget onto the four `LlmGenerationRequest` fields the gateway consumes.
- New module `src/test-intelligence/finops-report.ts` — `createFinOpsUsageRecorder`, `buildFinOpsBudgetReport`, `writeFinOpsBudgetReport` (atomic `${pid}.${randomUUID()}.tmp` rename). The recorder aggregates per-attempt observations with cache-hit / cache-miss tracking; cache hits never increment token or attempt counters.
- `runWave1Poc` accepts optional `finopsBudget` and `finopsCostRates` inputs and always emits `<runDir>/finops/budget-report.json`. Result type adds `finopsReport` (the in-memory `FinOpsBudgetReport`) and `finopsArtifactPath` so eval-gate and inspector code can read the report without re-parsing the file.
- Visual sidecar attempt records flow into the FinOps recorder verbatim: `VisualSidecarAttempt.deployment` decides the role (`llama-4-maverick-vision` → `visual_primary`, `phi-4-multimodal-poc` → `visual_fallback`, `mock` resolves by attempt index).

### Unchanged (Issue #1371)

- The Wave 1 evidence manifest (`Wave1PocEvidenceManifest`) does NOT attest the FinOps artifact because the manifest verifier resolves artifacts at the run-dir root only (basename invariant). The FinOps artifact is verifiable independently via its negative-invariant fields and its own schema/contract stamps.
- `gpt-oss-120b` (`test_generation`) still NEVER receives image payloads. The new `imageBytes` counter on `FinOpsRoleUsage` is non-zero only for visual roles.
- Cache-hit jobs report no LLM call and no new token usage: `recordCacheHit()` increments only the cache-hit counter, leaving every other counter at zero.

---

## [3.28.0] - 2026-04-25

### Added (Issue #1368)

- `DRY_RUN_REPORT_SCHEMA_VERSION` (`"1.0.0"`) and `DRY_RUN_REPORT_ARTIFACT_FILENAME` (`dry-run-report.json`) — version stamp and canonical filename for the persisted QC adapter dry-run report envelope (covers profile validation, mapping completeness, folder resolution state, planned-entity payload preview, and visual evidence flags).
- `ALLOWED_QC_ADAPTER_MODES` — runtime list of transfer modes recognised by the QC adapter facade (`export_only`, `dry_run`, `api_transfer`). The `api_transfer` mode is intentionally not implemented in Wave 2 and surfaces `mode_not_implemented` so the export pipeline can fail-closed.
- `ALLOWED_QC_ADAPTER_PROVIDERS` — runtime list of provider discriminators recognised by the QC adapter facade (`opentext_alm`, `opentext_octane`, `opentext_valueedge`, `xray`, `testrail`, `azure_devops_test_plans`, `qtest`, `custom`). Wave 2 ships only the `opentext_alm` adapter; the rest are reserved identifiers so future adapters plug in without contract churn.
- `ALLOWED_QC_MAPPING_PROFILE_ISSUE_CODES` — runtime list of mapping-profile validator codes (`missing_base_url_alias`, `invalid_base_url_alias`, `missing_domain`, `missing_project`, `missing_target_folder_path`, `invalid_target_folder_path`, `missing_test_entity_type`, `unsupported_test_entity_type`, `missing_required_fields`, `duplicate_required_field`, `missing_design_step_mapping`, `design_step_mapping_field_invalid`, `credential_like_field_present`, `provider_mismatch`, `profile_id_mismatch`).
- `ALLOWED_DRY_RUN_REFUSAL_CODES` — runtime list of refusal codes the dry-run adapter may emit (`no_mapped_test_cases`, `mapping_profile_invalid`, `provider_mismatch`, `mode_not_implemented`, `folder_resolution_failed`).
- `ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES` — runtime list of folder-resolution states under `dry_run` (`resolved`, `missing`, `simulated`, `invalid_path`).
- New exported types: `QcAdapterMode`, `QcAdapterProvider`, `QcMappingProfile`, `QcMappingProfileIssue`, `QcMappingProfileIssueCode`, `QcMappingProfileValidationResult`, `DryRunRefusalCode`, `DryRunFolderResolutionState`, `DryRunFolderResolution`, `DryRunMappingCompletenessEntry`, `DryRunMappingCompletenessSummary`, `DryRunPlannedEntityPayload`, `DryRunVisualEvidenceFlag`, `DryRunReportArtifact`.
- Provider-neutral `QcAdapter` interface (`src/test-intelligence/qc-adapter.ts`) — narrow façade exposing `provider`, `validateProfile`, and `dryRun`. The interface accepts injected `QcAdapterClock`, `QcAdapterIdSource`, and `QcFolderResolver` so dry-run output is bit-identical across runs and never performs I/O on the QC tool.
- OpenText ALM dry-run adapter (`openTextAlmDryRunAdapter`, `createOpenTextAlmDryRunAdapter`) — implements `QcAdapter` for the `opentext_alm` provider. Validates the supplied mapping profile (rejects credential-shaped fields, validates `/Subject/...` folder paths, surfaces missing required fields), simulates target folder resolution via the injected resolver, and emits a redacted `DryRunReportArtifact` with hard `rawScreenshotsIncluded: false` + `credentialsIncluded: false` invariants stamped at the type level. Visual sidecar evidence flows through as `visualEvidenceFlags` for cases whose mapping derives only from low-confidence sidecar observations.
- Hand-rolled mapping-profile validator (`validateQcMappingProfile`, `cloneOpenTextAlmDefaultMappingProfile`, `OPENTEXT_ALM_DEFAULT_MAPPING_PROFILE`) — `ValidationIssue[]`-style diagnostics with JSON-pointer-shaped paths and severity-tagged outcomes. Designed to plug into a UI form without re-walking the structure.

### Unchanged (Issue #1368)

- `export_only` pipeline (`runExportPipeline`) is byte-identical to its 3.27.0 emission; the dry-run adapter is a sibling surface, not a rewrite.
- The hard invariant that no QC credentials, no API URLs, and no raw screenshots are persisted in any artifact remains stamped at the type level on both `ExportReportArtifact` and the new `DryRunReportArtifact`.
- The `api_transfer` mode is intentionally NOT implemented in Wave 2 — calling it on the dry-run adapter throws `QcAdapterModeNotImplementedError` so callers can surface a deterministic refusal code.

---

## [3.27.0] - 2026-04-25

### Added (Issue #1386)

- `VISUAL_SIDECAR_RESULT_SCHEMA_VERSION` (`"1.0.0"`) and `VISUAL_SIDECAR_RESULT_ARTIFACT_FILENAME` (`visual-sidecar-result.json`) — version stamp and canonical filename for the persisted multimodal visual sidecar result envelope (covers capture identities, attempts, fallback reason, and the embedded validation report).
- `ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES` — runtime list of policy-readable failure classes for the visual sidecar client (`primary_unavailable`, `primary_quota_exceeded`, `both_sidecars_failed`, `schema_invalid_response`, `image_payload_too_large`, `image_mime_unsupported`, `duplicate_screen_id`, `empty_screen_capture_set`).
- `ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES` — runtime list of MIME types accepted as multimodal sidecar capture input (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). SVG is intentionally excluded because of the XML/injection surface.
- `MAX_VISUAL_SIDECAR_INPUT_BYTES` (`5 * 1024 * 1024`) — maximum decoded byte size of a single capture, enforced after base64 decoding.
- New exported types: `VisualSidecarFailureClass`, `VisualSidecarInputMimeType`, `VisualSidecarCaptureInput`, `VisualSidecarCaptureIdentity`, `VisualSidecarAttempt`, `VisualSidecarSuccess`, `VisualSidecarFailure`, `VisualSidecarResult`, `VisualSidecarResultArtifact`, `Wave1PocEvidenceVisualSidecarSummary`.
- Visual sidecar client (`describeVisualScreens` in `src/test-intelligence/visual-sidecar-client.ts`) — primary→fallback routing over `LlmGatewayClientBundle`, deterministic mock-friendly request shape, hand-rolled JSON-Schema gate on the sidecar envelope, `validateVisualSidecar` integration, atomic artifact persistence, and a defence-in-depth helper `assertNoImagePayloadToTestGeneration` that walks recorded gateway requests for the `test_generation` role.
- `runWave1Poc` accepts an optional `visualCaptures` + `bundle` pair so the POC can produce `VisualScreenDescription[]` from a multimodal sidecar call instead of a fixture JSON. Emits the new `visual-sidecar-result.json` artifact and adds it to the evidence manifest under the new `visual_sidecar` category. Failure results are persisted and manifest-attested before the harness refuses downstream generation. The default fixture-driven path is unchanged.
- `Wave1PocEvidenceManifest.visualSidecar` — optional direct summary of the selected sidecar deployment, fallback reason, confidence summary, and SHA-256 of `visual-sidecar-result.json` when the opt-in sidecar path runs.
- `pnpm run test:ti-live-smoke` — operator-controlled live visual-sidecar smoke test, disabled by default and enabled only with `WORKSPACE_TEST_SPACE_LIVE_SMOKE=1` plus the role-specific `WORKSPACE_TEST_SPACE_*` endpoint/deployment env vars and `WORKSPACE_TEST_SPACE_API_KEY`.
- `Wave1PocEvidenceArtifactCategory` gains a new variant `"visual_sidecar"`.

### Unchanged (Issue #1386)

- The hard invariant that the structured-test-case generator (`gpt-oss-120b`) never receives image payloads remains stamped at the type level (`imagePayloadSentToTestGeneration: false`).
- `rawScreenshotsIncluded: false` is enforced for both the evidence manifest and the new visual sidecar result artifact: only SHA-256 hashes of the captures are persisted, never the raw bytes.
- Existing `*.visual.json` POC fixtures and golden artifacts are byte-stable; the new sidecar entry point is opt-in.

---

## [3.26.0] - 2026-04-25

### Added (Issue #1367)

- New optional `WorkspaceStartOptions.testIntelligence.reviewBearerToken` and `WorkspaceStartOptions.testIntelligence.artifactRoot` fields. The bearer token gates `POST /workspace/test-intelligence/review/...` write actions fail-closed (503 when unset). The artifact root overrides the default `<outputRoot>/test-intelligence` directory used by the Inspector UI.
- New optional `WorkspaceStatus.testIntelligenceEnabled` boolean exposed from `GET /workspace`. The Inspector UI uses this flag to gate the "Test Intelligence" navigation entry.
- New routes mounted at `/workspace/test-intelligence/...`. All routes return `503 FEATURE_DISABLED` when the existing test-intelligence dual-gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` + `WorkspaceStartOptions.testIntelligence.enabled`) is not satisfied:
    - `GET /workspace/test-intelligence/jobs` — list jobs that have on-disk artifacts.
    - `GET /workspace/test-intelligence/jobs/<jobId>` — composite read of the per-job artifact bundle (generated test cases, validation report, policy report, coverage report, visual sidecar report, QC mapping preview, export report, review snapshot, review events). Returns `404 JOB_NOT_FOUND` when no artifact directory exists for the job.
    - `GET /workspace/test-intelligence/review/<jobId>/state` — read the review-gate snapshot and event log via the existing in-process review handler.
    - `POST /workspace/test-intelligence/review/<jobId>/<action>[/<testCaseId>]` — record a review-gate transition (`approve`, `reject`, `edit`, `note`, `review-started`). Bearer-protected fail-closed; rate-limited per IP+jobId.

### Unchanged (Issue #1367)

- Job submission contract is unchanged; `figma_to_qc_test_cases` continues to return `501 NOT_IMPLEMENTED` until a future wave wires the runner.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected.
- The hard invariant that the structured-test-case generator deployment never receives image payloads remains stamped in every emitted artifact.

---

## [3.25.0] - 2026-04-25

### Added (Issue #1366)

- `WAVE1_POC_EVIDENCE_MANIFEST_SCHEMA_VERSION`, `WAVE1_POC_EVAL_REPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 POC evidence manifest and evaluation report.
- `WAVE1_POC_EVIDENCE_MANIFEST_ARTIFACT_FILENAME` (`wave1-poc-evidence-manifest.json`), `WAVE1_POC_EVIDENCE_MANIFEST_DIGEST_FILENAME` (`wave1-poc-evidence-manifest.sha256`), `WAVE1_POC_EVAL_REPORT_ARTIFACT_FILENAME` (`wave1-poc-eval-report.json`) — canonical filenames for the evidence manifest, its digest witness, and the evaluation report artifacts.
- `WAVE1_POC_FIXTURE_IDS` — runtime list of public synthetic fixture identifiers (`poc-onboarding`, `poc-payment-auth`).
- `Wave1PocFixtureId` — discriminated union of the supported fixture identifiers.
- `Wave1PocEvidenceArtifact`, `Wave1PocEvidenceArtifactCategory`, `Wave1PocEvidenceManifest`, `Wave1PocEvidenceVerificationResult` — type surface for the new evidence manifest, including the hard `rawScreenshotsIncluded: false` and `imagePayloadSentToTestGeneration: false` invariants enforced at the type level.
- `Wave1PocEvalThresholds`, `Wave1PocEvalFailure`, `Wave1PocEvalFixtureMetrics`, `Wave1PocEvalFixtureReport`, `Wave1PocEvalReport` — type surface for the evaluation gate covering trace coverage, QC mapping completeness, duplicate similarity, expected results per case, and policy/visual/export gate outcomes.

### Unchanged (Issue #1366)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The Wave 1 POC harness, evidence manifest builder/verifier, fixture loader, and evaluation gate live entirely under `src/test-intelligence/` and are reached only via the opt-in test-intelligence subsurface.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected.
- The structured-test-case generator deployment (`gpt-oss-120b`) never receives image payloads; image-bearing payloads only flow into the visual sidecar role. The new manifest stamps this invariant explicitly.

---

## [3.24.0] - 2026-04-25

### Added (Issue #1365)

- `REVIEW_GATE_SCHEMA_VERSION`, `QC_MAPPING_PREVIEW_SCHEMA_VERSION`, `EXPORT_REPORT_SCHEMA_VERSION`, `ALM_EXPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 review gate, QC mapping preview, export-report, and OpenText ALM reference XML artifacts.
- `REVIEW_EVENTS_ARTIFACT_FILENAME`, `REVIEW_STATE_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_JSON_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_CSV_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_XLSX_ARTIFACT_FILENAME`, `EXPORT_TESTCASES_ALM_XML_ARTIFACT_FILENAME`, `QC_MAPPING_PREVIEW_ARTIFACT_FILENAME`, `EXPORT_REPORT_ARTIFACT_FILENAME` — canonical filenames for the eight persisted review-gate and export-only QC artifacts.
- `OPENTEXT_ALM_REFERENCE_PROFILE_ID`, `OPENTEXT_ALM_REFERENCE_PROFILE_VERSION`, `ALM_EXPORT_XML_NAMESPACE` — built-in OpenText ALM reference export profile identity and root XML namespace.
- `ALLOWED_REVIEW_STATES` — runtime list (`generated`, `needs_review`, `approved`, `rejected`, `edited`, `exported`, `transferred`).
- `ALLOWED_REVIEW_EVENT_KINDS` — runtime list (`generated`, `review_started`, `approved`, `rejected`, `edited`, `exported`, `transferred`, `note`).
- `ALLOWED_EXPORT_REFUSAL_CODES` — runtime list of fail-closed refusal codes covering missing approvals, residual unapproved cases, residual policy-blocked cases, residual schema-invalid cases, blocked visual sidecar, and inconsistent review state.
- `ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES` — runtime list of declared content types (`application/json`, `text/csv`, `application/xml`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- `ReviewState`, `ReviewEventKind`, `ReviewEvent`, `ReviewSnapshot`, `ReviewGateSnapshot` — type surface for the persisted review-gate event log and snapshot.
- `ExportRefusalCode`, `ExportArtifactContentType`, `ExportArtifactRecord`, `ExportReportArtifact` — type surface for the persisted export-report artifact, including the hard `rawScreenshotsIncluded: false` invariant.
- `QcMappingVisualProvenance`, `QcMappingPreviewEntry`, `QcMappingPreviewArtifact` — type surface for the QC mapping preview artifact, including model role names, deployment names, schema versions, evidence hashes, and source trace references.
- `OpenTextAlmExportProfile` — operator-tunable knobs for the reference ALM XML export.

### Unchanged (Issue #1365)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The review gate, export pipeline, and bearer-protected handler live entirely under `src/test-intelligence/`. The handler mirrors the import-session governance bearer pattern (`validateImportSessionEventWriteAuth`) but is invoked through an in-process API so the public HTTP surface is unaffected.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate review or export gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; review and export logic is reachable only from the test-intelligence subsurface.
- Production QC/ALM API writes are intentionally out of scope for Wave 1; the export pipeline emits deterministic on-disk artifacts only.

---

## [3.23.0] - 2026-04-25

### Added (Issue #1364)

- `TEST_CASE_VALIDATION_REPORT_SCHEMA_VERSION`, `TEST_CASE_POLICY_REPORT_SCHEMA_VERSION`, `TEST_CASE_COVERAGE_REPORT_SCHEMA_VERSION`, `VISUAL_SIDECAR_VALIDATION_REPORT_SCHEMA_VERSION` — version stamps (`"1.0.0"`) for the persisted Wave 1 validation, policy, coverage, and visual-sidecar gate artifacts.
- `GENERATED_TESTCASES_ARTIFACT_FILENAME`, `TEST_CASE_VALIDATION_REPORT_ARTIFACT_FILENAME`, `TEST_CASE_POLICY_REPORT_ARTIFACT_FILENAME`, `TEST_CASE_COVERAGE_REPORT_ARTIFACT_FILENAME`, `VISUAL_SIDECAR_VALIDATION_REPORT_ARTIFACT_FILENAME` — canonical filenames for the four persisted reports plus the gated test-case payload.
- `EU_BANKING_DEFAULT_POLICY_PROFILE_ID`, `EU_BANKING_DEFAULT_POLICY_PROFILE_VERSION` — built-in `eu-banking-default` policy profile identity stamp shipped with Wave 1.
- `ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES` — runtime source-of-truth list of semantic / structural validation issue codes consumed by the validation pipeline.
- `ALLOWED_TEST_CASE_POLICY_DECISIONS` — runtime list (`approved`, `blocked`, `needs_review`).
- `ALLOWED_TEST_CASE_POLICY_OUTCOMES` — runtime list of policy outcome codes covering missing-trace, missing-expected-results, PII in test data, missing negative/validation case, missing accessibility/boundary case, schema invalid, duplicate, regulated-risk review, ambiguity review, QC mapping not exportable, low confidence, open questions, plus the visual-sidecar codes (`visual_sidecar_failure`, `visual_sidecar_fallback_used`, `visual_sidecar_low_confidence`, `visual_sidecar_possible_pii`, `visual_sidecar_prompt_injection_text`).
- `ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES` — runtime list of visual-sidecar gate outcomes (`ok`, `schema_invalid`, `low_confidence`, `fallback_used`, `possible_pii`, `prompt_injection_like_text`, `conflicts_with_figma_metadata`, `primary_unavailable`).
- `TestCaseValidationIssue`, `TestCaseValidationReport`, `TestCaseValidationIssueCode`, `TestCaseValidationSeverity` — type surface for the persisted validation diagnostics.
- `TestCasePolicyDecision`, `TestCasePolicyOutcome`, `TestCasePolicyViolation`, `TestCasePolicyDecisionRecord`, `TestCasePolicyReport`, `TestCasePolicyProfile`, `TestCasePolicyProfileRules` — type surface for the policy gate.
- `TestCaseCoverageBucket`, `TestCaseCoverageReport`, `TestCaseDuplicatePair` — type surface for the coverage / quality-signals report and duplicate detection.
- `VisualSidecarValidationOutcome`, `VisualSidecarValidationRecord`, `VisualSidecarValidationReport` — type surface for the visual-sidecar gate.

### Unchanged (Issue #1364)

- No public route, submit parser, runtime schema, or orchestrator wiring changed. The validation, policy, coverage, and visual-sidecar gate live entirely under `src/test-intelligence/` and are consumed by Issue #1365 (review gate) and Issue #1366 (POC fixture / CI evaluation gate) in later waves.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate validation gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; the validation pipeline is reachable only from the test-intelligence subsurface.

---

## [3.22.0] - 2026-04-25

### Added (Issue #1363 follow-up)

- `WorkspaceJobArtifacts.llmCapabilitiesEvidenceDir` — optional public artifact pointer for per-role LLM capability evidence written under the job artifact tree.
- `LlmCapabilityProbeCapability` — probe-row discriminant type that covers declared capability flags plus the mandatory `textChat` baseline probe.
- `STAGE_ARTIFACT_KEYS.llmCapabilitiesEvidence` — internal artifact-store key for role-separated `llm-capabilities.json` evidence directories.

### Changed (Issue #1363 follow-up)

- `LLM_CAPABILITIES_SCHEMA_VERSION` from `"1.0.0"` to `"1.1.0"` because persisted probe rows now include the mandatory `textChat` baseline and no longer mark streaming as supported without network evidence.
- `openai_chat` request construction now uses the documented chat-completions path shape and Chat Completions token-budget field (`max_completion_tokens`).

---

## [3.21.0] - 2026-04-25

### Added (Issue #1363)

- `LLM_GATEWAY_CONTRACT_VERSION` — version stamp (`"1.0.0"`) for the role-separated LLM gateway client surface.
- `LLM_CAPABILITIES_SCHEMA_VERSION` — version stamp (`"1.0.0"`) for the persisted capability probe artifact.
- `LLM_CAPABILITIES_ARTIFACT_FILENAME` — canonical filename (`"llm-capabilities.json"`) for the persisted capability probe artifact.
- `ALLOWED_LLM_GATEWAY_ROLES` — runtime source-of-truth list of role discriminants (`test_generation`, `visual_primary`, `visual_fallback`).
- `ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES` — runtime source-of-truth list (`openai_chat`); future modes (`openai_responses`, `custom_adapter`) plug in here without changing call sites.
- `ALLOWED_LLM_GATEWAY_AUTH_MODES` — runtime source-of-truth list (`api_key`, `bearer_token`, `none`).
- `ALLOWED_LLM_GATEWAY_ERROR_CLASSES` — runtime source-of-truth list (`refusal`, `schema_invalid`, `incomplete`, `timeout`, `rate_limited`, `transport`, `image_payload_rejected`).
- `LlmGatewayRole`, `LlmGatewayCompatibilityMode`, `LlmGatewayAuthMode`, `LlmGatewayErrorClass` — discriminant types over the allow-lists above.
- `LlmGatewayCapabilities`, `LlmCapabilityProbeOutcome`, `LlmCapabilityProbeRecord`, `LlmCapabilitiesArtifact` — typed shape of the declared/observed capabilities and the persisted `llm-capabilities.json` evidence artifact.
- `LlmGatewayCircuitBreakerConfig`, `LlmGatewayClientConfig` — construction-time configuration shapes. The config object never carries an API token; tokens are read at request time via an injected provider callback.
- `LlmImageInput`, `LlmReasoningEffort`, `LlmGenerationRequest`, `LlmFinishReason`, `LlmGenerationSuccess`, `LlmGenerationFailure`, `LlmGenerationResult` — wire-shaped request/response surface for `LlmGatewayClient.generate`. The success branch never carries chain-of-thought or reasoning traces.

### Unchanged (Issue #1363)

- No runtime schema, submit parser, public route, or orchestrator wiring changed. The gateway client lives entirely under `src/test-intelligence/` and is consumed by Issues #1364 (policy gate), #1365 (review gate), and #1386 (visual sidecar) in later waves.
- The opt-in test-intelligence feature gate (`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE`, `WorkspaceStartOptions.testIntelligence.enabled`) remains the only entry-point gate; no separate gateway gate is introduced.
- The deterministic Figma-to-code pipeline (`llmCodegenMode=deterministic`) is unaffected; the gateway client is reachable only from the test-intelligence subsurface.

---

## [3.20.0] - 2026-04-25

### Added (Issue #1362)

- `VISUAL_SIDECAR_SCHEMA_VERSION` — schema version constant (`"1.0.0"`) consumed by the prompt compiler to bind a `VisualScreenDescription` payload to a replay-cache key.
- `REDACTION_POLICY_VERSION` — version stamp (`"1.0.0"`) for the redaction policy bundle hashed into compiled prompt artifacts and replay-cache keys.
- `GeneratedTestCase`, `GeneratedTestCaseList`, `GeneratedTestCaseStep`, `GeneratedTestCaseFigmaTrace`, `GeneratedTestCaseQcMapping`, `GeneratedTestCaseQualitySignals`, `GeneratedTestCaseAuditMetadata`, `GeneratedTestCaseReviewState`, `TestCaseLevel`, `TestCaseType`, `TestCasePriority`, `TestCaseRiskCategory`, `TestCaseTechnique29119` — type surface modeling the structured test-case payload the LLM gateway must produce.
- `CompiledPromptRequest`, `CompiledPromptArtifacts`, `CompiledPromptHashes`, `CompiledPromptVisualBinding`, `CompiledPromptModelBinding`, `VisualSidecarFallbackReason` — type surface emitted by the prompt compiler. The artifacts variant holds only redacted material safe to persist as evidence.
- `ReplayCacheKey`, `ReplayCacheEntry`, `ReplayCacheLookupResult` — type surface for the replay-cache layer. Cache hits are the only guaranteed bit-identical replay path; lookup keys hash input IR, prompt template, JSON schema, model revision, gateway release, policy bundle, redaction policy, visual sidecar binding, fixture image hash, prompt template version, and seed.

### Unchanged (Issue #1362)

- No runtime schema, submit parser, or orchestrator wiring changed. `src/test-intelligence/prompt-compiler.ts`, `src/test-intelligence/generated-test-case-schema.ts`, and `src/test-intelligence/replay-cache.ts` are pure helper surfaces that the LLM gateway client (Issue #1363) and the policy gate (Issue #1364) will compose with in later waves.

---

## [3.19.0] - 2026-04-24

### Added (Issue #1361)

- `BUSINESS_TEST_INTENT_IR_SCHEMA_VERSION` — schema version constant (`"1.0.0"`) for the redacted Business Test Intent IR artifact consumed by the downstream test-case generator.
- `BusinessTestIntentIr`, `BusinessTestIntentIrSource`, `BusinessTestIntentScreen`, `DetectedField`, `DetectedAction`, `DetectedValidation`, `DetectedNavigation`, `InferredBusinessObject`, `PiiIndicator`, `IntentRedaction`, `IntentTraceRef`, `IntentAmbiguity`, `IntentProvenance`, `PiiKind`, `PiiMatchLocation` exported types describing the IR shape, its Figma trace references, provenance, and redaction records.
- `VisualScreenDescription` interface — public type for the optional multimodal visual sidecar consumed alongside Figma input (Issue #1386 preparation).
- `WorkspaceJobArtifacts.businessTestIntentIrFile?: string` — optional public path to the persisted `business-test-intent-ir.json` artifact when the pipeline has derived it.

### Changed (Issue #1361)

- The `ir.derive` stage now persists the redacted Business Test Intent IR artifact through the existing stage artifact store. Runtime submit schema and test-intelligence prompt generation remain unchanged.

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
