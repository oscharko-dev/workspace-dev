type PathSegment = string | number;

const MAX_VALIDATION_ISSUES = 128;

export interface FigmaPayloadValidationIssue {
  path: PathSegment[];
  message: string;
}

export interface FigmaPayloadValidationError {
  issues: FigmaPayloadValidationIssue[];
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

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};

const pushIssue = ({
  issues,
  path,
  message
}: {
  issues: FigmaPayloadValidationIssue[];
  path: PathSegment[];
  message: string;
}): void => {
  if (issues.length >= MAX_VALIDATION_ISSUES) {
    return;
  }
  issues.push({ path: [...path], message });
};

const validateAbsoluteBoundingBox = ({
  value,
  path,
  issues
}: {
  value: unknown;
  path: PathSegment[];
  issues: FigmaPayloadValidationIssue[];
}): void => {
  if (!isRecord(value)) {
    pushIssue({
      issues,
      path,
      message: "absoluteBoundingBox must be an object."
    });
    return;
  }

  if (!isFiniteNumber(value.x)) {
    pushIssue({ issues, path: [...path, "x"], message: "x must be a finite number." });
  }
  if (!isFiniteNumber(value.y)) {
    pushIssue({ issues, path: [...path, "y"], message: "y must be a finite number." });
  }
  if (!isFiniteNumber(value.width)) {
    pushIssue({ issues, path: [...path, "width"], message: "width must be a finite number." });
  }
  if (!isFiniteNumber(value.height)) {
    pushIssue({ issues, path: [...path, "height"], message: "height must be a finite number." });
  }
};

const validateNode = ({
  value,
  path,
  issues,
  requireChildren,
  requireDocumentType,
  visited
}: {
  value: unknown;
  path: PathSegment[];
  issues: FigmaPayloadValidationIssue[];
  requireChildren: boolean;
  requireDocumentType: boolean;
  visited: Set<unknown>;
}): void => {
  if (!isRecord(value)) {
    pushIssue({
      issues,
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
      issues,
      path: [...path, "id"],
      message: "id must be a non-empty string."
    });
  }

  if (typeof value.type !== "string" || value.type.trim().length === 0) {
    pushIssue({
      issues,
      path: [...path, "type"],
      message: "type must be a non-empty string."
    });
  } else if (requireDocumentType && value.type !== "DOCUMENT") {
    pushIssue({
      issues,
      path: [...path, "type"],
      message: 'type must be "DOCUMENT" for the root document node.'
    });
  }

  if (value.absoluteBoundingBox !== undefined) {
    validateAbsoluteBoundingBox({
      value: value.absoluteBoundingBox,
      path: [...path, "absoluteBoundingBox"],
      issues
    });
  }

  const hasChildrenKey = Object.prototype.hasOwnProperty.call(value, "children");
  if (!requireChildren && !hasChildrenKey) {
    return;
  }

  if (!Array.isArray(value.children)) {
    pushIssue({
      issues,
      path: [...path, "children"],
      message: "children must be an array."
    });
    return;
  }

  value.children.forEach((child, index) => {
    validateNode({
      value: child,
      path: [...path, "children", index],
      issues,
      requireChildren: false,
      requireDocumentType: false,
      visited
    });
  });
};

export const safeParseFigmaPayload = ({ input }: { input: unknown }): ValidationResult<ValidatedFigmaPayload> => {
  const issues: FigmaPayloadValidationIssue[] = [];
  if (!isRecord(input)) {
    pushIssue({
      issues,
      path: [],
      message: "Payload root must be an object."
    });
    return { success: false, error: { issues } };
  }

  if (!isRecord(input.document)) {
    pushIssue({
      issues,
      path: ["document"],
      message: "document must be an object."
    });
    return { success: false, error: { issues } };
  }

  validateNode({
    value: input.document,
    path: ["document"],
    issues,
    requireChildren: true,
    requireDocumentType: true,
    visited: new Set<unknown>()
  });

  if (issues.length > 0) {
    return { success: false, error: { issues } };
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
  const overflow = error.issues.length - 1;
  if (overflow <= 0) {
    return `${firstPath}: ${firstIssue.message}`;
  }
  const plural = overflow === 1 ? "issue" : "issues";
  return `${firstPath}: ${firstIssue.message} (+${overflow} more ${plural})`;
};
