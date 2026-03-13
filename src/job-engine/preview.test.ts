import assert from "node:assert/strict";
import test from "node:test";
import { getContentType, normalizePathPart } from "./preview.js";

test("getContentType resolves known extensions and fallback", () => {
  assert.equal(getContentType("index.html"), "text/html; charset=utf-8");
  assert.equal(getContentType("styles.css"), "text/css; charset=utf-8");
  assert.equal(getContentType("app.js"), "application/javascript; charset=utf-8");
  assert.equal(getContentType("data.json"), "application/json; charset=utf-8");
  assert.equal(getContentType("icon.svg"), "image/svg+xml");
  assert.equal(getContentType("photo.png"), "image/png");
  assert.equal(getContentType("photo.jpg"), "image/jpeg");
  assert.equal(getContentType("photo.jpeg"), "image/jpeg");
  assert.equal(getContentType("file.bin"), "application/octet-stream");
});

test("normalizePathPart removes leading slashes and normalizes separators", () => {
  assert.equal(normalizePathPart("/nested/file.txt"), "nested/file.txt");
  assert.equal(normalizePathPart("\\nested\\file.txt"), "nested/file.txt");
  assert.equal(normalizePathPart("plain/file.txt"), "plain/file.txt");
});
