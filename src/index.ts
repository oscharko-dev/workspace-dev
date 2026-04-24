/**
 * workspace-dev — Public API surface.
 *
 * Re-exports contracts, server factory, mode-lock utilities,
 * and per-project isolation helpers.
 */

export type {
  WorkspaceFigmaSourceMode,
  WorkspaceLlmCodegenMode,
  WorkspaceJobType,
  WorkspaceTestIntelligenceMode,
  WorkspaceBrandTheme,
  WorkspaceFormHandlingMode,
  WorkspaceImportSession,
  WorkspaceImportSessionDeleteResult,
  WorkspaceImportSessionReimportAccepted,
  WorkspaceImportSessionScope,
  WorkspaceImportSessionSourceMode,
  WorkspaceLogFormat,
  WorkspaceRouterMode,
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
  ALLOWED_TEST_INTELLIGENCE_MODES,
  ALLOWED_WORKSPACE_JOB_TYPES,
  CONTRACT_VERSION,
  GENERATED_TEST_CASE_SCHEMA_VERSION,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  TEST_INTELLIGENCE_ENV,
  TEST_INTELLIGENCE_PROMPT_TEMPLATE_VERSION,
} from "./contracts/index.js";

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
