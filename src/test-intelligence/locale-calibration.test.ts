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
  // Common near-misses for the Issue #2188 locales.
  assert.equal(isSupportedLocale("CZ-CZ"), false); // language tag is `cs`, not `cz`
  assert.equal(isSupportedLocale("PL"), false);
});

test("locale-calibration: SUPPORTED_LOCALES covers all eleven locales (Issue #2117 + #2188)", () => {
  assert.deepEqual(
    [...SUPPORTED_LOCALES].sort(),
    [
      "CS-CZ",
      "DE-AT",
      "DE-CH",
      "DE-DE",
      "EN-IE",
      "ES-ES",
      "FR-FR",
      "HU-HU",
      "IT-IT",
      "NL-NL",
      "PL-PL",
    ],
  );
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

// Issue #2188 — extended locale primary-tag promotions.
test("locale-calibration: 2-letter primary tag 'pl' promotes to PL-PL", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "pl" }), "PL-PL");
});

test("locale-calibration: 2-letter primary tag 'es' promotes to ES-ES", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "es" }), "ES-ES");
});

test("locale-calibration: 2-letter primary tag 'nl' promotes to NL-NL", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "nl" }), "NL-NL");
});

test("locale-calibration: 2-letter primary tag 'cs' promotes to CS-CZ", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "cs" }), "CS-CZ");
});

test("locale-calibration: 2-letter primary tag 'hu' promotes to HU-HU", () => {
  assert.equal(deriveLocaleFromScreen({ screenLocale: "hu" }), "HU-HU");
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

// Issue #2188 — IBAN prefixes for the five extended locales.
test("locale-calibration: IBAN prefix PL maps to PL-PL", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["PL61109010140000071219812874"] }),
    "PL-PL",
  );
});

test("locale-calibration: IBAN prefix ES maps to ES-ES", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["ES9121000418450200051332"] }),
    "ES-ES",
  );
});

test("locale-calibration: IBAN prefix NL maps to NL-NL", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["NL91ABNA0417164300"] }),
    "NL-NL",
  );
});

test("locale-calibration: IBAN prefix CZ maps to CS-CZ", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["CZ6508000000192000145399"] }),
    "CS-CZ",
  );
});

test("locale-calibration: IBAN prefix HU maps to HU-HU", () => {
  assert.equal(
    deriveLocaleFromScreen({ ibanPrefixes: ["HU42117730161111101800000000"] }),
    "HU-HU",
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

// Issue #2188 — keyword heuristics for the five extended locales.
test("locale-calibration: Pole wymagane keyword maps to PL-PL", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Pole wymagane"] }),
    "PL-PL",
  );
});

test("locale-calibration: PESEL keyword maps to PL-PL", () => {
  assert.equal(deriveLocaleFromScreen({ fieldLabels: ["PESEL"] }), "PL-PL");
});

test("locale-calibration: Campo obligatorio keyword maps to ES-ES", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Campo obligatorio"] }),
    "ES-ES",
  );
});

test("locale-calibration: DNI keyword maps to ES-ES", () => {
  assert.equal(deriveLocaleFromScreen({ fieldLabels: ["DNI"] }), "ES-ES");
});

test("locale-calibration: Campo obbligatorio (IT) still maps to IT-IT, not ES-ES", () => {
  // The single-character distinction must keep working: IT comes before ES.
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Campo obbligatorio"] }),
    "IT-IT",
  );
});

test("locale-calibration: Verplicht veld keyword maps to NL-NL", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Verplicht veld"] }),
    "NL-NL",
  );
});

test("locale-calibration: BSN keyword maps to NL-NL", () => {
  assert.equal(deriveLocaleFromScreen({ fieldLabels: ["BSN"] }), "NL-NL");
});

test("locale-calibration: Povinné pole keyword maps to CS-CZ", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Povinné pole"] }),
    "CS-CZ",
  );
});

test("locale-calibration: Rodné číslo keyword maps to CS-CZ", () => {
  assert.equal(
    deriveLocaleFromScreen({ fieldLabels: ["Rodné číslo"] }),
    "CS-CZ",
  );
});

test("locale-calibration: Kötelező mező keyword maps to HU-HU", () => {
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: ["Kötelező mező"] }),
    "HU-HU",
  );
});

test("locale-calibration: Adószám keyword maps to HU-HU", () => {
  assert.equal(deriveLocaleFromScreen({ fieldLabels: ["Adószám"] }), "HU-HU");
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

// DE-AT, DE-CH, EN-IE: keyword-path tests — screenLocale is intentionally
// omitted so Rule 1 does not short-circuit and the keyword heuristic is
// actually exercised.  The fixture still carries a locale field for
// documentation purposes, but the test ignores it.

test("locale-calibration: fixture DE-AT resolves to DE-AT via keyword heuristic", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-AT.figma.json"), "utf8")) as {
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: validations, fieldLabels: labels }),
    "DE-AT",
  );
});

test("locale-calibration: fixture DE-CH resolves to DE-CH via keyword heuristic", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-CH.figma.json"), "utf8")) as {
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: validations, fieldLabels: labels }),
    "DE-CH",
  );
});

// DE-DE, FR-FR, IT-IT: smoke tests for direct locale-tag resolution (Rule 1).
// These fixtures carry the locale field and the tests pass it directly.

test("locale-calibration: fixture DE-DE resolves to DE-DE via direct locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "DE-DE.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "DE-DE");
});

test("locale-calibration: fixture EN-IE resolves to EN-IE via keyword heuristic", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "EN-IE.figma.json"), "utf8")) as {
    nodes: Array<{ validations?: string[]; nodeName?: string }>;
  };
  const validations = raw.nodes.flatMap((n) => n.validations ?? []);
  const labels = raw.nodes.map((n) => n.nodeName ?? "");
  assert.equal(
    deriveLocaleFromScreen({ validationStrings: validations, fieldLabels: labels }),
    "EN-IE",
  );
});

test("locale-calibration: fixture FR-FR resolves to FR-FR via direct locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "FR-FR.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "FR-FR");
});

test("locale-calibration: fixture IT-IT resolves to IT-IT via direct locale tag", async () => {
  const raw = JSON.parse(await readFile(join(FIXTURES_DIR, "IT-IT.figma.json"), "utf8")) as {
    locale: SupportedLocale;
  };
  assert.equal(deriveLocaleFromScreen({ screenLocale: raw.locale }), "IT-IT");
});

// Issue #2188 — fixture smoke tests for the five extended locales via the
// keyword heuristic (screenLocale is intentionally omitted so the heuristic
// is actually exercised).

const KEYWORD_FIXTURES: ReadonlyArray<[SupportedLocale, string]> = [
  ["PL-PL", "PL-PL.figma.json"],
  ["ES-ES", "ES-ES.figma.json"],
  ["NL-NL", "NL-NL.figma.json"],
  ["CS-CZ", "CS-CZ.figma.json"],
  ["HU-HU", "HU-HU.figma.json"],
];

for (const [expected, filename] of KEYWORD_FIXTURES) {
  test(`locale-calibration: fixture ${expected} resolves to ${expected} via keyword heuristic`, async () => {
    const raw = JSON.parse(await readFile(join(FIXTURES_DIR, filename), "utf8")) as {
      nodes: Array<{ validations?: string[]; nodeName?: string }>;
    };
    const validations = raw.nodes.flatMap((n) => n.validations ?? []);
    const labels = raw.nodes.map((n) => n.nodeName ?? "");
    assert.equal(
      deriveLocaleFromScreen({ validationStrings: validations, fieldLabels: labels }),
      expected,
    );
  });
}
