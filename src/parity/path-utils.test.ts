import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureTsxName, resolveInside, sanitizeFileName } from "./path-utils.js";

test("sanitizeFileName keeps safe characters and normalizes separators", () => {
  assert.equal(sanitizeFileName("My Screen/One"), "My_Screen_One");
  assert.equal(sanitizeFileName("***"), "_");
});

test("ensureTsxName normalizes casing and extension", () => {
  assert.equal(ensureTsxName("my screen"), "My_screen.tsx");
  assert.equal(ensureTsxName("Already.tsx"), "Already_tsx.tsx");
});

test("resolveInside returns nested paths and blocks traversal", () => {
  const root = path.join(os.tmpdir(), "workspace-dev-path-utils");
  const nested = resolveInside(root, "nested/file.txt");
  assert.ok(nested.startsWith(path.resolve(root)));
  assert.throws(() => resolveInside(root, "../escape.txt"), /Path escapes root/);
});
