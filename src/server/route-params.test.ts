import assert from "node:assert/strict";
import test from "node:test";
import { INVALID_PATH_ENCODING, normalizePlatformPath, safeDecode } from "./route-params.js";

// --- safeDecode ---

test("safeDecode returns the decoded string for valid input", () => {
  assert.equal(safeDecode("job-1"), "job-1");
  assert.equal(safeDecode("src%2FApp.tsx"), "src/App.tsx");
  assert.equal(safeDecode("hello%20world"), "hello world");
});

test("safeDecode returns INVALID_PATH_ENCODING for malformed percent-encoding", () => {
  assert.equal(safeDecode("%E0%A4%A"), INVALID_PATH_ENCODING);
  assert.equal(safeDecode("%"), INVALID_PATH_ENCODING);
  assert.equal(safeDecode("%ZZ"), INVALID_PATH_ENCODING);
  assert.equal(safeDecode("foo%2"), INVALID_PATH_ENCODING);
});

test("safeDecode handles empty strings", () => {
  assert.equal(safeDecode(""), "");
});

// --- normalizePlatformPath ---

test("normalizePlatformPath passes through valid POSIX relative paths", () => {
  const result = normalizePlatformPath("src/App.tsx");
  assert.deepEqual(result, { ok: true, normalized: "src/App.tsx" });
});

test("normalizePlatformPath normalizes backslashes to forward slashes", () => {
  const result = normalizePlatformPath("src\\screens\\Home.tsx");
  assert.deepEqual(result, { ok: true, normalized: "src/screens/Home.tsx" });
});

test("normalizePlatformPath normalizes mixed separators", () => {
  const result = normalizePlatformPath("src/screens\\Home.tsx");
  assert.deepEqual(result, { ok: true, normalized: "src/screens/Home.tsx" });
});

test("normalizePlatformPath rejects POSIX absolute paths", () => {
  const result = normalizePlatformPath("/etc/passwd");
  assert.equal(result.ok, false);
});

test("normalizePlatformPath rejects Windows drive-letter absolute paths", () => {
  assert.equal(normalizePlatformPath("C:\\Windows\\System32").ok, false);
  assert.equal(normalizePlatformPath("c:/Users/evil").ok, false);
  assert.equal(normalizePlatformPath("D:\\data").ok, false);
});

test("normalizePlatformPath rejects UNC paths", () => {
  assert.equal(normalizePlatformPath("\\\\server\\share").ok, false);
  assert.equal(normalizePlatformPath("//server/share").ok, false);
});

test("normalizePlatformPath rejects backslash-only absolute paths", () => {
  // A single leading backslash becomes "/" after normalization => absolute
  const result = normalizePlatformPath("\\etc\\passwd");
  assert.equal(result.ok, false);
});

test("normalizePlatformPath handles empty string", () => {
  const result = normalizePlatformPath("");
  assert.deepEqual(result, { ok: true, normalized: "" });
});
