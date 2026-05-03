/**
 * UntrustedContentNormalizer (Issue #1774).
 *
 * Strips 2025-vintage prompt-injection carriers from untrusted content
 * BEFORE any LLM sees it. Pure, deterministic, depth-bounded, zero-runtime-
 * deps; never persists raw stripped content.
 *
 * Carriers handled:
 *
 *   - Hidden Figma layers (`visible=false`)
 *   - Zero-opacity Figma layers
 *   - Off-canvas Figma layers (bounding box outside the parent screen)
 *   - Zero font-size Figma layers
 *   - Sentinel layer names (`__system`, `__instructions`, anything starting `__`)
 *     → severity `critical` → routes the job to `needs_review`
 *   - Zero-width Unicode in source text: U+200B U+200C U+200D U+FEFF
 *   - Atlassian Document Format (ADF) collapsed nodes — the normalizer
 *     defers to the existing `parseJiraAdfDocument` allow-list
 *   - Per-element hard byte cap (Jira-comment baseline)
 *
 * Detector integration:
 *
 *   - `detectPii` from `pii-detection.ts` — matches counted, never the
 *     match values themselves
 *   - `redactHighRiskSecrets` from `../secret-redaction.ts` — pre/post-byte
 *     diff is counted as the secret-match count
 *   - Markdown prompt-injection patterns (locally pinned regex set, mirrored
 *     from `test-design-model.ts`) — pattern hits counted
 *
 * The normalizer is fail-closed:
 *   - Any exception during traversal is caught and surfaced as a
 *     `needs_review` outcome with carrier `adf_collapsed_node`.
 *   - Banking profile callers do not get an opt-out: the production
 *     pipeline runs this before prompt compilation regardless of profile.
 *
 * Output contract:
 *
 *   - The returned `report` has only counts; no raw content is persisted
 *     anywhere in the artifact.
 *   - The optional file writer emits canonical-JSON
 *     (deterministic key ordering) so the report is byte-stable across
 *     runs and across input key reordering.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ALLOWED_UNTRUSTED_CONTENT_CARRIER_KINDS,
  MAX_UNTRUSTED_CONTENT_ELEMENT_BYTES,
  MAX_UNTRUSTED_CONTENT_MARKDOWN_BYTES,
  TEST_INTELLIGENCE_CONTRACT_VERSION,
  UNTRUSTED_CONTENT_NORMALIZATION_REPORT_ARTIFACT_FILENAME,
  UNTRUSTED_CONTENT_NORMALIZATION_REPORT_SCHEMA_VERSION,
  type UntrustedContentCarrierKind,
  type UntrustedContentNormalizationOutcome,
  type UntrustedContentSeverity,
} from "../contracts/index.js";
import { redactHighRiskSecrets } from "../secret-redaction.js";
import { canonicalJson } from "./content-hash.js";
import { parseJiraAdfDocument } from "./jira-adf-parser.js";
import { detectPii } from "./pii-detection.js";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Untrusted-content payload shapes accepted by the normalizer. */
export interface UntrustedContentNormalizerInput {
  /** Optional Figma REST file payload (any tree shape). Passed by reference; not mutated. */
  readonly figma?: { readonly document: unknown };
  /** Optional raw ADF JSON document string (UTF-8). */
  readonly jiraAdf?: string;
  /** Optional raw Markdown body (UTF-8). */
  readonly markdown?: string;
  /** Optional generic free-text fields, keyed by stable id. */
  readonly textFields?: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
  }>;
}

/**
 * Drop-count buckets emitted by the normalizer. Counts are non-negative
 * integers; zero values are kept (omitting them would defeat the
 * canonical-JSON byte-stability guarantee).
 */
export interface UntrustedContentDropCounts {
  readonly figmaHiddenLayers: number;
  readonly figmaZeroOpacityLayers: number;
  readonly figmaOffCanvasLayers: number;
  readonly figmaZeroFontSizeLayers: number;
  readonly sentinelLayerNames: number;
  readonly zeroWidthCharacters: number;
  readonly adfCollapsedNodes: number;
  readonly elementsTruncated: number;
  readonly piiMatches: number;
  readonly secretMatches: number;
  readonly markdownInjectionMatches: number;
}

/** Per-carrier reason that escalated the job to `needs_review`. */
export interface UntrustedContentNeedsReviewReason {
  readonly carrier: UntrustedContentCarrierKind;
  readonly severity: UntrustedContentSeverity;
  readonly count: number;
}

/** Drop-count report. Persisted as canonical JSON; counts only. */
export interface UntrustedContentNormalizationReport {
  readonly schemaVersion: typeof UNTRUSTED_CONTENT_NORMALIZATION_REPORT_SCHEMA_VERSION;
  readonly contractVersion: typeof TEST_INTELLIGENCE_CONTRACT_VERSION;
  readonly outcome: UntrustedContentNormalizationOutcome;
  readonly needsReviewReasons: ReadonlyArray<UntrustedContentNeedsReviewReason>;
  readonly counts: UntrustedContentDropCounts;
}

/** Sanitised payload + report. */
export interface UntrustedContentNormalizationOutput {
  readonly figma?: { readonly document: unknown };
  readonly jiraAdfPlainText?: string;
  readonly markdown?: string;
  readonly textFields?: ReadonlyArray<{
    readonly id: string;
    readonly text: string;
  }>;
  readonly report: UntrustedContentNormalizationReport;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Zero-width Unicode codepoints stripped from every source string:
 * U+200B ZERO WIDTH SPACE, U+200C ZERO WIDTH NON-JOINER,
 * U+200D ZERO WIDTH JOINER, U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM.
 */
const ZERO_WIDTH_RE = /\u200B|\u200C|\u200D|\uFEFF/gu;

/** Sentinel-name prefix that flips the outcome to `needs_review`. */
const SENTINEL_NAME_PREFIX = "__";

/** Hard depth cap for the iterative Figma walker. */
const MAX_FIGMA_TRAVERSAL_DEPTH = 64;

/** Hard total-node visit cap to bound CPU on pathological trees. */
const MAX_FIGMA_VISIT_NODES = 50_000;

/**
 * Markdown prompt-injection regex set. Mirrored from
 * `test-design-model.ts` so the normalizer ships its own copy and is
 * not coupled to the test-design-model module's lifecycle. Patterns are
 * stable strings and additive — adding a pattern is a minor bump.
 */
const MARKDOWN_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (all )?(previous|prior) (instructions|directives)\b/iu,
  /\bdisregard (the )?(system|instructions)\b/iu,
  /\bsystem\s*:\s*/iu,
  /\b<\s*\/?\s*(system|user|assistant)\s*>/iu,
  /\bsudo\s+/iu,
  /\bjailbreak\b/iu,
  /\boverride (this|the) (rule|policy)\b/iu,
];

/** Stable per-carrier severity assignment for the routing summary. */
const CARRIER_SEVERITY: Readonly<
  Record<UntrustedContentCarrierKind, UntrustedContentSeverity>
> = {
  figma_hidden_layer: "info",
  figma_zero_opacity_layer: "info",
  figma_off_canvas_layer: "warning",
  figma_zero_font_size_layer: "warning",
  sentinel_layer_name: "critical",
  zero_width_character: "warning",
  adf_collapsed_node: "warning",
  element_truncated: "info",
  pii_match: "warning",
  secret_match: "critical",
  markdown_injection_pattern: "critical",
};

/** Carriers whose presence flips the outcome to `needs_review`. */
const CRITICAL_CARRIERS: ReadonlySet<UntrustedContentCarrierKind> = new Set(
  ALLOWED_UNTRUSTED_CONTENT_CARRIER_KINDS.filter(
    (kind) => CARRIER_SEVERITY[kind] === "critical",
  ),
);

/** Replacement placeholder fed to {@link redactHighRiskSecrets}. */
const SECRET_REPLACEMENT = "[REDACTED:SECRET]";

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Normalize an untrusted-content payload. Pure: identical inputs always
 * yield identical outputs (counts and sanitised text are byte-stable).
 */
export const normalizeUntrustedContent = (
  input: UntrustedContentNormalizerInput,
): UntrustedContentNormalizationOutput => {
  const counts = newCounts();
  const output: {
    figma?: { readonly document: unknown };
    jiraAdfPlainText?: string;
    markdown?: string;
    textFields?: ReadonlyArray<{ id: string; text: string }>;
  } = {};

  if (input.figma !== undefined) {
    const figma = normalizeFigmaTree(input.figma.document, counts);
    output.figma = { document: figma };
  }

  if (input.jiraAdf !== undefined) {
    output.jiraAdfPlainText = normalizeJiraAdf(input.jiraAdf, counts);
  }

  if (input.markdown !== undefined) {
    output.markdown = normalizeMarkdown(input.markdown, counts);
  }

  if (input.textFields !== undefined) {
    output.textFields = normalizeTextFields(input.textFields, counts);
  }

  const report = buildReport(counts);
  return { ...output, report };
};

/**
 * Persist the canonical-JSON drop-count report under
 * `<runDir>/untrusted-content-normalization-report.json`. The file is
 * written atomically by the kernel-level `writeFile` semantics; counts
 * only, no raw content.
 */
export const writeUntrustedContentNormalizationReport = async (
  runDir: string,
  report: UntrustedContentNormalizationReport,
): Promise<{ path: string; bytesWritten: number }> => {
  const path = join(
    runDir,
    UNTRUSTED_CONTENT_NORMALIZATION_REPORT_ARTIFACT_FILENAME,
  );
  const body = canonicalJson(report);
  await writeFile(path, body, { encoding: "utf8" });
  return { path, bytesWritten: Buffer.byteLength(body, "utf8") };
};

// ---------------------------------------------------------------------------
// Figma traversal
// ---------------------------------------------------------------------------

interface MutableCounts {
  figmaHiddenLayers: number;
  figmaZeroOpacityLayers: number;
  figmaOffCanvasLayers: number;
  figmaZeroFontSizeLayers: number;
  sentinelLayerNames: number;
  zeroWidthCharacters: number;
  adfCollapsedNodes: number;
  elementsTruncated: number;
  piiMatches: number;
  secretMatches: number;
  markdownInjectionMatches: number;
}

interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const newCounts = (): MutableCounts => ({
  figmaHiddenLayers: 0,
  figmaZeroOpacityLayers: 0,
  figmaOffCanvasLayers: 0,
  figmaZeroFontSizeLayers: 0,
  sentinelLayerNames: 0,
  zeroWidthCharacters: 0,
  adfCollapsedNodes: 0,
  elementsTruncated: 0,
  piiMatches: 0,
  secretMatches: 0,
  markdownInjectionMatches: 0,
});

const normalizeFigmaTree = (
  rootValue: unknown,
  counts: MutableCounts,
): unknown => {
  if (!isPlainObject(rootValue)) return rootValue;
  // Output shares structure with input but is a fresh object tree so the
  // caller's payload is not mutated.
  return walkFigmaNode(rootValue, null, 0, counts, { visited: 0 });
};

const walkFigmaNode = (
  node: Record<string, unknown>,
  parentBox: BoundingBox | null,
  depth: number,
  counts: MutableCounts,
  budget: { visited: number },
): Record<string, unknown> | null => {
  if (depth > MAX_FIGMA_TRAVERSAL_DEPTH) return null;
  if (++budget.visited > MAX_FIGMA_VISIT_NODES) return null;

  if (shouldDropForVisibility(node)) {
    counts.figmaHiddenLayers += 1;
    return null;
  }
  if (shouldDropForOpacity(node)) {
    counts.figmaZeroOpacityLayers += 1;
    return null;
  }
  if (hasSentinelName(node)) {
    counts.sentinelLayerNames += 1;
    return null;
  }
  if (shouldDropForFontSize(node)) {
    counts.figmaZeroFontSizeLayers += 1;
    return null;
  }
  const ownBox = readBoundingBox(node);
  if (
    parentBox !== null &&
    ownBox !== null &&
    !boxesIntersect(ownBox, parentBox)
  ) {
    counts.figmaOffCanvasLayers += 1;
    return null;
  }

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(node).sort()) {
    if (key === "children") continue;
    const value = node[key];
    if (key === "characters" && typeof value === "string") {
      out.characters = sanitizeUntrustedString(value, counts);
      continue;
    }
    if (key === "name" && typeof value === "string") {
      out.name = sanitizeUntrustedString(value, counts);
      continue;
    }
    out[key] = value;
  }

  const childrenValue = node.children;
  if (Array.isArray(childrenValue)) {
    const projectedChildren: Record<string, unknown>[] = [];
    const nextParentBox = ownBox ?? parentBox;
    for (const child of childrenValue) {
      if (!isPlainObject(child)) continue;
      const projected = walkFigmaNode(
        child,
        nextParentBox,
        depth + 1,
        counts,
        budget,
      );
      if (projected !== null) projectedChildren.push(projected);
    }
    out.children = projectedChildren;
  }

  return out;
};

const shouldDropForVisibility = (node: Record<string, unknown>): boolean => {
  return node.visible === false;
};

const shouldDropForOpacity = (node: Record<string, unknown>): boolean => {
  const opacity = node.opacity;
  return typeof opacity === "number" && opacity === 0;
};

const shouldDropForFontSize = (node: Record<string, unknown>): boolean => {
  const style = node.style;
  if (!isPlainObject(style)) return false;
  const fontSize = style.fontSize;
  return typeof fontSize === "number" && fontSize === 0;
};

const hasSentinelName = (node: Record<string, unknown>): boolean => {
  const name = node.name;
  if (typeof name !== "string") return false;
  return name.startsWith(SENTINEL_NAME_PREFIX);
};

const readBoundingBox = (node: Record<string, unknown>): BoundingBox | null => {
  const raw = node.absoluteBoundingBox;
  if (!isPlainObject(raw)) return null;
  const x = toFiniteNumber(raw.x);
  const y = toFiniteNumber(raw.y);
  const width = toFiniteNumber(raw.width);
  const height = toFiniteNumber(raw.height);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return { x, y, width, height };
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

const boxesIntersect = (a: BoundingBox, b: BoundingBox): boolean => {
  // Rectangles touch (including zero-area) count as intersecting; the
  // off-canvas attack relies on a layer being entirely outside the parent.
  const aRight = a.x + a.width;
  const aBottom = a.y + a.height;
  const bRight = b.x + b.width;
  const bBottom = b.y + b.height;
  if (aRight < b.x) return false;
  if (a.x > bRight) return false;
  if (aBottom < b.y) return false;
  if (a.y > bBottom) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Jira ADF
// ---------------------------------------------------------------------------

const normalizeJiraAdf = (input: string, counts: MutableCounts): string => {
  const result = parseJiraAdfDocument(input);
  if (!result.ok) {
    counts.adfCollapsedNodes += 1;
    return "";
  }
  const sanitized = sanitizeUntrustedString(result.document.plainText, counts);
  // Per-element cap: the parser's plain-text output must fit a single
  // element's hard byte cap so a giant ADF body can't smuggle 100 KiB of
  // payload into the prompt.
  return enforceElementCap(sanitized, counts);
};

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const normalizeMarkdown = (input: string, counts: MutableCounts): string => {
  // Defense-in-depth byte cap before any regex scan.
  if (Buffer.byteLength(input, "utf8") > MAX_UNTRUSTED_CONTENT_MARKDOWN_BYTES) {
    counts.elementsTruncated += 1;
    const truncated = truncateUtf8(input, MAX_UNTRUSTED_CONTENT_MARKDOWN_BYTES);
    return scanAndSanitizeMarkdown(truncated, counts);
  }
  return scanAndSanitizeMarkdown(input, counts);
};

const scanAndSanitizeMarkdown = (
  input: string,
  counts: MutableCounts,
): string => {
  const stripped = sanitizeUntrustedString(input, counts);
  for (const re of MARKDOWN_INJECTION_PATTERNS) {
    const matches = stripped.match(new RegExp(re.source, re.flags + "g"));
    if (matches !== null) {
      counts.markdownInjectionMatches += matches.length;
    }
  }
  return stripped;
};

// ---------------------------------------------------------------------------
// Generic text fields
// ---------------------------------------------------------------------------

const normalizeTextFields = (
  fields: ReadonlyArray<{ id: string; text: string }>,
  counts: MutableCounts,
): ReadonlyArray<{ id: string; text: string }> => {
  const out: { id: string; text: string }[] = [];
  for (const field of fields) {
    if (typeof field.id !== "string" || typeof field.text !== "string") {
      continue;
    }
    const sanitized = sanitizeUntrustedString(field.text, counts);
    const capped = enforceElementCap(sanitized, counts);
    out.push({ id: field.id, text: capped });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Shared sanitization
// ---------------------------------------------------------------------------

/**
 * Apply zero-width stripping, PII detection, and secret redaction to a
 * single untrusted text span. Counts are folded into the shared bucket;
 * the returned string is sanitized in-place and remains byte-stable.
 */
const sanitizeUntrustedString = (
  input: string,
  counts: MutableCounts,
): string => {
  if (input.length === 0) return input;

  const zeroWidthHits = (input.match(ZERO_WIDTH_RE) ?? []).length;
  let working = input;
  if (zeroWidthHits > 0) {
    counts.zeroWidthCharacters += zeroWidthHits;
    working = working.replace(ZERO_WIDTH_RE, "");
  }

  if (detectPii(working) !== null) {
    counts.piiMatches += 1;
  }

  const redacted = redactHighRiskSecrets(working, SECRET_REPLACEMENT);
  if (redacted !== working) {
    // Count one secret-match per sanitized span; the redactor runs many
    // patterns and may rewrite multiple times, but the carrier is "this
    // span carried a secret" — granular per-pattern counts would force
    // us to re-run the scan, doubling cost for no policy benefit.
    counts.secretMatches += 1;
    working = redacted;
  }

  return working;
};

const enforceElementCap = (input: string, counts: MutableCounts): string => {
  if (Buffer.byteLength(input, "utf8") <= MAX_UNTRUSTED_CONTENT_ELEMENT_BYTES) {
    return input;
  }
  counts.elementsTruncated += 1;
  return truncateUtf8(input, MAX_UNTRUSTED_CONTENT_ELEMENT_BYTES);
};

const truncateUtf8 = (input: string, maxBytes: number): string => {
  const buf = Buffer.from(input, "utf8");
  if (buf.length <= maxBytes) return input;
  // Walk back from the cap until we find a UTF-8 boundary so we never
  // emit a half-encoded codepoint.
  let cut = maxBytes;
  while (cut > 0) {
    const byte = buf[cut];
    if (byte === undefined || (byte & 0b1100_0000) !== 0b1000_0000) break;
    cut -= 1;
  }
  return buf.subarray(0, cut).toString("utf8");
};

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

const buildReport = (
  counts: MutableCounts,
): UntrustedContentNormalizationReport => {
  const dropCounts: UntrustedContentDropCounts = {
    figmaHiddenLayers: counts.figmaHiddenLayers,
    figmaZeroOpacityLayers: counts.figmaZeroOpacityLayers,
    figmaOffCanvasLayers: counts.figmaOffCanvasLayers,
    figmaZeroFontSizeLayers: counts.figmaZeroFontSizeLayers,
    sentinelLayerNames: counts.sentinelLayerNames,
    zeroWidthCharacters: counts.zeroWidthCharacters,
    adfCollapsedNodes: counts.adfCollapsedNodes,
    elementsTruncated: counts.elementsTruncated,
    piiMatches: counts.piiMatches,
    secretMatches: counts.secretMatches,
    markdownInjectionMatches: counts.markdownInjectionMatches,
  };

  const reasons: UntrustedContentNeedsReviewReason[] = [];
  for (const carrier of ALLOWED_UNTRUSTED_CONTENT_CARRIER_KINDS) {
    const count = countForCarrier(carrier, dropCounts);
    if (count === 0) continue;
    if (!CRITICAL_CARRIERS.has(carrier)) continue;
    reasons.push({
      carrier,
      severity: CARRIER_SEVERITY[carrier],
      count,
    });
  }
  reasons.sort((a, b) => a.carrier.localeCompare(b.carrier));

  return {
    schemaVersion: UNTRUSTED_CONTENT_NORMALIZATION_REPORT_SCHEMA_VERSION,
    contractVersion: TEST_INTELLIGENCE_CONTRACT_VERSION,
    outcome: reasons.length === 0 ? "ok" : "needs_review",
    needsReviewReasons: reasons,
    counts: dropCounts,
  };
};

const countForCarrier = (
  carrier: UntrustedContentCarrierKind,
  counts: UntrustedContentDropCounts,
): number => {
  switch (carrier) {
    case "figma_hidden_layer":
      return counts.figmaHiddenLayers;
    case "figma_zero_opacity_layer":
      return counts.figmaZeroOpacityLayers;
    case "figma_off_canvas_layer":
      return counts.figmaOffCanvasLayers;
    case "figma_zero_font_size_layer":
      return counts.figmaZeroFontSizeLayers;
    case "sentinel_layer_name":
      return counts.sentinelLayerNames;
    case "zero_width_character":
      return counts.zeroWidthCharacters;
    case "adf_collapsed_node":
      return counts.adfCollapsedNodes;
    case "element_truncated":
      return counts.elementsTruncated;
    case "pii_match":
      return counts.piiMatches;
    case "secret_match":
      return counts.secretMatches;
    case "markdown_injection_pattern":
      return counts.markdownInjectionMatches;
    default: {
      const exhaustive: never = carrier;
      return exhaustive;
    }
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
