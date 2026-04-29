import type {
  WorkspaceComponentMappingRule,
  WorkspaceGitPrStatus,
  WorkspaceJobRetryStage,
} from "../../contracts/index.js";
import type { PipelineStagePlanEntry } from "../pipeline/orchestrator.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import type { PipelineExecutionContext } from "../pipeline/context.js";
import type { StageArtifactContract, StageService } from "../pipeline/stage-service.js";
import type { SubmissionJobInput } from "../types.js";
import { CodegenGenerateService } from "./codegen-generate-service.js";
import type { CodegenGenerateStageInput } from "./codegen-generate-types.js";
import { FigmaSourceService } from "./figma-source-service.js";
import type { FigmaSourceStageInput } from "./figma-source-service.js";
import { GitPrService } from "./git-pr-service.js";
import type { GitPrStageInput } from "./git-pr-service.js";
import { IrDeriveService } from "./ir-derive-service.js";
import type { IrDeriveStageInput } from "./ir-derive-service.js";
import { ReproExportService } from "./repro-export-service.js";
import { TemplatePrepareService } from "./template-prepare-service.js";
import { ValidateProjectService } from "./validate-project-service.js";

export interface PipelinePlanServiceOverrides {
  codegenGenerateService?: StageService<CodegenGenerateStageInput> | undefined;
  templatePrepareService?: StageService<void> | undefined;
}

const requireSubmissionInput = (
  context: PipelineExecutionContext,
): SubmissionJobInput => {
  if (!context.input) {
    throw new Error(
      "Submission input is missing for pipeline stage resolution.",
    );
  }
  return context.input;
};

const buildFigmaSourceInput = (
  context: PipelineExecutionContext,
): FigmaSourceStageInput => {
  const input = requireSubmissionInput(context);
  return {
    ...(input.figmaFileKey !== undefined
      ? { figmaFileKey: input.figmaFileKey }
      : {}),
    ...(input.figmaNodeId !== undefined
      ? { figmaNodeId: input.figmaNodeId }
      : {}),
    ...(input.figmaAccessToken !== undefined
      ? { figmaAccessToken: input.figmaAccessToken }
      : {}),
    ...(input.figmaJsonPath !== undefined
      ? { figmaJsonPath: input.figmaJsonPath }
      : {}),
    ...(input.requestSourceMode !== undefined
      ? { requestSourceMode: input.requestSourceMode }
      : {}),
  };
};

const resolveComponentMappingsFromContext = (
  context: PipelineExecutionContext,
): WorkspaceComponentMappingRule[] | undefined => {
  if (context.mode === "submission") {
    return context.input?.componentMappings;
  }
  if (context.regenerationInput?.componentMappings !== undefined) {
    return context.regenerationInput.componentMappings;
  }
  return context.sourceJob?.request.componentMappings;
};

const hasPatternComponentMappings = ({
  componentMappings,
}: {
  componentMappings: WorkspaceComponentMappingRule[] | undefined;
}): boolean => {
  return componentMappings?.some((rule) => !rule.nodeId?.trim()) ?? false;
};

const buildCodegenInput = ({
  boardKeySeed,
  context,
}: {
  boardKeySeed: string;
  context: PipelineExecutionContext;
}): CodegenGenerateStageInput => {
  const input = context.input;
  const sourceRequest = context.sourceJob?.request;
  const componentMappings = resolveComponentMappingsFromContext(context);
  return {
    boardKeySeed,
    ...(input?.figmaFileKey !== undefined
      ? { figmaFileKey: input.figmaFileKey }
      : sourceRequest?.figmaFileKey !== undefined
        ? { figmaFileKey: sourceRequest.figmaFileKey }
        : {}),
    ...(input?.figmaAccessToken !== undefined
      ? { figmaAccessToken: input.figmaAccessToken }
      : {}),
    ...(componentMappings !== undefined ? { componentMappings } : {}),
    ...(context.retryInput?.retryStage === "codegen.generate" &&
    context.retryInput.retryTargets &&
    context.retryInput.retryTargets.length > 0
      ? { retryTargets: context.retryInput.retryTargets }
      : {}),
  };
};

const resolveFigmaSourceArtifacts = (
  context: PipelineExecutionContext,
): StageArtifactContract => {
  return {
    writes: [
      STAGE_ARTIFACT_KEYS.figmaCleaned,
      STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
      STAGE_ARTIFACT_KEYS.figmaCleanedReport,
      ...(context.resolvedFigmaSourceMode === "local_json"
        ? [STAGE_ARTIFACT_KEYS.figmaRaw]
        : []),
    ],
  };
};

const resolveCodegenArtifactContract = (
  context: PipelineExecutionContext,
): StageArtifactContract => {
  const reads: NonNullable<StageArtifactContract["reads"]> = [];
  const isStorybookFirst = Boolean(
    context.requestedStorybookStaticDir ?? context.resolvedStorybookStaticDir,
  );
  if (isStorybookFirst) {
    reads.push(
      STAGE_ARTIFACT_KEYS.storybookTokens,
      STAGE_ARTIFACT_KEYS.storybookThemes,
      STAGE_ARTIFACT_KEYS.componentMatchReport,
    );
  }
  if (
    hasPatternComponentMappings({
      componentMappings: resolveComponentMappingsFromContext(context),
    })
  ) {
    reads.push(STAGE_ARTIFACT_KEYS.figmaAnalysis);
  }
  return {
    reads,
    optionalReads: [STAGE_ARTIFACT_KEYS.figmaLibraryResolution],
  };
};

const buildIrDeriveInput = (
  context: PipelineExecutionContext,
): IrDeriveStageInput => {
  const input = requireSubmissionInput(context);
  return {
    ...(input.figmaFileKey !== undefined
      ? { figmaFileKey: input.figmaFileKey }
      : {}),
    ...(input.figmaAccessToken !== undefined
      ? { figmaAccessToken: input.figmaAccessToken }
      : {}),
  };
};

const buildGitPrSkipStatus = (reason: string): WorkspaceGitPrStatus => {
  return {
    status: "skipped",
    reason,
  };
};

const STAGE_RANK = new Map<WorkspaceJobRetryStage, number>([
  ["figma.source", 0],
  ["ir.derive", 1],
  ["template.prepare", 2],
  ["codegen.generate", 3],
]);

const isStageBeforeRetryStage = ({
  stageName,
  retryStage,
}: {
  stageName: WorkspaceJobRetryStage;
  retryStage: WorkspaceJobRetryStage;
}): boolean => {
  return (STAGE_RANK.get(stageName) ?? 0) < (STAGE_RANK.get(retryStage) ?? 0);
};

export const buildSubmissionPipelinePlan = ({
  codegenGenerateService = CodegenGenerateService,
  templatePrepareService = TemplatePrepareService,
}: PipelinePlanServiceOverrides = {}): PipelineStagePlanEntry[] => {
  return [
    {
      service: FigmaSourceService,
      resolveInput: buildFigmaSourceInput,
      resolveArtifacts: resolveFigmaSourceArtifacts,
      artifacts: {
        writes: [
          STAGE_ARTIFACT_KEYS.figmaCleaned,
          STAGE_ARTIFACT_KEYS.figmaCleanedReport,
          STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
          STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
        ],
      },
    },
    {
      service: IrDeriveService,
      resolveInput: buildIrDeriveInput,
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.figmaCleaned,
          STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
          STAGE_ARTIFACT_KEYS.figmaCleanedReport,
        ],
        optionalReads: [STAGE_ARTIFACT_KEYS.pasteDeltaExecution],
        writes: [
          STAGE_ARTIFACT_KEYS.designIr,
          STAGE_ARTIFACT_KEYS.figmaAnalysis,
          STAGE_ARTIFACT_KEYS.businessTestIntentIr,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.llmCapabilitiesEvidence,
          STAGE_ARTIFACT_KEYS.storybookCatalog,
          STAGE_ARTIFACT_KEYS.storybookEvidence,
          STAGE_ARTIFACT_KEYS.storybookTokens,
          STAGE_ARTIFACT_KEYS.storybookThemes,
          STAGE_ARTIFACT_KEYS.storybookComponents,
          STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
          STAGE_ARTIFACT_KEYS.componentMatchReport,
          STAGE_ARTIFACT_KEYS.figmaScreenshotReferences,
          STAGE_ARTIFACT_KEYS.figmaScreenshotPipelineReport,
        ],
      },
    },
    {
      service: templatePrepareService,
      artifacts: {
        optionalReads: [STAGE_ARTIFACT_KEYS.pasteDeltaExecution],
        writes: [STAGE_ARTIFACT_KEYS.generatedProject],
      },
    },
    {
      service: codegenGenerateService,
      resolveArtifacts: resolveCodegenArtifactContract,
      resolveInput: (context) =>
        buildCodegenInput({
          context,
          boardKeySeed:
            context.input?.figmaFileKey?.trim() ||
            context.input?.figmaJsonPath?.trim() ||
            "local-json",
        }),
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.designIr],
        optionalReads: [STAGE_ARTIFACT_KEYS.pasteDeltaExecution],
        writes: [
          STAGE_ARTIFACT_KEYS.generatedProject,
          STAGE_ARTIFACT_KEYS.codegenSummary,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationMetrics,
          STAGE_ARTIFACT_KEYS.componentManifest,
          STAGE_ARTIFACT_KEYS.generationDiffContext,
        ],
      },
    },
    {
      service: ValidateProjectService,
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.generatedProject,
          STAGE_ARTIFACT_KEYS.generationDiffContext,
        ],
        optionalReads: [
          STAGE_ARTIFACT_KEYS.storybookCatalog,
          STAGE_ARTIFACT_KEYS.storybookEvidence,
          STAGE_ARTIFACT_KEYS.storybookTokens,
          STAGE_ARTIFACT_KEYS.storybookThemes,
          STAGE_ARTIFACT_KEYS.storybookComponents,
          STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
          STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
          STAGE_ARTIFACT_KEYS.componentMatchReport,
          STAGE_ARTIFACT_KEYS.figmaScreenshotReferences,
        ],
        writes: [
          STAGE_ARTIFACT_KEYS.validationSummary,
          STAGE_ARTIFACT_KEYS.validationSummaryFile,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationDiff,
          STAGE_ARTIFACT_KEYS.generationDiffFile,
          STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
          STAGE_ARTIFACT_KEYS.visualAuditActualImage,
          STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
          STAGE_ARTIFACT_KEYS.visualAuditReport,
          STAGE_ARTIFACT_KEYS.visualAuditResult,
          STAGE_ARTIFACT_KEYS.visualQualityResult,
        ],
      },
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
        writes: [STAGE_ARTIFACT_KEYS.reproPath],
      },
    },
    {
      service: GitPrService,
      resolveInput: (context): GitPrStageInput =>
        requireSubmissionInput(context),
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
          value: buildGitPrSkipStatus(reason),
        });
      },
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.generatedProject,
          STAGE_ARTIFACT_KEYS.generationDiff,
        ],
        writes: [STAGE_ARTIFACT_KEYS.gitPrStatus],
        skipWrites: [STAGE_ARTIFACT_KEYS.gitPrStatus],
      },
    },
  ];
};

export const buildRegenerationPipelinePlan = ({
  codegenGenerateService = CodegenGenerateService,
  templatePrepareService = TemplatePrepareService,
}: PipelinePlanServiceOverrides = {}): PipelineStagePlanEntry[] => {
  return [
    {
      service: FigmaSourceService,
      shouldSkip: (context) =>
        `Reusing source from job '${context.regenerationInput?.sourceJobId ?? "unknown"}'.`,
    },
    {
      service: IrDeriveService,
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.regenerationSourceIr,
          STAGE_ARTIFACT_KEYS.regenerationOverrides,
        ],
        writes: [
          STAGE_ARTIFACT_KEYS.designIr,
          STAGE_ARTIFACT_KEYS.figmaAnalysis,
          STAGE_ARTIFACT_KEYS.businessTestIntentIr,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.storybookCatalog,
          STAGE_ARTIFACT_KEYS.storybookEvidence,
          STAGE_ARTIFACT_KEYS.storybookTokens,
          STAGE_ARTIFACT_KEYS.storybookThemes,
          STAGE_ARTIFACT_KEYS.storybookComponents,
          STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
          STAGE_ARTIFACT_KEYS.componentMatchReport,
        ],
      },
    },
    {
      service: templatePrepareService,
      artifacts: {
        writes: [STAGE_ARTIFACT_KEYS.generatedProject],
      },
    },
    {
      service: codegenGenerateService,
      resolveArtifacts: resolveCodegenArtifactContract,
      resolveInput: (context) =>
        buildCodegenInput({
          context,
          boardKeySeed:
            context.sourceJob?.request.figmaFileKey?.trim() ||
            context.sourceJob?.request.figmaJsonPath?.trim() ||
            "regeneration",
        }),
      artifacts: {
        reads: [STAGE_ARTIFACT_KEYS.designIr],
        writes: [
          STAGE_ARTIFACT_KEYS.generatedProject,
          STAGE_ARTIFACT_KEYS.codegenSummary,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationMetrics,
          STAGE_ARTIFACT_KEYS.componentManifest,
          STAGE_ARTIFACT_KEYS.generationDiffContext,
        ],
      },
    },
    {
      service: ValidateProjectService,
      artifacts: {
        reads: [
          STAGE_ARTIFACT_KEYS.generatedProject,
          STAGE_ARTIFACT_KEYS.generationDiffContext,
        ],
        optionalReads: [
          STAGE_ARTIFACT_KEYS.storybookCatalog,
          STAGE_ARTIFACT_KEYS.storybookEvidence,
          STAGE_ARTIFACT_KEYS.storybookTokens,
          STAGE_ARTIFACT_KEYS.storybookThemes,
          STAGE_ARTIFACT_KEYS.storybookComponents,
          STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
          STAGE_ARTIFACT_KEYS.componentMatchReport,
        ],
        writes: [
          STAGE_ARTIFACT_KEYS.validationSummary,
          STAGE_ARTIFACT_KEYS.validationSummaryFile,
        ],
        optionalWrites: [
          STAGE_ARTIFACT_KEYS.generationDiff,
          STAGE_ARTIFACT_KEYS.generationDiffFile,
          STAGE_ARTIFACT_KEYS.visualAuditReferenceImage,
          STAGE_ARTIFACT_KEYS.visualAuditActualImage,
          STAGE_ARTIFACT_KEYS.visualAuditDiffImage,
          STAGE_ARTIFACT_KEYS.visualAuditReport,
          STAGE_ARTIFACT_KEYS.visualAuditResult,
          STAGE_ARTIFACT_KEYS.visualQualityResult,
        ],
      },
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
        writes: [STAGE_ARTIFACT_KEYS.reproPath],
      },
    },
    {
      service: GitPrService,
      shouldSkip: () => "Git/PR flow not applicable for regeneration jobs.",
      onSkipped: async (context, reason) => {
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.gitPrStatus,
          stage: "git.pr",
          value: buildGitPrSkipStatus(reason),
        });
      },
      artifacts: {
        writes: [STAGE_ARTIFACT_KEYS.gitPrStatus],
        skipWrites: [STAGE_ARTIFACT_KEYS.gitPrStatus],
      },
    },
  ];
};

export const buildRetryPipelinePlan = ({
  codegenGenerateService,
  retryStage,
  templatePrepareService,
}: {
  retryStage: WorkspaceJobRetryStage;
} & PipelinePlanServiceOverrides): PipelineStagePlanEntry[] => {
  const plan = buildSubmissionPipelinePlan({
    codegenGenerateService,
    templatePrepareService,
  });
  return plan.map((entry) => {
    const stageName = entry.service.stageName;
    if (
      (stageName === "figma.source" ||
        stageName === "ir.derive" ||
        stageName === "template.prepare" ||
        stageName === "codegen.generate") &&
      isStageBeforeRetryStage({
        stageName,
        retryStage,
      })
    ) {
      return {
        ...entry,
        shouldSkip: () =>
          `Reusing persisted artifacts from retry source before stage '${retryStage}'.`,
      };
    }
    return entry;
  });
};
