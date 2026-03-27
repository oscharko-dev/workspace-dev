import type { WorkspaceJobStageName, WorkspaceLogFormat } from "./contracts/index.js";

export type WorkspaceRuntimeLogLevel = "debug" | "info" | "warn" | "error";

export interface WorkspaceRuntimeLogger {
  log: (input: {
    level: WorkspaceRuntimeLogLevel;
    message: string;
    jobId?: string;
    stage?: WorkspaceJobStageName;
  }) => void;
}

export const DEFAULT_WORKSPACE_LOG_FORMAT: WorkspaceLogFormat = "text";

const TOKEN_EQUALS_PATTERN = /(token\s*=\s*)([^\s]+)/gi;
const AUTHORIZATION_BEARER_PATTERN = /(authorization\s*:\s*bearer\s+)([^\s]+)/gi;
const ACCESS_TOKEN_PATTERN = /(x-access-token:)([^@\s]+)/gi;

const formatTextLine = ({
  level,
  label,
  message,
  jobId,
  stage
}: {
  level: WorkspaceRuntimeLogLevel;
  label: string;
  message: string;
  jobId?: string;
  stage?: WorkspaceJobStageName;
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
  return `${segments.join("")} ${message}\n`;
};

export const redactLogMessage = (message: string): string => {
  return message
    .replace(TOKEN_EQUALS_PATTERN, "$1[REDACTED]")
    .replace(AUTHORIZATION_BEARER_PATTERN, "$1[REDACTED]")
    .replace(ACCESS_TOKEN_PATTERN, "$1[REDACTED]");
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
    log: ({ level, message, jobId, stage }) => {
      const sanitizedMessage = redactLogMessage(message);
      const line =
        format === "json"
          ? `${JSON.stringify({
              ts: now(),
              level,
              msg: sanitizedMessage,
              ...(jobId ? { jobId } : {}),
              ...(stage ? { stage } : {})
            })}\n`
          : formatTextLine({
              level,
              label,
              message: sanitizedMessage,
              ...(jobId ? { jobId } : {}),
              ...(stage ? { stage } : {})
            });

      if (level === "warn" || level === "error") {
        stderrWriter(line);
        return;
      }
      stdoutWriter(line);
    }
  };
};
