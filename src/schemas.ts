/**
 * Runtime validation schemas for workspace-dev.
 *
 * These lightweight validators intentionally avoid external runtime
 * dependencies to keep the package air-gap compatible.
 */

import type {
  WorkspaceBrandTheme,
  WorkspaceCreatePrInput,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceJobInput,
  WorkspaceLocalSyncRequest,
  WorkspaceRegenerationOverrideEntry,
  WorkspaceStatus
} from "./contracts/index.js";
import { validateRegenerationOverrideEntry } from "./job-engine/ir-override-validation.js";

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
    "figmaJsonPath",
    "repoUrl",
    "repoToken",
    "enableGitPr",
    "figmaSourceMode",
    "llmCodegenMode",
    "projectName",
    "targetPath",
    "brandTheme",
    "generationLocale",
    "formHandlingMode"
  ]);

  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  const figmaFileKey = parseStringField({
    input,
    key: "figmaFileKey",
    required: false,
    issues
  });
  const figmaAccessToken = parseStringField({
    input,
    key: "figmaAccessToken",
    required: false,
    issues
  });
  const figmaJsonPath = parseStringField({
    input,
    key: "figmaJsonPath",
    required: false,
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
  const rawBrandTheme = parseStringField({
    input,
    key: "brandTheme",
    required: false,
    issues
  });
  const generationLocale = parseStringField({
    input,
    key: "generationLocale",
    required: false,
    issues
  });
  const rawFormHandlingMode = parseStringField({
    input,
    key: "formHandlingMode",
    required: false,
    issues
  });
  const brandTheme = (() => {
    if (rawBrandTheme === undefined) {
      return undefined;
    }
    const normalized = rawBrandTheme.trim().toLowerCase();
    if (normalized === "derived" || normalized === "sparkasse") {
      return normalized as WorkspaceBrandTheme;
    }
    pushIssue(issues, ["brandTheme"], "brandTheme must be one of: derived, sparkasse");
    return undefined;
  })();
  const formHandlingMode = (() => {
    if (rawFormHandlingMode === undefined) {
      return undefined;
    }
    const normalized = rawFormHandlingMode.trim().toLowerCase();
    if (normalized === "react_hook_form" || normalized === "legacy_use_state") {
      return normalized as WorkspaceFormHandlingMode;
    }
    pushIssue(issues, ["formHandlingMode"], "formHandlingMode must be one of: react_hook_form, legacy_use_state");
    return undefined;
  })();

  const normalizedFigmaSourceMode = figmaSourceMode?.trim().toLowerCase();
  const resolvedFigmaSourceMode: WorkspaceFigmaSourceMode | undefined = (() => {
    if (normalizedFigmaSourceMode === undefined) {
      return figmaJsonPath !== undefined ? "local_json" : "rest";
    }
    if (normalizedFigmaSourceMode === "rest" || normalizedFigmaSourceMode === "local_json") {
      return normalizedFigmaSourceMode as WorkspaceFigmaSourceMode;
    }
    return undefined;
  })();

  if (resolvedFigmaSourceMode === "rest") {
    if (!figmaFileKey) {
      pushIssue(issues, ["figmaFileKey"], "figmaFileKey is required when figmaSourceMode=rest");
    }
    if (!figmaAccessToken) {
      pushIssue(issues, ["figmaAccessToken"], "figmaAccessToken is required when figmaSourceMode=rest");
    }
    if (figmaJsonPath !== undefined) {
      pushIssue(issues, ["figmaJsonPath"], "figmaJsonPath must be omitted when figmaSourceMode=rest");
    }
  }

  if (resolvedFigmaSourceMode === "local_json") {
    if (!figmaJsonPath) {
      pushIssue(issues, ["figmaJsonPath"], "figmaJsonPath is required when figmaSourceMode=local_json");
    }
    if (figmaFileKey !== undefined) {
      pushIssue(issues, ["figmaFileKey"], "figmaFileKey must be omitted when figmaSourceMode=local_json");
    }
    if (figmaAccessToken !== undefined) {
      pushIssue(issues, ["figmaAccessToken"], "figmaAccessToken must be omitted when figmaSourceMode=local_json");
    }
  }

  if (enableGitPr) {
    if (!repoUrl) {
      pushIssue(issues, ["repoUrl"], "repoUrl is required when enableGitPr=true");
    }
    if (!repoToken) {
      pushIssue(issues, ["repoToken"], "repoToken is required when enableGitPr=true");
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const data: WorkspaceJobInput = {
    enableGitPr
  };
  if (figmaSourceMode !== undefined) {
    data.figmaSourceMode = figmaSourceMode;
  } else if (resolvedFigmaSourceMode !== undefined) {
    data.figmaSourceMode = resolvedFigmaSourceMode;
  }
  if (figmaFileKey !== undefined) {
    data.figmaFileKey = figmaFileKey;
  }
  if (figmaAccessToken !== undefined) {
    data.figmaAccessToken = figmaAccessToken;
  }
  if (figmaJsonPath !== undefined) {
    data.figmaJsonPath = figmaJsonPath;
  }
  if (repoUrl !== undefined) {
    data.repoUrl = repoUrl;
  }
  if (repoToken !== undefined) {
    data.repoToken = repoToken;
  }
  if (llmCodegenMode !== undefined) {
    data.llmCodegenMode = llmCodegenMode;
  }
  if (projectName !== undefined) {
    data.projectName = projectName;
  }
  if (targetPath !== undefined) {
    data.targetPath = targetPath;
  }
  if (brandTheme !== undefined) {
    data.brandTheme = brandTheme;
  }
  if (generationLocale !== undefined) {
    data.generationLocale = generationLocale;
  }
  if (formHandlingMode !== undefined) {
    data.formHandlingMode = formHandlingMode;
  }

  return {
    success: true,
    data
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
  if (figmaSourceMode !== "rest" && figmaSourceMode !== "local_json") {
    pushIssue(issues, ["figmaSourceMode"], "figmaSourceMode must be one of: rest, local_json");
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
      figmaSourceMode: figmaSourceMode as WorkspaceFigmaSourceMode,
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

interface RegenerationRequestData {
  overrides: WorkspaceRegenerationOverrideEntry[];
  draftId?: string;
  baseFingerprint?: string;
}

function parseRegenerationRequest(input: unknown): ValidationResult<RegenerationRequestData> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set(["overrides", "draftId", "baseFingerprint"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  if (!Array.isArray(input.overrides)) {
    pushIssue(issues, ["overrides"], "overrides must be an array.");
    return { success: false, error: { issues } };
  }

  const overrides: WorkspaceRegenerationOverrideEntry[] = [];
  for (let i = 0; i < input.overrides.length; i++) {
    const entry = input.overrides[i] as unknown;
    if (!isRecord(entry)) {
      pushIssue(issues, ["overrides", i], "Each override entry must be an object.");
      continue;
    }
    if (typeof entry.nodeId !== "string" || entry.nodeId.trim().length === 0) {
      pushIssue(issues, ["overrides", i, "nodeId"], "nodeId must be a non-empty string.");
      continue;
    }
    if (typeof entry.field !== "string" || entry.field.trim().length === 0) {
      pushIssue(issues, ["overrides", i, "field"], "field must be a non-empty string.");
      continue;
    }
    const validationResult = validateRegenerationOverrideEntry({
      nodeId: entry.nodeId,
      field: entry.field,
      value: entry.value as WorkspaceRegenerationOverrideEntry["value"]
    });
    if (!validationResult.ok) {
      pushIssue(issues, ["overrides", i, validationResult.path], validationResult.message);
      continue;
    }
    overrides.push(validationResult.entry);
  }

  let draftId: string | undefined;
  if (input.draftId !== undefined) {
    if (typeof input.draftId !== "string" || input.draftId.trim().length === 0) {
      pushIssue(issues, ["draftId"], "draftId must be a non-empty string when provided.");
    } else {
      draftId = input.draftId;
    }
  }

  let baseFingerprint: string | undefined;
  if (input.baseFingerprint !== undefined) {
    if (typeof input.baseFingerprint !== "string" || input.baseFingerprint.trim().length === 0) {
      pushIssue(issues, ["baseFingerprint"], "baseFingerprint must be a non-empty string when provided.");
    } else {
      baseFingerprint = input.baseFingerprint;
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const data: RegenerationRequestData = { overrides };
  if (draftId !== undefined) {
    data.draftId = draftId;
  }
  if (baseFingerprint !== undefined) {
    data.baseFingerprint = baseFingerprint;
  }

  return { success: true, data };
}

export const RegenerationRequestSchema: RuntimeSchema<RegenerationRequestData> = {
  safeParse: parseRegenerationRequest
};

function parseSyncRequest(input: unknown): ValidationResult<WorkspaceLocalSyncRequest> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const mode = input.mode;
  if (mode !== "dry_run" && mode !== "apply") {
    pushIssue(issues, ["mode"], "mode must be one of: dry_run, apply.");
    return { success: false, error: { issues } };
  }

  if (mode === "dry_run") {
    const allowedKeys = new Set(["mode", "targetPath"]);
    for (const key of Object.keys(input)) {
      if (!allowedKeys.has(key)) {
        pushIssue(issues, [key], `Unexpected property '${key}'.`);
      }
    }

    if (input.targetPath !== undefined && (typeof input.targetPath !== "string" || input.targetPath.trim().length === 0)) {
      pushIssue(issues, ["targetPath"], "targetPath must be a non-empty string when provided.");
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }

    return {
      success: true,
      data: {
        mode: "dry_run",
        ...(typeof input.targetPath === "string" ? { targetPath: input.targetPath } : {})
      }
    };
  }

  const allowedKeys = new Set(["mode", "confirmationToken", "confirmOverwrite"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  if (typeof input.confirmationToken !== "string" || input.confirmationToken.trim().length === 0) {
    pushIssue(issues, ["confirmationToken"], "confirmationToken must be a non-empty string.");
  }
  if (input.confirmOverwrite !== true) {
    pushIssue(issues, ["confirmOverwrite"], "confirmOverwrite must be true for apply mode.");
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      mode: "apply",
      confirmationToken: input.confirmationToken as string,
      confirmOverwrite: true
    }
  };
}

export const SyncRequestSchema: RuntimeSchema<WorkspaceLocalSyncRequest> = {
  safeParse: parseSyncRequest
};

function parseCreatePrRequest(input: unknown): ValidationResult<WorkspaceCreatePrInput> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set(["repoUrl", "repoToken", "targetPath"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  if (typeof input.repoUrl !== "string" || input.repoUrl.trim().length === 0) {
    pushIssue(issues, ["repoUrl"], "repoUrl must be a non-empty string.");
  }
  if (typeof input.repoToken !== "string" || input.repoToken.trim().length === 0) {
    pushIssue(issues, ["repoToken"], "repoToken must be a non-empty string.");
  }

  if (input.targetPath !== undefined) {
    if (typeof input.targetPath !== "string" || input.targetPath.trim().length === 0) {
      pushIssue(issues, ["targetPath"], "targetPath must be a non-empty string when provided.");
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const data: WorkspaceCreatePrInput = {
    repoUrl: input.repoUrl as string,
    repoToken: input.repoToken as string
  };
  if (typeof input.targetPath === "string") {
    data.targetPath = input.targetPath;
  }

  return { success: true, data };
}

export const CreatePrRequestSchema: RuntimeSchema<WorkspaceCreatePrInput> = {
  safeParse: parseCreatePrRequest
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
