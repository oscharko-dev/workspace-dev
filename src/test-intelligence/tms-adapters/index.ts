/**
 * Public surface for the production-grade TMS adapters family
 * (Issue #2183, Wave 8).
 *
 * Importers wire the orchestrator into the CLI by composing one of
 * the four `create*Adapter` factories with an injected
 * `TmsHttpClient`. The orchestrator (`runTmsPushPipeline`) takes the
 * resulting `TmsAdapter` and drives the full lifecycle.
 */

export {
  ALM_ADAPTER_VERSION,
  createAlmAdapter,
  type CreateAlmAdapterInput,
} from "./alm-adapter.js";
export {
  createPolarionAdapter,
  POLARION_ADAPTER_VERSION,
  type CreatePolarionAdapterInput,
  type PolarionWebDavClient,
} from "./polarion-adapter.js";
export {
  createQtestAdapter,
  QTEST_ADAPTER_VERSION,
  type CreateQtestAdapterInput,
} from "./qtest-adapter.js";
export {
  createXrayAdapter,
  XRAY_ADAPTER_VERSION,
  type CreateXrayAdapterInput,
} from "./xray-adapter.js";
export {
  DEFAULT_TMS_PUSH_BATCH_SIZE,
  DEFAULT_TMS_REQUEST_TIMEOUT_MS,
  MAX_TMS_FAILURE_DETAIL_LENGTH,
  TmsAdapterError,
  TmsAuthError,
  TmsRateLimitError,
  TmsTransportError,
  TmsValidationError,
  type TmsAdapter,
  type TmsAdapterClock,
  type TmsAdapterSession,
  type TmsConnectInput,
  type TmsCredentials,
  type TmsHttpClient,
  type TmsHttpRequest,
  type TmsHttpResponse,
  type TmsMappedCase,
  type TmsPushAttemptResult,
  type TmsPushBatchResult,
  type TmsSyncStatus,
  type TmsValidateProjectResult,
} from "./tms-adapter-contract.js";
export {
  buildBasicAuthHeader,
  buildTmsPushReportPath,
  chunkBatches,
  classifyTmsHttpFailure,
  computeTmsIdempotencyKey,
  DEFAULT_TMS_PRINCIPAL_ID,
  DEFAULT_TMS_RETRY_ATTEMPTS,
  DEFAULT_TMS_RETRY_BASE_MS,
  DEFAULT_TMS_RETRY_CEIL_MS,
  executeWithRetry,
  isSupportedAuthKind,
  loadTmsCredentialsFromEnv,
  resolvePrincipalId,
  sanitizeTmsErrorDetail,
  TMS_ADAPTER_ENV_NAMES,
  writeTmsAtomicJson,
  type ExecuteWithRetryInput,
  type LoadTmsCredentialsFromEnvInput,
  type LoadTmsCredentialsResult,
} from "./tms-shared.js";
export {
  loadMappingPreviewFromRunDir,
  runTmsPushPipeline,
  type RunTmsPushPipelineInput,
  type RunTmsPushPipelineResult,
} from "./tms-push-pipeline.js";
