import assert from "node:assert/strict";
import test from "node:test";
import { inferValidationMode } from "./generator-core.js";
import type { InteractiveFieldModel } from "./generator-core.js";

const makeField = (overrides: Partial<InteractiveFieldModel> & { key: string; label: string }): InteractiveFieldModel => ({
  defaultValue: "",
  isSelect: false,
  options: [],
  ...overrides
});

// ---------------------------------------------------------------------------
// inferValidationMode — onSubmit (default)
// ---------------------------------------------------------------------------
test("inferValidationMode: returns onSubmit for empty fields", () => {
  assert.equal(
    inferValidationMode({ fields: [], hasVisualErrors: false }),
    "onSubmit"
  );
});

test("inferValidationMode: returns onSubmit for short form (2 fields, no visual errors)", () => {
  const fields = [
    makeField({ key: "email", label: "Email" }),
    makeField({ key: "password", label: "Password" })
  ];
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onSubmit"
  );
});

test("inferValidationMode: returns onSubmit for 4 fields (below threshold, no visual errors)", () => {
  const fields = Array.from({ length: 4 }, (_, i) =>
    makeField({ key: `field_${i}`, label: `Field ${i}` })
  );
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onSubmit"
  );
});

// ---------------------------------------------------------------------------
// inferValidationMode — onTouched (visual errors present)
// ---------------------------------------------------------------------------
test("inferValidationMode: returns onTouched when visual errors are present (short form)", () => {
  const fields = [
    makeField({ key: "email", label: "Email", hasVisualErrorExample: true }),
    makeField({ key: "password", label: "Password" })
  ];
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: true }),
    "onTouched"
  );
});

test("inferValidationMode: returns onTouched when visual errors present (long form)", () => {
  const fields = Array.from({ length: 6 }, (_, i) =>
    makeField({ key: `field_${i}`, label: `Field ${i}`, hasVisualErrorExample: i === 0 })
  );
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: true }),
    "onTouched"
  );
});

// ---------------------------------------------------------------------------
// inferValidationMode — onBlur (long form, no visual errors)
// ---------------------------------------------------------------------------
test("inferValidationMode: returns onBlur for 5+ non-select fields without visual errors", () => {
  const fields = Array.from({ length: 5 }, (_, i) =>
    makeField({ key: `field_${i}`, label: `Field ${i}` })
  );
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onBlur"
  );
});

test("inferValidationMode: returns onBlur for 8 non-select fields without visual errors", () => {
  const fields = Array.from({ length: 8 }, (_, i) =>
    makeField({ key: `field_${i}`, label: `Field ${i}` })
  );
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onBlur"
  );
});

// ---------------------------------------------------------------------------
// inferValidationMode — select fields excluded from count
// ---------------------------------------------------------------------------
test("inferValidationMode: select fields do not count toward long form threshold", () => {
  const fields = [
    makeField({ key: "field_0", label: "Field 0" }),
    makeField({ key: "field_1", label: "Field 1" }),
    makeField({ key: "field_2", label: "Field 2" }),
    makeField({ key: "select_0", label: "Select 0", isSelect: true }),
    makeField({ key: "select_1", label: "Select 1", isSelect: true }),
    makeField({ key: "select_2", label: "Select 2", isSelect: true })
  ];
  // only 3 non-select fields — should be onSubmit
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onSubmit"
  );
});

test("inferValidationMode: select fields mixed with enough text fields triggers onBlur", () => {
  const fields = [
    ...Array.from({ length: 5 }, (_, i) =>
      makeField({ key: `field_${i}`, label: `Field ${i}` })
    ),
    makeField({ key: "select_0", label: "Select 0", isSelect: true })
  ];
  // 5 non-select fields — should be onBlur
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: false }),
    "onBlur"
  );
});

// ---------------------------------------------------------------------------
// inferValidationMode — priority: visual errors > field count
// ---------------------------------------------------------------------------
test("inferValidationMode: visual errors take priority over short form", () => {
  const fields = [
    makeField({ key: "email", label: "Email" })
  ];
  assert.equal(
    inferValidationMode({ fields, hasVisualErrors: true }),
    "onTouched"
  );
});
