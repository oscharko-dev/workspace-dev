import assert from "node:assert/strict";
import test from "node:test";

import type { FigmaRestNode } from "./figma-rest-adapter.js";
import {
  normalizeFigmaFileToIntentInput,
  type NormalizeFigmaInput,
} from "./figma-payload-normalizer.js";

const node = (
  partial: Partial<FigmaRestNode> & { id: string; type: string },
): FigmaRestNode => partial as FigmaRestNode;

test("normalizeFigmaFileToIntentInput emits one screen per FRAME with bounding box", () => {
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "0:0",
      type: "DOCUMENT",
      children: [
        node({
          id: "0:1",
          name: "Page 1",
          type: "CANVAS",
          children: [
            node({
              id: "1:1",
              name: "Login",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
              children: [
                node({
                  id: "1:2",
                  name: "Email",
                  type: "TEXT",
                  characters: "Email",
                }),
              ],
            }),
            node({
              id: "1:3",
              name: "Signup",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
              children: [],
            }),
          ],
        }),
      ],
    }),
  };
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.source.kind, "figma_rest");
  assert.equal(result.screens.length, 2);
  // Sorted deterministically by screenId.
  assert.equal(result.screens[0]?.screenId, "1:1");
  assert.equal(result.screens[1]?.screenId, "1:3");
});

test("normalizeFigmaFileToIntentInput skips invisible nodes", () => {
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "0:0",
      type: "DOCUMENT",
      children: [
        node({
          id: "0:1",
          name: "Page 1",
          type: "CANVAS",
          children: [
            node({
              id: "1:1",
              name: "Hidden",
              type: "FRAME",
              visible: false,
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
            }),
            node({
              id: "1:2",
              name: "Visible",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
            }),
          ],
        }),
      ],
    }),
  };
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.screens.length, 1);
  assert.equal(result.screens[0]?.screenId, "1:2");
});

test("normalizeFigmaFileToIntentInput pulls text and button nodes inside a screen", () => {
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "0:0",
      type: "DOCUMENT",
      children: [
        node({
          id: "0:1",
          name: "Page 1",
          type: "CANVAS",
          children: [
            node({
              id: "1:1",
              name: "Login",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
              children: [
                node({
                  id: "2:1",
                  name: "Email",
                  type: "TEXT",
                  characters: "Email",
                }),
                node({
                  id: "2:2",
                  name: "Submit",
                  type: "INSTANCE",
                  characters: "Submit",
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  };
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.screens.length, 1);
  const screen = result.screens[0];
  assert.ok(screen);
  assert.equal(screen.nodes.length, 2);
  // Sorted by nodeId.
  assert.equal(screen.nodes[0]?.nodeId, "2:1");
  assert.equal(screen.nodes[0]?.text, "Email");
  assert.equal(screen.nodes[1]?.nodeId, "2:2");
});

test("normalizeFigmaFileToIntentInput emits no screens for an empty document", () => {
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "0:0",
      type: "DOCUMENT",
      children: [],
    }),
  };
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.screens.length, 0);
});

test("normalizeFigmaFileToIntentInput accepts a node-scoped FRAME directly as the document root", () => {
  // When the adapter fetches a node-scoped subtree, the document root IS the
  // requested frame (no DOCUMENT/CANVAS wrapper). The normalizer must still
  // produce a screen for it.
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "1:1",
      name: "Bedarfsermittlung",
      type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 1200 },
      children: [
        node({
          id: "2:1",
          name: "Investitionssumme",
          type: "TEXT",
          characters: "Investitionssumme",
        }),
      ],
    }),
  };
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.screens.length, 1);
  assert.equal(result.screens[0]?.screenId, "1:1");
  assert.equal(result.screens[0]?.nodes.length, 1);
});

test("normalizeFigmaFileToIntentInput is depth-bounded", () => {
  // Build a deeply nested tree; make sure normalization terminates and does
  // not blow the stack.
  let inner: FigmaRestNode = node({
    id: "leaf",
    type: "TEXT",
    characters: "leaf",
  });
  for (let i = 0; i < 200; i += 1) {
    inner = node({
      id: `n-${i}`,
      type: "GROUP",
      children: [inner],
    });
  }
  const input: NormalizeFigmaInput = {
    fileKey: "ABC",
    document: node({
      id: "0:0",
      type: "DOCUMENT",
      children: [
        node({
          id: "0:1",
          name: "Page 1",
          type: "CANVAS",
          children: [
            node({
              id: "1:1",
              name: "Wrapper",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
              children: [inner],
            }),
          ],
        }),
      ],
    }),
  };
  // Should complete without stack overflow.
  const result = normalizeFigmaFileToIntentInput(input);
  assert.equal(result.screens.length, 1);
});
