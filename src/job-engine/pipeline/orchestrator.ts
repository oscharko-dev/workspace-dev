import type { WorkspaceJobStageName } from "../../contracts/index.js";
import type { WorkspacePipelineError } from "../types.js";
import { STAGE_ORDER, pushRuntimeLog, updateStage } from "../stage-state.js";
import type { StageArtifactKey } from "./artifact-keys.js";
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

const PIPELINE_PLAN_INVALID_CODE = "E_PIPELINE_PLAN_INVALID" as const;
const STAGE_ORDER_SET = new Set<WorkspaceJobStageName>(STAGE_ORDER);

const isWorkspaceJobStageName = (value: string): value is WorkspaceJobStageName => {
  return STAGE_ORDER_SET.has(value as WorkspaceJobStageName);
};

const createPipelinePlanValidationError = ({
  message,
  stage
}: {
  message: string;
  stage: WorkspaceJobStageName;
}): WorkspacePipelineError => {
  const error = new Error(message) as WorkspacePipelineError;
  error.code = PIPELINE_PLAN_INVALID_CODE;
  error.stage = stage;
  return error;
};

export interface PipelineStagePlanEntry<TInput = unknown> {
  service: StageService<TInput>;
  artifacts?: StageArtifactContract;
  resolveArtifacts?: (context: PipelineExecutionContext) => Promise<StageArtifactContract> | StageArtifactContract;
  resolveInput?: (context: PipelineExecutionContext) => Promise<TInput> | TInput;
  shouldSkip?: (context: PipelineExecutionContext) => string | undefined;
  onSkipped?: (context: PipelineExecutionContext, reason: string) => void | Promise<void>;
}

interface PipelineOrchestratorDeps {
  toPipelineError: (input: { error: unknown; fallbackStage: WorkspaceJobStageName }) => WorkspacePipelineError;
  isAbortLikeError: (error: unknown) => boolean;
}

interface ResolvedStageArtifactContract {
  reads: StageArtifactKey[];
  optionalReads: StageArtifactKey[];
  writes: StageArtifactKey[];
  skipWrites: StageArtifactKey[];
  optionalWrites: StageArtifactKey[];
}

const mergeArtifactKeys = (...groups: ReadonlyArray<readonly StageArtifactKey[] | undefined>): StageArtifactKey[] => {
  const merged: StageArtifactKey[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const key of group ?? []) {
      const serializedKey = String(key);
      if (seen.has(serializedKey)) {
        continue;
      }
      seen.add(serializedKey);
      merged.push(key);
    }
  }
  return merged;
};

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

  private createResolvedArtifactContract(contract?: StageArtifactContract): ResolvedStageArtifactContract {
    return {
      reads: mergeArtifactKeys(contract?.reads),
      optionalReads: mergeArtifactKeys(contract?.optionalReads),
      writes: mergeArtifactKeys(contract?.writes),
      skipWrites: mergeArtifactKeys(contract?.skipWrites),
      optionalWrites: mergeArtifactKeys(contract?.optionalWrites)
    };
  }

  private async resolveArtifactContract({
    context,
    entry
  }: {
    context: PipelineExecutionContext;
    entry: PipelineStagePlanEntry<unknown>;
  }): Promise<ResolvedStageArtifactContract> {
    const staticContract = this.createResolvedArtifactContract(entry.artifacts);
    const dynamicContract = await entry.resolveArtifacts?.(context);
    return {
      reads: mergeArtifactKeys(staticContract.reads, dynamicContract?.reads),
      optionalReads: mergeArtifactKeys(staticContract.optionalReads, dynamicContract?.optionalReads),
      writes: mergeArtifactKeys(staticContract.writes, dynamicContract?.writes),
      skipWrites: mergeArtifactKeys(staticContract.skipWrites, dynamicContract?.skipWrites),
      optionalWrites: mergeArtifactKeys(staticContract.optionalWrites, dynamicContract?.optionalWrites)
    };
  }

  private validatePlan({
    plan
  }: {
    plan: PipelineStagePlanEntry<unknown>[];
  }): void {
    const lastCanonicalStage = STAGE_ORDER[STAGE_ORDER.length - 1] ?? "git.pr";
    const seenStages = new Set<WorkspaceJobStageName>();
    const maxLength = Math.max(plan.length, STAGE_ORDER.length);

    for (let index = 0; index < maxLength; index += 1) {
      const expectedStage = STAGE_ORDER[index];
      const actualStageName = plan[index]?.service.stageName as string | undefined;

      if (expectedStage === undefined) {
        if (actualStageName === undefined) {
          return;
        }
        if (!isWorkspaceJobStageName(actualStageName)) {
          throw createPipelinePlanValidationError({
            stage: lastCanonicalStage,
            message: `Pipeline plan contains invalid stage '${actualStageName}' after canonical plan end.`
          });
        }
        throw createPipelinePlanValidationError({
          stage: actualStageName,
          message: `Pipeline plan contains unexpected extra stage '${actualStageName}' after canonical plan end.`
        });
      }

      if (actualStageName === undefined) {
        throw createPipelinePlanValidationError({
          stage: expectedStage,
          message: `Pipeline plan is missing canonical stage '${expectedStage}' at position ${index + 1}.`
        });
      }

      if (!isWorkspaceJobStageName(actualStageName)) {
        throw createPipelinePlanValidationError({
          stage: expectedStage,
          message: `Pipeline plan contains invalid stage '${actualStageName}' at position ${index + 1}; expected '${expectedStage}'.`
        });
      }

      if (seenStages.has(actualStageName)) {
        throw createPipelinePlanValidationError({
          stage: expectedStage,
          message: `Pipeline plan duplicates stage '${actualStageName}' at position ${index + 1}; expected '${expectedStage}'.`
        });
      }
      seenStages.add(actualStageName);

      if (actualStageName !== expectedStage) {
        throw createPipelinePlanValidationError({
          stage: expectedStage,
          message: `Pipeline plan is out of canonical order at position ${index + 1}; expected '${expectedStage}' but received '${actualStageName}'.`
        });
      }
    }
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

  private async ensureRequiredArtifactsPersisted({
    context,
    requiredKeys,
    stage
  }: {
    context: PipelineExecutionContext;
    requiredKeys: StageArtifactKey[];
    stage: WorkspaceJobStageName;
  }): Promise<void> {
    for (const key of requiredKeys) {
      const reference = await context.artifactStore.getReference(key);
      if (!reference) {
        throw new Error(`Stage '${stage}' did not persist required artifact '${key}'.`);
      }
    }
  }

  private handleStageError({
    context,
    error,
    stage
  }: {
    context: PipelineExecutionContext;
    error: unknown;
    stage: WorkspaceJobStageName;
  }): never {
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

  private async runStage<TInput>({
    context,
    stage,
    entry,
    artifactContract,
    input
  }: {
    context: PipelineExecutionContext;
    stage: WorkspaceJobStageName;
    entry: PipelineStagePlanEntry<TInput>;
    artifactContract: ResolvedStageArtifactContract;
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
      await this.ensureRequiredArtifactsPersisted({
        context,
        requiredKeys: artifactContract.writes,
        stage
      });
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
      this.handleStageError({
        context,
        error,
        stage
      });
    }
  }

  private async skipStage({
    context,
    entry,
    artifactContract,
    reason,
    stage
  }: {
    context: PipelineExecutionContext;
    entry: PipelineStagePlanEntry<unknown>;
    artifactContract: ResolvedStageArtifactContract;
    reason: string;
    stage: WorkspaceJobStageName;
  }): Promise<void> {
    context.job.currentStage = stage;
    this.ensureStageNotCanceled({ context, stage });

    try {
      await entry.onSkipped?.(context, reason);
      await this.ensureRequiredArtifactsPersisted({
        context,
        requiredKeys: artifactContract.skipWrites,
        stage
      });
      await context.syncPublicJobProjection();
      this.ensureStageNotCanceled({ context, stage });
      updateStage({ job: context.job, stage, status: "skipped", message: reason });
      pushRuntimeLog({
        job: context.job,
        logger: context.runtime.logger,
        level: "info",
        stage,
        message: reason
      });
    } catch (error) {
      this.handleStageError({
        context,
        error,
        stage
      });
    }
  }

  async execute({
    context,
    plan
  }: {
    context: PipelineExecutionContext;
    plan: PipelineStagePlanEntry<unknown>[];
  }): Promise<void> {
    this.validatePlan({ plan });

    for (const entry of plan) {
      const service = entry.service;
      const skipReason = entry.shouldSkip?.(context);
      if (skipReason) {
        await this.skipStage({
          context,
          entry,
          artifactContract: this.createResolvedArtifactContract(entry.artifacts),
          reason: skipReason,
          stage: service.stageName
        });
        continue;
      }
      let artifactContract: ResolvedStageArtifactContract;
      try {
        artifactContract = await this.resolveArtifactContract({
          context,
          entry
        });
      } catch (error) {
        this.handleStageError({
          context,
          error,
          stage: service.stageName
        });
      }
      for (const key of artifactContract.reads) {
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
        artifactContract,
        input
      });
    }
  }
}
