import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTRACT_VERSION,
  type WorkspaceBrandTheme,
  type WorkspaceFigmaSourceMode,
  type WorkspaceFormHandlingMode,
  type WorkspaceImportSession,
  type WorkspaceImportSessionDeleteResult,
  type WorkspaceImportSessionEvent,
  type WorkspaceImportSessionReimportAccepted,
  type WorkspaceImportSessionSourceMode,
  type WorkspaceLocalSyncApplyResult,
  type WorkspaceLocalSyncDryRunResult,
  type WorkspaceJobDiagnostic,
  type WorkspaceJobInput,
  type WorkspaceJobRetryTarget,
  type WorkspaceJobRetryStage,
  type WorkspaceJobResult,
  type WorkspaceJobStageName,
  type WorkspaceJobStatus,
  type WorkspaceRegenerationInput,
  type WorkspaceRetryInput,
} from "./contracts/index.js";
import { normalizeComponentMappingRules } from "./component-mapping-rules.js";
import {
  safeParseCustomerProfileConfig,
  toCustomerProfileConfigSnapshot,
  type CustomerProfileConfigSnapshot,
  type ResolvedCustomerProfile,
} from "./customer-profile.js";
import {
  createPipelineError,
  getErrorMessage,
  mergePipelineDiagnostics,
  type PipelineDiagnosticInput,
  type PipelineDiagnosticLimits,
} from "./job-engine/errors.js";
import { resolveAbsoluteOutputRoot } from "./job-engine/fs-helpers.js";
import { resolveBoardKey } from "./parity/board-key.js";
import {
  executePersistedGitPr,
  toGitPrStageMessage,
} from "./job-engine/git-pr-persistence.js";
import {
  loadRehydratedJobs,
  writeTerminalJobSnapshot,
  writeTerminalJobSnapshotSync,
} from "./job-engine/job-snapshot.js";
import {
  getContentType,
  hasSymlinkInPath,
  isWithinRoot,
  normalizePathPart,
  readFileWithFinalComponentNoFollow,
} from "./job-engine/preview.js";
import { resolveRuntimeSettings } from "./job-engine/runtime.js";
import {
  DEFAULT_GENERATION_LOCALE,
  normalizeGenerationLocale,
  resolveGenerationLocale,
} from "./generation-locale.js";
import {
  createInitialStages,
  nowIso,
  pushRuntimeLog,
  toAcceptedModes,
  toFileSystemSafe,
  toJobSummary,
  toPublicJob,
  updateStage,
} from "./job-engine/stage-state.js";
import { createTemplateCopyFilter } from "./job-engine/template-copy-filter.js";
import type {
  CreateJobEngineInput,
  JobEngine,
  JobRecord,
  SubmissionJobInput,
  WorkspacePipelineError,
} from "./job-engine/types.js";
import { generateRemapSuggestions } from "./job-engine/remap-suggestions.js";
import {
  applyLocalSyncPlan,
  computeLocalSyncPlanFingerprint,
  LocalSyncError,
  type LocalSyncPlan,
  planLocalSync,
} from "./job-engine/local-sync.js";
import type { ComponentManifest } from "./parity/component-manifest.js";
import type { DesignIR } from "./parity/types-ir.js";
import { isSecuritySensitiveImport } from "./job-engine/import-governance.js";
import { StageArtifactStore } from "./job-engine/pipeline/artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./job-engine/pipeline/artifact-keys.js";
import {
  PipelineOrchestrator,
  isPipelineCancellationError,
} from "./job-engine/pipeline/orchestrator.js";
import type { PipelineExecutionContext } from "./job-engine/pipeline/context.js";
import { syncPublicJobProjection } from "./job-engine/pipeline/public-job-projection.js";
import {
  buildRetryPipelinePlan,
  buildRegenerationPipelinePlan,
  buildSubmissionPipelinePlan,
} from "./job-engine/services/pipeline-services.js";
import {
  computePasteCompatibilityFingerprint,
  createPasteFingerprintStore,
  type PasteFingerprintManifest,
} from "./job-engine/paste-fingerprint-store.js";
import {
  isPasteDeltaExecutionState,
  type PasteDeltaExecutionState,
} from "./job-engine/paste-delta-execution.js";

const isWorkspaceJobRetryTarget = (
  value: unknown,
): value is WorkspaceJobRetryTarget => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    kind?: unknown;
    stage?: unknown;
    targetId?: unknown;
    displayName?: unknown;
    filePath?: unknown;
    emittedScreenId?: unknown;
  };
  return (
    (candidate.kind === "stage" || candidate.kind === "generated_file") &&
    isWorkspaceJobRetryStage(candidate.stage) &&
    typeof candidate.targetId === "string" &&
    (candidate.displayName === undefined ||
      typeof candidate.displayName === "string") &&
    (candidate.filePath === undefined || typeof candidate.filePath === "string") &&
    (candidate.emittedScreenId === undefined ||
      typeof candidate.emittedScreenId === "string")
  );
};
import {
  resolveStorybookStaticDir,
  reuseStorybookArtifactsFromSourceJob,
} from "./job-engine/storybook-artifacts.js";
import { prepareGenerationDiff } from "./job-engine/generation-diff.js";
import { createImportSessionEventStore } from "./job-engine/import-session-event-store.js";
import { createImportSessionStore } from "./job-engine/import-session-store.js";
import { loadInspectorPolicy } from "./server/inspector-policy.js";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app");
const TEMPLATE_COPY_FILTER = createTemplateCopyFilter({
  templateRoot: TEMPLATE_ROOT,
});

const WORKSPACE_JOB_STAGES: WorkspaceJobStageName[] = [
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
  "validate.project",
  "repro.export",
  "git.pr",
];
const WORKSPACE_JOB_STAGE_SET = new Set<WorkspaceJobStageName>(
  WORKSPACE_JOB_STAGES,
);
const LOCAL_SYNC_CONFIRMATION_TTL_MS = 10 * 60_000;

interface LocalSyncConfirmationRecord {
  token: string;
  jobId: string;
  sourceJobId: string;
  expiresAtMs: number;
  plan: LocalSyncPlan;
  planFingerprint: string;
}

interface StoredCustomerProfileSnapshot {
  origin: "request" | "runtime";
  submittedPath?: string;
  resolvedPath?: string;
  profile: CustomerProfileConfigSnapshot;
}

interface ResolvedCustomerProfileActivation {
  snapshot: StoredCustomerProfileSnapshot;
  profile: ResolvedCustomerProfile;
}

const isWorkspaceJobStageName = (
  value: unknown,
): value is WorkspaceJobStageName => {
  return (
    typeof value === "string" &&
    WORKSPACE_JOB_STAGE_SET.has(value as WorkspaceJobStageName)
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeOptionalInputString = (
  value: string | undefined,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const RETRYABLE_STAGE_SET = new Set<WorkspaceJobRetryStage>([
  "figma.source",
  "ir.derive",
  "template.prepare",
  "codegen.generate",
]);

const isWorkspaceJobRetryStage = (
  value: unknown,
): value is WorkspaceJobRetryStage => {
  return (
    typeof value === "string" &&
    RETRYABLE_STAGE_SET.has(value as WorkspaceJobRetryStage)
  );
};

const resolveRequestCompositeQualityWeights = ({
  input,
  fallback,
}: {
  input: WorkspaceJobInput["compositeQualityWeights"];
  fallback: { visual: number; performance: number };
}): { visual: number; performance: number } => {
  if (input === undefined) {
    return { ...fallback };
  }

  const validate = (value: number | undefined, label: string): void => {
    if (value === undefined) {
      return;
    }
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(
        `submit: composite quality ${label} weight must be within 0..1.`,
      );
    }
  };

  validate(input.visual, "visual");
  validate(input.performance, "performance");

  let visual = input.visual;
  let performance = input.performance;
  if (visual === undefined && performance === undefined) {
    return { ...fallback };
  }
  if (visual === undefined && performance !== undefined) {
    visual = 1 - performance;
  } else if (performance === undefined && visual !== undefined) {
    performance = 1 - visual;
  }

  const total = (visual ?? 0) + (performance ?? 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(
      "submit: composite quality weights must sum to a positive value.",
    );
  }

  return {
    visual: Math.round(((visual ?? 0) / total) * 10_000) / 10_000,
    performance: Math.round(((performance ?? 0) / total) * 10_000) / 10_000,
  };
};

const isStoredCustomerProfileOrigin = (
  value: unknown,
): value is StoredCustomerProfileSnapshot["origin"] => {
  return value === "request" || value === "runtime";
};

const formatCustomerProfileParseFailure = ({
  snapshotLabel,
  issues,
}: {
  snapshotLabel: string;
  issues: Array<{ path: string; message: string }>;
}): string => {
  const firstIssue = issues[0];
  return firstIssue
    ? `${snapshotLabel} (${firstIssue.path}: ${firstIssue.message})`
    : snapshotLabel;
};

const describeCustomerProfileSnapshot = ({
  snapshot,
}: {
  snapshot: StoredCustomerProfileSnapshot;
}): string => {
  if (snapshot.origin === "request") {
    return (
      `request path '${snapshot.submittedPath ?? "<missing>"}'` +
      (snapshot.resolvedPath ? ` (resolved '${snapshot.resolvedPath}')` : "")
    );
  }
  return "runtime.customerProfile fallback";
};

const toRuntimeCustomerProfileActivation = ({
  profile,
}: {
  profile: ResolvedCustomerProfile;
}): ResolvedCustomerProfileActivation => {
  return {
    snapshot: {
      origin: "runtime",
      profile: toCustomerProfileConfigSnapshot({ profile }),
    },
    profile,
  };
};

const restoreCustomerProfileActivation = ({
  snapshot,
}: {
  snapshot: unknown;
}):
  | {
      success: true;
      value: ResolvedCustomerProfileActivation;
    }
  | {
      success: false;
      message: string;
    } => {
  if (!isRecord(snapshot)) {
    return {
      success: false,
      message: "stored customer profile snapshot is not an object",
    };
  }

  const origin = snapshot.origin;
  if (!isStoredCustomerProfileOrigin(origin)) {
    return {
      success: false,
      message: "stored customer profile snapshot origin is invalid",
    };
  }

  const submittedPath = normalizeOptionalInputString(
    typeof snapshot.submittedPath === "string"
      ? snapshot.submittedPath
      : undefined,
  );
  const resolvedPath = normalizeOptionalInputString(
    typeof snapshot.resolvedPath === "string"
      ? snapshot.resolvedPath
      : undefined,
  );
  if (origin === "request" && (!submittedPath || !resolvedPath)) {
    return {
      success: false,
      message:
        "stored customer profile snapshot is missing request path metadata",
    };
  }

  const parsed = safeParseCustomerProfileConfig({ input: snapshot.profile });
  if (!parsed.success) {
    return {
      success: false,
      message: formatCustomerProfileParseFailure({
        snapshotLabel: "stored customer profile snapshot is invalid",
        issues: parsed.issues,
      }),
    };
  }

  return {
    success: true,
    value: {
      snapshot: {
        origin,
        ...(submittedPath ? { submittedPath } : {}),
        ...(resolvedPath ? { resolvedPath } : {}),
        profile: toCustomerProfileConfigSnapshot({ profile: parsed.config }),
      },
      profile: parsed.config,
    },
  };
};

const loadCustomerProfileActivationFromRequest = async ({
  customerProfilePath,
  resolvedWorkspaceRoot,
  limits,
}: {
  customerProfilePath: string;
  resolvedWorkspaceRoot: string;
  limits: PipelineDiagnosticLimits;
}): Promise<ResolvedCustomerProfileActivation> => {
  if (customerProfilePath.includes("\0")) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message: "Customer profile path contains a null byte.",
      limits,
    });
  }

  const resolvedPath = path.resolve(resolvedWorkspaceRoot, customerProfilePath);

  if (
    !isWithinRoot({
      candidatePath: resolvedPath,
      rootPath: resolvedWorkspaceRoot,
    })
  ) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message:
        `Customer profile path '${customerProfilePath}' resolves outside the workspace root ` +
        `('${resolvedWorkspaceRoot}').`,
      limits,
    });
  }

  if (
    await hasSymlinkInPath({
      candidatePath: resolvedPath,
      rootPath: resolvedWorkspaceRoot,
    })
  ) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message:
        `Customer profile path '${customerProfilePath}' contains a symbolic link ` +
        `and cannot be loaded.`,
      limits,
    });
  }

  let rawContent: string;
  try {
    rawContent = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message:
        `Could not read customer profile '${customerProfilePath}' ` +
        `(resolved '${resolvedPath}'): ${getErrorMessage(error)}`,
      cause: error,
      limits,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (error) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message:
        `Could not parse customer profile '${customerProfilePath}' ` +
        `(resolved '${resolvedPath}'): ${getErrorMessage(error)}`,
      cause: error,
      limits,
    });
  }

  const parsed = safeParseCustomerProfileConfig({ input: parsedJson });
  if (!parsed.success) {
    throw createPipelineError({
      code: "E_CUSTOMER_PROFILE_LOAD_FAILED",
      stage: "figma.source",
      message: formatCustomerProfileParseFailure({
        snapshotLabel: `Customer profile '${customerProfilePath}' (resolved '${resolvedPath}') is invalid`,
        issues: parsed.issues,
      }),
      limits,
    });
  }

  return {
    snapshot: {
      origin: "request",
      submittedPath: customerProfilePath,
      resolvedPath,
      profile: toCustomerProfileConfigSnapshot({ profile: parsed.config }),
    },
    profile: parsed.config,
  };
};

const resolveConstrainedPipelinePath = async ({
  configuredPath,
  defaultPath,
  label,
  resolvedWorkspaceRoot,
  outputRoot,
  limits,
}: {
  configuredPath: string | undefined;
  defaultPath: string;
  label: "iconMapFilePath" | "designSystemFilePath";
  resolvedWorkspaceRoot: string;
  outputRoot: string;
  limits: PipelineDiagnosticLimits;
}): Promise<string> => {
  const candidatePath = configuredPath?.trim() || defaultPath;

  if (candidatePath.includes("\0")) {
    throw createPipelineError({
      code: "E_PIPELINE_PATH_INVALID",
      stage: "codegen.generate",
      message: `${label} contains a null byte.`,
      limits,
    });
  }

  const resolvedPath = path.resolve(resolvedWorkspaceRoot, candidatePath);
  const matchingRoot = [resolvedWorkspaceRoot, outputRoot].find((rootPath) =>
    isWithinRoot({
      candidatePath: resolvedPath,
      rootPath,
    }),
  );

  if (!matchingRoot) {
    throw createPipelineError({
      code: "E_PIPELINE_PATH_INVALID",
      stage: "codegen.generate",
      message: `${label} must resolve within the workspace root or output root.`,
      limits,
    });
  }

  if (
    await hasSymlinkInPath({
      candidatePath: resolvedPath,
      rootPath: matchingRoot,
    })
  ) {
    throw createPipelineError({
      code: "E_PIPELINE_PATH_INVALID",
      stage: "codegen.generate",
      message: `${label} contains a symbolic link and cannot be loaded.`,
      limits,
    });
  }

  return resolvedPath;
};

const toDiagnosticInputs = (
  value: unknown,
): PipelineDiagnosticInput[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const diagnostics: PipelineDiagnosticInput[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) {
      continue;
    }
    if (
      typeof candidate.code !== "string" ||
      typeof candidate.message !== "string" ||
      typeof candidate.suggestion !== "string"
    ) {
      continue;
    }
    diagnostics.push({
      code: candidate.code,
      message: candidate.message,
      suggestion: candidate.suggestion,
      ...(isWorkspaceJobStageName(candidate.stage)
        ? { stage: candidate.stage }
        : {}),
      ...(candidate.severity === "error" ||
      candidate.severity === "warning" ||
      candidate.severity === "info"
        ? { severity: candidate.severity }
        : {}),
      ...(typeof candidate.figmaNodeId === "string"
        ? { figmaNodeId: candidate.figmaNodeId }
        : {}),
      ...(typeof candidate.figmaUrl === "string"
        ? { figmaUrl: candidate.figmaUrl }
        : {}),
      ...(isRecord(candidate.details) ? { details: candidate.details } : {}),
    });
  }
  return diagnostics.length > 0 ? diagnostics : undefined;
};

const toPipelineError = ({
  error,
  fallbackStage,
  limits,
}: {
  error: unknown;
  fallbackStage: WorkspaceJobStageName;
  limits: PipelineDiagnosticLimits;
}): WorkspacePipelineError => {
  if (isPipelineError(error)) {
    return error;
  }
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const candidate = error as Error & {
      code: string;
      stage?: unknown;
      diagnostics?: unknown;
      retryable?: unknown;
      retryAfterMs?: unknown;
      fallbackMode?: unknown;
      retryTargets?: unknown;
    };
    const diagnostics = toDiagnosticInputs(candidate.diagnostics);
    return createPipelineError({
      code: candidate.code,
      stage: isWorkspaceJobStageName(candidate.stage)
        ? candidate.stage
        : fallbackStage,
      message: candidate.message,
      cause: error,
      limits,
      ...(typeof candidate.retryable === "boolean"
        ? { retryable: candidate.retryable }
        : {}),
      ...(typeof candidate.retryAfterMs === "number" &&
      Number.isFinite(candidate.retryAfterMs)
        ? { retryAfterMs: Math.max(0, Math.trunc(candidate.retryAfterMs)) }
        : {}),
      ...(candidate.fallbackMode === "none" ||
      candidate.fallbackMode === "rest" ||
      candidate.fallbackMode === "hybrid_rest"
        ? { fallbackMode: candidate.fallbackMode }
        : {}),
      ...(Array.isArray(candidate.retryTargets) &&
      candidate.retryTargets.every(isWorkspaceJobRetryTarget)
        ? { retryTargets: candidate.retryTargets }
        : {}),
      ...(diagnostics ? { diagnostics } : {}),
    });
  }
  return createPipelineError({
    code: "E_PIPELINE_UNKNOWN",
    stage: fallbackStage,
    message: getErrorMessage(error),
    cause: error,
    limits,
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
  runtimeGenerationLocale,
}: {
  submitGenerationLocale: string | undefined;
  runtimeGenerationLocale: string;
}): { locale: string; warningMessage?: string } => {
  const runtimeLocale = resolveGenerationLocale({
    requestedLocale: runtimeGenerationLocale,
    fallbackLocale: DEFAULT_GENERATION_LOCALE,
  }).locale;
  const normalizedSubmitLocale = normalizeGenerationLocale(
    submitGenerationLocale,
  );
  if (normalizedSubmitLocale) {
    return { locale: normalizedSubmitLocale };
  }
  if (
    typeof submitGenerationLocale === "string" &&
    submitGenerationLocale.trim().length > 0
  ) {
    return {
      locale: runtimeLocale,
      warningMessage: `Invalid generationLocale override '${submitGenerationLocale}' - falling back to '${runtimeLocale}'.`,
    };
  }
  return { locale: runtimeLocale };
};

const resolveFigmaSourceMode = ({
  submitFigmaSourceMode,
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
  submitFormHandlingMode,
}: {
  submitFormHandlingMode: WorkspaceFormHandlingMode | undefined;
}): WorkspaceFormHandlingMode => {
  return submitFormHandlingMode === "legacy_use_state"
    ? "legacy_use_state"
    : "react_hook_form";
};

export const createJobEngine = ({
  resolveBaseUrl,
  paths,
  runtime,
}: CreateJobEngineInput): JobEngine => {
  const resolvedPaths = resolveAbsoluteOutputRoot({
    outputRoot: paths.outputRoot,
  });
  const resolvedWorkspaceRoot = path.resolve(
    paths.workspaceRoot ?? path.resolve(paths.outputRoot, ".."),
  );
  const jobs = new Map<string, JobRecord>();
  const queuedJobIds: string[] = [];
  const queuedJobInputs = new Map<string, SubmissionJobInput>();
  const queuedRegenInputs = new Map<string, WorkspaceRegenerationInput>();
  const queuedRetryInputs = new Map<string, WorkspaceRetryInput>();
  const runningJobIds = new Set<string>();
  const localSyncConfirmations = new Map<string, LocalSyncConfirmationRecord>();
  const importSessionStore = createImportSessionStore({
    rootDir: path.join(resolvedPaths.outputRoot, "import-sessions"),
  });
  const importSessionEventStore = createImportSessionEventStore({
    rootDir: path.join(resolvedPaths.outputRoot, "import-sessions"),
  });

  const isAbortLikeError = (error: unknown): boolean => {
    if (!(error instanceof Error)) {
      return false;
    }
    const normalizedMessage = error.message.toLowerCase();
    return (
      error.name === "AbortError" ||
      normalizedMessage.includes("abort") ||
      normalizedMessage.includes("canceled")
    );
  };

  class JobQueueBackpressureError extends Error {
    code = "E_JOB_QUEUE_FULL" as const;
    queue: WorkspaceJobStatus["queue"];

    constructor({ queue }: { queue: WorkspaceJobStatus["queue"] }) {
      super(
        `Job queue limit reached (running=${queue.runningCount}/${queue.maxConcurrentJobs}, queued=${queue.queuedCount}/${queue.maxQueuedJobs}).`,
      );
      this.name = "JobQueueBackpressureError";
      this.queue = queue;
    }
  }

  const createQueuedJobRecord = ({
    jobId,
    request,
    lineage,
  }: {
    jobId: string;
    request: WorkspaceJobStatus["request"];
    lineage?: JobRecord["lineage"];
  }): JobRecord => {
    return {
      jobId,
      status: "queued",
      submittedAt: nowIso(),
      request,
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: resolvedPaths.outputRoot,
        jobDir: path.join(resolvedPaths.jobsRoot, jobId),
      },
      preview: {
        enabled: runtime.previewEnabled,
      },
      queue: toQueueSnapshot({ jobId }),
      ...(lineage ? { lineage } : {}),
    };
  };

  const toQueueSnapshot = ({
    jobId,
  }: { jobId?: string } = {}): WorkspaceJobStatus["queue"] => {
    const position = jobId ? queuedJobIds.indexOf(jobId) : -1;
    return {
      runningCount: runningJobIds.size,
      queuedCount: queuedJobIds.length,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
      ...(position >= 0 ? { position: position + 1 } : {}),
    };
  };

  const toTerminalQueueSnapshot = ({
    jobId,
  }: {
    jobId: string;
  }): WorkspaceJobStatus["queue"] => {
    const position = queuedJobIds.indexOf(jobId);
    return {
      runningCount: Math.max(
        0,
        runningJobIds.size - (runningJobIds.has(jobId) ? 1 : 0),
      ),
      queuedCount: Math.max(0, queuedJobIds.length - (position >= 0 ? 1 : 0)),
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs,
    };
  };

  const refreshQueueSnapshots = (): void => {
    for (const [jobId, job] of jobs.entries()) {
      job.queue = toQueueSnapshot({ jobId });
    }
  };

  const persistTerminalSnapshot = async ({
    job,
    diagnostics,
  }: {
    job: JobRecord;
    diagnostics?: WorkspaceJobDiagnostic[] | undefined;
  }): Promise<void> => {
    job.queue = toTerminalQueueSnapshot({ jobId: job.jobId });
    await writeTerminalJobSnapshot({ job, diagnostics });
  };

  const persistTerminalSnapshotSync = ({
    job,
    diagnostics,
  }: {
    job: JobRecord;
    diagnostics?: WorkspaceJobDiagnostic[] | undefined;
  }): void => {
    job.queue = toTerminalQueueSnapshot({ jobId: job.jobId });
    writeTerminalJobSnapshotSync({ job, diagnostics });
  };

  const buildCompletedTerminalJob = ({
    job,
    finishedAt,
  }: {
    job: JobRecord;
    finishedAt: string;
  }): JobRecord => {
    const terminalJob = structuredClone(job);
    delete terminalJob.abortController;
    terminalJob.status = "completed";
    terminalJob.outcome = "success";
    terminalJob.finishedAt = finishedAt;
    delete terminalJob.currentStage;
    return terminalJob;
  };

  const publishTerminalJob = ({
    job,
    terminalJob,
  }: {
    job: JobRecord;
    terminalJob: JobRecord;
  }): void => {
    Object.assign(job, terminalJob);
    delete job.currentStage;
  };

  const sumComponentManifestMappings = (manifest: unknown): number => {
    if (
      typeof manifest !== "object" ||
      manifest === null ||
      !("screens" in manifest) ||
      !Array.isArray((manifest as { screens?: unknown }).screens)
    ) {
      return 0;
    }
    let total = 0;
    for (const screen of (manifest as { screens: unknown[] }).screens) {
      if (
        typeof screen !== "object" ||
        screen === null ||
        !("components" in screen) ||
        !Array.isArray((screen as { components?: unknown }).components)
      ) {
        continue;
      }
      total += (screen as { components: unknown[] }).components.length;
    }
    return total;
  };

  const extractFirstScreenName = (designIr: unknown): string => {
    if (
      typeof designIr !== "object" ||
      designIr === null ||
      !("screens" in designIr) ||
      !Array.isArray((designIr as { screens?: unknown }).screens)
    ) {
      return "";
    }
    const firstScreen = (designIr as { screens: unknown[] }).screens[0];
    if (
      typeof firstScreen !== "object" ||
      firstScreen === null ||
      !("name" in firstScreen)
    ) {
      return "";
    }
    const name = (firstScreen as { name?: unknown }).name;
    return typeof name === "string" ? name.trim() : "";
  };

  const countDesignIrNodes = (ir: DesignIR): number => {
    let total = 0;
    const stack = [...(ir.screens as Array<{ children?: unknown[] }>)];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next) {
        continue;
      }
      total += 1;
      if (Array.isArray(next.children) && next.children.length > 0) {
        for (let index = next.children.length - 1; index >= 0; index -= 1) {
          const child = next.children[index];
          if (child) {
            stack.push(child as { children?: unknown[] });
          }
        }
      }
    }
    return total;
  };

  const readArtifactJson = async <T>({
    artifactStore,
    key,
  }: {
    artifactStore: StageArtifactStore;
    key: (typeof STAGE_ARTIFACT_KEYS)[keyof typeof STAGE_ARTIFACT_KEYS];
  }): Promise<T | undefined> => {
    const inlineValue = await artifactStore.getValue<T>(key);
    if (inlineValue !== undefined) {
      return inlineValue;
    }
    const artifactPath = await artifactStore.getPath(key);
    if (!artifactPath) {
      return undefined;
    }
    try {
      const raw = await readFile(artifactPath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  };

  const resolveRootSourceJobId = (job: JobRecord): string | null => {
    let current: JobRecord = job;
    const seen = new Set<string>();
    while (current.lineage) {
      if (seen.has(current.jobId)) {
        break;
      }
      seen.add(current.jobId);
      const next = jobs.get(current.lineage.sourceJobId);
      if (!next) {
        return current.lineage.sourceJobId;
      }
      current = next;
    }
    return current.jobId;
  };

  const findImportSessionByJobId = async (
    jobId: string,
  ): Promise<WorkspaceImportSession | undefined> => {
    const sessions = await importSessionStore.list();
    return sessions.find((entry) => entry.jobId === jobId);
  };

  const resolveGovernancePatterns = async (): Promise<readonly string[]> => {
    const loaded = await loadInspectorPolicy({
      workspaceRoot: resolvedWorkspaceRoot,
    });
    return loaded.policy?.governance?.securitySensitivePatterns ?? [];
  };

  const resolveImportGovernanceContext = async ({
    job,
  }: {
    job: JobRecord;
  }): Promise<{
    rootSourceJobId: string | null;
    importSession?: WorkspaceImportSession;
    securitySensitive: boolean;
  }> => {
    const rootSourceJobId = resolveRootSourceJobId(job);
    if (!rootSourceJobId) {
      return {
        rootSourceJobId: null,
        securitySensitive: false,
      };
    }

    const sourceJob = jobs.get(rootSourceJobId);
    if (!sourceJob) {
      return {
        rootSourceJobId,
        securitySensitive: false,
      };
    }

    const sourceArtifactStore = new StageArtifactStore({
      jobDir: sourceJob.artifacts.jobDir,
    });
    const [patterns, designIr, componentManifest, codegenSummary] =
      await Promise.all([
        resolveGovernancePatterns(),
        readArtifactJson<DesignIR>({
          artifactStore: sourceArtifactStore,
          key: STAGE_ARTIFACT_KEYS.designIr,
        }),
        readArtifactJson<ComponentManifest>({
          artifactStore: sourceArtifactStore,
          key: STAGE_ARTIFACT_KEYS.componentManifest,
        }),
        sourceArtifactStore.getValue<{ generatedPaths?: string[] }>(
          STAGE_ARTIFACT_KEYS.codegenSummary,
        ),
      ]);

    const importSession = await findImportSessionByJobId(rootSourceJobId);
    return {
      rootSourceJobId,
      securitySensitive: isSecuritySensitiveImport({
        patterns,
        ...(designIr ? { designIr } : {}),
        ...(componentManifest ? { componentManifest } : {}),
        ...(codegenSummary?.generatedPaths
          ? { generatedPaths: codegenSummary.generatedPaths }
          : {}),
      }),
      ...(importSession ? { importSession } : {}),
    };
  };

  const extractEventQualityScore = (
    event: WorkspaceImportSessionEvent,
  ): number | undefined => {
    const candidate = event.metadata?.qualityScore;
    return typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 0 &&
      candidate <= 100
      ? candidate
      : undefined;
  };

  const createImportSessionGovernanceError = ({
    code,
    message,
  }: {
    code:
      | "E_IMPORT_SESSION_INVALID_TRANSITION"
      | "E_SYNC_IMPORT_REVIEW_REQUIRED"
      | "E_PR_IMPORT_REVIEW_REQUIRED";
    message: string;
  }): Error & { code: string } => {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  };

  const resolveImportSessionStatus = ({
    session,
  }: {
    session: Pick<WorkspaceImportSession, "status">;
  }): NonNullable<WorkspaceImportSession["status"]> => {
    return session.status ?? "imported";
  };

  const GOVERNED_IMPORT_SESSION_ALLOWED_EVENTS: Record<
    NonNullable<WorkspaceImportSession["status"]>,
    ReadonlySet<WorkspaceImportSessionEvent["kind"]>
  > = {
    imported: new Set(["imported", "review_started", "rejected", "apply_blocked", "note"]),
    reviewing: new Set(["review_started", "approved", "rejected", "apply_blocked", "note"]),
    approved: new Set(["approved", "applied", "rejected", "apply_blocked", "note"]),
    applied: new Set(["applied", "note"]),
    rejected: new Set(["note"]),
  };

  const replayGovernedImportSessionHistory = ({
    events,
  }: {
    events: readonly WorkspaceImportSessionEvent[];
  }):
    | {
        ok: true;
        status: NonNullable<WorkspaceImportSession["status"]>;
        authorizingEvent?: WorkspaceImportSessionEvent;
      }
    | {
        ok: false;
        status: NonNullable<WorkspaceImportSession["status"]>;
        invalidEvent: WorkspaceImportSessionEvent;
      } => {
    let status: NonNullable<WorkspaceImportSession["status"]> = "imported";
    let authorizingEvent: WorkspaceImportSessionEvent | undefined;

    for (const event of events) {
      if (!GOVERNED_IMPORT_SESSION_ALLOWED_EVENTS[status].has(event.kind)) {
        return {
          ok: false,
          status,
          invalidEvent: event,
        };
      }
      status =
        deriveSessionStatusFromEvent({
          event,
          currentStatus: status,
        }) ?? status;
      if (event.kind === "approved" || event.kind === "applied") {
        authorizingEvent = event;
      }
    }

    return {
      ok: true,
      status,
      ...(authorizingEvent !== undefined ? { authorizingEvent } : {}),
    };
  };

  const resolveImportSessionGovernanceState = async ({
    session,
    invalidHistoryCode,
    operation,
  }: {
    session: WorkspaceImportSession;
    invalidHistoryCode:
      | "E_IMPORT_SESSION_INVALID_TRANSITION"
      | "E_SYNC_IMPORT_REVIEW_REQUIRED"
      | "E_PR_IMPORT_REVIEW_REQUIRED";
    operation: string;
  }): Promise<{
    status: NonNullable<WorkspaceImportSession["status"]>;
    events: WorkspaceImportSessionEvent[];
    authorizingEvent?: WorkspaceImportSessionEvent;
  }> => {
    const events = await importSessionEventStore.list(session.id);
    if (session.reviewRequired !== true) {
      return {
        status: resolveImportSessionStatus({ session }),
        events,
      };
    }

    const replayed = replayGovernedImportSessionHistory({ events });
    if (!replayed.ok) {
      throw createImportSessionGovernanceError({
        code: invalidHistoryCode,
        message:
          `Import session '${session.id}' has invalid governance history and cannot continue ${operation}: ` +
          `event '${replayed.invalidEvent.kind}' is not allowed after '${replayed.status}'.`,
      });
    }

    return {
      status: replayed.status,
      events,
      ...(replayed.authorizingEvent !== undefined
        ? { authorizingEvent: replayed.authorizingEvent }
        : {}),
    };
  };

  const assertImportSessionTransitionAllowed = async ({
    session,
    event,
  }: {
    session: WorkspaceImportSession;
    event: WorkspaceImportSessionEvent;
  }): Promise<NonNullable<WorkspaceImportSession["status"]>> => {
    const governance = await resolveImportSessionGovernanceState({
      session,
      invalidHistoryCode: "E_IMPORT_SESSION_INVALID_TRANSITION",
      operation: "appending a new import-session event",
    });

    if (
      session.reviewRequired === true &&
      !GOVERNED_IMPORT_SESSION_ALLOWED_EVENTS[governance.status].has(event.kind)
    ) {
      throw createImportSessionGovernanceError({
        code: "E_IMPORT_SESSION_INVALID_TRANSITION",
        message:
          `Import session '${session.id}' cannot append '${event.kind}' while status is '${governance.status}'.`,
      });
    }

    return governance.status;
  };

  const assertImportSessionApprovedForMutation = async ({
    session,
    code,
    operation,
  }: {
    session: WorkspaceImportSession;
    code: "E_SYNC_IMPORT_REVIEW_REQUIRED" | "E_PR_IMPORT_REVIEW_REQUIRED";
    operation: string;
  }): Promise<void> => {
    const governance = await resolveImportSessionGovernanceState({
      session,
      invalidHistoryCode: code,
      operation,
    });
    if (
      session.reviewRequired !== true ||
      governance.status === "approved" ||
      governance.status === "applied"
    ) {
      return;
    }

    throw createImportSessionGovernanceError({
      code,
      message: `Import session '${session.id}' must be approved before ${operation}.`,
    });
  };

  const deriveSessionStatusFromEvent = ({
    event,
    currentStatus,
  }: {
    event: WorkspaceImportSessionEvent;
    currentStatus: WorkspaceImportSession["status"];
  }): WorkspaceImportSession["status"] => {
    switch (event.kind) {
      case "imported":
        return "imported";
      case "review_started":
        return "reviewing";
      case "approved":
        return "approved";
      case "applied":
        return "applied";
      case "rejected":
        return "rejected";
      case "apply_blocked":
      case "note":
        return currentStatus;
    }
  };

  const normalizeReviewerNote = (value: string | undefined): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const resolveReplayability = ({
    requestSourceMode,
    fileKey,
    nodeId,
  }: {
    requestSourceMode: WorkspaceImportSessionSourceMode;
    fileKey: string;
    nodeId: string;
  }): Pick<WorkspaceImportSession, "replayable" | "replayDisabledReason"> => {
    if (requestSourceMode === "figma_url") {
      return {
        replayable: fileKey.length > 0,
        ...(fileKey.length === 0
          ? {
              replayDisabledReason:
                "This import is missing a stable Figma file locator.",
            }
          : {}),
      };
    }

    if (
      requestSourceMode === "figma_paste" ||
      requestSourceMode === "figma_plugin"
    ) {
      if (fileKey.length > 0 && nodeId.length > 0) {
        return { replayable: true };
      }
      return {
        replayable: false,
        replayDisabledReason:
          "Clipboard imports without a stable live locator cannot be replayed from history.",
      };
    }

    return {
      replayable: fileKey.length > 0,
      ...(fileKey.length === 0
        ? {
            replayDisabledReason:
              "This import is missing a stable source locator.",
          }
        : {}),
    };
  };

  const persistImportSessionForJob = async ({
    job,
    artifactStore,
  }: {
    job: JobRecord;
    artifactStore: StageArtifactStore;
  }): Promise<void> => {
    const requestSourceMode = job.request.requestSourceMode;
    if (requestSourceMode === undefined) {
      return;
    }
    if (job.status !== "completed" && job.status !== "partial") {
      return;
    }

    const designIr = await readArtifactJson<DesignIR>({
      artifactStore,
      key: STAGE_ARTIFACT_KEYS.designIr,
    });
    const codegenSummary = await artifactStore.getValue<{
      generatedPaths?: string[];
    }>(STAGE_ARTIFACT_KEYS.codegenSummary);
    const componentManifest = await readArtifactJson<ComponentManifest>({
      artifactStore,
      key: STAGE_ARTIFACT_KEYS.componentManifest,
    });
    const fileKey = job.request.figmaFileKey?.trim() ?? "";
    const nodeId = job.request.figmaNodeId?.trim() ?? "";
    const pasteIdentityKey = job.pasteDeltaSummary?.pasteIdentityKey ?? null;
    const matchedSession = await importSessionStore.findMatching({
      pasteIdentityKey,
      ...(fileKey.length > 0 ? { fileKey } : {}),
      ...(nodeId.length > 0 ? { nodeId } : {}),
    });
    const selectedNodes = [...(job.request.selectedNodeIds ?? [])];
    const firstScreenName = extractFirstScreenName(designIr);

    const session: WorkspaceImportSession = {
      id: matchedSession?.id ?? randomUUID(),
      jobId: job.jobId,
      sourceMode: requestSourceMode,
      fileKey,
      nodeId,
      nodeName: firstScreenName || job.request.projectName?.trim() || fileKey,
      importedAt: job.finishedAt ?? nowIso(),
      nodeCount: designIr ? countDesignIrNodes(designIr) : 0,
      fileCount: codegenSummary?.generatedPaths?.length ?? 0,
      selectedNodes,
      scope: selectedNodes.length > 0 ? "partial" : "all",
      componentMappings: sumComponentManifestMappings(componentManifest),
      pasteIdentityKey,
      status: "imported",
      reviewRequired: true,
      ...resolveReplayability({
        requestSourceMode,
        fileKey,
        nodeId,
      }),
    };

    await importSessionStore.save(session);

    const existingEvents = await importSessionEventStore.list(session.id);
    if (!existingEvents.some((event) => event.kind === "imported")) {
      await importSessionEventStore.append({
        id: randomUUID(),
        sessionId: session.id,
        kind: "imported",
        at: session.importedAt,
        metadata: {
          jobId: session.jobId,
          nodeCount: session.nodeCount,
          fileCount: session.fileCount,
          componentMappings: session.componentMappings,
          reviewRequired: session.reviewRequired ?? null,
          scope: session.scope,
        },
      });
    }
  };

  const determinePartialStatus = async ({
    stage,
    artifactStore,
  }: {
    stage: WorkspaceJobStageName;
    artifactStore: StageArtifactStore;
  }): Promise<boolean> => {
    if (stage === "figma.source") {
      return false;
    }
    if (stage === "ir.derive") {
      return (
        (await artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaCleaned)) !==
        undefined
      );
    }
    if (stage === "template.prepare") {
      return (
        (await artifactStore.getPath(STAGE_ARTIFACT_KEYS.designIr)) !==
        undefined
      );
    }
    if (stage === "codegen.generate") {
      return (
        (await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject)) !==
          undefined ||
        (await artifactStore.getValue(STAGE_ARTIFACT_KEYS.codegenSummary)) !==
          undefined
      );
    }
    return (
      (await artifactStore.getPath(STAGE_ARTIFACT_KEYS.generatedProject)) !==
      undefined
    );
  };

  const reconstructRetrySubmissionInput = ({
    sourceJob,
  }: {
    sourceJob: JobRecord;
  }): WorkspaceJobInput => {
    const figmaAccessToken =
      sourceJob.request.figmaSourceMode === "local_json"
        ? undefined
        : process.env.FIGMA_ACCESS_TOKEN?.trim();
    return {
      ...sourceJob.request,
      ...(sourceJob.request.figmaFileKey
        ? { figmaFileKey: sourceJob.request.figmaFileKey }
        : {}),
      ...(sourceJob.request.figmaNodeId
        ? { figmaNodeId: sourceJob.request.figmaNodeId }
        : {}),
      ...(sourceJob.request.figmaJsonPath
        ? { figmaJsonPath: sourceJob.request.figmaJsonPath }
        : {}),
      ...(figmaAccessToken ? { figmaAccessToken } : {}),
    };
  };

  const seedArtifactReference = async ({
    sourceArtifactStore,
    targetArtifactStore,
    key,
  }: {
    sourceArtifactStore: StageArtifactStore;
    targetArtifactStore: StageArtifactStore;
    key: (typeof STAGE_ARTIFACT_KEYS)[keyof typeof STAGE_ARTIFACT_KEYS];
  }): Promise<void> => {
    const reference = await sourceArtifactStore.getReference(key);
    if (!reference) {
      return;
    }
    if (reference.kind === "path" && reference.path) {
      await targetArtifactStore.setPath({
        key,
        stage: reference.stage,
        absolutePath: reference.path,
      });
      return;
    }
    await targetArtifactStore.setValue({
      key,
      stage: reference.stage,
      value: reference.value,
    });
  };

  const seedRetryArtifacts = async ({
    retryInput,
    sourceJob,
    targetArtifactStore,
    targetGeneratedProjectDir,
  }: {
    retryInput: WorkspaceRetryInput;
    sourceJob: JobRecord;
    targetArtifactStore: StageArtifactStore;
    targetGeneratedProjectDir: string;
  }): Promise<void> => {
    const sourceArtifactStore = new StageArtifactStore({
      jobDir: sourceJob.artifacts.jobDir,
    });
    const keysByStage: Record<
      WorkspaceJobRetryStage,
      Array<(typeof STAGE_ARTIFACT_KEYS)[keyof typeof STAGE_ARTIFACT_KEYS]>
    > = {
      "figma.source": [],
      "ir.derive": [
        STAGE_ARTIFACT_KEYS.figmaRaw,
        STAGE_ARTIFACT_KEYS.figmaCleaned,
        STAGE_ARTIFACT_KEYS.figmaCleanedReport,
        STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
        STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
        STAGE_ARTIFACT_KEYS.customerProfileResolved,
      ],
      "template.prepare": [
        STAGE_ARTIFACT_KEYS.designIr,
        STAGE_ARTIFACT_KEYS.figmaAnalysis,
        STAGE_ARTIFACT_KEYS.storybookCatalog,
        STAGE_ARTIFACT_KEYS.storybookEvidence,
        STAGE_ARTIFACT_KEYS.storybookTokens,
        STAGE_ARTIFACT_KEYS.storybookThemes,
        STAGE_ARTIFACT_KEYS.storybookComponents,
        STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
        STAGE_ARTIFACT_KEYS.componentMatchReport,
        STAGE_ARTIFACT_KEYS.customerProfileResolved,
      ],
      "codegen.generate": [
        STAGE_ARTIFACT_KEYS.designIr,
        STAGE_ARTIFACT_KEYS.figmaAnalysis,
        STAGE_ARTIFACT_KEYS.storybookCatalog,
        STAGE_ARTIFACT_KEYS.storybookEvidence,
        STAGE_ARTIFACT_KEYS.storybookTokens,
        STAGE_ARTIFACT_KEYS.storybookThemes,
        STAGE_ARTIFACT_KEYS.storybookComponents,
        STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
        STAGE_ARTIFACT_KEYS.componentMatchReport,
        STAGE_ARTIFACT_KEYS.customerProfileResolved,
      ],
    };

    for (const key of keysByStage[retryInput.retryStage]) {
      await seedArtifactReference({
        sourceArtifactStore,
        targetArtifactStore,
        key,
      });
    }

    if (retryInput.retryStage === "codegen.generate") {
      const sourceGeneratedProjectDir = sourceJob.artifacts.generatedProjectDir;
      if (!sourceGeneratedProjectDir) {
        throw createPipelineError({
          code: "E_RETRY_SOURCE_ARTIFACT_MISSING",
          stage: "codegen.generate",
          message: `Source job '${sourceJob.jobId}' is missing generated project artifacts required for generate-stage retry.`,
        });
      }
      await cp(sourceGeneratedProjectDir, targetGeneratedProjectDir, {
        recursive: true,
        force: true,
      });
      await targetArtifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.generatedProject,
        stage: "template.prepare",
        absolutePath: targetGeneratedProjectDir,
      });
    }
  };

  for (const rehydratedJob of loadRehydratedJobs({
    jobsRoot: resolvedPaths.jobsRoot,
    resolveBaseUrl,
  })) {
    jobs.set(rehydratedJob.jobId, rehydratedJob);
  }
  refreshQueueSnapshots();

  const createSyncError = ({
    code,
    message,
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
    jobId,
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
        message: `Unknown job '${jobId}'.`,
      });
    }

    if (!job.lineage) {
      throw createSyncError({
        code: "E_SYNC_REGEN_REQUIRED",
        message: `Job '${jobId}' is not a regeneration job; local sync is only available for regenerated output.`,
      });
    }

    if (job.status !== "completed") {
      throw createSyncError({
        code: "E_SYNC_JOB_NOT_COMPLETED",
        message: `Job '${jobId}' has status '${job.status}' — local sync is only available for completed jobs.`,
      });
    }

    if (!job.artifacts.generatedProjectDir) {
      const missingGeneratedDir = new LocalSyncError(
        "E_SYNC_GENERATED_DIR_MISSING",
        `Generated project directory not available for job '${jobId}'.`,
      );
      throw missingGeneratedDir;
    }

    const boardKeySeed =
      job.request.figmaFileKey?.trim() ||
      job.request.figmaJsonPath?.trim() ||
      "regeneration";
    return {
      job,
      sourceJobId: job.lineage.sourceJobId,
      boardKey: resolveBoardKey(boardKeySeed),
      generatedProjectDir: job.artifacts.generatedProjectDir,
    };
  };

  const markQueuedStagesSkippedAfterCancellation = ({
    job,
    reason,
  }: {
    job: JobRecord;
    reason: string;
  }): void => {
    for (const stage of job.stages) {
      if (stage.status === "queued") {
        updateStage({
          job,
          stage: stage.name,
          status: "skipped",
          message: reason,
        });
      }
    }
  };

  const persistCustomerProfileActivation = async ({
    artifactStore,
    stage,
    activation,
  }: {
    artifactStore: StageArtifactStore;
    stage: WorkspaceJobStageName;
    activation: ResolvedCustomerProfileActivation;
  }): Promise<void> => {
    await artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.customerProfileResolved,
      stage,
      value: activation.snapshot,
    });
  };

  const activateSubmissionCustomerProfile = async ({
    job,
    artifactStore,
    input,
  }: {
    job: JobRecord;
    artifactStore: StageArtifactStore;
    input: WorkspaceJobInput;
  }): Promise<ResolvedCustomerProfile | undefined> => {
    const explicitPath = normalizeOptionalInputString(
      input.customerProfilePath,
    );
    if (explicitPath) {
      const activation = await loadCustomerProfileActivationFromRequest({
        customerProfilePath: explicitPath,
        resolvedWorkspaceRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      await persistCustomerProfileActivation({
        artifactStore,
        stage: "figma.source",
        activation,
      });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "info",
        stage: "figma.source",
        message: `Activated customer profile snapshot from ${describeCustomerProfileSnapshot({ snapshot: activation.snapshot })}.`,
      });
      return activation.profile;
    }

    if (!runtime.customerProfile) {
      return undefined;
    }

    const activation = toRuntimeCustomerProfileActivation({
      profile: runtime.customerProfile,
    });
    await persistCustomerProfileActivation({
      artifactStore,
      stage: "figma.source",
      activation,
    });
    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      stage: "figma.source",
      message: `Activated customer profile snapshot from ${describeCustomerProfileSnapshot({ snapshot: activation.snapshot })}.`,
    });
    return activation.profile;
  };

  const activateSubmissionStorybookStaticDir = ({
    job,
    input,
  }: {
    job: JobRecord;
    input: WorkspaceJobInput;
  }):
    | {
        requestedStorybookStaticDir: string;
        resolvedStorybookStaticDir: string;
      }
    | undefined => {
    const requestedStorybookStaticDir = normalizeOptionalInputString(
      input.storybookStaticDir,
    );
    if (!requestedStorybookStaticDir) {
      return undefined;
    }

    const resolvedStorybookStaticDir = resolveStorybookStaticDir({
      storybookStaticDir: requestedStorybookStaticDir,
      resolvedWorkspaceRoot,
      limits: runtime.pipelineDiagnosticLimits,
    });
    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      stage: "figma.source",
      message:
        `Activated Storybook static dir '${requestedStorybookStaticDir}' ` +
        `(resolved '${resolvedStorybookStaticDir}').`,
    });
    return {
      requestedStorybookStaticDir,
      resolvedStorybookStaticDir,
    };
  };

  const buildPasteCompatibilityFingerprintForJob = async ({
    artifactStore,
    customerBrandId,
    request,
    storybookStaticDir,
  }: {
    artifactStore: StageArtifactStore;
    customerBrandId?: string;
    request: WorkspaceJobStatus["request"];
    storybookStaticDir?: string;
  }): Promise<string> => {
    const customerProfileSnapshot = await artifactStore.getValue<unknown>(
      STAGE_ARTIFACT_KEYS.customerProfileResolved,
    );
    return computePasteCompatibilityFingerprint({
      figmaSourceMode: request.figmaSourceMode,
      brandTheme: request.brandTheme,
      ...(customerBrandId ? { customerBrandId } : {}),
      ...(customerProfileSnapshot !== undefined
        ? { customerProfileSnapshot }
        : {}),
      ...(request.componentMappings !== undefined
        ? { componentMappings: request.componentMappings }
        : {}),
      ...(storybookStaticDir ? { storybookStaticDir } : {}),
      generationLocale: request.generationLocale,
      formHandlingMode: request.formHandlingMode,
      routerMode: runtime.routerMode,
      screenElementBudget: runtime.figmaScreenElementBudget,
      screenElementMaxDepth: runtime.figmaScreenElementMaxDepth,
      exportImages: runtime.exportImages,
    });
  };

  const resolveSubmissionPasteDeltaSourceJob = async ({
    artifactStore,
    input,
    job,
    resolvedCustomerBrandId,
    storybookActivation,
  }: {
    artifactStore: StageArtifactStore;
    input: SubmissionJobInput;
    job: JobRecord;
    resolvedCustomerBrandId?: string;
    storybookActivation?:
      | {
          requestedStorybookStaticDir: string;
          resolvedStorybookStaticDir: string;
        }
      | undefined;
  }): Promise<{
    sourceJob?: JobRecord;
    compatibilityFingerprint?: string;
  }> => {
    const seed = input.pasteDeltaSeed;
    if (!seed || input.importMode === "full") {
      return {};
    }
    const sourceJobId = seed.sourceJobId?.trim();
    if (!sourceJobId) {
      return {};
    }
    const sourceJob = jobs.get(sourceJobId);
    if (!sourceJob || sourceJob.status !== "completed") {
      return {};
    }
    if (
      !sourceJob.artifacts.designIrFile ||
      !sourceJob.artifacts.generatedProjectDir
    ) {
      return {};
    }

    const currentCompatibilityFingerprint =
      await buildPasteCompatibilityFingerprintForJob({
        artifactStore,
        ...(resolvedCustomerBrandId
          ? { customerBrandId: resolvedCustomerBrandId }
          : {}),
        request: job.request,
        ...(storybookActivation?.requestedStorybookStaticDir
          ? {
              storybookStaticDir:
                storybookActivation.requestedStorybookStaticDir,
            }
          : {}),
      });
    const sourceArtifactStore = new StageArtifactStore({
      jobDir: sourceJob.artifacts.jobDir,
    });
    const sourceCompatibilityFingerprint =
      await buildPasteCompatibilityFingerprintForJob({
        artifactStore: sourceArtifactStore,
        ...(sourceJob.request.customerBrandId
          ? { customerBrandId: sourceJob.request.customerBrandId }
          : {}),
        request: sourceJob.request,
        ...(sourceJob.request.storybookStaticDir
          ? { storybookStaticDir: sourceJob.request.storybookStaticDir }
          : {}),
      });

    if (currentCompatibilityFingerprint !== sourceCompatibilityFingerprint) {
      return {
        compatibilityFingerprint: currentCompatibilityFingerprint,
      };
    }

    return {
      sourceJob,
      compatibilityFingerprint: currentCompatibilityFingerprint,
    };
  };

  const activateRegenerationCustomerProfile = async ({
    job,
    artifactStore,
    sourceJob,
  }: {
    job: JobRecord;
    artifactStore: StageArtifactStore;
    sourceJob: JobRecord;
  }): Promise<ResolvedCustomerProfile | undefined> => {
    const sourceArtifactStore = new StageArtifactStore({
      jobDir: sourceJob.artifacts.jobDir,
    });
    const sourceSnapshot = await sourceArtifactStore.getValue<unknown>(
      STAGE_ARTIFACT_KEYS.customerProfileResolved,
    );
    const sourceDeclaredExplicitProfile = normalizeOptionalInputString(
      sourceJob.request.customerProfilePath,
    );

    if (sourceSnapshot === undefined) {
      if (!sourceDeclaredExplicitProfile) {
        return undefined;
      }
      throw createPipelineError({
        code: "E_CUSTOMER_PROFILE_SNAPSHOT_MISSING",
        stage: "ir.derive",
        message:
          `Source job '${sourceJob.jobId}' declared customerProfilePath '${sourceDeclaredExplicitProfile}' ` +
          "but no resolved customer profile snapshot was persisted.",
        limits: runtime.pipelineDiagnosticLimits,
      });
    }

    const restored = restoreCustomerProfileActivation({
      snapshot: sourceSnapshot,
    });
    if (!restored.success) {
      throw createPipelineError({
        code: "E_CUSTOMER_PROFILE_SNAPSHOT_MISSING",
        stage: "ir.derive",
        message: `Source job '${sourceJob.jobId}' customer profile snapshot is invalid: ${restored.message}.`,
        limits: runtime.pipelineDiagnosticLimits,
      });
    }

    await persistCustomerProfileActivation({
      artifactStore,
      stage: "ir.derive",
      activation: restored.value,
    });
    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      stage: "ir.derive",
      message:
        `Reused customer profile snapshot from source job '${sourceJob.jobId}' via ` +
        `${describeCustomerProfileSnapshot({ snapshot: restored.value.snapshot })}.`,
    });
    return restored.value.profile;
  };

  const activateRegenerationStorybookArtifacts = async ({
    job,
    artifactStore,
    sourceJob,
  }: {
    job: JobRecord;
    artifactStore: StageArtifactStore;
    sourceJob: JobRecord;
  }): Promise<string | undefined> => {
    const sourceRequestedStorybookStaticDir = normalizeOptionalInputString(
      sourceJob.request.storybookStaticDir,
    );
    if (!sourceRequestedStorybookStaticDir) {
      return undefined;
    }

    const sourceArtifactStore = new StageArtifactStore({
      jobDir: sourceJob.artifacts.jobDir,
    });
    try {
      await reuseStorybookArtifactsFromSourceJob({
        sourceArtifactStore,
        targetArtifactStore: artifactStore,
        sourceJobId: sourceJob.jobId,
        sourceRequestedStorybookStaticDir,
        targetJobDir: job.artifacts.jobDir,
        stage: "ir.derive",
      });
    } catch (error) {
      throw createPipelineError({
        code: "E_STORYBOOK_ARTIFACTS_MISSING",
        stage: "ir.derive",
        message: getErrorMessage(error),
        cause: error,
        limits: runtime.pipelineDiagnosticLimits,
      });
    }

    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      stage: "ir.derive",
      message:
        `Reused Storybook artifacts from source job '${sourceJob.jobId}' ` +
        `(storybookStaticDir='${sourceRequestedStorybookStaticDir}').`,
    });

    return sourceRequestedStorybookStaticDir;
  };

  const persistSubmissionPasteFingerprintManifest = async ({
    artifactStore,
    compatibilityFingerprint,
    job,
  }: {
    artifactStore: StageArtifactStore;
    compatibilityFingerprint?: string;
    job: JobRecord;
  }): Promise<void> => {
    const execution = await artifactStore.getValue<PasteDeltaExecutionState>(
      STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
      isPasteDeltaExecutionState,
    );
    if (!execution) {
      return;
    }
    const generatedProjectDir = await artifactStore.getPath(
      STAGE_ARTIFACT_KEYS.generatedProject,
    );
    if (!generatedProjectDir) {
      return;
    }
    const boardKey = resolveBoardKey(
      job.request.figmaFileKey?.trim() ||
        job.request.figmaJsonPath?.trim() ||
        execution.pasteIdentityKey,
    );
    const preparedDiff = await prepareGenerationDiff({
      generatedProjectDir,
      outputRoot: resolvedPaths.outputRoot,
      boardKey,
      jobId: job.jobId,
    });
    const manifest: PasteFingerprintManifest = {
      contractVersion: CONTRACT_VERSION,
      pasteIdentityKey: execution.pasteIdentityKey,
      createdAt: new Date().toISOString(),
      rootNodeIds: execution.rootNodeIds,
      nodes: execution.currentFingerprintNodes,
      ...(execution.figmaFileKey
        ? { figmaFileKey: execution.figmaFileKey }
        : {}),
      sourceJobId: job.jobId,
      execution: {
        requestedMode: execution.requestedMode,
        effectiveMode: execution.summary.mode,
        strategy: execution.summary.strategy,
        changedNodeIds: execution.changedNodeIds,
        changedRootNodeIds: execution.changedRootNodeIds,
        ...(compatibilityFingerprint
          ? { compatibilityFingerprint }
          : execution.compatibilityFingerprint
            ? { compatibilityFingerprint: execution.compatibilityFingerprint }
            : {}),
        generatedArtifactHashes: preparedDiff.snapshot.files,
      },
    };
    const store = createPasteFingerprintStore({
      rootDir: path.join(resolvedPaths.outputRoot, "paste-fingerprints"),
    });
    await store.save(manifest);
  };

  const runJob = async (
    job: JobRecord,
    input: SubmissionJobInput,
  ): Promise<void> => {
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
        signal: mergedSignal,
      });
    };
    const resolvedBrandTheme: WorkspaceBrandTheme =
      input.brandTheme ?? runtime.brandTheme;
    const resolvedCustomerBrandId = normalizeOptionalInputString(
      input.customerBrandId,
    );
    const resolvedFigmaSourceMode = resolveFigmaSourceMode({
      submitFigmaSourceMode: input.figmaSourceMode,
    });
    const resolvedFormHandlingMode = resolveFormHandlingMode({
      submitFormHandlingMode: input.formHandlingMode,
    });
    const generationLocaleResolution = resolveJobGenerationLocale({
      submitGenerationLocale: input.generationLocale,
      runtimeGenerationLocale: runtime.generationLocale,
    });
    const resolvedGenerationLocale = generationLocaleResolution.locale;
    const figmaFileKeyForDiagnostics =
      resolvedFigmaSourceMode === "local_json"
        ? undefined
        : input.figmaFileKey?.trim();

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const figmaAnalysisFile = path.join(jobDir, "figma-analysis.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.figmaJsonFile = figmaJsonFile;
    job.artifacts.designIrFile = designIrFile;
    job.artifacts.figmaAnalysisFile = figmaAnalysisFile;
    job.artifacts.stageTimingsFile = stageTimingsFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    let collectedDiagnostics: WorkspaceJobDiagnostic[] | undefined;
    const artifactStore = new StageArtifactStore({ jobDir });

    const appendDiagnostics = ({
      stage,
      diagnostics,
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
        diagnostics,
        limits: runtime.pipelineDiagnosticLimits,
      }).diagnostics;
      collectedDiagnostics = mergePipelineDiagnostics({
        ...(collectedDiagnostics ? { first: collectedDiagnostics } : {}),
        ...(normalized ? { second: normalized } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
    };

    try {
      const iconMapFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.iconMapFilePath,
        defaultPath: path.join(
          resolvedPaths.outputRoot,
          "icon-fallback-map.json",
        ),
        label: "iconMapFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const designSystemFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.designSystemFilePath,
        defaultPath: path.join(resolvedPaths.outputRoot, "design-system.json"),
        label: "designSystemFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const irCacheDir = path.join(
        resolvedPaths.outputRoot,
        "cache",
        "ir-derivation",
      );

      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.jobsRoot, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      const storybookActivation = activateSubmissionStorybookStaticDir({
        job,
        input,
      });
      const resolvedCustomerProfile = await activateSubmissionCustomerProfile({
        job,
        artifactStore,
        input,
      });
      const {
        sourceJob: deltaSourceJob,
        compatibilityFingerprint: pasteDeltaCompatibilityFingerprint,
      } = await resolveSubmissionPasteDeltaSourceJob({
        artifactStore,
        input,
        job,
        ...(resolvedCustomerBrandId ? { resolvedCustomerBrandId } : {}),
        ...(storybookActivation ? { storybookActivation } : {}),
      });
      const context: PipelineExecutionContext = {
        mode: "submission",
        job,
        input,
        ...(deltaSourceJob ? { sourceJob: deltaSourceJob } : {}),
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
          figmaAnalysisFile,
          stageTimingsFile,
          reproDir,
          iconMapFilePath,
          designSystemFilePath,
          irCacheDir,
          templateRoot: TEMPLATE_ROOT,
          templateCopyFilter: TEMPLATE_COPY_FILTER,
        },
        artifactStore,
        resolvedBrandTheme,
        ...(resolvedCustomerBrandId ? { resolvedCustomerBrandId } : {}),
        resolvedFigmaSourceMode,
        resolvedFormHandlingMode,
        ...(storybookActivation
          ? {
              requestedStorybookStaticDir:
                storybookActivation.requestedStorybookStaticDir,
              resolvedStorybookStaticDir:
                storybookActivation.resolvedStorybookStaticDir,
            }
          : {}),
        ...(resolvedCustomerProfile ? { resolvedCustomerProfile } : {}),
        generationLocaleResolution,
        resolvedGenerationLocale,
        appendDiagnostics,
        getCollectedDiagnostics: () => collectedDiagnostics,
        syncPublicJobProjection: async () => {
          await syncPublicJobProjection({ job, artifactStore });
        },
        ...(figmaFileKeyForDiagnostics ? { figmaFileKeyForDiagnostics } : {}),
      };

      const orchestrator = new PipelineOrchestrator({
        toPipelineError: ({ error, fallbackStage }) =>
          toPipelineError({
            error,
            fallbackStage,
            limits: runtime.pipelineDiagnosticLimits,
          }),
        isAbortLikeError,
      });
      await orchestrator.execute({
        context,
        plan: buildSubmissionPipelinePlan(),
      });

      const terminalJob = buildCompletedTerminalJob({
        job,
        finishedAt: nowIso(),
      });
      await syncPublicJobProjection({ job: terminalJob, artifactStore });
      if (
        deltaSourceJob &&
        terminalJob.pasteDeltaSummary &&
        (terminalJob.pasteDeltaSummary.mode === "delta" ||
          terminalJob.pasteDeltaSummary.mode === "auto_resolved_to_delta")
      ) {
        terminalJob.lineage = {
          sourceJobId: deltaSourceJob.jobId,
          kind: "delta",
          overrideCount: 0,
        };
      }
      await persistSubmissionPasteFingerprintManifest({
        artifactStore,
        ...(pasteDeltaCompatibilityFingerprint
          ? { compatibilityFingerprint: pasteDeltaCompatibilityFingerprint }
          : {}),
        job: terminalJob,
      });
      await persistImportSessionForJob({ job: terminalJob, artifactStore });
      const generationSummary = await artifactStore.getValue<{
        generatedPaths?: string[];
      }>(STAGE_ARTIFACT_KEYS.codegenSummary);
      pushRuntimeLog({
        job: terminalJob,
        logger: runtime.logger,
        level: "info",
        message:
          `Job completed. Generated output at ${generatedProjectDir} ` +
          `(${generationSummary?.generatedPaths?.length ?? 0} artifacts).`,
      });
      await persistTerminalSnapshot({
        job: terminalJob,
        ...(collectedDiagnostics ? { diagnostics: collectedDiagnostics } : {}),
      });
      publishTerminalJob({ job, terminalJob });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        job.status = "canceled";
        job.finishedAt = nowIso();
        job.currentStage = error.stage;
        if (!job.cancellation) {
          job.cancellation = {
            requestedAt: nowIso(),
            reason: error.message,
            requestedBy: "api",
          };
        }
        job.cancellation.completedAt = nowIso();
        markQueuedStagesSkippedAfterCancellation({
          job,
          reason: error.message,
        });
        pushRuntimeLog({
          job,
          logger: runtime.logger,
          level: "warn",
          stage: error.stage,
          message: `Job canceled: ${error.message}`,
        });
        try {
          await persistTerminalSnapshot({
            job,
            ...(collectedDiagnostics
              ? { diagnostics: collectedDiagnostics }
              : {}),
          });
        } catch {
          // Ignore stage-timing persistence failures during cancellation handling.
        }
        return;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: job.currentStage ?? "figma.source",
        limits: runtime.pipelineDiagnosticLimits,
      });
      const mergedDiagnostics = mergePipelineDiagnostics({
        ...(typedError.diagnostics ? { first: typedError.diagnostics } : {}),
        ...(collectedDiagnostics ? { second: collectedDiagnostics } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
      if (mergedDiagnostics) {
        collectedDiagnostics = mergedDiagnostics;
      }

      const shouldMarkPartial = await determinePartialStatus({
        stage: typedError.stage,
        artifactStore,
      });
      job.status = shouldMarkPartial ? "partial" : "failed";
      job.outcome = shouldMarkPartial ? "partial" : "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message,
        ...(typedError.retryable !== undefined
          ? { retryable: typedError.retryable }
          : {}),
        ...(typedError.retryAfterMs !== undefined
          ? { retryAfterMs: typedError.retryAfterMs }
          : {}),
        ...(typedError.fallbackMode !== undefined
          ? { fallbackMode: typedError.fallbackMode }
          : {}),
        ...(typedError.retryTargets
          ? {
              retryTargets: typedError.retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
        ...(mergedDiagnostics ? { diagnostics: mergedDiagnostics } : {}),
      };
      job.currentStage = typedError.stage;
      await syncPublicJobProjection({ job, artifactStore });
      await persistImportSessionForJob({ job, artifactStore });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "error",
        stage: typedError.stage,
        message: `Job failed: ${typedError.code} ${typedError.message}`,
      });
      try {
        await persistTerminalSnapshot({
          job,
          ...(collectedDiagnostics
            ? { diagnostics: collectedDiagnostics }
            : {}),
        });
      } catch {
        // Ignore stage-timing persistence failures during error handling.
      }
    } finally {
      delete job.abortController;
    }
  };

  const executeJob = ({
    job,
    input,
  }: {
    job: JobRecord;
    input: SubmissionJobInput;
  }): void => {
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

  const submitJob = (input: SubmissionJobInput) => {
    if (
      runningJobIds.size >= runtime.maxConcurrentJobs &&
      queuedJobIds.length >= runtime.maxQueuedJobs
    ) {
      throw new JobQueueBackpressureError({
        queue: toQueueSnapshot(),
      });
    }

    const jobId = randomUUID();
    const acceptedModes =
      input.figmaSourceMode === undefined
        ? toAcceptedModes()
        : toAcceptedModes({ figmaSourceMode: input.figmaSourceMode });
    const generationLocaleResolution = resolveJobGenerationLocale({
      submitGenerationLocale: input.generationLocale,
      runtimeGenerationLocale: runtime.generationLocale,
    });
    const customerProfilePath = normalizeOptionalInputString(
      input.customerProfilePath,
    );
    const customerBrandId = normalizeOptionalInputString(input.customerBrandId);
    const storybookStaticDir = normalizeOptionalInputString(
      input.storybookStaticDir,
    );
    const componentMappings = input.componentMappings
      ? normalizeComponentMappingRules({
          rules: input.componentMappings,
        })
      : undefined;
    const resolvedFormHandlingMode = resolveFormHandlingMode({
      submitFormHandlingMode: input.formHandlingMode,
    });
    const visualQualityCompatibilityEnabled = input.visualAudit !== undefined;
    const resolvedEnableVisualQualityValidation =
      typeof input.enableVisualQualityValidation === "boolean"
        ? input.enableVisualQualityValidation
        : visualQualityCompatibilityEnabled ||
          runtime.enableVisualQualityValidation;
    const resolvedVisualQualityReferenceMode =
      input.visualQualityReferenceMode ??
      (visualQualityCompatibilityEnabled
        ? "frozen_fixture"
        : runtime.visualQualityReferenceMode);
    const resolvedVisualQualityViewportWidth =
      typeof input.visualQualityViewportWidth === "number" &&
      Number.isFinite(input.visualQualityViewportWidth)
        ? Math.trunc(input.visualQualityViewportWidth)
        : typeof input.visualAudit?.capture?.viewport?.width === "number" &&
            Number.isFinite(input.visualAudit.capture.viewport.width)
          ? Math.trunc(input.visualAudit.capture.viewport.width)
          : runtime.visualQualityViewportWidth;
    const resolvedVisualQualityViewportHeight =
      typeof input.visualQualityViewportHeight === "number" &&
      Number.isFinite(input.visualQualityViewportHeight)
        ? Math.trunc(input.visualQualityViewportHeight)
        : typeof input.visualAudit?.capture?.viewport?.height === "number" &&
            Number.isFinite(input.visualAudit.capture.viewport.height)
          ? Math.trunc(input.visualAudit.capture.viewport.height)
          : runtime.visualQualityViewportHeight;
    const resolvedVisualQualityDeviceScaleFactor =
      typeof input.visualQualityDeviceScaleFactor === "number" &&
      Number.isFinite(input.visualQualityDeviceScaleFactor)
        ? input.visualQualityDeviceScaleFactor
        : runtime.visualQualityDeviceScaleFactor;
    const resolvedVisualQualityBrowsers =
      Array.isArray(input.visualQualityBrowsers) &&
      input.visualQualityBrowsers.length > 0
        ? input.visualQualityBrowsers
        : runtime.visualQualityBrowsers;
    const resolvedCompositeQualityWeights =
      resolveRequestCompositeQualityWeights({
        input: input.compositeQualityWeights,
        fallback: runtime.compositeQualityWeights,
      });
    const request: WorkspaceJobStatus["request"] = {
      enableGitPr: input.enableGitPr === true,
      figmaSourceMode: acceptedModes.figmaSourceMode,
      llmCodegenMode: acceptedModes.llmCodegenMode,
      brandTheme: input.brandTheme ?? runtime.brandTheme,
      generationLocale: generationLocaleResolution.locale,
      formHandlingMode: resolvedFormHandlingMode,
      enableVisualQualityValidation: resolvedEnableVisualQualityValidation,
      compositeQualityWeights: resolvedCompositeQualityWeights,
      ...(input.importMode !== undefined
        ? { importMode: input.importMode }
        : {}),
      ...(input.selectedNodeIds !== undefined
        ? { selectedNodeIds: [...input.selectedNodeIds] }
        : {}),
      ...(input.requestSourceMode !== undefined
        ? { requestSourceMode: input.requestSourceMode }
        : {}),
      ...(resolvedEnableVisualQualityValidation
        ? {
            visualQualityReferenceMode: resolvedVisualQualityReferenceMode,
            visualQualityViewportWidth: resolvedVisualQualityViewportWidth,
            visualQualityViewportHeight: resolvedVisualQualityViewportHeight,
            visualQualityDeviceScaleFactor:
              resolvedVisualQualityDeviceScaleFactor,
            visualQualityBrowsers: [...resolvedVisualQualityBrowsers],
          }
        : {}),
    };
    if (input.figmaFileKey) {
      request.figmaFileKey = input.figmaFileKey;
    }
    if (input.figmaNodeId) {
      request.figmaNodeId = input.figmaNodeId;
    }
    if (input.figmaJsonPath) {
      request.figmaJsonPath = input.figmaJsonPath;
    }
    if (customerProfilePath) {
      request.customerProfilePath = customerProfilePath;
    }
    if (customerBrandId) {
      request.customerBrandId = customerBrandId;
    }
    if (componentMappings !== undefined) {
      request.componentMappings = componentMappings;
    }
    if (storybookStaticDir) {
      request.storybookStaticDir = storybookStaticDir;
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
    if (input.importIntent !== undefined) {
      request.importIntent = input.importIntent;
    }
    if (input.originalIntent !== undefined) {
      request.originalIntent = input.originalIntent;
    }
    if (input.intentCorrected !== undefined) {
      request.intentCorrected = input.intentCorrected;
    }
    if (input.visualAudit) {
      request.visualAudit = {
        ...input.visualAudit,
        ...(input.visualAudit.capture
          ? {
              capture: {
                ...input.visualAudit.capture,
                ...(input.visualAudit.capture.viewport
                  ? {
                      viewport: { ...input.visualAudit.capture.viewport },
                    }
                  : {}),
              },
            }
          : {}),
        ...(input.visualAudit.diff
          ? { diff: { ...input.visualAudit.diff } }
          : {}),
        ...(input.visualAudit.regions
          ? {
              regions: input.visualAudit.regions.map((region) => ({
                ...region,
              })),
            }
          : {}),
      };
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
        jobDir: path.join(resolvedPaths.jobsRoot, jobId),
      },
      preview: {
        enabled: runtime.previewEnabled,
      },
      queue: toQueueSnapshot({ jobId }),
    };

    jobs.set(jobId, job);

    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      message: "Job accepted by workspace-dev runtime.",
    });

    if (runningJobIds.size < runtime.maxConcurrentJobs) {
      executeJob({ job, input });
    } else {
      queuedJobIds.push(jobId);
      queuedJobInputs.set(jobId, { ...input });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "info",
        message: `Job queued with position ${queuedJobIds.length}.`,
      });
      refreshQueueSnapshots();
    }

    return {
      jobId,
      status: "queued" as const,
      acceptedModes,
      ...(input.importIntent !== undefined
        ? { importIntent: input.importIntent }
        : {}),
    };
  };

  const runRegenerationJob = async (
    job: JobRecord,
    regenInput: WorkspaceRegenerationInput,
  ): Promise<void> => {
    job.status = "running";
    job.startedAt = nowIso();
    const jobAbortController = new AbortController();
    job.abortController = jobAbortController;

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const figmaAnalysisFile = path.join(jobDir, "figma-analysis.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.designIrFile = designIrFile;
    job.artifacts.figmaAnalysisFile = figmaAnalysisFile;
    job.artifacts.stageTimingsFile = stageTimingsFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    let collectedDiagnostics: WorkspaceJobDiagnostic[] | undefined;
    const artifactStore = new StageArtifactStore({ jobDir });

    const sourceRecord = jobs.get(regenInput.sourceJobId);
    if (!sourceRecord) {
      job.status = "failed";
      job.outcome = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: "E_REGEN_SOURCE_NOT_FOUND",
        stage: "figma.source",
        message: `Source job '${regenInput.sourceJobId}' not found.`,
      };
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "error",
        stage: "figma.source",
        message: `Regeneration job failed: E_REGEN_SOURCE_NOT_FOUND Source job '${regenInput.sourceJobId}' not found.`,
      });
      await persistTerminalSnapshot({ job });
      return;
    }

    const resolvedFormHandlingMode = sourceRecord.request.formHandlingMode;
    const resolvedGenerationLocale = sourceRecord.request.generationLocale;
    const resolvedFigmaSourceMode = sourceRecord.request.figmaSourceMode;
    const resolvedBrandTheme = sourceRecord.request.brandTheme;
    const resolvedCustomerBrandId =
      normalizeOptionalInputString(regenInput.customerBrandId) ??
      sourceRecord.request.customerBrandId;

    const appendDiagnostics = ({
      stage,
      diagnostics,
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
        diagnostics,
        limits: runtime.pipelineDiagnosticLimits,
      }).diagnostics;
      collectedDiagnostics = mergePipelineDiagnostics({
        ...(collectedDiagnostics ? { first: collectedDiagnostics } : {}),
        ...(normalized ? { second: normalized } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
    };

    try {
      const iconMapFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.iconMapFilePath,
        defaultPath: path.join(
          resolvedPaths.outputRoot,
          "icon-fallback-map.json",
        ),
        label: "iconMapFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const designSystemFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.designSystemFilePath,
        defaultPath: path.join(resolvedPaths.outputRoot, "design-system.json"),
        label: "designSystemFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const irCacheDir = path.join(
        resolvedPaths.outputRoot,
        "cache",
        "ir-derivation",
      );

      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      await artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.regenerationSourceIr,
        stage: "ir.derive",
        value: {
          sourceJobId: regenInput.sourceJobId,
          sourceIrFile: sourceRecord.artifacts.designIrFile,
          sourceAnalysisFile: sourceRecord.artifacts.figmaAnalysisFile,
        },
      });
      await artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.regenerationOverrides,
        stage: "ir.derive",
        value: regenInput.overrides,
      });
      const requestedStorybookStaticDir =
        await activateRegenerationStorybookArtifacts({
          job,
          artifactStore,
          sourceJob: sourceRecord,
        });
      const resolvedCustomerProfile = await activateRegenerationCustomerProfile(
        {
          job,
          artifactStore,
          sourceJob: sourceRecord,
        },
      );
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
          figmaAnalysisFile,
          stageTimingsFile,
          reproDir,
          iconMapFilePath,
          designSystemFilePath,
          irCacheDir,
          templateRoot: TEMPLATE_ROOT,
          templateCopyFilter: TEMPLATE_COPY_FILTER,
        },
        artifactStore,
        resolvedBrandTheme,
        ...(resolvedCustomerBrandId ? { resolvedCustomerBrandId } : {}),
        resolvedFigmaSourceMode,
        resolvedFormHandlingMode,
        ...(requestedStorybookStaticDir ? { requestedStorybookStaticDir } : {}),
        ...(resolvedCustomerProfile ? { resolvedCustomerProfile } : {}),
        generationLocaleResolution: { locale: resolvedGenerationLocale },
        resolvedGenerationLocale,
        appendDiagnostics,
        getCollectedDiagnostics: () => collectedDiagnostics,
        syncPublicJobProjection: async () => {
          await syncPublicJobProjection({ job, artifactStore });
        },
        ...(resolvedFigmaSourceMode === "local_json" ||
        !sourceRecord.request.figmaFileKey?.trim()
          ? {}
          : {
              figmaFileKeyForDiagnostics:
                sourceRecord.request.figmaFileKey.trim(),
            }),
      };

      const orchestrator = new PipelineOrchestrator({
        toPipelineError: ({ error, fallbackStage }) =>
          toPipelineError({
            error,
            fallbackStage,
            limits: runtime.pipelineDiagnosticLimits,
          }),
        isAbortLikeError,
      });
      await orchestrator.execute({
        context,
        plan: buildRegenerationPipelinePlan(),
      });

      const terminalJob = buildCompletedTerminalJob({
        job,
        finishedAt: nowIso(),
      });
      await syncPublicJobProjection({ job: terminalJob, artifactStore });
      const generationSummary = await artifactStore.getValue<{
        generatedPaths?: string[];
      }>(STAGE_ARTIFACT_KEYS.codegenSummary);
      pushRuntimeLog({
        job: terminalJob,
        logger: runtime.logger,
        level: "info",
        message:
          `Regeneration job completed. Generated output at ${generatedProjectDir} ` +
          `(${generationSummary?.generatedPaths?.length ?? 0} artifacts).`,
      });
      await persistTerminalSnapshot({
        job: terminalJob,
        ...(collectedDiagnostics ? { diagnostics: collectedDiagnostics } : {}),
      });
      publishTerminalJob({ job, terminalJob });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        job.status = "canceled";
        job.finishedAt = nowIso();
        job.currentStage = error.stage;
        if (!job.cancellation) {
          job.cancellation = {
            requestedAt: nowIso(),
            reason: error.message,
            requestedBy: "api",
          };
        }
        job.cancellation.completedAt = nowIso();
        markQueuedStagesSkippedAfterCancellation({
          job,
          reason: error.message,
        });
        pushRuntimeLog({
          job,
          logger: runtime.logger,
          level: "warn",
          stage: error.stage,
          message: `Regeneration job canceled: ${error.message}`,
        });
        try {
          await persistTerminalSnapshot({
            job,
            ...(collectedDiagnostics
              ? { diagnostics: collectedDiagnostics }
              : {}),
          });
        } catch {
          // Ignore
        }
        return;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: job.currentStage ?? "ir.derive",
        limits: runtime.pipelineDiagnosticLimits,
      });
      const mergedDiagnostics = mergePipelineDiagnostics({
        ...(typedError.diagnostics ? { first: typedError.diagnostics } : {}),
        ...(collectedDiagnostics ? { second: collectedDiagnostics } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
      if (mergedDiagnostics) {
        collectedDiagnostics = mergedDiagnostics;
      }

      const shouldMarkPartial = await determinePartialStatus({
        stage: typedError.stage,
        artifactStore,
      });
      job.status = shouldMarkPartial ? "partial" : "failed";
      job.outcome = shouldMarkPartial ? "partial" : "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message,
        ...(typedError.retryable !== undefined
          ? { retryable: typedError.retryable }
          : {}),
        ...(typedError.retryAfterMs !== undefined
          ? { retryAfterMs: typedError.retryAfterMs }
          : {}),
        ...(typedError.fallbackMode !== undefined
          ? { fallbackMode: typedError.fallbackMode }
          : {}),
        ...(typedError.retryTargets
          ? {
              retryTargets: typedError.retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
        ...(mergedDiagnostics ? { diagnostics: mergedDiagnostics } : {}),
      };
      job.currentStage = typedError.stage;
      await syncPublicJobProjection({ job, artifactStore });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "error",
        stage: typedError.stage,
        message: `Regeneration job failed: ${typedError.code} ${typedError.message}`,
      });
      try {
        await persistTerminalSnapshot({
          job,
          ...(collectedDiagnostics
            ? { diagnostics: collectedDiagnostics }
            : {}),
        });
      } catch {
        // Ignore
      }
    } finally {
      delete job.abortController;
    }
  };

  const executeRegenerationJob = ({
    job,
    input,
  }: {
    job: JobRecord;
    input: WorkspaceRegenerationInput;
  }): void => {
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

  const runRetryJob = async (
    job: JobRecord,
    retryInput: WorkspaceRetryInput,
  ): Promise<void> => {
    const sourceRecord = jobs.get(retryInput.sourceJobId);
    if (!sourceRecord) {
      job.status = "failed";
      job.outcome = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: "E_RETRY_SOURCE_NOT_FOUND",
        stage: retryInput.retryStage,
        message: `Source job '${retryInput.sourceJobId}' not found.`,
      };
      await persistTerminalSnapshot({ job });
      return;
    }

    if (retryInput.retryStage === "figma.source") {
      await runJob(
        job,
        reconstructRetrySubmissionInput({ sourceJob: sourceRecord }),
      );
      return;
    }

    job.status = "running";
    job.startedAt = nowIso();
    const jobAbortController = new AbortController();
    job.abortController = jobAbortController;

    const sourceInput = reconstructRetrySubmissionInput({
      sourceJob: sourceRecord,
    });
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
        signal: mergedSignal,
      });
    };

    const resolvedBrandTheme = sourceRecord.request.brandTheme;
    const resolvedFormHandlingMode = sourceRecord.request.formHandlingMode;
    const resolvedGenerationLocale = sourceRecord.request.generationLocale;
    const resolvedFigmaSourceMode = sourceRecord.request.figmaSourceMode;
    const resolvedCustomerBrandId = sourceRecord.request.customerBrandId;
    const figmaFileKeyForDiagnostics =
      resolvedFigmaSourceMode === "local_json"
        ? undefined
        : sourceRecord.request.figmaFileKey?.trim();

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const figmaAnalysisFile = path.join(jobDir, "figma-analysis.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);

    job.artifacts.jobDir = jobDir;
    job.artifacts.generatedProjectDir = generatedProjectDir;
    job.artifacts.figmaJsonFile = figmaJsonFile;
    job.artifacts.designIrFile = designIrFile;
    job.artifacts.figmaAnalysisFile = figmaAnalysisFile;
    job.artifacts.stageTimingsFile = stageTimingsFile;
    if (runtime.previewEnabled) {
      job.artifacts.reproDir = reproDir;
      job.preview.url = `${resolveBaseUrl()}/workspace/repros/${job.jobId}/`;
    }

    let collectedDiagnostics: WorkspaceJobDiagnostic[] | undefined;
    const artifactStore = new StageArtifactStore({ jobDir });
    const appendDiagnostics = ({
      stage,
      diagnostics,
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
        diagnostics,
        limits: runtime.pipelineDiagnosticLimits,
      }).diagnostics;
      collectedDiagnostics = mergePipelineDiagnostics({
        ...(collectedDiagnostics ? { first: collectedDiagnostics } : {}),
        ...(normalized ? { second: normalized } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
    };

    try {
      const iconMapFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.iconMapFilePath,
        defaultPath: path.join(
          resolvedPaths.outputRoot,
          "icon-fallback-map.json",
        ),
        label: "iconMapFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const designSystemFilePath = await resolveConstrainedPipelinePath({
        configuredPath: runtime.designSystemFilePath,
        defaultPath: path.join(resolvedPaths.outputRoot, "design-system.json"),
        label: "designSystemFilePath",
        resolvedWorkspaceRoot,
        outputRoot: resolvedPaths.outputRoot,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const irCacheDir = path.join(
        resolvedPaths.outputRoot,
        "cache",
        "ir-derivation",
      );

      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      await seedRetryArtifacts({
        retryInput,
        sourceJob: sourceRecord,
        targetArtifactStore: artifactStore,
        targetGeneratedProjectDir: generatedProjectDir,
      });

      const resolvedCustomerProfile = await activateRegenerationCustomerProfile(
        {
          job,
          artifactStore,
          sourceJob: sourceRecord,
        },
      );
      const requestedStorybookStaticDir = normalizeOptionalInputString(
        sourceRecord.request.storybookStaticDir,
      );

      const context: PipelineExecutionContext = {
        mode: "retry",
        job,
        input: sourceInput,
        retryInput,
        sourceJob: sourceRecord,
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
          figmaAnalysisFile,
          stageTimingsFile,
          reproDir,
          iconMapFilePath,
          designSystemFilePath,
          irCacheDir,
          templateRoot: TEMPLATE_ROOT,
          templateCopyFilter: TEMPLATE_COPY_FILTER,
        },
        artifactStore,
        resolvedBrandTheme,
        ...(resolvedCustomerBrandId ? { resolvedCustomerBrandId } : {}),
        resolvedFigmaSourceMode,
        resolvedFormHandlingMode,
        ...(requestedStorybookStaticDir ? { requestedStorybookStaticDir } : {}),
        ...(resolvedCustomerProfile ? { resolvedCustomerProfile } : {}),
        generationLocaleResolution: { locale: resolvedGenerationLocale },
        resolvedGenerationLocale,
        appendDiagnostics,
        getCollectedDiagnostics: () => collectedDiagnostics,
        syncPublicJobProjection: async () => {
          await syncPublicJobProjection({ job, artifactStore });
        },
        ...(figmaFileKeyForDiagnostics ? { figmaFileKeyForDiagnostics } : {}),
      };

      const orchestrator = new PipelineOrchestrator({
        toPipelineError: ({ error, fallbackStage }) =>
          toPipelineError({
            error,
            fallbackStage,
            limits: runtime.pipelineDiagnosticLimits,
          }),
        isAbortLikeError,
      });
      await orchestrator.execute({
        context,
        plan: buildRetryPipelinePlan({ retryStage: retryInput.retryStage }),
      });

      const terminalJob = buildCompletedTerminalJob({
        job,
        finishedAt: nowIso(),
      });
      await syncPublicJobProjection({ job: terminalJob, artifactStore });
      const generationSummary = await artifactStore.getValue<{
        generatedPaths?: string[];
      }>(STAGE_ARTIFACT_KEYS.codegenSummary);
      pushRuntimeLog({
        job: terminalJob,
        logger: runtime.logger,
        level: "info",
        message:
          `Retry job completed. Generated output at ${generatedProjectDir} ` +
          `(${generationSummary?.generatedPaths?.length ?? 0} artifacts).`,
      });
      await persistTerminalSnapshot({
        job: terminalJob,
        ...(collectedDiagnostics ? { diagnostics: collectedDiagnostics } : {}),
      });
      publishTerminalJob({ job, terminalJob });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        job.status = "canceled";
        job.finishedAt = nowIso();
        job.currentStage = error.stage;
        if (!job.cancellation) {
          job.cancellation = {
            requestedAt: nowIso(),
            reason: error.message,
            requestedBy: "api",
          };
        }
        job.cancellation.completedAt = nowIso();
        markQueuedStagesSkippedAfterCancellation({
          job,
          reason: error.message,
        });
        try {
          await persistTerminalSnapshot({
            job,
            ...(collectedDiagnostics
              ? { diagnostics: collectedDiagnostics }
              : {}),
          });
        } catch {
          // Ignore
        }
        return;
      }

      const typedError = toPipelineError({
        error,
        fallbackStage: retryInput.retryStage,
        limits: runtime.pipelineDiagnosticLimits,
      });
      const mergedDiagnostics = mergePipelineDiagnostics({
        ...(typedError.diagnostics ? { first: typedError.diagnostics } : {}),
        ...(collectedDiagnostics ? { second: collectedDiagnostics } : {}),
        max: runtime.pipelineDiagnosticLimits.maxDiagnostics,
      });
      if (mergedDiagnostics) {
        collectedDiagnostics = mergedDiagnostics;
      }
      const shouldMarkPartial = await determinePartialStatus({
        stage: typedError.stage,
        artifactStore,
      });
      job.status = shouldMarkPartial ? "partial" : "failed";
      job.outcome = shouldMarkPartial ? "partial" : "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message,
        ...(typedError.retryable !== undefined
          ? { retryable: typedError.retryable }
          : {}),
        ...(typedError.retryAfterMs !== undefined
          ? { retryAfterMs: typedError.retryAfterMs }
          : {}),
        ...(typedError.fallbackMode !== undefined
          ? { fallbackMode: typedError.fallbackMode }
          : {}),
        ...(typedError.retryTargets
          ? {
              retryTargets: typedError.retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
        ...(mergedDiagnostics ? { diagnostics: mergedDiagnostics } : {}),
      };
      job.currentStage = typedError.stage;
      await syncPublicJobProjection({ job, artifactStore });
      await persistTerminalSnapshot({
        job,
        ...(collectedDiagnostics ? { diagnostics: collectedDiagnostics } : {}),
      });
    } finally {
      delete job.abortController;
    }
  };

  const executeRetryJob = ({
    job,
    input,
  }: {
    job: JobRecord;
    input: WorkspaceRetryInput;
  }): void => {
    if (runningJobIds.has(job.jobId)) {
      return;
    }
    runningJobIds.add(job.jobId);
    refreshQueueSnapshots();
    queueMicrotask(() => {
      void runRetryJob(job, input).finally(() => {
        runningJobIds.delete(job.jobId);
        refreshQueueSnapshots();
        drainQueuedJobs();
        refreshQueueSnapshots();
      });
    });
  };

  const drainQueuedJobs = (): void => {
    while (
      runningJobIds.size < runtime.maxConcurrentJobs &&
      queuedJobIds.length > 0
    ) {
      const nextJobId = queuedJobIds.shift();
      if (!nextJobId) {
        break;
      }

      const nextJob = jobs.get(nextJobId);
      const nextInput = queuedJobInputs.get(nextJobId);
      const nextRegenInput = queuedRegenInputs.get(nextJobId);
      const nextRetryInput = queuedRetryInputs.get(nextJobId);

      if (!nextJob || nextJob.status !== "queued") {
        queuedJobInputs.delete(nextJobId);
        queuedRegenInputs.delete(nextJobId);
        queuedRetryInputs.delete(nextJobId);
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

      if (nextRetryInput) {
        queuedRetryInputs.delete(nextJobId);
        executeRetryJob({ job: nextJob, input: nextRetryInput });
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
      const err = new Error(
        `Source job '${input.sourceJobId}' has status '${sourceJob.status}' — only completed jobs can be used as regeneration source.`,
      );
      (err as Error & { code: string }).code = "E_REGEN_SOURCE_NOT_COMPLETED";
      throw err;
    }

    if (
      runningJobIds.size >= runtime.maxConcurrentJobs &&
      queuedJobIds.length >= runtime.maxQueuedJobs
    ) {
      throw new JobQueueBackpressureError({
        queue: toQueueSnapshot(),
      });
    }

    const jobId = randomUUID();
    const customerBrandId = normalizeOptionalInputString(input.customerBrandId);
    const componentMappings = input.componentMappings
      ? normalizeComponentMappingRules({
          rules: input.componentMappings,
        })
      : undefined;
    const job: JobRecord = {
      jobId,
      status: "queued",
      submittedAt: nowIso(),
      request: {
        ...sourceJob.request,
        enableGitPr: false,
        ...(customerBrandId ? { customerBrandId } : {}),
        ...(componentMappings ? { componentMappings } : {}),
      },
      stages: createInitialStages(),
      logs: [],
      artifacts: {
        outputRoot: resolvedPaths.outputRoot,
        jobDir: path.join(resolvedPaths.jobsRoot, jobId),
      },
      preview: {
        enabled: runtime.previewEnabled,
      },
      queue: toQueueSnapshot({ jobId }),
      lineage: {
        sourceJobId: input.sourceJobId,
        kind: "regeneration",
        overrideCount: input.overrides.length,
        ...(input.draftId ? { draftId: input.draftId } : {}),
        ...(input.baseFingerprint
          ? { baseFingerprint: input.baseFingerprint }
          : {}),
      },
    };

    jobs.set(jobId, job);
    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      message: `Regeneration job accepted (source=${input.sourceJobId}, overrides=${input.overrides.length}).`,
    });

    if (runningJobIds.size < runtime.maxConcurrentJobs) {
      executeRegenerationJob({ job, input });
    } else {
      queuedJobIds.push(jobId);
      queuedRegenInputs.set(jobId, { ...input });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "info",
        message: `Regeneration job queued with position ${queuedJobIds.length}.`,
      });
      refreshQueueSnapshots();
    }

    return {
      jobId,
      sourceJobId: input.sourceJobId,
      status: "queued" as const,
      acceptedModes: toAcceptedModes({
        figmaSourceMode: sourceJob.request.figmaSourceMode,
      }),
    };
  };

  const submitRetry = (input: WorkspaceRetryInput) => {
    const sourceJob = jobs.get(input.sourceJobId);
    if (!sourceJob) {
      const err = new Error(`Source job '${input.sourceJobId}' not found.`);
      (err as Error & { code: string }).code = "E_RETRY_SOURCE_NOT_FOUND";
      throw err;
    }
    if (sourceJob.status !== "failed" && sourceJob.status !== "partial") {
      const err = new Error(
        `Source job '${input.sourceJobId}' has status '${sourceJob.status}' — only failed or partial jobs can be retried.`,
      );
      (err as Error & { code: string }).code = "E_RETRY_SOURCE_NOT_FAILED";
      throw err;
    }
    if (!isWorkspaceJobRetryStage(input.retryStage)) {
      const err = new Error(
        `Retry stage '${String(input.retryStage)}' is not supported.`,
      );
      (err as Error & { code: string }).code = "E_RETRY_STAGE_INVALID";
      throw err;
    }
    if (
      input.retryTargets !== undefined &&
      input.retryStage !== "codegen.generate"
    ) {
      const err = new Error(
        "retryTargets are only supported when retryStage=codegen.generate.",
      );
      (err as Error & { code: string }).code = "E_RETRY_TARGETS_INVALID";
      throw err;
    }
    if (
      runningJobIds.size >= runtime.maxConcurrentJobs &&
      queuedJobIds.length >= runtime.maxQueuedJobs
    ) {
      throw new JobQueueBackpressureError({
        queue: toQueueSnapshot(),
      });
    }

    const jobId = randomUUID();
    const retryTargets =
      input.retryTargets?.map((entry) => entry.trim()).filter(Boolean) ?? [];
    const job = createQueuedJobRecord({
      jobId,
      request: {
        ...sourceJob.request,
      },
      lineage: {
        sourceJobId: input.sourceJobId,
        kind: "retry",
        overrideCount: 0,
        retryStage: input.retryStage,
        ...(retryTargets.length > 0 ? { retryTargets } : {}),
      },
    });

    jobs.set(jobId, job);
    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "info",
      message:
        `Retry job accepted (source=${input.sourceJobId}, stage=${input.retryStage}` +
        `${retryTargets.length > 0 ? `, targets=${retryTargets.length}` : ""}).`,
    });

    if (runningJobIds.size < runtime.maxConcurrentJobs) {
      executeRetryJob({
        job,
        input: {
          sourceJobId: input.sourceJobId,
          retryStage: input.retryStage,
          ...(retryTargets.length > 0 ? { retryTargets } : {}),
        },
      });
    } else {
      queuedJobIds.push(jobId);
      queuedRetryInputs.set(jobId, {
        sourceJobId: input.sourceJobId,
        retryStage: input.retryStage,
        ...(retryTargets.length > 0 ? { retryTargets } : {}),
      });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "info",
        message: `Retry job queued with position ${queuedJobIds.length}.`,
      });
      refreshQueueSnapshots();
    }

    return {
      jobId,
      sourceJobId: input.sourceJobId,
      retryStage: input.retryStage,
      status: "queued" as const,
      acceptedModes: toAcceptedModes({
        figmaSourceMode: sourceJob.request.figmaSourceMode,
      }),
    };
  };

  const previewLocalSync: JobEngine["previewLocalSync"] = async ({
    jobId,
    targetPath,
  }): Promise<WorkspaceLocalSyncDryRunResult> => {
    pruneExpiredSyncConfirmations();
    const syncContext = resolveSyncContext({ jobId });
    const plan = await planLocalSync({
      generatedProjectDir: syncContext.generatedProjectDir,
      workspaceRoot: resolvedWorkspaceRoot,
      outputRoot: resolvedPaths.outputRoot,
      targetPath: targetPath ?? syncContext.job.request.targetPath,
      boardKey: syncContext.boardKey,
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
      planFingerprint,
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
        message: entry.message,
      })),
      summary: { ...plan.summary },
      confirmationToken: token,
      confirmationExpiresAt: new Date(expiresAtMs).toISOString(),
    };
  };

  const applyLocalSync: JobEngine["applyLocalSync"] = async ({
    jobId,
    confirmationToken,
    confirmOverwrite,
    fileDecisions,
    reviewerNote,
  }): Promise<WorkspaceLocalSyncApplyResult> => {
    const normalizedReviewerNote = normalizeReviewerNote(reviewerNote);
    pruneExpiredSyncConfirmations();
    const syncContext = resolveSyncContext({ jobId });

    if (!confirmOverwrite) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_REQUIRED",
        message: "Local sync apply requires explicit overwrite confirmation.",
      });
    }

    const confirmation = localSyncConfirmations.get(confirmationToken);
    if (!confirmation) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_INVALID",
        message: "Invalid or unknown local sync confirmation token.",
      });
    }
    if (confirmation.expiresAtMs <= Date.now()) {
      localSyncConfirmations.delete(confirmationToken);
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_EXPIRED",
        message:
          "Local sync confirmation token expired. Request a new dry-run preview.",
      });
    }
    if (confirmation.jobId !== jobId) {
      throw createSyncError({
        code: "E_SYNC_CONFIRMATION_INVALID",
        message:
          "Local sync confirmation token does not match the selected job.",
      });
    }

    const syncGovernance = await resolveImportGovernanceContext({
      job: syncContext.job,
    });
    if (syncGovernance.importSession) {
      await assertImportSessionApprovedForMutation({
        session: syncGovernance.importSession,
        code: "E_SYNC_IMPORT_REVIEW_REQUIRED",
        operation: "applying local sync",
      });
    }

    const currentPlan = await planLocalSync({
      generatedProjectDir: syncContext.generatedProjectDir,
      workspaceRoot: resolvedWorkspaceRoot,
      outputRoot: resolvedPaths.outputRoot,
      targetPath: confirmation.plan.targetPath,
      boardKey: syncContext.boardKey,
    });
    const currentFingerprint = computeLocalSyncPlanFingerprint({
      plan: currentPlan,
    });
    if (currentFingerprint !== confirmation.planFingerprint) {
      localSyncConfirmations.delete(confirmationToken);
      throw createSyncError({
        code: "E_SYNC_PREVIEW_STALE",
        message:
          "Local sync preview is stale. Request a new dry-run preview before applying.",
      });
    }

    const appliedPlan = await applyLocalSyncPlan({
      plan: currentPlan,
      fileDecisions,
      jobId,
      sourceJobId: syncContext.sourceJobId,
    });
    localSyncConfirmations.delete(confirmationToken);
    if (syncGovernance.importSession) {
      await appendImportSessionEvent({
        event: {
          id: "",
          sessionId: syncGovernance.importSession.id,
          kind: "applied",
          at: "",
          ...(normalizedReviewerNote !== undefined
            ? { note: normalizedReviewerNote }
            : {}),
          metadata: {
            jobId,
            sourceJobId: syncContext.sourceJobId,
            selectedFiles: appliedPlan.summary.selectedFiles,
            targetPath: appliedPlan.targetPath,
            scopePath: appliedPlan.scopePath,
          },
        },
      });
    }

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
        message: entry.message,
      })),
      summary: { ...appliedPlan.summary },
      appliedAt: nowIso(),
    };
  };

  const cancelJob = ({
    jobId,
    reason,
  }: {
    jobId: string;
    reason?: string;
  }): WorkspaceJobStatus | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    if (
      job.status === "completed" ||
      job.status === "partial" ||
      job.status === "failed" ||
      job.status === "canceled"
    ) {
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
        requestedBy: "api",
      };
    }

    if (job.status === "queued") {
      const queuedIndex = queuedJobIds.indexOf(jobId);
      if (queuedIndex >= 0) {
        queuedJobIds.splice(queuedIndex, 1);
      }
      queuedJobInputs.delete(jobId);
      queuedRegenInputs.delete(jobId);
      queuedRetryInputs.delete(jobId);
      job.status = "canceled";
      job.finishedAt = nowIso();
      job.cancellation.completedAt = nowIso();
      delete job.currentStage;
      markQueuedStagesSkippedAfterCancellation({
        job,
        reason: cancellationReason,
      });
      pushRuntimeLog({
        job,
        logger: runtime.logger,
        level: "warn",
        message: `Job canceled while queued: ${cancellationReason}`,
      });
      refreshQueueSnapshots();
      persistTerminalSnapshotSync({ job });
      return toPublicJob(job);
    }

    pushRuntimeLog({
      job,
      logger: runtime.logger,
      level: "warn",
      ...(job.currentStage ? { stage: job.currentStage } : {}),
      message: `Cancellation requested: ${cancellationReason}`,
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
      ...(job.outcome ? { outcome: job.outcome } : {}),
      summary: toJobSummary(job),
      artifacts: { ...job.artifacts },
      preview: { ...job.preview },
    };
    if (job.pasteDeltaSummary) {
      result.pasteDeltaSummary = { ...job.pasteDeltaSummary };
    }
    if (job.lineage) {
      result.lineage = { ...job.lineage };
    }
    if (job.cancellation) {
      result.cancellation = { ...job.cancellation };
    }
    if (job.generationDiff) {
      result.generationDiff = { ...job.generationDiff };
    }
    if (job.visualAudit) {
      result.visualAudit = {
        ...job.visualAudit,
        ...(job.visualAudit.regions
          ? {
              regions: job.visualAudit.regions.map((region) => ({ ...region })),
            }
          : {}),
      };
    }
    if (job.visualQuality) {
      result.visualQuality = { ...job.visualQuality };
    }
    if (job.gitPr) {
      result.gitPr = { ...job.gitPr };
    }
    if (job.inspector) {
      result.inspector = {
        ...job.inspector,
        ...(job.inspector.retryableStages
          ? { retryableStages: [...job.inspector.retryableStages] }
          : {}),
        ...(job.inspector.retryTargets
          ? {
              retryTargets: job.inspector.retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
        stages: job.inspector.stages.map((stage) => ({
          ...stage,
          ...(stage.retryTargets
            ? {
                retryTargets: stage.retryTargets.map((target) => ({
                  ...target,
                })),
              }
            : {}),
        })),
      };
    }
    if (job.error) {
      result.error = {
        ...job.error,
        ...(job.error.retryTargets
          ? {
              retryTargets: job.error.retryTargets.map((target) => ({
                ...target,
              })),
            }
          : {}),
      };
    }

    return result;
  };

  const resolvePreviewAsset = async (
    jobId: string,
    previewPath: string,
  ): Promise<{ content: Buffer; contentType: string } | undefined> => {
    const safeJobId = toFileSystemSafe(jobId);
    if (safeJobId !== jobId) {
      return undefined;
    }

    const normalizedPart = normalizePathPart(previewPath || "index.html");
    if (normalizedPart === undefined) {
      return undefined;
    }
    const fallbackPath =
      normalizedPart.length > 0 ? normalizedPart : "index.html";
    const previewRoot = path.resolve(resolvedPaths.reprosRoot, safeJobId);
    const candidatePath = path.resolve(previewRoot, fallbackPath);

    if (!isWithinRoot({ candidatePath, rootPath: previewRoot })) {
      return undefined;
    }
    // This symlink walk fails closed for known path-segment links, but an ancestor can
    // still change before the file is opened. The final-component O_NOFOLLOW read below
    // narrows that race where Node exposes the flag; unsupported platforms retain this limitation.
    if (await hasSymlinkInPath({ candidatePath, rootPath: previewRoot })) {
      return undefined;
    }

    try {
      const content = await readFileWithFinalComponentNoFollow(candidatePath);
      return {
        content,
        contentType: getContentType(candidatePath),
      };
    } catch {
      if (fallbackPath !== "index.html") {
        const indexPath = path.resolve(previewRoot, "index.html");
        if (
          await hasSymlinkInPath({
            candidatePath: indexPath,
            rootPath: previewRoot,
          })
        ) {
          return undefined;
        }
        try {
          const content = await readFileWithFinalComponentNoFollow(indexPath);
          return {
            content,
            contentType: "text/html; charset=utf-8",
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
      artifacts: { ...job.artifacts },
    };
  };

  const createPrFromJob: JobEngine["createPrFromJob"] = async ({
    jobId,
    prInput,
  }) => {
    const job = jobs.get(jobId);
    if (!job) {
      const err = new Error(`Job '${jobId}' not found.`);
      (err as Error & { code: string }).code = "E_PR_JOB_NOT_FOUND";
      throw err;
    }
    if (job.status !== "completed") {
      const err = new Error(
        `Job '${jobId}' has status '${job.status}' — only completed jobs support PR creation.`,
      );
      (err as Error & { code: string }).code = "E_PR_JOB_NOT_COMPLETED";
      throw err;
    }
    if (!job.lineage) {
      const err = new Error(
        `Job '${jobId}' is not a regeneration job — PR creation is only supported for regenerated output.`,
      );
      (err as Error & { code: string }).code = "E_PR_NOT_REGENERATION_JOB";
      throw err;
    }

    const artifactStore = new StageArtifactStore({
      jobDir: job.artifacts.jobDir,
    });
    const generatedProjectDir = await artifactStore.getPath(
      STAGE_ARTIFACT_KEYS.generatedProject,
    );
    if (!generatedProjectDir) {
      const err = new Error(
        `Job '${jobId}' has no generated project directory.`,
      );
      (err as Error & { code: string }).code = "E_PR_NO_GENERATED_PROJECT";
      throw err;
    }
    const generationDiff = await artifactStore.getValue(
      STAGE_ARTIFACT_KEYS.generationDiff,
    );
    if (!generationDiff) {
      const err = new Error(
        `Job '${jobId}' is missing final generation diff provenance.`,
      );
      (err as Error & { code: string }).code = "E_PR_GENERATION_DIFF_MISSING";
      throw err;
    }
    if (!job.generationDiff) {
      job.generationDiff = generationDiff as NonNullable<
        JobRecord["generationDiff"]
      >;
    }

    const input: WorkspaceJobInput = {
      ...job.request,
      repoUrl: prInput.repoUrl,
      repoToken: prInput.repoToken,
      enableGitPr: true,
      ...(prInput.targetPath !== undefined
        ? { targetPath: prInput.targetPath }
        : {}),
    };

    const prGovernance = await resolveImportGovernanceContext({ job });
    if (prGovernance.importSession) {
      await assertImportSessionApprovedForMutation({
        session: prGovernance.importSession,
        code: "E_PR_IMPORT_REVIEW_REQUIRED",
        operation: "creating a PR",
      });
    }

    job.gitPr = await executePersistedGitPr({
      artifactStore,
      input,
      jobDir: job.artifacts.jobDir,
      jobId,
      ...(prGovernance.importSession
        ? { importSessionId: prGovernance.importSession.id }
        : {}),
      commandTimeoutMs: runtime.commandTimeoutMs,
      commandStdoutMaxBytes: runtime.commandStdoutMaxBytes,
      commandStderrMaxBytes: runtime.commandStderrMaxBytes,
      onLog: (message) => {
        pushRuntimeLog({
          job,
          logger: runtime.logger,
          level: "info",
          stage: "git.pr",
          message,
        });
      },
    });

    if (prGovernance.importSession) {
      const normalizedPrReviewerNote = normalizeReviewerNote(prInput.reviewerNote);
      await appendImportSessionEvent({
        event: {
          id: "",
          sessionId: prGovernance.importSession.id,
          kind: "note",
          at: "",
          note:
            `${job.gitPr.prUrl ? "PR created from regeneration job." : "Branch pushed from regeneration job."}${
              normalizedPrReviewerNote !== undefined
                ? ` Reviewer note: ${normalizedPrReviewerNote}`
                : ""
            }`,
          metadata: {
            jobId,
            sourceJobId: job.lineage.sourceJobId,
            branchName: job.gitPr.branchName ?? null,
            prUrl: job.gitPr.prUrl ?? null,
          },
        },
      });
    }

    updateStage({
      job,
      stage: "git.pr",
      status: "completed",
      message: toGitPrStageMessage({ gitPrStatus: job.gitPr }),
    });
    await persistTerminalSnapshot({ job });

    return {
      jobId,
      sourceJobId: job.lineage.sourceJobId,
      gitPr: job.gitPr,
    };
  };

  const findLatestCompletedJobForBoardKey = (
    boardKey: string,
    excludeJobId: string,
  ): JobRecord | undefined => {
    let latest: JobRecord | undefined;
    for (const job of jobs.values()) {
      if (job.status !== "completed") {
        continue;
      }
      if (job.jobId === excludeJobId) {
        continue;
      }
      const seed =
        job.request.figmaFileKey?.trim() ||
        job.request.figmaJsonPath?.trim() ||
        "";
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
      if (
        !latest ||
        (job.finishedAt &&
          (!latest.finishedAt || job.finishedAt > latest.finishedAt))
      ) {
        latest = job;
      }
    }
    return latest;
  };

  const checkStaleDraft: JobEngine["checkStaleDraft"] = async ({
    jobId,
    draftNodeIds,
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
        message: `Job '${jobId}' not found.`,
      };
    }

    const boardKeySeed =
      job.request.figmaFileKey?.trim() ||
      job.request.figmaJsonPath?.trim() ||
      "";
    if (!boardKeySeed) {
      return {
        stale: false,
        latestJobId: null,
        sourceJobId: jobId,
        boardKey: null,
        carryForwardAvailable: false,
        unmappedNodeIds: [],
        message: "Cannot determine board key for this job.",
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
        message: "Cannot resolve board key for this job.",
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
        message: "Draft is up-to-date — no newer job exists for this board.",
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
        message: "Draft is up-to-date — no newer job exists for this board.",
      };
    }

    // Draft is stale. Validate carry-forward feasibility using the latest job's design IR.
    let unmappedNodeIds: string[] = [];
    let carryForwardAvailable = false;

    if (draftNodeIds.length > 0 && latestJob.artifacts.designIrFile) {
      try {
        const irContent = await readFile(
          latestJob.artifacts.designIrFile,
          "utf8",
        );
        const irData = JSON.parse(irContent) as {
          screens?: Array<{ children?: Array<{ id: string }> }>;
        };
        const allNodeIds = new Set<string>();
        if (Array.isArray(irData.screens)) {
          for (const screen of irData.screens) {
            collectNodeIds(screen, allNodeIds);
          }
        }
        unmappedNodeIds = draftNodeIds.filter(
          (nodeId) => !allNodeIds.has(nodeId),
        );
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
          : `A newer job '${latestJob.jobId}' exists for this board.`,
    };
  };

  const suggestRemaps: JobEngine["suggestRemaps"] = async ({
    sourceJobId,
    latestJobId,
    unmappedNodeIds,
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
          reason: `Source job '${sourceJobId}' not found.`,
        })),
        message: `Source job '${sourceJobId}' not found.`,
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
          reason: `Latest job '${latestJobId}' not found.`,
        })),
        message: `Latest job '${latestJobId}' not found.`,
      };
    }

    if (
      !sourceJob.artifacts.designIrFile ||
      !latestJob.artifacts.designIrFile
    ) {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: unmappedNodeIds.map((id) => ({
          sourceNodeId: id,
          sourceNodeName: "(unknown)",
          sourceNodeType: "(unknown)",
          reason: "Design IR not available for one or both jobs.",
        })),
        message:
          "Design IR artifacts are missing — cannot generate remap suggestions.",
      };
    }

    let sourceIrContent: string;
    let latestIrContent: string;
    try {
      sourceIrContent = await readFile(
        sourceJob.artifacts.designIrFile,
        "utf8",
      );
      latestIrContent = await readFile(
        latestJob.artifacts.designIrFile,
        "utf8",
      );
    } catch {
      return {
        sourceJobId,
        latestJobId,
        suggestions: [],
        rejections: [],
        message: "Could not read Design IR files for remap analysis.",
      };
    }

    const sourceIr = JSON.parse(sourceIrContent) as DesignIR;
    const latestIr = JSON.parse(latestIrContent) as DesignIR;

    return generateRemapSuggestions({
      sourceIr,
      latestIr,
      unmappedNodeIds,
      sourceJobId,
      latestJobId,
    });
  };

  const listImportSessions: JobEngine["listImportSessions"] = async () => {
    return await importSessionStore.list();
  };

  const reimportImportSession: JobEngine["reimportImportSession"] = async ({
    sessionId,
  }): Promise<WorkspaceImportSessionReimportAccepted> => {
    const sessions = await importSessionStore.list();
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      const error = new Error(`Import session '${sessionId}' not found.`);
      (error as Error & { code: string }).code = "E_IMPORT_SESSION_NOT_FOUND";
      throw error;
    }
    if (!session.replayable) {
      const error = new Error(
        session.replayDisabledReason ??
          `Import session '${sessionId}' is not replayable.`,
      );
      (error as Error & { code: string }).code =
        "E_IMPORT_SESSION_NOT_REPLAYABLE";
      throw error;
    }
    if (session.fileKey.trim().length === 0) {
      const error = new Error(
        `Import session '${sessionId}' is missing a Figma file key.`,
      );
      (error as Error & { code: string }).code =
        "E_IMPORT_SESSION_INVALID_LOCATOR";
      throw error;
    }

    const figmaAccessToken = process.env.FIGMA_ACCESS_TOKEN?.trim();
    if (!figmaAccessToken) {
      const error = new Error(
        "Re-import requires FIGMA_ACCESS_TOKEN in the workspace-dev environment.",
      );
      (error as Error & { code: string }).code =
        "E_IMPORT_SESSION_MISSING_FIGMA_ACCESS_TOKEN";
      throw error;
    }

    const accepted = submitJob({
      figmaSourceMode: "hybrid",
      requestSourceMode: "figma_url",
      figmaFileKey: session.fileKey,
      ...(session.nodeId.length > 0 ? { figmaNodeId: session.nodeId } : {}),
      figmaAccessToken,
      enableGitPr: false,
    });

    return {
      ...accepted,
      sessionId,
      sourceJobId: session.jobId,
    };
  };

  const deleteImportSession: JobEngine["deleteImportSession"] = async ({
    sessionId,
  }): Promise<WorkspaceImportSessionDeleteResult> => {
    const removed = await importSessionStore.delete(sessionId);
    if (!removed) {
      const error = new Error(`Import session '${sessionId}' not found.`);
      (error as Error & { code: string }).code = "E_IMPORT_SESSION_NOT_FOUND";
      throw error;
    }

    const linkedJob = jobs.get(removed.jobId);
    if (linkedJob) {
      jobs.delete(removed.jobId);
      runningJobIds.delete(removed.jobId);
      queuedJobInputs.delete(removed.jobId);
      queuedRegenInputs.delete(removed.jobId);
      queuedRetryInputs.delete(removed.jobId);
      const queueIndex = queuedJobIds.indexOf(removed.jobId);
      if (queueIndex >= 0) {
        queuedJobIds.splice(queueIndex, 1);
      }
      refreshQueueSnapshots();
    }

    const jobDir =
      linkedJob?.artifacts.jobDir ??
      path.join(resolvedPaths.jobsRoot, removed.jobId);
    await rm(jobDir, { recursive: true, force: true });

    await importSessionEventStore.deleteAllForSession(sessionId);

    return {
      sessionId,
      deleted: true,
      jobId: removed.jobId,
    };
  };

  const listImportSessionEvents: JobEngine["listImportSessionEvents"] = async ({
    sessionId,
  }): Promise<WorkspaceImportSessionEvent[]> => {
    return await importSessionEventStore.list(sessionId);
  };

  const approveImportSession: JobEngine["approveImportSession"] = async ({
    sessionId,
  }): Promise<WorkspaceImportSessionEvent> => {
    const sessions = await importSessionStore.list();
    const session = sessions.find((entry) => entry.id === sessionId);
    if (!session) {
      const error = new Error(`Import session '${sessionId}' not found.`);
      (error as Error & { code: string }).code = "E_IMPORT_SESSION_NOT_FOUND";
      throw error;
    }

    const governance = await resolveImportSessionGovernanceState({
      session,
      invalidHistoryCode: "E_IMPORT_SESSION_INVALID_TRANSITION",
      operation: "approving the import session",
    });
    if (governance.status === "approved" || governance.status === "applied") {
      return (
        governance.authorizingEvent ?? {
          id: randomUUID(),
          sessionId,
          kind: "approved",
          at: nowIso(),
        }
      );
    }

    if (session.reviewRequired === true && governance.status === "imported") {
      await appendImportSessionEvent({
        event: {
          id: "",
          sessionId,
          kind: "review_started",
          at: "",
        },
      });
    }

    return await appendImportSessionEvent({
      event: {
        id: "",
        sessionId,
        kind: "approved",
        at: "",
      },
    });
  };

  const appendImportSessionEvent: JobEngine["appendImportSessionEvent"] =
    async ({ event }): Promise<WorkspaceImportSessionEvent> => {
      const sessions = await importSessionStore.list();
      const session = sessions.find((entry) => entry.id === event.sessionId);
      if (!session) {
        const error = new Error(
          `Import session '${event.sessionId}' not found.`,
        );
        (error as Error & { code: string }).code = "E_IMPORT_SESSION_NOT_FOUND";
        throw error;
      }
      const currentStatus = await assertImportSessionTransitionAllowed({
        session,
        event,
      });
      const finalized: WorkspaceImportSessionEvent = {
        ...event,
        id: event.id.length > 0 ? event.id : randomUUID(),
        at: nowIso(),
      };
      await importSessionEventStore.append(finalized);
      const qualityScore = extractEventQualityScore(finalized);
      const nextStatus = deriveSessionStatusFromEvent({
        event: finalized,
        currentStatus,
      });
      await importSessionStore.save({
        ...session,
        ...(finalized.actor ? { userId: finalized.actor } : {}),
        ...(qualityScore !== undefined ? { qualityScore } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      });
      return finalized;
    };

  return {
    submitJob,
    submitRegeneration,
    submitRetry,
    createPrFromJob,
    previewLocalSync,
    applyLocalSync,
    cancelJob,
    getJob,
    getJobResult,
    getJobRecord,
    resolvePreviewAsset,
    checkStaleDraft,
    suggestRemaps,
    listImportSessions,
    reimportImportSession,
    deleteImportSession,
    listImportSessionEvents,
    approveImportSession,
    appendImportSessionEvent,
  };
};

export { resolveRuntimeSettings };
export type {
  JobEngine,
  JobEngineRuntime,
  JobRecordSnapshot,
  SubmissionJobInput,
} from "./job-engine/types.js";
