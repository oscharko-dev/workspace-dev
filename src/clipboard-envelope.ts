import { DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT } from "./figma-payload-validation.js";

/**
 * Clipboard envelope for Figma plugin → Inspector handoff.
 *
 * The plugin writes a versioned JSON envelope to the system clipboard.
 * The Inspector detects the `kind` field and delegates to the server
 * for normalization into a pipeline-compatible Figma file structure.
 *
 * @see https://github.com/oscharko-dev/WorkspaceDev/issues/997
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current envelope kind used by the plugin. */
export const CLIPBOARD_ENVELOPE_KIND = "workspace-dev/figma-selection@1";
export const CLIPBOARD_ENVELOPE_KIND_PREFIX = "workspace-dev/figma-selection@";

/**
 * Set of known envelope kinds.  Future versions (`@2`, etc.) are added here
 * so that consumers can distinguish "unknown" from "known-but-unsupported".
 */
const KNOWN_ENVELOPE_KINDS = new Set<string>([CLIPBOARD_ENVELOPE_KIND]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single selection unit — one node exported via
 * `figma.exportAsync({ format: 'JSON_REST_V1' })`.
 */
export interface ClipboardEnvelopeSelection {
  document: {
    id: string;
    type: string;
    name: string;
    [key: string]: unknown;
  };
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  styles: Record<string, unknown>;
}

/** Versioned clipboard envelope written by the Figma plugin. */
export interface ClipboardEnvelope {
  kind: typeof CLIPBOARD_ENVELOPE_KIND;
  pluginVersion: string;
  copiedAt: string;
  selections: ClipboardEnvelopeSelection[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface EnvelopeValidationIssue {
  path: string;
  message: string;
}

export type EnvelopeValidationResult =
  | { valid: true; envelope: ClipboardEnvelope }
  | { valid: false; issues: EnvelopeValidationIssue[] };

export type EnvelopeComplexityValidationResult =
  | { ok: true; selectionCount: number; rootCount: number; nodeCount: number }
  | {
      ok: false;
      message: string;
      selectionCount: number;
      rootCount: number;
      nodeCount: number;
    };

export const DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Keys that, if used as own-property names on plain objects merged into the
 * pipeline, can pollute `Object.prototype` via downstream `Object.assign`,
 * recursive mergers, or `JSON.parse(JSON.stringify(x))` round-trips.
 *
 * Stripped at the validation boundary so the rest of the pipeline never sees
 * them. Defence-in-depth — the existing `key in target` collision guard in
 * `normalizeEnvelopeToFigmaFile` already blocks direct writes, but keeping
 * these keys in the in-memory structure leaves a structural foothold for any
 * future refactor (e.g. switching to `hasOwnProperty.call`) to silently
 * re-introduce CWE-1321.
 */
const FORBIDDEN_PROTOTYPE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Recursively rebuild `value` with `__proto__`/`constructor`/`prototype` keys
 * removed from every plain-object node. Arrays are traversed but kept as
 * arrays. Non-objects are returned as-is. Cycles are broken via the visited
 * set; re-encountered nodes are dropped (clipboard envelopes are tree-shaped
 * by contract — a cycle is itself a malformed input).
 */
const stripDangerousKeysDeep = (
  value: unknown,
  visited: WeakSet<object>,
): unknown => {
  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return [];
    }
    visited.add(value);
    return value.map((item) => stripDangerousKeysDeep(item, visited));
  }
  if (value !== null && typeof value === "object") {
    if (visited.has(value)) {
      return null;
    }
    visited.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FORBIDDEN_PROTOTYPE_KEYS.has(key)) {
        continue;
      }
      out[key] = stripDangerousKeysDeep(child, visited);
    }
    return out;
  }
  return value;
};

/**
 * Strip prototype-pollution keys from a single record (one level deep is the
 * mutation; the value-recursion happens via `stripDangerousKeysDeep`).
 */
const sanitizeRecord = (
  record: Record<string, unknown>,
): Record<string, unknown> =>
  stripDangerousKeysDeep(record, new WeakSet()) as Record<string, unknown>;

const countSelectionNodes = ({
  root,
  maxNodeCount,
}: {
  root: unknown;
  maxNodeCount: number;
}): number => {
  let nodeCount = 0;
  const stack: unknown[] = [root];
  const visited = new Set<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (
      current === undefined ||
      typeof current !== "object" ||
      current === null
    ) {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    nodeCount += 1;
    if (nodeCount > maxNodeCount) {
      return nodeCount;
    }

    const children = (current as { children?: unknown }).children;
    if (!Array.isArray(children) || children.length === 0) {
      continue;
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return nodeCount;
};

/**
 * Quick probe: returns `true` if `input` looks like a clipboard envelope
 * (has a `kind` field matching a known version).  Does NOT validate deeply.
 */
export function isClipboardEnvelope(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }
  return typeof input.kind === "string" && KNOWN_ENVELOPE_KINDS.has(input.kind);
}

/**
 * Broader probe: returns `true` if `input` carries a WorkspaceDev clipboard
 * envelope kind prefix, including versions the current runtime does not
 * support yet.
 */
export function looksLikeClipboardEnvelope(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }
  return (
    typeof input.kind === "string" &&
    input.kind.startsWith(CLIPBOARD_ENVELOPE_KIND_PREFIX)
  );
}

/**
 * Full validation: checks every required field, type, and structure.
 * Returns either a validated envelope or a list of issues.
 */
export function validateClipboardEnvelope(
  input: unknown,
): EnvelopeValidationResult {
  const issues: EnvelopeValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      valid: false,
      issues: [{ path: "(root)", message: "Envelope must be an object." }],
    };
  }

  // kind
  if (typeof input.kind !== "string") {
    issues.push({ path: "kind", message: "kind must be a string." });
  } else if (!KNOWN_ENVELOPE_KINDS.has(input.kind)) {
    issues.push({
      path: "kind",
      message: `Unknown envelope kind: "${input.kind}". Expected one of: ${[...KNOWN_ENVELOPE_KINDS].join(", ")}.`,
    });
  }

  // pluginVersion
  if (
    typeof input.pluginVersion !== "string" ||
    input.pluginVersion.length === 0
  ) {
    issues.push({
      path: "pluginVersion",
      message: "pluginVersion must be a non-empty string.",
    });
  }

  // copiedAt
  if (typeof input.copiedAt !== "string" || input.copiedAt.length === 0) {
    issues.push({
      path: "copiedAt",
      message: "copiedAt must be a non-empty string.",
    });
  }

  // selections
  if (!Array.isArray(input.selections)) {
    issues.push({
      path: "selections",
      message: "selections must be an array.",
    });
  } else if (input.selections.length === 0) {
    issues.push({
      path: "selections",
      message: "selections must contain at least one entry.",
    });
  } else {
    for (let i = 0; i < input.selections.length; i++) {
      const sel = input.selections[i] as unknown;
      const prefix = `selections[${i}]`;
      if (!isRecord(sel)) {
        issues.push({ path: prefix, message: "Selection must be an object." });
        continue;
      }
      if (!isRecord(sel.document)) {
        issues.push({
          path: `${prefix}.document`,
          message: "document must be an object.",
        });
      } else {
        const doc = sel.document;
        if (typeof doc.id !== "string" || doc.id.length === 0) {
          issues.push({
            path: `${prefix}.document.id`,
            message: "document.id must be a non-empty string.",
          });
        }
        if (typeof doc.type !== "string" || doc.type.length === 0) {
          issues.push({
            path: `${prefix}.document.type`,
            message: "document.type must be a non-empty string.",
          });
        }
        if (typeof doc.name !== "string") {
          issues.push({
            path: `${prefix}.document.name`,
            message: "document.name must be a string.",
          });
        }
      }
      if (!isRecord(sel.components)) {
        issues.push({
          path: `${prefix}.components`,
          message: "components must be an object.",
        });
      }
      if (!isRecord(sel.componentSets)) {
        issues.push({
          path: `${prefix}.componentSets`,
          message: "componentSets must be an object.",
        });
      }
      if (!isRecord(sel.styles)) {
        issues.push({
          path: `${prefix}.styles`,
          message: "styles must be an object.",
        });
      }
    }
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  // Defence-in-depth: strip prototype-pollution keys from every plain-object
  // subtree the pipeline will see. CWE-1321. Done after structural validation
  // so the strip cannot mask a missing-required-key violation.
  const sanitizedSelections = (input.selections as unknown[]).map((sel) => {
    const record = sel as Record<string, unknown>;
    return {
      ...record,
      document: stripDangerousKeysDeep(record.document, new WeakSet()),
      components: sanitizeRecord(record.components as Record<string, unknown>),
      componentSets: sanitizeRecord(
        record.componentSets as Record<string, unknown>,
      ),
      styles: sanitizeRecord(record.styles as Record<string, unknown>),
    };
  });

  const sanitizedEnvelope = {
    ...(input as Record<string, unknown>),
    selections: sanitizedSelections,
  } as unknown as ClipboardEnvelope;

  return { valid: true, envelope: sanitizedEnvelope };
}

// ---------------------------------------------------------------------------
// Normalization — envelope → pipeline-compatible Figma file structure
// ---------------------------------------------------------------------------

/**
 * Normalized output compatible with `FigmaFileResponse`.
 */
export interface NormalizedFigmaFile {
  name: string;
  document: {
    id: string;
    type: "DOCUMENT";
    name: string;
    children: unknown[];
  };
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  styles: Record<string, unknown>;
}

/**
 * Convert a validated clipboard envelope into a pipeline-compatible
 * Figma file structure.
 *
 * - **Single selection**: the selection's document node becomes a child
 *   of a synthetic DOCUMENT root.
 * - **Multi selection**: all selections are aggregated under a single
 *   synthetic DOCUMENT root.  Components, componentSets, and styles
 *   are merged (first-writer-wins on key collision).
 */
export function normalizeEnvelopeToFigmaFile(
  envelope: ClipboardEnvelope,
): NormalizedFigmaFile {
  const children: unknown[] = [];
  const components: Record<string, unknown> = {};
  const componentSets: Record<string, unknown> = {};
  const styles: Record<string, unknown> = {};

  for (const selection of envelope.selections) {
    children.push(selection.document);

    // Merge catalog entries (first-writer-wins on collision).
    for (const [key, value] of Object.entries(selection.components)) {
      if (!(key in components)) {
        components[key] = value;
      }
    }
    for (const [key, value] of Object.entries(selection.componentSets)) {
      if (!(key in componentSets)) {
        componentSets[key] = value;
      }
    }
    for (const [key, value] of Object.entries(selection.styles)) {
      if (!(key in styles)) {
        styles[key] = value;
      }
    }
  }

  const name =
    envelope.selections.length === 1
      ? envelope.selections[0]!.document.name
      : `Plugin Export (${envelope.selections.length} selections)`;

  // Wrap each selection under a PAGE node so the existing pipeline
  // (which expects DOCUMENT > PAGE > nodes) processes them correctly.
  const pageChildren = children.map((child, index) => ({
    id: `envelope-page:${index}`,
    type: "CANVAS",
    name:
      isRecord(child) && typeof child.name === "string"
        ? child.name
        : `Selection ${index + 1}`,
    children: [child],
  }));

  return {
    name,
    document: {
      id: "0:0",
      type: "DOCUMENT",
      name: "Document",
      children: pageChildren,
    },
    components,
    componentSets,
    styles,
  };
}

export function validateClipboardEnvelopeComplexity(
  envelope: ClipboardEnvelope,
): EnvelopeComplexityValidationResult {
  const selectionCount = envelope.selections.length;
  if (selectionCount > DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT) {
    return {
      ok: false,
      message: `figmaJsonPayload exceeds the figma_paste selection count budget (${selectionCount} > ${DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT})`,
      selectionCount,
      rootCount: selectionCount,
      nodeCount: 0,
    };
  }

  let nodeCount = 1 + selectionCount;
  if (nodeCount > DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT) {
    return {
      ok: false,
      message: `figmaJsonPayload exceeds the figma_paste node count budget (${nodeCount} > ${DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT})`,
      selectionCount,
      rootCount: selectionCount,
      nodeCount,
    };
  }

  for (const selection of envelope.selections) {
    nodeCount += countSelectionNodes({
      root: selection.document,
      maxNodeCount: DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT - nodeCount,
    });
    if (nodeCount > DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT) {
      return {
        ok: false,
        message: `figmaJsonPayload exceeds the figma_paste node count budget (${nodeCount} > ${DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT})`,
        selectionCount,
        rootCount: selectionCount,
        nodeCount,
      };
    }
  }

  return { ok: true, selectionCount, rootCount: selectionCount, nodeCount };
}

/**
 * Summarize envelope validation issues into a single human-readable string.
 */
export function summarizeEnvelopeValidationIssues(
  issues: EnvelopeValidationIssue[],
): string {
  if (issues.length === 0) {
    return "Unknown envelope validation error.";
  }
  const first = issues[0]!;
  const overflow = issues.length - 1;
  const base = `${first.path}: ${first.message}`;
  if (overflow <= 0) {
    return base;
  }
  const plural = overflow === 1 ? "issue" : "issues";
  return `${base} (+${overflow} more ${plural})`;
}
