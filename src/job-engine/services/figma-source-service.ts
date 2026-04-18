import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  WorkspaceJobInput,
  WorkspacePasteDeltaSummary,
} from "../../contracts/index.js";
import type { SubmissionJobInput } from "../types.js";
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
import { hasSymlinkInPath, isWithinRoot } from "../preview.js";
import {
  createPasteFingerprintStore,
  type PasteFingerprintManifest,
  type PasteFingerprintNode,
} from "../paste-fingerprint-store.js";
import { diffFigmaPaste } from "../paste-tree-diff.js";
import {
  collectChangedNodeIds,
  isPasteDeltaExecutionState,
  resolvePasteDeltaSummary,
  type PasteDeltaExecutionState,
} from "../paste-delta-execution.js";
import { extractDiffablePasteRoots } from "../paste-delta-roots.js";

const MAX_HYBRID_LOADER_ERROR_MESSAGE_LENGTH = 240;

export type FigmaSourceStageInput = Pick<
  WorkspaceJobInput,
  "figmaFileKey" | "figmaNodeId" | "figmaAccessToken" | "figmaJsonPath"
> &
  Pick<SubmissionJobInput, "requestSourceMode">;

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

const redactSecret = ({
  value,
  secret,
}: {
  value: string;
  secret?: string | undefined;
}): string => {
  if (!secret || secret.trim().length === 0) {
    return value;
  }
  return value.split(secret).join("[REDACTED]");
};

const sanitizeHybridLoaderErrorMessage = ({
  error,
  secret,
}: {
  error: unknown;
  secret?: string | undefined;
}): string => {
  const normalized = redactSecret({
    value: getErrorMessage(error).replace(/\s+/g, " ").trim(),
    secret,
  });
  if (normalized.length === 0) {
    return "MCP enrichment loader failed.";
  }
  return normalized.length > MAX_HYBRID_LOADER_ERROR_MESSAGE_LENGTH
    ? `${normalized.slice(0, MAX_HYBRID_LOADER_ERROR_MESSAGE_LENGTH)}...`
    : normalized;
};

const createAuthenticatedHostFetch = ({
  fetchImpl,
  allowedHostname,
  primaryAuthHeaders,
  retryAuthHeaders,
  shouldRetryWithAlternateAuth,
}: {
  fetchImpl: typeof fetch;
  allowedHostname: string;
  primaryAuthHeaders: Record<string, string>;
  retryAuthHeaders?: Record<string, string>;
  shouldRetryWithAlternateAuth?: (response: Response) => Promise<boolean>;
}): typeof fetch => {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== allowedHostname) {
      throw new Error(
        `Authenticated Figma fetch is restricted to '${allowedHostname}'.`,
      );
    }
    const applyHeaders = (authHeaders: Record<string, string>): Headers => {
      const headers = new Headers(request.headers);
      for (const [key, value] of Object.entries(authHeaders)) {
        headers.set(key, value);
      }
      return headers;
    };

    let response = await fetchImpl(
      new Request(request, {
        headers: applyHeaders(primaryAuthHeaders),
      }),
    );
    if (
      retryAuthHeaders &&
      shouldRetryWithAlternateAuth &&
      (await shouldRetryWithAlternateAuth(response))
    ) {
      response = await fetchImpl(
        new Request(request, {
          headers: applyHeaders(retryAuthHeaders),
        }),
      );
    }
    return response;
  };
};

const createAuthenticatedFigmaRestFetch = ({
  fetchImpl,
  accessToken,
}: {
  fetchImpl: typeof fetch;
  accessToken: string;
}): typeof fetch =>
  createAuthenticatedHostFetch({
    fetchImpl,
    allowedHostname: "api.figma.com",
    primaryAuthHeaders: {
      "X-Figma-Token": accessToken,
    },
    retryAuthHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
    shouldRetryWithAlternateAuth: async (response) => {
      if (response.status !== 403) {
        return false;
      }
      const bodyText = (await response.clone().text()).toLowerCase();
      return bodyText.includes("invalid token");
    },
  });

const createAuthenticatedFigmaMcpFetch = ({
  fetchImpl,
  accessToken,
}: {
  fetchImpl: typeof fetch;
  accessToken: string;
}): typeof fetch =>
  createAuthenticatedHostFetch({
    fetchImpl,
    allowedHostname: "mcp.figma.com",
    primaryAuthHeaders: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

const sortedUnique = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));

const buildNodeLookup = (
  nodes: readonly PasteFingerprintNode[],
): Map<string, PasteFingerprintNode> =>
  new Map(nodes.map((node) => [node.id, node] as const));

const resolveRootNodeIdForNode = ({
  nodeId,
  nodesById,
  rootNodeIds,
}: {
  nodeId: string;
  nodesById: ReadonlyMap<string, PasteFingerprintNode>;
  rootNodeIds: ReadonlySet<string>;
}): string | undefined => {
  let current = nodesById.get(nodeId);
  while (current) {
    if (rootNodeIds.has(current.id)) {
      return current.id;
    }
    if (current.parentId === null) {
      break;
    }
    current = nodesById.get(current.parentId);
  }
  return undefined;
};

const resolveChangedRootNodeIds = ({
  changedNodeIds,
  currentFingerprintNodes,
  currentRootNodeIds,
  priorManifest,
}: {
  changedNodeIds: readonly string[];
  currentFingerprintNodes: readonly PasteFingerprintNode[];
  currentRootNodeIds: readonly string[];
  priorManifest?: PasteFingerprintManifest;
}): string[] => {
  const changedRootIds = new Set<string>();
  const currentRootIdSet = new Set(currentRootNodeIds);
  const currentNodesById = buildNodeLookup(currentFingerprintNodes);
  const priorNodesById = buildNodeLookup(priorManifest?.nodes ?? []);
  const priorRootIdSet = new Set(priorManifest?.rootNodeIds ?? []);

  for (const nodeId of changedNodeIds) {
    const currentRootNodeId = resolveRootNodeIdForNode({
      nodeId,
      nodesById: currentNodesById,
      rootNodeIds: currentRootIdSet,
    });
    if (currentRootNodeId) {
      changedRootIds.add(currentRootNodeId);
      continue;
    }

    const priorRootNodeId = resolveRootNodeIdForNode({
      nodeId,
      nodesById: priorNodesById,
      rootNodeIds: priorRootIdSet,
    });
    if (priorRootNodeId) {
      changedRootIds.add(priorRootNodeId);
    }
  }

  return sortedUnique([...changedRootIds]);
};

export const FigmaSourceService: StageService<FigmaSourceStageInput> = {
  stageName: "figma.source",
  execute: async (input, context) => {
    if (
      context.mode === "regeneration" ||
      (context.mode === "retry" && context.retryStage !== "figma.source")
    ) {
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

      if (localPath.includes("\0")) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_PATH",
          stage: "figma.source",
          message: "figmaJsonPath contains a null byte.",
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      const allowedRoots = [context.resolvedWorkspaceRoot];
      if (
        input.requestSourceMode === "figma_paste" ||
        input.requestSourceMode === "figma_plugin"
      ) {
        allowedRoots.push(
          path.join(context.resolvedPaths.outputRoot, "tmp-figma-paste"),
        );
      }

      const resolvedLocalPath = path.resolve(
        context.resolvedWorkspaceRoot,
        localPath,
      );
      const matchingRoot = allowedRoots.find((rootPath) =>
        isWithinRoot({
          candidatePath: resolvedLocalPath,
          rootPath,
        }),
      );
      if (!matchingRoot) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_PATH",
          stage: "figma.source",
          message: "figmaJsonPath must resolve within the workspace root.",
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      if (
        await hasSymlinkInPath({
          candidatePath: resolvedLocalPath,
          rootPath: matchingRoot,
        })
      ) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_PATH",
          stage: "figma.source",
          message:
            "figmaJsonPath contains a symbolic link and cannot be loaded.",
          limits: context.runtime.pipelineDiagnosticLimits,
        });
      }

      let localFileContent: string;
      try {
        localFileContent = await readFile(resolvedLocalPath, "utf8");
      } catch (error) {
        throw createPipelineError({
          code: "E_FIGMA_LOCAL_JSON_READ",
          stage: "figma.source",
          message: `Could not read local Figma JSON file: ${getErrorMessage(error)}`,
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
          message: `Could not parse local Figma JSON file: ${getErrorMessage(error)}`,
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
            "Could not parse local Figma JSON file: invalid Figma payload " +
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
            level: "debug",
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
              const figmaRestFetch = createAuthenticatedFigmaRestFetch({
                fetchImpl: context.fetchWithCancellation,
                accessToken,
              });
              const figmaMcpFetch = createAuthenticatedFigmaMcpFetch({
                fetchImpl: context.fetchWithCancellation,
                accessToken,
              });
              const loaded = await context.runtime.figmaMcpEnrichmentLoader({
                figmaFileKey: fileKey,
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
                figmaRestFetch,
                figmaMcpFetch,
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
              const message = sanitizeHybridLoaderErrorMessage({
                error,
                secret: accessToken,
              });
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

    let pasteDeltaExecution: PasteDeltaExecutionState | undefined;
    if (context.mode === "submission" && context.input?.pasteDeltaSeed) {
      const deltaSeed = context.input.pasteDeltaSeed;
      try {
        const currentRoots = extractDiffablePasteRoots(figmaFetch.file);
        const store = createPasteFingerprintStore({
          rootDir: path.join(
            context.resolvedPaths.outputRoot,
            "paste-fingerprints",
          ),
        });
        const priorManifest =
          typeof deltaSeed.figmaFileKey === "string" &&
          deltaSeed.figmaFileKey.trim().length > 0
            ? await store.load(deltaSeed.pasteIdentityKey)
            : undefined;
        const plan = diffFigmaPaste({
          priorManifest,
          currentRoots,
        });

        let allowReuse =
          typeof deltaSeed.figmaFileKey === "string" &&
          deltaSeed.figmaFileKey.trim().length > 0 &&
          typeof deltaSeed.sourceJobId === "string" &&
          deltaSeed.sourceJobId.trim().length > 0 &&
          context.sourceJob?.jobId === deltaSeed.sourceJobId.trim();
        let fallbackReason: string | undefined;

        if (!allowReuse) {
          fallbackReason =
            typeof deltaSeed.figmaFileKey !== "string" ||
            deltaSeed.figmaFileKey.trim().length === 0
              ? "missing_figma_file_key"
              : context.sourceJob
                ? "source_job_mismatch"
                : "source_job_unavailable";
        } else if (plan.strategy === "baseline_created") {
          allowReuse = false;
          fallbackReason = "baseline_created";
        } else if (plan.strategy === "structural_break") {
          allowReuse = false;
          fallbackReason = "structural_break";
        } else if (plan.addedNodes.length > 0 || plan.removedNodes.length > 0) {
          allowReuse = false;
          fallbackReason = "root_structure_changed";
        }

        let summary = resolvePasteDeltaSummary({
          allowReuse,
          plan,
          requestedMode: deltaSeed.requestedMode,
        });
        const changedNodeIds = collectChangedNodeIds({ plan });
        let changedRootNodeIds = allowReuse
          ? resolveChangedRootNodeIds({
              changedNodeIds,
              currentFingerprintNodes: plan.currentFingerprintNodes,
              currentRootNodeIds: plan.rootNodeIds,
              ...(priorManifest ? { priorManifest } : {}),
            })
          : [];

        if (
          allowReuse &&
          plan.strategy === "delta" &&
          changedRootNodeIds.length === 0
        ) {
          allowReuse = false;
          fallbackReason = "changed_roots_unresolved";
          summary = resolvePasteDeltaSummary({
            allowReuse,
            plan,
            requestedMode: deltaSeed.requestedMode,
          });
          changedRootNodeIds = [];
        }

        summary = {
          ...summary,
          pasteIdentityKey: deltaSeed.pasteIdentityKey,
          priorManifestMissing: priorManifest === undefined,
        };

        pasteDeltaExecution = {
          pasteIdentityKey: deltaSeed.pasteIdentityKey,
          requestedMode: deltaSeed.requestedMode,
          summary,
          currentFingerprintNodes: plan.currentFingerprintNodes,
          rootNodeIds: plan.rootNodeIds,
          changedNodeIds,
          changedRootNodeIds,
          ...(deltaSeed.sourceJobId
            ? { sourceJobId: deltaSeed.sourceJobId }
            : {}),
          ...(deltaSeed.compatibilityFingerprint
            ? {
                compatibilityFingerprint: deltaSeed.compatibilityFingerprint,
              }
            : {}),
          ...(deltaSeed.figmaFileKey
            ? { figmaFileKey: deltaSeed.figmaFileKey }
            : {}),
          eligibleForReuse: allowReuse,
          ...(fallbackReason ? { fallbackReason } : {}),
        };
        context.job.pasteDeltaSummary = { ...summary };
        await context.syncPublicJobProjection();
      } catch (error) {
        context.log({
          level: "warn",
          message: `Paste delta resolution after cleaning failed; continuing with full execution: ${getErrorMessage(error)}`,
        });
        if (deltaSeed.provisionalSummary) {
          const fallbackSummary: WorkspacePasteDeltaSummary = {
            ...deltaSeed.provisionalSummary,
            mode:
              deltaSeed.requestedMode === "delta"
                ? "full"
                : "auto_resolved_to_full",
            pasteIdentityKey: deltaSeed.pasteIdentityKey,
          };
          pasteDeltaExecution = {
            pasteIdentityKey: deltaSeed.pasteIdentityKey,
            requestedMode: deltaSeed.requestedMode,
            summary: fallbackSummary,
            currentFingerprintNodes: [],
            rootNodeIds: [],
            changedNodeIds: [],
            changedRootNodeIds: [],
            ...(deltaSeed.sourceJobId
              ? { sourceJobId: deltaSeed.sourceJobId }
              : {}),
            ...(deltaSeed.compatibilityFingerprint
              ? {
                  compatibilityFingerprint: deltaSeed.compatibilityFingerprint,
                }
              : {}),
            ...(deltaSeed.figmaFileKey
              ? { figmaFileKey: deltaSeed.figmaFileKey }
              : {}),
            eligibleForReuse: false,
            fallbackReason: "delta_resolution_failed",
          };
          context.job.pasteDeltaSummary = { ...fallbackSummary };
          await context.syncPublicJobProjection();
        }
      }
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
    if (
      pasteDeltaExecution &&
      isPasteDeltaExecutionState(pasteDeltaExecution)
    ) {
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.pasteDeltaExecution,
        stage: "figma.source",
        value: pasteDeltaExecution,
      });
    }
    if (hybridMcpEnrichment) {
      await context.artifactStore.setValue({
        key: STAGE_ARTIFACT_KEYS.figmaHybridEnrichment,
        stage: "figma.source",
        value: hybridMcpEnrichment,
      });
    }
  },
};
