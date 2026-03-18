import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WorkspaceBrandTheme,
  WorkspaceFigmaSourceMode,
  WorkspaceJobInput,
  WorkspaceJobResult,
  WorkspaceJobStageName,
  WorkspaceJobStatus
} from "./contracts/index.js";
import {
  FigmaJsonByteLimitError,
  MAX_FIGMA_JSON_BYTES,
  readJsonFileWithByteLimit,
  safeParseFigmaPayload,
  summarizeFigmaPayloadValidationError
} from "./figma-payload-validation.js";
import { createPipelineError, getErrorMessage } from "./job-engine/errors.js";
import { cleanFigmaForCodegen } from "./job-engine/figma-clean.js";
import { exportImageAssetsFromFigma } from "./job-engine/image-export.js";
import { fetchFigmaFile } from "./job-engine/figma-source.js";
import { copyDir, pathExists, resolveAbsoluteOutputRoot } from "./job-engine/fs-helpers.js";
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
import { generateArtifacts } from "./parity/generator-core.js";
import { figmaToDesignIrWithOptions } from "./parity/ir.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app");
const TEMPLATE_COPY_FILTER = createTemplateCopyFilter({ templateRoot: TEMPLATE_ROOT });

const isPipelineError = (error: unknown): error is WorkspacePipelineError => {
  return error instanceof Error && "stage" in error && "code" in error;
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

export const createJobEngine = ({ resolveBaseUrl, paths, runtime }: CreateJobEngineInput): JobEngine => {
  const resolvedPaths = resolveAbsoluteOutputRoot({ outputRoot: paths.outputRoot });
  const jobs = new Map<string, JobRecord>();
  const queuedJobIds: string[] = [];
  const queuedJobInputs = new Map<string, WorkspaceJobInput>();
  const runningJobIds = new Set<string>();

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

      const typedError = isPipelineError(error)
        ? error
        : createPipelineError({
            code: "E_PIPELINE_UNKNOWN",
            stage,
            message: getErrorMessage(error),
            cause: error
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
    const generationLocaleResolution = resolveJobGenerationLocale({
      submitGenerationLocale: input.generationLocale,
      runtimeGenerationLocale: runtime.generationLocale
    });
    const resolvedGenerationLocale = generationLocaleResolution.locale;

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

    try {
      await mkdir(jobDir, { recursive: true });
      await mkdir(resolvedPaths.jobsRoot, { recursive: true });
      await mkdir(resolvedPaths.reprosRoot, { recursive: true });

      const persistStageTimings = async (): Promise<void> => {
        await writeFile(
          stageTimingsFile,
          `${JSON.stringify(
            {
              jobId: job.jobId,
              status: job.status,
              generatedAt: nowIso(),
              stages: job.stages
            },
            null,
            2
          )}\n`,
          "utf8"
        );
      };

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
            let parsedLocalFile: unknown;
            try {
              parsedLocalFile = await readJsonFileWithByteLimit({
                filePath: resolvedLocalPath,
                maxBytes: MAX_FIGMA_JSON_BYTES,
                sourceLabel: `local Figma JSON '${localPath}'`
              });
            } catch (error) {
              if (error instanceof FigmaJsonByteLimitError) {
                throw createPipelineError({
                  code: "E_FIGMA_PARSE",
                  stage: "figma.source",
                  message: `Could not parse local Figma JSON file '${localPath}': ${error.message}`,
                  cause: error
                });
              }

              if (error instanceof SyntaxError) {
                throw createPipelineError({
                  code: "E_FIGMA_PARSE",
                  stage: "figma.source",
                  message: `Could not parse local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
                  cause: error
                });
              }

              throw createPipelineError({
                code: "E_FIGMA_LOCAL_JSON_READ",
                stage: "figma.source",
                message: `Could not read local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
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

      const ir = await runStage({
        job,
        stage: "ir.derive",
        action: async () => {
          if (figmaFetch.cleaning.report.screenCandidateCount <= 0) {
            throw createPipelineError({
              code: "E_FIGMA_CLEAN_EMPTY",
              stage: "ir.derive",
              message: "Figma cleaning removed all screen candidates."
            });
          }
          const derived = figmaToDesignIrWithOptions(figmaFetch.file, {
            screenElementBudget: runtime.figmaScreenElementBudget,
            screenElementMaxDepth: runtime.figmaScreenElementMaxDepth,
            brandTheme: resolvedBrandTheme,
            sourceMetrics: {
              fetchedNodes: figmaFetch.diagnostics.fetchedNodes,
              degradedGeometryNodes: figmaFetch.diagnostics.degradedGeometryNodes
            }
          });
          if (!Array.isArray(derived.screens) || derived.screens.length === 0) {
            throw createPipelineError({
              code: "E_IR_EMPTY",
              stage: "ir.derive",
              message: "No screen found in IR"
            });
          }
          await writeFile(designIrFile, `${JSON.stringify(derived, null, 2)}\n`, "utf8");
          const depthTruncatedScreens = derived.metrics?.depthTruncatedScreens ?? [];
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
          }
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

          return await generateArtifacts({
            projectDir: generatedProjectDir,
            ir,
            iconMapFilePath,
            designSystemFilePath,
            imageAssetMap,
            generationLocale: resolvedGenerationLocale,
            routerMode: runtime.routerMode,
            llmModelName: "deterministic",
            llmCodegenMode: "deterministic",
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "codegen.generate",
                message
              });
            }
          });
        }
      });

      if (generationSummary.generatedPaths.includes("generation-metrics.json")) {
        job.artifacts.generationMetricsFile = path.join(generatedProjectDir, "generation-metrics.json");
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
          await writeFile(
            stageTimingsFile,
            `${JSON.stringify(
              {
                jobId: job.jobId,
                status: job.status,
                generatedAt: nowIso(),
                stages: job.stages,
                cancellation: job.cancellation
              },
              null,
              2
            )}\n`,
            "utf8"
          );
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

      const typedError = isPipelineError(error)
        ? error
        : createPipelineError({
            code: "E_PIPELINE_UNKNOWN",
            stage: job.currentStage ?? "figma.source",
            message: getErrorMessage(error),
            cause: error
          });

      job.status = "failed";
      job.finishedAt = nowIso();
      job.error = {
        code: typedError.code,
        stage: typedError.stage,
        message: typedError.message
      };
      job.currentStage = typedError.stage;
      try {
        await writeFile(
          stageTimingsFile,
          `${JSON.stringify(
            {
              jobId: job.jobId,
              status: job.status,
              generatedAt: nowIso(),
              stages: job.stages,
              error: job.error
            },
            null,
            2
          )}\n`,
          "utf8"
        );
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
    const request: WorkspaceJobStatus["request"] = {
      enableGitPr: input.enableGitPr === true,
      figmaSourceMode: acceptedModes.figmaSourceMode,
      llmCodegenMode: acceptedModes.llmCodegenMode,
      brandTheme: input.brandTheme ?? runtime.brandTheme,
      generationLocale: generationLocaleResolution.locale
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
    if (job.cancellation) {
      result.cancellation = { ...job.cancellation };
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

  return {
    submitJob,
    cancelJob,
    getJob,
    getJobResult,
    resolvePreviewAsset
  };
};

export { resolveRuntimeSettings };
export type { JobEngine, JobEngineRuntime } from "./job-engine/types.js";
