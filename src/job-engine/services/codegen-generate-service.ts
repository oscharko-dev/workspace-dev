import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exportImageAssetsFromFigma } from "../image-export.js";
import { createPipelineError, getErrorMessage } from "../errors.js";
import type { GenerationDiffContext } from "../generation-diff.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { buildComponentManifest } from "../../parity/component-manifest.js";
import { resolveEmittedScreenTargets } from "../../parity/emitted-screen-targets.js";
import { generateArtifactsStreaming } from "../../parity/generator-core.js";
import type { StreamingArtifactEvent } from "../../parity/generator-core.js";
import type { DesignIR } from "../../parity/types-ir.js";
import { toCustomerProfileDesignSystemConfigFromComponentMatchReport } from "../../customer-profile.js";
import { resolveStorybookTheme } from "../../storybook/theme-resolver.js";
import type {
  ComponentMatchReportIconResolutionRecord,
  ComponentMatchReportArtifact,
  StorybookPublicThemesArtifact,
  StorybookPublicTokensArtifact
} from "../../storybook/types.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";

export interface CodegenGenerateStageInput {
  figmaFileKey?: string;
  figmaAccessToken?: string;
  boardKeySeed: string;
}

interface CodegenGenerateServiceDeps {
  exportImageAssetsFromFigmaFn: typeof exportImageAssetsFromFigma;
  generateArtifactsStreamingFn: typeof generateArtifactsStreaming;
  buildComponentManifestFn: typeof buildComponentManifest;
  resolveStorybookThemeFn: typeof resolveStorybookTheme;
}

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
          tokensArtifact = JSON.parse(await readFile(storybookTokensPath, "utf8")) as StorybookPublicTokensArtifact;
          themesArtifact = JSON.parse(await readFile(storybookThemesPath, "utf8")) as StorybookPublicThemesArtifact;
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

        let componentMatchReportArtifact: ComponentMatchReportArtifact;
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

      const generator = generateArtifactsStreamingFn({
        projectDir: context.paths.generatedProjectDir,
        ir,
        iconMapFilePath: context.paths.iconMapFilePath,
        designSystemFilePath: context.paths.designSystemFilePath,
        ...(context.resolvedCustomerProfile ? { customerProfile: context.resolvedCustomerProfile } : {}),
        ...(customerProfileDesignSystemConfig ? { customerProfileDesignSystemConfig } : {}),
        ...(storybookFirstIconLookup ? { storybookFirstIconLookup } : {}),
        ...(resolvedStorybookTheme ? { resolvedStorybookTheme } : {}),
        ...(Object.keys(imageAssetMap).length > 0 ? { imageAssetMap } : {}),
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
          identitiesByScreenId: emittedScreenResolution.emittedIdentitiesByScreenId
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
        boardKey: resolveBoardKey(input.boardKeySeed)
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
