/**
 * workspace-dev — Public contracts for autonomous REST + deterministic generation.
 *
 * These types define the public API surface for workspace-dev consumers.
 * They must not import from internal services.
 *
 * Contract version: 3.2.0
 * See CONTRACT_CHANGELOG.md for contract change history and VERSIONING.md for
 * package-versus-contract versioning policy.
 */

/** Allowed Figma source modes for workspace-dev. */
export type WorkspaceFigmaSourceMode = "rest" | "hybrid" | "local_json";

/** Allowed codegen modes for workspace-dev. */
export type WorkspaceLlmCodegenMode = "deterministic";

/** Theme brand policy applied during IR token derivation. */
export type WorkspaceBrandTheme = "derived" | "sparkasse";

/** Router mode for generated React application shells. */
export type WorkspaceRouterMode = "browser" | "hash";

/** Output format for operational runtime logs. */
export type WorkspaceLogFormat = "text" | "json";

/** Form handling mode for generated interactive forms. */
export type WorkspaceFormHandlingMode = "react_hook_form" | "legacy_use_state";

/** Runtime status values for asynchronous workspace jobs. */
export type WorkspaceJobRuntimeStatus = "queued" | "running" | "completed" | "failed" | "canceled";

/** Stage status values for each pipeline stage. */
export type WorkspaceJobStageStatus = "queued" | "running" | "completed" | "failed" | "skipped";

/** Structured stage names exposed by workspace-dev. */
export type WorkspaceJobStageName =
  | "figma.source"
  | "ir.derive"
  | "template.prepare"
  | "codegen.generate"
  | "validate.project"
  | "repro.export"
  | "git.pr";

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
  /** Run static UI validation in validate.project. Default: false */
  enableUiValidation?: boolean;
  /** Run generated-project unit tests in validate.project. Default: false */
  enableUnitTestValidation?: boolean;
  /** Prefer offline package resolution during generated-project install. Default: true */
  installPreferOffline?: boolean;
  /** Skip package installation in validate.project; requires existing node_modules. Default: false */
  skipInstall?: boolean;
  /** Maximum number of jobs that may run concurrently. Default: 1 */
  maxConcurrentJobs?: number;
  /** Maximum number of queued jobs waiting for execution before backpressure rejects submit. Default: 20 */
  maxQueuedJobs?: number;
  /** Output format for operational runtime logs. Default: "text" */
  logFormat?: WorkspaceLogFormat;
  /** Maximum accepted submit/regenerate requests per minute for a single client IP. Use 0 to disable. Default: 10 */
  rateLimitPerMinute?: number;
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
  figmaAccessToken?: string;
  figmaJsonPath?: string;
  customerProfilePath?: string;
  repoUrl?: string;
  repoToken?: string;
  enableGitPr?: boolean;
  figmaSourceMode?: string;
  llmCodegenMode?: string;
  projectName?: string;
  targetPath?: string;
  brandTheme?: WorkspaceBrandTheme;
  generationLocale?: string;
  formHandlingMode?: WorkspaceFormHandlingMode;
}

/** Public subset of request metadata stored for a job (secrets excluded). */
export interface WorkspaceJobRequestMetadata {
  figmaFileKey?: string;
  figmaJsonPath?: string;
  customerProfilePath?: string;
  repoUrl?: string;
  enableGitPr: boolean;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  projectName?: string;
  targetPath?: string;
  brandTheme: WorkspaceBrandTheme;
  generationLocale: string;
  formHandlingMode: WorkspaceFormHandlingMode;
}

/** Submit response for accepted jobs. */
export interface WorkspaceSubmitAccepted {
  jobId: string;
  status: "queued";
  acceptedModes: {
    figmaSourceMode: WorkspaceFigmaSourceMode;
    llmCodegenMode: WorkspaceLlmCodegenMode;
  };
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
  level: "info" | "warn" | "error";
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

/** Artifact paths emitted by autonomous job execution. */
export interface WorkspaceJobArtifacts {
  outputRoot: string;
  jobDir: string;
  generatedProjectDir?: string;
  designIrFile?: string;
  figmaAnalysisFile?: string;
  figmaJsonFile?: string;
  generationMetricsFile?: string;
  componentManifestFile?: string;
  stageTimingsFile?: string;
  generationDiffFile?: string;
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
  cancellation?: WorkspaceJobCancellation;
  lineage?: WorkspaceJobLineage;
  generationDiff?: WorkspaceGenerationDiffReport;
  gitPr?: WorkspaceGitPrStatus;
  error?: WorkspaceJobError;
}

/** Compact result payload for terminal-state inspection. */
export interface WorkspaceJobResult {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  summary: string;
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  lineage?: WorkspaceJobLineage;
  cancellation?: WorkspaceJobCancellation;
  generationDiff?: WorkspaceGenerationDiffReport;
  gitPr?: WorkspaceGitPrStatus;
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
  value: string | number | boolean | { top: number; right: number; bottom: number; left: number };
}

/** Submission payload for regeneration from a completed source job with IR overrides. */
export interface WorkspaceRegenerationInput {
  sourceJobId: string;
  overrides: WorkspaceRegenerationOverrideEntry[];
  draftId?: string;
  baseFingerprint?: string;
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

/** Lineage metadata linking a regeneration job to its source. */
export interface WorkspaceJobLineage {
  sourceJobId: string;
  draftId?: string;
  baseFingerprint?: string;
  overrideCount: number;
}

/** Supported local sync execution modes. */
export type WorkspaceLocalSyncMode = "dry_run" | "apply";

/** File action the sync planner intends to perform for a path. */
export type WorkspaceLocalSyncFileAction = "create" | "overwrite" | "none";
/** File status reported by the sync planner after comparing generated, baseline, and destination states. */
export type WorkspaceLocalSyncFileStatus = "create" | "overwrite" | "conflict" | "untracked" | "unchanged";
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
}

/** Union of supported local sync request payloads. */
export type WorkspaceLocalSyncRequest = WorkspaceLocalSyncDryRunRequest | WorkspaceLocalSyncApplyRequest;

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
export type WorkspaceStaleDraftDecision = "continue" | "discard" | "carry-forward";

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
export type WorkspaceStaleDraftDecisionExtended = WorkspaceStaleDraftDecision | "remap";

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

/**
 * Current contract version constant.
 * Must be bumped according to CONTRACT_CHANGELOG.md rules.
 * Package version alignment is documented in VERSIONING.md.
 */
export const CONTRACT_VERSION = "3.2.0" as const;
