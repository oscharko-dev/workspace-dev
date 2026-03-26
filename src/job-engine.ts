import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceLocalSyncApplyResult,
  WorkspaceLocalSyncDryRunResult,
  WorkspaceJobDiagnostic,
  WorkspaceJobInput,
  WorkspaceJobResult,
  WorkspaceJobStageName,
  WorkspaceJobStatus,
  WorkspaceRegenerationInput
} from "./contracts/index.js";
import {
  createPipelineError,
  getErrorMessage,
  mergePipelineDiagnostics,
  type PipelineDiagnosticInput
} from "./job-engine/errors.js";
import { resolveAbsoluteOutputRoot } from "./job-engine/fs-helpers.js";
import { resolveBoardKey } from "./parity/board-key.js";
import { runGitPrFlow } from "./job-engine/git-pr.js";
import { getContentType, hasSymlinkInPath, isWithinRoot, normalizePathPart } from "./job-engine/preview.js";
import { resolveRuntimeSettings } from "./job-engine/runtime.js";
import { DEFAULT_GENERATION_LOCALE, normalizeGenerationLocale, resolveGenerationLocale } from "./generation-locale.js";
import {
  createInitialStages,
  nowIso,
  pushLog,
  toAcceptedModes,
  toFileSystemSafe,
  toJobSummary,
  toPublicJob,
  updateStage
} from "./job-engine/stage-state.js";
import { createTemplateCopyFilter } from "./job-engine/template-copy-filter.js";
import type { CreateJobEngineInput, JobEngine, JobRecord, WorkspacePipelineError } from "./job-engine/types.js";
import { generateRemapSuggestions } from "./job-engine/remap-suggestions.js";
import {
  applyLocalSyncPlan,
  computeLocalSyncPlanFingerprint,
  LocalSyncError,
  type LocalSyncPlan,
  planLocalSync
} from "./job-engine/local-sync.js";
import type { DesignIR } from "./parity/types-ir.js";
import { StageArtifactStore } from "./job-engine/pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./job-engine/pipeline/artifact-keys.js";
import { PipelineOrchestrator, isPipelineCancellationError } from "./job-engine/pipeline/orchestrator.js";
import type { PipelineExecutionContext } from "./job-engine/pipeline/context.js";
import { syncPublicJobProjection } from "./job-engine/pipeline/public-job-projection.js";
import { buildRegenerationPipelinePlan, buildSubmissionPipelinePlan } from "./job-engine/services/pipeline-services.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app");
const TEMPLATE_COPY_FILTER = createTemplateCopyFilter({ templateRoot: TEMPLATE_ROOT });

const WORKSPACE_JOB_STAGES: WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr"
];
const WORKSPACE_JOB_STAGE_SET = new Set<WorkspaceJobStageName>(WORKSPACE_JOB_STAGES);
const LOCAL_SYNC_CONFIRMATION_TTL_MS = 10 * 60_000;

interface LocalSyncConfirmationRecord {
  token: string;
  jobId: string;
  sourceJobId: string;
  expiresAtMs: number;
  plan: LocalSyncPlan;
  planFingerprint: string;
}

const isWorkspaceJobStageName = (value: unknown): value is WorkspaceJobStageName => {
  return typeof value === "string" && WORKSPACE_JOB_STAGE_SET.has(value as WorkspaceJobStageName);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toDiagnosticInputs = (value: unknown): PipelineDiagnosticInput[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const diagnostics: PipelineDiagnosticInput[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }
    if (typeof candidate.code !== "string" || typeof candidate.message !== "string" || typeof candidate.suggestion !== "string") {
      continue;
    }
    diagnostics.push({
      code: candidate.code,
      message: candidate.message,
      suggestion: candidate.suggestion,
      ...(isWorkspaceJobStageName(candidate.stage) ? { stage: candidate.stage } : {}),
      ...(candidate.severity === "error" || candidate.severity === "warning" || candidate.severity === "info"
        ? { severity: candidate.severity }
        : {}),
      ...(typeof candidate.figmaNodeId === "string" ? { figmaNodeId: candidate.figmaNodeId } : {}),
      ...(typeof candidate.figmaUrl === "string" ? { figmaUrl: candidate.figmaUrl } : {}),
      ...(isRecord(candidate.details) ? { details: candidate.details } : {})
    });
  }
  return diagnostics.length > 0 ? diagnostics : undefined;
};

const toPipelineError = ({
  error,
  fallbackStage
}: {
  error: unknown;
  fallbackStage: WorkspaceJobStageName;
}): WorkspacePipelineError => {
  if (isPipelineError(error)) {
    return error;
  }
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    const candidate = error as Error & {
      code: string;
      stage?: unknown;
      diagnostics?: unknown;
    };
    const diagnostics = toDiagnosticInputs(candidate.diagnostics);
    return createPipelineError({
      code: candidate.code,
      stage: isWorkspaceJobStageName(candidate.stage) ? candidate.stage : fallbackStage,
      message: candidate.message,
      cause: error,
      ...(diagnostics ? { diagnostics } : {})
    });
  }
  return createPipelineError({
    code: "E_PIPELINE_UNKNOWN",
    stage: fallbackStage,
    message: getErrorMessage(error),
    cause: error
  });
};

/** Recursively collect all node IDs from an IR node tree. */
const collectNodeIds = (node: unknown, ids: Set<string>): void => {
  if (!isRecord(node)) {
    return;
  }
  if (typeof node.id === "string") {
    ids.add(node.id);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectNodeIds(child, ids);
    }
  }
};

const isPipelineError = (error: unknown): error is WorkspacePipelineError => {
  return (
    error instanceof Error &&
    "stage" in error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    isWorkspaceJobStageName((error as { stage?: unknown }).stage)
  );
};

const resolveJobGenerationLocale = ({
  submitGenerationLocale,
  runtimeGenerationLocale
}: {
  submitGenerationLocale: string | undefined;
  runtimeGenerationLocale: string;
}): { locale: string; warningMessage?: string } => {
  const runtimeLocale = resolveGenerationLocale({
    requestedLocale: runtimeGenerationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE
  }).locale;
  const normalizedSubmitLocale = normalizeGenerationLocale(submitGenerationLocale);
  if (normalizedSubmitLocale) {
    return { locale: normalizedSubmitLocale };
  }
  if (typeof submitGenerationLocale === "string" && submitGenerationLocale.trim().length > 0) {
    return {
      locale: runtimeLocale,
      warningMessage: `Invalid generationLocale override '${submitGenerationLocale}' - falling back to '${runtimeLocale}'.`
    };
  }
  return { locale: runtimeLocale };
};

const resolveFigmaSourceMode = ({
  submitFigmaSourceMode
}: {
  submitFigmaSourceMode: string | undefined;
}): WorkspaceFigmaSourceMode => {
  const normalized = submitFigmaSourceMode?.trim().toLowerCase();
  if (normalized === "local_json") {
    return "local_json";
  }
  if (normalized === "hybrid") {
    return "hybrid";
  }
  return "rest";
};

const resolveFormHandlingMode = ({
  submitFormHandlingMode
}: {
  submitFormHandlingMode: WorkspaceFormHandlingMode | undefined;
}): WorkspaceFormHandlingMode => {
  return submitFormHandlingMode === "legacy_use_state" ? "legacy_use_state" : "react_hook_form";
};

export const createJobEngine = ({ resolveBaseUrl, paths, runtime }: CreateJobEngineInput): JobEngine => {
  const resolvedPaths = resolveAbsoluteOutputRoot({ outputRoot: paths.outputRoot });
  const resolvedWorkspaceRoot = path.resolve(paths.workspaceRoot ?? path.resolve(paths.outputRoot, ".."));
  const jobs = new Map<string, JobRecord>();
  const queuedJobIds: string[] = [];
  const queuedJobInputs = new Map<string, WorkspaceJobInput>();
  const queuedRegenInputs = new Map<string, WorkspaceRegenerationInput>();
  const runningJobIds = new Set<string>();
  const localSyncConfirmations = new Map<string, LocalSyncConfirmationRecord>();

  const isAbortLikeError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }
    const normalizedMessage = error.message.toLowerCase();
    return error.name === "AbortError" || normalizedMessage.includes("abort") || normalizedMessage.includes("canceled");
  };

  class JobQueueBackpressureError extends Error {
    code = "E_JOB_QUEUE_FULL" as const;
    queue: WorkspaceJobStatus["queue"];

    constructor({ queue }: { queue: WorkspaceJobStatus["queue"] }) {
      super(
        `Job queue limit reached (running=${queue.runningCount}/${queue.maxConcurrentJobs}, queued=${queue.queuedCount}/${queue.maxQueuedJobs}).`
      );
      this.name = "JobQueueBackpressureError";
      this.queue = queue;
    }
  }

  const toQueueSnapshot = ({ jobId }: { jobId?: string } = {}): WorkspaceJobStatus["queue"] => {
    const position = jobId ? queuedJobIds.indexOf(jobId) : -1;
    return {
      runningCount: runningJobIds.size,
      queuedCount: queuedJobIds.length,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
      ...(position >= 0 ? { position: position + 1 } : {})
    };
  };

  const refreshQueueSnapshots = (): void => {
    for (const [jobId, job] of jobs.entries()) {
      job.queue = toQueueSnapshot({ jobId });
    }
  };

  const createSyncError = ({
    code,
    message
  }: {
    code:
      | "E_SYNC_JOB_NOT_FOUND"
      | "E_SYNC_JOB_NOT_COMPLETED"
      | "E_SYNC_REGEN_REQUIRED"
      | "E_SYNC_CONFIRMATION_REQUIRED"
      | "E_SYNC_CONFIRMATION_INVALID"
      | "E_SYNC_CONFIRMATION_EXPIRED"
      | "E_SYNC_PREVIEW_STALE";
    message: string;
  }): Error & { code: string } => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  };

  const pruneExpiredSyncConfirmations = (): void => {
    const nowMs = Date.now();
    for (const [token, record] of localSyncConfirmations.entries()) {
      if (record.expiresAtMs <= nowMs) {
        localSyncConfirmations.delete(token);
      }
    }
  };

  const resolveSyncContext = ({
    jobId
  }: {
    jobId: string;
  }): {
    job: JobRecord;
    sourceJobId: string;
    boardKey: string;
    generatedProjectDir: string;
  } => {
    const job = jobs.get(jobId);
    if (!job) {
      throw createSyncError({
        code: "E_SYNC_JOB_NOT_FOUND",
        message: `Unknown job '${jobId}'.`
      });
    }

    if (!job.lineage) {
      throw createSyncError({
        code: "E_SYNC_REGEN_REQUIRED",
        message: `Job '${jobId}' is not a regeneration job; local sync is only available for regenerated output.`
      });
    }

    if (job.status !== "completed") {
      throw createSyncError({
        code: "E_SYNC_JOB_NOT_COMPLETED",
        message: `Job '${jobId}' has status '${job.status}' — local sync is only available for completed jobs.`
      });
    }

    if (!job.artifacts.generatedProjectDir) {
      const missingGeneratedDir = new LocalSyncError(
        "E_SYNC_GENERATED_DIR_MISSING",
        `Generated project directory not available for job '${jobId}'.`
      );
      throw missingGeneratedDir;
    }

    const boardKeySeed = job.request.figmaFileKey?.trim() || job.request.figmaJsonPath?.trim() || "regeneration";
    return {
      job,
      sourceJobId: job.lineage.sourceJobId,
      boardKey: resolveBoardKey(boardKeySeed),
      generatedProjectDir: job.artifacts.generatedProjectDir
    };
  };

  const markQueuedStagesSkippedAfterCancellation = ({
    job,
    reason
  }: {
    job: JobRecord;
    reason: string;
  }): void => {
    for (const stage of job.stages) {
      if (stage.status === "queued") {
        updateStage({ job, stage: stage.name, status: "skipped", message: reason });
      }
    }
  };

  const runJob = async (job: JobRecord, input: WorkspaceJobInput): Promise<void> => {
    job.status = "running";
    job.startedAt = nowIso();
    const jobAbortController = new AbortController();
    job.abortController = jobAbortController;
    const fetchWithCancellation: typeof fetch = async (resource, init) => {
      if (jobAbortController.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const existingSignal = init?.signal;
      const mergedSignal =
        existingSignal instanceof AbortSignal
          ? AbortSignal.any([existingSignal, jobAbortController.signal])
          : jobAbortController.signal;
      return await runtime.fetchImpl(resource, {
        ...init,
        signal: mergedSignal
      });
    };
    const resolvedBrandTheme: WorkspaceBrandTheme = input.brandTheme ?? runtime.brandTheme;
    const resolvedFigmaSourceMode = resolveFigmaSourceMode({ submitFigmaSourceMode: input.figmaSourceMode });
    const resolvedFormHandlingMode = resolveFormHandlingMode({
      submitFormHandlingMode: input.formHandlingMode
    });
    const generationLocaleResolution = resolveJobGenerationLocale({
      submitGenerationLocale: input.generationLocale,
      runtimeGenerationLocale: runtime.generationLocale
    });
    const resolvedGenerationLocale = generationLocaleResolution.locale;
    const figmaFileKeyForDiagnostics =
      resolvedFigmaSourceMode === "local_json" ? undefined : input.figmaFileKey?.trim();

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);
    const iconMapFilePath = runtime.iconMapFilePath ?? path.join(resolvedPaths.outputRoot, "icon-fallback-map.json");
    const designSystemFilePath = runtime.designSystemFilePath ?? path.join(resolvedPaths.outputRoot, "design-system.json");
    const irCacheDir = path.join(resolvedPaths.outputRoot, "cache", "ir-derivation");

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.figmaJsonFile = figmaJsonFile;
    job.artifacts.designIrFile = designIrFile;
    job.artifacts.stageTimingsFile = stageTimingsFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    let collectedDiagnostics: WorkspaceJobDiagnostic[] | undefined;
    const persistStageTimings = async (): Promise<void> => {
      const payload: {
        jobId: string;
        status: WorkspaceJobStatus["status"];
        generatedAt: string;
        stages: WorkspaceJobStatus["stages"];
        diagnostics?: WorkspaceJobDiagnostic[];
        cancellation?: WorkspaceJobStatus["cancellation"];
        error?: WorkspaceJobStatus["error"];
      } = {
        jobId: job.jobId,
        status: job.status,
        generatedAt: nowIso(),
        stages: job.stages
      };
      if (collectedDiagnostics && collectedDiagnostics.length > 0) {
        payload.diagnostics = collectedDiagnostics;
      }
      if (job.cancellation) {
        payload.cancellation = job.cancellation;
      }
      if (job.error) {
        payload.error = job.error;
      }
      await writeFile(stageTimingsFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    };

    const appendDiagnostics = ({
      stage,
      diagnostics
    }: {
      stage: WorkspaceJobStageName;
      diagnostics: PipelineDiagnosticInput[];
    }): void => {
      if (diagnostics.length === 0) {
        return;
      }
      const normalized = createPipelineError({
        code: "E_PIPELINE_DIAGNOSTICS_INTERNAL",
        stage,
        message: "Collected pipeline diagnostics.",
        diagnostics
      }).diagnostics;
      collectedDiagnostics = mergePipelineDiagnostics({
        ...(collectedDiagnostics ? { first: collectedDiagnostics } : {}),
        ...(normalized ? { second: normalized } : {})
      });
    };

    try {
      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.jobsRoot, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      const artifactStore = new StageArtifactStore({ jobDir });
      const context: PipelineExecutionContext = {
        mode: "submission",
        job,
        input,
        runtime,
        resolvedPaths,
        resolvedWorkspaceRoot,
        resolveBaseUrl,
        jobAbortController,
        fetchWithCancellation,
        paths: {
          jobDir,
          generatedProjectDir,
          figmaRawJsonFile,
          figmaJsonFile,
          designIrFile,
          stageTimingsFile,
          reproDir,
          iconMapFilePath,
          designSystemFilePath,
          irCacheDir,
          templateRoot: TEMPLATE_ROOT,
          templateCopyFilter: TEMPLATE_COPY_FILTER
        },
        artifactStore,
        resolvedBrandTheme,
        resolvedFigmaSourceMode,
        resolvedFormHandlingMode,
        generationLocaleResolution,
        resolvedGenerationLocale,
        appendDiagnostics,
        getCollectedDiagnostics: () => collectedDiagnostics,
        syncPublicJobProjection: async () => {
          await syncPublicJobProjection({ job, artifactStore });
        },
        ...(figmaFileKeyForDiagnostics ? { figmaFileKeyForDiagnostics } : {})
      };

      const orchestrator = new PipelineOrchestrator({
        toPipelineError,
        isAbortLikeError
      });
      await orchestrator.execute({
        context,
        plan: buildSubmissionPipelinePlan()
      });

      job.status = "completed";
      job.finishedAt = nowIso();
      delete job.currentStage;
      await persistStageTimings();
      const generationSummary = await artifactStore.getValue<{ generatedPaths?: string[] }>(STAGE_ARTIFACT_KEYS.codegenSummary);
      pushLog({
        job,
        level: "info",
        message:
          `Job completed. Generated output at ${generatedProjectDir} ` +
          `(${generationSummary?.generatedPaths?.length ?? 0} artifacts).`
      });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        job.status = "canceled";
        job.finishedAt = nowIso();
        job.currentStage = error.stage;
        if (!job.cancellation) {
          job.cancellation = {
            requestedAt: nowIso(),
            reason: error.message,
            requestedBy: "api"
          };
        }
        job.cancellation.completedAt = nowIso();
        markQueuedStagesSkippedAfterCancellation({ job, reason: error.message });
        try {
          await persistStageTimings();
        } catch {
          // Ignore stage-timing persistence failures during cancellation handling.
        }
        pushLog({
          job,
          level: "warn",
          stage: error.stage,
          message: `Job canceled: ${error.message}`
        });
        return;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: job.currentStage ?? "figma.source"
      });
      const mergedDiagnostics = mergePipelineDiagnostics({
        ...(typedError.diagnostics ? { first: typedError.diagnostics } : {}),
        ...(collectedDiagnostics ? { second: collectedDiagnostics } : {})
      });
      if (mergedDiagnostics) {
        collectedDiagnostics = mergedDiagnostics;
      }

      job.status = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message,
        ...(mergedDiagnostics ? { diagnostics: mergedDiagnostics } : {})
      };
      job.currentStage = typedError.stage;
      try {
        await persistStageTimings();
      } catch {
        // Ignore stage-timing persistence failures during error handling.
      }
      pushLog({
        job,
        level: "error",
        stage: typedError.stage,
        message: `Job failed: ${typedError.code} ${typedError.message}`
      });
    } finally {
      delete job.abortController;
    }
  };

  const executeJob = ({ job, input }: { job: JobRecord; input: WorkspaceJobInput }): void => {
    if (runningJobIds.has(job.jobId)) {
      return;
    }
    runningJobIds.add(job.jobId);
    refreshQueueSnapshots();
    queueMicrotask(() => {
      void runJob(job, input).finally(() => {
        runningJobIds.delete(job.jobId);
        refreshQueueSnapshots();
        drainQueuedJobs();
        refreshQueueSnapshots();
      });
    });
  };

  const submitJob = (input: WorkspaceJobInput) => {
    if (runningJobIds.size >= runtime.maxConcurrentJobs && queuedJobIds.length >= runtime.maxQueuedJobs) {
      throw new JobQueueBackpressureError({
        queue: toQueueSnapshot()
      });
    }

    const jobId = randomUUID();
    const acceptedModes =
      input.figmaSourceMode === undefined ? toAcceptedModes() : toAcceptedModes({ figmaSourceMode: input.figmaSourceMode });
    const generationLocaleResolution = resolveJobGenerationLocale({
      submitGenerationLocale: input.generationLocale,
      runtimeGenerationLocale: runtime.generationLocale
    });
    const resolvedFormHandlingMode = resolveFormHandlingMode({
      submitFormHandlingMode: input.formHandlingMode
    });
    const request: WorkspaceJobStatus["request"] = {
      enableGitPr: input.enableGitPr === true,
      figmaSourceMode: acceptedModes.figmaSourceMode,
      llmCodegenMode: acceptedModes.llmCodegenMode,
      brandTheme: input.brandTheme ?? runtime.brandTheme,
      generationLocale: generationLocaleResolution.locale,
      formHandlingMode: resolvedFormHandlingMode
    };
    if (input.figmaFileKey) {
      request.figmaFileKey = input.figmaFileKey;
    }
    if (input.figmaJsonPath) {
      request.figmaJsonPath = input.figmaJsonPath;
    }
    if (input.repoUrl) {
      request.repoUrl = input.repoUrl;
    }
    if (input.projectName) {
      request.projectName = input.projectName;
    }
    if (input.targetPath) {
      request.targetPath = input.targetPath;
    }

    const job: JobRecord = {
      jobId,
      status: "queued",
      submittedAt: nowIso(),
      request,
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: resolvedPaths.outputRoot,
        jobDir: path.join(resolvedPaths.jobsRoot, jobId)
      },
      preview: {
        enabled: runtime.previewEnabled
      },
      queue: toQueueSnapshot({ jobId })
    };

    jobs.set(jobId, job);

    pushLog({ job, level: "info", message: "Job accepted by workspace-dev runtime." });

    if (runningJobIds.size < runtime.maxConcurrentJobs) {
      executeJob({ job, input });
    } else {
      queuedJobIds.push(jobId);
      queuedJobInputs.set(jobId, { ...input });
      pushLog({
        job,
        level: "info",
        message: `Job queued with position ${queuedJobIds.length}.`
      });
      refreshQueueSnapshots();
    }

    return {
      jobId,
      status: "queued" as const,
      acceptedModes
    };
  };

  const runRegenerationJob = async (job: JobRecord, regenInput: WorkspaceRegenerationInput): Promise<void> => {
    job.status = "running";
    job.startedAt = nowIso();
    const jobAbortController = new AbortController();
    job.abortController = jobAbortController;

    const sourceRecord = jobs.get(regenInput.sourceJobId);
    if (!sourceRecord) {
      job.status = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: "E_REGEN_SOURCE_NOT_FOUND",
        stage: "figma.source",
        message: `Source job '${regenInput.sourceJobId}' not found.`
      };
      return;
    }

    const resolvedFormHandlingMode = sourceRecord.request.formHandlingMode;
    const resolvedGenerationLocale = sourceRecord.request.generationLocale;
    const resolvedFigmaSourceMode = sourceRecord.request.figmaSourceMode;
    const resolvedBrandTheme = sourceRecord.request.brandTheme;

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);
    const iconMapFilePath = runtime.iconMapFilePath ?? path.join(resolvedPaths.outputRoot, "icon-fallback-map.json");
    const designSystemFilePath = runtime.designSystemFilePath ?? path.join(resolvedPaths.outputRoot, "design-system.json");
    const irCacheDir = path.join(resolvedPaths.outputRoot, "cache", "ir-derivation");

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.designIrFile = designIrFile;
    job.artifacts.stageTimingsFile = stageTimingsFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    let collectedDiagnostics: WorkspaceJobDiagnostic[] | undefined;
    const persistStageTimings = async (): Promise<void> => {
      const payload: {
        jobId: string;
        status: WorkspaceJobStatus["status"];
        generatedAt: string;
        stages: WorkspaceJobStatus["stages"];
        lineage?: WorkspaceJobStatus["lineage"];
        diagnostics?: WorkspaceJobDiagnostic[];
        error?: WorkspaceJobStatus["error"];
      } = {
        jobId: job.jobId,
        status: job.status,
        generatedAt: nowIso(),
        stages: job.stages
      };
      if (job.lineage) {
        payload.lineage = job.lineage;
      }
      if (collectedDiagnostics && collectedDiagnostics.length > 0) {
        payload.diagnostics = collectedDiagnostics;
      }
      if (job.error) {
        payload.error = job.error;
      }
      await writeFile(stageTimingsFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    };

    const appendDiagnostics = ({
      stage,
      diagnostics
    }: {
      stage: WorkspaceJobStageName;
      diagnostics: PipelineDiagnosticInput[];
    }): void => {
      if (diagnostics.length === 0) {
        return;
      }
      const normalized = createPipelineError({
        code: "E_PIPELINE_DIAGNOSTICS_INTERNAL",
        stage,
        message: "Collected pipeline diagnostics.",
        diagnostics
      }).diagnostics;
      collectedDiagnostics = mergePipelineDiagnostics({
        ...(collectedDiagnostics ? { first: collectedDiagnostics } : {}),
        ...(normalized ? { second: normalized } : {})
      });
    };

    try {
      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      const artifactStore = new StageArtifactStore({ jobDir });
      await artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.regenerationSourceIr,
        stage: "ir.derive",
        value: {
          sourceJobId: regenInput.sourceJobId,
          sourceIrFile: sourceRecord.artifacts.designIrFile
        }
      });
      await artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.regenerationOverrides,
        stage: "ir.derive",
        value: regenInput.overrides
      });
      const context: PipelineExecutionContext = {
        mode: "regeneration",
        job,
        regenerationInput: regenInput,
        sourceJob: sourceRecord,
        runtime,
        resolvedPaths,
        resolvedWorkspaceRoot,
        resolveBaseUrl,
        jobAbortController,
        fetchWithCancellation: runtime.fetchImpl,
        paths: {
          jobDir,
          generatedProjectDir,
          figmaRawJsonFile,
          figmaJsonFile,
          designIrFile,
          stageTimingsFile,
          reproDir,
          iconMapFilePath,
          designSystemFilePath,
          irCacheDir,
          templateRoot: TEMPLATE_ROOT,
          templateCopyFilter: TEMPLATE_COPY_FILTER
        },
        artifactStore,
        resolvedBrandTheme,
        resolvedFigmaSourceMode,
        resolvedFormHandlingMode,
        generationLocaleResolution: { locale: resolvedGenerationLocale },
        resolvedGenerationLocale,
        appendDiagnostics,
        getCollectedDiagnostics: () => collectedDiagnostics,
        syncPublicJobProjection: async () => {
          await syncPublicJobProjection({ job, artifactStore });
        },
        ...(resolvedFigmaSourceMode === "local_json" || !sourceRecord.request.figmaFileKey?.trim()
          ? {}
          : { figmaFileKeyForDiagnostics: sourceRecord.request.figmaFileKey.trim() })
      };

      const orchestrator = new PipelineOrchestrator({
        toPipelineError,
        isAbortLikeError
      });
      await orchestrator.execute({
        context,
        plan: buildRegenerationPipelinePlan()
      });

      job.status = "completed";
      job.finishedAt = nowIso();
      delete job.currentStage;
      await persistStageTimings();
      const generationSummary = await artifactStore.getValue<{ generatedPaths?: string[] }>(STAGE_ARTIFACT_KEYS.codegenSummary);
      pushLog({
        job,
        level: "info",
        message:
          `Regeneration job completed. Generated output at ${generatedProjectDir} ` +
          `(${generationSummary?.generatedPaths?.length ?? 0} artifacts).`
      });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        job.status = "canceled";
        job.finishedAt = nowIso();
        job.currentStage = error.stage;
        if (!job.cancellation) {
          job.cancellation = {
            requestedAt: nowIso(),
            reason: error.message,
            requestedBy: "api"
          };
        }
        job.cancellation.completedAt = nowIso();
        markQueuedStagesSkippedAfterCancellation({ job, reason: error.message });
        try {
          await persistStageTimings();
        } catch {
          // Ignore
        }
        pushLog({
          job,
          level: "warn",
          stage: error.stage,
          message: `Regeneration job canceled: ${error.message}`
        });
        return;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: job.currentStage ?? "ir.derive"
      });
      const mergedDiagnostics = mergePipelineDiagnostics({
        ...(typedError.diagnostics ? { first: typedError.diagnostics } : {}),
        ...(collectedDiagnostics ? { second: collectedDiagnostics } : {})
      });
      if (mergedDiagnostics) {
        collectedDiagnostics = mergedDiagnostics;
      }

      job.status = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message,
        ...(mergedDiagnostics ? { diagnostics: mergedDiagnostics } : {})
      };
      job.currentStage = typedError.stage;
      try {
        await persistStageTimings();
      } catch {
        // Ignore
      }
      pushLog({
        job,
        level: "error",
        stage: typedError.stage,
        message: `Regeneration job failed: ${typedError.code} ${typedError.message}`
      });
    } finally {
      delete job.abortController;
    }
  };

  const executeRegenerationJob = ({ job, input }: { job: JobRecord; input: WorkspaceRegenerationInput }): void => {
    if (runningJobIds.has(job.jobId)) {
      return;
    }
    runningJobIds.add(job.jobId);
    refreshQueueSnapshots();
    queueMicrotask(() => {
      void runRegenerationJob(job, input).finally(() => {
        runningJobIds.delete(job.jobId);
        refreshQueueSnapshots();
        drainQueuedJobs();
        refreshQueueSnapshots();
      });
    });
  };

  const drainQueuedJobs = (): void => {
    while (runningJobIds.size < runtime.maxConcurrentJobs && queuedJobIds.length > 0) {
      const nextJobId = queuedJobIds.shift();
      if (!nextJobId) {
        break;
      }

      const nextJob = jobs.get(nextJobId);
      const nextInput = queuedJobInputs.get(nextJobId);
      const nextRegenInput = queuedRegenInputs.get(nextJobId);

      if (!nextJob || nextJob.status !== "queued") {
        queuedJobInputs.delete(nextJobId);
        queuedRegenInputs.delete(nextJobId);
        continue;
      }

      if (nextInput) {
        queuedJobInputs.delete(nextJobId);
        executeJob({ job: nextJob, input: nextInput });
        continue;
      }

      if (nextRegenInput) {
        queuedRegenInputs.delete(nextJobId);
        executeRegenerationJob({ job: nextJob, input: nextRegenInput });
        continue;
      }
    }
  };

  const submitRegeneration = (input: WorkspaceRegenerationInput) => {
    // Validate source job exists and is completed
    const sourceJob = jobs.get(input.sourceJobId);
    if (!sourceJob) {
      const err = new Error(`Source job '${input.sourceJobId}' not found.`);
      (err as Error & { code: string }).code = "E_REGEN_SOURCE_NOT_FOUND";
      throw err;
    }
    if (sourceJob.status !== "completed") {
      const err = new Error(`Source job '${input.sourceJobId}' has status '${sourceJob.status}' — only completed jobs can be used as regeneration source.`);
      (err as Error & { code: string }).code = "E_REGEN_SOURCE_NOT_COMPLETED";
      throw err;
    }

    if (runningJobIds.size >= runtime.maxConcurrentJobs && queuedJobIds.length >= runtime.maxQueuedJobs) {
      throw new JobQueueBackpressureError({
        queue: toQueueSnapshot()
      });
    }

    const jobId = randomUUID();
    const job: JobRecord = {
      jobId,
      status: "queued",
      submittedAt: nowIso(),
      request: { ...sourceJob.request, enableGitPr: false },
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: resolvedPaths.outputRoot,
        jobDir: path.join(resolvedPaths.jobsRoot, jobId)
      },
      preview: {
        enabled: runtime.previewEnabled
      },
      queue: toQueueSnapshot({ jobId }),
      lineage: {
        sourceJobId: input.sourceJobId,
        overrideCount: input.overrides.length,
        ...(input.draftId ? { draftId: input.draftId } : {}),
        ...(input.baseFingerprint ? { baseFingerprint: input.baseFingerprint } : {})
      }
    };

    jobs.set(jobId, job);
    pushLog({ job, level: "info", message: `Regeneration job accepted (source=${input.sourceJobId}, overrides=${input.overrides.length}).` });

    if (runningJobIds.size < runtime.maxConcurrentJobs) {
      executeRegenerationJob({ job, input });
    } else {
      queuedJobIds.push(jobId);
      queuedRegenInputs.set(jobId, { ...input });
      pushLog({
        job,
        level: "info",
        message: `Regeneration job queued with position ${queuedJobIds.length}.`
      });
      refreshQueueSnapshots();
    }

    return {
      jobId,
      sourceJobId: input.sourceJobId,
      status: "queued" as const,
      acceptedModes: toAcceptedModes({ figmaSourceMode: sourceJob.request.figmaSourceMode })
    };
  };

  const previewLocalSync: JobEngine["previewLocalSync"] = async ({
    jobId,
    targetPath
  }): Promise<WorkspaceLocalSyncDryRunResult> => {
    pruneExpiredSyncConfirmations();
    const syncContext = resolveSyncContext({ jobId });
    const plan = await planLocalSync({
      generatedProjectDir: syncContext.generatedProjectDir,
      workspaceRoot: resolvedWorkspaceRoot,
      outputRoot: resolvedPaths.outputRoot,
      targetPath: targetPath ?? syncContext.job.request.targetPath,
      boardKey: syncContext.boardKey
    });
    const token = randomUUID();
    const expiresAtMs = Date.now() + LOCAL_SYNC_CONFIRMATION_TTL_MS;
    const planFingerprint = computeLocalSyncPlanFingerprint({ plan });
    localSyncConfirmations.set(token, {
      token,
      jobId,
      sourceJobId: syncContext.sourceJobId,
      expiresAtMs,
      plan,
      planFingerprint
    });

    return {
      jobId,
      sourceJobId: syncContext.sourceJobId,
      boardKey: plan.boardKey,
      targetPath: plan.targetPath,
      scopePath: plan.scopePath,
      destinationRoot: plan.destinationRoot,
      files: plan.files.map((entry) => ({
        path: entry.relativePath,
        action: entry.action,
        status: entry.status,
        reason: entry.reason,
        decision: entry.decision,
        selectedByDefault: entry.selectedByDefault,
        sizeBytes: entry.sizeBytes,
        message: entry.message
      })),
      summary: { ...plan.summary },
      confirmationToken: token,
      confirmationExpiresAt: new Date(expiresAtMs).toISOString()
    };
  };

  const applyLocalSync: JobEngine["applyLocalSync"] = async ({
    jobId,
    confirmationToken,
    confirmOverwrite,
    fileDecisions
  }): Promise<WorkspaceLocalSyncApplyResult> => {
    pruneExpiredSyncConfirmations();
    const syncContext = resolveSyncContext({ jobId });

    if (!confirmOverwrite) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_REQUIRED",
        message: "Local sync apply requires explicit overwrite confirmation."
      });
    }

    const confirmation = localSyncConfirmations.get(confirmationToken);
    if (!confirmation) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_INVALID",
        message: "Invalid or unknown local sync confirmation token."
      });
    }
    if (confirmation.expiresAtMs <= Date.now()) {
      localSyncConfirmations.delete(confirmationToken);
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_EXPIRED",
        message: "Local sync confirmation token expired. Request a new dry-run preview."
      });
    }
    if (confirmation.jobId !== jobId) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_INVALID",
        message: "Local sync confirmation token does not match the selected job."
      });
    }

    const currentPlan = await planLocalSync({
      generatedProjectDir: syncContext.generatedProjectDir,
      workspaceRoot: resolvedWorkspaceRoot,
      outputRoot: resolvedPaths.outputRoot,
      targetPath: confirmation.plan.targetPath,
      boardKey: syncContext.boardKey
    });
    const currentFingerprint = computeLocalSyncPlanFingerprint({ plan: currentPlan });
    if (currentFingerprint !== confirmation.planFingerprint) {
      localSyncConfirmations.delete(confirmationToken);
      throw createSyncError({
        code: "E_SYNC_PREVIEW_STALE",
        message: "Local sync preview is stale. Request a new dry-run preview before applying."
      });
    }

    const appliedPlan = await applyLocalSyncPlan({
      plan: currentPlan,
      fileDecisions,
      jobId,
      sourceJobId: syncContext.sourceJobId
    });
    localSyncConfirmations.delete(confirmationToken);

    return {
      jobId,
      sourceJobId: syncContext.sourceJobId,
      boardKey: appliedPlan.boardKey,
      targetPath: appliedPlan.targetPath,
      scopePath: appliedPlan.scopePath,
      destinationRoot: appliedPlan.destinationRoot,
      files: appliedPlan.files.map((entry) => ({
        path: entry.relativePath,
        action: entry.action,
        status: entry.status,
        reason: entry.reason,
        decision: entry.decision,
        selectedByDefault: entry.selectedByDefault,
        sizeBytes: entry.sizeBytes,
        message: entry.message
      })),
      summary: { ...appliedPlan.summary },
      appliedAt: nowIso()
    };
  };

  const cancelJob = ({
    jobId,
    reason
  }: {
    jobId: string;
    reason?: string;
  }): WorkspaceJobStatus | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      refreshQueueSnapshots();
      return toPublicJob(job);
    }

    const cancellationReason =
      typeof reason === "string" && reason.trim().length > 0
        ? reason.trim().slice(0, 240)
        : "Cancellation requested via API.";

    if (!job.cancellation) {
      job.cancellation = {
        requestedAt: nowIso(),
        reason: cancellationReason,
        requestedBy: "api"
      };
    }

    if (job.status === "queued") {
      const queuedIndex = queuedJobIds.indexOf(jobId);
      if (queuedIndex >= 0) {
        queuedJobIds.splice(queuedIndex, 1);
      }
      queuedJobInputs.delete(jobId);
      queuedRegenInputs.delete(jobId);
      job.status = "canceled";
      job.finishedAt = nowIso();
      job.cancellation.completedAt = nowIso();
      delete job.currentStage;
      markQueuedStagesSkippedAfterCancellation({
        job,
        reason: cancellationReason
      });
      pushLog({
        job,
        level: "warn",
        message: `Job canceled while queued: ${cancellationReason}`
      });
      refreshQueueSnapshots();
      return toPublicJob(job);
    }

    pushLog({
      job,
      level: "warn",
      ...(job.currentStage ? { stage: job.currentStage } : {}),
      message: `Cancellation requested: ${cancellationReason}`
    });
    job.abortController?.abort(cancellationReason);
    refreshQueueSnapshots();
    return toPublicJob(job);
  };

  const getJob = (jobId: string): WorkspaceJobStatus | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }
    job.queue = toQueueSnapshot({ jobId });
    return toPublicJob(job);
  };

  const getJobResult = (jobId: string): WorkspaceJobResult | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const result: WorkspaceJobResult = {
      jobId: job.jobId,
      status: job.status,
      summary: toJobSummary(job),
      artifacts: { ...job.artifacts },
      preview: { ...job.preview }
    };
    if (job.lineage) {
      result.lineage = { ...job.lineage };
    }
    if (job.cancellation) {
      result.cancellation = { ...job.cancellation };
    }
    if (job.generationDiff) {
      result.generationDiff = { ...job.generationDiff };
    }
    if (job.gitPr) {
      result.gitPr = { ...job.gitPr };
    }
    if (job.error) {
      result.error = { ...job.error };
    }

    return result;
  };

  const resolvePreviewAsset = async (
    jobId: string,
    previewPath: string
  ): Promise<{ content: Buffer; contentType: string } | undefined> => {
    const safeJobId = toFileSystemSafe(jobId);
    if (safeJobId !== jobId) {
      return undefined;
    }

    const normalizedPart = normalizePathPart(previewPath || "index.html");
    if (normalizedPart === undefined) {
      return undefined;
    }
    const fallbackPath = normalizedPart.length > 0 ? normalizedPart : "index.html";
    const previewRoot = path.resolve(resolvedPaths.reprosRoot, safeJobId);
    const candidatePath = path.resolve(previewRoot, fallbackPath);

    if (!isWithinRoot({ candidatePath, rootPath: previewRoot })) {
      return undefined;
    }
    if (await hasSymlinkInPath({ candidatePath, rootPath: previewRoot })) {
      return undefined;
    }

    try {
      const content = await readFile(candidatePath);
      return {
        content,
        contentType: getContentType(candidatePath)
      };
    } catch {
      if (fallbackPath !== "index.html") {
        const indexPath = path.resolve(previewRoot, "index.html");
        if (await hasSymlinkInPath({ candidatePath: indexPath, rootPath: previewRoot })) {
          return undefined;
        }
        try {
          const content = await readFile(indexPath);
          return {
            content,
            contentType: "text/html; charset=utf-8"
          };
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  };

  const getJobRecord: JobEngine["getJobRecord"] = (jobId) => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }
    return {
      jobId: job.jobId,
      status: job.status,
      artifacts: { ...job.artifacts }
    };
  };

  const createPrFromJob: JobEngine["createPrFromJob"] = async ({ jobId, prInput }) => {
    const job = jobs.get(jobId);
    if (!job) {
      const err = new Error(`Job '${jobId}' not found.`);
      (err as Error & { code: string }).code = "E_PR_JOB_NOT_FOUND";
      throw err;
    }
    if (job.status !== "completed") {
      const err = new Error(`Job '${jobId}' has status '${job.status}' — only completed jobs support PR creation.`);
      (err as Error & { code: string }).code = "E_PR_JOB_NOT_COMPLETED";
      throw err;
    }
    if (!job.lineage) {
      const err = new Error(`Job '${jobId}' is not a regeneration job — PR creation is only supported for regenerated output.`);
      (err as Error & { code: string }).code = "E_PR_NOT_REGENERATION_JOB";
      throw err;
    }

    const generatedProjectDir = job.artifacts.generatedProjectDir;
    if (!generatedProjectDir) {
      const err = new Error(`Job '${jobId}' has no generated project directory.`);
      (err as Error & { code: string }).code = "E_PR_NO_GENERATED_PROJECT";
      throw err;
    }

    const jobDir = job.artifacts.jobDir;
    const input: WorkspaceJobInput = {
      ...job.request,
      repoUrl: prInput.repoUrl,
      repoToken: prInput.repoToken,
      enableGitPr: true,
      ...(prInput.targetPath !== undefined ? { targetPath: prInput.targetPath } : {})
    };

    const prResult = await runGitPrFlow({
      input,
      jobId,
      generatedProjectDir,
      jobDir,
      onLog: (message) => {
        pushLog({ job, level: "info", stage: "git.pr", message });
      },
      commandTimeoutMs: runtime.commandTimeoutMs,
      ...(job.generationDiff ? { generationDiff: job.generationDiff } : {})
    });

    job.gitPr = {
      status: "executed",
      ...(prResult.prUrl ? { prUrl: prResult.prUrl } : {}),
      branchName: prResult.branchName,
      scopePath: prResult.scopePath,
      changedFiles: prResult.changedFiles
    };

    // Update the git.pr stage to completed
    const gitPrStage = job.stages.find((s) => s.name === "git.pr");
    if (gitPrStage) {
      gitPrStage.status = "completed";
      gitPrStage.completedAt = nowIso();
      gitPrStage.message = prResult.prUrl
        ? `PR created: ${prResult.prUrl}`
        : `Branch pushed: ${prResult.branchName}`;
    }

    return {
      jobId,
      sourceJobId: job.lineage.sourceJobId,
      gitPr: job.gitPr
    };
  };

  const findLatestCompletedJobForBoardKey = (boardKey: string, excludeJobId: string): JobRecord | undefined => {
    let latest: JobRecord | undefined;
    for (const job of jobs.values()) {
      if (job.status !== "completed") {
        continue;
      }
      if (job.jobId === excludeJobId) {
        continue;
      }
      const seed = job.request.figmaFileKey?.trim() || job.request.figmaJsonPath?.trim() || "";
      if (!seed) {
        continue;
      }
      let candidateBoardKey: string;
      try {
        candidateBoardKey = resolveBoardKey(seed);
      } catch {
        continue;
      }
      if (candidateBoardKey !== boardKey) {
        continue;
      }
      if (!latest || (job.finishedAt && (!latest.finishedAt || job.finishedAt > latest.finishedAt))) {
        latest = job;
      }
    }
    return latest;
  };

  const checkStaleDraft: JobEngine["checkStaleDraft"] = async ({
    jobId,
    draftNodeIds
  }) => {
    const job = jobs.get(jobId);
    if (!job) {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey: null,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: `Job '${jobId}' not found.`
      };
    }

    const boardKeySeed = job.request.figmaFileKey?.trim() || job.request.figmaJsonPath?.trim() || "";
    if (!boardKeySeed) {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey: null,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: "Cannot determine board key for this job."
      };
    }

    let boardKey: string;
    try {
      boardKey = resolveBoardKey(boardKeySeed);
    } catch {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey: null,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: "Cannot resolve board key for this job."
      };
    }

    const latestJob = findLatestCompletedJobForBoardKey(boardKey, jobId);
    if (!latestJob) {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: "Draft is up-to-date — no newer job exists for this board."
      };
    }

    // Check whether the latest job is actually newer
    const sourceFinished = job.finishedAt ?? job.submittedAt;
    const latestFinished = latestJob.finishedAt ?? latestJob.submittedAt;
    if (latestFinished <= sourceFinished) {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: "Draft is up-to-date — no newer job exists for this board."
      };
    }

    // Draft is stale. Validate carry-forward feasibility using the latest job's design IR.
    let unmappedNodeIds: string[] = [];
    let carryForwardAvailable = false;

    if (draftNodeIds.length > 0 && latestJob.artifacts.designIrFile) {
      try {
        const irContent = await readFile(latestJob.artifacts.designIrFile, "utf8");
        const irData = JSON.parse(irContent) as { screens?: Array<{ children?: Array<{ id: string }> }> };
        const allNodeIds = new Set<string>();
        if (Array.isArray(irData.screens)) {
          for (const screen of irData.screens) {
            collectNodeIds(screen, allNodeIds);
          }
        }
        unmappedNodeIds = draftNodeIds.filter((nodeId) => !allNodeIds.has(nodeId));
        carryForwardAvailable = unmappedNodeIds.length === 0;
      } catch {
        // If IR is unreadable, carry-forward is not available.
        unmappedNodeIds = [];
        carryForwardAvailable = false;
      }
    }

    return {
      stale: true,
      latestJobId: latestJob.jobId,
      sourceJobId: jobId,
      boardKey,
      carryForwardAvailable,
      unmappedNodeIds,
      message: carryForwardAvailable
        ? `A newer job '${latestJob.jobId}' exists for this board. Carry-forward is available — all draft nodes are present in the latest output.`
        : unmappedNodeIds.length > 0
          ? `A newer job '${latestJob.jobId}' exists for this board. Carry-forward is not available — ${String(unmappedNodeIds.length)} node(s) could not be resolved in the latest output.`
          : `A newer job '${latestJob.jobId}' exists for this board.`
    };
  };

  const suggestRemaps: JobEngine["suggestRemaps"] = async ({
    sourceJobId,
    latestJobId,
    unmappedNodeIds
  }) => {
    const sourceJob = jobs.get(sourceJobId);
    if (!sourceJob) {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: unmappedNodeIds.map((id) => ({
          sourceNodeId: id,
          sourceNodeName: "(unknown)",
          sourceNodeType: "(unknown)",
          reason: `Source job '${sourceJobId}' not found.`
        })),
        message: `Source job '${sourceJobId}' not found.`
      };
    }

    const latestJob = jobs.get(latestJobId);
    if (!latestJob) {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: unmappedNodeIds.map((id) => ({
          sourceNodeId: id,
          sourceNodeName: "(unknown)",
          sourceNodeType: "(unknown)",
          reason: `Latest job '${latestJobId}' not found.`
        })),
        message: `Latest job '${latestJobId}' not found.`
      };
    }

    if (!sourceJob.artifacts.designIrFile || !latestJob.artifacts.designIrFile) {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: unmappedNodeIds.map((id) => ({
          sourceNodeId: id,
          sourceNodeName: "(unknown)",
          sourceNodeType: "(unknown)",
          reason: "Design IR not available for one or both jobs."
        })),
        message: "Design IR artifacts are missing — cannot generate remap suggestions."
      };
    }

    let sourceIrContent: string;
    let latestIrContent: string;
    try {
      sourceIrContent = await readFile(sourceJob.artifacts.designIrFile, "utf8");
      latestIrContent = await readFile(latestJob.artifacts.designIrFile, "utf8");
    } catch {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: [],
        message: "Could not read Design IR files for remap analysis."
      };
    }

    const sourceIr = JSON.parse(sourceIrContent) as DesignIR;
    const latestIr = JSON.parse(latestIrContent) as DesignIR;

    return generateRemapSuggestions({
      sourceIr,
      latestIr,
      unmappedNodeIds,
      sourceJobId,
      latestJobId
    });
  };

  return {
    submitJob,
    submitRegeneration,
    createPrFromJob,
    previewLocalSync,
    applyLocalSync,
    cancelJob,
    getJob,
    getJobResult,
    getJobRecord,
    resolvePreviewAsset,
    checkStaleDraft,
    suggestRemaps
  };
};

export { resolveRuntimeSettings };
export type { JobEngine, JobEngineRuntime, JobRecordSnapshot } from "./job-engine/types.js";
