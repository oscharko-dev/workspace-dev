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
