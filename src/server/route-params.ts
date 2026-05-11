/**
 * Route parameter hardening: safe URI decoding and cross-platform path normalization.
 *
 * Every untrusted route segment must pass through `safeDecode` before use,
 * and every decoded path must pass through `normalizePlatformPath` before
 * any allow/block security check.
 */

/** Sentinel returned when `decodeURIComponent` throws `URIError`. */
export const INVALID_PATH_ENCODING: unique symbol = Symbol("INVALID_PATH_ENCODING");

/**
 * Safely decode a URI-encoded route segment.
 *
 * Returns the decoded string on success, or `INVALID_PATH_ENCODING` when the
 * input contains a malformed percent-encoded sequence.  Callers must check for
 * the sentinel and respond with a deterministic 400.
 */
export function safeDecode(
  value: string
): string | typeof INVALID_PATH_ENCODING {
  try {
    return decodeURIComponent(value);
  } catch {
    return INVALID_PATH_ENCODING;
  }
}

/**
 * Windows absolute-path pattern.
 *
 * Matches drive letters (`C:\`, `c:/`) and UNC roots (`\\server`, `//server`).
 */
const WINDOWS_ABSOLUTE_RE = /^(?:[A-Za-z]:[/\\]|[/\\]{2}|\\\\)/;

/**
 * Normalize a decoded path for cross-platform security checks.
 *
 * 1. Replaces all backslash separators with forward slashes so that
 *    `node_modules\react` is caught by the same blocked-prefix check as
 *    `node_modules/react`.
 * 2. Rejects Windows absolute paths and UNC roots.
 * 3. Rejects POSIX absolute paths (`/etc/passwd`).
 *
 * Returns `{ ok: true; normalized: string }` on success, or
 * `{ ok: false; reason: string }` when the path shape is invalid.
 */
export function normalizePlatformPath(
  decoded: string
): { ok: true; normalized: string } | { ok: false; reason: string } {
  // Reject Windows absolute / UNC paths before normalization so an attacker
  // cannot sneak `C:\...` past POSIX-only checks.
  if (WINDOWS_ABSOLUTE_RE.test(decoded)) {
    return { ok: false, reason: "Windows absolute or UNC paths are not allowed." };
  }

  // Canonicalize separators.
  const normalized = decoded.replaceAll("\\", "/");

  // After normalization a leading `/` means an absolute path.
  if (normalized.startsWith("/")) {
    return { ok: false, reason: "Absolute paths are not allowed." };
  }

  return { ok: true, normalized };
}
