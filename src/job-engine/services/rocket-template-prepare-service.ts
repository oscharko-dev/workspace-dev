import { applyCustomerProfileToTemplate } from "../../customer-profile-template.js";
import type { StageService } from "../pipeline/stage-service.js";
import { createTemplatePrepareService } from "./template-prepare-core.js";

export const RocketTemplatePrepareService: StageService<void> = createTemplatePrepareService({
  applyFreshTemplateMutation: async (context) => {
    if (!context.resolvedCustomerProfile) {
      return;
    }

    await applyCustomerProfileToTemplate({
      generatedProjectDir: context.paths.generatedProjectDir,
      customerProfile: context.resolvedCustomerProfile,
    });
    context.log({
      level: "info",
      message: "Applied customer profile template dependencies and import aliases.",
    });
  },
});
