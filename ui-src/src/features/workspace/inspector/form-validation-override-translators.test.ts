/**
 * Unit tests for form validation override translators.
 *
 * Covers translation of `required`, `validationType`, and `validationMessage`
 * fields, as well as field support derivation and extraction.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/453
 */
import { describe, expect, it } from "vitest";
import {
  FORM_VALIDATION_OVERRIDE_FIELDS,
  SUPPORTED_VALIDATION_TYPES,
  deriveFormValidationOverrideFieldSupport,
  extractSupportedFormValidationOverrideFields,
  translateFormValidationOverrideInput
} from "./form-validation-override-translators";

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — required
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — required", () => {
  it("accepts boolean true", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: true });
    expect(result).toEqual({ ok: true, field: "required", value: true });
  });

  it("accepts boolean false", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: false });
    expect(result).toEqual({ ok: true, field: "required", value: false });
  });

  it("accepts string 'true'", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: "true" });
    expect(result).toEqual({ ok: true, field: "required", value: true });
  });

  it("accepts string 'false'", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: "false" });
    expect(result).toEqual({ ok: true, field: "required", value: false });
  });

  it("rejects non-boolean values", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: "yes" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("boolean");
    }
  });

  it("rejects numeric values", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects null", () => {
    const result = translateFormValidationOverrideInput({ field: "required", rawValue: null });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationType
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationType", () => {
  it("accepts all supported validation types", () => {
    for (const vType of SUPPORTED_VALIDATION_TYPES) {
      const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: vType });
      expect(result).toEqual({ ok: true, field: "validationType", value: vType });
    }
  });

  it("rejects unsupported validation type strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: "zip_code" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("must be one of");
    }
  });

  it("rejects empty string", () => {
    const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: "" });
    expect(result.ok).toBe(false);
  });

  it("rejects numeric values", () => {
    const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: 42 });
    expect(result.ok).toBe(false);
  });

  it("rejects null", () => {
    const result = translateFormValidationOverrideInput({ field: "validationType", rawValue: null });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationMessage
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationMessage", () => {
  it("accepts non-empty strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: "Please enter a valid email." });
    expect(result).toEqual({ ok: true, field: "validationMessage", value: "Please enter a valid email." });
  });

  it("trims whitespace", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: "  Required field.  " });
    expect(result).toEqual({ ok: true, field: "validationMessage", value: "Required field." });
  });

  it("rejects empty strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("non-empty string");
    }
  });

  it("rejects whitespace-only strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects non-string values", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: 123 });
    expect(result.ok).toBe(false);
  });

  it("rejects null", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMessage", rawValue: null });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveFormValidationOverrideFieldSupport
// ---------------------------------------------------------------------------

describe("deriveFormValidationOverrideFieldSupport", () => {
  it("returns all fields supported for a node with required, validationType, and validationMessage", () => {
    const nodeData = {
      required: true,
      validationType: "email",
      validationMessage: "Invalid email."
    };

    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    expect(support).toHaveLength(3);
    expect(support.every((entry) => entry.supported)).toBe(true);
  });

  it("returns required as supported when present", () => {
    const nodeData = { required: false };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    const requiredEntry = support.find((entry) => entry.field === "required");

    expect(requiredEntry?.supported).toBe(true);
  });

  it("returns required as unsupported when not present", () => {
    const nodeData = { fillColor: "#ff0000" };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    const requiredEntry = support.find((entry) => entry.field === "required");

    expect(requiredEntry?.supported).toBe(false);
    expect(requiredEntry?.reason).toContain("not present");
  });

  it("supports validationMessage when only validationType is present", () => {
    const nodeData = { validationType: "email" };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    const messageEntry = support.find((entry) => entry.field === "validationMessage");

    expect(messageEntry?.supported).toBe(true);
  });

  it("marks validationMessage as unsupported when neither validationType nor validationMessage are present", () => {
    const nodeData = { required: true };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    const messageEntry = support.find((entry) => entry.field === "validationMessage");

    expect(messageEntry?.supported).toBe(false);
    expect(messageEntry?.reason).toContain("validationType");
  });

  it("marks validationType as unsupported for unknown type values", () => {
    const nodeData = { validationType: "unknown_type" };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    const typeEntry = support.find((entry) => entry.field === "validationType");

    expect(typeEntry?.supported).toBe(false);
    expect(typeEntry?.reason).toContain("not a supported validation type");
  });

  it("returns all fields as unsupported for an empty node", () => {
    const nodeData = {};
    const support = deriveFormValidationOverrideFieldSupport(nodeData);

    expect(support.every((entry) => !entry.supported)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractSupportedFormValidationOverrideFields
// ---------------------------------------------------------------------------

describe("extractSupportedFormValidationOverrideFields", () => {
  it("extracts supported field names", () => {
    const nodeData = { required: true, validationType: "email", validationMessage: "Bad email." };
    const fields = extractSupportedFormValidationOverrideFields(nodeData);

    expect(fields).toEqual(["required", "validationType", "validationMessage"]);
  });

  it("returns empty for nodes with no validation fields", () => {
    const nodeData = { fillColor: "#000000", fontSize: 14 };
    const fields = extractSupportedFormValidationOverrideFields(nodeData);

    expect(fields).toEqual([]);
  });

  it("returns only required when other fields are absent", () => {
    const nodeData = { required: false };
    const fields = extractSupportedFormValidationOverrideFields(nodeData);

    expect(fields).toEqual(["required"]);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("constants", () => {
  it("exports exactly 3 form validation override fields", () => {
    expect(FORM_VALIDATION_OVERRIDE_FIELDS).toHaveLength(3);
    expect([...FORM_VALIDATION_OVERRIDE_FIELDS]).toEqual(["required", "validationType", "validationMessage"]);
  });

  it("exports all 10 supported validation types", () => {
    expect(SUPPORTED_VALIDATION_TYPES).toHaveLength(10);
    expect([...SUPPORTED_VALIDATION_TYPES]).toContain("email");
    expect([...SUPPORTED_VALIDATION_TYPES]).toContain("password");
    expect([...SUPPORTED_VALIDATION_TYPES]).toContain("iban");
    expect([...SUPPORTED_VALIDATION_TYPES]).toContain("plz");
    expect([...SUPPORTED_VALIDATION_TYPES]).toContain("credit_card");
  });
});
