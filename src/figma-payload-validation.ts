type PathSegment = string | number;

const MAX_VALIDATION_ISSUES = 128;

export interface FigmaPayloadValidationIssue {
  path: PathSegment[];
  message: string;
}

export interface FigmaPayloadValidationError {
  issues: FigmaPayloadValidationIssue[];
  truncated?: boolean;
  maxIssues?: number;
  omittedIssueCount?: number;
}

type FigmaPayloadOpenRecord = Record<string, unknown>;

export type ValidatedFigmaNode = FigmaPayloadOpenRecord & {
  id: string;
  type: string;
  children?: ValidatedFigmaNode[];
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type ValidatedFigmaPayload = FigmaPayloadOpenRecord & {
  name?: string;
  document: ValidatedFigmaNode;
};

type ValidationResult<T> = { success: true; data: T } | { success: false; error: FigmaPayloadValidationError };

type ValidationIssueAccumulator = {
  issues: FigmaPayloadValidationIssue[];
  omittedIssueCount: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const pushIssue = ({
  accumulator,
  path,
  message
}: {
  accumulator: ValidationIssueAccumulator;
  path: PathSegment[];
  message: string;
}): void => {
  if (accumulator.issues.length >= MAX_VALIDATION_ISSUES) {
    accumulator.omittedIssueCount += 1;
    return;
  }
  accumulator.issues.push({ path: [...path], message });
};

const toValidationError = ({
  accumulator
}: {
  accumulator: ValidationIssueAccumulator;
}): FigmaPayloadValidationError => {
  return {
    issues: accumulator.issues,
    truncated: accumulator.omittedIssueCount > 0,
    maxIssues: MAX_VALIDATION_ISSUES,
    omittedIssueCount: accumulator.omittedIssueCount
  };
};

const validateAbsoluteBoundingBox = ({
  value,
  path,
  accumulator
}: {
  value: unknown;
  path: PathSegment[];
  accumulator: ValidationIssueAccumulator;
}): void => {
  if (!isRecord(value)) {
    pushIssue({
      accumulator,
      path,
      message: "absoluteBoundingBox must be an object."
    });
    return;
  }

  if (!isFiniteNumber(value.x)) {
    pushIssue({ accumulator, path: [...path, "x"], message: "x must be a finite number." });
  }
  if (!isFiniteNumber(value.y)) {
    pushIssue({ accumulator, path: [...path, "y"], message: "y must be a finite number." });
  }
  if (!isFiniteNumber(value.width)) {
    pushIssue({ accumulator, path: [...path, "width"], message: "width must be a finite number." });
  }
  if (!isFiniteNumber(value.height)) {
    pushIssue({ accumulator, path: [...path, "height"], message: "height must be a finite number." });
  }
};

const validateNode = ({
  value,
  path,
  accumulator,
  requireChildren,
  requireDocumentType,
  visited
}: {
  value: unknown;
  path: PathSegment[];
  accumulator: ValidationIssueAccumulator;
  requireChildren: boolean;
  requireDocumentType: boolean;
  visited: Set<unknown>;
}): void => {
  if (!isRecord(value)) {
    pushIssue({
      accumulator,
      path,
      message: "Node must be an object."
    });
    return;
  }
  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    pushIssue({
      accumulator,
      path: [...path, "id"],
      message: "id must be a non-empty string."
    });
  }

  if (typeof value.type !== "string" || value.type.trim().length === 0) {
    pushIssue({
      accumulator,
      path: [...path, "type"],
      message: "type must be a non-empty string."
    });
  } else if (requireDocumentType && value.type !== "DOCUMENT") {
    pushIssue({
      accumulator,
      path: [...path, "type"],
      message: 'type must be "DOCUMENT" for the root document node.'
    });
  }

  if (value.absoluteBoundingBox !== undefined) {
    validateAbsoluteBoundingBox({
      value: value.absoluteBoundingBox,
      path: [...path, "absoluteBoundingBox"],
      accumulator
    });
  }

  const hasChildrenKey = Object.prototype.hasOwnProperty.call(value, "children");
  if (!requireChildren && !hasChildrenKey) {
    return;
  }

  if (!Array.isArray(value.children)) {
    pushIssue({
      accumulator,
      path: [...path, "children"],
      message: "children must be an array."
    });
    return;
  }

  value.children.forEach((child, index) => {
    validateNode({
      value: child,
      path: [...path, "children", index],
      accumulator,
      requireChildren: false,
      requireDocumentType: false,
      visited
    });
  });
};

export const safeParseFigmaPayload = ({ input }: { input: unknown }): ValidationResult<ValidatedFigmaPayload> => {
  const accumulator: ValidationIssueAccumulator = {
    issues: [],
    omittedIssueCount: 0
  };
  if (!isRecord(input)) {
    pushIssue({
      accumulator,
      path: [],
      message: "Payload root must be an object."
    });
    return { success: false, error: toValidationError({ accumulator }) };
  }

  if (!isRecord(input.document)) {
    pushIssue({
      accumulator,
      path: ["document"],
      message: "document must be an object."
    });
    return { success: false, error: toValidationError({ accumulator }) };
  }

  validateNode({
    value: input.document,
    path: ["document"],
    accumulator,
    requireChildren: true,
    requireDocumentType: true,
    visited: new Set<unknown>()
  });

  if (accumulator.issues.length > 0) {
    return { success: false, error: toValidationError({ accumulator }) };
  }

  return {
    success: true,
    data: input as ValidatedFigmaPayload
  };
};

export const formatFigmaPayloadPath = ({ path }: { path: PathSegment[] }): string => {
  if (path.length === 0) {
    return "(root)";
  }
  let output = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      output += `[${segment}]`;
      continue;
    }
    output = output.length > 0 ? `${output}.${segment}` : segment;
  }
  return output;
};

export const summarizeFigmaPayloadValidationError = ({ error }: { error: FigmaPayloadValidationError }): string => {
  if (error.issues.length === 0) {
    return "unknown payload validation error";
  }
  const firstIssue = error.issues[0]!;
  const firstPath = formatFigmaPayloadPath({ path: firstIssue.path });
  const collectedOverflow = error.issues.length - 1;
  const omittedIssueCount = error.omittedIssueCount ?? 0;
  if (collectedOverflow <= 0 && omittedIssueCount <= 0) {
    return `${firstPath}: ${firstIssue.message}`;
  }
  const collectedPlural = collectedOverflow === 1 ? "issue" : "issues";
  if (error.truncated && omittedIssueCount > 0) {
    const maxIssues = error.maxIssues ?? MAX_VALIDATION_ISSUES;
    return (
      `${firstPath}: ${firstIssue.message} (+${collectedOverflow} more ${collectedPlural}; ` +
      `${omittedIssueCount} omitted after cap ${maxIssues})`
    );
  }
  return `${firstPath}: ${firstIssue.message} (+${collectedOverflow} more ${collectedPlural})`;
};
