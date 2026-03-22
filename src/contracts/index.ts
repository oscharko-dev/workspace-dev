/**
 * workspace-dev — Public contracts for autonomous REST + deterministic generation.
 *
 * These types define the public API surface for workspace-dev consumers.
 * They must not import from internal services.
 *
 * Contract version: 2.17.0
 * See CONTRACT_CHANGELOG.md for change history and versioning rules.
 */

/** Allowed Figma source modes for workspace-dev. */
export type WorkspaceFigmaSourceMode = "rest" | "local_json";

/** Allowed codegen modes for workspace-dev. */
export type WorkspaceLlmCodegenMode = "deterministic";

/** Theme brand policy applied during IR token derivation. */
export type WorkspaceBrandTheme = "derived" | "sparkasse";

/** Router mode for generated React application shells. */
export type WorkspaceRouterMode = "browser" | "hash";

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
  /** Enable local preview export and serving. Default: true */
  enablePreview?: boolean;
  /** Optional custom fetch implementation (for tests or custom runtimes). */
  fetchImpl?: typeof fetch;
  /** Reserved for project-level isolation helpers. */
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

export type WorkspaceJobDiagnosticSeverity = "error" | "warning" | "info";

export type WorkspaceJobDiagnosticValue =
  | string
  | number
  | boolean
  | null
  | WorkspaceJobDiagnosticValue[]
  | { [key: string]: WorkspaceJobDiagnosticValue };

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

/**
 * Current contract version constant.
 * Must be bumped according to CONTRACT_CHANGELOG.md rules.
 */
export const CONTRACT_VERSION = "2.18.0" as const;
