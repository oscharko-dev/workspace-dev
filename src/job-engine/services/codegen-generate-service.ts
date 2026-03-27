import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exportImageAssetsFromFigma } from "../image-export.js";
import { createPipelineError, getErrorMessage } from "../errors.js";
import { runGenerationDiff } from "../generation-diff.js";
import { resolveBoardKey } from "../../parity/board-key.js";
import { buildComponentManifest } from "../../parity/component-manifest.js";
import { generateArtifactsStreaming } from "../../parity/generator-core.js";
import type { StreamingArtifactEvent } from "../../parity/generator-core.js";
import type { DesignIR } from "../../parity/types-ir.js";
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
  runGenerationDiffFn: typeof runGenerationDiff;
}

export const createCodegenGenerateService = ({
  exportImageAssetsFromFigmaFn = exportImageAssetsFromFigma,
  generateArtifactsStreamingFn = generateArtifactsStreaming,
  buildComponentManifestFn = buildComponentManifest,
  runGenerationDiffFn = runGenerationDiff
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

      const generator = generateArtifactsStreamingFn({
        projectDir: context.paths.generatedProjectDir,
        ir,
        iconMapFilePath: context.paths.iconMapFilePath,
        designSystemFilePath: context.paths.designSystemFilePath,
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
        const manifest = await buildComponentManifestFn({
          projectDir: context.paths.generatedProjectDir,
          screens: ir.screens
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

      try {
        const boardKey = resolveBoardKey(input.boardKeySeed);
        const diffReport = await runGenerationDiffFn({
          generatedProjectDir: context.paths.generatedProjectDir,
          jobDir: context.paths.jobDir,
          outputRoot: context.resolvedPaths.outputRoot,
          boardKey,
          jobId: context.jobId
        });
        const diffReportPath = path.join(context.paths.jobDir, "generation-diff.json");
        await context.artifactStore.setValue({
          key: STAGE_ARTIFACT_KEYS.generationDiff,
          stage: "codegen.generate",
          value: diffReport
        });
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.generationDiffFile,
          stage: "codegen.generate",
          absolutePath: diffReportPath
        });
        context.log({
          level: "info",
          message: `Generation diff: ${diffReport.summary}`
        });
      } catch (error) {
        context.log({
          level: "warn",
          message: `Generation diff computation failed: ${getErrorMessage(error)}`
        });
      }
    }
  };
};

export const CodegenGenerateService: StageService<CodegenGenerateStageInput> = createCodegenGenerateService();
