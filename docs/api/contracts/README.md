[**workspace-dev**](../README.md)

***

[workspace-dev](../README.md) / contracts

# contracts

## Interfaces

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

[`WorkspaceSubmitAccepted`](#workspacesubmitaccepted).[`jobId`](#jobid-10)

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

> **level**: `"debug"` \| `"info"` \| `"warn"` \| `"error"`

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

###### enabled

> **enabled**: `boolean`

Whether test-intelligence features may be invoked at runtime. Default: false.

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

[`WorkspaceVisualDiffRegion`](#workspacevisualdiffregion).[`name`](#name-2)

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

### ALLOWED\_TEST\_INTELLIGENCE\_MODES

> `const` **ALLOWED\_TEST\_INTELLIGENCE\_MODES**: readonly \[`"deterministic_llm"`, `"offline_eval"`, `"dry_run"`\]

Runtime source-of-truth for allowed test-intelligence modes.

Test intelligence is an opt-in, local-first feature that is SEPARATE from
the `llmCodegenMode` namespace used by the deterministic code generation
pipeline. The two mode namespaces are intentionally isolated: changes to
this array must never affect `ALLOWED_LLM_CODEGEN_MODES`.

***

### ALLOWED\_WORKSPACE\_JOB\_TYPES

> `const` **ALLOWED\_WORKSPACE\_JOB\_TYPES**: readonly \[`"figma_to_code"`, `"figma_to_qc_test_cases"`\]

Runtime source-of-truth for allowed workspace-dev job types.
Keep this array and `WorkspaceJobType` in lockstep.

***

### CONTRACT\_VERSION

> `const` **CONTRACT\_VERSION**: `"3.18.0"`

Current contract version constant.
Must be bumped according to CONTRACT_CHANGELOG.md rules.
Package version alignment is documented in VERSIONING.md.

***

### GENERATED\_TEST\_CASE\_SCHEMA\_VERSION

> `const` **GENERATED\_TEST\_CASE\_SCHEMA\_VERSION**: `"1.0.0"`

Schema version for generated test case payloads.

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
