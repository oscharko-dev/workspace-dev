/**
 * Unit tests for the guided override remap suggestion engine.
 *
 * Covers:
 *   - Empty unmapped list returns no suggestions
 *   - Exact ID match (high confidence)
 *   - Name + type match (high confidence)
 *   - Fuzzy name + type match (medium confidence)
 *   - Ancestry + type match (low confidence)
 *   - Rejection when no rule matches
 *   - Mixed scenarios with multiple rules
 *   - Source node not found in source IR
 *
 * @see https://github.com/oscharko-dev/workspace-dev/issues/466
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generateRemapSuggestions } from "./remap-suggestions.js";
import type { DesignIR, ScreenIR, ScreenElementIR } from "../parity/types-ir.js";

const makeElement = (overrides: Partial<ScreenElementIR> & { id: string; name: string; type: ScreenElementIR["type"] }): ScreenElementIR => ({
  nodeType: "FRAME",
  ...overrides
} as ScreenElementIR);

const makeScreen = (overrides: Partial<ScreenIR> & { id: string; name: string }): ScreenIR => ({
  layoutMode: "VERTICAL",
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  children: [],
  ...overrides
});

const makeIr = (screens: ScreenIR[]): DesignIR => ({
  sourceName: "test",
  screens,
  tokens: {
    palette: {
      primary: "#000", secondary: "#111", background: "#fff", text: "#000",
      success: "#0f0", warning: "#ff0", error: "#f00", info: "#00f",
      divider: "#ccc",
      action: { active: "#000", hover: "#111", selected: "#222", disabled: "#999", disabledBackground: "#eee", focus: "#333" }
    },
    borderRadius: 4,
    spacingBase: 8,
    fontFamily: "Roboto",
    headingSize: 24,
    bodySize: 14,
    typography: {
      h1: { fontSizePx: 32, fontWeight: 700, lineHeightPx: 40 },
      h2: { fontSizePx: 28, fontWeight: 700, lineHeightPx: 36 },
      h3: { fontSizePx: 24, fontWeight: 600, lineHeightPx: 32 },
      h4: { fontSizePx: 20, fontWeight: 600, lineHeightPx: 28 },
      h5: { fontSizePx: 18, fontWeight: 500, lineHeightPx: 24 },
      h6: { fontSizePx: 16, fontWeight: 500, lineHeightPx: 22 },
      subtitle1: { fontSizePx: 16, fontWeight: 400, lineHeightPx: 24 },
      subtitle2: { fontSizePx: 14, fontWeight: 500, lineHeightPx: 20 },
      body1: { fontSizePx: 16, fontWeight: 400, lineHeightPx: 24 },
      body2: { fontSizePx: 14, fontWeight: 400, lineHeightPx: 20 },
      button: { fontSizePx: 14, fontWeight: 500, lineHeightPx: 20 },
      caption: { fontSizePx: 12, fontWeight: 400, lineHeightPx: 16 },
      overline: { fontSizePx: 10, fontWeight: 400, lineHeightPx: 14 }
    }
  }
});

test("remap: empty unmapped list returns no suggestions", () => {
  const sourceIr = makeIr([makeScreen({ id: "s1", name: "Screen" })]);
  const latestIr = makeIr([makeScreen({ id: "s1", name: "Screen" })]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: [],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 0);
  assert.equal(result.rejections.length, 0);
  assert.equal(result.message, "No unmapped nodes to remap.");
});

test("remap: exact ID match produces high confidence suggestion", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Screen",
      children: [makeElement({ id: "btn-1", name: "Submit", type: "button" })]
    })
  ]);
  // Latest IR has the same node ID but we pretend it wasn't found by carry-forward
  // (In practice, exact-id match catches nodes that exist but weren't in the draft's nodeId list)
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Screen",
      children: [makeElement({ id: "btn-1", name: "Submit Button", type: "button" })]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["btn-1"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.rejections.length, 0);
  assert.equal(result.suggestions[0]?.rule, "exact-id");
  assert.equal(result.suggestions[0]?.confidence, "high");
  assert.equal(result.suggestions[0]?.targetNodeId, "btn-1");
});

test("remap: name + type match produces high confidence suggestion", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Login",
      children: [makeElement({ id: "old-btn", name: "Submit", type: "button" })]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Login",
      children: [makeElement({ id: "new-btn", name: "Submit", type: "button" })]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["old-btn"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.rule, "name-and-type");
  assert.equal(result.suggestions[0]?.confidence, "high");
  assert.equal(result.suggestions[0]?.targetNodeId, "new-btn");
});

test("remap: fuzzy name + type match produces medium confidence suggestion", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Dashboard",
      children: [makeElement({ id: "old-card", name: "User Card", type: "card" })]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Dashboard",
      children: [makeElement({ id: "new-card", name: "user-card", type: "card" })]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["old-card"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.rule, "name-fuzzy-and-type");
  assert.equal(result.suggestions[0]?.confidence, "medium");
  assert.equal(result.suggestions[0]?.targetNodeId, "new-card");
});

test("remap: ancestry + type match produces low confidence suggestion", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Profile",
      children: [
        makeElement({
          id: "container-1",
          name: "Header",
          type: "container",
          children: [
            makeElement({ id: "old-text", name: "Old Title", type: "text", text: "Title" } as never)
          ]
        })
      ]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Profile",
      children: [
        makeElement({
          id: "container-1",
          name: "Header",
          type: "container",
          children: [
            makeElement({ id: "new-text", name: "New Title", type: "text", text: "Title" } as never)
          ]
        })
      ]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["old-text"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.rule, "ancestry-and-type");
  assert.equal(result.suggestions[0]?.confidence, "low");
  assert.equal(result.suggestions[0]?.targetNodeId, "new-text");
});

test("remap: rejection when no rule matches", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Home",
      children: [makeElement({ id: "old-slider", name: "Volume", type: "slider" })]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Home",
      children: [makeElement({ id: "new-btn", name: "Play", type: "button" })]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["old-slider"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 0);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0]?.sourceNodeId, "old-slider");
  assert.ok(result.rejections[0]?.reason.includes("No matching node"));
});

test("remap: source node not found in source IR produces rejection", () => {
  const sourceIr = makeIr([makeScreen({ id: "s1", name: "Screen" })]);
  const latestIr = makeIr([makeScreen({ id: "s1", name: "Screen" })]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["nonexistent-node"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 0);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0]?.sourceNodeName, "(unknown)");
  assert.ok(result.rejections[0]?.reason.includes("not found in the source IR"));
});

test("remap: mixed scenario with multiple rules and rejections", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Settings",
      children: [
        makeElement({ id: "exact-match", name: "ExactNode", type: "container" }),
        makeElement({ id: "name-match-old", name: "Toggle Dark Mode", type: "switch" }),
        makeElement({ id: "no-match", name: "Deleted Widget", type: "progress" })
      ]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Settings",
      children: [
        makeElement({ id: "exact-match", name: "ExactNode Renamed", type: "container" }),
        makeElement({ id: "name-match-new", name: "Toggle Dark Mode", type: "switch" }),
        makeElement({ id: "new-widget", name: "New Widget", type: "chip" })
      ]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["exact-match", "name-match-old", "no-match"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 2);
  assert.equal(result.rejections.length, 1);

  const exactSuggestion = result.suggestions.find((s) => s.sourceNodeId === "exact-match");
  assert.ok(exactSuggestion);
  assert.equal(exactSuggestion.rule, "exact-id");
  assert.equal(exactSuggestion.confidence, "high");

  const nameSuggestion = result.suggestions.find((s) => s.sourceNodeId === "name-match-old");
  assert.ok(nameSuggestion);
  assert.equal(nameSuggestion.rule, "name-and-type");
  assert.equal(nameSuggestion.targetNodeId, "name-match-new");

  const rejection = result.rejections.find((r) => r.sourceNodeId === "no-match");
  assert.ok(rejection);
  assert.equal(rejection.sourceNodeName, "Deleted Widget");
});

test("remap: ambiguous name+type match (multiple candidates) falls through to next rule", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "List",
      children: [makeElement({ id: "old-item", name: "Item", type: "card" })]
    })
  ]);
  // Two candidates with same name+type — ambiguous, should not match name-and-type
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "List",
      children: [
        makeElement({ id: "new-item-1", name: "Item", type: "card" }),
        makeElement({ id: "new-item-2", name: "Item", type: "card" })
      ]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["old-item"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  // Should fall through name-and-type (ambiguous) and name-fuzzy-and-type (also ambiguous)
  // ancestry-and-type also ambiguous (same parent, same depth, same type)
  // => rejection
  assert.equal(result.suggestions.length, 0);
  assert.equal(result.rejections.length, 1);
});

test("remap: result message reflects counts correctly", () => {
  const sourceIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Page",
      children: [
        makeElement({ id: "a", name: "A", type: "button" }),
        makeElement({ id: "b", name: "B", type: "input" })
      ]
    })
  ]);
  const latestIr = makeIr([
    makeScreen({
      id: "s1",
      name: "Page",
      children: [
        makeElement({ id: "a2", name: "A", type: "button" })
        // B removed — no match possible
      ]
    })
  ]);

  const result = generateRemapSuggestions({
    sourceIr,
    latestIr,
    unmappedNodeIds: ["a", "b"],
    sourceJobId: "job-a",
    latestJobId: "job-b"
  });

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.rejections.length, 1);
  assert.ok(result.message.includes("1 of 2"));
  assert.ok(result.message.includes("1 could not be mapped"));
});
