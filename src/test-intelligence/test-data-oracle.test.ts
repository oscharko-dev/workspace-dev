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
