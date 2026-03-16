import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceJobInput, WorkspaceJobResult, WorkspaceJobStageName, WorkspaceJobStatus } from "./contracts/index.js";
import { createPipelineError, getErrorMessage } from "./job-engine/errors.js";
import { cleanFigmaForCodegen } from "./job-engine/figma-clean.js";
import { fetchFigmaFile } from "./job-engine/figma-source.js";
import { copyDir, pathExists, resolveAbsoluteOutputRoot } from "./job-engine/fs-helpers.js";
import { runGitPrFlow } from "./job-engine/git-pr.js";
import { getContentType, normalizePathPart } from "./job-engine/preview.js";
import { resolveRuntimeSettings } from "./job-engine/runtime.js";
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
import type { CreateJobEngineInput, JobEngine, JobRecord, WorkspacePipelineError } from "./job-engine/types.js";
import { runProjectValidation } from "./job-engine/validation.js";
import { generateArtifacts } from "./parity/generator-core.js";
import { figmaToDesignIrWithOptions } from "./parity/ir.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(MODULE_DIR, "../template/react-mui-app");

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

export const createJobEngine = ({ resolveBaseUrl, paths, runtime }: CreateJobEngineInput): JobEngine => {
  const resolvedPaths = resolveAbsoluteOutputRoot({ outputRoot: paths.outputRoot });
  const jobs = new Map<string, JobRecord>();

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

  const runStage = async <T>({
    job,
    stage,
    action
  }: {
    job: JobRecord;
    stage: WorkspaceJobStageName;
    action: () => Promise<T>;
  }): Promise<T> => {
    job.currentStage = stage;
    updateStage({ job, stage, status: "running" });
    pushLog({ job, level: "info", stage, message: `Starting stage '${stage}'.` });

    try {
      const result = await action();
      updateStage({ job, stage, status: "completed" });
      pushLog({ job, level: "info", stage, message: `Completed stage '${stage}'.` });
      return result;
    } catch (error) {
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

    const jobDir = path.join(resolvedPaths.jobsRoot, job.jobId);
    const generatedProjectDir = path.join(jobDir, "generated-app");
    const figmaRawJsonFile = path.join(jobDir, "figma.raw.json");
    const figmaJsonFile = path.join(jobDir, "figma.json");
    const designIrFile = path.join(jobDir, "design-ir.json");
    const stageTimingsFile = path.join(jobDir, "stage-timings.json");
    const reproDir = path.join(resolvedPaths.reprosRoot, job.jobId);

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
          const result = await fetchFigmaFile({
            fileKey: input.figmaFileKey,
            accessToken: input.figmaAccessToken,
            timeoutMs: runtime.figmaTimeoutMs,
            maxRetries: runtime.figmaMaxRetries,
            bootstrapDepth: runtime.figmaBootstrapDepth,
            nodeBatchSize: runtime.figmaNodeBatchSize,
            nodeFetchConcurrency: runtime.figmaNodeFetchConcurrency,
            adaptiveBatchingEnabled: runtime.figmaAdaptiveBatchingEnabled,
            maxScreenCandidates: runtime.figmaMaxScreenCandidates,
            cacheEnabled: runtime.figmaCacheEnabled,
            cacheTtlMs: runtime.figmaCacheTtlMs,
            cacheDir: path.join(resolvedPaths.outputRoot, "cache", "figma-source"),
            fetchImpl: runtime.fetchImpl,
            onLog: (message) => {
              pushLog({
                job,
                level: "info",
                stage: "figma.source",
                message
              });
            }
          });
          await writeFile(figmaRawJsonFile, `${JSON.stringify(result.file, null, 2)}\n`, "utf8");
          const cleaning = cleanFigmaForCodegen({ file: result.file });
          await writeFile(figmaJsonFile, `${JSON.stringify(cleaning.cleanedFile, null, 2)}\n`, "utf8");
          pushLog({
            job,
            level: "info",
            stage: "figma.source",
            message:
              `Figma source mode=${result.diagnostics.sourceMode}, fetchedNodes=${result.diagnostics.fetchedNodes}, ` +
              `degradedGeometryNodes=${result.diagnostics.degradedGeometryNodes.length}, cleanedNodes=${cleaning.report.outputNodeCount}/${cleaning.report.inputNodeCount}, ` +
              `removedHidden=${cleaning.report.removedHiddenNodes}, removedPlaceholders=${cleaning.report.removedPlaceholderNodes}, ` +
              `removedHelpers=${cleaning.report.removedHelperNodes}, removedInvalid=${cleaning.report.removedInvalidNodes}, removedProperties=${cleaning.report.removedPropertyCount}`
          });
          return {
            ...result,
            file: cleaning.cleanedFile,
            cleaning
          };
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
          pushLog({
            job,
            level: "info",
            stage: "ir.derive",
            message: `Derived Design IR with ${derived.screens.length} screens (skippedHidden=${derived.metrics?.skippedHidden ?? 0}, skippedPlaceholders=${derived.metrics?.skippedPlaceholders ?? 0}, truncatedScreens=${derived.metrics?.truncatedScreens.length ?? 0}).`
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
            filter: (sourcePath) => {
              const baseName = path.basename(sourcePath);
              return baseName !== "node_modules" && baseName !== ".vite" && baseName !== "dist";
            }
          });
        }
      });

      const generationSummary = await runStage({
        job,
        stage: "codegen.generate",
        action: async () => {
          return await generateArtifacts({
            projectDir: generatedProjectDir,
            ir,
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
            enablePerfValidation: isPerfValidationEnabled(),
            enableUiValidation: runtime.enableUiValidation,
            commandTimeoutMs: runtime.commandTimeoutMs,
            installPreferOffline: runtime.installPreferOffline,
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
    }
  };

  const submitJob = (input: WorkspaceJobInput) => {
    const jobId = randomUUID();
    const acceptedModes = toAcceptedModes();
    const request: WorkspaceJobStatus["request"] = {
      figmaFileKey: input.figmaFileKey,
      enableGitPr: input.enableGitPr === true,
      figmaSourceMode: acceptedModes.figmaSourceMode,
      llmCodegenMode: acceptedModes.llmCodegenMode
    };
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
      }
    };

    jobs.set(jobId, job);

    pushLog({ job, level: "info", message: "Job accepted by workspace-dev runtime." });

    queueMicrotask(() => {
      void runJob(job, input);
    });

    return {
      jobId,
      status: "queued" as const,
      acceptedModes
    };
  };

  const getJob = (jobId: string): WorkspaceJobStatus | undefined => {
    const job = jobs.get(jobId);
    if (!job) {
      return undefined;
    }
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
    getJob,
    getJobResult,
    resolvePreviewAsset
  };
};

export { resolveRuntimeSettings };
export type { JobEngine, JobEngineRuntime } from "./job-engine/types.js";
