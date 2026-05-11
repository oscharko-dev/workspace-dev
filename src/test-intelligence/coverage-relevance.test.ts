import assert from "node:assert/strict";
import test from "node:test";

import {
  isCoverageRelevantActionLike,
  isCoverageRelevantElementLike,
  normalizeCoverageText,
} from "./coverage-relevance.js";

test("coverage-relevance > filters single angle-bracket placeholders such as <Radio>", () => {
  assert.equal(isCoverageRelevantElementLike({ label: "<Radio>" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "<TextField>" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "<Select>" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "<Button>" }), false);
});

test("coverage-relevance > filters compound structural placeholders that mix bracketed components", () => {
  assert.equal(
    isCoverageRelevantElementLike({
      label: "<Stack> FormControlLabel | Radio",
    }),
    false,
  );
  assert.equal(
    isCoverageRelevantElementLike({ label: "<Stack>FormControlLabel|Radio" }),
    false,
  );
});

test("coverage-relevance > filters standalone unit and currency labels", () => {
  assert.equal(isCoverageRelevantElementLike({ label: "EUR" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "€" }), false);
});

test("coverage-relevance > filters value-only labels including the standard EUR/percent suffixes", () => {
  assert.equal(isCoverageRelevantElementLike({ label: "45.000,00" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "50.000,00 €" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "19,00 %" }), false);
});

test("coverage-relevance > filters known decorative labels including Text and (optional)", () => {
  assert.equal(isCoverageRelevantElementLike({ label: "Text" }), false);
  assert.equal(isCoverageRelevantElementLike({ label: "(optional)" }), false);
  assert.equal(
    isCoverageRelevantElementLike({ label: "Alternativtext" }),
    false,
  );
  assert.equal(isCoverageRelevantElementLike({ label: "" }), false);
});

test("coverage-relevance > filters decorative kinds even when the label is non-empty", () => {
  assert.equal(
    isCoverageRelevantElementLike({ label: "x", kind: "icon" }),
    false,
  );
  assert.equal(
    isCoverageRelevantElementLike({ label: "x", kind: "decorative" }),
    false,
  );
});

test("coverage-relevance > keeps meaningful business labels intact", () => {
  assert.equal(
    isCoverageRelevantElementLike({
      label: "Höhe des Kaufpreises (Netto)",
      kind: "text_input",
    }),
    true,
  );
  assert.equal(
    isCoverageRelevantElementLike({
      label: "Wie soll der Kaufpreis erfasst werden?",
      kind: "text",
    }),
    true,
  );
  assert.equal(isCoverageRelevantElementLike({ label: "Netto" }), true);
  assert.equal(isCoverageRelevantElementLike({ label: "Brutto" }), true);
  assert.equal(
    isCoverageRelevantElementLike({
      label: "Die MwSt. ist nicht Teil des Finanzierungsbedarfs.",
    }),
    true,
  );
  assert.equal(
    isCoverageRelevantElementLike({
      label: "Finanzierungsbedarf des Investitionsobjekts",
    }),
    true,
  );
});

test("coverage-relevance > filters bracketed placeholder action labels", () => {
  assert.equal(isCoverageRelevantActionLike({ label: "<Radio>" }), false);
});

test("coverage-relevance > keeps meaningful actions", () => {
  assert.equal(
    isCoverageRelevantActionLike({
      label: "Berechnen",
      kind: "submit",
      targetScreenId: "1:200",
    }),
    true,
  );
});

test("coverage-relevance > normalizeCoverageText trims, collapses whitespace, and lowercases", () => {
  assert.equal(normalizeCoverageText("  Hello   World  "), "hello world");
  assert.equal(normalizeCoverageText(undefined), "");
});
