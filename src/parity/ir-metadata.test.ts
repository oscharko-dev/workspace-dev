import assert from "node:assert/strict";
import test from "node:test";
import type { FigmaMcpMetadataHint } from "./types-job.js";
import {
  inferSemanticTypeFromMetadataHint,
  normalizeMetadataHint,
  deriveSemanticHintsFromMetadata,
  SEMANTIC_TYPE_PATTERNS
} from "./ir-metadata.js";

// ---------------------------------------------------------------------------
// inferSemanticTypeFromMetadataHint — name-pattern matching
// ---------------------------------------------------------------------------

test("inferSemanticTypeFromMetadataHint detects navigation patterns", () => {
  const cases: Array<{ input: Partial<FigmaMcpMetadataHint>; expected: string }> = [
    { input: { layerName: "Sidebar" }, expected: "navigation" },
    { input: { layerName: "Main Navigation" }, expected: "navigation" },
    { input: { layerName: "Navbar" }, expected: "navigation" },
    { input: { layerName: "Menu" }, expected: "navigation" },
    { input: { layerName: "Drawer" }, expected: "navigation" },
    { input: { layerName: "TabBar" }, expected: "navigation" },
    { input: { semanticName: "nav-container" }, expected: "navigation" }
  ];
  for (const { input, expected } of cases) {
    const hint: FigmaMcpMetadataHint = { nodeId: "1:1", sourceTools: ["get_metadata"], ...input };
    assert.equal(inferSemanticTypeFromMetadataHint(hint), expected, `Failed for: ${JSON.stringify(input)}`);
  }
});

test("inferSemanticTypeFromMetadataHint detects header patterns", () => {
  const cases: Array<{ input: Partial<FigmaMcpMetadataHint>; expected: string }> = [
    { input: { layerName: "Header" }, expected: "header" },
    { input: { layerName: "AppBar" }, expected: "header" },
    { input: { layerName: "Top Bar" }, expected: "header" },
    { input: { layerName: "Banner Section" }, expected: "header" },
    { input: { layerName: "Hero" }, expected: "header" }
  ];
  for (const { input, expected } of cases) {
    const hint: FigmaMcpMetadataHint = { nodeId: "1:2", sourceTools: ["get_metadata"], ...input };
    assert.equal(inferSemanticTypeFromMetadataHint(hint), expected, `Failed for: ${JSON.stringify(input)}`);
  }
});

test("inferSemanticTypeFromMetadataHint detects main content patterns", () => {
  const hint: FigmaMcpMetadataHint = { nodeId: "1:3", layerName: "Main Content", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(hint), "main");
});

test("inferSemanticTypeFromMetadataHint detects footer patterns", () => {
  const cases = ["Footer", "Bottom Bar", "contentinfo area"];
  for (const name of cases) {
    const hint: FigmaMcpMetadataHint = { nodeId: "1:4", layerName: name, sourceTools: ["get_metadata"] };
    assert.equal(inferSemanticTypeFromMetadataHint(hint), "footer", `Failed for: ${name}`);
  }
});

test("inferSemanticTypeFromMetadataHint detects article and card patterns", () => {
  const hint1: FigmaMcpMetadataHint = { nodeId: "1:5", layerName: "Article Preview", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(hint1), "article");
  const hint2: FigmaMcpMetadataHint = { nodeId: "1:6", layerName: "Product Card", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(hint2), "article");
});

test("inferSemanticTypeFromMetadataHint detects section and form patterns", () => {
  const sectionHint: FigmaMcpMetadataHint = { nodeId: "1:7", layerName: "Settings Section", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(sectionHint), "section");
  const formHint: FigmaMcpMetadataHint = { nodeId: "1:8", layerName: "Login Form", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(formHint), "form");
});

test("inferSemanticTypeFromMetadataHint returns undefined for unrecognized names", () => {
  const hint: FigmaMcpMetadataHint = { nodeId: "1:9", layerName: "Frame 42", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(hint), undefined);
});

test("inferSemanticTypeFromMetadataHint returns undefined for empty hint", () => {
  const hint: FigmaMcpMetadataHint = { nodeId: "1:10", sourceTools: ["get_metadata"] };
  assert.equal(inferSemanticTypeFromMetadataHint(hint), undefined);
});

test("inferSemanticTypeFromMetadataHint falls back to semanticType passthrough", () => {
  const hint: FigmaMcpMetadataHint = {
    nodeId: "1:11",
    semanticType: "custom-landmark",
    sourceTools: ["get_metadata"]
  };
  assert.equal(inferSemanticTypeFromMetadataHint(hint), "custom-landmark");
});

test("inferSemanticTypeFromMetadataHint prefers pattern match over raw semanticType", () => {
  const hint: FigmaMcpMetadataHint = {
    nodeId: "1:12",
    semanticType: "generic",
    layerName: "Navigation Panel",
    sourceTools: ["get_metadata"]
  };
  assert.equal(inferSemanticTypeFromMetadataHint(hint), "navigation");
});

// ---------------------------------------------------------------------------
// normalizeMetadataHint
// ---------------------------------------------------------------------------

test("normalizeMetadataHint derives semanticName from layerName when semanticName is absent", () => {
  const hint: FigmaMcpMetadataHint = { nodeId: "2:1", layerName: "Profile Header", sourceTools: ["get_metadata"] };
  const normalized = normalizeMetadataHint(hint);
  assert.equal(normalized.semanticName, "Profile Header");
  assert.equal(normalized.semanticType, "header");
});

test("normalizeMetadataHint preserves existing semanticName", () => {
  const hint: FigmaMcpMetadataHint = {
    nodeId: "2:2",
    semanticName: "Custom Name",
    layerName: "Sidebar Nav",
    sourceTools: ["get_metadata"]
  };
  const normalized = normalizeMetadataHint(hint);
  assert.equal(normalized.semanticName, "Custom Name");
  assert.equal(normalized.semanticType, "navigation");
});

// ---------------------------------------------------------------------------
// deriveSemanticHintsFromMetadata — batch processing
// ---------------------------------------------------------------------------

test("deriveSemanticHintsFromMetadata normalizes all hints in batch", () => {
  const hints: FigmaMcpMetadataHint[] = [
    { nodeId: "3:1", layerName: "Header", sourceTools: ["get_metadata"] },
    { nodeId: "3:2", layerName: "Main Content", sourceTools: ["get_metadata"] },
    { nodeId: "3:3", layerName: "Footer", sourceTools: ["get_metadata"] },
    { nodeId: "3:4", layerName: "Frame 99", sourceTools: ["get_metadata"] }
  ];
  const derived = deriveSemanticHintsFromMetadata(hints);
  assert.equal(derived.length, 4);
  assert.equal(derived[0]?.semanticType, "header");
  assert.equal(derived[1]?.semanticType, "main");
  assert.equal(derived[2]?.semanticType, "footer");
  assert.equal(derived[3]?.semanticType, undefined);
});

// ---------------------------------------------------------------------------
// SEMANTIC_TYPE_PATTERNS — exhaustive coverage
// ---------------------------------------------------------------------------

test("SEMANTIC_TYPE_PATTERNS contains all documented pattern categories", () => {
  const expectedTypes = ["navigation", "header", "main", "footer", "article", "section", "form"];
  const actualTypes = SEMANTIC_TYPE_PATTERNS.map(([, type]) => type);
  for (const expected of expectedTypes) {
    assert.ok(actualTypes.includes(expected), `Missing pattern for semantic type: ${expected}`);
  }
});
