/**
 * Form validation override translators for Inspector per-field editing.
 *
 * Supports the three validation primitives consumed by the form-generation
 * pipeline: `required`, `validationType`, and `validationMessage`.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/453
 */

// ---------------------------------------------------------------------------
// Supported form validation override fields
// ---------------------------------------------------------------------------

export const FORM_VALIDATION_OVERRIDE_FIELDS = [
  "required",
  "validationType",
  "validationMessage"
] as const;

export type FormValidationOverrideField = (typeof FORM_VALIDATION_OVERRIDE_FIELDS)[number];

// ---------------------------------------------------------------------------
// Validation types matching generator-forms.ts ValidationFieldType
// ---------------------------------------------------------------------------

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

export type SupportedValidationType = (typeof SUPPORTED_VALIDATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Value types per field
// ---------------------------------------------------------------------------

export interface FormValidationOverrideValueByField {
  required: boolean;
  validationType: SupportedValidationType;
  validationMessage: string;
}

export type FormValidationOverrideValue = FormValidationOverrideValueByField[FormValidationOverrideField];

// ---------------------------------------------------------------------------
// Translation result types
// ---------------------------------------------------------------------------

export interface FormValidationOverrideTranslationSuccess<TField extends FormValidationOverrideField> {
  ok: true;
  field: TField;
  value: FormValidationOverrideValueByField[TField];
}

export interface FormValidationOverrideTranslationFailure {
  ok: false;
  field: FormValidationOverrideField;
  error: string;
}

export type FormValidationOverrideTranslationResult<TField extends FormValidationOverrideField = FormValidationOverrideField> =
  | FormValidationOverrideTranslationSuccess<TField>
  | FormValidationOverrideTranslationFailure;

// ---------------------------------------------------------------------------
// Field support
// ---------------------------------------------------------------------------

export interface FormValidationOverrideFieldSupport {
  field: FormValidationOverrideField;
  supported: boolean;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function isValidationType(value: unknown): value is SupportedValidationType {
  return typeof value === "string" && (SUPPORTED_VALIDATION_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Translate raw input to a typed override value
// ---------------------------------------------------------------------------

export function translateFormValidationOverrideInput<TField extends FormValidationOverrideField>({
  field,
  rawValue
}: {
  field: TField;
  rawValue: unknown;
}): FormValidationOverrideTranslationResult<TField> {
  if (field === "required") {
    if (typeof rawValue === "boolean") {
      return {
        ok: true,
        field,
        value: rawValue as FormValidationOverrideValueByField[TField]
      };
    }
    if (rawValue === "true" || rawValue === "false") {
      return {
        ok: true,
        field,
        value: (rawValue === "true") as FormValidationOverrideValueByField[TField]
      };
    }
    return {
      ok: false,
      field,
      error: "required must be a boolean (true or false)."
    };
  }

  if (field === "validationType") {
    if (isValidationType(rawValue)) {
      return {
        ok: true,
        field,
        value: rawValue as FormValidationOverrideValueByField[TField]
      };
    }
    return {
      ok: false,
      field,
      error: `validationType must be one of: ${SUPPORTED_VALIDATION_TYPES.join(", ")}.`
    };
  }

  // validationMessage
  if (typeof rawValue !== "string") {
    return {
      ok: false,
      field,
      error: "validationMessage must be a non-empty string."
    };
  }
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      field,
      error: "validationMessage must be a non-empty string."
    };
  }
  return {
    ok: true,
    field,
    value: trimmed as FormValidationOverrideValueByField[TField]
  };
}

// ---------------------------------------------------------------------------
// Derive field support from node data
// ---------------------------------------------------------------------------

function hasNonNullField(nodeData: Readonly<Record<string, unknown>>, field: string): boolean {
  return field in nodeData && nodeData[field] !== undefined && nodeData[field] !== null;
}

/**
 * Determines which form validation override fields the node supports.
 * A field is supported when the node already carries the corresponding
 * property (i.e. the generator inferred it from the design).
 */
export function deriveFormValidationOverrideFieldSupport(
  nodeData: Readonly<Record<string, unknown>>
): FormValidationOverrideFieldSupport[] {
  return FORM_VALIDATION_OVERRIDE_FIELDS.map((field): FormValidationOverrideFieldSupport => {
    // validationMessage is supported whenever validationType is present,
    // even when no explicit message has been set yet.
    if (field === "validationMessage") {
      if (hasNonNullField(nodeData, "validationType") || hasNonNullField(nodeData, "validationMessage")) {
        return { field, supported: true, reason: null };
      }
      return {
        field,
        supported: false,
        reason: "validationMessage requires validationType to be present on the node."
      };
    }

    if (!hasNonNullField(nodeData, field)) {
      return {
        field,
        supported: false,
        reason: `${field} is not present on the selected node.`
      };
    }

    if (field === "validationType") {
      const value = nodeData[field];
      if (typeof value === "string" && !isValidationType(value)) {
        return {
          field,
          supported: false,
          reason: `validationType "${String(value)}" is not a supported validation type.`
        };
      }
    }

    return { field, supported: true, reason: null };
  });
}

/**
 * Extracts the form validation override field names supported by this node.
 */
export function extractSupportedFormValidationOverrideFields(
  nodeData: Readonly<Record<string, unknown>>
): FormValidationOverrideField[] {
  return deriveFormValidationOverrideFieldSupport(nodeData)
    .filter((entry) => entry.supported)
    .map((entry) => entry.field);
}
