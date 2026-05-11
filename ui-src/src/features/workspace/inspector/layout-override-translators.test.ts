import { describe, expect, it } from "vitest";
import {
  COUNTER_AXIS_ALIGN_ITEMS,
  LAYOUT_MODE_VALUES,
  LAYOUT_OVERRIDE_FIELDS,
  PRIMARY_AXIS_ALIGN_ITEMS,
  deriveLayoutOverrideFieldSupport,
  extractSupportedLayoutOverrideFields,
  translateLayoutOverrideInput
} from "./layout-override-translators";

describe("translateLayoutOverrideInput", () => {
  it("accepts positive width and height values", () => {
    expect(translateLayoutOverrideInput({ field: "width", rawValue: "320" })).toEqual({
      ok: true,
      field: "width",
      value: 320
    });
    expect(translateLayoutOverrideInput({ field: "height", rawValue: 72 })).toEqual({
      ok: true,
      field: "height",
      value: 72
    });
  });

  it("rejects zero or invalid dimension values", () => {
    expect(translateLayoutOverrideInput({ field: "width", rawValue: 0 }).ok).toBe(false);
    expect(translateLayoutOverrideInput({ field: "height", rawValue: "abc" }).ok).toBe(false);
  });

  it("normalizes layout mode and alignment enums", () => {
    expect(translateLayoutOverrideInput({ field: "layoutMode", rawValue: "horizontal" })).toEqual({
      ok: true,
      field: "layoutMode",
      value: "HORIZONTAL"
    });
    expect(
      translateLayoutOverrideInput({
        field: "primaryAxisAlignItems",
        rawValue: "space_between",
        effectiveLayoutMode: "HORIZONTAL"
      })
    ).toEqual({
      ok: true,
      field: "primaryAxisAlignItems",
      value: "SPACE_BETWEEN"
    });
  });

  it("rejects alignment overrides when layout mode is NONE", () => {
    const result = translateLayoutOverrideInput({
      field: "counterAxisAlignItems",
      rawValue: "center",
      effectiveLayoutMode: "NONE"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected alignment validation failure.");
    }
    expect(result.error).toContain("requires layoutMode");
  });
});

describe("deriveLayoutOverrideFieldSupport", () => {
  it("marks layout fields supported for compatible container nodes", () => {
    const support = deriveLayoutOverrideFieldSupport({
      nodeData: {
        type: "container",
        width: 480,
        height: 240,
        layoutMode: "VERTICAL",
        primaryAxisAlignItems: "CENTER",
        counterAxisAlignItems: "BASELINE",
        children: [{ id: "child-1" }]
      },
      effectiveLayoutMode: "VERTICAL"
    });

    expect(support.every((entry) => entry.supported)).toBe(true);
  });

  it("rejects width and height for text nodes", () => {
    const support = deriveLayoutOverrideFieldSupport({
      nodeData: {
        type: "text",
        width: 240,
        height: 40
      }
    });

    expect(support.find((entry) => entry.field === "width")).toEqual({
      field: "width",
      supported: false,
      reason: "width is not supported for text nodes because the generator does not emit text dimensions."
    });
    expect(support.find((entry) => entry.field === "height")).toEqual({
      field: "height",
      supported: false,
      reason: "height is not supported for text nodes because the generator does not emit text dimensions."
    });
  });

  it("requires flex layout before exposing alignment fields", () => {
    const support = deriveLayoutOverrideFieldSupport({
      nodeData: {
        type: "container",
        layoutMode: "NONE",
        children: [{ id: "child-1" }]
      },
      effectiveLayoutMode: "NONE"
    });

    expect(support.find((entry) => entry.field === "primaryAxisAlignItems")?.supported).toBe(false);
    expect(support.find((entry) => entry.field === "counterAxisAlignItems")?.supported).toBe(false);
  });
});

describe("extractSupportedLayoutOverrideFields", () => {
  it("returns only layout fields supported by the current node shape", () => {
    const fields = extractSupportedLayoutOverrideFields({
      type: "container",
      width: 320,
      height: 120,
      layoutMode: "HORIZONTAL",
      primaryAxisAlignItems: "MAX",
      counterAxisAlignItems: "CENTER",
      children: [{ id: "child-1" }]
    });

    expect(fields).toEqual([
      "width",
      "height",
      "layoutMode",
      "primaryAxisAlignItems",
      "counterAxisAlignItems"
    ]);
  });

  it("tracks the configured layout field and enum sets", () => {
    expect(LAYOUT_OVERRIDE_FIELDS).toEqual([
      "width",
      "height",
      "layoutMode",
      "primaryAxisAlignItems",
      "counterAxisAlignItems"
    ]);
    expect(LAYOUT_MODE_VALUES).toEqual(["VERTICAL", "HORIZONTAL", "NONE"]);
    expect(PRIMARY_AXIS_ALIGN_ITEMS).toEqual(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]);
    expect(COUNTER_AXIS_ALIGN_ITEMS).toEqual(["MIN", "CENTER", "MAX", "BASELINE"]);
  });
});
