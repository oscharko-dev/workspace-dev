import type { PiiKind } from "../contracts/index.js";

/** A single PII-like match inside a scanned string. */
export interface PiiMatch {
  kind: PiiKind;
  /** Replacement token (never contains the original value). */
  redacted: string;
  /** Confidence in 0..1. Higher means stronger signal. */
  confidence: number;
}

const REDACTION_TOKEN: Record<PiiKind, string> = {
  iban: "[REDACTED:IBAN]",
  bic: "[REDACTED:BIC]",
  pan: "[REDACTED:PAN]",
  tax_id: "[REDACTED:TAX_ID]",
  email: "[REDACTED:EMAIL]",
  phone: "[REDACTED:PHONE]",
  full_name: "[REDACTED:FULL_NAME]",
  internal_hostname: "[REDACTED:INTERNAL_HOSTNAME]",
  jira_mention: "[REDACTED:JIRA_MENTION]",
  customer_name_placeholder: "[REDACTED:CUSTOMER_NAME]",
  // Issue #1668 (audit-2026-05).
  postal_address: "[REDACTED:POSTAL_ADDRESS]",
  date_of_birth: "[REDACTED:DOB]",
  account_number: "[REDACTED:ACCOUNT_NUMBER]",
  national_id: "[REDACTED:NATIONAL_ID]",
  special_category: "[REDACTED:SPECIAL_CATEGORY]",
};

const EMAIL_RE =
  /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/u;

const IBAN_CANDIDATE_RE = /\b([A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30})\b/gu;

const BIC_CANDIDATE_RE =
  /\b[A-Z]{4}(?:DE|AT|CH|FR|GB|US|NL|ES|IT|BE|LU|DK|SE|NO|FI|IE|PT|PL|CZ|SK|HU|RO|BG|GR|CY|MT|EE|LV|LT|SI|HR)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gu;

const PAN_CANDIDATE_RE = /(?:\d[\s-]?){12,18}\d/gu;

// E.164-ish phone: requires either a leading "+" country code or a clear
// phone-shaped delimiter so we do not misclassify IBAN/PAN digit runs.
// The `(?!\d)` lookahead prevents matching when the candidate is a prefix
// of a longer digit run (e.g., a 16+ digit PAN remnant).
const PHONE_WITH_COUNTRY_CODE_RE =
  /(?<![\dA-Za-z])\+\d{1,3}[\s-]\d{2,4}[\s-]\d{3,8}(?:[\s-]\d{3,4})?(?!\d)/u;
const PHONE_LOCAL_GROUPED_RE =
  /(?<![\dA-Za-z])\(\d{2,4}\)[\s-]?\d{3,4}[\s-]\d{3,8}(?!\d)/u;

const GERMAN_TAX_ID_RE = /\b\d{11}\b/gu;
const US_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/u;

const FULL_NAME_PLACEHOLDERS = [
  "max mustermann",
  "erika mustermann",
  "max musterman",
  "john doe",
  "jane doe",
  "jane smith",
  "john smith",
];

/**
 * Detect PII-like substrings in a string. Returns the highest-confidence
 * match for the string, or `null` if nothing matched.
 *
 * Order matters: more specific detectors run first so that an IBAN does
 * not get misreported as a tax id.
 */
export const detectPii = (input: string): PiiMatch | null => {
  if (input.length === 0) return null;
  const normalized = input.normalize("NFKC");

  const iban = detectIban(normalized);
  if (iban) return iban;

  const bic = detectBic(normalized);
  if (bic) return bic;

  const pan = detectPan(normalized);
  if (pan) return pan;

  const email = detectEmail(normalized);
  if (email) return email;

  const tax = detectTaxId(normalized);
  if (tax) return tax;

  const phone = detectPhone(normalized);
  if (phone) return phone;

  const mention = detectJiraMention(normalized);
  if (mention) return mention;

  const hostname = detectInternalHostname(normalized);
  if (hostname) return hostname;

  const name = detectFullName(normalized);
  if (name) return name;

  // Issue #1668 (audit-2026-05): GDPR Art. 5(1)(c) categories. Order is
  // narrowest-first so a labelled "Geburtsdatum: 12.03.1985" is not also
  // re-classified as a generic account number.
  const nationalId = detectNationalId(normalized);
  if (nationalId) return nationalId;

  const dob = detectDateOfBirth(normalized);
  if (dob) return dob;

  const postal = detectPostalAddress(normalized);
  if (postal) return postal;

  const account = detectAccountNumber(normalized);
  if (account) return account;

  const special = detectSpecialCategory(normalized);
  if (special) return special;

  return null;
};

/** Opaque replacement token for a given PII kind. */
export const redactPii = (kind: PiiKind): string => {
  return REDACTION_TOKEN[kind];
};

const detectIban = (input: string): PiiMatch | null => {
  for (const match of input.matchAll(IBAN_CANDIDATE_RE)) {
    const candidate = match[1];
    if (candidate === undefined) continue;
    const normalized = candidate.replace(/[\s-]/gu, "").toUpperCase();
    if (normalized.length < 15 || normalized.length > 34) continue;
    if (validateIbanMod97(normalized)) {
      return {
        kind: "iban",
        redacted: REDACTION_TOKEN.iban,
        confidence: 0.99,
      };
    }
  }
  return null;
};

const detectBic = (input: string): PiiMatch | null => {
  const normalized = input.normalize("NFKC");
  const upper = normalized.toUpperCase();
  for (const match of upper.matchAll(BIC_CANDIDATE_RE)) {
    const candidate = match[0];
    const start = match.index;
    const end = start + candidate.length;
    const rawCandidate = normalized.slice(start, end);
    const before = normalized.slice(0, start).trim();
    const after = normalized.slice(end).trim();
    const standalone = before.length === 0 && after.length === 0;
    const labelled = /(?:bic|swift)\s*[:#-]?\s*$/iu.test(before);
    const uppercaseToken = rawCandidate === rawCandidate.toUpperCase();
    const standaloneAccepted =
      standalone && (uppercaseToken || candidate.length === 11);
    if (!standaloneAccepted && !labelled) continue;
    return {
      kind: "bic",
      redacted: REDACTION_TOKEN.bic,
      confidence: 0.9,
    };
  }
  return null;
};

const detectPan = (input: string): PiiMatch | null => {
  for (const match of input.matchAll(PAN_CANDIDATE_RE)) {
    const candidate = match[0];
    const digits = candidate.replace(/\D/gu, "");
    if (digits.length < 13 || digits.length > 19) continue;
    if (luhnValid(digits)) {
      return {
        kind: "pan",
        redacted: REDACTION_TOKEN.pan,
        confidence: 0.95,
      };
    }
  }
  return null;
};

const detectEmail = (input: string): PiiMatch | null => {
  if (EMAIL_RE.test(input)) {
    return {
      kind: "email",
      redacted: REDACTION_TOKEN.email,
      confidence: 0.95,
    };
  }
  return null;
};

const detectPhone = (input: string): PiiMatch | null => {
  const match =
    PHONE_WITH_COUNTRY_CODE_RE.exec(input) ??
    PHONE_LOCAL_GROUPED_RE.exec(input);
  if (!match) return null;
  const digits = match[0].replace(/\D/gu, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return {
    kind: "phone",
    redacted: REDACTION_TOKEN.phone,
    confidence: 0.8,
  };
};

const detectTaxId = (input: string): PiiMatch | null => {
  if (US_SSN_RE.test(input)) {
    return {
      kind: "tax_id",
      redacted: REDACTION_TOKEN.tax_id,
      confidence: 0.9,
    };
  }
  for (const match of input.matchAll(GERMAN_TAX_ID_RE)) {
    if (validateGermanTaxId(match[0])) {
      return {
        kind: "tax_id",
        redacted: REDACTION_TOKEN.tax_id,
        confidence: 0.85,
      };
    }
  }
  return null;
};

const detectFullName = (input: string): PiiMatch | null => {
  const lowered = input.toLowerCase();
  for (const placeholder of FULL_NAME_PLACEHOLDERS) {
    if (lowered.includes(placeholder)) {
      return {
        kind: "full_name",
        redacted: REDACTION_TOKEN.full_name,
        confidence: 0.7,
      };
    }
  }
  return null;
};

// --- Jira-aware detectors (Issue #1432) -------------------------------------

/**
 * Internal-hostname detector. Catches corporate-shaped hostnames that
 * commonly leak into Jira description / comment bodies: `*.intranet.*`,
 * `*.corp.*`, `*.internal`, `*.local`, `*.lan`, plus URLs targeting Jira
 * cloud sites (`<tenant>.atlassian.net`, `<tenant>.jira.com`) so a paste
 * of a Jira `self` URL cannot survive redaction. Public domains
 * (`.com`, `.de`, `.io`, …) without an internal-marker label are not
 * matched here — the email detector handles `name@public.com`.
 */
const INTERNAL_HOSTNAME_RE =
  /(?<![A-Za-z0-9])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:intranet|corp|internal|local|lan|atlassian\.net|jira\.com)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?![A-Za-z0-9])/iu;

const detectInternalHostname = (input: string): PiiMatch | null => {
  if (!INTERNAL_HOSTNAME_RE.test(input)) return null;
  return {
    kind: "internal_hostname",
    redacted: REDACTION_TOKEN.internal_hostname,
    confidence: 0.85,
  };
};

/**
 * Jira/Confluence mention detector. Matches:
 *
 *   - ADF-emitted mention placeholders left in stringified payloads, e.g.
 *     `@user-mention`, `@mention[123]`, `@accountId:5b10ac8d82e05b22cc7d4ec5`.
 *   - Raw Atlassian cloud account ids (24-32 hex chars after `account`/`user` token).
 *   - Confluence-style `[~accountid:...]` markup.
 *
 * Public-handle shapes like `@alice` (≤ 24 chars without colon/hex) are
 * intentionally NOT matched — the redaction profile would otherwise hit
 * every reviewer alias in plain prose. Callers route alias-shaped
 * tokens through `recordJiraMention` instead when ADF parser already
 * stubbed a mention.
 */
const JIRA_MENTION_RE =
  /(?:\[~accountid:[A-Za-z0-9:_-]+\])|(?:@(?:account(?:id)?|user-mention|mention)[\s:[(=-]+[A-Za-z0-9:_-]{4,64}\]?)|(?:[0-9a-f]{24,32}(?=\s|$|[^A-Za-z0-9]))/iu;

const detectJiraMention = (input: string): PiiMatch | null => {
  if (!JIRA_MENTION_RE.test(input)) return null;
  return {
    kind: "jira_mention",
    redacted: REDACTION_TOKEN.jira_mention,
    confidence: 0.9,
  };
};

/**
 * Customer-name-shaped placeholders pulled from common Jira customer
 * facing custom-field names. Returns a `customer_name_placeholder`
 * match when the input is a non-empty, name-shaped string AND the
 * caller signalled (via {@link detectCustomerNameInLabelledField}) that
 * the field carrying it is one of the customer-name-shaped Jira
 * fields. Generic full names without that signal still flow through
 * the existing {@link detectFullName} path.
 */
const CUSTOMER_NAME_FIELD_NAMES: ReadonlySet<string> = new Set([
  "customer name",
  "customer full name",
  "customer first name",
  "customer last name",
  "customer fullname",
  "client name",
  "account holder",
  "account holder name",
  "account owner",
  "primary contact",
  "primary contact name",
  "beneficiary",
  "beneficiary name",
  "beneficial owner",
  "policy holder",
  "card holder",
  "cardholder",
  "cardholder name",
  "name on card",
  "name on account",
]);

const NAME_SHAPED_RE =
  /^[A-ZÀ-ſ][A-Za-zÀ-ſ'.-]{1,40}(?:\s+[A-ZÀ-ſ][A-Za-zÀ-ſ'.-]{1,40}){1,4}$/u;

/**
 * Returns true when the (case-insensitive, trimmed) Jira field display
 * name is one of the well-known customer-name-shaped fields. Used by
 * the Jira IR redaction profile to escalate `full_name`-shaped values
 * inside customer-name fields into `customer_name_placeholder` matches.
 */
export const isCustomerNameShapedFieldName = (fieldName: string): boolean => {
  return CUSTOMER_NAME_FIELD_NAMES.has(fieldName.trim().toLowerCase());
};

/**
 * Detect a customer-name-shaped placeholder. Returns a non-null match
 * when the caller has already established (via {@link isCustomerNameShapedFieldName})
 * that the surrounding Jira field is a customer-name field, AND the
 * value text is name-shaped or already a known full-name placeholder.
 */
export const detectCustomerNameInLabelledField = (
  value: string,
): PiiMatch | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (NAME_SHAPED_RE.test(trimmed) || detectFullName(trimmed) !== null) {
    return {
      kind: "customer_name_placeholder",
      redacted: REDACTION_TOKEN.customer_name_placeholder,
      confidence: 0.92,
    };
  }
  return null;
};

/** ISO 13616 mod-97 validator (returns true if valid IBAN). */
const validateIbanMod97 = (iban: string): boolean => {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    let num: number;
    if (code >= 48 && code <= 57) {
      num = code - 48;
    } else if (code >= 65 && code <= 90) {
      num = code - 55;
    } else {
      return false;
    }
    const digits = num < 10 ? 1 : 2;
    remainder = (remainder * (digits === 1 ? 10 : 100) + num) % 97;
  }
  return remainder === 1;
};

/** Luhn mod-10 checksum over a digits-only string. */
const luhnValid = (digits: string): boolean => {
  if (digits.length === 0) return false;
  let sum = 0;
  let doubled = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const char = digits[i];
    if (char === undefined) return false;
    const d = char.charCodeAt(0) - 48;
    if (d < 0 || d > 9) return false;
    let value = d;
    if (doubled) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    doubled = !doubled;
  }
  return sum % 10 === 0;
};

/**
 * German Steuer-ID checksum (ISO 7064 mod-11-10).
 * 11 digits, with the 11th being the check digit.
 */
const validateGermanTaxId = (digits: string): boolean => {
  if (digits.length !== 11) return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    const ch = digits[i];
    if (ch === undefined) return false;
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) return false;
    let mod = (d + product) % 10;
    if (mod === 0) mod = 10;
    product = (mod * 2) % 11;
  }
  let check = 11 - product;
  if (check === 10) check = 0;
  const lastChar = digits[10];
  if (lastChar === undefined) return false;
  const lastDigit = lastChar.charCodeAt(0) - 48;
  return check === lastDigit;
};

// ---------------------------------------------------------------------------
// Issue #1668 (audit-2026-05): GDPR Art. 5(1)(c) data-minimization
// detectors. Each is hand-rolled, zero-runtime-deps, and runs after the
// existing PII detectors so labelled / structurally-recognized data
// (IBAN, PAN, tax_id) is classified by its primary detector first.
// ---------------------------------------------------------------------------

/**
 * Postal-address shapes for DE / AT / CH / NL / FR / IT / GB.
 * Pattern is "Street + house number" near a 4-5 digit postal code +
 * city name. The proximity check (number of intervening characters)
 * keeps the false-positive rate low; standalone postal codes alone are
 * not flagged because that would catch every European address book.
 */
const POSTAL_ADDRESS_RES: ReadonlyArray<RegExp> = [
  // DE: "Musterstraße 12, 10115 Berlin" / "Hauptstr. 5, 50667 Köln"
  /\b\p{Lu}\p{L}+(?:str(?:asse|aße)?|str\.|weg|allee|platz|gasse)\s+\d{1,4}[a-z]?\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/iu,
  // AT/CH: same street tokens, 4-digit postal code
  /\b\p{Lu}\p{L}+(?:strasse|gasse|weg|platz)\s+\d{1,4}[a-z]?\s*,?\s*\d{4}\s+\p{Lu}\p{L}+/iu,
  // NL: "Hoofdstraat 12, 1011 AB Amsterdam"
  /\b\p{Lu}\p{L}+straat\s+\d{1,4}[a-z]?\s*,?\s*\d{4}\s?[A-Z]{2}\s+\p{Lu}\p{L}+/iu,
  // FR: "12 rue de la Paix, 75002 Paris" / "5 avenue Foch, 75116 Paris"
  /\b\d{1,4}\s+(?:rue|avenue|boulevard|place|impasse)\s+(?:de\s+(?:la|l['’]|le|les)\s+)?\p{L}+\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/iu,
  // IT: "Via Roma 5, 00184 Roma" / "Piazza Garibaldi 12, 20121 Milano"
  /\b(?:via|viale|piazza|corso|vicolo)\s+\p{L}+\s+\d{1,4}[a-z]?\s*,?\s*\d{5}\s+\p{Lu}\p{L}+/iu,
  // GB: "10 Downing Street, London SW1A 2AA"
  /\b\d{1,4}\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?\s+(?:street|road|avenue|lane|close|square|terrace|gardens|crescent|hill)\s*,?\s*\p{Lu}\p{L}+\s+[A-Z]{1,2}\d{1,2}[A-Z]?\s+\d[A-Z]{2}/iu,
];

const detectPostalAddress = (input: string): PiiMatch | null => {
  for (const re of POSTAL_ADDRESS_RES) {
    if (re.test(input)) {
      return {
        kind: "postal_address",
        redacted: REDACTION_TOKEN.postal_address,
        confidence: 0.85,
      };
    }
  }
  return null;
};

/**
 * Date-of-birth detector. Restricted to DOB-shaped values (year between
 * 1900 and 2026) AND require either a labelling word ("born", "geboren",
 * "DOB", "Geburtsdatum", "date of birth") within ~32 chars OR an
 * unambiguously DOB-shaped year (1900..2010, narrowing the false-
 * positive risk on technical timestamps).
 */
const DOB_LABEL_RE =
  /\b(?:born|geboren|geb\.?|dob|date\s+of\s+birth|geburtsdatum|geburtstag|naissance|nacimiento|nascita)\b[^\n]{0,32}?(?:\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})/iu;

const detectDateOfBirth = (input: string): PiiMatch | null => {
  if (DOB_LABEL_RE.test(input)) {
    return {
      kind: "date_of_birth",
      redacted: REDACTION_TOKEN.date_of_birth,
      confidence: 0.9,
    };
  }
  return null;
};

/**
 * Account / contract number detector. Only fires on labelled occurrences
 * to avoid false-positives on Jira issue keys, line numbers, etc. Looks
 * for a label word followed within ~16 chars by a 6..18-digit run.
 */
const ACCOUNT_NUMBER_LABEL_RE =
  /\b(?:account|kontonummer|konto-?nr\.?|customer\s*id|kunden(?:nummer|nr\.?)|contract\s*(?:no|number|id)|vertragsnummer|vertrag\s*nr\.?|policy\s*(?:no|number)|membership\s*(?:no|number))\b[^\n]{0,16}?\b\d{6,18}\b/iu;

const detectAccountNumber = (input: string): PiiMatch | null => {
  if (ACCOUNT_NUMBER_LABEL_RE.test(input)) {
    return {
      kind: "account_number",
      redacted: REDACTION_TOKEN.account_number,
      confidence: 0.8,
    };
  }
  return null;
};

/**
 * National-ID detectors. Each variant is anchored on a country prefix
 * or a label so we do not misclassify random alnum runs.
 */
const NATIONAL_ID_RES: ReadonlyArray<RegExp> = [
  // German Personalausweisnummer: 9 digits + 1 alpha + 1 digit (legacy)
  // OR 10 alnum (post-2010). Require a labelling word to avoid false
  // positives on adjacent 10-digit hashes.
  /\b(?:personalausweis(?:nummer)?|ausweisnr\.?|id\s*card)\b[^\n]{0,16}?\b[A-Z0-9]{9,12}\b/iu,
  // Swiss AHV / AVS: 13 digits formatted 756.xxxx.xxxx.xx (or no dots)
  /\b756[.\-\s]?\d{4}[.\-\s]?\d{4}[.\-\s]?\d{2}\b/u,
  // Swedish personnummer: YYMMDD-NNNN or YYYYMMDD-NNNN
  /\b(?:19|20)?\d{6}[-+]\d{4}\b/u,
  // Spanish NIE/DNI: 8 digits + control letter
  /\b[0-9]{8}[A-HJ-NP-TV-Z]\b(?=\s|$|[,.])/u,
];

const detectNationalId = (input: string): PiiMatch | null => {
  for (const re of NATIONAL_ID_RES) {
    if (re.test(input)) {
      return {
        kind: "national_id",
        redacted: REDACTION_TOKEN.national_id,
        confidence: 0.85,
      };
    }
  }
  return null;
};

/**
 * GDPR Art. 9 special-category keyword block. Flags free text that
 * carries health / political / religious / union / sexual-orientation
 * signals so the reviewer is alerted; the surrounding context is NOT
 * auto-redacted because false positives on legitimate prose would be
 * disproportionate.
 *
 * Detection is keyword-anchored on whole-word matches so "religion" in
 * "religion of testing" is flagged but "preregister" is not.
 */
const SPECIAL_CATEGORY_RES: ReadonlyArray<RegExp> = [
  // Health
  /\b(?:HIV|AIDS|cancer|krebs|diabetes|depression|schwanger|pregnant|disabled|disability|behindert|invalidit(?:y|é|ät))\b/iu,
  // Political opinion / union
  /\b(?:political\s+(?:party|opinion|affiliation)|gewerkschaft|union\s+member|trade\s+union|partei(?:mitglied)?|syndicat)\b/iu,
  // Religion
  /\b(?:religion|religios|religiös|religieux|judaism|j(?:üd|ued|uw|udisch)|catholic|katholisch|muslim|muslimisch|protestant|protestantisch|atheist|atheismus|hindu|buddhist)\b/iu,
  // Race / ethnicity
  /\b(?:ethnic(?:ity|al)|race|rasse|ethnie|herkunft|nationality\s+code|asylum\s+status)\b/iu,
  // Sexual orientation
  /\b(?:sexual\s+orientation|gay|lesbian|bisexual|homosexuell?|heterosexuell?|transgender|nonbinary)\b/iu,
];

const detectSpecialCategory = (input: string): PiiMatch | null => {
  for (const re of SPECIAL_CATEGORY_RES) {
    if (re.test(input)) {
      return {
        kind: "special_category",
        redacted: REDACTION_TOKEN.special_category,
        confidence: 0.6, // Lower because keyword-only; reviewer attention.
      };
    }
  }
  return null;
};
