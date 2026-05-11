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

test("detectPii flags a lowercase BIC/SWIFT identifier", () => {
  const result = detectPii("ingddeffxxx");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "bic");
  assert.equal(result?.redacted, "[REDACTED:BIC]");
});

test("detectPii flags a mixed-case BIC/SWIFT identifier", () => {
  const result = detectPii("IngdDeffXXX");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "bic");
  assert.equal(result?.redacted, "[REDACTED:BIC]");
});

test("detectPii flags a labelled BIC/SWIFT identifier", () => {
  const result = detectPii("BIC: ingddeffxxx");
  assert.notEqual(result, null);
  assert.equal(result?.kind, "bic");
});

test("detectPii does not treat ordinary words as BIC/SWIFT identifiers", () => {
  assert.equal(detectPii("Accepted"), null);
  assert.equal(detectPii("Field accepts the minimum boundary value"), null);
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
  // Issue #1668 (audit-2026-05) tokens.
  assert.equal(redactPii("postal_address"), "[REDACTED:POSTAL_ADDRESS]");
  assert.equal(redactPii("date_of_birth"), "[REDACTED:DOB]");
  assert.equal(redactPii("account_number"), "[REDACTED:ACCOUNT_NUMBER]");
  assert.equal(redactPii("national_id"), "[REDACTED:NATIONAL_ID]");
  assert.equal(redactPii("special_category"), "[REDACTED:SPECIAL_CATEGORY]");
});

// ---------------------------------------------------------------------------
// Issue #1668 (audit-2026-05): GDPR Art. 5(1)(c) coverage.
// ---------------------------------------------------------------------------

test("postal_address: detects DE Musterstraße 12, 10115 Berlin", () => {
  const m = detectPii("Bitte senden an: Musterstraße 12, 10115 Berlin");
  assert.equal(m?.kind, "postal_address");
});

test("postal_address: detects FR rue + numero + code postal + ville", () => {
  const m = detectPii("Adresse: 12 rue de la Paix, 75002 Paris");
  assert.equal(m?.kind, "postal_address");
});

test("postal_address: detects NL Hoofdstraat 12, 1011 AB Amsterdam", () => {
  const m = detectPii("Hoofdstraat 12, 1011 AB Amsterdam");
  assert.equal(m?.kind, "postal_address");
});

test("postal_address: does NOT trigger on a bare postal code alone", () => {
  const m = detectPii("Reference number 10115 logged in audit table");
  assert.notEqual(m?.kind, "postal_address");
});

test("date_of_birth: detects DE 'Geburtsdatum: 12.03.1985'", () => {
  const m = detectPii("Geburtsdatum: 12.03.1985");
  assert.ok(m && (m.kind === "date_of_birth" || m.kind === "national_id"));
});

test("date_of_birth: detects EN 'date of birth: 1985-03-12'", () => {
  const m = detectPii("Customer date of birth: 1985-03-12 (verified)");
  assert.equal(m?.kind, "date_of_birth");
});

test("date_of_birth: does NOT trigger on a bare date with no DOB context", () => {
  const m = detectPii("Generated on 2026-04-25 by deterministic-runner");
  assert.equal(m, null);
});

test("account_number: detects EN labelled 'Account 1234567890'", () => {
  const m = detectPii("Account 1234567890 was found in legacy system.");
  assert.equal(m?.kind, "account_number");
});

test("account_number: detects DE 'Kundennummer 99887766'", () => {
  const m = detectPii("Kundennummer 99887766 ist gesperrt.");
  assert.equal(m?.kind, "account_number");
});

test("account_number: does NOT trigger on a bare digit run with no label", () => {
  const m = detectPii("Job duration was 1234567890 ms.");
  assert.equal(m, null);
});

test("national_id: detects Swiss AHV 756.1234.5678.97", () => {
  const m = detectPii("AHV-Nummer 756.1234.5678.97 vorgelegt.");
  assert.equal(m?.kind, "national_id");
});

test("national_id: detects Swedish personnummer 19850312-1234", () => {
  const m = detectPii("Pnr 19850312-1234 verified.");
  assert.equal(m?.kind, "national_id");
});

test("special_category: flags GDPR Art.9 health keyword (HIV)", () => {
  const m = detectPii("Patient HIV status confirmed in 2024.");
  assert.equal(m?.kind, "special_category");
});

test("special_category: flags GDPR Art.9 union-membership keyword (DE)", () => {
  const m = detectPii("Mitglied einer Gewerkschaft seit 2018.");
  assert.equal(m?.kind, "special_category");
});

test("special_category: flags sexual-orientation keyword", () => {
  const m = detectPii("self-identified as bisexual on the form.");
  assert.equal(m?.kind, "special_category");
});

test("special_category: does NOT trigger on technical prose containing 'union'", () => {
  const m = detectPii(
    "TypeScript discriminated union types compile to runtime JSON.",
  );
  assert.equal(m, null);
});

// ---------------------------------------------------------------------------
// Word-boundary integrity for the special_category detector
// (PR #1724 follow-up, audit-2026-05). Common business prose that *contains*
// substrings of GDPR Art. 9 keywords MUST NOT be flagged. Without these
// tests, a future regex tweak that accidentally drops the `\b` anchors
// would silently re-classify benign emails / changelogs as
// special_category PII.
// ---------------------------------------------------------------------------

test("special_category: 'cancer' must NOT trigger inside 'cancellation'", () => {
  for (const benign of [
    "Please confirm cancellation of order #42",
    "Subscription cancellation policy under review",
    "After cancellation the resource is freed",
  ]) {
    assert.equal(
      detectPii(benign),
      null,
      `false positive for benign cancellation prose: ${benign}`,
    );
  }
});

test("special_category: 'krebs' must NOT trigger inside 'krebsforschung'", () => {
  for (const benign of [
    "Krebsforschung GmbH ist seit 2010 unser Partner",
    "Spende an die Deutsche Krebsforschungsstiftung",
    "Die Krebsforschungsabteilung wurde umstrukturiert",
  ]) {
    assert.equal(
      detectPii(benign),
      null,
      `false positive for benign krebsforschung prose: ${benign}`,
    );
  }
});

test("special_category: extra word-boundary cases for compound and adjacent forms", () => {
  // Each entry contains a benign substring that happens to share a prefix
  // or appear next to a GDPR Art. 9 keyword. None of them form a whole-
  // word match, so `\b` anchors must keep them silent.
  for (const benign of [
    "Krebsdiagnose-Modul (legacy code path)",
    "Krebsregister-Schnittstelle dokumentiert",
    "the AIDStrategy committee met on Tuesday",
    "Schwangerschaftstest-Komponente refaktoriert",
    "diabetestest__module is unused",
    "religion_id is a foreign key",
  ]) {
    assert.equal(
      detectPii(benign),
      null,
      `false positive for benign compound: ${benign}`,
    );
  }
});

// ---------------------------------------------------------------------------
// ReDoS hard input-length cap (Issue #1668 follow-up, PR #1724 review).
// The new GDPR detectors use `\p{L}+` and nested alternations which carry
// catastrophic-backtracking risk on adversarial input. The detector
// declares a 16 KiB hard refusal cap; for any input above that cap the
// caller MUST get back `null` in <50 ms regardless of regex shape.
// ---------------------------------------------------------------------------

test("detectPii: refuses input > 16 KiB and returns null in well under 50ms (ReDoS guard)", () => {
  // 100 KB is well above both the upstream Jira/custom-context byte cap
  // and the detector's own 16 KiB hard cap. The pattern of the input is
  // a worst-case shape for the postal_address regex: long Unicode-letter
  // runs interspersed with digit runs that the engine could otherwise
  // explore exponentially.
  const segment = "Müllerstrasse 1234 Berliner ".repeat(20);
  const adversarial = (segment + "0123456789 ".repeat(40)).repeat(150);
  assert.ok(
    Buffer.byteLength(adversarial, "utf8") > 100 * 1024,
    `input must exceed 100 KiB; was ${Buffer.byteLength(adversarial, "utf8")} bytes`,
  );
  const start = process.hrtime.bigint();
  const result = detectPii(adversarial);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(result, null, "input above the 16 KiB cap must be refused");
  assert.ok(
    elapsedMs < 50,
    `detectPii must short-circuit in <50ms (ReDoS guard); took ${elapsedMs.toFixed(2)}ms`,
  );
});

test("detectPii: 32 KiB adversarial postal-address-shaped input completes in <50ms (ReDoS guard)", () => {
  // Even when the input is slightly above the cap, the byte-length check
  // must short-circuit before the regex engine sees the haystack.
  const adversarial = "A".repeat(32 * 1024) + "Musterstraße 12, 10115 Berlin";
  const start = process.hrtime.bigint();
  const result = detectPii(adversarial);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  assert.equal(result, null);
  assert.ok(
    elapsedMs < 50,
    `detectPii must short-circuit in <50ms (ReDoS guard); took ${elapsedMs.toFixed(2)}ms`,
  );
});
