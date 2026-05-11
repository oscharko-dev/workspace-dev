/**
 * Client-side Figma URL parser (Issue #1735).
 *
 * Extracts `figmaFileKey` and (optional) `figmaNodeId` from a Figma share
 * URL so the UI can validate the input and pre-render the submission body
 * before calling `POST /workspace/submit`. The server has its own SSRF-
 * guarded parser in `figma-rest-adapter.ts`; this module is intentionally
 * narrower (no host allowlist, no protocol enforcement is needed beyond
 * the regex shape — we only accept the figma.com host pattern).
 *
 * Pure: identical input always yields identical output. No side effects,
 * no I/O.
 */

const FIGMA_URL_PATTERN =
  /^https:\/\/(?:www\.)?figma\.com\/(?:file|design)\/([A-Za-z0-9]+)(?:\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/u;

export interface ParsedFigmaUrl {
  figmaFileKey: string;
  figmaNodeId: string | null;
}

export type ParseFigmaUrlResult =
  | { ok: true; value: ParsedFigmaUrl }
  | { ok: false; reason: ParseFigmaUrlError };

export type ParseFigmaUrlError =
  | "empty"
  | "not_https"
  | "wrong_host"
  | "missing_file_key"
  | "malformed";

const HUMAN_READABLE_REASONS: Record<ParseFigmaUrlError, string> = {
  empty: "Enter a Figma URL.",
  not_https: "Figma URLs must start with https://.",
  wrong_host: "URL must be on figma.com (https://www.figma.com/...).",
  missing_file_key: "URL is missing the file key segment.",
  malformed: "URL is not a recognised Figma file or design link.",
};

/**
 * Parse a Figma share URL into its file key and optional node id. Returns
 * `{ ok: false, reason }` for any unrecognised input — callers map
 * `reason` through {@link describeFigmaUrlError} for screen-reader text.
 */
export const parseFigmaUrl = (raw: string): ParseFigmaUrlResult => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (!trimmed.startsWith("https://")) {
    return { ok: false, reason: "not_https" };
  }
  if (
    !trimmed.startsWith("https://figma.com/") &&
    !trimmed.startsWith("https://www.figma.com/")
  ) {
    return { ok: false, reason: "wrong_host" };
  }
  const match = FIGMA_URL_PATTERN.exec(trimmed);
  if (match === null) {
    return { ok: false, reason: "malformed" };
  }
  const fileKey = match[1];
  if (fileKey === undefined || fileKey.length === 0) {
    return { ok: false, reason: "missing_file_key" };
  }
  const queryString = match[2] ?? "";
  const nodeId = extractNodeIdFromQuery(queryString);
  return {
    ok: true,
    value: {
      figmaFileKey: fileKey,
      figmaNodeId: nodeId,
    },
  };
};

const extractNodeIdFromQuery = (queryString: string): string | null => {
  if (queryString.length === 0) return null;
  const params = new URLSearchParams(queryString);
  const raw = params.get("node-id") ?? params.get("nodeId");
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // The runner accepts either "0:1" or "0-1"; normalise to colon form so
  // the request body matches what the schema expects in figmaNodeId.
  return trimmed.replace(/-/gu, ":");
};

export const describeFigmaUrlError = (reason: ParseFigmaUrlError): string =>
  HUMAN_READABLE_REASONS[reason];
