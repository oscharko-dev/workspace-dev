import type { SaveOperationCommit } from "./types-edit-session.js";
import type {
  LlmApiKeyMode,
  SyncChangeClass,
  SyncRunResultStatus,
  SyncRunStatus,
  UiGateMode
} from "./types-core.js";
import type { MappingPolicy } from "./types-mapping.js";

export interface SyncChangeRecord {
  class: SyncChangeClass;
  screenId?: string;
  screenName?: string;
  nodeId?: string;
  confidence?: number;
  fallbackRegen?: boolean;
  details?: Record<string, unknown>;
}

export interface SyncDiffLine {
  type: "context" | "add" | "del";
  content: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface SyncDiffHunk {
  header: string;
  lines: SyncDiffLine[];
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: SyncDiffHunk[];
}

export interface DiffStats {
  files: number;
  additions: number;
  deletions: number;
}

export interface SyncDiffEvidence {
  files: DiffFile[];
  stats: DiffStats;
  changedFiles: string[];
  classCounts: Record<SyncChangeClass, number>;
  routeUpdated: boolean;
  tokenUpdated: boolean;
}

export interface SyncRunSummary {
  resultStatus: SyncRunResultStatus;
  changedFiles: string[];
  additions: number;
  deletions: number;
  classCounts: Record<SyncChangeClass, number>;
  routeUpdated: boolean;
  tokenUpdated: boolean;
  fallbackScreens: string[];
  commit?: SaveOperationCommit;
  prUrl?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface SyncRunRecord {
  id: string;
  boardKey: string;
  sessionId: string;
  jobId: string;
  source?: "live_edit" | "scheduled_sync";
  baseRef?: string;
  headRef?: string;
  truncated?: boolean;
  status: SyncRunStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  baselineSnapshotId?: string;
  snapshotId?: string;
  summary?: SyncRunSummary;
  changes: SyncChangeRecord[];
  diff: SyncDiffEvidence;
}

export interface PatchPlanStepWrite {
  type: "write";
  path: string;
  content: string;
}

export interface PatchPlanStepDelete {
  type: "delete";
  path: string;
}

export interface PatchPlan {
  steps: Array<PatchPlanStepWrite | PatchPlanStepDelete>;
  changedScreens: string[];
  fallbackScreens: string[];
  routeUpdated: boolean;
  tokenUpdated: boolean;
}

export interface BoardRegistryRecord {
  boardKey: string;
  figmaFileKey: string;
  branchName: string;
  targetPath: string;
  prUrl?: string;
  latestSnapshotId?: string;
  latestSuccessfulRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SyncPolicySchedule {
  intervalMinutes: number;
  timezone?: "UTC";
}

export interface SyncBranchPolicy {
  mode: "persistent" | "per_run";
  branchName?: string;
  branchPrefix?: string;
}

export interface SyncFailPolicy {
  onConflict: "retry_once" | "fail";
  onValidation: "warn" | "fail";
}

export interface UiGatePolicy {
  enabled: boolean;
  mode: UiGateMode;
  maxVisualDiffCount?: number;
  maxA11yViolationCount?: number;
  maxInteractionViolationCount?: number;
  requireRunner?: boolean;
}

export interface CredentialRef {
  profileId?: string;
  allowEnvFallback: boolean;
}

export interface SyncPolicy {
  boardKey: string;
  projectId: string;
  schedule: SyncPolicySchedule;
  branchPolicy: SyncBranchPolicy;
  failPolicy: SyncFailPolicy;
  uiGatePolicy: UiGatePolicy;
  mappingPolicy: MappingPolicy;
  credentialRefs: CredentialRef[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialProfilePayload {
  figmaAccessToken?: string;
  figmaOauthToken?: string;
  figmaOauthRefreshToken?: string;
  figmaOauthExpiresAt?: string;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmApiKeyMode?: LlmApiKeyMode;
  llmModel?: string;
  repoAuthToken?: string;
}

export interface CredentialProfileRecord {
  id: string;
  projectId: string;
  boardKey?: string;
  label: string;
  provider: "figma" | "llm" | "git" | "composite";
  payload: CredentialProfilePayload;
  keyVersion: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialProfileMetadata {
  id: string;
  projectId: string;
  boardKey?: string;
  label: string;
  provider: "figma" | "llm" | "git" | "composite";
  keyVersion: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
