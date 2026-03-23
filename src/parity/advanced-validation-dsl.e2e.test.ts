/**
 * End-to-end test for advanced validation rule DSL (issue #464).
 *
 * Exercises the full pipeline: override validation → IR override application →
 * form template code generation with advanced validation rules.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { validateRegenerationOverrideEntry, SUPPORTED_REGENERATION_OVERRIDE_FIELDS } from "../job-engine/ir-override-validation.js";
import { applyIrOverrides } from "../job-engine/ir-overrides.js";
import { buildInlineReactHookFormStateBlock, toCrossFieldRefineChain } from "./generator-templates.js";
import type { DesignIR, ScreenIR, ScreenElementIR } from "./types-ir.js";
import type { ValidationRule, CrossFieldRule } from "./generator-core.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createIr(elements: ScreenElementIR[]): DesignIR {
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
    children: elements
  } as ScreenIR;
  return { screens: [screen], tokens: {} } as DesignIR;
}

function createInputElement(overrides: Partial<ScreenElementIR> & { id: string }): ScreenElementIR {
  return {
    name: "Field",
    nodeType: "FRAME",
    type: "container",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    children: [],
    ...overrides
  } as ScreenElementIR;
}

// ---------------------------------------------------------------------------
// E2E: supported override fields now include advanced validation
// ---------------------------------------------------------------------------
test("SUPPORTED_REGENERATION_OVERRIDE_FIELDS includes all 5 advanced validation fields", () => {
  const advancedFields = ["validationMin", "validationMax", "validationMinLength", "validationMaxLength", "validationPattern"];
  for (const field of advancedFields) {
    assert.ok(
      (SUPPORTED_REGENERATION_OVERRIDE_FIELDS as readonly string[]).includes(field),
      `Expected ${field} in SUPPORTED_REGENERATION_OVERRIDE_FIELDS`
    );
  }
});

// ---------------------------------------------------------------------------
// E2E: full pipeline — validation → IR application → code generation
// ---------------------------------------------------------------------------
test("E2E: applies min/max overrides and generates Zod code with validationRules", () => {
  // Step 1: Validate overrides
  const overrides = [
    { nodeId: "amount-field", field: "validationType", value: "number" },
    { nodeId: "amount-field", field: "validationMin", value: 0 },
    { nodeId: "amount-field", field: "validationMax", value: 10000 },
    { nodeId: "amount-field", field: "required", value: true },
    { nodeId: "amount-field", field: "validationMessage", value: "Please enter a valid amount." }
  ];

  for (const override of overrides) {
    const result = validateRegenerationOverrideEntry(override);
    assert.ok(result.ok, `Override ${override.field} validation failed`);
  }

  // Step 2: Apply overrides to IR
  const ir = createIr([createInputElement({ id: "amount-field" })]);
  const applied = applyIrOverrides({ ir, overrides });
  assert.equal(applied.appliedCount, 5);
  assert.equal(applied.skippedCount, 0);

  const element = applied.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationType, "number");
  assert.equal(element.validationMin, 0);
  assert.equal(element.validationMax, 10000);
  assert.equal(element.required, true);
  assert.equal(element.validationMessage, "Please enter a valid amount.");

  // Step 3: Generate form template with validationRules
  const validationRules: ValidationRule[] = [
    { type: "min", value: 0, message: "Amount must be at least 0." },
    { type: "max", value: 10000, message: "Amount must not exceed 10,000." }
  ];

  const code = buildInlineReactHookFormStateBlock({
    hasSelectField: false,
    selectOptionsMap: {},
    initialVisualErrorsMap: {},
    requiredFieldMap: { amount: true },
    validationTypeMap: { amount: "number" },
    validationMessageMap: { amount: "Please enter a valid amount." },
    initialValues: { amount: "" },
    validationRulesMap: { amount: validationRules }
  });

  // Verify the generated code includes the validation rules
  assert.ok(code.includes('"validationRules"'), "Generated code should include validationRules");
  assert.ok(code.includes('"min"'), "Generated code should include min rule type");
  assert.ok(code.includes('"max"'), "Generated code should include max rule type");
  assert.ok(code.includes("Amount must be at least 0."), "Generated code should include min rule message");
  assert.ok(code.includes("Amount must not exceed 10,000."), "Generated code should include max rule message");
  assert.ok(code.includes("createFieldSchema"), "Generated code should use createFieldSchema");
  assert.ok(code.includes("z.object"), "Generated code should define Zod schema");

  // Verify the generated code includes the advanced rule processing
  assert.ok(code.includes("spec.validationRules"), "Generated code should read validationRules from spec");
  assert.ok(code.includes("case \"minLength\""), "Generated code should handle minLength rule");
  assert.ok(code.includes("case \"maxLength\""), "Generated code should handle maxLength rule");
  assert.ok(code.includes("case \"min\""), "Generated code should handle min rule");
  assert.ok(code.includes("case \"max\""), "Generated code should handle max rule");
  assert.ok(code.includes("case \"pattern\""), "Generated code should handle pattern rule");
});

test("E2E: applies pattern and length overrides", () => {
  const overrides = [
    { nodeId: "code-field", field: "validationType", value: "search" },
    { nodeId: "code-field", field: "validationMinLength", value: 2 },
    { nodeId: "code-field", field: "validationMaxLength", value: 10 },
    { nodeId: "code-field", field: "validationPattern", value: "^[A-Z0-9]+$" }
  ];

  for (const override of overrides) {
    const result = validateRegenerationOverrideEntry(override);
    assert.ok(result.ok, `Override ${override.field} validation failed`);
  }

  const ir = createIr([createInputElement({ id: "code-field" })]);
  const applied = applyIrOverrides({ ir, overrides });
  assert.equal(applied.appliedCount, 4);

  const element = applied.ir.screens[0]?.children[0] as Record<string, unknown>;
  assert.equal(element.validationType, "search");
  assert.equal(element.validationMinLength, 2);
  assert.equal(element.validationMaxLength, 10);
  assert.equal(element.validationPattern, "^[A-Z0-9]+$");
});

test("E2E: mixes legacy and advanced validation in same form", () => {
  const ir = createIr([
    createInputElement({ id: "email-field" }),
    createInputElement({ id: "amount-field" }),
    createInputElement({ id: "code-field" })
  ]);

  const overrides = [
    // Email field: legacy-only
    { nodeId: "email-field", field: "required", value: true },
    { nodeId: "email-field", field: "validationType", value: "email" },
    { nodeId: "email-field", field: "validationMessage", value: "Invalid email." },
    // Amount field: legacy + advanced
    { nodeId: "amount-field", field: "validationType", value: "number" },
    { nodeId: "amount-field", field: "validationMin", value: 1 },
    { nodeId: "amount-field", field: "validationMax", value: 999 },
    // Code field: advanced only
    { nodeId: "code-field", field: "validationPattern", value: "^[A-Z]{3}$" },
    { nodeId: "code-field", field: "validationMinLength", value: 3 },
    { nodeId: "code-field", field: "validationMaxLength", value: 3 }
  ];

  const applied = applyIrOverrides({ ir, overrides });
  assert.equal(applied.appliedCount, 9);
  assert.equal(applied.skippedCount, 0);
});

test("E2E: rejects invalid advanced overrides without affecting valid ones", () => {
  const ir = createIr([createInputElement({ id: "field-1" })]);

  const overrides = [
    { nodeId: "field-1", field: "validationMin", value: 10 },
    { nodeId: "field-1", field: "validationMinLength", value: -5 }, // invalid
    { nodeId: "field-1", field: "validationPattern", value: "[bad" }, // invalid
    { nodeId: "field-1", field: "validationMax", value: 100 }
  ];

  const applied = applyIrOverrides({ ir, overrides });
  assert.equal(applied.appliedCount, 2); // min and max
  assert.equal(applied.skippedCount, 2); // minLength and pattern
});

test("E2E: cross-field rules coexist with advanced validation rules in code generation", () => {
  const crossFieldRules: CrossFieldRule[] = [
    { type: "match", sourceFieldKey: "password", targetFieldKey: "confirm_password", message: "Passwords must match." }
  ];

  const validationRules: ValidationRule[] = [
    { type: "minLength", value: 8, message: "Password must be at least 8 characters." },
    { type: "pattern", value: "^(?=.*[A-Z])(?=.*\\d)", message: "Must contain an uppercase letter and number." }
  ];

  const code = buildInlineReactHookFormStateBlock({
    hasSelectField: false,
    selectOptionsMap: {},
    initialVisualErrorsMap: {},
    requiredFieldMap: { password: true, confirm_password: true },
    validationTypeMap: { password: "password", confirm_password: "password" },
    validationMessageMap: { password: "Invalid password.", confirm_password: "Invalid." },
    initialValues: { password: "", confirm_password: "" },
    crossFieldRules,
    validationRulesMap: { password: validationRules }
  });

  // Cross-field rules generate .refine() chains
  assert.ok(code.includes(".refine("), "Generated code should include cross-field refine chain");
  assert.ok(code.includes("Passwords must match."), "Generated code should include cross-field message");

  // Advanced rules are embedded in validationRules in field specs
  assert.ok(code.includes('"minLength"'), "Generated code should include minLength rule");
  assert.ok(code.includes("Password must be at least 8 characters."), "Generated code should include advanced rule message");
});
