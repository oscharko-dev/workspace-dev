import { readFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceJobInput } from "../../contracts/index.js";
import {
  safeParseFigmaPayload,
  summarizeFigmaPayloadValidationError,
} from "../../figma-payload-validation.js";
import { cleanFigmaForCodegen } from "../figma-clean.js";
import { createPipelineError, getErrorMessage } from "../errors.js";
import {
  applyAuthoritativeFigmaSubtrees,
  fetchFigmaFile,
} from "../figma-source.js";
import { writePrettyJsonFile } from "../json-file.js";
import type { FigmaFileResponse } from "../types.js";
import type { FigmaMcpEnrichment } from "../../parity/types.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import {
  isFigmaFileResponseShape,
  validatedJsonParse,
} from "../pipeline/pipeline-schemas.js";

export type FigmaSourceStageInput = Pick<
  WorkspaceJobInput,
  "figmaFileKey" | "figmaNodeId" | "figmaAccessToken" | "figmaJsonPath"
>;

const createHybridFallbackEnrichment = ({
  code,
  message,
}: {
  code: string;
  message: string;
}): FigmaMcpEnrichment => {
  return {
    sourceMode: "hybrid",
    nodeHints: [],
    toolNames: [],
    diagnostics: [
      {
        code,
        message,
        severity: "warning",
        source: "loader",
      },
    ],
  };
};

export const FigmaSourceService: StageService<FigmaSourceStageInput> = {
  stageName: "figma.source",
  execute: async (input, context) => {
    if (context.mode !== "submission") {
      return;
    }

    const writeAndClean = async ({
      sourceFile,
      diagnostics,
    }: {
      sourceFile: FigmaFileResponse;
      diagnostics: {
        sourceMode: "geometry-paths" | "staged-nodes" | "local-json";
        fetchedNodes: number;
        degradedGeometryNodes: string[];
        lowFidelityDetected?: boolean;
        lowFidelityReasons?: string[];
        authoritativeSubtreeCount?: number;
      };
    }) => {
      await writePrettyJsonFile({
        filePath: context.paths.figmaRawJsonFile,
        value: sourceFile,
      });
      const cleaning = cleanFigmaForCodegen({ file: sourceFile });
      await writePrettyJsonFile({
        filePath: context.paths.figmaJsonFile,
        value: cleaning.cleanedFile,
      });
      context.log({
        level: "info",
        message:
          `Figma source mode=${diagnostics.sourceMode}, fetchedNodes=${diagnostics.fetchedNodes}, ` +
          `degradedGeometryNodes=${diagnostics.degradedGeometryNodes.length}, ` +
          `lowFidelity=${diagnostics.lowFidelityDetected === true ? "yes" : "no"}, ` +
          `authoritativeSubtrees=${diagnostics.authoritativeSubtreeCount ?? 0}, ` +
          `cleanedNodes=${cleaning.report.outputNodeCount}/${cleaning.report.inputNodeCount}, ` +
          `removedHidden=${cleaning.report.removedHiddenNodes}, removedPlaceholders=${cleaning.report.removedPlaceholderNodes}, ` +
          `removedHelpers=${cleaning.report.removedHelperNodes}, removedInvalid=${cleaning.report.removedInvalidNodes}, removedProperties=${cleaning.report.removedPropertyCount}`,
      });
      return {
        file: cleaning.cleanedFile,
        diagnostics,
        cleaning: cleaning.report,
      };
    };

    let figmaFetch: {
      file: FigmaFileResponse;
      diagnostics: {
        sourceMode: "geometry-paths" | "staged-nodes" | "local-json";
        fetchedNodes: number;
        degradedGeometryNodes: string[];
        lowFidelityDetected?: boolean;
        lowFidelityReasons?: string[];
        authoritativeSubtreeCount?: number;
      };
      cleaning: ReturnType<typeof cleanFigmaForCodegen>["report"];
    };

    if (context.resolvedFigmaSourceMode === "local_json") {
      const localPath = input.figmaJsonPath?.trim();
      if (!localPath) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_PATH",
          stage: "figma.source",
          message: "figmaJsonPath is required when figmaSourceMode=local_json.",
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      const resolvedLocalPath = path.resolve(localPath);
      let localFileContent: string;
      try {
        localFileContent = await readFile(resolvedLocalPath, "utf8");
      } catch (error) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_READ",
          stage: "figma.source",
          message: `Could not read local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      let parsedLocalFile: unknown;
      try {
        parsedLocalFile = JSON.parse(localFileContent);
      } catch (error) {
        throw createPipelineError({
          code: "E_FIGMA_PARSE",
          stage: "figma.source",
          message: `Could not parse local Figma JSON file '${localPath}': ${getErrorMessage(error)}`,
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      const parsedLocalPayload = safeParseFigmaPayload({
        input: parsedLocalFile,
      });
      if (!parsedLocalPayload.success) {
        throw createPipelineError({
          code: "E_FIGMA_PARSE",
          stage: "figma.source",
          message:
            `Could not parse local Figma JSON file '${localPath}': invalid Figma payload ` +
            `(${summarizeFigmaPayloadValidationError({ error: parsedLocalPayload.error })}).`,
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      context.log({
        level: "info",
        message: `Loaded local Figma JSON from '${resolvedLocalPath}'.`,
      });

      figmaFetch = await writeAndClean({
        sourceFile: parsedLocalPayload.data,
        diagnostics: {
          sourceMode: "local-json",
          fetchedNodes: 0,
          degradedGeometryNodes: [],
        },
      });
    } else {
      const fileKey = input.figmaFileKey?.trim();
      const accessToken = input.figmaAccessToken?.trim();
      if (!fileKey || !accessToken) {
        throw createPipelineError({
          code: "E_FIGMA_REST_INPUT",
          stage: "figma.source",
          message: `figmaFileKey and figmaAccessToken are required when figmaSourceMode=${context.resolvedFigmaSourceMode}.`,
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }
      const result = await fetchFigmaFile({
        fileKey,
        ...(input.figmaNodeId?.trim()
          ? { nodeId: input.figmaNodeId.trim() }
          : {}),
        accessToken,
        timeoutMs: context.runtime.figmaTimeoutMs,
        maxRetries: context.runtime.figmaMaxRetries,
        bootstrapDepth: context.runtime.figmaBootstrapDepth,
        nodeBatchSize: context.runtime.figmaNodeBatchSize,
        nodeFetchConcurrency: context.runtime.figmaNodeFetchConcurrency,
        adaptiveBatchingEnabled: context.runtime.figmaAdaptiveBatchingEnabled,
        maxScreenCandidates: context.runtime.figmaMaxScreenCandidates,
        figmaRestCircuitBreaker: context.runtime.figmaRestCircuitBreaker,
        ...(context.runtime.figmaScreenNamePattern !== undefined
          ? { screenNamePattern: context.runtime.figmaScreenNamePattern }
          : {}),
        cacheEnabled: context.runtime.figmaCacheEnabled,
        cacheTtlMs: context.runtime.figmaCacheTtlMs,
        cacheDir: path.join(
          context.resolvedPaths.outputRoot,
          "cache",
          "figma-source",
        ),
        pipelineDiagnosticLimits: context.runtime.pipelineDiagnosticLimits,
        fetchImpl: context.fetchWithCancellation,
        onLog: (message) => {
          context.log({
            level: "info",
            message,
          });
        },
      });
      figmaFetch = await writeAndClean({
        sourceFile: result.file,
        diagnostics: result.diagnostics,
      });
    }

    const hybridMcpEnrichment =
      context.resolvedFigmaSourceMode !== "hybrid"
        ? undefined
        : await (async (): Promise<FigmaMcpEnrichment> => {
            const fileKey = input.figmaFileKey?.trim();
            const accessToken = input.figmaAccessToken?.trim();
            if (!fileKey || !accessToken) {
              return createHybridFallbackEnrichment({
                code: "W_MCP_ENRICHMENT_SKIPPED",
                message:
                  "Hybrid mode fell back to REST-only derivation because Figma REST credentials were incomplete.",
              });
            }
            if (!context.runtime.figmaMcpEnrichmentLoader) {
              context.log({
                level: "warn",
                stage: "ir.derive",
                message:
                  "Hybrid mode selected, but no figmaMcpEnrichmentLoader is configured. Falling back to REST-only derivation.",
              });
              context.appendDiagnostics({
                stage: "ir.derive",
                diagnostics: [
                  {
                    code: "W_MCP_ENRICHMENT_SKIPPED",
                    message:
                      "Hybrid mode fell back to REST-only derivation because no MCP enrichment loader is configured.",
                    suggestion:
                      "Configure a figmaMcpEnrichmentLoader to supply variables, style catalog, metadata hints, or Code Connect mappings.",
                    stage: "ir.derive",
                    severity: "warning",
                    details: {
                      figmaSourceMode: context.resolvedFigmaSourceMode,
                    },
                  },
                ],
              });
              return createHybridFallbackEnrichment({
                code: "W_MCP_ENRICHMENT_SKIPPED",
                message: "No MCP enrichment loader configured.",
              });
            }
            try {
              const loaded = await context.runtime.figmaMcpEnrichmentLoader({
                figmaFileKey: fileKey,
                figmaAccessToken: accessToken,
                cleanedFile: figmaFetch.file,
                rawFile: validatedJsonParse({
                  raw: await readFile(context.paths.figmaRawJsonFile, "utf8"),
                  guard: isFigmaFileResponseShape,
                  schema: "FigmaFileResponse",
                  filePath: context.paths.figmaRawJsonFile,
                }),
                jobDir: context.paths.jobDir,
                workspaceRoot: context.resolvedWorkspaceRoot,
                fetchImpl: context.fetchWithCancellation,
              });
              if (!loaded) {
                return createHybridFallbackEnrichment({
                  code: "W_MCP_ENRICHMENT_SKIPPED",
                  message:
                    "Hybrid mode loader returned no enrichment; REST-only derivation was used.",
                });
              }
              return loaded;
            } catch (error) {
              const message = getErrorMessage(error);
              context.log({
                level: "warn",
                stage: "ir.derive",
                message: `Hybrid MCP enrichment failed; falling back to REST-only derivation. ${message}`,
              });
              context.appendDiagnostics({
                stage: "ir.derive",
                diagnostics: [
                  {
                    code: "W_MCP_ENRICHMENT_SKIPPED",
                    message:
                      "Hybrid mode fell back to REST-only derivation because MCP enrichment loading failed.",
                    suggestion:
                      "Check the MCP enrichment loader and retry. REST derivation completed without authoritative MCP data.",
                    stage: "ir.derive",
                    severity: "warning",
                    details: {
                      error: message,
                    },
                  },
                ],
              });
              return createHybridFallbackEnrichment({
                code: "W_MCP_ENRICHMENT_SKIPPED",
                message: `MCP enrichment loader failed: ${message}`,
              });
            }
          })();

    const authoritativeSubtrees =
      hybridMcpEnrichment?.authoritativeSubtrees ?? [];
    if (authoritativeSubtrees.length > 0) {
      const rawFile = validatedJsonParse({
        raw: await readFile(context.paths.figmaRawJsonFile, "utf8"),
        guard: isFigmaFileResponseShape,
        schema: "FigmaFileResponse",
        filePath: context.paths.figmaRawJsonFile,
      });
      const mergedSource = applyAuthoritativeFigmaSubtrees({
        file: rawFile,
        subtrees: authoritativeSubtrees,
      });
      if (mergedSource.appliedNodeIds.length > 0) {
        const cleaning = cleanFigmaForCodegen({ file: mergedSource.file });
        await writePrettyJsonFile({
          filePath: context.paths.figmaRawJsonFile,
          value: mergedSource.file,
        });
        await writePrettyJsonFile({
          filePath: context.paths.figmaJsonFile,
          value: cleaning.cleanedFile,
        });
        figmaFetch = {
          ...figmaFetch,
          file: cleaning.cleanedFile,
          diagnostics: {
            ...figmaFetch.diagnostics,
            authoritativeSubtreeCount: mergedSource.appliedNodeIds.length,
          },
          cleaning: cleaning.report,
        };
        context.log({
          level: "info",
          stage: "ir.derive",
          message: `Applied ${mergedSource.appliedNodeIds.length} authoritative subtree snapshot(s) from hybrid enrichment before IR derivation.`,
        });
      }
    }

    if (
      figmaFetch.diagnostics.lowFidelityDetected === true &&
      (figmaFetch.diagnostics.authoritativeSubtreeCount ?? 0) === 0
    ) {
      const lowFidelityReasons =
        figmaFetch.diagnostics.lowFidelityReasons ?? [];
      const summary =
        lowFidelityReasons.length > 0
          ? lowFidelityReasons.join(" ")
          : "REST geometry payload appears structurally weak for this board.";
      context.log({
        level: "error",
        message: `Low-fidelity Figma source detected without authoritative recovery. ${summary}`,
      });
      throw createPipelineError({
        code: "E_FIGMA_LOW_FIDELITY_SOURCE",
        stage: "figma.source",
        message: `Figma source fidelity is too low to generate a reliable screen. ${summary}`,
        limits: context.runtime.pipelineDiagnosticLimits,
        diagnostics: [
          {
            code: "E_FIGMA_LOW_FIDELITY_SOURCE",
            message:
              "Figma REST geometry-paths payload is too low-fidelity for deterministic generation.",
            suggestion:
              context.resolvedFigmaSourceMode === "hybrid"
                ? "Verify authoritative subtree recovery for hybrid mode or use a local_json export for this board."
                : "Retry with figmaSourceMode=hybrid so authoritative subtrees can be recovered, or use a local_json export.",
            stage: "figma.source",
            severity: "error",
            details: {
              figmaSourceMode: context.resolvedFigmaSourceMode,
              sourceMode: figmaFetch.diagnostics.sourceMode,
              reasons: lowFidelityReasons,
            },
          },
        ],
      });
    }

    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.figmaRaw,
      stage: "figma.source",
      absolutePath: context.paths.figmaRawJsonFile,
    });
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.figmaCleaned,
      stage: "figma.source",
      absolutePath: context.paths.figmaJsonFile,
    });
    await context.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics,
      stage: "figma.source",
      value: figmaFetch.diagnostics,
    });
    await context.artifactStore.setValue({
      key: STAGE_ARTIFACT_KEYS.figmaCleanedReport,
      stage: "figma.source",
      value: figmaFetch.cleaning,
    });
    if (hybridMcpEnrichment) {
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
        stage: "figma.source",
        value: hybridMcpEnrichment,
      });
    }
  },
};
