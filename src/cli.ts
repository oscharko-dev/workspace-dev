#!/usr/bin/env node
/**
 * CLI entry point for workspace-dev.
 *
 * Usage:
 *   workspace-dev start [--port 1983] [--host 127.0.0.1]
 *
 * Alias:
 *   figmapipe-workspace-dev start [--port 1983] [--host 127.0.0.1]
 *
 * Environment variables:
 *   FIGMAPIPE_WORKSPACE_PORT  - Override default port (1983)
 *   FIGMAPIPE_WORKSPACE_HOST  - Override default host (127.0.0.1)
 */

import { createWorkspaceServer } from "./server.js";

const DEFAULT_PORT = 1983;
const DEFAULT_HOST = "127.0.0.1";

const parseArgs = (argv: string[]): { command: string; port: number; host: string } => {
  const args = argv.slice(2);
  const command = args[0] ?? "start";

  let port = DEFAULT_PORT;
  let host = DEFAULT_HOST;

  const envPort = process.env.FIGMAPIPE_WORKSPACE_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
      port = parsed;
    }
  }

  const envHost = process.env.FIGMAPIPE_WORKSPACE_HOST;
  if (envHost?.trim()) {
    host = envHost.trim();
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      const parsed = parseInt(args[i + 1], 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
        port = parsed;
        i++;
      }
    }
    if (args[i] === "--host" && args[i + 1]) {
      host = args[i + 1].trim();
      i++;
    }
  }

  return { command, port, host };
};

const printHelp = (): void => {
  console.log(`
workspace-dev - Local workspace status and validation server

Usage:
  workspace-dev start [options]
  workspace-dev --help

Alias:
  figmapipe-workspace-dev start [options]

Options:
  --port <port>    Port to listen on (default: ${DEFAULT_PORT})
  --host <host>    Host to bind to (default: ${DEFAULT_HOST})
  --help           Show this help message

Environment variables:
  FIGMAPIPE_WORKSPACE_PORT    Override default port
  FIGMAPIPE_WORKSPACE_HOST    Override default host

Capabilities:
  - GET /workspace          Server status (mode info, uptime)
  - GET /workspace/ui       Storybook-inspired local UI shell
  - GET /healthz            Health check probe
  - POST /workspace/submit  Mode-locked request validation (execution not implemented)

Note:
  This server validates requests but does not execute Figma fetch,
  code generation, or filesystem output.

Examples:
  workspace-dev start
  workspace-dev start --port 3000
  FIGMAPIPE_WORKSPACE_PORT=8080 workspace-dev start
`);
};

const main = async (): Promise<void> => {
  const { command, port, host } = parseArgs(process.argv);

  if (command === "--help" || command === "help") {
    printHelp();
    process.exit(0);
  }

  if (command !== "start") {
    console.error(`Unknown command: ${command}`);
    console.error('Use "workspace-dev start" to start the server.');
    console.error('Use "workspace-dev --help" for usage information.');
    process.exit(1);
  }

  console.log(`[workspace-dev] Starting on http://${host}:${port}/workspace`);
  console.log("[workspace-dev] Mode: figmaSourceMode=rest, llmCodegenMode=deterministic");

  try {
    const server = await createWorkspaceServer({ host, port });

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[workspace-dev] Failed to start: ${message}`);
    process.exit(1);
  }
};

void main();
