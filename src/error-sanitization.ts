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

function redact(input: string): string {
  return redactHighRiskSecrets(
    input
      .replace(EMAIL_PATTERN, "[redacted-email]")
      .replace(PAN_PATTERN, (candidate) =>
        passesLuhnChecksum(candidate) ? "[redacted-pan]" : candidate,
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
      const rendered = redact(raw);
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
    const redactedMessage = redact(rawMessage);
    const header =
      redactedMessage.length > 0 ? `${name}: ${redactedMessage}` : name;
    lines.push(`${prefix}${header}`);

    if (typeof current.stack === "string" && current.stack.length > 0) {
      const redactedStack = redact(current.stack);
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
