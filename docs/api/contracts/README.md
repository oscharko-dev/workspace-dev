[**workspace-dev**](../README.md)

***

[workspace-dev](../README.md) / contracts

# contracts

## Interfaces

### BusinessTestIntentIr

Redacted, deterministic test-design IR for a job.

Wave 4 (Issue #1431) introduces an additive [sourceEnvelope](#sourceenvelope) field
carrying the multi-source aggregate. The legacy [source](#source) singleton
is preserved for backward-compat: single-source Figma jobs that have not
opted into the multi-source gate keep emitting it as-is.

#### Properties

##### assumptions

> **assumptions**: `string`[]

##### detectedActions

> **detectedActions**: [`DetectedAction`](#detectedaction)[]

##### detectedFields

> **detectedFields**: [`DetectedField`](#detectedfield)[]

##### detectedNavigation

> **detectedNavigation**: [`DetectedNavigation`](#detectednavigation-1)[]

##### detectedValidations

> **detectedValidations**: [`DetectedValidation`](#detectedvalidation)[]

##### inferredBusinessObjects

> **inferredBusinessObjects**: [`InferredBusinessObject`](#inferredbusinessobject)[]

##### multiSourceConflicts?

> `optional` **multiSourceConflicts?**: [`MultiSourceConflict`](#multisourceconflict)[]

Additive conflict/report payload emitted by the deterministic multi-source
reconciliation engine (Issue #1436). Omitted for legacy single-source
jobs so existing artifacts remain byte-stable.

##### openQuestions

> **openQuestions**: `string`[]

##### piiIndicators

> **piiIndicators**: [`PiiIndicator`](#piiindicator)[]

##### redactions

> **redactions**: [`IntentRedaction`](#intentredaction)[]

##### risks

> **risks**: `string`[]

##### screens

> **screens**: [`BusinessTestIntentScreen`](#businesstestintentscreen)[]

##### source

> **source**: [`BusinessTestIntentIrSource`](#businesstestintentirsource-1)

##### sourceEnvelope?

> `optional` **sourceEnvelope?**: [`MultiSourceTestIntentEnvelope`](#multisourcetestintentenvelope)

Aggregate envelope of contributing test-design sources (Issue #1431).

Optional and additive: omitted for legacy single-source Figma jobs to
preserve byte-stable artifacts and replay-cache hits. Populated only
when both the parent [TEST\_INTELLIGENCE\_ENV](#test_intelligence_env) gate and the
[TEST\_INTELLIGENCE\_MULTISOURCE\_ENV](#test_intelligence_multisource_env) gate are enabled, and the
parent test-intelligence startup option allows multi-source ingestion.

##### version

> **version**: `"1.0.0"`

***

### BusinessTestIntentIrSource

Metadata about the input that produced the IR.

Wave 4 (Issue #1431) generalises this single-source descriptor into a
discriminated union of seven source kinds carried inside the
[MultiSourceTestIntentEnvelope](#multisourcetestintentenvelope). The legacy `source` field on
[BusinessTestIntentIr](#businesstestintentir) is kept additive for one minor cycle so
single-source Figma jobs that have not opted into the multi-source gate
keep producing bit-identical artifacts.

#### Properties

##### contentHash

> **contentHash**: `string`

##### kind

> **kind**: `"hybrid"` \| `"figma_plugin"` \| `"figma_local_json"` \| `"figma_rest"`

***

### BusinessTestIntentScreen

Per-screen slice of the intent.

#### Properties

##### screenId

> **screenId**: `string`

##### screenName

> **screenName**: `string`

##### screenPath?

> `optional` **screenPath?**: `string`

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### CompiledPromptArtifacts

Persisted, fully-redacted artifact form of a compiled prompt.

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### hashes

> **hashes**: [`CompiledPromptHashes`](#compiledprompthashes)

##### jobId

> **jobId**: `string`

##### modelBinding

> **modelBinding**: [`CompiledPromptModelBinding`](#compiledpromptmodelbinding)

##### payload

> **payload**: `object`

Redacted JSON payload that the model will reason over.

###### customContext?

> `optional` **customContext?**: [`CompiledPromptCustomContext`](#compiledpromptcustomcontext)

###### intent

> **intent**: [`BusinessTestIntentIr`](#businesstestintentir)

###### sourceMixPlan?

> `optional` **sourceMixPlan?**: [`SourceMixPlan`](#sourcemixplan-1)

###### visual

> **visual**: [`VisualScreenDescription`](#visualscreendescription)[]

##### policyBundleVersion

> **policyBundleVersion**: `string`

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

##### systemPrompt

> **systemPrompt**: `string`

##### userPrompt

> **userPrompt**: `string`

##### visualBinding

> **visualBinding**: [`CompiledPromptVisualBinding`](#compiledpromptvisualbinding)

***

### CompiledPromptCustomContext

Sanitized custom supporting context visible to prompt compilation.

#### Properties

##### markdownSections

> **markdownSections**: `object`[]

###### bodyMarkdown

> **bodyMarkdown**: `string`

###### bodyPlain

> **bodyPlain**: `string`

###### entryId

> **entryId**: `string`

###### markdownContentHash

> **markdownContentHash**: `string`

###### plainContentHash

> **plainContentHash**: `string`

###### sourceId

> **sourceId**: `string`

##### structuredAttributes

> **structuredAttributes**: `object`[]

###### contentHash

> **contentHash**: `string`

###### entryId

> **entryId**: `string`

###### key

> **key**: `string`

###### sourceId

> **sourceId**: `string`

###### value

> **value**: `string`

***

### CompiledPromptHashes

Hash bundle attached to a compiled prompt.

#### Properties

##### cacheKey

> **cacheKey**: `string`

##### inputHash

> **inputHash**: `string`

##### promptHash

> **promptHash**: `string`

##### schemaHash

> **schemaHash**: `string`

***

### CompiledPromptModelBinding

Identity of the structured-test-case generator gateway/model pair.

#### Properties

##### gatewayRelease

> **gatewayRelease**: `string`

##### modelRevision

> **modelRevision**: `string`

##### seed?

> `optional` **seed?**: `number`

Optional deterministic seed the model accepts (provider-dependent).

***

### CompiledPromptRequest

Wire-shaped request handed to the LLM gateway client.

#### Properties

##### hashes

> **hashes**: [`CompiledPromptHashes`](#compiledprompthashes)

##### jobId

> **jobId**: `string`

##### modelBinding

> **modelBinding**: [`CompiledPromptModelBinding`](#compiledpromptmodelbinding)

##### responseSchema

> **responseSchema**: `Record`\<`string`, `unknown`\>

JSON schema the gateway must enforce on the response (structured output).

##### responseSchemaName

> **responseSchemaName**: `string`

Stable schema name used by some gateways.

##### systemPrompt

> **systemPrompt**: `string`

##### userPrompt

> **userPrompt**: `string`

***

### CompiledPromptVisualBinding

Identity of the visual sidecar that produced a `VisualScreenDescription`
batch. The compiler hashes this object into the replay-cache key so that
a fallback model swap forces a cache miss.

#### Properties

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

##### fixtureImageHash?

> `optional` **fixtureImageHash?**: `string`

Hex digest of the screenshot/fixture used for visual analysis, if any.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### screenCount

> **screenCount**: `number`

Number of screens covered by the visual binding.

##### selectedDeployment

> **selectedDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

***

### CoveragePlan

Deterministic pre-generation coverage plan derived from `TestDesignModel`
plus optional source-mix context.

`mutationKillRateTarget` defaults to `0.85` when the caller does not supply
an override; callers may only provide values in the closed interval `[0, 1]`.

#### Properties

##### jobId

> `readonly` **jobId**: `string`

##### minimumCases

> `readonly` **minimumCases**: readonly [`CoverageRequirement`](#coveragerequirement)[]

##### mutationKillRateTarget

> `readonly` **mutationKillRateTarget**: `number`

##### recommendedCases

> `readonly` **recommendedCases**: readonly [`CoverageRequirement`](#coveragerequirement)[]

##### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

##### techniques

> `readonly` **techniques**: readonly (`"equivalence_partitioning"` \| `"decision_table"` \| `"state_transition"` \| `"error_guessing"` \| `"initial_state"` \| `"boundary_value"` \| `"pairwise"`)[]

***

### CoverageRequirement

A single deterministic coverage requirement emitted by `coverage-planner.ts`.

Each requirement is machine-readable and points at the model entities and
source refs that justified it. Human-readable wording is intentionally kept
out of the contract so equivalent inputs remain byte-stable.

#### Properties

##### reasonCode

> `readonly` **reasonCode**: `"screen_baseline"` \| `"element_partition"` \| `"rule_partition"` \| `"rule_boundary"` \| `"rule_decision"` \| `"action_transition"` \| `"calculation_rule"` \| `"screen_pairwise"` \| `"risk_regression"` \| `"open_question_probe"` \| `"source_reconciliation_probe"` \| `"supporting_context_probe"`

##### requirementId

> `readonly` **requirementId**: `string`

##### screenId?

> `readonly` `optional` **screenId?**: `string`

##### sourceRefs

> `readonly` **sourceRefs**: readonly `string`[]

##### targetIds

> `readonly` **targetIds**: readonly `string`[]

##### technique

> `readonly` **technique**: `"equivalence_partitioning"` \| `"decision_table"` \| `"state_transition"` \| `"error_guessing"` \| `"initial_state"` \| `"boundary_value"` \| `"pairwise"`

##### visualRefs

> `readonly` **visualRefs**: readonly `string`[]

***

### CustomContextNoteEntry

PII-redacted Markdown note persisted as custom supporting context.

#### Properties

##### authorHandle

> **authorHandle**: `string`

##### bodyMarkdown

> **bodyMarkdown**: `string`

Canonical allowlist Markdown after PII redaction.

##### bodyPlain

> **bodyPlain**: `string`

Deterministic plain-text derivative of [bodyMarkdown](#bodymarkdown).

##### capturedAt

> **capturedAt**: `string`

##### entryId

> **entryId**: `string`

##### inputFormat

> **inputFormat**: `"markdown"`

##### markdownContentHash

> **markdownContentHash**: `string`

##### piiIndicators

> **piiIndicators**: [`PiiIndicator`](#piiindicator)[]

##### plainContentHash

> **plainContentHash**: `string`

##### redactions

> **redactions**: [`IntentRedaction`](#intentredaction)[]

***

### CustomContextPolicySignal

Policy signal derived from recognized custom structured attributes.

#### Properties

##### attributeKey

> **attributeKey**: `string`

##### attributeValue

> **attributeValue**: `string`

##### contentHash

> **contentHash**: `string`

##### entryId

> **entryId**: `string`

##### reason

> **reason**: `string`

##### riskCategory

> **riskCategory**: [`TestCaseRiskCategory`](#testcaseriskcategory)

##### sourceId

> **sourceId**: `string`

***

### CustomContextSource

Persisted custom-context source artifact.

#### Properties

##### aggregateContentHash

> **aggregateContentHash**: `string`

##### noteEntries

> **noteEntries**: [`CustomContextNoteEntry`](#customcontextnoteentry)[]

##### sourceKind

> **sourceKind**: `"custom_text"` \| `"custom_structured"`

##### structuredEntries

> **structuredEntries**: [`CustomContextStructuredEntry`](#customcontextstructuredentry)[]

##### version

> **version**: `"1.0.0"`

***

### CustomContextStructuredEntry

Validated machine-checkable custom supporting attributes.

#### Properties

##### attributes

> **attributes**: `object`[]

###### key

> **key**: `string`

###### value

> **value**: `string`

##### authorHandle

> **authorHandle**: `string`

##### capturedAt

> **capturedAt**: `string`

##### contentHash

> **contentHash**: `string`

##### entryId

> **entryId**: `string`

##### piiIndicators

> **piiIndicators**: [`PiiIndicator`](#piiindicator)[]

##### redactions

> **redactions**: [`IntentRedaction`](#intentredaction)[]

***

### DedupeCaseVerdict

Per-case verdict computed from the dedupe pipeline.

#### Properties

##### isDuplicate

> **isDuplicate**: `boolean`

`true` when the case has at least one internal duplicate
finding above the configured threshold OR an external
lookup match.

##### matchedSources

> **matchedSources**: (`"lexical"` \| `"embedding"` \| `"external_lookup"`)[]

Sorted-and-deduplicated list of similarity sources that fired.

##### maxInternalSimilarity

> **maxInternalSimilarity**: `number`

Highest similarity observed for this case across internal sources.

##### testCaseId

> **testCaseId**: `string`

***

### DedupeExternalFinding

Single external duplicate finding (against an external QC folder).

#### Properties

##### externalIdCandidate

> **externalIdCandidate**: `string`

##### matchedEntityId?

> `optional` **matchedEntityId?**: `string`

Stable opaque identifier of the matched entity in the target
system. Treated as opaque — never logged or persisted alongside
any URL or token.

##### matchedFolderPath?

> `optional` **matchedFolderPath?**: `string`

Resolved folder path of the existing entity in the target system.

##### source

> **source**: `"external_lookup"`

##### testCaseId

> **testCaseId**: `string`

***

### DedupeInternalFinding

Single internal duplicate finding (within the current job).

#### Properties

##### leftTestCaseId

> **leftTestCaseId**: `string`

##### rightTestCaseId

> **rightTestCaseId**: `string`

##### similarity

> **similarity**: `number`

Similarity in [0, 1], rounded to 6 digits.

##### source

> **source**: `"lexical"` \| `"embedding"`

***

### DetectedAction

Action/control inferred from a screen (e.g. Submit button).

Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
[DetectedField](#detectedfield) for backward-compat semantics.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

##### confidence

> **confidence**: `number`

##### id

> **id**: `string`

##### kind

> **kind**: `string`

##### label

> **label**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

##### screenId

> **screenId**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing sources (Issue #1431). Optional, additive.

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### DetectedField

Input field inferred from a screen.

Wave 4 (Issue #1431) adds the optional `sourceRefs` array so the
derivation pipeline can record every source that contributed to this
field. The legacy singular `trace` and `provenance` fields keep
working unchanged for single-source jobs.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

##### confidence

> **confidence**: `number`

##### defaultValue?

> `optional` **defaultValue?**: `string`

##### id

> **id**: `string`

##### label

> **label**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

##### screenId

> **screenId**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing sources (Issue #1431). Optional, additive.

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

##### type

> **type**: `string`

***

### DetectedNavigation

Navigation edge inferred from prototype links or equivalent.

Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
[DetectedField](#detectedfield) for backward-compat semantics.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

##### confidence

> **confidence**: `number`

##### id

> **id**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

##### screenId

> **screenId**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing sources (Issue #1431). Optional, additive.

##### targetScreenId

> **targetScreenId**: `string`

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

##### triggerElementId?

> `optional` **triggerElementId?**: `string`

***

### DetectedValidation

Validation rule inferred from design hints.

Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
[DetectedField](#detectedfield) for backward-compat semantics.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

##### confidence

> **confidence**: `number`

##### id

> **id**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

##### rule

> **rule**: `string`

##### screenId

> **screenId**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing sources (Issue #1431). Optional, additive.

##### targetFieldId?

> `optional` **targetFieldId?**: `string`

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### DryRunFolderResolution

Outcome of attempting to resolve a target folder under `dry_run`.

#### Properties

##### evidence

> **evidence**: `string`

Free-form, redacted evidence string supplied by the resolver (e.g.
`"simulated:matched-segments=3"`). Never includes a URL or token.

##### path

> **path**: `string`

##### state

> **state**: `"resolved"` \| `"missing"` \| `"simulated"` \| `"invalid_path"`

***

### DryRunMappingCompletenessEntry

Per-test-case completeness row inside the dry-run report.

#### Properties

##### complete

> **complete**: `boolean`

True when every required field is populated AND the entry is exportable.

##### externalIdCandidate

> **externalIdCandidate**: `string`

##### missingRequiredFields

> **missingRequiredFields**: `string`[]

Required field names whose mapped value was missing on the case.

##### testCaseId

> **testCaseId**: `string`

***

### DryRunMappingCompletenessSummary

Aggregate mapping completeness summary.

#### Properties

##### completeCases

> **completeCases**: `number`

##### incompleteCases

> **incompleteCases**: `number`

##### missingFieldsAcrossCases

> **missingFieldsAcrossCases**: `string`[]

Distinct missing-field names across all cases, sorted.

##### perCase

> **perCase**: [`DryRunMappingCompletenessEntry`](#dryrunmappingcompletenessentry)[]

##### totalCases

> **totalCases**: `number`

***

### DryRunPlannedEntityPayload

Per-test-case planned ALM entity payload preview (REDACTED).

#### Properties

##### designStepCount

> **designStepCount**: `number`

Number of design steps in the planned payload.

##### externalIdCandidate

> **externalIdCandidate**: `string`

##### fields

> **fields**: `object`[]

Mapped QC fields (deterministic, redacted, no credentials).

###### name

> **name**: `string`

###### value

> **value**: `string`

##### targetFolderPath

> **targetFolderPath**: `string`

##### testCaseId

> **testCaseId**: `string`

##### testEntityType

> **testEntityType**: `string`

##### visualAmbiguityFlags?

> `optional` **visualAmbiguityFlags?**: (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

Sorted, de-duplicated set of non-`ok` outcome codes contributing to the
matching visual records. Surfaces ambiguity reasons (`low_confidence`,
`schema_invalid`, etc.) without re-emitting the raw issue text. Absent
when no records match. Issue #1374.

##### visualConfidence?

> `optional` **visualConfidence?**: `number`

Mean visual-sidecar confidence (0..1) across matching screen records,
rounded to 4 decimals for byte-stability. Issue #1374 multimodal
addendum (2026-04-24). Absent (no key set) when the case has no
matching visual records or when emitted by the dry-run stub adapter.

##### visualEvidenceRefs?

> `optional` **visualEvidenceRefs?**: `object`[]

Sorted by `screenId`, `modelDeployment`, then `evidenceHash`.
Each ref carries a derivative identity hash that lets a reviewer
correlate the planned payload back to the per-screen validation record
without re-importing raw screenshot bytes. Absent when no records match.
Issue #1374.

Field semantics:
  - `screenId` — matching `VisualSidecarValidationRecord.screenId`.
  - `modelDeployment` — sourced verbatim from
    `VisualSidecarValidationRecord.deployment`. The contract historically
    uses the field name `deployment` on the record; this ref re-exposes
    it under `modelDeployment` to align with the broader replay-cache
    idiom (see `SelfVerifyRubricReplayCacheKey.modelDeployment`).
  - `evidenceHash` — `sha256` hex of the canonical validation-record
    identity tuple `(screenId|deployment|sortedOutcomes|roundedConfidence)`.
    Note this is NOT a hash of screenshot bytes — the dry-run adapter
    never receives image bytes. The `VisualSidecarCaptureIdentity.sha256`
    (image-byte hash) lives only on the upstream
    `VisualSidecarSuccess` artifact, which dry-run does not consume.

###### evidenceHash

> **evidenceHash**: `string`

###### modelDeployment

> **modelDeployment**: `string`

###### screenId

> **screenId**: `string`

##### visualFallbackUsed?

> `optional` **visualFallbackUsed?**: `boolean`

True when at least one matching visual record carries the
`fallback_used` outcome — i.e. the secondary multimodal deployment
produced the description the case relies on. Absent when no records
match. Issue #1374.

***

### DryRunReportArtifact

Aggregate dry-run report artifact.

#### Properties

##### adapter

> **adapter**: `object`

###### provider

> **provider**: `"opentext_alm"` \| `"opentext_octane"` \| `"opentext_valueedge"` \| `"xray"` \| `"testrail"` \| `"azure_devops_test_plans"` \| `"qtest"` \| `"custom"`

###### version

> **version**: `string`

##### completeness

> **completeness**: [`DryRunMappingCompletenessSummary`](#dryrunmappingcompletenesssummary)

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### credentialsIncluded

> **credentialsIncluded**: `false`

Hard invariant: credentials are never embedded into dry-run payloads.

##### folderResolution

> **folderResolution**: [`DryRunFolderResolution`](#dryrunfolderresolution)

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### mode

> **mode**: `"dry_run"` \| `"export_only"` \| `"api_transfer"`

##### plannedPayloads

> **plannedPayloads**: [`DryRunPlannedEntityPayload`](#dryrunplannedentitypayload)[]

Sorted by `testCaseId`. Empty when the report is refused.

##### profile

> **profile**: `object`

###### id

> **id**: `string`

###### version

> **version**: `string`

##### profileValidation

> **profileValidation**: [`QcMappingProfileValidationResult`](#qcmappingprofilevalidationresult)

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: raw screenshots are never embedded into dry-run payloads.

##### refusalCodes

> **refusalCodes**: (`"provider_mismatch"` \| `"no_mapped_test_cases"` \| `"mapping_profile_invalid"` \| `"mode_not_implemented"` \| `"folder_resolution_failed"` \| `"provider_not_implemented"`)[]

##### refused

> **refused**: `boolean`

True iff the adapter refused to produce a usable report.

##### reportId

> **reportId**: `string`

Deterministic id derived from job + adapter + profile + clock.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### visualEvidenceFlags

> **visualEvidenceFlags**: [`DryRunVisualEvidenceFlag`](#dryrunvisualevidenceflag)[]

Sorted by `testCaseId`.

***

### DryRunVisualEvidenceFlag

Visual evidence flag attached to a mapped case when the case's mapping
derives from low-confidence visual-only sidecar observations (Issue
#1386 / #1368).

#### Properties

##### ambiguityFlags

> **ambiguityFlags**: (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

Per-screen ambiguity outcome counts contributing to the flag.

##### reason

> **reason**: `"visual_only_low_confidence_mapping"`

Explicit reason classification:
  - `visual_only_low_confidence_mapping` — mapping derives only from
    sidecar observations whose confidence is below the configured
    threshold; reviewer must validate before transfer.

##### screenIds

> **screenIds**: `string`[]

Originating screen ids in the visual sidecar that drive the flag.

##### sidecarConfidence

> **sidecarConfidence**: `number`

Mean sidecar confidence across the matching screen records (0..1).

##### testCaseId

> **testCaseId**: `string`

##### traceRefs

> **traceRefs**: [`GeneratedTestCaseFigmaTrace`](#generatedtestcasefigmatrace)[]

Stable trace references — figmaTraceRefs subset that drove the mapping.

***

### EvidenceVerifyCheck

One row in the `checks` array. Carries enough context for an auditor
to identify which artifact / check passed or failed and (when failed)
why. Sorted deterministically so the response body is byte-stable
across consecutive verifications of the same on-disk run.

#### Properties

##### failureCode?

> `optional` **failureCode?**: [`EvidenceVerifyFailureCode`](#evidenceverifyfailurecode-1)

Failure code when `ok === false`. Omitted when `ok === true`.

##### kind

> **kind**: [`EvidenceVerifyCheckKind`](#evidenceverifycheckkind-1)

##### ok

> **ok**: `boolean`

##### reference

> **reference**: `string`

Safe manifest-relative artifact filename or stable check identifier.

##### signingMode?

> `optional` **signingMode?**: `"unsigned"` \| `"sigstore"`

Optional structured detail attached to attestation checks.

***

### EvidenceVerifyFailure

One row in the `failures` array. Flat, sorted by reference + code.

#### Properties

##### code

> **code**: [`EvidenceVerifyFailureCode`](#evidenceverifyfailurecode-1)

##### message

> **message**: `string`

Operator-readable diagnostic. Never includes absolute paths or secrets.

##### reference

> **reference**: `string`

Safe manifest-relative artifact filename or stable check identifier.

***

### EvidenceVerifyResponse

Response body returned by `GET /workspace/jobs/:jobId/evidence/verify`
with HTTP status 200. Status 200 means "verification completed",
regardless of pass/fail outcome — `ok` carries the verdict. The body
never contains absolute paths, bearer tokens, prompt bodies, raw
test-case payloads, env values, or signer secret material; only safe
manifest-relative filenames, SHA-256 digests, and identity stamps appear.

#### Properties

##### attestation?

> `optional` **attestation?**: `object`

Attestation summary when an attestation envelope is on disk.

###### present

> **present**: `boolean`

###### signatureCount

> **signatureCount**: `number`

###### signaturesVerified

> **signaturesVerified**: `boolean`

###### signingMode

> **signingMode**: `"unsigned"` \| `"sigstore"`

##### checks

> **checks**: [`EvidenceVerifyCheck`](#evidenceverifycheck)[]

Per-artifact + per-check verification results.

##### failures

> **failures**: [`EvidenceVerifyFailure`](#evidenceverifyfailure)[]

Flat list of every failed check, sorted by `reference`+`code`.

##### jobId

> **jobId**: `string`

##### manifestSchemaVersion?

> `optional` **manifestSchemaVersion?**: `string`

Mirrors `manifest.schemaVersion` when readable.

##### manifestSha256

> **manifestSha256**: `string`

SHA-256 of the canonical manifest bytes (computed in memory).

##### modelDeployments?

> `optional` **modelDeployments?**: `object`

Model deployment names per role from the manifest.

###### testGeneration

> **testGeneration**: `string`

###### visualFallback?

> `optional` **visualFallback?**: `string`

###### visualPrimary?

> `optional` **visualPrimary?**: `string`

##### ok

> **ok**: `boolean`

Overall verdict: true iff `failures.length === 0`.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### testIntelligenceContractVersion?

> `optional` **testIntelligenceContractVersion?**: `string`

Mirrors `manifest.testIntelligenceContractVersion` when readable.

##### verifiedAt

> **verifiedAt**: `string`

ISO-8601 timestamp the verification completed at.

##### visualSidecar?

> `optional` **visualSidecar?**: `object`

Visual sidecar metadata when the manifest carries it.

###### fallbackUsed

> **fallbackUsed**: `boolean`

###### resultArtifactSha256?

> `optional` **resultArtifactSha256?**: `string`

###### selectedDeployment?

> `optional` **selectedDeployment?**: `string`

***

### ExportArtifactRecord

Single artifact bookkeeping row inside `export-report.json`.

#### Properties

##### bytes

> **bytes**: `number`

##### contentType

> **contentType**: `"application/json"` \| `"text/csv"` \| `"application/xml"` \| `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`

##### filename

> **filename**: `string`

##### sha256

> **sha256**: `string`

SHA-256 hex of the on-disk byte stream.

***

### ExportReportArtifact

Aggregate export-report artifact.

#### Properties

##### artifacts

> **artifacts**: [`ExportArtifactRecord`](#exportartifactrecord)[]

Sorted by filename for deterministic emission.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### exportedTestCaseCount

> **exportedTestCaseCount**: `number`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### modelDeployments

> **modelDeployments**: `object`

Identity of the deployments behind the run.

###### testGeneration

> **testGeneration**: `string`

###### visualFallback?

> `optional` **visualFallback?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

###### visualPrimary?

> `optional` **visualPrimary?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

##### profileId

> **profileId**: `string`

##### profileVersion

> **profileVersion**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: raw screenshots are never embedded into export artifacts.

##### refusalCodes

> **refusalCodes**: (`"no_approved_test_cases"` \| `"unapproved_test_cases_present"` \| `"policy_blocked_cases_present"` \| `"schema_invalid_cases_present"` \| `"visual_sidecar_blocked"` \| `"review_state_inconsistent"`)[]

##### refused

> **refused**: `boolean`

True when the pipeline refused to emit any non-report artifact.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### visualEvidenceHashes

> **visualEvidenceHashes**: `string`[]

Sorted, de-duplicated.

***

### FinOpsBudgetBreach

Single budget breach record. Multiple breaches may be stamped on a
single report; the consumer can pick the first by `rule` order.

#### Properties

##### message

> **message**: `string`

Sanitized human-readable message — never carries tokens or PII.

##### observed

> **observed**: `number`

Numeric observed value (encoded as number for comparators).

##### role?

> `optional` **role?**: `"test_generation"` \| `"visual_primary"` \| `"visual_fallback"` \| `"jira_api_requests"` \| `"jira_paste_ingest"` \| `"custom_context_ingest"`

Affected role, or `undefined` for job-level rules.

##### rule

> **rule**: `"max_input_tokens"` \| `"max_output_tokens"` \| `"max_wall_clock_ms"` \| `"max_retries"` \| `"max_attempts"` \| `"max_image_bytes"` \| `"max_total_input_tokens"` \| `"max_total_output_tokens"` \| `"max_total_wall_clock_ms"` \| `"max_replay_cache_miss_rate"` \| `"max_fallback_attempts"` \| `"max_live_smoke_calls"` \| `"max_estimated_cost"` \| `"jira_api_quota_exceeded"` \| `"jira_paste_quota_exceeded"` \| `"custom_context_quota_exceeded"`

##### threshold

> **threshold**: `number`

Numeric threshold that was breached.

***

### FinOpsBudgetEnvelope

Aggregate budget envelope for a job. The envelope is rendered into the
FinOps report verbatim so an operator can read the limits applied without
cross-referencing source code.

#### Properties

##### budgetId

> **budgetId**: `string`

Stable identifier for the budget profile (operator-supplied).

##### budgetVersion

> **budgetVersion**: `string`

Free-form version label for the budget profile.

##### maxEstimatedCost?

> `optional` **maxEstimatedCost?**: `number`

Optional per-job estimated cost cap (currency-agnostic — the recorder
accepts caller-supplied per-1000-token rates). `undefined` disables the
check.

##### maxJobWallClockMs?

> `optional` **maxJobWallClockMs?**: `number`

Aggregate wall-clock cap across the entire job, all roles combined.

##### maxReplayCacheMissRate?

> `optional` **maxReplayCacheMissRate?**: `number`

Maximum permitted replay-cache miss rate over the job (`misses / total`).
`undefined` disables the check. Range `[0, 1]`.

##### roles

> **roles**: `object`

Per-role budget records. Missing roles are unconstrained.

###### custom\_context\_ingest?

> `optional` **custom\_context\_ingest?**: [`FinOpsRoleBudget`](#finopsrolebudget)

###### jira\_api\_requests?

> `optional` **jira\_api\_requests?**: [`FinOpsRoleBudget`](#finopsrolebudget)

###### jira\_paste\_ingest?

> `optional` **jira\_paste\_ingest?**: [`FinOpsRoleBudget`](#finopsrolebudget)

###### test\_generation?

> `optional` **test\_generation?**: [`FinOpsRoleBudget`](#finopsrolebudget)

###### visual\_fallback?

> `optional` **visual\_fallback?**: [`FinOpsRoleBudget`](#finopsrolebudget)

###### visual\_primary?

> `optional` **visual\_primary?**: [`FinOpsRoleBudget`](#finopsrolebudget)

##### sourceQuotas?

> `optional` **sourceQuotas?**: `object`

Per-source quota caps for non-LLM ingestion roles. Checked before any
ingestion begins; breach emits the source-specific breach reason and
fails fast without writing any artifact.

###### maxCustomContextBytesPerJob?

> `optional` **maxCustomContextBytesPerJob?**: `number`

Maximum custom-context input bytes per job. Default: `MAX_CUSTOM_CONTEXT_BYTES_PER_JOB`.

###### maxJiraApiRequestsPerJob?

> `optional` **maxJiraApiRequestsPerJob?**: `number`

Maximum Jira REST API calls per job. Default: `MAX_JIRA_API_REQUESTS_PER_JOB`.

###### maxJiraPasteBytesPerJob?

> `optional` **maxJiraPasteBytesPerJob?**: `number`

Maximum raw paste bytes per job. Default: `MAX_JIRA_PASTE_BYTES_PER_JOB`.

***

### FinOpsBudgetReport

FinOps budget report artifact. Persisted under
`<runDir>/finops/budget-report.json`. The artifact is byte-stable per job
(sorted role list, deterministic breach order). Cache-hit jobs report no
gateway usage; the `outcome` reflects this verbatim.

Negative invariants stamped explicitly so absence cannot be inferred:
  - `secretsIncluded: false`
  - `rawPromptsIncluded: false`
  - `rawScreenshotsIncluded: false`

#### Properties

##### breaches

> **breaches**: [`FinOpsBudgetBreach`](#finopsbudgetbreach)[]

Sorted by `(rule, role)`. Empty when no budget was breached.

##### budget

> **budget**: [`FinOpsBudgetEnvelope`](#finopsbudgetenvelope)

Verbatim copy of the budget envelope applied to this job.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### currencyLabel?

> `optional` **currencyLabel?**: `string`

Caller-supplied currency label. `undefined` when no rate map was supplied.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### outcome

> **outcome**: `"completed"` \| `"policy_blocked"` \| `"validation_blocked"` \| `"export_refused"` \| `"completed_cache_hit"` \| `"budget_exceeded"` \| `"visual_sidecar_failed"` \| `"gateway_failed"`

Terminal job outcome the report attests.

##### rawPromptsIncluded

> **rawPromptsIncluded**: `false`

Hard invariant — raw prompt or response text is never embedded.

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant — image bytes are never embedded.

##### roles

> **roles**: [`FinOpsRoleUsage`](#finopsroleusage)[]

Sorted by `role`. Always lists every role, even when usage is zero.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

Hard invariant — secrets are never embedded in this artifact.

##### totals

> **totals**: `object`

Aggregate counters across every role.

###### attempts

> **attempts**: `number`

###### cacheHits

> **cacheHits**: `number`

###### cacheMisses

> **cacheMisses**: `number`

###### durationMs

> **durationMs**: `number`

###### estimatedCost

> **estimatedCost**: `number`

###### failures

> **failures**: `number`

###### fallbackAttempts

> **fallbackAttempts**: `number`

###### imageBytes

> **imageBytes**: `number`

###### inputTokens

> **inputTokens**: `number`

###### liveSmokeCalls

> **liveSmokeCalls**: `number`

###### outputTokens

> **outputTokens**: `number`

###### replayCacheHitRate

> **replayCacheHitRate**: `number`

`cacheHits / (cacheHits + cacheMisses)` clamped to `[0, 1]`. NaN → 0.

###### replayCacheMissRate

> **replayCacheMissRate**: `number`

`cacheMisses / (cacheHits + cacheMisses)` clamped to `[0, 1]`. NaN → 0.

###### successes

> **successes**: `number`

***

### FinOpsCostRate

Per-attempt cost-rate input. Operators can supply a flat per-1000-token
rate and a per-attempt fixed cost; the recorder multiplies usage to
produce `estimatedCost`. Cost is currency-agnostic (the operator chooses
the unit, e.g. USD or "internal credits"), and the report stamps the
caller-supplied label so consumers know what the number means.

#### Properties

##### fixedCostPerAttempt?

> `optional` **fixedCostPerAttempt?**: `number`

Fixed per-attempt cost (e.g. minimum-charge / API-call premium).

##### inputTokenCostPer1k?

> `optional` **inputTokenCostPer1k?**: `number`

Cost per 1000 input tokens.

##### outputTokenCostPer1k?

> `optional` **outputTokenCostPer1k?**: `number`

Cost per 1000 output tokens.

***

### FinOpsCostRateMap

Per-role cost rate map. Roles with no rate produce `estimatedCost = 0`.

#### Properties

##### currencyLabel

> **currencyLabel**: `string`

Operator-supplied label describing the unit (e.g. "USD").

##### rates

> **rates**: `object`

###### custom\_context\_ingest?

> `optional` **custom\_context\_ingest?**: [`FinOpsCostRate`](#finopscostrate)

###### jira\_api\_requests?

> `optional` **jira\_api\_requests?**: [`FinOpsCostRate`](#finopscostrate)

###### jira\_paste\_ingest?

> `optional` **jira\_paste\_ingest?**: [`FinOpsCostRate`](#finopscostrate)

###### test\_generation?

> `optional` **test\_generation?**: [`FinOpsCostRate`](#finopscostrate)

###### visual\_fallback?

> `optional` **visual\_fallback?**: [`FinOpsCostRate`](#finopscostrate)

###### visual\_primary?

> `optional` **visual\_primary?**: [`FinOpsCostRate`](#finopscostrate)

***

### FinOpsRoleBudget

Per-role budget envelope. Every limit is optional; `undefined` means the
limit is not enforced for that role. Counters compare with `>` (strict
exceedance) — a usage that exactly equals a limit is allowed.

#### Properties

##### maxAttempts?

> `optional` **maxAttempts?**: `number`

Maximum number of gateway attempts the role may make in total
(success-or-failure). Useful when the live smoke surface should
fire only N times.

##### maxFallbackAttempts?

> `optional` **maxFallbackAttempts?**: `number`

Maximum number of fallback-deployment attempts the visual role may make.
Enforced against `visual_fallback` only; ignored for other roles.

##### maxImageBytesPerRequest?

> `optional` **maxImageBytesPerRequest?**: `number`

Cap on the decoded image bytes per request (visual roles only).

##### maxIngestBytesPerJob?

> `optional` **maxIngestBytesPerJob?**: `number`

Aggregate byte-ingest cap per job for non-LLM source-ingestion roles
(`jira_paste_ingest`, `custom_context_ingest`). Ignored for LLM roles.

##### maxInputTokensPerRequest?

> `optional` **maxInputTokensPerRequest?**: `number`

Cap on the gateway's pre-flight `estimateInputTokens` (per-request).

##### maxLiveSmokeCalls?

> `optional` **maxLiveSmokeCalls?**: `number`

Maximum number of live-smoke calls the role may make. Enforced when
the operator wires a live-smoke counter into the recorder; otherwise
treated as not-configured.

##### maxOutputTokensPerRequest?

> `optional` **maxOutputTokensPerRequest?**: `number`

Cap on `max_completion_tokens` forwarded to the gateway (per-request).

##### maxRetriesPerRequest?

> `optional` **maxRetriesPerRequest?**: `number`

Per-request retry cap. Maps to `LlmGenerationRequest.maxRetries`.

##### maxTotalInputTokens?

> `optional` **maxTotalInputTokens?**: `number`

Aggregate input-token cap across every request the role makes.

##### maxTotalOutputTokens?

> `optional` **maxTotalOutputTokens?**: `number`

Aggregate output-token cap across every request the role makes.

##### maxTotalWallClockMs?

> `optional` **maxTotalWallClockMs?**: `number`

Aggregate wall-clock cap across every request the role makes.

##### maxWallClockMsPerRequest?

> `optional` **maxWallClockMsPerRequest?**: `number`

Per-request wall-clock cap. Maps to `LlmGenerationRequest.maxWallClockMs`.

***

### FinOpsRoleUsage

Per-role usage record. Aggregated across every gateway attempt the role
made during the job. Cache hits do NOT increment any counter except
`cacheHits`.

#### Properties

##### attempts

> **attempts**: `number`

Total LLM call attempts (success + failure). Cache hits do NOT increment.

##### cacheHits

> **cacheHits**: `number`

Number of replay-cache hits attributed to this role.

##### cacheMisses

> **cacheMisses**: `number`

Number of replay-cache misses attributed to this role.

##### deployment

> **deployment**: `string`

Deployment label observed (e.g. `gpt-oss-120b-mock`). Empty string when no attempt was made.

##### durationMs

> **durationMs**: `number`

Sum of wall-clock duration across attempts, in milliseconds.

##### estimatedCost

> **estimatedCost**: `number`

Estimated cost contribution from this role (currency-agnostic).

##### failures

> **failures**: `number`

Failure attempts (any error class).

##### fallbackAttempts

> **fallbackAttempts**: `number`

Number of attempts that selected a fallback deployment.

##### imageBytes

> **imageBytes**: `number`

Sum of decoded image-input bytes per request (visual roles only; 0 elsewhere).

##### ingestBytes

> **ingestBytes**: `number`

Total bytes ingested by non-LLM ingest roles (`jira_paste_ingest`,
`custom_context_ingest`). Always `0` for LLM and visual roles.

##### inputTokens

> **inputTokens**: `number`

Sum of input tokens reported by the gateway across all successful attempts.

##### lastErrorClass?

> `optional` **lastErrorClass?**: `"schema_invalid"` \| `"schema_invalid_response"` \| `"refusal"` \| `"incomplete"` \| `"timeout"` \| `"rate_limited"` \| `"transport"` \| `"image_payload_rejected"` \| `"input_budget_exceeded"` \| `"response_too_large"` \| `"protocol"` \| `"canceled"`

Last error class observed (failure path) — `undefined` if no failure.

##### lastFinishReason?

> `optional` **lastFinishReason?**: [`LlmFinishReason`](#llmfinishreason)

Last finish reason observed (success path) — `undefined` if no success.

##### liveSmokeCalls

> **liveSmokeCalls**: `number`

Number of attempts that hit a non-mock gateway (live-smoke counter).

##### outputTokens

> **outputTokens**: `number`

Sum of output tokens reported by the gateway across all successful attempts.

##### role

> **role**: `"test_generation"` \| `"visual_primary"` \| `"visual_fallback"` \| `"jira_api_requests"` \| `"jira_paste_ingest"` \| `"custom_context_ingest"`

##### successes

> **successes**: `number`

Successful attempts.

***

### FourEyesPolicy

Operator-tunable four-eyes policy (#1376).

Resolved at startup from `WorkspaceStartOptions.testIntelligence`
fields; the resolved policy is consulted at review-snapshot seed time
to stamp `fourEyesEnforced` per test case.

#### Properties

##### requiredRiskCategories

> **requiredRiskCategories**: readonly [`TestCaseRiskCategory`](#testcaseriskcategory)[]

Risk categories that always require four-eyes. Sorted, deduplicated.

##### visualSidecarTriggerOutcomes

> **visualSidecarTriggerOutcomes**: readonly (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

Visual-sidecar validation outcomes that trigger four-eyes regardless
of risk category. Sorted, deduplicated.

***

### GeneratedTestCase

Single generated test case.

#### Properties

##### assumptions

> **assumptions**: `string`[]

##### audit

> **audit**: [`GeneratedTestCaseAuditMetadata`](#generatedtestcaseauditmetadata)

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### expectedResults

> **expectedResults**: `string`[]

##### figmaTraceRefs

> **figmaTraceRefs**: [`GeneratedTestCaseFigmaTrace`](#generatedtestcasefigmatrace)[]

##### id

> **id**: `string`

##### level

> **level**: [`TestCaseLevel`](#testcaselevel)

##### objective

> **objective**: `string`

##### openQuestions

> **openQuestions**: `string`[]

##### preconditions

> **preconditions**: `string`[]

##### priority

> **priority**: [`TestCasePriority`](#testcasepriority)

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### qcMappingPreview

> **qcMappingPreview**: [`GeneratedTestCaseQcMapping`](#generatedtestcaseqcmapping)

##### qualitySignals

> **qualitySignals**: [`GeneratedTestCaseQualitySignals`](#generatedtestcasequalitysignals-1)

##### regulatoryRelevance?

> `optional` **regulatoryRelevance?**: [`RegulatoryRelevance`](#regulatoryrelevance-1)

Optional regulatory-relevance signal (Issue #1735, contract bump
4.27.0). Populated by the production runner when the source screen
matches banking/insurance semantic keywords or when prompt augmentation
produced a compliance-flavoured case.

##### reviewState

> **reviewState**: [`GeneratedTestCaseReviewState`](#generatedtestcasereviewstate-1)

##### riskCategory

> **riskCategory**: [`TestCaseRiskCategory`](#testcaseriskcategory)

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

##### sourceJobId

> **sourceJobId**: `string`

##### steps

> **steps**: [`GeneratedTestCaseStep`](#generatedtestcasestep)[]

##### technique

> **technique**: [`TestCaseTechnique29119`](#testcasetechnique29119)

##### testData

> **testData**: `string`[]

##### title

> **title**: `string`

##### type

> **type**: [`TestCaseType`](#testcasetype)

***

### GeneratedTestCaseAuditMetadata

Audit metadata attached to a generated test case.

#### Properties

##### cacheHit

> **cacheHit**: `boolean`

Whether the artifact came from a replay-cache hit.

##### cacheKey

> **cacheKey**: `string`

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### generatedAt

> **generatedAt**: `string`

##### inputHash

> **inputHash**: `string`

##### jobId

> **jobId**: `string`

##### promptHash

> **promptHash**: `string`

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### GeneratedTestCaseFigmaTrace

Reference back to a Figma trace path that motivated a test case.

#### Properties

##### nodeId?

> `optional` **nodeId?**: `string`

##### nodeName?

> `optional` **nodeName?**: `string`

##### nodePath?

> `optional` **nodePath?**: `string`

##### screenId

> **screenId**: `string`

***

### GeneratedTestCaseList

Wrapper produced by the generator for a single job.

#### Properties

##### jobId

> **jobId**: `string`

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

##### testCases

> **testCases**: [`GeneratedTestCase`](#generatedtestcase)[]

***

### GeneratedTestCaseQcMapping

QC/ALM mapping preview emitted alongside the test case.

#### Properties

##### blockingReasons?

> `optional` **blockingReasons?**: `string`[]

Human-readable reasons when exportable=false.

##### exportable

> **exportable**: `boolean`

Whether the case is exportable as-is under the mapping profile.

##### folderHint?

> `optional` **folderHint?**: `string`

Canonical test-case folder hint inside QC/ALM.

##### mappingProfileId?

> `optional` **mappingProfileId?**: `string`

Canonical mapping profile id this preview was rendered for.

***

### GeneratedTestCaseQualitySignals

Quality signal fields attached to each generated test case.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

Optional ambiguity note.

##### confidence

> **confidence**: `number`

0..1 — generator-side confidence in the produced case.

##### coveredActionIds

> **coveredActionIds**: `string`[]

##### coveredFieldIds

> **coveredFieldIds**: `string`[]

##### coveredNavigationIds

> **coveredNavigationIds**: `string`[]

##### coveredValidationIds

> **coveredValidationIds**: `string`[]

***

### GeneratedTestCaseStep

Single ordered step inside a generated test case.

#### Properties

##### action

> **action**: `string`

##### data?

> `optional` **data?**: `string`

##### expected?

> `optional` **expected?**: `string`

##### index

> **index**: `number`

***

### InferredBusinessObject

Business-object cluster inferred across one or more fields.

Wave 4 (Issue #1431) adds the optional `sourceRefs` array; see
[DetectedField](#detectedfield) for backward-compat semantics.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

##### confidence

> **confidence**: `number`

##### fieldIds

> **fieldIds**: `string`[]

##### id

> **id**: `string`

##### name

> **name**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

##### screenId

> **screenId**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing sources (Issue #1431). Optional, additive.

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### IntentAmbiguity

Ambiguity note attached to a detected element or PII indicator.

#### Properties

##### reason

> **reason**: `string`

***

### IntentDeltaEntry

Single delta entry inside `IntentDeltaReport.entries`.

#### Properties

##### changeType

> **changeType**: `"added"` \| `"removed"` \| `"changed"` \| `"confidence_dropped"` \| `"ambiguity_increased"`

##### currentHash?

> `optional` **currentHash?**: `string`

SHA-256 hex of the current canonical projection, when present.

##### detail?

> `optional` **detail?**: `string`

Optional sanitized human-readable detail (no PII, no tokens).

##### elementId

> **elementId**: `string`

Stable identifier inside the IR (e.g. `screenId`, `field.id`).

##### kind

> **kind**: `"validation"` \| `"navigation"` \| `"screen"` \| `"field"` \| `"action"` \| `"visual_screen"`

##### priorHash?

> `optional` **priorHash?**: `string`

SHA-256 hex of the prior canonical projection, when present.

##### screenId?

> `optional` **screenId?**: `string`

Owning screen id, when the entry is screen-scoped.

***

### IntentDeltaReport

Hard-invariant intent-delta report artifact (Issue #1373).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### currentIntentHash

> **currentIntentHash**: `string`

SHA-256 of the canonical current IR (anchors the comparison).

##### entries

> **entries**: [`IntentDeltaEntry`](#intentdeltaentry)[]

Sorted-by-(kind,elementId,changeType) deterministic entries.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### priorIntentHash

> **priorIntentHash**: `string`

SHA-256 of the canonical prior IR (anchors the comparison).

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: image bytes are NEVER embedded into this artifact.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

Hard invariant: tokens / credentials are NEVER embedded.

##### totals

> **totals**: `object`

Aggregate counts, computed deterministically from `entries`.

###### added

> **added**: `number`

###### ambiguityIncreased

> **ambiguityIncreased**: `number`

###### changed

> **changed**: `number`

###### confidenceDropped

> **confidenceDropped**: `number`

###### removed

> **removed**: `number`

***

### IntentRedaction

Record describing a single redaction decision.

#### Properties

##### id

> **id**: `string`

##### indicatorId

> **indicatorId**: `string`

##### kind

> **kind**: [`PiiKind`](#piikind)

##### reason

> **reason**: `string`

##### replacement

> **replacement**: `string`

***

### IntentTraceRef

Reference to the Figma node that produced an intent element.

Wave 4 (Issue #1431) extends this trace with an optional array of
contributing [TestIntentSourceRef](#testintentsourceref) entries so a single trace may
record multiple sources that agreed on (or conflicted over) a field.
The legacy `nodeId` / `nodeName` / `nodePath` fields keep working for
single-source Figma traces.

#### Properties

##### nodeId?

> `optional` **nodeId?**: `string`

##### nodeName?

> `optional` **nodeName?**: `string`

##### nodePath?

> `optional` **nodePath?**: `string`

##### sourceRefs?

> `optional` **sourceRefs?**: [`TestIntentSourceRef`](#testintentsourceref)[]

Contributing source references for this trace (Issue #1431).
Optional — omitted for legacy single-source Figma jobs to keep
artifacts byte-stable. When present, each entry MUST match an entry
in the surrounding [MultiSourceTestIntentEnvelope.sources](#sources)
array by `sourceId`.

***

### JiraAcceptanceCriterion

Single normalized acceptance criterion derived from a Jira issue.

#### Properties

##### id

> **id**: `string`

Stable per-issue id, e.g. `"ac.0"`, `"ac.1"`.

##### sourceFieldId?

> `optional` **sourceFieldId?**: `string`

Original Jira field id this criterion was sourced from (e.g. `"customfield_10042"`).

##### text

> **text**: `string`

Plain-text criterion body, PII-redacted.

***

### JiraAttachmentRef

Metadata reference to a Jira attachment. The IR NEVER carries
attachment bytes — only the redacted filename, MIME type, and byte
size. Download URLs are stripped by the builder.

#### Properties

##### byteSize?

> `optional` **byteSize?**: `number`

Reported byte size, if known.

##### filename

> **filename**: `string`

PII-redacted attachment filename.

##### id

> **id**: `string`

Stable per-issue id, e.g. `"attachment.0"`.

##### mimeType?

> `optional` **mimeType?**: `string`

Reported MIME type, normalised to lowercase.

***

### JiraCapabilityProbe

Jira capability probe result.

#### Properties

##### adfSupported

> **adfSupported**: `boolean`

##### deploymentType

> **deploymentType**: `"unknown"` \| `"Cloud"` \| `"Server"` \| `"DataCenter"`

##### version

> **version**: `string`

***

### JiraComment

Single PII-redacted Jira comment carried into the IR (opt-in only).

#### Properties

##### authorHandle?

> `optional` **authorHandle?**: `string`

Opaque non-PII author handle (never raw email, full name, or Jira
accountId). Resolution is the caller's responsibility before the
comment reaches the builder.

##### body

> **body**: `string`

PII-redacted comment body. May be truncated to the configured byte cap.

##### bodyTruncated

> **bodyTruncated**: `boolean`

True when the body was truncated to fit [MAX\_JIRA\_COMMENT\_BODY\_BYTES](#max_jira_comment_body_bytes).

##### createdAt

> **createdAt**: `string`

ISO-8601 UTC timestamp of the original Jira comment.

##### id

> **id**: `string`

Stable per-issue id, e.g. `"comment.0"`.

***

### JiraCreatedSubtasksArtifact

Aggregate `jira-created-subtasks.json` artifact (Issue #1482).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### credentialsIncluded

> **credentialsIncluded**: `false`

Hard invariant: credentials are never embedded in Jira write payloads.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### parentIssueKey

> **parentIssueKey**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: raw screenshots are never embedded in Jira write payloads.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### subtasks

> **subtasks**: [`JiraSubTaskRecord`](#jirasubtaskrecord)[]

Sorted by `testCaseId` for deterministic emission.

***

### JiraFetchRequest

Outbound fetch request shape for the Jira gateway.

#### Properties

##### capturedAt?

> `optional` **capturedAt?**: `string`

Deterministic capture timestamp for generated IR; defaults to Unix epoch.

##### expand?

> `optional` **expand?**: readonly (`"renderedFields"` \| `"names"` \| `"schema"`)[]

##### fieldSelection?

> `optional` **fieldSelection?**: `Partial`\<[`JiraFieldSelectionProfile`](#jirafieldselectionprofile)\>

##### linkExpansionDepth?

> `optional` **linkExpansionDepth?**: `0` \| `1` \| `2`

##### maxRetries?

> `optional` **maxRetries?**: `number`

##### maxWallClockMs?

> `optional` **maxWallClockMs?**: `number`

##### query

> **query**: \{ `jql`: `string`; `kind`: `"jql"`; `maxResults`: `number`; \} \| \{ `issueKeys`: `string`[]; `kind`: `"issueKeys"`; \}

##### replayMode?

> `optional` **replayMode?**: `boolean`

When true, load the persisted redacted Jira IR list and issue zero outbound fetches.

##### runDir?

> `optional` **runDir?**: `string`

Enables deterministic on-disk gateway artifacts under `<runDir>/sources/<sourceId>/`.

##### sourceId?

> `optional` **sourceId?**: `string`

Source namespace used for replay/cache artifacts when `runDir` is set.

***

### JiraFetchResult

Result returned by the Jira gateway.

#### Properties

##### attempts

> **attempts**: `number`

##### cacheHit?

> `optional` **cacheHit?**: `boolean`

##### capability

> **capability**: [`JiraCapabilityProbe`](#jiracapabilityprobe)

##### diagnostic?

> `optional` **diagnostic?**: [`JiraGatewayDiagnostic`](#jiragatewaydiagnostic)

##### issues

> **issues**: [`JiraIssueIr`](#jiraissueir)[]

##### responseHash

> **responseHash**: `string`

##### retryable

> **retryable**: `boolean`

***

### JiraFieldSelectionProfile

Field-selection profile applied by the Jira IR builder. The default is
data-minimized: comments, attachments, linked issues, and custom fields
are excluded unless the caller opts each group in. Unknown custom-field
ids are always excluded — there is no opt-in path for "all custom
fields".

#### Properties

##### acceptanceCriterionFieldIds

> **acceptanceCriterionFieldIds**: readonly `string`[]

Allow-list of Jira custom-field ids interpreted as acceptance
criteria. The builder reads these fields, parses them as ADF when
appropriate, and emits [JiraAcceptanceCriterion](#jiraacceptancecriterion) entries.

##### customFieldAllowList

> **customFieldAllowList**: readonly `string`[]

Allow-list of Jira custom-field ids whose values are persisted on
the IR. Anything outside this list is excluded and counted in
[JiraIssueIrDataMinimization.unknownCustomFieldsExcluded](#unknowncustomfieldsexcluded).

##### includeAttachments

> **includeAttachments**: `boolean`

Include attachment metadata (default `false`).

##### includeComments

> **includeComments**: `boolean`

Include comments (default `false`).

##### includeDescription

> **includeDescription**: `boolean`

Include the description body (default `true`).

##### includeLinks

> **includeLinks**: `boolean`

Include linked-issue refs (default `false`).

***

### JiraGatewayConfig

Client configuration for the Jira REST gateway (Wave 4.C).

#### Properties

##### allowedHostPatterns?

> `optional` **allowedHostPatterns?**: readonly `string`[]

Exact hostnames or `*.example.com` suffix patterns allowed for Bearer
token/Data Center calls. Cloud Basic and OAuth gateway hosts are validated
by auth-mode-specific rules; Data Center endpoints must be allow-listed.

##### auth

> **auth**: \{ `kind`: `"bearer"`; `token`: `string`; \} \| \{ `apiToken`: `string`; `email`: `string`; `kind`: `"basic"`; \} \| \{ `accessToken`: `string`; `kind`: `"oauth2_3lo"`; \}

##### baseUrl

> **baseUrl**: `string`

##### maxResponseBytes?

> `optional` **maxResponseBytes?**: `number`

##### maxRetries?

> `optional` **maxRetries?**: `number`

##### maxWallClockMs?

> `optional` **maxWallClockMs?**: `number`

##### userAgent

> **userAgent**: `string`

***

### JiraGatewayDiagnostic

Structured diagnostic emitted by the Jira gateway failure path.

#### Properties

##### code

> **code**: `string`

##### message

> **message**: `string`

##### rateLimitReason?

> `optional` **rateLimitReason?**: `string`

##### retryable

> **retryable**: `boolean`

##### status?

> `optional` **status?**: `number`

***

### JiraIssueIr

Canonical, PII-redacted, deterministically-hashed Jira issue IR. Wave
4.F's reconciliation engine and the LLM prompt compiler consume only
this IR — raw Jira payloads never reach prompt compilation.

Hard invariants enforced by the builder:

  1. `issueKey` is validated (`^[A-Z][A-Z0-9_]+-[1-9][0-9]*$`, ≤ 64 chars).
  2. `descriptionPlain`, `summary`, comment bodies, custom-field values,
     attachment filenames, and link relationships are all PII-redacted
     before persistence.
  3. No Jira `self` URL, account id, avatar URL, attachment download
     URL, or raw `names`/`schema` map is present anywhere on the IR.
  4. `contentHash` is the SHA-256 of the canonical JSON serialization
     of the IR with `contentHash` itself stripped.
  5. Audit/data-minimization metadata is always present.

#### Properties

##### acceptanceCriteria

> **acceptanceCriteria**: [`JiraAcceptanceCriterion`](#jiraacceptancecriterion)[]

Acceptance criteria parsed from explicitly configured custom fields.

##### attachments

> **attachments**: [`JiraAttachmentRef`](#jiraattachmentref)[]

Attachment metadata only — NEVER bytes (opt-in only).

##### capturedAt

> **capturedAt**: `string`

ISO-8601 UTC timestamp at which the IR was built (`Z` suffix).

##### comments

> **comments**: [`JiraComment`](#jiracomment)[]

PII-redacted comments (opt-in only).

##### components

> **components**: `string`[]

Sorted, deduplicated, PII-redacted component names.

##### contentHash

> **contentHash**: `string`

SHA-256 of the canonical IR with `contentHash` stripped. Lowercase, 64 hex.

##### customFields

> **customFields**: [`JiraIssueIrCustomField`](#jiraissueircustomfield)[]

Allow-listed custom fields with PII-redacted values (opt-in).

##### dataMinimization

> **dataMinimization**: [`JiraIssueIrDataMinimization`](#jiraissueirdataminimization-1)

Data-minimization audit metadata.

##### descriptionPlain

> **descriptionPlain**: `string`

PII-redacted plain-text description, capped at [MAX\_JIRA\_DESCRIPTION\_PLAIN\_BYTES](#max_jira_description_plain_bytes).

##### fixVersions

> **fixVersions**: `string`[]

Sorted, deduplicated fix-version names.

##### issueKey

> **issueKey**: `string`

Validated Jira issue key, e.g. `"PAY-1234"`.

##### issueType

> **issueType**: `"other"` \| `"story"` \| `"task"` \| `"bug"` \| `"epic"` \| `"subtask"`

Allow-listed issue type discriminant. Free-form types collapse to `"other"`.

##### labels

> **labels**: `string`[]

Sorted, deduplicated, PII-redacted labels.

##### links

> **links**: [`JiraLinkRef`](#jiralinkref)[]

Linked-issue refs (opt-in only).

##### piiIndicators

> **piiIndicators**: [`PiiIndicator`](#piiindicator)[]

PII indicators surfaced during redaction.

##### priority?

> `optional` **priority?**: `string`

Optional priority name (e.g. `"High"`).

##### redactions

> **redactions**: [`IntentRedaction`](#intentredaction)[]

Redaction records corresponding to [piiIndicators](#piiindicators-3).

##### status

> **status**: `string`

Issue status name (e.g. `"In Progress"`).

##### summary

> **summary**: `string`

PII-redacted summary line.

##### version

> **version**: `"1.0.0"`

Schema version stamp.

***

### JiraIssueIrCustomField

Single PII-redacted custom field included in the IR (opt-in only).

#### Properties

##### id

> **id**: `string`

Jira custom-field id (e.g. `"customfield_10042"`).

##### nameRedacted

> **nameRedacted**: `string`

PII-redacted custom-field display name.

##### valuePlain

> **valuePlain**: `string`

PII-redacted, byte-capped, normalized scalar value.

##### valueTruncated

> **valueTruncated**: `boolean`

True when the value was truncated to fit [MAX\_JIRA\_CUSTOM\_FIELD\_VALUE\_BYTES](#max_jira_custom_field_value_bytes).

***

### JiraIssueIrDataMinimization

Audit metadata recording how the data-minimization profile was applied
to a single IR build. Lets reviewers verify that opt-in field groups
were turned on intentionally, that over-large bodies were capped before
persistence, and that unknown custom fields were excluded by default.

#### Properties

##### attachmentsDropped

> **attachmentsDropped**: `number`

Count of attachments dropped because the count cap was exceeded.

##### attachmentsIncluded

> **attachmentsIncluded**: `boolean`

True when attachment metadata was included on the IR (opt-in).

##### commentsCapped

> **commentsCapped**: `number`

Count of comments whose body was truncated to fit the byte cap.

##### commentsDropped

> **commentsDropped**: `number`

Count of comments dropped because the count cap was exceeded.

##### commentsIncluded

> **commentsIncluded**: `boolean`

True when comments were included on the IR (opt-in).

##### customFieldsCapped

> **customFieldsCapped**: `number`

Count of custom-field values truncated to fit the per-field byte cap.

##### customFieldsIncluded

> **customFieldsIncluded**: `number`

Count of custom fields included via the explicit allow-list.

##### descriptionIncluded

> **descriptionIncluded**: `boolean`

True when the description body was included on the IR.

##### descriptionTruncated

> **descriptionTruncated**: `boolean`

True when the description body was truncated to fit the byte cap.

##### linksDropped

> **linksDropped**: `number`

Count of links dropped because the count cap was exceeded.

##### linksIncluded

> **linksIncluded**: `boolean`

True when linked-issue refs were included on the IR (opt-in).

##### unknownCustomFieldsExcluded

> **unknownCustomFieldsExcluded**: `number`

Count of custom fields excluded because they were not on the allow-list.

***

### JiraLinkRef

Reference to another Jira issue linked from this one (opt-in).

#### Properties

##### id

> **id**: `string`

Stable per-issue id, e.g. `"link.0"`.

##### relationship

> **relationship**: `string`

Normalized link relationship label (e.g. `"blocks"`, `"relates_to"`).

##### targetIssueKey

> **targetIssueKey**: `string`

Validated Jira issue key of the linked issue.

***

### JiraSubTaskRecord

Per-test-case sub-task record persisted in `jira-created-subtasks.json`
and embedded in the audit-shaped `jira-write-report.json`.

#### Properties

##### externalId

> **externalId**: `string`

Stable idempotency key SHA-256(`jobId|testCaseId|parentIssueKey`).

##### failureClass?

> `optional` **failureClass?**: `"rate_limited"` \| `"provider_not_implemented"` \| `"transport_error"` \| `"auth_failed"` \| `"permission_denied"` \| `"validation_rejected"` \| `"server_error"` \| `"unknown"`

Failure classification when `outcome === "failed"`.

##### failureDetail?

> `optional` **failureDetail?**: `string`

Sanitised, length-bounded failure detail; never carries URLs/tokens.

##### jiraIssueKey?

> `optional` **jiraIssueKey?**: `string`

Resolved Jira issue key for the created or pre-existing sub-task.

##### outcome

> **outcome**: `"dry_run"` \| `"failed"` \| `"created"` \| `"skipped_duplicate"`

##### retryable?

> `optional` **retryable?**: `boolean`

Whether the failed sub-task attempt is safe to retry later. Present only
for failed outcomes so persisted status can distinguish transient
transport/rate-limit/server failures from permanent validation/auth faults.

##### testCaseId

> **testCaseId**: `string`

Generated test case identifier this sub-task corresponds to.

***

### JiraWriteAuditMetadata

Audit metadata persisted alongside the Jira write report.

#### Properties

##### adminEnabled

> **adminEnabled**: `boolean`

Whether the admin gate (`allowJiraWrite`) was enabled.

##### bearerConfigured

> **bearerConfigured**: `boolean`

Whether a bearer token was configured for the run.

##### dryRun

> **dryRun**: `boolean`

Whether the run was a dry-run (no live Jira calls).

##### mode

> **mode**: `"jira_subtasks"`

Mode used by this run; only `jira_subtasks` is shipped in Wave 5.

##### principalId

> **principalId**: `string`

Stable opaque principal id; never an email or token.

***

### JiraWriteReportArtifact

Aggregate `jira-write-report.json` artifact (Issue #1482).

#### Properties

##### audit

> **audit**: [`JiraWriteAuditMetadata`](#jirawriteauditmetadata)

Audit metadata for the run.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### createdCount

> **createdCount**: `number`

Number of records whose outcome is `created`.

##### credentialsIncluded

> **credentialsIncluded**: `false`

Hard invariant: credentials are never embedded in Jira write payloads.

##### dryRunCount

> **dryRunCount**: `number`

Number of records whose outcome is `dry_run`.

##### failedCount

> **failedCount**: `number`

Number of records whose outcome is `failed`.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### parentIssueKey

> **parentIssueKey**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: raw screenshots are never embedded in Jira write payloads.

##### refusalCodes

> **refusalCodes**: (`"no_approved_test_cases"` \| `"policy_blocked_cases_present"` \| `"schema_invalid_cases_present"` \| `"visual_sidecar_blocked"` \| `"admin_gate_disabled"` \| `"bearer_token_missing"` \| `"feature_gate_disabled"` \| `"invalid_parent_issue_key"`)[]

Sorted, deduplicated refusal codes that fired.

##### refused

> **refused**: `boolean`

True iff the pipeline refused to perform any write.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### skippedDuplicateCount

> **skippedDuplicateCount**: `number`

Number of records whose outcome is `skipped_duplicate`.

##### totalCases

> **totalCases**: `number`

Total number of approved test cases supplied to the pipeline.

***

### LbomDataComponent

CycloneDX 1.6 component entry — data variant (bundle / policy).

#### Properties

##### bom-ref

> **bom-ref**: `string`

##### description

> **description**: `string`

##### hashes

> **hashes**: [`LbomHash`](#lbomhash)[]

##### name

> **name**: `string`

##### properties

> **properties**: [`LbomProperty`](#lbomproperty)[]

##### type

> **type**: `"data"`

##### version

> **version**: `string`

***

### LbomDependency

CycloneDX 1.6 dependency edge.

#### Properties

##### dependsOn

> **dependsOn**: `string`[]

##### ref

> **ref**: `string`

***

### LbomExternalReference

External reference entry on a CycloneDX 1.6 component.

#### Properties

##### type

> **type**: `"documentation"` \| `"vcs"` \| `"evidence"` \| `"model-card"` \| `"configuration"` \| `"license"`

##### url

> **url**: `string`

***

### LbomHash

Hash entry on a CycloneDX 1.6 component.

#### Properties

##### alg

> **alg**: `"SHA-256"`

Hash algorithm — workspace-dev only emits `SHA-256`.

##### content

> **content**: `string`

Lowercase hex digest.

***

### LbomLicenseEntry

License entry — workspace-dev exclusively emits SPDX identifiers.

#### Properties

##### license

> **license**: `object`

###### id

> **id**: `string`

***

### LbomMetadata

CycloneDX 1.6 metadata block as emitted by workspace-dev.

#### Properties

##### component

> **component**: [`LbomSubjectComponent`](#lbomsubjectcomponent)

##### properties

> **properties**: [`LbomProperty`](#lbomproperty)[]

##### timestamp

> **timestamp**: `string`

##### tools

> **tools**: `object`

###### components

> **components**: [`LbomToolComponent`](#lbomtoolcomponent)[]

***

### LbomModelCard

CycloneDX 1.6 modelCard surface as emitted by workspace-dev.

#### Properties

##### considerations?

> `optional` **considerations?**: [`LbomModelConsiderations`](#lbommodelconsiderations)

##### modelParameters?

> `optional` **modelParameters?**: [`LbomModelParameters`](#lbommodelparameters)

##### properties?

> `optional` **properties?**: [`LbomProperty`](#lbomproperty)[]

##### quantitativeAnalysis?

> `optional` **quantitativeAnalysis?**: `object`

###### performanceMetrics

> **performanceMetrics**: [`LbomPerformanceMetric`](#lbomperformancemetric)[]

***

### LbomModelComponent

CycloneDX 1.6 component entry — model variant.

#### Properties

##### bom-ref

> **bom-ref**: `string`

##### description

> **description**: `string`

##### externalReferences?

> `optional` **externalReferences?**: [`LbomExternalReference`](#lbomexternalreference)[]

##### group?

> `optional` **group?**: `string`

##### hashes?

> `optional` **hashes?**: [`LbomHash`](#lbomhash)[]

##### licenses?

> `optional` **licenses?**: [`LbomLicenseEntry`](#lbomlicenseentry)[]

##### modelCard

> **modelCard**: [`LbomModelCard`](#lbommodelcard)

##### name

> **name**: `string`

##### properties

> **properties**: [`LbomProperty`](#lbomproperty)[]

##### publisher?

> `optional` **publisher?**: `string`

##### type

> **type**: `"machine-learning-model"`

##### version

> **version**: `string`

***

### LbomModelConsiderations

CycloneDX 1.6 modelCard.considerations surface as emitted by workspace-dev.

#### Properties

##### ethicalConsiderations?

> `optional` **ethicalConsiderations?**: `object`[]

###### mitigationStrategy?

> `optional` **mitigationStrategy?**: `string`

###### name

> **name**: `string`

##### fairnessAssessments?

> `optional` **fairnessAssessments?**: `string`[]

##### performanceTradeoffs?

> `optional` **performanceTradeoffs?**: `string`[]

##### technicalLimitations?

> `optional` **technicalLimitations?**: `string`[]

##### useCases?

> `optional` **useCases?**: `string`[]

##### users?

> `optional` **users?**: `string`[]

***

### LbomModelParameters

CycloneDX 1.6 modelCard.modelParameters surface as emitted by workspace-dev.

#### Properties

##### architectureFamily?

> `optional` **architectureFamily?**: `string`

##### modelArchitecture?

> `optional` **modelArchitecture?**: `string`

##### task

> **task**: `string`

***

### LbomPerformanceMetric

CycloneDX 1.6 modelCard.quantitativeAnalysis.performanceMetrics entry.
Values are encoded as strings per the CycloneDX 1.6 spec.

#### Properties

##### confidenceInterval?

> `optional` **confidenceInterval?**: `object`

###### lowerBound

> **lowerBound**: `string`

###### upperBound

> **upperBound**: `string`

##### slice?

> `optional` **slice?**: `string`

##### type

> **type**: `string`

##### value

> **value**: `string`

***

### LbomProperty

Property entry on a CycloneDX 1.6 component (or root metadata).

#### Properties

##### name

> **name**: `string`

##### value

> **value**: `string`

***

### LbomSubjectComponent

CycloneDX 1.6 metadata.component entry — the BOM subject.

#### Properties

##### bom-ref

> **bom-ref**: `string`

##### description

> **description**: `string`

##### name

> **name**: `string`

##### properties

> **properties**: [`LbomProperty`](#lbomproperty)[]

##### type

> **type**: `"application"`

##### version

> **version**: `string`

***

### LbomToolComponent

CycloneDX 1.6 metadata.tools entry.

#### Properties

##### description

> **description**: `string`

##### name

> **name**: `string`

##### publisher

> **publisher**: `string`

##### type

> **type**: `"application"`

##### version

> **version**: `string`

***

### LbomValidationIssue

Validation issue surfaced by `validateLbomDocument`.

#### Properties

##### code

> **code**: `"missing_required_field"` \| `"invalid_value"` \| `"invalid_hash"` \| `"invalid_type"` \| `"invalid_serial_number"` \| `"invalid_timestamp"` \| `"duplicate_bom_ref"` \| `"unknown_dependency_ref"` \| `"raw_prompt_leak"` \| `"raw_screenshot_leak"` \| `"secret_leak"`

Stable diagnostic code consumers can switch on.

##### message

> **message**: `string`

##### path

> **path**: `string`

Dotted JSON path of the offending field.

***

### LbomValidationResult

Result of `validateLbomDocument`.

#### Properties

##### issues

> **issues**: [`LbomValidationIssue`](#lbomvalidationissue)[]

##### valid

> **valid**: `boolean`

***

### LlmCapabilitiesArtifact

Persistable capabilities artifact. Contains identity (role, deployment,
gateway release, model revision, optional model-weights SHA-256) and the
declared/observed capabilities. NEVER contains tokens, headers, or
reasoning traces.

#### Properties

##### capabilities

> **capabilities**: [`LlmGatewayCapabilities`](#llmgatewaycapabilities)

##### compatibilityMode

> **compatibilityMode**: `"openai_chat"`

##### contractVersion

> **contractVersion**: `"1.0.0"`

##### deployment

> **deployment**: `string`

##### gatewayRelease

> **gatewayRelease**: `string`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### modelRevision

> **modelRevision**: `string`

##### modelWeightsSha256?

> `optional` **modelWeightsSha256?**: `string`

##### probes

> **probes**: [`LlmCapabilityProbeRecord`](#llmcapabilityproberecord)[]

##### role

> **role**: `"test_generation"` \| `"visual_primary"` \| `"visual_fallback"`

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

***

### LlmCapabilityProbeRecord

One probe row in `llm-capabilities.json`.

#### Properties

##### capability

> **capability**: [`LlmCapabilityProbeCapability`](#llmcapabilityprobecapability)

##### declared

> **declared**: `boolean`

##### detail?

> `optional` **detail?**: `string`

##### outcome

> **outcome**: [`LlmCapabilityProbeOutcome`](#llmcapabilityprobeoutcome)

***

### LlmGatewayCapabilities

Capability flags declared by the gateway operator and verified at probe
time. Streaming is disabled by default in Wave 1 — the Figma-to-test
pipeline consumes only the final structured JSON envelope.

#### Properties

##### imageInputSupport

> **imageInputSupport**: `boolean`

##### maxOutputTokensSupport

> **maxOutputTokensSupport**: `boolean`

##### reasoningEffortSupport

> **reasoningEffortSupport**: `boolean`

##### seedSupport

> **seedSupport**: `boolean`

##### streamingSupport

> **streamingSupport**: `boolean`

##### structuredOutputs

> **structuredOutputs**: `boolean`

***

### LlmGatewayCircuitBreakerConfig

Tunable circuit-breaker thresholds for an LLM gateway client.

#### Properties

##### failureThreshold

> **failureThreshold**: `number`

##### resetTimeoutMs

> **resetTimeoutMs**: `number`

***

### LlmGatewayClientConfig

Construction-time configuration for an LLM gateway client.

API tokens are NEVER in this object. Operators inject a token reader via
the runtime factory; the reader is invoked once per request and the value
is held only for the duration of that request.

#### Properties

##### authMode

> **authMode**: `"api_key"` \| `"bearer_token"` \| `"none"`

##### baseUrl

> **baseUrl**: `string`

##### circuitBreaker

> **circuitBreaker**: [`LlmGatewayCircuitBreakerConfig`](#llmgatewaycircuitbreakerconfig)

##### compatibilityMode

> **compatibilityMode**: `"openai_chat"`

##### declaredCapabilities

> **declaredCapabilities**: [`LlmGatewayCapabilities`](#llmgatewaycapabilities)

##### deployment

> **deployment**: `string`

##### gatewayRelease

> **gatewayRelease**: `string`

##### maxResponseBytes?

> `optional` **maxResponseBytes?**: `number`

Hard upper bound on the gateway response body, in bytes. The transport
counts decoded bytes during read and aborts the stream the moment the
running total exceeds this cap; the failure surfaces as
`errorClass: "response_too_large"` with `retryable: false` (Issue #1414).
The cap is enforced both via the `Content-Length` header (pre-read
short-circuit) and via streaming byte accounting (so a missing or
mendacious header still cannot exhaust memory). Defaults to
`8 * 1024 * 1024` (8 MiB) when omitted; positive integer values up to
`Number.MAX_SAFE_INTEGER` are accepted, anything else throws at
client construction. The mock gateway has no transport and ignores
this field.

##### maxRetries

> **maxRetries**: `number`

##### modelRevision

> **modelRevision**: `string`

##### modelWeightsSha256?

> `optional` **modelWeightsSha256?**: `string`

##### role

> **role**: `"test_generation"` \| `"visual_primary"` \| `"visual_fallback"`

##### timeoutMs

> **timeoutMs**: `number`

##### wireStructuredOutputMode?

> `optional` **wireStructuredOutputMode?**: `"none"` \| `"json_schema"` \| `"json_object"`

Wire-format strategy for structured outputs. Defaults to `"json_schema"`
(preserves existing behaviour). Set to `"json_object"` for providers
that accept the weaker mode but reject `json_schema`. Set to `"none"`
for providers that return empty content for ANY `response_format`
(observed on Azure AI Foundry's `gpt-oss-120b` via the `openai/v1`
path on 2026-05-02). In all three modes, the gateway parses and
validates the response content as JSON in-process when the request
carries a `responseSchema`, so the contract guarantee surfaced to
callers is unchanged. See [LlmGatewayWireStructuredOutputMode](#llmgatewaywirestructuredoutputmode).

***

### LlmGenerationFailure

Failure outcome with a redacted message and an explicit retryable flag.

#### Properties

##### attempt

> **attempt**: `number`

##### errorClass

> **errorClass**: `"schema_invalid"` \| `"refusal"` \| `"incomplete"` \| `"timeout"` \| `"rate_limited"` \| `"transport"` \| `"image_payload_rejected"` \| `"input_budget_exceeded"` \| `"response_too_large"` \| `"protocol"` \| `"canceled"`

##### message

> **message**: `string`

##### outcome

> **outcome**: `"error"`

##### retryable

> **retryable**: `boolean`

***

### LlmGenerationRequest

Wire-shaped request handed to a gateway client.

#### Properties

##### abortSignal?

> `optional` **abortSignal?**: `AbortSignal`

Optional caller-side `AbortSignal`. When the orchestrator cancels a
running job (#1694), this signal is plumbed all the way to the
outbound `fetch` so the in-flight LLM call is aborted immediately
instead of running until the per-request timeout fires. Aborts via
this signal surface as `errorClass: "canceled"` (`retryable: false`),
distinct from `"timeout"` so circuit-breaker accounting and retry
policy do not treat user cancellation as a transient transport
failure.

##### imageInputs?

> `optional` **imageInputs?**: readonly [`LlmImageInput`](#llmimageinput)[]

##### jobId

> **jobId**: `string`

##### maxInputTokens?

> `optional` **maxInputTokens?**: `number`

Optional client-side input-token budget. Gateway clients estimate the
outgoing prompt size (system + user prompt + structured-output schema +
any image payloads) and reject the request before transport with
`errorClass: "input_budget_exceeded"` (`retryable: false`) when the
estimate exceeds this cap (Issue #1415). Operators set the cap to bound
cost and to keep maliciously expanded Figma metadata from reaching the
gateway. Negative or non-integer values are rejected as `schema_invalid`.

##### maxOutputTokens?

> `optional` **maxOutputTokens?**: `number`

##### maxRetries?

> `optional` **maxRetries?**: `number`

Optional per-request retry cap. When set, the gateway uses
`min(config.maxRetries, request.maxRetries)` so an operator can bound
retry blast radius for an individual job without rebuilding the client
(Issue #1371).

##### maxWallClockMs?

> `optional` **maxWallClockMs?**: `number`

Optional per-request wall-clock budget. When set, the request times out
after `maxWallClockMs` instead of the client config's `timeoutMs` if
smaller, AND the resulting timeout failure is surfaced with
`retryable: false` (FinOps fail-closed semantics — Issue #1371).

##### reasoningEffort?

> `optional` **reasoningEffort?**: [`LlmReasoningEffort`](#llmreasoningeffort)

##### responseSchema?

> `optional` **responseSchema?**: `Record`\<`string`, `unknown`\>

##### responseSchemaName?

> `optional` **responseSchemaName?**: `string`

##### seed?

> `optional` **seed?**: `number`

##### systemPrompt

> **systemPrompt**: `string`

##### userPrompt

> **userPrompt**: `string`

***

### LlmGenerationSuccess

Success outcome — never includes reasoning/CoT traces.

#### Properties

##### attempt

> **attempt**: `number`

##### content

> **content**: `unknown`

##### finishReason

> **finishReason**: [`LlmFinishReason`](#llmfinishreason)

##### gatewayRelease

> **gatewayRelease**: `string`

##### modelDeployment

> **modelDeployment**: `string`

##### modelRevision

> **modelRevision**: `string`

##### outcome

> **outcome**: `"success"`

##### rawTextContent?

> `optional` **rawTextContent?**: `string`

##### usage

> **usage**: `object`

###### inputTokens?

> `optional` **inputTokens?**: `number`

###### outputTokens?

> `optional` **outputTokens?**: `number`

***

### LlmImageInput

Image payload accepted by visual sidecars. Rejected for `test_generation`.

#### Properties

##### base64Data

> **base64Data**: `string`

##### mimeType

> **mimeType**: `string`

***

### MultiSourceConflict

One deterministic conflict row emitted by the reconciliation engine.

#### Properties

##### affectedElementIds?

> `optional` **affectedElementIds?**: `string`[]

Stable IR ids affected by this conflict, when known.

##### affectedScreenIds?

> `optional` **affectedScreenIds?**: `string`[]

Stable screen ids affected by this conflict, when known.

##### conflictId

> **conflictId**: `string`

SHA-256 of `{ kind, sourceRefs, normalizedValues }`.

##### detail?

> `optional` **detail?**: `string`

Optional sanitized detail suitable for reviewer inspection.

##### kind

> **kind**: [`MultiSourceConflictKind`](#multisourceconflictkind-1)

##### normalizedValues

> **normalizedValues**: `string`[]

Sorted, redacted, canonical values that disagreed.

##### participatingSourceIds

> **participatingSourceIds**: `string`[]

##### resolution

> **resolution**: `"auto_priority"` \| `"deferred_to_reviewer"` \| `"kept_both"` \| `"unresolved"`

##### resolvedAt?

> `optional` **resolvedAt?**: `string`

##### resolvedBy?

> `optional` **resolvedBy?**: `string`

***

### MultiSourceEnvelopeIssue

A single validation issue surfaced by the multi-source envelope
validator. `path` is a JS property-path-like locator (e.g.
`"sources[2].contentHash"`).

#### Properties

##### code

> **code**: `"envelope_missing"` \| `"envelope_version_mismatch"` \| `"sources_empty"` \| `"duplicate_source_id"` \| `"invalid_source_id"` \| `"invalid_source_kind"` \| `"invalid_content_hash"` \| `"invalid_captured_at"` \| `"invalid_author_handle"` \| `"primary_source_required"` \| `"duplicate_jira_paste_collision"` \| `"custom_input_format_required"` \| `"custom_input_format_invalid"` \| `"primary_source_input_format_invalid"` \| `"markdown_metadata_only_for_custom"` \| `"markdown_hash_required"` \| `"markdown_hash_only_for_markdown"` \| `"jira_issue_key_invalid"` \| `"jira_issue_key_only_for_jira"` \| `"invalid_conflict_resolution_policy"` \| `"priority_order_required"` \| `"priority_order_invalid_kind"` \| `"priority_order_incomplete"` \| `"priority_order_duplicate"` \| `"aggregate_hash_mismatch"` \| `"source_mix_plan_invalid"`

##### detail?

> `optional` **detail?**: `string`

##### path?

> `optional` **path?**: `string`

***

### MultiSourceModeGateDecision

Decision produced by `evaluateMultiSourceModeGate`.

#### Properties

##### allowed

> **allowed**: `boolean`

##### refusals

> **refusals**: [`MultiSourceModeGateRefusal`](#multisourcemodegaterefusal)[]

***

### MultiSourceModeGateInput

Inputs accepted by `evaluateMultiSourceModeGate`.

#### Properties

##### llmCodegenMode?

> `optional` **llmCodegenMode?**: `string`

##### multiSourceEnvEnabled

> **multiSourceEnvEnabled**: `boolean`

##### multiSourceStartupEnabled

> **multiSourceStartupEnabled**: `boolean`

##### testIntelligenceEnvEnabled

> **testIntelligenceEnvEnabled**: `boolean`

##### testIntelligenceStartupEnabled

> **testIntelligenceStartupEnabled**: `boolean`

***

### MultiSourceModeGateRefusal

Single refusal entry on a [MultiSourceModeGateDecision](#multisourcemodegatedecision).

#### Properties

##### code

> **code**: `"test_intelligence_disabled"` \| `"multi_source_env_disabled"` \| `"multi_source_startup_option_disabled"` \| `"llm_codegen_mode_locked"`

##### detail

> **detail**: `string`

***

### MultiSourceReconciliationReport

Aggregate deterministic conflict artifact emitted for a reconciled run.

#### Properties

##### conflicts

> **conflicts**: [`MultiSourceConflict`](#multisourceconflict)[]

##### contributingSourcesPerCase

> **contributingSourcesPerCase**: `object`[]

Stable conceptual-case mapping used by downstream reviewers. Each id is a
deterministic synthetic case key produced by the reconciliation engine.

###### sourceIds

> **sourceIds**: `string`[]

###### testCaseId

> **testCaseId**: `string`

##### envelopeHash

> **envelopeHash**: `string`

##### policyApplied

> **policyApplied**: `"priority"` \| `"reviewer_decides"` \| `"keep_both"`

##### transcript

> **transcript**: [`MultiSourceReconciliationTranscriptEntry`](#multisourcereconciliationtranscriptentry)[]

##### unmatchedSources

> **unmatchedSources**: `string`[]

Sources that were present but contributed no accepted or conflict rows.

##### version

> **version**: `"1.0.0"`

***

### MultiSourceReconciliationTranscriptEntry

Stable transcript row describing one merge decision taken by the engine.

#### Properties

##### action

> **action**: `"accepted"` \| `"merged"` \| `"conflict_recorded"` \| `"alternative_emitted"` \| `"source_unmatched"`

##### affectedElementIds

> **affectedElementIds**: `string`[]

##### decisionId

> **decisionId**: `string`

##### rationale

> **rationale**: `string`

##### sourceIds

> **sourceIds**: `string`[]

***

### MultiSourceSourceProvenanceRecord

Per-source provenance record in the evidence manifest.
One entry per source-IR artifact emitted under `<runDir>/sources/<sourceId>/`.

#### Properties

##### authorHandle?

> `optional` **authorHandle?**: `string`

Author handle (reviewer-supplied for paste/custom sources).

##### bytes

> **bytes**: `number`

##### capturedAt?

> `optional` **capturedAt?**: `string`

ISO-8601 capture timestamp.

##### contentHash

> **contentHash**: `string`

##### kind

> **kind**: `"figma_plugin"` \| `"figma_local_json"` \| `"figma_rest"` \| `"jira_rest"` \| `"jira_paste"` \| `"custom_text"` \| `"custom_structured"` \| `"custom_markdown"`

##### sourceId

> **sourceId**: `string`

***

### MultiSourceTestIntentEnvelope

Aggregate envelope of contributing sources (Issue #1431).

The envelope is a pure value object; ingestion logic, reconciliation,
and orchestration live in downstream Wave 4 issues (4.B / 4.C / 4.D /
4.E / 4.F / 4.H). The envelope guarantees:

  1. At least one source.
  2. At least one primary source (primary-source-required rule).
  3. Stable [aggregateContentHash](#aggregatecontenthash-1) that is invariant under source
     reordering when [conflictResolutionPolicy](#conflictresolutionpolicy) is not `priority`,
     and changes when source content actually changes.
  4. When `conflictResolutionPolicy="priority"`, a non-empty
     [priorityOrder](#priorityorder) listing every source kind present in the
     envelope (no extras).

#### Properties

##### aggregateContentHash

> **aggregateContentHash**: `string`

Stable aggregate hash of the contributing sources. Computed via
`sha256Hex` of the canonical-sorted (`contentHash`, `kind`) pairs by
default, with the `priorityOrder` mixed in when the resolution policy
is `priority`.

##### conflictResolutionPolicy

> **conflictResolutionPolicy**: `"priority"` \| `"reviewer_decides"` \| `"keep_both"`

Resolution discriminant for cross-source disagreement.

##### priorityOrder?

> `optional` **priorityOrder?**: (`"figma_plugin"` \| `"figma_local_json"` \| `"figma_rest"` \| `"jira_rest"` \| `"jira_paste"` \| `"custom_text"` \| `"custom_structured"` \| `"custom_markdown"`)[]

Required when [conflictResolutionPolicy](#conflictresolutionpolicy) is `priority`: an
ordered, deduplicated list of source kinds covering every kind that
appears in [sources](#sources). The list participates in the aggregate
hash so a different priority order produces a different hash.

##### sourceMixPlan?

> `optional` **sourceMixPlan?**: [`MultiSourceTestIntentSourceMixPlanRef`](#multisourcetestintentsourcemixplanref)

Optional source-mix plan hook owned by Issue #1441.

##### sources

> **sources**: [`TestIntentSourceRef`](#testintentsourceref)[]

Ordered list of contributing sources (length ≥ 1).

##### version

> **version**: `"1.0.0"`

Schema version stamp.

***

### MultiSourceTestIntentSourceMixPlanRef

Forward reference for source-mix orchestration owned by Issue #1441. Wave
4.A validates the shape only; pipeline routing and reconciliation remain in
the downstream source-mix issue.

#### Properties

##### ownerIssue

> **ownerIssue**: `"#1441"`

Ownership marker for downstream orchestration.

##### planHash

> **planHash**: `string`

Stable hash of the source-mix plan payload owned by Issue #1441.

***

### OpenTextAlmExportProfile

Operator-tunable knobs of an OpenText ALM reference export profile.

#### Properties

##### cdataDescription

> **cdataDescription**: `boolean`

Whether to wrap the test-case description in a CDATA block so that
embedded markup survives ALM round-trips.

##### description

> **description**: `string`

##### id

> **id**: `string`

##### rootFolderPath

> **rootFolderPath**: `string`

Folder path prepended to every per-case `targetFolderPath`.

##### version

> **version**: `string`

***

### PiiIndicator

PII indicator attached to a detected element. Original values are never persisted.

#### Properties

##### confidence

> **confidence**: `number`

##### elementId?

> `optional` **elementId?**: `string`

##### id

> **id**: `string`

##### kind

> **kind**: [`PiiKind`](#piikind)

##### matchLocation

> **matchLocation**: [`PiiMatchLocation`](#piimatchlocation)

##### redacted

> **redacted**: `string`

##### screenId?

> `optional` **screenId?**: `string`

##### traceRef?

> `optional` **traceRef?**: [`IntentTraceRef`](#intenttraceref)

***

### QcCreatedEntitiesArtifact

Aggregate `qc-created-entities.json` artifact (Issue #1372).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### entities

> **entities**: [`QcCreatedEntity`](#qccreatedentity)[]

Sorted by `testCaseId` for deterministic emission.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### profileId

> **profileId**: `string`

##### profileVersion

> **profileVersion**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### transferUrlIncluded

> **transferUrlIncluded**: `false`

Hard invariant: never carries the resolved transfer URL.

***

### QcCreatedEntity

Single created QC entity row in `qc-created-entities.json`.

#### Properties

##### createdAt

> **createdAt**: `string`

ISO-8601 UTC timestamp at which the entity was first created.

##### designStepCount

> **designStepCount**: `number`

Number of design steps persisted alongside the entity.

##### externalIdCandidate

> **externalIdCandidate**: `string`

##### preExisting

> **preExisting**: `boolean`

`true` when the entity already existed on a prior transfer run for
the same `(externalIdCandidate, targetFolderPath)` tuple. Idempotent
re-runs preserve this flag so audit logs document the lineage.

##### qcEntityId

> **qcEntityId**: `string`

##### targetFolderPath

> **targetFolderPath**: `string`

Forward-slash-separated folder path under the profile root.

##### testCaseId

> **testCaseId**: `string`

***

### QcMappingPreviewArtifact

Aggregate QC mapping preview artifact.

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### entries

> **entries**: [`QcMappingPreviewEntry`](#qcmappingpreviewentry)[]

Sorted by `testCaseId` for deterministic emission.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### profileId

> **profileId**: `string`

##### profileVersion

> **profileVersion**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

***

### QcMappingPreviewEntry

Single per-test-case mapping preview row consumed by QC/ALM operators.

#### Properties

##### blockingReasons

> **blockingReasons**: `string`[]

##### designSteps

> **designSteps**: [`GeneratedTestCaseStep`](#generatedtestcasestep)[]

##### expectedResults

> **expectedResults**: `string`[]

##### exportable

> **exportable**: `boolean`

##### externalIdCandidate

> **externalIdCandidate**: `string`

Deterministic candidate external id used for idempotent later transfer.

##### objective

> **objective**: `string`

##### preconditions

> **preconditions**: `string`[]

##### priority

> **priority**: [`TestCasePriority`](#testcasepriority)

##### riskCategory

> **riskCategory**: [`TestCaseRiskCategory`](#testcaseriskcategory)

##### sourceTraceRefs

> **sourceTraceRefs**: [`GeneratedTestCaseFigmaTrace`](#generatedtestcasefigmatrace)[]

Subset of figmaTraceRefs sufficient for round-trip provenance.

##### targetFolderPath

> **targetFolderPath**: `string`

Forward-slash-separated folder path under the profile root.

##### testCaseId

> **testCaseId**: `string`

##### testData

> **testData**: `string`[]

##### testName

> **testName**: `string`

##### visualProvenance?

> `optional` **visualProvenance?**: [`QcMappingVisualProvenance`](#qcmappingvisualprovenance)

***

### QcMappingProfile

Provider-neutral mapping profile shape consumed by all QC adapters.

#### Properties

##### baseUrlAlias

> **baseUrlAlias**: `string`

Symbolic alias for the base URL of the target QC tenant. Adapters
resolve the actual URL from operator-supplied secrets at call time;
the alias never carries credentials and never embeds userinfo.

##### designStepMapping

> **designStepMapping**: `object`

Per-design-step field mapping. The keys are the GeneratedTestCaseStep
fields that participate in the QC step entity (`action`, `expected`,
`data`); the values are the QC field names they map to.

###### action

> **action**: `string`

###### data?

> `optional` **data?**: `string`

###### expected

> **expected**: `string`

##### domain

> **domain**: `string`

Tenant domain (e.g. `DEFAULT`).

##### id

> **id**: `string`

Profile identity (e.g. `opentext-alm-default`).

##### project

> **project**: `string`

Tenant project (e.g. `payments-checkout`).

##### provider

> **provider**: `"opentext_alm"` \| `"opentext_octane"` \| `"opentext_valueedge"` \| `"xray"` \| `"testrail"` \| `"azure_devops_test_plans"` \| `"qtest"` \| `"custom"`

QC provider this profile targets.

##### requiredFields

> **requiredFields**: `string`[]

Required field names enforced on each mapped case. Sorted, deduped.

##### targetFolderPath

> **targetFolderPath**: `string`

Forward-slash-separated `/Subject/...` folder path used as default root.

##### testEntityType

> **testEntityType**: `string`

Test entity type string accepted by the QC tool (e.g. `MANUAL`).

##### version

> **version**: `string`

***

### QcMappingProfileIssue

Single mapping-profile validation issue.

#### Properties

##### code

> **code**: `"missing_base_url_alias"` \| `"invalid_base_url_alias"` \| `"missing_domain"` \| `"missing_project"` \| `"missing_target_folder_path"` \| `"invalid_target_folder_path"` \| `"missing_test_entity_type"` \| `"unsupported_test_entity_type"` \| `"missing_required_fields"` \| `"duplicate_required_field"` \| `"missing_design_step_mapping"` \| `"design_step_mapping_field_invalid"` \| `"credential_like_field_present"` \| `"provider_mismatch"` \| `"profile_id_mismatch"`

##### message

> **message**: `string`

##### path

> **path**: `string`

##### severity

> **severity**: [`TestCaseValidationSeverity`](#testcasevalidationseverity)

***

### QcMappingProfileValidationResult

Aggregate mapping-profile validation result.

#### Properties

##### errorCount

> **errorCount**: `number`

##### issues

> **issues**: [`QcMappingProfileIssue`](#qcmappingprofileissue)[]

##### ok

> **ok**: `boolean`

##### warningCount

> **warningCount**: `number`

***

### QcMappingVisualProvenance

Visual provenance attached to a QC mapping preview entry (Issue #1386).

#### Properties

##### ambiguityCount

> **ambiguityCount**: `number`

##### confidenceMean

> **confidenceMean**: `number`

##### deployment

> **deployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

##### evidenceHash

> **evidenceHash**: `string`

SHA-256 hex of the derived validation-record identity tuple
`(screenId|deployment|sortedOutcomes|roundedConfidence)`. This is not a
raw screenshot hash and does not include request headers or secrets.

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

***

### QcProviderCapabilities

Capability matrix for a QC provider (Issue #1374).

Each flag mirrors a `QcProviderOperation`. Wave 3 ships only the
`opentext_alm` provider with the full matrix `true`; the other six
builtin providers advertise dry-run + validate only and refuse writes.
The reserved `custom` slot is published with every flag `false` until a
caller registers a concrete adapter.

The shape is a closed product type so a future operation cannot be
silently introduced without a contract bump — every consumer reading the
matrix today is guaranteed to see exactly these six fields.

#### Properties

##### apiTransfer

> **apiTransfer**: `boolean`

Adapter can perform controlled API writes against the live tool.

##### dryRun

> **dryRun**: `boolean`

Adapter can emit a `DryRunReportArtifact` (concrete or fail-closed stub).

##### exportOnly

> **exportOnly**: `boolean`

Adapter can emit export-only artifacts (CSV/XLSX/XML).

##### registerCustom

> **registerCustom**: `boolean`

Caller may register a concrete custom adapter under this provider id.

##### resolveTargetFolder

> **resolveTargetFolder**: `boolean`

Adapter knows how to validate a target folder path (read-only).

##### validateProfile

> **validateProfile**: `boolean`

Adapter exposes a structural `validateProfile` pass.

***

### QcProviderDescriptor

Descriptor for a builtin or custom-registered QC provider (Issue #1374).

Descriptors are returned by the registry so a UI or operator audit can
answer "which providers are wired up and what can they do?" without
loading any adapter implementation. They carry no credentials, no URLs,
and no runtime mutable state.

#### Properties

##### builtin

> **builtin**: `boolean`

True for the eight in-tree descriptors; false for caller-registered slots.

##### capabilities

> **capabilities**: [`QcProviderCapabilities`](#qcprovidercapabilities)

Capability matrix advertised for this provider.

##### label

> **label**: `string`

Short human-readable label, e.g. `"OpenText ALM"`.

##### mappingProfileSeedId?

> `optional` **mappingProfileSeedId?**: `string`

Optional pointer to the mapping-profile factory id a caller can use to
seed a fresh profile (e.g. `opentext-alm-default`). Absent when the
provider has no in-tree default profile yet.

##### provider

> **provider**: `"opentext_alm"` \| `"opentext_octane"` \| `"opentext_valueedge"` \| `"xray"` \| `"testrail"` \| `"azure_devops_test_plans"` \| `"qtest"` \| `"custom"`

Provider discriminator from `ALLOWED_QC_ADAPTER_PROVIDERS`.

##### version

> **version**: `string`

Semver-shaped descriptor version, bumped when the matrix changes.

***

### RegulatoryRelevance

Optional per-test-case regulatory-relevance signal (Issue #1735, contract
bump 4.27.0). Populated by the production runner when the source screen
matches a banking / insurance semantic keyword (see
[BANKING\_INSURANCE\_SEMANTIC\_KEYWORDS](#banking_insurance_semantic_keywords)) or when the prompt-augmentation
pass produced a compliance-flavoured case (PII / IBAN rejection,
four-eyes / audit-trail, regulated-data boundary).

The field is optional — non-banking/insurance Figma sources do not emit
it, which means existing artifacts and replay-cache entries from contract
version 4.26.0 remain valid (additive, backwards-compatible field).

#### Properties

##### domain

> **domain**: `"banking"` \| `"insurance"` \| `"general"`

##### rationale

> **rationale**: `string`

Free-form German rationale (≤ 240 chars) explaining why the case carries
regulatory weight. Generic compliance language only; the prompt
augmentation forbids the model from citing specific paragraphs.

***

### ReplayCacheEntry

Stored cache entry.

#### Properties

##### key

> **key**: `string`

##### storedAt

> **storedAt**: `string`

##### testCases

> **testCases**: [`GeneratedTestCaseList`](#generatedtestcaselist)

***

### ReplayCacheKey

Replay-cache key — the only deterministic-bit-identical replay anchor.

#### Properties

##### fixtureImageHash?

> `optional` **fixtureImageHash?**: `string`

##### gatewayRelease

> **gatewayRelease**: `string`

##### inputHash

> **inputHash**: `string`

##### modelRevision

> **modelRevision**: `string`

##### policyBundleVersion

> **policyBundleVersion**: `string`

##### promptHash

> **promptHash**: `string`

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

##### seed?

> `optional` **seed?**: `number`

##### sourceMixPlanHash?

> `optional` **sourceMixPlanHash?**: `string`

##### visualFallbackReason

> **visualFallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

##### visualSelectedDeployment

> **visualSelectedDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### ReviewEvent

Single immutable event appended to the review-gate event log.

#### Properties

##### actor?

> `optional` **actor?**: `string`

Optional opaque actor handle; never an email or token.

##### at

> **at**: `string`

ISO-8601 UTC timestamp at the moment of persistence.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### fromState?

> `optional` **fromState?**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"pending_secondary_approval"` \| `"edited"` \| `"exported"` \| `"transferred"`

##### id

> **id**: `string`

Globally unique opaque identifier; generated server-side.

##### jobId

> **jobId**: `string`

##### kind

> **kind**: `"approved"` \| `"rejected"` \| `"review_started"` \| `"note"` \| `"generated"` \| `"edited"` \| `"exported"` \| `"transferred"` \| `"primary_approved"` \| `"secondary_approved"`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>

Flat metadata (no nested objects).

##### note?

> `optional` **note?**: `string`

Optional human-readable note (length-bounded by the store).

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### sequence

> **sequence**: `number`

Monotonic 1-based per-job sequence; gap-free.

##### testCaseId?

> `optional` **testCaseId?**: `string`

Unset when the event is job-level (e.g. seed).

##### toState?

> `optional` **toState?**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"pending_secondary_approval"` \| `"edited"` \| `"exported"` \| `"transferred"`

***

### ReviewGateSnapshot

Aggregate per-job review-gate snapshot.

#### Properties

##### approvedCount

> **approvedCount**: `number`

Number of cases currently in `approved` (or `exported`/`transferred`) state.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### fourEyesPolicy?

> `optional` **fourEyesPolicy?**: [`FourEyesPolicy`](#foureyespolicy)

Resolved four-eyes policy that produced this snapshot. Optional for
backward compatibility. When present, both arrays are sorted /
deduplicated (#1376).

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### needsReviewCount

> **needsReviewCount**: `number`

Number of cases currently in `needs_review` state.

##### pendingSecondaryApprovalCount?

> `optional` **pendingSecondaryApprovalCount?**: `number`

Number of cases currently awaiting a second distinct approver
(state = `pending_secondary_approval`). Optional for backward
compatibility; consumers must treat absence as `0` (#1376).

##### perTestCase

> **perTestCase**: [`ReviewSnapshot`](#reviewsnapshot)[]

Sorted by `testCaseId` for deterministic emission.

##### rejectedCount

> **rejectedCount**: `number`

Number of cases currently in `rejected` state.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

***

### ReviewSnapshot

Per-test-case review-state snapshot.

#### Properties

##### approvers

> **approvers**: `string`[]

Set of distinct reviewer actors that have approved this case in
sequence. Sorted, deduplicated. For four-eyes-enforced cases the
first entry is the primary approver, the second the secondary.

##### fourEyesEnforced

> **fourEyesEnforced**: `boolean`

Whether the resolved four-eyes policy requires two distinct
authenticated principals before this case may reach `approved`.
When `true`, the export pipeline refuses cases not in `approved`,
`exported`, or `transferred` state (#1376).

##### fourEyesReasons?

> `optional` **fourEyesReasons?**: (`"multi_source_conflict_present"` \| `"risk_category"` \| `"visual_low_confidence"` \| `"visual_fallback_used"` \| `"visual_possible_pii"` \| `"visual_prompt_injection"` \| `"visual_metadata_conflict"`)[]

Reasons four-eyes is enforced (#1376). Empty when
`fourEyesEnforced=false`. Sorted deterministic. Optional for
backward compatibility; consumers should treat absence as
"no recorded reasons" (i.e. older snapshots before #1376 shipped).

##### lastEditor?

> `optional` **lastEditor?**: `string`

Identity of the actor who recorded the most recent `edited` event
for this case, if any. Used by the four-eyes gate to refuse
approvals submitted by the same principal that authored the edit
(self-approval refusal).

##### lastEventAt

> **lastEventAt**: `string`

##### lastEventId

> **lastEventId**: `string`

Identifier of the most recent event affecting this case.

##### policyDecision

> **policyDecision**: `"approved"` \| `"blocked"` \| `"needs_review"`

##### primaryApprovalAt?

> `optional` **primaryApprovalAt?**: `string`

ISO-8601 UTC timestamp at which the primary approval was recorded.

##### primaryReviewer?

> `optional` **primaryReviewer?**: `string`

Identity of the first distinct approver, recorded when a four-eyes
case transitions out of `needs_review`/`edited`. Optional for
non-enforced cases and for snapshots written before any approval.

##### secondaryApprovalAt?

> `optional` **secondaryApprovalAt?**: `string`

ISO-8601 UTC timestamp at which the secondary approval was recorded.

##### secondaryReviewer?

> `optional` **secondaryReviewer?**: `string`

Identity of the second distinct approver, recorded when a four-eyes
case transitions from `pending_secondary_approval` to `approved`.

##### state

> **state**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"pending_secondary_approval"` \| `"edited"` \| `"exported"` \| `"transferred"`

##### testCaseId

> **testCaseId**: `string`

***

### SelfVerifyRubricAggregateScores

Job-level aggregate of the rubric pass.

#### Properties

##### dimensionScores

> **dimensionScores**: [`SelfVerifyRubricDimensionScore`](#selfverifyrubricdimensionscore)[]

Job-level mean per rubric dimension; sorted by dimension name.

##### jobLevelRubricScore

> **jobLevelRubricScore**: `number`

Mean of the per-case `rubricScore` values across the job.

##### visualSubscores?

> `optional` **visualSubscores?**: [`SelfVerifyRubricVisualSubscore`](#selfverifyrubricvisualsubscore)[]

Job-level mean per visual subscore when the rubric pass scored visuals.

***

### SelfVerifyRubricCaseEvaluation

Per-test-case rubric evaluation row.

#### Properties

##### citations

> **citations**: [`SelfVerifyRubricRuleCitation`](#selfverifyrubricrulecitation)[]

Sorted by `ruleId` for byte stability. Empty array when no rule fired.

##### dimensions

> **dimensions**: [`SelfVerifyRubricDimensionScore`](#selfverifyrubricdimensionscore)[]

Sorted by dimension name for byte stability.

##### rubricScore

> **rubricScore**: `number`

Aggregate per-case rubric score in `[0, 1]`. Arithmetic mean of the
dimensions and visual subscores; rounded to 6 digits in the artifact.

##### testCaseId

> **testCaseId**: `string`

##### visualSubscores?

> `optional` **visualSubscores?**: [`SelfVerifyRubricVisualSubscore`](#selfverifyrubricvisualsubscore)[]

Visual subscores when the rubric pass had a visual sidecar input.

***

### SelfVerifyRubricDimensionScore

Single dimension score in the persisted rubric report.

#### Properties

##### dimension

> **dimension**: `"schema_conformance"` \| `"source_trace_completeness"` \| `"assumption_open_question_marking"` \| `"expected_result_coverage"` \| `"negative_boundary_presence"` \| `"duplication_flag_consistency"`

##### score

> **score**: `number`

Score in `[0, 1]`; rounded to 6 digits in the persisted artifact.

***

### SelfVerifyRubricRefusal

Refusal record emitted when the rubric pass cannot publish scores.

#### Properties

##### code

> **code**: `"feature_disabled"` \| `"gateway_failure"` \| `"model_binding_mismatch"` \| `"schema_invalid_response"` \| `"score_out_of_range"` \| `"missing_test_case_score"` \| `"extra_test_case_score"` \| `"duplicate_test_case_score"` \| `"image_payload_attempted"`

##### message

> **message**: `string`

Sanitized + truncated message; no secrets, no chain-of-thought.

***

### SelfVerifyRubricReplayCacheEntry

Stored cache entry for a rubric report.

#### Properties

##### key

> **key**: `string`

##### report

> **report**: [`SelfVerifyRubricReport`](#selfverifyrubricreport)

##### storedAt

> **storedAt**: `string`

***

### SelfVerifyRubricReplayCacheKey

Replay-cache key for the self-verify rubric pass. The key carries a
hard discriminator (`passKind`) so it can never collide with the
test-generation replay cache key, even when other identity fields
happen to match.

#### Properties

##### compatibilityMode

> **compatibilityMode**: `"openai_chat"`

Gateway compatibility mode; Issue #1379 pins this to `openai_chat`.

##### gatewayRelease

> **gatewayRelease**: `string`

##### inputHash

> **inputHash**: `string`

SHA-256 of the rubric input (test cases + intent + visual descriptions).

##### modelDeployment

> **modelDeployment**: `string`

Deployment identity used for the rubric pass.

##### modelRevision

> **modelRevision**: `string`

##### passKind

> **passKind**: `"self_verify_rubric"`

##### policyBundleVersion

> **policyBundleVersion**: `string`

##### promptHash

> **promptHash**: `string`

SHA-256 of the rubric prompt + response schema identity.

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### rubricSchemaVersion

> **rubricSchemaVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

SHA-256 of the rubric response JSON schema.

##### seed?

> `optional` **seed?**: `number`

***

### SelfVerifyRubricReport

Persisted self-verify rubric pass artifact (Issue #1379).

Sibling to `validation-report.json` and `coverage-report.json` under
`<runDir>/testcases/self-verify-rubric.json`. Always byte-stable: per
case evaluations are sorted by `testCaseId`, dimension lists are
sorted by dimension name, and citations are sorted by rule id.

When a `refusal` is present, `caseEvaluations` is empty and the
`aggregate` carries `0` job/dimension scores; downstream policy gates
MUST treat the refusal as a soft signal (it does not by itself block
a job) and surface it on the inspector for operator review.

#### Properties

##### aggregate

> **aggregate**: [`SelfVerifyRubricAggregateScores`](#selfverifyrubricaggregatescores)

##### cacheHit

> **cacheHit**: `boolean`

Whether the rubric replay cache served the result without invoking the LLM.

##### cacheKeyDigest

> **cacheKeyDigest**: `string`

Hex-encoded SHA-256 digest of the rubric replay-cache key.

##### caseEvaluations

> **caseEvaluations**: [`SelfVerifyRubricCaseEvaluation`](#selfverifyrubriccaseevaluation)[]

Sorted by `testCaseId` for byte stability. Empty when `refusal` is set.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### gatewayRelease

> **gatewayRelease**: `string`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### modelDeployment

> **modelDeployment**: `string`

Identity stamps of the deployment that produced (or would have produced) the scores.

##### modelRevision

> **modelRevision**: `string`

##### policyProfileId

> **policyProfileId**: `string`

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### refusal?

> `optional` **refusal?**: [`SelfVerifyRubricRefusal`](#selfverifyrubricrefusal)

Set when the pass refused to publish scores.

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

***

### SelfVerifyRubricRuleCitation

Short, structured rule citation attached to a per-case evaluation. The
citation surfaces the rubric rule the rater applied and a short
audit-grade message. No chain-of-thought is persisted — `message` is
a single sentence the rater produced when grading the case.

#### Properties

##### message

> **message**: `string`

Audit-grade short message; sanitized + truncated by the parser.

##### ruleId

> **ruleId**: `string`

Stable rule identifier (e.g. `"schema_conformance.required_fields"`).

***

### SelfVerifyRubricVisualSubscore

Single visual subscore in the persisted rubric report.

#### Properties

##### score

> **score**: `number`

Score in `[0, 1]`; rounded to 6 digits in the persisted artifact.

##### subscore

> **subscore**: `"visible_control_coverage"` \| `"state_validation_coverage"` \| `"ambiguity_handling"` \| `"unsupported_visual_claims"`

***

### SourceMixPlan

Deterministic plan produced by the source-mix planner (Issue #1441).

The plan captures which source combinations were selected for a job, what
visual-sidecar requirement applies, and in what order the prompt compiler
must emit role-tagged source sections. It also carries hash-only source
fingerprints so the `sourceMixPlanHash` changes when source content changes,
including redacted Markdown supporting context. The `sourceMixPlanHash`
participates in the replay-cache key so a different source mix always forces
a cache miss.

Negative invariants (TYPE-LEVEL `false`):
- `figmaSourceRequired` is `false` on Jira-only and custom-enriched-Jira plans.
- `visualSidecarRequired` is `false` whenever `visualSidecarRequirement` is
  `"not_applicable"`.
- `rawJiraResponsePersisted` is always `false` — only normalized IRs are stored.
- `rawPasteBytesPersisted` is always `false` — only normalized hashes are stored.

#### Properties

##### kind

> **kind**: `"figma_only"` \| `"jira_rest_only"` \| `"jira_paste_only"` \| `"figma_jira_rest"` \| `"figma_jira_paste"` \| `"figma_jira_mixed"` \| `"jira_mixed"`

Discriminated mix kind derived from the source envelope.

##### primarySourceIds

> **primarySourceIds**: `string`[]

Ordered source IDs classified as primary sources.

##### promptSections

> **promptSections**: [`SourceMixPlanPromptSection`](#sourcemixplanpromptsection)[]

Ordered list of prompt sections the compiler must emit for this plan.
The compiler must emit each listed section and MUST NOT emit unlisted sections.

##### rawJiraResponsePersisted

> **rawJiraResponsePersisted**: `false`

Hard invariant: only normalized IRs are stored, never raw Jira API responses.

##### rawPasteBytesPersisted

> **rawPasteBytesPersisted**: `false`

Hard invariant: only redacted hashes are stored, never raw paste bytes.

##### sourceDigests?

> `optional` **sourceDigests?**: [`SourceMixPlanSourceDigest`](#sourcemixplansourcedigest)[]

Hash-only source fingerprints included in `sourceMixPlanHash` when emitted by the planner.

##### sourceMixPlanHash

> **sourceMixPlanHash**: `string`

SHA-256 of the canonical plan payload (computed before this field is set,
so the hash covers `kind`, `primarySourceIds`, `supportingSourceIds`,
`visualSidecarRequirement`, `promptSections`, and `sourceDigests`).

##### supportingSourceIds

> **supportingSourceIds**: `string`[]

Ordered source IDs classified as supporting sources.

##### version

> **version**: `"1.0.0"`

Schema version stamp.

##### visualSidecarRequirement

> **visualSidecarRequirement**: `"required"` \| `"optional"` \| `"not_applicable"`

Whether the job requires a visual sidecar pass.
- `required` — at least one Figma source is present and visual captures are expected.
- `optional` — Figma is present but no capture set was supplied.
- `not_applicable` — Jira-only or custom-only; must be `false` at runtime.

***

### SourceMixPlannerIssue

A single validation issue surfaced by the source-mix planner.

#### Properties

##### code

> **code**: `"duplicate_source_id"` \| `"primary_source_required"` \| `"unsupported_source_mix"` \| `"duplicate_jira_issue_key"` \| `"custom_markdown_hash_required"` \| `"custom_markdown_input_format_invalid"` \| `"source_mix_plan_hash_mismatch"` \| `"mode_gate_not_satisfied"`

##### detail?

> `optional` **detail?**: `string`

##### path?

> `optional` **path?**: `string`

***

### SourceMixPlanSourceDigest

Redacted source fingerprint material sealed into a source-mix plan.

The planner records hashes only, never raw Jira responses, paste bytes, or
Markdown editor input. For Markdown context, the redacted Markdown and
plain-text derivative hashes are included so `sourceMixPlanHash` changes
when sanitized supporting evidence changes.

#### Properties

##### canonicalIssueKey?

> `optional` **canonicalIssueKey?**: `string`

Canonical Jira issue key, when the source is Jira-backed.

##### contentHash

> **contentHash**: `string`

Canonical source content hash from the multi-source envelope.

##### kind

> **kind**: `"figma_plugin"` \| `"figma_local_json"` \| `"figma_rest"` \| `"jira_rest"` \| `"jira_paste"` \| `"custom_text"` \| `"custom_structured"` \| `"custom_markdown"`

Source kind from the multi-source envelope.

##### plainTextDerivativeHash?

> `optional` **plainTextDerivativeHash?**: `string`

Plain-text derivative hash for Markdown supporting context.

##### redactedMarkdownHash?

> `optional` **redactedMarkdownHash?**: `string`

Redacted Markdown hash for Markdown supporting context.

##### sourceId

> **sourceId**: `string`

Source ID from the multi-source envelope.

***

### SuggestedCustomContextAttribute

Recognized custom attribute and its intended downstream consumer.

#### Properties

##### description

> **description**: `string`

##### downstreamConsumer

> **downstreamConsumer**: `string`

##### key

> **key**: `string`

##### label

> **label**: `string`

***

### TestCaseCoverageBucket

Per-element coverage breakdown.

#### Properties

##### covered

> **covered**: `number`

Element ids covered by at least one accepted test case.

##### ratio

> **ratio**: `number`

Coverage ratio in [0, 1]; 0 when total=0 (no elements => no gap).

##### total

> **total**: `number`

Total IR elements of this kind across the job.

##### uncoveredIds

> **uncoveredIds**: `string`[]

Element ids that have no covering test case.

***

### TestCaseCoverageReport

Coverage/quality signals across one job's generated test cases.

#### Properties

##### accessibilityCaseCount

> **accessibilityCaseCount**: `number`

##### actionCoverage

> **actionCoverage**: [`TestCaseCoverageBucket`](#testcasecoveragebucket)

##### assumptionsRatio

> **assumptionsRatio**: `number`

Avg assumptions per case.

##### boundaryCaseCount

> **boundaryCaseCount**: `number`

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### duplicatePairs

> **duplicatePairs**: [`TestCaseDuplicatePair`](#testcaseduplicatepair)[]

Test-case pairs sharing >= duplicate threshold.

##### fieldCoverage

> **fieldCoverage**: [`TestCaseCoverageBucket`](#testcasecoveragebucket)

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### navigationCoverage

> **navigationCoverage**: [`TestCaseCoverageBucket`](#testcasecoveragebucket)

##### negativeCaseCount

> **negativeCaseCount**: `number`

##### openQuestionsCount

> **openQuestionsCount**: `number`

Total open questions across all cases.

##### policyProfileId

> **policyProfileId**: `string`

##### positiveCaseCount

> **positiveCaseCount**: `number`

##### rubricScore?

> `optional` **rubricScore?**: `number`

Optional 0..1 rubric score from a downstream rater (Wave 2).

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### totalTestCases

> **totalTestCases**: `number`

##### traceCoverage

> **traceCoverage**: `object`

###### ratio

> **ratio**: `number`

###### total

> **total**: `number`

###### withTrace

> **withTrace**: `number`

##### validationCaseCount

> **validationCaseCount**: `number`

##### validationCoverage

> **validationCoverage**: [`TestCaseCoverageBucket`](#testcasecoveragebucket)

##### workflowCaseCount

> **workflowCaseCount**: `number`

***

### TestCaseDedupeReport

Aggregate dedupe report artifact (Issue #1373).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### embeddingProvider

> **embeddingProvider**: `object`

Whether the embedding path participated in the run.

###### configured

> **configured**: `boolean`

###### identifier?

> `optional` **identifier?**: `string`

##### embeddingThreshold?

> `optional` **embeddingThreshold?**: `number`

Threshold above which embedding similarity is reported (0..1).

##### externalFindings

> **externalFindings**: [`DedupeExternalFinding`](#dedupeexternalfinding)[]

##### externalProbe

> **externalProbe**: `object`

###### cases

> **cases**: `number`

Number of test cases probed; zero on `disabled`/`unconfigured`.

###### note?

> `optional` **note?**: `string`

Sanitized informational note when the probe declined to run.

###### state

> **state**: `"executed"` \| `"disabled"` \| `"unconfigured"` \| `"partial_failure"`

##### generatedAt

> **generatedAt**: `string`

##### internalFindings

> **internalFindings**: [`DedupeInternalFinding`](#dedupeinternalfinding)[]

##### jobId

> **jobId**: `string`

##### lexicalThreshold

> **lexicalThreshold**: `number`

Threshold above which lexical similarity is reported (0..1).

##### perCase

> **perCase**: [`DedupeCaseVerdict`](#dedupecaseverdict)[]

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

##### totals

> **totals**: `object`

###### duplicates

> **duplicates**: `number`

###### externalMatches

> **externalMatches**: `number`

###### internalEmbedding

> **internalEmbedding**: `number`

###### internalLexical

> **internalLexical**: `number`

***

### TestCaseDeltaReport

Aggregate test-case delta report (always paired with `IntentDeltaReport`).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

##### rows

> **rows**: [`TestCaseDeltaRow`](#testcasedeltarow)[]

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

##### totals

> **totals**: `object`

###### changed

> **changed**: `number`

###### new

> **new**: `number`

###### obsolete

> **obsolete**: `number`

###### requiresReview

> **requiresReview**: `number`

###### unchanged

> **unchanged**: `number`

***

### TestCaseDeltaRow

Single per-case classification row.

#### Properties

##### affectedScreenIds

> **affectedScreenIds**: `string`[]

Sorted figma screen ids implicated by this row.

##### currentFingerprintHash?

> `optional` **currentFingerprintHash?**: `string`

SHA-256 hex of the current fingerprint when present.

##### priorFingerprintHash?

> `optional` **priorFingerprintHash?**: `string`

SHA-256 hex of the prior fingerprint when present.

##### reasons

> **reasons**: (`"absent_in_current"` \| `"absent_in_prior"` \| `"fingerprint_changed"` \| `"trace_screen_changed"` \| `"trace_screen_removed"` \| `"visual_ambiguity_increased"` \| `"visual_confidence_dropped"` \| `"reconciliation_conflict"`)[]

Sorted, deduplicated reasons that fired.

##### testCaseId

> **testCaseId**: `string`

##### verdict

> **verdict**: `"unchanged"` \| `"changed"` \| `"new"` \| `"obsolete"` \| `"requires_review"`

***

### TestCaseDuplicatePair

Pair of generated test case ids exceeding the similarity threshold.

#### Properties

##### leftTestCaseId

> **leftTestCaseId**: `string`

##### rightTestCaseId

> **rightTestCaseId**: `string`

##### similarity

> **similarity**: `number`

***

### TestCasePolicyDecisionRecord

Per-test-case policy decision row.

#### Properties

##### decision

> **decision**: `"approved"` \| `"blocked"` \| `"needs_review"`

##### testCaseId

> **testCaseId**: `string`

##### violations

> **violations**: [`TestCasePolicyViolation`](#testcasepolicyviolation)[]

***

### TestCasePolicyProfile

Built-in policy profile shape. Profiles are identified by `id`+`version`.

#### Properties

##### description

> **description**: `string`

##### id

> **id**: `string`

##### rules

> **rules**: [`TestCasePolicyProfileRules`](#testcasepolicyprofilerules-1)

##### version

> **version**: `string`

***

### TestCasePolicyProfileRules

Tunable knobs of a policy profile (defaults shown for `eu-banking-default`).

#### Properties

##### duplicateSimilarityThreshold

> **duplicateSimilarityThreshold**: `number`

Max Jaccard similarity above which two cases are flagged as duplicates.

##### enforceRiskTagDowngradeDetection?

> `optional` **enforceRiskTagDowngradeDetection?**: `boolean`

Whether the policy gate must cross-reference each generated test case's
declared `riskCategory` against the risk classification derivable from the
Business Test Intent IR for the screens referenced in the case's
`figmaTraceRefs`. When enabled (the secure default), any case that
declares a risk category outside `reviewOnlyRiskCategories` while the
intent IR derives a review-only classification for one of its screens
raises a `risk_tag_downgrade_detected` outcome at both per-case and
job-level. The case is escalated to `needs_review` (defense-in-depth
against an out-of-band caller submitting forged low-risk tags).

Optional for backward compatibility. Treat `undefined` as `true`.

##### maxAssumptionsPerCase

> **maxAssumptionsPerCase**: `number`

Max assumption count per case before review is required.

##### maxOpenQuestionsPerCase

> **maxOpenQuestionsPerCase**: `number`

Max open-question count per case before review is required.

##### minConfidence

> **minConfidence**: `number`

Min generator-side confidence; below this threshold => needs_review.

##### requireAccessibilityCaseWhenFormPresent

> **requireAccessibilityCaseWhenFormPresent**: `boolean`

Whether a screen with form fields requires at least one accessibility case.

##### requireBoundaryCaseForRequiredFields

> **requireBoundaryCaseForRequiredFields**: `boolean`

Whether each required field requires at least one boundary case.

##### requireNegativeOrValidationForValidationRules

> **requireNegativeOrValidationForValidationRules**: `boolean`

Whether each detected validation rule requires at least one negative/validation case.

##### reviewOnlyRiskCategories

> **reviewOnlyRiskCategories**: [`TestCaseRiskCategory`](#testcaseriskcategory)[]

Risk categories that always require manual review.

##### strictRiskCategories

> **strictRiskCategories**: [`TestCaseRiskCategory`](#testcaseriskcategory)[]

Risk categories that block export when missing trace/expected/PII checks fail.

***

### TestCasePolicyReport

Aggregate policy report across one job's generated test cases.

#### Properties

##### approvedCount

> **approvedCount**: `number`

##### blocked

> **blocked**: `boolean`

Whether ANY case was blocked (downstream export gate).

##### blockedCount

> **blockedCount**: `number`

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### decisions

> **decisions**: [`TestCasePolicyDecisionRecord`](#testcasepolicydecisionrecord)[]

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### jobLevelViolations

> **jobLevelViolations**: [`TestCasePolicyViolation`](#testcasepolicyviolation)[]

Job-level policy violations (e.g., job-wide duplicate fingerprint).

##### needsReviewCount

> **needsReviewCount**: `number`

##### policyProfileId

> **policyProfileId**: `string`

##### policyProfileVersion

> **policyProfileVersion**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### totalTestCases

> **totalTestCases**: `number`

***

### TestCasePolicyViolation

Single policy-rule violation surfaced for a generated test case.

#### Properties

##### outcome

> **outcome**: `"schema_invalid"` \| `"missing_trace"` \| `"missing_expected_results"` \| `"semantic_suspicious_content"` \| `"pii_in_test_data"` \| `"missing_negative_or_validation_for_required_field"` \| `"missing_accessibility_case"` \| `"missing_boundary_case"` \| `"duplicate_test_case"` \| `"regulated_risk_review_required"` \| `"ambiguity_review_required"` \| `"qc_mapping_not_exportable"` \| `"low_confidence_review_required"` \| `"open_questions_review_required"` \| `"visual_sidecar_failure"` \| `"visual_sidecar_fallback_used"` \| `"visual_sidecar_low_confidence"` \| `"visual_sidecar_possible_pii"` \| `"visual_sidecar_prompt_injection_text"` \| `"risk_tag_downgrade_detected"` \| `"custom_context_risk_escalation"` \| `"multi_source_conflict_present"`

##### path?

> `optional` **path?**: `string`

JSON-pointer-style path inside the test case if applicable.

##### reason

> **reason**: `string`

##### rule

> **rule**: `string`

##### severity

> **severity**: [`TestCaseValidationSeverity`](#testcasevalidationseverity)

***

### TestCaseQualitySignalRubric

Per-test-case rubric quality signal emitted by the self-verify pass
(Issue #1379). The signal is reported via the `self-verify-rubric.json`
artifact rather than mutated onto the cached `GeneratedTestCase` so
the strict generated-test-case JSON schema and the replay-cache
identity remain byte-stable. Each row mirrors one
`SelfVerifyRubricCaseEvaluation` from the rubric report and is
surfaced on the inspector + the audit-timeline as a quality signal of
the underlying test case.

#### Properties

##### rubricScore

> **rubricScore**: `number`

0..1 aggregate rubric score for this case (rounded to 6 digits).

##### testCaseId

> **testCaseId**: `string`

***

### TestCaseValidationIssue

Single semantic / structural validation issue.

#### Properties

##### code

> **code**: `"schema_invalid"` \| `"missing_trace"` \| `"trace_screen_unknown"` \| `"missing_expected_results"` \| `"steps_unordered"` \| `"steps_indices_non_sequential"` \| `"step_action_empty"` \| `"step_action_too_long"` \| `"duplicate_step_index"` \| `"duplicate_test_case_id"` \| `"title_empty"` \| `"objective_empty"` \| `"risk_category_invalid_for_intent"` \| `"qc_mapping_blocking_reasons_missing"` \| `"qc_mapping_exportable_inconsistent"` \| `"quality_signals_confidence_out_of_range"` \| `"quality_signals_coverage_unknown_id"` \| `"test_data_pii_detected"` \| `"test_data_unredacted_value"` \| `"preconditions_pii_detected"` \| `"expected_results_pii_detected"` \| `"assumptions_excessive"` \| `"open_questions_excessive"` \| `"ambiguity_without_review_state"` \| `"semantic_suspicious_content"`

##### message

> **message**: `string`

##### path

> **path**: `string`

##### severity

> **severity**: [`TestCaseValidationSeverity`](#testcasevalidationseverity)

##### testCaseId?

> `optional` **testCaseId?**: `string`

***

### TestCaseValidationReport

Aggregate validation outcome across one job's generated test cases.

#### Properties

##### blocked

> **blocked**: `boolean`

Whether the report blocks downstream review/export (any error => true).

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### errorCount

> **errorCount**: `number`

##### generatedAt

> **generatedAt**: `string`

##### issues

> **issues**: [`TestCaseValidationIssue`](#testcasevalidationissue)[]

##### jobId

> **jobId**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### totalTestCases

> **totalTestCases**: `number`

##### warningCount

> **warningCount**: `number`

***

### TestDesignAction

#### Properties

##### actionId

> **actionId**: `string`

##### ambiguity?

> `optional` **ambiguity?**: `string`

##### kind

> **kind**: `string`

##### label

> **label**: `string`

##### targetScreenId?

> `optional` **targetScreenId?**: `string`

***

### TestDesignAssumption

#### Properties

##### assumptionId

> **assumptionId**: `string`

##### text

> **text**: `string`

***

### TestDesignCalculation

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: `string`

##### calculationId

> **calculationId**: `string`

##### inputElementIds

> **inputElementIds**: `string`[]

##### name

> **name**: `string`

***

### TestDesignElement

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: `string`

##### defaultValue?

> `optional` **defaultValue?**: `string`

##### elementId

> **elementId**: `string`

##### kind

> **kind**: `string`

##### label

> **label**: `string`

***

### TestDesignModel

Compact, versioned projection of `BusinessTestIntentIr` plus optional
visual-sidecar evidence. This additive artifact gives downstream prompt
compilation a bounded, test-design-oriented surface without replacing the
source IR.

#### Properties

##### assumptions

> **assumptions**: [`TestDesignAssumption`](#testdesignassumption)[]

##### businessRules

> **businessRules**: [`TestDesignRule`](#testdesignrule)[]

##### jobId

> **jobId**: `string`

##### openQuestions

> **openQuestions**: [`TestDesignOpenQuestion`](#testdesignopenquestion)[]

##### riskSignals

> **riskSignals**: [`TestDesignRiskSignal`](#testdesignrisksignal)[]

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### screens

> **screens**: [`TestDesignScreen`](#testdesignscreen)[]

##### sourceHash

> **sourceHash**: `string`

***

### TestDesignOpenQuestion

#### Properties

##### openQuestionId

> **openQuestionId**: `string`

##### text

> **text**: `string`

***

### TestDesignRiskSignal

#### Properties

##### riskSignalId

> **riskSignalId**: `string`

##### screenId?

> `optional` **screenId?**: `string`

##### sourceRefs

> **sourceRefs**: `string`[]

##### text

> **text**: `string`

***

### TestDesignRule

#### Properties

##### description

> **description**: `string`

##### ruleId

> **ruleId**: `string`

##### screenId?

> `optional` **screenId?**: `string`

##### sourceRefs

> **sourceRefs**: `string`[]

***

### TestDesignScreen

#### Properties

##### actions

> **actions**: [`TestDesignAction`](#testdesignaction)[]

##### calculations

> **calculations**: [`TestDesignCalculation`](#testdesigncalculation)[]

##### elements

> **elements**: [`TestDesignElement`](#testdesignelement)[]

##### name

> **name**: `string`

##### purpose?

> `optional` **purpose?**: `string`

##### screenId

> **screenId**: `string`

##### sourceRefs

> **sourceRefs**: `string`[]

##### validations

> **validations**: [`TestDesignValidation`](#testdesignvalidation)[]

##### visualRefs

> **visualRefs**: `string`[]

***

### TestDesignValidation

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: `string`

##### rule

> **rule**: `string`

##### targetElementId?

> `optional` **targetElementId?**: `string`

##### validationId

> **validationId**: `string`

***

### TestIntelligenceReviewPrincipal

Bearer credential bound to a single review principal.

Used by the test-intelligence review gate when four-eyes review is
enforced (#1376). The token authenticates the caller; the
`principalId` is the server-owned reviewer identity persisted on
review events and snapshots. Never reuse one token for multiple
principals.

#### Properties

##### bearerToken

> **bearerToken**: `string`

Bearer token accepted for this principal's review-gate write requests.

##### principalId

> **principalId**: `string`

Opaque, non-secret reviewer principal id persisted in review audit logs.

***

### TestIntelligenceTransferPrincipal

Principal-bound credentials used by the controlled OpenText ALM API
transfer pipeline (#1372). The token authenticates the caller; the
`principalId` is the server-owned operator identity persisted in
`transfer-report.json` so audit lineage survives token rotation.
Never reuse one token for multiple principals.

#### Properties

##### bearerToken

> **bearerToken**: `string`

Bearer token accepted for this principal's API transfer requests.

##### principalId

> **principalId**: `string`

Opaque, non-secret operator principal id persisted in transfer audit logs.

***

### TestIntentSourceRef

Reference to a single contributing source inside a
[MultiSourceTestIntentEnvelope](#multisourcetestintentenvelope). References are stable per envelope
and never carry raw source bytes — only redacted hashes and structured
provenance hints.

#### Properties

##### authorHandle?

> `optional` **authorHandle?**: `string`

Opaque, non-PII operator handle for paste/custom sources. Never store
raw email addresses or full names — callers MUST redact before set.

##### canonicalIssueKey?

> `optional` **canonicalIssueKey?**: `string`

Canonical Jira issue key for `jira_rest` / `jira_paste` sources, e.g.
`"PAY-1234"`. When both REST and paste sources carry the same key, the
validator reports `duplicate_jira_paste_collision` so downstream Wave 4.D
routing can resolve the paste collision explicitly.

##### capturedAt

> **capturedAt**: `string`

ISO-8601 UTC capture timestamp (millisecond precision, `Z` suffix).

##### contentHash

> **contentHash**: `string`

SHA-256 of the canonicalised source bytes (lowercase hex, 64 chars).

##### inputFormat?

> `optional` **inputFormat?**: `"plain_text"` \| `"markdown"` \| `"structured_json"`

Input format for `custom_text` / `custom_structured`. Required for
those kinds, MUST be omitted for primary kinds.

##### kind

> **kind**: `"figma_plugin"` \| `"figma_local_json"` \| `"figma_rest"` \| `"jira_rest"` \| `"jira_paste"` \| `"custom_text"` \| `"custom_structured"` \| `"custom_markdown"`

Discriminated source kind.

##### markdownSectionPath?

> `optional` **markdownSectionPath?**: `string`

Markdown section path (heading / table / list context) for Markdown
custom sources, e.g. `"# Risks > ## PII handling"`. Optional and
ignored for non-Markdown sources.

##### noteEntryId?

> `optional` **noteEntryId?**: `string`

Note-entry id for Markdown-authored custom sources (Markdown
addendum). Lets provenance references identify the source row in the
reviewer note store. Optional, ignored for non-Markdown sources.

##### plainTextDerivativeHash?

> `optional` **plainTextDerivativeHash?**: `string`

SHA-256 hash of the deterministic plain-text derivative produced from the
redacted Markdown. This lets prompt-isolation code audit what evidence was
made available without treating Markdown as instructions.

##### redactedMarkdownHash?

> `optional` **redactedMarkdownHash?**: `string`

SHA-256 hash of the canonical redacted Markdown for Markdown-authored
custom sources. Raw Markdown is never stored in the envelope.

##### sourceId

> **sourceId**: `string`

Stable identifier per envelope, e.g. `"src.0"`, `"src.1"`.

***

### TraceabilityMatrix

Aggregate traceability-matrix artifact (Issue #1373).

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### exportProfile?

> `optional` **exportProfile?**: `object`

Identity of the export profile in play, when one is supplied.

###### id

> **id**: `string`

###### version

> **version**: `string`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### policyProfile?

> `optional` **policyProfile?**: `object`

Identity of the policy profile in play, when one is supplied.

###### id

> **id**: `string`

###### version

> **version**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

##### rows

> **rows**: [`TraceabilityMatrixRow`](#traceabilitymatrixrow)[]

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

##### totals

> **totals**: `object`

###### failed

> **failed**: `number`

###### refused

> **refused**: `number`

###### rows

> **rows**: `number`

###### skippedDuplicate

> **skippedDuplicate**: `number`

###### transferred

> **transferred**: `number`

***

### TraceabilityMatrixRow

Single row inside the traceability matrix. Joins the lifecycle
of one generated test case across its Figma source, IR
elements, QC mapping, transfer outcome, visual sidecar
observations, and validation/policy outcomes.

#### Properties

##### externalIdCandidate?

> `optional` **externalIdCandidate?**: `string`

Deterministic external-id candidate for the QC mapping.

##### figmaNodeIds

> **figmaNodeIds**: `string`[]

Sorted Figma node ids that motivated the case. Empty when no
trace ref carries a node id.

##### figmaScreenIds

> **figmaScreenIds**: `string`[]

Sorted Figma screen ids that motivated the case.

##### intentActionIds

> **intentActionIds**: `string`[]

Sorted IR action ids covered by this case.

##### intentFieldIds

> **intentFieldIds**: `string`[]

Sorted IR field ids covered by this case.

##### intentNavigationIds

> **intentNavigationIds**: `string`[]

Sorted IR navigation ids covered by this case.

##### intentValidationIds

> **intentValidationIds**: `string`[]

Sorted IR validation ids covered by this case.

##### policyDecision?

> `optional` **policyDecision?**: `"approved"` \| `"blocked"` \| `"needs_review"`

Per-case policy decision (mirrors `TestCasePolicyDecisionRecord.decision`).

##### policyOutcomes

> **policyOutcomes**: (`"schema_invalid"` \| `"missing_trace"` \| `"missing_expected_results"` \| `"semantic_suspicious_content"` \| `"pii_in_test_data"` \| `"missing_negative_or_validation_for_required_field"` \| `"missing_accessibility_case"` \| `"missing_boundary_case"` \| `"duplicate_test_case"` \| `"regulated_risk_review_required"` \| `"ambiguity_review_required"` \| `"qc_mapping_not_exportable"` \| `"low_confidence_review_required"` \| `"open_questions_review_required"` \| `"visual_sidecar_failure"` \| `"visual_sidecar_fallback_used"` \| `"visual_sidecar_low_confidence"` \| `"visual_sidecar_possible_pii"` \| `"visual_sidecar_prompt_injection_text"` \| `"risk_tag_downgrade_detected"` \| `"custom_context_risk_escalation"` \| `"multi_source_conflict_present"`)[]

Per-case sorted, deduplicated policy outcome codes that fired.

##### qcEntityId?

> `optional` **qcEntityId?**: `string`

Resolved QC entity id when the case was transferred.

##### qcFolderPath?

> `optional` **qcFolderPath?**: `string`

Resolved target QC folder path under the export profile.

##### reconciliationDecisions

> **reconciliationDecisions**: [`TraceabilityReconciliationDecision`](#traceabilityreconciliationdecision)[]

Reconciliation decisions: one row per IR element with explicit provenance.

##### reviewState?

> `optional` **reviewState?**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"pending_secondary_approval"` \| `"edited"` \| `"exported"` \| `"transferred"`

Review-state snapshot at the moment the matrix was built.

##### steps

> **steps**: [`TraceabilityStepRow`](#traceabilitysteprow)[]

Per-step traceability rows derived from generated and QC design steps.

##### testCaseId

> **testCaseId**: `string`

##### title

> **title**: `string`

Title at the moment the matrix was built.

##### transferOutcome?

> `optional` **transferOutcome?**: `"failed"` \| `"created"` \| `"skipped_duplicate"` \| `"refused"`

Outcome of the transfer pipeline for this case, when known.

##### validationOutcome

> **validationOutcome**: `"error"` \| `"warning"` \| `"ok"`

Per-case validation outcome — `error` if any error issue was raised.

##### visualObservations

> **visualObservations**: [`TraceabilityVisualObservation`](#traceabilityvisualobservation)[]

Per-screen visual sidecar observations relevant to this case.

***

### TraceabilityReconciliationDecision

Single reconciliation decision row inside the matrix.

#### Properties

##### ambiguity?

> `optional` **ambiguity?**: `string`

Sanitized ambiguity reason, when present.

##### confidence

> **confidence**: `number`

##### elementId

> **elementId**: `string`

##### provenance

> **provenance**: [`IntentProvenance`](#intentprovenance)

IR provenance after reconciliation.

##### screenId

> **screenId**: `string`

***

### TraceabilityStepRow

Single ordered step row inside a traceability matrix row.

#### Properties

##### action

> **action**: `string`

##### expected?

> `optional` **expected?**: `string`

##### figmaNodeIds

> **figmaNodeIds**: `string`[]

Sorted Figma node ids inherited from the test-case trace refs.

##### figmaScreenIds

> **figmaScreenIds**: `string`[]

Sorted Figma screen ids inherited from the test-case trace refs.

##### policyDecision?

> `optional` **policyDecision?**: `"approved"` \| `"blocked"` \| `"needs_review"`

Per-case policy decision at the time this step row was built.

##### policyOutcomes

> **policyOutcomes**: (`"schema_invalid"` \| `"missing_trace"` \| `"missing_expected_results"` \| `"semantic_suspicious_content"` \| `"pii_in_test_data"` \| `"missing_negative_or_validation_for_required_field"` \| `"missing_accessibility_case"` \| `"missing_boundary_case"` \| `"duplicate_test_case"` \| `"regulated_risk_review_required"` \| `"ambiguity_review_required"` \| `"qc_mapping_not_exportable"` \| `"low_confidence_review_required"` \| `"open_questions_review_required"` \| `"visual_sidecar_failure"` \| `"visual_sidecar_fallback_used"` \| `"visual_sidecar_low_confidence"` \| `"visual_sidecar_possible_pii"` \| `"visual_sidecar_prompt_injection_text"` \| `"risk_tag_downgrade_detected"` \| `"custom_context_risk_escalation"` \| `"multi_source_conflict_present"`)[]

Per-case sorted, deduplicated policy outcomes at the time this step row was built.

##### qcDesignStepIndex?

> `optional` **qcDesignStepIndex?**: `number`

Matching QC design-step index when the mapping preview carries one.

##### stepIndex

> **stepIndex**: `number`

##### validationOutcome

> **validationOutcome**: `"error"` \| `"warning"` \| `"ok"`

Per-case validation outcome at the time this step row was built.

##### visualObservations

> **visualObservations**: [`TraceabilityVisualObservation`](#traceabilityvisualobservation)[]

Per-screen visual sidecar observations available for the step's case.

***

### TraceabilityVisualObservation

Single per-screen visual observation row inside the matrix.

#### Properties

##### deployment

> **deployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

##### meanConfidence

> **meanConfidence**: `number`

##### outcomes

> **outcomes**: (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

Sorted, deduplicated outcome codes that fired on the screen.

##### screenId

> **screenId**: `string`

***

### TransferAuditMetadata

Audit metadata describing the operator/principal that authorised the run.

#### Properties

##### actor

> **actor**: `string`

Opaque actor handle; never an email or token.

##### authPrincipalId

> **authPrincipalId**: `string`

Stable id for the operator-supplied bearer-token principal.

##### bearerTokenAccepted

> **bearerTokenAccepted**: `boolean`

Whether the operator-supplied bearer token matched a configured
principal. `true` is required for the transfer to proceed.

##### dryRunReportId

> **dryRunReportId**: `string`

Identity of the dry-run report consumed; binds the run to a validation.

##### evidenceReferences

> **evidenceReferences**: [`TransferEvidenceReferences`](#transferevidencereferences)

Hash-only upstream artifact references; never raw prompts, screenshots, or credentials.

##### fourEyesReasons

> **fourEyesReasons**: (`"multi_source_conflict_present"` \| `"risk_category"` \| `"visual_low_confidence"` \| `"visual_fallback_used"` \| `"visual_possible_pii"` \| `"visual_prompt_injection"` \| `"visual_metadata_conflict"`)[]

Reasons four-eyes review applied to one or more cases (sorted, deduped).

***

### TransferEntityRecord

Per-entity record inside the transfer report.

#### Properties

##### designStepsCreated

> **designStepsCreated**: `number`

Number of design steps the adapter created for this entity.

##### externalIdCandidate

> **externalIdCandidate**: `string`

##### failureClass?

> `optional` **failureClass?**: `"rate_limited"` \| `"transport_error"` \| `"auth_failed"` \| `"permission_denied"` \| `"validation_rejected"` \| `"conflict_unresolved"` \| `"server_error"` \| `"unknown"`

Failure class when `outcome === "failed"`; absent otherwise.

##### failureDetail?

> `optional` **failureDetail?**: `string`

Sanitised, length-bounded failure detail; never carries URLs/tokens.

##### outcome

> **outcome**: `"failed"` \| `"created"` \| `"skipped_duplicate"` \| `"refused"`

##### qcEntityId

> **qcEntityId**: `string`

Resolved QC entity id when the outcome is `created`, `skipped_duplicate`,
or a failed attempt left a partial tenant entity. Empty for `refused`.

##### recordedAt

> **recordedAt**: `string`

Wall-clock timestamp at which the adapter recorded the outcome.

##### targetFolderPath

> **targetFolderPath**: `string`

##### testCaseId

> **testCaseId**: `string`

***

### TransferEvidenceReferences

Hash-only evidence references that bind transfer to upstream artifacts.

#### Properties

##### dryRunReportHash

> **dryRunReportHash**: `string`

SHA-256 hex of the dry-run report consumed by transfer.

##### generationOutputHash?

> `optional` **generationOutputHash?**: `string`

Optional SHA-256 hex of the generated test-case artifact.

##### qcMappingPreviewHash

> **qcMappingPreviewHash**: `string`

SHA-256 hex of the QC mapping preview consumed by transfer.

##### reconciledIntentIrHash?

> `optional` **reconciledIntentIrHash?**: `string`

Optional SHA-256 hex of the reconciled intent IR artifact.

##### visualSidecarEvidenceHashes

> **visualSidecarEvidenceHashes**: `string`[]

Sorted hash-only references to sidecar evidence used by mapped cases.

##### visualSidecarReportHash

> **visualSidecarReportHash**: `string`

SHA-256 hex of the visual-sidecar validation report, when present.

***

### TransferReportArtifact

Aggregate `transfer-report.json` artifact (Issue #1372).

#### Properties

##### adapter

> **adapter**: `object`

###### provider

> **provider**: `"opentext_alm"` \| `"opentext_octane"` \| `"opentext_valueedge"` \| `"xray"` \| `"testrail"` \| `"azure_devops_test_plans"` \| `"qtest"` \| `"custom"`

###### version

> **version**: `string`

##### audit

> **audit**: [`TransferAuditMetadata`](#transferauditmetadata)

Audit metadata for the run.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### createdCount

> **createdCount**: `number`

Number of records whose outcome is `created`.

##### credentialsIncluded

> **credentialsIncluded**: `false`

Hard invariant: credentials are never embedded into transfer payloads.

##### failedCount

> **failedCount**: `number`

Number of records whose outcome is `failed`.

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### mode

> **mode**: `"dry_run"` \| `"export_only"` \| `"api_transfer"`

##### profile

> **profile**: `object`

###### id

> **id**: `string`

###### version

> **version**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: raw screenshots are never embedded into transfer payloads.

##### records

> **records**: [`TransferEntityRecord`](#transferentityrecord)[]

Sorted by `testCaseId`. Empty when refused before any attempt.

##### refusalCodes

> **refusalCodes**: (`"feature_disabled"` \| `"no_approved_test_cases"` \| `"unapproved_test_cases_present"` \| `"policy_blocked_cases_present"` \| `"schema_invalid_cases_present"` \| `"visual_sidecar_blocked"` \| `"review_state_inconsistent"` \| `"provider_mismatch"` \| `"no_mapped_test_cases"` \| `"mapping_profile_invalid"` \| `"mode_not_implemented"` \| `"folder_resolution_failed"` \| `"admin_gate_disabled"` \| `"bearer_token_missing"` \| `"visual_sidecar_evidence_missing"` \| `"four_eyes_pending"` \| `"dry_run_refused"` \| `"dry_run_missing"`)[]

##### refused

> **refused**: `boolean`

True iff the pipeline refused to perform any write.

##### refusedCount

> **refusedCount**: `number`

Number of records whose outcome is `refused`.

##### reportId

> **reportId**: `string`

Deterministic id derived from job + adapter + profile + clock.

##### schemaVersion

> **schemaVersion**: `"1.1.0"`

##### skippedDuplicateCount

> **skippedDuplicateCount**: `number`

Number of records whose outcome is `skipped_duplicate`.

##### transferUrlIncluded

> **transferUrlIncluded**: `false`

Hard invariant: never carries the resolved transfer URL.

***

### VisualScreenDescription

Visual-sidecar description produced by a multimodal vision model (Issue #1386).

#### Properties

##### capturedAt?

> `optional` **capturedAt?**: `string`

##### confidenceSummary

> **confidenceSummary**: `object`

###### max

> **max**: `number`

###### mean

> **mean**: `number`

###### min

> **min**: `number`

##### piiFlags?

> `optional` **piiFlags?**: `object`[]

###### confidence

> **confidence**: `number`

###### kind

> **kind**: [`PiiKind`](#piikind)

###### regionId

> **regionId**: `string`

##### regions

> **regions**: `object`[]

###### ambiguity?

> `optional` **ambiguity?**: [`IntentAmbiguity`](#intentambiguity)

###### confidence

> **confidence**: `number`

###### controlType?

> `optional` **controlType?**: `string`

###### label?

> `optional` **label?**: `string`

###### regionId

> **regionId**: `string`

###### stateHints?

> `optional` **stateHints?**: `string`[]

###### validationHints?

> `optional` **validationHints?**: `string`[]

###### visibleText?

> `optional` **visibleText?**: `string`

##### screenId

> **screenId**: `string`

##### screenName?

> `optional` **screenName?**: `string`

##### sidecarDeployment

> **sidecarDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

***

### VisualSidecarAttempt

Single attempt against a sidecar deployment. Composes with the gateway
surface so the policy gate can correlate attempts with the gateway's
own circuit-breaker telemetry without a translation layer.

#### Properties

##### attempt

> **attempt**: `number`

Sequence index, 1-based across both primary and fallback attempts.

##### deployment

> **deployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

Sidecar deployment that was attempted.

##### durationMs

> **durationMs**: `number`

Wall-clock duration of the attempt in milliseconds.

##### errorClass?

> `optional` **errorClass?**: `"schema_invalid"` \| `"schema_invalid_response"` \| `"refusal"` \| `"incomplete"` \| `"timeout"` \| `"rate_limited"` \| `"transport"` \| `"image_payload_rejected"` \| `"input_budget_exceeded"` \| `"response_too_large"` \| `"protocol"` \| `"canceled"`

Error class when the attempt failed. Absent on a success.

***

### VisualSidecarCaptureIdentity

Identity record for a single capture, persisted alongside the sidecar
result. Carries no image bytes — only a SHA-256 of the decoded bytes
plus the byte length. Re-validating a result against the original
captures requires re-hashing, never re-loading raw screenshot bytes.

#### Properties

##### byteLength

> **byteLength**: `number`

##### mimeType

> **mimeType**: `"image/png"` \| `"image/jpeg"` \| `"image/webp"` \| `"image/gif"`

##### screenId

> **screenId**: `string`

##### sha256

> **sha256**: `string`

SHA-256 hex of the decoded image bytes (NOT of the base64 string).

***

### VisualSidecarCaptureInput

In-memory capture handed to the visual sidecar client. The bytes never
touch disk: only the SHA-256 hash is persisted into the result artifact.

#### Properties

##### base64Data

> **base64Data**: `string`

Base64-encoded image bytes. Decoded length must be <= the byte bound.

##### capturedAt?

> `optional` **capturedAt?**: `string`

Optional ISO-8601 capture timestamp (sourced from a screenshot pipeline).

##### mimeType

> **mimeType**: `"image/png"` \| `"image/jpeg"` \| `"image/webp"` \| `"image/gif"`

MIME type of the encoded bytes. Must be in the allowlist.

##### screenId

> **screenId**: `string`

Stable identifier matching a `BusinessTestIntentScreen.screenId`.

##### screenName?

> `optional` **screenName?**: `string`

Optional human-readable label.

***

### VisualSidecarFailure

Failure outcome — both primary and fallback exhausted, or pre-flight
rejected the captures. The `failureClass` is policy-readable so
upstream gates can decide between "retry later" and "refuse the job".

#### Properties

##### attempts

> **attempts**: [`VisualSidecarAttempt`](#visualsidecarattempt)[]

##### captureIdentities

> **captureIdentities**: [`VisualSidecarCaptureIdentity`](#visualsidecarcaptureidentity)[]

##### failureClass

> **failureClass**: `"schema_invalid_response"` \| `"primary_unavailable"` \| `"primary_quota_exceeded"` \| `"both_sidecars_failed"` \| `"image_payload_too_large"` \| `"image_mime_unsupported"` \| `"duplicate_screen_id"` \| `"empty_screen_capture_set"`

##### failureMessage

> **failureMessage**: `string`

Sanitized human-readable message — never carries tokens or PII.

##### outcome

> **outcome**: `"failure"`

***

### VisualSidecarResultArtifact

Persisted form of the visual sidecar result. Carries schema/contract
stamps and the hard `rawScreenshotsIncluded: false` literal so that any
downstream consumer can verify the artifact never re-introduced raw
screenshot bytes.

#### Properties

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant — image bytes are never embedded in this artifact.

##### result

> **result**: [`VisualSidecarResult`](#visualsidecarresult)

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### VisualSidecarSuccess

Successful sidecar outcome — primary or fallback. The downstream
`VisualScreenDescription[]` is structurally validated by the existing
`validateVisualSidecar` gate; this type carries the validation report
verbatim so the caller can persist or refuse on it.

#### Properties

##### attempts

> **attempts**: [`VisualSidecarAttempt`](#visualsidecarattempt)[]

##### captureIdentities

> **captureIdentities**: [`VisualSidecarCaptureIdentity`](#visualsidecarcaptureidentity)[]

##### confidenceSummary

> **confidenceSummary**: `object`

Aggregated confidence summary across every screen description.

###### max

> **max**: `number`

###### mean

> **mean**: `number`

###### min

> **min**: `number`

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

##### outcome

> **outcome**: `"success"`

##### selectedDeployment

> **selectedDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

Deployment that produced the descriptions.

##### validationReport

> **validationReport**: [`VisualSidecarValidationReport`](#visualsidecarvalidationreport)

Verbatim validation report produced by `validateVisualSidecar`. The
client does NOT silently strip findings — when the report says
`blocked: true`, the success surfaces the report so the caller can
persist it for the policy gate to inspect.

##### visual

> **visual**: [`VisualScreenDescription`](#visualscreendescription)[]

***

### VisualSidecarValidationRecord

Single per-screen visual-sidecar validation row.

#### Properties

##### deployment

> **deployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

##### issues

> **issues**: [`TestCaseValidationIssue`](#testcasevalidationissue)[]

Issues found while structurally validating the description.

##### meanConfidence

> **meanConfidence**: `number`

Mean confidence reported by the sidecar (0..1).

##### outcomes

> **outcomes**: (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

##### screenId

> **screenId**: `string`

***

### VisualSidecarValidationReport

Aggregate visual-sidecar validation report across a job.

#### Properties

##### blocked

> **blocked**: `boolean`

Whether any record carries a non-`ok`/non-`fallback_used` outcome that blocks generation.

##### contractVersion

> **contractVersion**: `"1.6.0"`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### records

> **records**: [`VisualSidecarValidationRecord`](#visualsidecarvalidationrecord)[]

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### screensWithFindings

> **screensWithFindings**: `number`

##### totalScreens

> **totalScreens**: `number`

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### Wave1PocAttestationBundle

Sigstore-shaped bundle persisted alongside a signed attestation.

#### Properties

##### dsseEnvelope

> **dsseEnvelope**: [`Wave1PocAttestationDsseEnvelope`](#wave1pocattestationdsseenvelope)

The DSSE envelope this bundle witnesses. Identical bytes to the
`evidence/attestations/...` artifact; duplication is intentional so
the bundle is self-contained.

##### mediaType

> **mediaType**: `"application/vnd.dev.sigstore.bundle.v0.3+json"`

##### verificationMaterial

> **verificationMaterial**: [`Wave1PocAttestationVerificationMaterial`](#wave1pocattestationverificationmaterial)

Verification material — public key OR x509 certificate chain.

***

### Wave1PocAttestationCertificateChainMaterial

X.509 certificate-chain verification material. Used by the Sigstore
keyless signing flow: the leaf certificate carries the OIDC-bound
subject identity and is signed by Fulcio. Verifiers reconstruct the
public key from the leaf certificate, then validate it through the
chain to a trust root the operator pins.

The repo does not vendor Fulcio root certificates — operators wire
the trust root themselves. The cert-chain shape is provided here as
a load-bearing type so the Sigstore bundle media type can carry
keyless signatures end-to-end without breaking changes.

#### Properties

##### algorithm

> **algorithm**: `"ecdsa-p256-sha256"`

Signing algorithm used to produce the DSSE signatures.

##### certificateChainPem

> **certificateChainPem**: `string`

PEM-encoded certificate chain, leaf first. The leaf certificate's
subject public key is used to verify the DSSE signature. Operators
wiring full Sigstore keyless flow include the Fulcio-issued leaf
(with the OIDC subject as a SAN extension) and any intermediate(s)
up to a trust root.

##### hint

> **hint**: `string`

Stable, non-secret signer reference (matches `Wave1PocAttestationSignature.keyid`).

##### rekorLogIndex?

> `optional` **rekorLogIndex?**: `number`

Optional Rekor transparency-log inclusion proof reference. When
present, a verifier MAY consult its trusted Rekor instance to
confirm the entry is logged. The repo never fetches Rekor by
default; the field is opaque metadata.

***

### Wave1PocAttestationDsseEnvelope

DSSE envelope (canonical form). When `signatures` is empty the
envelope represents an unsigned attestation. When populated, each
signature is an ECDSA P-256 signature over the PAE-encoded
(payloadType, payload) tuple, base64-encoded into `sig`.

#### Properties

##### payload

> **payload**: `string`

Base64 (RFC 4648 §4) encoded `Wave1PocAttestationStatement` JSON.

##### payloadType

> **payloadType**: `"application/vnd.in-toto+json"`

##### signatures

> **signatures**: [`Wave1PocAttestationSignature`](#wave1pocattestationsignature)[]

***

### Wave1PocAttestationPredicate

Predicate body of the Wave 1 POC attestation. The predicate carries
pipeline-identity facts (model deployments, prompt template, schema,
policy, export profile) plus the manifest's own SHA-256 so the
statement attests both the artifact subjects and the metadata
envelope used to produce them. No secrets, prompts, or response
bodies are embedded — only identity hashes and version stamps.

#### Properties

##### cacheKeyDigest

> **cacheKeyDigest**: `string`

##### contractVersion

> **contractVersion**: `string`

##### exportProfileId

> **exportProfileId**: `string`

Export profile identity (export-only QC pipeline).

##### exportProfileVersion

> **exportProfileVersion**: `string`

##### fixtureId

> **fixtureId**: `"poc-onboarding"` \| `"poc-payment-auth"`

##### generatedAt

> **generatedAt**: `string`

##### generatedTestCaseSchemaVersion

> **generatedTestCaseSchemaVersion**: `"1.1.0"`

##### imagePayloadSentToTestGeneration

> **imagePayloadSentToTestGeneration**: `false`

Hard invariant — test_generation never received an image payload.

##### inputHash

> **inputHash**: `string`

##### jobId

> **jobId**: `string`

##### manifestFilename

> **manifestFilename**: `"wave1-poc-evidence-manifest.json"`

Filename of the manifest artifact (relative to the run dir).

##### manifestSha256

> **manifestSha256**: `string`

SHA-256 of the canonical evidence manifest the attestation covers.

##### modelDeployments

> **modelDeployments**: `object`

Identity of every model role active during the run.

###### testGeneration

> **testGeneration**: `string`

###### visualFallback?

> `optional` **visualFallback?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

###### visualPrimary?

> `optional` **visualPrimary?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

##### policyProfileId

> **policyProfileId**: `string`

Policy bundle identity (validation gate).

##### policyProfileVersion

> **policyProfileVersion**: `string`

##### promptHash

> **promptHash**: `string`

Replay-cache identity hashes.

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

Versions stamped by the harness at run time.

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant — no raw screenshot bytes attested.

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### secretsIncluded

> **secretsIncluded**: `false`

Hard invariant — no API keys / bearer tokens attested.

##### signingMode

> **signingMode**: `"unsigned"` \| `"sigstore"`

Active signing mode; mirrored from the run input for auditability.

##### testIntelligenceContractVersion

> **testIntelligenceContractVersion**: `"1.6.0"`

##### visualSidecar?

> `optional` **visualSidecar?**: [`Wave1PocAttestationVisualSidecarIdentity`](#wave1pocattestationvisualsidecaridentity)

Visual-sidecar chain-of-custody identity (when present).

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### Wave1PocAttestationPublicKeyMaterial

Public-key verification material. Used by the key-bound Sigstore
signing flow (and by air-gapped verifiers that pin a single signer
key). The PEM-encoded public key MUST be a SubjectPublicKeyInfo over
the prime256v1 (P-256) curve.

#### Properties

##### algorithm

> **algorithm**: `"ecdsa-p256-sha256"`

Signing algorithm used to produce the DSSE signatures.

##### hint

> **hint**: `string`

Stable, non-secret signer reference (matches `Wave1PocAttestationSignature.keyid`).

##### publicKeyPem

> **publicKeyPem**: `string`

PEM-encoded SubjectPublicKeyInfo for the matching public key.

***

### Wave1PocAttestationSignature

A single signature attached to a DSSE envelope.

#### Properties

##### keyid

> **keyid**: `string`

Stable, non-secret identifier for the signing key.

##### sig

> **sig**: `string`

Base64 (RFC 4648 §4) encoded signature bytes.

***

### Wave1PocAttestationStatement

in-toto v1 statement envelope (the DSSE payload after base64 decode).

#### Properties

##### \_type

> **\_type**: `"https://in-toto.io/Statement/v1"`

##### predicate

> **predicate**: [`Wave1PocAttestationPredicate`](#wave1pocattestationpredicate)

##### predicateType

> **predicateType**: `"https://workspace-dev.figmapipe.dev/test-intelligence/wave1-poc-evidence/v1"`

##### subject

> **subject**: [`Wave1PocAttestationSubject`](#wave1pocattestationsubject)[]

Sorted-by-name, de-duplicated subject list.

***

### Wave1PocAttestationSubject

Subject record inside the in-toto v1 statement.

#### Properties

##### digest

> **digest**: `object`

Subject digest map. Always populated with at least `sha256`.

###### sha256

> **sha256**: `string`

##### name

> **name**: `string`

Relative artifact path inside the run directory (no leading slash).

***

### Wave1PocAttestationSummary

Audit-timeline summary surfaced on the harness result. Carries only
non-secret identifiers and digests so callers can render signing
provenance without re-reading on-disk artifacts.

#### Properties

##### attestationFilename

> **attestationFilename**: `string`

Relative path of the persisted in-toto envelope.

##### attestationSha256

> **attestationSha256**: `string`

SHA-256 of the canonical envelope bytes.

##### bundleFilename?

> `optional` **bundleFilename?**: `string`

Relative path of the Sigstore bundle. `undefined` when unsigned.

##### bundleSha256?

> `optional` **bundleSha256?**: `string`

SHA-256 of the canonical bundle bytes. `undefined` when unsigned.

##### signerReference?

> `optional` **signerReference?**: `string`

Stable signer identifier (matches `keyid`). `undefined` when unsigned.

##### signingMode

> **signingMode**: `"unsigned"` \| `"sigstore"`

***

### Wave1PocAttestationVerificationFailure

Failure record produced by `verifyWave1PocAttestation`. Each failure
names the specific subject / signature / metadata field that failed
so an auditor can pinpoint the mismatch without re-running the
harness.

#### Properties

##### code

> **code**: `"envelope_unparseable"` \| `"envelope_payload_type_mismatch"` \| `"envelope_payload_decode_failed"` \| `"statement_unparseable"` \| `"statement_type_mismatch"` \| `"statement_predicate_type_mismatch"` \| `"statement_predicate_invalid"` \| `"subject_missing_artifact"` \| `"subject_digest_mismatch"` \| `"subject_unattested_artifact"` \| `"signing_mode_mismatch"` \| `"signature_required"` \| `"signature_unsigned_envelope_carries_signatures"` \| `"signature_invalid_keyid"` \| `"signature_invalid_encoding"` \| `"signature_unverified"` \| `"bundle_missing"` \| `"bundle_envelope_mismatch"` \| `"bundle_public_key_missing"` \| `"manifest_sha256_mismatch"`

Stable failure code.

##### message

> **message**: `string`

Human-readable diagnostic. Never includes secrets.

##### reference

> **reference**: `string`

Subject / artifact / field that triggered the failure.

***

### Wave1PocAttestationVerificationResult

Result of `verifyWave1PocAttestation`.

#### Properties

##### failures

> **failures**: [`Wave1PocAttestationVerificationFailure`](#wave1pocattestationverificationfailure)[]

Structured failure list — empty when `ok === true`.

##### ok

> **ok**: `boolean`

##### signatureCount

> **signatureCount**: `number`

Number of signatures present (0 for unsigned).

##### signaturesVerified

> **signaturesVerified**: `boolean`

True iff every present signature verified against `publicKey`.

##### signingMode

> **signingMode**: `"unsigned"` \| `"sigstore"`

***

### Wave1PocAttestationVisualSidecarIdentity

Visual-sidecar identity carried into the attestation predicate so an
auditor can verify the multimodal chain of custody (Issue #1386
addendum to #1377). Mirrors the fields already attested on the
evidence manifest but pinned to the predicate version.

#### Properties

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

##### resultArtifactSha256

> **resultArtifactSha256**: `string`

##### selectedDeployment

> **selectedDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

##### visualFallback?

> `optional` **visualFallback?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

##### visualPrimary?

> `optional` **visualPrimary?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

***

### Wave1PocEvalFailure

Failure record describing a single threshold breach.

#### Properties

##### actual

> **actual**: `number`

Numeric or boolean observed value (encoded as number for comparators).

##### message

> **message**: `string`

##### rule

> **rule**: `"visual_sidecar_blocked"` \| `"min_trace_coverage_fields"` \| `"min_trace_coverage_actions"` \| `"min_trace_coverage_validations"` \| `"min_qc_mapping_exportable_fraction"` \| `"max_duplicate_similarity"` \| `"min_expected_results_per_case"` \| `"min_approved_cases"` \| `"policy_blocked"` \| `"validation_blocked"` \| `"export_refused"` \| `"min_job_rubric_score"` \| `"rubric_pass_refused"`

##### threshold

> **threshold**: `number`

Numeric or boolean threshold that was breached.

***

### Wave1PocEvalFixtureMetrics

Per-fixture metrics computed by the Wave 1 POC evaluation gate.

#### Properties

##### approvedCases

> **approvedCases**: `number`

##### blockedCases

> **blockedCases**: `number`

##### coveredActions

> **coveredActions**: `number`

##### coveredFields

> **coveredFields**: `number`

##### coveredValidations

> **coveredValidations**: `number`

##### detectedActions

> **detectedActions**: `number`

##### detectedFields

> **detectedFields**: `number`

##### detectedValidations

> **detectedValidations**: `number`

##### exportableApprovedCases

> **exportableApprovedCases**: `number`

##### exportRefused

> **exportRefused**: `boolean`

##### fixtureId

> **fixtureId**: `"poc-onboarding"` \| `"poc-payment-auth"`

##### jobRubricScore?

> `optional` **jobRubricScore?**: `number`

Optional job-level self-verify rubric score (Issue #1379). Only
present when the rubric pass ran for the fixture. Mirrors the value
stored on `coverage-report.json#rubricScore` (rounded to 6 digits).

##### maxObservedDuplicateSimilarity

> **maxObservedDuplicateSimilarity**: `number`

##### minObservedExpectedResultsPerCase

> **minObservedExpectedResultsPerCase**: `number`

##### needsReviewCases

> **needsReviewCases**: `number`

##### policyBlocked

> **policyBlocked**: `boolean`

##### rubricRefused?

> `optional` **rubricRefused?**: `boolean`

Whether the rubric pass attached a `refusal` to its report
(Issue #1379). `true` when the LLM gateway refused, the response
failed schema validation, or the per-case score set was incomplete.

##### totalGeneratedCases

> **totalGeneratedCases**: `number`

##### validationBlocked

> **validationBlocked**: `boolean`

##### visualSidecarBlocked

> **visualSidecarBlocked**: `boolean`

***

### Wave1PocEvalFixtureReport

Per-fixture evaluation outcome.

#### Properties

##### failures

> **failures**: [`Wave1PocEvalFailure`](#wave1pocevalfailure)[]

##### fixtureId

> **fixtureId**: `"poc-onboarding"` \| `"poc-payment-auth"`

##### metrics

> **metrics**: [`Wave1PocEvalFixtureMetrics`](#wave1pocevalfixturemetrics)

##### pass

> **pass**: `boolean`

***

### Wave1PocEvalReport

Aggregate evaluation report covering one or more fixtures. This artifact
is byte-stable: fixtures and failures are sorted, hashes are not embedded,
and timestamps are caller-provided.

#### Properties

##### contractVersion

> **contractVersion**: `string`

##### fixtures

> **fixtures**: [`Wave1PocEvalFixtureReport`](#wave1pocevalfixturereport)[]

##### generatedAt

> **generatedAt**: `string`

##### pass

> **pass**: `boolean`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### testIntelligenceContractVersion

> **testIntelligenceContractVersion**: `"1.6.0"`

##### thresholds

> **thresholds**: [`Wave1PocEvalThresholds`](#wave1pocevalthresholds)

***

### Wave1PocEvalThresholds

Numeric thresholds applied by the Wave 1 POC evaluation gate. Each
threshold is enforced on a per-fixture basis. Fractions are in `[0, 1]`.

#### Properties

##### maxDuplicateSimilarity

> **maxDuplicateSimilarity**: `number`

Maximum allowed pairwise duplicate similarity across all generated cases.
Computed by `detectDuplicateTestCases` on case fingerprints.

##### minApprovedCases

> **minApprovedCases**: `number`

Minimum number of approved cases required after the review gate.

##### minExpectedResultsPerCase

> **minExpectedResultsPerCase**: `number`

Minimum number of `expectedResults` entries required per approved case.

##### minJobRubricScore?

> `optional` **minJobRubricScore?**: `number`

Optional minimum job-level self-verify rubric score in `[0, 1]`
(Issue #1379). When set, the eval gate fails the run if the rubric
pass produced a `jobLevelRubricScore` strictly below this threshold.
When omitted, the rubric job-level score is informational only.

##### minQcMappingExportableFraction

> **minQcMappingExportableFraction**: `number`

Fraction of approved cases whose `qcMappingPreview.exportable` is true.

##### minTraceCoverageActions

> **minTraceCoverageActions**: `number`

Fraction of detected actions covered by at least one approved test case.

##### minTraceCoverageFields

> **minTraceCoverageFields**: `number`

Fraction of detected fields covered by at least one approved test case.

##### minTraceCoverageValidations

> **minTraceCoverageValidations**: `number`

Fraction of detected validations covered by at least one approved test case.

##### requirePolicyPass

> **requirePolicyPass**: `boolean`

Validation pipeline must not block.

##### requireRubricPass?

> `optional` **requireRubricPass?**: `boolean`

When `true`, the eval gate also fails when the self-verify rubric
pass attached a `refusal` to its report. Defaulted to `false` so
the eval gate stays byte-stable for fixtures that do not exercise
the opt-in pass.

##### requireVisualSidecarPass

> **requireVisualSidecarPass**: `boolean`

Visual sidecar gate must not block (when sidecar is present).

***

### Wave1PocEvidenceArtifact

Single artifact attested by the Wave 1 POC evidence manifest.

#### Properties

##### bytes

> **bytes**: `number`

Byte length on disk at manifest creation time.

##### category

> **category**: [`Wave1PocEvidenceArtifactCategory`](#wave1pocevidenceartifactcategory-1)

##### filename

> **filename**: `string`

Relative filename inside the run directory.

##### sha256

> **sha256**: `string`

SHA-256 of the on-disk byte stream.

***

### Wave1PocEvidenceManifest

Wave 1 POC evidence manifest. Frozen, deterministic, byte-identical
across runs of the same fixture and mock output. Lists every artifact
the harness emits with its SHA-256 hash and byte length, plus the
contract / template / schema / policy / model identities used during
the run. The manifest itself is also written to disk; verifying its
integrity is performed against the stored copy plus the artifact bytes.

Two negative invariants are stamped explicitly so they appear in the
evidence audit trail rather than being inferred from absence:

  - `rawScreenshotsIncluded: false` — no raw screenshot bytes are ever
    embedded in any exported artifact.
  - `imagePayloadSentToTestGeneration: false` — the structured-test-case
    generator deployment (e.g. `gpt-oss-120b`) never received an image
    payload during the run; image-bearing payloads only flow into the
    visual sidecar role.

#### Properties

##### artifacts

> **artifacts**: [`Wave1PocEvidenceArtifact`](#wave1pocevidenceartifact)[]

Sorted-by-filename, de-duplicated artifact list.

##### cacheKeyDigest

> **cacheKeyDigest**: `string`

##### contractVersion

> **contractVersion**: `string`

workspace-dev contract version that produced the artifacts.

##### exportProfileId

> **exportProfileId**: `string`

OpenText ALM (or override) export profile identity.

##### exportProfileVersion

> **exportProfileVersion**: `string`

##### fixtureId

> **fixtureId**: `"poc-onboarding"` \| `"poc-payment-auth"`

Identifier of the fixture exercised.

##### generatedAt

> **generatedAt**: `string`

##### generatedTestCaseSchemaVersion

> **generatedTestCaseSchemaVersion**: `"1.1.0"`

##### imagePayloadSentToTestGeneration

> **imagePayloadSentToTestGeneration**: `false`

Hard invariant: the structured-test-case generator deployment never
received an image payload during the run.

##### inputHash

> **inputHash**: `string`

##### jobId

> **jobId**: `string`

##### manifestIntegrity?

> `optional` **manifestIntegrity?**: [`Wave1PocEvidenceManifestIntegrity`](#wave1pocevidencemanifestintegrity)

Self-attestation over the canonical manifest metadata and artifact list.
New manifests stamp this field; it remains optional so legacy manifests can
still be parsed and verified with their existing digest witness.

##### modelDeployments

> **modelDeployments**: `object`

Identities of the deployments behind the run.

###### testGeneration

> **testGeneration**: `string`

###### visualFallback?

> `optional` **visualFallback?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

###### visualPrimary?

> `optional` **visualPrimary?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

##### multiSourceEnabled?

> `optional` **multiSourceEnabled?**: `boolean`

`true` when the Wave 4 multi-source pipeline produced this manifest.

##### policyProfileId

> **policyProfileId**: `string`

Policy profile identity used by the validation pipeline.

##### policyProfileVersion

> **policyProfileVersion**: `string`

##### promptHash

> **promptHash**: `string`

Replay-cache identity hashes for the run (mirrors compiled prompt).

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

Versions used to compile the prompt and validate the output.

##### rawJiraResponsePersisted?

> `optional` **rawJiraResponsePersisted?**: `false`

Hard invariant on multi-source manifests: raw Jira responses not persisted.

##### rawPasteBytesPersisted?

> `optional` **rawPasteBytesPersisted?**: `false`

Hard invariant on multi-source manifests: raw paste bytes not persisted.

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: no raw screenshot bytes leak into export artifacts.

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### sourceProvenanceRecords?

> `optional` **sourceProvenanceRecords?**: [`MultiSourceSourceProvenanceRecord`](#multisourcesourceprovenancerecord)[]

Per-source provenance records added when the multi-source pipeline ran.
Present only when `multiSourceEnabled` is `true`. Each entry records the
SHA-256 + bytes of the per-source IR artifact under
`<runDir>/sources/<sourceId>/`. Never includes raw Jira API responses,
raw paste bytes, or PII.

##### testIntelligenceContractVersion

> **testIntelligenceContractVersion**: `"1.6.0"`

Test-intelligence subsurface contract version.

##### visualSidecar?

> `optional` **visualSidecar?**: [`Wave1PocEvidenceVisualSidecarSummary`](#wave1pocevidencevisualsidecarsummary)

Direct visual-sidecar evidence summary when the opt-in sidecar path ran.

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### Wave1PocEvidenceManifestIntegrity

Self-attestation stamped into the Wave 1 evidence manifest.

#### Properties

##### algorithm

> **algorithm**: `"sha256"`

##### hash

> **hash**: `string`

SHA-256 of canonical manifest JSON with `manifestIntegrity` omitted.

***

### Wave1PocEvidenceManifestIntegrityVerification

Structured verification result for the manifest self-attestation.

#### Properties

##### actualHash

> **actualHash**: `string`

##### algorithm

> **algorithm**: `"sha256"`

##### expectedHash?

> `optional` **expectedHash?**: `string`

##### ok

> **ok**: `boolean`

***

### Wave1PocEvidenceVerificationResult

Result of `verifyWave1PocEvidenceManifest` against a directory of artifacts.
Determines whether ALL attested artifacts still hash to the values stored
in the manifest. Any mismatch fails the verification fail-closed.

#### Properties

##### manifestIntegrity?

> `optional` **manifestIntegrity?**: [`Wave1PocEvidenceManifestIntegrityVerification`](#wave1pocevidencemanifestintegrityverification)

Manifest self-attestation result when the manifest carries a
`manifestIntegrity` block, or when a current-version manifest is missing
the block and therefore fails closed.

##### missing

> **missing**: `string`[]

Filenames listed in the manifest that are missing on disk.

##### mutated

> **mutated**: `string`[]

Filenames whose on-disk SHA-256 differs from the manifest.

##### ok

> **ok**: `boolean`

##### resized

> **resized**: `string`[]

Filenames whose on-disk byte length differs from the manifest.

##### unexpected

> **unexpected**: `string`[]

Filenames present on disk but not attested by the manifest.

***

### Wave1PocEvidenceVisualSidecarSummary

Visual-sidecar summary duplicated into the Wave 1 evidence manifest.

#### Properties

##### confidenceSummary

> **confidenceSummary**: `object`

###### max

> **max**: `number`

###### mean

> **mean**: `number`

###### min

> **min**: `number`

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

##### resultArtifactSha256

> **resultArtifactSha256**: `string`

SHA-256 hex of the persisted `visual-sidecar-result.json` artifact.

##### selectedDeployment

> **selectedDeployment**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"`

***

### Wave1PocLbomDocument

Per-job LLM Bill of Materials document (CycloneDX 1.6 ML-BOM, Issue #1378).

The shape mirrors the CycloneDX 1.6 JSON spec for fields workspace-dev
actually populates. Optional CycloneDX fields workspace-dev does not use
are intentionally omitted from the type to keep emission and validation
aligned with what callers can audit.

#### Properties

##### bomFormat

> **bomFormat**: `"CycloneDX"`

##### components

> **components**: ([`LbomModelComponent`](#lbommodelcomponent) \| [`LbomDataComponent`](#lbomdatacomponent))[]

##### dependencies

> **dependencies**: [`LbomDependency`](#lbomdependency)[]

##### metadata

> **metadata**: [`LbomMetadata`](#lbommetadata)

##### serialNumber

> **serialNumber**: `string`

RFC-4122 UUID URN, deterministic from job identity.

##### specVersion

> **specVersion**: `"1.6"`

##### version

> **version**: `1`

CycloneDX-required document version. workspace-dev always emits `1`.

***

### Wave1PocLbomSummary

Audit-timeline summary of the per-job LBOM emit. Carries the on-disk
filename, byte length, the canonical SHA-256 (matches the manifest
attestation), and a count of components by kind so a verifier can spot
"only one model row" regression without re-parsing the artifact.

#### Properties

##### bytes

> **bytes**: `number`

Byte length of the persisted canonical JSON.

##### componentCounts

> **componentCounts**: `object`

Component-kind counts.

###### data

> **data**: `number`

###### models

> **models**: `number`

##### filename

> **filename**: `string`

Relative filename inside the run directory (`lbom/ai-bom.cdx.json`).

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### sha256

> **sha256**: `string`

SHA-256 of the persisted canonical JSON (hex, lowercase).

##### visualFallbackUsed

> **visualFallbackUsed**: `boolean`

Whether the visual sidecar fallback path was taken in the run.

***

### Wave4ProductionReadinessEvalReport

Evaluation report produced by the Wave 4 production-readiness gate.
Written to `<runDir>/wave4-production-readiness-eval-report.json`.

#### Properties

##### failureReasons

> **failureReasons**: `string`[]

##### generatedAt

> **generatedAt**: `string`

##### markdownCustomContextCoverage

> **markdownCustomContextCoverage**: `object`

###### coverageRatio

> **coverageRatio**: `number`

###### sourcesWithProvenance

> **sourcesWithProvenance**: `number`

###### totalMarkdownSources

> **totalMarkdownSources**: `number`

##### overallSourceProvenanceCoverage

> **overallSourceProvenanceCoverage**: `number`

##### overallTestCaseAttributionCoverage

> **overallTestCaseAttributionCoverage**: `number`

##### passed

> **passed**: `boolean`

##### rawJiraResponsePersisted

> **rawJiraResponsePersisted**: `false`

##### rawPasteBytesPersisted

> **rawPasteBytesPersisted**: `false`

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

##### secretsIncluded

> **secretsIncluded**: `false`

##### sourceMixCoverage

> **sourceMixCoverage**: [`Wave4SourceMixCoverageEntry`](#wave4sourcemixcoverageentry)[]

##### thresholds

> **thresholds**: [`Wave4ProductionReadinessEvalThresholds`](#wave4productionreadinessevalthresholds)

##### version

> **version**: `"1.0.0"`

***

### Wave4ProductionReadinessEvalThresholds

Pass/fail thresholds for the Wave 4 production-readiness eval gate.

#### Properties

##### maxAirgapFetchCalls

> **maxAirgapFetchCalls**: `number`

Maximum allowed outbound fetch calls in the air-gap fixture. Default 0.

##### minConflictDetectionRecall

> **minConflictDetectionRecall**: `number`

Minimum conflict-detection recall on the payment-with-conflict fixture (0–1). Default 0.95.

##### minSourceProvenance

> **minSourceProvenance**: `number`

Required provenance-field coverage across all sources (0–1). Default 1.0.

##### minTestCaseSourceAttribution

> **minTestCaseSourceAttribution**: `number`

Required source-attribution coverage on every test case (0–1). Default 1.0.

***

### Wave4SourceMixCoverageEntry

Per-source-mix coverage entry emitted by the eval gate.

#### Properties

##### airgapFetchCalls?

> `optional` **airgapFetchCalls?**: `number`

##### conflictDetectionRecall?

> `optional` **conflictDetectionRecall?**: `number`

##### failureReasons

> **failureReasons**: `string`[]

##### fixtureId

> **fixtureId**: `string`

##### mixId

> **mixId**: [`Wave4SourceMixId`](#wave4sourcemixid)

##### pass

> **pass**: `boolean`

##### sourceProvenanceCoverage

> **sourceProvenanceCoverage**: `number`

Provenance coverage ratio (0–1).

##### testCaseAttributionCoverage

> **testCaseAttributionCoverage**: `number`

Source-attribution coverage ratio across test cases (0–1).

***

### WorkspaceComponentConfidence

Per-component confidence assessment.

#### Properties

##### componentId

> **componentId**: `string`

##### componentName

> **componentName**: `string`

##### contributors

> **contributors**: [`WorkspaceConfidenceContributor`](#workspaceconfidencecontributor)[]

##### level

> **level**: [`WorkspaceConfidenceLevel`](#workspaceconfidencelevel)

##### score

> **score**: `number`

***

### WorkspaceComponentMappingRule

Submit-time or regeneration-time component mapping override rule.

#### Properties

##### boardKey

> **boardKey**: `string`

##### canonicalComponentName?

> `optional` **canonicalComponentName?**: `string`

##### componentName

> **componentName**: `string`

##### createdAt?

> `optional` **createdAt?**: `string`

##### enabled

> **enabled**: `boolean`

##### figmaLibrary?

> `optional` **figmaLibrary?**: `string`

##### id?

> `optional` **id?**: `number`

##### importPath

> **importPath**: `string`

##### nodeId?

> `optional` **nodeId?**: `string`

##### nodeNamePattern?

> `optional` **nodeNamePattern?**: `string`

##### priority

> **priority**: `number`

##### propContract?

> `optional` **propContract?**: `Record`\<`string`, `unknown`\>

##### semanticType?

> `optional` **semanticType?**: `string`

##### source

> **source**: [`WorkspaceComponentMappingSource`](#workspacecomponentmappingsource)

##### storybookTier?

> `optional` **storybookTier?**: `string`

##### updatedAt?

> `optional` **updatedAt?**: `string`

***

### WorkspaceCompositeQualityLighthouseSample

Per-sample Lighthouse metrics captured for the combined visual/performance quality report.

#### Properties

##### cls

> **cls**: `number` \| `null`

##### fcp\_ms

> **fcp\_ms**: `number` \| `null`

##### lcp\_ms

> **lcp\_ms**: `number` \| `null`

##### performanceScore

> **performanceScore**: `number` \| `null`

##### profile

> **profile**: [`WorkspaceCompositeQualityLighthouseProfile`](#workspacecompositequalitylighthouseprofile)

##### route

> **route**: `string`

##### speed\_index\_ms

> **speed\_index\_ms**: `number` \| `null`

##### tbt\_ms

> **tbt\_ms**: `number` \| `null`

***

### WorkspaceCompositeQualityPerformanceAggregateMetrics

Aggregated Lighthouse metrics included in the combined visual/performance quality report.

#### Properties

##### cls

> **cls**: `number` \| `null`

##### fcp\_ms

> **fcp\_ms**: `number` \| `null`

##### lcp\_ms

> **lcp\_ms**: `number` \| `null`

##### speed\_index\_ms

> **speed\_index\_ms**: `number` \| `null`

##### tbt\_ms

> **tbt\_ms**: `number` \| `null`

***

### WorkspaceCompositeQualityPerformanceBreakdown

Performance breakdown included in the combined visual/performance quality report.

#### Properties

##### aggregateMetrics

> **aggregateMetrics**: [`WorkspaceCompositeQualityPerformanceAggregateMetrics`](#workspacecompositequalityperformanceaggregatemetrics)

##### sampleCount

> **sampleCount**: `number`

##### samples

> **samples**: [`WorkspaceCompositeQualityLighthouseSample`](#workspacecompositequalitylighthousesample)[]

##### score

> **score**: `number` \| `null`

##### sourcePath?

> `optional` **sourcePath?**: `string`

##### warnings

> **warnings**: `string`[]

***

### WorkspaceCompositeQualityReport

Combined visual + performance quality report surfaced by validate.project.

#### Properties

##### composite?

> `optional` **composite?**: `object`

###### explanation

> **explanation**: `string`

###### includedDimensions

> **includedDimensions**: [`WorkspaceCompositeQualityDimension`](#workspacecompositequalitydimension)[]

###### score

> **score**: `number` \| `null`

##### generatedAt?

> `optional` **generatedAt?**: `string`

##### message?

> `optional` **message?**: `string`

##### performance?

> `optional` **performance?**: [`WorkspaceCompositeQualityPerformanceBreakdown`](#workspacecompositequalityperformancebreakdown) \| `null`

##### status

> **status**: `"completed"` \| `"failed"` \| `"not_requested"`

##### visual?

> `optional` **visual?**: \{ `ranAt`: `string`; `score`: `number`; `source`: `string`; \} \| `null`

##### warnings?

> `optional` **warnings?**: `string`[]

##### weights?

> `optional` **weights?**: [`WorkspaceCompositeQualityWeights`](#workspacecompositequalityweights)

***

### WorkspaceCompositeQualityWeights

Normalized weights for the combined visual/performance quality score.

#### Properties

##### performance

> **performance**: `number`

##### visual

> **visual**: `number`

***

### WorkspaceCompositeQualityWeightsInput

Optional overrides for the combined visual/performance quality weights.

#### Properties

##### performance?

> `optional` **performance?**: `number`

##### visual?

> `optional` **visual?**: `number`

***

### WorkspaceConfidenceContributor

A single explainable contributor to a confidence score.

#### Properties

##### detail

> **detail**: `string`

##### impact

> **impact**: `"positive"` \| `"negative"` \| `"neutral"`

##### signal

> **signal**: `string`

##### value

> **value**: `number`

##### weight

> **weight**: `number`

***

### WorkspaceCreatePrInput

Input payload for creating a PR from a completed regeneration job.

#### Properties

##### repoToken

> **repoToken**: `string`

##### repoUrl

> **repoUrl**: `string`

##### reviewerNote?

> `optional` **reviewerNote?**: `string`

##### targetPath?

> `optional` **targetPath?**: `string`

***

### WorkspaceCreatePrResult

Result payload returned after PR creation from a regenerated job.

#### Properties

##### gitPr

> **gitPr**: [`WorkspaceGitPrStatus`](#workspacegitprstatus)

##### jobId

> **jobId**: `string`

##### sourceJobId

> **sourceJobId**: `string`

***

### WorkspaceGenerationDiffModifiedFile

Describes a modified file in the generation diff report.

#### Properties

##### currentHash

> **currentHash**: `string`

##### file

> **file**: `string`

##### previousHash

> **previousHash**: `string`

***

### WorkspaceGenerationDiffReport

Generation diff report comparing current generation with the previous run.

#### Properties

##### added

> **added**: `string`[]

##### boardKey

> **boardKey**: `string`

##### currentJobId

> **currentJobId**: `string`

##### generatedAt

> **generatedAt**: `string`

##### modified

> **modified**: [`WorkspaceGenerationDiffModifiedFile`](#workspacegenerationdiffmodifiedfile)[]

##### previousJobId

> **previousJobId**: `string` \| `null`

##### removed

> **removed**: `string`[]

##### summary

> **summary**: `string`

##### unchanged

> **unchanged**: `string`[]

***

### WorkspaceGitPrPrerequisites

Prerequisites check result for PR creation from a regenerated job.

#### Properties

##### available

> **available**: `boolean`

##### missing

> **missing**: `string`[]

***

### WorkspaceGitPrStatus

PR execution status attached to completed jobs when Git PR integration is enabled.

#### Properties

##### branchName?

> `optional` **branchName?**: `string`

##### changedFiles?

> `optional` **changedFiles?**: `string`[]

##### prUrl?

> `optional` **prUrl?**: `string`

##### reason?

> `optional` **reason?**: `string`

##### scopePath?

> `optional` **scopePath?**: `string`

##### status

> **status**: `"skipped"` \| `"executed"`

***

### WorkspaceImportSession

#### Properties

##### componentMappings

> **componentMappings**: `number`

##### fileCount

> **fileCount**: `number`

##### fileKey

> **fileKey**: `string`

##### id

> **id**: `string`

##### importedAt

> **importedAt**: `string`

##### jobId

> **jobId**: `string`

##### nodeCount

> **nodeCount**: `number`

##### nodeId

> **nodeId**: `string`

##### nodeName

> **nodeName**: `string`

##### pasteIdentityKey

> **pasteIdentityKey**: `string` \| `null`

##### pipelineId?

> `optional` **pipelineId?**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata?

> `optional` **pipelineMetadata?**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### qualityScore?

> `optional` **qualityScore?**: `number`

##### replayable

> **replayable**: `boolean`

##### replayDisabledReason?

> `optional` **replayDisabledReason?**: `string`

##### reviewRequired?

> `optional` **reviewRequired?**: `boolean`

##### scope

> **scope**: [`WorkspaceImportSessionScope`](#workspaceimportsessionscope-1)

##### selectedNodes

> **selectedNodes**: `string`[]

##### sourceMode

> **sourceMode**: [`WorkspaceImportSessionSourceMode`](#workspaceimportsessionsourcemode-1)

##### status?

> `optional` **status?**: [`WorkspaceImportSessionStatus`](#workspaceimportsessionstatus-1)

##### userId?

> `optional` **userId?**: `string`

##### version?

> `optional` **version?**: `string`

***

### WorkspaceImportSessionDeleteResult

#### Properties

##### deleted

> **deleted**: `true`

##### jobId?

> `optional` **jobId?**: `string`

##### sessionId

> **sessionId**: `string`

***

### WorkspaceImportSessionEvent

#### Properties

##### actor?

> `optional` **actor?**: `string`

##### at

> **at**: `string`

##### id

> **id**: `string`

##### kind

> **kind**: [`WorkspaceImportSessionEventKind`](#workspaceimportsessioneventkind-1)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>

##### note?

> `optional` **note?**: `string`

##### sequence?

> `optional` **sequence?**: `number`

##### sessionId

> **sessionId**: `string`

***

### WorkspaceImportSessionEventsResponse

#### Properties

##### events

> **events**: [`WorkspaceImportSessionEvent`](#workspaceimportsessionevent)[]

***

### WorkspaceImportSessionReimportAccepted

Submit response for accepted jobs.

#### Extends

- [`WorkspaceSubmitAccepted`](#workspacesubmitaccepted)

#### Properties

##### acceptedModes

> **acceptedModes**: `object`

###### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

###### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`acceptedModes`](#acceptedmodes-3)

##### importIntent?

> `optional` **importIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`importIntent`](#importintent-3)

##### jobId

> **jobId**: `string`

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`jobId`](#jobid-41)

##### pasteDeltaSummary?

> `optional` **pasteDeltaSummary?**: [`WorkspacePasteDeltaSummary`](#workspacepastedeltasummary)

Per-paste delta summary computed at submit time for Figma paste imports.
Present only when `figmaSourceMode === "figma_paste" | "figma_plugin"` and diff succeeded.

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`pasteDeltaSummary`](#pastedeltasummary-3)

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`pipelineId`](#pipelineid-13)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`pipelineMetadata`](#pipelinemetadata-9)

##### sessionId

> **sessionId**: `string`

##### sourceJobId?

> `optional` **sourceJobId?**: `string`

##### status

> **status**: `"queued"`

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`status`](#status-16)

***

### WorkspaceImportSessionsResponse

#### Properties

##### sessions

> **sessions**: [`WorkspaceImportSession`](#workspaceimportsession)[]

***

### WorkspaceJobArtifacts

Artifact paths emitted by autonomous job execution.

#### Properties

##### businessTestIntentIrFile?

> `optional` **businessTestIntentIrFile?**: `string`

##### componentManifestFile?

> `optional` **componentManifestFile?**: `string`

##### componentMatchReportFile?

> `optional` **componentMatchReportFile?**: `string`

##### componentVisualCatalogFile?

> `optional` **componentVisualCatalogFile?**: `string`

##### compositeQualityReportFile?

> `optional` **compositeQualityReportFile?**: `string`

##### confidenceReportFile?

> `optional` **confidenceReportFile?**: `string`

##### coveragePlanFile?

> `optional` **coveragePlanFile?**: `string`

##### designIrFile?

> `optional` **designIrFile?**: `string`

##### figmaAnalysisFile?

> `optional` **figmaAnalysisFile?**: `string`

##### figmaJsonFile?

> `optional` **figmaJsonFile?**: `string`

##### figmaLibraryResolutionFile?

> `optional` **figmaLibraryResolutionFile?**: `string`

##### generatedProjectDir?

> `optional` **generatedProjectDir?**: `string`

##### generationDiffFile?

> `optional` **generationDiffFile?**: `string`

##### generationMetricsFile?

> `optional` **generationMetricsFile?**: `string`

##### jobDir

> **jobDir**: `string`

##### llmCapabilitiesEvidenceDir?

> `optional` **llmCapabilitiesEvidenceDir?**: `string`

##### outputRoot

> **outputRoot**: `string`

##### qualityPassportFile?

> `optional` **qualityPassportFile?**: `string`

##### reproDir?

> `optional` **reproDir?**: `string`

##### stageTimingsFile?

> `optional` **stageTimingsFile?**: `string`

##### storybookComponentsFile?

> `optional` **storybookComponentsFile?**: `string`

##### storybookThemesFile?

> `optional` **storybookThemesFile?**: `string`

##### storybookTokensFile?

> `optional` **storybookTokensFile?**: `string`

##### validationSummaryFile?

> `optional` **validationSummaryFile?**: `string`

##### visualAuditActualImageFile?

> `optional` **visualAuditActualImageFile?**: `string`

##### visualAuditDiffImageFile?

> `optional` **visualAuditDiffImageFile?**: `string`

##### visualAuditReferenceImageFile?

> `optional` **visualAuditReferenceImageFile?**: `string`

##### visualAuditReportFile?

> `optional` **visualAuditReportFile?**: `string`

##### visualQualityReportFile?

> `optional` **visualQualityReportFile?**: `string`

***

### WorkspaceJobCancellation

Cancellation metadata attached to jobs with cancel intent and terminal reason.

#### Properties

##### completedAt?

> `optional` **completedAt?**: `string`

##### reason

> **reason**: `string`

##### requestedAt

> **requestedAt**: `string`

##### requestedBy

> **requestedBy**: `"api"`

***

### WorkspaceJobConfidence

Job-level confidence report produced by the scoring model.

#### Properties

##### contributors?

> `optional` **contributors?**: [`WorkspaceConfidenceContributor`](#workspaceconfidencecontributor)[]

##### generatedAt?

> `optional` **generatedAt?**: `string`

##### level?

> `optional` **level?**: [`WorkspaceConfidenceLevel`](#workspaceconfidencelevel)

##### lowConfidenceSummary?

> `optional` **lowConfidenceSummary?**: `string`[]

##### message?

> `optional` **message?**: `string`

##### score?

> `optional` **score?**: `number`

##### screens?

> `optional` **screens?**: [`WorkspaceScreenConfidence`](#workspacescreenconfidence)[]

##### status

> **status**: `"completed"` \| `"failed"` \| `"not_requested"`

***

### WorkspaceJobDiagnostic

Structured diagnostic entry emitted for job, stage, or node-level issues.

#### Properties

##### code

> **code**: `string`

##### details?

> `optional` **details?**: `Record`\<`string`, [`WorkspaceJobDiagnosticValue`](#workspacejobdiagnosticvalue)\>

##### figmaNodeId?

> `optional` **figmaNodeId?**: `string`

##### figmaUrl?

> `optional` **figmaUrl?**: `string`

##### message

> **message**: `string`

##### severity

> **severity**: [`WorkspaceJobDiagnosticSeverity`](#workspacejobdiagnosticseverity-1)

##### stage

> **stage**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

##### suggestion

> **suggestion**: `string`

***

### WorkspaceJobError

Error information for failed jobs.

#### Properties

##### code

> **code**: `string`

##### diagnostics?

> `optional` **diagnostics?**: [`WorkspaceJobDiagnostic`](#workspacejobdiagnostic)[]

##### fallbackMode?

> `optional` **fallbackMode?**: [`WorkspaceJobFallbackMode`](#workspacejobfallbackmode)

##### message

> **message**: `string`

##### retryable?

> `optional` **retryable?**: `boolean`

##### retryAfterMs?

> `optional` **retryAfterMs?**: `number`

##### retryTargets?

> `optional` **retryTargets?**: [`WorkspaceJobRetryTarget`](#workspacejobretrytarget)[]

##### stage

> **stage**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

***

### WorkspaceJobInput

Submission payload accepted by workspace-dev.

#### Properties

##### brandTheme?

> `optional` **brandTheme?**: [`WorkspaceBrandTheme`](#workspacebrandtheme)

##### componentMappings?

> `optional` **componentMappings?**: [`WorkspaceComponentMappingRule`](#workspacecomponentmappingrule)[]

##### compositeQualityWeights?

> `optional` **compositeQualityWeights?**: [`WorkspaceCompositeQualityWeightsInput`](#workspacecompositequalityweightsinput)

##### customerBrandId?

> `optional` **customerBrandId?**: `string`

##### customerProfilePath?

> `optional` **customerProfilePath?**: `string`

##### enableGitPr?

> `optional` **enableGitPr?**: `boolean`

##### enableVisualQualityValidation?

> `optional` **enableVisualQualityValidation?**: `boolean`

##### figmaAccessToken?

> `optional` **figmaAccessToken?**: `string`

##### figmaFileKey?

> `optional` **figmaFileKey?**: `string`

##### figmaJsonPath?

> `optional` **figmaJsonPath?**: `string`

##### figmaJsonPayload?

> `optional` **figmaJsonPayload?**: `string`

##### figmaNodeId?

> `optional` **figmaNodeId?**: `string`

##### figmaSourceMode?

> `optional` **figmaSourceMode?**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

##### formHandlingMode?

> `optional` **formHandlingMode?**: [`WorkspaceFormHandlingMode`](#workspaceformhandlingmode)

##### generationLocale?

> `optional` **generationLocale?**: `string`

##### importIntent?

> `optional` **importIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

##### importMode?

> `optional` **importMode?**: [`WorkspaceImportMode`](#workspaceimportmode)

Optional import mode for Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold.

##### intentCorrected?

> `optional` **intentCorrected?**: `boolean`

##### jobType?

> `optional` **jobType?**: `"figma_to_code"` \| `"figma_to_qc_test_cases"`

Optional job-type discriminator. When omitted, the submission is treated
as `figma_to_code`. Setting `figma_to_qc_test_cases` requires both the
`WorkspaceStartOptions.testIntelligence.enabled` startup flag and the
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` environment variable. When the
gates are not satisfied, the server returns `503 Feature Disabled`.

##### llmCodegenMode?

> `optional` **llmCodegenMode?**: `"deterministic"`

##### originalIntent?

> `optional` **originalIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

##### pipelineId?

> `optional` **pipelineId?**: [`WorkspacePipelineId`](#workspacepipelineid)

##### projectName?

> `optional` **projectName?**: `string`

##### repoToken?

> `optional` **repoToken?**: `string`

##### repoUrl?

> `optional` **repoUrl?**: `string`

##### selectedNodeIds?

> `optional` **selectedNodeIds?**: `string`[]

Optional server-side generation scope. When present, only the selected IR nodes are kept for output generation.

##### storybookStaticDir?

> `optional` **storybookStaticDir?**: `string`

##### targetPath?

> `optional` **targetPath?**: `string`

##### testIntelligenceMode?

> `optional` **testIntelligenceMode?**: `"deterministic_llm"` \| `"offline_eval"` \| `"dry_run"`

Optional test-intelligence mode namespace. Only relevant when
`jobType="figma_to_qc_test_cases"`. Values are validated independently
of `llmCodegenMode`, which remains locked to `deterministic`.

##### ~~visualAudit?~~

> `optional` **visualAudit?**: [`WorkspaceVisualAuditInput`](#workspacevisualauditinput)

###### Deprecated

Use visual quality settings instead.

##### visualQualityBrowsers?

> `optional` **visualQualityBrowsers?**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)[]

##### visualQualityDeviceScaleFactor?

> `optional` **visualQualityDeviceScaleFactor?**: `number`

##### visualQualityFrozenReference?

> `optional` **visualQualityFrozenReference?**: [`WorkspaceVisualQualityFrozenReference`](#workspacevisualqualityfrozenreference)

##### visualQualityReferenceMode?

> `optional` **visualQualityReferenceMode?**: [`WorkspaceVisualQualityReferenceMode`](#workspacevisualqualityreferencemode)

##### visualQualityViewportHeight?

> `optional` **visualQualityViewportHeight?**: `number`

##### visualQualityViewportWidth?

> `optional` **visualQualityViewportWidth?**: `number`

***

### WorkspaceJobInspector

Inspector-facing backend result contract for recovery-aware paste flows.

#### Properties

##### fallbackMode?

> `optional` **fallbackMode?**: [`WorkspaceJobFallbackMode`](#workspacejobfallbackmode)

##### mcpCallsConsumed?

> `optional` **mcpCallsConsumed?**: `number`

Successful MCP read-tool calls consumed by this job.

##### outcome?

> `optional` **outcome?**: [`WorkspaceJobOutcome`](#workspacejoboutcome)

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### qualityPassport?

> `optional` **qualityPassport?**: [`WorkspacePipelineQualityPassportSummary`](#workspacepipelinequalitypassportsummary)

##### retryableStages?

> `optional` **retryableStages?**: [`WorkspaceJobRetryStage`](#workspacejobretrystage)[]

##### retryTargets?

> `optional` **retryTargets?**: [`WorkspaceJobRetryTarget`](#workspacejobretrytarget)[]

##### stages

> **stages**: [`WorkspaceJobInspectorStage`](#workspacejobinspectorstage)[]

***

### WorkspaceJobInspectorStage

Inspector-facing metadata for a single pipeline stage.

#### Properties

##### code?

> `optional` **code?**: `string`

##### fallbackMode?

> `optional` **fallbackMode?**: [`WorkspaceJobFallbackMode`](#workspacejobfallbackmode)

##### message?

> `optional` **message?**: `string`

##### retryable?

> `optional` **retryable?**: `boolean`

##### retryAfterMs?

> `optional` **retryAfterMs?**: `number`

##### retryTargets?

> `optional` **retryTargets?**: [`WorkspaceJobRetryTarget`](#workspacejobretrytarget)[]

##### stage

> **stage**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

##### status

> **status**: [`WorkspaceJobStageStatus`](#workspacejobstagestatus-1)

***

### WorkspaceJobLineage

Lineage metadata linking a regeneration job to its source.

#### Properties

##### baseFingerprint?

> `optional` **baseFingerprint?**: `string`

##### draftId?

> `optional` **draftId?**: `string`

##### kind?

> `optional` **kind?**: `"delta"` \| `"regeneration"` \| `"retry"`

##### overrideCount

> **overrideCount**: `number`

##### pipelineMetadata?

> `optional` **pipelineMetadata?**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### retryStage?

> `optional` **retryStage?**: [`WorkspaceJobRetryStage`](#workspacejobretrystage)

##### retryTargets?

> `optional` **retryTargets?**: `string`[]

##### sourceJobId

> **sourceJobId**: `string`

***

### WorkspaceJobLog

Structured job log line.

#### Properties

##### at

> **at**: `string`

##### level

> **level**: `"error"` \| `"info"` \| `"debug"` \| `"warn"`

##### message

> **message**: `string`

##### stage?

> `optional` **stage?**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

***

### WorkspaceJobPipelineMetadata

Pipeline identity stamped onto job lifecycle records and public projections.

#### Properties

##### buildProfile

> **buildProfile**: `string`

##### deterministic

> **deterministic**: `true`

##### pipelineDisplayName

> **pipelineDisplayName**: `string`

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### templateBundleId

> **templateBundleId**: `string`

***

### WorkspaceJobQueueState

Queue snapshot attached to job payloads for queue-state visibility.

#### Properties

##### maxConcurrentJobs

> **maxConcurrentJobs**: `number`

##### maxQueuedJobs

> **maxQueuedJobs**: `number`

##### position?

> `optional` **position?**: `number`

##### queuedCount

> **queuedCount**: `number`

##### runningCount

> **runningCount**: `number`

***

### WorkspaceJobRequestMetadata

Public subset of request metadata stored for a job (secrets excluded).

#### Properties

##### brandTheme

> **brandTheme**: [`WorkspaceBrandTheme`](#workspacebrandtheme)

##### componentMappings?

> `optional` **componentMappings?**: [`WorkspaceComponentMappingRule`](#workspacecomponentmappingrule)[]

##### compositeQualityWeights?

> `optional` **compositeQualityWeights?**: [`WorkspaceCompositeQualityWeightsInput`](#workspacecompositequalityweightsinput)

##### customerBrandId?

> `optional` **customerBrandId?**: `string`

##### customerProfilePath?

> `optional` **customerProfilePath?**: `string`

##### enableGitPr

> **enableGitPr**: `boolean`

##### enableVisualQualityValidation

> **enableVisualQualityValidation**: `boolean`

##### figmaFileKey?

> `optional` **figmaFileKey?**: `string`

##### figmaJsonPath?

> `optional` **figmaJsonPath?**: `string`

##### figmaNodeId?

> `optional` **figmaNodeId?**: `string`

##### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

##### formHandlingMode

> **formHandlingMode**: [`WorkspaceFormHandlingMode`](#workspaceformhandlingmode)

##### generationLocale

> **generationLocale**: `string`

##### importIntent?

> `optional` **importIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

##### importMode?

> `optional` **importMode?**: [`WorkspaceImportMode`](#workspaceimportmode)

##### intentCorrected?

> `optional` **intentCorrected?**: `boolean`

##### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

##### originalIntent?

> `optional` **originalIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

##### pipelineId?

> `optional` **pipelineId?**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata?

> `optional` **pipelineMetadata?**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### projectName?

> `optional` **projectName?**: `string`

##### repoUrl?

> `optional` **repoUrl?**: `string`

##### requestSourceMode?

> `optional` **requestSourceMode?**: [`WorkspaceImportSessionSourceMode`](#workspaceimportsessionsourcemode-1)

##### selectedNodeIds?

> `optional` **selectedNodeIds?**: `string`[]

##### storybookStaticDir?

> `optional` **storybookStaticDir?**: `string`

##### targetPath?

> `optional` **targetPath?**: `string`

##### ~~visualAudit?~~

> `optional` **visualAudit?**: [`WorkspaceVisualAuditInput`](#workspacevisualauditinput)

###### Deprecated

Compatibility alias for legacy callers.

##### visualQualityBrowsers?

> `optional` **visualQualityBrowsers?**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)[]

##### visualQualityDeviceScaleFactor?

> `optional` **visualQualityDeviceScaleFactor?**: `number`

##### visualQualityFrozenReference?

> `optional` **visualQualityFrozenReference?**: [`WorkspaceVisualQualityFrozenReference`](#workspacevisualqualityfrozenreference)

##### visualQualityReferenceMode?

> `optional` **visualQualityReferenceMode?**: [`WorkspaceVisualQualityReferenceMode`](#workspacevisualqualityreferencemode)

##### visualQualityViewportHeight?

> `optional` **visualQualityViewportHeight?**: `number`

##### visualQualityViewportWidth?

> `optional` **visualQualityViewportWidth?**: `number`

***

### WorkspaceJobResult

Compact result payload for terminal-state inspection.

#### Properties

##### artifacts

> **artifacts**: [`WorkspaceJobArtifacts`](#workspacejobartifacts)

##### cancellation?

> `optional` **cancellation?**: [`WorkspaceJobCancellation`](#workspacejobcancellation)

##### compositeQuality?

> `optional` **compositeQuality?**: [`WorkspaceCompositeQualityReport`](#workspacecompositequalityreport)

##### confidence?

> `optional` **confidence?**: [`WorkspaceJobConfidence`](#workspacejobconfidence)

##### error?

> `optional` **error?**: [`WorkspaceJobError`](#workspacejoberror)

##### generationDiff?

> `optional` **generationDiff?**: [`WorkspaceGenerationDiffReport`](#workspacegenerationdiffreport)

##### gitPr?

> `optional` **gitPr?**: [`WorkspaceGitPrStatus`](#workspacegitprstatus)

##### inspector?

> `optional` **inspector?**: [`WorkspaceJobInspector`](#workspacejobinspector)

##### jobId

> **jobId**: `string`

##### lineage?

> `optional` **lineage?**: [`WorkspaceJobLineage`](#workspacejoblineage)

##### outcome?

> `optional` **outcome?**: [`WorkspaceJobOutcome`](#workspacejoboutcome)

##### pasteDeltaSummary?

> `optional` **pasteDeltaSummary?**: [`WorkspacePasteDeltaSummary`](#workspacepastedeltasummary)

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### preview

> **preview**: `object`

###### enabled

> **enabled**: `boolean`

###### url?

> `optional` **url?**: `string`

##### status

> **status**: [`WorkspaceJobRuntimeStatus`](#workspacejobruntimestatus)

##### summary

> **summary**: `string`

##### visualAudit?

> `optional` **visualAudit?**: [`WorkspaceVisualAuditResult`](#workspacevisualauditresult)

##### visualQuality?

> `optional` **visualQuality?**: [`WorkspaceVisualQualityReport`](#workspacevisualqualityreport)

***

### WorkspaceJobRetryTarget

Retry target surfaced for failed-stage retries and failed generated files.

#### Properties

##### displayName?

> `optional` **displayName?**: `string`

##### emittedScreenId?

> `optional` **emittedScreenId?**: `string`

##### filePath?

> `optional` **filePath?**: `string`

##### kind

> **kind**: `"stage"` \| `"generated_file"`

##### stage

> **stage**: [`WorkspaceJobRetryStage`](#workspacejobretrystage)

##### targetId

> **targetId**: `string`

***

### WorkspaceJobStage

Stage details for each job stage.

#### Properties

##### completedAt?

> `optional` **completedAt?**: `string`

##### durationMs?

> `optional` **durationMs?**: `number`

##### message?

> `optional` **message?**: `string`

##### name

> **name**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

##### startedAt?

> `optional` **startedAt?**: `string`

##### status

> **status**: [`WorkspaceJobStageStatus`](#workspacejobstagestatus-1)

***

### WorkspaceJobStatus

Full job status payload for polling endpoint.

#### Properties

##### artifacts

> **artifacts**: [`WorkspaceJobArtifacts`](#workspacejobartifacts)

##### cancellation?

> `optional` **cancellation?**: [`WorkspaceJobCancellation`](#workspacejobcancellation)

##### compositeQuality?

> `optional` **compositeQuality?**: [`WorkspaceCompositeQualityReport`](#workspacecompositequalityreport)

##### confidence?

> `optional` **confidence?**: [`WorkspaceJobConfidence`](#workspacejobconfidence)

##### currentStage?

> `optional` **currentStage?**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

##### error?

> `optional` **error?**: [`WorkspaceJobError`](#workspacejoberror)

##### finishedAt?

> `optional` **finishedAt?**: `string`

##### generationDiff?

> `optional` **generationDiff?**: [`WorkspaceGenerationDiffReport`](#workspacegenerationdiffreport)

##### gitPr?

> `optional` **gitPr?**: [`WorkspaceGitPrStatus`](#workspacegitprstatus)

##### inspector?

> `optional` **inspector?**: [`WorkspaceJobInspector`](#workspacejobinspector)

##### jobId

> **jobId**: `string`

##### lineage?

> `optional` **lineage?**: [`WorkspaceJobLineage`](#workspacejoblineage)

##### logs

> **logs**: [`WorkspaceJobLog`](#workspacejoblog)[]

##### outcome?

> `optional` **outcome?**: [`WorkspaceJobOutcome`](#workspacejoboutcome)

##### pasteDeltaSummary?

> `optional` **pasteDeltaSummary?**: [`WorkspacePasteDeltaSummary`](#workspacepastedeltasummary)

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### preview

> **preview**: `object`

###### enabled

> **enabled**: `boolean`

###### url?

> `optional` **url?**: `string`

##### queue

> **queue**: [`WorkspaceJobQueueState`](#workspacejobqueuestate)

##### request

> **request**: [`WorkspaceJobRequestMetadata`](#workspacejobrequestmetadata)

##### stages

> **stages**: [`WorkspaceJobStage`](#workspacejobstage)[]

##### startedAt?

> `optional` **startedAt?**: `string`

##### status

> **status**: [`WorkspaceJobRuntimeStatus`](#workspacejobruntimestatus)

##### submittedAt

> **submittedAt**: `string`

##### visualAudit?

> `optional` **visualAudit?**: [`WorkspaceVisualAuditResult`](#workspacevisualauditresult)

##### visualQuality?

> `optional` **visualQuality?**: [`WorkspaceVisualQualityReport`](#workspacevisualqualityreport)

***

### WorkspaceLocalSyncApplyRequest

Apply request payload for executing a previously previewed local sync plan.

#### Properties

##### confirmationToken

> **confirmationToken**: `string`

##### confirmOverwrite

> **confirmOverwrite**: `boolean`

##### fileDecisions

> **fileDecisions**: [`WorkspaceLocalSyncFileDecisionEntry`](#workspacelocalsyncfiledecisionentry)[]

##### mode

> **mode**: `"apply"`

##### reviewerNote?

> `optional` **reviewerNote?**: `string`

***

### WorkspaceLocalSyncApplyResult

Apply response payload describing the executed local sync plan.

#### Properties

##### appliedAt

> **appliedAt**: `string`

##### boardKey

> **boardKey**: `string`

##### destinationRoot

> **destinationRoot**: `string`

##### files

> **files**: [`WorkspaceLocalSyncFilePlanEntry`](#workspacelocalsyncfileplanentry)[]

##### jobId

> **jobId**: `string`

##### scopePath

> **scopePath**: `string`

##### sourceJobId

> **sourceJobId**: `string`

##### summary

> **summary**: [`WorkspaceLocalSyncSummary`](#workspacelocalsyncsummary)

##### targetPath

> **targetPath**: `string`

***

### WorkspaceLocalSyncDryRunRequest

Dry-run request payload for previewing a local sync plan.

#### Properties

##### mode

> **mode**: `"dry_run"`

##### targetPath?

> `optional` **targetPath?**: `string`

***

### WorkspaceLocalSyncDryRunResult

Dry-run response payload describing a local sync plan before apply.

#### Properties

##### boardKey

> **boardKey**: `string`

##### confirmationExpiresAt

> **confirmationExpiresAt**: `string`

##### confirmationToken

> **confirmationToken**: `string`

##### destinationRoot

> **destinationRoot**: `string`

##### files

> **files**: [`WorkspaceLocalSyncFilePlanEntry`](#workspacelocalsyncfileplanentry)[]

##### jobId

> **jobId**: `string`

##### scopePath

> **scopePath**: `string`

##### sourceJobId

> **sourceJobId**: `string`

##### summary

> **summary**: [`WorkspaceLocalSyncSummary`](#workspacelocalsyncsummary)

##### targetPath

> **targetPath**: `string`

***

### WorkspaceLocalSyncFileDecisionEntry

User decision for a single planned file during local sync apply.

#### Properties

##### decision

> **decision**: [`WorkspaceLocalSyncFileDecision`](#workspacelocalsyncfiledecision)

##### path

> **path**: `string`

***

### WorkspaceLocalSyncFilePlanEntry

Planned file entry returned by local sync preview/apply flows.

#### Properties

##### action

> **action**: [`WorkspaceLocalSyncFileAction`](#workspacelocalsyncfileaction)

##### decision

> **decision**: [`WorkspaceLocalSyncFileDecision`](#workspacelocalsyncfiledecision)

##### message

> **message**: `string`

##### path

> **path**: `string`

##### reason

> **reason**: [`WorkspaceLocalSyncFileReason`](#workspacelocalsyncfilereason)

##### selectedByDefault

> **selectedByDefault**: `boolean`

##### sizeBytes

> **sizeBytes**: `number`

##### status

> **status**: [`WorkspaceLocalSyncFileStatus`](#workspacelocalsyncfilestatus)

***

### WorkspaceLocalSyncSummary

Aggregate counts and byte sizes for a planned local sync run.

#### Properties

##### conflictCount

> **conflictCount**: `number`

##### createCount

> **createCount**: `number`

##### overwriteCount

> **overwriteCount**: `number`

##### selectedBytes

> **selectedBytes**: `number`

##### selectedFiles

> **selectedFiles**: `number`

##### totalBytes

> **totalBytes**: `number`

##### totalFiles

> **totalFiles**: `number`

##### unchangedCount

> **unchangedCount**: `number`

##### untrackedCount

> **untrackedCount**: `number`

***

### WorkspacePasteDeltaSummary

Summary of the per-paste delta computation. Surfaced on JobResult when Figma paste import is used.

#### Properties

##### mode

> **mode**: `"delta"` \| `"full"` \| `"auto_resolved_to_full"` \| `"auto_resolved_to_delta"`

Mode ultimately used by the server. `auto_*` variants are returned when the client asked for "auto".

##### nodesReprocessed

> **nodesReprocessed**: `number`

Nodes that required reprocessing (added + updated + all descendants of updated).

##### nodesReused

> **nodesReused**: `number`

Nodes whose subtree hash matched the prior manifest (eligible for reuse).

##### pasteIdentityKey

> **pasteIdentityKey**: `string`

Stable per-component identity key (sha256 prefix). Useful for correlating future pastes.

##### priorManifestMissing

> **priorManifestMissing**: `boolean`

True when the server had no prior manifest for this identity (first paste).

##### strategy

> **strategy**: [`WorkspacePasteDeltaStrategy`](#workspacepastedeltastrategy)

Structural classification of the tree diff.

##### structuralChangeRatio

> **structuralChangeRatio**: `number`

Diff ratio used to choose mode when `auto`. 0 = identical, 1 = all new.

##### totalNodes

> **totalNodes**: `number`

Total nodes observed in the current paste.

***

### WorkspacePipelineDescriptor

Public descriptor for a pipeline included in the current package profile.

#### Properties

##### description

> **description**: `string`

##### deterministic?

> `optional` **deterministic?**: `true`

##### displayName

> **displayName**: `string`

##### id

> **id**: [`WorkspacePipelineId`](#workspacepipelineid)

##### supportedScopes

> **supportedScopes**: [`WorkspacePipelineScope`](#workspacepipelinescope)[]

##### supportedSourceModes

> **supportedSourceModes**: (`"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`)[]

##### template?

> `optional` **template?**: [`WorkspacePipelineTemplateMetadata`](#workspacepipelinetemplatemetadata)

##### visibility?

> `optional` **visibility?**: [`WorkspacePipelineVisibility`](#workspacepipelinevisibility)

***

### WorkspacePipelineQualityCoverageMetric

Ratio-based metric used for token and semantic coverage evidence.

#### Properties

##### covered

> **covered**: `number`

##### ratio

> **ratio**: `number`

##### status

> **status**: [`WorkspacePipelineQualityValidationStatus`](#workspacepipelinequalityvalidationstatus)

##### total

> **total**: `number`

***

### WorkspacePipelineQualityGeneratedFile

Generated-file evidence row for a pipeline quality passport.

#### Properties

##### path

> **path**: `string`

##### sha256?

> `optional` **sha256?**: `string`

##### sizeBytes?

> `optional` **sizeBytes?**: `number`

***

### WorkspacePipelineQualityPassport

Deterministic, secret-free enterprise evidence emitted as `quality-passport.json`.

#### Properties

##### buildProfile

> **buildProfile**: `string`

##### coverage

> **coverage**: `object`

###### semantic

> **semantic**: [`WorkspacePipelineQualityCoverageMetric`](#workspacepipelinequalitycoveragemetric)

###### token

> **token**: [`WorkspacePipelineQualityCoverageMetric`](#workspacepipelinequalitycoveragemetric)

##### generatedFiles

> **generatedFiles**: [`WorkspacePipelineQualityGeneratedFile`](#workspacepipelinequalitygeneratedfile)[]

##### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### scope

> **scope**: [`WorkspacePipelineQualityScope`](#workspacepipelinequalityscope)

##### templateBundleId

> **templateBundleId**: `string`

##### validation

> **validation**: [`WorkspacePipelineQualityValidationSummary`](#workspacepipelinequalityvalidationsummary)

##### warnings

> **warnings**: [`WorkspacePipelineQualityWarning`](#workspacepipelinequalitywarning)[]

***

### WorkspacePipelineQualityPassportSummary

Inspector-facing compact projection of persisted quality-passport evidence.

#### Properties

##### artifactFile?

> `optional` **artifactFile?**: `string`

##### buildProfile

> **buildProfile**: `string`

##### generatedFileCount

> **generatedFileCount**: `number`

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### scope

> **scope**: [`WorkspacePipelineScope`](#workspacepipelinescope)

##### selectedNodeCount

> **selectedNodeCount**: `number`

##### semanticCoverage

> **semanticCoverage**: [`WorkspacePipelineQualityCoverageMetric`](#workspacepipelinequalitycoveragemetric)

##### sourceMode

> **sourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

##### templateBundleId

> **templateBundleId**: `string`

##### tokenCoverage

> **tokenCoverage**: [`WorkspacePipelineQualityCoverageMetric`](#workspacepipelinequalitycoveragemetric)

##### validationStatus

> **validationStatus**: [`WorkspacePipelineQualityValidationStatus`](#workspacepipelinequalityvalidationstatus)

##### warningCount

> **warningCount**: `number`

***

### WorkspacePipelineQualityScope

Scope projection for a generated pipeline quality passport.

#### Properties

##### scope

> **scope**: [`WorkspacePipelineScope`](#workspacepipelinescope)

##### selectedNodeCount

> **selectedNodeCount**: `number`

##### sourceMode

> **sourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

***

### WorkspacePipelineQualityValidationSummary

Stable validation summary for quality-passport evidence.

#### Properties

##### stages

> **stages**: `object`[]

###### name

> **name**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

###### status

> **status**: [`WorkspaceJobStageStatus`](#workspacejobstagestatus-1)

##### status

> **status**: [`WorkspacePipelineQualityValidationStatus`](#workspacepipelinequalityvalidationstatus)

***

### WorkspacePipelineQualityWarning

Structured warning row used by deterministic quality-passport evidence.

#### Properties

##### code

> **code**: `string`

##### message

> **message**: `string`

##### severity

> **severity**: [`WorkspacePipelineQualityWarningSeverity`](#workspacepipelinequalitywarningseverity-1)

##### source?

> `optional` **source?**: `string`

***

### WorkspacePipelineStackDescriptor

Public stack identity for a pipeline template bundle.

#### Properties

##### bundler

> **bundler**: `string`

##### framework

> **framework**: `string`

##### language

> **language**: `string`

##### styling

> **styling**: `string`

***

### WorkspacePipelineTemplateMetadata

Public template identity for a pipeline included in the current package profile.

#### Properties

##### bundleId

> **bundleId**: `string`

##### path

> **path**: `string`

##### stack

> **stack**: [`WorkspacePipelineStackDescriptor`](#workspacepipelinestackdescriptor)

***

### WorkspaceRegenerationAccepted

Submit response for accepted regeneration jobs.

#### Properties

##### acceptedModes

> **acceptedModes**: `object`

###### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

###### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

##### jobId

> **jobId**: `string`

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### sourceJobId

> **sourceJobId**: `string`

##### status

> **status**: `"queued"`

***

### WorkspaceRegenerationInput

Submission payload for regeneration from a completed source job with IR overrides.

Customer profile handling: regeneration reuses the source job's persisted
customer-profile snapshot (`STAGE_ARTIFACT_KEYS.customerProfileResolved`).
This interface intentionally exposes no `customerProfilePath` field — the
profile is not overridable at regeneration time. To regenerate against a
different profile, submit a new job.

#### Properties

##### baseFingerprint?

> `optional` **baseFingerprint?**: `string`

##### componentMappings?

> `optional` **componentMappings?**: [`WorkspaceComponentMappingRule`](#workspacecomponentmappingrule)[]

##### customerBrandId?

> `optional` **customerBrandId?**: `string`

##### draftId?

> `optional` **draftId?**: `string`

##### overrides

> **overrides**: [`WorkspaceRegenerationOverrideEntry`](#workspaceregenerationoverrideentry)[]

##### pipelineId?

> `optional` **pipelineId?**: [`WorkspacePipelineId`](#workspacepipelineid)

Optional pipeline assertion. When provided, it must match the completed
source job pipeline; regeneration cannot migrate between pipelines.

##### sourceJobId

> **sourceJobId**: `string`

***

### WorkspaceRegenerationOverrideEntry

Structured override entry for regeneration from Inspector drafts.

#### Properties

##### field

> **field**: `string`

##### nodeId

> **nodeId**: `string`

##### value

> **value**: `string` \| `number` \| `boolean` \| \{ `bottom`: `number`; `left`: `number`; `right`: `number`; `top`: `number`; \}

***

### WorkspaceRemapDecisionEntry

A user decision on a single remap suggestion.

#### Properties

##### accepted

> **accepted**: `boolean`

##### sourceNodeId

> **sourceNodeId**: `string`

##### targetNodeId

> **targetNodeId**: `string` \| `null`

***

### WorkspaceRemapRejection

A source node for which no remap could be determined.

#### Properties

##### reason

> **reason**: `string`

Human-readable reason why remapping was not possible.

##### sourceNodeId

> **sourceNodeId**: `string`

The unmappable node ID from the stale draft.

##### sourceNodeName

> **sourceNodeName**: `string`

The original node name (from the source IR).

##### sourceNodeType

> **sourceNodeType**: `string`

The element type of the source node.

***

### WorkspaceRemapSuggestInput

Input payload for the remap-suggest endpoint.

#### Properties

##### latestJobId

> **latestJobId**: `string`

The latest job ID to remap into.

##### sourceJobId

> **sourceJobId**: `string`

The stale source job ID whose draft overrides need remapping.

##### unmappedNodeIds

> **unmappedNodeIds**: `string`[]

Node IDs from the draft that need remapping (those not found in the latest IR).

***

### WorkspaceRemapSuggestion

A single remap suggestion mapping a source node to a candidate target node.

#### Properties

##### confidence

> **confidence**: [`WorkspaceRemapConfidence`](#workspaceremapconfidence)

Confidence level of the suggestion.

##### reason

> **reason**: `string`

Human-readable reason for the suggestion.

##### rule

> **rule**: [`WorkspaceRemapRule`](#workspaceremaprule)

The rule that produced this suggestion.

##### sourceNodeId

> **sourceNodeId**: `string`

The original node ID from the stale draft override.

##### sourceNodeName

> **sourceNodeName**: `string`

The original node name (from the source IR).

##### sourceNodeType

> **sourceNodeType**: `string`

The element type of the source node.

##### targetNodeId

> **targetNodeId**: `string`

The suggested target node ID in the latest IR.

##### targetNodeName

> **targetNodeName**: `string`

The target node name in the latest IR.

##### targetNodeType

> **targetNodeType**: `string`

The element type of the target node.

***

### WorkspaceRemapSuggestResult

Result of the remap-suggest endpoint.

#### Properties

##### latestJobId

> **latestJobId**: `string`

##### message

> **message**: `string`

##### rejections

> **rejections**: [`WorkspaceRemapRejection`](#workspaceremaprejection)[]

##### sourceJobId

> **sourceJobId**: `string`

##### suggestions

> **suggestions**: [`WorkspaceRemapSuggestion`](#workspaceremapsuggestion)[]

***

### WorkspaceRetryAccepted

Submit response for accepted retry jobs.

#### Properties

##### acceptedModes

> **acceptedModes**: `object`

###### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

###### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

##### jobId

> **jobId**: `string`

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### retryStage

> **retryStage**: [`WorkspaceJobRetryStage`](#workspacejobretrystage)

##### sourceJobId

> **sourceJobId**: `string`

##### status

> **status**: `"queued"`

***

### WorkspaceRetryInput

Submission payload for retrying a failed or partial job from a persisted stage boundary.

#### Properties

##### retryStage

> **retryStage**: [`WorkspaceJobRetryStage`](#workspacejobretrystage)

##### retryTargets?

> `optional` **retryTargets?**: `string`[]

##### sourceJobId

> **sourceJobId**: `string`

***

### WorkspaceScreenConfidence

Per-screen confidence assessment.

#### Properties

##### components

> **components**: [`WorkspaceComponentConfidence`](#workspacecomponentconfidence)[]

##### contributors

> **contributors**: [`WorkspaceConfidenceContributor`](#workspaceconfidencecontributor)[]

##### level

> **level**: [`WorkspaceConfidenceLevel`](#workspaceconfidencelevel)

##### score

> **score**: `number`

##### screenId

> **screenId**: `string`

##### screenName

> **screenName**: `string`

***

### WorkspaceStaleDraftCheckResult

Result of a stale-draft check for a given job.

#### Properties

##### boardKey

> **boardKey**: `string` \| `null`

Board key shared by source and latest jobs.

##### carryForwardAvailable

> **carryForwardAvailable**: `boolean`

Whether carry-forward is available (all draft node IDs exist in the latest job's IR).

##### latestJobId

> **latestJobId**: `string` \| `null`

The job ID of the latest completed job for the same board key (if stale).

##### message

> **message**: `string`

Human-readable explanation of the stale state.

##### sourceJobId

> **sourceJobId**: `string`

The job ID the draft was created from.

##### stale

> **stale**: `boolean`

Whether the draft's source job is stale (a newer completed job exists for the same board key).

##### unmappedNodeIds

> **unmappedNodeIds**: `string`[]

Node IDs from the draft that could not be resolved in the latest job's IR.

***

### WorkspaceStartOptions

Configuration for starting a workspace-dev server instance.

#### Properties

##### brandTheme?

> `optional` **brandTheme?**: [`WorkspaceBrandTheme`](#workspacebrandtheme)

Token brand policy used when deriving IR tokens. Default: "derived"

##### commandStderrMaxBytes?

> `optional` **commandStderrMaxBytes?**: `number`

Maximum retained stderr bytes per external command before truncation/spooling. Default: 1048576

##### commandStdoutMaxBytes?

> `optional` **commandStdoutMaxBytes?**: `number`

Maximum retained stdout bytes per external command before truncation/spooling. Default: 1048576

##### commandTimeoutMs?

> `optional` **commandTimeoutMs?**: `number`

Timeout for external commands (pnpm/git) in milliseconds. Default: 900000

##### compositeQualityWeights?

> `optional` **compositeQualityWeights?**: [`WorkspaceCompositeQualityWeightsInput`](#workspacecompositequalityweightsinput)

Weight overrides used when computing the combined visual/performance quality score. Default: visual 0.6, performance 0.4

##### designSystemFilePath?

> `optional` **designSystemFilePath?**: `string`

Path to design-system mapping file (JSON). Default: <outputRoot>/design-system.json

##### enableLintAutofix?

> `optional` **enableLintAutofix?**: `boolean`

Run lint auto-fix during validate.project before lint/typecheck/build. Default: true

##### enablePerfValidation?

> `optional` **enablePerfValidation?**: `boolean`

Run perf validation during validate.project. Default: false

##### enablePreview?

> `optional` **enablePreview?**: `boolean`

Enable local preview export and serving. Default: true

##### enableUiValidation?

> `optional` **enableUiValidation?**: `boolean`

Run generated-project UI validation in validate.project, including static checks and optional browser visual matrix when the template provides `validate:playwright`. Default: false

##### enableUnitTestValidation?

> `optional` **enableUnitTestValidation?**: `boolean`

Run generated-project unit tests in validate.project. Default: false

##### enableVisualQualityValidation?

> `optional` **enableVisualQualityValidation?**: `boolean`

Run visual quality validation in validate.project. Default: false

##### exportImages?

> `optional` **exportImages?**: `boolean`

Enable Figma image asset export to generated-app/public/images. Default: true

##### fetchImpl?

> `optional` **fetchImpl?**: \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

Optional custom fetch implementation (for tests or custom runtimes).

###### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

###### Parameters

###### input

`URL` \| `RequestInfo`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

###### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### figmaAdaptiveBatchingEnabled?

> `optional` **figmaAdaptiveBatchingEnabled?**: `boolean`

Enable adaptive node batch splitting on repeated oversized responses. Default: true

##### figmaBootstrapDepth?

> `optional` **figmaBootstrapDepth?**: `number`

Bootstrap depth for large-board staged fetch. Default: 5

##### figmaCacheEnabled?

> `optional` **figmaCacheEnabled?**: `boolean`

Enable file-system cache for figma.source fetches. Default: true

##### figmaCacheTtlMs?

> `optional` **figmaCacheTtlMs?**: `number`

Cache TTL for figma.source entries in milliseconds. Default: 900000

##### figmaCircuitBreakerFailureThreshold?

> `optional` **figmaCircuitBreakerFailureThreshold?**: `number`

Consecutive transient failures before the Figma REST circuit breaker opens. Default: 3

##### figmaCircuitBreakerResetTimeoutMs?

> `optional` **figmaCircuitBreakerResetTimeoutMs?**: `number`

Duration in milliseconds that the Figma REST circuit breaker stays open before a probe request is allowed. Default: 30000

##### figmaMaxRetries?

> `optional` **figmaMaxRetries?**: `number`

Figma retry attempts. Default: 3

##### figmaMaxScreenCandidates?

> `optional` **figmaMaxScreenCandidates?**: `number`

Maximum staged screen candidates to fetch. Default: 40

##### figmaNodeBatchSize?

> `optional` **figmaNodeBatchSize?**: `number`

Candidate node batch size for staged fetch. Default: 6

##### figmaNodeFetchConcurrency?

> `optional` **figmaNodeFetchConcurrency?**: `number`

Number of concurrent staged /nodes fetch workers. Default: 3

##### figmaPasteTempTtlMs?

> `optional` **figmaPasteTempTtlMs?**: `number`

Startup cleanup TTL for stale tmp-figma-paste JSON files in milliseconds. Default: 86400000

##### figmaRequestTimeoutMs?

> `optional` **figmaRequestTimeoutMs?**: `number`

Figma request timeout in milliseconds. Default: 30000

##### figmaScreenElementBudget?

> `optional` **figmaScreenElementBudget?**: `number`

Maximum IR elements per screen before deterministic truncation. Default: 1200

##### figmaScreenElementMaxDepth?

> `optional` **figmaScreenElementMaxDepth?**: `number`

Configured baseline depth limit for dynamic IR child traversal. Default: 14

##### figmaScreenNamePattern?

> `optional` **figmaScreenNamePattern?**: `string`

Optional case-insensitive regex used to include staged screen candidates by name.

##### generationLocale?

> `optional` **generationLocale?**: `string`

Locale used for deterministic select-option number derivation. Default: "de-DE"

##### host?

> `optional` **host?**: `string`

Host to bind to. Default: "127.0.0.1"

##### iconMapFilePath?

> `optional` **iconMapFilePath?**: `string`

Path to icon fallback mapping file (JSON). Default: <outputRoot>/icon-fallback-map.json

##### importSessionEventBearerToken?

> `optional` **importSessionEventBearerToken?**: `string`

Bearer token accepted for `POST /workspace/import-sessions/:id/events`.
When omitted, import-session event writes fail closed.

##### installPreferOffline?

> `optional` **installPreferOffline?**: `boolean`

Prefer offline package resolution during generated-project install. Default: true

##### logFormat?

> `optional` **logFormat?**: [`WorkspaceLogFormat`](#workspacelogformat)

Output format for operational runtime logs. Default: "text"

##### logLimit?

> `optional` **logLimit?**: `number`

Maximum retained job log entries. Default: 300

##### maxConcurrentJobs?

> `optional` **maxConcurrentJobs?**: `number`

Maximum number of jobs that may run concurrently. Default: 1

##### maxIrCacheBytes?

> `optional` **maxIrCacheBytes?**: `number`

Maximum IR cache bytes retained on disk before eviction. Default: 134217728

##### maxIrCacheEntries?

> `optional` **maxIrCacheEntries?**: `number`

Maximum IR cache entry count before eviction. Default: 50

##### maxJobDiskBytes?

> `optional` **maxJobDiskBytes?**: `number`

Maximum on-disk bytes for job-owned roots before the pipeline fails. Default: 536870912

##### maxJsonResponseBytes?

> `optional` **maxJsonResponseBytes?**: `number`

Maximum Figma JSON response bytes accepted before parse fallback/failure. Default: 67108864

##### maxQueuedJobs?

> `optional` **maxQueuedJobs?**: `number`

Maximum number of queued jobs waiting for execution before backpressure rejects submit. Default: 20

##### maxValidationAttempts?

> `optional` **maxValidationAttempts?**: `number`

Maximum validation retry attempts for lint/typecheck/build correction loops. Default: 3

##### outputRoot?

> `optional` **outputRoot?**: `string`

Output root relative to workDir or as absolute path. Default: ".workspace-dev"

##### pipelineDiagnosticDetailsMaxDepth?

> `optional` **pipelineDiagnosticDetailsMaxDepth?**: `number`

Maximum nesting depth retained when sanitizing structured diagnostic details. Default: 4

##### pipelineDiagnosticDetailsMaxItems?

> `optional` **pipelineDiagnosticDetailsMaxItems?**: `number`

Maximum array items retained per structured diagnostic details array. Default: 20

##### pipelineDiagnosticDetailsMaxKeys?

> `optional` **pipelineDiagnosticDetailsMaxKeys?**: `number`

Maximum object keys retained per structured diagnostic details object. Default: 30

##### pipelineDiagnosticMaxCount?

> `optional` **pipelineDiagnosticMaxCount?**: `number`

Maximum structured diagnostics retained per pipeline error. Default: 25

##### pipelineDiagnosticTextMaxLength?

> `optional` **pipelineDiagnosticTextMaxLength?**: `number`

Maximum message/suggestion characters retained per structured diagnostic. Default: 320

##### port?

> `optional` **port?**: `number`

Port to bind to. Default: 1983

##### rateLimitPerMinute?

> `optional` **rateLimitPerMinute?**: `number`

Maximum accepted job submissions and import-session event writes per minute for a single client IP, enforced separately per route family. Use 0 to disable. Default: 10

##### routerMode?

> `optional` **routerMode?**: [`WorkspaceRouterMode`](#workspaceroutermode)

Router mode for generated App.tsx shell. Default: "browser"

##### shutdownTimeoutMs?

> `optional` **shutdownTimeoutMs?**: `number`

Maximum graceful shutdown drain time in milliseconds before remaining connections are terminated. Default: 10000

##### skipInstall?

> `optional` **skipInstall?**: `boolean`

Skip package installation in validate.project; requires existing node_modules. Default: false

##### sparkasseTokensFilePath?

> `optional` **sparkasseTokensFilePath?**: `string`

Optional Sparkasse design-token file used only when `brandTheme="sparkasse"`; when omitted, built-in defaults are used.

##### ~~targetPath?~~

> `optional` **targetPath?**: `string`

###### Deprecated

Reserved for backward compatibility with callers that reuse
submit-time option objects. Isolated child startup ignores this field and
it does not define any server-start target-root behavior.

##### testIntelligence?

> `optional` **testIntelligence?**: `object`

Opt-in startup feature gate for Figma-to-QC test case generation.

Test intelligence is SEPARATE from the Figma-to-code mode lock and is
local-first by design. The feature is reachable only when both this
startup option and the `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1`
environment variable are enabled; otherwise, submitting a
`figma_to_qc_test_cases` job fails closed with a `503 Feature Disabled`
response and performs no side effects.

A future-facing optional subpath export `workspace-dev/test-intelligence`
is planned to expose the full test-intelligence surface without
importing it from the root entry point; that export is not wired in
this wave.

###### allowApiTransfer?

> `optional` **allowApiTransfer?**: `boolean`

Whether the controlled OpenText ALM API transfer pipeline (#1372)
is allowed at runtime. Defaults to `false` (fail-closed). Even
when `true`, every other gate (feature flag, bearer token, dry-run
report, four-eyes, policy) must still pass before any write
leaves the process. Operators may flip this off to halt transfer
without redeploying.

###### allowJiraWrite?

> `optional` **allowJiraWrite?**: `boolean`

Whether the Jira sub-task write pipeline (#1482) is allowed at
runtime. Defaults to `false` (fail-closed). Even when `true`,
every other gate (feature flag, bearer token, parent issue key,
approved cases, policy/visual sidecar clear) must still pass
before any write leaves the process. Operators may flip this off
to halt Jira writes without redeploying.

###### artifactRoot?

> `optional` **artifactRoot?**: `string`

Optional override for the directory under which per-job
test-intelligence artifacts are stored and read by the Inspector
UI. When omitted, defaults to `<outputRoot>/test-intelligence`.
The directory is treated as opaque storage; missing artifacts
surface as empty UI states rather than errors.

###### enabled

> **enabled**: `boolean`

Whether test-intelligence features may be invoked at runtime. Default: false.

###### fourEyesRequiredRiskCategories?

> `optional` **fourEyesRequiredRiskCategories?**: [`TestCaseRiskCategory`](#testcaseriskcategory)[]

Risk categories for which the review gate must enforce four-eyes
approval (#1376). When omitted, defaults to
`DEFAULT_FOUR_EYES_REQUIRED_RISK_CATEGORIES`. Values outside the
`TestCaseRiskCategory` taxonomy are ignored. An empty array
disables risk-driven enforcement (visual-sidecar triggers still
apply unless `fourEyesVisualSidecarTriggerOutcomes` is also
empty).

###### fourEyesVisualSidecarTriggerOutcomes?

> `optional` **fourEyesVisualSidecarTriggerOutcomes?**: (`"schema_invalid"` \| `"ok"` \| `"low_confidence"` \| `"fallback_used"` \| `"possible_pii"` \| `"prompt_injection_like_text"` \| `"conflicts_with_figma_metadata"` \| `"primary_unavailable"`)[]

Visual-sidecar validation outcomes that trigger four-eyes review
for any case whose Figma trace references a screen carrying the
outcome (#1376, 2026-04-24 multimodal addendum). Defaults to
`DEFAULT_FOUR_EYES_VISUAL_SIDECAR_TRIGGERS`.

###### jiraWriteBearerToken?

> `optional` **jiraWriteBearerToken?**: `string`

Bearer token used by the Jira sub-task write pipeline (#1482).
Fail-closed when omitted: every Jira write attempt refuses with
`bearer_token_missing`. The token is supplied to the configured
`JiraWriteClient` and is never persisted into emitted artifacts.

###### multiSourceEnabled?

> `optional` **multiSourceEnabled?**: `boolean`

Whether the Wave 4 multi-source ingestion gate (Issue #1431) is
permitted at runtime. Default: false. Strictly nested inside
[enabled](#testintelligence): even when this flag is true, multi-source
ingestion still fails closed unless `enabled === true` _and_ the
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE` /
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE` environment
gates are both set. Operators may flip this off at startup to
halt multi-source ingestion without redeploying.

###### reviewBearerToken?

> `optional` **reviewBearerToken?**: `string`

Bearer token accepted by the Inspector test-intelligence review-gate
write routes (`POST /workspace/test-intelligence/review/...`). When
omitted or blank, review writes fail closed with `503` until the
operator configures a token. Reads do not require this token. This
legacy token is treated as one authenticated principal; configure
`reviewPrincipals` for true two-distinct-principal four-eyes approval.

###### reviewPrincipals?

> `optional` **reviewPrincipals?**: [`TestIntelligenceReviewPrincipal`](#testintelligencereviewprincipal)[]

Principal-bound review credentials. When configured, approval actor
identity is derived from the matching bearer token rather than from
the request body, preventing forged reviewer identities (#1376).

###### transferBearerToken?

> `optional` **transferBearerToken?**: `string`

Bearer token accepted by the controlled OpenText ALM API transfer
pipeline (#1372) when `allowApiTransfer=true`. When omitted or
blank, every transfer attempt fails closed with
`bearer_token_missing`. The token is matched against the
caller-supplied bearer using a SHA-256 timing-safe compare so
incorrect lengths do not leak via timing. The token is treated as
a single authenticated principal; configure `transferPrincipals`
for multi-principal idempotent transfer audit trails.

###### transferPrincipals?

> `optional` **transferPrincipals?**: [`TestIntelligenceTransferPrincipal`](#testintelligencetransferprincipal)[]

Principal-bound transfer credentials (#1372). When configured,
the principal id of the matching token is recorded in
`transfer-report.json` audit metadata, enabling per-operator
audit lineage on top of the bearer-token check.

##### unitTestIgnoreFailure?

> `optional` **unitTestIgnoreFailure?**: `boolean`

Make generated-project unit test failures non-fatal. When true, test results are recorded but failures do not throw. Default: false

##### visualQualityBrowsers?

> `optional` **visualQualityBrowsers?**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)[]

Browser engines used when capturing generated output for visual quality validation. Default: ["chromium"]

##### visualQualityDeviceScaleFactor?

> `optional` **visualQualityDeviceScaleFactor?**: `number`

Device pixel ratio used when capturing generated output for visual quality validation. Default: 1

##### visualQualityReferenceMode?

> `optional` **visualQualityReferenceMode?**: [`WorkspaceVisualQualityReferenceMode`](#workspacevisualqualityreferencemode)

Reference source for visual quality validation. Default: "figma_api" when enabled

##### visualQualityViewportHeight?

> `optional` **visualQualityViewportHeight?**: `number`

Viewport height used when capturing generated output for visual quality validation. Default: 800

##### visualQualityViewportWidth?

> `optional` **visualQualityViewportWidth?**: `number`

Viewport width used when capturing generated output for visual quality validation. Default: 1280

##### workDir?

> `optional` **workDir?**: `string`

Project-specific working directory. Default: process.cwd()

***

### WorkspaceStatus

Status of a running workspace-dev instance.

#### Properties

##### availablePipelines?

> `optional` **availablePipelines?**: [`WorkspacePipelineDescriptor`](#workspacepipelinedescriptor)[]

##### defaultPipelineId?

> `optional` **defaultPipelineId?**: [`WorkspacePipelineId`](#workspacepipelineid)

##### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

##### host

> **host**: `string`

##### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

##### outputRoot

> **outputRoot**: `string`

##### port

> **port**: `number`

##### previewEnabled

> **previewEnabled**: `boolean`

##### running

> **running**: `boolean`

##### testIntelligenceEnabled?

> `optional` **testIntelligenceEnabled?**: `boolean`

Whether the test-intelligence Inspector surface is reachable. True only
when both `WorkspaceStartOptions.testIntelligence.enabled` and
`FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE=1` are satisfied. The Inspector
UI uses this flag to gate the "Test Intelligence" navigation entry.

##### testIntelligenceJiraGatewayConfigured?

> `optional` **testIntelligenceJiraGatewayConfigured?**: `boolean`

Whether the Inspector can reach a configured Jira REST gateway for
Jira API source ingestion. False means Jira paste remains the available
air-gapped Jira source path.

##### testIntelligenceMultiSourceEnabled?

> `optional` **testIntelligenceMultiSourceEnabled?**: `boolean`

Whether the Wave 4 multi-source ingestion gate (Issue #1431) is
reachable. True only when [testIntelligenceEnabled](#testintelligenceenabled) is true,
`WorkspaceStartOptions.testIntelligence.multiSourceEnabled` is true,
and `FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE=1` is set.
Independent of mode-lock isolation, which is enforced per request.

##### uptimeMs

> **uptimeMs**: `number`

##### url

> **url**: `string`

***

### WorkspaceSubmitAccepted

Submit response for accepted jobs.

#### Extended by

- [`WorkspaceImportSessionReimportAccepted`](#workspaceimportsessionreimportaccepted)

#### Properties

##### acceptedModes

> **acceptedModes**: `object`

###### figmaSourceMode

> **figmaSourceMode**: `"rest"` \| `"hybrid"` \| `"local_json"` \| `"figma_paste"` \| `"figma_plugin"`

###### llmCodegenMode

> **llmCodegenMode**: `"deterministic"`

##### importIntent?

> `optional` **importIntent?**: [`WorkspaceImportIntent`](#workspaceimportintent)

##### jobId

> **jobId**: `string`

##### pasteDeltaSummary?

> `optional` **pasteDeltaSummary?**: [`WorkspacePasteDeltaSummary`](#workspacepastedeltasummary)

Per-paste delta summary computed at submit time for Figma paste imports.
Present only when `figmaSourceMode === "figma_paste" | "figma_plugin"` and diff succeeded.

##### pipelineId

> **pipelineId**: [`WorkspacePipelineId`](#workspacepipelineid)

##### pipelineMetadata

> **pipelineMetadata**: [`WorkspaceJobPipelineMetadata`](#workspacejobpipelinemetadata)

##### status

> **status**: `"queued"`

***

### WorkspaceVersionInfo

Version information for the workspace-dev package.

#### Properties

##### contractVersion

> **contractVersion**: `string`

##### version

> **version**: `string`

***

### WorkspaceVisualAuditInput

Input payload for the optional visual audit flow.

#### Properties

##### baselineImagePath

> **baselineImagePath**: `string`

##### capture?

> `optional` **capture?**: [`WorkspaceVisualCaptureConfig`](#workspacevisualcaptureconfig)

##### diff?

> `optional` **diff?**: [`WorkspaceVisualDiffConfig`](#workspacevisualdiffconfig)

##### regions?

> `optional` **regions?**: [`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion)[]

***

### WorkspaceVisualAuditRegionResult

Region result returned as part of a visual audit.

#### Extends

- [`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion)

#### Properties

##### deviationPercent

> **deviationPercent**: `number`

##### diffPixelCount

> **diffPixelCount**: `number`

##### height

> **height**: `number`

###### Inherited from

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`height`](#height-2)

##### name

> **name**: `string`

###### Inherited from

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`name`](#name-11)

##### totalPixels

> **totalPixels**: `number`

##### width

> **width**: `number`

###### Inherited from

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`width`](#width-2)

##### x

> **x**: `number`

###### Inherited from

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`x`](#x-2)

##### y

> **y**: `number`

###### Inherited from

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`y`](#y-2)

***

### WorkspaceVisualAuditResult

Computed output for the optional visual audit flow.

#### Properties

##### actualImagePath?

> `optional` **actualImagePath?**: `string`

##### baselineImagePath?

> `optional` **baselineImagePath?**: `string`

##### diffImagePath?

> `optional` **diffImagePath?**: `string`

##### diffPixelCount?

> `optional` **diffPixelCount?**: `number`

##### referenceImagePath?

> `optional` **referenceImagePath?**: `string`

##### regions?

> `optional` **regions?**: [`WorkspaceVisualAuditRegionResult`](#workspacevisualauditregionresult)[]

##### reportPath?

> `optional` **reportPath?**: `string`

##### similarityScore?

> `optional` **similarityScore?**: `number`

##### status

> **status**: [`WorkspaceVisualAuditStatus`](#workspacevisualauditstatus)

##### totalPixels?

> `optional` **totalPixels?**: `number`

##### warnings?

> `optional` **warnings?**: `string`[]

***

### WorkspaceVisualCaptureConfig

Configuration for the optional visual audit capture flow.

#### Properties

##### fullPage?

> `optional` **fullPage?**: `boolean`

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

##### viewport?

> `optional` **viewport?**: `object`

###### deviceScaleFactor?

> `optional` **deviceScaleFactor?**: `number`

###### height?

> `optional` **height?**: `number`

###### width?

> `optional` **width?**: `number`

##### waitForAnimations?

> `optional` **waitForAnimations?**: `boolean`

##### waitForFonts?

> `optional` **waitForFonts?**: `boolean`

##### waitForNetworkIdle?

> `optional` **waitForNetworkIdle?**: `boolean`

***

### WorkspaceVisualComparisonMetadata

Metadata about a visual quality comparison run.

#### Properties

##### comparedAt

> **comparedAt**: `string`

##### configuredWeights

> **configuredWeights**: [`WorkspaceVisualScoringWeights`](#workspacevisualscoringweights)

##### diffPixelCount

> **diffPixelCount**: `number`

##### imageHeight

> **imageHeight**: `number`

##### imageWidth

> **imageWidth**: `number`

##### totalPixels

> **totalPixels**: `number`

##### versions

> **versions**: `object`

###### contractVersion

> **contractVersion**: `string`

###### packageVersion

> **packageVersion**: `string`

##### viewport

> **viewport**: `object`

###### deviceScaleFactor

> **deviceScaleFactor**: `number`

###### height

> **height**: `number`

###### width

> **width**: `number`

***

### WorkspaceVisualComponentCoverage

#### Properties

##### bySkipReason

> **bySkipReason**: `Record`\<`string`, `number`\>

##### comparedCount

> **comparedCount**: `number`

##### coveragePercent

> **coveragePercent**: `number`

##### skippedCount

> **skippedCount**: `number`

***

### WorkspaceVisualCrossBrowserConsistency

#### Properties

##### browsers

> **browsers**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)[]

##### consistencyScore

> **consistencyScore**: `number`

##### pairwiseDiffs

> **pairwiseDiffs**: [`WorkspaceVisualCrossBrowserPairwiseDiff`](#workspacevisualcrossbrowserpairwisediff)[]

##### warnings?

> `optional` **warnings?**: `string`[]

***

### WorkspaceVisualCrossBrowserPairwiseDiff

#### Properties

##### browserA

> **browserA**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)

##### browserB

> **browserB**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)

##### diffImagePath?

> `optional` **diffImagePath?**: `string`

##### diffPercent

> **diffPercent**: `number`

***

### WorkspaceVisualDeviationHotspot

Deviation hotspot identified in a visual quality comparison.

#### Properties

##### category

> **category**: `"layout"` \| `"color"` \| `"typography"` \| `"component"` \| `"spacing"`

##### deviationPercent

> **deviationPercent**: `number`

##### height

> **height**: `number`

##### rank

> **rank**: `number`

##### region

> **region**: `string`

##### severity

> **severity**: `"low"` \| `"medium"` \| `"high"` \| `"critical"`

##### width

> **width**: `number`

##### x

> **x**: `number`

##### y

> **y**: `number`

***

### WorkspaceVisualDiffConfig

Configuration for the optional visual audit diff flow.

#### Properties

##### alpha?

> `optional` **alpha?**: `number`

##### includeAntialiasing?

> `optional` **includeAntialiasing?**: `boolean`

##### threshold?

> `optional` **threshold?**: `number`

***

### WorkspaceVisualDiffRegion

Region definition used for visual diff breakdowns.

#### Extended by

- [`WorkspaceVisualAuditRegionResult`](#workspacevisualauditregionresult)

#### Properties

##### height

> **height**: `number`

##### name

> **name**: `string`

##### width

> **width**: `number`

##### x

> **x**: `number`

##### y

> **y**: `number`

***

### WorkspaceVisualDimensionScore

Per-dimension score in a visual quality report.

#### Properties

##### details

> **details**: `string`

##### name

> **name**: `string`

##### score

> **score**: `number`

##### weight

> **weight**: `number`

***

### WorkspaceVisualPerBrowserResult

#### Properties

##### actualImagePath?

> `optional` **actualImagePath?**: `string`

##### browser

> **browser**: [`WorkspaceVisualBrowserName`](#workspacevisualbrowsername)

##### diffImagePath?

> `optional` **diffImagePath?**: `string`

##### overallScore

> **overallScore**: `number`

##### reportPath?

> `optional` **reportPath?**: `string`

##### warnings?

> `optional` **warnings?**: `string`[]

***

### WorkspaceVisualQualityComponentEntry

#### Properties

##### componentId

> **componentId**: `string`

##### componentName

> **componentName**: `string`

##### diffImagePath?

> `optional` **diffImagePath?**: `string`

##### referenceNodeId?

> `optional` **referenceNodeId?**: `string`

##### reportPath?

> `optional` **reportPath?**: `string`

##### score?

> `optional` **score?**: `number`

##### skipReason?

> `optional` **skipReason?**: `string`

##### status

> **status**: `"skipped"` \| `"compared"`

##### storyEntryId?

> `optional` **storyEntryId?**: `string`

##### warnings?

> `optional` **warnings?**: `string`[]

***

### WorkspaceVisualQualityFrozenReference

Explicit frozen visual reference files used by validate.project.

#### Properties

##### imagePath

> **imagePath**: `string`

##### metadataPath

> **metadataPath**: `string`

***

### WorkspaceVisualQualityReport

Full visual quality report produced by the scoring system.

#### Properties

##### browserBreakdown?

> `optional` **browserBreakdown?**: `Partial`\<`Record`\<[`WorkspaceVisualBrowserName`](#workspacevisualbrowsername), `number`\>\>

##### capturedAt?

> `optional` **capturedAt?**: `string`

##### componentAggregateScore?

> `optional` **componentAggregateScore?**: `number`

##### componentCoverage?

> `optional` **componentCoverage?**: [`WorkspaceVisualComponentCoverage`](#workspacevisualcomponentcoverage)

##### components?

> `optional` **components?**: [`WorkspaceVisualQualityComponentEntry`](#workspacevisualqualitycomponententry)[]

##### crossBrowserConsistency?

> `optional` **crossBrowserConsistency?**: [`WorkspaceVisualCrossBrowserConsistency`](#workspacevisualcrossbrowserconsistency)

##### diffImagePath?

> `optional` **diffImagePath?**: `string`

##### dimensions?

> `optional` **dimensions?**: [`WorkspaceVisualDimensionScore`](#workspacevisualdimensionscore)[]

##### hotspots?

> `optional` **hotspots?**: [`WorkspaceVisualDeviationHotspot`](#workspacevisualdeviationhotspot)[]

##### interpretation?

> `optional` **interpretation?**: `string`

##### message?

> `optional` **message?**: `string`

##### metadata?

> `optional` **metadata?**: [`WorkspaceVisualComparisonMetadata`](#workspacevisualcomparisonmetadata)

##### overallScore?

> `optional` **overallScore?**: `number`

##### perBrowser?

> `optional` **perBrowser?**: [`WorkspaceVisualPerBrowserResult`](#workspacevisualperbrowserresult)[]

##### referenceSource?

> `optional` **referenceSource?**: [`WorkspaceVisualQualityReferenceMode`](#workspacevisualqualityreferencemode)

##### status

> **status**: `"completed"` \| `"failed"` \| `"not_requested"`

##### warnings?

> `optional` **warnings?**: `string`[]

***

### WorkspaceVisualReferenceFixtureMetadata

Frozen fixture metadata used for visual quality reference images.

#### Properties

##### capturedAt

> **capturedAt**: `string`

##### source

> **source**: `object`

###### fileKey

> **fileKey**: `string`

###### lastModified

> **lastModified**: `string`

###### nodeId

> **nodeId**: `string`

###### nodeName

> **nodeName**: `string`

##### viewport

> **viewport**: `object`

###### deviceScaleFactor?

> `optional` **deviceScaleFactor?**: `number`

###### height

> **height**: `number`

###### width

> **width**: `number`

***

### WorkspaceVisualScoringWeights

Scoring weights for the visual quality composite score.

#### Properties

##### colorFidelity

> **colorFidelity**: `number`

##### componentStructure

> **componentStructure**: `number`

##### layoutAccuracy

> **layoutAccuracy**: `number`

##### spacingAlignment

> **spacingAlignment**: `number`

##### typography

> **typography**: `number`

## Type Aliases

### BankingInsuranceSemanticKeyword

> **BankingInsuranceSemanticKeyword** = *typeof* [`BANKING_INSURANCE_SEMANTIC_KEYWORDS`](#banking_insurance_semantic_keywords)\[`number`\]

***

### ConflictResolutionPolicy

> **ConflictResolutionPolicy** = *typeof* [`ALLOWED_CONFLICT_RESOLUTION_POLICIES`](#allowed_conflict_resolution_policies)\[`number`\]

Conflict-resolution policy alias.

***

### CoveragePlanTechnique

> **CoveragePlanTechnique** = *typeof* [`ALLOWED_COVERAGE_PLAN_TECHNIQUES`](#allowed_coverage_plan_techniques)\[`number`\]

Discriminated union of deterministic coverage-planning techniques.

***

### CoverageRequirementReasonCode

> **CoverageRequirementReasonCode** = *typeof* [`ALLOWED_COVERAGE_REQUIREMENT_REASON_CODES`](#allowed_coverage_requirement_reason_codes)\[`number`\]

Stable reason-code union for deterministic coverage requirements.

***

### DedupeExternalProbeState

> **DedupeExternalProbeState** = *typeof* [`ALLOWED_DEDUPE_EXTERNAL_PROBE_STATES`](#allowed_dedupe_external_probe_states)\[`number`\]

***

### DedupeSimilaritySource

> **DedupeSimilaritySource** = *typeof* [`ALLOWED_DEDUPE_SIMILARITY_SOURCES`](#allowed_dedupe_similarity_sources)\[`number`\]

***

### DryRunFolderResolutionState

> **DryRunFolderResolutionState** = *typeof* [`ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES`](#allowed_dry_run_folder_resolution_states)\[`number`\]

***

### DryRunRefusalCode

> **DryRunRefusalCode** = *typeof* [`ALLOWED_DRY_RUN_REFUSAL_CODES`](#allowed_dry_run_refusal_codes)\[`number`\]

***

### EvidenceVerifyCheckKind

> **EvidenceVerifyCheckKind** = `"artifact_sha256"` \| `"manifest_metadata"` \| `"manifest_digest_witness"` \| `"visual_sidecar_evidence"` \| `"attestation_envelope"` \| `"attestation_signatures"`

Stable check-kind labels surfaced in the `EvidenceVerifyResponse.checks` array.

***

### EvidenceVerifyFailureCode

> **EvidenceVerifyFailureCode** = `"manifest_unparseable"` \| `"manifest_metadata_invalid"` \| `"manifest_digest_witness_invalid"` \| `"artifact_missing"` \| `"artifact_mutated"` \| `"artifact_resized"` \| `"unexpected_artifact"` \| `"visual_sidecar_evidence_missing"` \| `"envelope_unparseable"` \| `"envelope_payload_type_mismatch"` \| `"envelope_payload_decode_failed"` \| `"statement_unparseable"` \| `"statement_type_mismatch"` \| `"statement_predicate_type_mismatch"` \| `"statement_predicate_invalid"` \| `"subject_missing_artifact"` \| `"subject_digest_mismatch"` \| `"subject_unattested_artifact"` \| `"signing_mode_mismatch"` \| `"signature_required"` \| `"signature_unsigned_envelope_carries_signatures"` \| `"signature_invalid_keyid"` \| `"signature_invalid_encoding"` \| `"signature_unverified"` \| `"bundle_missing"` \| `"bundle_envelope_mismatch"` \| `"bundle_public_key_missing"` \| `"manifest_sha256_mismatch"`

Stable failure-code surface for evidence verification. Re-uses the
existing `Wave1PocAttestationVerificationFailureCode` literals where
applicable so a single auditor can route on a unified vocabulary.

***

### ExportArtifactContentType

> **ExportArtifactContentType** = *typeof* [`ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES`](#allowed_export_artifact_content_types)\[`number`\]

***

### ExportRefusalCode

> **ExportRefusalCode** = *typeof* [`ALLOWED_EXPORT_REFUSAL_CODES`](#allowed_export_refusal_codes)\[`number`\]

***

### FinOpsBudgetBreachReason

> **FinOpsBudgetBreachReason** = *typeof* [`ALLOWED_FINOPS_BUDGET_BREACH_REASONS`](#allowed_finops_budget_breach_reasons)\[`number`\]

Discriminant of a FinOps budget breach reason.

***

### FinOpsJobOutcome

> **FinOpsJobOutcome** = *typeof* [`ALLOWED_FINOPS_JOB_OUTCOMES`](#allowed_finops_job_outcomes)\[`number`\]

Discriminant of the terminal job outcome the FinOps report records.

***

### FinOpsRole

> **FinOpsRole** = *typeof* [`ALLOWED_FINOPS_ROLES`](#allowed_finops_roles)\[`number`\]

Discriminant of an allowed FinOps role.

***

### FourEyesEnforcementReason

> **FourEyesEnforcementReason** = *typeof* [`ALLOWED_FOUR_EYES_ENFORCEMENT_REASONS`](#allowed_four_eyes_enforcement_reasons)\[`number`\]

***

### GeneratedTestCaseReviewState

> **GeneratedTestCaseReviewState** = `"draft"` \| `"auto_approved"` \| `"needs_review"` \| `"rejected"`

Review state at the moment the test case is emitted.

***

### IntentDeltaChangeType

> **IntentDeltaChangeType** = *typeof* [`ALLOWED_INTENT_DELTA_CHANGE_TYPES`](#allowed_intent_delta_change_types)\[`number`\]

***

### IntentDeltaKind

> **IntentDeltaKind** = *typeof* [`ALLOWED_INTENT_DELTA_KINDS`](#allowed_intent_delta_kinds)\[`number`\]

***

### IntentProvenance

> **IntentProvenance** = `"figma_node"` \| `"visual_sidecar"` \| `"reconciled"`

Where a detected element came from during reconciliation.

***

### JiraAdfMarkType

> **JiraAdfMarkType** = *typeof* [`ALLOWED_JIRA_ADF_MARK_TYPES`](#allowed_jira_adf_mark_types)\[`number`\]

Discriminated alias for [ALLOWED\_JIRA\_ADF\_MARK\_TYPES](#allowed_jira_adf_mark_types).

***

### JiraAdfNodeType

> **JiraAdfNodeType** = *typeof* [`ALLOWED_JIRA_ADF_NODE_TYPES`](#allowed_jira_adf_node_types)\[`number`\]

Discriminated alias for [ALLOWED\_JIRA\_ADF\_NODE\_TYPES](#allowed_jira_adf_node_types).

***

### JiraAdfRejectionCode

> **JiraAdfRejectionCode** = *typeof* [`ALLOWED_JIRA_ADF_REJECTION_CODES`](#allowed_jira_adf_rejection_codes)\[`number`\]

Discriminated alias for [ALLOWED\_JIRA\_ADF\_REJECTION\_CODES](#allowed_jira_adf_rejection_codes).

***

### JiraIrRefusalCode

> **JiraIrRefusalCode** = *typeof* [`ALLOWED_JIRA_IR_REFUSAL_CODES`](#allowed_jira_ir_refusal_codes)\[`number`\]

Discriminated alias for [ALLOWED\_JIRA\_IR\_REFUSAL\_CODES](#allowed_jira_ir_refusal_codes).

***

### JiraIssueType

> **JiraIssueType** = *typeof* [`ALLOWED_JIRA_ISSUE_TYPES`](#allowed_jira_issue_types)\[`number`\]

Discriminated alias for [ALLOWED\_JIRA\_ISSUE\_TYPES](#allowed_jira_issue_types).

***

### JiraWriteEntityOutcome

> **JiraWriteEntityOutcome** = *typeof* [`ALLOWED_JIRA_WRITE_ENTITY_OUTCOMES`](#allowed_jira_write_entity_outcomes)\[`number`\]

***

### JiraWriteFailureClass

> **JiraWriteFailureClass** = *typeof* [`ALLOWED_JIRA_WRITE_FAILURE_CLASSES`](#allowed_jira_write_failure_classes)\[`number`\]

***

### JiraWriteMode

> **JiraWriteMode** = *typeof* [`ALLOWED_JIRA_WRITE_MODE_VALUES`](#allowed_jira_write_mode_values)\[`number`\]

***

### JiraWriteRefusalCode

> **JiraWriteRefusalCode** = *typeof* [`ALLOWED_JIRA_WRITE_REFUSAL_CODES`](#allowed_jira_write_refusal_codes)\[`number`\]

***

### LbomDataKind

> **LbomDataKind** = `"few_shot_bundle"` \| `"policy_profile"`

Discriminant of an LBOM data-component kind.

***

### LbomModelRole

> **LbomModelRole** = *typeof* [`ALLOWED_LBOM_MODEL_ROLES`](#allowed_lbom_model_roles)\[`number`\]

Discriminant of an LBOM model role.

***

### LlmCapabilityProbeCapability

> **LlmCapabilityProbeCapability** = keyof [`LlmGatewayCapabilities`](#llmgatewaycapabilities) \| `"textChat"`

Probe rows can cover declared capability flags plus the mandatory text-chat baseline.

***

### LlmCapabilityProbeOutcome

> **LlmCapabilityProbeOutcome** = `"supported"` \| `"unsupported"` \| `"untested"` \| `"probe_failed"`

Per-capability probe verdict carried in the persisted artifact.

***

### LlmFinishReason

> **LlmFinishReason** = `"stop"` \| `"length"` \| `"content_filter"` \| `"tool_calls"` \| `"other"`

Provider finish reasons normalized to a single set.

***

### LlmGatewayAuthMode

> **LlmGatewayAuthMode** = *typeof* [`ALLOWED_LLM_GATEWAY_AUTH_MODES`](#allowed_llm_gateway_auth_modes)\[`number`\]

***

### LlmGatewayCompatibilityMode

> **LlmGatewayCompatibilityMode** = *typeof* [`ALLOWED_LLM_GATEWAY_COMPATIBILITY_MODES`](#allowed_llm_gateway_compatibility_modes)\[`number`\]

***

### LlmGatewayErrorClass

> **LlmGatewayErrorClass** = *typeof* [`ALLOWED_LLM_GATEWAY_ERROR_CLASSES`](#allowed_llm_gateway_error_classes)\[`number`\]

***

### LlmGatewayRole

> **LlmGatewayRole** = *typeof* [`ALLOWED_LLM_GATEWAY_ROLES`](#allowed_llm_gateway_roles)\[`number`\]

***

### LlmGatewayWireStructuredOutputMode

> **LlmGatewayWireStructuredOutputMode** = *typeof* [`ALLOWED_LLM_GATEWAY_WIRE_STRUCTURED_OUTPUT_MODES`](#allowed_llm_gateway_wire_structured_output_modes)\[`number`\]

***

### LlmGenerationResult

> **LlmGenerationResult** = [`LlmGenerationSuccess`](#llmgenerationsuccess) \| [`LlmGenerationFailure`](#llmgenerationfailure)

Discriminated union returned by `LlmGatewayClient.generate`.

***

### LlmReasoningEffort

> **LlmReasoningEffort** = `"low"` \| `"medium"` \| `"high"`

Reasoning-effort hint forwarded only when `reasoningEffortSupport` is true.

***

### MultiSourceConflictKind

> **MultiSourceConflictKind** = `"field_label_mismatch"` \| `"validation_rule_mismatch"` \| `"risk_category_mismatch"` \| `"test_data_example_mismatch"` \| `"duplicate_acceptance_criterion"` \| `"paste_collision"`

Kinds of cross-source disagreement recognized by Issue #1436.

***

### MultiSourceEnvelopeRefusalCode

> **MultiSourceEnvelopeRefusalCode** = *typeof* [`ALLOWED_MULTI_SOURCE_ENVELOPE_REFUSAL_CODES`](#allowed_multi_source_envelope_refusal_codes)\[`number`\]

Refusal code alias for the multi-source envelope validator.

***

### MultiSourceEnvelopeValidationResult

> **MultiSourceEnvelopeValidationResult** = \{ `envelope`: [`MultiSourceTestIntentEnvelope`](#multisourcetestintentenvelope); `ok`: `true`; \} \| \{ `issues`: [`MultiSourceEnvelopeIssue`](#multisourceenvelopeissue)[]; `ok`: `false`; \}

Result of multi-source envelope validation (Issue #1431). Hand-rolled
to keep workspace-dev free of external schema libraries.

***

### MultiSourceModeGateRefusalCode

> **MultiSourceModeGateRefusalCode** = *typeof* [`ALLOWED_MULTI_SOURCE_MODE_GATE_REFUSAL_CODES`](#allowed_multi_source_mode_gate_refusal_codes)\[`number`\]

Refusal-code alias for the multi-source mode gate.

***

### PiiKind

> **PiiKind** = `"iban"` \| `"bic"` \| `"pan"` \| `"tax_id"` \| `"email"` \| `"phone"` \| `"full_name"` \| `"internal_hostname"` \| `"jira_mention"` \| `"customer_name_placeholder"` \| `"postal_address"` \| `"date_of_birth"` \| `"account_number"` \| `"national_id"` \| `"special_category"`

Known PII-like categories detected in mock form data and Jira payloads.

Wave 4.B (Issue #1432) extended this union with three Jira-aware
categories: `internal_hostname` (corporate hostname patterns surfaced
inside ADF text), `jira_mention` (Confluence/Jira `@user` mentions and
raw account ids), and `customer_name_placeholder` (full-name-shaped
values pulled from common Jira customer-facing custom-field names).

Adding new union members is treated as a minor contract bump per
`CONTRACT_CHANGELOG.md`'s versioning rules — consumers reading the IR
may receive previously-unseen `kind` values.

***

### PiiMatchLocation

> **PiiMatchLocation** = `"field_label"` \| `"field_default_value"` \| `"screen_text"` \| `"action_label"` \| `"trace_node_name"` \| `"trace_node_path"` \| `"screen_name"` \| `"screen_path"` \| `"validation_rule"` \| `"navigation_target"` \| `"jira_summary"` \| `"jira_description"` \| `"jira_acceptance_criterion"` \| `"jira_comment_body"` \| `"jira_custom_field_name"` \| `"jira_custom_field_value"` \| `"jira_attachment_filename"` \| `"jira_link_relationship"` \| `"jira_label"` \| `"jira_component"` \| `"custom_context_markdown"` \| `"custom_context_attribute"`

Location within the input that held a PII-like match.

Wave 4.B (Issue #1432) extends this union with Jira-IR-specific
locations so adversarial-fixture and audit code can attribute every
indicator back to the exact field it was sourced from.

***

### PrimaryTestIntentSourceKind

> **PrimaryTestIntentSourceKind** = *typeof* [`PRIMARY_TEST_INTENT_SOURCE_KINDS`](#primary_test_intent_source_kinds)\[`number`\]

Subset alias for primary source kinds.

***

### QcAdapterMode

> **QcAdapterMode** = *typeof* [`ALLOWED_QC_ADAPTER_MODES`](#allowed_qc_adapter_modes)\[`number`\]

***

### QcAdapterProvider

> **QcAdapterProvider** = *typeof* [`ALLOWED_QC_ADAPTER_PROVIDERS`](#allowed_qc_adapter_providers)\[`number`\]

***

### QcMappingProfileIssueCode

> **QcMappingProfileIssueCode** = *typeof* [`ALLOWED_QC_MAPPING_PROFILE_ISSUE_CODES`](#allowed_qc_mapping_profile_issue_codes)\[`number`\]

***

### QcProviderOperation

> **QcProviderOperation** = *typeof* [`ALLOWED_QC_PROVIDER_OPERATIONS`](#allowed_qc_provider_operations)\[`number`\]

***

### RegulatoryRelevanceDomain

> **RegulatoryRelevanceDomain** = *typeof* [`ALLOWED_REGULATORY_RELEVANCE_DOMAINS`](#allowed_regulatory_relevance_domains)\[`number`\]

***

### ReplayCacheLookupResult

> **ReplayCacheLookupResult** = \{ `entry`: [`ReplayCacheEntry`](#replaycacheentry); `hit`: `true`; \} \| \{ `hit`: `false`; `key`: `string`; \}

Cache lookup outcome consumed by the orchestration layer.

***

### ReviewEventKind

> **ReviewEventKind** = *typeof* [`ALLOWED_REVIEW_EVENT_KINDS`](#allowed_review_event_kinds)\[`number`\]

***

### ReviewState

> **ReviewState** = *typeof* [`ALLOWED_REVIEW_STATES`](#allowed_review_states)\[`number`\]

***

### SelfVerifyRubricDimension

> **SelfVerifyRubricDimension** = *typeof* [`ALLOWED_SELF_VERIFY_RUBRIC_DIMENSIONS`](#allowed_self_verify_rubric_dimensions)\[`number`\]

Single rubric scoring dimension.

***

### SelfVerifyRubricRefusalCode

> **SelfVerifyRubricRefusalCode** = *typeof* [`ALLOWED_SELF_VERIFY_RUBRIC_REFUSAL_CODES`](#allowed_self_verify_rubric_refusal_codes)\[`number`\]

Single rubric pass refusal classification.

***

### SelfVerifyRubricReplayCacheLookupResult

> **SelfVerifyRubricReplayCacheLookupResult** = \{ `entry`: [`SelfVerifyRubricReplayCacheEntry`](#selfverifyrubricreplaycacheentry); `hit`: `true`; \} \| \{ `hit`: `false`; `key`: `string`; \}

Cache lookup outcome consumed by the rubric pass orchestration layer.

***

### SelfVerifyRubricVisualSubscoreKind

> **SelfVerifyRubricVisualSubscoreKind** = *typeof* [`ALLOWED_SELF_VERIFY_RUBRIC_VISUAL_SUBSCORES`](#allowed_self_verify_rubric_visual_subscores)\[`number`\]

Single multimodal visual subscore kind.

***

### SourceMixPlannerRefusalCode

> **SourceMixPlannerRefusalCode** = *typeof* [`ALLOWED_SOURCE_MIX_PLANNER_REFUSAL_CODES`](#allowed_source_mix_planner_refusal_codes)\[`number`\]

Refusal code alias for the source-mix planner.

***

### SourceMixPlannerResult

> **SourceMixPlannerResult** = \{ `ok`: `true`; `plan`: [`SourceMixPlan`](#sourcemixplan-1); \} \| \{ `issues`: [`SourceMixPlannerIssue`](#sourcemixplannerissue)[]; `ok`: `false`; \}

Result of source-mix planning (Issue #1441).

***

### SourceMixPlanPromptSection

> **SourceMixPlanPromptSection** = `"figma_intent"` \| `"jira_requirements"` \| `"custom_context"` \| `"custom_context_markdown"` \| `"reconciliation_report"`

Prompt section tag identifying the role of a compiled source segment in the
LLM user prompt. The planner populates [SourceMixPlan.promptSections](#promptsections)
with the ordered list of sections that the prompt compiler must emit.

- `figma_intent` — redacted Figma Business Test Intent IR.
- `jira_requirements` — one or more normalized Jira Issue IRs.
- `custom_context` — structured-attribute and/or plain-text custom context.
- `custom_context_markdown` — Markdown custom context (dedicated kind).
- `reconciliation_report` — cross-source conflict and field-provenance summary.

***

### SupportingTestIntentSourceKind

> **SupportingTestIntentSourceKind** = *typeof* [`SUPPORTING_TEST_INTENT_SOURCE_KINDS`](#supporting_test_intent_source_kinds)\[`number`\]

Subset alias for supporting source kinds.

***

### TestCaseDeltaReason

> **TestCaseDeltaReason** = *typeof* [`ALLOWED_TEST_CASE_DELTA_REASONS`](#allowed_test_case_delta_reasons)\[`number`\]

***

### TestCaseDeltaVerdict

> **TestCaseDeltaVerdict** = *typeof* [`ALLOWED_TEST_CASE_DELTA_VERDICTS`](#allowed_test_case_delta_verdicts)\[`number`\]

***

### TestCaseLevel

> **TestCaseLevel** = `"unit"` \| `"component"` \| `"integration"` \| `"system"` \| `"acceptance"`

Coarse-grain test level.

***

### TestCasePolicyDecision

> **TestCasePolicyDecision** = *typeof* [`ALLOWED_TEST_CASE_POLICY_DECISIONS`](#allowed_test_case_policy_decisions)\[`number`\]

***

### TestCasePolicyOutcome

> **TestCasePolicyOutcome** = *typeof* [`ALLOWED_TEST_CASE_POLICY_OUTCOMES`](#allowed_test_case_policy_outcomes)\[`number`\]

***

### TestCasePriority

> **TestCasePriority** = `"p0"` \| `"p1"` \| `"p2"` \| `"p3"`

Priority band attached to a generated test case.

***

### TestCaseRiskCategory

> **TestCaseRiskCategory** = `"low"` \| `"medium"` \| `"high"` \| `"regulated_data"` \| `"financial_transaction"`

Risk band attached to a generated test case.

***

### TestCaseTechnique29119

> **TestCaseTechnique29119** = `"equivalence_partitioning"` \| `"boundary_value_analysis"` \| `"decision_table"` \| `"state_transition"` \| `"use_case"` \| `"exploratory"` \| `"error_guessing"` \| `"syntax_testing"` \| `"classification_tree"`

ISO/IEC/IEEE 29119-4 technique tags supported by the generator.

***

### TestCaseType

> **TestCaseType** = `"functional"` \| `"negative"` \| `"boundary"` \| `"validation"` \| `"navigation"` \| `"regression"` \| `"exploratory"` \| `"accessibility"`

Coarse-grain test type.

***

### TestCaseValidationIssueCode

> **TestCaseValidationIssueCode** = *typeof* [`ALLOWED_TEST_CASE_VALIDATION_ISSUE_CODES`](#allowed_test_case_validation_issue_codes)\[`number`\]

***

### TestCaseValidationSeverity

> **TestCaseValidationSeverity** = `"error"` \| `"warning"`

Severity surfaced for a single validation issue.

***

### TestIntentCustomInputFormat

> **TestIntentCustomInputFormat** = *typeof* [`ALLOWED_TEST_INTENT_CUSTOM_INPUT_FORMATS`](#allowed_test_intent_custom_input_formats)\[`number`\]

Custom input-format alias.

***

### TestIntentSourceKind

> **TestIntentSourceKind** = *typeof* [`ALLOWED_TEST_INTENT_SOURCE_KINDS`](#allowed_test_intent_source_kinds)\[`number`\]

Discriminated source-kind alias derived from [ALLOWED\_TEST\_INTENT\_SOURCE\_KINDS](#allowed_test_intent_source_kinds).

***

### TestIntentSourceMixKind

> **TestIntentSourceMixKind** = *typeof* [`ALLOWED_TEST_INTENT_SOURCE_MIX_KINDS`](#allowed_test_intent_source_mix_kinds)\[`number`\]

Discriminated union of all supported source-mix kinds (Issue #1441).

***

### TransferEntityOutcome

> **TransferEntityOutcome** = *typeof* [`ALLOWED_TRANSFER_ENTITY_OUTCOMES`](#allowed_transfer_entity_outcomes)\[`number`\]

***

### TransferFailureClass

> **TransferFailureClass** = *typeof* [`ALLOWED_TRANSFER_FAILURE_CLASSES`](#allowed_transfer_failure_classes)\[`number`\]

***

### TransferRefusalCode

> **TransferRefusalCode** = *typeof* [`ALLOWED_TRANSFER_REFUSAL_CODES`](#allowed_transfer_refusal_codes)\[`number`\]

***

### VisualSidecarFailureClass

> **VisualSidecarFailureClass** = *typeof* [`ALLOWED_VISUAL_SIDECAR_FAILURE_CLASSES`](#allowed_visual_sidecar_failure_classes)\[`number`\]

Discriminant of a `VisualSidecarFailure`.

***

### VisualSidecarFallbackReason

> **VisualSidecarFallbackReason** = `"primary_unavailable"` \| `"primary_quota_exceeded"` \| `"primary_disabled"` \| `"policy_downgrade"` \| `"none"`

Reason a fallback visual sidecar deployment was selected, if any.

***

### VisualSidecarInputMimeType

> **VisualSidecarInputMimeType** = *typeof* [`ALLOWED_VISUAL_SIDECAR_INPUT_MIME_TYPES`](#allowed_visual_sidecar_input_mime_types)\[`number`\]

Discriminant of an allowed visual sidecar input MIME type.

***

### VisualSidecarResult

> **VisualSidecarResult** = [`VisualSidecarSuccess`](#visualsidecarsuccess) \| [`VisualSidecarFailure`](#visualsidecarfailure)

Discriminated union returned by `describeVisualScreens`.

***

### VisualSidecarValidationOutcome

> **VisualSidecarValidationOutcome** = *typeof* [`ALLOWED_VISUAL_SIDECAR_VALIDATION_OUTCOMES`](#allowed_visual_sidecar_validation_outcomes)\[`number`\]

***

### Wave1PocAttestationSigningMode

> **Wave1PocAttestationSigningMode** = *typeof* [`ALLOWED_WAVE1_POC_ATTESTATION_SIGNING_MODES`](#allowed_wave1_poc_attestation_signing_modes)\[`number`\]

Discriminant of the active signing mode.

***

### Wave1PocAttestationVerificationMaterial

> **Wave1PocAttestationVerificationMaterial** = \{ `publicKey`: [`Wave1PocAttestationPublicKeyMaterial`](#wave1pocattestationpublickeymaterial); \} \| \{ `x509CertificateChain`: [`Wave1PocAttestationCertificateChainMaterial`](#wave1pocattestationcertificatechainmaterial); \}

Sigstore bundle verification material. Discriminated by which form
the operator wires: `publicKey` for key-bound signing (the repo's
default), `x509CertificateChain` for keyless signing (operator-
supplied integration with Fulcio + Rekor).

***

### Wave1PocEvidenceArtifactCategory

> **Wave1PocEvidenceArtifactCategory** = `"intent"` \| `"validation"` \| `"review"` \| `"export"` \| `"manifest"` \| `"visual_sidecar"` \| `"finops"` \| `"attestation"` \| `"signature"` \| `"lbom"` \| `"self_verify_rubric"` \| `"intent_delta"` \| `"dedupe_report"` \| `"traceability_matrix"` \| `"multi_source_reconciliation"` \| `"source_ir"` \| `"source_provenance"` \| `"multi_source_conflicts"` \| `"production_readiness_eval"`

Categorisation of an artifact attested by the evidence manifest.

***

### Wave1PocFixtureId

> **Wave1PocFixtureId** = *typeof* [`WAVE1_POC_FIXTURE_IDS`](#wave1_poc_fixture_ids)\[`number`\]

Identifier of a Wave 1 POC fixture.

***

### Wave4SourceMixId

> **Wave4SourceMixId** = `"figma_only"` \| `"jira_rest_only"` \| `"jira_paste_only"` \| `"figma_plus_jira_rest"` \| `"figma_plus_jira_paste"` \| `"jira_rest_plus_custom"` \| `"figma_plus_jira_plus_custom"` \| `"all_sources_with_conflict"` \| `"custom_markdown_only"` \| `"figma_plus_jira_plus_custom_markdown"` \| `"custom_markdown_adversarial"`

Source-mix identifier. Each distinct combination of source kinds is one mix.

***

### WorkspaceBrandTheme

> **WorkspaceBrandTheme** = `"derived"` \| `"sparkasse"`

Theme brand policy applied during IR token derivation.

***

### WorkspaceComponentMappingSource

> **WorkspaceComponentMappingSource** = `"local_override"` \| `"code_connect_import"`

Source that produced a manual or imported component mapping rule.

***

### WorkspaceCompositeQualityDimension

> **WorkspaceCompositeQualityDimension** = `"visual"` \| `"performance"`

Dimensions that may contribute to the combined visual/performance quality score.

***

### WorkspaceCompositeQualityLighthouseProfile

> **WorkspaceCompositeQualityLighthouseProfile** = `"mobile"` \| `"desktop"`

Supported Lighthouse profiles in the combined visual/performance quality report.

***

### WorkspaceConfidenceLevel

> **WorkspaceConfidenceLevel** = `"high"` \| `"medium"` \| `"low"` \| `"very_low"`

Confidence level for a generated job, screen, or component.

***

### WorkspaceFigmaSourceMode

> **WorkspaceFigmaSourceMode** = *typeof* [`ALLOWED_FIGMA_SOURCE_MODES`](#allowed_figma_source_modes)\[`number`\]

Allowed Figma source modes for workspace-dev.

***

### WorkspaceFormHandlingMode

> **WorkspaceFormHandlingMode** = `"react_hook_form"` \| `"legacy_use_state"`

Form handling mode for generated interactive forms.

***

### WorkspaceImportIntent

> **WorkspaceImportIntent** = `"FIGMA_JSON_NODE_BATCH"` \| `"FIGMA_JSON_DOC"` \| `"FIGMA_PLUGIN_ENVELOPE"` \| `"RAW_CODE_OR_TEXT"` \| `"UNKNOWN"`

Import intent detected by the client-side paste classifier.

***

### WorkspaceImportMode

> **WorkspaceImportMode** = `"full"` \| `"delta"` \| `"auto"`

Import mode for a Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold.

***

### WorkspaceImportSessionEventKind

> **WorkspaceImportSessionEventKind** = `"imported"` \| `"review_started"` \| `"approved"` \| `"applied"` \| `"rejected"` \| `"apply_blocked"` \| `"note"`

***

### WorkspaceImportSessionScope

> **WorkspaceImportSessionScope** = `"all"` \| `"partial"`

***

### WorkspaceImportSessionSourceMode

> **WorkspaceImportSessionSourceMode** = [`WorkspaceFigmaSourceMode`](#workspacefigmasourcemode) \| `"figma_url"`

Source modes used to record replayable import sessions.

***

### WorkspaceImportSessionStatus

> **WorkspaceImportSessionStatus** = `"imported"` \| `"reviewing"` \| `"approved"` \| `"applied"` \| `"rejected"`

***

### WorkspaceJobDiagnosticSeverity

> **WorkspaceJobDiagnosticSeverity** = `"error"` \| `"warning"` \| `"info"`

Severity levels emitted for structured job diagnostics.

***

### WorkspaceJobDiagnosticValue

> **WorkspaceJobDiagnosticValue** = `string` \| `number` \| `boolean` \| `null` \| [`WorkspaceJobDiagnosticValue`](#workspacejobdiagnosticvalue)[] \| \{\[`key`: `string`\]: [`WorkspaceJobDiagnosticValue`](#workspacejobdiagnosticvalue); \}

JSON-safe diagnostic payload values attached to structured job diagnostics.

***

### WorkspaceJobFallbackMode

> **WorkspaceJobFallbackMode** = `"none"` \| `"rest"` \| `"hybrid_rest"`

Backend fallback mode surfaced to the inspector.

***

### WorkspaceJobOutcome

> **WorkspaceJobOutcome** = `"success"` \| `"partial"` \| `"failed"`

Inspector-facing terminal outcome for a job.

***

### WorkspaceJobRetryStage

> **WorkspaceJobRetryStage** = `"figma.source"` \| `"ir.derive"` \| `"template.prepare"` \| `"codegen.generate"`

Retryable stage boundaries supported by persisted-artifact retry jobs.

***

### WorkspaceJobRuntimeStatus

> **WorkspaceJobRuntimeStatus** = `"queued"` \| `"running"` \| `"partial"` \| `"completed"` \| `"failed"` \| `"canceled"`

Runtime status values for asynchronous workspace jobs.

***

### WorkspaceJobStageName

> **WorkspaceJobStageName** = `"figma.source"` \| `"ir.derive"` \| `"template.prepare"` \| `"codegen.generate"` \| `"validate.project"` \| `"repro.export"` \| `"git.pr"`

Structured stage names exposed by workspace-dev.

***

### WorkspaceJobStageStatus

> **WorkspaceJobStageStatus** = `"queued"` \| `"running"` \| `"completed"` \| `"failed"` \| `"skipped"`

Stage status values for each pipeline stage.

***

### WorkspaceJobType

> **WorkspaceJobType** = *typeof* [`ALLOWED_WORKSPACE_JOB_TYPES`](#allowed_workspace_job_types)\[`number`\]

Allowed job types for workspace-dev submissions.

***

### WorkspaceLlmCodegenMode

> **WorkspaceLlmCodegenMode** = *typeof* [`ALLOWED_LLM_CODEGEN_MODES`](#allowed_llm_codegen_modes)\[`number`\]

Allowed codegen modes for workspace-dev.

***

### WorkspaceLocalSyncFileAction

> **WorkspaceLocalSyncFileAction** = `"create"` \| `"overwrite"` \| `"none"`

File action the sync planner intends to perform for a path.

***

### WorkspaceLocalSyncFileDecision

> **WorkspaceLocalSyncFileDecision** = `"write"` \| `"skip"`

User decision applied to a single file in local sync preview/apply flows.

***

### WorkspaceLocalSyncFileReason

> **WorkspaceLocalSyncFileReason** = `"new_file"` \| `"managed_destination_unchanged"` \| `"destination_modified_since_sync"` \| `"destination_deleted_since_sync"` \| `"existing_without_baseline"` \| `"already_matches_generated"`

Reason explaining why a file received its planned sync status.

***

### WorkspaceLocalSyncFileStatus

> **WorkspaceLocalSyncFileStatus** = `"create"` \| `"overwrite"` \| `"conflict"` \| `"untracked"` \| `"unchanged"`

File status reported by the sync planner after comparing generated, baseline, and destination states.

***

### WorkspaceLocalSyncMode

> **WorkspaceLocalSyncMode** = `"dry_run"` \| `"apply"`

Supported local sync execution modes.

***

### WorkspaceLocalSyncRequest

> **WorkspaceLocalSyncRequest** = [`WorkspaceLocalSyncDryRunRequest`](#workspacelocalsyncdryrunrequest) \| [`WorkspaceLocalSyncApplyRequest`](#workspacelocalsyncapplyrequest)

Union of supported local sync request payloads.

***

### WorkspaceLogFormat

> **WorkspaceLogFormat** = `"text"` \| `"json"`

Output format for operational runtime logs.

***

### WorkspacePasteDeltaStrategy

> **WorkspacePasteDeltaStrategy** = `"baseline_created"` \| `"no_changes"` \| `"delta"` \| `"structural_break"`

Structural classification of a per-paste delta diff.

***

### WorkspacePipelineId

> **WorkspacePipelineId** = `"default"` \| `"rocket"` \| `string` & `object`

Stable pipeline identifiers understood by workspace-dev.

***

### WorkspacePipelineQualityValidationStatus

> **WorkspacePipelineQualityValidationStatus** = `"not_run"` \| `"passed"` \| `"warning"` \| `"failed"`

Validation status vocabulary used by persisted quality-passport evidence.

***

### WorkspacePipelineQualityWarningSeverity

> **WorkspacePipelineQualityWarningSeverity** = `"info"` \| `"warning"` \| `"error"`

Severity levels used by deterministic quality-passport warnings.

***

### WorkspacePipelineRequestErrorCode

> **WorkspacePipelineRequestErrorCode** = *typeof* [`ALLOWED_PIPELINE_REQUEST_ERROR_CODES`](#allowed_pipeline_request_error_codes)\[`number`\]

Request-time pipeline selection error code.

***

### WorkspacePipelineScope

> **WorkspacePipelineScope** = `"board"` \| `"node"` \| `"selection"`

Input scope resolved before pipeline selection.

***

### WorkspacePipelineVisibility

> **WorkspacePipelineVisibility** = `"oss"` \| `"customer"` \| `"internal"`

Visibility class for a pipeline included in the current package profile.

***

### WorkspaceRemapConfidence

> **WorkspaceRemapConfidence** = `"high"` \| `"medium"` \| `"low"`

Confidence level for a remap suggestion.

***

### WorkspaceRemapRule

> **WorkspaceRemapRule** = `"exact-id"` \| `"name-and-type"` \| `"name-fuzzy-and-type"` \| `"ancestry-and-type"`

Rule that produced a remap suggestion.

***

### WorkspaceRouterMode

> **WorkspaceRouterMode** = `"browser"` \| `"hash"`

Router mode for generated React application shells.

***

### WorkspaceStaleDraftDecision

> **WorkspaceStaleDraftDecision** = `"continue"` \| `"discard"` \| `"carry-forward"`

User decision for handling a stale draft.

***

### WorkspaceStaleDraftDecisionExtended

> **WorkspaceStaleDraftDecisionExtended** = [`WorkspaceStaleDraftDecision`](#workspacestaledraftdecision) \| `"remap"`

User decision for handling a stale draft — extended with remap option.

***

### WorkspaceTestIntelligenceMode

> **WorkspaceTestIntelligenceMode** = *typeof* [`ALLOWED_TEST_INTELLIGENCE_MODES`](#allowed_test_intelligence_modes)\[`number`\]

Allowed test-intelligence modes.

***

### WorkspaceVisualAuditStatus

> **WorkspaceVisualAuditStatus** = `"not_requested"` \| `"ok"` \| `"warn"` \| `"failed"`

Runtime status for the optional visual audit flow.

***

### WorkspaceVisualBrowserName

> **WorkspaceVisualBrowserName** = `"chromium"` \| `"firefox"` \| `"webkit"`

Supported browser engines for visual quality capture.

***

### WorkspaceVisualQualityReferenceMode

> **WorkspaceVisualQualityReferenceMode** = `"figma_api"` \| `"frozen_fixture"`

Supported visual quality reference sources.

## Variables

### ALLOWED\_CONFLICT\_RESOLUTION\_POLICIES

> `const` **ALLOWED\_CONFLICT\_RESOLUTION\_POLICIES**: readonly \[`"priority"`, `"reviewer_decides"`, `"keep_both"`\]

Conflict-resolution policy discriminant carried on every envelope.

- `priority` — apply [MultiSourceTestIntentEnvelope.priorityOrder](#priorityorder)
  when sources disagree on a field. The aggregate hash MUST encode the
  priority order so swapping it forces a cache miss.
- `reviewer_decides` — surface conflicts to the reviewer and keep both
  variants until the reviewer chooses one.
- `keep_both` — emit independent test cases per source without merging.

***

### ALLOWED\_COVERAGE\_PLAN\_TECHNIQUES

> `const` **ALLOWED\_COVERAGE\_PLAN\_TECHNIQUES**: readonly \[`"initial_state"`, `"equivalence_partitioning"`, `"boundary_value"`, `"decision_table"`, `"state_transition"`, `"pairwise"`, `"error_guessing"`\]

Technique identifiers selected by the deterministic coverage planner.

These are plan-level test-design techniques, not the same enum as
`GeneratedTestCase.technique`.

***

### ALLOWED\_COVERAGE\_REQUIREMENT\_REASON\_CODES

> `const` **ALLOWED\_COVERAGE\_REQUIREMENT\_REASON\_CODES**: readonly \[`"screen_baseline"`, `"element_partition"`, `"rule_partition"`, `"rule_boundary"`, `"rule_decision"`, `"action_transition"`, `"calculation_rule"`, `"screen_pairwise"`, `"risk_regression"`, `"open_question_probe"`, `"source_reconciliation_probe"`, `"supporting_context_probe"`\]

Stable reason codes explaining why a coverage requirement exists.
These allow downstream generation and auditing to distinguish requirements
without parsing human-readable labels.

***

### ALLOWED\_DEDUPE\_EXTERNAL\_PROBE\_STATES

> `const` **ALLOWED\_DEDUPE\_EXTERNAL\_PROBE\_STATES**: readonly \[`"disabled"`, `"unconfigured"`, `"partial_failure"`, `"executed"`\]

Allowed informational outcomes of an external dedup probe.

- `disabled` — caller did not configure an `externalProbe`.
- `unconfigured` — probe was supplied but reported its own
  `unconfigured` verdict (e.g. air-gapped client). Fail-closed.
- `partial_failure` — at least one external lookup succeeded, but
  one or more cases could not be checked. Fail-closed.
- `executed` — probe ran and returned per-case verdicts.

***

### ALLOWED\_DEDUPE\_SIMILARITY\_SOURCES

> `const` **ALLOWED\_DEDUPE\_SIMILARITY\_SOURCES**: readonly \[`"lexical"`, `"embedding"`, `"external_lookup"`\]

Allowed similarity sources for a duplicate finding inside the
dedupe report.

- `lexical` — Jaccard over the existing lexical fingerprint
  (`buildTestCaseFingerprint`). Always available.
- `embedding` — cosine similarity over a caller-supplied
  embedding vector. Only fires when an `EmbeddingProvider` is
  injected.
- `external_lookup` — duplicate of an existing entity in an
  external QC folder, surfaced via an injected probe. Only
  fires when the optional probe is configured.

***

### ALLOWED\_DRY\_RUN\_FOLDER\_RESOLUTION\_STATES

> `const` **ALLOWED\_DRY\_RUN\_FOLDER\_RESOLUTION\_STATES**: readonly \[`"resolved"`, `"missing"`, `"simulated"`, `"invalid_path"`\]

Allowed states of a target-folder resolution attempt under `dry_run`.

***

### ALLOWED\_DRY\_RUN\_REFUSAL\_CODES

> `const` **ALLOWED\_DRY\_RUN\_REFUSAL\_CODES**: readonly \[`"no_mapped_test_cases"`, `"mapping_profile_invalid"`, `"provider_mismatch"`, `"mode_not_implemented"`, `"folder_resolution_failed"`, `"provider_not_implemented"`\]

Allowed reasons the QC adapter may refuse to produce a dry-run report.

`provider_not_implemented` (Issue #1374) is appended at the end so the
ordinal positions of prior codes stay byte-stable for callers that pin
to a known index. The code is emitted by the dry-run-only stub adapter
for non-ALM providers that have no real implementation yet.

***

### ALLOWED\_EXPORT\_ARTIFACT\_CONTENT\_TYPES

> `const` **ALLOWED\_EXPORT\_ARTIFACT\_CONTENT\_TYPES**: readonly \[`"application/json"`, `"text/csv"`, `"application/xml"`, `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`\]

Allowed content types declared on an exported artifact record.

***

### ALLOWED\_EXPORT\_REFUSAL\_CODES

> `const` **ALLOWED\_EXPORT\_REFUSAL\_CODES**: readonly \[`"no_approved_test_cases"`, `"unapproved_test_cases_present"`, `"policy_blocked_cases_present"`, `"schema_invalid_cases_present"`, `"visual_sidecar_blocked"`, `"review_state_inconsistent"`\]

Allowed reasons the export pipeline may refuse to emit QC artifacts.

***

### ALLOWED\_FIGMA\_SOURCE\_MODES

> `const` **ALLOWED\_FIGMA\_SOURCE\_MODES**: readonly \[`"rest"`, `"hybrid"`, `"local_json"`, `"figma_paste"`, `"figma_plugin"`\]

Runtime source-of-truth list of allowed Figma source modes.
Keep this array and `WorkspaceFigmaSourceMode` in lockstep;
`submit-mode-parity.test.ts` enforces that compile-time and
runtime agree.

***

### ALLOWED\_FINOPS\_BUDGET\_BREACH\_REASONS

> `const` **ALLOWED\_FINOPS\_BUDGET\_BREACH\_REASONS**: readonly \[`"max_input_tokens"`, `"max_output_tokens"`, `"max_wall_clock_ms"`, `"max_retries"`, `"max_attempts"`, `"max_image_bytes"`, `"max_total_input_tokens"`, `"max_total_output_tokens"`, `"max_total_wall_clock_ms"`, `"max_replay_cache_miss_rate"`, `"max_fallback_attempts"`, `"max_live_smoke_calls"`, `"max_estimated_cost"`, `"jira_api_quota_exceeded"`, `"jira_paste_quota_exceeded"`, `"custom_context_quota_exceeded"`\]

Allowed budget breach reasons. Discriminated for policy-readable diagnostics.

***

### ALLOWED\_FINOPS\_JOB\_OUTCOMES

> `const` **ALLOWED\_FINOPS\_JOB\_OUTCOMES**: readonly \[`"completed"`, `"completed_cache_hit"`, `"budget_exceeded"`, `"policy_blocked"`, `"validation_blocked"`, `"visual_sidecar_failed"`, `"export_refused"`, `"gateway_failed"`\]

Allowed terminal outcomes for a FinOps-tracked job.

***

### ALLOWED\_FINOPS\_ROLES

> `const` **ALLOWED\_FINOPS\_ROLES**: readonly \[`"test_generation"`, `"visual_primary"`, `"visual_fallback"`, `"jira_api_requests"`, `"jira_paste_ingest"`, `"custom_context_ingest"`\]

Per-role discriminant used inside the FinOps surface. Mirrors the gateway
roles but is exported as its own list so policy gates can iterate roles
without depending on the gateway surface.

***

### ALLOWED\_FOUR\_EYES\_ENFORCEMENT\_REASONS

> `const` **ALLOWED\_FOUR\_EYES\_ENFORCEMENT\_REASONS**: readonly \[`"risk_category"`, `"visual_low_confidence"`, `"visual_fallback_used"`, `"visual_possible_pii"`, `"visual_prompt_injection"`, `"visual_metadata_conflict"`, `"multi_source_conflict_present"`\]

Reasons four-eyes review is enforced for a single test case (#1376).

Multiple reasons may apply (e.g. a `regulated_data` case whose visual
sidecar reported low confidence). Reasons are reported deterministic-
sorted on the `ReviewSnapshot.fourEyesReasons` field.

***

### ALLOWED\_INTENT\_DELTA\_CHANGE\_TYPES

> `const` **ALLOWED\_INTENT\_DELTA\_CHANGE\_TYPES**: readonly \[`"added"`, `"removed"`, `"changed"`, `"confidence_dropped"`, `"ambiguity_increased"`\]

Allowed change types on a single delta entry.

- `added` — present in current, absent in prior.
- `removed` — present in prior, absent in current.
- `changed` — present in both, but the canonical-hash differs.
- `confidence_dropped` — visual confidence (mean) fell more than
  the configured drift threshold.
- `ambiguity_increased` — visual ambiguity / open-question count
  grew between revisions.

***

### ALLOWED\_INTENT\_DELTA\_KINDS

> `const` **ALLOWED\_INTENT\_DELTA\_KINDS**: readonly \[`"screen"`, `"field"`, `"action"`, `"validation"`, `"navigation"`, `"visual_screen"`\]

Allowed kinds of delta entries inside the intent-delta report.
Sorted, additive — additional kinds may be appended in future
minors.

***

### ALLOWED\_JIRA\_ADF\_MARK\_TYPES

> `const` **ALLOWED\_JIRA\_ADF\_MARK\_TYPES**: readonly \[`"strong"`, `"em"`, `"code"`, `"strike"`, `"underline"`, `"link"`, `"subsup"`, `"textColor"`\]

Allow-listed Atlassian Document Format `mark.type` discriminants. Marks
carry inline annotation (e.g. `strong`, `link`) on `text` nodes. Marks
outside this set are rejected with `jira_adf_unknown_mark_type`.

***

### ALLOWED\_JIRA\_ADF\_NODE\_TYPES

> `const` **ALLOWED\_JIRA\_ADF\_NODE\_TYPES**: readonly \[`"doc"`, `"paragraph"`, `"heading"`, `"blockquote"`, `"bulletList"`, `"orderedList"`, `"listItem"`, `"codeBlock"`, `"rule"`, `"panel"`, `"table"`, `"tableRow"`, `"tableHeader"`, `"tableCell"`, `"mediaSingle"`, `"mediaGroup"`, `"media"`, `"text"`, `"hardBreak"`, `"mention"`, `"emoji"`, `"inlineCard"`, `"status"`, `"date"`\]

Allow-listed Atlassian Document Format node `type` discriminants. The
parser fails closed on any node whose `type` is not in this set
(`jira_adf_unknown_node_type`).

***

### ALLOWED\_JIRA\_ADF\_REJECTION\_CODES

> `const` **ALLOWED\_JIRA\_ADF\_REJECTION\_CODES**: readonly \[`"jira_adf_payload_too_large"`, `"jira_adf_input_not_string"`, `"jira_adf_input_not_json"`, `"jira_adf_root_not_object"`, `"jira_adf_root_type_invalid"`, `"jira_adf_unknown_node_type"`, `"jira_adf_unknown_mark_type"`, `"jira_adf_node_shape_invalid"`, `"jira_adf_text_node_invalid"`, `"jira_adf_max_depth_exceeded"`, `"jira_adf_max_node_count_exceeded"`\]

Refusal codes emitted by the ADF parser (`parseJiraAdfDocument`). The
parser never throws — it returns a discriminated union and these codes
are stable, locale-independent strings safe to ship to automation.

***

### ALLOWED\_JIRA\_IR\_REFUSAL\_CODES

> `const` **ALLOWED\_JIRA\_IR\_REFUSAL\_CODES**: readonly \[`"jira_issue_key_invalid"`, `"jira_issue_key_too_long"`, `"jira_issue_type_invalid"`, `"jira_summary_invalid"`, `"jira_description_invalid"`, `"jira_acceptance_criterion_invalid"`, `"jira_comment_invalid"`, `"jira_attachment_invalid"`, `"jira_link_invalid"`, `"jira_custom_field_invalid"`, `"jira_custom_field_id_invalid"`, `"jira_status_invalid"`, `"jira_priority_invalid"`, `"jira_field_selection_profile_invalid"`, `"jira_captured_at_invalid"`, `"jira_field_unknown_excluded"`, `"jira_jql_fragment_disallowed_token"`, `"jira_jql_fragment_control_character"`, `"jira_jql_fragment_too_long"`\]

Refusal codes emitted by the Jira IR builder (`buildJiraIssueIr`) and
by the Jira-issue-key / JQL-fragment validators. Stable and
locale-independent.

***

### ALLOWED\_JIRA\_ISSUE\_TYPES

> `const` **ALLOWED\_JIRA\_ISSUE\_TYPES**: readonly \[`"story"`, `"task"`, `"bug"`, `"epic"`, `"subtask"`, `"other"`\]

Allow-listed Jira issue type discriminants. Anything outside this set
collapses to `"other"` so the IR cannot be tricked into smuggling a
free-form issue-type string into the prompt or downstream prompts.

***

### ALLOWED\_JIRA\_WRITE\_ENTITY\_OUTCOMES

> `const` **ALLOWED\_JIRA\_WRITE\_ENTITY\_OUTCOMES**: readonly \[`"created"`, `"skipped_duplicate"`, `"failed"`, `"dry_run"`\]

Per-case outcome of a Jira sub-task write attempt.

- `created` — sub-task did not exist; Jira create call succeeded.
- `skipped_duplicate` — sub-task already exists for this `externalId`
  on the parent; no write performed.
- `failed` — adapter or transport error; pipeline continued with
  subsequent cases (per-case failure isolation).
- `dry_run` — pipeline was invoked with `dryRun=true`; no Jira call
  was attempted.

***

### ALLOWED\_JIRA\_WRITE\_FAILURE\_CLASSES

> `const` **ALLOWED\_JIRA\_WRITE\_FAILURE\_CLASSES**: readonly \[`"transport_error"`, `"auth_failed"`, `"permission_denied"`, `"validation_rejected"`, `"rate_limited"`, `"server_error"`, `"provider_not_implemented"`, `"unknown"`\]

Allowed failure classes for a per-case Jira write failure. Mirrors the
Jira gateway taxonomy so transport faults stay distinguishable from
server-side validation faults.

***

### ALLOWED\_JIRA\_WRITE\_MODE\_VALUES

> `const` **ALLOWED\_JIRA\_WRITE\_MODE\_VALUES**: readonly \[`"jira_subtasks"`\]

Allowed Jira write modes. Only `jira_subtasks` is shipped in Wave 5;
the array is the source of truth so future modes plug in without
changing call sites.

***

### ALLOWED\_JIRA\_WRITE\_REFUSAL\_CODES

> `const` **ALLOWED\_JIRA\_WRITE\_REFUSAL\_CODES**: readonly \[`"feature_gate_disabled"`, `"admin_gate_disabled"`, `"bearer_token_missing"`, `"invalid_parent_issue_key"`, `"no_approved_test_cases"`, `"policy_blocked_cases_present"`, `"schema_invalid_cases_present"`, `"visual_sidecar_blocked"`\]

Allowed reasons the Jira write pipeline may refuse to perform any
sub-task creation. Evaluated in fail-closed order; every fired refusal
is recorded so operators can address them all in one cycle.

***

### ALLOWED\_LBOM\_MODEL\_ROLES

> `const` **ALLOWED\_LBOM\_MODEL\_ROLES**: readonly \[`"test_generation"`, `"visual_primary"`, `"visual_fallback"`\]

Allowed roles for an LBOM machine-learning-model component. Mirrors the
gateway role surface so a single artifact can describe the entire model
chain that produced a job's test cases.

***

### ALLOWED\_LLM\_CODEGEN\_MODES

> `const` **ALLOWED\_LLM\_CODEGEN\_MODES**: readonly \[`"deterministic"`\]

Runtime source-of-truth list of allowed codegen modes.
Keep this array and `WorkspaceLlmCodegenMode` in lockstep;
`submit-mode-parity.test.ts` enforces that compile-time and
runtime agree.

***

### ALLOWED\_LLM\_GATEWAY\_AUTH\_MODES

> `const` **ALLOWED\_LLM\_GATEWAY\_AUTH\_MODES**: readonly \[`"api_key"`, `"bearer_token"`, `"none"`\]

Authentication strategy for outbound requests to the LLM gateway.

***

### ALLOWED\_LLM\_GATEWAY\_COMPATIBILITY\_MODES

> `const` **ALLOWED\_LLM\_GATEWAY\_COMPATIBILITY\_MODES**: readonly \[`"openai_chat"`\]

Wire-protocol compatibility modes. `openai_chat` is the only mode shipped in
Wave 1; the array is the source of truth so future modes (`openai_responses`,
`custom_adapter`) plug in without changing the call sites.

***

### ALLOWED\_LLM\_GATEWAY\_ERROR\_CLASSES

> `const` **ALLOWED\_LLM\_GATEWAY\_ERROR\_CLASSES**: readonly \[`"refusal"`, `"schema_invalid"`, `"incomplete"`, `"timeout"`, `"rate_limited"`, `"transport"`, `"image_payload_rejected"`, `"input_budget_exceeded"`, `"response_too_large"`, `"protocol"`, `"canceled"`\]

Disjoint failure classes surfaced by `LlmGatewayClient.generate`. Refusals,
schema-invalid responses, and image-payload guard rejections are NOT
retryable; transport, timeout, and rate-limit failures are.

***

### ALLOWED\_LLM\_GATEWAY\_ROLES

> `const` **ALLOWED\_LLM\_GATEWAY\_ROLES**: readonly \[`"test_generation"`, `"visual_primary"`, `"visual_fallback"`\]

Allowed gateway roles. Each role is bound to a single deployment to keep the
structured test-case generator (`gpt-oss-120b`) strictly separated from the
multimodal visual sidecars (`llama-4-maverick-vision`, `phi-4-multimodal-poc`).

***

### ALLOWED\_LLM\_GATEWAY\_WIRE\_STRUCTURED\_OUTPUT\_MODES

> `const` **ALLOWED\_LLM\_GATEWAY\_WIRE\_STRUCTURED\_OUTPUT\_MODES**: readonly \[`"json_schema"`, `"json_object"`, `"none"`\]

Wire-format strategy for structured outputs. Decouples our in-process
structured-output behaviour (the gateway always parses JSON content and
validates it against `responseSchema` when present) from the on-the-wire
`response_format` field shipped to the upstream provider.

- `"json_schema"` (default) — emit
  `response_format: { type: "json_schema", json_schema: {...} }` when the
  client config declares `structuredOutputs: true` and the request carries
  a schema. Matches OpenAI / Azure OpenAI Structured Outputs.
- `"json_object"` — emit `response_format: { type: "json_object" }`. The
  schema is still validated in-process. Use for providers that accept the
  weaker `json_object` mode but reject `json_schema`.
- `"none"` — omit `response_format` entirely. Use when the deployment
  silently returns empty content for any `response_format` value (observed
  on `gpt-oss-120b` via Azure AI Foundry's `openai/v1` path on 2026-05-02:
  any `response_format` setting yields `content: ""` after burning ~2
  tokens; with no `response_format`, the model produces clean parseable
  JSON when the prompt instructs it to). The gateway still parses and
  schema-validates the content in-process so the contract guarantee
  ("structured-output success returns parsed JSON") is unchanged.

***

### ALLOWED\_MULTI\_SOURCE\_ENVELOPE\_REFUSAL\_CODES

> `const` **ALLOWED\_MULTI\_SOURCE\_ENVELOPE\_REFUSAL\_CODES**: readonly \[`"envelope_missing"`, `"envelope_version_mismatch"`, `"sources_empty"`, `"duplicate_source_id"`, `"invalid_source_id"`, `"invalid_source_kind"`, `"invalid_content_hash"`, `"invalid_captured_at"`, `"invalid_author_handle"`, `"primary_source_required"`, `"duplicate_jira_paste_collision"`, `"custom_input_format_required"`, `"custom_input_format_invalid"`, `"primary_source_input_format_invalid"`, `"markdown_metadata_only_for_custom"`, `"markdown_hash_required"`, `"markdown_hash_only_for_markdown"`, `"jira_issue_key_invalid"`, `"jira_issue_key_only_for_jira"`, `"invalid_conflict_resolution_policy"`, `"priority_order_required"`, `"priority_order_invalid_kind"`, `"priority_order_incomplete"`, `"priority_order_duplicate"`, `"aggregate_hash_mismatch"`, `"source_mix_plan_invalid"`\]

Refusal codes emitted by the multi-source envelope validator
(Issue #1431). Stable, locale-independent strings safe to ship to
automation.

***

### ALLOWED\_MULTI\_SOURCE\_MODE\_GATE\_REFUSAL\_CODES

> `const` **ALLOWED\_MULTI\_SOURCE\_MODE\_GATE\_REFUSAL\_CODES**: readonly \[`"test_intelligence_disabled"`, `"multi_source_env_disabled"`, `"multi_source_startup_option_disabled"`, `"llm_codegen_mode_locked"`\]

Refusal codes for the multi-source mode gate (Issue #1431). The gate
enforces three nested invariants before any multi-source ingestion is
permitted:

  1. Parent test-intelligence env + startup option enabled.
  2. Multi-source env + startup option enabled.
  3. `llmCodegenMode === "deterministic"`.

Any failed check fails closed with zero side effects and surfaces a
structured diagnostic.

***

### ALLOWED\_PIPELINE\_REQUEST\_ERROR\_CODES

> `const` **ALLOWED\_PIPELINE\_REQUEST\_ERROR\_CODES**: readonly \[`"INVALID_PIPELINE"`, `"PIPELINE_UNAVAILABLE"`, `"PIPELINE_INPUT_UNSUPPORTED"`, `"PIPELINE_SOURCE_MODE_UNSUPPORTED"`, `"PIPELINE_SCOPE_UNSUPPORTED"`\]

Structured request-time pipeline selection failures.

***

### ALLOWED\_QC\_ADAPTER\_MODES

> `const` **ALLOWED\_QC\_ADAPTER\_MODES**: readonly \[`"export_only"`, `"dry_run"`, `"api_transfer"`\]

Allowed transfer modes recognised by the QC adapter façade.

- `export_only` — produce on-disk artifacts; no QC API touched.
- `dry_run` — validate target mapping (folder, fields, schema) without
  creating tests in the QC tool.
- `api_transfer` — controlled OpenText ALM write path implemented by the
  Wave 3 transfer orchestrator. The dry-run adapter still throws
  `mode_not_implemented` when called directly with this mode.

***

### ALLOWED\_QC\_ADAPTER\_PROVIDERS

> `const` **ALLOWED\_QC\_ADAPTER\_PROVIDERS**: readonly \[`"opentext_alm"`, `"opentext_octane"`, `"opentext_valueedge"`, `"xray"`, `"testrail"`, `"azure_devops_test_plans"`, `"qtest"`, `"custom"`\]

Allowed QC adapter provider discriminators. Wave 2 ships `opentext_alm`;
the rest are stub identifiers reserved so future adapters plug in
without contract churn.

***

### ALLOWED\_QC\_MAPPING\_PROFILE\_ISSUE\_CODES

> `const` **ALLOWED\_QC\_MAPPING\_PROFILE\_ISSUE\_CODES**: readonly \[`"missing_base_url_alias"`, `"invalid_base_url_alias"`, `"missing_domain"`, `"missing_project"`, `"missing_target_folder_path"`, `"invalid_target_folder_path"`, `"missing_test_entity_type"`, `"unsupported_test_entity_type"`, `"missing_required_fields"`, `"duplicate_required_field"`, `"missing_design_step_mapping"`, `"design_step_mapping_field_invalid"`, `"credential_like_field_present"`, `"provider_mismatch"`, `"profile_id_mismatch"`\]

Allowed mapping-profile validation issue codes (Issue #1368). Tracks the
`ValidationIssue[]` style used elsewhere in test-intelligence.

***

### ALLOWED\_QC\_PROVIDER\_OPERATIONS

> `const` **ALLOWED\_QC\_PROVIDER\_OPERATIONS**: readonly \[`"validate_profile"`, `"resolve_target_folder"`, `"dry_run"`, `"export_only"`, `"api_transfer"`, `"register_custom"`\]

Allowed QC provider operations (Issue #1374).

Each builtin provider descriptor advertises which of these operations its
adapter implements. The registry uses the matrix to surface "what does
this provider support" without coupling to a concrete adapter:

  - `validate_profile` — pure structural validator runs against the
    supplied mapping profile.
  - `resolve_target_folder` — adapter knows how to validate a target
    folder path against its provider (read-only resolver).
  - `dry_run` — adapter can produce a `DryRunReportArtifact` (potentially
    a fail-closed stub).
  - `export_only` — adapter can emit export-only artifacts.
  - `api_transfer` — adapter can perform controlled API writes.
  - `register_custom` — caller may register a custom adapter under this
    provider id (only true for the reserved `custom` slot).

***

### ALLOWED\_REGULATORY\_RELEVANCE\_DOMAINS

> `const` **ALLOWED\_REGULATORY\_RELEVANCE\_DOMAINS**: readonly \[`"banking"`, `"insurance"`, `"general"`\]

Regulatory-domain enum for [RegulatoryRelevance.domain](#domain-1)
(Issue #1735, contract bump 4.27.0).

Drives the banking/insurance prompt-augmentation pass in the production
runner. The enum is intentionally narrow — generic-compliance language
only (no specific paragraph numbers / regulatory-text citations).

- `"banking"` — semantic banking node names ("Antrag", "Auszahlung",
  "Bonität", IBAN/BIC inputs, four-eyes-state-changing actions, ...).
- `"insurance"` — semantic insurance node names ("Versicherung", "Police",
  "Schadensfall", "Risikoprüfung", ...).
- `"general"` — flagged as compliance-relevant but not specific to the
  above two industries (e.g. PII boundary cases).

***

### ALLOWED\_REVIEW\_EVENT\_KINDS

> `const` **ALLOWED\_REVIEW\_EVENT\_KINDS**: readonly \[`"generated"`, `"review_started"`, `"approved"`, `"primary_approved"`, `"secondary_approved"`, `"rejected"`, `"edited"`, `"exported"`, `"transferred"`, `"note"`\]

Allowed event kinds appended to the review-gate event log.

`primary_approved` and `secondary_approved` (added in #1376) are
emitted in lockstep with four-eyes enforcement: the first distinct
approver records `primary_approved`; the second distinct approver
records `secondary_approved`. Clients may also continue to send the
generic `approved` kind — when the snapshot indicates four-eyes is
enforced, the store routes the request to the correct primary or
secondary event kind based on current state, which keeps wire-level
audit clarity without forcing UI rewrites.

***

### ALLOWED\_REVIEW\_STATES

> `const` **ALLOWED\_REVIEW\_STATES**: readonly \[`"generated"`, `"needs_review"`, `"pending_secondary_approval"`, `"approved"`, `"rejected"`, `"edited"`, `"exported"`, `"transferred"`\]

Allowed lifecycle states for a generated test case under review.

`pending_secondary_approval` (added in #1376) is the intermediate
state a four-eyes-enforced case occupies after the first approval and
before the second distinct approval. Cases not subject to four-eyes
skip this state entirely.

***

### ALLOWED\_SELF\_VERIFY\_RUBRIC\_DIMENSIONS

> `const` **ALLOWED\_SELF\_VERIFY\_RUBRIC\_DIMENSIONS**: readonly \[`"schema_conformance"`, `"source_trace_completeness"`, `"assumption_open_question_marking"`, `"expected_result_coverage"`, `"negative_boundary_presence"`, `"duplication_flag_consistency"`\]

Allowed scoring dimensions evaluated by the self-verify rubric pass
(Issue #1379). Each dimension is scored in `[0, 1]` per test case;
the per-case rubric score is the arithmetic mean of the supplied
dimensions (and visual subscores when present). The discriminant is
the runtime source of truth — adding a new dimension is a minor
(additive) bump per the contract versioning rules.

***

### ALLOWED\_SELF\_VERIFY\_RUBRIC\_REFUSAL\_CODES

> `const` **ALLOWED\_SELF\_VERIFY\_RUBRIC\_REFUSAL\_CODES**: readonly \[`"feature_disabled"`, `"gateway_failure"`, `"model_binding_mismatch"`, `"schema_invalid_response"`, `"score_out_of_range"`, `"missing_test_case_score"`, `"extra_test_case_score"`, `"duplicate_test_case_score"`, `"image_payload_attempted"`\]

Allowed refusal codes reported by the self-verify rubric pass when the
pass cannot publish a complete per-case evaluation. The code is
load-bearing: callers that gate on rubric output check this code and
fall back to the unscored coverage path. No two refusal codes overlap.

***

### ALLOWED\_SELF\_VERIFY\_RUBRIC\_VISUAL\_SUBSCORES

> `const` **ALLOWED\_SELF\_VERIFY\_RUBRIC\_VISUAL\_SUBSCORES**: readonly \[`"visible_control_coverage"`, `"state_validation_coverage"`, `"ambiguity_handling"`, `"unsupported_visual_claims"`\]

Allowed multimodal visual subscores layered onto the rubric pass when
a validated `VisualScreenDescription` batch is supplied alongside the
test cases (Issue #1379, multimodal addendum 2026-04-24). The four
subscores are: visible-control coverage, state/validation coverage,
ambiguity handling, and the unsupported-visual-claims penalty (the
latter is interpreted as `1 - penalty` so all subscores remain in
`[0, 1]` where higher is better).

***

### ALLOWED\_SOURCE\_MIX\_PLANNER\_REFUSAL\_CODES

> `const` **ALLOWED\_SOURCE\_MIX\_PLANNER\_REFUSAL\_CODES**: readonly \[`"primary_source_required"`, `"unsupported_source_mix"`, `"duplicate_source_id"`, `"duplicate_jira_issue_key"`, `"custom_markdown_hash_required"`, `"custom_markdown_input_format_invalid"`, `"source_mix_plan_hash_mismatch"`, `"mode_gate_not_satisfied"`\]

Refusal codes emitted by the source-mix planner when it rejects an envelope.
All refusals are fail-closed; no partial artifact is written.

***

### ALLOWED\_TEST\_CASE\_DELTA\_REASONS

> `const` **ALLOWED\_TEST\_CASE\_DELTA\_REASONS**: readonly \[`"absent_in_current"`, `"absent_in_prior"`, `"fingerprint_changed"`, `"trace_screen_changed"`, `"trace_screen_removed"`, `"visual_ambiguity_increased"`, `"visual_confidence_dropped"`, `"reconciliation_conflict"`\]

Allowed reasons attached to a test-case delta verdict. Sorted,
additive. Multiple reasons may apply to the same verdict.

***

### ALLOWED\_TEST\_CASE\_DELTA\_VERDICTS

> `const` **ALLOWED\_TEST\_CASE\_DELTA\_VERDICTS**: readonly \[`"new"`, `"unchanged"`, `"changed"`, `"obsolete"`, `"requires_review"`\]

Per-test-case verdict produced by the test-case delta classifier.

- `new` — case id present in current generation, absent from
  prior generation.
- `unchanged` — case id present in both with identical
  fingerprint AND no upstream IR delta touching its trace screens.
- `changed` — case id present in both, fingerprint differs OR
  an IR delta touches one of the case's `figmaTraceRefs`.
- `obsolete` — case id present in prior generation but EVERY
  trace screen is absent from the current IR. Reported only —
  never destructively removed from QC (per Issue #1373 AC3).
- `requires_review` — visual confidence dropped below threshold
  OR a reconciliation conflict surfaced.

***

### ALLOWED\_TEST\_CASE\_POLICY\_DECISIONS

> `const` **ALLOWED\_TEST\_CASE\_POLICY\_DECISIONS**: readonly \[`"approved"`, `"blocked"`, `"needs_review"`\]

Allowed policy-gate decisions (Issue #1364).

- `approved` — case may proceed to review/export as-is.
- `blocked` — case must not reach review or export.
- `needs_review` — case must be reviewed manually before export.

***

### ALLOWED\_TEST\_CASE\_POLICY\_OUTCOMES

> `const` **ALLOWED\_TEST\_CASE\_POLICY\_OUTCOMES**: readonly \[`"missing_trace"`, `"missing_expected_results"`, `"pii_in_test_data"`, `"missing_negative_or_validation_for_required_field"`, `"missing_accessibility_case"`, `"missing_boundary_case"`, `"schema_invalid"`, `"duplicate_test_case"`, `"regulated_risk_review_required"`, `"ambiguity_review_required"`, `"qc_mapping_not_exportable"`, `"low_confidence_review_required"`, `"open_questions_review_required"`, `"visual_sidecar_failure"`, `"visual_sidecar_fallback_used"`, `"visual_sidecar_low_confidence"`, `"visual_sidecar_possible_pii"`, `"visual_sidecar_prompt_injection_text"`, `"semantic_suspicious_content"`, `"risk_tag_downgrade_detected"`, `"custom_context_risk_escalation"`, `"multi_source_conflict_present"`\]

Allowed policy outcome codes attached to a single decision row.
Visual-sidecar codes (`visual_*`) come from the multimodal sidecar
gating per the Issue #1364 / #1386 update.

***

### ALLOWED\_TEST\_CASE\_VALIDATION\_ISSUE\_CODES

> `const` **ALLOWED\_TEST\_CASE\_VALIDATION\_ISSUE\_CODES**: readonly \[`"schema_invalid"`, `"missing_trace"`, `"trace_screen_unknown"`, `"missing_expected_results"`, `"steps_unordered"`, `"steps_indices_non_sequential"`, `"step_action_empty"`, `"step_action_too_long"`, `"duplicate_step_index"`, `"duplicate_test_case_id"`, `"title_empty"`, `"objective_empty"`, `"risk_category_invalid_for_intent"`, `"qc_mapping_blocking_reasons_missing"`, `"qc_mapping_exportable_inconsistent"`, `"quality_signals_confidence_out_of_range"`, `"quality_signals_coverage_unknown_id"`, `"test_data_pii_detected"`, `"test_data_unredacted_value"`, `"preconditions_pii_detected"`, `"expected_results_pii_detected"`, `"assumptions_excessive"`, `"open_questions_excessive"`, `"ambiguity_without_review_state"`, `"semantic_suspicious_content"`\]

Allowed test-case validation issue codes (Issue #1364).
The list is the runtime source of truth; new codes plug in here without
altering call sites. Adding a new code is a minor (additive) bump.

***

### ALLOWED\_TEST\_INTELLIGENCE\_MODES

> `const` **ALLOWED\_TEST\_INTELLIGENCE\_MODES**: readonly \[`"deterministic_llm"`, `"offline_eval"`, `"dry_run"`\]

Runtime source-of-truth for allowed test-intelligence modes.

Test intelligence is an opt-in, local-first feature that is SEPARATE from
the `llmCodegenMode` namespace used by the deterministic code generation
pipeline. The two mode namespaces are intentionally isolated: changes to
this array must never affect `ALLOWED_LLM_CODEGEN_MODES`.

***

### ALLOWED\_TEST\_INTENT\_CUSTOM\_INPUT\_FORMATS

> `const` **ALLOWED\_TEST\_INTENT\_CUSTOM\_INPUT\_FORMATS**: readonly \[`"plain_text"`, `"markdown"`, `"structured_json"`\]

Recognised input formats for `custom_text` / `custom_structured` sources
(Markdown-aware addendum, 2026-04-26). Markdown is treated as
user-provided supporting evidence and is NEVER trusted as instructions
to the model or runtime.

***

### ALLOWED\_TEST\_INTENT\_SOURCE\_KINDS

> `const` **ALLOWED\_TEST\_INTENT\_SOURCE\_KINDS**: readonly \[`"figma_local_json"`, `"figma_plugin"`, `"figma_rest"`, `"jira_rest"`, `"jira_paste"`, `"custom_text"`, `"custom_structured"`, `"custom_markdown"`\]

Source kinds recognised by the multi-source Test Intent ingestion
pipeline (Issue #1431). The first three are existing Figma kinds; the
remaining four are introduced by Wave 4 issues 4.B–4.E. `custom_markdown`
is added by Issue #1441 as a dedicated Markdown supporting source kind.

***

### ALLOWED\_TEST\_INTENT\_SOURCE\_MIX\_KINDS

> `const` **ALLOWED\_TEST\_INTENT\_SOURCE\_MIX\_KINDS**: readonly \[`"figma_only"`, `"jira_rest_only"`, `"jira_paste_only"`, `"figma_jira_rest"`, `"figma_jira_paste"`, `"figma_jira_mixed"`, `"jira_mixed"`\]

All supported source-mix identifiers. Each value represents a distinct
combination of primary and supporting source kinds that the planner accepts.
The planner rejects any combination not listed here with
`unsupported_source_mix`.

***

### ALLOWED\_TRANSFER\_ENTITY\_OUTCOMES

> `const` **ALLOWED\_TRANSFER\_ENTITY\_OUTCOMES**: readonly \[`"created"`, `"skipped_duplicate"`, `"failed"`, `"refused"`\]

Per-test-case outcome of an API transfer attempt. Discriminated so
report consumers can sort + count without re-deriving the state.

- `created` — the entity did not exist; create call succeeded.
- `skipped_duplicate` — the entity already exists for this
  `externalIdCandidate` + folder; no write performed.
- `failed` — adapter or transport error. When `qcEntityId` is
  non-empty, the tenant may contain a partially created entity and the
  rollback guidance must include it for operator cleanup.
- `refused` — pipeline-level refusal (e.g. unapproved); no call
  was attempted.

***

### ALLOWED\_TRANSFER\_FAILURE\_CLASSES

> `const` **ALLOWED\_TRANSFER\_FAILURE\_CLASSES**: readonly \[`"transport_error"`, `"auth_failed"`, `"permission_denied"`, `"validation_rejected"`, `"conflict_unresolved"`, `"rate_limited"`, `"server_error"`, `"unknown"`\]

Allowed failure classes for a per-entity transfer failure. Mirrors the
gateway taxonomy so transport faults stay distinguishable from
server-side validation faults.

***

### ALLOWED\_TRANSFER\_REFUSAL\_CODES

> `const` **ALLOWED\_TRANSFER\_REFUSAL\_CODES**: readonly \[`"feature_disabled"`, `"admin_gate_disabled"`, `"bearer_token_missing"`, `"mapping_profile_invalid"`, `"provider_mismatch"`, `"no_mapped_test_cases"`, `"no_approved_test_cases"`, `"unapproved_test_cases_present"`, `"policy_blocked_cases_present"`, `"schema_invalid_cases_present"`, `"visual_sidecar_blocked"`, `"visual_sidecar_evidence_missing"`, `"review_state_inconsistent"`, `"four_eyes_pending"`, `"dry_run_refused"`, `"dry_run_missing"`, `"folder_resolution_failed"`, `"mode_not_implemented"`\]

Allowed reasons the QC adapter may refuse to perform an API transfer.

These are evaluated in fail-closed order — the first refusal stops the
pipeline before any state-mutating call leaves the process. The
`transfer-report.json` artifact records every refusal that fired so
the operator can address them all in one cycle.

***

### ALLOWED\_VISUAL\_SIDECAR\_FAILURE\_CLASSES

> `const` **ALLOWED\_VISUAL\_SIDECAR\_FAILURE\_CLASSES**: readonly \[`"primary_unavailable"`, `"primary_quota_exceeded"`, `"both_sidecars_failed"`, `"schema_invalid_response"`, `"image_payload_too_large"`, `"image_mime_unsupported"`, `"duplicate_screen_id"`, `"empty_screen_capture_set"`\]

Allowed failure classes for the visual sidecar client. The classes are
disjoint and policy-readable: a downstream policy gate can refuse a job
by inspecting the failure class without reading sanitized free-form
messages.

***

### ALLOWED\_VISUAL\_SIDECAR\_INPUT\_MIME\_TYPES

> `const` **ALLOWED\_VISUAL\_SIDECAR\_INPUT\_MIME\_TYPES**: readonly \[`"image/png"`, `"image/jpeg"`, `"image/webp"`, `"image/gif"`\]

Allowed input MIME types for visual sidecar captures. SVG is intentionally
NOT in the allowlist because SVG is XML and exposes a parser/injection
surface that the multimodal sidecar should never have to evaluate.

***

### ALLOWED\_VISUAL\_SIDECAR\_VALIDATION\_OUTCOMES

> `const` **ALLOWED\_VISUAL\_SIDECAR\_VALIDATION\_OUTCOMES**: readonly \[`"ok"`, `"schema_invalid"`, `"low_confidence"`, `"fallback_used"`, `"possible_pii"`, `"prompt_injection_like_text"`, `"conflicts_with_figma_metadata"`, `"primary_unavailable"`\]

Allowed visual-sidecar policy outcome codes (Issue #1364 / #1386).

These mirror the visual-sidecar policy outcomes attached to the policy
report when the multimodal sidecar misbehaves or is downgraded.

***

### ALLOWED\_WAVE1\_POC\_ATTESTATION\_SIGNING\_MODES

> `const` **ALLOWED\_WAVE1\_POC\_ATTESTATION\_SIGNING\_MODES**: readonly \[`"unsigned"`, `"sigstore"`\]

Allowed signing modes for the Wave 1 POC attestation.

- `unsigned` (default) — emit DSSE envelope with empty `signatures`,
  no Sigstore bundle. Always works air-gapped without network access.
- `sigstore` — emit DSSE envelope with one or more signatures and a
  Sigstore bundle alongside. The signer is operator-supplied; the
  built-in key-bound signer uses ECDSA P-256 from `node:crypto` so
  tests and verifiers run without external network calls. A keyless
  flow (Fulcio + Rekor) plugs into the same signer interface but is
  never invoked by default.

***

### ALLOWED\_WORKSPACE\_JOB\_TYPES

> `const` **ALLOWED\_WORKSPACE\_JOB\_TYPES**: readonly \[`"figma_to_code"`, `"figma_to_qc_test_cases"`\]

Runtime source-of-truth for allowed workspace-dev job types.
Keep this array and `WorkspaceJobType` in lockstep.

***

### ALM\_EXPORT\_SCHEMA\_VERSION

> `const` **ALM\_EXPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version stamp embedded in the OpenText ALM reference XML export (Issue #1365).

***

### ALM\_EXPORT\_XML\_NAMESPACE

> `const` **ALM\_EXPORT\_XML\_NAMESPACE**: `"https://workspace-dev.local/schema/alm-export/v1"`

XML namespace embedded in the OpenText ALM reference export root element.

***

### BANKING\_INSURANCE\_SEMANTIC\_KEYWORDS

> `const` **BANKING\_INSURANCE\_SEMANTIC\_KEYWORDS**: readonly \[`"Versicherung"`, `"Police"`, `"Schadensfall"`, `"Risikoprüfung"`, `"Bonität"`, `"Antrag"`, `"Abschluss"`, `"Auszahlung"`, `"Kündigung"`\]

Banking / insurance semantic keywords surfaced in screen / node names that
trigger the regulatory-prompt augmentation pass. The list is intentionally
narrow: generic banking + insurance flow vocabulary (German), no specific
regulatory-text citations.

Exposed as a frozen contract export so callers (production runner +
inspector tooling) share one source of truth for "is this screen regulated".

***

### BUSINESS\_TEST\_INTENT\_IR\_SCHEMA\_VERSION

> `const` **BUSINESS\_TEST\_INTENT\_IR\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for `BusinessTestIntentIr` artifacts.

***

### CONTRACT\_VERSION

> `const` **CONTRACT\_VERSION**: `"4.28.0"`

Current contract version constant.
Must be bumped according to CONTRACT_CHANGELOG.md rules.
Package version alignment is documented in VERSIONING.md.

***

### COVERAGE\_PLAN\_ARTIFACT\_FILENAME

> `const` **COVERAGE\_PLAN\_ARTIFACT\_FILENAME**: `"coverage-plan.json"`

Canonical filename for the deterministic coverage-plan artifact.

***

### COVERAGE\_PLAN\_SCHEMA\_VERSION

> `const` **COVERAGE\_PLAN\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for persisted `coverage-plan.json` artifacts.

***

### CUSTOM\_CONTEXT\_ARTIFACT\_FILENAME

> `const` **CUSTOM\_CONTEXT\_ARTIFACT\_FILENAME**: `"custom-context.json"`

Canonical filename for a persisted custom-context supporting source.

***

### CUSTOM\_CONTEXT\_MARKDOWN\_SOURCE\_ID

> `const` **CUSTOM\_CONTEXT\_MARKDOWN\_SOURCE\_ID**: `"custom-context-markdown"`

Stable source id for Markdown-authored custom context.

***

### CUSTOM\_CONTEXT\_SCHEMA\_VERSION

> `const` **CUSTOM\_CONTEXT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for persisted custom-context supporting source artifacts.

***

### CUSTOM\_CONTEXT\_STRUCTURED\_SOURCE\_ID

> `const` **CUSTOM\_CONTEXT\_STRUCTURED\_SOURCE\_ID**: `"custom-context-structured"`

Stable source id for structured-attribute custom context.

***

### DEDUPE\_REPORT\_ARTIFACT\_FILENAME

> `const` **DEDUPE\_REPORT\_ARTIFACT\_FILENAME**: `"dedupe-report.json"`

Canonical filename for the persisted dedupe artifact.

***

### DEDUPE\_REPORT\_SCHEMA\_VERSION

> `const` **DEDUPE\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted dedupe artifact (Issue #1373).

***

### DEFAULT\_FOUR\_EYES\_REQUIRED\_RISK\_CATEGORIES

> `const` **DEFAULT\_FOUR\_EYES\_REQUIRED\_RISK\_CATEGORIES**: readonly [`TestCaseRiskCategory`](#testcaseriskcategory)[]

Default risk categories that require four-eyes review (#1376).

The list spans the existing `TestCaseRiskCategory` taxonomy. Issue
#1376 names the operator-facing risk classes as
`payment / authorization / identity / regulatory`; those map onto the
existing taxonomy as `financial_transaction` (payment) +
`regulated_data` (identity, regulatory) + `high` (authorization /
elevated-impact). Operators may override with
`WorkspaceStartOptions.testIntelligence.fourEyesRequiredRiskCategories`.

***

### DEFAULT\_FOUR\_EYES\_VISUAL\_SIDECAR\_TRIGGERS

> `const` **DEFAULT\_FOUR\_EYES\_VISUAL\_SIDECAR\_TRIGGERS**: readonly [`VisualSidecarValidationOutcome`](#visualsidecarvalidationoutcome)[]

Default visual-sidecar validation outcomes that trigger four-eyes
enforcement (#1376, 2026-04-24 multimodal addendum).

When ANY screen referenced by a test case carries one of these
outcomes in `VisualSidecarValidationReport`, the case is enforced as
four-eyes regardless of risk category.

***

### DEFAULT\_JIRA\_FIELD\_SELECTION\_PROFILE

> `const` **DEFAULT\_JIRA\_FIELD\_SELECTION\_PROFILE**: [`JiraFieldSelectionProfile`](#jirafieldselectionprofile)

Default Jira field selection profile — data-minimized by default. No
comments, no attachments, no linked issues, no unknown custom fields.
Description is included; acceptance criteria require explicit
configuration.

***

### DEFAULT\_MUTATION\_KILL\_RATE\_TARGET

> `const` **DEFAULT\_MUTATION\_KILL\_RATE\_TARGET**: `0.85`

Default mutation kill-rate target for deterministic coverage planning.

***

### DRY\_RUN\_REPORT\_ARTIFACT\_FILENAME

> `const` **DRY\_RUN\_REPORT\_ARTIFACT\_FILENAME**: `"dry-run-report.json"`

Canonical filename for the persisted dry-run report artifact.

***

### DRY\_RUN\_REPORT\_SCHEMA\_VERSION

> `const` **DRY\_RUN\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted dry-run report artifact (Issue #1368).

***

### EU\_BANKING\_DEFAULT\_POLICY\_PROFILE\_ID

> `const` **EU\_BANKING\_DEFAULT\_POLICY\_PROFILE\_ID**: `"eu-banking-default"`

Built-in policy profile id for the default EU-banking compliance gate.
Operators may install additional profiles by version stamp; this id is the
one Wave 1 ships with.

***

### EU\_BANKING\_DEFAULT\_POLICY\_PROFILE\_VERSION

> `const` **EU\_BANKING\_DEFAULT\_POLICY\_PROFILE\_VERSION**: `"1.0.0"`

Version stamp for the built-in `eu-banking-default` policy profile.

***

### EVIDENCE\_VERIFY\_RESPONSE\_SCHEMA\_VERSION

> `const` **EVIDENCE\_VERIFY\_RESPONSE\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the `EvidenceVerifyResponse` envelope returned by
`GET /workspace/jobs/:jobId/evidence/verify` (Issue #1380). Bump when a
backwards-incompatible field shape change ships.

***

### EXPORT\_REPORT\_ARTIFACT\_FILENAME

> `const` **EXPORT\_REPORT\_ARTIFACT\_FILENAME**: `"export-report.json"`

Canonical filename for the persisted export-report artifact.

***

### EXPORT\_REPORT\_SCHEMA\_VERSION

> `const` **EXPORT\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted export-report artifact (Issue #1365).

***

### EXPORT\_TESTCASES\_ALM\_XML\_ARTIFACT\_FILENAME

> `const` **EXPORT\_TESTCASES\_ALM\_XML\_ARTIFACT\_FILENAME**: `"testcases.alm.xml"`

Canonical filename for the persisted OpenText ALM reference XML export.

***

### EXPORT\_TESTCASES\_CSV\_ARTIFACT\_FILENAME

> `const` **EXPORT\_TESTCASES\_CSV\_ARTIFACT\_FILENAME**: `"testcases.csv"`

Canonical filename for the persisted CSV export of approved test cases.

***

### EXPORT\_TESTCASES\_JSON\_ARTIFACT\_FILENAME

> `const` **EXPORT\_TESTCASES\_JSON\_ARTIFACT\_FILENAME**: `"testcases.json"`

Canonical filename for the persisted JSON export of approved test cases.

***

### EXPORT\_TESTCASES\_XLSX\_ARTIFACT\_FILENAME

> `const` **EXPORT\_TESTCASES\_XLSX\_ARTIFACT\_FILENAME**: `"testcases.xlsx"`

Canonical filename for the optional persisted XLSX export of approved test cases.

***

### FINOPS\_ARTIFACT\_DIRECTORY

> `const` **FINOPS\_ARTIFACT\_DIRECTORY**: `"finops"`

Subdirectory under a run dir where FinOps artifacts are persisted.

***

### FINOPS\_BUDGET\_REPORT\_ARTIFACT\_FILENAME

> `const` **FINOPS\_BUDGET\_REPORT\_ARTIFACT\_FILENAME**: `"budget-report.json"`

Canonical filename for the FinOps budget report artifact.

***

### FINOPS\_BUDGET\_REPORT\_SCHEMA\_VERSION

> `const` **FINOPS\_BUDGET\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted FinOps budget report artifact (Issue #1371).

***

### GENERATED\_TEST\_CASE\_SCHEMA\_VERSION

> `const` **GENERATED\_TEST\_CASE\_SCHEMA\_VERSION**: `"1.1.0"`

Schema version for generated test case payloads.

1.1.0 — Issue #1735: optional additive field `regulatoryRelevance`
({domain, rationale}) on each test case. Backwards compatible — the
validator accepts both 1.0.0-shaped lists (without the field) and
1.1.0-shaped lists (with or without the field).

***

### GENERATED\_TESTCASES\_ARTIFACT\_FILENAME

> `const` **GENERATED\_TESTCASES\_ARTIFACT\_FILENAME**: `"generated-testcases.json"`

Canonical filename for the persisted test-case payload accepted into review/export.

***

### INTENT\_DELTA\_REPORT\_ARTIFACT\_FILENAME

> `const` **INTENT\_DELTA\_REPORT\_ARTIFACT\_FILENAME**: `"intent-delta-report.json"`

Canonical filename for the persisted intent-delta artifact.

***

### INTENT\_DELTA\_REPORT\_SCHEMA\_VERSION

> `const` **INTENT\_DELTA\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted intent-delta artifact (Issue #1373).

***

### JIRA\_CREATED\_SUBTASKS\_ARTIFACT\_FILENAME

> `const` **JIRA\_CREATED\_SUBTASKS\_ARTIFACT\_FILENAME**: `"jira-created-subtasks.json"`

Canonical filename for the Jira created sub-tasks artifact.

***

### JIRA\_CREATED\_SUBTASKS\_SCHEMA\_VERSION

> `const` **JIRA\_CREATED\_SUBTASKS\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted Jira created sub-tasks artifact (Issue #1482).

***

### JIRA\_ISSUE\_IR\_ARTIFACT\_DIRECTORY

> `const` **JIRA\_ISSUE\_IR\_ARTIFACT\_DIRECTORY**: `"sources"`

Run-dir-relative subdirectory under which per-source Jira IR artifacts
are persisted, namespaced by [TestIntentSourceRef.sourceId](#sourceid-4).

Layout: `<runDir>/sources/<sourceId>/jira-issue-ir.json`.

***

### JIRA\_ISSUE\_IR\_ARTIFACT\_FILENAME

> `const` **JIRA\_ISSUE\_IR\_ARTIFACT\_FILENAME**: `"jira-issue-ir.json"`

Canonical filename for the persisted Jira IR artifact.

***

### JIRA\_ISSUE\_IR\_SCHEMA\_VERSION

> `const` **JIRA\_ISSUE\_IR\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version stamp for the [JiraIssueIr](#jiraissueir) artifact.

***

### JIRA\_WRITE\_REPORT\_ARTIFACT\_DIRECTORY

> `const` **JIRA\_WRITE\_REPORT\_ARTIFACT\_DIRECTORY**: `"jira-write"`

Sub-directory under the run dir where Jira write artifacts are persisted.

***

### JIRA\_WRITE\_REPORT\_ARTIFACT\_FILENAME

> `const` **JIRA\_WRITE\_REPORT\_ARTIFACT\_FILENAME**: `"jira-write-report.json"`

Canonical filename for the Jira write report artifact.

***

### JIRA\_WRITE\_REPORT\_SCHEMA\_VERSION

> `const` **JIRA\_WRITE\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted Jira write report artifact (Issue #1482).

***

### LBOM\_ARTIFACT\_DIRECTORY

> `const` **LBOM\_ARTIFACT\_DIRECTORY**: `"lbom"`

Subdirectory under a run dir where the per-job LBOM is persisted.

***

### LBOM\_ARTIFACT\_FILENAME

> `const` **LBOM\_ARTIFACT\_FILENAME**: `"ai-bom.cdx.json"`

Canonical filename for the per-job LBOM artifact.

***

### LBOM\_ARTIFACT\_SCHEMA\_VERSION

> `const` **LBOM\_ARTIFACT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted per-job LBOM artifact.

***

### LBOM\_CYCLONEDX\_SPEC\_VERSION

> `const` **LBOM\_CYCLONEDX\_SPEC\_VERSION**: `"1.6"`

CycloneDX spec version targeted by the per-job LBOM.

***

### LLM\_CAPABILITIES\_ARTIFACT\_FILENAME

> `const` **LLM\_CAPABILITIES\_ARTIFACT\_FILENAME**: `"llm-capabilities.json"`

Canonical filename for the persisted LLM gateway capability probe artifact.

***

### LLM\_CAPABILITIES\_SCHEMA\_VERSION

> `const` **LLM\_CAPABILITIES\_SCHEMA\_VERSION**: `"1.1.0"`

Schema version for the persisted `llm-capabilities.json` evidence artifact.

***

### LLM\_GATEWAY\_CONTRACT\_VERSION

> `const` **LLM\_GATEWAY\_CONTRACT\_VERSION**: `"1.0.0"`

Version stamp for persisted role-separated LLM gateway evidence artifacts.

***

### MAX\_CUSTOM\_CONTEXT\_BYTES\_PER\_JOB

> `const` **MAX\_CUSTOM\_CONTEXT\_BYTES\_PER\_JOB**: `262144`

Maximum custom-context input bytes allowed per production-readiness job.
Enforced before custom-context ingest begins; breach emits
`custom_context_quota_exceeded`.

***

### MAX\_JIRA\_ADF\_INPUT\_BYTES

> `const` **MAX\_JIRA\_ADF\_INPUT\_BYTES**: `1048576`

Hard pre-parse byte cap on the serialized ADF JSON document. Inputs
exceeding this are rejected with `jira_adf_payload_too_large` before
any tree traversal — the parser MUST NOT allocate proportional to the
payload above this bound.

***

### MAX\_JIRA\_API\_REQUESTS\_PER\_JOB

> `const` **MAX\_JIRA\_API\_REQUESTS\_PER\_JOB**: `20`

Maximum Jira REST API calls allowed per production-readiness job.
Enforced before any outbound fetch; breach emits `jira_api_quota_exceeded`.

***

### MAX\_JIRA\_ATTACHMENT\_COUNT

> `const` **MAX\_JIRA\_ATTACHMENT\_COUNT**: `50`

Hard cap on the number of Jira attachments persisted in a single IR.
Attachment bytes are NEVER persisted — only metadata.

***

### MAX\_JIRA\_COMMENT\_BODY\_BYTES

> `const` **MAX\_JIRA\_COMMENT\_BODY\_BYTES**: `4096`

Hard cap on the UTF-8 byte length of any single normalized + redacted
Jira comment body. Over-cap comments are truncated and counted in
[JiraIssueIrDataMinimization.commentsCapped](#commentscapped).

***

### MAX\_JIRA\_COMMENT\_COUNT

> `const` **MAX\_JIRA\_COMMENT\_COUNT**: `50`

Hard cap on the number of Jira comments persisted in a single IR.
Over-cap comments are dropped and counted in
[JiraIssueIrDataMinimization.commentsDropped](#commentsdropped).

***

### MAX\_JIRA\_CUSTOM\_FIELD\_COUNT

> `const` **MAX\_JIRA\_CUSTOM\_FIELD\_COUNT**: `50`

Hard cap on the number of custom fields persisted in a single IR.

***

### MAX\_JIRA\_CUSTOM\_FIELD\_VALUE\_BYTES

> `const` **MAX\_JIRA\_CUSTOM\_FIELD\_VALUE\_BYTES**: `2048`

Hard cap on the UTF-8 byte length of a single normalized + redacted custom-field value.

***

### MAX\_JIRA\_DESCRIPTION\_PLAIN\_BYTES

> `const` **MAX\_JIRA\_DESCRIPTION\_PLAIN\_BYTES**: `32768`

Hard cap on the UTF-8 byte length of [JiraIssueIr.descriptionPlain](#descriptionplain)
after ADF normalization + PII redaction. Over-cap descriptions are
truncated and the truncation is recorded in [JiraIssueIrDataMinimization.descriptionTruncated](#descriptiontruncated).

***

### MAX\_JIRA\_LINK\_COUNT

> `const` **MAX\_JIRA\_LINK\_COUNT**: `50`

Hard cap on the number of Jira linked-issue refs persisted in a single IR.

***

### MAX\_JIRA\_PASTE\_BYTES\_PER\_JOB

> `const` **MAX\_JIRA\_PASTE\_BYTES\_PER\_JOB**: `524288`

Maximum raw paste bytes allowed per production-readiness job.
Enforced before Jira paste ingest begins; breach emits `jira_paste_quota_exceeded`.

***

### MAX\_VISUAL\_SIDECAR\_INPUT\_BYTES

> `const` **MAX\_VISUAL\_SIDECAR\_INPUT\_BYTES**: `number`

Maximum decoded byte size of a single visual sidecar capture. The bound
is enforced AFTER base64 decoding (i.e. on the actual image bytes the
gateway would forward). Five MiB matches the conservative ceiling Azure
OpenAI imposes on multimodal payloads.

***

### MULTI\_SOURCE\_CONFLICT\_REPORT\_ARTIFACT\_FILENAME

> `const` **MULTI\_SOURCE\_CONFLICT\_REPORT\_ARTIFACT\_FILENAME**: `"multi-source-conflicts.json"`

Canonical filename for the deterministic multi-source conflict artifact.

***

### MULTI\_SOURCE\_RECONCILIATION\_REPORT\_SCHEMA\_VERSION

> `const` **MULTI\_SOURCE\_RECONCILIATION\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for `multi-source-conflicts.json` (Issue #1436).

***

### MULTI\_SOURCE\_TEST\_INTENT\_ENVELOPE\_SCHEMA\_VERSION

> `const` **MULTI\_SOURCE\_TEST\_INTENT\_ENVELOPE\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the [MultiSourceTestIntentEnvelope](#multisourcetestintentenvelope) aggregate
(Issue #1431). Bumped on any breaking change to the envelope shape, the
source-ref shape, or the aggregate-hash construction.

***

### OPENTEXT\_ALM\_REFERENCE\_PROFILE\_ID

> `const` **OPENTEXT\_ALM\_REFERENCE\_PROFILE\_ID**: `"opentext-alm-default"`

Built-in OpenText ALM reference export profile id (Wave 1).

***

### OPENTEXT\_ALM\_REFERENCE\_PROFILE\_VERSION

> `const` **OPENTEXT\_ALM\_REFERENCE\_PROFILE\_VERSION**: `"1.0.0"`

Version stamp for the built-in OpenText ALM reference export profile.

***

### PIPELINE\_QUALITY\_PASSPORT\_ARTIFACT\_FILENAME

> `const` **PIPELINE\_QUALITY\_PASSPORT\_ARTIFACT\_FILENAME**: `"quality-passport.json"`

Canonical filename for the persisted pipeline quality passport artifact.

***

### PIPELINE\_QUALITY\_PASSPORT\_SCHEMA\_VERSION

> `const` **PIPELINE\_QUALITY\_PASSPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the deterministic pipeline quality passport artifact.

***

### PRIMARY\_TEST\_INTENT\_SOURCE\_KINDS

> `const` **PRIMARY\_TEST\_INTENT\_SOURCE\_KINDS**: readonly \[`"figma_local_json"`, `"figma_plugin"`, `"figma_rest"`, `"jira_rest"`, `"jira_paste"`\]

Primary source kinds — at least one of these must be present in any
envelope. A custom-only envelope must fail validation with
`primary_source_required` (Issue #1431, source-mix hardening addendum).

***

### QC\_CREATED\_ENTITIES\_ARTIFACT\_FILENAME

> `const` **QC\_CREATED\_ENTITIES\_ARTIFACT\_FILENAME**: `"qc-created-entities.json"`

Canonical filename for the persisted qc-created-entities artifact.

***

### QC\_CREATED\_ENTITIES\_SCHEMA\_VERSION

> `const` **QC\_CREATED\_ENTITIES\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted qc-created-entities artifact (Issue #1372).

***

### QC\_MAPPING\_PREVIEW\_ARTIFACT\_FILENAME

> `const` **QC\_MAPPING\_PREVIEW\_ARTIFACT\_FILENAME**: `"qc-mapping-preview.json"`

Canonical filename for the persisted QC mapping preview artifact.

***

### QC\_MAPPING\_PREVIEW\_SCHEMA\_VERSION

> `const` **QC\_MAPPING\_PREVIEW\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted QC mapping preview artifact (Issue #1365).

***

### REDACTION\_POLICY\_VERSION

> `const` **REDACTION\_POLICY\_VERSION**: `"1.0.0"`

Redaction policy bundle version applied before prompt compilation.

***

### REVIEW\_EVENTS\_ARTIFACT\_FILENAME

> `const` **REVIEW\_EVENTS\_ARTIFACT\_FILENAME**: `"review-events.json"`

Canonical filename for the persisted review-gate event log.

***

### REVIEW\_GATE\_SCHEMA\_VERSION

> `const` **REVIEW\_GATE\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted review-gate state and event-log artifacts (Issue #1365).

***

### REVIEW\_STATE\_ARTIFACT\_FILENAME

> `const` **REVIEW\_STATE\_ARTIFACT\_FILENAME**: `"review-state.json"`

Canonical filename for the persisted review-gate snapshot.

***

### SELF\_VERIFY\_RUBRIC\_ARTIFACT\_DIRECTORY

> `const` **SELF\_VERIFY\_RUBRIC\_ARTIFACT\_DIRECTORY**: `"testcases"`

Run-dir-relative subdirectory under which the self-verify rubric artifact
is persisted. Sibling to the validation reports so consumers can locate
the test-case quality signals next to the cases they describe.

***

### SELF\_VERIFY\_RUBRIC\_PROMPT\_TEMPLATE\_VERSION

> `const` **SELF\_VERIFY\_RUBRIC\_PROMPT\_TEMPLATE\_VERSION**: `"1.0.0"`

Prompt template version stamp for the rubric-only prompt family. Bumped
on any change to the system prompt, user-prompt preamble, or the JSON
response schema; the version stamp participates in the rubric replay-cache
key so any template change forces a cache miss.

***

### SELF\_VERIFY\_RUBRIC\_REPORT\_ARTIFACT\_FILENAME

> `const` **SELF\_VERIFY\_RUBRIC\_REPORT\_ARTIFACT\_FILENAME**: `"self-verify-rubric.json"`

Canonical filename for the persisted self-verify rubric report
(Issue #1379). The artifact is emitted under
`<runDir>/testcases/self-verify-rubric.json` when the opt-in pass runs.

***

### SELF\_VERIFY\_RUBRIC\_REPORT\_SCHEMA\_VERSION

> `const` **SELF\_VERIFY\_RUBRIC\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted self-verify rubric pass artifact (Issue #1379).

Bumped on any breaking change to the per-case evaluation shape, the
job-level aggregate shape, the rubric-dimension union, or the JSON
response shape consumed by the rubric prompt.

***

### SELF\_VERIFY\_RUBRIC\_RESPONSE\_SCHEMA\_NAME

> `const` **SELF\_VERIFY\_RUBRIC\_RESPONSE\_SCHEMA\_NAME**: `"SelfVerifyRubricReport"`

Stable JSON schema name attached to the structured rubric response.

***

### SOURCE\_MIX\_PLAN\_ARTIFACT\_FILENAME

> `const` **SOURCE\_MIX\_PLAN\_ARTIFACT\_FILENAME**: `"source-mix-plan.json"`

Canonical filename for the deterministic source-mix plan artifact.

***

### SOURCE\_MIX\_PLAN\_SCHEMA\_VERSION

> `const` **SOURCE\_MIX\_PLAN\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for persisted `source-mix-plan.json` artifacts.

***

### SUGGESTED\_CUSTOM\_CONTEXT\_ATTRIBUTES

> `const` **SUGGESTED\_CUSTOM\_CONTEXT\_ATTRIBUTES**: readonly [`SuggestedCustomContextAttribute`](#suggestedcustomcontextattribute)[]

Curated structured-attribute schema surfaced to API and UI consumers.

***

### SUPPORTING\_TEST\_INTENT\_SOURCE\_KINDS

> `const` **SUPPORTING\_TEST\_INTENT\_SOURCE\_KINDS**: readonly \[`"custom_text"`, `"custom_structured"`, `"custom_markdown"`\]

Supporting (non-primary) source kinds — may only appear alongside at
least one primary source. `custom_markdown` is a dedicated Markdown
supporting source kind (Issue #1441); it always carries
`redactedMarkdownHash` + `plainTextDerivativeHash` and never requires
`inputFormat` since its format is intrinsically Markdown.

***

### TEST\_CASE\_COVERAGE\_REPORT\_ARTIFACT\_FILENAME

> `const` **TEST\_CASE\_COVERAGE\_REPORT\_ARTIFACT\_FILENAME**: `"coverage-report.json"`

Canonical filename for the persisted coverage / quality-signals artifact.

***

### TEST\_CASE\_COVERAGE\_REPORT\_SCHEMA\_VERSION

> `const` **TEST\_CASE\_COVERAGE\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted coverage / quality-signals report artifact (Issue #1364).

***

### TEST\_CASE\_DELTA\_REPORT\_ARTIFACT\_FILENAME

> `const` **TEST\_CASE\_DELTA\_REPORT\_ARTIFACT\_FILENAME**: `"test-case-delta-report.json"`

Canonical filename for the persisted test-case delta artifact.

***

### TEST\_CASE\_DELTA\_REPORT\_SCHEMA\_VERSION

> `const` **TEST\_CASE\_DELTA\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted test-case delta report artifact (Issue #1373).

***

### TEST\_CASE\_POLICY\_REPORT\_ARTIFACT\_FILENAME

> `const` **TEST\_CASE\_POLICY\_REPORT\_ARTIFACT\_FILENAME**: `"policy-report.json"`

Canonical filename for the persisted policy-gate decision artifact.

***

### TEST\_CASE\_POLICY\_REPORT\_SCHEMA\_VERSION

> `const` **TEST\_CASE\_POLICY\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted policy decision report artifact (Issue #1364).

***

### TEST\_CASE\_VALIDATION\_REPORT\_ARTIFACT\_FILENAME

> `const` **TEST\_CASE\_VALIDATION\_REPORT\_ARTIFACT\_FILENAME**: `"validation-report.json"`

Canonical filename for the persisted validation diagnostics artifact.

***

### TEST\_CASE\_VALIDATION\_REPORT\_SCHEMA\_VERSION

> `const` **TEST\_CASE\_VALIDATION\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted test-case validation report artifact (Issue #1364).
Bumped when `TestCaseValidationReport` changes shape.

***

### TEST\_DESIGN\_MODEL\_ARTIFACT\_FILENAME

> `const` **TEST\_DESIGN\_MODEL\_ARTIFACT\_FILENAME**: `"test-design-model.json"`

Canonical filename for persisted `TestDesignModel` artifacts.

***

### TEST\_DESIGN\_MODEL\_SCHEMA\_VERSION

> `const` **TEST\_DESIGN\_MODEL\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for persisted `TestDesignModel` projection artifacts.

***

### TEST\_INTELLIGENCE\_CONTRACT\_VERSION

> `const` **TEST\_INTELLIGENCE\_CONTRACT\_VERSION**: `"1.6.0"`

Contract version for the opt-in test-intelligence surface.

***

### TEST\_INTELLIGENCE\_ENV

> `const` **TEST\_INTELLIGENCE\_ENV**: `"FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE"`

Environment variable name that gates test-intelligence features at startup.

***

### TEST\_INTELLIGENCE\_MULTISOURCE\_ENV

> `const` **TEST\_INTELLIGENCE\_MULTISOURCE\_ENV**: `"FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE_MULTISOURCE"`

Environment variable name for the Wave 4 multi-source ingestion gate
(Issue #1431). Strictly nested behind [TEST\_INTELLIGENCE\_ENV](#test_intelligence_env); the
resolver requires both gates _and_ the parent startup option to be enabled
before a job may compose more than one test-design source.

***

### TEST\_INTELLIGENCE\_PROMPT\_TEMPLATE\_VERSION

> `const` **TEST\_INTELLIGENCE\_PROMPT\_TEMPLATE\_VERSION**: `"1.0.0"`

Prompt template version for the test-intelligence prompt family.

***

### TRACEABILITY\_MATRIX\_ARTIFACT\_FILENAME

> `const` **TRACEABILITY\_MATRIX\_ARTIFACT\_FILENAME**: `"traceability-matrix.json"`

Canonical filename for the persisted traceability-matrix artifact.

***

### TRACEABILITY\_MATRIX\_SCHEMA\_VERSION

> `const` **TRACEABILITY\_MATRIX\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted traceability-matrix artifact (Issue #1373).

***

### TRANSFER\_REPORT\_ARTIFACT\_FILENAME

> `const` **TRANSFER\_REPORT\_ARTIFACT\_FILENAME**: `"transfer-report.json"`

Canonical filename for the persisted transfer-report artifact.

***

### TRANSFER\_REPORT\_SCHEMA\_VERSION

> `const` **TRANSFER\_REPORT\_SCHEMA\_VERSION**: `"1.1.0"`

Schema version for the persisted transfer-report artifact (Issue #1372).

***

### VISUAL\_SIDECAR\_RESULT\_ARTIFACT\_FILENAME

> `const` **VISUAL\_SIDECAR\_RESULT\_ARTIFACT\_FILENAME**: `"visual-sidecar-result.json"`

Canonical filename for the persisted visual sidecar result artifact.

***

### VISUAL\_SIDECAR\_RESULT\_SCHEMA\_VERSION

> `const` **VISUAL\_SIDECAR\_RESULT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted multimodal visual sidecar result
artifact emitted by the visual sidecar client (Issue #1386). Bumped
independently from `VISUAL_SIDECAR_SCHEMA_VERSION` (which describes the
sidecar's per-screen output) because this version covers the wrapping
envelope plus capture identities, attempts, and failure classes.

***

### VISUAL\_SIDECAR\_SCHEMA\_VERSION

> `const` **VISUAL\_SIDECAR\_SCHEMA\_VERSION**: `"1.0.0"`

Visual sidecar schema version consumed by the prompt compiler (Issue #1386).

***

### VISUAL\_SIDECAR\_VALIDATION\_REPORT\_ARTIFACT\_FILENAME

> `const` **VISUAL\_SIDECAR\_VALIDATION\_REPORT\_ARTIFACT\_FILENAME**: `"visual-sidecar-validation-report.json"`

Canonical filename for the persisted visual-sidecar validation artifact.

***

### VISUAL\_SIDECAR\_VALIDATION\_REPORT\_SCHEMA\_VERSION

> `const` **VISUAL\_SIDECAR\_VALIDATION\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted visual-sidecar validation report artifact (Issue #1364 / #1386).

***

### WAVE1\_POC\_ATTESTATION\_ARTIFACT\_FILENAME

> `const` **WAVE1\_POC\_ATTESTATION\_ARTIFACT\_FILENAME**: `"wave1-poc-attestation.intoto.json"`

Filename of the persisted in-toto DSSE envelope.

***

### WAVE1\_POC\_ATTESTATION\_BUNDLE\_FILENAME

> `const` **WAVE1\_POC\_ATTESTATION\_BUNDLE\_FILENAME**: `"wave1-poc-attestation.bundle.json"`

Filename of the persisted Sigstore bundle when signing is enabled.

***

### WAVE1\_POC\_ATTESTATION\_BUNDLE\_MEDIA\_TYPE

> `const` **WAVE1\_POC\_ATTESTATION\_BUNDLE\_MEDIA\_TYPE**: `"application/vnd.dev.sigstore.bundle.v0.3+json"`

Sigstore bundle media type — pinned to the v0.3 envelope shape.

***

### WAVE1\_POC\_ATTESTATION\_PAYLOAD\_TYPE

> `const` **WAVE1\_POC\_ATTESTATION\_PAYLOAD\_TYPE**: `"application/vnd.in-toto+json"`

DSSE `payloadType` stamped onto every in-toto attestation. The pre-
authentication encoding (PAE) hashes this value alongside the payload
bytes so it is bound to the signature.

***

### WAVE1\_POC\_ATTESTATION\_PREDICATE\_TYPE

> `const` **WAVE1\_POC\_ATTESTATION\_PREDICATE\_TYPE**: `"https://workspace-dev.figmapipe.dev/test-intelligence/wave1-poc-evidence/v1"`

Predicate type URI identifying the Wave 1 POC evidence shape. Bumped
in lockstep with the schema version when the predicate fields change.

***

### WAVE1\_POC\_ATTESTATION\_SCHEMA\_VERSION

> `const` **WAVE1\_POC\_ATTESTATION\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the in-toto v1 attestation envelope produced per
job by the Wave 1 POC harness. Bumped on any breaking change to the
statement payload, predicate shape, or DSSE encoding.

***

### WAVE1\_POC\_ATTESTATION\_STATEMENT\_TYPE

> `const` **WAVE1\_POC\_ATTESTATION\_STATEMENT\_TYPE**: `"https://in-toto.io/Statement/v1"`

in-toto v1 statement type URI.

***

### WAVE1\_POC\_ATTESTATIONS\_DIRECTORY

> `const` **WAVE1\_POC\_ATTESTATIONS\_DIRECTORY**: `"evidence/attestations"`

Subdirectory under a run dir where attestation envelopes are persisted.

***

### WAVE1\_POC\_EVAL\_REPORT\_ARTIFACT\_FILENAME

> `const` **WAVE1\_POC\_EVAL\_REPORT\_ARTIFACT\_FILENAME**: `"wave1-poc-eval-report.json"` = `"wave1-poc-eval-report.json"`

Filename used for the Wave 1 POC evaluation report artifact.

***

### WAVE1\_POC\_EVAL\_REPORT\_SCHEMA\_VERSION

> `const` **WAVE1\_POC\_EVAL\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the Wave 1 POC evaluation report envelope.

***

### WAVE1\_POC\_EVIDENCE\_MANIFEST\_ARTIFACT\_FILENAME

> `const` **WAVE1\_POC\_EVIDENCE\_MANIFEST\_ARTIFACT\_FILENAME**: `"wave1-poc-evidence-manifest.json"` = `"wave1-poc-evidence-manifest.json"`

Filename used for the Wave 1 POC evidence manifest artifact.

***

### WAVE1\_POC\_EVIDENCE\_MANIFEST\_DIGEST\_FILENAME

> `const` **WAVE1\_POC\_EVIDENCE\_MANIFEST\_DIGEST\_FILENAME**: `"wave1-poc-evidence-manifest.sha256"` = `"wave1-poc-evidence-manifest.sha256"`

Filename used for the Wave 1 POC evidence manifest digest witness.

***

### WAVE1\_POC\_EVIDENCE\_MANIFEST\_SCHEMA\_VERSION

> `const` **WAVE1\_POC\_EVIDENCE\_MANIFEST\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the Wave 1 POC evidence manifest envelope.

***

### WAVE1\_POC\_FIXTURE\_IDS

> `const` **WAVE1\_POC\_FIXTURE\_IDS**: readonly \[`"poc-onboarding"`, `"poc-payment-auth"`\]

Allowed Wave 1 POC fixture identifiers.

`poc-onboarding` — synthetic onboarding-style sign-up flow.
`poc-payment-auth` — synthetic payment + 3-D Secure authorisation flow.

Both fixtures are public, contain only synthetic data, and ship with a
companion visual sidecar fixture so the Figma → Visual Sidecar →
Business Test Intent IR → structured generation chain is exercised
end-to-end against an air-gapped mock LLM.

***

### WAVE1\_POC\_SIGNATURES\_DIRECTORY

> `const` **WAVE1\_POC\_SIGNATURES\_DIRECTORY**: `"evidence/signatures"`

Subdirectory under a run dir where Sigstore signature bundles are persisted.

***

### WAVE4\_PRODUCTION\_READINESS\_EVAL\_REPORT\_ARTIFACT\_FILENAME

> `const` **WAVE4\_PRODUCTION\_READINESS\_EVAL\_REPORT\_ARTIFACT\_FILENAME**: `"wave4-production-readiness-eval-report.json"`

On-disk filename for `Wave4ProductionReadinessEvalReport`.

***

### WAVE4\_PRODUCTION\_READINESS\_EVAL\_REPORT\_SCHEMA\_VERSION

> `const` **WAVE4\_PRODUCTION\_READINESS\_EVAL\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for `Wave4ProductionReadinessEvalReport`.
