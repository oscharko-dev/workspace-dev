import assert from "node:assert/strict";
import test from "node:test";
import { createTraversalIndex, getIndexedSubtreeNodeIds, getIndexedTextNodes, getIndexedVectorPaths } from "./generator-traversal-index.js";
import type { ScreenElementIR } from "./types.js";

const makeNode = ({
  id,
  type,
  name = id,
  nodeType = "FRAME",
  ...overrides
}: {
  id: string;
  type: ScreenElementIR["type"];
  name?: string;
  nodeType?: string;
} & Omit<Partial<ScreenElementIR>, "id" | "type" | "name" | "nodeType">): ScreenElementIR =>
  ({
    id,
    type,
    name,
    nodeType,
    ...overrides
  }) as ScreenElementIR;

const makeText = ({
  id,
  text,
  ...overrides
}: {
  id: string;
  text: string;
} & Omit<Partial<ScreenElementIR>, "id" | "type" | "name" | "nodeType" | "text">): ScreenElementIR =>
  ({
    id,
    name: id,
    type: "text",
    nodeType: "TEXT",
    text,
    ...overrides
  }) as ScreenElementIR;

test("createTraversalIndex reuses subtree views for text, vectors, and node ids", () => {
  const icon = makeNode({
    id: "icon",
    type: "image",
    vectorPaths: ["M0 0L1 1", "M0 0L1 1"]
  });
  const label = makeText({
    id: "label",
    text: "Primary label"
  });
  const child = makeNode({
    id: "child",
    type: "container",
    children: [label, icon]
  });
  const root = makeNode({
    id: "root",
    type: "container",
    children: [child]
  });
  child.children?.push(root);

  const index = createTraversalIndex([root]);

  assert.deepEqual(index.flatElements.map((element) => element.id), ["root", "child", "label", "icon"]);
  assert.deepEqual(getIndexedTextNodes(index, root).map((node) => node.id), ["label"]);
  assert.deepEqual(getIndexedVectorPaths(index, child), ["M0 0L1 1"]);
  assert.deepEqual(getIndexedSubtreeNodeIds(index, child), ["child", "label", "icon"]);
});
