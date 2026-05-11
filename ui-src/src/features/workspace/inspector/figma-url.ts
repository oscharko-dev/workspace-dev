/**
 * Figma URL parsing — shared between PasteDropZone and Inspector re-import flows.
 *
 * Recognises four URL shapes:
 *   - design   `https://figma.com/design/:fileKey/:fileName?node-id=:n`
 *   - file     `https://figma.com/file/:fileKey/:fileName?...`            (legacy)
 *   - branch   `https://figma.com/design/:fileKey/branch/:branchKey/:fileName`
 *   - figjam / make / community → unsupported
 *
 * `node-id` may arrive as `1-2`, `1:2`, or `1%3A2`; this module normalizes to
 * the `1-2` form so downstream code (Figma MCP, REST API) sees a single shape.
 *
 * The module is pure — no React, no DOM, no logging — so it can be reused by
 * the Inspector re-import flows added for Issue #1010.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FigmaUrlKind = "design" | "file" | "branch";

export interface FigmaUrlParseResult {
  /** Effective key to send to the API (branchKey when present, otherwise fileKey). */
  readonly fileKey: string;
  /** Original file key (parent of the branch when branched). */
  readonly rootFileKey: string;
  /** Branch key when the URL is a branch URL, otherwise null. */
  readonly branchKey: string | null;
  /** Normalized node id ("1-2" form), or null when not present in the URL. */
  readonly nodeId: string | null;
  /** Variant of the URL we parsed. */
  readonly kind: FigmaUrlKind;
}

export type FigmaUrlValidationCode =
  | "EMPTY"
  | "INVALID_URL"
  | "WRONG_HOST"
  | "UNSUPPORTED_FIGMA_VARIANT"
  | "MISSING_FILE_KEY";

export type FigmaUrlValidationResult =
  | { readonly ok: true; readonly value: FigmaUrlParseResult }
  | {
      readonly ok: false;
      readonly code: FigmaUrlValidationCode;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIGMA_HOST = "figma.com";

const VALIDATION_MESSAGES: Record<FigmaUrlValidationCode, string> = {
  EMPTY: "Enter a Figma design URL",
  INVALID_URL: "That does not look like a URL",
  WRONG_HOST: "URL must be on figma.com",
  UNSUPPORTED_FIGMA_VARIANT:
    "FigJam, Figma Make, and community files are not supported",
  MISSING_FILE_KEY: "URL is missing the file key",
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse + validate a Figma URL. Returns `null` for the simple "is it valid?"
 * use case; callers that need structured error info should use
 * {@link validateFigmaUrl} instead.
 */
export function parseFigmaUrl(url: string): FigmaUrlParseResult | null {
  const result = validateFigmaUrl(url);
  return result.ok ? result.value : null;
}

/**
 * Parse + validate with structured error info, suitable for inline UI feedback.
 */
export function validateFigmaUrl(url: string): FigmaUrlValidationResult {
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return failure("EMPTY");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return failure("INVALID_URL");
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host !== FIGMA_HOST) {
    return failure("WRONG_HOST");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const kindSegment = segments[0];
  if (kindSegment === undefined) {
    return failure("MISSING_FILE_KEY");
  }

  if (kindSegment !== "design" && kindSegment !== "file") {
    return failure("UNSUPPORTED_FIGMA_VARIANT");
  }

  const rootFileKey = segments[1];
  if (rootFileKey === undefined || rootFileKey.length === 0) {
    return failure("MISSING_FILE_KEY");
  }

  let kind: FigmaUrlKind = kindSegment;
  let branchKey: string | null = null;
  let fileKey = rootFileKey;

  if (kindSegment === "design" && segments[2] === "branch") {
    const branchSegment = segments[3];
    if (branchSegment === undefined || branchSegment.length === 0) {
      return failure("MISSING_FILE_KEY");
    }
    kind = "branch";
    branchKey = branchSegment;
    fileKey = branchSegment;
  }

  const nodeId = normalizeNodeId(parsed.searchParams.get("node-id"));

  return {
    ok: true,
    value: { fileKey, rootFileKey, branchKey, nodeId, kind },
  };
}

/** Returns true when {@link parseFigmaUrl} succeeds. Convenience for UI form state. */
export function isValidFigmaUrl(url: string): boolean {
  return parseFigmaUrl(url) !== null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function failure(
  code: FigmaUrlValidationCode,
): Extract<FigmaUrlValidationResult, { ok: false }> {
  return { ok: false, code, message: VALIDATION_MESSAGES[code] };
}

/**
 * Normalize the `node-id` query value to the `1-2` form expected by the Figma
 * MCP and REST APIs. URLSearchParams already decodes `%3A` to `:`, so we just
 * collapse any `:` separators to `-`. Returns `null` when no node id is given
 * or when the value is empty.
 */
function normalizeNodeId(raw: string | null): string | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  return raw.replaceAll(":", "-");
}
