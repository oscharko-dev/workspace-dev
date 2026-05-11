import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256Hex } from "./content-hash.js";

test("canonicalJson sorts object keys recursively", () => {
  const a = { b: 1, a: { y: 2, x: 1 } };
  const b = { a: { x: 1, y: 2 }, b: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"a":{"x":1,"y":2},"b":1}');
});

test("canonicalJson preserves array order", () => {
  assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
});

test("canonicalJson handles primitives and null", () => {
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson(42), "42");
  assert.equal(canonicalJson("hello"), '"hello"');
  assert.equal(canonicalJson(true), "true");
});

test("sha256Hex is deterministic across key-reordered objects", () => {
  const a = { b: 1, a: 2, c: [3, { y: 1, x: 2 }] };
  const b = { c: [3, { x: 2, y: 1 }], a: 2, b: 1 };
  assert.equal(sha256Hex(a), sha256Hex(b));
});

test("sha256Hex changes when a value changes", () => {
  assert.notEqual(sha256Hex({ a: 1 }), sha256Hex({ a: 2 }));
});
