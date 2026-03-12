import { WorkspaceStartOptions } from './contracts/index.js';
export { CONTRACT_VERSION, WorkspaceFigmaSourceMode, WorkspaceJobInput, WorkspaceJobResult, WorkspaceLlmCodegenMode, WorkspaceStatus, WorkspaceVersionInfo } from './contracts/index.js';

/**
 * Workspace-dev HTTP server.
 *
 * Provides the `/workspace` endpoint and a mode-locked submission validation path.
 * Binds to 127.0.0.1:1983 by default (configurable via options).
 *
 * All incoming requests are validated at runtime without external dependencies.
 * Invalid requests receive deterministic error responses with structured issues.
 */

interface InjectResponse {
    statusCode: number;
    body: string;
    headers: Record<string, string>;
    json: <T = unknown>() => T;
}
interface InjectRequest {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
}
interface WorkspaceServerApp {
    close: () => Promise<void>;
    inject: (request: InjectRequest) => Promise<InjectResponse>;
    addresses: () => Array<{
        address: string;
        family: string;
        port: number;
    }>;
}
interface WorkspaceServer {
    app: WorkspaceServerApp;
    url: string;
    host: string;
    port: number;
    startedAt: number;
}
declare const createWorkspaceServer: (options?: WorkspaceStartOptions) => Promise<WorkspaceServer>;

/**
 * Mode-lock enforcement for workspace-dev.
 *
 * Only `figmaSourceMode=rest` and `llmCodegenMode=deterministic` are allowed.
 * All other modes are blocked with explicit error messages.
 */
declare const ALLOWED_FIGMA_SOURCE_MODE: "rest";
declare const ALLOWED_LLM_CODEGEN_MODE: "deterministic";
interface ModeLockValidationResult {
    valid: boolean;
    errors: string[];
}
declare function validateModeLock(input: {
    figmaSourceMode?: string;
    llmCodegenMode?: string;
}): ModeLockValidationResult;
declare function enforceModeLock(input: {
    figmaSourceMode?: string;
    llmCodegenMode?: string;
}): void;
declare function getWorkspaceDefaults(): {
    figmaSourceMode: typeof ALLOWED_FIGMA_SOURCE_MODE;
    llmCodegenMode: typeof ALLOWED_LLM_CODEGEN_MODE;
};

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

interface ProjectInstance {
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
declare const createProjectInstance: (projectKey: string, options?: WorkspaceStartOptions) => Promise<ProjectInstance>;
/**
 * Returns the active instance for a project key, if any.
 */
declare const getProjectInstance: (projectKey: string) => ProjectInstance | undefined;
/**
 * Stops and removes a project instance. Kills the child process and
 * cleans up the working directory.
 *
 * @returns true if an instance was found and removed, false otherwise.
 */
declare const removeProjectInstance: (projectKey: string) => Promise<boolean>;
/**
 * Returns all active project instances (public interface only).
 */
declare const listProjectInstances: () => ReadonlyMap<string, ProjectInstance>;
/**
 * Removes all active instances. Used for cleanup in tests and shutdown.
 */
declare const removeAllInstances: () => Promise<void>;

export { type ModeLockValidationResult, type ProjectInstance, type WorkspaceServer, WorkspaceStartOptions, createProjectInstance, createWorkspaceServer, enforceModeLock, getProjectInstance, getWorkspaceDefaults, listProjectInstances, removeAllInstances, removeProjectInstance, validateModeLock };
