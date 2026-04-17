import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkflowError,
  isWorkflowError,
  toWorkflowError,
} from "./workflow-error.js";

test("WorkflowError keeps structured metadata and cause", () => {
  const cause = new Error("root cause");
  const error = new WorkflowError({
    code: "E_TEST",
    message: "failure",
    stage: "codegen.generate",
    retryable: true,
    cause,
  });

  assert.equal(error.name, "WorkflowError");
  assert.equal(error.code, "E_TEST");
  assert.equal(error.message, "failure");
  assert.equal(error.stage, "codegen.generate");
  assert.equal(error.retryable, true);
  assert.equal(error.cause, cause);
});

test("isWorkflowError detects only WorkflowError instances", () => {
  assert.equal(
    isWorkflowError(new WorkflowError({ code: "E", message: "m" })),
    true,
  );
  assert.equal(isWorkflowError(new Error("plain")), false);
  assert.equal(isWorkflowError("nope"), false);
});

test("toWorkflowError returns existing WorkflowError untouched", () => {
  const existing = new WorkflowError({
    code: "E_EXISTING",
    message: "already typed",
    stage: "figma.source",
    retryable: false,
  });

  assert.equal(
    toWorkflowError(existing, {
      code: "E_FALLBACK",
      message: "fallback message",
    }),
    existing,
  );
});

test("toWorkflowError maps generic Error to WorkflowError preserving message", () => {
  const input = new Error("network timed out");
  const output = toWorkflowError(input, {
    code: "E_NETWORK",
    message: "fallback",
    stage: "figma.source",
    retryable: true,
  });

  assert.equal(output.code, "E_NETWORK");
  assert.equal(output.message, "network timed out");
  assert.equal(output.stage, "figma.source");
  assert.equal(output.retryable, true);
  assert.equal(output.cause, input);
});

test("toWorkflowError maps non-error value to fallback message", () => {
  const output = toWorkflowError(
    { context: "invalid payload" },
    {
      code: "E_FALLBACK",
      message: "invalid payload",
      stage: "ir.derive",
      retryable: false,
    },
  );

  assert.equal(output.code, "E_FALLBACK");
  assert.equal(output.message, "invalid payload");
  assert.equal(output.stage, "ir.derive");
  assert.equal(output.retryable, false);
  assert.deepEqual(output.cause, { context: "invalid payload" });
});

test("WorkflowError preserves optional diagnostics", () => {
  const diagnostics = [
    {
      code: "W_IR_CLASSIFICATION_FALLBACK",
      message: "Fallback used.",
      suggestion: "Rename node.",
      stage: "ir.derive" as const,
      severity: "warning" as const,
    },
  ];
  const error = new WorkflowError({
    code: "E_TEST",
    message: "failure",
    diagnostics,
  });

  assert.deepEqual(error.diagnostics, diagnostics);
});

test("WorkflowError redacts high-risk secrets in error messages", () => {
  const error = new WorkflowError({
    code: "E_API_CALL",
    message:
      'API returned {"error":"unauthorized","Authorization":"Bearer secret_token_123"}',
    stage: "figma.source",
  });

  assert.equal(error.message.includes("secret_token_123"), false);
  assert.equal(error.message.includes("[redacted-secret]"), true);
  assert.equal(error.message.includes('{"error"'), true);
});

test("WorkflowError.toJSON() excludes cause property", () => {
  const cause = new Error("Inner error");
  const error = new WorkflowError({
    code: "E_OUTER",
    message: "Outer error",
    stage: "figma.source",
    cause,
  });

  const json = error.toJSON();
  assert.equal(json.message, "Outer error");
  assert.equal(json.code, "E_OUTER");
  assert.equal(json.stage, "figma.source");
  assert.equal("cause" in json, false);
});

test("WorkflowError.toJSON() includes optional properties when present", () => {
  const error = new WorkflowError({
    code: "E_RETRY",
    message: "Retryable error",
    stage: "fetch.figma",
    retryable: true,
    diagnostics: [
      {
        code: "D_RATE_LIMIT",
        message: "Rate limited",
        suggestion: "Wait before retrying",
        stage: "fetch.figma" as const,
        severity: "warning" as const,
      },
    ],
  });

  const json = error.toJSON();
  assert.equal(json.stage, "fetch.figma");
  assert.equal(json.retryable, true);
  assert.deepEqual(json.diagnostics, [
    {
      code: "D_RATE_LIMIT",
      message: "Rate limited",
      suggestion: "Wait before retrying",
      stage: "fetch.figma",
      severity: "warning",
    },
  ]);
});

test("WorkflowError.toJSON() omits undefined optional properties", () => {
  const error = new WorkflowError({
    code: "E_BASIC",
    message: "Basic error",
    retryable: false,
  });

  const json = error.toJSON();
  assert.equal(json.code, "E_BASIC");
  assert.equal(json.message, "Basic error");
  assert.equal(json.retryable, false);
  assert.equal("stage" in json, false);
  assert.equal("diagnostics" in json, false);
});
