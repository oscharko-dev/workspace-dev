import type {
  WorkspaceFigmaSourceMode,
  WorkspaceImportSessionSourceMode,
  WorkspacePipelineId,
  WorkspacePipelineScope,
} from "../../contracts/index.js";
import { ALLOWED_FIGMA_SOURCE_MODES } from "../../contracts/index.js";
import {
  buildRegenerationPipelinePlan,
  buildRetryPipelinePlan,
  buildSubmissionPipelinePlan,
} from "../services/pipeline-services.js";
import { RocketTemplatePrepareService } from "../services/rocket-template-prepare-service.js";
import type { SubmissionJobInput } from "../types.js";
import { CURRENT_BUILD_PROFILE_PIPELINE_IDS } from "./pipeline-build-profile.js";
import type { PipelineDefinition } from "./pipeline-definition.js";
import { PipelineRequestError } from "./pipeline-errors.js";
import { PipelineRegistry } from "./pipeline-registry.js";

export const KNOWN_WORKSPACE_PIPELINE_IDS = ["default", "rocket"] as const;

export const ROCKET_PIPELINE_DEFINITION: PipelineDefinition = {
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

let defaultRegistry: PipelineRegistry | undefined;

export const createDefaultPipelineRegistry = (): PipelineRegistry =>
  new PipelineRegistry({
    definitions: [ROCKET_PIPELINE_DEFINITION].filter((definition) =>
      CURRENT_BUILD_PROFILE_PIPELINE_IDS.includes(definition.id),
    ),
    knownPipelineIds: [...KNOWN_WORKSPACE_PIPELINE_IDS],
  });

export const getDefaultPipelineRegistry = (): PipelineRegistry => {
  defaultRegistry ??= createDefaultPipelineRegistry();
  return defaultRegistry;
};

export const inferPipelineScope = (
  input: Pick<SubmissionJobInput, "figmaNodeId" | "selectedNodeIds">,
): WorkspacePipelineScope => {
  if (input.selectedNodeIds !== undefined && input.selectedNodeIds.length > 0) {
    return "selection";
  }
  if (
    typeof input.figmaNodeId === "string" &&
    input.figmaNodeId.trim().length > 0
  ) {
    return "node";
  }
  return "board";
};

export const inferPipelineSourceMode = ({
  figmaSourceMode,
  requestSourceMode,
}: {
  figmaSourceMode: WorkspaceFigmaSourceMode;
  requestSourceMode?: WorkspaceImportSessionSourceMode | undefined;
}): WorkspaceFigmaSourceMode => {
  if (
    requestSourceMode === "rest" ||
    requestSourceMode === "hybrid" ||
    requestSourceMode === "local_json" ||
    requestSourceMode === "figma_paste" ||
    requestSourceMode === "figma_plugin"
  ) {
    return requestSourceMode;
  }
  return figmaSourceMode;
};

export const selectPipelineDefinition = ({
  registry = getDefaultPipelineRegistry(),
  requestedPipelineId,
  sourceMode,
  scope,
}: {
  registry?: PipelineRegistry;
  requestedPipelineId?: WorkspacePipelineId | undefined;
  sourceMode: WorkspaceFigmaSourceMode;
  scope: WorkspacePipelineScope;
}): PipelineDefinition => {
  const available = registry.list();
  const normalizedRequestedPipelineId = requestedPipelineId?.trim();

  let selected: PipelineDefinition | undefined;
  if (
    normalizedRequestedPipelineId !== undefined &&
    normalizedRequestedPipelineId.length > 0
  ) {
    selected = registry.get(normalizedRequestedPipelineId);
    if (!selected) {
      throw new PipelineRequestError({
        code: registry.isKnown(normalizedRequestedPipelineId)
          ? "PIPELINE_UNAVAILABLE"
          : "INVALID_PIPELINE",
        pipelineId: normalizedRequestedPipelineId,
        message: registry.isKnown(normalizedRequestedPipelineId)
          ? `Pipeline '${normalizedRequestedPipelineId}' is not available in this build profile.`
          : `Unknown pipeline '${normalizedRequestedPipelineId}'.`,
      });
    }
  } else if (available.length === 1) {
    selected = available[0];
  } else {
    selected =
      available.find((definition) => definition.id === "default") ?? undefined;
    if (!selected) {
      throw new PipelineRequestError({
        code: "PIPELINE_UNAVAILABLE",
        message:
          "No deterministic default pipeline is available for this build profile.",
      });
    }
  }
  if (!selected) {
    throw new PipelineRequestError({
      code: "PIPELINE_UNAVAILABLE",
      message: "No pipeline is available for this build profile.",
    });
  }

  if (!selected.supportedSourceModes.includes(sourceMode)) {
    throw new PipelineRequestError({
      code: "PIPELINE_SOURCE_MODE_UNSUPPORTED",
      pipelineId: selected.id,
      message: `Pipeline '${selected.id}' does not support figmaSourceMode='${sourceMode}'.`,
    });
  }
  if (!selected.supportedScopes.includes(scope)) {
    throw new PipelineRequestError({
      code: "PIPELINE_SCOPE_UNSUPPORTED",
      pipelineId: selected.id,
      message: `Pipeline '${selected.id}' does not support scope='${scope}'.`,
    });
  }

  return selected;
};
