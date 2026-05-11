import type {
  FigmaMcpAuthMode,
  FigmaSourceMode,
  JobEventType,
  JobExecutionMode,
  JobPreviewState,
  JobQueueStatus,
  JobStageState,
  JobState,
  JobWarningCode,
  LlmApiKeyMode,
  LlmCodegenMode,
  LlmProviderMode,
  RepoAuthSource,
  SyncChangeClass,
  UiGateMode,
} from "./types-core.js";
import type {
  MappingCoverageMetrics,
  MappingPolicy,
  ComponentMappingRule,
} from "./types-mapping.js";
import type { DesignTokens } from "./types-ir.js";
import type {
  CredentialRef,
  SyncBranchPolicy,
  SyncFailPolicy,
  UiGatePolicy,
} from "./types-sync.js";

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

export interface FigmaMcpVariableDefinition {
  name: string;
  kind: "color" | "number" | "string" | "boolean";
  value: string | number | boolean;
  collectionName?: string;
  modeName?: string;
  aliases?: string[];
  sourceNodeId?: string;
  sourceProperty?: string;
}

export type FigmaMcpStyleType =
  | "TEXT"
  | "FILL"
  | "STROKE"
  | "EFFECT"
  | (string & {});

export interface FigmaMcpStyleCatalogEntry {
  name: string;
  styleType: FigmaMcpStyleType;
  id?: string;
  fontSizePx?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  fontFamily?: string;
  letterSpacingPx?: number;
  color?: string;
  aliases?: string[];
}

export interface FigmaMcpCodeConnectMapping {
  nodeId: string;
  componentName: string;
  source: string;
  label?: string;
  semanticName?: string;
  semanticType?: string;
  propContract?: Record<string, unknown>;
}

export interface FigmaMcpDesignSystemMapping {
  nodeId: string;
  componentName: string;
  source: string;
  label?: string;
  semanticName?: string;
  semanticType?: string;
  propContract?: Record<string, unknown>;
  libraryKey?: string;
}

export interface FigmaMcpMetadataHint {
  nodeId: string;
  semanticName?: string;
  semanticType?: string;
  layerName?: string;
  layerType?: string;
  sourceTools: string[];
}

export interface FigmaMcpScreenshotReference {
  nodeId: string;
  url: string;
  mimeType?: string;
  purpose?: "quality-gate" | "context";
}

export interface FigmaMcpAssetReference {
  nodeId: string;
  source: string;
  kind: "image" | "svg" | "icon";
  mimeType?: string;
  alt?: string;
  label?: string;
  purpose?: "render" | "quality-gate" | "context";
}

export interface FigmaMcpAuthoritativeSubtree {
  nodeId: string;
  document: unknown;
}

export interface FigmaMcpEnrichmentDiagnostic {
  code: string;
  message: string;
  severity: "info" | "warning";
  source:
    | "loader"
    | "variables"
    | "styles"
    | "code_connect"
    | "design_system"
    | "metadata"
    | "screenshots"
    | "assets";
}

export interface FigmaMcpEnrichment {
  sourceMode: "mcp" | "hybrid";
  nodeHints: FigmaMcpNodeHint[];
  variables?: FigmaMcpVariableDefinition[];
  styleCatalog?: FigmaMcpStyleCatalogEntry[];
  cssCustomProperties?: string;
  tailwindExtension?: Record<string, Record<string, string>>;
  libraryKeys?: string[];
  modeAlternatives?: Record<string, Record<string, string | number | boolean>>;
  conflicts?: TokenConflict[];
  unmappedVariables?: string[];
  codeConnectMappings?: FigmaMcpCodeConnectMapping[];
  designSystemMappings?: FigmaMcpDesignSystemMapping[];
  heuristicComponentMappings?: FigmaMcpCodeConnectMapping[];
  metadataHints?: FigmaMcpMetadataHint[];
  authoritativeSubtrees?: FigmaMcpAuthoritativeSubtree[];
  assets?: FigmaMcpAssetReference[];
  screenshots?: FigmaMcpScreenshotReference[];
  diagnostics?: FigmaMcpEnrichmentDiagnostic[];
  toolNames: string[];
}

// ---------------------------------------------------------------------------
// Token bridge types (Issue #1001)
// ---------------------------------------------------------------------------

/**
 * Reasons why a token decision was non-trivial.
 *
 * - `value_override`: an incoming Figma value differs from the existing
 *   workspace value for the same `(name, mode)` key — the merge picked one.
 * - `library_alias_collision`: two or more distinct Figma variables resolve
 *   to the same library style by hex match. Renaming all of them to the
 *   library name would silently drop variables in `mergeVariablesWithExisting`
 *   (which keys by name+mode), so we keep their original names and surface
 *   the library name only as an alias on each claimant.
 */
export type TokenConflict =
  | {
      kind: "value_override";
      name: string;
      figmaValue: string;
      existingValue: string;
      resolution: "figma" | "existing";
    }
  | {
      kind: "library_alias_collision";
      libraryName: string;
      collidingVariables: Array<{
        name: string;
        value: string;
        modeName?: string;
      }>;
      resolution: "preserve_original";
    }
  | {
      kind: "alias_cycle";
      name: string;
      chain: string[];
    };

export interface TokenBridgeResult {
  variables: FigmaMcpVariableDefinition[];
  styleCatalog: FigmaMcpStyleCatalogEntry[];
  designTokens: DesignTokens;
  cssCustomProperties: string;
  tailwindExtension?: Record<string, Record<string, string>>;
  libraryKeys: string[];
  modeAlternatives: Record<string, Record<string, string | number | boolean>>;
  conflicts: TokenConflict[];
  unmappedVariables: string[];
  diagnostics: FigmaMcpEnrichmentDiagnostic[];
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

export interface PasteDeltaSummary {
  mode: "full" | "delta" | "auto_resolved_to_full" | "auto_resolved_to_delta";
  strategy: "baseline_created" | "no_changes" | "delta" | "structural_break";
  totalNodes: number;
  nodesReused: number;
  nodesReprocessed: number;
  structuralChangeRatio: number;
  pasteIdentityKey: string;
  priorManifestMissing: boolean;
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
  pasteDeltaSummary?: PasteDeltaSummary;
}

export interface JobSourceMeta {
  figmaFileKey?: string;
  figmaSourceMode: FigmaSourceMode;
  figmaMcpAuthMode: FigmaMcpAuthMode;
  boardKey?: string;
}

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

export interface JobMetrics {
  totalDurationMs?: number;
  retries: Record<string, number>;
  llm?: JobLlmMetrics;
  uiGate?: UiGateResult;
  mapping?: MappingCoverageMetrics;
}

export interface JobEvent {
  timestamp: string;
  type: JobEventType;
  level: "debug" | "info" | "warn" | "error";
  jobId: string;
  requestId?: string;
  stage?: string;
  code?: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

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
    broadPatternCount?: number;
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
