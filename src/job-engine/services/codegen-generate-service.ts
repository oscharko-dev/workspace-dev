import path from "node:path";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { exportImageAssetsFromFigma } from "../image-export.js";
import { createPipelineError, getErrorMessage } from "../errors.js";
import type { GenerationDiffContext } from "../generation-diff.js";
import type { WorkspaceComponentMappingRule } from "../../contracts/index.js";
import { describeComponentMappingRule, resolveComponentMappingRules } from "../../component-mapping-rules.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { buildComponentManifest } from "../../parity/component-manifest.js";
import type { ComponentManifest } from "../../parity/component-manifest.js";
import { resolveEmittedScreenTargets } from "../../parity/emitted-screen-targets.js";
import { generateArtifactsStreaming } from "../../parity/generator-core.js";
import type { StreamingArtifactEvent } from "../../parity/generator-core.js";
import type { FigmaAnalysis } from "../../parity/figma-analysis.js";
import type { ComponentMappingWarning } from "../../parity/types-mapping.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { toCustomerProfileDesignSystemConfigFromComponentMatchReport } from "../../customer-profile.js";
import { parseStorybookThemesArtifact, parseStorybookTokensArtifact } from "../../storybook/artifact-validation.js";
import { resolveStorybookTheme } from "../../storybook/theme-resolver.js";
import { pruneDesignIrToSelectedNodeIds } from "../scoped-design-ir.js";
import type {
  ComponentMatchReportIconResolutionRecord,
  ComponentMatchReportArtifact,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact
} from "../../storybook/types.js";
import type { FigmaLibraryResolutionArtifact } from "../figma-library-resolution.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import { isDesignIRShape, validatedJsonParse } from "../pipeline/pipeline-schemas.js";
import {
  downgradePasteDeltaExecutionToFull,
  isPasteDeltaExecutionState,
  type PasteDeltaExecutionState,
} from "../paste-delta-execution.js";

export interface CodegenGenerateStageInput {
  figmaFileKey?: string;
  figmaAccessToken?: string;
  boardKeySeed: string;
  componentMappings?: WorkspaceComponentMappingRule[];
  customerProfileDesignSystemConfigSource?: "storybook_first";
  retryTargets?: string[];
}

export interface CodegenFailedTarget {
  kind: "generated_file";
  stage: "codegen.generate";
  targetId: string;
  displayName: string;
  filePath: string;
  emittedScreenId: string;
}

export interface CodegenGenerateSummary {
  generatedPaths: string[];
  failedTargets?: CodegenFailedTarget[];
  generationMetrics?: Record<string, unknown>;
  themeApplied?: boolean;
  screenApplied?: number;
  screenTotal?: number;
  screenRejected?: unknown[];
  llmWarnings?: Array<{ code: string; message: string }>;
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
  };
  mappingDiagnostics?: Record<string, unknown>;
  mappingWarnings?: ComponentMappingWarning[];
  iconWarnings?: Array<{ code?: string; message: string }>;
}

interface CodegenGenerateServiceDeps {
  exportImageAssetsFromFigmaFn: typeof exportImageAssetsFromFigma;
  generateArtifactsStreamingFn: typeof generateArtifactsStreaming;
  buildComponentManifestFn: typeof buildComponentManifest;
  resolveStorybookThemeFn: typeof resolveStorybookTheme;
}

const collectScreenNodeIds = (screen: Pick<DesignIR["screens"][number], "id" | "children">): ReadonlySet<string> => {
  const nodeIds = new Set<string>([screen.id]);
  const stack = [...screen.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    nodeIds.add(node.id);
    if (Array.isArray(node.children) && node.children.length > 0) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return nodeIds;
};

const buildManifestAssociationNodeIdsByScreenId = ({
  ir,
  emittedScreenResolution
}: {
  ir: DesignIR;
  emittedScreenResolution: ReturnType<typeof resolveEmittedScreenTargets>;
}): Map<string, ReadonlySet<string>> => {
  const nodeIdsByScreenId = new Map(
    ir.screens.map((screen) => [screen.id, collectScreenNodeIds(screen)] as const)
  );

  return new Map(
    emittedScreenResolution.emittedTargets.map((target) => {
      const associatedNodeIds = new Set<string>(nodeIdsByScreenId.get(target.screen.id) ?? []);
      if (target.family) {
        for (const memberScreenId of target.family.memberScreenIds) {
          const memberNodeIds = nodeIdsByScreenId.get(memberScreenId);
          if (!memberNodeIds) {
            continue;
          }
          for (const nodeId of memberNodeIds) {
            associatedNodeIds.add(nodeId);
          }
        }
      }
      return [target.emittedScreenId, associatedNodeIds] as const;
    })
  );
};

const normalizeOptionalString = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const collectBoardKeyMismatchWarnings = ({
  componentMappings,
  currentBoardKey,
  boardKeySeed
}: {
  componentMappings: readonly WorkspaceComponentMappingRule[];
  currentBoardKey: string;
  boardKeySeed: string;
}): ComponentMappingWarning[] => {
  const acceptedBoardKeys = new Set<string>([currentBoardKey]);
  const normalizedBoardKeySeed = normalizeOptionalString(boardKeySeed);
  if (normalizedBoardKeySeed) {
    acceptedBoardKeys.add(normalizedBoardKeySeed);
  }

  return componentMappings.flatMap((rule) => {
    const declaredBoardKey = normalizeOptionalString(rule.boardKey);
    if (!declaredBoardKey || acceptedBoardKeys.has(declaredBoardKey)) {
      return [];
    }

    return [
      {
        code: "W_COMPONENT_MAPPING_BOARD_KEY_MISMATCH",
        message:
          `Component mapping rule ${describeComponentMappingRule({ rule })} declares boardKey '${declaredBoardKey}' ` +
          `but current generation boardKey is '${currentBoardKey}'; applying override for compatibility.`
      }
    ];
  });
};

const parseComponentMatchReportArtifact = ({
  input
}: {
  input: string;
}): ComponentMatchReportArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("artifact" in parsed) ||
    (parsed as Record<string, unknown>).artifact !== "component.match_report" ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error("Expected a component.match_report artifact with an entries array.");
  }
  return parsed as ComponentMatchReportArtifact;
};

const parseFigmaAnalysisArtifact = ({
  input
}: {
  input: string;
}): FigmaAnalysis => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("componentFamilies" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).componentFamilies)
  ) {
    throw new Error("Expected a figma.analysis artifact with a componentFamilies array.");
  }
  return parsed as FigmaAnalysis;
};

const parseFigmaLibraryResolutionArtifact = ({
  input
}: {
  input: string;
}): FigmaLibraryResolutionArtifact => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("artifact" in parsed) ||
    (parsed as Record<string, unknown>).artifact !== "figma.library_resolution" ||
    !("entries" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).entries)
  ) {
    throw new Error("Expected a figma.library_resolution artifact with an entries array.");
  }
  return parsed as FigmaLibraryResolutionArtifact;
};

const parseComponentManifestArtifact = ({
  input
}: {
  input: string;
}): ComponentManifest => {
  const parsed: unknown = JSON.parse(input);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("screens" in parsed) ||
    !Array.isArray((parsed as Record<string, unknown>).screens)
  ) {
    throw new Error("Expected a component manifest with a screens array.");
  }
  return parsed as ComponentManifest;
};

const resolveDeltaTargetIds = ({
  manifest,
  changedNodeIds
}: {
  manifest: ComponentManifest;
  changedNodeIds: readonly string[];
}): string[] => {
  const changedNodeIdSet = new Set(changedNodeIds);
  const targetIds = new Set<string>();
  for (const screen of manifest.screens) {
    if (changedNodeIdSet.has(screen.screenId)) {
      targetIds.add(screen.screenId);
      continue;
    }
    if (screen.components.some((component) => changedNodeIdSet.has(component.irNodeId))) {
      targetIds.add(screen.screenId);
    }
  }
  return Array.from(targetIds).sort((left, right) => left.localeCompare(right));
};

const rankIconResolutionStatus = (value: ComponentMatchReportIconResolutionRecord["status"]): number => {
  switch (value) {
    case "resolved_import":
      return 0;
    case "wrapper_fallback_allowed":
      return 1;
    case "wrapper_fallback_denied":
      return 2;
    case "unresolved":
      return 3;
    case "ambiguous":
      return 4;
    case "not_applicable":
      return 5;
  }
};

const buildStorybookFirstIconLookup = ({
  artifact
}: {
  artifact: ComponentMatchReportArtifact;
}): ReadonlyMap<string, ComponentMatchReportIconResolutionRecord> => {
  const iconLookup = new Map<string, ComponentMatchReportIconResolutionRecord>();
  for (const entry of artifact.entries) {
    if (!entry.iconResolution) {
      continue;
    }
    for (const [iconKey, resolution] of Object.entries(entry.iconResolution.byKey)) {
      const existing = iconLookup.get(iconKey);
      if (!existing) {
        iconLookup.set(iconKey, resolution);
        continue;
      }
      if (rankIconResolutionStatus(resolution.status) < rankIconResolutionStatus(existing.status)) {
        iconLookup.set(iconKey, resolution);
      }
    }
  }
  return iconLookup;
};

const writeManifestAtomically = async ({
  manifestPath,
  payload
}: {
  manifestPath: string;
  payload: unknown;
}): Promise<void> => {
  const temporaryPath = `${manifestPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await rename(temporaryPath, manifestPath);
};

const collectGeneratedPaths = async ({
  projectDir,
  currentDir = projectDir,
}: {
  projectDir: string;
  currentDir?: string;
}): Promise<string[]> => {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return [];
  }
  const generatedPaths: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      generatedPaths.push(
        ...(await collectGeneratedPaths({
          projectDir,
          currentDir: absolutePath,
        })),
      );
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    generatedPaths.push(path.relative(projectDir, absolutePath).split(path.sep).join("/"));
  }
  generatedPaths.sort((left, right) => left.localeCompare(right));
  return generatedPaths;
};

const collectRemovedDeltaFilePaths = ({
  sourceManifest,
  currentIdentitiesByScreenId,
}: {
  sourceManifest: ComponentManifest;
  currentIdentitiesByScreenId: ReadonlyMap<
    string,
    { filePath: string }
  >;
}): string[] => {
  const currentFilePaths = new Set(
    Array.from(currentIdentitiesByScreenId.values()).map(
      (identity) => identity.filePath,
    ),
  );
  const removedFilePaths = new Set<string>();
  for (const screen of sourceManifest.screens) {
    if (!currentFilePaths.has(screen.file)) {
      removedFilePaths.add(screen.file);
    }
  }
  return Array.from(removedFilePaths).sort((left, right) =>
    left.localeCompare(right),
  );
};

const toSafeGeneratedProjectPath = ({
  projectDir,
  relativePath,
}: {
  projectDir: string;
  relativePath: string;
}): string | null => {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    return null;
  }
  const resolvedProjectDir = path.resolve(projectDir);
  const absolutePath = path.resolve(projectDir, trimmed);
  if (
    absolutePath !== resolvedProjectDir &&
    !absolutePath.startsWith(`${resolvedProjectDir}${path.sep}`)
  ) {
    return null;
  }
  return absolutePath;
};

export const createCodegenGenerateService = ({
  exportImageAssetsFromFigmaFn = exportImageAssetsFromFigma,
  generateArtifactsStreamingFn = generateArtifactsStreaming,
  buildComponentManifestFn = buildComponentManifest,
  resolveStorybookThemeFn = resolveStorybookTheme
}: Partial<CodegenGenerateServiceDeps> = {}): StageService<CodegenGenerateStageInput> => {
  return {
    stageName: "codegen.generate",
    execute: async (input, context) => {
      const designIrPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.designIr);
      const currentBoardKey = resolveBoardKey(input.boardKeySeed);

      let ir: DesignIR;
      try {
        ir = validatedJsonParse({
          raw: await readFile(designIrPath, "utf8"),
          guard: isDesignIRShape,
          schema: "DesignIR",
          filePath: designIrPath
        });
      } catch (error) {
        throw createPipelineError({
          code: "E_IR_EMPTY",
          stage: "codegen.generate",
          message: "Design IR is missing before code generation.",
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      if (
        context.mode === "submission" &&
        Array.isArray(context.input?.selectedNodeIds) &&
        context.input.selectedNodeIds.length > 0
      ) {
        ir = pruneDesignIrToSelectedNodeIds({
          ir,
          selectedNodeIds: context.input.selectedNodeIds,
        });
        await writeFile(designIrPath, `${JSON.stringify(ir, null, 2)}\n`, "utf8");
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.designIr,
          stage: "codegen.generate",
          absolutePath: designIrPath,
        });
      }

      if (context.mode === "submission" && context.generationLocaleResolution.warningMessage) {
        context.log({
          level: "warn",
          message: context.generationLocaleResolution.warningMessage
        });
      }

      const pasteDeltaExecution =
        await context.artifactStore.getValue<PasteDeltaExecutionState>(
          STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
          isPasteDeltaExecutionState,
        );
      const downgradePasteDeltaExecution = async (
        fallbackReason: string,
      ): Promise<PasteDeltaExecutionState | undefined> => {
        if (!pasteDeltaExecution) {
          return undefined;
        }
        const downgraded = downgradePasteDeltaExecutionToFull({
          state: pasteDeltaExecution,
          fallbackReason,
        });
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
          stage: "codegen.generate",
          value: downgraded,
        });
        context.job.pasteDeltaSummary = { ...downgraded.summary };
        await context.syncPublicJobProjection();
        return downgraded;
      };

      let imageAssetMap: Record<string, string> = {};
      if (context.mode === "submission") {
        if (!context.runtime.exportImages) {
          context.log({
            level: "info",
            message: "Image asset export disabled by runtime configuration."
          });
        } else if (context.resolvedFigmaSourceMode === "local_json") {
          context.log({
            level: "info",
            message: "Image asset export skipped for figmaSourceMode=local_json."
          });
        } else {
          const fileKey = input.figmaFileKey?.trim();
          const accessToken = input.figmaAccessToken?.trim();
          if (!fileKey || !accessToken) {
            context.log({
              level: "warn",
              message: "Image asset export skipped because figmaFileKey/figmaAccessToken are missing."
            });
          } else {
            try {
              const exportResult = await exportImageAssetsFromFigmaFn({
                fileKey,
                accessToken,
                ir,
                generatedProjectDir: context.paths.generatedProjectDir,
                fetchImpl: context.fetchWithCancellation,
                timeoutMs: context.runtime.figmaTimeoutMs,
                maxRetries: context.runtime.figmaMaxRetries,
                onLog: (message) => {
                  context.log({
                    level: message.toLowerCase().includes("warning") ? "warn" : "info",
                    message
                  });
                }
              });
              imageAssetMap = exportResult.imageAssetMap;
            } catch (error) {
              context.log({
                level: "warn",
                message: `Image asset export failed; falling back to placeholders: ${getErrorMessage(error)}`
              });
            }
          }
        }
      }

      let resolvedStorybookTheme: ReturnType<typeof resolveStorybookThemeFn> | undefined;
      let customerProfileDesignSystemConfig:
        | ReturnType<typeof toCustomerProfileDesignSystemConfigFromComponentMatchReport>["config"]
        | undefined;
      let customerProfileDesignSystemConfigSource: "storybook_first" | undefined;
      let storybookFirstIconLookup: ReadonlyMap<string, ComponentMatchReportIconResolutionRecord> | undefined;
      let componentMatchReportArtifact: ComponentMatchReportArtifact | undefined;
      let figmaLibraryResolutionArtifact: FigmaLibraryResolutionArtifact | undefined;
      const isStorybookFirst = Boolean(context.requestedStorybookStaticDir ?? context.resolvedStorybookStaticDir);
      if (isStorybookFirst) {
        if (!context.resolvedCustomerProfile) {
          throw createPipelineError({
            code: "E_STORYBOOK_THEME_CUSTOMER_PROFILE_REQUIRED",
            stage: "codegen.generate",
            message:
              "Storybook-first code generation requires a resolved customer profile when storybookStaticDir is enabled.",
            limits: context.runtime.pipelineDiagnosticLimits
          });
        }
        if (!context.resolvedCustomerBrandId) {
          throw createPipelineError({
            code: "E_STORYBOOK_THEME_CUSTOMER_BRAND_REQUIRED",
            stage: "codegen.generate",
            message:
              "Storybook-first code generation requires customerBrandId when storybookStaticDir is enabled.",
            limits: context.runtime.pipelineDiagnosticLimits
          });
        }

        const storybookTokensPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.storybookTokens);
        const storybookThemesPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.storybookThemes);

        let tokensArtifact: StorybookPublicTokensArtifact;
        let themesArtifact: StorybookPublicThemesArtifact;
        try {
          tokensArtifact = parseStorybookTokensArtifact({
            input: await readFile(storybookTokensPath, "utf8")
          });
          themesArtifact = parseStorybookThemesArtifact({
            input: await readFile(storybookThemesPath, "utf8")
          });
        } catch (error) {
          throw createPipelineError({
            code: "E_STORYBOOK_THEME_ARTIFACT_INVALID",
            stage: "codegen.generate",
            message: "Storybook theme artifacts are unreadable or malformed.",
            cause: error,
            limits: context.runtime.pipelineDiagnosticLimits
          });
        }

        try {
          resolvedStorybookTheme = resolveStorybookThemeFn({
            customerBrandId: context.resolvedCustomerBrandId,
            customerProfile: context.resolvedCustomerProfile,
            tokensArtifact,
            themesArtifact
          });
        } catch (error) {
          if (error instanceof Error && "code" in error) {
            const resolverError = error as Error & { code: string; details?: Record<string, unknown> };
            throw createPipelineError({
              code: resolverError.code,
              stage: "codegen.generate",
              message: resolverError.message,
              cause: error,
              ...(resolverError.details
                ? {
                    diagnostics: [
                      {
                        code: resolverError.code,
                        message: resolverError.message,
                        suggestion:
                          "Fix the selected Storybook brand mapping or Storybook public token artifacts so the required theme surfaces are present.",
                        details: resolverError.details
                      }
                    ]
                  }
                : {}),
              limits: context.runtime.pipelineDiagnosticLimits
            });
          }
          throw error;
        }

        try {
          const componentMatchReportPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.componentMatchReport);
          componentMatchReportArtifact = parseComponentMatchReportArtifact({
            input: await readFile(componentMatchReportPath, "utf8")
          });
        } catch (error) {
          throw createPipelineError({
            code: "E_COMPONENT_MATCH_REPORT_INVALID",
            stage: "codegen.generate",
            message:
              "Storybook-first code generation requires a readable component.match_report artifact when storybookStaticDir is enabled.",
            cause: error,
            limits: context.runtime.pipelineDiagnosticLimits
          });
        }

        const matchReportDesignSystemConfig = toCustomerProfileDesignSystemConfigFromComponentMatchReport({
          artifact: componentMatchReportArtifact
        });
        customerProfileDesignSystemConfig =
          matchReportDesignSystemConfig.config ?? {
            library: "__customer_profile__",
            mappings: {}
          };
        customerProfileDesignSystemConfigSource = "storybook_first";
        storybookFirstIconLookup = buildStorybookFirstIconLookup({
          artifact: componentMatchReportArtifact
        });
        for (const warning of matchReportDesignSystemConfig.warnings) {
          context.log({
            level: "warn",
            message: warning
          });
        }
      }

      let resolvedComponentMappings = input.componentMappings;
      let initialMappingWarnings: ReturnType<typeof resolveComponentMappingRules>["mappingWarnings"] = [];
      if (resolvedComponentMappings && resolvedComponentMappings.length > 0) {
        const boardKeyMismatchWarnings = collectBoardKeyMismatchWarnings({
          componentMappings: resolvedComponentMappings,
          currentBoardKey,
          boardKeySeed: input.boardKeySeed
        });
        const hasPatternComponentMappings = resolvedComponentMappings.some((rule) => !rule.nodeId?.trim());
        let figmaAnalysisArtifact: FigmaAnalysis | undefined;
        if (hasPatternComponentMappings) {
          try {
            const figmaAnalysisPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.figmaAnalysis);
            figmaAnalysisArtifact = parseFigmaAnalysisArtifact({
              input: await readFile(figmaAnalysisPath, "utf8")
            });
          } catch (error) {
            throw createPipelineError({
              code: "E_FIGMA_ANALYSIS_INVALID",
              stage: "codegen.generate",
              message: "Pattern component mapping overrides require a readable figma.analysis artifact.",
              cause: error,
              limits: context.runtime.pipelineDiagnosticLimits
            });
          }
        }

        if (hasPatternComponentMappings && !componentMatchReportArtifact) {
          const componentMatchReportPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.componentMatchReport);
          if (componentMatchReportPath) {
            try {
              componentMatchReportArtifact = parseComponentMatchReportArtifact({
                input: await readFile(componentMatchReportPath, "utf8")
              });
            } catch (error) {
              throw createPipelineError({
                code: "E_COMPONENT_MATCH_REPORT_INVALID",
                stage: "codegen.generate",
                message: "Pattern component mapping overrides require a readable component.match_report artifact.",
                cause: error,
                limits: context.runtime.pipelineDiagnosticLimits
              });
            }
          }

          const figmaLibraryResolutionPath = await context.artifactStore.getPath(STAGE_ARTIFACT_KEYS.figmaLibraryResolution);
          if (figmaLibraryResolutionPath) {
            try {
              figmaLibraryResolutionArtifact = parseFigmaLibraryResolutionArtifact({
                input: await readFile(figmaLibraryResolutionPath, "utf8")
              });
            } catch (error) {
              throw createPipelineError({
                code: "E_FIGMA_LIBRARY_RESOLUTION_INVALID",
                stage: "codegen.generate",
                message: "Pattern component mapping overrides require a readable figma.library_resolution artifact when present.",
                cause: error,
                limits: context.runtime.pipelineDiagnosticLimits
              });
            }
          }
        }

        const resolvedComponentMappingResult = resolveComponentMappingRules({
          componentMappings: resolvedComponentMappings,
          ir,
          ...(figmaAnalysisArtifact ? { figmaAnalysis: figmaAnalysisArtifact } : {}),
          ...(componentMatchReportArtifact ? { componentMatchReportArtifact } : {}),
          ...(figmaLibraryResolutionArtifact ? { figmaLibraryResolutionArtifact } : {})
        });
        resolvedComponentMappings = resolvedComponentMappingResult.componentMappings;
        initialMappingWarnings = [...boardKeyMismatchWarnings, ...resolvedComponentMappingResult.mappingWarnings];
        for (const warning of initialMappingWarnings) {
          context.log({
            level: "warn",
            message: warning.message
          });
        }
      }

      const fullEmittedScreenResolution = resolveEmittedScreenTargets({ ir });
      const requestedRetryTargets = input.retryTargets
        ?.map((value) => value.trim())
        .filter((value) => value.length > 0);
      let requestedTargetIds = requestedRetryTargets;
      let removedDeltaFilePaths: string[] = [];
      let sourceComponentManifest: ComponentManifest | undefined;
      const isDeltaNoChanges =
        context.mode === "submission" &&
        pasteDeltaExecution?.eligibleForReuse === true &&
        pasteDeltaExecution.summary.strategy === "no_changes";

      if (
        !requestedTargetIds &&
        context.mode === "submission" &&
        pasteDeltaExecution?.eligibleForReuse === true &&
        pasteDeltaExecution.summary.strategy === "delta"
      ) {
        const sourceManifestPath = path.join(
          context.paths.generatedProjectDir,
          "component-manifest.json",
        );
        try {
          sourceComponentManifest = parseComponentManifestArtifact({
            input: await readFile(sourceManifestPath, "utf8"),
          });
          const deltaTargetIds = resolveDeltaTargetIds({
            manifest: sourceComponentManifest,
            changedNodeIds: pasteDeltaExecution.changedNodeIds,
          });
          if (deltaTargetIds.length === 0) {
            await downgradePasteDeltaExecution("codegen_target_mapping_failed");
          } else {
            const removableTargetIds = new Set<string>();
            const hasPathDrift = deltaTargetIds.some((targetId) => {
              const previousScreen = sourceComponentManifest?.screens.find(
                (screen) => screen.screenId === targetId,
              );
              const nextIdentity =
                fullEmittedScreenResolution.emittedIdentitiesByScreenId.get(
                  targetId,
                );
              if (previousScreen && !nextIdentity) {
                removableTargetIds.add(targetId);
                return false;
              }
              return (
                !previousScreen ||
                !nextIdentity ||
                previousScreen.file !== nextIdentity.filePath
              );
            });
            if (hasPathDrift) {
              await downgradePasteDeltaExecution("codegen_target_path_changed");
            } else {
              requestedTargetIds = deltaTargetIds.filter(
                (targetId) => !removableTargetIds.has(targetId),
              );
              removedDeltaFilePaths = sourceComponentManifest.screens
                .filter((screen) => removableTargetIds.has(screen.screenId))
                .map((screen) => screen.file)
                .sort((left, right) => left.localeCompare(right));
            }
          }
        } catch (error) {
          context.log({
            level: "warn",
            message:
              `Delta target resolution failed; regenerating fully instead: ${getErrorMessage(error)}`,
          });
          await downgradePasteDeltaExecution("codegen_target_resolution_failed");
        }
      }

      if (
        sourceComponentManifest &&
        pasteDeltaExecution?.eligibleForReuse === true &&
        pasteDeltaExecution.summary.strategy === "delta"
      ) {
        for (const filePath of collectRemovedDeltaFilePaths({
          sourceManifest: sourceComponentManifest,
          currentIdentitiesByScreenId:
            fullEmittedScreenResolution.emittedIdentitiesByScreenId,
        })) {
          if (!removedDeltaFilePaths.includes(filePath)) {
            removedDeltaFilePaths.push(filePath);
          }
        }
        removedDeltaFilePaths.sort((left, right) => left.localeCompare(right));
      }

      const hasTargetFilter =
        requestedTargetIds !== undefined || removedDeltaFilePaths.length > 0;
      const selectedTargets =
        hasTargetFilter
          ? fullEmittedScreenResolution.emittedTargets.filter((target) => {
              const identity = fullEmittedScreenResolution.emittedIdentitiesByScreenId.get(
                target.emittedScreenId
              );
              return (
                Boolean(
                  requestedTargetIds?.includes(target.emittedScreenId) ||
                    (identity
                      ? requestedTargetIds?.includes(identity.filePath)
                      : false),
                )
              );
            })
          : fullEmittedScreenResolution.emittedTargets;

      if (requestedTargetIds && requestedTargetIds.length > 0 && selectedTargets.length === 0) {
        throw createPipelineError({
          code: "E_RETRY_TARGETS_INVALID",
          stage: "codegen.generate",
          message: "No requested generate-stage retry targets matched the persisted emitted screen targets.",
          retryable: false,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      const selectedScreenIds = new Set<string>();
      const selectedFamilyIds = new Set<string>();
      for (const target of selectedTargets) {
        selectedScreenIds.add(target.screen.id);
        if (target.family) {
          selectedFamilyIds.add(target.family.familyId);
          for (const memberScreenId of target.family.memberScreenIds) {
            selectedScreenIds.add(memberScreenId);
          }
        }
      }

      const generationIr =
        !hasTargetFilter ||
        selectedTargets.length === fullEmittedScreenResolution.emittedTargets.length
          ? ir
          : {
              ...ir,
              screens: ir.screens.filter((screen) => selectedScreenIds.has(screen.id)),
              screenVariantFamilies: (ir.screenVariantFamilies ?? []).filter((family) =>
                selectedFamilyIds.has(family.familyId)
              )
        };

      const generator = generateArtifactsStreamingFn({
        projectDir: context.paths.generatedProjectDir,
        ir: generationIr,
        ...(resolvedComponentMappings ? { componentMappings: resolvedComponentMappings } : {}),
        iconMapFilePath: context.paths.iconMapFilePath,
        designSystemFilePath: context.paths.designSystemFilePath,
        ...(context.resolvedCustomerProfile ? { customerProfile: context.resolvedCustomerProfile } : {}),
        ...(customerProfileDesignSystemConfigSource === "storybook_first"
          ? {
              customerProfileDesignSystemConfig: customerProfileDesignSystemConfig ?? {
                library: "__customer_profile__",
                mappings: {}
              }
            }
          : customerProfileDesignSystemConfig
            ? { customerProfileDesignSystemConfig }
            : {}),
        ...(customerProfileDesignSystemConfigSource ? { customerProfileDesignSystemConfigSource } : {}),
        ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
        ...(resolvedStorybookTheme ? { resolvedStorybookTheme } : {}),
        ...(Object.keys(imageAssetMap).length > 0 ? { imageAssetMap } : {}),
        ...(initialMappingWarnings.length > 0 ? { initialMappingWarnings } : {}),
        generationLocale: context.resolvedGenerationLocale,
        routerMode: context.runtime.routerMode,
        formHandlingMode: context.resolvedFormHandlingMode,
        llmModelName: "deterministic",
        llmCodegenMode: "deterministic",
        onLog: (message) => {
          context.log({
            level: "info",
            message
          });
        }
      });
      const emittedScreenResolution = resolveEmittedScreenTargets({ ir: generationIr });
      const fullManifestAssociationNodeIdsByScreenId = buildManifestAssociationNodeIdsByScreenId({
        ir,
        emittedScreenResolution: fullEmittedScreenResolution
      });
      const manifestAssociationNodeIdsByScreenId = buildManifestAssociationNodeIdsByScreenId({
        ir,
        emittedScreenResolution
      });
      const emittedScreenIdsByFilePath = new Map(
        Array.from(emittedScreenResolution.emittedIdentitiesByScreenId.entries()).map(([screenId, identity]) => [
          identity.filePath,
          screenId
        ] as const)
      );
      const manifestPath = path.join(context.paths.generatedProjectDir, "component-manifest.json");
      const publishedScreenIds = new Set<string>();
      let generatedProjectPublished = false;

      const removeDeltaFiles = async (): Promise<void> => {
        for (const relativePath of removedDeltaFilePaths) {
          const absolutePath = toSafeGeneratedProjectPath({
            projectDir: context.paths.generatedProjectDir,
            relativePath,
          });
          if (!absolutePath) {
            context.log({
              level: "warn",
              message:
                `Skipped deleting stale delta artifact outside the generated project root: '${relativePath}'.`,
            });
            continue;
          }
          try {
            await unlink(absolutePath);
          } catch (error) {
            const code =
              typeof error === "object" &&
              error !== null &&
              "code" in error &&
              typeof (error as { code?: unknown }).code === "string"
                ? (error as { code: string }).code
                : "";
            if (code !== "ENOENT") {
              context.log({
                level: "warn",
                message:
                  `Could not delete stale delta artifact '${relativePath}': ${getErrorMessage(error)}`,
              });
            }
          }
        }
      };

      const publishGeneratedProject = async (): Promise<void> => {
        if (generatedProjectPublished) {
          return;
        }
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.generatedProject,
          stage: "codegen.generate",
          absolutePath: context.paths.generatedProjectDir
        });
        generatedProjectPublished = true;
      };

      const publishManifest = async ({
        screenIds
      }: {
        screenIds: ReadonlySet<string>;
      }): Promise<void> => {
        if (screenIds.size === 0) {
          return;
        }

        const screens = emittedScreenResolution.emittedScreens.filter((screen) =>
          screenIds.has(screen.id)
        );
        const identitiesByScreenId = new Map(
          screens.map((screen) => {
            const identity = emittedScreenResolution.emittedIdentitiesByScreenId.get(screen.id);
            if (!identity) {
              throw new Error(`Missing emitted screen identity for '${screen.id}'.`);
            }
            return [screen.id, identity] as const;
          })
        );
        const associatedNodeIdsByScreenId = new Map(
          screens.map((screen) => [
            screen.id,
            manifestAssociationNodeIdsByScreenId.get(screen.id) ?? new Set<string>()
          ] as const)
        );
        const manifest = await buildComponentManifestFn({
          projectDir: context.paths.generatedProjectDir,
          screens,
          identitiesByScreenId,
          associatedNodeIdsByScreenId
        });
        await writeManifestAtomically({
          manifestPath,
          payload: manifest
        });
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.componentManifest,
          stage: "codegen.generate",
          absolutePath: manifestPath
        });
      };

      if (isDeltaNoChanges) {
        await publishGeneratedProject();
        try {
          await publishManifest({
            screenIds: new Set(
              emittedScreenResolution.emittedScreens.map((screen) => screen.id),
            ),
          });
        } catch (error) {
          context.log({
            level: "warn",
            message: `Component manifest refresh failed during no-change delta reuse: ${getErrorMessage(error)}`,
          });
        }

        const generationSummary: CodegenGenerateSummary = {
          generatedPaths: await collectGeneratedPaths({
            projectDir: context.paths.generatedProjectDir,
          }),
        };
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.codegenSummary,
          stage: "codegen.generate",
          value: generationSummary,
        });
        if (generationSummary.generatedPaths.includes("generation-metrics.json")) {
          await context.artifactStore.setPath({
            key: STAGE_ARTIFACT_KEYS.generationMetrics,
            stage: "codegen.generate",
            absolutePath: path.join(
              context.paths.generatedProjectDir,
              "generation-metrics.json",
            ),
          });
        }
        const diffContext: GenerationDiffContext = {
          boardKey: currentBoardKey,
        };
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.generationDiffContext,
          stage: "codegen.generate",
          value: diffContext,
        });
        context.log({
          level: "info",
          message:
            `Skipped code generation because delta execution detected no changes ` +
            `(reused ${generationSummary.generatedPaths.length} generated files).`,
        });
        return;
      }

      if (
        context.mode === "submission" &&
        pasteDeltaExecution?.eligibleForReuse === true &&
        pasteDeltaExecution.summary.strategy === "delta" &&
        selectedTargets.length === 0 &&
        removedDeltaFilePaths.length > 0
      ) {
        await publishGeneratedProject();
        await removeDeltaFiles();
        try {
          const manifest = await buildComponentManifestFn({
            projectDir: context.paths.generatedProjectDir,
            screens: fullEmittedScreenResolution.emittedScreens,
            identitiesByScreenId:
              fullEmittedScreenResolution.emittedIdentitiesByScreenId,
            associatedNodeIdsByScreenId: fullManifestAssociationNodeIdsByScreenId,
          });
          await writeManifestAtomically({
            manifestPath,
            payload: manifest,
          });
          await context.artifactStore.setPath({
            key: STAGE_ARTIFACT_KEYS.componentManifest,
            stage: "codegen.generate",
            absolutePath: manifestPath,
          });
        } catch (error) {
          context.log({
            level: "warn",
            message:
              `Component manifest generation failed during delta removal cleanup: ${getErrorMessage(error)}`,
          });
        }

        const generationSummary: CodegenGenerateSummary = {
          generatedPaths: await collectGeneratedPaths({
            projectDir: context.paths.generatedProjectDir,
          }),
        };
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.codegenSummary,
          stage: "codegen.generate",
          value: generationSummary,
        });
        const diffContext: GenerationDiffContext = {
          boardKey: currentBoardKey,
        };
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.generationDiffContext,
          stage: "codegen.generate",
          value: diffContext,
        });
        context.log({
          level: "info",
          message:
            `Skipped code generation and removed ${removedDeltaFilePaths.length} stale delta artifact(s).`,
        });
        return;
      }

      const publishStreamingArtifacts = async ({
        event
      }: {
        event: StreamingArtifactEvent;
      }): Promise<void> => {
        if (event.type === "progress") {
          return;
        }

        await publishGeneratedProject();

        if (event.type === "metrics" || (event.type === "app" && event.file.path === "generation-metrics.json")) {
          await context.artifactStore.setPath({
            key: STAGE_ARTIFACT_KEYS.generationMetrics,
            stage: "codegen.generate",
            absolutePath: path.join(context.paths.generatedProjectDir, "generation-metrics.json")
          });
        }

        if (event.type === "screen") {
          for (const file of event.files) {
            const emittedScreenId = emittedScreenIdsByFilePath.get(file.path);
            if (emittedScreenId) {
              publishedScreenIds.add(emittedScreenId);
            }
          }

          try {
            await publishManifest({
              screenIds: publishedScreenIds
            });
          } catch (error) {
            context.log({
              level: "warn",
              message: `Progressive component manifest refresh failed: ${getErrorMessage(error)}`
            });
          }
        }

        await context.syncPublicJobProjection();
      };

      let generationSummary: CodegenGenerateSummary | undefined;
      try {
        let iterResult = await generator.next();
        while (!iterResult.done) {
          const event: StreamingArtifactEvent = iterResult.value;
          if (event.type === "progress") {
            context.log({
              level: "info",
              message: `Screen ${event.screenIndex}/${event.screenCount} completed: '${event.screenName}'`
            });
          }
          await publishStreamingArtifacts({ event });
          iterResult = await generator.next();
        }
        generationSummary = iterResult.value as unknown as CodegenGenerateSummary;
      } catch (error) {
        const generatedPaths = await collectGeneratedPaths({
          projectDir: context.paths.generatedProjectDir
        });
        if (generatedPaths.length === 0) {
          throw error;
        }

        await publishGeneratedProject();
        const failedTargets: CodegenFailedTarget[] = emittedScreenResolution.emittedTargets
          .filter((target) => !publishedScreenIds.has(target.screen.id))
          .flatMap((target) => {
            const identity = emittedScreenResolution.emittedIdentitiesByScreenId.get(target.emittedScreenId);
            if (!identity) {
              return [];
            }
            return [
              {
                kind: "generated_file" as const,
                stage: "codegen.generate" as const,
                targetId: target.emittedScreenId,
                displayName: target.screen.name,
                filePath: identity.filePath,
                emittedScreenId: target.emittedScreenId
              }
            ];
          });
        generationSummary = {
          generatedPaths,
          failedTargets
        };
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.codegenSummary,
          stage: "codegen.generate",
          value: generationSummary
        });
        throw createPipelineError({
          code: "E_CODEGEN_PARTIAL",
          stage: "codegen.generate",
          message:
            `Code generation produced ${generatedPaths.length} file(s) but left ` +
            `${failedTargets.length} generated target(s) incomplete.`,
          cause: error,
          retryable: true,
          retryTargets: failedTargets,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      await publishGeneratedProject();
      await removeDeltaFiles();
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.codegenSummary,
        stage: "codegen.generate",
        value: generationSummary
      });

      if (generationSummary.generatedPaths.includes("generation-metrics.json")) {
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.generationMetrics,
          stage: "codegen.generate",
          absolutePath: path.join(context.paths.generatedProjectDir, "generation-metrics.json")
        });
      }

      try {
        const manifest = await buildComponentManifestFn({
          projectDir: context.paths.generatedProjectDir,
          screens: fullEmittedScreenResolution.emittedScreens,
          identitiesByScreenId: fullEmittedScreenResolution.emittedIdentitiesByScreenId,
          associatedNodeIdsByScreenId: fullManifestAssociationNodeIdsByScreenId
        });
        await writeManifestAtomically({
          manifestPath,
          payload: manifest
        });
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.componentManifest,
          stage: "codegen.generate",
          absolutePath: manifestPath
        });
        context.log({
          level: "info",
          message: `Component manifest written with ${manifest.screens.length} screens.`
        });
      } catch (error) {
        context.log({
          level: "warn",
          message: `Component manifest generation failed: ${getErrorMessage(error)}`
        });
      }

      const diffContext: GenerationDiffContext = {
        boardKey: currentBoardKey
      };
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.generationDiffContext,
        stage: "codegen.generate",
        value: diffContext
      });
    }
  };
};

export const CodegenGenerateService: StageService<CodegenGenerateStageInput> = createCodegenGenerateService();
