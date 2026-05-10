/**
 * Per-locale calibration support for Issue #2117.
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
 * map to one of the six supported locales.
 */
const IBAN_PREFIX_TO_LOCALE: ReadonlyMap<string, SupportedLocale> = new Map([
  ["AT", "DE-AT"],
  ["CH", "DE-CH"],
  ["DE", "DE-DE"],
  ["FR", "FR-FR"],
  ["IE", "EN-IE"],
  ["IT", "IT-IT"],
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

  // IT-IT
  if (anyContainsKeyword(texts, IT_IT_KEYWORDS)) {
    return "IT-IT";
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
