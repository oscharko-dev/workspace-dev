import type { WorkspaceRegenerationOverrideEntry } from "../contracts/index.js";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const SUPPORTED_REGENERATION_OVERRIDE_FIELDS = [
  "fillColor",
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "padding",
  "gap",
  "width",
  "height",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "required",
  "validationType",
  "validationMessage"
] as const;

export type SupportedRegenerationOverrideField = (typeof SUPPORTED_REGENERATION_OVERRIDE_FIELDS)[number];

export const SUPPORTED_LAYOUT_MODES = ["VERTICAL", "HORIZONTAL", "NONE"] as const;
export const SUPPORTED_PRIMARY_AXIS_ALIGN_ITEMS = ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"] as const;
export const SUPPORTED_COUNTER_AXIS_ALIGN_ITEMS = ["MIN", "CENTER", "MAX", "BASELINE"] as const;
export const SUPPORTED_VALIDATION_TYPES = [
  "email",
  "password",
  "tel",
  "number",
  "date",
  "url",
  "search",
  "iban",
  "plz",
  "credit_card"
] as const;

export interface PaddingOverrideValue {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type SupportedRegenerationOverrideValue =
  | string
  | number
  | boolean
  | PaddingOverrideValue;

export interface ValidatedRegenerationOverrideEntry {
  nodeId: string;
  field: SupportedRegenerationOverrideField;
  value: SupportedRegenerationOverrideValue;
}

export interface ValidateRegenerationOverrideEntrySuccess {
  ok: true;
  entry: ValidatedRegenerationOverrideEntry;
}

export interface ValidateRegenerationOverrideEntryFailure {
  ok: false;
  path: "field" | "value";
  message: string;
}

export type ValidateRegenerationOverrideEntryResult =
  | ValidateRegenerationOverrideEntrySuccess
  | ValidateRegenerationOverrideEntryFailure;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function normalizeFiniteNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function normalizeHexColor(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    return null;
  }
  const source = trimmed.slice(1).toLowerCase();
  if (source.length === 3 || source.length === 4) {
    const expanded = source
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded}`;
  }
  return `#${source}`;
}

function normalizeNonEmptyString(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEnumValue<TValue extends readonly string[]>(
  raw: unknown,
  values: TValue,
  mode: "upper" | "lower"
): TValue[number] | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  const normalized = mode === "upper"
    ? trimmed.toUpperCase()
    : trimmed.toLowerCase();
  return (values as readonly string[]).includes(normalized) ? (normalized as TValue[number]) : null;
}

function normalizePaddingValue(raw: unknown): PaddingOverrideValue | null {
  if (!isRecord(raw)) {
    return null;
  }
  const top = normalizeFiniteNumber(raw.top);
  const right = normalizeFiniteNumber(raw.right);
  const bottom = normalizeFiniteNumber(raw.bottom);
  const left = normalizeFiniteNumber(raw.left);
  if (top === null || right === null || bottom === null || left === null) {
    return null;
  }
  if (top < 0 || right < 0 || bottom < 0 || left < 0) {
    return null;
  }
  return { top, right, bottom, left };
}

function isSupportedField(raw: unknown): raw is SupportedRegenerationOverrideField {
  return typeof raw === "string"
    && (SUPPORTED_REGENERATION_OVERRIDE_FIELDS as readonly string[]).includes(raw);
}

export function validateRegenerationOverrideEntry(
  entry: WorkspaceRegenerationOverrideEntry
): ValidateRegenerationOverrideEntryResult {
  if (!isSupportedField(entry.field)) {
    return {
      ok: false,
      path: "field",
      message: `field must be one of: ${SUPPORTED_REGENERATION_OVERRIDE_FIELDS.join(", ")}.`
    };
  }

  const { field } = entry;

  if (field === "fillColor") {
    const normalized = normalizeHexColor(entry.value);
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: "fillColor must be a hex color like #RRGGBB or #RRGGBBAA." };
  }

  if (field === "opacity") {
    const normalized = normalizeFiniteNumber(entry.value);
    return normalized !== null && normalized >= 0 && normalized <= 1
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: "opacity must be a finite number between 0 and 1." };
  }

  if (field === "cornerRadius" || field === "fontSize" || field === "gap") {
    const normalized = normalizeFiniteNumber(entry.value);
    return normalized !== null && normalized >= 0
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `${field} must be a non-negative number.` };
  }

  if (field === "width" || field === "height") {
    const normalized = normalizeFiniteNumber(entry.value);
    return normalized !== null && normalized > 0
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `${field} must be a finite positive number.` };
  }

  if (field === "fontWeight") {
    const normalized = normalizeFiniteNumber(entry.value);
    return normalized !== null
      && Number.isInteger(normalized)
      && normalized >= 100
      && normalized <= 900
      && normalized % 100 === 0
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: "fontWeight must be an integer between 100 and 900 in 100-step increments." };
  }

  if (field === "fontFamily" || field === "validationMessage") {
    const normalized = normalizeNonEmptyString(entry.value);
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `${field} must be a non-empty string.` };
  }

  if (field === "padding") {
    const normalized = normalizePaddingValue(entry.value);
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: "padding must be an object with non-negative numeric top, right, bottom, and left values." };
  }

  if (field === "required") {
    return typeof entry.value === "boolean"
      ? { ok: true, entry: { ...entry, field, value: entry.value } }
      : { ok: false, path: "value", message: "required must be a boolean." };
  }

  if (field === "layoutMode") {
    const normalized = normalizeEnumValue(entry.value, SUPPORTED_LAYOUT_MODES, "upper");
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `layoutMode must be one of: ${SUPPORTED_LAYOUT_MODES.join(", ")}.` };
  }

  if (field === "primaryAxisAlignItems") {
    const normalized = normalizeEnumValue(entry.value, SUPPORTED_PRIMARY_AXIS_ALIGN_ITEMS, "upper");
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `primaryAxisAlignItems must be one of: ${SUPPORTED_PRIMARY_AXIS_ALIGN_ITEMS.join(", ")}.` };
  }

  if (field === "counterAxisAlignItems") {
    const normalized = normalizeEnumValue(entry.value, SUPPORTED_COUNTER_AXIS_ALIGN_ITEMS, "upper");
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `counterAxisAlignItems must be one of: ${SUPPORTED_COUNTER_AXIS_ALIGN_ITEMS.join(", ")}.` };
  }

  if (field === "validationType") {
    const normalized = normalizeEnumValue(entry.value, SUPPORTED_VALIDATION_TYPES, "lower");
    return normalized
      ? { ok: true, entry: { ...entry, field, value: normalized } }
      : { ok: false, path: "value", message: `validationType must be one of: ${SUPPORTED_VALIDATION_TYPES.join(", ")}.` };
  }

  return {
    ok: false,
    path: "field",
    message: `field must be one of: ${SUPPORTED_REGENERATION_OVERRIDE_FIELDS.join(", ")}.`
  };
}
