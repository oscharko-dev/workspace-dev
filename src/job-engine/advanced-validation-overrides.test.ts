/**
 * Tests for advanced validation override fields (issue #464).
 *
 * Covers validationMin, validationMax, validationMinLength, validationMaxLength,
 * and validationPattern across the IR override validation and application pipeline.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { validateRegenerationOverrideEntry } from "./ir-override-validation.js";
import { applyIrOverrides } from "./ir-overrides.js";
import type { DesignIR, ScreenIR, ScreenElementIR } from "../parity/types-ir.js";

// ---------------------------------------------------------------------------
// Helper to create a minimal DesignIR with one element
// ---------------------------------------------------------------------------
function createTestIr(elementOverrides: Partial<ScreenElementIR> = {}): DesignIR {
  const element: ScreenElementIR = {
    id: "node-1",
    name: "TestField",
    nodeType: "FRAME",
    type: "container",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    children: [],
    ...elementOverrides
  } as ScreenElementIR;

  const screen: ScreenIR = {
    id: "screen-1",
    name: "TestScreen",
    nodeType: "FRAME",
    type: "screen",
    x: 0,
    y: 0,
    width: 375,
    height: 812,
    fillColor: "#ffffff",
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    gap: 0,
    children: [element]
  } as ScreenIR;

  return {
    screens: [screen],
    tokens: {}
  } as DesignIR;
}

// ---------------------------------------------------------------------------
// validateRegenerationOverrideEntry — validationMin
// ---------------------------------------------------------------------------
test("validationMin: accepts a finite number", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: 5 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 5);
  }
});

test("validationMin: accepts negative numbers", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: -10 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, -10);
  }
});

test("validationMin: accepts zero", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: 0 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 0);
  }
});

test("validationMin: accepts floating point", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: 3.14 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 3.14);
  }
});

test("validationMin: rejects non-number values", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: "five" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.message.includes("finite number"));
  }
});

test("validationMin: rejects Infinity", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: Infinity });
  assert.equal(result.ok, false);
});

test("validationMin: rejects NaN", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMin", value: NaN });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// validateRegenerationOverrideEntry — validationMax
// ---------------------------------------------------------------------------
test("validationMax: accepts a finite number", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMax", value: 100 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 100);
  }
});

test("validationMax: rejects non-number values", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMax", value: true });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// validateRegenerationOverrideEntry — validationMinLength
// ---------------------------------------------------------------------------
test("validationMinLength: accepts non-negative integer", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMinLength", value: 8 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 8);
  }
});

test("validationMinLength: accepts zero", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMinLength", value: 0 });
  assert.ok(result.ok);
});

test("validationMinLength: rejects negative integers", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMinLength", value: -1 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.message.includes("non-negative integer"));
  }
});

test("validationMinLength: rejects floating point", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMinLength", value: 3.5 });
  assert.equal(result.ok, false);
});

test("validationMinLength: rejects non-number", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMinLength", value: "8" });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// validateRegenerationOverrideEntry — validationMaxLength
// ---------------------------------------------------------------------------
test("validationMaxLength: accepts non-negative integer", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMaxLength", value: 255 });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, 255);
  }
});

test("validationMaxLength: rejects negative integers", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationMaxLength", value: -5 });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// validateRegenerationOverrideEntry — validationPattern
// ---------------------------------------------------------------------------
test("validationPattern: accepts a valid regex string", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: "^[A-Z]{2}\\d{4}$" });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, "^[A-Z]{2}\\d{4}$");
  }
});

test("validationPattern: accepts simple pattern", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: "\\d+" });
  assert.ok(result.ok);
});

test("validationPattern: rejects empty string", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: "" });
  assert.equal(result.ok, false);
});

test("validationPattern: rejects invalid regex", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: "[invalid" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.message.includes("valid regular expression"));
  }
});

test("validationPattern: rejects non-string", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: 42 });
  assert.equal(result.ok, false);
});

test("validationPattern: trims whitespace", () => {
  const result = validateRegenerationOverrideEntry({ nodeId: "n1", field: "validationPattern", value: "  \\d+  " });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.entry.value, "\\d+");
  }
});

// ---------------------------------------------------------------------------
// applyIrOverrides — advanced validation fields
// ---------------------------------------------------------------------------
test("applyIrOverrides: applies validationMin to element", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationMin", value: 0 }]
  });
  assert.equal(result.appliedCount, 1);
  assert.equal(result.skippedCount, 0);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationMin, 0);
});

test("applyIrOverrides: applies validationMax to element", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationMax", value: 100 }]
  });
  assert.equal(result.appliedCount, 1);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationMax, 100);
});

test("applyIrOverrides: applies validationMinLength to element", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationMinLength", value: 8 }]
  });
  assert.equal(result.appliedCount, 1);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationMinLength, 8);
});

test("applyIrOverrides: applies validationMaxLength to element", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationMaxLength", value: 255 }]
  });
  assert.equal(result.appliedCount, 1);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationMaxLength, 255);
});

test("applyIrOverrides: applies validationPattern to element", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationPattern", value: "^[A-Z]+$" }]
  });
  assert.equal(result.appliedCount, 1);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationPattern, "^[A-Z]+$");
});

test("applyIrOverrides: applies multiple advanced validation fields together", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "node-1", field: "validationMin", value: 0 },
      { nodeId: "node-1", field: "validationMax", value: 100 },
      { nodeId: "node-1", field: "validationMinLength", value: 2 },
      { nodeId: "node-1", field: "validationMaxLength", value: 50 },
      { nodeId: "node-1", field: "validationPattern", value: "\\d+" }
    ]
  });
  assert.equal(result.appliedCount, 5);
  assert.equal(result.skippedCount, 0);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationMin, 0);
  assert.equal(element.validationMax, 100);
  assert.equal(element.validationMinLength, 2);
  assert.equal(element.validationMaxLength, 50);
  assert.equal(element.validationPattern, "\\d+");
});

test("applyIrOverrides: mixes advanced and legacy validation fields", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "node-1", field: "required", value: true },
      { nodeId: "node-1", field: "validationType", value: "number" },
      { nodeId: "node-1", field: "validationMessage", value: "Enter a valid number." },
      { nodeId: "node-1", field: "validationMin", value: 0 },
      { nodeId: "node-1", field: "validationMax", value: 999 }
    ]
  });
  assert.equal(result.appliedCount, 5);
  assert.equal(result.skippedCount, 0);
  const element = result.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.required, true);
  assert.equal(element.validationType, "number");
  assert.equal(element.validationMessage, "Enter a valid number.");
  assert.equal(element.validationMin, 0);
  assert.equal(element.validationMax, 999);
});

test("applyIrOverrides: skips invalid advanced validation overrides", () => {
  const ir = createTestIr();
  const result = applyIrOverrides({
    ir,
    overrides: [
      { nodeId: "node-1", field: "validationMinLength", value: -1 },
      { nodeId: "node-1", field: "validationPattern", value: "[invalid" }
    ]
  });
  assert.equal(result.appliedCount, 0);
  assert.equal(result.skippedCount, 2);
});

test("applyIrOverrides: does not mutate original IR", () => {
  const ir = createTestIr();
  const originalElement = ir.screens[0]?.children[0] as Record<string, unknown>;
  applyIrOverrides({
    ir,
    overrides: [{ nodeId: "node-1", field: "validationMin", value: 5 }]
  });
  assert.equal(originalElement.validationMin, undefined);
});
