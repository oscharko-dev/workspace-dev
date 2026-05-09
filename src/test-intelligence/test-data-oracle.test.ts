import assert from "node:assert/strict";
import test from "node:test";

import {
  formatOracleValueAsTestDataEntry,
  resolveTestData,
} from "./test-data-oracle.js";

const ANCHOR = new Date("2026-05-09T00:00:00.000Z");

test("test-data-oracle: numeric range emits min/mid/max + below-min/above-max invalids", () => {
  const r = resolveTestData({
    fieldLabel: "Kreditbetrag",
    validations: ["Required", "Numeric in range 1000..50000"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return; // type narrow
  assert.equal(r.valid.length, 3);
  assert.equal(r.invalid.length, 2);
  const validValues = r.valid.map((v) => v.value);
  const invalidValues = r.invalid.map((v) => v.value);
  assert.deepEqual(validValues, ["1000.00", "25500.00", "50000.00"]);
  assert.deepEqual(invalidValues, ["999.99", "50000.01"]);
});

test("test-data-oracle: integer >= 1 boundary uses integer step (no decimals)", () => {
  const r = resolveTestData({
    fieldLabel: "Stueck",
    validations: ["Integer >= 1"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  assert.ok(r.valid.length >= 1);
  assert.equal(r.valid[0]?.value, "1");
  assert.equal(r.invalid.length, 1);
  assert.equal(r.invalid[0]?.value, "0");
});

test("test-data-oracle: numeric > 0 emits 0.01 as boundary_min and 0 as invalid", () => {
  const r = resolveTestData({
    fieldLabel: "Betrag (EUR)",
    validations: ["Required", "Numeric > 0", "Max 2 decimals"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  const validValues = r.valid.map((v) => v.value);
  const invalidValues = r.invalid.map((v) => v.value);
  assert.ok(validValues.includes("0.01"));
  assert.ok(invalidValues.includes("0.00"));
});

test("test-data-oracle: fixed length emits exact-len valid and len-1 / len+1 invalids", () => {
  const r = resolveTestData({
    fieldLabel: "PLZ",
    validations: ["Required", "Length 5", "Numeric"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  // Length-5 emits one valid (5 chars) and two invalids (4, 6 chars)
  const lenSamples = r.valid.find((v) => v.rule === "Length 5");
  assert.equal(lenSamples?.value.length, 5);
  const lenInvalids = r.invalid.filter((v) => v.rule === "Length 5");
  const lengths = lenInvalids.map((v) => v.value.length).sort();
  assert.deepEqual(lengths, [4, 6]);
});

test("test-data-oracle: ISO date <= today emits today + 1y past valid + tomorrow invalid", () => {
  const r = resolveTestData({
    fieldLabel: "Schadendatum",
    validations: ["Required", "ISO date", "Date <= today"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  // Anchor is 2026-05-09; bound matcher emits boundary_max = today
  const boundaryMax = r.valid.find(
    (v) => v.rule === "Date <= today" && v.category === "boundary_max",
  );
  assert.equal(boundaryMax?.value, "2026-05-09");
  // Above-max invalid is tomorrow
  const aboveMax = r.invalid.find(
    (v) => v.rule === "Date <= today" && v.category === "above_max_invalid",
  );
  assert.equal(aboveMax?.value, "2026-05-10");
});

test("test-data-oracle: IBAN format emits documentation IBAN (not invented)", () => {
  const r = resolveTestData({
    fieldLabel: "IBAN",
    validations: ["Required", "IBAN format with Mod-97 checksum"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  const validValues = r.valid.map((v) => v.value);
  // Bundesbank Testbank-IBAN
  assert.ok(validValues.includes("DE89370400440532013000"));
  // Provenance must record this is a documentation example
  assert.ok(
    r.provenance.some((p) => p.includes("public documentation IBAN")),
  );
});

test("test-data-oracle: ISIN format emits documentation ISIN", () => {
  const r = resolveTestData({
    fieldLabel: "ISIN",
    validations: ["Required", "ISIN format with check digit"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  assert.ok(r.valid.some((v) => v.value === "DE000BASF111"));
});

test("test-data-oracle: presence-only rules without bounds return openQuestion (no inventing)", () => {
  const r = resolveTestData({
    fieldLabel: "Beruf",
    validations: ["Required"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, false);
  if (r.resolvable !== false) return;
  assert.ok(r.openQuestion.length > 0);
  assert.ok(r.openQuestion.includes("Beruf"));
});

test("test-data-oracle: conditional 'Required if X is Yes' is unresolvable (no concrete value invented)", () => {
  const r = resolveTestData({
    fieldLabel: "Termin-Slot",
    validations: ["Required if Verfahren is VideoIdent"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, false);
  if (r.resolvable !== false) return;
  assert.ok(r.openQuestion.includes("Termin-Slot"));
  assert.ok(r.openQuestion.includes("Required if Verfahren is VideoIdent"));
});

test("test-data-oracle: computed-value rules surface as openQuestion (rubric forbids inventing concrete numbers)", () => {
  const r = resolveTestData({
    fieldLabel: "Monthly Payment",
    validations: [
      "Computed = principal * (rate/12) / (1 - (1 + rate/12)^(-12*years))",
    ],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, false);
});

test("test-data-oracle: deterministic across calls (same inputs -> byte-identical outputs)", () => {
  const args = {
    fieldLabel: "Kreditbetrag",
    validations: ["Required", "Numeric in range 1000..50000"],
    now: ANCHOR,
  };
  const a = resolveTestData(args);
  const b = resolveTestData(args);
  assert.deepEqual(a, b);
});

test("test-data-oracle: formatOracleValueAsTestDataEntry produces deterministic provenance string", () => {
  const r = resolveTestData({
    fieldLabel: "Kreditbetrag",
    validations: ["Numeric in range 1000..50000"],
    now: ANCHOR,
  });
  if (r.resolvable !== true) {
    assert.fail("expected resolvable");
    return;
  }
  const entry = formatOracleValueAsTestDataEntry(
    "Kreditbetrag",
    r.valid[0]!,
  );
  assert.equal(
    entry,
    'Kreditbetrag: 1000.00 (boundary_min; from rule "Numeric in range 1000..50000")',
  );
});

test("test-data-oracle: ISO datetime + Date >= today + 1 day combination resolves to documented future date", () => {
  const r = resolveTestData({
    fieldLabel: "Termin-Slot",
    validations: [
      "Required if Verfahren is VideoIdent",
      "ISO datetime",
      "Date >= today + 1 day",
    ],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  // Anchor 2026-05-09 + 1 day = 2026-05-10 as boundary_min for the
  // date-bound rule; ISO datetime emits the format-valid sample.
  const boundaryMin = r.valid.find(
    (v) =>
      v.rule === "Date >= today + 1 day" &&
      v.category === "boundary_min",
  );
  assert.equal(boundaryMin?.value, "2026-05-10");
});

test("test-data-oracle: long Max-N-characters values are chunked so they cannot trip the base64 heuristic (issue #2087)", () => {
  // The validation harness flags 64+ contiguous base64-alphabet characters
  // as `encoded_payload_base64`. A naive `"x".repeat(500)` would be 500
  // contiguous `x` chars and trip the detector. The oracle must emit
  // chunked filler that breaks the contiguous run with non-base64 chars
  // (whitespace) so legitimate long boundary samples are not mistaken for
  // exfiltrated payloads.
  const r = resolveTestData({
    fieldLabel: "Schadenbeschreibung",
    validations: ["Required", "Max 500 characters"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  const boundaryMax = r.valid.find(
    (v) => v.rule === "Max 500 characters" && v.category === "boundary_max",
  );
  assert.equal(boundaryMax?.value.length, 500);
  // No 64+ contiguous run of base64-alphabet characters anywhere in the
  // value — the chunked filler caps any single run at 16 (one trailing
  // x is appended when the requested length is a multiple of 16).
  assert.doesNotMatch(boundaryMax?.value ?? "", /[A-Za-z0-9+/]{64,}/u);
  // The above-max invalid is also chunked so the invalidation sample
  // itself does not silently get blocked by the same gate.
  const aboveMax = r.invalid.find(
    (v) => v.rule === "Max 500 characters" && v.category === "above_max_invalid",
  );
  assert.equal(aboveMax?.value.length, 501);
  assert.doesNotMatch(aboveMax?.value ?? "", /[A-Za-z0-9+/]{64,}/u);
});

test("test-data-oracle: short fixed-length values stay as a contiguous run (no whitespace splice for len <= 16)", () => {
  // For len <= 16 we MUST keep the legacy `"x".repeat(N)` form so
  // length-N-character invariants (PLZ length 5, Steuer-ID length 11) are
  // not silently broken by an embedded space. 16 is well below the
  // base64-heuristic floor of 64, so contiguity is safe at this scale.
  const r = resolveTestData({
    fieldLabel: "Steuer-ID",
    validations: ["Required", "Length 11"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  const sample = r.valid.find((v) => v.rule === "Length 11");
  assert.equal(sample?.value, "xxxxxxxxxxx");
});

test("test-data-oracle: documentation-example test-data entries carry a redaction-token sentinel so the PII validator skips them", () => {
  // The Bundesbank Testbank IBAN is, syntactically, a well-formed IBAN
  // (Mod-97 valid) — the strict PII detector flags it even though it is
  // a public documentation placeholder. We tag the rendered test-data
  // entry with `[REDACTED:DOC_EXAMPLE]` so `looksLikeRedactionToken` in
  // `test-case-validation.ts` short-circuits the scan, keeping the
  // underlying oracle value (`DE89370400440532013000`) intact for all
  // cross-component redaction tests that assert on the literal.
  const r = resolveTestData({
    fieldLabel: "IBAN",
    validations: ["Required", "IBAN format with Mod-97 checksum"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  const docExample = r.valid.find(
    (v) => v.category === "documentation_example",
  );
  assert.ok(docExample !== undefined);
  // Underlying value is unchanged.
  assert.equal(docExample?.value, "DE89370400440532013000");
  // Rendered entry carries the redaction-token sentinel.
  const entry = formatOracleValueAsTestDataEntry("IBAN", docExample!);
  assert.match(entry, /\[REDACTED:DOC_EXAMPLE\]\s*$/u);
  assert.ok(entry.includes("DE89370400440532013000"));
  // Non-documentation entries do NOT receive the marker (this would be
  // wrong: a real numeric range value is not a documentation placeholder).
  const r2 = resolveTestData({
    fieldLabel: "Kreditbetrag",
    validations: ["Numeric in range 1000..50000"],
    now: ANCHOR,
  });
  if (r2.resolvable !== true) {
    assert.fail("expected resolvable");
    return;
  }
  const entry2 = formatOracleValueAsTestDataEntry("Kreditbetrag", r2.valid[0]!);
  assert.doesNotMatch(entry2, /\[REDACTED:DOC_EXAMPLE\]/u);
});

test("test-data-oracle: ISO-date / datetime entries carry the redaction-token sentinel so DOB-label collisions do not trip the PII validator", () => {
  // The DOB detector in pii-detection.ts matches when a label keyword
  // (Geburtsdatum / dob / geboren / ...) appears within ~32 chars of an
  // ISO date. The oracle's anchor sample for "ISO date" is `today`,
  // which combined with `Geburtsdatum:` flips the heuristic on a
  // synthesized boundary value. The rendered entry must carry the
  // redaction-token sentinel so the validator skips it.
  const r = resolveTestData({
    fieldLabel: "Geburtsdatum",
    validations: ["Required", "ISO date", "Date implies age >= 18"],
    now: ANCHOR,
  });
  assert.equal(r.resolvable, true);
  if (r.resolvable !== true) return;
  for (const v of r.valid) {
    if (v.rule === "ISO date") {
      const entry = formatOracleValueAsTestDataEntry("Geburtsdatum", v);
      assert.match(
        entry,
        /\[REDACTED:DOC_EXAMPLE\]\s*$/u,
        `format_valid ISO-date entry missing sentinel: ${entry}`,
      );
    }
  }
  for (const v of r.invalid) {
    if (v.rule === "ISO date") {
      const entry = formatOracleValueAsTestDataEntry("Geburtsdatum", v);
      assert.match(
        entry,
        /\[REDACTED:DOC_EXAMPLE\]\s*$/u,
        `format_invalid ISO-date entry missing sentinel: ${entry}`,
      );
    }
  }
  // ISO datetime carries the same sentinel.
  const r2 = resolveTestData({
    fieldLabel: "Termin-Slot",
    validations: ["ISO datetime"],
    now: ANCHOR,
  });
  if (r2.resolvable !== true) {
    assert.fail("expected resolvable");
    return;
  }
  const dt = r2.valid.find((v) => v.rule === "ISO datetime");
  if (dt !== undefined) {
    const entry = formatOracleValueAsTestDataEntry("Termin-Slot", dt);
    assert.match(entry, /\[REDACTED:DOC_EXAMPLE\]\s*$/u);
  }
  // Date-bound rules (Date <= today, Date >= today + 1 day) likewise.
  const r3 = resolveTestData({
    fieldLabel: "Schadendatum",
    validations: ["Date <= today"],
    now: ANCHOR,
  });
  if (r3.resolvable !== true) {
    assert.fail("expected resolvable");
    return;
  }
  for (const v of r3.valid) {
    const entry = formatOracleValueAsTestDataEntry("Schadendatum", v);
    assert.match(entry, /\[REDACTED:DOC_EXAMPLE\]\s*$/u);
  }
});
