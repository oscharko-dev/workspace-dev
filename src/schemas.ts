/**
 * Runtime validation schemas for workspace-dev.
 *
 * These lightweight validators intentionally avoid external runtime
 * dependencies to keep the package air-gap compatible.
 */

import type { WorkspaceJobInput, WorkspaceStatus } from "./contracts/index.js";

type PathSegment = string | number;

export interface ValidationIssue {
  path: PathSegment[];
  message: string;
}

export interface ValidationError {
  issues: ValidationIssue[];
}

interface ValidationSuccess<T> {
  success: true;
  data: T;
}

interface ValidationFailureResult {
  success: false;
  error: ValidationError;
}

type ValidationResult<T> = ValidationSuccess<T> | ValidationFailureResult;

interface RuntimeSchema<T> {
  safeParse(input: unknown): ValidationResult<T>;
}

export interface ValidationFailure {
  error: "VALIDATION_ERROR";
  message: string;
  issues: Array<{ path: string; message: string }>;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function pushIssue(issues: ValidationIssue[], path: PathSegment[], message: string): void {
  issues.push({ path, message });
}

function parseStringField({
  input,
  key,
  required,
  issues,
  minLength = 1
}: {
  input: Record<string, unknown>;
  key: keyof WorkspaceJobInput;
  required: boolean;
  issues: ValidationIssue[];
  minLength?: number;
}): string | undefined {
  const value = input[key];

  if (value === undefined) {
    if (required) {
      pushIssue(issues, [key], `${String(key)} is required`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    pushIssue(issues, [key], `${String(key)} must be a string`);
    return undefined;
  }

  if (value.trim().length < minLength) {
    pushIssue(issues, [key], `${String(key)} must not be empty`);
    return undefined;
  }

  return value;
}

function parseSubmitRequest(input: unknown): ValidationResult<WorkspaceJobInput> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "figmaFileKey",
    "figmaAccessToken",
    "repoUrl",
    "repoToken",
    "enableGitPr",
    "figmaSourceMode",
    "llmCodegenMode",
    "projectName",
    "targetPath"
  ]);

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  const figmaFileKey = parseStringField({
    input,
    key: "figmaFileKey",
    required: true,
    issues
  });
  const figmaAccessToken = parseStringField({
    input,
    key: "figmaAccessToken",
    required: true,
    issues
  });
  const repoUrl = parseStringField({
    input,
    key: "repoUrl",
    required: false,
    issues
  });
  const repoToken = parseStringField({
    input,
    key: "repoToken",
    required: false,
    issues
  });
  const rawEnableGitPr = input.enableGitPr;
  const enableGitPr =
    rawEnableGitPr === undefined
      ? false
      : typeof rawEnableGitPr === "boolean"
        ? rawEnableGitPr
        : (() => {
            pushIssue(issues, ["enableGitPr"], "enableGitPr must be a boolean");
            return false;
          })();
  const figmaSourceMode = parseStringField({
    input,
    key: "figmaSourceMode",
    required: false,
    issues
  });
  const llmCodegenMode = parseStringField({
    input,
    key: "llmCodegenMode",
    required: false,
    issues
  });
  const projectName = parseStringField({
    input,
    key: "projectName",
    required: false,
    issues
  });
  const targetPath = parseStringField({
    input,
    key: "targetPath",
    required: false,
    issues
  });

  if (enableGitPr) {
    if (!repoUrl) {
      pushIssue(issues, ["repoUrl"], "repoUrl is required when enableGitPr=true");
    }
    if (!repoToken) {
      pushIssue(issues, ["repoToken"], "repoToken is required when enableGitPr=true");
    }
  }

  if (issues.length > 0 || !figmaFileKey || !figmaAccessToken) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      figmaFileKey,
      figmaAccessToken,
      repoUrl,
      repoToken,
      enableGitPr,
      figmaSourceMode,
      llmCodegenMode,
      projectName,
      targetPath
    }
  };
}

function parseWorkspaceStatus(input: unknown): ValidationResult<WorkspaceStatus> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const running = input.running;
  const url = input.url;
  const host = input.host;
  const port = input.port;
  const figmaSourceMode = input.figmaSourceMode;
  const llmCodegenMode = input.llmCodegenMode;
  const uptimeMs = input.uptimeMs;
  const outputRoot = input.outputRoot;
  const previewEnabled = input.previewEnabled;

  if (typeof running !== "boolean") pushIssue(issues, ["running"], "running must be a boolean");
  if (typeof url !== "string") pushIssue(issues, ["url"], "url must be a string");
  if (typeof host !== "string") pushIssue(issues, ["host"], "host must be a string");
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1) {
    pushIssue(issues, ["port"], "port must be a positive integer");
  }
  if (figmaSourceMode !== "rest") {
    pushIssue(issues, ["figmaSourceMode"], "figmaSourceMode must equal 'rest'");
  }
  if (llmCodegenMode !== "deterministic") {
    pushIssue(issues, ["llmCodegenMode"], "llmCodegenMode must equal 'deterministic'");
  }
  if (typeof uptimeMs !== "number" || uptimeMs < 0) {
    pushIssue(issues, ["uptimeMs"], "uptimeMs must be a non-negative number");
  }
  if (typeof outputRoot !== "string" || outputRoot.length < 1) {
    pushIssue(issues, ["outputRoot"], "outputRoot must be a non-empty string");
  }
  if (typeof previewEnabled !== "boolean") {
    pushIssue(issues, ["previewEnabled"], "previewEnabled must be a boolean");
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      running: running as boolean,
      url: url as string,
      host: host as string,
      port: port as number,
      figmaSourceMode: "rest",
      llmCodegenMode: "deterministic",
      uptimeMs: uptimeMs as number,
      outputRoot: outputRoot as string,
      previewEnabled: previewEnabled as boolean
    }
  };
}

function parseErrorResponse(input: unknown): ValidationResult<{ error: string; message: string }> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  if (typeof input.error !== "string") {
    pushIssue(issues, ["error"], "error must be a string");
  }

  if (typeof input.message !== "string") {
    pushIssue(issues, ["message"], "message must be a string");
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      error: input.error as string,
      message: input.message as string
    }
  };
}

export const SubmitRequestSchema: RuntimeSchema<WorkspaceJobInput> = {
  safeParse: parseSubmitRequest
};

export type SubmitRequestInput = WorkspaceJobInput;

export const WorkspaceStatusSchema: RuntimeSchema<WorkspaceStatus> = {
  safeParse: parseWorkspaceStatus
};

export const ErrorResponseSchema: RuntimeSchema<{ error: string; message: string }> = {
  safeParse: parseErrorResponse
};

/**
 * Keeps backward-compatible naming for existing tests and consumers.
 */
export function formatZodError(validationError: ValidationError): ValidationFailure {
  return {
    error: "VALIDATION_ERROR",
    message: "Request validation failed.",
    issues: validationError.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message
    }))
  };
}
