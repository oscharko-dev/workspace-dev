import assert from "node:assert/strict";
import test from "node:test";
import { inferValidationRulesFromEvidence } from "./generator-core.js";

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

// ---------------------------------------------------------------------------
// Email patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'Ungültige E-Mail-Adresse' → email pattern", () => {
  const rules = inferValidationRulesFromEvidence("Ungültige E-Mail-Adresse");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.equal(typeof rules[0].value, "string");
  assert.ok(new RegExp(rules[0].value as string).test("test@example.com"));
  assert.ok(!new RegExp(rules[0].value as string).test("invalid"));
});

test("inferValidationRulesFromEvidence: 'Invalid email address' → email pattern", () => {
  const rules = inferValidationRulesFromEvidence("Invalid email address");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
});

// ---------------------------------------------------------------------------
// IBAN / BIC patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'IBAN ungültig' → IBAN pattern", () => {
  const rules = inferValidationRulesFromEvidence("IBAN ungültig");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("DE89370400440532013000"));
});

test("inferValidationRulesFromEvidence: 'BIC/SWIFT ungültig' → BIC pattern", () => {
  const rules = inferValidationRulesFromEvidence("BIC/SWIFT ungültig");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("COBADEFFXXX"));
});

// ---------------------------------------------------------------------------
// PLZ / Phone / Date patterns
// ---------------------------------------------------------------------------

test("inferValidationRulesFromEvidence: 'PLZ ungültig' → PLZ pattern", () => {
  const rules = inferValidationRulesFromEvidence("PLZ ungültig");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("12345"));
  assert.ok(!new RegExp(rules[0].value as string).test("1234"));
});

test("inferValidationRulesFromEvidence: 'Ungültige Telefonnummer' → phone pattern", () => {
  const rules = inferValidationRulesFromEvidence("Ungültige Telefonnummer");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("+49 170 1234567"));
});

test("inferValidationRulesFromEvidence: 'Ungültiges Datum' → date pattern", () => {
  const rules = inferValidationRulesFromEvidence("Ungültiges Datum");
  assert.equal(rules.length, 1);
  assert.equal(rules[0].type, "pattern");
  assert.ok(new RegExp(rules[0].value as string).test("01.01.2024"));
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
