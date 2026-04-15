import { rm } from "node:fs/promises";
import { createPipelineError } from "../errors.js";
import { copyDir, pathExists } from "../fs-helpers.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { applyCustomerProfileToTemplate } from "../../customer-profile-template.js";
import {
  downgradePasteDeltaExecutionToFull,
  isPasteDeltaExecutionState,
  type PasteDeltaExecutionState,
} from "../paste-delta-execution.js";

export const TemplatePrepareService: StageService<void> = {
  stageName: "template.prepare",
  execute: async (_input, context) => {
    const templateExists = await pathExists(context.paths.templateRoot);
    if (!templateExists) {
      throw createPipelineError({
        code: "E_TEMPLATE_MISSING",
        stage: "template.prepare",
        message: `Template not found at ${context.paths.templateRoot}`,
        limits: context.runtime.pipelineDiagnosticLimits
      });
    }
    const pasteDeltaExecution =
      await context.artifactStore.getValue<PasteDeltaExecutionState>(
        STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
        isPasteDeltaExecutionState,
      );
    const downgradePasteDeltaExecution = async (
      fallbackReason: string,
    ): Promise<void> => {
      if (!pasteDeltaExecution) {
        return;
      }
      const downgraded = downgradePasteDeltaExecutionToFull({
        state: pasteDeltaExecution,
        fallbackReason,
      });
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
        stage: "template.prepare",
        value: downgraded,
      });
      context.job.pasteDeltaSummary = { ...downgraded.summary };
      await context.syncPublicJobProjection();
    };

    await rm(context.paths.generatedProjectDir, { recursive: true, force: true });
    const shouldSeedSourceProject =
      context.mode === "submission" &&
      pasteDeltaExecution?.eligibleForReuse === true &&
      context.sourceJob?.artifacts.generatedProjectDir;
    let seededFromSourceProject = false;

    if (shouldSeedSourceProject) {
      const sourceJob = context.sourceJob;
      const sourceProjectDir = sourceJob.artifacts.generatedProjectDir!;
      try {
        await copyDir({
          sourceDir: sourceProjectDir,
          targetDir: context.paths.generatedProjectDir,
        });
        seededFromSourceProject = true;
        context.log({
          level: "info",
          message:
            `Seeded generated project from source job '${sourceJob.jobId}' ` +
            `for ${pasteDeltaExecution.summary.strategy} delta execution.`,
        });
      } catch {
        context.log({
          level: "warn",
          message:
            "Seeding prior generated project failed; falling back to a fresh template copy.",
        });
        await downgradePasteDeltaExecution("template_seed_failed");
        await copyDir({
          sourceDir: context.paths.templateRoot,
          targetDir: context.paths.generatedProjectDir,
          filter: context.paths.templateCopyFilter
        });
      }
    } else {
      await copyDir({
        sourceDir: context.paths.templateRoot,
        targetDir: context.paths.generatedProjectDir,
        filter: context.paths.templateCopyFilter
      });
    }

    if (context.resolvedCustomerProfile && !seededFromSourceProject) {
      await applyCustomerProfileToTemplate({
        generatedProjectDir: context.paths.generatedProjectDir,
        customerProfile: context.resolvedCustomerProfile
      });
      context.log({
        level: "info",
        message: "Applied customer profile template dependencies and import aliases."
      });
    }
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.generatedProject,
      stage: "template.prepare",
      absolutePath: context.paths.generatedProjectDir
    });
  }
};
