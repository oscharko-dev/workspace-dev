export const SCALAR_OVERRIDE_FIELDS = [
  "fillColor",
  "opacity",
  "cornerRadius",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "padding",
  "gap"
] as const;

export type ScalarOverrideField = (typeof SCALAR_OVERRIDE_FIELDS)[number];

export interface ScalarPaddingValue {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ScalarOverrideValueByField {
  fillColor: string;
  opacity: number;
  cornerRadius: number;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  padding: ScalarPaddingValue;
  gap: number;
}

export type ScalarOverrideValue = ScalarOverrideValueByField[ScalarOverrideField];

export interface ScalarOverrideTranslationSuccess<TField extends ScalarOverrideField> {
  ok: true;
  field: TField;
  value: ScalarOverrideValueByField[TField];
}

export interface ScalarOverrideTranslationFailure {
  ok: false;
  field: ScalarOverrideField;
  error: string;
}

export type ScalarOverrideTranslationResult<TField extends ScalarOverrideField = ScalarOverrideField> =
  | ScalarOverrideTranslationSuccess<TField>
  | ScalarOverrideTranslationFailure;

export interface ScalarOverrideFieldSupport {
  field: ScalarOverrideField;
  supported: boolean;
  reason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFiniteNumber(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

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

export function isScalarPaddingValue(value: unknown): value is ScalarPaddingValue {
  if (!isRecord(value)) {
    return false;
  }

  return ["top", "right", "bottom", "left"].every((side) => {
    const candidate = value[side];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0;
  });
}

function parsePadding(raw: unknown): ScalarPaddingValue | null {
  if (!isRecord(raw)) {
    return null;
  }

  const top = parseFiniteNumber(raw.top);
  const right = parseFiniteNumber(raw.right);
  const bottom = parseFiniteNumber(raw.bottom);
  const left = parseFiniteNumber(raw.left);

  if (top === null || right === null || bottom === null || left === null) {
    return null;
  }

  if (top < 0 || right < 0 || bottom < 0 || left < 0) {
    return null;
  }

  return { top, right, bottom, left };
}

export function translateScalarOverrideInput<TField extends ScalarOverrideField>({
  field,
  rawValue
}: {
  field: TField;
  rawValue: unknown;
}): ScalarOverrideTranslationResult<TField> {
  if (field === "fillColor") {
    const normalized = normalizeHexColor(rawValue);
    if (!normalized) {
      return {
        ok: false,
        field,
        error: "fillColor must be a hex color like #RRGGBB or #RRGGBBAA."
      };
    }
    return {
      ok: true,
      field,
      value: normalized as ScalarOverrideValueByField[TField]
    };
  }

  if (field === "opacity") {
    const parsed = parseFiniteNumber(rawValue);
    if (parsed === null || parsed < 0 || parsed > 1) {
      return {
        ok: false,
        field,
        error: "opacity must be a finite number between 0 and 1."
      };
    }
    return {
      ok: true,
      field,
      value: parsed as ScalarOverrideValueByField[TField]
    };
  }

  if (field === "cornerRadius" || field === "fontSize" || field === "gap") {
    const parsed = parseFiniteNumber(rawValue);
    if (parsed === null || parsed < 0) {
      return {
        ok: false,
        field,
        error: `${field} must be a non-negative number.`
      };
    }
    return {
      ok: true,
      field,
      value: parsed as ScalarOverrideValueByField[TField]
    };
  }

  if (field === "fontWeight") {
    const parsed = parseFiniteNumber(rawValue);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 100 || parsed > 900 || parsed % 100 !== 0) {
      return {
        ok: false,
        field,
        error: "fontWeight must be an integer between 100 and 900 in 100-step increments."
      };
    }
    return {
      ok: true,
      field,
      value: parsed as ScalarOverrideValueByField[TField]
    };
  }

  if (field === "fontFamily") {
    if (typeof rawValue !== "string") {
      return {
        ok: false,
        field,
        error: "fontFamily must be a non-empty string."
      };
    }
    const normalized = rawValue.trim();
    if (normalized.length === 0) {
      return {
        ok: false,
        field,
        error: "fontFamily must be a non-empty string."
      };
    }
    return {
      ok: true,
      field,
      value: normalized as ScalarOverrideValueByField[TField]
    };
  }

  const parsedPadding = parsePadding(rawValue);
  if (!parsedPadding) {
    return {
      ok: false,
      field,
      error: "padding must include non-negative top/right/bottom/left values."
    };
  }

  return {
    ok: true,
    field,
    value: parsedPadding as ScalarOverrideValueByField[TField]
  };
}

function hasNonNullField(nodeData: Readonly<Record<string, unknown>>, field: ScalarOverrideField): boolean {
  return field in nodeData && nodeData[field] !== undefined && nodeData[field] !== null;
}

export function deriveScalarOverrideFieldSupport(
  nodeData: Readonly<Record<string, unknown>>
): ScalarOverrideFieldSupport[] {
  return SCALAR_OVERRIDE_FIELDS.map((field): ScalarOverrideFieldSupport => {
    if (!hasNonNullField(nodeData, field)) {
      return {
        field,
        supported: false,
        reason: `${field} is not present on the selected node.`
      };
    }

    if (field === "padding") {
      if (!parsePadding(nodeData.padding)) {
        return {
          field,
          supported: false,
          reason: "padding is present but has an unsupported shape."
        };
      }
    }

    return {
      field,
      supported: true,
      reason: null
    };
  });
}

export function extractSupportedScalarOverrideFields(
  nodeData: Readonly<Record<string, unknown>>
): ScalarOverrideField[] {
  return deriveScalarOverrideFieldSupport(nodeData)
    .filter((entry) => entry.supported)
    .map((entry) => entry.field);
}
