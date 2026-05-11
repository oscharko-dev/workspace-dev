import assert from "node:assert/strict";
import test from "node:test";
import {
  extractDiffablePasteRoots,
  extractDiffablePasteRootsFromJson,
} from "./paste-delta-roots.js";

test("extractDiffablePasteRoots returns page child frames instead of page wrappers", () => {
  const roots = extractDiffablePasteRoots({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              id: "screen-1",
              type: "FRAME",
              name: "Screen 1",
              children: [],
            },
            {
              id: "screen-2",
              type: "FRAME",
              name: "Screen 2",
              children: [],
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    roots.map((root) => root.id),
    ["screen-1", "screen-2"],
  );
});

test("extractDiffablePasteRoots flattens section wrappers to screen-like children", () => {
  const roots = extractDiffablePasteRoots({
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: "0:1",
          type: "CANVAS",
          name: "Page 1",
          children: [
            {
              id: "section-1",
              type: "SECTION",
              name: "Checkout",
              children: [
                {
                  id: "screen-1",
                  type: "FRAME",
                  name: "Shipping",
                  children: [],
                },
                {
                  id: "screen-2",
                  type: "COMPONENT",
                  name: "Summary",
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.deepEqual(
    roots.map((root) => root.id),
    ["screen-1", "screen-2"],
  );
});

test("extractDiffablePasteRootsFromJson keeps direct frame roots unchanged", () => {
  const roots = extractDiffablePasteRootsFromJson(
    JSON.stringify({
      document: {
        id: "0:0",
        type: "DOCUMENT",
        children: [
          {
            id: "screen-1",
            type: "FRAME",
            name: "Hero",
            children: [],
          },
        ],
      },
    }),
  );

  assert.deepEqual(
    roots.map((root) => root.id),
    ["screen-1"],
  );
});
