import assert from "node:assert/strict";
import test from "node:test";
import { createPipelineError, getErrorMessage } from "./errors.js";

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
