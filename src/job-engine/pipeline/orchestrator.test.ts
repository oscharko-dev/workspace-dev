import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPipelineError } from "../errors.js";
import { resolveRuntimeSettings } from "../runtime.js";
import { createInitialStages, nowIso, STAGE_ORDER } from "../stage-state.js";
import type { JobRecord, WorkspacePipelineError } from "../types.js";
import type { PipelineExecutionContext } from "./context.js";
import { StageArtifactStore } from "./artifact-store.js";
import { STAGE_ARTIFACT_KEYS } from "./artifact-keys.js";
import { PipelineCancellationError, PipelineOrchestrator, type PipelineStagePlanEntry } from "./orchestrator.js";
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
      figmaAnalysisFile: path.join(jobDir, "figma-analysis.json"),
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

type CanonicalPlanOverride = Omit<PipelineStagePlanEntry<unknown>, "service"> & {
  execute?: PipelineStagePlanEntry<unknown>["service"]["execute"];
};

const createCanonicalPlan = (
  overrides: Partial<Record<(typeof STAGE_ORDER)[number], CanonicalPlanOverride>> = {}
): PipelineStagePlanEntry<unknown>[] => {
  return STAGE_ORDER.map((stageName) => {
    const override = overrides[stageName];
    return {
      service: {
        stageName,
        execute: override?.execute ?? (async () => {})
      },
      ...(override?.artifacts ? { artifacts: override.artifacts } : {}),
      ...(override?.resolveArtifacts ? { resolveArtifacts: override.resolveArtifacts } : {}),
      ...(override?.resolveInput ? { resolveInput: override.resolveInput } : {}),
      ...(override?.shouldSkip ? { shouldSkip: override.shouldSkip } : {}),
      ...(override?.onSkipped ? { onSkipped: override.onSkipped } : {})
    };
  });
};

test("PipelineOrchestrator runs stages in order and honors plan-level skip rules", async () => {
  const context = await createContext();
  const events: string[] = [];
  const orchestrator = createOrchestrator();

  await orchestrator.execute({
    context,
    plan: createCanonicalPlan({
      "figma.source": {
        execute: async () => {
          events.push("figma");
        }
      },
      "ir.derive": {
        execute: async () => {
          events.push("ir");
        },
        shouldSkip: () => "skip ir"
      },
      "template.prepare": {
        execute: async () => {
          events.push("template");
        }
      }
    })
  });

  assert.deepEqual(events, ["figma", "template"]);
  assert.equal(context.job.stages.find((stage) => stage.name === "figma.source")?.status, "completed");
  assert.equal(context.job.stages.find((stage) => stage.name === "ir.derive")?.status, "skipped");
  assert.equal(context.job.stages.find((stage) => stage.name === "template.prepare")?.status, "completed");
});

test("PipelineOrchestrator rejects duplicate stages before execution starts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  plan[2] = {
    service: {
      stageName: "ir.derive",
      execute: async () => {}
    }
  };

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "template.prepare");
      assert.equal(
        error.message,
        "Pipeline plan duplicates stage 'ir.derive' at position 3; expected 'template.prepare'.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator rejects out-of-order stage plans before execution starts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  const templateStage = plan[2];
  const codegenStage = plan[3];
  if (!templateStage || !codegenStage) {
    throw new Error("Canonical stage plan is incomplete.");
  }
  plan[2] = codegenStage;
  plan[3] = templateStage;

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "template.prepare");
      assert.equal(
        error.message,
        "Pipeline plan is out of canonical order at position 3; expected 'template.prepare' but received 'codegen.generate'.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator rejects invalid stage names before execution starts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  plan[1] = {
    service: {
      stageName: "invalid.stage" as unknown as (typeof STAGE_ORDER)[number],
      execute: async () => {}
    }
  };

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "ir.derive");
      assert.equal(
        error.message,
        "Pipeline plan contains invalid stage 'invalid.stage' at position 2; expected 'ir.derive'.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator rejects missing canonical stages before execution starts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  plan.pop();

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "git.pr");
      assert.equal(
        error.message,
        "Pipeline plan is missing canonical stage 'git.pr' at position 7.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator rejects unexpected extra stages before execution starts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  plan.push({
    service: {
      stageName: "git.pr",
      execute: async () => {}
    }
  });

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "git.pr");
      assert.equal(
        error.message,
        "Pipeline plan contains unexpected extra stage 'git.pr' after canonical plan end.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator rejects invalid extra stages after canonical plan end using the last canonical stage", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const plan = createCanonicalPlan();
  plan.push({
    service: {
      stageName: "invalid.extra" as unknown as (typeof STAGE_ORDER)[number],
      execute: async () => {}
    }
  });

  await assert.rejects(
    async () => {
      await orchestrator.execute({ context, plan });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_PLAN_INVALID");
      assert.equal((error as WorkspacePipelineError).stage, "git.pr");
      assert.equal(
        error.message,
        "Pipeline plan contains invalid stage 'invalid.extra' after canonical plan end.",
      );
      return true;
    }
  );
});

test("PipelineOrchestrator projects artifact-backed public fields after each stage", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  const diffPath = path.join(context.paths.jobDir, "generation-diff.json");

  await orchestrator.execute({
    context,
    plan: createCanonicalPlan({
      "codegen.generate": {
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
        },
        artifacts: {
          writes: [STAGE_ARTIFACT_KEYS.generatedProject]
        }
      },
      "git.pr": {
        execute: async () => {
          // no-op; skip handler persists public git PR status
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
          skipWrites: [STAGE_ARTIFACT_KEYS.gitPrStatus]
        }
      }
    })
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
        plan: createCanonicalPlan({
          "codegen.generate": {
            execute: async () => {
              executed = true;
            },
            artifacts: {
              reads: [STAGE_ARTIFACT_KEYS.designIr]
            }
          }
        })
      });
    },
    /requires missing artifact 'design\.ir'/
  );

  assert.equal(executed, false);
});

test("PipelineOrchestrator executes stages when required read artifacts are already persisted", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  let executed = false;

  await context.artifactStore.setValue({
    key: STAGE_ARTIFACT_KEYS.designIr,
    stage: "ir.derive",
    value: { schemaVersion: 1 }
  });

  await orchestrator.execute({
    context,
    plan: createCanonicalPlan({
      "codegen.generate": {
        execute: async () => {
          executed = true;
        },
        artifacts: {
          reads: [STAGE_ARTIFACT_KEYS.designIr]
        }
      }
    })
  });

  assert.equal(executed, true);
  assert.equal(context.job.stages.find((stage) => stage.name === "codegen.generate")?.status, "completed");
  assert.equal(context.job.logs.some((entry) => entry.message === "Starting stage 'codegen.generate'."), true);
  assert.equal(context.job.logs.some((entry) => entry.message === "Completed stage 'codegen.generate'."), true);
});

test("PipelineOrchestrator rejects missing dynamically required read artifacts before stage execution", async () => {
  const context = await createContext();
  context.requestedStorybookStaticDir = "storybook-static/customer";
  context.resolvedStorybookStaticDir = "/tmp/storybook-static/customer";
  const orchestrator = createOrchestrator();
  let executed = false;

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "codegen.generate": {
            execute: async () => {
              executed = true;
            },
            resolveArtifacts: (executionContext) => {
              if (!executionContext.requestedStorybookStaticDir) {
                return {};
              }
              return {
                reads: [STAGE_ARTIFACT_KEYS.storybookTokens]
              };
            }
          }
        })
      });
    },
    /requires missing artifact 'storybook\.tokens'/
  );

  assert.equal(executed, false);
});

test("PipelineOrchestrator normalizes resolveArtifacts failures through the stage error path", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "codegen.generate": {
            execute: async () => {},
            resolveArtifacts: async () => {
              throw new Error("artifact contract resolution failed");
            }
          }
        })
      });
    },
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      "stage" in error &&
      (error as WorkspacePipelineError).code === "E_PIPELINE_UNKNOWN" &&
      (error as WorkspacePipelineError).stage === "codegen.generate" &&
      error.message.includes("artifact contract resolution failed")
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "codegen.generate")?.status, "failed");
});

test("PipelineOrchestrator skips stages without resolving dynamic artifacts", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();
  let resolveArtifactsCalls = 0;

  await orchestrator.execute({
    context,
    plan: createCanonicalPlan({
      "git.pr": {
        execute: async () => {
          assert.fail("skipped stages must not execute");
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
          skipWrites: [STAGE_ARTIFACT_KEYS.gitPrStatus]
        },
        resolveArtifacts: async () => {
          resolveArtifactsCalls += 1;
          throw new Error("skip path should not resolve artifacts");
        }
      }
    })
  });

  assert.equal(resolveArtifactsCalls, 0);
  assert.equal(context.job.stages.find((stage) => stage.name === "git.pr")?.status, "skipped");
  assert.deepEqual(context.job.gitPr, {
    status: "skipped",
    reason: "Git/PR flow disabled by request."
  });
});

test("PipelineOrchestrator marks stage failed when a required write artifact is missing", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "template.prepare": {
            execute: async () => {
              // intentionally do not write required artifact
            },
            artifacts: {
              writes: [STAGE_ARTIFACT_KEYS.generatedProject]
            }
          }
        })
      });
    },
    /did not persist required artifact 'generated\.project'/
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "template.prepare")?.status, "failed");
});

test("PipelineOrchestrator marks skipped stages failed when required skip artifacts are missing", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "git.pr": {
            execute: async () => {},
            shouldSkip: () => "Git/PR flow disabled by request.",
            onSkipped: async () => {
              // intentionally do not persist gitPrStatus
            },
            artifacts: {
              skipWrites: [STAGE_ARTIFACT_KEYS.gitPrStatus]
            }
          }
        })
      });
    },
    /did not persist required artifact 'git\.pr\.status'/
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "git.pr")?.status, "failed");
  assert.equal(context.job.stages.find((stage) => stage.name === "git.pr")?.message?.includes("git.pr.status"), true);
  assert.equal("gitPr" in context.job, false);
});

test("PipelineOrchestrator marks skipped stage failed when onSkipped throws an unexpected error", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "git.pr": {
            execute: async () => {},
            shouldSkip: () => "Git/PR flow disabled by request.",
            onSkipped: async () => {
              throw new Error("onSkipped callback failure");
            }
          }
        })
      });
    },
    /onSkipped callback failure/
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "git.pr")?.status, "failed");
});

test("PipelineOrchestrator raises cancellation when stage is canceled during skip path", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "git.pr": {
            execute: async () => {},
            shouldSkip: () => "Git/PR flow disabled by request.",
            onSkipped: async () => {
              context.job.cancellation = {
                requestedAt: nowIso(),
                requestedBy: "api",
                reason: "cancel during skip"
              };
            }
          }
        })
      });
    },
    (error: unknown) =>
      error instanceof PipelineCancellationError &&
      error.stage === "git.pr" &&
      error.message === "cancel during skip"
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "git.pr")?.status, "failed");
});

test("PipelineOrchestrator marks stage failed on service errors", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "figma.source": {
            execute: async () => {
              throw new Error("boom");
            }
          }
        })
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
        plan: createCanonicalPlan({
          "figma.source": {
            execute: async () => {
              // no-op
            }
          }
        })
      });
    },
    (error: unknown) => error instanceof PipelineCancellationError && error.stage === "figma.source"
  );
});

test("PipelineOrchestrator falls back to the default cancellation reason when none is provided", async () => {
  const context = await createContext();
  context.job.cancellation = {
    requestedAt: nowIso(),
    requestedBy: "api"
  };
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "figma.source": {
            execute: async () => {
              // no-op
            }
          }
        })
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof PipelineCancellationError);
      assert.equal(error.stage, "figma.source");
      assert.equal(error.message, "Cancellation requested.");
      assert.equal(error.code, "E_JOB_CANCELED");
      assert.equal(error.name, "PipelineCancellationError");
      return true;
    }
  );
});

test("PipelineOrchestrator converts in-flight abort-like errors into pipeline cancellation", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "validate.project": {
            execute: async () => {
              context.job.cancellation = {
                requestedAt: nowIso(),
                requestedBy: "api",
                reason: "abort requested during validation"
              };
              throw new DOMException("aborted", "AbortError");
            }
          }
        })
      });
    },
    (error: unknown) =>
      error instanceof PipelineCancellationError &&
      error.stage === "validate.project" &&
      error.message.includes("abort requested during validation")
  );
});

test("PipelineOrchestrator leaves abort-like errors as regular stage failures when no cancellation was requested", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "validate.project": {
            execute: async () => {
              throw new DOMException("aborted upstream", "AbortError");
            }
          }
        })
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as WorkspacePipelineError).code, "E_PIPELINE_UNKNOWN");
      assert.equal((error as WorkspacePipelineError).stage, "validate.project");
      assert.equal(error.message, "aborted upstream");
      return true;
    }
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "validate.project")?.status, "failed");
  assert.equal(context.job.logs.some((entry) => entry.message === "E_PIPELINE_UNKNOWN: aborted upstream"), true);
  assert.equal(context.job.logs.some((entry) => entry.message.startsWith("E_JOB_CANCELED:")), false);
});

test("PipelineOrchestrator preserves explicit service-thrown cancellation errors", async () => {
  const context = await createContext();
  const orchestrator = createOrchestrator();

  await assert.rejects(
    async () => {
      await orchestrator.execute({
        context,
        plan: createCanonicalPlan({
          "figma.source": {
            execute: async () => {
              throw new PipelineCancellationError({
                stage: "figma.source",
                reason: "service canceled"
              });
            }
          }
        })
      });
    },
    (error: unknown) =>
      error instanceof PipelineCancellationError &&
      error.stage === "figma.source" &&
      error.message === "service canceled"
  );

  assert.equal(context.job.stages.find((stage) => stage.name === "figma.source")?.status, "failed");
  assert.match(String(context.job.logs.at(-1)?.message ?? ""), /E_JOB_CANCELED: service canceled/);
});
