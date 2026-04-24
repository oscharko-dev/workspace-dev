import { createHash } from "node:crypto";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Serialize a JSON value with sorted object keys so that logically equal
 * inputs always produce the same byte sequence. Used by the content-hash
 * and by deterministic output serialization.
 */
export const canonicalJson = (value: unknown): string => {
  return JSON.stringify(sortValue(value as JsonValue));
};

/** sha256 hex digest of a canonical JSON serialization of `value`. */
export const sha256Hex = (value: unknown): string => {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
};

const sortValue = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortValue(value[key] as JsonValue);
    }
    return sorted;
  }
  return value;
};
