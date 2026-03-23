import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceLocalSyncApplyResult,
  WorkspaceLocalSyncFileDecisionEntry,
  WorkspaceLocalSyncDryRunResult,
  WorkspaceJobDiagnostic,
  WorkspaceJobInput,
  WorkspaceJobResult,
  WorkspaceJobStageName,
  WorkspaceJobStatus,
  WorkspaceRegenerationInput
} from "./contracts/index.js";
import { safeParseFigmaPayload, summarizeFigmaPayloadValidationError } from "./figma-payload-validation.js";
import {
  createPipelineError,
  getErrorMessage,
  mergePipelineDiagnostics,
  type PipelineDiagnosticInput
} from "./job-engine/errors.js";
import { cleanFigmaForCodegen } from "./job-engine/figma-clean.js";
import { exportImageAssetsFromFigma } from "./job-engine/image-export.js";
import { fetchFigmaFile } from "./job-engine/figma-source.js";
import { copyDir, pathExists, resolveAbsoluteOutputRoot } from "./job-engine/fs-helpers.js";
import { runGenerationDiff } from "./job-engine/generation-diff.js";
import { resolveBoardKey } from "./parity/board-key.js";
import { runGitPrFlow } from "./job-engine/git-pr.js";
import { getContentType, normalizePathPart } from "./job-engine/preview.js";
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
import type { CreateJobEngineInput, FigmaFileResponse, JobEngine, JobRecord, WorkspacePipelineError } from "./job-engine/types.js";
import { runProjectValidation } from "./job-engine/validation.js";
import { generateArtifactsStreaming } from "./parity/generator-core.js";
import type { StreamingArtifactEvent } from "./parity/generator-core.js";
import { computeContentHash, computeOptionsHash, loadCachedIr, saveCachedIr } from "./job-engine/ir-cache.js";
import { applyIrOverrides } from "./job-engine/ir-overrides.js";
import { generateRemapSuggestions } from "./job-engine/remap-suggestions.js";
import {
  applyLocalSyncPlan,
  computeLocalSyncPlanFingerprint,
  LocalSyncError,
  type LocalSyncPlan,
  planLocalSync
} from "./job-engine/local-sync.js";
import { buildComponentManifest } from "./parity/component-manifest.js";
import { figmaToDesignIrWithOptions } from "./parity/ir.js";
import type { DesignIR } from "./parity/types-ir.js";

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

const toFigmaNodeUrl = ({
  fileKey,
  nodeId
}: {
  fileKey: string | undefined;
  nodeId: string | undefined;
}): string | undefined => {
  if (!fileKey || !nodeId) {
    return undefined;
  }
  const trimmedFileKey = fileKey.trim();
  const trimmedNodeId = nodeId.trim();
  if (!trimmedFileKey || !trimmedNodeId) {
    return undefined;
  }
  return `https://www.figma.com/design/${encodeURIComponent(trimmedFileKey)}?node-id=${encodeURIComponent(
    trimmedNodeId.replace(/:/g, "-")
  )}`;
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

interface RejectedScreenCandidate {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  reason: "hidden-page" | "hidden-node" | "non-screen-root" | "unsupported-node-type" | "section-without-screen-like-children";
  pageId?: string;
  pageName?: string;
}

const collectRejectedSectionCandidates = ({
  section,
  pageId,
  pageName
}: {
  section: Record<string, unknown>;
  pageId?: string;
  pageName?: string;
}): RejectedScreenCandidate[] => {
  const sectionChildren = Array.isArray(section.children) ? section.children : [];
  const rejections: RejectedScreenCandidate[] = [];
  let hasNestedScreenLike = false;
  for (const nestedCandidate of sectionChildren) {
    if (!isRecord(nestedCandidate)) {
      continue;
    }
    const nestedType = typeof nestedCandidate.type === "string" ? nestedCandidate.type : "UNKNOWN";
    if (nestedType === "FRAME" || nestedType === "COMPONENT") {
      hasNestedScreenLike = true;
      continue;
    }
    const nestedId = typeof nestedCandidate.id === "string" ? nestedCandidate.id : "unknown";
    const nestedName = typeof nestedCandidate.name === "string" ? nestedCandidate.name : nestedType;
    if (nestedType === "SECTION") {
      const nestedSectionRejections = collectRejectedSectionCandidates({
        section: nestedCandidate,
        ...(pageId ? { pageId } : {}),
        ...(pageName ? { pageName } : {})
      });
      if (nestedSectionRejections.length > 0) {
        rejections.push(...nestedSectionRejections);
      }
      continue;
    }
    rejections.push({
      nodeId: nestedId,
      nodeName: nestedName,
      nodeType: nestedType,
      reason: "unsupported-node-type",
      ...(pageId ? { pageId } : {}),
      ...(pageName ? { pageName } : {})
    });
  }
  if (!hasNestedScreenLike) {
    rejections.push({
      nodeId: typeof section.id === "string" ? section.id : "unknown",
      nodeName: typeof section.name === "string" ? section.name : "Section",
      nodeType: "SECTION",
      reason: "section-without-screen-like-children",
      ...(pageId ? { pageId } : {}),
      ...(pageName ? { pageName } : {})
    });
  }
  return rejections;
};

const analyzeScreenCandidateRejections = ({
  sourceFile
}: {
  sourceFile: FigmaFileResponse;
}): {
  rejectedCandidates: RejectedScreenCandidate[];
  rootCandidateCount: number;
} => {
  const rejectedCandidates: RejectedScreenCandidate[] = [];
  if (!isRecord(sourceFile.document)) {
    return {
      rejectedCandidates,
      rootCandidateCount: 0
    };
  }
  const documentNode = sourceFile.document;
  const pages = Array.isArray(documentNode.children) ? documentNode.children : [];
  let rootCandidateCount = 0;
  for (const pageCandidate of pages) {
    if (!isRecord(pageCandidate)) {
      continue;
    }
    const pageId = typeof pageCandidate.id === "string" ? pageCandidate.id : undefined;
    const pageName = typeof pageCandidate.name === "string" ? pageCandidate.name : undefined;
    if (pageCandidate.visible === false) {
      rejectedCandidates.push({
        nodeId: pageId ?? "unknown",
        nodeName: pageName ?? "Page",
        nodeType: "CANVAS",
        reason: "hidden-page"
      });
      continue;
    }
    const pageChildren = Array.isArray(pageCandidate.children) ? pageCandidate.children : [];
    for (const childCandidate of pageChildren) {
      if (!isRecord(childCandidate)) {
        continue;
      }
      const nodeType = typeof childCandidate.type === "string" ? childCandidate.type : "UNKNOWN";
      const nodeId = typeof childCandidate.id === "string" ? childCandidate.id : "unknown";
      const nodeName = typeof childCandidate.name === "string" ? childCandidate.name : nodeType;
      if (childCandidate.visible === false) {
        rejectedCandidates.push({
          nodeId,
          nodeName,
          nodeType,
          reason: "hidden-node",
          ...(pageId ? { pageId } : {}),
          ...(pageName ? { pageName } : {})
        });
        continue;
      }
      if (nodeType === "FRAME" || nodeType === "COMPONENT") {
        rootCandidateCount += 1;
        continue;
      }
      if (nodeType === "SECTION") {
        const sectionRejections = collectRejectedSectionCandidates({
          section: childCandidate,
          ...(pageId ? { pageId } : {}),
          ...(pageName ? { pageName } : {})
        });
        rejectedCandidates.push(...sectionRejections);
        continue;
      }
      rejectedCandidates.push({
        nodeId,
        nodeName,
        nodeType,
        reason: "non-screen-root",
        ...(pageId ? { pageId } : {}),
        ...(pageName ? { pageName } : {})
      });
    }
  }
  return {
    rejectedCandidates: rejectedCandidates.slice(0, 20),
    rootCandidateCount
  };
};

const SCREEN_REJECTION_REASON_MESSAGE: Record<RejectedScreenCandidate["reason"], string> = {
  "hidden-page": "The page is hidden.",
  "hidden-node": "The node is hidden.",
  "non-screen-root": "The node is not a supported top-level screen root (expected FRAME/COMPONENT/SECTION).",
  "unsupported-node-type": "The node type is not supported as a screen candidate.",
  "section-without-screen-like-children": "The section has no FRAME/COMPONENT children."
};

const SCREEN_REJECTION_REASON_SUGGESTION: Record<RejectedScreenCandidate["reason"], string> = {
  "hidden-page": "Unhide the page or move target screens into a visible page.",
  "hidden-node": "Unhide the node or choose a visible FRAME/COMPONENT root.",
  "non-screen-root": "Use FRAME/COMPONENT roots for screen-level content or wrap content in a FRAME.",
  "unsupported-node-type": "Convert or wrap the node into a FRAME/COMPONENT that can be treated as a screen root.",
  "section-without-screen-like-children": "Add at least one FRAME/COMPONENT under this section."
};

const toSortedReasonCounts = ({
  rejectedCandidates
}: {
  rejectedCandidates: RejectedScreenCandidate[];
}): Record<string, number> => {
  const reasonCounts = new Map<string, number>();
  for (const entry of rejectedCandidates) {
    reasonCounts.set(entry.reason, (reasonCounts.get(entry.reason) ?? 0) + 1);
  }
  return [...reasonCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Record<string, number>>((accumulator, [reason, count]) => {
      accumulator[reason] = count;
      return accumulator;
    }, {});
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

const isPerfValidationEnabled = (): boolean => {
  const raw = process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION ?? process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION;
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const isLintAutofixEnabled = (): boolean => {
  const raw = process.env.FIGMAPIPE_WORKSPACE_ENABLE_LINT_AUTOFIX;
  if (!raw) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return true;
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

  class JobCancellationError extends Error {
    code = "E_JOB_CANCELED" as const;
    stage: WorkspaceJobStageName;

    constructor({ stage, reason }: { stage: WorkspaceJobStageName; reason: string }) {
      super(reason);
      this.name = "JobCancellationError";
      this.stage = stage;
    }
  }

  const isJobCancellationError = (error: unknown): error is JobCancellationError => {
    return error instanceof JobCancellationError;
  };

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

  const markStageSkipped = ({
    job,
    stage,
    message
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
    message: string;
  }): void => {
    updateStage({ job, stage, status: "skipped", message });
    pushLog({ job, level: "info", stage, message });
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

  const resolveCancellationReason = ({
    job,
    fallbackReason
  }: {
    job: JobRecord;
    fallbackReason: string;
  }): string => {
    if (job.cancellation?.reason) {
      return job.cancellation.reason;
    }
    return fallbackReason;
  };

  const ensureStageNotCanceled = ({
    job,
    stage
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
  }): void => {
    if (!job.cancellation || job.cancellation.completedAt) {
      return;
    }
    throw new JobCancellationError({
      stage,
      reason: resolveCancellationReason({
        job,
        fallbackReason: "Cancellation requested."
      })
    });
  };

  const runStage = async <T>({
    job,
    stage,
    action
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
    action: () => Promise<T>;
  }): Promise<T> => {
    ensureStageNotCanceled({ job, stage });
    job.currentStage = stage;
    updateStage({ job, stage, status: "running" });
    pushLog({ job, level: "info", stage, message: `Starting stage '${stage}'.` });

    try {
      const result = await action();
      ensureStageNotCanceled({ job, stage });
      updateStage({ job, stage, status: "completed" });
      pushLog({ job, level: "info", stage, message: `Completed stage '${stage}'.` });
      return result;
    } catch (error) {
      if (isJobCancellationError(error)) {
        updateStage({
          job,
          stage,
          status: "failed",
          message: error.message
        });
        pushLog({
          job,
          level: "warn",
          stage,
          message: `${error.code}: ${error.message}`
        });
        throw error;
      }

      if (job.cancellation && isAbortLikeError(error)) {
        const cancellationError = new JobCancellationError({
          stage,
          reason: resolveCancellationReason({
            job,
            fallbackReason: "Cancellation requested."
          })
        });
        updateStage({
          job,
          stage,
          status: "failed",
          message: cancellationError.message
        });
        pushLog({
          job,
          level: "warn",
          stage,
          message: `${cancellationError.code}: ${cancellationError.message}`
        });
        throw cancellationError;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: stage
      });
      updateStage({
        job,
        stage,
        status: "failed",
        message: typedError.message
      });
      pushLog({
        job,
        level: "error",
        stage,
        message: `${typedError.code}: ${typedError.message}`
      });
      throw typedError;
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
    const figmaFileKeyForDiagnostics = resolvedFigmaSourceMode === "rest" ? input.figmaFileKey?.trim() : undefined;

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);
    const iconMapFilePath = runtime.iconMapFilePath ?? path.join(resolvedPaths.outputRoot, "icon-fallback-map.json");
    const designSystemFilePath = runtime.designSystemFilePath ?? path.join(resolvedPaths.outputRoot, "design-system.json");

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

      const figmaFetch = await runStage({
        job,
        stage: "figma.source",
        action: async () => {
          const writeAndClean = async ({
            sourceFile,
            diagnostics
          }: {
            sourceFile: FigmaFileResponse;
            diagnostics: {
              sourceMode: "geometry-paths" | "staged-nodes" | "local-json";
              fetchedNodes: number;
              degradedGeometryNodes: string[];
            };
          }) => {
            await writeFile(figmaRawJsonFile, `${JSON.stringify(sourceFile, null, 2)}\n`, "utf8");
            const cleaning = cleanFigmaForCodegen({ file: sourceFile });
            await writeFile(figmaJsonFile, `${JSON.stringify(cleaning.cleanedFile, null, 2)}\n`, "utf8");
            pushLog({
              job,
              level: "info",
              stage: "figma.source",
              message:
                `Figma source mode=${diagnostics.sourceMode}, fetchedNodes=${diagnostics.fetchedNodes}, ` +
                `degradedGeometryNodes=${diagnostics.degradedGeometryNodes.length}, cleanedNodes=${cleaning.report.outputNodeCount}/${cleaning.report.inputNodeCount}, ` +
                `removedHidden=${cleaning.report.removedHiddenNodes}, removedPlaceholders=${cleaning.report.removedPlaceholderNodes}, ` +
                `removedHelpers=${cleaning.report.removedHelperNodes}, removedInvalid=${cleaning.report.removedInvalidNodes}, removedProperties=${cleaning.report.removedPropertyCount}`
            });
            return {
              file: cleaning.cleanedFile,
              diagnostics,
              cleaning
            };
          };

          if (resolvedFigmaSourceMode === "local_json") {
            const localPath = input.figmaJsonPath?.trim();
            if (!localPath) {
              throw createPipelineError({
                code: "E_FIGMA_LOCAL_JSON_PATH",
                stage: "figma.source",
                message: "figmaJsonPath is required when figmaSourceMode=local_json."
              });
            }

            const resolvedLocalPath = path.resolve(localPath);
            let localFileContent: string;
            try {
              localFileContent = await readFile(resolvedLocalPath, "utf8");
            } catch (error) {
              throw createPipelineError({
                code: "E_FIGMA_LOCAL_JSON_READ",
                stage: "figma.source",
                message: `Could not read local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
                cause: error
              });
            }

            let parsedLocalFile: unknown;
            try {
              parsedLocalFile = JSON.parse(localFileContent);
            } catch (error) {
              throw createPipelineError({
                code: "E_FIGMA_PARSE",
                stage: "figma.source",
                message: `Could not parse local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
                cause: error
              });
            }

            const parsedLocalPayload = safeParseFigmaPayload({ input: parsedLocalFile });
            if (!parsedLocalPayload.success) {
              throw createPipelineError({
                code: "E_FIGMA_PARSE",
                stage: "figma.source",
                message:
                  `Could not parse local Figma JSON file '${localPath}': invalid Figma payload ` +
                  `(${summarizeFigmaPayloadValidationError({ error: parsedLocalPayload.error })}).`
              });
            }

            pushLog({
              job,
              level: "info",
              stage: "figma.source",
              message: `Loaded local Figma JSON from '${resolvedLocalPath}'.`
            });

            return await writeAndClean({
              sourceFile: parsedLocalPayload.data,
              diagnostics: {
                sourceMode: "local-json",
                fetchedNodes: 0,
                degradedGeometryNodes: []
              }
            });
          }

          const fileKey = input.figmaFileKey?.trim();
          const accessToken = input.figmaAccessToken?.trim();
          if (!fileKey || !accessToken) {
            throw createPipelineError({
              code: "E_FIGMA_REST_INPUT",
              stage: "figma.source",
              message: "figmaFileKey and figmaAccessToken are required when figmaSourceMode=rest."
            });
          }

          const result = await fetchFigmaFile({
            fileKey,
            accessToken,
            timeoutMs: runtime.figmaTimeoutMs,
            maxRetries: runtime.figmaMaxRetries,
            bootstrapDepth: runtime.figmaBootstrapDepth,
            nodeBatchSize: runtime.figmaNodeBatchSize,
            nodeFetchConcurrency: runtime.figmaNodeFetchConcurrency,
            adaptiveBatchingEnabled: runtime.figmaAdaptiveBatchingEnabled,
            maxScreenCandidates: runtime.figmaMaxScreenCandidates,
            ...(runtime.figmaScreenNamePattern !== undefined
              ? { screenNamePattern: runtime.figmaScreenNamePattern }
              : {}),
            cacheEnabled: runtime.figmaCacheEnabled,
            cacheTtlMs: runtime.figmaCacheTtlMs,
            cacheDir: path.join(resolvedPaths.outputRoot, "cache", "figma-source"),
            fetchImpl: fetchWithCancellation,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "figma.source",
                message
              });
            }
          });
          return await writeAndClean({
            sourceFile: result.file,
            diagnostics: result.diagnostics
          });
        }
      });

      const irCacheDir = path.join(resolvedPaths.outputRoot, "cache", "ir-derivation");

      const ir = await runStage({
        job,
        stage: "ir.derive",
        action: async () => {
          const emitIrMetricDiagnostics = ({
            source
          }: {
            source: {
              metrics?: {
                truncatedScreens?: Array<{
                  screenId: string;
                  screenName: string;
                  originalElements: number;
                  retainedElements: number;
                  budget: number;
                }>;
                depthTruncatedScreens?: Array<{
                  screenId: string;
                  screenName: string;
                  firstTruncatedDepth: number;
                  truncatedBranchCount: number;
                  maxDepth: number;
                }>;
                classificationFallbacks?: Array<{
                  screenId: string;
                  screenName: string;
                  nodeId: string;
                  nodeName: string;
                  nodeType: string;
                  depth: number;
                  matchedRulePriority?: number;
                  layoutMode?: string;
                }>;
              };
            };
          }): void => {
            const budgetTruncatedScreens = [...(source.metrics?.truncatedScreens ?? [])].sort((left, right) => {
              if (left.screenName !== right.screenName) {
                return left.screenName.localeCompare(right.screenName);
              }
              return left.screenId.localeCompare(right.screenId);
            });
            if (budgetTruncatedScreens.length > 0) {
              const diagnostics: PipelineDiagnosticInput[] = budgetTruncatedScreens.slice(0, 8).map((entry) => {
                const figmaUrl = toFigmaNodeUrl({
                  fileKey: figmaFileKeyForDiagnostics,
                  nodeId: entry.screenId
                });
                return {
                  code: "W_IR_ELEMENT_BUDGET_TRUNCATION",
                  message:
                    `Screen '${entry.screenName}' exceeded element budget (${entry.retainedElements}/${entry.originalElements} retained).`,
                  suggestion:
                    "Split the screen into smaller sections/components or increase figmaScreenElementBudget if larger screens are intentional.",
                  stage: "ir.derive",
                  severity: "warning",
                  figmaNodeId: entry.screenId,
                  ...(figmaUrl ? { figmaUrl } : {}),
                  details: {
                    screenId: entry.screenId,
                    screenName: entry.screenName,
                    originalElements: entry.originalElements,
                    retainedElements: entry.retainedElements,
                    budget: entry.budget
                  }
                };
              });
              appendDiagnostics({
                stage: "ir.derive",
                diagnostics
              });
            }

            const depthTruncatedScreens = [...(source.metrics?.depthTruncatedScreens ?? [])].sort((left, right) => {
              if (left.screenName !== right.screenName) {
                return left.screenName.localeCompare(right.screenName);
              }
              return left.screenId.localeCompare(right.screenId);
            });
            if (depthTruncatedScreens.length > 0) {
              const summary = depthTruncatedScreens
                .slice(0, 3)
                .map(
                  (entry) =>
                    `'${entry.screenName}' branches=${entry.truncatedBranchCount} firstDepth=${entry.firstTruncatedDepth}`
                )
                .join("; ");
              pushLog({
                job,
                level: "warn",
                stage: "ir.derive",
                message:
                  `Dynamic depth truncation applied on ${depthTruncatedScreens.length} screen(s) ` +
                  `(maxDepth=${runtime.figmaScreenElementMaxDepth}). ${summary}`
              });

              const diagnostics: PipelineDiagnosticInput[] = depthTruncatedScreens.slice(0, 8).map((entry) => {
                const figmaUrl = toFigmaNodeUrl({
                  fileKey: figmaFileKeyForDiagnostics,
                  nodeId: entry.screenId
                });
                return {
                  code: "W_IR_DEPTH_TRUNCATION",
                  message:
                    `Depth truncation started at depth ${entry.firstTruncatedDepth} for screen '${entry.screenName}'.`,
                  suggestion:
                    "Split deeply nested content into smaller screens/components or increase figmaScreenElementMaxDepth.",
                  stage: "ir.derive",
                  severity: "warning",
                  figmaNodeId: entry.screenId,
                  ...(figmaUrl ? { figmaUrl } : {}),
                  details: {
                    screenId: entry.screenId,
                    screenName: entry.screenName,
                    maxDepth: entry.maxDepth,
                    firstTruncatedDepth: entry.firstTruncatedDepth,
                    truncatedBranchCount: entry.truncatedBranchCount
                  }
                };
              });
              appendDiagnostics({
                stage: "ir.derive",
                diagnostics
              });
            }

            const classificationFallbacks = [...(source.metrics?.classificationFallbacks ?? [])].sort((left, right) => {
              if (left.screenName !== right.screenName) {
                return left.screenName.localeCompare(right.screenName);
              }
              if (left.depth !== right.depth) {
                return left.depth - right.depth;
              }
              return left.nodeId.localeCompare(right.nodeId);
            });
            if (classificationFallbacks.length > 0) {
              pushLog({
                job,
                level: "warn",
                stage: "ir.derive",
                message:
                  `Classification fallback to container used for ${classificationFallbacks.length} node(s). ` +
                  `Top sample: ${classificationFallbacks
                    .slice(0, 3)
                    .map((entry) => `'${entry.nodeName}'`)
                    .join(", ")}`
              });
              const diagnostics: PipelineDiagnosticInput[] = classificationFallbacks.slice(0, 12).map((entry) => {
                const figmaUrl = toFigmaNodeUrl({
                  fileKey: figmaFileKeyForDiagnostics,
                  nodeId: entry.nodeId
                });
                return {
                  code: "W_IR_CLASSIFICATION_FALLBACK",
                  message: `Node '${entry.nodeName}' fell back to generic 'container' classification.`,
                  suggestion:
                    "Use clearer component naming/structure (e.g., button/input/list/table semantics) so deterministic classification can resolve a specific type.",
                  stage: "ir.derive",
                  severity: "warning",
                  figmaNodeId: entry.nodeId,
                  ...(figmaUrl ? { figmaUrl } : {}),
                  details: {
                    screenId: entry.screenId,
                    screenName: entry.screenName,
                    nodeId: entry.nodeId,
                    nodeName: entry.nodeName,
                    nodeType: entry.nodeType,
                    depth: entry.depth,
                    ...(entry.layoutMode ? { layoutMode: entry.layoutMode } : {}),
                    ...(entry.matchedRulePriority !== undefined
                      ? { matchedRulePriority: entry.matchedRulePriority }
                      : {})
                  }
                };
              });
              appendDiagnostics({
                stage: "ir.derive",
                diagnostics
              });
            }
          };
          const buildIrEmptyDiagnostics = (): PipelineDiagnosticInput[] => {
            const { rejectedCandidates, rootCandidateCount } = analyzeScreenCandidateRejections({
              sourceFile: figmaFetch.file
            });
            const reasonCounts = toSortedReasonCounts({
              rejectedCandidates
            });
            if (figmaFetch.cleaning.report.screenCandidateCount <= 0) {
              reasonCounts["cleaning-removed-candidates"] = 1;
            }
            const candidateDiagnostics: PipelineDiagnosticInput[] = rejectedCandidates.slice(0, 8).map((entry) => {
              const figmaUrl = toFigmaNodeUrl({
                fileKey: figmaFileKeyForDiagnostics,
                nodeId: entry.nodeId
              });
              return {
                code: "E_IR_EMPTY_CANDIDATE_REJECTED",
                message: `Rejected node '${entry.nodeName}' (${entry.nodeType}): ${SCREEN_REJECTION_REASON_MESSAGE[entry.reason]}`,
                suggestion: SCREEN_REJECTION_REASON_SUGGESTION[entry.reason],
                stage: "ir.derive",
                severity: "error",
                ...(entry.nodeId ? { figmaNodeId: entry.nodeId } : {}),
                ...(figmaUrl ? { figmaUrl } : {}),
                details: {
                  reason: entry.reason,
                  ...(entry.pageId ? { pageId: entry.pageId } : {}),
                  ...(entry.pageName ? { pageName: entry.pageName } : {}),
                  nodeType: entry.nodeType
                }
              };
            });
            return [
              {
                code: "E_IR_EMPTY",
                message: "IR derivation produced zero screens.",
                suggestion:
                  "Provide at least one visible FRAME/COMPONENT root screen and avoid layouts that are fully removed by cleaning.",
                stage: "ir.derive",
                severity: "error",
                details: {
                  rootCandidateCount,
                  rejectedCandidateCount: rejectedCandidates.length,
                  reasonCounts,
                  screenCandidateCountAfterCleaning: figmaFetch.cleaning.report.screenCandidateCount
                }
              },
              ...candidateDiagnostics
            ];
          };

          if (figmaFetch.cleaning.report.screenCandidateCount <= 0) {
            throw createPipelineError({
              code: "E_FIGMA_CLEAN_EMPTY",
              stage: "ir.derive",
              message: "Figma cleaning removed all screen candidates.",
              diagnostics: [
                {
                  code: "E_FIGMA_CLEAN_EMPTY",
                  message: "No screen candidates remained after Figma cleaning.",
                  suggestion:
                    "Ensure at least one visible FRAME/COMPONENT (or SECTION with FRAME/COMPONENT children) remains after cleaning.",
                  stage: "ir.derive",
                  severity: "error",
                  details: {
                    inputNodeCount: figmaFetch.cleaning.report.inputNodeCount,
                    outputNodeCount: figmaFetch.cleaning.report.outputNodeCount,
                    screenCandidateCount: figmaFetch.cleaning.report.screenCandidateCount,
                    removedHiddenNodes: figmaFetch.cleaning.report.removedHiddenNodes,
                    removedPlaceholderNodes: figmaFetch.cleaning.report.removedPlaceholderNodes,
                    removedHelperNodes: figmaFetch.cleaning.report.removedHelperNodes,
                    removedInvalidNodes: figmaFetch.cleaning.report.removedInvalidNodes
                  }
                }
              ]
            });
          }

          const irDerivationOptions = {
            screenElementBudget: runtime.figmaScreenElementBudget,
            screenElementMaxDepth: runtime.figmaScreenElementMaxDepth,
            brandTheme: resolvedBrandTheme
          };

          const irCacheLog = (message: string): void => {
            pushLog({ job, level: "info", stage: "ir.derive", message });
          };

          if (runtime.irCacheEnabled) {
            const contentHash = computeContentHash(figmaFetch.file);
            const optionsHash = computeOptionsHash(irDerivationOptions);

            const cached = await loadCachedIr({
              cacheDir: irCacheDir,
              contentHash,
              optionsHash,
              ttlMs: runtime.irCacheTtlMs,
              onLog: irCacheLog
            });

            if (cached) {
              await writeFile(designIrFile, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
              pushLog({
                job,
                level: "info",
                stage: "ir.derive",
                message:
                  `IR cache hit — skipped derivation. Loaded ${cached.screens.length} screens ` +
                  `(brandTheme=${resolvedBrandTheme}).`
              });
              emitIrMetricDiagnostics({ source: cached });
              return cached;
            }
          }

          let derived: ReturnType<typeof figmaToDesignIrWithOptions>;
          try {
            derived = figmaToDesignIrWithOptions(figmaFetch.file, {
              ...irDerivationOptions,
              sourceMetrics: {
                fetchedNodes: figmaFetch.diagnostics.fetchedNodes,
                degradedGeometryNodes: figmaFetch.diagnostics.degradedGeometryNodes
              }
            });
          } catch (error) {
            if (error instanceof Error && error.message.includes("No top-level frames/components found in Figma file")) {
              throw createPipelineError({
                code: "E_IR_EMPTY",
                stage: "ir.derive",
                message: "No screen found in IR.",
                cause: error,
                diagnostics: buildIrEmptyDiagnostics()
              });
            }
            throw error;
          }
          if (!Array.isArray(derived.screens) || derived.screens.length === 0) {
            throw createPipelineError({
              code: "E_IR_EMPTY",
              stage: "ir.derive",
              message: "No screen found in IR.",
              diagnostics: buildIrEmptyDiagnostics()
            });
          }
          await writeFile(designIrFile, `${JSON.stringify(derived, null, 2)}\n`, "utf8");

          if (runtime.irCacheEnabled) {
            const contentHash = computeContentHash(figmaFetch.file);
            const optionsHash = computeOptionsHash(irDerivationOptions);
            await saveCachedIr({
              cacheDir: irCacheDir,
              contentHash,
              optionsHash,
              ttlMs: runtime.irCacheTtlMs,
              ir: derived,
              onLog: irCacheLog
            });
          }

          emitIrMetricDiagnostics({ source: derived });

          pushLog({
            job,
            level: "info",
            stage: "ir.derive",
            message:
              `Derived Design IR with ${derived.screens.length} screens (brandTheme=${resolvedBrandTheme}, ` +
              `skippedHidden=${derived.metrics?.skippedHidden ?? 0}, skippedPlaceholders=${derived.metrics?.skippedPlaceholders ?? 0}, ` +
              `truncatedScreens=${derived.metrics?.truncatedScreens.length ?? 0}, ` +
              `depthTruncatedScreens=${derived.metrics?.depthTruncatedScreens?.length ?? 0}).`
          });
          return derived;
        }
      });

      await runStage({
        job,
        stage: "template.prepare",
        action: async () => {
          const templateExists = await pathExists(TEMPLATE_ROOT);
          if (!templateExists) {
            throw createPipelineError({
              code: "E_TEMPLATE_MISSING",
              stage: "template.prepare",
              message: `Template not found at ${TEMPLATE_ROOT}`
            });
          }

          await rm(generatedProjectDir, { recursive: true, force: true });
          await copyDir({
            sourceDir: TEMPLATE_ROOT,
            targetDir: generatedProjectDir,
            filter: TEMPLATE_COPY_FILTER
          });
        }
      });

      const generationSummary = await runStage({
        job,
        stage: "codegen.generate",
        action: async () => {
          if (generationLocaleResolution.warningMessage) {
            pushLog({
              job,
              level: "warn",
              stage: "codegen.generate",
              message: generationLocaleResolution.warningMessage
            });
          }
          let imageAssetMap: Record<string, string> = {};
          if (!runtime.exportImages) {
            pushLog({
              job,
              level: "info",
              stage: "codegen.generate",
              message: "Image asset export disabled by runtime configuration."
            });
          } else if (resolvedFigmaSourceMode !== "rest") {
            pushLog({
              job,
              level: "info",
              stage: "codegen.generate",
              message: "Image asset export skipped for figmaSourceMode=local_json."
            });
          } else {
            const fileKey = input.figmaFileKey?.trim();
            const accessToken = input.figmaAccessToken?.trim();
            if (!fileKey || !accessToken) {
              pushLog({
                job,
                level: "warn",
                stage: "codegen.generate",
                message: "Image asset export skipped because figmaFileKey/figmaAccessToken are missing."
              });
            } else {
              try {
                const exportResult = await exportImageAssetsFromFigma({
                  fileKey,
                  accessToken,
                  ir,
                  generatedProjectDir,
                  fetchImpl: fetchWithCancellation,
                  timeoutMs: runtime.figmaTimeoutMs,
                  maxRetries: runtime.figmaMaxRetries,
                  onLog: (message) => {
                    pushLog({
                      job,
                      level: message.toLowerCase().includes("warning") ? "warn" : "info",
                      stage: "codegen.generate",
                      message
                    });
                  }
                });
                imageAssetMap = exportResult.imageAssetMap;
              } catch (error) {
                pushLog({
                  job,
                  level: "warn",
                  stage: "codegen.generate",
                  message: `Image asset export failed; falling back to placeholders: ${getErrorMessage(error)}`
                });
              }
            }
          }

          const streamingOnLog = (message: string): void => {
            pushLog({
              job,
              level: "info",
              stage: "codegen.generate",
              message
            });
          };
          const generator = generateArtifactsStreaming({
            projectDir: generatedProjectDir,
            ir,
            iconMapFilePath,
            designSystemFilePath,
            imageAssetMap,
            generationLocale: resolvedGenerationLocale,
            routerMode: runtime.routerMode,
            formHandlingMode: resolvedFormHandlingMode,
            llmModelName: "deterministic",
            llmCodegenMode: "deterministic",
            onLog: streamingOnLog
          });
          let iterResult = await generator.next();
          while (!iterResult.done) {
            const event: StreamingArtifactEvent = iterResult.value;
            if (event.type === "progress") {
              pushLog({
                job,
                level: "info",
                stage: "codegen.generate",
                message: `Screen ${event.screenIndex}/${event.screenCount} completed: '${event.screenName}'`
              });
            }
            iterResult = await generator.next();
          }
          return iterResult.value;
        }
      });

      if (generationSummary.generatedPaths.includes("generation-metrics.json")) {
        job.artifacts.generationMetricsFile = path.join(generatedProjectDir, "generation-metrics.json");
      }

      // Build component manifest mapping IR nodes to generated code ranges
      try {
        const manifest = await buildComponentManifest({
          projectDir: generatedProjectDir,
          screens: ir.screens
        });
        const manifestPath = path.join(generatedProjectDir, "component-manifest.json");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        job.artifacts.componentManifestFile = manifestPath;
        pushLog({
          job,
          level: "info",
          stage: "codegen.generate",
          message: `Component manifest written with ${manifest.screens.length} screens.`
        });
      } catch (error) {
        pushLog({
          job,
          level: "warn",
          stage: "codegen.generate",
          message: `Component manifest generation failed: ${getErrorMessage(error)}`
        });
      }

      // Generation diff: compare current output with previous run for same board key
      try {
        const boardKeySeed = input.figmaFileKey?.trim() || input.figmaJsonPath?.trim() || "local-json";
        const boardKey = resolveBoardKey(boardKeySeed);
        const diffReport = await runGenerationDiff({
          generatedProjectDir,
          jobDir,
          outputRoot: resolvedPaths.outputRoot,
          boardKey,
          jobId: job.jobId
        });
        job.generationDiff = diffReport;
        job.artifacts.generationDiffFile = path.join(jobDir, "generation-diff.json");
        pushLog({
          job,
          level: "info",
          stage: "codegen.generate",
          message: `Generation diff: ${diffReport.summary}`
        });
      } catch (error) {
        pushLog({
          job,
          level: "warn",
          stage: "codegen.generate",
          message: `Generation diff computation failed: ${getErrorMessage(error)}`
        });
      }

      await runStage({
        job,
        stage: "validate.project",
        action: async () => {
          await runProjectValidation({
            generatedProjectDir,
            enableLintAutofix: isLintAutofixEnabled(),
            enablePerfValidation: isPerfValidationEnabled(),
            enableUiValidation: runtime.enableUiValidation,
            enableUnitTestValidation: runtime.enableUnitTestValidation,
            commandTimeoutMs: runtime.commandTimeoutMs,
            installPreferOffline: runtime.installPreferOffline,
            skipInstall: runtime.skipInstall,
            abortSignal: jobAbortController.signal,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "validate.project",
                message
              });
            }
          });
        }
      });

      if (!runtime.previewEnabled) {
        markStageSkipped({
          job,
          stage: "repro.export",
          message: "Preview disabled by runtime configuration."
        });
      } else {
        await runStage({
          job,
          stage: "repro.export",
          action: async () => {
            await rm(reproDir, { recursive: true, force: true });
            await copyDir({
              sourceDir: path.join(generatedProjectDir, "dist"),
              targetDir: reproDir
            });
          }
        });
      }

      if (!input.enableGitPr) {
        job.gitPr = {
          status: "skipped",
          reason: "enableGitPr=false"
        };
        markStageSkipped({
          job,
          stage: "git.pr",
          message: "Git/PR flow disabled by request."
        });
      } else {
        const gitResult = await runStage({
          job,
          stage: "git.pr",
          action: async () => {
            return await runGitPrFlow({
              input,
              job,
              generatedProjectDir,
              jobDir,
              commandTimeoutMs: runtime.commandTimeoutMs,
              ...(job.generationDiff ? { generationDiff: job.generationDiff } : {}),
              onLog: (message) => {
                pushLog({
                  job,
                  level: "info",
                  stage: "git.pr",
                  message
                });
              }
            });
          }
        });

        job.gitPr = {
          status: "executed",
          branchName: gitResult.branchName,
          scopePath: gitResult.scopePath,
          changedFiles: gitResult.changedFiles
        };
        if (gitResult.prUrl) {
          job.gitPr.prUrl = gitResult.prUrl;
        }
      }

      job.status = "completed";
      job.finishedAt = nowIso();
      delete job.currentStage;
      await persistStageTimings();
      pushLog({
        job,
        level: "info",
        message: `Job completed. Generated output at ${generatedProjectDir} (${generationSummary.generatedPaths.length} artifacts).`
      });
    } catch (error) {
      if (isJobCancellationError(error)) {
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
        while (runningJobIds.size < runtime.maxConcurrentJobs && queuedJobIds.length > 0) {
          const nextJobId = queuedJobIds.shift();
          if (!nextJobId) {
            break;
          }
          const nextJob = jobs.get(nextJobId);
          const nextInput = queuedJobInputs.get(nextJobId);
          if (!nextJob || !nextInput || nextJob.status !== "queued") {
            queuedJobInputs.delete(nextJobId);
            continue;
          }
          queuedJobInputs.delete(nextJobId);
          executeJob({ job: nextJob, input: nextInput });
        }
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

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);
    const iconMapFilePath = runtime.iconMapFilePath ?? path.join(resolvedPaths.outputRoot, "icon-fallback-map.json");
    const designSystemFilePath = runtime.designSystemFilePath ?? path.join(resolvedPaths.outputRoot, "design-system.json");

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

    try {
      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      // Skip figma.source — load IR from source job
      markStageSkipped({
        job,
        stage: "figma.source",
        message: `Reusing source from job '${regenInput.sourceJobId}'.`
      });

      // Load and apply overrides to source IR
      const ir = await runStage({
        job,
        stage: "ir.derive",
        action: async () => {
          const sourceIrPath = sourceRecord.artifacts.designIrFile;
          if (!sourceIrPath) {
            throw createPipelineError({
              code: "E_REGEN_SOURCE_IR_MISSING",
              stage: "ir.derive",
              message: `Source job '${regenInput.sourceJobId}' has no Design IR artifact.`
            });
          }

          let rawContent: string;
          try {
            rawContent = await readFile(sourceIrPath, "utf8");
          } catch {
            throw createPipelineError({
              code: "E_REGEN_SOURCE_IR_READ",
              stage: "ir.derive",
              message: `Could not read Design IR from source job '${regenInput.sourceJobId}'.`
            });
          }

          let baseIr: DesignIR;
          try {
            baseIr = JSON.parse(rawContent) as DesignIR;
          } catch {
            throw createPipelineError({
              code: "E_REGEN_SOURCE_IR_PARSE",
              stage: "ir.derive",
              message: `Could not parse Design IR from source job '${regenInput.sourceJobId}'.`
            });
          }

          const overrideResult = applyIrOverrides({
            ir: baseIr,
            overrides: regenInput.overrides
          });

          await writeFile(designIrFile, `${JSON.stringify(overrideResult.ir, null, 2)}\n`, "utf8");

          pushLog({
            job,
            level: "info",
            stage: "ir.derive",
            message:
              `Applied ${overrideResult.appliedCount} override(s) to source IR ` +
              `(${overrideResult.skippedCount} skipped, ${overrideResult.ir.screens.length} screens).`
          });

          return overrideResult.ir;
        }
      });

      await runStage({
        job,
        stage: "template.prepare",
        action: async () => {
          const templateExists = await pathExists(TEMPLATE_ROOT);
          if (!templateExists) {
            throw createPipelineError({
              code: "E_TEMPLATE_MISSING",
              stage: "template.prepare",
              message: `Template not found at ${TEMPLATE_ROOT}`
            });
          }
          await rm(generatedProjectDir, { recursive: true, force: true });
          await copyDir({
            sourceDir: TEMPLATE_ROOT,
            targetDir: generatedProjectDir,
            filter: TEMPLATE_COPY_FILTER
          });
        }
      });

      const generationSummary = await runStage({
        job,
        stage: "codegen.generate",
        action: async () => {
          const streamingOnLog = (message: string): void => {
            pushLog({
              job,
              level: "info",
              stage: "codegen.generate",
              message
            });
          };
          const generator = generateArtifactsStreaming({
            projectDir: generatedProjectDir,
            ir,
            iconMapFilePath,
            designSystemFilePath,
            generationLocale: resolvedGenerationLocale,
            routerMode: runtime.routerMode,
            formHandlingMode: resolvedFormHandlingMode,
            llmModelName: "deterministic",
            llmCodegenMode: "deterministic",
            onLog: streamingOnLog
          });
          let iterResult = await generator.next();
          while (!iterResult.done) {
            const event: StreamingArtifactEvent = iterResult.value;
            if (event.type === "progress") {
              pushLog({
                job,
                level: "info",
                stage: "codegen.generate",
                message: `Screen ${event.screenIndex}/${event.screenCount} completed: '${event.screenName}'`
              });
            }
            iterResult = await generator.next();
          }
          return iterResult.value;
        }
      });

      if (generationSummary.generatedPaths.includes("generation-metrics.json")) {
        job.artifacts.generationMetricsFile = path.join(generatedProjectDir, "generation-metrics.json");
      }

      try {
        const manifest = await buildComponentManifest({
          projectDir: generatedProjectDir,
          screens: ir.screens
        });
        const manifestPath = path.join(generatedProjectDir, "component-manifest.json");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        job.artifacts.componentManifestFile = manifestPath;
      } catch (error) {
        pushLog({
          job,
          level: "warn",
          stage: "codegen.generate",
          message: `Component manifest generation failed: ${getErrorMessage(error)}`
        });
      }

      try {
        const boardKeySeed = sourceRecord.request.figmaFileKey ?? "regeneration";
        const boardKey = resolveBoardKey(boardKeySeed);
        const diffReport = await runGenerationDiff({
          generatedProjectDir,
          jobDir,
          outputRoot: resolvedPaths.outputRoot,
          boardKey,
          jobId: job.jobId
        });
        job.generationDiff = diffReport;
        job.artifacts.generationDiffFile = path.join(jobDir, "generation-diff.json");
      } catch (error) {
        pushLog({
          job,
          level: "warn",
          stage: "codegen.generate",
          message: `Generation diff computation failed: ${getErrorMessage(error)}`
        });
      }

      await runStage({
        job,
        stage: "validate.project",
        action: async () => {
          await runProjectValidation({
            generatedProjectDir,
            enableLintAutofix: isLintAutofixEnabled(),
            enablePerfValidation: isPerfValidationEnabled(),
            enableUiValidation: runtime.enableUiValidation,
            enableUnitTestValidation: runtime.enableUnitTestValidation,
            commandTimeoutMs: runtime.commandTimeoutMs,
            installPreferOffline: runtime.installPreferOffline,
            skipInstall: runtime.skipInstall,
            abortSignal: jobAbortController.signal,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "validate.project",
                message
              });
            }
          });
        }
      });

      if (!runtime.previewEnabled) {
        markStageSkipped({
          job,
          stage: "repro.export",
          message: "Preview disabled by runtime configuration."
        });
      } else {
        await runStage({
          job,
          stage: "repro.export",
          action: async () => {
            await rm(reproDir, { recursive: true, force: true });
            await copyDir({
              sourceDir: path.join(generatedProjectDir, "dist"),
              targetDir: reproDir
            });
          }
        });
      }

      // git.pr always skipped for regeneration jobs (per issue #455 scope)
      job.gitPr = {
        status: "skipped",
        reason: "Git/PR flow not applicable for regeneration jobs."
      };
      markStageSkipped({
        job,
        stage: "git.pr",
        message: "Git/PR flow not applicable for regeneration jobs."
      });

      job.status = "completed";
      job.finishedAt = nowIso();
      delete job.currentStage;
      await persistStageTimings();
      pushLog({
        job,
        level: "info",
        message: `Regeneration job completed. Generated output at ${generatedProjectDir} (${generationSummary.generatedPaths.length} artifacts).`
      });
    } catch (error) {
      if (isJobCancellationError(error)) {
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
        while (runningJobIds.size < runtime.maxConcurrentJobs && queuedJobIds.length > 0) {
          const nextJobId = queuedJobIds.shift();
          if (!nextJobId) {
            break;
          }
          const nextJob = jobs.get(nextJobId);
          const nextInput = queuedJobInputs.get(nextJobId);
          if (!nextJob || !nextInput || nextJob.status !== "queued") {
            queuedJobInputs.delete(nextJobId);
            continue;
          }
          queuedJobInputs.delete(nextJobId);
          executeJob({ job: nextJob, input: nextInput });
        }
        refreshQueueSnapshots();
      });
    });
  };

  const queuedRegenInputs = new Map<string, WorkspaceRegenerationInput>();

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
      fileDecisions: fileDecisions as WorkspaceLocalSyncFileDecisionEntry[],
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
    const fallbackPath = normalizedPart.length > 0 ? normalizedPart : "index.html";
    const candidatePath = path.normalize(path.join(resolvedPaths.reprosRoot, safeJobId, fallbackPath));
    const expectedPrefix = path.normalize(path.join(resolvedPaths.reprosRoot, safeJobId));

    if (!candidatePath.startsWith(expectedPrefix)) {
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
        const indexPath = path.join(resolvedPaths.reprosRoot, safeJobId, "index.html");
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
      job,
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

    const sourceIr = JSON.parse(sourceIrContent) as import("./parity/types-ir.js").DesignIR;
    const latestIr = JSON.parse(latestIrContent) as import("./parity/types-ir.js").DesignIR;

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
