import type { WorkspaceJobStageName, WorkspaceLogFormat } from "./contracts/index.js";
import { redactHighRiskSecrets } from "./secret-redaction.js";

export type WorkspaceRuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface WorkspaceRuntimeLogInput {
  level: WorkspaceRuntimeLogLevel;
  message: string;
  jobId?: string;
  stage?: WorkspaceJobStageName;
  requestId?: string;
  event?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}

export interface WorkspaceRuntimeLogger {
  log: (input: WorkspaceRuntimeLogInput) => void;
}

export const DEFAULT_WORKSPACE_LOG_FORMAT: WorkspaceLogFormat = "text";

const formatTextLine = ({
  level,
  label,
  message,
  jobId,
  stage,
  requestId,
  event,
  method,
  path,
  statusCode
}: {
  level: WorkspaceRuntimeLogLevel;
  label: string;
  message: string;
  jobId?: string;
  stage?: WorkspaceJobStageName;
  requestId?: string;
  event?: string;
  method?: string;
  path?: string;
  statusCode?: number;
}): string => {
  const segments = [`[${label}]`];
  if (level !== "info") {
    segments.push(`[${level}]`);
  }
  if (jobId) {
    segments.push(`[job=${jobId}]`);
  }
  if (stage) {
    segments.push(`[stage=${stage}]`);
  }
  if (requestId) {
    segments.push(`[request=${requestId}]`);
  }
  if (event) {
    segments.push(`[event=${event}]`);
  }
  if (method) {
    segments.push(`[method=${method}]`);
  }
  if (path) {
    segments.push(`[path=${path}]`);
  }
  if (statusCode !== undefined) {
    segments.push(`[status=${statusCode}]`);
  }
  return `${segments.join("")} ${message}\n`;
};

export const redactLogMessage = (message: string): string => {
  return redactHighRiskSecrets(message, "[REDACTED]");
};

export const resolveWorkspaceLogFormat = ({
  value,
  fallback = DEFAULT_WORKSPACE_LOG_FORMAT
}: {
  value: string | undefined;
  fallback?: WorkspaceLogFormat;
}): WorkspaceLogFormat => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "json") {
    return "json";
  }
  if (normalized === "text") {
    return "text";
  }
  return fallback;
};

export const createWorkspaceLogger = ({
  format = DEFAULT_WORKSPACE_LOG_FORMAT,
  now = () => new Date().toISOString(),
  stdoutWriter = (line: string) => {
    process.stdout.write(line);
  },
  stderrWriter = (line: string) => {
    process.stderr.write(line);
  },
  label = "workspace-dev"
}: {
  format?: WorkspaceLogFormat;
  now?: () => string;
  stdoutWriter?: (line: string) => void;
  stderrWriter?: (line: string) => void;
  label?: string;
} = {}): WorkspaceRuntimeLogger => {
  return {
    log: ({ level, message, jobId, stage, requestId, event, method, path, statusCode }) => {
      const sanitizedMessage = redactLogMessage(message);
      const line =
        format === "json"
          ? `${JSON.stringify({
              ts: now(),
              level,
              msg: sanitizedMessage,
              ...(jobId ? { jobId } : {}),
              ...(stage ? { stage } : {}),
              ...(requestId ? { requestId } : {}),
              ...(event ? { event } : {}),
              ...(method ? { method } : {}),
              ...(path ? { path } : {}),
              ...(statusCode !== undefined ? { statusCode } : {})
            })}\n`
          : formatTextLine({
              level,
              label,
              message: sanitizedMessage,
              ...(jobId ? { jobId } : {}),
              ...(stage ? { stage } : {}),
              ...(requestId ? { requestId } : {}),
              ...(event ? { event } : {}),
              ...(method ? { method } : {}),
              ...(path ? { path } : {}),
              ...(statusCode !== undefined ? { statusCode } : {})
            });

      if (level === "warn" || level === "error") {
        stderrWriter(line);
        return;
      }
      stdoutWriter(line);
    }
  };
};
