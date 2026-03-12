/**
 * workspace-dev — Public contracts for REST + deterministic mode.
 *
 * These types define the public API surface for workspace-dev consumers.
 * They must not import from internal services.
 *
 * Contract version: 1.0.0
 * See CONTRACT_CHANGELOG.md for change history and versioning rules.
 */

/** Allowed Figma source modes for workspace-dev. */
export type WorkspaceFigmaSourceMode = "rest";

/** Allowed codegen modes for workspace-dev. */
export type WorkspaceLlmCodegenMode = "deterministic";

/** Configuration for starting a workspace-dev server instance. */
export interface WorkspaceStartOptions {
  /** Host to bind to. Default: "127.0.0.1" */
  host?: string;
  /** Port to bind to. Default: 1983 */
  port?: number;
  /** Project-specific working directory. Default: process.cwd() */
  workDir?: string;
  /** Reserved for future use. Not consumed by the current runtime. */
  figmaAccessToken?: string;
  /** Reserved for future use. Not consumed by the current runtime. */
  figmaFileKey?: string;
  /** Reserved for future use by isolation helpers. */
  targetPath?: string;
}

/** Status of a running workspace-dev instance. */
export interface WorkspaceStatus {
  running: boolean;
  url: string;
  host: string;
  port: number;
  figmaSourceMode: WorkspaceFigmaSourceMode;
  llmCodegenMode: WorkspaceLlmCodegenMode;
  uptimeMs: number;
}

/** Minimal submission payload accepted for request validation. */
export interface WorkspaceJobInput {
  figmaFileKey: string;
  figmaSourceMode?: string;
  llmCodegenMode?: string;
  projectName?: string;
}

/** Current response shape for validated submit requests. */
export interface WorkspaceJobResult {
  status: "not_implemented";
  error: "SUBMIT_NOT_IMPLEMENTED";
  message: string;
}

/** Version information for the workspace-dev package. */
export interface WorkspaceVersionInfo {
  version: string;
  contractVersion: string;
}

/**
 * Current contract version constant.
 * Must be bumped according to CONTRACT_CHANGELOG.md rules.
 */
export const CONTRACT_VERSION = "1.0.0" as const;
