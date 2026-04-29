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
import { DefaultCodegenGenerateService } from "../services/default-codegen-generate-service.js";
import { RocketTemplatePrepareService } from "../services/rocket-template-prepare-service.js";
import type { SubmissionJobInput } from "../types.js";
import { CURRENT_BUILD_PROFILE_PIPELINE_IDS } from "./pipeline-build-profile.js";
import type { PipelineDefinition } from "./pipeline-definition.js";
import { PipelineRequestError } from "./pipeline-errors.js";
import { PipelineRegistry } from "./pipeline-registry.js";

export const KNOWN_WORKSPACE_PIPELINE_IDS = ["default", "rocket"] as const;

export type LegacyRocketAutoSelectionSignal =
  | "customerProfilePath"
  | "customerBrandId"
  | "componentMappings"
  | "customerProfileMappings"
  | "customerProfileImportAliases"
  | "directMuiEmotionMappings";

export interface PipelineSelectionWarning {
  code: "LEGACY_ROCKET_AUTO_SELECTED";
  message: string;
  signals: LegacyRocketAutoSelectionSignal[];
}

export interface PipelineSelectionResult {
  definition: PipelineDefinition;
  warnings: PipelineSelectionWarning[];
}

const LEGACY_ROCKET_SIGNAL_LABELS: Record<
  LegacyRocketAutoSelectionSignal,
  string
> = {
  customerProfilePath: "customerProfilePath",
  customerBrandId: "customerBrandId",
  componentMappings: "componentMappings",
  customerProfileMappings: "customer-profile component mappings",
  customerProfileImportAliases: "customer-profile import aliases",
  directMuiEmotionMappings: "direct MUI/Emotion mappings",
};

export const DEFAULT_PIPELINE_DEFINITION: PipelineDefinition = {
  id: "default",
  displayName: "Default",
  description:
    "OSS React, TypeScript, and Tailwind pipeline for deterministic generated apps.",
  visibility: "oss",
  deterministic: true,
  template: {
    bundleId: "react-tailwind-app",
    path: "template/react-tailwind-app",
    stack: {
      framework: "react",
      language: "typescript",
      styling: "tailwind",
      bundler: "vite",
    },
  },
  supportedSourceModes: [...ALLOWED_FIGMA_SOURCE_MODES],
  supportedScopes: ["board", "node", "selection"],
  buildSubmissionPlan: () =>
    buildSubmissionPipelinePlan({
      codegenGenerateService: DefaultCodegenGenerateService,
    }),
  buildRegenerationPlan: () =>
    buildRegenerationPipelinePlan({
      codegenGenerateService: DefaultCodegenGenerateService,
    }),
  buildRetryPlan: ({ retryStage }) =>
    buildRetryPipelinePlan({
      codegenGenerateService: DefaultCodegenGenerateService,
      retryStage,
    }),
};

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
    definitions: [
      DEFAULT_PIPELINE_DEFINITION,
      ROCKET_PIPELINE_DEFINITION,
    ].filter((definition) =>
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

const normalizeLegacyRocketSignals = (
  signals: readonly LegacyRocketAutoSelectionSignal[] | undefined,
): LegacyRocketAutoSelectionSignal[] => {
  if (signals === undefined || signals.length === 0) {
    return [];
  }
  return [...new Set(signals)];
};

const createLegacyRocketAutoSelectionWarning = (
  signals: LegacyRocketAutoSelectionSignal[],
): PipelineSelectionWarning => {
  const labels = signals.map((signal) => LEGACY_ROCKET_SIGNAL_LABELS[signal]);
  return {
    code: "LEGACY_ROCKET_AUTO_SELECTED",
    signals,
    message:
      "Omitted pipelineId selected the legacy Rocket compatibility pipeline " +
      `because Rocket-specific inputs were provided: ${labels.join(", ")}. ` +
      "Set pipelineId='rocket' explicitly; this compatibility fallback is deprecated.",
  };
};

const createDefaultPipelineUnsupportedInputMessage = (
  signals: LegacyRocketAutoSelectionSignal[],
): string => {
  const labels = signals.map((signal) => LEGACY_ROCKET_SIGNAL_LABELS[signal]);
  return (
    "Pipeline 'default' does not support Rocket-specific inputs: " +
    `${labels.join(", ")}. ` +
    "Use pipelineId='rocket' or remove the Rocket-specific inputs."
  );
};

export const selectPipeline = ({
  registry = getDefaultPipelineRegistry(),
  legacyRocketAutoSelectionSignals,
  requestedPipelineId,
  sourceMode,
  scope,
}: {
  registry?: PipelineRegistry;
  legacyRocketAutoSelectionSignals?: readonly LegacyRocketAutoSelectionSignal[];
  requestedPipelineId?: WorkspacePipelineId | undefined;
  sourceMode: WorkspaceFigmaSourceMode;
  scope: WorkspacePipelineScope;
}): PipelineSelectionResult => {
  const available = registry.list();
  const normalizedRequestedPipelineId = requestedPipelineId?.trim();
  const legacyRocketSignals = normalizeLegacyRocketSignals(
    legacyRocketAutoSelectionSignals,
  );
  const warnings: PipelineSelectionWarning[] = [];

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
    const defaultPipeline =
      available.find((definition) => definition.id === "default") ?? undefined;
    const rocketPipeline =
      available.find((definition) => definition.id === "rocket") ?? undefined;
    if (
      defaultPipeline !== undefined &&
      rocketPipeline !== undefined &&
      legacyRocketSignals.length > 0
    ) {
      selected = rocketPipeline;
      warnings.push(
        createLegacyRocketAutoSelectionWarning(legacyRocketSignals),
      );
    } else {
      selected = defaultPipeline;
    }
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
  if (selected.id === "default" && legacyRocketSignals.length > 0) {
    throw new PipelineRequestError({
      code: "PIPELINE_INPUT_UNSUPPORTED",
      pipelineId: selected.id,
      message: createDefaultPipelineUnsupportedInputMessage(
        legacyRocketSignals,
      ),
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

  return { definition: selected, warnings };
};

export const selectPipelineDefinition = (
  input: Parameters<typeof selectPipeline>[0],
): PipelineDefinition => selectPipeline(input).definition;
