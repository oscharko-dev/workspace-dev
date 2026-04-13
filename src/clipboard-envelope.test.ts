import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIPBOARD_ENVELOPE_KIND,
  isClipboardEnvelope,
  normalizeEnvelopeToFigmaFile,
  summarizeEnvelopeValidationIssues,
  validateClipboardEnvelope,
} from "./clipboard-envelope.js";

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
