[**workspace-dev**](../README.md)

***

[workspace-dev](../README.md) / contracts

# contracts

## Interfaces

### BusinessTestIntentIr

Redacted, deterministic test-design IR for a job.

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

##### version

> **version**: `"1.0.0"`

***

### BusinessTestIntentIrSource

Metadata about the input that produced the IR.

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

> **contractVersion**: `"1.0.0"`

##### hashes

> **hashes**: [`CompiledPromptHashes`](#compiledprompthashes)

##### jobId

> **jobId**: `string`

##### modelBinding

> **modelBinding**: [`CompiledPromptModelBinding`](#compiledpromptmodelbinding)

##### payload

> **payload**: `object`

Redacted JSON payload that the model will reason over.

###### intent

> **intent**: [`BusinessTestIntentIr`](#businesstestintentir)

###### visual

> **visual**: [`VisualScreenDescription`](#visualscreendescription)[]

##### policyBundleVersion

> **policyBundleVersion**: `string`

##### promptTemplateVersion

> **promptTemplateVersion**: `"1.0.0"`

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### systemPrompt

> **systemPrompt**: `string`

##### userPrompt

> **userPrompt**: `string`

##### visualBinding

> **visualBinding**: [`CompiledPromptVisualBinding`](#compiledpromptvisualbinding)

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

### DetectedAction

Action/control inferred from a screen (e.g. Submit button).

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

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### DetectedField

Input field inferred from a screen.

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

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

##### type

> **type**: `string`

***

### DetectedNavigation

Navigation edge inferred from prototype links or equivalent.

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

##### targetScreenId

> **targetScreenId**: `string`

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

##### triggerElementId?

> `optional` **triggerElementId?**: `string`

***

### DetectedValidation

Validation rule inferred from design hints.

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

> **contractVersion**: `"1.0.0"`

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

> **refusalCodes**: (`"provider_mismatch"` \| `"no_mapped_test_cases"` \| `"mapping_profile_invalid"` \| `"mode_not_implemented"` \| `"folder_resolution_failed"`)[]

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

> **contractVersion**: `"1.0.0"`

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

### GeneratedTestCase

Single generated test case.

#### Properties

##### assumptions

> **assumptions**: `string`[]

##### audit

> **audit**: [`GeneratedTestCaseAuditMetadata`](#generatedtestcaseauditmetadata)

##### contractVersion

> **contractVersion**: `"1.0.0"`

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

##### reviewState

> **reviewState**: [`GeneratedTestCaseReviewState`](#generatedtestcasereviewstate-1)

##### riskCategory

> **riskCategory**: [`TestCaseRiskCategory`](#testcaseriskcategory)

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

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

> **contractVersion**: `"1.0.0"`

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

> **schemaVersion**: `"1.0.0"`

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

> **schemaVersion**: `"1.0.0"`

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

##### trace

> **trace**: [`IntentTraceRef`](#intenttraceref)

***

### IntentAmbiguity

Ambiguity note attached to a detected element or PII indicator.

#### Properties

##### reason

> **reason**: `string`

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

#### Properties

##### nodeId?

> `optional` **nodeId?**: `string`

##### nodeName?

> `optional` **nodeName?**: `string`

##### nodePath?

> `optional` **nodePath?**: `string`

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

***

### LlmGenerationFailure

Failure outcome with a redacted message and an explicit retryable flag.

#### Properties

##### attempt

> **attempt**: `number`

##### errorClass

> **errorClass**: `"schema_invalid"` \| `"refusal"` \| `"incomplete"` \| `"timeout"` \| `"rate_limited"` \| `"transport"` \| `"image_payload_rejected"`

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

##### imageInputs?

> `optional` **imageInputs?**: readonly [`LlmImageInput`](#llmimageinput)[]

##### jobId

> **jobId**: `string`

##### maxInputTokens?

> `optional` **maxInputTokens?**: `number`

Optional client-side input budget; gateway clients fail closed when exceeded.

##### maxOutputTokens?

> `optional` **maxOutputTokens?**: `number`

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

### QcMappingPreviewArtifact

Aggregate QC mapping preview artifact.

#### Properties

##### contractVersion

> **contractVersion**: `"1.0.0"`

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

SHA-256 hex of the visual sidecar response payload (no raw screenshot).

##### fallbackReason

> **fallbackReason**: [`VisualSidecarFallbackReason`](#visualsidecarfallbackreason)

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

> **contractVersion**: `"1.0.0"`

##### fromState?

> `optional` **fromState?**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"edited"` \| `"exported"` \| `"transferred"`

##### id

> **id**: `string`

Globally unique opaque identifier; generated server-side.

##### jobId

> **jobId**: `string`

##### kind

> **kind**: `"approved"` \| `"rejected"` \| `"review_started"` \| `"note"` \| `"generated"` \| `"edited"` \| `"exported"` \| `"transferred"`

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

> `optional` **toState?**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"edited"` \| `"exported"` \| `"transferred"`

***

### ReviewGateSnapshot

Aggregate per-job review-gate snapshot.

#### Properties

##### approvedCount

> **approvedCount**: `number`

Number of cases currently in `approved` (or `exported`/`transferred`) state.

##### contractVersion

> **contractVersion**: `"1.0.0"`

##### generatedAt

> **generatedAt**: `string`

##### jobId

> **jobId**: `string`

##### needsReviewCount

> **needsReviewCount**: `number`

Number of cases currently in `needs_review` state.

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

Set of distinct reviewer actors that have approved this case.
Empty list when the case is not yet approved or auto-approved by policy.

##### fourEyesEnforced

> **fourEyesEnforced**: `boolean`

Whether the operator profile requires two distinct approvers. Wave 1
always emits `false`; Wave 2 may flip this to gate the export pipeline
on approver-count without changing the schema.

##### lastEventAt

> **lastEventAt**: `string`

##### lastEventId

> **lastEventId**: `string`

Identifier of the most recent event affecting this case.

##### policyDecision

> **policyDecision**: `"approved"` \| `"blocked"` \| `"needs_review"`

##### state

> **state**: `"approved"` \| `"needs_review"` \| `"rejected"` \| `"generated"` \| `"edited"` \| `"exported"` \| `"transferred"`

##### testCaseId

> **testCaseId**: `string`

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

> **contractVersion**: `"1.0.0"`

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

> **contractVersion**: `"1.0.0"`

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

> **outcome**: `"schema_invalid"` \| `"missing_trace"` \| `"missing_expected_results"` \| `"pii_in_test_data"` \| `"missing_negative_or_validation_for_required_field"` \| `"missing_accessibility_case"` \| `"missing_boundary_case"` \| `"duplicate_test_case"` \| `"regulated_risk_review_required"` \| `"ambiguity_review_required"` \| `"qc_mapping_not_exportable"` \| `"low_confidence_review_required"` \| `"open_questions_review_required"` \| `"visual_sidecar_failure"` \| `"visual_sidecar_fallback_used"` \| `"visual_sidecar_low_confidence"` \| `"visual_sidecar_possible_pii"` \| `"visual_sidecar_prompt_injection_text"`

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

### TestCaseValidationIssue

Single semantic / structural validation issue.

#### Properties

##### code

> **code**: `"schema_invalid"` \| `"missing_trace"` \| `"trace_screen_unknown"` \| `"missing_expected_results"` \| `"steps_unordered"` \| `"steps_indices_non_sequential"` \| `"step_action_empty"` \| `"step_action_too_long"` \| `"duplicate_step_index"` \| `"duplicate_test_case_id"` \| `"title_empty"` \| `"objective_empty"` \| `"risk_category_invalid_for_intent"` \| `"qc_mapping_blocking_reasons_missing"` \| `"qc_mapping_exportable_inconsistent"` \| `"quality_signals_confidence_out_of_range"` \| `"quality_signals_coverage_unknown_id"` \| `"test_data_pii_detected"` \| `"test_data_unredacted_value"` \| `"preconditions_pii_detected"` \| `"expected_results_pii_detected"` \| `"assumptions_excessive"` \| `"open_questions_excessive"` \| `"ambiguity_without_review_state"`

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

> **contractVersion**: `"1.0.0"`

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

> `optional` **errorClass?**: `"schema_invalid"` \| `"refusal"` \| `"incomplete"` \| `"timeout"` \| `"rate_limited"` \| `"transport"` \| `"image_payload_rejected"` \| `"schema_invalid_response"`

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

> **failureClass**: `"primary_unavailable"` \| `"primary_quota_exceeded"` \| `"both_sidecars_failed"` \| `"schema_invalid_response"` \| `"image_payload_too_large"` \| `"image_mime_unsupported"` \| `"duplicate_screen_id"` \| `"empty_screen_capture_set"`

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

> **contractVersion**: `"1.0.0"`

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

> **contractVersion**: `"1.0.0"`

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

### Wave1PocEvalFailure

Failure record describing a single threshold breach.

#### Properties

##### actual

> **actual**: `number`

Numeric or boolean observed value (encoded as number for comparators).

##### message

> **message**: `string`

##### rule

> **rule**: `"visual_sidecar_blocked"` \| `"min_trace_coverage_fields"` \| `"min_trace_coverage_actions"` \| `"min_trace_coverage_validations"` \| `"min_qc_mapping_exportable_fraction"` \| `"max_duplicate_similarity"` \| `"min_expected_results_per_case"` \| `"min_approved_cases"` \| `"policy_blocked"` \| `"validation_blocked"` \| `"export_refused"`

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

##### maxObservedDuplicateSimilarity

> **maxObservedDuplicateSimilarity**: `number`

##### minObservedExpectedResultsPerCase

> **minObservedExpectedResultsPerCase**: `number`

##### needsReviewCases

> **needsReviewCases**: `number`

##### policyBlocked

> **policyBlocked**: `boolean`

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

> **testIntelligenceContractVersion**: `"1.0.0"`

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

> **generatedTestCaseSchemaVersion**: `"1.0.0"`

##### imagePayloadSentToTestGeneration

> **imagePayloadSentToTestGeneration**: `false`

Hard invariant: the structured-test-case generator deployment never
received an image payload during the run.

##### inputHash

> **inputHash**: `string`

##### jobId

> **jobId**: `string`

##### modelDeployments

> **modelDeployments**: `object`

Identities of the deployments behind the run.

###### testGeneration

> **testGeneration**: `string`

###### visualFallback?

> `optional` **visualFallback?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

###### visualPrimary?

> `optional` **visualPrimary?**: `"llama-4-maverick-vision"` \| `"phi-4-multimodal-poc"` \| `"mock"` \| `"none"`

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

##### rawScreenshotsIncluded

> **rawScreenshotsIncluded**: `false`

Hard invariant: no raw screenshot bytes leak into export artifacts.

##### redactionPolicyVersion

> **redactionPolicyVersion**: `"1.0.0"`

##### schemaHash

> **schemaHash**: `string`

##### schemaVersion

> **schemaVersion**: `"1.0.0"`

##### testIntelligenceContractVersion

> **testIntelligenceContractVersion**: `"1.0.0"`

Test-intelligence subsurface contract version.

##### visualSidecar?

> `optional` **visualSidecar?**: [`Wave1PocEvidenceVisualSidecarSummary`](#wave1pocevidencevisualsidecarsummary)

Direct visual-sidecar evidence summary when the opt-in sidecar path ran.

##### visualSidecarSchemaVersion

> **visualSidecarSchemaVersion**: `"1.0.0"`

***

### Wave1PocEvidenceVerificationResult

Result of `verifyWave1PocEvidenceManifest` against a directory of artifacts.
Determines whether ALL attested artifacts still hash to the values stored
in the manifest. Any mismatch fails the verification fail-closed.

#### Properties

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

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`jobId`](#jobid-27)

##### pasteDeltaSummary?

> `optional` **pasteDeltaSummary?**: [`WorkspacePasteDeltaSummary`](#workspacepastedeltasummary)

Per-paste delta summary computed at submit time for Figma paste imports.
Present only when `figmaSourceMode === "figma_paste" | "figma_plugin"` and diff succeeded.

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`pasteDeltaSummary`](#pastedeltasummary-3)

##### sessionId

> **sessionId**: `string`

##### sourceJobId?

> `optional` **sourceJobId?**: `string`

##### status

> **status**: `"queued"`

###### Inherited from

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`status`](#status-12)

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

> **level**: `"error"` \| `"debug"` \| `"info"` \| `"warn"`

##### message

> **message**: `string`

##### stage?

> `optional` **stage?**: [`WorkspaceJobStageName`](#workspacejobstagename-1)

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

Run static UI validation in validate.project. Default: false

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

###### reviewBearerToken?

> `optional` **reviewBearerToken?**: `string`

Bearer token accepted by the Inspector test-intelligence review-gate
write routes (`POST /workspace/test-intelligence/review/...`). When
omitted or blank, review writes fail closed with `503` until the
operator configures a token. Reads do not require this token.

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

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`name`](#name-3)

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

### DryRunFolderResolutionState

> **DryRunFolderResolutionState** = *typeof* [`ALLOWED_DRY_RUN_FOLDER_RESOLUTION_STATES`](#allowed_dry_run_folder_resolution_states)\[`number`\]

***

### DryRunRefusalCode

> **DryRunRefusalCode** = *typeof* [`ALLOWED_DRY_RUN_REFUSAL_CODES`](#allowed_dry_run_refusal_codes)\[`number`\]

***

### ExportArtifactContentType

> **ExportArtifactContentType** = *typeof* [`ALLOWED_EXPORT_ARTIFACT_CONTENT_TYPES`](#allowed_export_artifact_content_types)\[`number`\]

***

### ExportRefusalCode

> **ExportRefusalCode** = *typeof* [`ALLOWED_EXPORT_REFUSAL_CODES`](#allowed_export_refusal_codes)\[`number`\]

***

### GeneratedTestCaseReviewState

> **GeneratedTestCaseReviewState** = `"draft"` \| `"auto_approved"` \| `"needs_review"` \| `"rejected"`

Review state at the moment the test case is emitted.

***

### IntentProvenance

> **IntentProvenance** = `"figma_node"` \| `"visual_sidecar"` \| `"reconciled"`

Where a detected element came from during reconciliation.

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

### LlmGenerationResult

> **LlmGenerationResult** = [`LlmGenerationSuccess`](#llmgenerationsuccess) \| [`LlmGenerationFailure`](#llmgenerationfailure)

Discriminated union returned by `LlmGatewayClient.generate`.

***

### LlmReasoningEffort

> **LlmReasoningEffort** = `"low"` \| `"medium"` \| `"high"`

Reasoning-effort hint forwarded only when `reasoningEffortSupport` is true.

***

### PiiKind

> **PiiKind** = `"iban"` \| `"bic"` \| `"pan"` \| `"tax_id"` \| `"email"` \| `"phone"` \| `"full_name"`

Known PII-like categories detected in mock form data.

***

### PiiMatchLocation

> **PiiMatchLocation** = `"field_label"` \| `"field_default_value"` \| `"screen_text"` \| `"action_label"` \| `"trace_node_name"` \| `"trace_node_path"` \| `"screen_name"` \| `"screen_path"` \| `"validation_rule"` \| `"navigation_target"`

Location within the input that held a PII-like match.

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

### Wave1PocEvidenceArtifactCategory

> **Wave1PocEvidenceArtifactCategory** = `"intent"` \| `"validation"` \| `"review"` \| `"export"` \| `"manifest"` \| `"visual_sidecar"`

Categorisation of an artifact attested by the evidence manifest.

***

### Wave1PocFixtureId

> **Wave1PocFixtureId** = *typeof* [`WAVE1_POC_FIXTURE_IDS`](#wave1_poc_fixture_ids)\[`number`\]

Identifier of a Wave 1 POC fixture.

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

### ALLOWED\_DRY\_RUN\_FOLDER\_RESOLUTION\_STATES

> `const` **ALLOWED\_DRY\_RUN\_FOLDER\_RESOLUTION\_STATES**: readonly \[`"resolved"`, `"missing"`, `"simulated"`, `"invalid_path"`\]

Allowed states of a target-folder resolution attempt under `dry_run`.

***

### ALLOWED\_DRY\_RUN\_REFUSAL\_CODES

> `const` **ALLOWED\_DRY\_RUN\_REFUSAL\_CODES**: readonly \[`"no_mapped_test_cases"`, `"mapping_profile_invalid"`, `"provider_mismatch"`, `"mode_not_implemented"`, `"folder_resolution_failed"`\]

Allowed reasons the QC adapter may refuse to produce a dry-run report.

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

> `const` **ALLOWED\_LLM\_GATEWAY\_ERROR\_CLASSES**: readonly \[`"refusal"`, `"schema_invalid"`, `"incomplete"`, `"timeout"`, `"rate_limited"`, `"transport"`, `"image_payload_rejected"`\]

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

### ALLOWED\_QC\_ADAPTER\_MODES

> `const` **ALLOWED\_QC\_ADAPTER\_MODES**: readonly \[`"export_only"`, `"dry_run"`, `"api_transfer"`\]

Allowed transfer modes recognised by the QC adapter façade.

- `export_only` — produce on-disk artifacts; no QC API touched.
- `dry_run` — validate target mapping (folder, fields, schema) without
  creating tests in the QC tool.
- `api_transfer` — placeholder for the future production transfer path;
  the dry-run adapter must throw `mode_not_implemented` for this mode.

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

### ALLOWED\_REVIEW\_EVENT\_KINDS

> `const` **ALLOWED\_REVIEW\_EVENT\_KINDS**: readonly \[`"generated"`, `"review_started"`, `"approved"`, `"rejected"`, `"edited"`, `"exported"`, `"transferred"`, `"note"`\]

Allowed event kinds appended to the review-gate event log.

***

### ALLOWED\_REVIEW\_STATES

> `const` **ALLOWED\_REVIEW\_STATES**: readonly \[`"generated"`, `"needs_review"`, `"approved"`, `"rejected"`, `"edited"`, `"exported"`, `"transferred"`\]

Allowed lifecycle states for a generated test case under review.

***

### ALLOWED\_TEST\_CASE\_POLICY\_DECISIONS

> `const` **ALLOWED\_TEST\_CASE\_POLICY\_DECISIONS**: readonly \[`"approved"`, `"blocked"`, `"needs_review"`\]

Allowed policy-gate decisions (Issue #1364).

- `approved` — case may proceed to review/export as-is.
- `blocked` — case must not reach review or export.
- `needs_review` — case must be reviewed manually before export.

***

### ALLOWED\_TEST\_CASE\_POLICY\_OUTCOMES

> `const` **ALLOWED\_TEST\_CASE\_POLICY\_OUTCOMES**: readonly \[`"missing_trace"`, `"missing_expected_results"`, `"pii_in_test_data"`, `"missing_negative_or_validation_for_required_field"`, `"missing_accessibility_case"`, `"missing_boundary_case"`, `"schema_invalid"`, `"duplicate_test_case"`, `"regulated_risk_review_required"`, `"ambiguity_review_required"`, `"qc_mapping_not_exportable"`, `"low_confidence_review_required"`, `"open_questions_review_required"`, `"visual_sidecar_failure"`, `"visual_sidecar_fallback_used"`, `"visual_sidecar_low_confidence"`, `"visual_sidecar_possible_pii"`, `"visual_sidecar_prompt_injection_text"`\]

Allowed policy outcome codes attached to a single decision row.
Visual-sidecar codes (`visual_*`) come from the multimodal sidecar
gating per the Issue #1364 / #1386 update.

***

### ALLOWED\_TEST\_CASE\_VALIDATION\_ISSUE\_CODES

> `const` **ALLOWED\_TEST\_CASE\_VALIDATION\_ISSUE\_CODES**: readonly \[`"schema_invalid"`, `"missing_trace"`, `"trace_screen_unknown"`, `"missing_expected_results"`, `"steps_unordered"`, `"steps_indices_non_sequential"`, `"step_action_empty"`, `"step_action_too_long"`, `"duplicate_step_index"`, `"duplicate_test_case_id"`, `"title_empty"`, `"objective_empty"`, `"risk_category_invalid_for_intent"`, `"qc_mapping_blocking_reasons_missing"`, `"qc_mapping_exportable_inconsistent"`, `"quality_signals_confidence_out_of_range"`, `"quality_signals_coverage_unknown_id"`, `"test_data_pii_detected"`, `"test_data_unredacted_value"`, `"preconditions_pii_detected"`, `"expected_results_pii_detected"`, `"assumptions_excessive"`, `"open_questions_excessive"`, `"ambiguity_without_review_state"`\]

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

### BUSINESS\_TEST\_INTENT\_IR\_SCHEMA\_VERSION

> `const` **BUSINESS\_TEST\_INTENT\_IR\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for `BusinessTestIntentIr` artifacts.

***

### CONTRACT\_VERSION

> `const` **CONTRACT\_VERSION**: `"3.28.0"`

Current contract version constant.
Must be bumped according to CONTRACT_CHANGELOG.md rules.
Package version alignment is documented in VERSIONING.md.

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

### GENERATED\_TEST\_CASE\_SCHEMA\_VERSION

> `const` **GENERATED\_TEST\_CASE\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for generated test case payloads.

***

### GENERATED\_TESTCASES\_ARTIFACT\_FILENAME

> `const` **GENERATED\_TESTCASES\_ARTIFACT\_FILENAME**: `"generated-testcases.json"`

Canonical filename for the persisted test-case payload accepted into review/export.

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

Contract version for the role-separated LLM gateway client surface (Issue #1363).

***

### MAX\_VISUAL\_SIDECAR\_INPUT\_BYTES

> `const` **MAX\_VISUAL\_SIDECAR\_INPUT\_BYTES**: `number`

Maximum decoded byte size of a single visual sidecar capture. The bound
is enforced AFTER base64 decoding (i.e. on the actual image bytes the
gateway would forward). Five MiB matches the conservative ceiling Azure
OpenAI imposes on multimodal payloads.

***

### OPENTEXT\_ALM\_REFERENCE\_PROFILE\_ID

> `const` **OPENTEXT\_ALM\_REFERENCE\_PROFILE\_ID**: `"opentext-alm-default"`

Built-in OpenText ALM reference export profile id (Wave 1).

***

### OPENTEXT\_ALM\_REFERENCE\_PROFILE\_VERSION

> `const` **OPENTEXT\_ALM\_REFERENCE\_PROFILE\_VERSION**: `"1.0.0"`

Version stamp for the built-in OpenText ALM reference export profile.

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

### TEST\_CASE\_COVERAGE\_REPORT\_ARTIFACT\_FILENAME

> `const` **TEST\_CASE\_COVERAGE\_REPORT\_ARTIFACT\_FILENAME**: `"coverage-report.json"`

Canonical filename for the persisted coverage / quality-signals artifact.

***

### TEST\_CASE\_COVERAGE\_REPORT\_SCHEMA\_VERSION

> `const` **TEST\_CASE\_COVERAGE\_REPORT\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for the persisted coverage / quality-signals report artifact (Issue #1364).

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

### TEST\_INTELLIGENCE\_CONTRACT\_VERSION

> `const` **TEST\_INTELLIGENCE\_CONTRACT\_VERSION**: `"1.0.0"`

Contract version for the opt-in test-intelligence surface.

***

### TEST\_INTELLIGENCE\_ENV

> `const` **TEST\_INTELLIGENCE\_ENV**: `"FIGMAPIPE_WORKSPACE_TEST_INTELLIGENCE"`

Environment variable name that gates test-intelligence features at startup.

***

### TEST\_INTELLIGENCE\_PROMPT\_TEMPLATE\_VERSION

> `const` **TEST\_INTELLIGENCE\_PROMPT\_TEMPLATE\_VERSION**: `"1.0.0"`

Prompt template version for the test-intelligence prompt family.

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
