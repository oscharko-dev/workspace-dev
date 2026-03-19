import assert from "node:assert/strict";
import test from "node:test";
import {
  ErrorResponseSchema,
  SubmitRequestSchema,
  WorkspaceStatusSchema,
  formatZodError
} from "./schemas.js";

// ---------------------------------------------------------------------------
// SubmitRequestSchema
// ---------------------------------------------------------------------------

test("schema: valid submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    brandTheme: "Sparkasse",
    generationLocale: "en-US",
    formHandlingMode: "react_hook_form",
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaFileKey, "abc123");
    assert.equal(result.data.brandTheme, "sparkasse");
    assert.equal(result.data.generationLocale, "en-US");
    assert.equal(result.data.formHandlingMode, "react_hook_form");
    assert.equal(result.data.figmaSourceMode, "rest");
    assert.equal(result.data.enableGitPr, false);
  }
});

test("schema: valid local_json submit body parses correctly", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    llmCodegenMode: "deterministic"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPath, "./fixtures/figma.json");
    assert.equal(result.data.figmaFileKey, undefined);
    assert.equal(result.data.figmaAccessToken, undefined);
  }
});

test("schema: local_json mode is inferred from figmaJsonPath when figmaSourceMode is omitted", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaJsonPath: "./fixtures/figma.json"
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.figmaSourceMode, "local_json");
    assert.equal(result.data.figmaJsonPath, "./fixtures/figma.json");
  }
});

test("schema: missing required fields fails validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "abc123"
  });
  assert.equal(result.success, false);
});

test("schema: empty required values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "",
    figmaAccessToken: ""
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects missing figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json"
  });
  assert.equal(result.success, false);
});

test("schema: local_json mode rejects rest credentials", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "local_json",
    figmaJsonPath: "./fixtures/figma.json",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx"
  });
  assert.equal(result.success, false);
});

test("schema: rest mode rejects figmaJsonPath", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaSourceMode: "rest",
    figmaFileKey: "abc123",
    figmaAccessToken: "figd_xxx",
    figmaJsonPath: "./fixtures/figma.json"
  });
  assert.equal(result.success, false);
});

test("schema: non-string values fail validation", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: 12345,
    figmaAccessToken: 12345
  });
  assert.equal(result.success, false);
});

test("schema: extra unknown fields are rejected (strict mode)", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    unknownField: "unexpected"
  });
  assert.equal(result.success, false);
});

test("schema: optional fields must be strings when provided", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    projectName: 123,
    generationLocale: 5,
    formHandlingMode: 7
  });
  assert.equal(result.success, false);
});

test("schema: brandTheme must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    brandTheme: "enterprise"
  });
  assert.equal(result.success, false);
});

test("schema: formHandlingMode must be a supported enum value", () => {
  const result = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    formHandlingMode: "formik"
  });
  assert.equal(result.success, false);
});

test("schema: git fields required when enableGitPr=true", () => {
  const invalid = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: true
  });
  assert.equal(invalid.success, false);

  const valid = SubmitRequestSchema.safeParse({
    figmaFileKey: "key-1",
    figmaAccessToken: "token",
    enableGitPr: true,
    repoUrl: "https://github.com/example/repo.git",
    repoToken: "repo-token"
  });
  assert.equal(valid.success, true);
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
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
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
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, false);
});

test("schema: workspace status allows local_json figmaSourceMode", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "local_json",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234,
    outputRoot: "/tmp/.workspace-dev",
    previewEnabled: true
  });
  assert.equal(result.success, true);
});

test("schema: workspace status requires outputRoot and previewEnabled", () => {
  const result = WorkspaceStatusSchema.safeParse({
    running: true,
    url: "http://127.0.0.1:1983",
    host: "127.0.0.1",
    port: 1983,
    figmaSourceMode: "rest",
    llmCodegenMode: "deterministic",
    uptimeMs: 1234
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
