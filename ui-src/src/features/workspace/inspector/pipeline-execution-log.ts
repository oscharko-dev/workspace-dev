/**
 * In-memory pipeline execution log for the current session.
 * Stores stage events with timestamps and exports them as JSON for bug reports.
 * Redacts Figma access tokens before any export.
 */

export interface PipelineLogEntry {
  /** ISO timestamp when this entry was recorded. */
  timestamp: string;
  /** Pipeline stage name (e.g. "parsing", "resolving"). */
  stage: string;
  /** Duration of this stage in milliseconds, if known. */
  durationMs?: number;
  /** Whether the stage completed successfully. */
  success: boolean;
  /** Error code if the stage failed. */
  errorCode?: string;
  /** Sanitized error message if the stage failed. Never contains tokens. */
  errorMessage?: string;
}

export interface PipelineExecutionLog {
  /** All entries recorded so far. */
  readonly entries: readonly PipelineLogEntry[];
  /** Record a new log entry. */
  addEntry(entry: PipelineLogEntry): void;
  /** Export entries as a JSON string, redacting sensitive data. */
  exportJson(): string;
  /** Clear all entries. */
  clear(): void;
}

export interface PipelineReportStageStatus {
  state: string;
  duration?: number | undefined;
  message?: string | undefined;
  code?: string | undefined;
  retryable?: boolean | undefined;
  retryAfterMs?: number | undefined;
  fallbackMode?: string | undefined;
}

export interface PipelineReportError {
  stage: string;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number | undefined;
  fallbackMode?: string | undefined;
  retryTargets?: Array<{
    id: string;
    label: string;
    filePath?: string | undefined;
  }> | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface PipelineReportInput {
  stage: string;
  outcome?: string | undefined;
  pipelineId?: string | undefined;
  pipelineMetadata?: {
    pipelineId: string;
    pipelineDisplayName: string;
    templateBundleId: string;
    buildProfile: string;
    deterministic: true;
  } | undefined;
  jobId?: string | undefined;
  jobStatus?: string | undefined;
  fallbackMode?: string | undefined;
  retryRequest?: {
    stage: string;
    targetIds?: string[] | undefined;
  } | undefined;
  stageProgress: Record<string, PipelineReportStageStatus>;
  errors: readonly PipelineReportError[];
}

// Token-like patterns to redact (Figma PATs start with "figd_").
const REDACT_PATTERNS: readonly RegExp[] = [
  /figd_[A-Za-z0-9_-]{8,}/g,
  /figma_[A-Za-z0-9_-]{8,}/g,
  /\\?"figmaAccessToken\\?"\s*:\s*\\?"[^"\\]+\\?"/gi,
  /\\?"accessToken\\?"\s*:\s*\\?"[^"\\]+\\?"/gi,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /x-figma-token:\s*[A-Za-z0-9._-]{8,}/gi,
];

const REDACT_PLACEHOLDER = "[REDACTED]";

export function redactSensitiveData(text: string): string {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // For JSON key-value patterns, preserve the key structure.
      const colonIdx = match.indexOf(":");
      if (colonIdx !== -1 && /["]/.test(match)) {
        const escaped = match.includes('\\"');
        const quote = escaped ? '\\"' : '"';
        return `${match.slice(0, colonIdx + 1)} ${quote}${REDACT_PLACEHOLDER}${quote}`;
      }
      return REDACT_PLACEHOLDER;
    });
  }
  return result;
}

export function createPipelineExecutionLog(): PipelineExecutionLog {
  const entries: PipelineLogEntry[] = [];
  let frozenCache: readonly PipelineLogEntry[] | null = null;

  return {
    get entries(): readonly PipelineLogEntry[] {
      if (frozenCache === null) {
        frozenCache = Object.freeze([...entries]);
      }
      return frozenCache;
    },

    addEntry(entry: PipelineLogEntry): void {
      frozenCache = null;
      entries.push(entry);
    },

    exportJson(): string {
      const payload = {
        exportedAt: new Date().toISOString(),
        entryCount: entries.length,
        entries,
      };
      const raw = JSON.stringify(payload, null, 2);
      return redactSensitiveData(raw);
    },

    clear(): void {
      frozenCache = null;
      entries.length = 0;
    },
  };
}

export function buildSanitizedPipelineReport({
  pipeline,
  executionLog,
}: {
  pipeline: PipelineReportInput;
  executionLog?: PipelineExecutionLog | undefined;
}): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    outcome: pipeline.outcome ?? pipeline.stage,
    stage: pipeline.stage,
    pipelineId: pipeline.pipelineId ?? null,
    pipelineMetadata: pipeline.pipelineMetadata ?? null,
    jobId: pipeline.jobId ?? null,
    jobStatus: pipeline.jobStatus ?? null,
    fallbackMode: pipeline.fallbackMode ?? null,
    retry: pipeline.retryRequest ?? null,
    stageProgress: pipeline.stageProgress,
    errors: pipeline.errors,
    executionLog: executionLog?.entries ?? [],
  };
  return redactSensitiveData(JSON.stringify(payload, null, 2));
}
