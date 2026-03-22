/**
 * Unit tests for edit-mode capability detection.
 *
 * Covers all three conditions (manifest mapping, element type eligibility,
 * supported override fields) and the extractPresentFields helper.
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/451
 */
import { describe, expect, it } from "vitest";
import {
  detectEditCapability,
  extractPresentFields,
  EDITABLE_ELEMENT_TYPES,
  SUPPORTED_OVERRIDE_FIELDS,
  type EditCapabilityNode
} from "./edit-capability-detection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<EditCapabilityNode> = {}): EditCapabilityNode {
  return {
    id: "node-1",
    name: "TestNode",
    type: "button",
    mapped: true,
    presentFields: ["text", "fillColor", "cornerRadius"],
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// detectEditCapability
// ---------------------------------------------------------------------------

describe("detectEditCapability", () => {
  describe("when node is fully editable", () => {
    it("returns editable=true with correct fields", () => {
      const result = detectEditCapability(makeNode());

      expect(result.editable).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.editableFields).toEqual(["text", "fillColor", "cornerRadius"]);
    });

    it("returns editable for text element with text field", () => {
      const result = detectEditCapability(makeNode({
        type: "text",
        presentFields: ["text", "fontSize", "fontWeight"]
      }));

      expect(result.editable).toBe(true);
      expect(result.editableFields).toEqual(["text", "fontSize", "fontWeight"]);
    });

    it("returns editable for container with layout fields", () => {
      const result = detectEditCapability(makeNode({
        type: "container",
        presentFields: ["padding", "gap", "layoutMode"]
      }));

      expect(result.editable).toBe(true);
      expect(result.editableFields).toEqual(["padding", "gap", "layoutMode"]);
    });
  });

  describe("condition 1: unmapped node", () => {
    it("returns not editable with manifest reason", () => {
      const result = detectEditCapability(makeNode({ mapped: false }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("not mapped in the component manifest");
      expect(result.editableFields).toEqual([]);
    });
  });

  describe("condition 2: unsupported element type", () => {
    it("returns not editable for unsupported types", () => {
      const unsupportedTypes = ["tooltip", "table", "select", "slider", "rating",
        "checkbox", "radio", "switch", "breadcrumbs", "tab", "stepper", "progress", "skeleton"];

      for (const type of unsupportedTypes) {
        const result = detectEditCapability(makeNode({ type }));

        expect(result.editable).toBe(false);
        expect(result.reason).toContain("does not support structured editing");
        expect(result.editableFields).toEqual([]);
      }
    });

    it("returns not editable for screen type", () => {
      const result = detectEditCapability(makeNode({ type: "screen" }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("does not support structured editing");
    });
  });

  describe("condition 3: no supported override fields", () => {
    it("returns not editable when no fields are present", () => {
      const result = detectEditCapability(makeNode({ presentFields: [] }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("no fields supported by override translators");
      expect(result.editableFields).toEqual([]);
    });

    it("returns not editable when fields are not in the supported set", () => {
      const result = detectEditCapability(makeNode({
        presentFields: ["vectorPaths", "prototypeNavigation", "variantMapping"]
      }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("no fields supported by override translators");
    });

    it("returns not editable when presentFields is undefined", () => {
      const result = detectEditCapability(makeNode({ presentFields: undefined }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("no fields supported by override translators");
    });
  });

  describe("condition priority", () => {
    it("checks manifest mapping first (before type)", () => {
      const result = detectEditCapability(makeNode({
        mapped: false,
        type: "tooltip" // also unsupported type
      }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("not mapped");
    });

    it("checks element type second (before fields)", () => {
      const result = detectEditCapability(makeNode({
        mapped: true,
        type: "tooltip", // unsupported type
        presentFields: ["text", "fillColor"]
      }));

      expect(result.editable).toBe(false);
      expect(result.reason).toContain("does not support structured editing");
    });
  });

  describe("editable element types coverage", () => {
    it("all types in EDITABLE_ELEMENT_TYPES produce editable=true when mapped with fields", () => {
      for (const type of EDITABLE_ELEMENT_TYPES) {
        const result = detectEditCapability(makeNode({
          type,
          presentFields: ["fillColor"]
        }));

        expect(result.editable).toBe(true);
      }
    });
  });

  describe("field filtering", () => {
    it("only includes fields in SUPPORTED_OVERRIDE_FIELDS", () => {
      const result = detectEditCapability(makeNode({
        presentFields: ["text", "unknownField", "fillColor", "vectorPaths", "opacity"]
      }));

      expect(result.editable).toBe(true);
      expect(result.editableFields).toEqual(["text", "fillColor", "opacity"]);
    });

    it("preserves field order from SUPPORTED_OVERRIDE_FIELDS", () => {
      const result = detectEditCapability(makeNode({
        presentFields: ["opacity", "text", "fillColor"]
      }));

      // Order follows SUPPORTED_OVERRIDE_FIELDS, not input order
      expect(result.editableFields).toEqual(["text", "fillColor", "opacity"]);
    });
  });
});

// ---------------------------------------------------------------------------
// extractPresentFields
// ---------------------------------------------------------------------------

describe("extractPresentFields", () => {
  it("extracts fields that exist and are not null/undefined", () => {
    const nodeData: Record<string, unknown> = {
      id: "node-1",
      name: "Test",
      type: "button",
      text: "Click me",
      fillColor: "#ff0000",
      cornerRadius: 8,
      opacity: 1.0,
      fontSize: null,
      fontWeight: undefined,
      vectorPaths: ["M0 0"]
    };

    const fields = extractPresentFields(nodeData);

    expect(fields).toContain("text");
    expect(fields).toContain("fillColor");
    expect(fields).toContain("cornerRadius");
    expect(fields).toContain("opacity");
    expect(fields).not.toContain("fontSize"); // null
    expect(fields).not.toContain("fontWeight"); // undefined
    expect(fields).not.toContain("vectorPaths"); // not in SUPPORTED_OVERRIDE_FIELDS
    expect(fields).not.toContain("id"); // not in SUPPORTED_OVERRIDE_FIELDS
  });

  it("returns empty array for node with no supported fields", () => {
    const nodeData: Record<string, unknown> = {
      id: "node-1",
      name: "Empty",
      type: "container"
    };

    const fields = extractPresentFields(nodeData);
    expect(fields).toEqual([]);
  });

  it("extracts all supported fields when present", () => {
    const allFields: Record<string, unknown> = {};
    for (const field of SUPPORTED_OVERRIDE_FIELDS) {
      allFields[field] = "value";
    }

    const fields = extractPresentFields(allFields);
    expect(fields).toHaveLength(SUPPORTED_OVERRIDE_FIELDS.length);
    for (const field of SUPPORTED_OVERRIDE_FIELDS) {
      expect(fields).toContain(field);
    }
  });

  it("handles numeric zero as a present value", () => {
    const nodeData: Record<string, unknown> = {
      cornerRadius: 0,
      opacity: 0,
      gap: 0
    };

    const fields = extractPresentFields(nodeData);
    expect(fields).toContain("cornerRadius");
    expect(fields).toContain("opacity");
    expect(fields).toContain("gap");
  });

  it("handles empty string as a present value", () => {
    const nodeData: Record<string, unknown> = {
      text: "",
      fillColor: ""
    };

    const fields = extractPresentFields(nodeData);
    expect(fields).toContain("text");
    expect(fields).toContain("fillColor");
  });
});
