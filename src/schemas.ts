/**
 * Runtime validation schemas for workspace-dev.
 *
 * Validation conventions in this module:
 * - Guard unknown input with `isRecord` before reading object fields.
 * - Define an explicit `allowedKeys` set for each object schema and reject
 *   unexpected properties.
 * - Reuse shared field parsers such as `parseStringField` when possible and
 *   keep schema-specific normalization close to the owning schema.
 * - Collect failures in `ValidationIssue[]` with stable paths and messages
 *   instead of throwing on the first invalid field.
 * - Construct the typed output object only after validation finishes without
 *   issues.
 *
 * These lightweight validators intentionally avoid external runtime schema
 * dependencies to keep the package air-gap compatible.
 */

import type {
  WorkspaceBrandTheme,
  WorkspaceComponentMappingRule,
  WorkspaceCreatePrInput,
  WorkspaceFigmaSourceMode,
  WorkspaceFormHandlingMode,
  WorkspaceImportIntent,
  WorkspaceImportMode,
  WorkspaceJobInput,
  WorkspaceJobRetryStage,
  WorkspaceLlmCodegenMode,
  WorkspaceLocalSyncApplyRequest,
  WorkspaceLocalSyncRequest,
  WorkspaceRegenerationOverrideEntry,
  WorkspaceStatus,
  WorkspaceVisualAuditInput,
} from "./contracts/index.js";
import {
  ALLOWED_FIGMA_SOURCE_MODES,
  ALLOWED_LLM_CODEGEN_MODES,
} from "./contracts/index.js";
import { validateComponentMappingRule } from "./component-mapping-rules.js";
import {
  isClipboardEnvelope,
  looksLikeClipboardEnvelope,
  validateClipboardEnvelope,
  validateClipboardEnvelopeComplexity,
  summarizeEnvelopeValidationIssues,
} from "./clipboard-envelope.js";
import {
  safeParseFigmaPayload,
  summarizeFigmaPayloadValidationError,
  validateFigmaPayloadComplexity,
} from "./figma-payload-validation.js";
import { normalizeGenerationLocale } from "./generation-locale.js";
import { validateRegenerationOverrideEntry } from "./job-engine/ir-override-validation.js";
import {
  MAX_SUBMIT_BODY_BYTES,
  resolveFigmaPasteMaxBytes,
} from "./server/constants.js";

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
type ParsedLocalSyncFileDecision =
  WorkspaceLocalSyncApplyRequest["fileDecisions"][number];

interface RuntimeSchema<T> {
  safeParse(input: unknown): ValidationResult<T>;
}

interface RetryRequestData {
  retryStage: WorkspaceJobRetryStage;
  retryTargets?: string[];
}

export interface ValidationFailure {
  error: "VALIDATION_ERROR";
  message: string;
  issues: Array<{ path: string; message: string }>;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function pushIssue(
  issues: ValidationIssue[],
  path: PathSegment[],
  message: string,
): void {
  issues.push({ path, message });
}

function parseStringField({
  input,
  key,
  required,
  issues,
  minLength = 1,
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
      pushIssue(issues, [key], `${key} is required`);
    }
    return undefined;
  }

  if (typeof value !== "string") {
    pushIssue(issues, [key], `${key} must be a string`);
    return undefined;
  }

  if (value.trim().length < minLength) {
    pushIssue(issues, [key], `${key} must not be empty`);
    return undefined;
  }

  return value;
}

function parseOptionalNonEmptyStringArrayField({
  input,
  key,
  issues,
}: {
  input: Record<string, unknown>;
  key: keyof WorkspaceJobInput;
  issues: ValidationIssue[];
}): string[] | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    pushIssue(issues, [key], `${key} must be an array of non-empty strings`);
    return undefined;
  }
  if (value.length === 0) {
    pushIssue(issues, [key], `${key} must not be an empty array`);
    return undefined;
  }

  const parsed: string[] = [];
  const entries: unknown[] = value;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== "string") {
      pushIssue(
        issues,
        [key, index],
        `${key} entries must be non-empty strings`,
      );
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      pushIssue(
        issues,
        [key, index],
        `${key} entries must be non-empty strings`,
      );
      continue;
    }
    parsed.push(trimmed);
  }

  return issues.length > 0 ? undefined : parsed;
}

function parseSubmitLlmCodegenMode({
  value,
  issues,
}: {
  value: string | undefined;
  issues: ValidationIssue[];
}): WorkspaceLlmCodegenMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const match = ALLOWED_LLM_CODEGEN_MODES.find((mode) => mode === normalized);
  if (match === undefined) {
    pushIssue(
      issues,
      ["llmCodegenMode"],
      `llmCodegenMode must equal '${ALLOWED_LLM_CODEGEN_MODES[0]}'`,
    );
    return undefined;
  }

  return match;
}

function parseSubmitGenerationLocale({
  value,
  issues,
}: {
  value: string | undefined;
  issues: ValidationIssue[];
}): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = normalizeGenerationLocale(value);
  if (!normalized) {
    pushIssue(
      issues,
      ["generationLocale"],
      "generationLocale must be a valid supported locale",
    );
    return undefined;
  }

  return normalized;
}

function estimateFigmaPasteSubmitTransportBytes({
  figmaJsonPayload,
}: {
  figmaJsonPayload: string;
}): number {
  return Buffer.byteLength(
    JSON.stringify({
      figmaSourceMode: "figma_paste",
      figmaJsonPayload,
      llmCodegenMode: "deterministic",
      enableGitPr: false,
    }),
    "utf8",
  );
}

function parseComponentMappingRuleEntry({
  entry,
  path,
}: {
  entry: unknown;
  path: PathSegment[];
}): ValidationResult<WorkspaceComponentMappingRule> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(entry)) {
    pushIssue(issues, path, "Each component mapping rule must be an object.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "id",
    "boardKey",
    "nodeId",
    "nodeNamePattern",
    "canonicalComponentName",
    "storybookTier",
    "figmaLibrary",
    "semanticType",
    "componentName",
    "importPath",
    "propContract",
    "priority",
    "source",
    "enabled",
    "createdAt",
    "updatedAt",
  ]);
  for (const key of Object.keys(entry)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [...path, key], `Unexpected property '${key}'.`);
    }
  }

  const parseOptionalNonEmptyString = (
    key: keyof WorkspaceComponentMappingRule,
  ): string | undefined => {
    const value = entry[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      pushIssue(
        issues,
        [...path, key],
        `${key} must be a non-empty string when provided.`,
      );
      return undefined;
    }
    return value.trim();
  };

  const boardKey = parseOptionalNonEmptyString("boardKey");
  const nodeId = parseOptionalNonEmptyString("nodeId");
  const nodeNamePattern = parseOptionalNonEmptyString("nodeNamePattern");
  const canonicalComponentName = parseOptionalNonEmptyString(
    "canonicalComponentName",
  );
  const storybookTier = parseOptionalNonEmptyString("storybookTier");
  const figmaLibrary = parseOptionalNonEmptyString("figmaLibrary");
  const semanticType = parseOptionalNonEmptyString("semanticType");
  const componentName = parseOptionalNonEmptyString("componentName");
  const importPath = parseOptionalNonEmptyString("importPath");
  const createdAt = parseOptionalNonEmptyString("createdAt");
  const updatedAt = parseOptionalNonEmptyString("updatedAt");

  const id = (() => {
    const value = entry.id;
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      pushIssue(
        issues,
        [...path, "id"],
        "id must be an integer when provided.",
      );
      return undefined;
    }
    return value;
  })();

  const priority = (() => {
    const value = entry.priority;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      pushIssue(
        issues,
        [...path, "priority"],
        "priority must be a finite number.",
      );
      return undefined;
    }
    return value;
  })();

  const source = (() => {
    const value = entry.source;
    if (value !== "local_override" && value !== "code_connect_import") {
      pushIssue(
        issues,
        [...path, "source"],
        "source must be either 'local_override' or 'code_connect_import'.",
      );
      return undefined;
    }
    return value;
  })();

  const enabled = (() => {
    const value = entry.enabled;
    if (typeof value !== "boolean") {
      pushIssue(issues, [...path, "enabled"], "enabled must be a boolean.");
      return undefined;
    }
    return value;
  })();

  const propContract = (() => {
    const value = entry.propContract;
    if (value === undefined) {
      return undefined;
    }
    if (!isRecord(value)) {
      pushIssue(
        issues,
        [...path, "propContract"],
        "propContract must be an object when provided.",
      );
      return undefined;
    }
    return value;
  })();

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const rule: WorkspaceComponentMappingRule = {
    boardKey: boardKey as string,
    componentName: componentName as string,
    importPath: importPath as string,
    priority: priority as number,
    source: source as WorkspaceComponentMappingRule["source"],
    enabled: enabled as boolean,
    ...(id !== undefined ? { id } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(nodeNamePattern ? { nodeNamePattern } : {}),
    ...(canonicalComponentName ? { canonicalComponentName } : {}),
    ...(storybookTier ? { storybookTier } : {}),
    ...(figmaLibrary ? { figmaLibrary } : {}),
    ...(semanticType ? { semanticType } : {}),
    ...(propContract ? { propContract } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };

  const validation = validateComponentMappingRule({ rule });
  if (!validation.ok) {
    const validationPath = validation.field
      ? [...path, validation.field]
      : path;
    pushIssue(issues, validationPath, validation.message);
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: validation.normalizedRule,
  };
}

function parseOptionalComponentMappingsField({
  input,
  key,
  issues,
}: {
  input: Record<string, unknown>;
  key: "componentMappings";
  issues: ValidationIssue[];
}): WorkspaceComponentMappingRule[] | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      [key],
      "componentMappings must be an array when provided.",
    );
    return undefined;
  }

  const parsedRules: WorkspaceComponentMappingRule[] = [];
  value.forEach((entry, index) => {
    const parsed = parseComponentMappingRuleEntry({
      entry,
      path: [key, index],
    });
    if (!parsed.success) {
      issues.push(...parsed.error.issues);
      return;
    }
    parsedRules.push(parsed.data);
  });

  return parsedRules;
}

function parseOptionalVisualAuditField({
  input,
  key,
  issues,
}: {
  input: Record<string, unknown>;
  key: "visualAudit";
  issues: ValidationIssue[];
}): WorkspaceVisualAuditInput | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    pushIssue(issues, [key], "visualAudit must be an object when provided.");
    return undefined;
  }

  const allowedKeys = new Set([
    "baselineImagePath",
    "capture",
    "diff",
    "regions",
  ]);
  for (const candidateKey of Object.keys(value)) {
    if (!allowedKeys.has(candidateKey)) {
      pushIssue(
        issues,
        [key, candidateKey],
        `Unexpected property '${candidateKey}'.`,
      );
    }
  }

  const baselineImagePath = (() => {
    const raw = value.baselineImagePath;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      pushIssue(
        issues,
        [key, "baselineImagePath"],
        "baselineImagePath must be a non-empty string.",
      );
      return undefined;
    }
    return raw.trim();
  })();

  const capture = (() => {
    const raw = value.capture;
    if (raw === undefined) {
      return undefined;
    }
    if (!isRecord(raw)) {
      pushIssue(
        issues,
        [key, "capture"],
        "visualAudit.capture must be an object when provided.",
      );
      return undefined;
    }

    const allowedCaptureKeys = new Set([
      "viewport",
      "waitForNetworkIdle",
      "waitForFonts",
      "waitForAnimations",
      "timeoutMs",
      "fullPage",
    ]);
    for (const captureKey of Object.keys(raw)) {
      if (!allowedCaptureKeys.has(captureKey)) {
        pushIssue(
          issues,
          [key, "capture", captureKey],
          `Unexpected property '${captureKey}'.`,
        );
      }
    }

    const parseOptionalBoolean = (field: string): boolean | undefined => {
      const candidate = raw[field];
      if (candidate === undefined) {
        return undefined;
      }
      if (typeof candidate !== "boolean") {
        pushIssue(
          issues,
          [key, "capture", field],
          `${field} must be a boolean when provided.`,
        );
        return undefined;
      }
      return candidate;
    };

    const parseOptionalPositiveNumber = ({
      field,
      integer = false,
    }: {
      field: string;
      integer?: boolean;
    }): number | undefined => {
      const candidate = raw[field];
      if (candidate === undefined) {
        return undefined;
      }
      if (
        typeof candidate !== "number" ||
        !Number.isFinite(candidate) ||
        candidate <= 0
      ) {
        pushIssue(
          issues,
          [key, "capture", field],
          `${field} must be a finite number greater than 0 when provided.`,
        );
        return undefined;
      }
      if (integer && !Number.isInteger(candidate)) {
        pushIssue(
          issues,
          [key, "capture", field],
          `${field} must be an integer when provided.`,
        );
        return undefined;
      }
      return candidate;
    };

    const viewport = (() => {
      const viewportRaw = raw.viewport;
      if (viewportRaw === undefined) {
        return undefined;
      }
      if (!isRecord(viewportRaw)) {
        pushIssue(
          issues,
          [key, "capture", "viewport"],
          "viewport must be an object when provided.",
        );
        return undefined;
      }
      const allowedViewportKeys = new Set([
        "width",
        "height",
        "deviceScaleFactor",
      ]);
      for (const viewportKey of Object.keys(viewportRaw)) {
        if (!allowedViewportKeys.has(viewportKey)) {
          pushIssue(
            issues,
            [key, "capture", "viewport", viewportKey],
            `Unexpected property '${viewportKey}'.`,
          );
        }
      }

      const parseViewportNumber = ({
        field,
        integer = false,
      }: {
        field: "width" | "height" | "deviceScaleFactor";
        integer?: boolean;
      }): number | undefined => {
        const candidate = viewportRaw[field];
        if (candidate === undefined) {
          return undefined;
        }
        if (
          typeof candidate !== "number" ||
          !Number.isFinite(candidate) ||
          candidate <= 0
        ) {
          pushIssue(
            issues,
            [key, "capture", "viewport", field],
            `${field} must be a finite number greater than 0 when provided.`,
          );
          return undefined;
        }
        if (integer && !Number.isInteger(candidate)) {
          pushIssue(
            issues,
            [key, "capture", "viewport", field],
            `${field} must be an integer when provided.`,
          );
          return undefined;
        }
        return candidate;
      };

      const width = parseViewportNumber({ field: "width", integer: true });
      const height = parseViewportNumber({ field: "height", integer: true });
      const deviceScaleFactor = parseViewportNumber({
        field: "deviceScaleFactor",
      });

      if (
        width === undefined &&
        height === undefined &&
        deviceScaleFactor === undefined
      ) {
        return undefined;
      }

      return {
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
      };
    })();

    const timeoutMs = parseOptionalPositiveNumber({
      field: "timeoutMs",
      integer: true,
    });
    const waitForNetworkIdle = parseOptionalBoolean("waitForNetworkIdle");
    const waitForFonts = parseOptionalBoolean("waitForFonts");
    const waitForAnimations = parseOptionalBoolean("waitForAnimations");
    const fullPage = parseOptionalBoolean("fullPage");

    return {
      ...(viewport ? { viewport } : {}),
      ...(waitForNetworkIdle !== undefined ? { waitForNetworkIdle } : {}),
      ...(waitForFonts !== undefined ? { waitForFonts } : {}),
      ...(waitForAnimations !== undefined ? { waitForAnimations } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(fullPage !== undefined ? { fullPage } : {}),
    };
  })();

  const diff = (() => {
    const raw = value.diff;
    if (raw === undefined) {
      return undefined;
    }
    if (!isRecord(raw)) {
      pushIssue(
        issues,
        [key, "diff"],
        "visualAudit.diff must be an object when provided.",
      );
      return undefined;
    }
    const allowedDiffKeys = new Set([
      "threshold",
      "includeAntialiasing",
      "alpha",
    ]);
    for (const diffKey of Object.keys(raw)) {
      if (!allowedDiffKeys.has(diffKey)) {
        pushIssue(
          issues,
          [key, "diff", diffKey],
          `Unexpected property '${diffKey}'.`,
        );
      }
    }

    const parseOptionalRatio = (
      field: "threshold" | "alpha",
    ): number | undefined => {
      const candidate = raw[field];
      if (candidate === undefined) {
        return undefined;
      }
      if (
        typeof candidate !== "number" ||
        !Number.isFinite(candidate) ||
        candidate < 0 ||
        candidate > 1
      ) {
        pushIssue(
          issues,
          [key, "diff", field],
          `${field} must be a number between 0 and 1 when provided.`,
        );
        return undefined;
      }
      return candidate;
    };

    const includeAntialiasing = (() => {
      const candidate = raw.includeAntialiasing;
      if (candidate === undefined) {
        return undefined;
      }
      if (typeof candidate !== "boolean") {
        pushIssue(
          issues,
          [key, "diff", "includeAntialiasing"],
          "includeAntialiasing must be a boolean when provided.",
        );
        return undefined;
      }
      return candidate;
    })();

    const threshold = parseOptionalRatio("threshold");
    const alpha = parseOptionalRatio("alpha");

    return {
      ...(threshold !== undefined ? { threshold } : {}),
      ...(includeAntialiasing !== undefined ? { includeAntialiasing } : {}),
      ...(alpha !== undefined ? { alpha } : {}),
    };
  })();

  const regions = (() => {
    const raw = value.regions;
    if (raw === undefined) {
      return undefined;
    }
    if (!Array.isArray(raw)) {
      pushIssue(
        issues,
        [key, "regions"],
        "visualAudit.regions must be an array when provided.",
      );
      return undefined;
    }

    return raw.flatMap((entry, index) => {
      const regionPath: PathSegment[] = [key, "regions", index];
      if (!isRecord(entry)) {
        pushIssue(
          issues,
          regionPath,
          "Each visualAudit region must be an object.",
        );
        return [];
      }

      const allowedRegionKeys = new Set(["name", "x", "y", "width", "height"]);
      for (const regionKey of Object.keys(entry)) {
        if (!allowedRegionKeys.has(regionKey)) {
          pushIssue(
            issues,
            [...regionPath, regionKey],
            `Unexpected property '${regionKey}'.`,
          );
        }
      }

      const name =
        typeof entry.name === "string" && entry.name.trim().length > 0
          ? entry.name.trim()
          : undefined;
      if (!name) {
        pushIssue(
          issues,
          [...regionPath, "name"],
          "name must be a non-empty string.",
        );
      }

      const parseInteger = (
        field: "x" | "y" | "width" | "height",
      ): number | undefined => {
        const candidate = entry[field];
        if (
          typeof candidate !== "number" ||
          !Number.isFinite(candidate) ||
          !Number.isInteger(candidate)
        ) {
          pushIssue(
            issues,
            [...regionPath, field],
            `${field} must be an integer.`,
          );
          return undefined;
        }
        if ((field === "width" || field === "height") && candidate <= 0) {
          pushIssue(
            issues,
            [...regionPath, field],
            `${field} must be greater than 0.`,
          );
          return undefined;
        }
        if ((field === "x" || field === "y") && candidate < 0) {
          pushIssue(
            issues,
            [...regionPath, field],
            `${field} must be greater than or equal to 0.`,
          );
          return undefined;
        }
        return candidate;
      };

      const x = parseInteger("x");
      const y = parseInteger("y");
      const width = parseInteger("width");
      const height = parseInteger("height");

      if (
        !name ||
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      ) {
        return [];
      }

      return [{ name, x, y, width, height }];
    });
  })();

  if (!baselineImagePath) {
    return undefined;
  }

  return {
    baselineImagePath,
    ...(capture && Object.keys(capture).length > 0 ? { capture } : {}),
    ...(diff && Object.keys(diff).length > 0 ? { diff } : {}),
    ...(regions ? { regions } : {}),
  };
}

function parseSubmitRequest(
  input: unknown,
): ValidationResult<WorkspaceJobInput> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "figmaFileKey",
    "figmaNodeId",
    "figmaAccessToken",
    "figmaJsonPath",
    "storybookStaticDir",
    "figmaJsonPayload",
    "customerProfilePath",
    "customerBrandId",
    "componentMappings",
    "repoUrl",
    "repoToken",
    "enableGitPr",
    "figmaSourceMode",
    "llmCodegenMode",
    "projectName",
    "targetPath",
    "brandTheme",
    "generationLocale",
    "formHandlingMode",
    "visualAudit",
    "importIntent",
    "originalIntent",
    "intentCorrected",
    "importMode",
    "selectedNodeIds",
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
    issues,
  });
  const figmaNodeId = parseStringField({
    input,
    key: "figmaNodeId",
    required: false,
    issues,
  });
  const figmaAccessToken = parseStringField({
    input,
    key: "figmaAccessToken",
    required: false,
    issues,
  });
  const figmaJsonPath = parseStringField({
    input,
    key: "figmaJsonPath",
    required: false,
    issues,
  });
  const figmaJsonPayload = parseStringField({
    input,
    key: "figmaJsonPayload",
    required: false,
    issues,
  });
  const storybookStaticDir = parseStringField({
    input,
    key: "storybookStaticDir",
    required: false,
    issues,
  });
  const customerProfilePath = parseStringField({
    input,
    key: "customerProfilePath",
    required: false,
    issues,
  });
  const customerBrandId = parseStringField({
    input,
    key: "customerBrandId",
    required: false,
    issues,
  });
  const componentMappings = parseOptionalComponentMappingsField({
    input,
    key: "componentMappings",
    issues,
  });
  const visualAudit = parseOptionalVisualAuditField({
    input,
    key: "visualAudit",
    issues,
  });
  const repoUrl = parseStringField({
    input,
    key: "repoUrl",
    required: false,
    issues,
  });
  const repoToken = parseStringField({
    input,
    key: "repoToken",
    required: false,
    issues,
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
    issues,
  });
  const rawLlmCodegenMode = parseStringField({
    input,
    key: "llmCodegenMode",
    required: false,
    issues,
  });
  const projectName = parseStringField({
    input,
    key: "projectName",
    required: false,
    issues,
  });
  const targetPath = parseStringField({
    input,
    key: "targetPath",
    required: false,
    issues,
  });
  const rawBrandTheme = parseStringField({
    input,
    key: "brandTheme",
    required: false,
    issues,
  });
  const rawGenerationLocale = parseStringField({
    input,
    key: "generationLocale",
    required: false,
    issues,
  });
  const rawFormHandlingMode = parseStringField({
    input,
    key: "formHandlingMode",
    required: false,
    issues,
  });
  const rawImportIntent = parseStringField({
    input,
    key: "importIntent",
    required: false,
    issues,
  });
  const rawOriginalIntent = parseStringField({
    input,
    key: "originalIntent" as keyof WorkspaceJobInput,
    required: false,
    issues,
  });
  const selectedNodeIds = parseOptionalNonEmptyStringArrayField({
    input,
    key: "selectedNodeIds",
    issues,
  });
  const brandTheme = (() => {
    if (rawBrandTheme === undefined) {
      return undefined;
    }
    const normalized = rawBrandTheme.trim().toLowerCase();
    if (normalized === "derived" || normalized === "sparkasse") {
      return normalized as WorkspaceBrandTheme;
    }
    pushIssue(
      issues,
      ["brandTheme"],
      "brandTheme must be one of: derived, sparkasse",
    );
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
    pushIssue(
      issues,
      ["formHandlingMode"],
      "formHandlingMode must be one of: react_hook_form, legacy_use_state",
    );
    return undefined;
  })();
  const importIntent = (() => {
    if (rawImportIntent === undefined) {
      return undefined;
    }
    const normalized = rawImportIntent.trim().toUpperCase();
    if (
      normalized === "FIGMA_JSON_NODE_BATCH" ||
      normalized === "FIGMA_JSON_DOC" ||
      normalized === "FIGMA_PLUGIN_ENVELOPE" ||
      normalized === "RAW_CODE_OR_TEXT" ||
      normalized === "UNKNOWN"
    ) {
      return normalized as WorkspaceImportIntent;
    }
    pushIssue(
      issues,
      ["importIntent"],
      "importIntent must be one of: FIGMA_JSON_NODE_BATCH, FIGMA_JSON_DOC, FIGMA_PLUGIN_ENVELOPE, RAW_CODE_OR_TEXT, UNKNOWN",
    );
    return undefined;
  })();
  const originalIntent = (() => {
    if (rawOriginalIntent === undefined) {
      return undefined;
    }
    const normalized = rawOriginalIntent.trim().toUpperCase();
    if (
      normalized === "FIGMA_JSON_NODE_BATCH" ||
      normalized === "FIGMA_JSON_DOC" ||
      normalized === "FIGMA_PLUGIN_ENVELOPE" ||
      normalized === "RAW_CODE_OR_TEXT" ||
      normalized === "UNKNOWN"
    ) {
      return normalized as WorkspaceImportIntent;
    }
    pushIssue(
      issues,
      ["originalIntent"],
      "originalIntent must be one of: FIGMA_JSON_NODE_BATCH, FIGMA_JSON_DOC, FIGMA_PLUGIN_ENVELOPE, RAW_CODE_OR_TEXT, UNKNOWN",
    );
    return undefined;
  })();
  const rawIntentCorrected = input.intentCorrected;
  const intentCorrected =
    rawIntentCorrected === undefined
      ? undefined
      : typeof rawIntentCorrected === "boolean"
        ? rawIntentCorrected
        : (() => {
            pushIssue(
              issues,
              ["intentCorrected"],
              "intentCorrected must be a boolean",
            );
            return undefined;
          })();
  const rawImportMode = parseStringField({
    input,
    key: "importMode",
    required: false,
    issues,
  });
  const importMode = (() => {
    if (rawImportMode === undefined) {
      return undefined;
    }
    const normalized = rawImportMode.trim().toLowerCase();
    if (
      normalized === "full" ||
      normalized === "delta" ||
      normalized === "auto"
    ) {
      return normalized as WorkspaceImportMode;
    }
    pushIssue(
      issues,
      ["importMode"],
      "importMode must be one of: full, delta, auto",
    );
    return undefined;
  })();
  const llmCodegenMode = parseSubmitLlmCodegenMode({
    value: rawLlmCodegenMode,
    issues,
  });
  const generationLocale = parseSubmitGenerationLocale({
    value: rawGenerationLocale,
    issues,
  });

  const normalizedFigmaSourceMode = figmaSourceMode?.trim().toLowerCase();
  const resolvedFigmaSourceMode: WorkspaceFigmaSourceMode | undefined = (() => {
    if (normalizedFigmaSourceMode === undefined) {
      return figmaJsonPath !== undefined ? "local_json" : "rest";
    }
    const match = ALLOWED_FIGMA_SOURCE_MODES.find(
      (mode) => mode === normalizedFigmaSourceMode,
    );
    if (match === undefined) {
      pushIssue(
        issues,
        ["figmaSourceMode"],
        `figmaSourceMode must be one of: ${ALLOWED_FIGMA_SOURCE_MODES.join(", ")}`,
      );
    }
    return match;
  })();

  if (
    resolvedFigmaSourceMode === "rest" ||
    resolvedFigmaSourceMode === "hybrid"
  ) {
    if (!figmaFileKey) {
      pushIssue(
        issues,
        ["figmaFileKey"],
        `figmaFileKey is required when figmaSourceMode=${resolvedFigmaSourceMode}`,
      );
    }
    if (!figmaAccessToken) {
      pushIssue(
        issues,
        ["figmaAccessToken"],
        `figmaAccessToken is required when figmaSourceMode=${resolvedFigmaSourceMode}`,
      );
    }
    if (figmaJsonPath !== undefined) {
      pushIssue(
        issues,
        ["figmaJsonPath"],
        `figmaJsonPath must be omitted when figmaSourceMode=${resolvedFigmaSourceMode}`,
      );
    }
  }

  if (resolvedFigmaSourceMode === "local_json") {
    if (!figmaJsonPath) {
      pushIssue(
        issues,
        ["figmaJsonPath"],
        "figmaJsonPath is required when figmaSourceMode=local_json",
      );
    }
    if (figmaFileKey !== undefined) {
      pushIssue(
        issues,
        ["figmaFileKey"],
        "figmaFileKey must be omitted when figmaSourceMode=local_json",
      );
    }
    if (figmaAccessToken !== undefined) {
      pushIssue(
        issues,
        ["figmaAccessToken"],
        "figmaAccessToken must be omitted when figmaSourceMode=local_json",
      );
    }
  }

  if (
    resolvedFigmaSourceMode === "figma_paste" ||
    resolvedFigmaSourceMode === "figma_plugin"
  ) {
    const figmaPasteMaxBytes = resolveFigmaPasteMaxBytes();
    if (!figmaJsonPayload) {
      pushIssue(
        issues,
        ["figmaJsonPayload"],
        "INVALID_PAYLOAD: figmaJsonPayload is required when figmaSourceMode=figma_paste or figma_plugin",
      );
    } else {
      const byteLength = Buffer.byteLength(figmaJsonPayload, "utf8");
      if (byteLength > figmaPasteMaxBytes) {
        pushIssue(
          issues,
          ["figmaJsonPayload"],
          `TOO_LARGE: figmaJsonPayload exceeds maximum allowed size of ${figmaPasteMaxBytes} bytes`,
        );
      } else if (
        estimateFigmaPasteSubmitTransportBytes({ figmaJsonPayload }) >
        MAX_SUBMIT_BODY_BYTES
      ) {
        pushIssue(
          issues,
          ["figmaJsonPayload"],
          `TOO_LARGE: figmaJsonPayload exceeds the ${MAX_SUBMIT_BODY_BYTES} byte submit transport budget`,
        );
      } else {
        try {
          const parsedFigmaPayload = JSON.parse(figmaJsonPayload) as unknown;
          if (looksLikeClipboardEnvelope(parsedFigmaPayload)) {
            // Validate as clipboard envelope (plugin handoff format).
            const envelopeResult =
              validateClipboardEnvelope(parsedFigmaPayload);
            if (!envelopeResult.valid) {
              const issuePrefix = isClipboardEnvelope(parsedFigmaPayload)
                ? "SCHEMA_MISMATCH"
                : resolvedFigmaSourceMode === "figma_plugin"
                  ? "UNSUPPORTED_FORMAT"
                  : "UNSUPPORTED_CLIPBOARD_KIND";
              pushIssue(
                issues,
                ["figmaJsonPayload"],
                `${issuePrefix}: ${summarizeEnvelopeValidationIssues(envelopeResult.issues)}`,
              );
            } else {
              const complexityResult = validateClipboardEnvelopeComplexity(
                envelopeResult.envelope,
              );
              if (!complexityResult.ok) {
                pushIssue(
                  issues,
                  ["figmaJsonPayload"],
                  `TOO_LARGE: ${complexityResult.message}`,
                );
              }
            }
          } else {
            // Validate as full Figma document JSON.
            const validatedFigmaPayload = safeParseFigmaPayload({
              input: parsedFigmaPayload,
            });
            if (!validatedFigmaPayload.success) {
              pushIssue(
                issues,
                ["figmaJsonPayload"],
                `SCHEMA_MISMATCH: ${summarizeFigmaPayloadValidationError({
                  error: validatedFigmaPayload.error,
                })}`,
              );
            } else {
              const complexityResult = validateFigmaPayloadComplexity({
                document: validatedFigmaPayload.data.document,
              });
              if (!complexityResult.ok) {
                pushIssue(
                  issues,
                  ["figmaJsonPayload"],
                  `TOO_LARGE: ${complexityResult.message}`,
                );
              }
            }
          }
        } catch {
          pushIssue(
            issues,
            ["figmaJsonPayload"],
            "SCHEMA_MISMATCH: figmaJsonPayload must be valid JSON",
          );
        }
      }
    }
    if (figmaAccessToken !== undefined) {
      pushIssue(
        issues,
        ["figmaAccessToken"],
        `figmaAccessToken must be omitted when figmaSourceMode=${resolvedFigmaSourceMode}`,
      );
    }
    if (figmaJsonPath !== undefined) {
      pushIssue(
        issues,
        ["figmaJsonPath"],
        `figmaJsonPath must be omitted when figmaSourceMode=${resolvedFigmaSourceMode}`,
      );
    }
  }

  if (selectedNodeIds !== undefined) {
    const importCapableModes = new Set<WorkspaceFigmaSourceMode>([
      "rest",
      "hybrid",
      "local_json",
      "figma_paste",
      "figma_plugin",
    ]);
    if (
      resolvedFigmaSourceMode === undefined ||
      !importCapableModes.has(resolvedFigmaSourceMode)
    ) {
      pushIssue(
        issues,
        ["selectedNodeIds"],
        "selectedNodeIds are only supported for import-capable submit modes",
      );
    }
  }

  if (enableGitPr) {
    if (!repoUrl) {
      pushIssue(
        issues,
        ["repoUrl"],
        "repoUrl is required when enableGitPr=true",
      );
    }
    if (!repoToken) {
      pushIssue(
        issues,
        ["repoToken"],
        "repoToken is required when enableGitPr=true",
      );
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const data: WorkspaceJobInput = {
    enableGitPr,
  };
  if (resolvedFigmaSourceMode !== undefined) {
    data.figmaSourceMode = resolvedFigmaSourceMode;
  }
  if (figmaFileKey !== undefined) {
    data.figmaFileKey = figmaFileKey;
  }
  if (figmaNodeId !== undefined) {
    data.figmaNodeId = figmaNodeId;
  }
  if (figmaAccessToken !== undefined) {
    data.figmaAccessToken = figmaAccessToken;
  }
  if (figmaJsonPath !== undefined) {
    data.figmaJsonPath = figmaJsonPath;
  }
  if (figmaJsonPayload !== undefined) {
    data.figmaJsonPayload = figmaJsonPayload;
  }
  if (storybookStaticDir !== undefined) {
    data.storybookStaticDir = storybookStaticDir.trim();
  }
  if (customerProfilePath !== undefined) {
    data.customerProfilePath = customerProfilePath.trim();
  }
  if (customerBrandId !== undefined) {
    data.customerBrandId = customerBrandId.trim();
  }
  if (componentMappings !== undefined) {
    data.componentMappings = componentMappings;
  }
  if (visualAudit !== undefined) {
    data.visualAudit = visualAudit;
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
  if (importIntent !== undefined) {
    data.importIntent = importIntent;
  }
  if (originalIntent !== undefined) {
    data.originalIntent = originalIntent;
  }
  if (intentCorrected !== undefined) {
    data.intentCorrected = intentCorrected;
  }
  if (importMode !== undefined) {
    data.importMode = importMode;
  }
  if (selectedNodeIds !== undefined) {
    data.selectedNodeIds = selectedNodeIds;
  }

  return {
    success: true,
    data,
  };
}

function parseWorkspaceStatus(
  input: unknown,
): ValidationResult<WorkspaceStatus> {
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

  if (typeof running !== "boolean")
    pushIssue(issues, ["running"], "running must be a boolean");
  if (typeof url !== "string")
    pushIssue(issues, ["url"], "url must be a string");
  if (typeof host !== "string")
    pushIssue(issues, ["host"], "host must be a string");
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1) {
    pushIssue(issues, ["port"], "port must be a positive integer");
  }
  const isAllowedFigmaSourceMode = ALLOWED_FIGMA_SOURCE_MODES.some(
    (mode) => mode === figmaSourceMode,
  );
  if (!isAllowedFigmaSourceMode) {
    pushIssue(
      issues,
      ["figmaSourceMode"],
      `figmaSourceMode must be one of: ${ALLOWED_FIGMA_SOURCE_MODES.join(", ")}`,
    );
  }
  const isAllowedLlmCodegenMode = ALLOWED_LLM_CODEGEN_MODES.some(
    (mode) => mode === llmCodegenMode,
  );
  if (!isAllowedLlmCodegenMode) {
    pushIssue(
      issues,
      ["llmCodegenMode"],
      `llmCodegenMode must equal '${ALLOWED_LLM_CODEGEN_MODES[0]}'`,
    );
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
      previewEnabled: previewEnabled as boolean,
    },
  };
}

function parseErrorResponse(
  input: unknown,
): ValidationResult<{ error: string; message: string }> {
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
      message: input.message as string,
    },
  };
}

export const SubmitRequestSchema: RuntimeSchema<WorkspaceJobInput> = {
  safeParse: parseSubmitRequest,
};

export const WorkspaceStatusSchema: RuntimeSchema<WorkspaceStatus> = {
  safeParse: parseWorkspaceStatus,
};

export const ErrorResponseSchema: RuntimeSchema<{
  error: string;
  message: string;
}> = {
  safeParse: parseErrorResponse,
};

interface RegenerationRequestData {
  overrides: WorkspaceRegenerationOverrideEntry[];
  draftId?: string;
  baseFingerprint?: string;
  customerBrandId?: string;
  componentMappings?: WorkspaceComponentMappingRule[];
}

function parseRegenerationRequest(
  input: unknown,
): ValidationResult<RegenerationRequestData> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "overrides",
    "draftId",
    "baseFingerprint",
    "customerBrandId",
    "componentMappings",
  ]);
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
      pushIssue(
        issues,
        ["overrides", i],
        "Each override entry must be an object.",
      );
      continue;
    }
    if (typeof entry.nodeId !== "string" || entry.nodeId.trim().length === 0) {
      pushIssue(
        issues,
        ["overrides", i, "nodeId"],
        "nodeId must be a non-empty string.",
      );
      continue;
    }
    if (typeof entry.field !== "string" || entry.field.trim().length === 0) {
      pushIssue(
        issues,
        ["overrides", i, "field"],
        "field must be a non-empty string.",
      );
      continue;
    }
    const validationResult = validateRegenerationOverrideEntry({
      nodeId: entry.nodeId,
      field: entry.field,
      value: entry.value as WorkspaceRegenerationOverrideEntry["value"],
    });
    if (!validationResult.ok) {
      pushIssue(
        issues,
        ["overrides", i, validationResult.path],
        validationResult.message,
      );
      continue;
    }
    overrides.push(validationResult.entry);
  }

  let draftId: string | undefined;
  if (input.draftId !== undefined) {
    if (
      typeof input.draftId !== "string" ||
      input.draftId.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["draftId"],
        "draftId must be a non-empty string when provided.",
      );
    } else {
      draftId = input.draftId;
    }
  }

  let baseFingerprint: string | undefined;
  if (input.baseFingerprint !== undefined) {
    if (
      typeof input.baseFingerprint !== "string" ||
      input.baseFingerprint.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["baseFingerprint"],
        "baseFingerprint must be a non-empty string when provided.",
      );
    } else {
      baseFingerprint = input.baseFingerprint;
    }
  }

  let customerBrandId: string | undefined;
  if (input.customerBrandId !== undefined) {
    if (
      typeof input.customerBrandId !== "string" ||
      input.customerBrandId.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["customerBrandId"],
        "customerBrandId must be a non-empty string when provided.",
      );
    } else {
      customerBrandId = input.customerBrandId.trim();
    }
  }

  const componentMappings = parseOptionalComponentMappingsField({
    input,
    key: "componentMappings",
    issues,
  });

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
  if (customerBrandId !== undefined) {
    data.customerBrandId = customerBrandId;
  }
  if (componentMappings !== undefined) {
    data.componentMappings = componentMappings;
  }

  return { success: true, data };
}

export const RegenerationRequestSchema: RuntimeSchema<RegenerationRequestData> =
  {
    safeParse: parseRegenerationRequest,
  };

function parseRetryRequest(input: unknown): ValidationResult<RetryRequestData> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set(["retryStage", "retryTargets"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  let retryStage: WorkspaceJobRetryStage | undefined;
  if (
    input.retryStage === "figma.source" ||
    input.retryStage === "ir.derive" ||
    input.retryStage === "template.prepare" ||
    input.retryStage === "codegen.generate"
  ) {
    retryStage = input.retryStage;
  } else {
    pushIssue(
      issues,
      ["retryStage"],
      "retryStage must be one of: figma.source, ir.derive, template.prepare, codegen.generate.",
    );
  }

  let retryTargets: string[] | undefined;
  if (input.retryTargets !== undefined) {
    if (!Array.isArray(input.retryTargets)) {
      pushIssue(
        issues,
        ["retryTargets"],
        "retryTargets must be an array of non-empty strings when provided.",
      );
    } else {
      const normalizedTargets: string[] = [];
      const retryTargetEntries: unknown[] = input.retryTargets;
      for (let index = 0; index < retryTargetEntries.length; index += 1) {
        const entry = retryTargetEntries[index];
        if (typeof entry !== "string" || entry.trim().length === 0) {
          pushIssue(
            issues,
            ["retryTargets", index],
            "Each retryTargets entry must be a non-empty string.",
          );
          continue;
        }
        normalizedTargets.push(entry.trim());
      }
      retryTargets = normalizedTargets;
    }
  }

  if (retryTargets !== undefined && retryStage !== "codegen.generate") {
    pushIssue(
      issues,
      ["retryTargets"],
      "retryTargets are only allowed when retryStage=codegen.generate.",
    );
  }

  if (issues.length > 0 || retryStage === undefined) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      retryStage,
      ...(retryTargets !== undefined ? { retryTargets } : {}),
    },
  };
}

export const RetryRequestSchema: RuntimeSchema<RetryRequestData> = {
  safeParse: parseRetryRequest,
};

function parseSyncRequest(
  input: unknown,
): ValidationResult<WorkspaceLocalSyncRequest> {
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

    if (
      input.targetPath !== undefined &&
      (typeof input.targetPath !== "string" ||
        input.targetPath.trim().length === 0)
    ) {
      pushIssue(
        issues,
        ["targetPath"],
        "targetPath must be a non-empty string when provided.",
      );
    }

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }

    return {
      success: true,
      data: {
        mode: "dry_run",
        ...(typeof input.targetPath === "string"
          ? { targetPath: input.targetPath }
          : {}),
      },
    };
  }

  const allowedKeys = new Set([
    "mode",
    "confirmationToken",
    "confirmOverwrite",
    "fileDecisions",
    "reviewerNote",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  const confirmationToken =
    typeof input.confirmationToken === "string"
      ? input.confirmationToken.trim()
      : "";
  if (confirmationToken.length === 0) {
    pushIssue(
      issues,
      ["confirmationToken"],
      "confirmationToken must be a non-empty string.",
    );
  }
  if (input.confirmOverwrite !== true) {
    pushIssue(
      issues,
      ["confirmOverwrite"],
      "confirmOverwrite must be true for apply mode.",
    );
  }
  if (!Array.isArray(input.fileDecisions) || input.fileDecisions.length === 0) {
    pushIssue(
      issues,
      ["fileDecisions"],
      "fileDecisions must be a non-empty array.",
    );
  }

  const fileDecisions: readonly unknown[] = Array.isArray(input.fileDecisions)
    ? input.fileDecisions
    : [];
  const seenPaths = new Set<string>();
  const parsedFileDecisions: ParsedLocalSyncFileDecision[] = [];
  for (let index = 0; index < fileDecisions.length; index += 1) {
    const candidate = fileDecisions[index];
    if (!isRecord(candidate)) {
      pushIssue(
        issues,
        ["fileDecisions", index],
        "Each fileDecisions entry must be an object.",
      );
      continue;
    }

    const rawPath = candidate.path;
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      pushIssue(
        issues,
        ["fileDecisions", index, "path"],
        "path must be a non-empty string.",
      );
    }

    const rawDecision = candidate.decision;
    if (rawDecision !== "write" && rawDecision !== "skip") {
      pushIssue(
        issues,
        ["fileDecisions", index, "decision"],
        "decision must be one of: write, skip.",
      );
    }

    if (typeof rawPath === "string" && rawPath.trim().length > 0) {
      const normalizedPath = rawPath.trim();
      if (seenPaths.has(normalizedPath)) {
        pushIssue(
          issues,
          ["fileDecisions", index, "path"],
          `Duplicate decision for '${normalizedPath}'.`,
        );
      } else {
        seenPaths.add(normalizedPath);
        if (rawDecision === "write" || rawDecision === "skip") {
          parsedFileDecisions.push({
            path: normalizedPath,
            decision: rawDecision,
          });
        }
      }
    }
  }

  let reviewerNote: string | undefined;
  if (input.reviewerNote !== undefined) {
    if (
      typeof input.reviewerNote !== "string" ||
      input.reviewerNote.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["reviewerNote"],
        "reviewerNote must be a non-empty string when provided.",
      );
    } else {
      reviewerNote = input.reviewerNote.trim();
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      mode: "apply",
      confirmationToken,
      confirmOverwrite: true,
      fileDecisions: parsedFileDecisions,
      ...(reviewerNote !== undefined ? { reviewerNote } : {}),
    },
  };
}

export const SyncRequestSchema: RuntimeSchema<WorkspaceLocalSyncRequest> = {
  safeParse: parseSyncRequest,
};

function parseCreatePrRequest(
  input: unknown,
): ValidationResult<WorkspaceCreatePrInput> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "repoUrl",
    "repoToken",
    "targetPath",
    "reviewerNote",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  if (typeof input.repoUrl !== "string" || input.repoUrl.trim().length === 0) {
    pushIssue(issues, ["repoUrl"], "repoUrl must be a non-empty string.");
  }
  if (
    typeof input.repoToken !== "string" ||
    input.repoToken.trim().length === 0
  ) {
    pushIssue(issues, ["repoToken"], "repoToken must be a non-empty string.");
  }

  if (input.targetPath !== undefined) {
    if (
      typeof input.targetPath !== "string" ||
      input.targetPath.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["targetPath"],
        "targetPath must be a non-empty string when provided.",
      );
    }
  }

  let reviewerNote: string | undefined;
  if (input.reviewerNote !== undefined) {
    if (
      typeof input.reviewerNote !== "string" ||
      input.reviewerNote.trim().length === 0
    ) {
      pushIssue(
        issues,
        ["reviewerNote"],
        "reviewerNote must be a non-empty string when provided.",
      );
    } else {
      reviewerNote = input.reviewerNote.trim();
    }
  }

  if (issues.length > 0) {
    return { success: false, error: { issues } };
  }

  const data: WorkspaceCreatePrInput = {
    repoUrl: input.repoUrl as string,
    repoToken: input.repoToken as string,
  };
  if (typeof input.targetPath === "string") {
    data.targetPath = input.targetPath;
  }
  if (reviewerNote !== undefined) {
    data.reviewerNote = reviewerNote;
  }

  return { success: true, data };
}

export const CreatePrRequestSchema: RuntimeSchema<WorkspaceCreatePrInput> = {
  safeParse: parseCreatePrRequest,
};

/**
 * Keeps backward-compatible naming for existing tests and consumers.
 */
export function formatZodError(
  validationError: ValidationError,
): ValidationFailure {
  return {
    error: "VALIDATION_ERROR",
    message: "Request validation failed.",
    issues: validationError.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message,
    })),
  };
}
