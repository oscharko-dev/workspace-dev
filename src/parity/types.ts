export type JobState = "pending" | "running" | "completed" | "failed";
export type DeploymentProfile = "default" | "strict_internal" | "appliance";
export type FigmaSourceMode = "rest" | "hybrid" | "mcp";
export type FigmaMcpAuthMode = "desktop" | "remote_oauth";
export type LlmCodegenMode = "deterministic" | "hybrid" | "llm_strict";
export type LlmProviderMode = "custom";
export type LlmApiKeyMode = "api-key" | "bearer";
export type LlmEndpointMode = "intranet_only" | "standard";
export type JobExecutionMode = "default" | "scheduled_sync";
export type UiGateMode = "warn" | "fail";
export type MappingGateMode = "warn" | "fail";
export type ValidatorInstallPolicy = "offline_only" | "offline_with_online_fallback";
export type JobStageState = "pending" | "running" | "completed" | "failed" | "skipped";
export type JobEventType = "job" | "stage" | "warning" | "log" | "metric";
export type JobWarningCode =
  | "W_MCP_ENRICHMENT_SKIPPED"
  | "W_LLM_RESPONSES_INCOMPLETE"
  | "W_LLM_STRICT_THEME_REJECTED"
  | "W_LLM_STRICT_SCREEN_REJECTED"
  | "W_LLM_STRICT_QUALITY_TARGET_MISSED"
  | (string & {});

export type RepoAuthSource = "request" | "runtime-default" | "none";

export interface RepoConfig {
  gitProvider: "github" | "gitlab";
  repoUrl: string;
  baseBranch: string;
  authToken: string;
  authSource?: RepoAuthSource;
  repoOwner?: string;
  repoName?: string;
  apiBaseUrl?: string;
  targetPath?: string;
}

export interface JobInput {
  figmaJsonBytes?: Buffer;
  figmaJsonFilename?: string;
  figmaFileKey?: string;
  figmaAccessToken?: string;
  figmaOauthToken?: string;
  figmaOauthProfileId?: string;
  figmaSourceMode: FigmaSourceMode;
  figmaMcpAuthMode: FigmaMcpAuthMode;
  figmaMcpServerUrl?: string;
  figmaMcpRegion?: string;
  llmProviderMode: LlmProviderMode;
  llmApiUrl?: string;
  llmApiKey?: string;
  llmApiKeyMode: LlmApiKeyMode;
  llmModel?: string;
  llmCodegenMode?: LlmCodegenMode;
  offlineMode: boolean;
  executionMode?: JobExecutionMode;
  scheduledSync?: {
    boardKey?: string;
    slotKey?: string;
    policyId?: string;
    preferredBranchName?: string;
    branchPolicy?: SyncBranchPolicy;
    failPolicy?: SyncFailPolicy;
  };
  componentMappings?: ComponentMappingRule[];
  uiGatePolicy?: UiGatePolicy;
  mappingPolicy?: MappingPolicy;
  credentialRefs?: CredentialRef[];
  repo: RepoConfig;
}

export interface FigmaMcpNodeHint {
  nodeId: string;
  semanticName?: string;
  semanticType?: string;
  sourceTools: string[];
}

export interface FigmaMcpEnrichment {
  sourceMode: "mcp" | "hybrid";
  nodeHints: FigmaMcpNodeHint[];
  toolNames: string[];
}

export interface JobDeltaSummary {
  strategy: "baseline_created" | "no_changes" | "patched";
  changedFiles: number;
  noChanges: boolean;
  scopePath?: string;
  classCounts?: Partial<Record<SyncChangeClass, number>>;
  routeUpdated?: boolean;
  tokenUpdated?: boolean;
  baselineSnapshotId?: string;
}

export interface JobDiffPreview {
  url: string;
  baseRef?: string;
  headRef?: string;
  truncated?: boolean;
  stats: {
    files: number;
    additions: number;
    deletions: number;
  };
}

export interface JobResult {
  prUrl?: string;
  reproUrl?: string;
  branchName?: string;
  changedFiles?: string[];
  deltaSummary?: JobDeltaSummary;
  diffPreview?: JobDiffPreview;
  reviewEvidenceId?: string;
  reviewEvidenceUrl?: string;
}

export interface JobSourceMeta {
  figmaFileKey?: string;
  figmaSourceMode: FigmaSourceMode;
  figmaMcpAuthMode: FigmaMcpAuthMode;
  boardKey?: string;
}

export type JobPreviewState = "pending" | "ready" | "unavailable" | "failed";

export interface JobPreview {
  sourceFirstMaskState: JobPreviewState;
  sourceFirstMaskUrl?: string;
  sourceFirstMaskMessage?: string;
}

export interface JobWarning {
  code: JobWarningCode;
  stage: string;
  message: string;
  retryable: boolean;
  timestamp: string;
}

export interface JobStage {
  name: string;
  status: JobStageState;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  errorCode?: string;
  message?: string;
  optional: boolean;
}

export interface JobLlmMetrics {
  mode: LlmCodegenMode;
  themeApplied: boolean;
  screenApplied: number;
  screenTotal: number;
  tokensIn?: number;
  tokensOut?: number;
  latencyMsP95?: number;
  fallbackTier?: number;
  responsesPollAttemptsMax?: number;
  responsesLastStatus?: string;
}

export interface JobMetrics {
  totalDurationMs?: number;
  retries: Record<string, number>;
  llm?: JobLlmMetrics;
  uiGate?: UiGateResult;
  mapping?: MappingCoverageMetrics;
}

export interface UiGateResult {
  status: "passed" | "warned" | "failed" | "skipped";
  mode: UiGateMode;
  visualDiffCount: number;
  a11yViolationCount: number;
  interactionViolationCount: number;
  runnerConfigured: boolean;
  degraded: boolean;
  artifacts: string[];
  blocking: boolean;
  summary?: string;
}

export interface JobEvent {
  timestamp: string;
  type: JobEventType;
  level: "info" | "warn" | "error";
  jobId: string;
  requestId?: string;
  stage?: string;
  code?: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  status: JobState;
  logs: string[];
  error?: string;
  failureCode?: string;
  result?: JobResult;
  sourceMeta?: JobSourceMeta;
  preview?: JobPreview;
  warnings?: JobWarning[];
  stages?: JobStage[];
  metrics?: JobMetrics;
  queueState?: JobQueueState;
  createdAt: string;
  updatedAt: string;
}

export type JobQueueStatus = "queued" | "running" | "idle";

export interface JobQueueState {
  status: JobQueueStatus;
  queuedAt?: string;
  startedAt?: string;
  /**
   * Optional queue rank. Some queue implementations intentionally omit this
   * when a live per-job position would require an unbounded scan.
   */
  position?: number;
}

export interface LatestSuccessPreview {
  sollView01Url: string;
  sollView02Url: string;
  finalUrl: string;
}

export interface LatestSuccessJobResponse {
  id: string;
  createdAt: string;
  updatedAt: string;
  result: JobResult;
  preview: LatestSuccessPreview;
}

export interface ProjectSummary {
  id: string;
  figmaFileKey: string;
  boardKey: string;
  name?: string;
  previewImageUrl?: string;
  latestJobId?: string;
  latestJobStatus?: JobState;
  latestReproUrl?: string;
  latestPrUrl?: string;
  latestBranchName?: string;
  jobsCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ProjectActivity {
  id: number;
  projectId: string;
  jobId?: string;
  type: string;
  status?: string;
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectDeleteResponse {
  projectId: string;
  deleted: true;
  removed: {
    project: number;
    activities: number;
    jobs: number;
    artifacts: number;
  };
  warnings?: string[];
}

export interface KpiDurationStats {
  avgMs?: number;
  p95Ms?: number;
}

export interface KpiRateStats {
  completionRate: number;
  failureRate: number;
  warningRate: number;
}

export interface ProjectKpiSnapshot {
  projectId: string;
  from: string;
  to: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  retriesTotal: number;
  retriesPerJob?: number;
  duration: KpiDurationStats;
  rates: KpiRateStats;
  mappingCoverageAvg?: number;
  uiGateWarnRate?: number;
}

export interface PortfolioKpiSnapshot {
  from: string;
  to: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  retriesTotal: number;
  retriesPerJob?: number;
  duration: KpiDurationStats;
  rates: KpiRateStats;
  mappingCoverageAvg?: number;
  uiGateWarnRate?: number;
  projects: Array<{
    projectId: string;
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
  }>;
}

export type KpiBucket = "day" | "week";

export interface KpiTrendBucket {
  bucketStart: string;
  bucketEnd: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  queueRejectedJobs: number;
  warningRate: number;
  uiGateWarnRate: number;
  retriesPerJob: number;
  mappingCoverageAvg?: number;
  duration: KpiDurationStats;
}

export interface KpiBaselineComparison {
  baselineFrom: string;
  baselineTo: string;
  currentFrom: string;
  currentTo: string;
  mappingCoverageDelta?: number;
  uiGateWarnRateDelta?: number;
  retriesPerJobDelta?: number;
}

export type KpiAlertCode =
  | "ALERT_MAPPING_COVERAGE_DROP"
  | "ALERT_UI_GATE_WARN_SPIKE"
  | "ALERT_RETRY_INFLATION"
  | "ALERT_QUEUE_SATURATION";

export interface KpiAlert {
  code: KpiAlertCode;
  severity: "warn";
  message: string;
  value: number;
  threshold: number;
}

export interface ProjectKpiResponse {
  projectId: string;
  boardKey: string;
  from: string;
  to: string;
  bucket: KpiBucket;
  summary: ProjectKpiSnapshot;
  trend: KpiTrendBucket[];
  baseline?: KpiBaselineComparison;
  alerts: KpiAlert[];
}

export interface PortfolioKpiResponse {
  from: string;
  to: string;
  bucket: KpiBucket;
  summary: PortfolioKpiSnapshot;
  trend: KpiTrendBucket[];
  baseline?: KpiBaselineComparison;
  alerts: KpiAlert[];
}

export type EditSessionState = "initializing" | "ready" | "saving" | "error" | "terminated";

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

export type SyncRunStatus = "queued" | "running" | "completed" | "failed";
export type SyncRunResultStatus = "baseline_created" | "no_changes" | "patched";
export type SyncChangeClass =
  | "TOKEN_VALUE_CHANGED"
  | "TOKEN_BINDING_CHANGED"
  | "STYLE_PROP_CHANGED"
  | "TEXT_CHANGED"
  | "STRUCTURE_CHANGED"
  | "SCREEN_ADDED"
  | "SCREEN_REMOVED"
  | "SCREEN_RENAMED";

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

export interface DesignTokenPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
}

export interface DesignTokens {
  palette: DesignTokenPalette;
  borderRadius: number;
  spacingBase: number;
  fontFamily: string;
  headingSize: number;
  bodySize: number;
}

export type PrimaryAxisAlignItems = "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
export type CounterAxisAlignItems = "MIN" | "CENTER" | "MAX" | "BASELINE";

export interface ScreenElementIR {
  id: string;
  name: string;
  nodeType: string;
  type:
    | "text"
    | "container"
    | "button"
    | "input"
    | "image"
    | "card"
    | "chip"
    | "switch"
    | "checkbox"
    | "radio"
    | "list"
    | "appbar"
    | "tab"
    | "dialog"
    | "stepper"
    | "progress"
    | "avatar"
    | "badge"
    | "divider"
    | "navigation";
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  textAlign?: "LEFT" | "CENTER" | "RIGHT";
  vectorPaths?: string[];
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  gap?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  cornerRadius?: number;
  children?: ScreenElementIR[];
}

export interface ScreenIR {
  id: string;
  name: string;
  layoutMode: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
  gap: number;
  width?: number;
  height?: number;
  fillColor?: string;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  children: ScreenElementIR[];
}

export interface ScreenElementCountMetric {
  screenId: string;
  screenName: string;
  elements: number;
}

export interface TruncatedScreenMetric {
  screenId: string;
  screenName: string;
  originalElements: number;
  retainedElements: number;
  budget: number;
}

export interface GenerationMetrics {
  fetchedNodes: number;
  skippedHidden: number;
  skippedPlaceholders: number;
  screenElementCounts: ScreenElementCountMetric[];
  truncatedScreens: TruncatedScreenMetric[];
  degradedGeometryNodes: string[];
}

export interface DesignIR {
  sourceName: string;
  screens: ScreenIR[];
  tokens: DesignTokens;
  metrics?: GenerationMetrics;
}

export interface DesignNodeFingerprint {
  nodeId: string;
  name: string;
  type: ScreenElementIR["type"];
  nodeType: string;
  boundVariables?: string[];
  text?: string;
  fillColor?: string;
  strokeColor?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutMode?: "VERTICAL" | "HORIZONTAL" | "NONE";
  primaryAxisAlignItems?: PrimaryAxisAlignItems;
  counterAxisAlignItems?: CounterAxisAlignItems;
}

export interface DesignScreenFingerprint {
  screenId: string;
  name: string;
  filePath: string;
  nodes: DesignNodeFingerprint[];
}

export interface DesignManifest {
  boardKey: string;
  figmaFileKey: string;
  generatedAt: string;
  tokens: DesignTokens;
  screens: DesignScreenFingerprint[];
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ValidationFailure {
  command: string;
  output: string;
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

export interface MappingPolicy {
  enabled: boolean;
  mode: MappingGateMode;
  minCoverageRatio?: number;
  minUsedMappings?: number;
  maxContractMismatchCount?: number;
  maxMissingMappingCount?: number;
}

export interface MappingCoverageMetrics {
  usedMappings: number;
  fallbackNodes: number;
  totalCandidateNodes: number;
  coverageRatio: number;
  contractMismatchCount: number;
  missingMappingCount: number;
  disabledMappingCount: number;
  status: "passed" | "warned" | "failed";
  policy?: MappingPolicy;
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

export type ComponentMappingSource = "local_override" | "code_connect_import";

export interface ComponentMappingRule {
  id?: number;
  boardKey: string;
  nodeId: string;
  componentName: string;
  importPath: string;
  propContract?: Record<string, unknown>;
  priority: number;
  source: ComponentMappingSource;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComponentMappingCoverage {
  boardKey: string;
  totalMappings: number;
  enabledMappings: number;
  bySource: Record<ComponentMappingSource, number>;
}

export interface ReviewEvidenceSummary {
  jobId: string;
  mode: JobExecutionMode;
  repoAuthSource?: RepoAuthSource;
  changedScreens: string[];
  changedComponents: string[];
  changedTokens: string[];
  mcpNodeHintCount: number;
  llmMode?: LlmCodegenMode;
  llmThemeApplied?: boolean;
  llmScreensApplied?: number;
  llmScreensTotal?: number;
  validatorSummary?: {
    fixIterations: number;
    uiGate?: UiGateResult;
  };
  mappingCoverage?: {
    usedMappings: number;
    fallbackNodes: number;
    totalCandidateNodes: number;
    contractMismatchCount?: number;
    missingMappingCount?: number;
    disabledMappingCount?: number;
  };
  deltaSummary?: JobDeltaSummary;
  diffPreview?: JobDiffPreview;
  warnings: JobWarning[];
  retries: Record<string, number>;
  totalDurationMs?: number;
  reproUrl?: string;
  prUrl?: string;
  generatedAt: string;
}

export interface ReviewEvidenceRecord {
  jobId: string;
  summary: ReviewEvidenceSummary;
  artifactPath: string;
  prCommentPosted: boolean;
  prCommentUrl?: string;
  createdAt: string;
  updatedAt: string;
}
