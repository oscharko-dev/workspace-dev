import type {
  WorkspaceBrandTheme,
  WorkspaceGenerationDiffReport,
  WorkspaceGitPrStatus,
  WorkspaceLocalSyncApplyResult,
  WorkspaceLocalSyncDryRunResult,
  WorkspaceJobDiagnostic,
  WorkspaceJobArtifacts,
  WorkspaceJobCancellation,
  WorkspaceJobError,
  WorkspaceJobInput,
  WorkspaceJobLineage,
  WorkspaceJobLog,
  WorkspaceJobQueueState,
  WorkspaceJobResult,
  WorkspaceJobRuntimeStatus,
  WorkspaceRouterMode,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStatus,
  WorkspaceRegenerationAccepted,
  WorkspaceRegenerationInput,
  WorkspaceSubmitAccepted
} from "../contracts/index.js";

export interface FigmaFileResponse {
  name?: string;
  document?: unknown;
}

export interface FigmaFetchDiagnostics {
  sourceMode: "geometry-paths" | "staged-nodes" | "local-json";
  fetchedNodes: number;
  degradedGeometryNodes: string[];
}

export interface FigmaFetchResult {
  file: FigmaFileResponse;
  diagnostics: FigmaFetchDiagnostics;
}

export interface JobRecord {
  jobId: string;
  status: WorkspaceJobRuntimeStatus;
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
  abortController?: AbortController;
  lineage?: WorkspaceJobLineage;
  cancellation?: WorkspaceJobCancellation;
  generationDiff?: WorkspaceGenerationDiffReport;
  gitPr?: WorkspaceGitPrStatus;
  error?: WorkspaceJobError;
}

export interface WorkspacePipelineError extends Error {
  code: string;
  stage: WorkspaceJobStageName;
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
  enableUiValidation: boolean;
  enableUnitTestValidation: boolean;
  installPreferOffline: boolean;
  skipInstall: boolean;
  maxConcurrentJobs: number;
  maxQueuedJobs: number;
  previewEnabled: boolean;
  fetchImpl: typeof fetch;
}

export interface CreateJobEngineInput {
  resolveBaseUrl: () => string;
  paths: JobEnginePaths;
  runtime: JobEngineRuntime;
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
  submitJob: (input: WorkspaceJobInput) => WorkspaceSubmitAccepted;
  submitRegeneration: (input: WorkspaceRegenerationInput) => WorkspaceRegenerationAccepted;
  previewLocalSync: (input: { jobId: string; targetPath?: string }) => Promise<WorkspaceLocalSyncDryRunResult>;
  applyLocalSync: (input: { jobId: string; confirmationToken: string; confirmOverwrite: boolean }) => Promise<WorkspaceLocalSyncApplyResult>;
  cancelJob: (input: { jobId: string; reason?: string }) => WorkspaceJobStatus | undefined;
  getJob: (jobId: string) => WorkspaceJobStatus | undefined;
  getJobResult: (jobId: string) => WorkspaceJobResult | undefined;
  getJobRecord: (jobId: string) => JobRecordSnapshot | undefined;
  resolvePreviewAsset: (jobId: string, previewPath: string) => Promise<{ content: Buffer; contentType: string } | undefined>;
}
