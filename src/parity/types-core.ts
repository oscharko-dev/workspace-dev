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
export type JobPreviewState = "pending" | "ready" | "unavailable" | "failed";
export type JobQueueStatus = "queued" | "running" | "idle";
export type EditSessionState = "initializing" | "ready" | "saving" | "error" | "terminated";

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
