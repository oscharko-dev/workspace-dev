import type {
  WorkspaceFigmaSourceMode,
  WorkspaceTestSpaceCase,
  WorkspaceTestSpaceCoverageFinding,
  WorkspaceTestSpaceRunRequest,
  WorkspaceTestSpaceStep,
} from "../contracts/index.js";
import { ALLOWED_FIGMA_SOURCE_MODES } from "../contracts/index.js";

type PathSegment = string | number;

interface ValidationIssue {
  path: PathSegment[];
  message: string;
}

interface ValidationError {
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

function pushIssue(
  issues: ValidationIssue[],
  path: PathSegment[],
  message: string,
): void {
  issues.push({ path, message });
}

function parseNonEmptyStringField({
  input,
  key,
  issues,
  required,
  path = [key],
}: {
  input: Record<string, unknown>;
  key: string;
  issues: ValidationIssue[];
  required: boolean;
  path?: PathSegment[];
}): string | undefined {
  const value = input[key];
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, `${key} is required.`);
    }
    return undefined;
  }
  if (typeof value !== "string") {
    pushIssue(issues, path, `${key} must be a string.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    pushIssue(issues, path, `${key} must not be empty.`);
    return undefined;
  }
  return trimmed;
}

function parseOptionalStringArrayField({
  input,
  key,
  issues,
  path = [key],
}: {
  input: Record<string, unknown>;
  key: string;
  issues: ValidationIssue[];
  path?: PathSegment[];
}): string[] | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    pushIssue(issues, path, `${key} must be an array of non-empty strings.`);
    return undefined;
  }

  const parsed: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string" || entry.trim().length === 0) {
      pushIssue(
        issues,
        [key, index],
        `${key} entries must be non-empty strings.`,
      );
      continue;
    }
    parsed.push(entry.trim());
  }

  return issues.length > 0 ? undefined : parsed;
}

function parseFigmaSourceMode({
  value,
  issues,
}: {
  value: unknown;
  issues: ValidationIssue[];
}): WorkspaceFigmaSourceMode | undefined {
  if (typeof value !== "string") {
    pushIssue(issues, ["figmaSourceMode"], "figmaSourceMode is required.");
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const match = ALLOWED_FIGMA_SOURCE_MODES.find((mode) => mode === normalized);
  if (match === undefined) {
    pushIssue(
      issues,
      ["figmaSourceMode"],
      `figmaSourceMode must be one of: ${ALLOWED_FIGMA_SOURCE_MODES.join(", ")}`,
    );
    return undefined;
  }

  return match;
}

function parseJsonPayloadField({
  input,
  key,
  issues,
}: {
  input: Record<string, unknown>;
  key: string;
  issues: ValidationIssue[];
}): string | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    pushIssue(issues, [key], `${key} must be a string.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    pushIssue(issues, [key], `${key} must not be empty.`);
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed === null ||
      (typeof parsed !== "object" && !Array.isArray(parsed))
    ) {
      pushIssue(
        issues,
        [key],
        `${key} must contain a JSON object or array.`,
      );
      return undefined;
    }
  } catch {
    pushIssue(issues, [key], `${key} must contain valid JSON.`);
    return undefined;
  }

  return trimmed;
}

function hasFigmaJsonSource({
  figmaJsonPath,
  figmaJsonPayload,
}: {
  figmaJsonPath: string | undefined;
  figmaJsonPayload: string | undefined;
}): boolean {
  return figmaJsonPath !== undefined || figmaJsonPayload !== undefined;
}

function parseBusinessContext({
  input,
  issues,
}: {
  input: Record<string, unknown>;
  issues: ValidationIssue[];
}): WorkspaceTestSpaceRunRequest["businessContext"] | undefined {
  const rawBusinessContext = input.businessContext;
  if (!isRecord(rawBusinessContext)) {
    pushIssue(
      issues,
      ["businessContext"],
      "businessContext is required and must be an object.",
    );
    return undefined;
  }

  const allowedKeys = new Set([
    "summary",
    "productName",
    "audience",
    "goals",
    "constraints",
    "notes",
  ]);
  for (const key of Object.keys(rawBusinessContext)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, ["businessContext", key], `Unexpected property '${key}'.`);
    }
  }

  const summary = parseNonEmptyStringField({
    input: rawBusinessContext,
    key: "summary",
    required: true,
    path: ["businessContext", "summary"],
    issues,
  });
  const productName = parseNonEmptyStringField({
    input: rawBusinessContext,
    key: "productName",
    required: false,
    path: ["businessContext", "productName"],
    issues,
  });
  const audience = parseNonEmptyStringField({
    input: rawBusinessContext,
    key: "audience",
    required: false,
    path: ["businessContext", "audience"],
    issues,
  });
  const goals = parseOptionalStringArrayField({
    input: rawBusinessContext,
    key: "goals",
    path: ["businessContext", "goals"],
    issues,
  });
  const constraints = parseOptionalStringArrayField({
    input: rawBusinessContext,
    key: "constraints",
    path: ["businessContext", "constraints"],
    issues,
  });
  const notes = parseNonEmptyStringField({
    input: rawBusinessContext,
    key: "notes",
    required: false,
    path: ["businessContext", "notes"],
    issues,
  });

  if (summary === undefined) {
    return undefined;
  }

  return {
    summary,
    ...(productName !== undefined ? { productName } : {}),
    ...(audience !== undefined ? { audience } : {}),
    ...(goals !== undefined ? { goals } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function parseTestSpaceRunRequest(
  input: unknown,
): ValidationResult<WorkspaceTestSpaceRunRequest> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set([
    "figmaSourceMode",
    "figmaFileKey",
    "figmaNodeId",
    "figmaAccessToken",
    "figmaJsonPath",
    "figmaJsonPayload",
    "testSuiteName",
    "businessContext",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  const figmaSourceMode = parseFigmaSourceMode({
    value: input.figmaSourceMode,
    issues,
  });
  const figmaFileKey = parseNonEmptyStringField({
    input,
    key: "figmaFileKey",
    required: false,
    issues,
  });
  const figmaNodeId = parseNonEmptyStringField({
    input,
    key: "figmaNodeId",
    required: false,
    issues,
  });
  const figmaAccessToken = parseNonEmptyStringField({
    input,
    key: "figmaAccessToken",
    required: false,
    issues,
  });
  const figmaJsonPath = parseNonEmptyStringField({
    input,
    key: "figmaJsonPath",
    required: false,
    issues,
  });
  const figmaJsonPayload = parseJsonPayloadField({
    input,
    key: "figmaJsonPayload",
    issues,
  });
  const testSuiteName = parseNonEmptyStringField({
    input,
    key: "testSuiteName",
    required: false,
    issues,
  });
  const businessContext = parseBusinessContext({ input, issues });

  if (
    !hasFigmaJsonSource({
      figmaJsonPath,
      figmaJsonPayload,
    })
  ) {
    pushIssue(
      issues,
      ["figmaJsonPath"],
      "figmaJsonPath or figmaJsonPayload is required for Test Space runs.",
    );
  }

  if (issues.length > 0 || figmaSourceMode === undefined || businessContext === undefined) {
    return { success: false, error: { issues } };
  }

  const data: WorkspaceTestSpaceRunRequest = {
    figmaSourceMode,
    businessContext,
    ...(figmaFileKey !== undefined ? { figmaFileKey } : {}),
    ...(figmaNodeId !== undefined ? { figmaNodeId } : {}),
    ...(figmaAccessToken !== undefined ? { figmaAccessToken } : {}),
    ...(figmaJsonPath !== undefined ? { figmaJsonPath } : {}),
    ...(figmaJsonPayload !== undefined ? { figmaJsonPayload } : {}),
    ...(testSuiteName !== undefined ? { testSuiteName } : {}),
  };

  return { success: true, data };
}

function parseTestSpaceStep(
  input: unknown,
  path: PathSegment[],
  issues: ValidationIssue[],
): WorkspaceTestSpaceStep | undefined {
  if (!isRecord(input)) {
    pushIssue(issues, path, "Each step must be an object.");
    return undefined;
  }

  const allowedKeys = new Set(["order", "action", "expectedResult"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [...path, key], `Unexpected property '${key}'.`);
    }
  }

  const orderValue = input.order;
  if (
    typeof orderValue !== "number" ||
    !Number.isInteger(orderValue) ||
    orderValue < 1
  ) {
    pushIssue(issues, [...path, "order"], "order must be a positive integer.");
  }
  const action = parseNonEmptyStringField({
    input,
    key: "action",
    required: true,
    issues,
  });
  const expectedResult = parseNonEmptyStringField({
    input,
    key: "expectedResult",
    required: true,
    issues,
  });

  if (
    typeof orderValue !== "number" ||
    !Number.isInteger(orderValue) ||
    orderValue < 1 ||
    action === undefined ||
    expectedResult === undefined
  ) {
    return undefined;
  }

  return {
    order: orderValue,
    action,
    expectedResult,
  };
}

function parseTestSpaceCase(
  input: unknown,
  path: PathSegment[],
  issues: ValidationIssue[],
): WorkspaceTestSpaceCase | undefined {
  if (!isRecord(input)) {
    pushIssue(issues, path, "Each test case must be an object.");
    return undefined;
  }

  const allowedKeys = new Set([
    "id",
    "title",
    "priority",
    "type",
    "preconditions",
    "steps",
    "expectedResult",
    "coverageTags",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [...path, key], `Unexpected property '${key}'.`);
    }
  }

  const id = parseNonEmptyStringField({
    input,
    key: "id",
    required: true,
    path: [...path, "id"],
    issues,
  });
  const title = parseNonEmptyStringField({
    input,
    key: "title",
    required: true,
    path: [...path, "title"],
    issues,
  });
  const priorityRaw = parseNonEmptyStringField({
    input,
    key: "priority",
    required: true,
    path: [...path, "priority"],
    issues,
  });
  const typeRaw = parseNonEmptyStringField({
    input,
    key: "type",
    required: true,
    path: [...path, "type"],
    issues,
  });
  const preconditions = parseOptionalStringArrayField({
    input,
    key: "preconditions",
    path: [...path, "preconditions"],
    issues,
  });
  const stepsRaw = input.steps;
  const expectedResult = parseNonEmptyStringField({
    input,
    key: "expectedResult",
    required: true,
    path: [...path, "expectedResult"],
    issues,
  });
  const coverageTags = parseOptionalStringArrayField({
    input,
    key: "coverageTags",
    path: [...path, "coverageTags"],
    issues,
  });

  const priority =
    priorityRaw === undefined
      ? undefined
      : priorityRaw.toUpperCase() === "P0" ||
          priorityRaw.toUpperCase() === "P1" ||
          priorityRaw.toUpperCase() === "P2"
        ? (priorityRaw.toUpperCase() as WorkspaceTestSpaceCase["priority"])
        : (() => {
            pushIssue(
              issues,
              [...path, "priority"],
              "priority must be one of: P0, P1, P2.",
            );
            return undefined;
          })();

  const type =
    typeRaw === undefined
      ? undefined
      :
          typeRaw.toLowerCase() === "happy_path" ||
          typeRaw.toLowerCase() === "validation" ||
          typeRaw.toLowerCase() === "edge_case" ||
          typeRaw.toLowerCase() === "regression"
        ? (typeRaw.toLowerCase() as WorkspaceTestSpaceCase["type"])
        : (() => {
            pushIssue(
              issues,
              [...path, "type"],
              "type must be one of: happy_path, validation, edge_case, regression.",
            );
            return undefined;
          })();

  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    pushIssue(issues, [...path, "steps"], "steps must be a non-empty array.");
  }
  const steps: WorkspaceTestSpaceStep[] = [];
  if (Array.isArray(stepsRaw)) {
    for (let index = 0; index < stepsRaw.length; index += 1) {
      const step = parseTestSpaceStep(stepsRaw[index], [...path, "steps", index], issues);
      if (step !== undefined) {
        steps.push(step);
      }
    }
  }

  if (
    id === undefined ||
    title === undefined ||
    priority === undefined ||
    type === undefined ||
    expectedResult === undefined ||
    !Array.isArray(stepsRaw) ||
    steps.length === 0
  ) {
    return undefined;
  }

  const data: WorkspaceTestSpaceCase = {
    id,
    title,
    priority,
    type,
    steps,
    expectedResult,
    coverageTags: coverageTags ?? [],
  };
  if (preconditions !== undefined) {
    data.preconditions = preconditions;
  }
  return data;
}

function parseTestSpaceCoverageFinding(
  input: unknown,
  path: PathSegment[],
  issues: ValidationIssue[],
): WorkspaceTestSpaceCoverageFinding | undefined {
  if (!isRecord(input)) {
    pushIssue(issues, path, "Each coverage finding must be an object.");
    return undefined;
  }

  const allowedKeys = new Set([
    "id",
    "severity",
    "message",
    "recommendation",
    "relatedCaseIds",
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [...path, key], `Unexpected property '${key}'.`);
    }
  }

  const id = parseNonEmptyStringField({
    input,
    key: "id",
    required: true,
    path: [...path, "id"],
    issues,
  });
  const severityRaw = parseNonEmptyStringField({
    input,
    key: "severity",
    required: true,
    path: [...path, "severity"],
    issues,
  });
  const message = parseNonEmptyStringField({
    input,
    key: "message",
    required: true,
    path: [...path, "message"],
    issues,
  });
  const recommendation = parseNonEmptyStringField({
    input,
    key: "recommendation",
    required: true,
    path: [...path, "recommendation"],
    issues,
  });
  const relatedCaseIds = parseOptionalStringArrayField({
    input,
    key: "relatedCaseIds",
    path: [...path, "relatedCaseIds"],
    issues,
  });

  const severity =
    severityRaw === undefined
      ? undefined
      : severityRaw.toLowerCase() === "low" ||
          severityRaw.toLowerCase() === "medium" ||
          severityRaw.toLowerCase() === "high"
        ? (severityRaw.toLowerCase() as WorkspaceTestSpaceCoverageFinding["severity"])
        : (() => {
            pushIssue(
              issues,
              [...path, "severity"],
              "severity must be one of: low, medium, high.",
            );
            return undefined;
          })();

  if (
    id === undefined ||
    severity === undefined ||
    message === undefined ||
    recommendation === undefined
  ) {
    return undefined;
  }

  const data: WorkspaceTestSpaceCoverageFinding = {
    id,
    severity,
    message,
    recommendation,
    relatedCaseIds: [],
  };
  if (relatedCaseIds !== undefined) {
    data.relatedCaseIds = relatedCaseIds;
  }
  return data;
}

function parseTestSpaceLlmOutput(
  input: unknown,
): ValidationResult<{
  testCases: WorkspaceTestSpaceCase[];
  coverageFindings: WorkspaceTestSpaceCoverageFinding[];
}> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(input)) {
    pushIssue(issues, [], "Expected an object body.");
    return { success: false, error: { issues } };
  }

  const allowedKeys = new Set(["testCases", "coverageFindings"]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) {
      pushIssue(issues, [key], `Unexpected property '${key}'.`);
    }
  }

  const testCasesRaw = input.testCases;
  if (!Array.isArray(testCasesRaw) || testCasesRaw.length === 0) {
    pushIssue(issues, ["testCases"], "testCases must be a non-empty array.");
  }
  const testCases: WorkspaceTestSpaceCase[] = [];
  if (Array.isArray(testCasesRaw)) {
    for (let index = 0; index < testCasesRaw.length; index += 1) {
      const parsedCase = parseTestSpaceCase(
        testCasesRaw[index],
        ["testCases", index],
        issues,
      );
      if (parsedCase !== undefined) {
        testCases.push(parsedCase);
      }
    }
  }

  const coverageFindingsRaw = input.coverageFindings;
  if (coverageFindingsRaw !== undefined && !Array.isArray(coverageFindingsRaw)) {
    pushIssue(
      issues,
      ["coverageFindings"],
      "coverageFindings must be an array when provided.",
    );
  }
  const coverageFindings: WorkspaceTestSpaceCoverageFinding[] = [];
  if (Array.isArray(coverageFindingsRaw)) {
    for (let index = 0; index < coverageFindingsRaw.length; index += 1) {
      const parsedFinding = parseTestSpaceCoverageFinding(
        coverageFindingsRaw[index],
        ["coverageFindings", index],
        issues,
      );
      if (parsedFinding !== undefined) {
        coverageFindings.push(parsedFinding);
      }
    }
  }

  if (issues.length > 0 || testCases.length === 0) {
    return { success: false, error: { issues } };
  }

  return {
    success: true,
    data: {
      testCases,
      coverageFindings,
    },
  };
}

export const TestSpaceRunRequestSchema: RuntimeSchema<WorkspaceTestSpaceRunRequest> =
  {
    safeParse: parseTestSpaceRunRequest,
  };

export const TestSpaceLlmOutputSchema: RuntimeSchema<{
  testCases: WorkspaceTestSpaceCase[];
  coverageFindings: WorkspaceTestSpaceCoverageFinding[];
}> = {
  safeParse: parseTestSpaceLlmOutput,
};

export function formatTestSpaceValidationError(
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
