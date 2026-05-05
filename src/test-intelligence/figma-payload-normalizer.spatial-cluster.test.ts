/**
 * Issue #1902 — spatial-cluster + sibling-text pairing tests for the Figma
 * payload normalizer.
 *
 * Each test exercises one published behaviour of the pass:
 *   1. plain INSTANCE button with one descendant TEXT donor.
 *   2. donor TEXT is suppressed from the flat node list (no double-count).
 *   3. nested Button → ChildButton → ChildText: deepest button wins.
 *   4. button with explicit `characters` keeps its own label.
 *   5. button with no donor falls back to component name + labelConfidence:0.
 *   6. donor TEXT outside the button bbox is rejected.
 *   7. field-cluster groups label/value pairs by tight bbox adjacency.
 *   8. property: pairing terminates deterministically on random trees.
 */

import assert from "node:assert/strict";
import test from "node:test";
import * as fc from "fast-check";

import type { FigmaRestNode } from "./figma-rest-adapter.js";
import {
  normalizeFigmaFileToIntentInput,
  type NormalizeFigmaInput,
} from "./figma-payload-normalizer.js";

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

const buildScreen = (children: FigmaRestNode[]): NormalizeFigmaInput => ({
  fileKey: "FK",
  document: node({
    id: "screen-1",
    name: "Test-View-04",
    type: "FRAME",
    absoluteBoundingBox: { x: 0, y: 0, width: 1024, height: 1024 },
    children,
  }),
});

test("button INSTANCE with descendant TEXT adopts sibling text as label", () => {
  const input = buildScreen([
    node({
      id: "btn-1",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 100, y: 200, width: 240, height: 64 },
      children: [
        node({
          id: "btn-1-label",
          name: "Label",
          type: "TEXT",
          characters: "Vorhaben hinzufügen",
          absoluteBoundingBox: { x: 110, y: 220, width: 200, height: 24 },
        }),
      ],
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0];
  assert.ok(screen);
  const button = screen.nodes.find((n) => n.nodeId === "btn-1");
  assert.ok(button);
  assert.equal(button.text, "Vorhaben hinzufügen");
  assert.equal(button.labelSource, "sibling_text");
  assert.equal(button.componentName, "<Button>");
  assert.ok(
    button.labelConfidence !== undefined && button.labelConfidence > 0,
    "synthesised label should carry positive confidence",
  );
});

test("donor TEXT is removed from the flat node list (no double-count)", () => {
  const input = buildScreen([
    node({
      id: "btn-1",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "btn-1-label",
          name: "Label",
          type: "TEXT",
          characters: "Speichern",
          absoluteBoundingBox: { x: 10, y: 10, width: 180, height: 40 },
        }),
      ],
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  // Only the button survives — the donor is absorbed as its label.
  assert.deepEqual(
    screen.nodes.map((n) => n.nodeId),
    ["btn-1"],
  );
});

test("nested Button → ChildButton → ChildText: deepest button wins", () => {
  const input = buildScreen([
    node({
      id: "outer-btn",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
      children: [
        node({
          id: "inner-btn",
          name: "<Button>",
          type: "INSTANCE",
          absoluteBoundingBox: { x: 50, y: 50, width: 200, height: 100 },
          children: [
            node({
              id: "inner-text",
              name: "Label",
              type: "TEXT",
              characters: "Nested CTA",
              absoluteBoundingBox: { x: 60, y: 60, width: 180, height: 40 },
            }),
          ],
        }),
      ],
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  const inner = screen.nodes.find((n) => n.nodeId === "inner-btn");
  const outer = screen.nodes.find((n) => n.nodeId === "outer-btn");
  assert.ok(inner);
  assert.ok(outer);
  assert.equal(inner.text, "Nested CTA");
  assert.equal(inner.labelSource, "sibling_text");
  // Outer button does not receive the same donor.
  assert.notEqual(outer.text, "Nested CTA");
  assert.equal(outer.labelConfidence, 0);
});

test("button with author-set characters keeps its own label", () => {
  const input = buildScreen([
    node({
      id: "btn-1",
      name: "<Button>",
      type: "INSTANCE",
      characters: "Submit",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "btn-1-label",
          name: "Label",
          type: "TEXT",
          characters: "Should not adopt",
          absoluteBoundingBox: { x: 10, y: 10, width: 180, height: 40 },
        }),
      ],
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  const button = screen.nodes.find((n) => n.nodeId === "btn-1");
  assert.ok(button);
  assert.equal(button.text, "Submit");
  // labelSource for explicit characters defaults to node_name (button hint).
  assert.notEqual(button.labelSource, "sibling_text");
});

test("button with no donor TEXT keeps component name and labelConfidence 0", () => {
  const input = buildScreen([
    node({
      id: "btn-empty",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  const button = screen.nodes.find((n) => n.nodeId === "btn-empty");
  assert.ok(button);
  assert.equal(button.text, "<Button>");
  assert.equal(button.componentName, "<Button>");
  assert.equal(button.labelConfidence, 0);
});

test("donor TEXT outside the button bbox is not adopted", () => {
  // Sibling text whose bbox is *outside* the button — structural ancestry
  // alone should not be enough when bboxes disagree.
  const input = buildScreen([
    node({
      id: "btn-1",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
      children: [
        node({
          id: "stray-text",
          name: "Stray",
          type: "TEXT",
          characters: "Far away label",
          absoluteBoundingBox: { x: 800, y: 800, width: 100, height: 40 },
        }),
      ],
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  const button = screen.nodes.find((n) => n.nodeId === "btn-1");
  assert.ok(button);
  assert.equal(button.labelConfidence, 0);
  // Stray text is preserved as its own TEXT projection.
  assert.ok(screen.nodes.some((n) => n.nodeId === "stray-text"));
});

test("adjacent label/value TEXT pair shares a clusterId", () => {
  const input = buildScreen([
    node({
      id: "label-text",
      name: "Label",
      type: "TEXT",
      characters: "Gesamtfinanzierungsbedarf",
      absoluteBoundingBox: { x: 100, y: 100, width: 240, height: 24 },
    }),
    node({
      id: "value-text",
      name: "Value",
      type: "TEXT",
      characters: "0,00 €",
      absoluteBoundingBox: { x: 100, y: 130, width: 240, height: 24 },
    }),
    // Far-away unrelated text — must NOT cluster with the pair above.
    node({
      id: "elsewhere",
      name: "Elsewhere",
      type: "TEXT",
      characters: "Footer",
      absoluteBoundingBox: { x: 800, y: 900, width: 200, height: 24 },
    }),
  ]);
  const result = normalizeFigmaFileToIntentInput(input);
  const screen = result.screens[0]!;
  const label = screen.nodes.find((n) => n.nodeId === "label-text");
  const value = screen.nodes.find((n) => n.nodeId === "value-text");
  const other = screen.nodes.find((n) => n.nodeId === "elsewhere");
  assert.ok(label);
  assert.ok(value);
  assert.ok(other);
  assert.ok(label.clusterId);
  assert.equal(label.clusterId, value.clusterId);
  assert.equal(other.clusterId, undefined);
});

test("output remains deterministic across two runs with reordered children", () => {
  const a = buildScreen([
    node({
      id: "btn-A",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "txt-A",
          name: "T",
          type: "TEXT",
          characters: "Alpha",
          absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 40 },
        }),
      ],
    }),
    node({
      id: "btn-B",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 300, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "txt-B",
          name: "T",
          type: "TEXT",
          characters: "Beta",
          absoluteBoundingBox: { x: 310, y: 10, width: 100, height: 40 },
        }),
      ],
    }),
  ]);
  const b = buildScreen([
    node({
      id: "btn-B",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 300, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "txt-B",
          name: "T",
          type: "TEXT",
          characters: "Beta",
          absoluteBoundingBox: { x: 310, y: 10, width: 100, height: 40 },
        }),
      ],
    }),
    node({
      id: "btn-A",
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
      children: [
        node({
          id: "txt-A",
          name: "T",
          type: "TEXT",
          characters: "Alpha",
          absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 40 },
        }),
      ],
    }),
  ]);
  const ra = normalizeFigmaFileToIntentInput(a);
  const rb = normalizeFigmaFileToIntentInput(b);
  assert.equal(JSON.stringify(ra), JSON.stringify(rb));
});

test("Test-View-04 surrogate: at least 5 of 6 buttons receive sibling-text labels", () => {
  // Surrogate fixture for the live Test-View-04 frame from the issue: six
  // button instances laid out vertically, each with a TEXT child carrying the
  // visible label.
  const labels = [
    "Vorhaben hinzufügen",
    "Salden und Raten aktualisieren",
    "Speichern",
    "Abbrechen",
    "Weiter",
    "Zurück",
  ];
  const children: FigmaRestNode[] = labels.map((label, i) =>
    node({
      id: `btn-${i}`,
      name: "<Button>",
      type: "INSTANCE",
      absoluteBoundingBox: { x: 0, y: i * 80, width: 320, height: 60 },
      children: [
        node({
          id: `btn-${i}-label`,
          name: "Label",
          type: "TEXT",
          characters: label,
          absoluteBoundingBox: { x: 10, y: i * 80 + 10, width: 300, height: 40 },
        }),
      ],
    }),
  );
  const result = normalizeFigmaFileToIntentInput(buildScreen(children));
  const screen = result.screens[0]!;
  const buttonNodes = screen.nodes.filter((n) => n.nodeType === "BUTTON");
  assert.equal(buttonNodes.length, 6);
  const adopted = buttonNodes.filter((n) => n.labelSource === "sibling_text");
  assert.ok(
    adopted.length >= 5,
    `expected >=5 buttons to adopt sibling text, got ${adopted.length}`,
  );
  const firstButton = buttonNodes.find((n) => n.nodeId === "btn-0");
  assert.equal(firstButton?.text, "Vorhaben hinzufügen");
  assert.equal(firstButton?.componentName, "<Button>");
});

test("property: pairing terminates deterministically on random trees", () => {
  // Build a random screen with N synthetic buttons, each containing 0..2 text
  // children at random offsets. The pairing pass must always terminate, never
  // throw, and produce the same JSON regardless of input child order.
  const labelArb = fc.string({ minLength: 1, maxLength: 16 });
  const buttonArb = fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    label: fc.option(labelArb, { nil: undefined }),
    bx: fc.integer({ min: 0, max: 800 }),
    by: fc.integer({ min: 0, max: 800 }),
    bw: fc.integer({ min: 50, max: 200 }),
    bh: fc.integer({ min: 30, max: 100 }),
    children: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        text: labelArb,
      }),
      { maxLength: 2 },
    ),
  });
  fc.assert(
    fc.property(
      fc.array(buttonArb, { minLength: 0, maxLength: 8 }),
      (buttons) => {
        const seenIds = new Set<string>();
        const sanitized = buttons
          .filter((b) => {
            if (seenIds.has(b.id)) return false;
            seenIds.add(b.id);
            return true;
          })
          .map((b, i) => ({ ...b, id: `b${i}-${b.id}` }));
        const childrenA: FigmaRestNode[] = sanitized.map((b) => {
          const figma: FigmaRestNode = node({
            id: b.id,
            name: "<Button>",
            type: "INSTANCE",
            absoluteBoundingBox: { x: b.bx, y: b.by, width: b.bw, height: b.bh },
            children: b.children.map((c, ci) =>
              node({
                id: `${b.id}-c${ci}`,
                name: "T",
                type: "TEXT",
                characters: c.text,
                absoluteBoundingBox: {
                  x: b.bx + 1,
                  y: b.by + 1,
                  width: Math.max(1, b.bw - 2),
                  height: Math.max(1, b.bh - 2),
                },
              }),
            ),
          });
          if (b.label !== undefined) figma.characters = b.label;
          return figma;
        });
        const ra = normalizeFigmaFileToIntentInput(buildScreen(childrenA));
        const rb = normalizeFigmaFileToIntentInput(
          buildScreen([...childrenA].reverse()),
        );
        assert.equal(JSON.stringify(ra), JSON.stringify(rb));
        return true;
      },
    ),
    { numRuns: 50 },
  );
});
