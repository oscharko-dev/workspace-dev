/**
 * Sanitizes runtime error messages before they are returned or logged.
 *
 * This prevents accidental leakage of PII, credentials, or long opaque tokens.
 */

import { redactHighRiskSecrets } from "./secret-redaction.js";

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PAN_PATTERN = /\b\d{13,19}\b/g;

const MAX_MESSAGE_LENGTH = 240;
const DEFAULT_CAUSE_DEPTH_MAX = 8;

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

/** Lightweight IIN/BIN prefix check for major card networks. */
function hasKnownIssuerPrefix(candidate: string): boolean {
  const d1 = candidate.charCodeAt(0) - 48;
  const d2 = d1 * 10 + (candidate.charCodeAt(1) - 48);

  // Visa: starts with 4
  if (d1 === 4) return true;
  // Amex: 34, 37
  if (d2 === 34 || d2 === 37) return true;
  // Mastercard: 51-55
  if (d2 >= 51 && d2 <= 55) return true;
  // UnionPay: 62
  if (d2 === 62) return true;
  // Discover: 65
  if (d2 === 65) return true;
  // Diners Club: 36, 38
  if (d2 === 36 || d2 === 38) return true;

  if (candidate.length >= 3) {
    const d3 = d2 * 10 + (candidate.charCodeAt(2) - 48);
    // Diners Club: 300-305
    if (d3 >= 300 && d3 <= 305) return true;
    // Discover: 644-649
    if (d3 >= 644 && d3 <= 649) return true;
  }

  if (candidate.length >= 4) {
    const d4 =
      (candidate.charCodeAt(0) - 48) * 1000 +
      (candidate.charCodeAt(1) - 48) * 100 +
      (candidate.charCodeAt(2) - 48) * 10 +
      (candidate.charCodeAt(3) - 48);
    // Mastercard: 2221-2720
    if (d4 >= 2221 && d4 <= 2720) return true;
    // JCB: 3528-3589
    if (d4 >= 3528 && d4 <= 3589) return true;
    // Discover: 6011
    if (d4 === 6011) return true;
  }

  return false;
}

function redact(input: string): string {
  return redactHighRiskSecrets(
    input
      .replace(EMAIL_PATTERN, "[redacted-email]")
      .replace(PAN_PATTERN, (candidate) =>
        passesLuhnChecksum(candidate) && hasKnownIssuerPrefix(candidate)
          ? "[redacted-pan]"
          : candidate,
      ),
    "[redacted-secret]",
  );
}

/**
 * Walks the `.cause` chain of an error, redacting high-risk secrets from each
 * level's message and stack. Uses a WeakSet to short-circuit circular chains
 * and a depth cap to guard against pathologically deep nesting.
 *
 * Returns a single human-readable string with each cause prefixed by
 * "[cause]: " on its own line.
 */
export function redactErrorChain(
  err: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depthMax: number = DEFAULT_CAUSE_DEPTH_MAX,
): string {
  const lines: string[] = [];
  let current: unknown = err;
  let depth = 0;

  while (current !== null && current !== undefined) {
    const prefix = depth === 0 ? "" : "[cause]: ";

    if (!(current instanceof Error)) {
      const raw =
        typeof current === "string"
          ? current
          : typeof current === "number" ||
              typeof current === "boolean" ||
              typeof current === "bigint"
            ? String(current)
            : "[object Object]";
      const rendered = redactHighRiskSecrets(raw, "[redacted-secret]");
      lines.push(`${prefix}${rendered}`);
      break;
    }

    if (seen.has(current)) {
      lines.push(`${prefix}[circular]`);
      break;
    }
    seen.add(current);

    const name =
      typeof current.name === "string" && current.name.length > 0
        ? current.name
        : "Error";
    const rawMessage =
      typeof current.message === "string" ? current.message : "";
    const redactedMessage = redactHighRiskSecrets(
      rawMessage,
      "[redacted-secret]",
    );
    const header =
      redactedMessage.length > 0 ? `${name}: ${redactedMessage}` : name;
    lines.push(`${prefix}${header}`);

    if (typeof current.stack === "string" && current.stack.length > 0) {
      const redactedStack = redactHighRiskSecrets(
        current.stack,
        "[redacted-secret]",
      );
      lines.push(redactedStack);
    }

    if (depth + 1 >= depthMax) {
      lines.push("[cause]: [truncated: max depth reached]");
      break;
    }

    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }

  return lines.join("\n");
}

export function sanitizeErrorMessage({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const hasCause = (error as { cause?: unknown }).cause !== undefined;
  const source = hasCause ? redactErrorChain(error) : redact(error.message);
  const sanitized = source.replace(/\s+/g, " ").trim();
  if (sanitized.length < 1) {
    return fallback;
  }
  if (sanitized.length > MAX_MESSAGE_LENGTH) {
    return `${sanitized.slice(0, MAX_MESSAGE_LENGTH)}...`;
  }
  return sanitized;
}
