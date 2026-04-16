import type {
  WorkspaceBrandTheme,
  WorkspaceCompositeQualityReport,
  WorkspaceCompositeQualityWeights,
  WorkspaceCreatePrInput,
  WorkspaceCreatePrResult,
  WorkspaceJobConfidence,
  WorkspaceLocalSyncFileDecisionEntry,
  WorkspaceLogFormat,
  WorkspaceGenerationDiffReport,
  WorkspaceGitPrStatus,
  WorkspaceImportSession,
  WorkspaceImportSessionDeleteResult,
  WorkspaceImportSessionEvent,
  WorkspaceImportSessionReimportAccepted,
  WorkspaceLocalSyncApplyResult,
  WorkspaceLocalSyncDryRunResult,
  WorkspaceJobDiagnostic,
  WorkspaceJobArtifacts,
  WorkspaceJobCancellation,
  WorkspaceJobError,
  WorkspaceJobInput,
  WorkspaceJobInspector,
  WorkspaceJobLineage,
  WorkspaceJobLog,
  WorkspaceJobOutcome,
  WorkspaceJobQueueState,
  WorkspaceJobRetryTarget,
  WorkspaceJobResult,
  WorkspaceJobRuntimeStatus,
  WorkspacePasteDeltaSummary,
  WorkspaceRouterMode,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStatus,
  WorkspaceVisualBrowserName,
  WorkspaceVisualQualityReferenceMode,
  WorkspaceRegenerationAccepted,
  WorkspaceRegenerationInput,
  WorkspaceRetryAccepted,
  WorkspaceRetryInput,
  WorkspaceRemapSuggestInput,
  WorkspaceRemapSuggestResult,
  WorkspaceStaleDraftCheckResult,
  WorkspaceSubmitAccepted,
  WorkspaceVisualAuditResult,
  WorkspaceVisualQualityReport,
} from "../contracts/index.js";
import type { FigmaMcpEnrichment } from "../parity/types.js";
import type { WorkspaceRuntimeLogger } from "../logging.js";
import type { FigmaRestCircuitBreaker } from "./figma-rest-circuit-breaker.js";
import type { PipelineDiagnosticLimits } from "./errors.js";
import type { ResolvedCustomerProfile } from "../customer-profile.js";
import type { WorkspacePasteDeltaSeed } from "./paste-delta-execution.js";

export interface FigmaComponentCatalogEntry {
  key?: string;
  name?: string;
  description?: string;
  componentSetId?: string;
  remote?: boolean;
}

export interface FigmaComponentSetCatalogEntry {
  key?: string;
  name?: string;
  description?: string;
  remote?: boolean;
}

export interface FigmaFileResponse {
  name?: string;
  lastModified?: string;
  document?: unknown;
  styles?: Record<string, unknown>;
  components?: Record<string, FigmaComponentCatalogEntry>;
  componentSets?: Record<string, FigmaComponentSetCatalogEntry>;
}

export interface FigmaFetchDiagnostics {
  sourceMode: "geometry-paths" | "staged-nodes" | "local-json";
  fetchedNodes: number;
  degradedGeometryNodes: string[];
  lowFidelityDetected?: boolean;
  lowFidelityReasons?: string[];
  authoritativeSubtreeCount?: number;
}

export interface FigmaFetchResult {
  file: FigmaFileResponse;
  diagnostics: FigmaFetchDiagnostics;
}

export interface JobRecord {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  outcome?: WorkspaceJobOutcome;
  currentStage?: WorkspaceJobStageName;
  submittedAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: WorkspaceJobStatus["request"];
  stages: WorkspaceJobStage[];
  logs: WorkspaceJobLog[];
  artifacts: WorkspaceJobArtifacts;
  preview: {
    enabled: boolean;
    url?: string;
  };
  queue: WorkspaceJobQueueState;
  pasteDeltaSummary?: WorkspacePasteDeltaSummary;
  abortController?: AbortController;
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

export type SubmissionJobInput = WorkspaceJobInput & {
  pasteDeltaSeed?: WorkspacePasteDeltaSeed;
};

export interface WorkspacePipelineError extends Error {
  code: string;
  stage: WorkspaceJobStageName;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: "none" | "rest" | "hybrid_rest";
  retryTargets?: WorkspaceJobRetryTarget[];
  diagnostics?: WorkspaceJobDiagnostic[];
}

export interface JobEnginePaths {
  workspaceRoot?: string;
  outputRoot: string;
  jobsRoot: string;
  reprosRoot: string;
}

export interface JobEngineRuntime {
  figmaTimeoutMs: number;
  figmaMaxRetries: number;
  figmaCircuitBreakerFailureThreshold: number;
  figmaCircuitBreakerResetTimeoutMs: number;
  figmaRestCircuitBreaker: FigmaRestCircuitBreaker;
  figmaBootstrapDepth: number;
  figmaNodeBatchSize: number;
  figmaNodeFetchConcurrency: number;
  figmaAdaptiveBatchingEnabled: boolean;
  figmaMaxScreenCandidates: number;
  figmaScreenNamePattern: string | undefined;
  figmaCacheEnabled: boolean;
  figmaCacheTtlMs: number;
  irCacheEnabled: boolean;
  irCacheTtlMs: number;
  iconMapFilePath: string | undefined;
  designSystemFilePath: string | undefined;
  exportImages: boolean;
  figmaScreenElementBudget: number;
  figmaScreenElementMaxDepth: number;
  brandTheme: WorkspaceBrandTheme;
  generationLocale: string;
  routerMode: WorkspaceRouterMode;
  commandTimeoutMs: number;
  commandStdoutMaxBytes: number;
  commandStderrMaxBytes: number;
  pipelineDiagnosticLimits: PipelineDiagnosticLimits;
  enableUiValidation: boolean;
  enableVisualQualityValidation: boolean;
  visualQualityReferenceMode: WorkspaceVisualQualityReferenceMode;
  visualQualityViewportWidth: number;
  visualQualityViewportHeight: number;
  visualQualityDeviceScaleFactor: number;
  visualQualityBrowsers: WorkspaceVisualBrowserName[];
  compositeQualityWeights: WorkspaceCompositeQualityWeights;
  enableUnitTestValidation: boolean;
  unitTestIgnoreFailure: boolean;
  installPreferOffline: boolean;
  skipInstall: boolean;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  logFormat: WorkspaceLogFormat;
  logger: WorkspaceRuntimeLogger;
  previewEnabled: boolean;
  fetchImpl: typeof fetch;
  customerProfile?: ResolvedCustomerProfile;
  figmaMcpEnrichmentLoader?: (
    input: FigmaMcpEnrichmentLoaderInput,
  ) => Promise<FigmaMcpEnrichment | undefined>;
}

export interface FigmaMcpEnrichmentLoaderInput {
  figmaFileKey: string;
  cleanedFile: FigmaFileResponse;
  rawFile: FigmaFileResponse;
  jobDir: string;
  workspaceRoot?: string;
  fetchImpl: typeof fetch;
  figmaRestFetch: typeof fetch;
  figmaMcpFetch: typeof fetch;
}

export interface CreateJobEngineInput {
  resolveBaseUrl: () => string;
  paths: JobEnginePaths;
  runtime: JobEngineRuntime;
}

export interface CommandOutputCaptureOptions {
  jobDir: string;
  key: string;
  stdoutMaxBytes: number;
  stderrMaxBytes: number;
}

export interface CommandOutputMetadata {
  observedBytes: number;
  retainedBytes: number;
  truncated: boolean;
  artifactPath?: string;
}

export interface CommandExecutionInput {
  cwd: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  redactions?: string[];
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  outputCapture?: CommandOutputCaptureOptions;
}

export interface CommandResult {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  combined: string;
  timedOut?: boolean;
  canceled?: boolean;
  durationMs?: number;
  stdoutMetadata?: CommandOutputMetadata;
  stderrMetadata?: CommandOutputMetadata;
}

export interface GitPrExecutionResult {
  status: "executed";
  prUrl?: string;
  branchName: string;
  scopePath: string;
  changedFiles: string[];
}

/** Minimal internal job snapshot for handlers that need raw artifact paths and status. */
export interface JobRecordSnapshot {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
  artifacts: WorkspaceJobArtifacts;
}

export interface JobEngine {
  submitJob: (input: SubmissionJobInput) => WorkspaceSubmitAccepted;
  submitRegeneration: (
    input: WorkspaceRegenerationInput,
  ) => WorkspaceRegenerationAccepted;
  submitRetry: (input: WorkspaceRetryInput) => WorkspaceRetryAccepted;
  createPrFromJob: (input: {
    jobId: string;
    prInput: WorkspaceCreatePrInput;
  }) => Promise<WorkspaceCreatePrResult>;
  previewLocalSync: (input: {
    jobId: string;
    targetPath?: string;
  }) => Promise<WorkspaceLocalSyncDryRunResult>;
  applyLocalSync: (input: {
    jobId: string;
    confirmationToken: string;
    confirmOverwrite: boolean;
    fileDecisions: WorkspaceLocalSyncFileDecisionEntry[];
    reviewerNote?: string;
  }) => Promise<WorkspaceLocalSyncApplyResult>;
  cancelJob: (input: {
    jobId: string;
    reason?: string;
  }) => WorkspaceJobStatus | undefined;
  getJob: (jobId: string) => WorkspaceJobStatus | undefined;
  getJobResult: (jobId: string) => WorkspaceJobResult | undefined;
  getJobRecord: (jobId: string) => JobRecordSnapshot | undefined;
  resolvePreviewAsset: (
    jobId: string,
    previewPath: string,
  ) => Promise<{ content: Buffer; contentType: string } | undefined>;
  checkStaleDraft: (input: {
    jobId: string;
    draftNodeIds: string[];
  }) => Promise<WorkspaceStaleDraftCheckResult>;
  suggestRemaps: (
    input: WorkspaceRemapSuggestInput,
  ) => Promise<WorkspaceRemapSuggestResult>;
  listImportSessions: () => Promise<WorkspaceImportSession[]>;
  reimportImportSession: (input: {
    sessionId: string;
  }) => Promise<WorkspaceImportSessionReimportAccepted>;
  deleteImportSession: (input: {
    sessionId: string;
  }) => Promise<WorkspaceImportSessionDeleteResult>;
  listImportSessionEvents: (input: {
    sessionId: string;
  }) => Promise<WorkspaceImportSessionEvent[]>;
  approveImportSession: (input: {
    sessionId: string;
  }) => Promise<WorkspaceImportSessionEvent>;
  appendImportSessionEvent: (input: {
    event: WorkspaceImportSessionEvent;
  }) => Promise<WorkspaceImportSessionEvent>;
}
