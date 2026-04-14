import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceJobDiagnostic,
  WorkspaceJobLog,
  WorkspaceJobRetryStage,
  WorkspaceJobStageName,
  WorkspaceRegenerationInput,
  WorkspaceRetryInput
} from "../../contracts/index.js";
import type { PipelineDiagnosticInput } from "../errors.js";
import { pushRuntimeLog } from "../stage-state.js";
import type {
  JobEnginePaths,
  JobEngineRuntime,
  JobRecord,
  SubmissionJobInput,
} from "../types.js";
import type { StageArtifactStore } from "./artifact-store.js";
import type { ResolvedCustomerProfile } from "../../customer-profile.js";

export type PipelineExecutionMode = "submission" | "regeneration" | "retry";

export interface PipelineResolvedPaths {
  jobDir: string;
  generatedProjectDir: string;
  figmaRawJsonFile: string;
  figmaJsonFile: string;
  designIrFile: string;
  figmaAnalysisFile: string;
  stageTimingsFile: string;
  reproDir: string;
  iconMapFilePath: string;
  designSystemFilePath: string;
  irCacheDir: string;
  templateRoot: string;
  templateCopyFilter: (sourcePath: string) => boolean;
}

export interface PipelineExecutionContext {
  mode: PipelineExecutionMode;
  job: JobRecord;
  input?: SubmissionJobInput;
  regenerationInput?: WorkspaceRegenerationInput;
  retryInput?: WorkspaceRetryInput;
  sourceJob?: JobRecord;
  runtime: JobEngineRuntime;
  resolvedPaths: JobEnginePaths;
  resolvedWorkspaceRoot: string;
  resolveBaseUrl: () => string;
  jobAbortController: AbortController;
  fetchWithCancellation: typeof fetch;
  paths: PipelineResolvedPaths;
  artifactStore: StageArtifactStore;
  resolvedBrandTheme: WorkspaceBrandTheme;
  resolvedCustomerBrandId?: string;
  resolvedFigmaSourceMode: WorkspaceFigmaSourceMode;
  resolvedFormHandlingMode: WorkspaceFormHandlingMode;
  requestedStorybookStaticDir?: string;
  resolvedStorybookStaticDir?: string;
  resolvedCustomerProfile?: ResolvedCustomerProfile;
  generationLocaleResolution: {
    locale: string;
    warningMessage?: string;
  };
  resolvedGenerationLocale: string;
  figmaFileKeyForDiagnostics?: string;
  appendDiagnostics: (input: { stage: WorkspaceJobStageName; diagnostics: PipelineDiagnosticInput[] }) => void;
  getCollectedDiagnostics: () => WorkspaceJobDiagnostic[] | undefined;
  syncPublicJobProjection: () => Promise<void>;
}

export interface StageRuntimeContext {
  readonly mode: PipelineExecutionMode;
  readonly jobId: string;
  readonly job: JobRecord;
  readonly input?: SubmissionJobInput;
  readonly sourceJob?: JobRecord;
  readonly retryInput?: WorkspaceRetryInput;
  readonly retryStage?: WorkspaceJobRetryStage;
  readonly runtime: Readonly<JobEngineRuntime>;
  readonly paths: Readonly<PipelineResolvedPaths>;
  readonly resolvedPaths: Readonly<JobEnginePaths>;
  readonly resolvedWorkspaceRoot: string;
  readonly artifactStore: StageArtifactStore;
  readonly abortSignal: AbortSignal;
  readonly fetchWithCancellation: typeof fetch;
  readonly resolvedBrandTheme: WorkspaceBrandTheme;
  readonly resolvedCustomerBrandId?: string;
  readonly resolvedFigmaSourceMode: WorkspaceFigmaSourceMode;
  readonly resolvedFormHandlingMode: WorkspaceFormHandlingMode;
  readonly requestedStorybookStaticDir?: string;
  readonly resolvedStorybookStaticDir?: string;
  readonly resolvedCustomerProfile?: ResolvedCustomerProfile;
  readonly generationLocaleResolution: Readonly<{
    locale: string;
    warningMessage?: string;
  }>;
  readonly resolvedGenerationLocale: string;
  readonly figmaFileKeyForDiagnostics?: string;
  log: (input: {
    level: WorkspaceJobLog["level"];
    message: string;
    stage?: WorkspaceJobStageName;
  }) => void;
  appendDiagnostics: (input: {
    diagnostics: PipelineDiagnosticInput[];
    stage?: WorkspaceJobStageName;
  }) => void;
  getCollectedDiagnostics: () => WorkspaceJobDiagnostic[] | undefined;
  syncPublicJobProjection: () => Promise<void>;
}

export const createStageRuntimeContext = ({
  executionContext,
  stage
}: {
  executionContext: PipelineExecutionContext;
  stage: WorkspaceJobStageName;
}): StageRuntimeContext => {
  return {
    mode: executionContext.mode,
    jobId: executionContext.job.jobId,
    job: executionContext.job,
    ...(executionContext.input ? { input: executionContext.input } : {}),
    ...(executionContext.sourceJob ? { sourceJob: executionContext.sourceJob } : {}),
    ...(executionContext.retryInput ? { retryInput: executionContext.retryInput } : {}),
    ...(executionContext.retryInput?.retryStage
      ? { retryStage: executionContext.retryInput.retryStage }
      : {}),
    runtime: executionContext.runtime,
    paths: executionContext.paths,
    resolvedPaths: executionContext.resolvedPaths,
    resolvedWorkspaceRoot: executionContext.resolvedWorkspaceRoot,
    artifactStore: executionContext.artifactStore,
    abortSignal: executionContext.jobAbortController.signal,
    fetchWithCancellation: executionContext.fetchWithCancellation,
    resolvedBrandTheme: executionContext.resolvedBrandTheme,
    ...(executionContext.resolvedCustomerBrandId
      ? { resolvedCustomerBrandId: executionContext.resolvedCustomerBrandId }
      : {}),
    resolvedFigmaSourceMode: executionContext.resolvedFigmaSourceMode,
    resolvedFormHandlingMode: executionContext.resolvedFormHandlingMode,
    ...(executionContext.requestedStorybookStaticDir
      ? { requestedStorybookStaticDir: executionContext.requestedStorybookStaticDir }
      : {}),
    ...(executionContext.resolvedStorybookStaticDir
      ? { resolvedStorybookStaticDir: executionContext.resolvedStorybookStaticDir }
      : {}),
    ...(executionContext.resolvedCustomerProfile
      ? { resolvedCustomerProfile: executionContext.resolvedCustomerProfile }
      : {}),
    generationLocaleResolution: executionContext.generationLocaleResolution,
    resolvedGenerationLocale: executionContext.resolvedGenerationLocale,
    ...(executionContext.figmaFileKeyForDiagnostics
      ? { figmaFileKeyForDiagnostics: executionContext.figmaFileKeyForDiagnostics }
      : {}),
    log: ({ level, message, stage: overrideStage }) => {
      pushRuntimeLog({
        job: executionContext.job,
        logger: executionContext.runtime.logger,
        level,
        stage: overrideStage ?? stage,
        message
      });
    },
    appendDiagnostics: ({ diagnostics, stage: overrideStage }) => {
      const resolvedStage = overrideStage ?? stage;
      executionContext.appendDiagnostics({
        stage: resolvedStage,
        diagnostics: diagnostics.map((diagnostic) => {
          if (diagnostic.stage) {
            return diagnostic;
          }
          return {
            ...diagnostic,
            stage: resolvedStage
          };
        })
      });
    },
    getCollectedDiagnostics: () => executionContext.getCollectedDiagnostics(),
    syncPublicJobProjection: () => executionContext.syncPublicJobProjection()
  };
};
