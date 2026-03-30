import { rm } from "node:fs/promises";
import { createPipelineError } from "../errors.js";
import { copyDir, pathExists } from "../fs-helpers.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { applyCustomerProfileToTemplate } from "../../customer-profile-template.js";

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
    await rm(context.paths.generatedProjectDir, { recursive: true, force: true });
    await copyDir({
      sourceDir: context.paths.templateRoot,
      targetDir: context.paths.generatedProjectDir,
      filter: context.paths.templateCopyFilter
    });
    if (context.resolvedCustomerProfile) {
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
