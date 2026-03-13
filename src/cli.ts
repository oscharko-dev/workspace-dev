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

interface CliOptions {
  command: string;
  port: number;
  host: string;
  outputRoot: string;
  figmaTimeoutMs: number;
  figmaRetries: number;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workspace-dev] Failed to start: ${message}`);
    process.exit(1);
  }
};

void main();
