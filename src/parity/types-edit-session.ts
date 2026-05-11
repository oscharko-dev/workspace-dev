import type { EditSessionState, SyncRunStatus } from "./types-core.js";

export interface EditableFileNode {
  type: "file" | "directory";
  name: string;
  path: string;
  children?: EditableFileNode[];
}

export interface FileContentRecord {
  path: string;
  content: string;
  version: string;
  language: string;
}

export interface SaveOperationCommit {
  sha: string;
  message: string;
}

export interface SaveOperationResult {
  path: string;
  version: string;
  savedAt: string;
  commit: SaveOperationCommit | null;
  prUrl?: string;
}

export interface EditSessionEvent {
  timestamp: string;
  type: "info" | "warn" | "error" | "save" | "commit" | "build" | "hmr";
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface EditSessionGitStatus {
  enabled: boolean;
  branchName?: string;
  prUrl?: string;
  aheadCount: number;
  changedFiles: string[];
  lastCommit?: SaveOperationCommit;
}

export interface EditSessionSyncState {
  enabled: boolean;
  authConfigured: boolean;
  running: boolean;
  boardKey?: string;
  lastRunId?: string;
  latestRunStatus?: SyncRunStatus;
  lastError?: string;
}

export interface EditSessionTypecheckDiagnostic {
  filePath: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface EditSessionTypecheckResult {
  ok: boolean;
  diagnostics: EditSessionTypecheckDiagnostic[];
  totalErrors: number;
  checkedAt: string;
}

export interface EditSessionRecord {
  id: string;
  jobId: string;
  status: EditSessionState;
  workspaceDir: string;
  appRoot: string;
  previewUrl: string;
  runtimeMode?: "local" | "k8s";
  previewTarget?: string;
  devServerPort?: number;
  ideUrl?: string;
  ideTarget?: string;
  ideServerPort?: number;
  k8sPodName?: string;
  k8sServiceName?: string;
  syncAuthCiphertext?: string;
  branchName?: string;
  boardKey?: string;
  prUrl?: string;
  lastError?: string;
  fileVersions: Record<string, string>;
  events: EditSessionEvent[];
  git: EditSessionGitStatus;
  sync?: EditSessionSyncState;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  terminatedAt?: string;
}
