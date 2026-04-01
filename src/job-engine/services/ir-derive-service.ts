import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { WorkspaceJobInput, WorkspaceRegenerationInput } from "../../contracts/index.js";
import { createPipelineError, getErrorMessage, type PipelineDiagnosticInput } from "../errors.js";
import { computeContentHash, computeOptionsHash, loadCachedIr, saveCachedIr } from "../ir-cache.js";
import { applyIrOverrides } from "../ir-overrides.js";
import { buildFigmaAnalysis, buildRegenerationFallbackFigmaAnalysis } from "../../parity/figma-analysis.js";
import { figmaToDesignIrWithOptions } from "../../parity/ir.js";
import type { FigmaFile } from "../../parity/ir-helpers.js";
import type { DesignIR } from "../../parity/types-ir.js";
import type { FigmaFetchDiagnostics, FigmaFileResponse } from "../types.js";
import type { CleanFigmaResult } from "../figma-clean.js";
import type { FigmaMcpEnrichment } from "../../parity/types.js";
import type { StageService } from "../pipeline/stage-service.js";
import { STAGE_ARTIFACT_KEYS } from "../pipeline/artifact-keys.js";
import {
  SCREEN_REJECTION_REASON_MESSAGE,
  SCREEN_REJECTION_REASON_SUGGESTION,
  analyzeScreenCandidateRejections,
  toFigmaNodeUrl,
  toMcpCoverageDiagnostics,
  toSortedReasonCounts
} from "./ir-diagnostics.js";
import {
  resolveFigmaLibraryResolutionArtifact,
  type FigmaLibraryResolutionArtifact
} from "../figma-library-resolution.js";
import {
  buildComponentMatchReportArtifact,
  writeComponentMatchReportArtifact
} from "../../storybook/component-match-report.js";
import {
  createJobStorybookArtifactPaths,
  generateStorybookArtifactsForJob,
  type GeneratedJobStorybookArtifacts
} from "../storybook-artifacts.js";

interface RegenerationSourceIrSeed {
  sourceJobId: string;
  sourceIrFile?: string;
  sourceAnalysisFile?: string;
}

export type IrDeriveStageInput = Pick<WorkspaceJobInput, "figmaFileKey" | "figmaAccessToken">;

export const IrDeriveService: StageService<IrDeriveStageInput | undefined> = {
  stageName: "ir.derive",
  execute: async (input, context) => {
    const persistStorybookArtifactsIfRequested = async (): Promise<GeneratedJobStorybookArtifacts | undefined> => {
      if (!context.resolvedStorybookStaticDir) {
        return undefined;
      }

      try {
        const storybookArtifacts = await generateStorybookArtifactsForJob({
          storybookStaticDir: context.resolvedStorybookStaticDir,
          jobDir: context.paths.jobDir,
          artifactStore: context.artifactStore,
          stage: "ir.derive",
          limits: context.runtime.pipelineDiagnosticLimits
        });
        context.log({
          level: "info",
          message:
            `Generated Storybook artifacts from '${context.requestedStorybookStaticDir ?? context.resolvedStorybookStaticDir}' ` +
            `into '${path.relative(context.paths.jobDir, storybookArtifacts.paths.rootDir) || "."}'.`
        });
        return storybookArtifacts;
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "E_STORYBOOK_TOKEN_EXTRACTION_INVALID"
        ) {
          throw error;
        }
        throw createPipelineError({
          code: "E_STORYBOOK_ARTIFACTS_FAILED",
          stage: "ir.derive",
          message:
            `Failed to generate Storybook artifacts from '${context.requestedStorybookStaticDir ?? context.resolvedStorybookStaticDir}' ` +
            `(resolved '${context.resolvedStorybookStaticDir}'): ${getErrorMessage(error)}`,
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }
    };

    const persistFigmaLibraryResolutionIfAvailable = async ({
      figmaAnalysis,
      file
    }: {
      figmaAnalysis: ReturnType<typeof buildFigmaAnalysis>;
      file: FigmaFileResponse;
    }): Promise<FigmaLibraryResolutionArtifact | undefined> => {
      const artifact = await resolveFigmaLibraryResolutionArtifact({
        analysis: figmaAnalysis,
        file,
        figmaSourceMode: context.resolvedFigmaSourceMode,
        cacheDir: path.join(context.resolvedPaths.outputRoot, "cache", "figma-library-resolution"),
        ...(input?.figmaFileKey?.trim() ? { fileKey: input.figmaFileKey.trim() } : {}),
        ...(input?.figmaAccessToken?.trim() ? { accessToken: input.figmaAccessToken.trim() } : {}),
        fetchImpl: context.fetchWithCancellation,
        timeoutMs: context.runtime.figmaTimeoutMs,
        maxRetries: context.runtime.figmaMaxRetries,
        abortSignal: context.abortSignal,
        onLog: (message) => {
          context.log({
            level: "info",
            message
          });
        }
      });
      if (!artifact) {
        return undefined;
      }
      const artifactPaths = createJobStorybookArtifactPaths({
        jobDir: context.paths.jobDir
      });
      await mkdir(path.dirname(artifactPaths.figmaLibraryResolutionFile), { recursive: true });
      await writeFile(artifactPaths.figmaLibraryResolutionFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.figmaLibraryResolution,
        stage: "ir.derive",
        absolutePath: artifactPaths.figmaLibraryResolutionFile
      });
      context.log({
        level: artifact.summary.error > 0 || artifact.summary.partial > 0 ? "warn" : "info",
        message:
          `Resolved external Figma libraries for ${artifact.summary.total} component reference(s): ` +
          `resolved=${artifact.summary.resolved}, partial=${artifact.summary.partial}, error=${artifact.summary.error}, ` +
          `cacheHit=${artifact.summary.cacheHit}, offlineReused=${artifact.summary.offlineReused}.`
      });
      return artifact;
    };

    const persistComponentMatchReportIfAvailable = async ({
      figmaAnalysis,
      storybookArtifacts,
      figmaLibraryResolutionArtifact
    }: {
      figmaAnalysis: ReturnType<typeof buildFigmaAnalysis>;
      storybookArtifacts: GeneratedJobStorybookArtifacts | undefined;
      figmaLibraryResolutionArtifact: FigmaLibraryResolutionArtifact | undefined;
    }): Promise<void> => {
      if (!storybookArtifacts) {
        return;
      }

      const artifact = buildComponentMatchReportArtifact({
        figmaAnalysis,
        catalogArtifact: storybookArtifacts.catalogArtifact,
        evidenceArtifact: storybookArtifacts.evidenceArtifact,
        ...(figmaLibraryResolutionArtifact ? { figmaLibraryResolutionArtifact } : {})
      });
      const writtenFile = await writeComponentMatchReportArtifact({
        artifact,
        outputFilePath: storybookArtifacts.paths.componentMatchReportFile
      });
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.componentMatchReport,
        stage: "ir.derive",
        absolutePath: writtenFile
      });
      context.log({
        level: "info",
        message:
          `Generated component match report: matched=${artifact.summary.matched}, ` +
          `ambiguous=${artifact.summary.ambiguous}, unmatched=${artifact.summary.unmatched}.`
      });
    };

    if (context.mode === "regeneration") {
      const sourceReference = await context.artifactStore.requireValue<RegenerationSourceIrSeed>(
        STAGE_ARTIFACT_KEYS.regenerationSourceIr
      );
      const overrides = await context.artifactStore.requireValue<WorkspaceRegenerationInput["overrides"]>(
        STAGE_ARTIFACT_KEYS.regenerationOverrides
      );
      const sourceJobId = sourceReference.sourceJobId;
      const sourceIrPath = sourceReference.sourceIrFile;
      const sourceAnalysisPath = sourceReference.sourceAnalysisFile;
      if (!sourceIrPath) {
        throw createPipelineError({
          code: "E_REGEN_SOURCE_IR_MISSING",
          stage: "ir.derive",
          message: `Source job '${sourceJobId}' has no Design IR artifact.`,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      let rawContent: string;
      try {
        rawContent = await readFile(sourceIrPath, "utf8");
      } catch {
        throw createPipelineError({
          code: "E_REGEN_SOURCE_IR_READ",
          stage: "ir.derive",
          message: `Could not read Design IR from source job '${sourceJobId}'.`,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      let baseIr: DesignIR;
      try {
        baseIr = JSON.parse(rawContent) as DesignIR;
      } catch {
        throw createPipelineError({
          code: "E_REGEN_SOURCE_IR_PARSE",
          stage: "ir.derive",
          message: `Could not parse Design IR from source job '${sourceJobId}'.`,
          limits: context.runtime.pipelineDiagnosticLimits
        });
      }

      const overrideResult = applyIrOverrides({
        ir: baseIr,
        overrides
      });

      await writeFile(context.paths.designIrFile, `${JSON.stringify(overrideResult.ir, null, 2)}\n`, "utf8");
      const regeneratedAnalysis =
        typeof sourceAnalysisPath === "string" && sourceAnalysisPath.trim().length > 0
          ? await readFile(sourceAnalysisPath, "utf8").catch(() => undefined)
          : undefined;
      const analysisContent =
        regeneratedAnalysis ?? `${JSON.stringify(buildRegenerationFallbackFigmaAnalysis({ ir: overrideResult.ir }), null, 2)}\n`;
      await writeFile(context.paths.figmaAnalysisFile, analysisContent.endsWith("\n") ? analysisContent : `${analysisContent}\n`, "utf8");
      context.log({
        level: "info",
        message:
          `Applied ${overrideResult.appliedCount} override(s) to source IR ` +
          `(${overrideResult.skippedCount} skipped, ${overrideResult.ir.screens.length} screens).`
      });
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.designIr,
        stage: "ir.derive",
        absolutePath: context.paths.designIrFile
      });
      await context.artifactStore.setPath({
        key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
        stage: "ir.derive",
        absolutePath: context.paths.figmaAnalysisFile
      });
      return;
    }

    const figmaCleanedPath = await context.artifactStore.requirePath(STAGE_ARTIFACT_KEYS.figmaCleaned);
    const fetchDiagnostics = await context.artifactStore.requireValue<FigmaFetchDiagnostics>(
      STAGE_ARTIFACT_KEYS.figmaFetchDiagnostics
    );
    const cleaningReport = await context.artifactStore.requireValue<CleanFigmaResult["report"]>(
      STAGE_ARTIFACT_KEYS.figmaCleanedReport
    );
    const hybridMcpEnrichment = await context.artifactStore.getValue<FigmaMcpEnrichment>(
      STAGE_ARTIFACT_KEYS.figmaHybridEnrichment
    );

    let cleanedFile: FigmaFileResponse;
    try {
      cleanedFile = JSON.parse(await readFile(figmaCleanedPath, "utf8")) as FigmaFileResponse;
    } catch (error) {
      throw createPipelineError({
        code: "E_FIGMA_PARSE",
        stage: "ir.derive",
        message: "Figma source payload is missing before IR derivation.",
        cause: error,
        limits: context.runtime.pipelineDiagnosticLimits
      });
    }

    const figmaFetch = {
      file: cleanedFile,
      diagnostics: fetchDiagnostics,
      cleaning: cleaningReport
    };
    const figmaAnalysisSource = figmaFetch.file as FigmaFile;

    const emitIrMetricDiagnostics = ({ source }: { source: DesignIR }): void => {
      const budgetTruncatedScreens = [...(source.metrics?.truncatedScreens ?? [])].sort((left, right) => {
        if (left.screenName !== right.screenName) {
          return left.screenName.localeCompare(right.screenName);
        }
        return left.screenId.localeCompare(right.screenId);
      });
      if (budgetTruncatedScreens.length > 0) {
        const diagnostics: PipelineDiagnosticInput[] = budgetTruncatedScreens.slice(0, 8).map((entry) => {
          const figmaUrl = toFigmaNodeUrl({
            fileKey: context.figmaFileKeyForDiagnostics,
            nodeId: entry.screenId
          });
          return {
            code: "W_IR_ELEMENT_BUDGET_TRUNCATION",
            message: `Screen '${entry.screenName}' exceeded element budget (${entry.retainedElements}/${entry.originalElements} retained).`,
            suggestion:
              "Split the screen into smaller sections/components or increase figmaScreenElementBudget if larger screens are intentional.",
            stage: "ir.derive",
            severity: "warning",
            figmaNodeId: entry.screenId,
            ...(figmaUrl ? { figmaUrl } : {}),
            details: {
              screenId: entry.screenId,
              screenName: entry.screenName,
              originalElements: entry.originalElements,
              retainedElements: entry.retainedElements,
              budget: entry.budget
            }
          };
        });
        context.appendDiagnostics({
          diagnostics
        });
      }

      const depthTruncatedScreens = [...(source.metrics?.depthTruncatedScreens ?? [])].sort((left, right) => {
        if (left.screenName !== right.screenName) {
          return left.screenName.localeCompare(right.screenName);
        }
        if (left.firstTruncatedDepth !== right.firstTruncatedDepth) {
          return left.firstTruncatedDepth - right.firstTruncatedDepth;
        }
        return left.screenId.localeCompare(right.screenId);
      });
      if (depthTruncatedScreens.length > 0) {
        const summary = depthTruncatedScreens
          .slice(0, 3)
          .map((entry) => `'${entry.screenName}' branches=${entry.truncatedBranchCount} firstDepth=${entry.firstTruncatedDepth}`)
          .join("; ");
        context.log({
          level: "warn",
          message:
            `Dynamic depth truncation applied on ${depthTruncatedScreens.length} screen(s) ` +
            `(maxDepth=${context.runtime.figmaScreenElementMaxDepth}). ${summary}`
        });

        const diagnostics: PipelineDiagnosticInput[] = depthTruncatedScreens.slice(0, 8).map((entry) => {
          const figmaUrl = toFigmaNodeUrl({
            fileKey: context.figmaFileKeyForDiagnostics,
            nodeId: entry.screenId
          });
          return {
            code: "W_IR_DEPTH_TRUNCATION",
            message: `Depth truncation started at depth ${entry.firstTruncatedDepth} for screen '${entry.screenName}'.`,
            suggestion: "Split deeply nested content into smaller screens/components or increase figmaScreenElementMaxDepth.",
            stage: "ir.derive",
            severity: "warning",
            figmaNodeId: entry.screenId,
            ...(figmaUrl ? { figmaUrl } : {}),
            details: {
              screenId: entry.screenId,
              screenName: entry.screenName,
              maxDepth: entry.maxDepth,
              firstTruncatedDepth: entry.firstTruncatedDepth,
              truncatedBranchCount: entry.truncatedBranchCount
            }
          };
        });
        context.appendDiagnostics({
          diagnostics
        });
      }

      const classificationFallbacks = [...(source.metrics?.classificationFallbacks ?? [])].sort((left, right) => {
        if (left.screenName !== right.screenName) {
          return left.screenName.localeCompare(right.screenName);
        }
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }
        return left.nodeId.localeCompare(right.nodeId);
      });
      if (classificationFallbacks.length > 0) {
        context.log({
          level: "warn",
          message:
            `Classification fallback to container used for ${classificationFallbacks.length} node(s). ` +
            `Top sample: ${classificationFallbacks
              .slice(0, 3)
              .map((entry) => `'${entry.nodeName}'`)
              .join(", ")}`
        });
        const diagnostics: PipelineDiagnosticInput[] = classificationFallbacks.slice(0, 12).map((entry) => {
          const figmaUrl = toFigmaNodeUrl({
            fileKey: context.figmaFileKeyForDiagnostics,
            nodeId: entry.nodeId
          });
          return {
            code: "W_IR_CLASSIFICATION_FALLBACK",
            message: `Node '${entry.nodeName}' fell back to generic 'container' classification.`,
            suggestion:
              "Use clearer component naming/structure (e.g., button/input/list/table semantics) so deterministic classification can resolve a specific type.",
            stage: "ir.derive",
            severity: "warning",
            figmaNodeId: entry.nodeId,
            ...(figmaUrl ? { figmaUrl } : {}),
            details: {
              screenId: entry.screenId,
              screenName: entry.screenName,
              nodeId: entry.nodeId,
              nodeName: entry.nodeName,
              nodeType: entry.nodeType,
              depth: entry.depth,
              ...(entry.layoutMode ? { layoutMode: entry.layoutMode } : {}),
              ...(entry.matchedRulePriority !== undefined
                ? { matchedRulePriority: entry.matchedRulePriority }
                : {})
            }
          };
        });
        context.appendDiagnostics({
          diagnostics
        });
      }

      const mcpCoverage = source.metrics?.mcpCoverage;
      if (mcpCoverage) {
        context.log({
          level: mcpCoverage.fallbackUsed ? "warn" : "info",
          message:
            `MCP enrichment coverage (${mcpCoverage.sourceMode}): ` +
            `variables=${mcpCoverage.variableCount}, styles=${mcpCoverage.styleEntryCount}, ` +
            `codeConnect=${mcpCoverage.codeConnectMappingCount}, designSystem=${mcpCoverage.designSystemMappingCount}, metadata=${mcpCoverage.metadataHintCount}, ` +
            `nodeHints=${mcpCoverage.nodeHintCount}, assets=${mcpCoverage.assetCount}, screenshots=${mcpCoverage.screenshotCount}.`
        });
        context.appendDiagnostics({
          diagnostics: toMcpCoverageDiagnostics({
            stage: "ir.derive",
            diagnostics: mcpCoverage.diagnostics ?? []
          })
        });

        const isHybridEquivalentToRest =
          mcpCoverage.sourceMode === "hybrid" &&
          mcpCoverage.nodeHintCount === 0 &&
          mcpCoverage.metadataHintCount === 0 &&
          mcpCoverage.codeConnectMappingCount === 0 &&
          mcpCoverage.designSystemMappingCount === 0 &&
          mcpCoverage.variableCount === 0 &&
          mcpCoverage.styleEntryCount === 0 &&
          mcpCoverage.assetCount === 0 &&
          mcpCoverage.screenshotCount === 0;
        if (isHybridEquivalentToRest) {
          context.log({
            level: "warn",
            message: "hybrid_equivalent_to_rest: Hybrid mode produced zero MCP enrichment coverage; generated output is effectively REST-equivalent."
          });
          context.appendDiagnostics({
            diagnostics: [
              {
                code: "W_HYBRID_EQUIVALENT_TO_REST",
                message:
                  "hybrid_equivalent_to_rest: Hybrid mode produced zero MCP enrichment coverage and is effectively equivalent to REST output.",
                suggestion:
                  "Use figmaSourceMode=rest for equivalent deterministic output or configure hybrid MCP enrichment (variables, styles, code-connect, metadata, assets).",
                stage: "ir.derive",
                severity: "warning",
                details: {
                  hybridEquivalentToRest: true,
                  toolNames: [...mcpCoverage.toolNames]
                }
              }
            ]
          });
        }
      }
    };

    const buildIrEmptyDiagnostics = (): PipelineDiagnosticInput[] => {
      const { rejectedCandidates, rootCandidateCount } = analyzeScreenCandidateRejections({
        sourceFile: figmaFetch.file
      });
      const reasonCounts = toSortedReasonCounts({
        rejectedCandidates
      });
      if (figmaFetch.cleaning.screenCandidateCount <= 0) {
        reasonCounts["cleaning-removed-candidates"] = 1;
      }
      const candidateDiagnostics: PipelineDiagnosticInput[] = rejectedCandidates.slice(0, 8).map((entry) => {
        const figmaUrl = toFigmaNodeUrl({
          fileKey: context.figmaFileKeyForDiagnostics,
          nodeId: entry.nodeId
        });
        return {
          code: "E_IR_EMPTY_CANDIDATE_REJECTED",
          message: `Rejected node '${entry.nodeName}' (${entry.nodeType}): ${SCREEN_REJECTION_REASON_MESSAGE[entry.reason]}`,
          suggestion: SCREEN_REJECTION_REASON_SUGGESTION[entry.reason],
          stage: "ir.derive",
          severity: "error",
          ...(entry.nodeId ? { figmaNodeId: entry.nodeId } : {}),
          ...(figmaUrl ? { figmaUrl } : {}),
          details: {
            reason: entry.reason,
            ...(entry.pageId ? { pageId: entry.pageId } : {}),
            ...(entry.pageName ? { pageName: entry.pageName } : {}),
            nodeType: entry.nodeType
          }
        };
      });
      return [
        {
          code: "E_IR_EMPTY",
          message: "IR derivation produced zero screens.",
          suggestion: "Provide at least one visible FRAME/COMPONENT root screen and avoid layouts that are fully removed by cleaning.",
          stage: "ir.derive",
          severity: "error",
          details: {
            rootCandidateCount,
            rejectedCandidateCount: rejectedCandidates.length,
            reasonCounts,
            screenCandidateCountAfterCleaning: figmaFetch.cleaning.screenCandidateCount
          }
        },
        ...candidateDiagnostics
      ];
    };

    if (figmaFetch.cleaning.screenCandidateCount <= 0) {
      throw createPipelineError({
        code: "E_FIGMA_CLEAN_EMPTY",
        stage: "ir.derive",
        message: "Figma cleaning removed all screen candidates.",
        limits: context.runtime.pipelineDiagnosticLimits,
        diagnostics: [
          {
            code: "E_FIGMA_CLEAN_EMPTY",
            message: "No screen candidates remained after Figma cleaning.",
            suggestion:
              "Ensure at least one visible FRAME/COMPONENT (or SECTION with FRAME/COMPONENT children) remains after cleaning.",
            stage: "ir.derive",
            severity: "error",
            details: {
              inputNodeCount: figmaFetch.cleaning.inputNodeCount,
              outputNodeCount: figmaFetch.cleaning.outputNodeCount,
              screenCandidateCount: figmaFetch.cleaning.screenCandidateCount,
              removedHiddenNodes: figmaFetch.cleaning.removedHiddenNodes,
              removedPlaceholderNodes: figmaFetch.cleaning.removedPlaceholderNodes,
              removedHelperNodes: figmaFetch.cleaning.removedHelperNodes,
              removedInvalidNodes: figmaFetch.cleaning.removedInvalidNodes
            }
          }
        ]
      });
    }

    const irDerivationOptions = {
      screenElementBudget: context.runtime.figmaScreenElementBudget,
      screenElementMaxDepth: context.runtime.figmaScreenElementMaxDepth,
      brandTheme: context.resolvedBrandTheme,
      figmaSourceMode: context.resolvedFigmaSourceMode,
      ...(hybridMcpEnrichment
        ? { mcpEnrichmentFingerprint: computeContentHash(hybridMcpEnrichment) }
        : {})
    };

    const irCacheLog = (message: string): void => {
      context.log({
        level: "info",
        message
      });
    };

      if (context.runtime.irCacheEnabled) {
      const contentHash = computeContentHash(figmaFetch.file);
      const optionsHash = computeOptionsHash(irDerivationOptions);
      const cached = await loadCachedIr({
        cacheDir: context.paths.irCacheDir,
        contentHash,
        optionsHash,
        ttlMs: context.runtime.irCacheTtlMs,
        onLog: irCacheLog
      });
      if (cached) {
        await writeFile(context.paths.designIrFile, `${JSON.stringify(cached, null, 2)}\n`, "utf8");
        const cachedAnalysis = buildFigmaAnalysis({
          file: figmaAnalysisSource,
          ...(hybridMcpEnrichment ? { enrichment: hybridMcpEnrichment } : {})
        });
        await writeFile(context.paths.figmaAnalysisFile, `${JSON.stringify(cachedAnalysis, null, 2)}\n`, "utf8");
        const figmaLibraryResolutionArtifact = await persistFigmaLibraryResolutionIfAvailable({
          figmaAnalysis: cachedAnalysis,
          file: cleanedFile
        });
        context.log({
          level: "info",
          message: `IR cache hit — skipped derivation. Loaded ${cached.screens.length} screens (brandTheme=${context.resolvedBrandTheme}).`
        });
        emitIrMetricDiagnostics({ source: cached });
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.designIr,
          stage: "ir.derive",
          absolutePath: context.paths.designIrFile
        });
        await context.artifactStore.setPath({
          key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
          stage: "ir.derive",
          absolutePath: context.paths.figmaAnalysisFile
        });
        const storybookArtifacts = await persistStorybookArtifactsIfRequested();
        await persistComponentMatchReportIfAvailable({
          figmaAnalysis: cachedAnalysis,
          storybookArtifacts,
          figmaLibraryResolutionArtifact
        });
        return;
      }
    }

    let derived: ReturnType<typeof figmaToDesignIrWithOptions>;
    try {
      derived = figmaToDesignIrWithOptions(figmaFetch.file, {
        ...irDerivationOptions,
        sourceMetrics: {
          fetchedNodes: figmaFetch.diagnostics.fetchedNodes,
          degradedGeometryNodes: figmaFetch.diagnostics.degradedGeometryNodes
        },
        ...(hybridMcpEnrichment ? { mcpEnrichment: hybridMcpEnrichment } : {})
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("No top-level frames/components found in Figma file")) {
        throw createPipelineError({
          code: "E_IR_EMPTY",
          stage: "ir.derive",
          message: "No screen found in IR.",
          cause: error,
          limits: context.runtime.pipelineDiagnosticLimits,
          diagnostics: buildIrEmptyDiagnostics()
        });
      }
      throw error;
    }
    if (!Array.isArray(derived.screens) || derived.screens.length === 0) {
      throw createPipelineError({
        code: "E_IR_EMPTY",
        stage: "ir.derive",
        message: "No screen found in IR.",
        limits: context.runtime.pipelineDiagnosticLimits,
        diagnostics: buildIrEmptyDiagnostics()
      });
    }
    await writeFile(context.paths.designIrFile, `${JSON.stringify(derived, null, 2)}\n`, "utf8");
    const figmaAnalysis = buildFigmaAnalysis({
      file: figmaAnalysisSource,
      ...(hybridMcpEnrichment ? { enrichment: hybridMcpEnrichment } : {})
    });
    await writeFile(context.paths.figmaAnalysisFile, `${JSON.stringify(figmaAnalysis, null, 2)}\n`, "utf8");
    const figmaLibraryResolutionArtifact = await persistFigmaLibraryResolutionIfAvailable({
      figmaAnalysis,
      file: cleanedFile
    });

    if (context.runtime.irCacheEnabled) {
      const contentHash = computeContentHash(figmaFetch.file);
      const optionsHash = computeOptionsHash(irDerivationOptions);
      await saveCachedIr({
        cacheDir: context.paths.irCacheDir,
        contentHash,
        optionsHash,
        ttlMs: context.runtime.irCacheTtlMs,
        ir: derived,
        onLog: irCacheLog
      });
    }

    emitIrMetricDiagnostics({ source: derived });
    context.log({
      level: "info",
      message:
        `Derived Design IR with ${derived.screens.length} screens (brandTheme=${context.resolvedBrandTheme}, ` +
        `skippedHidden=${derived.metrics?.skippedHidden ?? 0}, skippedPlaceholders=${derived.metrics?.skippedPlaceholders ?? 0}, ` +
        `truncatedScreens=${derived.metrics?.truncatedScreens.length ?? 0}, ` +
        `depthTruncatedScreens=${derived.metrics?.depthTruncatedScreens?.length ?? 0}).`
    });

    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.designIr,
      stage: "ir.derive",
      absolutePath: context.paths.designIrFile
    });
    await context.artifactStore.setPath({
      key: STAGE_ARTIFACT_KEYS.figmaAnalysis,
      stage: "ir.derive",
      absolutePath: context.paths.figmaAnalysisFile
    });
    const storybookArtifacts = await persistStorybookArtifactsIfRequested();
    await persistComponentMatchReportIfAvailable({
      figmaAnalysis,
      storybookArtifacts,
      figmaLibraryResolutionArtifact
    });
  }
};
