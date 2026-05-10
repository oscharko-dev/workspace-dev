import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  deriveLocaleFromScreen,
  deriveLocaleFromBusinessTestIntentScreen,
  isSupportedLocale,
  LOCALE_CALIBRATION_FALLBACK_KEY,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locale-calibration.js";
import type { BusinessTestIntentScreen } from "../contracts/index.js";

const FIXTURES_DIR = join(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../../fixtures/test-intelligence/per-locale-calibration",
);

// ---------------------------------------------------------------------------
// isSupportedLocale
// ---------------------------------------------------------------------------

test("locale-calibration: isSupportedLocale returns true for all six codes", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(isSupportedLocale(locale), true, `Expected ${locale} to be supported`);
  }
});

test("locale-calibration: isSupportedLocale returns false for unknown codes", () => {
  assert.equal(isSupportedLocale("EN-US"), false);
  assert.equal(isSupportedLocale("de"), false);
  assert.equal(isSupportedLocale(""), false);
  assert.equal(isSupportedLocale("default"), false);
});

test("locale-calibration: LOCALE_CALIBRATION_FALLBACK_KEY is not a SupportedLocale", () => {
  assert.equal(isSupportedLocale(LOCALE_CALIBRATION_FALLBACK_KEY), false);
});

// ---------------------------------------------------------------------------
// deriveLocaleFromScreen — direct SupportedLocale match (Rule 1)
// ---------------------------------------------------------------------------

test("locale-calibration: exact SupportedLocale in screenLocale is returned as-is", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(
      deriveLocaleFromScreen({ screenLocale: locale }),
      locale,
      `Expected exact match for ${locale}`,
    );
  }
});

// ---------------------------------------------------------------------------
// deriveLocaleFromScreen — 2-letter primary-tag promotion (Rule 2)
// ---------------------------------------------------------------------------

test("locale-calibration: 2-letter primary tag 'de' promotes to DE-DE", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "de" }), "DE-DE");
});

test("locale-calibration: 2-letter primary tag 'fr' promotes to FR-FR", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "fr" }), "FR-FR");
});

test("locale-calibration: 2-letter primary tag 'it' promotes to IT-IT", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "it" }), "IT-IT");
});

test("locale-calibration: 2-letter primary tag 'en' promotes to EN-IE (EU banking default)", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "en" }), "EN-IE");
});

// ---------------------------------------------------------------------------
// deriveLocaleFromScreen — IBAN prefix (Rule 3)
// ---------------------------------------------------------------------------

test("locale-calibration: IBAN prefix AT maps to DE-AT", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["AT123456789"] }),
    "DE-AT",
  );
});

test("locale-calibration: IBAN prefix CH maps to DE-CH", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["CH5604835012345678009"] }),
    "DE-CH",
  );
});

test("locale-calibration: IBAN prefix DE maps to DE-DE", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["DE89370400440532013000"] }),
    "DE-DE",
  );
});

test("locale-calibration: IBAN prefix FR maps to FR-FR", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["FR7630006000011234567890189"] }),
    "FR-FR",
  );
});

test("locale-calibration: IBAN prefix IE maps to EN-IE", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["IE29AIBK93115212345678"] }),
    "EN-IE",
  );
});

test("locale-calibration: IBAN prefix IT maps to IT-IT", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["IT60X0542811101000000123456"] }),
    "IT-IT",
  );
});

// ---------------------------------------------------------------------------
// deriveLocaleFromScreen — keyword heuristics (Rule 4)
// ---------------------------------------------------------------------------

test("locale-calibration: Sozialversicherungsnummer keyword maps to DE-AT", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Sozialversicherungsnummer"] }),
    "DE-AT",
  );
});

test("locale-calibration: UID-Nummer ATU keyword maps to DE-AT", () => {
  assert.equal(
    deriveLocaleFromScreen({ fieldLabels: ["UID-Nummer ATU"] }),
    "DE-AT",
  );
});

test("locale-calibration: AHV-Nummer keyword maps to DE-CH", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["AHV-Nummer"] }),
    "DE-CH",
  );
});

test("locale-calibration: Champ obligatoire keyword maps to FR-FR", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Champ obligatoire"] }),
    "FR-FR",
  );
});

test("locale-calibration: Numéro de TVA FR keyword maps to FR-FR", () => {
  assert.equal(
    deriveLocaleFromScreen({ fieldLabels: ["Numéro de TVA FR"] }),
    "FR-FR",
  );
});

test("locale-calibration: Codice Fiscale keyword maps to IT-IT", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Codice Fiscale"] }),
    "IT-IT",
  );
});

test("locale-calibration: Partita IVA IT keyword maps to IT-IT", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Partita IVA IT"] }),
    "IT-IT",
  );
});

test("locale-calibration: Campo obbligatorio keyword maps to IT-IT", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Campo obbligatorio"] }),
    "IT-IT",
  );
});

test("locale-calibration: Eircode keyword maps to EN-IE", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Eircode"] }),
    "EN-IE",
  );
});

test("locale-calibration: PPS Number keyword maps to EN-IE", () => {
  assert.equal(
    deriveLocaleFromScreen({ fieldLabels: ["PPS Number"] }),
    "EN-IE",
  );
});

test("locale-calibration: Required field keyword maps to EN-IE", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Required field"] }),
    "EN-IE",
  );
});

test("locale-calibration: Pflichtfeld alone maps to DE-DE", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Pflichtfeld"] }),
    "DE-DE",
  );
});

// ---------------------------------------------------------------------------
// deriveLocaleFromScreen — returns undefined for non-matching input
// ---------------------------------------------------------------------------

test("locale-calibration: returns undefined for empty input", () => {
  assert.equal(deriveLocaleFromScreen({}), undefined);
});

test("locale-calibration: returns undefined for unrecognised screenLocale", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "xx-XX" }), undefined);
  assert.equal(deriveLocaleFromScreen({ screenLocale: "zh" }), undefined);
});

test("locale-calibration: returns undefined for non-matching keywords", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["required", "max length 100"] }),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// deriveLocaleFromBusinessTestIntentScreen
// ---------------------------------------------------------------------------

test("locale-calibration: deriveLocaleFromBusinessTestIntentScreen reads screen.locale", () => {
  const screen: BusinessTestIntentScreen = {
    screenId: "s1",
    screenName: "Test",
    locale: "FR-FR",
    trace: { nodeId: "s1" },
  };
  assert.equal(deriveLocaleFromBusinessTestIntentScreen(screen), "FR-FR");
});

test("locale-calibration: deriveLocaleFromBusinessTestIntentScreen falls back to supplementary", () => {
  const screen: BusinessTestIntentScreen = {
    screenId: "s1",
    screenName: "Test",
    trace: { nodeId: "s1" },
  };
  assert.equal(
    deriveLocaleFromBusinessTestIntentScreen(screen, {
      validations: ["Champ obligatoire"],
    }),
    "FR-FR",
  );
});

test("locale-calibration: deriveLocaleFromBusinessTestIntentScreen returns undefined when nothing matches", () => {
  const screen: BusinessTestIntentScreen = {
    screenId: "s1",
    screenName: "Test",
    trace: { nodeId: "s1" },
  };
  assert.equal(deriveLocaleFromBusinessTestIntentScreen(screen), undefined);
});

// ---------------------------------------------------------------------------
// Fixture-based smoke tests: each fixture file resolves to the expected locale
// ---------------------------------------------------------------------------

test("locale-calibration: fixture DE-AT resolves to DE-AT via keywords", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-AT.figma.json"), "utf8")) as {
    locale: SupportedLocale;
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ screenLocale: raw.locale, validationStrings: validations, fieldLabels: labels }),
    "DE-AT",
  );
});

test("locale-calibration: fixture DE-CH resolves to DE-CH via keywords", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-CH.figma.json"), "utf8")) as {
    locale: SupportedLocale;
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ screenLocale: raw.locale, validationStrings: validations, fieldLabels: labels }),
    "DE-CH",
  );
});

test("locale-calibration: fixture DE-DE resolves to DE-DE via locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-DE.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "DE-DE");
});

test("locale-calibration: fixture EN-IE resolves to EN-IE via keywords", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "EN-IE.figma.json"), "utf8")) as {
    locale: SupportedLocale;
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ screenLocale: raw.locale, validationStrings: validations, fieldLabels: labels }),
    "EN-IE",
  );
});

test("locale-calibration: fixture FR-FR resolves to FR-FR via locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "FR-FR.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "FR-FR");
});

test("locale-calibration: fixture IT-IT resolves to IT-IT via locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "IT-IT.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "IT-IT");
});
