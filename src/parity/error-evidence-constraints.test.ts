import assert from "node:assert/strict";
import test from "node:test";
import { inferValidationRulesFromEvidence } from "./generator-core.js";
import { classifyValidationEvidence } from "./generator-forms.js";

// ---------------------------------------------------------------------------
// Required field patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'Pflichtfeld' → minLength(1)", () => {
  const rules = inferValidationRulesFromEvidence("Pflichtfeld");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 1);
  assert.equal(rules[0].message, "Pflichtfeld");
});

test("inferValidationRulesFromEvidence: 'required' → minLength(1)", () => {
  const rules = inferValidationRulesFromEvidence("required");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 1);
});

test("inferValidationRulesFromEvidence: 'Dieses Feld ist erforderlich' → minLength(1)", () => {
  const rules = inferValidationRulesFromEvidence("Dieses Feld ist erforderlich");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 1);
});

test("inferValidationRulesFromEvidence: 'This field is required' → minLength(1)", () => {
  const rules = inferValidationRulesFromEvidence("This field is required");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 1);
});

test("inferValidationRulesFromEvidence: case insensitive 'PFLICHTFELD' → minLength(1)", () => {
  const rules = inferValidationRulesFromEvidence("PFLICHTFELD");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 1);
});

test("classifyValidationEvidence: 'Email is required' keeps required semantics", () => {
  const classification = classifyValidationEvidence("Email is required");
  assert.equal(classification.required, true);
  assert.equal(classification.validationType, "email");
  assert.deepEqual(classification.validationRules, [
    { type: "minLength", value: 1, message: "Email is required" }
  ]);
});

test("classifyValidationEvidence: 'E-Mail ist erforderlich' keeps required semantics", () => {
  const classification = classifyValidationEvidence("E-Mail ist erforderlich");
  assert.equal(classification.required, true);
  assert.equal(classification.validationType, "email");
  assert.deepEqual(classification.validationRules, [
    { type: "minLength", value: 1, message: "E-Mail ist erforderlich" }
  ]);
});

// ---------------------------------------------------------------------------
// Email patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'Ungültige E-Mail-Adresse' → no direct rules for semantic email validation", () => {
  const rules = inferValidationRulesFromEvidence("Ungültige E-Mail-Adresse");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: 'Invalid email address' → no direct rules for semantic email validation", () => {
  const rules = inferValidationRulesFromEvidence("Invalid email address");
  assert.equal(rules.length, 0);
});

// ---------------------------------------------------------------------------
// IBAN / BIC patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'IBAN ungültig' → no direct rules for semantic IBAN validation", () => {
  const rules = inferValidationRulesFromEvidence("IBAN ungültig");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: 'BIC/SWIFT ungültig' → BIC pattern", () => {
  const rules = inferValidationRulesFromEvidence("BIC/SWIFT ungültig");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("COBADEFFXXX"));
});

test("classifyValidationEvidence: 'BIC/SWIFT ungültig' remains regex-only", () => {
  const classification = classifyValidationEvidence("BIC/SWIFT ungültig");
  assert.equal(classification.required, false);
  assert.equal(classification.validationType, undefined);
  assert.equal(classification.validationRules.length, 1);
  assert.equal(classification.validationRules[0].type, "pattern");
});

// ---------------------------------------------------------------------------
// PLZ / Phone / Date patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'PLZ ungültig' → no direct rules for semantic PLZ validation", () => {
  const rules = inferValidationRulesFromEvidence("PLZ ungültig");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: 'Ungültige Telefonnummer' → no direct rules for semantic phone validation", () => {
  const rules = inferValidationRulesFromEvidence("Ungültige Telefonnummer");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: 'Ungültiges Datum' → date pattern", () => {
  const rules = inferValidationRulesFromEvidence("Ungültiges Datum");
  assert.equal(rules.length, 0);
});

test("classifyValidationEvidence: 'Ungültiges Datum' infers semantic date validation", () => {
  const classification = classifyValidationEvidence("Ungültiges Datum");
  assert.equal(classification.required, false);
  assert.equal(classification.validationType, "date");
  assert.deepEqual(classification.validationRules, []);
});

// ---------------------------------------------------------------------------
// Min / max length extraction
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'Mindestens 8 Zeichen' → minLength(8)", () => {
  const rules = inferValidationRulesFromEvidence("Mindestens 8 Zeichen");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 8);
});

test("inferValidationRulesFromEvidence: 'at least 6 characters' → minLength(6)", () => {
  const rules = inferValidationRulesFromEvidence("at least 6 characters");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "minLength");
  assert.equal(rules[0].value, 6);
});

test("inferValidationRulesFromEvidence: 'Maximal 100 Zeichen' → maxLength(100)", () => {
  const rules = inferValidationRulesFromEvidence("Maximal 100 Zeichen");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "maxLength");
  assert.equal(rules[0].value, 100);
});

test("inferValidationRulesFromEvidence: 'maximum 255 characters' → maxLength(255)", () => {
  const rules = inferValidationRulesFromEvidence("maximum 255 characters");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "maxLength");
  assert.equal(rules[0].value, 255);
});

// ---------------------------------------------------------------------------
// Fallback / edge cases
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: unknown message → empty array", () => {
  const rules = inferValidationRulesFromEvidence("Some unknown error message");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: empty string → empty array", () => {
  const rules = inferValidationRulesFromEvidence("");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: whitespace only → empty array", () => {
  const rules = inferValidationRulesFromEvidence("   ");
  assert.equal(rules.length, 0);
});

test("inferValidationRulesFromEvidence: preserves original message in rule", () => {
  const msg = "  Pflichtfeld  ";
  const rules = inferValidationRulesFromEvidence(msg);
  assert.equal(rules[0].message, "Pflichtfeld");
});
