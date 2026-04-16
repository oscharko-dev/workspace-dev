/**
 * Workspace-dev HTTP server.
 *
 * Provides a local UI shell (`/workspace/ui` and `/workspace/:figmaFileKey`),
 * runtime status (`/workspace`), job submission and polling endpoints,
 * and integrated preview serving from local generated artifacts.
 */

import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceStartOptions } from "./contracts/index.js";
import { createDefaultFigmaMcpEnrichmentLoader } from "./job-engine/figma-hybrid-enrichment.js";
import { createJobEngine, resolveRuntimeSettings } from "./job-engine.js";
import { getWorkspaceDefaults } from "./mode-lock.js";
import { buildApp, toAddressList, type WorkspaceServerApp } from "./server/app-inject.js";
import { DEFAULT_HOST, DEFAULT_OUTPUT_ROOT, DEFAULT_PORT, DEFAULT_RATE_LIMIT_PER_MINUTE } from "./server/constants.js";
import { createWorkspaceRequestHandler } from "./server/request-handler.js";

const MODULE_DIR = typeof __dirname === "string" ? __dirname : path.dirname(fileURLToPath(import.meta.url));

export interface WorkspaceServer {
  app: WorkspaceServerApp;
  url: string;
  host: string;
  port: number;
  startedAt: number;
}

async function startServer({
  server,
  host,
  port
}: {
  server: Server;
  host: string;
  port: number;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export const createWorkspaceServer = async (options: WorkspaceStartOptions = {}): Promise<WorkspaceServer> => {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const workDir = options.workDir ?? process.cwd();
  const rateLimitPerMinute =
    typeof options.rateLimitPerMinute === "number" && Number.isFinite(options.rateLimitPerMinute)
      ? Math.max(0, Math.min(1000, Math.trunc(options.rateLimitPerMinute)))
      : DEFAULT_RATE_LIMIT_PER_MINUTE;
  const importSessionEventBearerToken =
    typeof options.importSessionEventBearerToken === "string" &&
    options.importSessionEventBearerToken.trim().length > 0
      ? options.importSessionEventBearerToken.trim()
      : undefined;
  const outputRoot =
    typeof options.outputRoot === "string" && options.outputRoot.trim().length > 0
      ? options.outputRoot
      : DEFAULT_OUTPUT_ROOT;
  const absoluteOutputRoot = path.isAbsolute(outputRoot)
    ? path.normalize(outputRoot)
    : path.resolve(workDir, outputRoot);
  const absoluteIconMapFilePath =
    typeof options.iconMapFilePath === "string" && options.iconMapFilePath.trim().length > 0
      ? path.isAbsolute(options.iconMapFilePath)
        ? path.normalize(options.iconMapFilePath)
        : path.resolve(workDir, options.iconMapFilePath)
      : undefined;
  const absoluteDesignSystemFilePath =
    typeof options.designSystemFilePath === "string" && options.designSystemFilePath.trim().length > 0
      ? path.isAbsolute(options.designSystemFilePath)
        ? path.normalize(options.designSystemFilePath)
        : path.resolve(workDir, options.designSystemFilePath)
      : undefined;

  const startedAt = Date.now();
  const defaults = getWorkspaceDefaults();
  const runtime = resolveRuntimeSettings({
    ...(options.figmaRequestTimeoutMs !== undefined ? { figmaRequestTimeoutMs: options.figmaRequestTimeoutMs } : {}),
    ...(options.figmaMaxRetries !== undefined ? { figmaMaxRetries: options.figmaMaxRetries } : {}),
    ...(options.figmaCircuitBreakerFailureThreshold !== undefined
      ? { figmaCircuitBreakerFailureThreshold: options.figmaCircuitBreakerFailureThreshold }
      : {}),
    ...(options.figmaCircuitBreakerResetTimeoutMs !== undefined
      ? { figmaCircuitBreakerResetTimeoutMs: options.figmaCircuitBreakerResetTimeoutMs }
      : {}),
    ...(options.figmaBootstrapDepth !== undefined ? { figmaBootstrapDepth: options.figmaBootstrapDepth } : {}),
    ...(options.figmaNodeBatchSize !== undefined ? { figmaNodeBatchSize: options.figmaNodeBatchSize } : {}),
    ...(options.figmaNodeFetchConcurrency !== undefined
      ? { figmaNodeFetchConcurrency: options.figmaNodeFetchConcurrency }
      : {}),
    ...(options.figmaAdaptiveBatchingEnabled !== undefined
      ? { figmaAdaptiveBatchingEnabled: options.figmaAdaptiveBatchingEnabled }
      : {}),
    ...(options.figmaMaxScreenCandidates !== undefined
      ? { figmaMaxScreenCandidates: options.figmaMaxScreenCandidates }
      : {}),
    ...(options.figmaScreenNamePattern !== undefined
      ? { figmaScreenNamePattern: options.figmaScreenNamePattern }
      : {}),
    ...(options.figmaCacheEnabled !== undefined ? { figmaCacheEnabled: options.figmaCacheEnabled } : {}),
    ...(options.figmaCacheTtlMs !== undefined ? { figmaCacheTtlMs: options.figmaCacheTtlMs } : {}),
    ...(absoluteIconMapFilePath !== undefined ? { iconMapFilePath: absoluteIconMapFilePath } : {}),
    ...(absoluteDesignSystemFilePath !== undefined ? { designSystemFilePath: absoluteDesignSystemFilePath } : {}),
    ...(options.exportImages !== undefined ? { exportImages: options.exportImages } : {}),
    ...(options.figmaScreenElementBudget !== undefined
      ? { figmaScreenElementBudget: options.figmaScreenElementBudget }
      : {}),
    ...(options.figmaScreenElementMaxDepth !== undefined
      ? { figmaScreenElementMaxDepth: options.figmaScreenElementMaxDepth }
      : {}),
    ...(options.brandTheme !== undefined ? { brandTheme: options.brandTheme } : {}),
    ...(options.generationLocale !== undefined ? { generationLocale: options.generationLocale } : {}),
    ...(options.routerMode !== undefined ? { routerMode: options.routerMode } : {}),
    ...(options.commandTimeoutMs !== undefined ? { commandTimeoutMs: options.commandTimeoutMs } : {}),
    ...(options.commandStdoutMaxBytes !== undefined ? { commandStdoutMaxBytes: options.commandStdoutMaxBytes } : {}),
    ...(options.commandStderrMaxBytes !== undefined ? { commandStderrMaxBytes: options.commandStderrMaxBytes } : {}),
    ...(options.pipelineDiagnosticMaxCount !== undefined
      ? { pipelineDiagnosticMaxCount: options.pipelineDiagnosticMaxCount }
      : {}),
    ...(options.pipelineDiagnosticTextMaxLength !== undefined
      ? { pipelineDiagnosticTextMaxLength: options.pipelineDiagnosticTextMaxLength }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxKeys !== undefined
      ? { pipelineDiagnosticDetailsMaxKeys: options.pipelineDiagnosticDetailsMaxKeys }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxItems !== undefined
      ? { pipelineDiagnosticDetailsMaxItems: options.pipelineDiagnosticDetailsMaxItems }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxDepth !== undefined
      ? { pipelineDiagnosticDetailsMaxDepth: options.pipelineDiagnosticDetailsMaxDepth }
      : {}),
    ...(options.enableUiValidation !== undefined ? { enableUiValidation: options.enableUiValidation } : {}),
    ...(options.enableVisualQualityValidation !== undefined
      ? { enableVisualQualityValidation: options.enableVisualQualityValidation }
      : {}),
    ...(options.compositeQualityWeights !== undefined
      ? { compositeQualityWeights: options.compositeQualityWeights }
      : {}),
    ...(options.visualQualityReferenceMode !== undefined
      ? { visualQualityReferenceMode: options.visualQualityReferenceMode }
      : {}),
    ...(options.visualQualityViewportWidth !== undefined
      ? { visualQualityViewportWidth: options.visualQualityViewportWidth }
      : {}),
    ...(options.visualQualityViewportHeight !== undefined
      ? { visualQualityViewportHeight: options.visualQualityViewportHeight }
      : {}),
    ...(options.visualQualityDeviceScaleFactor !== undefined
      ? { visualQualityDeviceScaleFactor: options.visualQualityDeviceScaleFactor }
      : {}),
    ...(options.visualQualityBrowsers !== undefined
      ? { visualQualityBrowsers: options.visualQualityBrowsers }
      : {}),
    ...(options.enableUnitTestValidation !== undefined
      ? { enableUnitTestValidation: options.enableUnitTestValidation }
      : {}),
    ...(options.installPreferOffline !== undefined ? { installPreferOffline: options.installPreferOffline } : {}),
    ...(options.skipInstall !== undefined ? { skipInstall: options.skipInstall } : {}),
    ...(options.maxConcurrentJobs !== undefined ? { maxConcurrentJobs: options.maxConcurrentJobs } : {}),
    ...(options.maxQueuedJobs !== undefined ? { maxQueuedJobs: options.maxQueuedJobs } : {}),
    ...(options.logFormat !== undefined ? { logFormat: options.logFormat } : {}),
    ...(options.enablePreview !== undefined ? { enablePreview: options.enablePreview } : {}),
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {})
  });
  runtime.figmaMcpEnrichmentLoader ??= createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: runtime.figmaTimeoutMs,
    maxRetries: runtime.figmaMaxRetries,
    maxScreenCandidates: runtime.figmaMaxScreenCandidates,
    ...(runtime.figmaScreenNamePattern !== undefined ? { screenNamePattern: runtime.figmaScreenNamePattern } : {})
  });

  let resolvedPort = port;
  const jobEngine = createJobEngine({
    resolveBaseUrl: () => `http://${host}:${resolvedPort}`,
    paths: {
      workspaceRoot: path.resolve(workDir),
      outputRoot: absoluteOutputRoot,
      jobsRoot: path.join(absoluteOutputRoot, "jobs"),
      reprosRoot: path.join(absoluteOutputRoot, "repros")
    },
    runtime
  });

  const handleRequest = createWorkspaceRequestHandler({
    host,
    getResolvedPort: () => resolvedPort,
    startedAt,
    absoluteOutputRoot,
    workspaceRoot: path.resolve(workDir),
    defaults,
    runtime: {
      previewEnabled: runtime.previewEnabled,
      rateLimitPerMinute,
      ...(importSessionEventBearerToken !== undefined ? { importSessionEventBearerToken } : {}),
      logger: runtime.logger
    },
    jobEngine,
    moduleDir: MODULE_DIR
  });

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  try {
    await startServer({ server, host, port });
  } catch (error) {
    const isAddrInUse =
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (isAddrInUse) {
      throw new Error(
        `Port ${port} is already in use. ` +
          `Another instance of workspace-dev or another service may be running on this port. ` +
          `Use FIGMAPIPE_WORKSPACE_PORT to configure an alternative port.`
      );
    }
    throw error;
  }

  const addresses = toAddressList(server);
  const firstAddress = addresses.at(0);
  if (firstAddress) {
    resolvedPort = firstAddress.port;
  }

  const app = buildApp({
    server,
    host,
    port: resolvedPort
  });

  return { app, url: `http://${host}:${resolvedPort}`, host, port: resolvedPort, startedAt };
};
