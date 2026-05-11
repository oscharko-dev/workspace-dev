import { ALLOWED_FIGMA_SOURCE_MODES } from "../../contracts/index.js";
import { RocketTemplatePrepareService } from "../services/rocket-template-prepare-service.js";
import {
  buildRegenerationPipelinePlan,
  buildRetryPipelinePlan,
  buildSubmissionPipelinePlan,
} from "../services/pipeline-services.js";
import type { PipelineDefinition } from "./pipeline-definition.js";

const rocketPipelineDefinition: PipelineDefinition = {
  id: "rocket",
  displayName: "Rocket",
  description:
    "Compatibility pipeline for the existing WorkspaceDev generator.",
  visibility: "customer",
  deterministic: true,
  template: {
    bundleId: "react-mui-app",
    path: "template/react-mui-app",
    stack: {
      framework: "react",
      language: "typescript",
      styling: "mui",
      bundler: "vite",
    },
  },
  supportedSourceModes: [...ALLOWED_FIGMA_SOURCE_MODES],
  supportedScopes: ["board", "node", "selection"],
  buildSubmissionPlan: () =>
    buildSubmissionPipelinePlan({
      templatePrepareService: RocketTemplatePrepareService,
    }),
  buildRegenerationPlan: () =>
    buildRegenerationPipelinePlan({
      templatePrepareService: RocketTemplatePrepareService,
    }),
  buildRetryPlan: ({ retryStage }) =>
    buildRetryPipelinePlan({
      retryStage,
      templatePrepareService: RocketTemplatePrepareService,
    }),
};

export {
  rocketPipelineDefinition,
  rocketPipelineDefinition as ROCKET_PIPELINE_DEFINITION,
};
