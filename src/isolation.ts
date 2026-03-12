/**
 * Per-project instance isolation for workspace-dev.
 *
 * Each project instance runs in its own child process with an OS-assigned port.
 * This ensures true runtime isolation: no shared state, ports, or artefacts
 * between concurrent projects.
 *
 * Cleanup is deterministic: instances are killed and temp directories removed
 * even when the parent process crashes or receives SIGTERM.
 */

import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { WorkspaceStartOptions } from "./contracts/index.js";

const PACKAGE_NAME = "workspace-dev";

const resolvePackageRoot = (): string => {
  const fromCwdRequire = createRequire(path.resolve(process.cwd(), "__workspace-dev-resolver__.cjs"));

  const candidateSpecifiers = [`${PACKAGE_NAME}/package.json`, "./package.json"];
  for (const specifier of candidateSpecifiers) {
    try {
      const resolved = fromCwdRequire.resolve(specifier);
      return path.dirname(resolved);
    } catch {
      // Continue with the next candidate.
    }
  }

  return process.cwd();
};

const packageRoot = resolvePackageRoot();

export interface ProjectInstance {
  /** Unique instance identifier. */
  instanceId: string;
  /** Project key this instance belongs to. */
  projectKey: string;
  /** Project-specific working directory. */
  workDir: string;
  /** Hostname the instance is bound to. */
  host: string;
  /** OS-assigned port the instance is listening on. */
  port: number;
  /** Timestamp when this instance was created. */
  createdAt: string;
}

interface ManagedInstance extends ProjectInstance {
  /** The child process running this instance. */
  process: ChildProcess;
}

const activeInstances = new Map<string, ManagedInstance>();

const toPublicInstance = (instance: ManagedInstance): ProjectInstance => ({
  instanceId: instance.instanceId,
  projectKey: instance.projectKey,
  workDir: instance.workDir,
  host: instance.host,
  port: instance.port,
  createdAt: instance.createdAt
});

// ── Deterministic cleanup on parent exit ────────────────────────────────────
let cleanupRegistered = false;

const registerParentCleanup = (): void => {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  const killAll = (): void => {
    for (const [key, inst] of activeInstances) {
      try {
        inst.process.kill("SIGTERM");
      } catch { /* already dead */ }
      activeInstances.delete(key);
    }
  };

  process.on("exit", killAll);
  process.on("SIGINT", () => { killAll(); process.exit(128 + 2); });
  process.on("SIGTERM", () => { killAll(); process.exit(128 + 15); });
  process.on("uncaughtException", (err) => {
    console.error("[isolation] uncaughtException — cleaning up instances", err);
    killAll();
    process.exit(1);
  });
};

interface ResolvedIsolationEntryPoint {
  path: string;
  execArgv: string[];
}

const resolveTsExecArgv = (): string[] => {
  const args = [...process.execArgv];
  const hasTsxImport = args.some((arg, index) => arg === "--import" && args[index + 1] === "tsx");
  if (!hasTsxImport) {
    args.push("--import", "tsx");
  }
  return args;
};

// ── Resolve the entry point for fork ────────────────────────────────────────
const resolveEntryPoint = (): ResolvedIsolationEntryPoint => {
  const jsPath = path.join(packageRoot, "dist", "isolated-server-entry.js");
  if (existsSync(jsPath)) {
    return { path: jsPath, execArgv: [] };
  }

  const tsPath = path.join(packageRoot, "src", "isolated-server-entry.ts");
  if (existsSync(tsPath)) {
    return { path: tsPath, execArgv: resolveTsExecArgv() };
  }

  throw new Error(
    "Unable to resolve isolated-server entrypoint. Expected dist/isolated-server-entry.js or src/isolated-server-entry.ts."
  );
};

export const resolveIsolationEntryPointForTest = (): ResolvedIsolationEntryPoint => {
  return resolveEntryPoint();
};

/**
 * Creates an isolated project instance in its own child process.
 *
 * The child process starts an HTTP server on port 0 (OS-assigned),
 * ensuring no port conflicts between concurrent instances.
 *
 * @param projectKey — Unique key for the project (e.g., Figma file key).
 * @param options — Server start options; workDir defaults to a temp-safe path.
 * @returns A promise that resolves once the instance is ready and listening.
 */
export const createProjectInstance = async (
  projectKey: string,
  options: WorkspaceStartOptions = {}
): Promise<ProjectInstance> => {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectKey)) {
    throw new Error(`Invalid projectKey '${projectKey}'. Only alphanumeric, dashes, and underscores are permitted.`);
  }

  if (activeInstances.has(projectKey)) {
    throw new Error(`Instance for project '${projectKey}' already exists. Remove it first.`);
  }

  registerParentCleanup();

  const baseDir = options.workDir ?? process.cwd();
  const workDir = path.join(baseDir, ".figmapipe", projectKey);
  await mkdir(workDir, { recursive: true });

  const host = options.host ?? "127.0.0.1";
  const entryPoint = resolveEntryPoint();

  return new Promise<ProjectInstance>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Instance for '${projectKey}' timed out during startup (10s).`));
    }, 10_000);

    const child = fork(entryPoint.path, [], {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      execArgv: entryPoint.execArgv,
      env: { ...process.env, NODE_ENV: "production" }
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      activeInstances.delete(projectKey);
      reject(new Error(`Failed to fork instance for '${projectKey}': ${err.message}`));
    });

    child.on("exit", () => {
      clearTimeout(timeout);
      activeInstances.delete(projectKey);
      // Clean up workdir on exit
      void rm(workDir, { recursive: true, force: true }).catch(() => {});
    });

    child.on("message", (msg: unknown) => {
      const message = msg as Record<string, unknown>;

      if (message.type === "awaiting_config") {
        // Send start config
        child.send({
          type: "start",
          config: {
            host,
            workDir,
            targetPath: options.targetPath ?? "figma-generated"
          }
        });
      } else if (message.type === "ready") {
        clearTimeout(timeout);

        const instance: ManagedInstance = {
          instanceId: message.instanceId as string,
          projectKey,
          workDir,
          host,
          port: message.port as number,
          createdAt: new Date().toISOString(),
          process: child
        };

        activeInstances.set(projectKey, instance);

        // Return public interface (without process reference)
        resolve(toPublicInstance(instance));
      } else if (message.type === "error") {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        const errorMessage =
          typeof message.message === "string" ? message.message : "unknown startup error";
        reject(new Error(`Instance for '${projectKey}' failed: ${errorMessage}`));
      }
    });
  });
};

/**
 * Returns the active instance for a project key, if any.
 */
export const getProjectInstance = (projectKey: string): ProjectInstance | undefined => {
  const inst = activeInstances.get(projectKey);
  if (!inst) return undefined;
  return toPublicInstance(inst);
};

/**
 * Stops and removes a project instance. Kills the child process and
 * cleans up the working directory.
 *
 * @returns true if an instance was found and removed, false otherwise.
 */
export const removeProjectInstance = async (projectKey: string): Promise<boolean> => {
  const inst = activeInstances.get(projectKey);
  if (!inst) return false;

  // Send graceful shutdown
  try {
    inst.process.send({ type: "shutdown" });
  } catch { /* IPC may already be closed */ }

  // Wait briefly for graceful exit, then force kill
  await new Promise<void>((resolve) => {
    const forceKillTimeout = setTimeout(() => {
      try { inst.process.kill("SIGKILL"); } catch { /* already dead */ }
      resolve();
    }, 3_000);

    inst.process.on("exit", () => {
      clearTimeout(forceKillTimeout);
      resolve();
    });
  });

  activeInstances.delete(projectKey);

  // Clean up workdir
  try {
    await rm(inst.workDir, { recursive: true, force: true });
  } catch { /* best effort */ }

  return true;
};

/**
 * Returns all active project instances (public interface only).
 */
export const listProjectInstances = (): ReadonlyMap<string, ProjectInstance> => {
  const result = new Map<string, ProjectInstance>();
  for (const [key, inst] of activeInstances) {
    result.set(key, toPublicInstance(inst));
  }
  return result;
};

/**
 * Removes all active instances. Used for cleanup in tests and shutdown.
 */
export const removeAllInstances = async (): Promise<void> => {
  const keys = [...activeInstances.keys()];
  await Promise.all(keys.map((k) => removeProjectInstance(k)));
};
