import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TARGET_PATH, sanitizeTargetPath, toScopePath } from "./target-path.js";

test("sanitizeTargetPath defaults to the generated target path when input is empty", () => {
  assert.equal(sanitizeTargetPath(undefined), DEFAULT_TARGET_PATH);
  assert.equal(sanitizeTargetPath("   "), DEFAULT_TARGET_PATH);
});

test("sanitizeTargetPath trims and normalizes Windows separators", () => {
  assert.equal(sanitizeTargetPath("  nested\\board\\output  "), "nested/board/output");
});

test("sanitizeTargetPath rejects traversal, absolute, and null-byte paths", () => {
  for (const candidate of [
    "../escape",
    "..\\escape",
    "/absolute",
    "foo/../../escape",
    "nested\0escape",
    "C:\\workspace\\generated",
    "C:workspace\\generated",
    "\\\\server\\share\\generated",
  ]) {
    assert.throws(
      () => sanitizeTargetPath(candidate),
      /Invalid targetPath '.*'\. Expected a safe relative path\./
    );
  }
});

test("toScopePath joins the target path and board key with posix separators", () => {
  assert.equal(
    toScopePath({
      targetPath: "figma-generated/output",
      boardKey: "board-123"
    }),
    "figma-generated/output/board-123"
  );
  assert.equal(
    toScopePath({
      targetPath: "figma-generated/output/",
      boardKey: "board-123"
    }),
    "figma-generated/output/board-123"
  );
});
