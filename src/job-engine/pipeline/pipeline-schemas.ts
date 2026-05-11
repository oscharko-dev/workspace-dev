import type { DesignIR } from "../../parity/types-ir.js";
import type { FigmaFileResponse } from "../types.js";

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export class SchemaValidationError extends Error {
  readonly schema: string;
  readonly filePath: string | undefined;

  constructor({ schema, filePath, message }: {
    schema: string;
    filePath?: string;
    message: string;
  }) {
    super(message);
    this.name = "SchemaValidationError";
    this.schema = schema;
    this.filePath = filePath;
  }
}

export function isDesignIRShape(input: unknown): input is DesignIR {
  if (!isRecord(input)) {
    return false;
  }
  if (typeof input.sourceName !== "string") {
    return false;
  }
  if (!Array.isArray(input.screens)) {
    return false;
  }
  if (!isRecord(input.tokens)) {
    return false;
  }
  return true;
}

export function isFigmaFileResponseShape(input: unknown): input is FigmaFileResponse {
  if (!isRecord(input)) {
    return false;
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    return false;
  }
  if (input.lastModified !== undefined && typeof input.lastModified !== "string") {
    return false;
  }
  if (input.styles !== undefined && !isRecord(input.styles)) {
    return false;
  }
  if (input.components !== undefined && !isRecord(input.components)) {
    return false;
  }
  if (input.componentSets !== undefined && !isRecord(input.componentSets)) {
    return false;
  }
  return true;
}

export function validatedJsonParse<T>({
  raw,
  guard,
  schema,
  filePath
}: {
  raw: string;
  guard: (value: unknown) => value is T;
  schema: string;
  filePath?: string;
}): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SchemaValidationError({
      schema,
      ...(filePath !== undefined ? { filePath } : {}),
      message: `Failed to parse JSON for schema '${schema}'${filePath ? ` from '${filePath}'` : ""}: input is not valid JSON.`
    });
  }
  if (!guard(parsed)) {
    throw new SchemaValidationError({
      schema,
      ...(filePath !== undefined ? { filePath } : {}),
      message: `Schema validation failed for '${schema}'${filePath ? ` from '${filePath}'` : ""}: parsed value does not match expected structure.`
    });
  }
  return parsed;
}
