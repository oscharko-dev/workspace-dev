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
  pan: "[REDACTED:PAN]",
  tax_id: "[REDACTED:TAX_ID]",
  email: "[REDACTED:EMAIL]",
  phone: "[REDACTED:PHONE]",
  full_name: "[REDACTED:FULL_NAME]",
};

const EMAIL_RE =
  /[\w.!#$%&'*+/=?^`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/u;

const IBAN_CANDIDATE_RE = /\b([A-Z]{2}\d{2}(?:[\s-]?[A-Z0-9]){11,30})\b/gu;

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

  const pan = detectPan(normalized);
  if (pan) return pan;

  const email = detectEmail(normalized);
  if (email) return email;

  const tax = detectTaxId(normalized);
  if (tax) return tax;

  const phone = detectPhone(normalized);
  if (phone) return phone;

  const name = detectFullName(normalized);
  if (name) return name;

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
