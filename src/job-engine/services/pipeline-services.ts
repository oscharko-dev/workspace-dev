import type { WorkspaceJobInput, WorkspaceGitPrStatus } from "../../contracts/index.js";
import type { PipelineStagePlanEntry } from "../pipeline/orchestrator.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import type { PipelineExecutionContext } from "../pipeline/context.js";
import { CodegenGenerateService } from "./codegen-generate-service.js";
import type { CodegenGenerateStageInput } from "./codegen-generate-service.js";
import { FigmaSourceService } from "./figma-source-service.js";
import type { FigmaSourceStageInput } from "./figma-source-service.js";
import { GitPrService } from "./git-pr-service.js";
import type { GitPrStageInput } from "./git-pr-service.js";
import { IrDeriveService } from "./ir-derive-service.js";
import { ReproExportService } from "./repro-export-service.js";
import { TemplatePrepareService } from "./template-prepare-service.js";
import { ValidateProjectService } from "./validate-project-service.js";

const requireSubmissionInput = (context: PipelineExecutionContext): WorkspaceJobInput => {
  if (!context.input) {
    throw new Error("Submission input is missing for pipeline stage resolution.");
  }
  return context.input;
};

const buildFigmaSourceInput = (context: PipelineExecutionContext): FigmaSourceStageInput => {
  const input = requireSubmissionInput(context);
  return {
    ...(input.figmaFileKey !== undefined ? { figmaFileKey: input.figmaFileKey } : {}),
    ...(input.figmaAccessToken !== undefined ? { figmaAccessToken: input.figmaAccessToken } : {}),
    ...(input.figmaJsonPath !== undefined ? { figmaJsonPath: input.figmaJsonPath } : {})
  };
};

const buildCodegenInput = ({
  boardKeySeed,
  context
}: {
  boardKeySeed: string;
  context: PipelineExecutionContext;
}): CodegenGenerateStageInput => {
  const input = context.input;
  return {
    boardKeySeed,
    ...(input?.figmaFileKey !== undefined ? { figmaFileKey: input.figmaFileKey } : {}),
    ...(input?.figmaAccessToken !== undefined ? { figmaAccessToken: input.figmaAccessToken } : {})
  };
};

const buildGitPrSkipStatus = (reason: string): WorkspaceGitPrStatus => {
  return {
    status: "skipped",
    reason
  };
};

export const buildSubmissionPipelinePlan = (): PipelineStagePlanEntry[] => {
  return [
    {
      service: FigmaSourceService,
      resolveInput: buildFigmaSourceInput,
      artifacts: {
        writes: [
          STAGE_ARTIFACT_KEYS.figmaRaw,
          STAGE_ARTIFACT_KEYS.figmaCleaned,
          STAGE_ARTIFACT_KEYS.figmaCleanedReport,
          STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics
        ],
        optionalWrites: [STAGE_ARTIFACT_KEYS.figmaHybridEnrichment]
      }
    },
    {
      service: IrDeriveService,
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.figmaCleaned,
          STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
          STAGE_ARTIFACT_KEYS.figmaCleanedReport
        ],
        writes: [STAGE_ARTIFACT_KEYS.designIr]
      }
    },
    {
      service: TemplatePrepareService,
      artifacts: {
        writes: [STAGE_ARTIFACT_KEYS.generatedProject]
      }
    },
    {
      service: CodegenGenerateService,
      resolveInput: (context) =>
        buildCodegenInput({
          context,
          boardKeySeed: context.input?.figmaFileKey?.trim() || context.input?.figmaJsonPath?.trim() || "local-json"
        }),
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.designIr],
        writes: [STAGE_ARTIFACT_KEYS.generatedProject, STAGE_ARTIFACT_KEYS.codegenSummary],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationMetrics,
          STAGE_ARTIFACT_KEYS.componentManifest,
          STAGE_ARTIFACT_KEYS.generationDiffContext
        ]
      }
    },
    {
      service: ValidateProjectService,
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.generatedProject, STAGE_ARTIFACT_KEYS.generationDiffContext],
        writes: [STAGE_ARTIFACT_KEYS.validationSummary],
        optionalWrites: [STAGE_ARTIFACT_KEYS.generationDiff, STAGE_ARTIFACT_KEYS.generationDiffFile]
      }
    },
    {
      service: ReproExportService,
      shouldSkip: (context) => {
        if (context.runtime.previewEnabled) {
          return undefined;
        }
        return "Preview disabled by runtime configuration.";
      },
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.generatedProject],
        writes: [STAGE_ARTIFACT_KEYS.reproPath]
      }
    },
    {
      service: GitPrService,
      resolveInput: (context): GitPrStageInput => requireSubmissionInput(context),
      shouldSkip: (context) => {
        if (context.input?.enableGitPr !== true) {
          return "Git/PR flow disabled by request.";
        }
        return undefined;
      },
      onSkipped: async (context, reason) => {
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.gitPrStatus,
          stage: "git.pr",
          value: buildGitPrSkipStatus(reason)
        });
      },
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.generatedProject, STAGE_ARTIFACT_KEYS.generationDiff],
        writes: [STAGE_ARTIFACT_KEYS.gitPrStatus]
      }
    }
  ];
};

export const buildRegenerationPipelinePlan = (): PipelineStagePlanEntry[] => {
  return [
    {
      service: FigmaSourceService,
      shouldSkip: (context) => `Reusing source from job '${context.regenerationInput?.sourceJobId ?? "unknown"}'.`
    },
    {
      service: IrDeriveService,
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.regenerationSourceIr, STAGE_ARTIFACT_KEYS.regenerationOverrides],
        writes: [STAGE_ARTIFACT_KEYS.designIr]
      }
    },
    {
      service: TemplatePrepareService,
      artifacts: {
        writes: [STAGE_ARTIFACT_KEYS.generatedProject]
      }
    },
    {
      service: CodegenGenerateService,
      resolveInput: (context) =>
        buildCodegenInput({
          context,
          boardKeySeed:
            context.sourceJob?.request.figmaFileKey?.trim() || context.sourceJob?.request.figmaJsonPath?.trim() || "regeneration"
        }),
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.designIr],
        writes: [STAGE_ARTIFACT_KEYS.generatedProject, STAGE_ARTIFACT_KEYS.codegenSummary],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationMetrics,
          STAGE_ARTIFACT_KEYS.componentManifest,
          STAGE_ARTIFACT_KEYS.generationDiffContext
        ]
      }
    },
    {
      service: ValidateProjectService,
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.generatedProject, STAGE_ARTIFACT_KEYS.generationDiffContext],
        writes: [STAGE_ARTIFACT_KEYS.validationSummary],
        optionalWrites: [STAGE_ARTIFACT_KEYS.generationDiff, STAGE_ARTIFACT_KEYS.generationDiffFile]
      }
    },
    {
      service: ReproExportService,
      shouldSkip: (context) => {
        if (context.runtime.previewEnabled) {
          return undefined;
        }
        return "Preview disabled by runtime configuration.";
      },
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.generatedProject],
        writes: [STAGE_ARTIFACT_KEYS.reproPath]
      }
    },
    {
      service: GitPrService,
      shouldSkip: () => "Git/PR flow not applicable for regeneration jobs.",
      onSkipped: async (context, reason) => {
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.gitPrStatus,
          stage: "git.pr",
          value: buildGitPrSkipStatus(reason)
        });
      },
      artifacts: {
        writes: [STAGE_ARTIFACT_KEYS.gitPrStatus]
      }
    }
  ];
};
