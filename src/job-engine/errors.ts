import type {
  WorkspaceJobDiagnostic,
  WorkspaceJobDiagnosticSeverity,
  WorkspaceJobDiagnosticValue,
  WorkspaceJobStageName
} from "../contracts/index.js";
import type { WorkspacePipelineError } from "./types.js";

const MAX_PIPELINE_DIAGNOSTICS = 25;
const MAX_DIAGNOSTIC_TEXT_LENGTH = 320;
const MAX_DIAGNOSTIC_DETAILS_KEYS = 30;
const MAX_DIAGNOSTIC_DETAILS_ITEMS = 20;
const MAX_DIAGNOSTIC_DETAILS_DEPTH = 4;

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

const truncateText = (value: string, maxLength = MAX_DIAGNOSTIC_TEXT_LENGTH): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
};

const sanitizeDiagnosticValue = ({
  value,
  depth
}: {
  value: unknown;
  depth: number;
}): WorkspaceJobDiagnosticValue | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return truncateText(value, 500);
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
    if (depth >= MAX_DIAGNOSTIC_DETAILS_DEPTH) {
      return value.length;
    }
    const normalizedItems = value
      .slice(0, MAX_DIAGNOSTIC_DETAILS_ITEMS)
      .map((entry) => sanitizeDiagnosticValue({ value: entry, depth: depth + 1 }))
      .filter((entry): entry is WorkspaceJobDiagnosticValue => entry !== undefined);
    return normalizedItems;
  }
  if (typeof value !== "object") {
    if (typeof value === "undefined") {
      return "undefined";
    }
    if (typeof value === "function") {
      return truncateText(`[Function ${value.name || "anonymous"}]`, 500);
    }
    if (typeof value === "symbol") {
      return truncateText(value.description ? `Symbol(${value.description})` : "Symbol()", 500);
    }
    if (typeof value === "bigint") {
      return truncateText(`${value.toString()}n`, 500);
    }
    return undefined;
  }
  if (depth >= MAX_DIAGNOSTIC_DETAILS_DEPTH) {
    return truncateText(Object.prototype.toString.call(value), 500);
  }
  const record = value as Record<string, unknown>;
  const output: Record<string, WorkspaceJobDiagnosticValue> = {};
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right)).slice(0, MAX_DIAGNOSTIC_DETAILS_KEYS);
  for (const key of keys) {
    const normalized = sanitizeDiagnosticValue({
      value: record[key],
      depth: depth + 1
    });
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }
  return output;
};

const normalizePipelineDiagnostics = ({
  diagnostics,
  fallbackStage
}: {
  diagnostics: PipelineDiagnosticInput[] | undefined;
  fallbackStage: WorkspaceJobStageName;
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
    const message = truncateText(candidate.message.trim(), MAX_DIAGNOSTIC_TEXT_LENGTH);
    if (message.length === 0) {
      continue;
    }
    const suggestion = truncateText(candidate.suggestion.trim(), MAX_DIAGNOSTIC_TEXT_LENGTH);
    if (suggestion.length === 0) {
      continue;
    }
    const detailsValue =
      candidate.details === undefined
        ? undefined
        : sanitizeDiagnosticValue({
            value: candidate.details,
            depth: 0
          });
    normalized.push({
      code,
      message,
      suggestion,
      stage: candidate.stage ?? fallbackStage,
      severity: candidate.severity ?? "error",
      ...(candidate.figmaNodeId?.trim() ? { figmaNodeId: candidate.figmaNodeId.trim() } : {}),
      ...(candidate.figmaUrl?.trim() ? { figmaUrl: truncateText(candidate.figmaUrl.trim(), 500) } : {}),
      ...(detailsValue && typeof detailsValue === "object" && !Array.isArray(detailsValue)
        ? { details: detailsValue as Record<string, WorkspaceJobDiagnosticValue> }
        : {})
    });
    if (normalized.length >= MAX_PIPELINE_DIAGNOSTICS) {
      break;
    }
  }
  return normalized.length > 0 ? normalized : undefined;
};

export const mergePipelineDiagnostics = ({
  first,
  second,
  max = MAX_PIPELINE_DIAGNOSTICS
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
  diagnostics
}: {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  cause?: unknown;
  diagnostics?: PipelineDiagnosticInput[];
}): WorkspacePipelineError => {
  const error = new Error(message) as WorkspacePipelineError;
  error.code = code;
  error.stage = stage;
  const normalizedDiagnostics = normalizePipelineDiagnostics({
    diagnostics,
    fallbackStage: stage
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
