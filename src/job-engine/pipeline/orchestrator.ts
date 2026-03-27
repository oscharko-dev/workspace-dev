import type { WorkspaceJobStageName } from "../../contracts/index.js";
import type { WorkspacePipelineError } from "../types.js";
import { pushRuntimeLog, updateStage } from "../stage-state.js";
import { createStageRuntimeContext, type PipelineExecutionContext } from "./context.js";
import type { StageArtifactContract, StageService } from "./stage-service.js";

export class PipelineCancellationError extends Error {
  code = "E_JOB_CANCELED" as const;
  stage: WorkspaceJobStageName;

  constructor({ stage, reason }: { stage: WorkspaceJobStageName; reason: string }) {
    super(reason);
    this.name = "PipelineCancellationError";
    this.stage = stage;
  }
}

export const isPipelineCancellationError = (error: unknown): error is PipelineCancellationError => {
  return error instanceof PipelineCancellationError;
};

export interface PipelineStagePlanEntry<TInput = unknown> {
  service: StageService<TInput>;
  artifacts?: StageArtifactContract;
  resolveInput?: (context: PipelineExecutionContext) => Promise<TInput> | TInput;
  shouldSkip?: (context: PipelineExecutionContext) => string | undefined;
  onSkipped?: (context: PipelineExecutionContext, reason: string) => void | Promise<void>;
}

interface PipelineOrchestratorDeps {
  toPipelineError: (input: { error: unknown; fallbackStage: WorkspaceJobStageName }) => WorkspacePipelineError;
  isAbortLikeError: (error: unknown) => boolean;
}

const resolveCancellationReason = ({
  context,
  fallbackReason
}: {
  context: PipelineExecutionContext;
  fallbackReason: string;
}): string => {
  if (context.job.cancellation?.reason) {
    return context.job.cancellation.reason;
  }
  return fallbackReason;
};

export class PipelineOrchestrator {
  private readonly deps: PipelineOrchestratorDeps;

  constructor(deps: PipelineOrchestratorDeps) {
    this.deps = deps;
  }

  private resolveArtifactContract({
    entry
  }: {
    entry: PipelineStagePlanEntry<unknown>;
  }): { reads: string[]; writes: string[]; optionalWrites: string[] } {
    const contract = entry.artifacts;
    return {
      reads: [...(contract?.reads ?? [])],
      writes: [...(contract?.writes ?? [])],
      optionalWrites: [...(contract?.optionalWrites ?? [])]
    };
  }

  private ensureStageNotCanceled({
    context,
    stage
  }: {
    context: PipelineExecutionContext;
    stage: WorkspaceJobStageName;
  }): void {
    if (!context.job.cancellation || context.job.cancellation.completedAt) {
      return;
    }
    throw new PipelineCancellationError({
      stage,
      reason: resolveCancellationReason({
        context,
        fallbackReason: "Cancellation requested."
      })
    });
  }

  private async runStage<TInput>({
    context,
    stage,
    entry,
    input
  }: {
    context: PipelineExecutionContext;
    stage: WorkspaceJobStageName;
    entry: PipelineStagePlanEntry<TInput>;
    input: TInput;
  }): Promise<void> {
    this.ensureStageNotCanceled({ context, stage });
    context.job.currentStage = stage;
    updateStage({ job: context.job, stage, status: "running" });
    pushRuntimeLog({
      job: context.job,
      logger: context.runtime.logger,
      level: "info",
      stage,
      message: `Starting stage '${stage}'.`
    });

    try {
      const stageContext = createStageRuntimeContext({
        executionContext: context,
        stage
      });
      await entry.service.execute(input, stageContext);
      const { writes: requiredWrites } = this.resolveArtifactContract({ entry });
      for (const key of requiredWrites) {
        const reference = await context.artifactStore.getReference(key);
        if (!reference) {
          throw new Error(`Stage '${stage}' did not persist required artifact '${key}'.`);
        }
      }
      await context.syncPublicJobProjection();
      this.ensureStageNotCanceled({ context, stage });
      updateStage({ job: context.job, stage, status: "completed" });
      pushRuntimeLog({
        job: context.job,
        logger: context.runtime.logger,
        level: "info",
        stage,
        message: `Completed stage '${stage}'.`
      });
    } catch (error) {
      if (isPipelineCancellationError(error)) {
        updateStage({
          job: context.job,
          stage,
          status: "failed",
          message: error.message
        });
        pushRuntimeLog({
          job: context.job,
          logger: context.runtime.logger,
          level: "warn",
          stage,
          message: `${error.code}: ${error.message}`
        });
        throw error;
      }

      if (context.job.cancellation && this.deps.isAbortLikeError(error)) {
        const cancellationError = new PipelineCancellationError({
          stage,
          reason: resolveCancellationReason({
            context,
            fallbackReason: "Cancellation requested."
          })
        });
        updateStage({
          job: context.job,
          stage,
          status: "failed",
          message: cancellationError.message
        });
        pushRuntimeLog({
          job: context.job,
          logger: context.runtime.logger,
          level: "warn",
          stage,
          message: `${cancellationError.code}: ${cancellationError.message}`
        });
        throw cancellationError;
      }

      const typedError = this.deps.toPipelineError({
        error,
        fallbackStage: stage
      });
      updateStage({
        job: context.job,
        stage,
        status: "failed",
        message: typedError.message
      });
      pushRuntimeLog({
        job: context.job,
        logger: context.runtime.logger,
        level: "error",
        stage,
        message: `${typedError.code}: ${typedError.message}`
      });
      throw typedError;
    }
  }

  async execute({
    context,
    plan
  }: {
    context: PipelineExecutionContext;
    plan: PipelineStagePlanEntry<unknown>[];
  }): Promise<void> {
    for (const entry of plan) {
      const service = entry.service;
      const skipReason = entry.shouldSkip?.(context);
      if (skipReason) {
        updateStage({ job: context.job, stage: service.stageName, status: "skipped", message: skipReason });
        pushRuntimeLog({
          job: context.job,
          logger: context.runtime.logger,
          level: "info",
          stage: service.stageName,
          message: skipReason
        });
        await entry.onSkipped?.(context, skipReason);
        await context.syncPublicJobProjection();
        continue;
      }
      const { reads: requiredReads } = this.resolveArtifactContract({ entry });
      for (const key of requiredReads) {
        const reference = await context.artifactStore.getReference(key);
        if (!reference) {
          throw this.deps.toPipelineError({
            error: new Error(`Stage '${service.stageName}' requires missing artifact '${key}'.`),
            fallbackStage: service.stageName
          });
        }
      }
      const input = entry.resolveInput ? await entry.resolveInput(context) : undefined;
      await this.runStage({
        context,
        stage: service.stageName,
        entry,
        input
      });
    }
  }
}
