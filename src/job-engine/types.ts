import type {
  WorkspaceBrandTheme,
  WorkspaceGitPrStatus,
  WorkspaceJobArtifacts,
  WorkspaceJobError,
  WorkspaceJobInput,
  WorkspaceJobLog,
  WorkspaceJobResult,
  WorkspaceJobRuntimeStatus,
  WorkspaceRouterMode,
  WorkspaceJobStage,
  WorkspaceJobStageName,
  WorkspaceJobStatus,
  WorkspaceSubmitAccepted
} from "../contracts/index.js";

export interface FigmaFileResponse {
  name?: string;
  document?: unknown;
}

export interface FigmaFetchDiagnostics {
  sourceMode: "geometry-paths" | "staged-nodes";
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
  gitPr?: WorkspaceGitPrStatus;
  error?: WorkspaceJobError;
}

export interface WorkspacePipelineError extends Error {
  code: string;
  stage: WorkspaceJobStageName;
}

export interface JobEnginePaths {
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
  iconMapFilePath: string | undefined;
  exportImages: boolean;
  figmaScreenElementBudget: number;
  figmaScreenElementMaxDepth: number;
  brandTheme: WorkspaceBrandTheme;
  generationLocale: string;
  routerMode: WorkspaceRouterMode;
  commandTimeoutMs: number;
  enableUiValidation: boolean;
  installPreferOffline: boolean;
  skipInstall: boolean;
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
  durationMs?: number;
}

export interface GitPrExecutionResult {
  status: "executed";
  prUrl?: string;
  branchName: string;
  scopePath: string;
  changedFiles: string[];
}

export interface JobEngine {
  submitJob: (input: WorkspaceJobInput) => WorkspaceSubmitAccepted;
  getJob: (jobId: string) => WorkspaceJobStatus | undefined;
  getJobResult: (jobId: string) => WorkspaceJobResult | undefined;
  resolvePreviewAsset: (jobId: string, previewPath: string) => Promise<{ content: Buffer; contentType: string } | undefined>;
}
