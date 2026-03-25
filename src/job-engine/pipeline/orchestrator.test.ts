import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPipelineError } from "../errors.js";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso } from "../stage-state.js";
import type { JobRecord, WorkspacePipelineError } from "../types.js";
import type { PipelineExecutionContext } from "./context.js";
import { StageArtifactStore } from "./artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import { PipelineCancellationError, PipelineOrchestrator } from "./orchestrator.js";
import { syncPublicJobProjection } from "./public-job-projection.js";

const createContext = async (): Promise<PipelineExecutionContext> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-dev-orchestrator-"));
  const runtime = resolveRuntimeSettings({ enablePreview: false });
  const jobDir = path.join(root, "jobs", "job-1");
  const generatedProjectDir = path.join(jobDir, "generated-app");
  const reproDir = path.join(root, "repros", "job-1");
  await mkdir(jobDir, { recursive: true });
  const job: JobRecord = {
    jobId: "job-1",
    status: "queued",
    submittedAt: nowIso(),
    request: {
      enableGitPr: false,
      figmaSourceMode: "local_json",
      llmCodegenMode: "deterministic",
      brandTheme: "derived",
      generationLocale: "en-US",
      formHandlingMode: "react_hook_form"
    },
    stages: createInitialStages(),
    logs: [],
    artifacts: {
      outputRoot: root,
      jobDir
    },
    preview: { enabled: false },
    queue: {
      runningCount: 0,
      queuedCount: 0,
      maxConcurrentJobs: runtime.maxConcurrentJobs,
      maxQueuedJobs: runtime.maxQueuedJobs
    }
  };
  const artifactStore = new StageArtifactStore({ jobDir });

  return {
    mode: "submission",
    job,
    runtime,
    resolvedPaths: {
      outputRoot: root,
      jobsRoot: path.join(root, "jobs"),
      reprosRoot: path.join(root, "repros")
    },
    resolvedWorkspaceRoot: root,
    resolveBaseUrl: () => "http://127.0.0.1:1983",
    jobAbortController: new AbortController(),
    fetchWithCancellation: runtime.fetchImpl,
    paths: {
      jobDir,
      generatedProjectDir,
      figmaRawJsonFile: path.join(jobDir, "figma.raw.json"),
      figmaJsonFile: path.join(jobDir, "figma.json"),
      designIrFile: path.join(jobDir, "design-ir.json"),
      stageTimingsFile: path.join(jobDir, "stage-timings.json"),
      reproDir,
      iconMapFilePath: path.join(root, "icon-map.json"),
      designSystemFilePath: path.join(root, "design-system.json"),
      irCacheDir: path.join(root, "cache", "ir-derivation"),
      templateRoot: path.join(root, "template"),
      templateCopyFilter: () => true
    },
    artifactStore,
    resolvedBrandTheme: "derived",
    resolvedFigmaSourceMode: "local_json",
    resolvedFormHandlingMode: "react_hook_form",
    generationLocaleResolution: {
      locale: "en-US"
    },
    resolvedGenerationLocale: "en-US",
    appendDiagnostics: () => {
      // no-op for test
    },
    getCollectedDiagnostics: () => undefined,
    syncPublicJobProjection: async () => {
      await syncPublicJobProjection({ job, artifactStore });
    }
  };
};

const createOrchestrator = (): PipelineOrchestrator => {
  return new PipelineOrchestrator({
    toPipelineError: ({ error, fallbackStage }): WorkspacePipelineError => {
      if (error instanceof Error && "code" in error && "stage" in error) {
        return error as WorkspacePipelineError;
      }
      return createPipelineError({
        code: "E_PIPELINE_UNKNOWN",
        stage: fallbackStage,
        message: error instanceof Error ? error.message : String(error)
      });
    },
    isAbortLikeError: (error) => error instanceof Error && /abort|cancel/i.test(error.message)
  });
};

test("PipelineOrchestrator runs stages in order and honors plan-level skip rules", async () => {
  const context = await createContext();
  const events: string[] = [];
  const orchestrator = createOrchestrator();

  await orchestrator.execute({
    context,
    plan: [
      {
        service: {
          stageName: "figma.source",
          execute: async () => {
            events.push("figma");
          }
        }
      },
      {
        service: {
          stageName: "ir.derive",
          execute: async () => {
            events.push("ir");
          }
        },
        shouldSkip: () => "skip ir"
      },
      {
        service: {
          stageName: "template.prepare",
          execute: async () => {
            events.push("template");
          }
        }
      }
    ]
  });

  assert.deepEqual(events, ["figma", "template"]);
  assert.equal(context.job.stages.find((stage) => stage.name === "figma.source")?.status, "completed");
  assert.equal(context.job.stages.find((stage) => stage.name === "ir.derive")?.status, "skipped");
  assert.equal(context.job.stages.find((stage) => stage.name === "template.prepare")?.status, "completed");
});

test("PipelineOrchestrator projects artifact-backed public fields after each stage", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const diffPath = path.join(context.paths.jobDir, "generation-diff.json");

  await orchestrator.execute({
    context,
    plan: [
      {
        service: {
          stageName: "codegen.generate",
          execute: async (_input, stageContext) => {
            await stageContext.artifactStore.setPath({
              key: STAGE_ARTIFACT_KEYS.generatedProject,
              stage: "codegen.generate",
              absolutePath: context.paths.generatedProjectDir
            });
            await stageContext.artifactStore.setValue({
              key: STAGE_ARTIFACT_KEYS.generationDiff,
              stage: "codegen.generate",
              value: {
                summary: "diff ready"
              }
            });
            await stageContext.artifactStore.setPath({
              key: STAGE_ARTIFACT_KEYS.generationDiffFile,
              stage: "codegen.generate",
              absolutePath: diffPath
            });
          }
        },
        artifacts: {
          writes: [STAGE_ARTIFACT_KEYS.generatedProject]
        }
      },
      {
        service: {
          stageName: "git.pr",
          execute: async () => {
            // no-op; skip handler persists public git PR status
          }
        },
        shouldSkip: () => "Git/PR flow disabled by request.",
        onSkipped: async (executionContext, reason) => {
          await executionContext.artifactStore.setValue({
            key: STAGE_ARTIFACT_KEYS.gitPrStatus,
            stage: "git.pr",
            value: {
              status: "skipped",
              reason
            }
          });
        },
        artifacts: {
          writes: [STAGE_ARTIFACT_KEYS.gitPrStatus]
        }
      }
    ]
  });

  assert.equal(context.job.artifacts.generatedProjectDir, context.paths.generatedProjectDir);
  assert.deepEqual(context.job.generationDiff, { summary: "diff ready" });
  assert.equal(context.job.artifacts.generationDiffFile, diffPath);
  assert.deepEqual(context.job.gitPr, {
    status: "skipped",
    reason: "Git/PR flow disabled by request."
  });
});

test("PipelineOrchestrator rejects missing required read artifacts before stage execution", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  let executed = false;

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: [
          {
            service: {
              stageName: "codegen.generate",
              execute: async () => {
                executed = true;
              }
            },
            artifacts: {
              reads: [STAGE_ARTIFACT_KEYS.designIr]
            }
          }
        ]
      });
    },
    /requires missing artifact 'design\.ir'/
  );

  assert.equal(executed, false);
});

test("PipelineOrchestrator marks stage failed when a required write artifact is missing", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: [
          {
            service: {
              stageName: "template.prepare",
              execute: async () => {
                // intentionally do not write required artifact
              }
            },
            artifacts: {
              writes: [STAGE_ARTIFACT_KEYS.generatedProject]
            }
          }
        ]
      });
    },
    /did not persist required artifact 'generated\.project'/
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "template.prepare")?.status, "failed");
});

test("PipelineOrchestrator marks stage failed on service errors", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: [
          {
            service: {
              stageName: "figma.source",
              execute: async () => {
                throw new Error("boom");
              }
            }
          }
        ]
      });
    },
    /boom/
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "figma.source")?.status, "failed");
});

test("PipelineOrchestrator raises cancellation when stage is canceled before execution", async () => {
  const context = await createContext();
  context.job.cancellation = {
    requestedAt: nowIso(),
    requestedBy: "api",
    reason: "cancel requested"
  };
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: [
          {
            service: {
              stageName: "figma.source",
              execute: async () => {
                // no-op
              }
            }
          }
        ]
      });
    },
    (error: unknown) => error instanceof PipelineCancellationError && error.stage === "figma.source"
  );
});

test("PipelineOrchestrator converts in-flight abort-like errors into pipeline cancellation", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: [
          {
            service: {
              stageName: "validate.project",
              execute: async () => {
                context.job.cancellation = {
                  requestedAt: nowIso(),
                  requestedBy: "api",
                  reason: "abort requested during validation"
                };
                throw new DOMException("aborted", "AbortError");
              }
            }
          }
        ]
      });
    },
    (error: unknown) =>
      error instanceof PipelineCancellationError &&
      error.stage === "validate.project" &&
      error.message.includes("abort requested during validation")
  );
});
