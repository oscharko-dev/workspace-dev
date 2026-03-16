#!/usr/bin/env node
/**
 * CLI entry point for workspace-dev.
 *
 * Usage:
 *   workspace-dev start [--port 1983] [--host 127.0.0.1]
 */

import { createWorkspaceServer } from "./server.js";

const DEFAULT_PORT = 1983;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_OUTPUT_ROOT = ".workspace-dev";
const DEFAULT_FIGMA_TIMEOUT_MS = 30_000;
const DEFAULT_FIGMA_RETRIES = 3;
const DEFAULT_FIGMA_BOOTSTRAP_DEPTH = 5;
const DEFAULT_FIGMA_NODE_BATCH_SIZE = 6;
const DEFAULT_FIGMA_NODE_FETCH_CONCURRENCY = 3;
const DEFAULT_FIGMA_ADAPTIVE_BATCHING = true;
const DEFAULT_FIGMA_MAX_SCREEN_CANDIDATES = 40;
const DEFAULT_FIGMA_CACHE_ENABLED = true;
const DEFAULT_FIGMA_CACHE_TTL_MS = 15 * 60_000;
const DEFAULT_FIGMA_SCREEN_ELEMENT_BUDGET = 1_200;
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_ENABLE_UI_VALIDATION = false;
const DEFAULT_INSTALL_PREFER_OFFLINE = true;

interface CliOptions {
  command: string;
  port: number;
  host: string;
  outputRoot: string;
  figmaTimeoutMs: number;
  figmaRetries: number;
  figmaBootstrapDepth: number;
  figmaNodeBatchSize: number;
  figmaNodeFetchConcurrency: number;
  figmaAdaptiveBatchingEnabled: boolean;
  figmaMaxScreenCandidates: number;
  figmaScreenNamePattern: string | undefined;
  figmaCacheEnabled: boolean;
  figmaCacheTtlMs: number;
  figmaScreenElementBudget: number;
  commandTimeoutMs: number;
  enableUiValidation: boolean;
  installPreferOffline: boolean;
  enablePreview: boolean;
  enablePerfValidation: boolean;
}

const parseBooleanLike = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const parseIntInRange = ({
  raw,
  fallback,
  min,
  max
}: {
  raw: string | undefined;
  fallback: number;
  min: number;
  max: number;
}): number => {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
};

const parseArgs = (argv: string[]): CliOptions => {
  const args = argv.slice(2);
  const command = args[0] ?? "start";

  let port = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_PORT,
    fallback: DEFAULT_PORT,
    min: 1,
    max: 65535
  });
  let host = process.env.FIGMAPIPE_WORKSPACE_HOST?.trim() || DEFAULT_HOST;
  let outputRoot = process.env.FIGMAPIPE_WORKSPACE_OUTPUT_ROOT?.trim() || DEFAULT_OUTPUT_ROOT;
  let figmaTimeoutMs = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_TIMEOUT_MS,
    fallback: DEFAULT_FIGMA_TIMEOUT_MS,
    min: 1_000,
    max: 120_000
  });
  let figmaRetries = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_RETRIES,
    fallback: DEFAULT_FIGMA_RETRIES,
    min: 1,
    max: 10
  });
  let figmaBootstrapDepth = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_BOOTSTRAP_DEPTH,
    fallback: DEFAULT_FIGMA_BOOTSTRAP_DEPTH,
    min: 1,
    max: 10
  });
  let figmaNodeBatchSize = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_NODE_BATCH_SIZE,
    fallback: DEFAULT_FIGMA_NODE_BATCH_SIZE,
    min: 1,
    max: 20
  });
  let figmaNodeFetchConcurrency = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_NODE_FETCH_CONCURRENCY,
    fallback: DEFAULT_FIGMA_NODE_FETCH_CONCURRENCY,
    min: 1,
    max: 10
  });
  let figmaAdaptiveBatchingEnabled = parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_FIGMA_ADAPTIVE_BATCHING,
    DEFAULT_FIGMA_ADAPTIVE_BATCHING
  );
  let figmaMaxScreenCandidates = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_MAX_SCREEN_CANDIDATES,
    fallback: DEFAULT_FIGMA_MAX_SCREEN_CANDIDATES,
    min: 1,
    max: 200
  });
  let figmaScreenNamePattern = process.env.FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_NAME_PATTERN?.trim() || undefined;
  let figmaCacheEnabled = !parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_NO_CACHE,
    !DEFAULT_FIGMA_CACHE_ENABLED
  );
  let figmaCacheTtlMs = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_CACHE_TTL_MS,
    fallback: DEFAULT_FIGMA_CACHE_TTL_MS,
    min: 1_000,
    max: 24 * 60 * 60_000
  });
  let figmaScreenElementBudget = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_BUDGET,
    fallback: DEFAULT_FIGMA_SCREEN_ELEMENT_BUDGET,
    min: 100,
    max: 10000
  });
  let commandTimeoutMs = parseIntInRange({
    raw: process.env.FIGMAPIPE_WORKSPACE_COMMAND_TIMEOUT_MS,
    fallback: DEFAULT_COMMAND_TIMEOUT_MS,
    min: 5_000,
    max: 60 * 60_000
  });
  let enableUiValidation = parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_ENABLE_UI_VALIDATION,
    DEFAULT_ENABLE_UI_VALIDATION
  );
  let installPreferOffline = parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_INSTALL_PREFER_OFFLINE,
    DEFAULT_INSTALL_PREFER_OFFLINE
  );
  let enablePreview = parseBooleanLike(process.env.FIGMAPIPE_WORKSPACE_ENABLE_PREVIEW, true);
  let enablePerfValidation = parseBooleanLike(
    process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION ?? process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION,
    false
  );

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--port") {
      port = parseIntInRange({
        raw: args[index + 1],
        fallback: port,
        min: 1,
        max: 65535
      });
      index += 1;
      continue;
    }

    if (arg === "--host") {
      const nextValue = args[index + 1]?.trim();
      if (nextValue) {
        host = nextValue;
      }
      index += 1;
      continue;
    }

    if (arg === "--output-root") {
      const nextValue = args[index + 1]?.trim();
      if (nextValue) {
        outputRoot = nextValue;
      }
      index += 1;
      continue;
    }

    if (arg === "--figma-timeout-ms") {
      figmaTimeoutMs = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaTimeoutMs,
        min: 1_000,
        max: 120_000
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-retries") {
      figmaRetries = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaRetries,
        min: 1,
        max: 10
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-bootstrap-depth") {
      figmaBootstrapDepth = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaBootstrapDepth,
        min: 1,
        max: 10
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-node-batch-size") {
      figmaNodeBatchSize = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaNodeBatchSize,
        min: 1,
        max: 20
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-node-fetch-concurrency") {
      figmaNodeFetchConcurrency = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaNodeFetchConcurrency,
        min: 1,
        max: 10
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-adaptive-batching") {
      figmaAdaptiveBatchingEnabled = parseBooleanLike(args[index + 1], figmaAdaptiveBatchingEnabled);
      index += 1;
      continue;
    }

    if (arg === "--figma-max-screen-candidates") {
      figmaMaxScreenCandidates = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaMaxScreenCandidates,
        min: 1,
        max: 200
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-screen-name-pattern") {
      const nextValue = args[index + 1]?.trim();
      figmaScreenNamePattern = nextValue && nextValue.length > 0 ? nextValue : undefined;
      index += 1;
      continue;
    }

    if (arg === "--no-cache") {
      figmaCacheEnabled = false;
      continue;
    }

    if (arg === "--figma-cache-ttl-ms") {
      figmaCacheTtlMs = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaCacheTtlMs,
        min: 1_000,
        max: 24 * 60 * 60_000
      });
      index += 1;
      continue;
    }

    if (arg === "--figma-screen-element-budget") {
      figmaScreenElementBudget = parseIntInRange({
        raw: args[index + 1],
        fallback: figmaScreenElementBudget,
        min: 100,
        max: 10_000
      });
      index += 1;
      continue;
    }

    if (arg === "--command-timeout-ms") {
      commandTimeoutMs = parseIntInRange({
        raw: args[index + 1],
        fallback: commandTimeoutMs,
        min: 5_000,
        max: 60 * 60_000
      });
      index += 1;
      continue;
    }

    if (arg === "--ui-validation") {
      enableUiValidation = parseBooleanLike(args[index + 1], enableUiValidation);
      index += 1;
      continue;
    }

    if (arg === "--install-prefer-offline") {
      installPreferOffline = parseBooleanLike(args[index + 1], installPreferOffline);
      index += 1;
      continue;
    }

    if (arg === "--preview") {
      enablePreview = parseBooleanLike(args[index + 1], enablePreview);
      index += 1;
      continue;
    }

    if (arg === "--perf-validation") {
      enablePerfValidation = parseBooleanLike(args[index + 1], enablePerfValidation);
      index += 1;
      continue;
    }
  }

  return {
    command,
    port,
    host,
    outputRoot,
    figmaTimeoutMs,
    figmaRetries,
    figmaBootstrapDepth,
    figmaNodeBatchSize,
    figmaNodeFetchConcurrency,
    figmaAdaptiveBatchingEnabled,
    figmaMaxScreenCandidates,
    figmaScreenNamePattern,
    figmaCacheEnabled,
    figmaCacheTtlMs,
    figmaScreenElementBudget,
    commandTimeoutMs,
    enableUiValidation,
    installPreferOffline,
    enablePreview,
    enablePerfValidation
  };
};

const printHelp = (): void => {
  console.log(`
workspace-dev - autonomous local workspace generator

Usage:
  workspace-dev start [options]
  workspace-dev --help

Options:
  --port <port>              Port to listen on (default: ${DEFAULT_PORT})
  --host <host>              Host to bind to (default: ${DEFAULT_HOST})
  --output-root <path>       Output root for jobs/repros (default: ${DEFAULT_OUTPUT_ROOT})
  --figma-timeout-ms <ms>    Figma request timeout (default: ${DEFAULT_FIGMA_TIMEOUT_MS})
  --figma-retries <count>    Figma max retries (default: ${DEFAULT_FIGMA_RETRIES})
  --figma-bootstrap-depth <n>
                             Bootstrap depth for staged large-board fetch (default: ${DEFAULT_FIGMA_BOOTSTRAP_DEPTH})
  --figma-node-batch-size <n>
                             Candidate batch size for /nodes fetch (default: ${DEFAULT_FIGMA_NODE_BATCH_SIZE})
  --figma-node-fetch-concurrency <n>
                             Concurrent staged /nodes fetches (default: ${DEFAULT_FIGMA_NODE_FETCH_CONCURRENCY})
  --figma-adaptive-batching <true|false>
                             Auto-split oversized staged /nodes batches (default: ${DEFAULT_FIGMA_ADAPTIVE_BATCHING})
  --figma-max-screen-candidates <n>
                             Max screen candidates fetched in staged mode (default: ${DEFAULT_FIGMA_MAX_SCREEN_CANDIDATES})
  --figma-screen-name-pattern <regex>
                             Case-insensitive regex include-filter for staged screen names
  --no-cache                 Disable figma.source file-system cache
  --figma-cache-ttl-ms <ms>  Cache TTL for figma.source entries (default: ${DEFAULT_FIGMA_CACHE_TTL_MS})
  --figma-screen-element-budget <n>
                             Max IR elements per screen before truncation (default: ${DEFAULT_FIGMA_SCREEN_ELEMENT_BUDGET})
  --command-timeout-ms <ms>  Timeout for pnpm/git commands (default: ${DEFAULT_COMMAND_TIMEOUT_MS})
  --ui-validation <true|false>
                             Run validate:ui in validate.project (default: ${DEFAULT_ENABLE_UI_VALIDATION})
  --install-prefer-offline <true|false>
                             Prefer offline install for generated project (default: ${DEFAULT_INSTALL_PREFER_OFFLINE})
  --preview <true|false>     Enable preview export/serving (default: true)
  --perf-validation <true|false>
                             Run perf:assert during validate.project (default: false)
  --help                     Show this help message

Environment variables:
  FIGMAPIPE_WORKSPACE_PORT
  FIGMAPIPE_WORKSPACE_HOST
  FIGMAPIPE_WORKSPACE_OUTPUT_ROOT
  FIGMAPIPE_WORKSPACE_FIGMA_TIMEOUT_MS
  FIGMAPIPE_WORKSPACE_FIGMA_RETRIES
  FIGMAPIPE_WORKSPACE_FIGMA_BOOTSTRAP_DEPTH
  FIGMAPIPE_WORKSPACE_FIGMA_NODE_BATCH_SIZE
  FIGMAPIPE_WORKSPACE_FIGMA_NODE_FETCH_CONCURRENCY
  FIGMAPIPE_WORKSPACE_FIGMA_ADAPTIVE_BATCHING
  FIGMAPIPE_WORKSPACE_FIGMA_MAX_SCREEN_CANDIDATES
  FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_NAME_PATTERN
  FIGMAPIPE_WORKSPACE_NO_CACHE
  FIGMAPIPE_WORKSPACE_FIGMA_CACHE_TTL_MS
  FIGMAPIPE_WORKSPACE_FIGMA_SCREEN_ELEMENT_BUDGET
  FIGMAPIPE_WORKSPACE_COMMAND_TIMEOUT_MS
  FIGMAPIPE_WORKSPACE_ENABLE_UI_VALIDATION
  FIGMAPIPE_WORKSPACE_INSTALL_PREFER_OFFLINE
  FIGMAPIPE_WORKSPACE_ENABLE_PREVIEW
  FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION
  FIGMAPIPE_ENABLE_PERF_VALIDATION (legacy alias)

Capabilities:
  - GET /workspace                 Runtime status
  - GET /workspace/ui              Local workspace UI
  - GET /workspace/:figmaFileKey   Deep-linkable workspace UI
  - POST /workspace/submit         Start autonomous generation job
  - GET /workspace/jobs/:id        Poll job status and stages
  - GET /workspace/jobs/:id/result Fetch compact result payload
  - GET /workspace/repros/:id/     Open generated local preview

Mode lock is always enforced:
  figmaSourceMode=rest
  llmCodegenMode=deterministic
`);
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv);

  if (options.command === "--help" || options.command === "help") {
    printHelp();
    process.exit(0);
  }

  if (options.command !== "start") {
    console.error(`Unknown command: ${options.command}`);
    console.error('Use "workspace-dev start" to start the server.');
    console.error('Use "workspace-dev --help" for usage information.');
    process.exit(1);
  }

  console.log(`[workspace-dev] Starting on http://${options.host}:${options.port}/workspace`);
  console.log("[workspace-dev] Mode lock: figmaSourceMode=rest, llmCodegenMode=deterministic");
  process.env.FIGMAPIPE_WORKSPACE_ENABLE_PERF_VALIDATION = options.enablePerfValidation ? "true" : "false";
  process.env.FIGMAPIPE_ENABLE_PERF_VALIDATION = options.enablePerfValidation ? "true" : "false";

  try {
    const server = await createWorkspaceServer({
      host: options.host,
      port: options.port,
      outputRoot: options.outputRoot,
      figmaRequestTimeoutMs: options.figmaTimeoutMs,
      figmaMaxRetries: options.figmaRetries,
      figmaBootstrapDepth: options.figmaBootstrapDepth,
      figmaNodeBatchSize: options.figmaNodeBatchSize,
      figmaNodeFetchConcurrency: options.figmaNodeFetchConcurrency,
      figmaAdaptiveBatchingEnabled: options.figmaAdaptiveBatchingEnabled,
      figmaMaxScreenCandidates: options.figmaMaxScreenCandidates,
      ...(options.figmaScreenNamePattern !== undefined
        ? { figmaScreenNamePattern: options.figmaScreenNamePattern }
        : {}),
      figmaCacheEnabled: options.figmaCacheEnabled,
      figmaCacheTtlMs: options.figmaCacheTtlMs,
      figmaScreenElementBudget: options.figmaScreenElementBudget,
      commandTimeoutMs: options.commandTimeoutMs,
      enableUiValidation: options.enableUiValidation,
      installPreferOffline: options.installPreferOffline,
      enablePreview: options.enablePreview
    });

    const shutdown = async (signal: string): Promise<void> => {
      console.log(`\n[workspace-dev] Received ${signal}, shutting down...`);
      await server.app.close();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    console.log(`[workspace-dev] Server ready at ${server.url}/workspace`);
    console.log(`[workspace-dev] Output root: ${options.outputRoot}`);
    console.log(`[workspace-dev] Preview enabled: ${options.enablePreview}`);
    console.log(`[workspace-dev] Perf validation enabled: ${options.enablePerfValidation}`);
    console.log(`[workspace-dev] UI validation enabled: ${options.enableUiValidation}`);
    console.log(`[workspace-dev] Install prefer-offline: ${options.installPreferOffline}`);
    console.log(`[workspace-dev] Figma cache enabled: ${options.figmaCacheEnabled}, ttlMs=${options.figmaCacheTtlMs}`);
    console.log(
      `[workspace-dev] Figma screen name pattern: ${options.figmaScreenNamePattern ?? "(unset)"}`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workspace-dev] Failed to start: ${message}`);
    process.exit(1);
  }
};

void main();
