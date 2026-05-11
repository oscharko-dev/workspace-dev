/**
 * Per-project instance isolation for workspace-dev.
 *
 * Each project instance runs in its own child process with an OS-assigned port.
 * This ensures true runtime isolation: no shared state, ports, or artefacts
 * between concurrent projects.
 *
 * Cleanup is deterministic through explicit lifecycle APIs, with optional
 * process-level cleanup registration for host applications that want it.
 */

import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { WorkspaceStartOptions } from "./contracts/index.js";
import {
  isIsolatedChildAwaitingConfigMessage,
  isIsolatedChildErrorMessage,
  isIsolatedChildReadyMessage,
  type IsolatedChildStartConfig
} from "./isolation-startup-contract.js";

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

/**
 * Parent-process registry of active child instances.
 *
 * Architectural invariant: this mutable module-global Map is only safe because
 * workspace-dev assumes single-threaded access within one Node.js event loop.
 * It is not safe to share across worker_threads or any other concurrent
 * mutation model without explicit synchronization or a different ownership
 * design.
 *
 * The registry owns child-process lifecycle state for both targeted removal
 * and best-effort host cleanup:
 * - removeProjectInstance() sends IPC shutdown, waits up to 3 seconds, then
 *   falls back to SIGKILL.
 * - registerIsolationProcessCleanup() uses best-effort SIGTERM during host
 *   process shutdown hooks.
 */
const activeInstances = new Map<string, ManagedInstance>();

const toPublicInstance = (instance: ManagedInstance): ProjectInstance => ({
  instanceId: instance.instanceId,
  projectKey: instance.projectKey,
  workDir: instance.workDir,
  host: instance.host,
  port: instance.port,
  createdAt: instance.createdAt
});

// ── Optional host-process cleanup registration ──────────────────────────────
let cleanupRegistered = false;

const killAllActiveInstances = (): void => {
  for (const [key, inst] of activeInstances) {
    try {
      inst.process.send({ type: "shutdown" });
      setTimeout(() => {
        try {
          inst.process.kill("SIGTERM");
        } catch {
          // Ignore already-dead processes during best-effort cleanup.
        }
      }, 3_000).unref();
    } catch {
      // Ignore already-dead processes during best-effort cleanup.
    }
    activeInstances.delete(key);
  }
};

const processCleanupListeners: Partial<Record<"exit" | "SIGINT" | "SIGTERM", () => void>> = {};

export const registerIsolationProcessCleanup = (): void => {
  if (cleanupRegistered) {
    return;
  }
  cleanupRegistered = true;

  const handleExit = () => {
    killAllActiveInstances();
  };
  const handleSigint = () => {
    killAllActiveInstances();
  };
  const handleSigterm = () => {
    killAllActiveInstances();
  };

  processCleanupListeners.exit = handleExit;
  processCleanupListeners.SIGINT = handleSigint;
  processCleanupListeners.SIGTERM = handleSigterm;

  process.on("exit", handleExit);
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);
};

export const unregisterIsolationProcessCleanup = (): void => {
  if (!cleanupRegistered) {
    return;
  }
  cleanupRegistered = false;

  if (processCleanupListeners.exit) {
    process.off("exit", processCleanupListeners.exit);
    delete processCleanupListeners.exit;
  }
  if (processCleanupListeners.SIGINT) {
    process.off("SIGINT", processCleanupListeners.SIGINT);
    delete processCleanupListeners.SIGINT;
  }
  if (processCleanupListeners.SIGTERM) {
    process.off("SIGTERM", processCleanupListeners.SIGTERM);
    delete processCleanupListeners.SIGTERM;
  }
};

interface ResolvedIsolationEntryPoint {
  path: string;
  execArgv: string[];
}

const ISOLATED_CHILD_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SHELL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "PNPM_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR"
] as const;

export const buildIsolatedChildProcessEnv = ({
  parentEnv = process.env
}: {
  parentEnv?: NodeJS.ProcessEnv;
} = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production"
  };

  for (const key of ISOLATED_CHILD_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
};

const createIsolatedChildStartConfig = ({
  host,
  workDir,
  logFormat,
  shutdownTimeoutMs
}: {
  host: string;
  workDir: string;
  logFormat?: WorkspaceStartOptions["logFormat"];
  shutdownTimeoutMs?: WorkspaceStartOptions["shutdownTimeoutMs"];
}): IsolatedChildStartConfig => {
  return {
    host,
    workDir,
    ...(logFormat ? { logFormat } : {}),
    ...(shutdownTimeoutMs !== undefined ? { shutdownTimeoutMs } : {})
  };
};

const isTsxRuntimeArg = (value: string): boolean => {
  return value === "tsx" || value.includes("/tsx/") || value.includes("\\tsx\\");
};

const isRunningWithTsx = (): boolean => {
  return process.execArgv.some((arg) => isTsxRuntimeArg(arg));
};

const resolveTsExecArgv = (): string[] => {
  if (isRunningWithTsx()) {
    const args: string[] = [];

    for (let index = 0; index < process.execArgv.length; index += 1) {
      const arg = process.execArgv[index];
      const nextArg = process.execArgv[index + 1];
      const isTsxPairFlag = arg === "--import" || arg === "--require" || arg === "--loader";
      if (isTsxPairFlag && typeof nextArg === "string" && isTsxRuntimeArg(nextArg)) {
        args.push(arg, nextArg);
        index += 1;
      }
    }

    if (args.length > 0) {
      return args;
    }
  }

  return ["--import", "tsx"];
};

// ── Resolve the entry point for fork ────────────────────────────────────────
const resolveEntryPoint = (): ResolvedIsolationEntryPoint => {
  const tsPath = path.join(packageRoot, "src", "isolated-server-entry.ts");
  if (isRunningWithTsx() && existsSync(tsPath)) {
    return { path: tsPath, execArgv: resolveTsExecArgv() };
  }

  const jsPath = path.join(packageRoot, "dist", "isolated-server-entry.js");
  if (existsSync(jsPath)) {
    return { path: jsPath, execArgv: [] };
  }

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
      env: buildIsolatedChildProcessEnv()
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
      if (isIsolatedChildAwaitingConfigMessage(msg)) {
        // Keep targetPath in WorkspaceStartOptions for compatibility with callers
        // that reuse submit-time option objects, but isolated server startup does
        // not define target-root behavior and intentionally omits it from IPC.
        child.send({
          type: "start",
          config: createIsolatedChildStartConfig({
            host,
            workDir,
            logFormat: options.logFormat,
            shutdownTimeoutMs: options.shutdownTimeoutMs
          })
        });
      } else if (isIsolatedChildReadyMessage(msg)) {
        clearTimeout(timeout);

        const instance: ManagedInstance = {
          instanceId: msg.instanceId,
          projectKey,
          workDir,
          host,
          port: msg.port,
          createdAt: new Date().toISOString(),
          process: child
        };

        activeInstances.set(projectKey, instance);

        // Return public interface (without process reference)
        resolve(toPublicInstance(instance));
      } else if (isIsolatedChildErrorMessage(msg)) {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        reject(new Error(`Instance for '${projectKey}' failed: ${msg.message}`));
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
