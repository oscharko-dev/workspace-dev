/**
 * workspace-dev — Public contracts for autonomous REST + deterministic generation.
 *
 * These types define the public API surface for workspace-dev consumers.
 * They must not import from internal services.
 *
 * Contract version: 3.18.0
 * See CONTRACT_CHANGELOG.md for contract change history and VERSIONING.md for
 * package-versus-contract versioning policy.
 */

/**
 * Runtime source-of-truth list of allowed Figma source modes.
 * Keep this array and `WorkspaceFigmaSourceMode` in lockstep;
 * `submit-mode-parity.test.ts` enforces that compile-time and
 * runtime agree.
 */
export const ALLOWED_FIGMA_SOURCE_MODES = [
  "rest",
  "hybrid",
  "local_json",
  "figma_paste",
  "figma_plugin",
] as const;

/** Allowed Figma source modes for workspace-dev. */
export type WorkspaceFigmaSourceMode =
  (typeof ALLOWED_FIGMA_SOURCE_MODES)[number];

/** Source modes used to record replayable import sessions. */
export type WorkspaceImportSessionSourceMode =
  | WorkspaceFigmaSourceMode
  | "figma_url";

/** Import intent detected by the client-side paste classifier. */
export type WorkspaceImportIntent =
  | "FIGMA_JSON_NODE_BATCH"
  | "FIGMA_JSON_DOC"
  | "FIGMA_PLUGIN_ENVELOPE"
  | "RAW_CODE_OR_TEXT"
  | "UNKNOWN";

/** Structural classification of a per-paste delta diff. */
export type WorkspacePasteDeltaStrategy =
  | "baseline_created"
  | "no_changes"
  | "delta"
  | "structural_break";

/** Import mode for a Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold. */
export type WorkspaceImportMode = "full" | "delta" | "auto";

export type WorkspaceImportSessionScope = "all" | "partial";

/** Summary of the per-paste delta computation. Surfaced on JobResult when Figma paste import is used. */
export interface WorkspacePasteDeltaSummary {
  /** Mode ultimately used by the server. `auto_*` variants are returned when the client asked for "auto". */
  mode: "full" | "delta" | "auto_resolved_to_full" | "auto_resolved_to_delta";
  /** Structural classification of the tree diff. */
  strategy: WorkspacePasteDeltaStrategy;
  /** Total nodes observed in the current paste. */
  totalNodes: number;
  /** Nodes whose subtree hash matched the prior manifest (eligible for reuse). */
  nodesReused: number;
  /** Nodes that required reprocessing (added + updated + all descendants of updated). */
  nodesReprocessed: number;
  /** Diff ratio used to choose mode when `auto`. 0 = identical, 1 = all new. */
  structuralChangeRatio: number;
  /** Stable per-component identity key (sha256 prefix). Useful for correlating future pastes. */
  pasteIdentityKey: string;
  /** True when the server had no prior manifest for this identity (first paste). */
  priorManifestMissing: boolean;
}

/**
 * Runtime source-of-truth list of allowed codegen modes.
 * Keep this array and `WorkspaceLlmCodegenMode` in lockstep;
 * `submit-mode-parity.test.ts` enforces that compile-time and
 * runtime agree.
 */
export const ALLOWED_LLM_CODEGEN_MODES = ["deterministic"] as const;

/** Allowed codegen modes for workspace-dev. */
export type WorkspaceLlmCodegenMode =
  (typeof ALLOWED_LLM_CODEGEN_MODES)[number];

/** Theme brand policy applied during IR token derivation. */
export type WorkspaceBrandTheme = "derived" | "sparkasse";

/** Router mode for generated React application shells. */
export type WorkspaceRouterMode = "browser" | "hash";

/** Supported visual quality reference sources. */
export type WorkspaceVisualQualityReferenceMode =
  | "figma_api"
  | "frozen_fixture";

/** Supported browser engines for visual quality capture. */
export type WorkspaceVisualBrowserName = "chromium" | "firefox" | "webkit";

/** Explicit frozen visual reference files used by validate.project. */
export interface WorkspaceVisualQualityFrozenReference {
  imagePath: string;
  metadataPath: string;
}

/** Optional overrides for the combined visual/performance quality weights. */
export interface WorkspaceCompositeQualityWeightsInput {
  visual?: number;
  performance?: number;
}

/** Normalized weights for the combined visual/performance quality score. */
export interface WorkspaceCompositeQualityWeights {
  visual: number;
  performance: number;
}

/** Output format for operational runtime logs. */
export type WorkspaceLogFormat = "text" | "json";

/** Form handling mode for generated interactive forms. */
export type WorkspaceFormHandlingMode = "react_hook_form" | "legacy_use_state";

/** Source that produced a manual or imported component mapping rule. */
export type WorkspaceComponentMappingSource =
  | "local_override"
  | "code_connect_import";

/** Submit-time or regeneration-time component mapping override rule. */
export interface WorkspaceComponentMappingRule {
  id?: number;
  boardKey: string;
  nodeId?: string;
  nodeNamePattern?: string;
  canonicalComponentName?: string;
  storybookTier?: string;
  figmaLibrary?: string;
  semanticType?: string;
  componentName: string;
  importPath: string;
  propContract?: Record<string, unknown>;
  priority: number;
  source: WorkspaceComponentMappingSource;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Runtime status values for asynchronous workspace jobs. */
export type WorkspaceJobRuntimeStatus =
  | "queued"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "canceled";

/** Stage status values for each pipeline stage. */
export type WorkspaceJobStageStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

/** Structured stage names exposed by workspace-dev. */
export type WorkspaceJobStageName =
  | "figma.source"
  | "ir.derive"
  | "template.prepare"
  | "codegen.generate"
  | "validate.project"
  | "repro.export"
  | "git.pr";

/** Retryable stage boundaries supported by persisted-artifact retry jobs. */
export type WorkspaceJobRetryStage =
  | "figma.source"
  | "ir.derive"
  | "template.prepare"
  | "codegen.generate";

/** Inspector-facing terminal outcome for a job. */
export type WorkspaceJobOutcome = "success" | "partial" | "failed";

/** Backend fallback mode surfaced to the inspector. */
export type WorkspaceJobFallbackMode = "none" | "rest" | "hybrid_rest";

/** Configuration for starting a workspace-dev server instance. */
export interface WorkspaceStartOptions {
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
  /** Port to bind to. Default: 1983 */
  port?: number;
  /** Project-specific working directory. Default: process.cwd() */
  workDir?: string;
  /** Output root relative to workDir or as absolute path. Default: ".workspace-dev" */
  outputRoot?: string;
  /** Startup cleanup TTL for stale tmp-figma-paste JSON files in milliseconds. Default: 86400000 */
  figmaPasteTempTtlMs?: number;
  /** Figma request timeout in milliseconds. Default: 30000 */
  figmaRequestTimeoutMs?: number;
  /** Figma retry attempts. Default: 3 */
  figmaMaxRetries?: number;
  /** Consecutive transient failures before the Figma REST circuit breaker opens. Default: 3 */
  figmaCircuitBreakerFailureThreshold?: number;
  /** Duration in milliseconds that the Figma REST circuit breaker stays open before a probe request is allowed. Default: 30000 */
  figmaCircuitBreakerResetTimeoutMs?: number;
  /** Bootstrap depth for large-board staged fetch. Default: 5 */
  figmaBootstrapDepth?: number;
  /** Candidate node batch size for staged fetch. Default: 6 */
  figmaNodeBatchSize?: number;
  /** Number of concurrent staged /nodes fetch workers. Default: 3 */
  figmaNodeFetchConcurrency?: number;
  /** Enable adaptive node batch splitting on repeated oversized responses. Default: true */
  figmaAdaptiveBatchingEnabled?: boolean;
  /** Maximum staged screen candidates to fetch. Default: 40 */
  figmaMaxScreenCandidates?: number;
  /** Optional case-insensitive regex used to include staged screen candidates by name. */
  figmaScreenNamePattern?: string;
  /** Enable file-system cache for figma.source fetches. Default: true */
  figmaCacheEnabled?: boolean;
  /** Cache TTL for figma.source entries in milliseconds. Default: 900000 */
  figmaCacheTtlMs?: number;
  /** Maximum Figma JSON response bytes accepted before parse fallback/failure. Default: 67108864 */
  maxJsonResponseBytes?: number;
  /** Maximum IR cache entry count before eviction. Default: 50 */
  maxIrCacheEntries?: number;
  /** Maximum IR cache bytes retained on disk before eviction. Default: 134217728 */
  maxIrCacheBytes?: number;
  /** Path to icon fallback mapping file (JSON). Default: <outputRoot>/icon-fallback-map.json */
  iconMapFilePath?: string;
  /** Path to design-system mapping file (JSON). Default: <outputRoot>/design-system.json */
  designSystemFilePath?: string;
  /** Enable Figma image asset export to generated-app/public/images. Default: true */
  exportImages?: boolean;
  /** Maximum IR elements per screen before deterministic truncation. Default: 1200 */
  figmaScreenElementBudget?: number;
  /** Configured baseline depth limit for dynamic IR child traversal. Default: 14 */
  figmaScreenElementMaxDepth?: number;
  /** Token brand policy used when deriving IR tokens. Default: "derived" */
  brandTheme?: WorkspaceBrandTheme;
  /** Optional Sparkasse design-token file used only when `brandTheme="sparkasse"`; when omitted, built-in defaults are used. */
  sparkasseTokensFilePath?: string;
  /** Locale used for deterministic select-option number derivation. Default: "de-DE" */
  generationLocale?: string;
  /** Router mode for generated App.tsx shell. Default: "browser" */
  routerMode?: WorkspaceRouterMode;
  /** Timeout for external commands (pnpm/git) in milliseconds. Default: 900000 */
  commandTimeoutMs?: number;
  /** Maximum retained stdout bytes per external command before truncation/spooling. Default: 1048576 */
  commandStdoutMaxBytes?: number;
  /** Maximum retained stderr bytes per external command before truncation/spooling. Default: 1048576 */
  commandStderrMaxBytes?: number;
  /** Maximum structured diagnostics retained per pipeline error. Default: 25 */
  pipelineDiagnosticMaxCount?: number;
  /** Maximum message/suggestion characters retained per structured diagnostic. Default: 320 */
  pipelineDiagnosticTextMaxLength?: number;
  /** Maximum object keys retained per structured diagnostic details object. Default: 30 */
  pipelineDiagnosticDetailsMaxKeys?: number;
  /** Maximum array items retained per structured diagnostic details array. Default: 20 */
  pipelineDiagnosticDetailsMaxItems?: number;
  /** Maximum nesting depth retained when sanitizing structured diagnostic details. Default: 4 */
  pipelineDiagnosticDetailsMaxDepth?: number;
  /** Maximum validation retry attempts for lint/typecheck/build correction loops. Default: 3 */
  maxValidationAttempts?: number;
  /** Run lint auto-fix during validate.project before lint/typecheck/build. Default: true */
  enableLintAutofix?: boolean;
  /** Run perf validation during validate.project. Default: false */
  enablePerfValidation?: boolean;
  /** Run static UI validation in validate.project. Default: false */
  enableUiValidation?: boolean;
  /** Run visual quality validation in validate.project. Default: false */
  enableVisualQualityValidation?: boolean;
  /** Reference source for visual quality validation. Default: "figma_api" when enabled */
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  /** Viewport width used when capturing generated output for visual quality validation. Default: 1280 */
  visualQualityViewportWidth?: number;
  /** Viewport height used when capturing generated output for visual quality validation. Default: 800 */
  visualQualityViewportHeight?: number;
  /** Device pixel ratio used when capturing generated output for visual quality validation. Default: 1 */
  visualQualityDeviceScaleFactor?: number;
  /** Browser engines used when capturing generated output for visual quality validation. Default: ["chromium"] */
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  /** Weight overrides used when computing the combined visual/performance quality score. Default: visual 0.6, performance 0.4 */
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** Run generated-project unit tests in validate.project. Default: false */
  enableUnitTestValidation?: boolean;
  /** Make generated-project unit test failures non-fatal. When true, test results are recorded but failures do not throw. Default: false */
  unitTestIgnoreFailure?: boolean;
  /** Prefer offline package resolution during generated-project install. Default: true */
  installPreferOffline?: boolean;
  /** Skip package installation in validate.project; requires existing node_modules. Default: false */
  skipInstall?: boolean;
  /** Maximum number of jobs that may run concurrently. Default: 1 */
  maxConcurrentJobs?: number;
  /** Maximum number of queued jobs waiting for execution before backpressure rejects submit. Default: 20 */
  maxQueuedJobs?: number;
  /** Maximum retained job log entries. Default: 300 */
  logLimit?: number;
  /** Maximum on-disk bytes for job-owned roots before the pipeline fails. Default: 536870912 */
  maxJobDiskBytes?: number;
  /** Output format for operational runtime logs. Default: "text" */
  logFormat?: WorkspaceLogFormat;
  /** Maximum accepted job submissions and import-session event writes per minute for a single client IP, enforced separately per route family. Use 0 to disable. Default: 10 */
  rateLimitPerMinute?: number;
  /** Maximum graceful shutdown drain time in milliseconds before remaining connections are terminated. Default: 10000 */
  shutdownTimeoutMs?: number;
  /**
   * Bearer token accepted for `POST /workspace/import-sessions/:id/events`.
   * When omitted, import-session event writes fail closed.
   */
  importSessionEventBearerToken?: string;
  /** Enable local preview export and serving. Default: true */
  enablePreview?: boolean;
  /** Optional custom fetch implementation (for tests or custom runtimes). */
  fetchImpl?: typeof fetch;
  /**
   * @deprecated Reserved for backward compatibility with callers that reuse
   * submit-time option objects. Isolated child startup ignores this field and
   * it does not define any server-start target-root behavior.
   */
  targetPath?: string;
}

/** Status of a running workspace-dev instance. */
export interface WorkspaceStatus {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  uptimeMs: number;
  outputRoot: string;
  previewEnabled: boolean;
}

/** Submission payload accepted by workspace-dev. */
export interface WorkspaceJobInput {
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaAccessToken?: string;
  figmaJsonPath?: string;
  figmaJsonPayload?: string;
  /** Optional import mode for Figma paste. `"auto"` lets the server pick delta vs full based on diff threshold. */
  importMode?: WorkspaceImportMode;
  /** Optional server-side generation scope. When present, only the selected IR nodes are kept for output generation. */
  selectedNodeIds?: string[];
  storybookStaticDir?: string;
  customerProfilePath?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  enableVisualQualityValidation?: boolean;
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  visualQualityViewportWidth?: number;
  visualQualityViewportHeight?: number;
  visualQualityDeviceScaleFactor?: number;
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  visualQualityFrozenReference?: WorkspaceVisualQualityFrozenReference;
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** @deprecated Use visual quality settings instead. */
  visualAudit?: WorkspaceVisualAuditInput;
  repoUrl?: string;
  repoToken?: string;
  enableGitPr?: boolean;
  figmaSourceMode?: WorkspaceFigmaSourceMode;
  llmCodegenMode?: WorkspaceLlmCodegenMode;
  projectName?: string;
  targetPath?: string;
  brandTheme?: WorkspaceBrandTheme;
  generationLocale?: string;
  formHandlingMode?: WorkspaceFormHandlingMode;
  importIntent?: WorkspaceImportIntent;
  originalIntent?: WorkspaceImportIntent;
  intentCorrected?: boolean;
}

/** Public subset of request metadata stored for a job (secrets excluded). */
export interface WorkspaceJobRequestMetadata {
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaJsonPath?: string;
  selectedNodeIds?: string[];
  storybookStaticDir?: string;
  customerProfilePath?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  enableVisualQualityValidation: boolean;
  visualQualityReferenceMode?: WorkspaceVisualQualityReferenceMode;
  visualQualityViewportWidth?: number;
  visualQualityViewportHeight?: number;
  visualQualityDeviceScaleFactor?: number;
  visualQualityBrowsers?: WorkspaceVisualBrowserName[];
  visualQualityFrozenReference?: WorkspaceVisualQualityFrozenReference;
  compositeQualityWeights?: WorkspaceCompositeQualityWeightsInput;
  /** @deprecated Compatibility alias for legacy callers. */
  visualAudit?: WorkspaceVisualAuditInput;
  repoUrl?: string;
  enableGitPr: boolean;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  projectName?: string;
  targetPath?: string;
  brandTheme: WorkspaceBrandTheme;
  generationLocale: string;
  formHandlingMode: WorkspaceFormHandlingMode;
  importMode?: WorkspaceImportMode;
  importIntent?: WorkspaceImportIntent;
  originalIntent?: WorkspaceImportIntent;
  intentCorrected?: boolean;
  requestSourceMode?: WorkspaceImportSessionSourceMode;
}

/** Submission payload for Test Space v1 business test-case generation. */
export interface WorkspaceTestSpaceRunRequest {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaAccessToken?: string;
  figmaJsonPath?: string;
  figmaJsonPayload?: string;
  testSuiteName?: string;
  businessContext: {
    summary: string;
    productName?: string;
    audience?: string;
    goals?: string[];
    constraints?: string[];
    notes?: string;
  };
}

/** Public request summary for completed Test Space runs and persisted artifacts. */
export interface WorkspaceTestSpaceRunRequestSummary {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  figmaFileKey?: string;
  figmaNodeId?: string;
  figmaJsonPayloadPresent: boolean;
  figmaJsonPayloadSha256?: string;
  figmaJsonPathPresent: boolean;
  figmaJsonPathBasename?: string;
  testSuiteName?: string;
  businessContext: {
    summary: string;
    productName?: string;
    audience?: string;
    goals?: string[];
    constraints?: string[];
    notes?: string;
  };
}

/** Single executable step within a generated Test Space case. */
export interface WorkspaceTestSpaceStep {
  order: number;
  action: string;
  expectedResult: string;
}

/** Generated business test case derived from Figma and business context. */
export interface WorkspaceTestSpaceCase {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  type: "happy_path" | "validation" | "edge_case" | "regression";
  preconditions?: string[];
  steps: WorkspaceTestSpaceStep[];
  expectedResult: string;
  coverageTags: string[];
}

/** Coverage gap or risk finding produced during Test Space generation. */
export interface WorkspaceTestSpaceCoverageFinding {
  id: string;
  severity: "low" | "medium" | "high";
  message: string;
  recommendation: string;
  relatedCaseIds: string[];
}

/** Markdown artifact describing the generated Test Space run. */
export interface WorkspaceTestSpaceMarkdownArtifact {
  path: string;
  title: string;
  contentType: "text/markdown; charset=utf-8";
  bytes: number;
  lineCount: number;
}

/** QC mapping draft prepared for a future OpenText ALM/QC write boundary. */
export interface WorkspaceTestSpaceQcMappingDraft {
  connector: "opentext-alm-qc";
  writeEnabled: false;
  projectName: string;
  testPlanName: string;
  testSetName: string;
  caseMappings: Array<{
    caseId: string;
    title: string;
    priority: "P0" | "P1" | "P2";
    stepCount: number;
    coverageTags: string[];
  }>;
}

/** Public result for a completed Test Space run. */
export interface WorkspaceTestSpaceRun {
  runId: string;
  status: "completed";
  modelDeployment: string;
  createdAt: string;
  updatedAt: string;
  request: WorkspaceTestSpaceRunRequestSummary;
  figmaSummary: Record<string, unknown>;
  testCases: WorkspaceTestSpaceCase[];
  coverageFindings: WorkspaceTestSpaceCoverageFinding[];
  markdownArtifact: WorkspaceTestSpaceMarkdownArtifact;
  qcMappingDraft: WorkspaceTestSpaceQcMappingDraft;
  artifacts: {
    root: string;
    inputJson: string;
    figmaSummaryJson: string;
    llmRequestRedactedJson: string;
    llmResponseRawJson: string;
    testCasesJson: string;
    testCasesMarkdown: string;
    auditLogJsonl: string;
  };
}

export type WorkspaceImportSessionStatus =
  | "imported"
  | "reviewing"
  | "approved"
  | "applied"
  | "rejected";

export type WorkspaceImportSessionEventKind =
  | "imported"
  | "review_started"
  | "approved"
  | "applied"
  | "rejected"
  | "apply_blocked"
  | "note";

export interface WorkspaceImportSessionEvent {
  id: string;
  sessionId: string;
  kind: WorkspaceImportSessionEventKind;
  at: string;
  actor?: string;
  note?: string;
  metadata?: Record<string, string | number | boolean | null>;
  sequence?: number;
}

export interface WorkspaceImportSessionEventsResponse {
  events: WorkspaceImportSessionEvent[];
}

export interface WorkspaceImportSession {
  id: string;
  jobId: string;
  sourceMode: WorkspaceImportSessionSourceMode;
  fileKey: string;
  nodeId: string;
  nodeName: string;
  importedAt: string;
  nodeCount: number;
  fileCount: number;
  selectedNodes: string[];
  scope: WorkspaceImportSessionScope;
  componentMappings: number;
  version?: string;
  pasteIdentityKey: string | null;
  replayable: boolean;
  replayDisabledReason?: string;
  userId?: string;
  qualityScore?: number;
  status?: WorkspaceImportSessionStatus;
  reviewRequired?: boolean;
}

export interface WorkspaceImportSessionsResponse {
  sessions: WorkspaceImportSession[];
}

export interface WorkspaceImportSessionReimportAccepted extends WorkspaceSubmitAccepted {
  sessionId: string;
  sourceJobId?: string;
}

export interface WorkspaceImportSessionDeleteResult {
  sessionId: string;
  deleted: true;
  jobId?: string;
}

/** Submit response for accepted jobs. */
export interface WorkspaceSubmitAccepted {
  jobId: string;
  status: "queued";
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
  importIntent?: WorkspaceImportIntent;
  /**
   * Per-paste delta summary computed at submit time for Figma paste imports.
   * Present only when `figmaSourceMode === "figma_paste" | "figma_plugin"` and diff succeeded.
   */
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
}

/** Stage details for each job stage. */
export interface WorkspaceJobStage {
  name: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  message?: string;
}

/** Structured job log line. */
export interface WorkspaceJobLog {
  at: string;
  level: "debug" | "info" | "warn" | "error";
  stage?: WorkspaceJobStageName;
  message: string;
}

/** Severity levels emitted for structured job diagnostics. */
export type WorkspaceJobDiagnosticSeverity = "error" | "warning" | "info";

/** JSON-safe diagnostic payload values attached to structured job diagnostics. */
export type WorkspaceJobDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | WorkspaceJobDiagnosticValue[]
  | { [key: string]: WorkspaceJobDiagnosticValue };

/** Structured diagnostic entry emitted for job, stage, or node-level issues. */
export interface WorkspaceJobDiagnostic {
  code: string;
  message: string;
  suggestion: string;
  stage: WorkspaceJobStageName;
  severity: WorkspaceJobDiagnosticSeverity;
  figmaNodeId?: string;
  figmaUrl?: string;
  details?: Record<string, WorkspaceJobDiagnosticValue>;
}

/** Retry target surfaced for failed-stage retries and failed generated files. */
export interface WorkspaceJobRetryTarget {
  kind: "stage" | "generated_file";
  stage: WorkspaceJobRetryStage;
  targetId: string;
  displayName?: string;
  filePath?: string;
  emittedScreenId?: string;
}

/** Inspector-facing metadata for a single pipeline stage. */
export interface WorkspaceJobInspectorStage {
  stage: WorkspaceJobStageName;
  status: WorkspaceJobStageStatus;
  retryable?: boolean;
  code?: string;
  message?: string;
  retryAfterMs?: number;
  fallbackMode?: WorkspaceJobFallbackMode;
  retryTargets?: WorkspaceJobRetryTarget[];
}

/** Inspector-facing backend result contract for recovery-aware paste flows. */
export interface WorkspaceJobInspector {
  outcome?: WorkspaceJobOutcome;
  fallbackMode?: WorkspaceJobFallbackMode;
  /** Successful MCP read-tool calls consumed by this job. */
  mcpCallsConsumed?: number;
  retryableStages?: WorkspaceJobRetryStage[];
  retryTargets?: WorkspaceJobRetryTarget[];
  stages: WorkspaceJobInspectorStage[];
}

/** Artifact paths emitted by autonomous job execution. */
export interface WorkspaceJobArtifacts {
  outputRoot: string;
  jobDir: string;
  generatedProjectDir?: string;
  designIrFile?: string;
  figmaAnalysisFile?: string;
  figmaJsonFile?: string;
  storybookTokensFile?: string;
  storybookThemesFile?: string;
  storybookComponentsFile?: string;
  componentVisualCatalogFile?: string;
  figmaLibraryResolutionFile?: string;
  componentMatchReportFile?: string;
  generationMetricsFile?: string;
  componentManifestFile?: string;
  validationSummaryFile?: string;
  stageTimingsFile?: string;
  generationDiffFile?: string;
  visualAuditReferenceImageFile?: string;
  visualAuditActualImageFile?: string;
  visualAuditDiffImageFile?: string;
  visualAuditReportFile?: string;
  visualQualityReportFile?: string;
  compositeQualityReportFile?: string;
  confidenceReportFile?: string;
  reproDir?: string;
}

/** Describes a modified file in the generation diff report. */
export interface WorkspaceGenerationDiffModifiedFile {
  file: string;
  previousHash: string;
  currentHash: string;
}

/** Generation diff report comparing current generation with the previous run. */
export interface WorkspaceGenerationDiffReport {
  boardKey: string;
  currentJobId: string;
  previousJobId: string | null;
  generatedAt: string;
  added: string[];
  modified: WorkspaceGenerationDiffModifiedFile[];
  removed: string[];
  unchanged: string[];
  summary: string;
}

/** Configuration for the optional visual audit capture flow. */
export interface WorkspaceVisualCaptureConfig {
  viewport?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
  };
  waitForNetworkIdle?: boolean;
  waitForFonts?: boolean;
  waitForAnimations?: boolean;
  timeoutMs?: number;
  fullPage?: boolean;
}

/** Configuration for the optional visual audit diff flow. */
export interface WorkspaceVisualDiffConfig {
  threshold?: number;
  includeAntialiasing?: boolean;
  alpha?: number;
}

/** Region definition used for visual diff breakdowns. */
export interface WorkspaceVisualDiffRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Region result returned as part of a visual audit. */
export interface WorkspaceVisualAuditRegionResult extends WorkspaceVisualDiffRegion {
  diffPixelCount: number;
  totalPixels: number;
  deviationPercent: number;
}

/** Input payload for the optional visual audit flow. */
export interface WorkspaceVisualAuditInput {
  baselineImagePath: string;
  capture?: WorkspaceVisualCaptureConfig;
  diff?: WorkspaceVisualDiffConfig;
  regions?: WorkspaceVisualDiffRegion[];
}

/** Runtime status for the optional visual audit flow. */
export type WorkspaceVisualAuditStatus =
  | "not_requested"
  | "ok"
  | "warn"
  | "failed";

/** Computed output for the optional visual audit flow. */
export interface WorkspaceVisualAuditResult {
  status: WorkspaceVisualAuditStatus;
  baselineImagePath?: string;
  referenceImagePath?: string;
  actualImagePath?: string;
  diffImagePath?: string;
  reportPath?: string;
  similarityScore?: number;
  diffPixelCount?: number;
  totalPixels?: number;
  regions?: WorkspaceVisualAuditRegionResult[];
  warnings?: string[];
}

/** Frozen fixture metadata used for visual quality reference images. */
export interface WorkspaceVisualReferenceFixtureMetadata {
  capturedAt: string;
  source: {
    fileKey: string;
    nodeId: string;
    nodeName: string;
    lastModified: string;
  };
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
  };
}

/** Scoring weights for the visual quality composite score. */
export interface WorkspaceVisualScoringWeights {
  layoutAccuracy: number;
  colorFidelity: number;
  typography: number;
  componentStructure: number;
  spacingAlignment: number;
}

/** Per-dimension score in a visual quality report. */
export interface WorkspaceVisualDimensionScore {
  name: string;
  weight: number;
  score: number;
  details: string;
}

/** Deviation hotspot identified in a visual quality comparison. */
export interface WorkspaceVisualDeviationHotspot {
  rank: number;
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
  deviationPercent: number;
  severity: "low" | "medium" | "high" | "critical";
  category: "layout" | "color" | "typography" | "component" | "spacing";
}

/** Metadata about a visual quality comparison run. */
export interface WorkspaceVisualComparisonMetadata {
  comparedAt: string;
  imageWidth: number;
  imageHeight: number;
  totalPixels: number;
  diffPixelCount: number;
  configuredWeights: WorkspaceVisualScoringWeights;
  viewport: {
    width: number;
    height: number;
    deviceScaleFactor: number;
  };
  versions: {
    packageVersion: string;
    contractVersion: string;
  };
}

export interface WorkspaceVisualCrossBrowserPairwiseDiff {
  browserA: WorkspaceVisualBrowserName;
  browserB: WorkspaceVisualBrowserName;
  diffPercent: number;
  diffImagePath?: string;
}

export interface WorkspaceVisualCrossBrowserConsistency {
  browsers: WorkspaceVisualBrowserName[];
  consistencyScore: number;
  pairwiseDiffs: WorkspaceVisualCrossBrowserPairwiseDiff[];
  warnings?: string[];
}

export interface WorkspaceVisualPerBrowserResult {
  browser: WorkspaceVisualBrowserName;
  overallScore: number;
  actualImagePath?: string;
  diffImagePath?: string;
  reportPath?: string;
  warnings?: string[];
}

export interface WorkspaceVisualComponentCoverage {
  comparedCount: number;
  skippedCount: number;
  coveragePercent: number;
  bySkipReason: Record<string, number>;
}

export interface WorkspaceVisualQualityComponentEntry {
  componentId: string;
  componentName: string;
  status: "compared" | "skipped";
  score?: number;
  diffImagePath?: string;
  reportPath?: string;
  skipReason?: string;
  storyEntryId?: string;
  referenceNodeId?: string;
  warnings?: string[];
}

/** Full visual quality report produced by the scoring system. */
export interface WorkspaceVisualQualityReport {
  status: "completed" | "failed" | "not_requested";
  referenceSource?: WorkspaceVisualQualityReferenceMode;
  capturedAt?: string;
  overallScore?: number;
  interpretation?: string;
  dimensions?: WorkspaceVisualDimensionScore[];
  componentAggregateScore?: number;
  componentCoverage?: WorkspaceVisualComponentCoverage;
  components?: WorkspaceVisualQualityComponentEntry[];
  diffImagePath?: string;
  hotspots?: WorkspaceVisualDeviationHotspot[];
  metadata?: WorkspaceVisualComparisonMetadata;
  browserBreakdown?: Partial<Record<WorkspaceVisualBrowserName, number>>;
  crossBrowserConsistency?: WorkspaceVisualCrossBrowserConsistency;
  perBrowser?: WorkspaceVisualPerBrowserResult[];
  warnings?: string[];
  message?: string;
}

/** Supported Lighthouse profiles in the combined visual/performance quality report. */
export type WorkspaceCompositeQualityLighthouseProfile = "mobile" | "desktop";

/** Per-sample Lighthouse metrics captured for the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityLighthouseSample {
  profile: WorkspaceCompositeQualityLighthouseProfile;
  route: string;
  performanceScore: number | null;
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

/** Aggregated Lighthouse metrics included in the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityPerformanceAggregateMetrics {
  fcp_ms: number | null;
  lcp_ms: number | null;
  cls: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

/** Performance breakdown included in the combined visual/performance quality report. */
export interface WorkspaceCompositeQualityPerformanceBreakdown {
  sourcePath?: string;
  score: number | null;
  sampleCount: number;
  samples: WorkspaceCompositeQualityLighthouseSample[];
  aggregateMetrics: WorkspaceCompositeQualityPerformanceAggregateMetrics;
  warnings: string[];
}

/** Dimensions that may contribute to the combined visual/performance quality score. */
export type WorkspaceCompositeQualityDimension = "visual" | "performance";

/** Combined visual + performance quality report surfaced by validate.project. */
export interface WorkspaceCompositeQualityReport {
  status: "completed" | "failed" | "not_requested";
  generatedAt?: string;
  weights?: WorkspaceCompositeQualityWeights;
  visual?: {
    score: number;
    ranAt: string;
    source: string;
  } | null;
  performance?: WorkspaceCompositeQualityPerformanceBreakdown | null;
  composite?: {
    score: number | null;
    includedDimensions: WorkspaceCompositeQualityDimension[];
    explanation: string;
  };
  warnings?: string[];
  message?: string;
}

/** PR execution status attached to completed jobs when Git PR integration is enabled. */
export interface WorkspaceGitPrStatus {
  status: "executed" | "skipped";
  reason?: string;
  prUrl?: string;
  branchName?: string;
  scopePath?: string;
  changedFiles?: string[];
}

/** Error information for failed jobs. */
export interface WorkspaceJobError {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: WorkspaceJobFallbackMode;
  retryTargets?: WorkspaceJobRetryTarget[];
  diagnostics?: WorkspaceJobDiagnostic[];
}

/** Queue snapshot attached to job payloads for queue-state visibility. */
export interface WorkspaceJobQueueState {
  runningCount: number;
  queuedCount: number;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  position?: number;
}

/** Cancellation metadata attached to jobs with cancel intent and terminal reason. */
export interface WorkspaceJobCancellation {
  requestedAt: string;
  reason: string;
  requestedBy: "api";
  completedAt?: string;
}

/** Full job status payload for polling endpoint. */
export interface WorkspaceJobStatus {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  outcome?: WorkspaceJobOutcome;
  currentStage?: WorkspaceJobStageName;
  submittedAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: WorkspaceJobRequestMetadata;
  stages: WorkspaceJobStage[];
  logs: WorkspaceJobLog[];
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  queue: WorkspaceJobQueueState;
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
  cancellation?: WorkspaceJobCancellation;
  lineage?: WorkspaceJobLineage;
  generationDiff?: WorkspaceGenerationDiffReport;
  visualAudit?: WorkspaceVisualAuditResult;
  visualQuality?: WorkspaceVisualQualityReport;
  compositeQuality?: WorkspaceCompositeQualityReport;
  confidence?: WorkspaceJobConfidence;
  gitPr?: WorkspaceGitPrStatus;
  inspector?: WorkspaceJobInspector;
  error?: WorkspaceJobError;
}

/** Compact result payload for terminal-state inspection. */
export interface WorkspaceJobResult {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  outcome?: WorkspaceJobOutcome;
  summary: string;
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
  lineage?: WorkspaceJobLineage;
  cancellation?: WorkspaceJobCancellation;
  generationDiff?: WorkspaceGenerationDiffReport;
  visualAudit?: WorkspaceVisualAuditResult;
  visualQuality?: WorkspaceVisualQualityReport;
  compositeQuality?: WorkspaceCompositeQualityReport;
  confidence?: WorkspaceJobConfidence;
  gitPr?: WorkspaceGitPrStatus;
  inspector?: WorkspaceJobInspector;
  error?: WorkspaceJobError;
}

/** Version information for the workspace-dev package. */
export interface WorkspaceVersionInfo {
  version: string;
  contractVersion: string;
}

/** Structured override entry for regeneration from Inspector drafts. */
export interface WorkspaceRegenerationOverrideEntry {
  nodeId: string;
  field: string;
  value:
    | string
    | number
    | boolean
    | { top: number; right: number; bottom: number; left: number };
}

/**
 * Submission payload for regeneration from a completed source job with IR overrides.
 *
 * Customer profile handling: regeneration reuses the source job's persisted
 * customer-profile snapshot (`STAGE_ARTIFACT_KEYS.customerProfileResolved`).
 * This interface intentionally exposes no `customerProfilePath` field — the
 * profile is not overridable at regeneration time. To regenerate against a
 * different profile, submit a new job.
 */
export interface WorkspaceRegenerationInput {
  sourceJobId: string;
  overrides: WorkspaceRegenerationOverrideEntry[];
  draftId?: string;
  baseFingerprint?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
}

/** Submit response for accepted regeneration jobs. */
export interface WorkspaceRegenerationAccepted {
  jobId: string;
  sourceJobId: string;
  status: "queued";
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
}

/** Submission payload for retrying a failed or partial job from a persisted stage boundary. */
export interface WorkspaceRetryInput {
  sourceJobId: string;
  retryStage: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

/** Submit response for accepted retry jobs. */
export interface WorkspaceRetryAccepted {
  jobId: string;
  sourceJobId: string;
  retryStage: WorkspaceJobRetryStage;
  status: "queued";
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
}

/** Lineage metadata linking a regeneration job to its source. */
export interface WorkspaceJobLineage {
  sourceJobId: string;
  kind?: "regeneration" | "retry" | "delta";
  draftId?: string;
  baseFingerprint?: string;
  overrideCount: number;
  retryStage?: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

/** Supported local sync execution modes. */
export type WorkspaceLocalSyncMode = "dry_run" | "apply";

/** File action the sync planner intends to perform for a path. */
export type WorkspaceLocalSyncFileAction = "create" | "overwrite" | "none";
/** File status reported by the sync planner after comparing generated, baseline, and destination states. */
export type WorkspaceLocalSyncFileStatus =
  | "create"
  | "overwrite"
  | "conflict"
  | "untracked"
  | "unchanged";
/** Reason explaining why a file received its planned sync status. */
export type WorkspaceLocalSyncFileReason =
  | "new_file"
  | "managed_destination_unchanged"
  | "destination_modified_since_sync"
  | "destination_deleted_since_sync"
  | "existing_without_baseline"
  | "already_matches_generated";
/** User decision applied to a single file in local sync preview/apply flows. */
export type WorkspaceLocalSyncFileDecision = "write" | "skip";

/** Dry-run request payload for previewing a local sync plan. */
export interface WorkspaceLocalSyncDryRunRequest {
  mode: "dry_run";
  targetPath?: string;
}

/** User decision for a single planned file during local sync apply. */
export interface WorkspaceLocalSyncFileDecisionEntry {
  path: string;
  decision: WorkspaceLocalSyncFileDecision;
}

/** Apply request payload for executing a previously previewed local sync plan. */
export interface WorkspaceLocalSyncApplyRequest {
  mode: "apply";
  confirmationToken: string;
  confirmOverwrite: boolean;
  fileDecisions: WorkspaceLocalSyncFileDecisionEntry[];
  reviewerNote?: string;
}

/** Union of supported local sync request payloads. */
export type WorkspaceLocalSyncRequest =
  | WorkspaceLocalSyncDryRunRequest
  | WorkspaceLocalSyncApplyRequest;

/** Planned file entry returned by local sync preview/apply flows. */
export interface WorkspaceLocalSyncFilePlanEntry {
  path: string;
  action: WorkspaceLocalSyncFileAction;
  status: WorkspaceLocalSyncFileStatus;
  reason: WorkspaceLocalSyncFileReason;
  decision: WorkspaceLocalSyncFileDecision;
  selectedByDefault: boolean;
  sizeBytes: number;
  message: string;
}

/** Aggregate counts and byte sizes for a planned local sync run. */
export interface WorkspaceLocalSyncSummary {
  totalFiles: number;
  selectedFiles: number;
  createCount: number;
  overwriteCount: number;
  conflictCount: number;
  untrackedCount: number;
  unchangedCount: number;
  totalBytes: number;
  selectedBytes: number;
}

/** Dry-run response payload describing a local sync plan before apply. */
export interface WorkspaceLocalSyncDryRunResult {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: WorkspaceLocalSyncFilePlanEntry[];
  summary: WorkspaceLocalSyncSummary;
  confirmationToken: string;
  confirmationExpiresAt: string;
}

/** Apply response payload describing the executed local sync plan. */
export interface WorkspaceLocalSyncApplyResult {
  jobId: string;
  sourceJobId: string;
  boardKey: string;
  targetPath: string;
  scopePath: string;
  destinationRoot: string;
  files: WorkspaceLocalSyncFilePlanEntry[];
  summary: WorkspaceLocalSyncSummary;
  appliedAt: string;
}

/** Input payload for creating a PR from a completed regeneration job. */
export interface WorkspaceCreatePrInput {
  repoUrl: string;
  repoToken: string;
  targetPath?: string;
  reviewerNote?: string;
}

/** Result payload returned after PR creation from a regenerated job. */
export interface WorkspaceCreatePrResult {
  jobId: string;
  sourceJobId: string;
  gitPr: WorkspaceGitPrStatus;
}

/** Prerequisites check result for PR creation from a regenerated job. */
export interface WorkspaceGitPrPrerequisites {
  available: boolean;
  missing: string[];
}

/** User decision for handling a stale draft. */
export type WorkspaceStaleDraftDecision =
  | "continue"
  | "discard"
  | "carry-forward";

/** Result of a stale-draft check for a given job. */
export interface WorkspaceStaleDraftCheckResult {
  /** Whether the draft's source job is stale (a newer completed job exists for the same board key). */
  stale: boolean;
  /** The job ID of the latest completed job for the same board key (if stale). */
  latestJobId: string | null;
  /** The job ID the draft was created from. */
  sourceJobId: string;
  /** Board key shared by source and latest jobs. */
  boardKey: string | null;
  /** Whether carry-forward is available (all draft node IDs exist in the latest job's IR). */
  carryForwardAvailable: boolean;
  /** Node IDs from the draft that could not be resolved in the latest job's IR. */
  unmappedNodeIds: string[];
  /** Human-readable explanation of the stale state. */
  message: string;
}

// ---------------------------------------------------------------------------
// Remap suggestion types for guided stale-draft override remapping (#466)
// ---------------------------------------------------------------------------

/** User decision for handling a stale draft — extended with remap option. */
export type WorkspaceStaleDraftDecisionExtended =
  | WorkspaceStaleDraftDecision
  | "remap";

/** Confidence level for a remap suggestion. */
export type WorkspaceRemapConfidence = "high" | "medium" | "low";

/** Rule that produced a remap suggestion. */
export type WorkspaceRemapRule =
  | "exact-id"
  | "name-and-type"
  | "name-fuzzy-and-type"
  | "ancestry-and-type";

/** A single remap suggestion mapping a source node to a candidate target node. */
export interface WorkspaceRemapSuggestion {
  /** The original node ID from the stale draft override. */
  sourceNodeId: string;
  /** The original node name (from the source IR). */
  sourceNodeName: string;
  /** The element type of the source node. */
  sourceNodeType: string;
  /** The suggested target node ID in the latest IR. */
  targetNodeId: string;
  /** The target node name in the latest IR. */
  targetNodeName: string;
  /** The element type of the target node. */
  targetNodeType: string;
  /** The rule that produced this suggestion. */
  rule: WorkspaceRemapRule;
  /** Confidence level of the suggestion. */
  confidence: WorkspaceRemapConfidence;
  /** Human-readable reason for the suggestion. */
  reason: string;
}

/** A source node for which no remap could be determined. */
export interface WorkspaceRemapRejection {
  /** The unmappable node ID from the stale draft. */
  sourceNodeId: string;
  /** The original node name (from the source IR). */
  sourceNodeName: string;
  /** The element type of the source node. */
  sourceNodeType: string;
  /** Human-readable reason why remapping was not possible. */
  reason: string;
}

/** Input payload for the remap-suggest endpoint. */
export interface WorkspaceRemapSuggestInput {
  /** The stale source job ID whose draft overrides need remapping. */
  sourceJobId: string;
  /** The latest job ID to remap into. */
  latestJobId: string;
  /** Node IDs from the draft that need remapping (those not found in the latest IR). */
  unmappedNodeIds: string[];
}

/** Result of the remap-suggest endpoint. */
export interface WorkspaceRemapSuggestResult {
  sourceJobId: string;
  latestJobId: string;
  suggestions: WorkspaceRemapSuggestion[];
  rejections: WorkspaceRemapRejection[];
  message: string;
}

/** A user decision on a single remap suggestion. */
export interface WorkspaceRemapDecisionEntry {
  sourceNodeId: string;
  targetNodeId: string | null;
  accepted: boolean;
}

// ---------------------------------------------------------------------------
// Generation confidence model types (#849)
// ---------------------------------------------------------------------------

/** Confidence level for a generated job, screen, or component. */
export type WorkspaceConfidenceLevel = "high" | "medium" | "low" | "very_low";

/** A single explainable contributor to a confidence score. */
export interface WorkspaceConfidenceContributor {
  signal: string;
  impact: "positive" | "negative" | "neutral";
  weight: number;
  value: number;
  detail: string;
}

/** Per-component confidence assessment. */
export interface WorkspaceComponentConfidence {
  componentId: string;
  componentName: string;
  level: WorkspaceConfidenceLevel;
  score: number;
  contributors: WorkspaceConfidenceContributor[];
}

/** Per-screen confidence assessment. */
export interface WorkspaceScreenConfidence {
  screenId: string;
  screenName: string;
  level: WorkspaceConfidenceLevel;
  score: number;
  contributors: WorkspaceConfidenceContributor[];
  components: WorkspaceComponentConfidence[];
}

/** Job-level confidence report produced by the scoring model. */
export interface WorkspaceJobConfidence {
  status: "completed" | "failed" | "not_requested";
  generatedAt?: string;
  level?: WorkspaceConfidenceLevel;
  score?: number;
  contributors?: WorkspaceConfidenceContributor[];
  screens?: WorkspaceScreenConfidence[];
  lowConfidenceSummary?: string[];
  message?: string;
}

/**
 * Current contract version constant.
 * Must be bumped according to CONTRACT_CHANGELOG.md rules.
 * Package version alignment is documented in VERSIONING.md.
 */
export const CONTRACT_VERSION = "3.18.0" as const;
