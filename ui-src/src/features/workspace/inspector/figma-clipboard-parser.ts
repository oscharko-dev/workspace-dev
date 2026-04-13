/**
 * Figma clipboard HTML parser — extracts figmeta JSON and detects design payloads.
 *
 * When a user copies a component or view in Figma, the system clipboard receives
 * `text/html` containing two base64-encoded data blocks:
 *
 * 1. `data-metadata` (figmeta): Base64-encoded JSON with `{ fileKey, pasteID, dataType }`
 * 2. `data-buffer` (figma): Base64-encoded Kiwi binary (NOT parsed here)
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/999
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex that matches the `<!--(figmeta)...(/figmeta)-->` wrapper. */
const FIGMETA_WRAPPER_RE = /<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/;

/** Lightweight probe — avoids DOM parsing for the fast-path check. */
const FIGMETA_PROBE_RE = /\(figmeta\)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FigmaMeta {
  fileKey: string;
  pasteID: number;
  dataType: "scene" | string;
}

export interface FigmaClipboardResult {
  meta: FigmaMeta;
  hasBuffer: boolean;
  rawHtml: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fast check — returns `true` if the HTML string contains a Figma clipboard
 * payload marker. Does NOT parse the HTML or decode the payload.
 */
export function isFigmaClipboard(html: string): boolean {
  return FIGMETA_PROBE_RE.test(html);
}

/**
 * Full parse — extracts the `figmeta` JSON and detects whether the Kiwi buffer
 * is present.  Returns `null` if the HTML does not contain valid Figma data.
 */
export function parseFigmaClipboard(html: string): FigmaClipboardResult | null {
  if (!isFigmaClipboard(html)) {
    return null;
  }

  const metadataAttr = extractDataAttribute(html, "data-metadata");
  if (metadataAttr === null) {
    return null;
  }

  const base64 = unwrapFigmeta(metadataAttr);
  if (base64 === null) {
    return null;
  }

  const meta = decodeFigmeta(base64);
  if (meta === null) {
    return null;
  }

  const hasBuffer = hasDataBuffer(html);

  return { meta, hasBuffer, rawHtml: html };
}

/**
 * Derive the Figma node ID from the clipboard metadata.
 *
 * The `pasteID` alone is not a full node reference — resolving the actual node
 * requires a round-trip via the Figma MCP or REST API using `fileKey`.  This
 * function returns a best-effort colon-formatted ID when the metadata looks
 * like a scene paste, or `null` when derivation is not possible.
 */
export function extractFigmaNodeId(figmeta: FigmaMeta): string | null {
  if (figmeta.dataType !== "scene" || !Number.isFinite(figmeta.pasteID)) {
    return null;
  }

  // Figma node IDs follow the `pageId:nodeId` pattern.  The pasteID from the
  // clipboard metadata corresponds to the top-level node that was copied, but
  // without page context we can only return the raw numeric ID as a hint.
  return `${figmeta.pasteID}:1`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Extract the value of a `data-*` attribute from the first matching `<span>`
 * using DOM parsing.  Falls back to regex when `DOMParser` is unavailable.
 */
function extractDataAttribute(html: string, attribute: string): string | null {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const span = doc.querySelector(`span[${attribute}]`);
    return span?.getAttribute(attribute) ?? null;
  }

  // Regex fallback for environments without DOMParser (e.g. Node without jsdom).
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}="([^"]*)"`, "i");
  const match = html.match(re);
  return match?.[1] ?? null;
}

/**
 * Strip the `<!--(figmeta)...(/figmeta)-->` comment wrapper and return the
 * inner base64 content, or `null` if the wrapper is absent.
 */
function unwrapFigmeta(raw: string): string | null {
  const match = raw.match(FIGMETA_WRAPPER_RE);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

/**
 * Base64-decode and JSON-parse the figmeta payload.
 * Returns a validated `FigmaMeta` or `null` on any failure.
 */
function decodeFigmeta(base64: string): FigmaMeta | null {
  let json: string;
  try {
    json = atob(base64);
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const { fileKey, pasteID, dataType } = record;

  if (
    typeof fileKey !== "string" ||
    fileKey.length === 0 ||
    typeof pasteID !== "number" ||
    typeof dataType !== "string"
  ) {
    return null;
  }

  return { fileKey, pasteID, dataType };
}

/**
 * Check whether the HTML contains a `data-buffer` span with a `(figma)` payload.
 */
function hasDataBuffer(html: string): boolean {
  return html.includes("(figma)");
}
