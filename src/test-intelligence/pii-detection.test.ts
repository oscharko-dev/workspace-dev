import assert from "node:assert/strict";
import test from "node:test";
import { detectPii, redactPii } from "./pii-detection.js";

test("detectPii flags a valid IBAN (DE89 3704 0044 0532 0130 00)", () => {
  const result = detectPii("DE89 3704 0044 0532 0130 00");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "iban");
  assert.equal(result?.redacted, "[REDACTED:IBAN]");
});

test("detectPii rejects an IBAN with a bad checksum", () => {
  const result = detectPii("DE89 3704 0044 0532 0130 01");
  assert.equal(result, null);
});

test("detectPii flags a BIC/SWIFT-style bank identifier", () => {
  const result = detectPii("INGDDEFFXXX");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "bic");
  assert.equal(result?.redacted, "[REDACTED:BIC]");
});

test("detectPii flags a valid Visa PAN (4111 1111 1111 1111)", () => {
  const result = detectPii("Card: 4111 1111 1111 1111");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "pan");
});

test("detectPii rejects a 16-digit string that fails Luhn", () => {
  const result = detectPii("1234 5678 9012 3456");
  assert.equal(result, null);
});

test("detectPii flags an email", () => {
  const result = detectPii("max.mustermann@sparkasse.de");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "email");
});

test("detectPii flags an E.164 phone", () => {
  const result = detectPii("+49 221 1234567");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "phone");
});

test("detectPii flags a full-name placeholder (case-insensitive)", () => {
  const result = detectPii("Max Mustermann");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "full_name");
});

test("detectPii flags a US SSN format", () => {
  const result = detectPii("123-45-6789");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "tax_id");
});

test("detectPii flags a German Steuer-ID with valid checksum", () => {
  // Generated with a valid ISO 7064 mod-11-10 checksum.
  const result = detectPii("86095742719");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "tax_id");
});

test("detectPii rejects clean action labels", () => {
  assert.equal(detectPii("Submit"), null);
  assert.equal(detectPii("Cancel"), null);
  assert.equal(detectPii(""), null);
});

test("detectPii redaction tokens never contain the original value", () => {
  const cases = [
    { input: "DE89 3704 0044 0532 0130 00", kind: "iban" },
    { input: "INGDDEFFXXX", kind: "bic" },
    { input: "4111 1111 1111 1111", kind: "pan" },
    { input: "max.mustermann@sparkasse.de", kind: "email" },
    { input: "+49 221 1234567", kind: "phone" },
    { input: "Max Mustermann", kind: "full_name" },
    { input: "123-45-6789", kind: "tax_id" },
  ];
  for (const { input, kind } of cases) {
    const result = detectPii(input);
    assert.equal(result?.kind, kind, `failed to detect ${kind} in "${input}"`);
    const redacted = result?.redacted ?? "";
    assert.equal(
      redacted.includes(input),
      false,
      `${kind} token leaked original`,
    );
    // Also ensure individual digit runs do not leak (e.g. PAN last 4).
    const digits = input.replace(/\D/gu, "");
    if (digits.length > 0) {
      assert.equal(redacted.includes(digits), false);
    }
  }
});

test("detectPii is idempotent across repeated calls (no stateful regex lastIndex)", () => {
  const ssn = "123-45-6789";
  const first = detectPii(ssn);
  const second = detectPii(ssn);
  const third = detectPii(ssn);
  assert.equal(first?.kind, "tax_id");
  assert.equal(second?.kind, "tax_id");
  assert.equal(third?.kind, "tax_id");
});

test("redactPii returns the stable token per kind", () => {
  assert.equal(redactPii("iban"), "[REDACTED:IBAN]");
  assert.equal(redactPii("bic"), "[REDACTED:BIC]");
  assert.equal(redactPii("pan"), "[REDACTED:PAN]");
  assert.equal(redactPii("email"), "[REDACTED:EMAIL]");
  assert.equal(redactPii("phone"), "[REDACTED:PHONE]");
  assert.equal(redactPii("tax_id"), "[REDACTED:TAX_ID]");
  assert.equal(redactPii("full_name"), "[REDACTED:FULL_NAME]");
});
