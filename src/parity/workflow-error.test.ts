import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowError, isWorkflowError, toWorkflowError } from "./workflow-error.js";

test("WorkflowError keeps structured metadata and cause", () => {
  const cause = new Error("root cause");
  const error = new WorkflowError({
    code: "E_TEST",
    message: "failure",
    stage: "codegen.generate",
    retryable: true,
    cause
  });

  assert.equal(error.name, "WorkflowError");
  assert.equal(error.code, "E_TEST");
  assert.equal(error.message, "failure");
  assert.equal(error.stage, "codegen.generate");
  assert.equal(error.retryable, true);
  assert.equal(error.cause, cause);
});

test("isWorkflowError detects only WorkflowError instances", () => {
  assert.equal(isWorkflowError(new WorkflowError({ code: "E", message: "m" })), true);
  assert.equal(isWorkflowError(new Error("plain")), false);
  assert.equal(isWorkflowError("nope"), false);
});

test("toWorkflowError returns existing WorkflowError untouched", () => {
  const existing = new WorkflowError({
    code: "E_EXISTING",
    message: "already typed",
    stage: "figma.source",
    retryable: false
  });

  assert.equal(
    toWorkflowError(existing, {
      code: "E_FALLBACK",
      message: "fallback message"
    }),
    existing
  );
});

test("toWorkflowError maps generic Error to WorkflowError preserving message", () => {
  const input = new Error("network timed out");
  const output = toWorkflowError(input, {
    code: "E_NETWORK",
    message: "fallback",
    stage: "figma.source",
    retryable: true
  });

  assert.equal(output.code, "E_NETWORK");
  assert.equal(output.message, "network timed out");
  assert.equal(output.stage, "figma.source");
  assert.equal(output.retryable, true);
  assert.equal(output.cause, input);
});

test("toWorkflowError maps non-error value to fallback message", () => {
  const output = toWorkflowError({ context: "invalid payload" }, {
    code: "E_FALLBACK",
    message: "invalid payload",
    stage: "ir.derive",
    retryable: false
  });

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
      severity: "warning" as const
    }
  ];
  const error = new WorkflowError({
    code: "E_TEST",
    message: "failure",
    diagnostics
  });

  assert.deepEqual(error.diagnostics, diagnostics);
});
