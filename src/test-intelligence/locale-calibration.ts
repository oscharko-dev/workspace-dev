/**
 * Per-locale calibration support.
 *
 * Issue #2117 added the initial six EU-banking locales
 * (DE-DE / DE-AT / DE-CH / EN-IE / FR-FR / IT-IT).
 *
 * Issue #2188 extends the corpus with five additional locales
 * (PL-PL Polish, ES-ES Spanish, NL-NL Dutch, CS-CZ Czech, HU-HU Hungarian),
 * each backed by per-locale terminology glossaries, regulator citation
 * maps, and Platt-curve fixture data so the harness can serve the
 * pre-registered EU-banking customer pipeline for those jurisdictions
 * (KNF / Banco de España / DNB / ČNB / MNB).
 *
 * Provides locale identification, derivation heuristics, and the type
 * definitions used by the per-locale Platt-curve fits in
 * `case-confidence-calibrator.ts` and the drift-canary locale dimension.
 *
 * All functions are pure (no I/O, deterministic).
 */

import type { BusinessTestIntentScreen, SupportedLocale } from "../contracts/index.js";

// Re-export so existing importers of this module don't need to change.
export type { SupportedLocale };

// ---------------------------------------------------------------------------
// Locale type surface
// ---------------------------------------------------------------------------

export const SUPPORTED_LOCALES: ReadonlyArray<SupportedLocale> = Object.freeze([
  "DE-DE",
  "DE-AT",
  "DE-CH",
  "EN-IE",
  "FR-FR",
  "IT-IT",
  // Issue #2188 — extended EU-banking corpus.
  "PL-PL",
  "ES-ES",
  "NL-NL",
  "CS-CZ",
  "HU-HU",
] satisfies SupportedLocale[]);

/**
 * The map key used for the aggregate (unseen-locale) fallback curve.
 * Distinct from any `SupportedLocale` value so a `Record<LocaleCalibrationKey, …>`
 * unambiguously separates the fallback entry from real locale entries.
 */
export const LOCALE_CALIBRATION_FALLBACK_KEY = "default" as const;

export type LocaleCalibrationKey =
  | SupportedLocale
  | typeof LOCALE_CALIBRATION_FALLBACK_KEY;

/**
 * Narrow predicate: returns `true` when `value` is one of the six supported
 * locale codes.  Safe to use as a type guard.
 */
export const isSupportedLocale = (value: string): value is SupportedLocale =>
  SUPPORTED_LOCALES.includes(value as SupportedLocale);

// ---------------------------------------------------------------------------
// IBAN-prefix → locale mapping
// ---------------------------------------------------------------------------

/**
 * Country-code prefixes (first two characters of an IBAN) that unambiguously
 * map to one of the supported locales.
 *
 * Issue #2188 extended the table with PL, ES, NL, CZ, HU.
 */
const IBAN_PREFIX_TO_LOCALE: ReadonlyMap<string, SupportedLocale> = new Map([
  ["AT", "DE-AT"],
  ["CH", "DE-CH"],
  ["DE", "DE-DE"],
  ["FR", "FR-FR"],
  ["IE", "EN-IE"],
  ["IT", "IT-IT"],
  // Issue #2188 — extended locales.
  ["PL", "PL-PL"],
  ["ES", "ES-ES"],
  ["NL", "NL-NL"],
  ["CZ", "CS-CZ"],
  ["HU", "HU-HU"],
]);

// ---------------------------------------------------------------------------
// Keyword sets for label/validation heuristics
// ---------------------------------------------------------------------------

// Each set is tested with a case-sensitive substring match because most
// German/French/Italian validation keywords are capitalised consistently
// in Figma node text.

/** Austrian-specific validation keywords (used in the DE-AT heuristic path). */
const DE_AT_KEYWORDS = Object.freeze([
  "Sozialversicherungsnummer",
  "UID-Nummer ATU",
] as const);

const DE_CH_KEYWORDS = Object.freeze([
  "AHV-Nummer",
]);

const DE_DE_KEYWORDS = Object.freeze([
  "Pflichtfeld",   // combined with DE IBAN detection in heuristic order
]);

const FR_FR_KEYWORDS = Object.freeze([
  "Champ obligatoire",
  "Numéro de TVA FR",
]);

const IT_IT_KEYWORDS = Object.freeze([
  "Campo obbligatorio",
  "Codice Fiscale",
  "Partita IVA IT",
]);

const EN_IE_KEYWORDS = Object.freeze([
  "Required field",
  "Eircode",
  "PPS Number",
]);

// ---------------------------------------------------------------------------
// Issue #2188 — keyword sets for the five extended locales.
// ---------------------------------------------------------------------------

/**
 * Polish-specific validation keywords.
 * `Pole wymagane` ≈ "Required field", `PESEL` and `NIP` are the two
 * personal/business tax identifiers, `Numer rachunku` ≈ "Account number".
 */
const PL_PL_KEYWORDS = Object.freeze([
  "Pole wymagane",
  "PESEL",
  "NIP",
  "Numer rachunku",
]);

/**
 * Spanish-specific validation keywords.
 * `Campo obligatorio` ≈ "Required field", `DNI` (national ID) / `NIE`
 * (foreigner ID) / `CIF` (company tax ID), `Código postal` ≈ "Postal code".
 *
 * IMPORTANT: `Campo obbligatorio` is the Italian token; the Spanish form is
 * `Campo obligatorio` (single `b`). The IT heuristic above is matched first
 * on the IT spelling so a single misspelled token cannot cross over.
 */
const ES_ES_KEYWORDS = Object.freeze([
  "Campo obligatorio",
  "DNI",
  "NIE",
  "CIF",
  "Código postal",
]);

/**
 * Dutch-specific validation keywords.
 * `Verplicht veld` ≈ "Required field", `BSN` (Burgerservicenummer = national
 * ID), `KvK-nummer` (Kamer van Koophandel = chamber of commerce ID),
 * `Postcode` (Dutch / EN cognate but combined with NL IBAN it's unambiguous).
 */
const NL_NL_KEYWORDS = Object.freeze([
  "Verplicht veld",
  "BSN",
  "KvK-nummer",
  "BTW-nummer",
]);

/**
 * Czech-specific validation keywords.
 * `Povinné pole` ≈ "Required field", `Rodné číslo` (national ID),
 * `IČO` (organisation ID), `DIČ` (tax ID), `PSČ` (postal code).
 */
const CS_CZ_KEYWORDS = Object.freeze([
  "Povinné pole",
  "Rodné číslo",
  "IČO",
  "DIČ",
]);

/**
 * Hungarian-specific validation keywords.
 * `Kötelező mező` ≈ "Required field", `Adószám` (tax number),
 * `Személyi szám` (personal ID), `Irányítószám` (postal code).
 */
const HU_HU_KEYWORDS = Object.freeze([
  "Kötelező mező",
  "Adószám",
  "Személyi szám",
  "Irányítószám",
]);

// ---------------------------------------------------------------------------
// 2-letter primary-tag promotion
// ---------------------------------------------------------------------------

/**
 * When `screenLocale` is a 2-letter BCP 47 primary sub-tag (e.g. "de", "fr"),
 * promote it to the most representative locale for EU banking.
 *
 * Documented default for "en": EN-IE (Irish bias) because this package is
 * scoped to the EU banking / insurance domain where Ireland is the most common
 * English-speaking jurisdiction.
 */
const PRIMARY_TAG_TO_LOCALE: ReadonlyMap<string, SupportedLocale> = new Map([
  ["de", "DE-DE"],
  ["fr", "FR-FR"],
  ["it", "IT-IT"],
  // "en" → EN-IE: Irish bias for EU banking is the documented default.
  ["en", "EN-IE"],
  // Issue #2188 — extended locale primary-tag promotions.
  // "pl" / "es" / "nl" each map uniquely to their EU-banking locale.
  // For Czech the BCP 47 primary tag is `cs`, not `cz`.
  ["pl", "PL-PL"],
  ["es", "ES-ES"],
  ["nl", "NL-NL"],
  ["cs", "CS-CZ"],
  ["hu", "HU-HU"],
]);

// ---------------------------------------------------------------------------
// Core derivation helpers
// ---------------------------------------------------------------------------

const containsAnyKeyword = (
  text: string,
  keywords: ReadonlyArray<string>,
): boolean => keywords.some((kw) => text.includes(kw));

const anyContainsKeyword = (
  texts: readonly string[],
  keywords: ReadonlyArray<string>,
): boolean => texts.some((text) => containsAnyKeyword(text, keywords));

/**
 * Return the first IBAN-prefix match found in the provided token list.
 * Tokens are compared case-insensitively (normalised to upper-case).
 */
const localeFromIbanPrefixes = (
  ibanPrefixes: readonly string[],
): SupportedLocale | undefined => {
  for (const prefix of ibanPrefixes) {
    const locale = IBAN_PREFIX_TO_LOCALE.get(prefix.toUpperCase().slice(0, 2));
    if (locale !== undefined) return locale;
  }
  return undefined;
};

/**
 * Return a locale derived from validation strings and field labels using
 * keyword matching.  Evaluation order matches the priority ranking in the
 * design doc (AT > CH > FR > IT > EN-IE > DE-DE).
 */
const localeFromKeywords = (
  validationStrings: readonly string[],
  fieldLabels: readonly string[],
): SupportedLocale | undefined => {
  const texts = [...validationStrings, ...fieldLabels];

  // DE-AT: Austrian-specific terms take precedence over generic German keywords.
  // DE_AT_KEYWORDS covers the unambiguously Austrian vocabulary; the secondary
  // Pflichtfeld+PLZ combo handles the case where the AT-specific markers are
  // absent but the postal-code format betrays the locale.
  if (
    anyContainsKeyword(texts, DE_AT_KEYWORDS) ||
    (anyContainsKeyword(texts, ["Pflichtfeld"]) &&
      texts.some((t) => /\bPLZ\b/.test(t) && /\b\d{4}\b/.test(t)))
  ) {
    return "DE-AT";
  }

  // DE-CH: Swiss-specific AHV number marker
  if (anyContainsKeyword(texts, DE_CH_KEYWORDS)) {
    return "DE-CH";
  }

  // FR-FR
  if (anyContainsKeyword(texts, FR_FR_KEYWORDS)) {
    return "FR-FR";
  }

  // IT-IT — must run before ES-ES because `Campo obbligatorio` (IT) and
  // `Campo obligatorio` (ES) differ by a single character.
  if (anyContainsKeyword(texts, IT_IT_KEYWORDS)) {
    return "IT-IT";
  }

  // Issue #2188 — extended locales.  Each new locale has a unique set of
  // identifiers (national-ID format, tax-ID name, "Required field"
  // translation), so the evaluation order between them does not matter
  // in practice; we pick alphabetical order on the locale code for
  // determinism and ease of audit.

  // CS-CZ
  if (anyContainsKeyword(texts, CS_CZ_KEYWORDS)) {
    return "CS-CZ";
  }

  // ES-ES
  if (anyContainsKeyword(texts, ES_ES_KEYWORDS)) {
    return "ES-ES";
  }

  // HU-HU
  if (anyContainsKeyword(texts, HU_HU_KEYWORDS)) {
    return "HU-HU";
  }

  // NL-NL
  if (anyContainsKeyword(texts, NL_NL_KEYWORDS)) {
    return "NL-NL";
  }

  // PL-PL
  if (anyContainsKeyword(texts, PL_PL_KEYWORDS)) {
    return "PL-PL";
  }

  // EN-IE: Irish-English markers
  if (anyContainsKeyword(texts, EN_IE_KEYWORDS)) {
    return "EN-IE";
  }

  // DE-DE: generic German "Pflichtfeld" without AT/CH markers
  if (anyContainsKeyword(texts, DE_DE_KEYWORDS)) {
    return "DE-DE";
  }

  return undefined;
};

// ---------------------------------------------------------------------------
// Public derivation API
// ---------------------------------------------------------------------------

/**
 * Derive a `SupportedLocale` from heterogeneous screen signals.
 *
 * Heuristic evaluation order:
 * 1. Exact `SupportedLocale` match in `screenLocale`.
 * 2. 2-letter BCP 47 primary sub-tag promotion (de→DE-DE, fr→FR-FR,
 *    it→IT-IT, en→EN-IE).
 * 3. IBAN country-code prefix tokens (AT→DE-AT, CH→DE-CH, DE→DE-DE,
 *    FR→FR-FR, IE→EN-IE, IT→IT-IT).
 * 4. Validation/label keyword matching (see inline comments).
 *
 * Returns `undefined` when no rule matches; the caller decides the fallback.
 */
export const deriveLocaleFromScreen = (input: {
  readonly screenLocale?: string;
  readonly validationStrings?: readonly string[];
  readonly fieldLabels?: readonly string[];
  readonly ibanPrefixes?: readonly string[];
}): SupportedLocale | undefined => {
  const { screenLocale, validationStrings = [], fieldLabels = [], ibanPrefixes = [] } =
    input;

  // Rule 1: exact SupportedLocale match
  if (screenLocale !== undefined && isSupportedLocale(screenLocale)) {
    return screenLocale;
  }

  // Rule 2: 2-letter primary-tag promotion
  if (screenLocale !== undefined) {
    const primary = screenLocale.toLowerCase().split(/[-_]/u)[0] ?? "";
    const promoted = PRIMARY_TAG_TO_LOCALE.get(primary);
    if (promoted !== undefined) return promoted;
  }

  // Rule 3: IBAN-prefix tokens
  const ibanLocale = localeFromIbanPrefixes(ibanPrefixes);
  if (ibanLocale !== undefined) return ibanLocale;

  // Rule 4: keyword-based heuristic
  return localeFromKeywords(validationStrings, fieldLabels);
};

/**
 * Thin wrapper around `deriveLocaleFromScreen` that reads `screen.locale`
 * first, then forwards supplementary hints (validation texts, field labels,
 * IBAN prefixes) supplied by the caller.
 */
export const deriveLocaleFromBusinessTestIntentScreen = (
  screen: BusinessTestIntentScreen,
  supplementary?: {
    readonly validations?: readonly string[];
    readonly labels?: readonly string[];
    readonly ibanPrefixes?: readonly string[];
  },
): SupportedLocale | undefined =>
  deriveLocaleFromScreen({
    ...(screen.locale !== undefined ? { screenLocale: screen.locale } : {}),
    validationStrings: supplementary?.validations ?? [],
    fieldLabels: supplementary?.labels ?? [],
    ibanPrefixes: supplementary?.ibanPrefixes ?? [],
  });
