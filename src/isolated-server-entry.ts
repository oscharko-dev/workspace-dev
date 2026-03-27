/**
 * Isolated server entry point for forked child processes.
 *
 * Started via child_process.fork() from isolation.ts.
 * Receives config via IPC message, starts an HTTP server on port 0
 * (OS-assigned), and reports the resolved port back to the parent.
 *
 * Protocol:
 *   Parent → Child:  { type: "start", config: { host, workDir, targetPath, logFormat } }
 *   Child  → Parent: { type: "ready", port: number, instanceId: string }
 *   Child  → Parent: { type: "error", message: string }
 *   Parent → Child:  { type: "shutdown" }
 */

import { randomUUID } from "node:crypto";
import { createWorkspaceServer } from "./server.js";

const instanceId = randomUUID();

const handleMessage = async (msg: unknown): Promise<void> => {
  const message = msg as Record<string, unknown>;

  if (message.type === "start") {
    const config = message.config as Record<string, unknown>;
    const host = typeof config.host === "string" ? config.host : "127.0.0.1";
    const logFormat =
      config.logFormat === "text" || config.logFormat === "json" ? config.logFormat : undefined;

    try {
      const server = await createWorkspaceServer({
        host,
        port: 0,
        ...(logFormat ? { logFormat } : {})
      });

      // Report the OS-assigned port back to parent
      process.send?.({
        type: "ready",
        port: server.port,
        instanceId
      });

      // Listen for shutdown signal
      process.on("message", (shutdownMsg: unknown) => {
        const sm = shutdownMsg as Record<string, unknown>;
        if (sm.type === "shutdown") {
          void server.app.close().then(() => {
            process.exit(0);
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.send?.({ type: "error", message });
      process.exit(1);
    }
  }
};

process.on("message", (message: unknown) => {
  void handleMessage(message);
});

// Handle parent disconnect (parent crashed or was killed)
process.on("disconnect", () => {
  process.exit(0);
});

// Signal readiness to receive config
process.send?.({ type: "awaiting_config", instanceId });
