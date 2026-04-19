import assert from "node:assert/strict";
import test from "node:test";
import { isValidBoardKey, resolveBoardKey, toSyncBranchName } from "./board-key.js";

test("resolveBoardKey normalizes and appends stable hash", () => {
  const key = resolveBoardKey("  My Fancy Board  ");
  assert.equal(isValidBoardKey(key), true);
  assert.ok(key.startsWith("my-fancy-board-"));
  assert.equal(resolveBoardKey("My Fancy Board"), resolveBoardKey("My Fancy Board"));
});

test("resolveBoardKey rejects empty input", () => {
  assert.throws(() => resolveBoardKey("   "), /figmaFileKey is empty/);
});

test("board key validation and generation stay within 75 character max", () => {
  const key = resolveBoardKey("x".repeat(512));
  assert.equal(key.length, 75);
  assert.equal(isValidBoardKey("a".repeat(75)), true);
  assert.equal(isValidBoardKey("a".repeat(76)), false);
});

test("toSyncBranchName validates and normalizes board keys", () => {
  const boardKey = resolveBoardKey("Board-123");
  const branch = toSyncBranchName(boardKey.toUpperCase());
  assert.equal(branch, `auto/figma-sync/${boardKey}`);
  assert.throws(() => toSyncBranchName("bad key"), /Invalid board key/);
});
