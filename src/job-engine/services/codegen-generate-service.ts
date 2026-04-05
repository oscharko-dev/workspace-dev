import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exportImageAssetsFromFigma } from "../image-export.js";
import { createPipelineError, getErrorMessage } from "../errors.js";
import type { GenerationDiffContext } from "../generation-diff.js";
import type { WorkspaceComponentMappingRule } from "../../contracts/index.js";
import { describeComponentMappingRule, resolveComponentMappingRules } from "../../component-mapping-rules.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { buildComponentManifest } from "../../parity/component-manifest.js";
import { resolveEmittedScreenTargets } from "../../parity/emitted-screen-targets.js";
import { generateArtifactsStreaming } from "../../parity/generator-core.js";
import type { StreamingArtifactEvent } from "../../parity/generator-core.js";
import type { FigmaAnalysis } from "../../parity/figma-analysis.js";
import type { ComponentMappingWarning } from "../../parity/types-mapping.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { toCustomerProfileDesignSystemConfigFromComponentMatchReport } from "../../customer-profile.js";
import { parseStorybookThemesArtifact, parseStorybookTokensArtifact } from "../../storybook/artifact-validation.js";
import { resolveStorybookTheme } from "../../storybook/theme-resolver.js";
import type {
  ComponentMatchReportIconResolutionRecord,
  ComponentMatchReportArtifact,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact
} from "../../storybook/types.js";
import type { FigmaLibraryResolutionArtifact } from "../figma-library-resolution.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";

export interface CodegenGenerateStageInput {
  figmaFileKey?: string;
  figmaAccessToken?: string;
  boardKeySeed: string;
  componentMappings?: WorkspaceComponentMappingRule[];
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
        ir = JSON.parse(await readFile(designIrPath, "utf8")) as DesignIR;
      } catch (error) {
        throw createPipelineError({
          code: "E_IR_EMPTY",
          stage: "codegen.generate",
          message: "Design IR is missing before code generation.",
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      if (context.mode === "submission" && context.generationLocaleResolution.warningMessage) {
        context.log({
          level: "warn",
          message: context.generationLocaleResolution.warningMessage
        });
      }

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
        customerProfileDesignSystemConfig = matchReportDesignSystemConfig.config;
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

      const generator = generateArtifactsStreamingFn({
        projectDir: context.paths.generatedProjectDir,
        ir,
        ...(resolvedComponentMappings ? { componentMappings: resolvedComponentMappings } : {}),
        iconMapFilePath: context.paths.iconMapFilePath,
        designSystemFilePath: context.paths.designSystemFilePath,
        ...(context.resolvedCustomerProfile ? { customerProfile: context.resolvedCustomerProfile } : {}),
        ...(customerProfileDesignSystemConfig ? { customerProfileDesignSystemConfig } : {}),
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
      let iterResult = await generator.next();
      while (!iterResult.done) {
        const event: StreamingArtifactEvent = iterResult.value;
        if (event.type === "progress") {
          context.log({
            level: "info",
            message: `Screen ${event.screenIndex}/${event.screenCount} completed: '${event.screenName}'`
          });
        }
        iterResult = await generator.next();
      }

      const generationSummary = iterResult.value;
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.generatedProject,
        stage: "codegen.generate",
        absolutePath: context.paths.generatedProjectDir
      });
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
        const emittedScreenResolution = resolveEmittedScreenTargets({ ir });
        const manifest = await buildComponentManifestFn({
          projectDir: context.paths.generatedProjectDir,
          screens: emittedScreenResolution.emittedScreens,
          identitiesByScreenId: emittedScreenResolution.emittedIdentitiesByScreenId,
          associatedNodeIdsByScreenId: buildManifestAssociationNodeIdsByScreenId({
            ir,
            emittedScreenResolution
          })
        });
        const manifestPath = path.join(context.paths.generatedProjectDir, "component-manifest.json");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
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
