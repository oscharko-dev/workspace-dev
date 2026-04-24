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
  WorkspaceImportSession,
  WorkspaceImportSessionDeleteResult,
  WorkspaceImportSessionReimportAccepted,
  WorkspaceImportSessionScope,
  WorkspaceImportSessionSourceMode,
  WorkspaceLogFormat,
  WorkspaceRouterMode,
  WorkspaceTestSpaceCase,
  WorkspaceTestSpaceCoverageFinding,
  WorkspaceTestSpaceMarkdownArtifact,
  WorkspaceTestSpaceQcMappingDraft,
  WorkspaceTestSpaceRun,
  WorkspaceTestSpaceRunRequest,
  WorkspaceTestSpaceRunRequestSummary,
  WorkspaceTestSpaceStep,
  WorkspaceVisualQualityReferenceMode,
  WorkspaceStartOptions,
  WorkspaceStatus,
  WorkspaceJobInput,
  WorkspaceVisualAuditInput,
  WorkspaceVisualCaptureConfig,
  WorkspaceVisualDiffConfig,
  WorkspaceVisualDiffRegion,
  WorkspaceVisualAuditRegionResult,
  WorkspaceVisualAuditStatus,
  WorkspaceVisualAuditResult,
  WorkspaceVisualReferenceFixtureMetadata,
  WorkspaceVisualScoringWeights,
  WorkspaceVisualDimensionScore,
  WorkspaceVisualDeviationHotspot,
  WorkspaceVisualComparisonMetadata,
  WorkspaceVisualQualityReport,
  WorkspaceJobResult,
  WorkspaceVersionInfo,
} from "./contracts/index.js";

export {
  ALLOWED_FIGMA_SOURCE_MODES,
  ALLOWED_LLM_CODEGEN_MODES,
  CONTRACT_VERSION,
} from "./contracts/index.js";

export {
  DEFAULT_TEST_SPACE_MODEL_DEPLOYMENT,
  DEFAULT_TEST_SPACE_QC_WRITE_ENABLED,
  WORKSPACE_TEST_SPACE_AZURE_BEARER_TOKEN_ENV,
  WORKSPACE_TEST_SPACE_MODEL_DEPLOYMENT_ENV,
  WORKSPACE_TEST_SPACE_MODEL_ENDPOINT_ENV,
  WORKSPACE_TEST_SPACE_QC_BASE_URL_ENV,
  WORKSPACE_TEST_SPACE_QC_CLIENT_ID_ENV,
  WORKSPACE_TEST_SPACE_QC_CLIENT_SECRET_ENV,
  WORKSPACE_TEST_SPACE_QC_DOMAIN_ENV,
  WORKSPACE_TEST_SPACE_QC_PROJECT_ENV,
  WORKSPACE_TEST_SPACE_QC_WRITE_ENABLED_ENV,
} from "./test-space/constants.js";

export { createWorkspaceServer } from "./server.js";
export type { WorkspaceServer } from "./server.js";
export type {
  InjectRequest,
  InjectResponse,
  WorkspaceServerApp,
} from "./server/app-inject.js";

export {
  validateModeLock,
  enforceModeLock,
  getWorkspaceDefaults,
} from "./mode-lock.js";
export type { ModeLockValidationResult } from "./mode-lock.js";

export {
  createProjectInstance,
  getProjectInstance,
  removeProjectInstance,
  removeAllInstances,
  listProjectInstances,
  registerIsolationProcessCleanup,
  unregisterIsolationProcessCleanup,
} from "./isolation.js";
export type { ProjectInstance } from "./isolation.js";

export * from "./job-engine/visual-capture.js";
export * from "./job-engine/visual-diff.js";
export * from "./job-engine/visual-scoring.js";
