/**
 * Sanitizes runtime error messages before they are returned or logged.
 *
 * This prevents accidental leakage of PII, credentials, or long opaque tokens.
 */

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PAN_PATTERN = /\b\d{13,19}\b/g;
const SECRET_TOKEN_PATTERN =
  /\b(?:Bearer|Token|Secret|Api[-_ ]?Key|Password)\s*[:=]?\s*[A-Za-z0-9._-]{8,}\b/gi;

const MAX_MESSAGE_LENGTH = 240;

function passesLuhnChecksum(candidate: string): boolean {
  if (candidate.length < 13 || candidate.length > 19) {
    return false;
  }

  let checksum = 0;
  let shouldDouble = false;

  for (let index = candidate.length - 1; index >= 0; index -= 1) {
    const digit = candidate.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      return false;
    }

    let contribution = digit;
    if (shouldDouble) {
      contribution *= 2;
      if (contribution > 9) {
        contribution -= 9;
      }
    }

    checksum += contribution;
    shouldDouble = !shouldDouble;
  }

  return checksum % 10 === 0;
}

function redact(input: string): string {
  return input
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(PAN_PATTERN, (candidate) => (passesLuhnChecksum(candidate) ? "[redacted-pan]" : candidate))
    .replace(SECRET_TOKEN_PATTERN, "[redacted-secret]");
}

export function sanitizeErrorMessage({
  error,
  fallback
}: {
  error: unknown;
  fallback: string;
}): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const sanitized = redact(error.message).replace(/\s+/g, " ").trim();
  if (sanitized.length < 1) {
    return fallback;
  }
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    return `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}...`;
  }
  return sanitized;
}
