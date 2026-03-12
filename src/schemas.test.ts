import assert from "node:assert/strict";
import test from "node:test";
import {
  ErrorResponseSchema,
  SubmitRequestSchema,
  formatZodError,
  WorkspaceStatusSchema
} from "./schemas.js";

// ---------------------------------------------------------------------------
// SubmitRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaFileKey, "abc123");
    assert.equal(result.data.figmaSourceMode, "rest");
  }
});

test("schema: minimal valid submit body (only figmaFileKey)", () => {
  const result = SubmitRequestSchema.safeParse({ figmaFileKey: "key-1" });
  assert.equal(result.success, true);
});

test("schema: missing figmaFileKey fails validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest"
  });
  assert.equal(result.success, false);
});

test("schema: empty figmaFileKey fails validation", () => {
  const result = SubmitRequestSchema.safeParse({ figmaFileKey: "" });
  assert.equal(result.success, false);
});

test("schema: non-string figmaFileKey fails validation", () => {
  const result = SubmitRequestSchema.safeParse({ figmaFileKey: 12345 });
  assert.equal(result.success, false);
});

test("schema: extra unknown fields are rejected (strict mode)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    unknownField: "unexpected"
  });
  assert.equal(result.success, false);
});

test("schema: null body fails validation", () => {
  const result = SubmitRequestSchema.safeParse(null);
  assert.equal(result.success, false);
});

test("schema: undefined body fails validation", () => {
  const result = SubmitRequestSchema.safeParse(undefined);
  assert.equal(result.success, false);
});

test("schema: array body fails validation", () => {
  const result = SubmitRequestSchema.safeParse([]);
  assert.equal(result.success, false);
});

test("schema: optional fields must be strings when provided", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc",
    projectName: 123
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// WorkspaceStatusSchema
// ---------------------------------------------------------------------------

test("schema: valid workspace status parses", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234
  });
  assert.equal(result.success, true);
});

test("schema: workspace status rejects non-rest figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "mcp",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234
  });
  assert.equal(result.success, false);
});

test("schema: workspace status rejects non-object payloads", () => {
  const result = WorkspaceStatusSchema.safeParse("bad-payload");
  assert.equal(result.success, false);
});

test("schema: workspace status rejects invalid primitive fields", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: "yes",
    url: 100,
    host: false,
    port: -1,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    uptimeMs: -10
  });
  assert.equal(result.success, false);
});

test("schema: error envelope requires message and error strings", () => {
  const result = ErrorResponseSchema.safeParse({
    error: "X",
    message: "Y"
  });
  assert.equal(result.success, true);

  const invalid = ErrorResponseSchema.safeParse({ error: "X", message: 1 });
  assert.equal(invalid.success, false);

  const notObject = ErrorResponseSchema.safeParse(undefined);
  assert.equal(notObject.success, false);
});

// ---------------------------------------------------------------------------
// formatZodError
// ---------------------------------------------------------------------------

test("schema: formatZodError produces deterministic output", () => {
  const result = SubmitRequestSchema.safeParse({ figmaFileKey: 123 });
  assert.equal(result.success, false);
  if (!result.success) {
    const formatted = formatZodError(result.error);
    assert.equal(formatted.error, "VALIDATION_ERROR");
    assert.equal(formatted.message, "Request validation failed.");
    assert.ok(Array.isArray(formatted.issues));
    assert.ok(formatted.issues.length > 0);
    assert.equal(typeof formatted.issues[0]!.path, "string");
    assert.equal(typeof formatted.issues[0]!.message, "string");
  }
});

test("schema: formatZodError maps root-level paths correctly", () => {
  const formatted = formatZodError({
    issues: [{ path: [], message: "root issue" }]
  });
  assert.equal(formatted.issues[0]?.path, "(root)");
});
