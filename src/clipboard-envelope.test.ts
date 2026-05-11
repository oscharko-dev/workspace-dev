import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIPBOARD_ENVELOPE_KIND,
  DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT,
  isClipboardEnvelope,
  looksLikeClipboardEnvelope,
  normalizeEnvelopeToFigmaFile,
  summarizeEnvelopeValidationIssues,
  validateClipboardEnvelope,
  validateClipboardEnvelopeComplexity,
} from "./clipboard-envelope.js";
import { DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT } from "./figma-payload-validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createValidEnvelope(overrides?: Partial<Record<string, unknown>>) {
  return {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-04-12T18:00:00.000Z",
    selections: [
      {
        document: { id: "1:2", type: "FRAME", name: "Card" },
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
    ...overrides,
  };
}

function createMultiSelectionEnvelope() {
  return {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-04-12T18:00:00.000Z",
    selections: [
      {
        document: { id: "1:2", type: "FRAME", name: "Card" },
        components: { "comp:1": { key: "comp:1", name: "Button" } },
        componentSets: {},
        styles: { "style:1": { name: "Primary" } },
      },
      {
        document: { id: "3:4", type: "FRAME", name: "Header" },
        components: { "comp:2": { key: "comp:2", name: "Icon" } },
        componentSets: { "set:1": { name: "Icons" } },
        styles: { "style:1": { name: "ShouldBeIgnored" } },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// isClipboardEnvelope
// ---------------------------------------------------------------------------

test("isClipboardEnvelope returns true for valid envelope", () => {
  assert.equal(isClipboardEnvelope(createValidEnvelope()), true);
});

test("isClipboardEnvelope returns false for non-object", () => {
  assert.equal(isClipboardEnvelope(null), false);
  assert.equal(isClipboardEnvelope("string"), false);
  assert.equal(isClipboardEnvelope(42), false);
  assert.equal(isClipboardEnvelope(undefined), false);
});

test("isClipboardEnvelope returns false for object without kind", () => {
  assert.equal(isClipboardEnvelope({ document: {} }), false);
});

test("isClipboardEnvelope returns false for unknown kind", () => {
  assert.equal(
    isClipboardEnvelope({ kind: "workspace-dev/figma-selection@99" }),
    false,
  );
});

test("looksLikeClipboardEnvelope returns true for supported kind", () => {
  assert.equal(looksLikeClipboardEnvelope(createValidEnvelope()), true);
});

test("looksLikeClipboardEnvelope returns true for unsupported version", () => {
  assert.equal(
    looksLikeClipboardEnvelope({ kind: "workspace-dev/figma-selection@99" }),
    true,
  );
});

test("looksLikeClipboardEnvelope returns false for unrelated kind", () => {
  assert.equal(looksLikeClipboardEnvelope({ kind: "other-envelope@1" }), false);
});

// ---------------------------------------------------------------------------
// validateClipboardEnvelope — success
// ---------------------------------------------------------------------------

test("validateClipboardEnvelope accepts valid single-selection envelope", () => {
  const result = validateClipboardEnvelope(createValidEnvelope());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.envelope.kind, CLIPBOARD_ENVELOPE_KIND);
    assert.equal(result.envelope.selections.length, 1);
  }
});

test("validateClipboardEnvelope accepts valid multi-selection envelope", () => {
  const result = validateClipboardEnvelope(createMultiSelectionEnvelope());
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.envelope.selections.length, 2);
  }
});

// ---------------------------------------------------------------------------
// validateClipboardEnvelope — failures
// ---------------------------------------------------------------------------

test("validateClipboardEnvelope rejects non-object", () => {
  const result = validateClipboardEnvelope("not-an-object");
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0]!.message, /must be an object/);
  }
});

test("validateClipboardEnvelope rejects unknown kind", () => {
  const result = validateClipboardEnvelope(
    createValidEnvelope({ kind: "workspace-dev/figma-selection@99" }),
  );
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === "kind"));
  }
});

test("validateClipboardEnvelope rejects missing pluginVersion", () => {
  const env = createValidEnvelope();
  delete (env as Record<string, unknown>).pluginVersion;
  const result = validateClipboardEnvelope(env);
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === "pluginVersion"));
  }
});

test("validateClipboardEnvelope rejects empty selections array", () => {
  const result = validateClipboardEnvelope(
    createValidEnvelope({ selections: [] }),
  );
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === "selections"));
  }
});

test("validateClipboardEnvelope rejects selection without document", () => {
  const result = validateClipboardEnvelope(
    createValidEnvelope({
      selections: [{ components: {}, componentSets: {}, styles: {} }],
    }),
  );
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.issues.some((i) => i.path === "selections[0].document"));
  }
});

test("validateClipboardEnvelope rejects selection with missing document.id", () => {
  const result = validateClipboardEnvelope(
    createValidEnvelope({
      selections: [
        {
          document: { type: "FRAME", name: "Card" },
          components: {},
          componentSets: {},
          styles: {},
        },
      ],
    }),
  );
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(
      result.issues.some((i) => i.path === "selections[0].document.id"),
    );
  }
});

// ---------------------------------------------------------------------------
// normalizeEnvelopeToFigmaFile — single selection
// ---------------------------------------------------------------------------

test("normalizeEnvelopeToFigmaFile produces valid Figma file for single selection", () => {
  const envelope = createValidEnvelope();
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  const file = normalizeEnvelopeToFigmaFile(result.envelope);

  assert.equal(file.name, "Card");
  assert.equal(file.document.id, "0:0");
  assert.equal(file.document.type, "DOCUMENT");
  assert.equal(file.document.children.length, 1);

  const page = file.document.children[0] as Record<string, unknown>;
  assert.equal(page.type, "CANVAS");
  assert.equal(page.name, "Card");
  assert.ok(Array.isArray(page.children));
  assert.equal((page.children as unknown[]).length, 1);
});

// ---------------------------------------------------------------------------
// normalizeEnvelopeToFigmaFile — multi selection
// ---------------------------------------------------------------------------

test("normalizeEnvelopeToFigmaFile aggregates multi-selection into synthetic document", () => {
  const envelope = createMultiSelectionEnvelope();
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  const file = normalizeEnvelopeToFigmaFile(result.envelope);

  assert.match(file.name, /2 selections/);
  assert.equal(file.document.children.length, 2);

  // Components merged
  assert.ok("comp:1" in file.components);
  assert.ok("comp:2" in file.components);

  // ComponentSets merged
  assert.ok("set:1" in file.componentSets);

  // Styles: first-writer-wins on collision
  assert.ok("style:1" in file.styles);
  assert.deepEqual(
    (file.styles["style:1"] as Record<string, unknown>).name,
    "Primary",
  );
});

// ---------------------------------------------------------------------------
// Prototype-pollution defence (Issue #1684, audit-2026-05 Wave 1)
// ---------------------------------------------------------------------------

test("validateClipboardEnvelope strips __proto__ keys from components/styles", () => {
  const envelope = {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-05-02T00:00:00.000Z",
    selections: [
      {
        document: { id: "1:2", type: "FRAME", name: "Card" },
        components: {
          __proto__: { polluted: true },
          "comp:1": { name: "Button" },
        },
        componentSets: { constructor: { polluted: true } },
        styles: {
          prototype: { polluted: true },
          "style:1": { name: "Primary" },
        },
      },
    ],
  };

  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  const sel = result.envelope.selections[0]!;
  assert.equal(Object.hasOwn(sel.components, "__proto__"), false);
  assert.equal(Object.hasOwn(sel.componentSets, "constructor"), false);
  assert.equal(Object.hasOwn(sel.styles, "prototype"), false);
  assert.equal(Object.hasOwn(sel.components, "comp:1"), true);
  assert.equal(Object.hasOwn(sel.styles, "style:1"), true);

  // Object.prototype must remain unpolluted regardless of input.
  assert.equal(
    (Object.prototype as Record<string, unknown>).polluted,
    undefined,
  );
});

test("validateClipboardEnvelope strips __proto__ keys recursively from document subtree", () => {
  const envelope = {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-05-02T00:00:00.000Z",
    selections: [
      {
        document: {
          id: "1:2",
          type: "FRAME",
          name: "Card",
          children: [
            { __proto__: { polluted: true }, type: "TEXT", name: "Hi" },
          ],
        },
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
  };

  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;

  const child = (
    result.envelope.selections[0]!.document.children as unknown[]
  )[0] as Record<string, unknown>;
  assert.equal(Object.hasOwn(child, "__proto__"), false);
  assert.equal(child.type, "TEXT");
  assert.equal(
    (Object.prototype as Record<string, unknown>).polluted,
    undefined,
  );
});

// ---------------------------------------------------------------------------
// summarizeEnvelopeValidationIssues
// ---------------------------------------------------------------------------

test("summarizeEnvelopeValidationIssues handles empty list", () => {
  assert.match(summarizeEnvelopeValidationIssues([]), /unknown/i);
});

test("summarizeEnvelopeValidationIssues formats single issue", () => {
  const summary = summarizeEnvelopeValidationIssues([
    { path: "kind", message: "kind must be a string." },
  ]);
  assert.match(summary, /kind/);
  assert.ok(!summary.includes("more"));
});

test("summarizeEnvelopeValidationIssues formats multiple issues", () => {
  const summary = summarizeEnvelopeValidationIssues([
    { path: "kind", message: "kind must be a string." },
    { path: "pluginVersion", message: "pluginVersion is missing." },
  ]);
  assert.match(summary, /\+1 more/);
});

// ---------------------------------------------------------------------------
// validateClipboardEnvelopeComplexity (Issue #1702, audit-2026-05 Wave 4)
// Closes a zero-coverage gap — these validators are the DoS / memory-
// exhaustion defence on the figma-paste request path.
// ---------------------------------------------------------------------------

const buildEnvelopeWithSelections = (count: number) => ({
  kind: CLIPBOARD_ENVELOPE_KIND,
  pluginVersion: "0.1.0",
  copiedAt: "2026-05-02T00:00:00.000Z",
  selections: Array.from({ length: count }, (_unused, idx) => ({
    document: { id: `1:${idx}`, type: "FRAME", name: `Frame${idx}` },
    components: {},
    componentSets: {},
    styles: {},
  })),
});

test("validateClipboardEnvelopeComplexity accepts a small envelope", () => {
  const envelope = buildEnvelopeWithSelections(2);
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const complexity = validateClipboardEnvelopeComplexity(result.envelope);
  assert.equal(complexity.ok, true);
  if (!complexity.ok) return;
  assert.equal(complexity.selectionCount, 2);
  assert.ok(complexity.nodeCount >= 3);
});

test("validateClipboardEnvelopeComplexity rejects > selection-count budget", () => {
  const envelope = buildEnvelopeWithSelections(
    DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT + 1,
  );
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const complexity = validateClipboardEnvelopeComplexity(result.envelope);
  assert.equal(complexity.ok, false);
  if (complexity.ok) return;
  assert.match(complexity.message, /selection count budget/);
  assert.equal(
    complexity.selectionCount,
    DEFAULT_FIGMA_PASTE_MAX_SELECTION_COUNT + 1,
  );
});

test("validateClipboardEnvelopeComplexity rejects > node-count budget", () => {
  // Wide-and-shallow tree: one root with `children` array of length
  // > DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT. Avoids deep recursion in the
  // recursive `validate` validator and the `JSON` round-trip in the
  // sanitisation step.
  const children: Array<Record<string, unknown>> = [];
  for (let i = 0; i < DEFAULT_FIGMA_PASTE_MAX_NODE_COUNT + 5; i += 1) {
    children.push({ id: `c${i}`, type: "FRAME", name: `c${i}` });
  }
  const envelope = {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-05-02T00:00:00.000Z",
    selections: [
      {
        document: {
          id: "root",
          type: "FRAME",
          name: "root",
          children,
        },
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
  };
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const complexity = validateClipboardEnvelopeComplexity(result.envelope);
  assert.equal(complexity.ok, false);
  if (complexity.ok) return;
  assert.match(complexity.message, /node count budget/);
});

test("validateClipboardEnvelopeComplexity tolerates cyclic graphs without infinite loop", () => {
  const node: Record<string, unknown> = {
    id: "1:1",
    type: "FRAME",
    name: "cycle",
  };
  node.children = [node];
  const envelope = {
    kind: CLIPBOARD_ENVELOPE_KIND,
    pluginVersion: "0.1.0",
    copiedAt: "2026-05-02T00:00:00.000Z",
    selections: [
      {
        document: node,
        components: {},
        componentSets: {},
        styles: {},
      },
    ],
  };
  const result = validateClipboardEnvelope(envelope);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  // Cycle protection: validator MUST return, not spin forever.
  const complexity = validateClipboardEnvelopeComplexity(result.envelope);
  assert.ok(typeof complexity.nodeCount === "number");
});
