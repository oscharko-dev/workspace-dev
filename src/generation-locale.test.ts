import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGenerationLocale, resolveGenerationLocale, DEFAULT_GENERATION_LOCALE } from "./generation-locale.js";

test("normalizeGenerationLocale: returns canonical form for valid locales", () => {
  assert.equal(normalizeGenerationLocale("en-US"), "en-US");
  assert.equal(normalizeGenerationLocale("de-DE"), "de-DE");
  assert.equal(normalizeGenerationLocale("fr-FR"), "fr-FR");
});

test("normalizeGenerationLocale: trims whitespace before canonicalization", () => {
  assert.equal(normalizeGenerationLocale("  en-US  "), "en-US");
  assert.equal(normalizeGenerationLocale("\ten-US\n"), "en-US");
});

test("normalizeGenerationLocale: canonicalizes case variants", () => {
  assert.equal(normalizeGenerationLocale("EN-us"), "en-US");
  assert.equal(normalizeGenerationLocale("en-us"), "en-US");
  assert.equal(normalizeGenerationLocale("DE-de"), "de-DE");
});

test("normalizeGenerationLocale: rejects empty and whitespace-only inputs", () => {
  assert.equal(normalizeGenerationLocale(""), undefined);
  assert.equal(normalizeGenerationLocale("   "), undefined);
  assert.equal(normalizeGenerationLocale(undefined), undefined);
});

test("normalizeGenerationLocale: rejects invalid locale syntax", () => {
  assert.equal(normalizeGenerationLocale("not-a-locale"), undefined);
  assert.equal(normalizeGenerationLocale("en_US"), undefined);
  assert.equal(normalizeGenerationLocale("123"), undefined);
  assert.equal(normalizeGenerationLocale("x"), undefined);
});

test("normalizeGenerationLocale: rejects unsupported locale codes", () => {
  assert.equal(normalizeGenerationLocale("zz-ZZ"), undefined);
});

test("resolveGenerationLocale: returns requested locale when valid", () => {
  const result = resolveGenerationLocale({ requestedLocale: "en-US" });
  assert.equal(result.locale, "en-US");
  assert.equal(result.usedFallback, false);
});

test("resolveGenerationLocale: falls back to default for invalid input", () => {
  const result = resolveGenerationLocale({ requestedLocale: "invalid" });
  assert.equal(result.locale, DEFAULT_GENERATION_LOCALE);
  assert.equal(result.usedFallback, true);
});

test("resolveGenerationLocale: falls back to default when locale is omitted", () => {
  const result = resolveGenerationLocale({ requestedLocale: undefined });
  assert.equal(result.locale, DEFAULT_GENERATION_LOCALE);
  assert.equal(result.usedFallback, false);
});

test("resolveGenerationLocale: uses custom fallback locale when provided", () => {
  const result = resolveGenerationLocale({ requestedLocale: "invalid", fallbackLocale: "fr-FR" });
  assert.equal(result.locale, "fr-FR");
  assert.equal(result.usedFallback, true);
});

test("DEFAULT_GENERATION_LOCALE is de-DE", () => {
  assert.equal(DEFAULT_GENERATION_LOCALE, "de-DE");
});
