import assert from "node:assert/strict";
import test from "node:test";
import { parseIrMarkersFromSource } from "./component-manifest.js";

test("parseIrMarkersFromSource returns empty for content without markers", () => {
  const content = `import React from "react";\nexport default function App() { return <div />; }\n`;
  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});

test("parseIrMarkersFromSource parses a single marker pair", () => {
  const content = [
    `import React from "react";`,
    `{/* @ir:start node-1 MyButton INSTANCE */}`,
    `<Button>Click</Button>`,
    `{/* @ir:end node-1 */}`,
    ``
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    irNodeId: "node-1",
    irNodeName: "MyButton",
    irNodeType: "INSTANCE",
    file: "src/screens/Home.tsx",
    startLine: 2,
    endLine: 4
  });
});

test("parseIrMarkersFromSource parses nested marker pairs", () => {
  const content = [
    `{/* @ir:start parent-1 Container FRAME */}`,
    `<div>`,
    `  {/* @ir:start child-1 Label TEXT */}`,
    `  <span>Hello</span>`,
    `  {/* @ir:end child-1 */}`,
    `</div>`,
    `{/* @ir:end parent-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 2);

  const child = entries.find((e) => e.irNodeId === "child-1");
  assert.ok(child);
  assert.equal(child.irNodeName, "Label");
  assert.equal(child.irNodeType, "TEXT");
  assert.equal(child.startLine, 3);
  assert.equal(child.endLine, 5);

  const parent = entries.find((e) => e.irNodeId === "parent-1");
  assert.ok(parent);
  assert.equal(parent.startLine, 1);
  assert.equal(parent.endLine, 7);
});

test("parseIrMarkersFromSource detects extracted components", () => {
  const content = [
    `{/* @ir:start comp-1 CardPattern INSTANCE extracted */}`,
    `<Card />`,
    `{/* @ir:end comp-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/screens/Home.tsx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.extractedComponent, true);
});

test("parseIrMarkersFromSource handles names with spaces", () => {
  const content = [
    `{/* @ir:start id-1 My Long Component Name FRAME */}`,
    `<div />`,
    `{/* @ir:end id-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.irNodeName, "My Long Component Name");
  assert.equal(entries[0]!.irNodeType, "FRAME");
});

test("parseIrMarkersFromSource ignores unmatched start markers", () => {
  const content = [
    `{/* @ir:start orphan-1 Orphan FRAME */}`,
    `<div />`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});

test("parseIrMarkersFromSource ignores unmatched end markers", () => {
  const content = [
    `<div />`,
    `{/* @ir:end ghost-1 */}`
  ].join("\n");

  const entries = parseIrMarkersFromSource(content, "src/App.tsx");
  assert.equal(entries.length, 0);
});
