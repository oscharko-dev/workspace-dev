import assert from "node:assert/strict";
import test from "node:test";
import { createPipelineError, getErrorMessage, mergePipelineDiagnostics } from "./errors.js";

test("createPipelineError sets code/stage/message and preserves cause", () => {
  const cause = new Error("network down");
  const error = createPipelineError({
    code: "E_TEST",
    stage: "figma.source",
    message: "pipeline failed",
    cause
  });

  assert.equal(error.code, "E_TEST");
  assert.equal(error.stage, "figma.source");
  assert.equal(error.message, "pipeline failed");
  assert.equal((error as Error & { cause?: unknown }).cause, cause);
});

test("getErrorMessage returns fallback string forms for unknown values", () => {
  assert.equal(getErrorMessage(new Error("boom")), "boom");
  assert.equal(getErrorMessage("raw"), "raw");
  assert.equal(getErrorMessage(42), "42");
});

test("createPipelineError normalizes and truncates diagnostics", () => {
  const oversized = "x".repeat(500);
  const error = createPipelineError({
    code: "E_TEST",
    stage: "ir.derive",
    message: "failed",
    diagnostics: [
      {
        code: "W_TEST",
        message: oversized,
        suggestion: oversized,
        stage: "ir.derive",
        severity: "warning",
        details: {
          nested: {
            value: oversized
          }
        }
      }
    ]
  });

  assert.equal(error.diagnostics?.length, 1);
  assert.equal(error.diagnostics?.[0]?.code, "W_TEST");
  assert.equal(error.diagnostics?.[0]?.severity, "warning");
  assert.equal(error.diagnostics?.[0]?.message.endsWith("..."), true);
  assert.equal(error.diagnostics?.[0]?.suggestion.endsWith("..."), true);
  assert.equal(String(error.diagnostics?.[0]?.details?.nested).length > 0, true);
});

test("mergePipelineDiagnostics keeps deterministic first-seen order and de-duplicates", () => {
  const merged = mergePipelineDiagnostics({
    first: [
      {
        code: "W_A",
        message: "first",
        suggestion: "s",
        stage: "ir.derive",
        severity: "warning"
      },
      {
        code: "W_A",
        message: "first",
        suggestion: "s",
        stage: "ir.derive",
        severity: "warning"
      }
    ],
    second: [
      {
        code: "W_B",
        message: "second",
        suggestion: "s",
        stage: "validate.project",
        severity: "error"
      }
    ]
  });

  assert.equal(merged?.length, 2);
  assert.equal(merged?.[0]?.code, "W_A");
  assert.equal(merged?.[1]?.code, "W_B");
});
