import assert from "node:assert/strict";
import test from "node:test";
import {
  isGeometryEmpty,
  isHelperItemNode,
  isHelperItemNodeName,
  isNodeGeometryEmpty,
  isTechnicalPlaceholderNode,
  isTechnicalPlaceholderText,
  normalizePlaceholderText
} from "./figma-node-heuristics.js";

test("normalizePlaceholderText normalizes whitespace and case", () => {
  assert.equal(normalizePlaceholderText({ value: "  Swap   Component " }), "swap component");
  assert.equal(normalizePlaceholderText({ value: "AlternativText" }), "alternativtext");
});

test("isTechnicalPlaceholderText matches known technical placeholders", () => {
  assert.equal(isTechnicalPlaceholderText({ text: "Swap Component" }), true);
  assert.equal(isTechnicalPlaceholderText({ text: " instance   swap " }), true);
  assert.equal(isTechnicalPlaceholderText({ text: "Visible Value" }), false);
});

test("isTechnicalPlaceholderNode requires TEXT node with technical placeholder text", () => {
  assert.equal(
    isTechnicalPlaceholderNode({
      node: { type: "TEXT", characters: "Add Description" }
    }),
    true
  );
  assert.equal(
    isTechnicalPlaceholderNode({
      node: { type: "FRAME", characters: "Add Description" }
    }),
    false
  );
});

test("isHelperItemNodeName recognizes helper naming variants", () => {
  assert.equal(isHelperItemNodeName({ name: "_Item" }), true);
  assert.equal(isHelperItemNodeName({ name: "_item row" }), true);
  assert.equal(isHelperItemNodeName({ name: "item_wrapper" }), true);
  assert.equal(isHelperItemNodeName({ name: "row_item" }), true);
  assert.equal(isHelperItemNodeName({ name: "item" }), false);
});

test("isHelperItemNode uses node name safely", () => {
  assert.equal(isHelperItemNode({ node: { name: "_Item" } }), true);
  assert.equal(isHelperItemNode({ node: { name: "Card" } }), false);
  assert.equal(isHelperItemNode({ node: {} }), false);
});

test("isGeometryEmpty and isNodeGeometryEmpty detect only non-positive finite bounds", () => {
  assert.equal(isGeometryEmpty({ absoluteBoundingBox: { width: 0, height: 24 } }), true);
  assert.equal(isGeometryEmpty({ absoluteBoundingBox: { width: 12, height: 0 } }), true);
  assert.equal(isGeometryEmpty({ absoluteBoundingBox: { width: 12, height: 24 } }), false);
  assert.equal(isGeometryEmpty({ absoluteBoundingBox: { width: Number.NaN, height: 24 } }), false);

  assert.equal(
    isNodeGeometryEmpty({
      node: { absoluteBoundingBox: { x: 0, y: 0, width: 0, height: 10 } }
    }),
    true
  );
  assert.equal(
    isNodeGeometryEmpty({
      node: { absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 } }
    }),
    false
  );
});
