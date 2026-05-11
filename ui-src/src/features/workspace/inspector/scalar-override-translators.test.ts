import { describe, expect, it } from "vitest";
import {
  SCALAR_OVERRIDE_FIELDS,
  deriveScalarOverrideFieldSupport,
  extractSupportedScalarOverrideFields,
  isScalarPaddingValue,
  translateScalarOverrideInput
} from "./scalar-override-translators";

describe("translateScalarOverrideInput", () => {
  it("normalizes hex colors deterministically", () => {
    const shortHex = translateScalarOverrideInput({ field: "fillColor", rawValue: "#AbC" });
    const longHex = translateScalarOverrideInput({ field: "fillColor", rawValue: "#00FFaa" });

    expect(shortHex).toEqual({ ok: true, field: "fillColor", value: "#aabbcc" });
    expect(longHex).toEqual({ ok: true, field: "fillColor", value: "#00ffaa" });
  });

  it("rejects invalid hex color values", () => {
    const result = translateScalarOverrideInput({ field: "fillColor", rawValue: "blue" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected fillColor validation failure.");
    }
    expect(result.error).toContain("hex color");
  });

  it("accepts opacity values between 0 and 1", () => {
    const byNumber = translateScalarOverrideInput({ field: "opacity", rawValue: 0.45 });
    const byString = translateScalarOverrideInput({ field: "opacity", rawValue: "0.9" });

    expect(byNumber).toEqual({ ok: true, field: "opacity", value: 0.45 });
    expect(byString).toEqual({ ok: true, field: "opacity", value: 0.9 });
  });

  it("rejects opacity values outside the valid range", () => {
    const negative = translateScalarOverrideInput({ field: "opacity", rawValue: -0.1 });
    const tooLarge = translateScalarOverrideInput({ field: "opacity", rawValue: "1.2" });

    expect(negative.ok).toBe(false);
    expect(tooLarge.ok).toBe(false);
  });

  it("accepts non-negative numeric scalar fields", () => {
    const cornerRadius = translateScalarOverrideInput({ field: "cornerRadius", rawValue: "12" });
    const fontSize = translateScalarOverrideInput({ field: "fontSize", rawValue: 16 });
    const gap = translateScalarOverrideInput({ field: "gap", rawValue: 24 });

    expect(cornerRadius).toEqual({ ok: true, field: "cornerRadius", value: 12 });
    expect(fontSize).toEqual({ ok: true, field: "fontSize", value: 16 });
    expect(gap).toEqual({ ok: true, field: "gap", value: 24 });
  });

  it("rejects negative values for non-negative scalar fields", () => {
    const cornerRadius = translateScalarOverrideInput({ field: "cornerRadius", rawValue: -1 });
    const fontSize = translateScalarOverrideInput({ field: "fontSize", rawValue: "-4" });

    expect(cornerRadius.ok).toBe(false);
    expect(fontSize.ok).toBe(false);
  });

  it("accepts fontWeight values in 100-step increments", () => {
    const weight = translateScalarOverrideInput({ field: "fontWeight", rawValue: "700" });

    expect(weight).toEqual({ ok: true, field: "fontWeight", value: 700 });
  });

  it("rejects invalid fontWeight values", () => {
    const nonStep = translateScalarOverrideInput({ field: "fontWeight", rawValue: 750 });
    const tooSmall = translateScalarOverrideInput({ field: "fontWeight", rawValue: 50 });

    expect(nonStep.ok).toBe(false);
    expect(tooSmall.ok).toBe(false);
  });

  it("trims and validates fontFamily", () => {
    const valid = translateScalarOverrideInput({ field: "fontFamily", rawValue: "  Inter  " });
    const invalid = translateScalarOverrideInput({ field: "fontFamily", rawValue: "   " });

    expect(valid).toEqual({ ok: true, field: "fontFamily", value: "Inter" });
    expect(invalid.ok).toBe(false);
  });

  it("accepts and normalizes padding objects", () => {
    const result = translateScalarOverrideInput({
      field: "padding",
      rawValue: {
        top: "8",
        right: 12,
        bottom: "16",
        left: 4
      }
    });

    expect(result).toEqual({
      ok: true,
      field: "padding",
      value: {
        top: 8,
        right: 12,
        bottom: 16,
        left: 4
      }
    });
  });

  it("rejects padding objects with missing sides", () => {
    const result = translateScalarOverrideInput({
      field: "padding",
      rawValue: {
        top: 8,
        right: 12,
        bottom: 16
      }
    });

    expect(result.ok).toBe(false);
  });
});

describe("isScalarPaddingValue", () => {
  it("returns true for valid non-negative numeric padding", () => {
    expect(
      isScalarPaddingValue({
        top: 0,
        right: 8,
        bottom: 12,
        left: 4
      })
    ).toBe(true);
  });

  it("returns false when any side is invalid", () => {
    expect(
      isScalarPaddingValue({
        top: -1,
        right: 8,
        bottom: 12,
        left: 4
      })
    ).toBe(false);
  });
});

describe("deriveScalarOverrideFieldSupport", () => {
  it("marks scalar fields as supported when present and compatible", () => {
    const support = deriveScalarOverrideFieldSupport({
      fillColor: "#ff0000",
      opacity: 0.8,
      cornerRadius: 8,
      fontSize: 16,
      fontWeight: 700,
      fontFamily: "Inter",
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      gap: 12
    });

    expect(support.every((entry) => entry.supported)).toBe(true);
  });

  it("includes explicit reasons for unsupported fields", () => {
    const support = deriveScalarOverrideFieldSupport({
      fillColor: "#ff0000",
      padding: { top: 8, right: "x", bottom: 8, left: 8 }
    });

    const unsupported = support.filter((entry) => !entry.supported);
    expect(unsupported.length).toBeGreaterThan(0);
    expect(unsupported.every((entry) => typeof entry.reason === "string" && entry.reason.length > 0)).toBe(true);
  });
});

describe("extractSupportedScalarOverrideFields", () => {
  it("returns only supported scalar fields in canonical order", () => {
    const fields = extractSupportedScalarOverrideFields({
      gap: 8,
      fillColor: "#ffffff",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      width: 100,
      layoutMode: "VERTICAL"
    });

    expect(fields).toEqual(["fillColor", "padding", "gap"]);
  });

  it("tracks exactly the configured scalar field set", () => {
    expect(SCALAR_OVERRIDE_FIELDS).toEqual([
      "fillColor",
      "opacity",
      "cornerRadius",
      "fontSize",
      "fontWeight",
      "fontFamily",
      "padding",
      "gap"
    ]);
  });
});
