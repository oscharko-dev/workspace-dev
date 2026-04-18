/**
 * Isolated server entry point for forked child processes.
 *
 * Started via child_process.fork() from isolation.ts.
 * Receives config via IPC message, starts an HTTP server on port 0
 * (OS-assigned), and reports the resolved port back to the parent.
 *
 * Protocol:
 *   Parent → Child:  { type: "start", config: { host, workDir, logFormat? } }
 *   Child  → Parent: { type: "ready", port: number, instanceId: string }
 *   Child  → Parent: { type: "error", message: string }
 *   Parent → Child:  { type: "shutdown" }
 */

import { randomUUID } from "node:crypto";
import { createWorkspaceServer, type WorkspaceServer } from "./server.js";
import {
  isIsolatedChildShutdownMessage,
  isIsolatedChildStartMessage
} from "./isolation-startup-contract.js";

const instanceId = randomUUID();
let activeServer: WorkspaceServer | undefined;
let hasStarted = false;

const shutdown = async (): Promise<void> => {
  const server = activeServer;
  activeServer = undefined;

  if (!server) {
    process.exit(0);
    return;
  }

  try {
    await server.app.close();
  } catch {
    // Ignore shutdown errors during child teardown.
  }

  process.exit(0);
};

const handleMessage = async (msg: unknown): Promise<void> => {
  if (isIsolatedChildShutdownMessage(msg)) {
    await shutdown();
    return;
  }

  if (!isIsolatedChildStartMessage(msg)) {
    return;
  }

  if (hasStarted) {
    process.send?.({ type: "error", message: "Isolated workspace server already started." });
    process.exit(1);
    return;
  }

  hasStarted = true;
  const { host, workDir, logFormat, shutdownTimeoutMs } = msg.config;

  try {
    activeServer = await createWorkspaceServer({
      host,
      port: 0,
      workDir,
      ...(logFormat ? { logFormat } : {}),
      ...(shutdownTimeoutMs !== undefined ? { shutdownTimeoutMs } : {})
    });

    process.send?.({
      type: "ready",
      port: activeServer.port,
      instanceId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.send?.({ type: "error", message });
    process.exit(1);
  }
};

process.on("message", (message: unknown) => {
  void handleMessage(message);
});

// Handle parent disconnect (parent crashed or was killed)
process.on("disconnect", () => {
  void shutdown();
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

// Signal readiness to receive config
process.send?.({ type: "awaiting_config", instanceId });
