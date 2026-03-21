import assert from "node:assert/strict";
import test from "node:test";
import { detectCrossFieldRules } from "./generator-core.js";
import type { InteractiveFieldModel, CrossFieldRule } from "./generator-core.js";
import { toCrossFieldRefineChain } from "./generator-templates.js";

const makeField = (overrides: Partial<InteractiveFieldModel> & { key: string; label: string }): InteractiveFieldModel => ({
  defaultValue: "",
  isSelect: false,
  options: [],
  ...overrides
});

// ---------------------------------------------------------------------------
// detectCrossFieldRules — match (password confirmation)
// ---------------------------------------------------------------------------
test("detectCrossFieldRules: detects password confirmation via 'confirm' in label", () => {
  const fields = [
    makeField({ key: "password_field", label: "Password", validationType: "password" }),
    makeField({ key: "confirm_password_field", label: "Confirm Password", validationType: "password" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "match");
  assert.equal(rules[0]?.sourceFieldKey, "password_field");
  assert.equal(rules[0]?.targetFieldKey, "confirm_password_field");
  assert.ok(rules[0]?.message.includes("Password"));
});

test("detectCrossFieldRules: detects password confirmation via German 'bestätigen' label", () => {
  const fields = [
    makeField({ key: "passwort", label: "Passwort", validationType: "password" }),
    makeField({ key: "passwort_bestaetigen", label: "Passwort bestätigen", validationType: "password" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "match");
  assert.equal(rules[0]?.sourceFieldKey, "passwort");
  assert.equal(rules[0]?.targetFieldKey, "passwort_bestaetigen");
});

test("detectCrossFieldRules: detects email confirmation via 'repeat' in label", () => {
  const fields = [
    makeField({ key: "email_input", label: "Email", validationType: "email" }),
    makeField({ key: "repeat_email_input", label: "Repeat Email", validationType: "email" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "match");
  assert.equal(rules[0]?.sourceFieldKey, "email_input");
  assert.equal(rules[0]?.targetFieldKey, "repeat_email_input");
});

test("detectCrossFieldRules: no match rule when no confirm pattern found", () => {
  const fields = [
    makeField({ key: "password_field", label: "Password", validationType: "password" }),
    makeField({ key: "email_field", label: "Email", validationType: "email" })
  ];
  const rules = detectCrossFieldRules(fields);
  const matchRules = rules.filter((r) => r.type === "match");
  assert.equal(matchRules.length, 0);
});

// ---------------------------------------------------------------------------
// detectCrossFieldRules — date_after (date range)
// ---------------------------------------------------------------------------
test("detectCrossFieldRules: detects date range with start/end labels", () => {
  const fields = [
    makeField({ key: "start_date", label: "Start Date", validationType: "date" }),
    makeField({ key: "end_date", label: "End Date", validationType: "date" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "date_after");
  assert.equal(rules[0]?.sourceFieldKey, "start_date");
  assert.equal(rules[0]?.targetFieldKey, "end_date");
  assert.ok(rules[0]?.message.includes("after"));
});

test("detectCrossFieldRules: detects German date range with von/bis labels", () => {
  const fields = [
    makeField({ key: "datum_von", label: "Datum von", validationType: "date" }),
    makeField({ key: "datum_bis", label: "Datum bis", validationType: "date" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "date_after");
  assert.equal(rules[0]?.sourceFieldKey, "datum_von");
  assert.equal(rules[0]?.targetFieldKey, "datum_bis");
});

test("detectCrossFieldRules: no date_after rule with only one date field", () => {
  const fields = [
    makeField({ key: "birthday", label: "Birthday", validationType: "date" })
  ];
  const rules = detectCrossFieldRules(fields);
  const dateRules = rules.filter((r) => r.type === "date_after");
  assert.equal(dateRules.length, 0);
});

test("detectCrossFieldRules: no date_after rule when both date fields lack start/end semantics", () => {
  const fields = [
    makeField({ key: "birthday", label: "Birthday", validationType: "date" }),
    makeField({ key: "anniversary", label: "Anniversary", validationType: "date" })
  ];
  const rules = detectCrossFieldRules(fields);
  const dateRules = rules.filter((r) => r.type === "date_after");
  assert.equal(dateRules.length, 0);
});

// ---------------------------------------------------------------------------
// detectCrossFieldRules — numeric_gt (min/max range)
// ---------------------------------------------------------------------------
test("detectCrossFieldRules: detects numeric range with min/max labels", () => {
  const fields = [
    makeField({ key: "min_amount", label: "Min Amount", validationType: "number" }),
    makeField({ key: "max_amount", label: "Max Amount", validationType: "number" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "numeric_gt");
  assert.equal(rules[0]?.sourceFieldKey, "min_amount");
  assert.equal(rules[0]?.targetFieldKey, "max_amount");
  assert.ok(rules[0]?.message.includes("greater"));
});

test("detectCrossFieldRules: detects German numeric range with Mindest/Höchst labels", () => {
  const fields = [
    makeField({ key: "mindest_betrag", label: "Mindest Betrag", validationType: "number" }),
    makeField({ key: "hoechst_betrag", label: "Höchst Betrag", validationType: "number" })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.type, "numeric_gt");
});

test("detectCrossFieldRules: no numeric_gt when no min/max pattern", () => {
  const fields = [
    makeField({ key: "quantity", label: "Quantity", validationType: "number" }),
    makeField({ key: "price", label: "Price", validationType: "number" })
  ];
  const rules = detectCrossFieldRules(fields);
  const numericRules = rules.filter((r) => r.type === "numeric_gt");
  assert.equal(numericRules.length, 0);
});

// ---------------------------------------------------------------------------
// detectCrossFieldRules — edge cases
// ---------------------------------------------------------------------------
test("detectCrossFieldRules: returns empty array for empty fields", () => {
  assert.deepStrictEqual(detectCrossFieldRules([]), []);
});

test("detectCrossFieldRules: skips select fields entirely", () => {
  const fields = [
    makeField({ key: "password_field", label: "Password", validationType: "password", isSelect: true }),
    makeField({ key: "confirm_password_field", label: "Confirm Password", validationType: "password", isSelect: true })
  ];
  const rules = detectCrossFieldRules(fields);
  assert.equal(rules.length, 0);
});

test("detectCrossFieldRules: handles mixed rule types in a single form", () => {
  const fields = [
    makeField({ key: "password_field", label: "Password", validationType: "password" }),
    makeField({ key: "confirm_password", label: "Confirm Password", validationType: "password" }),
    makeField({ key: "start_date", label: "Start Date", validationType: "date" }),
    makeField({ key: "end_date", label: "End Date", validationType: "date" }),
    makeField({ key: "min_val", label: "Minimum Number", validationType: "number" }),
    makeField({ key: "max_val", label: "Maximum Number", validationType: "number" }),
    makeField({ key: "email_field", label: "Email", validationType: "email" })
  ];
  const rules = detectCrossFieldRules(fields);
  const matchRules = rules.filter((r) => r.type === "match");
  const dateRules = rules.filter((r) => r.type === "date_after");
  const numericRules = rules.filter((r) => r.type === "numeric_gt");
  assert.equal(matchRules.length, 1);
  assert.equal(dateRules.length, 1);
  assert.equal(numericRules.length, 1);
});

// ---------------------------------------------------------------------------
// toCrossFieldRefineChain — code generation
// ---------------------------------------------------------------------------
test("toCrossFieldRefineChain: returns empty string for no rules", () => {
  assert.equal(toCrossFieldRefineChain({ rules: [], indent: "" }), "");
});

test("toCrossFieldRefineChain: generates .refine() for match rule", () => {
  const rules: CrossFieldRule[] = [
    { type: "match", sourceFieldKey: "pw", targetFieldKey: "confirm_pw", message: "Must match Password." }
  ];
  const result = toCrossFieldRefineChain({ rules, indent: "" });
  assert.ok(result.includes(".refine("));
  assert.ok(result.includes('data["pw"]'));
  assert.ok(result.includes('data["confirm_pw"]'));
  assert.ok(result.includes("Must match Password."));
  assert.ok(result.includes('path: ["confirm_pw"]'));
});

test("toCrossFieldRefineChain: generates .refine() for date_after rule", () => {
  const rules: CrossFieldRule[] = [
    { type: "date_after", sourceFieldKey: "start", targetFieldKey: "end", message: "Must be after Start Date." }
  ];
  const result = toCrossFieldRefineChain({ rules, indent: "" });
  assert.ok(result.includes(".refine("));
  assert.ok(result.includes("end > start"));
  assert.ok(result.includes("Must be after Start Date."));
  assert.ok(result.includes('path: ["end"]'));
});

test("toCrossFieldRefineChain: generates .refine() for numeric_gt rule", () => {
  const rules: CrossFieldRule[] = [
    { type: "numeric_gt", sourceFieldKey: "min_val", targetFieldKey: "max_val", message: "Must be greater than Min." }
  ];
  const result = toCrossFieldRefineChain({ rules, indent: "" });
  assert.ok(result.includes(".refine("));
  assert.ok(result.includes("const toComparableNumber = (value: unknown): number | undefined => {"));
  assert.ok(result.includes('const minVal = toComparableNumber(data["min_val"]);'));
  assert.ok(result.includes('const maxVal = toComparableNumber(data["max_val"]);'));
  assert.ok(result.includes("parseLocalizedNumber"));
  assert.ok(result.includes("maxVal > minVal"));
  assert.ok(result.includes("Must be greater than Min."));
  assert.ok(result.includes('path: ["max_val"]'));
  assert.equal(result.includes('parseLocalizedNumber(data["min_val"].trim())'), false);
  assert.equal(result.includes('parseLocalizedNumber(data["max_val"].trim())'), false);
});

test("toCrossFieldRefineChain: chains multiple .refine() calls", () => {
  const rules: CrossFieldRule[] = [
    { type: "match", sourceFieldKey: "a", targetFieldKey: "b", message: "Must match." },
    { type: "date_after", sourceFieldKey: "c", targetFieldKey: "d", message: "Must be after." }
  ];
  const result = toCrossFieldRefineChain({ rules, indent: "" });
  const refineCount = (result.match(/\.refine\(/g) ?? []).length;
  assert.equal(refineCount, 2);
});
