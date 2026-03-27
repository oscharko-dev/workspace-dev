import type {
  WorkspaceJobDiagnostic,
  WorkspaceJobDiagnosticSeverity,
  WorkspaceJobDiagnosticValue,
  WorkspaceJobStageName
} from "../contracts/index.js";
import type { WorkspacePipelineError } from "./types.js";

const DETAIL_VALUE_TEXT_MAX_LENGTH = 500;

export interface PipelineDiagnosticLimits {
  maxDiagnostics: number;
  textMaxLength: number;
  detailsMaxKeys: number;
  detailsMaxItems: number;
  detailsMaxDepth: number;
}

export const DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS: PipelineDiagnosticLimits = {
  maxDiagnostics: 25,
  textMaxLength: 320,
  detailsMaxKeys: 30,
  detailsMaxItems: 20,
  detailsMaxDepth: 4
};

export interface PipelineDiagnosticInput {
  code: string;
  message: string;
  suggestion: string;
  stage?: WorkspaceJobStageName;
  severity?: WorkspaceJobDiagnosticSeverity;
  figmaNodeId?: string;
  figmaUrl?: string;
  details?: Record<string, unknown>;
}

const truncateText = ({
  value,
  maxLength
}: {
  value: string;
  maxLength: number;
}): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
};

const sanitizeDiagnosticValue = ({
  value,
  depth,
  limits
}: {
  value: unknown;
  depth: number;
  limits: PipelineDiagnosticLimits;
}): WorkspaceJobDiagnosticValue | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText({ value, maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH });
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= limits.detailsMaxDepth) {
      return value.length;
    }
    const normalizedItems = value
      .slice(0, limits.detailsMaxItems)
      .map((entry) =>
        sanitizeDiagnosticValue({
          value: entry,
          depth: depth + 1,
          limits
        })
      )
      .filter((entry): entry is WorkspaceJobDiagnosticValue => entry !== undefined);
    return normalizedItems;
  }
  if (typeof value !== "object") {
    if (typeof value === "undefined") {
      return "undefined";
    }
    if (typeof value === "function") {
      return truncateText({
        value: `[Function ${value.name || "anonymous"}]`,
        maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH
      });
    }
    if (typeof value === "symbol") {
      return truncateText({
        value: value.description ? `Symbol(${value.description})` : "Symbol()",
        maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH
      });
    }
    if (typeof value === "bigint") {
      return truncateText({
        value: `${value.toString()}n`,
        maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH
      });
    }
    return undefined;
  }
  if (depth >= limits.detailsMaxDepth) {
    return truncateText({
      value: Object.prototype.toString.call(value),
      maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH
    });
  }
  const record = value as Record<string, unknown>;
  const output: Record<string, WorkspaceJobDiagnosticValue> = {};
  const keys = Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limits.detailsMaxKeys);
  for (const key of keys) {
    const normalized = sanitizeDiagnosticValue({
      value: record[key],
      depth: depth + 1,
      limits
    });
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }
  return output;
};

const normalizePipelineDiagnostics = ({
  diagnostics,
  fallbackStage,
  limits = DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS
}: {
  diagnostics: PipelineDiagnosticInput[] | undefined;
  fallbackStage: WorkspaceJobStageName;
  limits?: PipelineDiagnosticLimits;
}): WorkspaceJobDiagnostic[] | undefined => {
  if (!diagnostics || diagnostics.length === 0) {
    return undefined;
  }
  const normalized: WorkspaceJobDiagnostic[] = [];
  for (const candidate of diagnostics) {
    const code = candidate.code.trim();
    if (code.length === 0) {
      continue;
    }
    const message = truncateText({
      value: candidate.message.trim(),
      maxLength: limits.textMaxLength
    });
    if (message.length === 0) {
      continue;
    }
    const suggestion = truncateText({
      value: candidate.suggestion.trim(),
      maxLength: limits.textMaxLength
    });
    if (suggestion.length === 0) {
      continue;
    }
    const detailsValue =
      candidate.details === undefined
        ? undefined
        : sanitizeDiagnosticValue({
            value: candidate.details,
            depth: 0,
            limits
          });
    normalized.push({
      code,
      message,
      suggestion,
      stage: candidate.stage ?? fallbackStage,
      severity: candidate.severity ?? "error",
      ...(candidate.figmaNodeId?.trim() ? { figmaNodeId: candidate.figmaNodeId.trim() } : {}),
      ...(candidate.figmaUrl?.trim()
        ? {
            figmaUrl: truncateText({
              value: candidate.figmaUrl.trim(),
              maxLength: DETAIL_VALUE_TEXT_MAX_LENGTH
            })
          }
        : {}),
      ...(detailsValue && typeof detailsValue === "object" && !Array.isArray(detailsValue)
        ? { details: detailsValue as Record<string, WorkspaceJobDiagnosticValue> }
        : {})
    });
    if (normalized.length >= limits.maxDiagnostics) {
      break;
    }
  }
  return normalized.length > 0 ? normalized : undefined;
};

export const mergePipelineDiagnostics = ({
  first,
  second,
  max = DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.maxDiagnostics
}: {
  first?: WorkspaceJobDiagnostic[];
  second?: WorkspaceJobDiagnostic[];
  max?: number;
}): WorkspaceJobDiagnostic[] | undefined => {
  const merged: WorkspaceJobDiagnostic[] = [];
  const seen = new Set<string>();
  for (const entry of [...(first ?? []), ...(second ?? [])]) {
    const key = `${entry.code}|${entry.stage}|${entry.severity}|${entry.figmaNodeId ?? ""}|${entry.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(entry);
    if (merged.length >= max) {
      break;
    }
  }
  return merged.length > 0 ? merged : undefined;
};

export const createPipelineError = ({
  code,
  stage,
  message,
  cause,
  diagnostics,
  limits
}: {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  cause?: unknown;
  diagnostics?: PipelineDiagnosticInput[];
  limits?: PipelineDiagnosticLimits;
}): WorkspacePipelineError => {
  const error = new Error(message) as WorkspacePipelineError;
  error.code = code;
  error.stage = stage;
  const normalizedDiagnostics = normalizePipelineDiagnostics({
    diagnostics,
    fallbackStage: stage,
    ...(limits ? { limits } : {})
  });
  if (normalizedDiagnostics) {
    error.diagnostics = normalizedDiagnostics;
  }
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", {
      value: cause,
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return error;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};
