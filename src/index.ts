/**
 * workspace-dev — Public API surface.
 *
 * Re-exports contracts, server factory, mode-lock utilities,
 * and per-project isolation helpers.
 */

export type {
  WorkspaceFigmaSourceMode,
  WorkspaceLlmCodegenMode,
  WorkspaceBrandTheme,
  WorkspaceFormHandlingMode,
  WorkspaceRouterMode,
  WorkspaceStartOptions,
  WorkspaceStatus,
  WorkspaceJobInput,
  WorkspaceJobResult,
  WorkspaceVersionInfo
} from "./contracts/index.js";

export { CONTRACT_VERSION } from "./contracts/index.js";

export { createWorkspaceServer } from "./server.js";
export type { WorkspaceServer } from "./server.js";

export {
  validateModeLock,
  enforceModeLock,
  getWorkspaceDefaults
} from "./mode-lock.js";
export type { ModeLockValidationResult } from "./mode-lock.js";

export {
  createProjectInstance,
  getProjectInstance,
  removeProjectInstance,
  removeAllInstances,
  listProjectInstances,
  registerIsolationProcessCleanup,
  unregisterIsolationProcessCleanup
} from "./isolation.js";
export type { ProjectInstance } from "./isolation.js";
