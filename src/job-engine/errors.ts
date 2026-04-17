import os from "node:os";
import path from "node:path";
import type {
  WorkspaceJobDiagnostic,
  WorkspaceJobDiagnosticSeverity,
  WorkspaceJobDiagnosticValue,
  WorkspaceJobFallbackMode,
  WorkspaceJobRetryTarget,
  WorkspaceJobStageName,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import type { WorkspacePipelineError } from "./types.js";

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
  detailsMaxDepth: 4,
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
  maxLength,
}: {
  value: string;
  maxLength: number;
}): string => {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
};

const STATIC_SENSITIVE_PATH_ROOTS = [
  "/etc",
  "/var",
  "/private",
  "/opt",
  "/srv",
  "/mnt",
  "/Volumes",
  "/dev/shm",
];

const LEADING_TOKEN_PUNCTUATION = new Set(["(", "[", "{", "<", '"', "'", "`"]);
const TRAILING_TOKEN_PUNCTUATION = new Set([
  ")",
  "]",
  "}",
  ">",
  '"',
  "'",
  "`",
  ",",
  ".",
  ";",
  "!",
  "?",
]);

const isWithinRoot = ({
  candidatePath,
  rootPath,
}: {
  candidatePath: string;
  rootPath: string;
}): boolean => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
};

const getSensitivePathRoots = (): string[] => {
  const roots = [
    process.cwd(),
    os.tmpdir(),
    os.homedir(),
    ...STATIC_SENSITIVE_PATH_ROOTS,
  ];
  return Array.from(
    new Set(
      roots
        .map((root) => root.trim())
        .filter((root) => root.length > 0)
        .map((root) => path.resolve(root)),
    ),
  );
};

const shouldRedactAbsoluteFilesystemPath = (candidate: string): boolean => {
  const normalized = candidate.trim();
  if (normalized.length === 0) {
    return false;
  }
  if (path.win32.isAbsolute(normalized)) {
    return true;
  }
  if (!path.isAbsolute(normalized)) {
    return false;
  }

  const resolvedCandidate = path.resolve(normalized);
  if (
    getSensitivePathRoots().some((root) =>
      isWithinRoot({ candidatePath: resolvedCandidate, rootPath: root }),
    )
  ) {
    return true;
  }

  return /(?:^|[\\/])(?:generated-app|node_modules|jobs|repros|\.stage-store)(?:[\\/]|$)/.test(
    normalized,
  );
};

const toRedactedPathLabel = (candidate: string): string => {
  const basename = path.win32.isAbsolute(candidate)
    ? path.win32.basename(candidate)
    : path.basename(candidate);
  return basename.length > 0
    ? `[redacted-path]/${basename}`
    : "[redacted-path]";
};

const sanitizePathToken = (token: string): string => {
  let start = 0;
  let end = token.length;

  while (start < end && LEADING_TOKEN_PUNCTUATION.has(token[start] ?? "")) {
    start += 1;
  }
  while (end > start && TRAILING_TOKEN_PUNCTUATION.has(token[end - 1] ?? "")) {
    end -= 1;
  }

  const candidate = token.slice(start, end);
  if (!shouldRedactAbsoluteFilesystemPath(candidate)) {
    return token;
  }

  return `${token.slice(0, start)}${toRedactedPathLabel(candidate)}${token.slice(end)}`;
};

export const sanitizeDiagnosticText = ({
  value,
  maxLength,
}: {
  value: string;
  maxLength: number;
}): string => {
  // Public diagnostics use one truncation policy: redact sensitive paths first,
  // then bound the remaining text with the caller-provided diagnostic limit.
  const redacted = value
    .split(/(\s+)/)
    .map((token) =>
      token.trim().length === 0 ? token : sanitizePathToken(token),
    )
    .join("");
  return truncateText({ value: redacted, maxLength });
};

const sanitizeDiagnosticValue = ({
  value,
  depth,
  limits,
}: {
  value: unknown;
  depth: number;
  limits: PipelineDiagnosticLimits;
}): WorkspaceJobDiagnosticValue | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return sanitizeDiagnosticText({ value, maxLength: limits.textMaxLength });
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
          limits,
        }),
      )
      .filter(
        (entry): entry is WorkspaceJobDiagnosticValue => entry !== undefined,
      );
    return normalizedItems;
  }
  if (typeof value !== "object") {
    if (typeof value === "undefined") {
      return "undefined";
    }
    if (typeof value === "function") {
      return sanitizeDiagnosticText({
        value: `[Function ${value.name || "anonymous"}]`,
        maxLength: limits.textMaxLength,
      });
    }
    if (typeof value === "symbol") {
      return sanitizeDiagnosticText({
        value: value.description ? `Symbol(${value.description})` : "Symbol()",
        maxLength: limits.textMaxLength,
      });
    }
    if (typeof value === "bigint") {
      return sanitizeDiagnosticText({
        value: `${value.toString()}n`,
        maxLength: limits.textMaxLength,
      });
    }
    return undefined;
  }
  if (depth >= limits.detailsMaxDepth) {
    return sanitizeDiagnosticText({
      value: Object.prototype.toString.call(value),
      maxLength: limits.textMaxLength,
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
      limits,
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
  limits = DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS,
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
    const message = sanitizeDiagnosticText({
      value: candidate.message.trim(),
      maxLength: limits.textMaxLength,
    });
    if (message.length === 0) {
      continue;
    }
    const suggestion = sanitizeDiagnosticText({
      value: candidate.suggestion.trim(),
      maxLength: limits.textMaxLength,
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
            limits,
          });
    normalized.push({
      code,
      message,
      suggestion,
      stage: candidate.stage ?? fallbackStage,
      severity: candidate.severity ?? "error",
      ...(candidate.figmaNodeId?.trim()
        ? { figmaNodeId: candidate.figmaNodeId.trim() }
        : {}),
      ...(candidate.figmaUrl?.trim()
        ? {
            figmaUrl: sanitizeDiagnosticText({
              value: candidate.figmaUrl.trim(),
              maxLength: limits.textMaxLength,
            }),
          }
        : {}),
      ...(detailsValue &&
      typeof detailsValue === "object" &&
      !Array.isArray(detailsValue)
        ? {
            details: detailsValue as Record<
              string,
              WorkspaceJobDiagnosticValue
            >,
          }
        : {}),
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
  max = DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS.maxDiagnostics,
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

interface CreatePipelineErrorOptions {
  code: string;
  stage: WorkspaceJobStageName;
  message: string;
  cause?: unknown;
  diagnostics?: PipelineDiagnosticInput[];
  limits?: PipelineDiagnosticLimits;
  retryable?: boolean;
  retryAfterMs?: number;
  fallbackMode?: WorkspaceJobFallbackMode;
  retryTargets?: WorkspaceJobRetryTarget[];
}

export class PipelineError extends Error implements WorkspacePipelineError {
  declare code: string;
  declare stage: WorkspaceJobStageName;
  declare retryable?: boolean;
  declare retryAfterMs?: number;
  declare fallbackMode?: WorkspaceJobFallbackMode;
  declare retryTargets?: WorkspaceJobRetryTarget[];
  declare diagnostics?: WorkspaceJobDiagnostic[];

  constructor({
    code,
    stage,
    message,
    cause,
    diagnostics,
    limits,
    retryable,
    retryAfterMs,
    fallbackMode,
    retryTargets,
  }: CreatePipelineErrorOptions) {
    const resolvedLimits = limits ?? DEFAULT_PIPELINE_DIAGNOSTIC_LIMITS;
    const pathRedacted = sanitizeDiagnosticText({
      value: message,
      maxLength: resolvedLimits.textMaxLength,
    });

    const sanitizedMessage = redactHighRiskSecrets(
      pathRedacted,
      "[redacted-secret]",
    );

    // Store both message and cause; sanitizeErrorMessage will handle cause chain
    super(sanitizedMessage, cause === undefined ? undefined : { cause });
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "PipelineError";
    this.code = code;
    this.stage = stage;
    const captureStackTrace = Reflect.get(Error, "captureStackTrace");
    if (typeof captureStackTrace === "function") {
      (
        captureStackTrace as (
          target: object,
          constructor?: new (...args: never[]) => unknown,
        ) => void
      )(this, PipelineError);
    }
    if (retryable !== undefined) {
      this.retryable = retryable;
    }
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
    if (fallbackMode !== undefined) {
      this.fallbackMode = fallbackMode;
    }
    if (retryTargets !== undefined) {
      this.retryTargets = retryTargets.map((target) => ({ ...target }));
    }
    const normalizedDiagnostics = normalizePipelineDiagnostics({
      diagnostics,
      fallbackStage: stage,
      limits: resolvedLimits,
    });
    if (normalizedDiagnostics) {
      this.diagnostics = normalizedDiagnostics;
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      stage: this.stage,
      ...(this.retryable !== undefined && { retryable: this.retryable }),
      ...(this.retryAfterMs !== undefined && {
        retryAfterMs: this.retryAfterMs,
      }),
      ...(this.fallbackMode !== undefined && {
        fallbackMode: this.fallbackMode,
      }),
      ...(this.retryTargets !== undefined && {
        retryTargets: this.retryTargets,
      }),
      ...(this.diagnostics !== undefined && { diagnostics: this.diagnostics }),
    };
  }
}

export const createPipelineError = (
  options: CreatePipelineErrorOptions,
): WorkspacePipelineError => {
  return new PipelineError(options);
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
};
