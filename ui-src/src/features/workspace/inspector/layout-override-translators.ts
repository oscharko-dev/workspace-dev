/**
 * Layout and dimension override translators for Inspector editing.
 *
 * Supports deterministic node-level overrides for width, height, layout mode,
 * and flex alignment fields that the current generator already emits.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/463
 */

export const LAYOUT_OVERRIDE_FIELDS = [
  "width",
  "height",
  "layoutMode",
  "primaryAxisAlignItems",
  "counterAxisAlignItems"
] as const;

export type LayoutOverrideField = (typeof LAYOUT_OVERRIDE_FIELDS)[number];

export const LAYOUT_MODE_VALUES = [
  "VERTICAL",
  "HORIZONTAL",
  "NONE"
] as const;

export type LayoutModeOverrideValue = (typeof LAYOUT_MODE_VALUES)[number];

export const PRIMARY_AXIS_ALIGN_ITEMS = [
  "MIN",
  "CENTER",
  "MAX",
  "SPACE_BETWEEN"
] as const;

export type PrimaryAxisAlignItemsOverrideValue = (typeof PRIMARY_AXIS_ALIGN_ITEMS)[number];

export const COUNTER_AXIS_ALIGN_ITEMS = [
  "MIN",
  "CENTER",
  "MAX",
  "BASELINE"
] as const;

export type CounterAxisAlignItemsOverrideValue = (typeof COUNTER_AXIS_ALIGN_ITEMS)[number];

export interface LayoutOverrideValueByField {
  width: number;
  height: number;
  layoutMode: LayoutModeOverrideValue;
  primaryAxisAlignItems: PrimaryAxisAlignItemsOverrideValue;
  counterAxisAlignItems: CounterAxisAlignItemsOverrideValue;
}

export type LayoutOverrideValue = LayoutOverrideValueByField[LayoutOverrideField];

export interface LayoutOverrideTranslationSuccess<TField extends LayoutOverrideField> {
  ok: true;
  field: TField;
  value: LayoutOverrideValueByField[TField];
}

export interface LayoutOverrideTranslationFailure {
  ok: false;
  field: LayoutOverrideField;
  error: string;
}

export type LayoutOverrideTranslationResult<TField extends LayoutOverrideField = LayoutOverrideField> =
  | LayoutOverrideTranslationSuccess<TField>
  | LayoutOverrideTranslationFailure;

export interface LayoutOverrideFieldSupport {
  field: LayoutOverrideField;
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

function normalizeEnumValue<TValue extends readonly string[]>(raw: unknown, values: TValue): TValue[number] | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().toUpperCase();
  return (values as readonly string[]).includes(normalized) ? (normalized as TValue[number]) : null;
}

function hasNonNullField(nodeData: Readonly<Record<string, unknown>>, field: LayoutOverrideField): boolean {
  return field in nodeData && nodeData[field] !== undefined && nodeData[field] !== null;
}

function hasChildren(nodeData: Readonly<Record<string, unknown>>): boolean {
  return Array.isArray(nodeData.children) && nodeData.children.length > 0;
}

function isTextNode(nodeData: Readonly<Record<string, unknown>>): boolean {
  return nodeData.type === "text";
}

export function resolveLayoutModeValue(raw: unknown): LayoutModeOverrideValue | null {
  return normalizeEnumValue(raw, LAYOUT_MODE_VALUES);
}

function resolvePrimaryAxisAlignItemsValue(raw: unknown): PrimaryAxisAlignItemsOverrideValue | null {
  return normalizeEnumValue(raw, PRIMARY_AXIS_ALIGN_ITEMS);
}

function resolveCounterAxisAlignItemsValue(raw: unknown): CounterAxisAlignItemsOverrideValue | null {
  return normalizeEnumValue(raw, COUNTER_AXIS_ALIGN_ITEMS);
}

export function translateLayoutOverrideInput<TField extends LayoutOverrideField>({
  field,
  rawValue,
  effectiveLayoutMode
}: {
  field: TField;
  rawValue: unknown;
  effectiveLayoutMode?: LayoutModeOverrideValue;
}): LayoutOverrideTranslationResult<TField> {
  if (field === "width" || field === "height") {
    const parsed = parseFiniteNumber(rawValue);
    if (parsed === null || parsed <= 0) {
      return {
        ok: false,
        field,
        error: `${field} must be a finite positive number.`
      };
    }
    return {
      ok: true,
      field,
      value: parsed as LayoutOverrideValueByField[TField]
    };
  }

  if (field === "layoutMode") {
    const normalized = resolveLayoutModeValue(rawValue);
    if (!normalized) {
      return {
        ok: false,
        field,
        error: `layoutMode must be one of: ${LAYOUT_MODE_VALUES.join(", ")}.`
      };
    }
    return {
      ok: true,
      field,
      value: normalized as LayoutOverrideValueByField[TField]
    };
  }

  if (effectiveLayoutMode === "NONE") {
    return {
      ok: false,
      field,
      error: `${field} requires layoutMode to be HORIZONTAL or VERTICAL.`
    };
  }

  const normalized = field === "primaryAxisAlignItems"
    ? resolvePrimaryAxisAlignItemsValue(rawValue)
    : resolveCounterAxisAlignItemsValue(rawValue);
  if (!normalized) {
    return {
      ok: false,
      field,
      error:
        field === "primaryAxisAlignItems"
          ? `primaryAxisAlignItems must be one of: ${PRIMARY_AXIS_ALIGN_ITEMS.join(", ")}.`
          : `counterAxisAlignItems must be one of: ${COUNTER_AXIS_ALIGN_ITEMS.join(", ")}.`
    };
  }

  return {
    ok: true,
    field,
    value: normalized as LayoutOverrideValueByField[TField]
  };
}

export function deriveLayoutOverrideFieldSupport({
  nodeData,
  effectiveLayoutMode
}: {
  nodeData: Readonly<Record<string, unknown>>;
  effectiveLayoutMode?: LayoutModeOverrideValue;
}): LayoutOverrideFieldSupport[] {
  const resolvedLayoutMode = effectiveLayoutMode ?? resolveLayoutModeValue(nodeData.layoutMode) ?? "NONE";

  return LAYOUT_OVERRIDE_FIELDS.map((field): LayoutOverrideFieldSupport => {
    if (field === "width" || field === "height") {
      if (isTextNode(nodeData)) {
        return {
          field,
          supported: false,
          reason: `${field} is not supported for text nodes because the generator does not emit text dimensions.`
        };
      }
      if (!hasNonNullField(nodeData, field)) {
        return {
          field,
          supported: false,
          reason: `${field} is not present on the selected node.`
        };
      }
      const parsed = parseFiniteNumber(nodeData[field]);
      if (parsed === null || parsed < 0) {
        return {
          field,
          supported: false,
          reason: `${field} is present but has an unsupported value.`
        };
      }
      return {
        field,
        supported: true,
        reason: null
      };
    }

    if (field === "layoutMode") {
      if (!hasChildren(nodeData)) {
        return {
          field,
          supported: false,
          reason: "layoutMode is only supported for nodes with children."
        };
      }
      if (hasNonNullField(nodeData, field) && !resolveLayoutModeValue(nodeData.layoutMode)) {
        return {
          field,
          supported: false,
          reason: `layoutMode "${String(nodeData.layoutMode)}" is not supported.`
        };
      }
      return {
        field,
        supported: true,
        reason: null
      };
    }

    if (!hasChildren(nodeData)) {
      return {
        field,
        supported: false,
        reason: `${field} is only supported for nodes with children.`
      };
    }

    if (resolvedLayoutMode === "NONE") {
      return {
        field,
        supported: false,
        reason: `${field} requires layoutMode to be HORIZONTAL or VERTICAL.`
      };
    }

    if (field === "primaryAxisAlignItems") {
      if (hasNonNullField(nodeData, field) && !resolvePrimaryAxisAlignItemsValue(nodeData.primaryAxisAlignItems)) {
        return {
          field,
          supported: false,
          reason: `primaryAxisAlignItems "${String(nodeData.primaryAxisAlignItems)}" is not supported.`
        };
      }
      return {
        field,
        supported: true,
        reason: null
      };
    }

    if (hasNonNullField(nodeData, field) && !resolveCounterAxisAlignItemsValue(nodeData.counterAxisAlignItems)) {
      return {
        field,
        supported: false,
        reason: `counterAxisAlignItems "${String(nodeData.counterAxisAlignItems)}" is not supported.`
      };
    }

    return {
      field,
      supported: true,
      reason: null
    };
  });
}

export function extractSupportedLayoutOverrideFields(
  nodeData: Readonly<Record<string, unknown>>
): LayoutOverrideField[] {
  return deriveLayoutOverrideFieldSupport({ nodeData })
    .filter((entry) => entry.supported)
    .map((entry) => entry.field);
}

export function isLayoutOverrideValue(field: LayoutOverrideField, value: unknown): value is LayoutOverrideValue {
  if (field === "width" || field === "height") {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  }
  if (field === "layoutMode") {
    return resolveLayoutModeValue(value) !== null;
  }
  if (field === "primaryAxisAlignItems") {
    return resolvePrimaryAxisAlignItemsValue(value) !== null;
  }
  return resolveCounterAxisAlignItemsValue(value) !== null;
}

export function isLayoutOverrideNodeData(value: unknown): value is Readonly<Record<string, unknown>> {
  return isRecord(value);
}
