/**
 * Unit tests for advanced form validation override translators (issue #464).
 *
 * Covers translation of `validationMin`, `validationMax`, `validationMinLength`,
 * `validationMaxLength`, and `validationPattern` fields, as well as field
 * support derivation for nodes with validationType present.
 */
import { describe, expect, it } from "vitest";
import {
  FORM_VALIDATION_OVERRIDE_FIELDS,
  deriveFormValidationOverrideFieldSupport,
  extractSupportedFormValidationOverrideFields,
  translateFormValidationOverrideInput
} from "./form-validation-override-translators";

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationMin
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationMin", () => {
  it("accepts a finite number", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: 5 });
    expect(result).toEqual({ ok: true, field: "validationMin", value: 5 });
  });

  it("accepts zero", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: 0 });
    expect(result).toEqual({ ok: true, field: "validationMin", value: 0 });
  });

  it("accepts negative numbers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: -10 });
    expect(result).toEqual({ ok: true, field: "validationMin", value: -10 });
  });

  it("accepts numeric strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: "42" });
    expect(result).toEqual({ ok: true, field: "validationMin", value: 42 });
  });

  it("rejects non-numeric strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: "abc" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("finite number");
    }
  });

  it("rejects Infinity", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: Infinity });
    expect(result.ok).toBe(false);
  });

  it("rejects null", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: null });
    expect(result.ok).toBe(false);
  });

  it("rejects boolean", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMin", rawValue: true });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationMax
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationMax", () => {
  it("accepts a finite number", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMax", rawValue: 100 });
    expect(result).toEqual({ ok: true, field: "validationMax", value: 100 });
  });

  it("accepts numeric strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMax", rawValue: "99.5" });
    expect(result).toEqual({ ok: true, field: "validationMax", value: 99.5 });
  });

  it("rejects NaN", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMax", rawValue: NaN });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationMinLength
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationMinLength", () => {
  it("accepts non-negative integers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: 8 });
    expect(result).toEqual({ ok: true, field: "validationMinLength", value: 8 });
  });

  it("accepts zero", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: 0 });
    expect(result).toEqual({ ok: true, field: "validationMinLength", value: 0 });
  });

  it("rejects negative integers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("non-negative integer");
    }
  });

  it("rejects floating point numbers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: 3.5 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: "abc" });
    expect(result.ok).toBe(false);
  });

  it("accepts integer numeric strings", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMinLength", rawValue: "10" });
    expect(result).toEqual({ ok: true, field: "validationMinLength", value: 10 });
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationMaxLength
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationMaxLength", () => {
  it("accepts non-negative integers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMaxLength", rawValue: 255 });
    expect(result).toEqual({ ok: true, field: "validationMaxLength", value: 255 });
  });

  it("rejects negative integers", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMaxLength", rawValue: -5 });
    expect(result.ok).toBe(false);
  });

  it("rejects floating point", () => {
    const result = translateFormValidationOverrideInput({ field: "validationMaxLength", rawValue: 2.7 });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// translateFormValidationOverrideInput — validationPattern
// ---------------------------------------------------------------------------

describe("translateFormValidationOverrideInput — validationPattern", () => {
  it("accepts a valid regex string", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "^[A-Z]{2}\\d{4}$" });
    expect(result).toEqual({ ok: true, field: "validationPattern", value: "^[A-Z]{2}\\d{4}$" });
  });

  it("accepts simple regex", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "\\d+" });
    expect(result).toEqual({ ok: true, field: "validationPattern", value: "\\d+" });
  });

  it("trims whitespace", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "  ^abc$  " });
    expect(result).toEqual({ ok: true, field: "validationPattern", value: "^abc$" });
  });

  it("rejects empty string", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("non-empty string");
    }
  });

  it("rejects whitespace-only string", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "   " });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid regex", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: "[invalid" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("valid regular expression");
    }
  });

  it("rejects non-string values", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: 42 });
    expect(result.ok).toBe(false);
  });

  it("rejects null", () => {
    const result = translateFormValidationOverrideInput({ field: "validationPattern", rawValue: null });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveFormValidationOverrideFieldSupport — advanced fields
// ---------------------------------------------------------------------------

describe("deriveFormValidationOverrideFieldSupport — advanced fields", () => {
  it("supports advanced validation fields when validationType is present", () => {
    const nodeData = { validationType: "number" };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);

    const minEntry = support.find((entry) => entry.field === "validationMin");
    const maxEntry = support.find((entry) => entry.field === "validationMax");
    const minLengthEntry = support.find((entry) => entry.field === "validationMinLength");
    const maxLengthEntry = support.find((entry) => entry.field === "validationMaxLength");
    const patternEntry = support.find((entry) => entry.field === "validationPattern");

    expect(minEntry?.supported).toBe(true);
    expect(maxEntry?.supported).toBe(true);
    expect(minLengthEntry?.supported).toBe(true);
    expect(maxLengthEntry?.supported).toBe(true);
    expect(patternEntry?.supported).toBe(true);
  });

  it("marks advanced fields as unsupported when no validationType is present", () => {
    const nodeData = { required: true };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);

    const minEntry = support.find((entry) => entry.field === "validationMin");
    expect(minEntry?.supported).toBe(false);
    expect(minEntry?.reason).toContain("validationType");
  });

  it("supports advanced field if that specific field is already present on node", () => {
    const nodeData = { validationMin: 0 };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);

    const minEntry = support.find((entry) => entry.field === "validationMin");
    expect(minEntry?.supported).toBe(true);
  });

  it("returns all 8 validation override fields", () => {
    const nodeData = {
      required: true,
      validationType: "email",
      validationMessage: "Bad email."
    };
    const support = deriveFormValidationOverrideFieldSupport(nodeData);
    expect(support).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// extractSupportedFormValidationOverrideFields — with advanced fields
// ---------------------------------------------------------------------------

describe("extractSupportedFormValidationOverrideFields — with advanced fields", () => {
  it("includes advanced fields when validationType is present", () => {
    const nodeData = { required: true, validationType: "number", validationMessage: "Invalid." };
    const fields = extractSupportedFormValidationOverrideFields(nodeData);

    expect(fields).toContain("validationMin");
    expect(fields).toContain("validationMax");
    expect(fields).toContain("validationMinLength");
    expect(fields).toContain("validationMaxLength");
    expect(fields).toContain("validationPattern");
  });

  it("excludes advanced fields when only required is present", () => {
    const nodeData = { required: false };
    const fields = extractSupportedFormValidationOverrideFields(nodeData);

    expect(fields).toContain("required");
    expect(fields).not.toContain("validationMin");
    expect(fields).not.toContain("validationPattern");
  });
});

// ---------------------------------------------------------------------------
// Constants — updated field count
// ---------------------------------------------------------------------------

describe("constants — updated for issue #464", () => {
  it("exports exactly 8 form validation override fields", () => {
    expect(FORM_VALIDATION_OVERRIDE_FIELDS).toHaveLength(8);
    expect([...FORM_VALIDATION_OVERRIDE_FIELDS]).toEqual([
      "required",
      "validationType",
      "validationMessage",
      "validationMin",
      "validationMax",
      "validationMinLength",
      "validationMaxLength",
      "validationPattern"
    ]);
  });
});
