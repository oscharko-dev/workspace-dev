/**
 * Workspace-dev HTTP server.
 *
 * Provides a local UI shell (`/workspace/ui` and `/workspace/:figmaFileKey`),
 * runtime status (`/workspace`), job submission and polling endpoints,
 * and integrated preview serving from local generated artifacts.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceStartOptions } from "./contracts/index.js";
import { createDefaultFigmaMcpEnrichmentLoader } from "./job-engine/figma-hybrid-enrichment.js";
import { createJobEngine, resolveRuntimeSettings } from "./job-engine.js";
import type { WorkspaceRuntimeLogger } from "./logging.js";
import { getWorkspaceDefaults } from "./mode-lock.js";
import {
  buildApp,
  closeServer,
  toAddressList,
  type WorkspaceServerApp,
} from "./server/app-inject.js";
import {
  DEFAULT_HOST,
  DEFAULT_OUTPUT_ROOT,
  DEFAULT_PORT,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
} from "./server/constants.js";
import { createWorkspaceRequestHandler } from "./server/request-handler.js";

const MODULE_DIR =
  typeof __dirname === "string"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIGMA_PASTE_TEMP_TTL_MS = 24 * 60 * 60_000;
const FIGMA_PASTE_TEMP_DIR_NAME = "tmp-figma-paste";
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export interface WorkspaceServer {
  app: WorkspaceServerApp;
  url: string;
  host: string;
  port: number;
  startedAt: number;
}

type WorkspaceServerLifecycleState =
  | "starting"
  | "ready"
  | "draining"
  | "stopped";

async function startServer({
  server,
  host,
  port,
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

const getErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const resolveFigmaPasteTempTtlMs = (value: number | undefined): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_FIGMA_PASTE_TEMP_TTL_MS;
  }
  return Math.max(0, Math.trunc(value));
};

const sweepStaleFigmaPasteTempFiles = async ({
  outputRoot,
  ttlMs,
  logger,
  nowMs = Date.now(),
}: {
  outputRoot: string;
  ttlMs: number;
  logger: WorkspaceRuntimeLogger;
  nowMs?: number;
}): Promise<number> => {
  const pasteTempDir = path.join(outputRoot, FIGMA_PASTE_TEMP_DIR_NAME);
  let deletedCount = 0;

  try {
    const entries = await readdir(pasteTempDir, { withFileTypes: true });
    const deletedEntries = await Promise.all(
      entries.map(async (entry): Promise<number> => {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
          return 0;
        }

        const entryPath = path.join(pasteTempDir, entry.name);
        let entryStats: Awaited<ReturnType<typeof stat>>;
        try {
          entryStats = await stat(entryPath);
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined;
          if (code !== "ENOENT") {
            logger.log({
              level: "warn",
              event: "figma_paste_temp_sweep",
              message: `tmp-figma-paste startup sweep could not stat '${entry.name}': ${getErrorMessage(error)}`,
            });
          }
          return 0;
        }

        if (nowMs - entryStats.mtimeMs <= ttlMs) {
          return 0;
        }

        try {
          await rm(entryPath, { force: true });
          return 1;
        } catch (error) {
          const code =
            typeof error === "object" && error !== null && "code" in error
              ? error.code
              : undefined;
          if (code !== "ENOENT") {
            logger.log({
              level: "warn",
              event: "figma_paste_temp_sweep",
              message: `tmp-figma-paste startup sweep could not delete '${entry.name}': ${getErrorMessage(error)}`,
            });
          }
          return 0;
        }
      }),
    );
    deletedCount = deletedEntries.reduce((sum, count) => sum + count, 0);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : undefined;
    if (code !== "ENOENT") {
      logger.log({
        level: "warn",
        event: "figma_paste_temp_sweep",
        message: `tmp-figma-paste startup sweep failed: ${getErrorMessage(error)}`,
      });
    }
  }

  logger.log({
    level: "info",
    event: "figma_paste_temp_sweep",
    message: `tmp-figma-paste startup sweep deleted ${deletedCount} stale file(s); ttlMs=${ttlMs}`,
  });

  return deletedCount;
};

export const createWorkspaceServer = async (
  options: WorkspaceStartOptions = {},
): Promise<WorkspaceServer> => {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const workDir = options.workDir ?? process.cwd();
  const rateLimitPerMinute =
    typeof options.rateLimitPerMinute === "number" &&
    Number.isFinite(options.rateLimitPerMinute)
      ? Math.max(0, Math.min(1000, Math.trunc(options.rateLimitPerMinute)))
      : DEFAULT_RATE_LIMIT_PER_MINUTE;
  const importSessionEventBearerToken =
    typeof options.importSessionEventBearerToken === "string" &&
    options.importSessionEventBearerToken.trim().length > 0
      ? options.importSessionEventBearerToken.trim()
      : undefined;
  const testIntelligenceReviewBearerToken =
    typeof options.testIntelligence?.reviewBearerToken === "string" &&
    options.testIntelligence.reviewBearerToken.trim().length > 0
      ? options.testIntelligence.reviewBearerToken.trim()
      : undefined;
  const outputRoot =
    typeof options.outputRoot === "string" &&
    options.outputRoot.trim().length > 0
      ? options.outputRoot
      : DEFAULT_OUTPUT_ROOT;
  const absoluteOutputRoot = path.isAbsolute(outputRoot)
    ? path.normalize(outputRoot)
    : path.resolve(workDir, outputRoot);
  const testIntelligenceArtifactRootOption =
    typeof options.testIntelligence?.artifactRoot === "string" &&
    options.testIntelligence.artifactRoot.trim().length > 0
      ? options.testIntelligence.artifactRoot
      : undefined;
  const testIntelligenceArtifactRoot =
    testIntelligenceArtifactRootOption === undefined
      ? path.join(absoluteOutputRoot, "test-intelligence")
      : path.isAbsolute(testIntelligenceArtifactRootOption)
        ? path.normalize(testIntelligenceArtifactRootOption)
        : path.resolve(workDir, testIntelligenceArtifactRootOption);
  const figmaPasteTempTtlMs = resolveFigmaPasteTempTtlMs(
    options.figmaPasteTempTtlMs,
  );
  const shutdownTimeoutMs =
    typeof options.shutdownTimeoutMs === "number" &&
    Number.isFinite(options.shutdownTimeoutMs)
      ? Math.max(0, Math.trunc(options.shutdownTimeoutMs))
      : DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const absoluteIconMapFilePath =
    typeof options.iconMapFilePath === "string" &&
    options.iconMapFilePath.trim().length > 0
      ? path.isAbsolute(options.iconMapFilePath)
        ? path.normalize(options.iconMapFilePath)
        : path.resolve(workDir, options.iconMapFilePath)
      : undefined;
  const absoluteDesignSystemFilePath =
    typeof options.designSystemFilePath === "string" &&
    options.designSystemFilePath.trim().length > 0
      ? path.isAbsolute(options.designSystemFilePath)
        ? path.normalize(options.designSystemFilePath)
        : path.resolve(workDir, options.designSystemFilePath)
      : undefined;
  const absoluteSparkasseTokensFilePath =
    typeof options.sparkasseTokensFilePath === "string" &&
    options.sparkasseTokensFilePath.trim().length > 0
      ? path.isAbsolute(options.sparkasseTokensFilePath)
        ? path.normalize(options.sparkasseTokensFilePath)
        : path.resolve(workDir, options.sparkasseTokensFilePath)
      : undefined;

  const startedAt = Date.now();
  const defaults = getWorkspaceDefaults();
  const runtime = resolveRuntimeSettings({
    ...(options.figmaRequestTimeoutMs !== undefined
      ? { figmaRequestTimeoutMs: options.figmaRequestTimeoutMs }
      : {}),
    ...(options.figmaMaxRetries !== undefined
      ? { figmaMaxRetries: options.figmaMaxRetries }
      : {}),
    ...(options.figmaCircuitBreakerFailureThreshold !== undefined
      ? {
          figmaCircuitBreakerFailureThreshold:
            options.figmaCircuitBreakerFailureThreshold,
        }
      : {}),
    ...(options.figmaCircuitBreakerResetTimeoutMs !== undefined
      ? {
          figmaCircuitBreakerResetTimeoutMs:
            options.figmaCircuitBreakerResetTimeoutMs,
        }
      : {}),
    ...(options.figmaBootstrapDepth !== undefined
      ? { figmaBootstrapDepth: options.figmaBootstrapDepth }
      : {}),
    ...(options.figmaNodeBatchSize !== undefined
      ? { figmaNodeBatchSize: options.figmaNodeBatchSize }
      : {}),
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
    ...(options.figmaCacheEnabled !== undefined
      ? { figmaCacheEnabled: options.figmaCacheEnabled }
      : {}),
    ...(options.figmaCacheTtlMs !== undefined
      ? { figmaCacheTtlMs: options.figmaCacheTtlMs }
      : {}),
    ...(options.maxJsonResponseBytes !== undefined
      ? { maxJsonResponseBytes: options.maxJsonResponseBytes }
      : {}),
    ...(options.maxIrCacheEntries !== undefined
      ? { maxIrCacheEntries: options.maxIrCacheEntries }
      : {}),
    ...(options.maxIrCacheBytes !== undefined
      ? { maxIrCacheBytes: options.maxIrCacheBytes }
      : {}),
    ...(absoluteIconMapFilePath !== undefined
      ? { iconMapFilePath: absoluteIconMapFilePath }
      : {}),
    ...(absoluteDesignSystemFilePath !== undefined
      ? { designSystemFilePath: absoluteDesignSystemFilePath }
      : {}),
    ...(options.exportImages !== undefined
      ? { exportImages: options.exportImages }
      : {}),
    ...(options.figmaScreenElementBudget !== undefined
      ? { figmaScreenElementBudget: options.figmaScreenElementBudget }
      : {}),
    ...(options.figmaScreenElementMaxDepth !== undefined
      ? { figmaScreenElementMaxDepth: options.figmaScreenElementMaxDepth }
      : {}),
    ...(options.brandTheme !== undefined
      ? { brandTheme: options.brandTheme }
      : {}),
    ...(absoluteSparkasseTokensFilePath !== undefined
      ? { sparkasseTokensFilePath: absoluteSparkasseTokensFilePath }
      : {}),
    ...(options.generationLocale !== undefined
      ? { generationLocale: options.generationLocale }
      : {}),
    ...(options.routerMode !== undefined
      ? { routerMode: options.routerMode }
      : {}),
    ...(options.commandTimeoutMs !== undefined
      ? { commandTimeoutMs: options.commandTimeoutMs }
      : {}),
    ...(options.commandStdoutMaxBytes !== undefined
      ? { commandStdoutMaxBytes: options.commandStdoutMaxBytes }
      : {}),
    ...(options.commandStderrMaxBytes !== undefined
      ? { commandStderrMaxBytes: options.commandStderrMaxBytes }
      : {}),
    ...(options.pipelineDiagnosticMaxCount !== undefined
      ? { pipelineDiagnosticMaxCount: options.pipelineDiagnosticMaxCount }
      : {}),
    ...(options.pipelineDiagnosticTextMaxLength !== undefined
      ? {
          pipelineDiagnosticTextMaxLength:
            options.pipelineDiagnosticTextMaxLength,
        }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxKeys !== undefined
      ? {
          pipelineDiagnosticDetailsMaxKeys:
            options.pipelineDiagnosticDetailsMaxKeys,
        }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxItems !== undefined
      ? {
          pipelineDiagnosticDetailsMaxItems:
            options.pipelineDiagnosticDetailsMaxItems,
        }
      : {}),
    ...(options.pipelineDiagnosticDetailsMaxDepth !== undefined
      ? {
          pipelineDiagnosticDetailsMaxDepth:
            options.pipelineDiagnosticDetailsMaxDepth,
        }
      : {}),
    ...(options.maxValidationAttempts !== undefined
      ? { maxValidationAttempts: options.maxValidationAttempts }
      : {}),
    ...(options.enableLintAutofix !== undefined
      ? { enableLintAutofix: options.enableLintAutofix }
      : {}),
    ...(options.enablePerfValidation !== undefined
      ? { enablePerfValidation: options.enablePerfValidation }
      : {}),
    ...(options.enableUiValidation !== undefined
      ? { enableUiValidation: options.enableUiValidation }
      : {}),
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
      ? {
          visualQualityDeviceScaleFactor:
            options.visualQualityDeviceScaleFactor,
        }
      : {}),
    ...(options.visualQualityBrowsers !== undefined
      ? { visualQualityBrowsers: options.visualQualityBrowsers }
      : {}),
    ...(options.enableUnitTestValidation !== undefined
      ? { enableUnitTestValidation: options.enableUnitTestValidation }
      : {}),
    ...(options.installPreferOffline !== undefined
      ? { installPreferOffline: options.installPreferOffline }
      : {}),
    ...(options.skipInstall !== undefined
      ? { skipInstall: options.skipInstall }
      : {}),
    ...(options.maxConcurrentJobs !== undefined
      ? { maxConcurrentJobs: options.maxConcurrentJobs }
      : {}),
    ...(options.maxQueuedJobs !== undefined
      ? { maxQueuedJobs: options.maxQueuedJobs }
      : {}),
    ...(options.logLimit !== undefined ? { logLimit: options.logLimit } : {}),
    ...(options.maxJobDiskBytes !== undefined
      ? { maxJobDiskBytes: options.maxJobDiskBytes }
      : {}),
    ...(options.logFormat !== undefined
      ? { logFormat: options.logFormat }
      : {}),
    ...(options.enablePreview !== undefined
      ? { enablePreview: options.enablePreview }
      : {}),
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
  });
  runtime.figmaMcpEnrichmentLoader ??= createDefaultFigmaMcpEnrichmentLoader({
    timeoutMs: runtime.figmaTimeoutMs,
    maxRetries: runtime.figmaMaxRetries,
    maxScreenCandidates: runtime.figmaMaxScreenCandidates,
    ...(runtime.figmaScreenNamePattern !== undefined
      ? { screenNamePattern: runtime.figmaScreenNamePattern }
      : {}),
  });

  let resolvedPort = port;
  let lifecycleState: WorkspaceServerLifecycleState = "starting";
  let drainTrackedRequestCount = 0;
  const activeSockets = new Set<Socket>();
  const requestDrainWaiters = new Set<() => void>();
  let closePromise: Promise<void> | undefined;
  const jobEngine = createJobEngine({
    resolveBaseUrl: () => `http://${host}:${resolvedPort}`,
    paths: {
      workspaceRoot: path.resolve(workDir),
      outputRoot: absoluteOutputRoot,
      jobsRoot: path.join(absoluteOutputRoot, "jobs"),
      reprosRoot: path.join(absoluteOutputRoot, "repros"),
    },
    runtime,
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
      ...(importSessionEventBearerToken !== undefined
        ? { importSessionEventBearerToken }
        : {}),
      testIntelligenceEnabled: options.testIntelligence?.enabled === true,
      ...(testIntelligenceReviewBearerToken !== undefined
        ? { testIntelligenceReviewBearerToken }
        : {}),
      testIntelligenceArtifactRoot,
      logger: runtime.logger,
    },
    getServerLifecycleState: () => lifecycleState,
    jobEngine,
    moduleDir: MODULE_DIR,
  });

  const server = createServer((request, response) => {
    const trackForDrain = lifecycleState !== "draining";
    if (trackForDrain) {
      drainTrackedRequestCount += 1;
    }
    let settled = false;
    const markRequestComplete = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (!trackForDrain) {
        return;
      }
      drainTrackedRequestCount = Math.max(0, drainTrackedRequestCount - 1);
      if (drainTrackedRequestCount === 0) {
        for (const resolve of requestDrainWaiters) {
          resolve();
        }
        requestDrainWaiters.clear();
      }
    };

    response.once("finish", markRequestComplete);
    response.once("close", markRequestComplete);
    void handleRequest(request, response);
  });
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => {
      activeSockets.delete(socket);
    });
  });

  await sweepStaleFigmaPasteTempFiles({
    outputRoot: absoluteOutputRoot,
    ttlMs: figmaPasteTempTtlMs,
    logger: runtime.logger,
  });

  try {
    await startServer({ server, host, port });
  } catch (error) {
    const isAddrInUse =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EADDRINUSE";
    if (isAddrInUse) {
      throw new Error(
        `Port ${port} is already in use. ` +
          `Another instance of workspace-dev or another service may be running on this port. ` +
          `Use FIGMAPIPE_WORKSPACE_PORT to configure an alternative port.`,
      );
    }
    throw error;
  }

  const addresses = toAddressList(server);
  const firstAddress = addresses.at(0);
  if (firstAddress) {
    resolvedPort = firstAddress.port;
  }
  lifecycleState = "ready";

  const baseApp = buildApp({
    server,
    host,
    port: resolvedPort,
  });
  const waitForActiveRequestsToDrain = async (): Promise<void> => {
    if (drainTrackedRequestCount === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      requestDrainWaiters.add(resolve);
    });
  };
  const terminateOpenSockets = (): void => {
    for (const socket of activeSockets) {
      socket.destroy();
    }
    activeSockets.clear();
  };
  const closeWithDrain = async (): Promise<void> => {
    if (lifecycleState === "stopped") {
      return;
    }
    if (closePromise) {
      return await closePromise;
    }

    lifecycleState = "draining";
    closePromise = (async () => {
      const shutdownReason = "Server shutdown interrupted in-flight work.";
      const jobShutdownPromise = jobEngine.shutdown({
        reason: shutdownReason,
        timeoutMs: shutdownTimeoutMs,
      });
      let timedOut = false;

      try {
        await Promise.race([
          Promise.all([
            waitForActiveRequestsToDrain(),
            jobShutdownPromise,
          ]).then(() => undefined),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(
                new Error(
                  `Graceful shutdown timed out after ${shutdownTimeoutMs}ms.`,
                ),
              );
            }, shutdownTimeoutMs);
          }),
        ]);
      } catch {
        timedOut = true;
        terminateOpenSockets();
      } finally {
        const closeServerPromise = closeServer(server);
        if (typeof server.closeIdleConnections === "function") {
          server.closeIdleConnections();
        }
        if (timedOut) {
          terminateOpenSockets();
        }
        await closeServerPromise.catch(() => {});
        lifecycleState = "stopped";
      }
    })();

    return await closePromise;
  };
  const app: WorkspaceServerApp = {
    ...baseApp,
    close: closeWithDrain,
  };

  return {
    app,
    url: `http://${host}:${resolvedPort}`,
    host,
    port: resolvedPort,
    startedAt,
  };
};
