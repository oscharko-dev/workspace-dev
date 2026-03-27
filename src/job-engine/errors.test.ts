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

test("createPipelineError drops invalid diagnostics and sanitizes heterogeneous detail values", () => {
  const error = createPipelineError({
    code: "E_TEST",
    stage: "validate.project",
    message: "failed",
    diagnostics: [
      {
        code: "   ",
        message: "ignored",
        suggestion: "ignored"
      },
      {
        code: "W_SANITIZED",
        message: "  detailed warning  ",
        suggestion: "  fix it  ",
        figmaNodeId: "  1:2  ",
        figmaUrl: "  https://example.test/node/1:2  ",
        details: {
          finiteNumber: 42,
          infiniteNumber: Number.POSITIVE_INFINITY,
          nullValue: null,
          undefinedValue: undefined,
          bigintValue: 99n,
          symbolValue: Symbol("demo"),
          functionValue: function sample() {
            return "ok";
          },
          nestedArray: [1, undefined, Number.NaN, { keep: true }],
          deepObject: {
            one: {
              two: {
                three: {
                  four: {
                    five: "trimmed"
                  }
                }
              }
            }
          }
        }
      },
      {
        code: "W_EMPTY_MESSAGE",
        message: "   ",
        suggestion: "ignored"
      },
      {
        code: "W_EMPTY_SUGGESTION",
        message: "ignored",
        suggestion: "   "
      }
    ]
  });

  assert.equal(error.diagnostics?.length, 1);
  assert.equal(error.diagnostics?.[0]?.code, "W_SANITIZED");
  assert.equal(error.diagnostics?.[0]?.stage, "validate.project");
  assert.equal(error.diagnostics?.[0]?.severity, "error");
  assert.equal(error.diagnostics?.[0]?.figmaNodeId, "1:2");
  assert.equal(error.diagnostics?.[0]?.figmaUrl, "https://example.test/node/1:2");
  assert.equal(error.diagnostics?.[0]?.details?.finiteNumber, 42);
  assert.equal("infiniteNumber" in (error.diagnostics?.[0]?.details ?? {}), false);
  assert.equal(error.diagnostics?.[0]?.details?.nullValue, null);
  assert.equal(error.diagnostics?.[0]?.details?.undefinedValue, "undefined");
  assert.equal(error.diagnostics?.[0]?.details?.bigintValue, "99n");
  assert.equal(error.diagnostics?.[0]?.details?.symbolValue, "Symbol(demo)");
  assert.equal(error.diagnostics?.[0]?.details?.functionValue, "[Function sample]");
  assert.deepEqual(error.diagnostics?.[0]?.details?.nestedArray, [1, "undefined", { keep: true }]);
  assert.equal(typeof error.diagnostics?.[0]?.details?.deepObject, "object");
});

test("mergePipelineDiagnostics honors max and returns undefined when no diagnostics exist", () => {
  assert.equal(mergePipelineDiagnostics({ first: undefined, second: undefined }), undefined);

  const merged = mergePipelineDiagnostics({
    first: [
      {
        code: "W_A",
        message: "first",
        suggestion: "s",
        stage: "ir.derive",
        severity: "warning",
        figmaNodeId: "node-a"
      }
    ],
    second: [
      {
        code: "W_A",
        message: "first",
        suggestion: "s",
        stage: "ir.derive",
        severity: "warning",
        figmaNodeId: "node-b"
      }
    ],
    max: 1
  });

  assert.equal(merged?.length, 1);
  assert.equal(merged?.[0]?.figmaNodeId, "node-a");
});

test("createPipelineError truncates diagnostic count and omits non-object detail payloads", () => {
  const diagnostics = Array.from({ length: 30 }, (_, index) => ({
    code: `W_${String(index).padStart(2, "0")}`,
    message: `message ${index}`,
    suggestion: `suggestion ${index}`,
    details: index === 0 ? ["array detail should be omitted"] : undefined
  }));

  const error = createPipelineError({
    code: "E_BULK",
    stage: "validate.project",
    message: "bulk diagnostics",
    diagnostics
  });

  assert.equal(error.diagnostics?.length, 25);
  assert.equal("details" in (error.diagnostics?.[0] ?? {}), false);
  assert.equal(error.diagnostics?.[24]?.code, "W_24");
});

test("createPipelineError respects injected diagnostic limits", () => {
  const error = createPipelineError({
    code: "E_LIMITS",
    stage: "validate.project",
    message: "limits",
    limits: {
      maxDiagnostics: 1,
      textMaxLength: 16,
      detailsMaxKeys: 2,
      detailsMaxItems: 2,
      detailsMaxDepth: 2
    },
    diagnostics: [
      {
        code: "W_LIMITED",
        message: "0123456789abcdefghi",
        suggestion: "suggestion length exceeds limit",
        details: {
          keepA: [1, 2, 3],
          keepB: {
            nested: {
              value: "trimmed at depth"
            }
          },
          zDropC: "excluded"
        }
      },
      {
        code: "W_DROPPED",
        message: "should be dropped",
        suggestion: "should be dropped"
      }
    ]
  });

  assert.equal(error.diagnostics?.length, 1);
  assert.equal(error.diagnostics?.[0]?.message, "0123456789abc...");
  assert.equal(error.diagnostics?.[0]?.suggestion, "suggestion le...");
  assert.deepEqual(error.diagnostics?.[0]?.details, {
    keepA: [1, 2],
    keepB: {
      nested: "[object Object]"
    }
  });
});

test("createPipelineError sanitizes anonymous functions, deep arrays, and symbol values without descriptions", () => {
  const namelessFunction = function namedFunction() {
    return "ok";
  };
  Object.defineProperty(namelessFunction, "name", { value: "" });

  const error = createPipelineError({
    code: "E_NESTED",
    stage: "validate.project",
    message: "nested diagnostics",
    diagnostics: [
      {
        code: "W_NESTED",
        message: "nested",
        suggestion: "inspect",
        details: {
          anonymousFunction: namelessFunction,
          noDescriptionSymbol: Symbol(),
          deepArray: [[[[["too deep"]]]]]
        }
      }
    ]
  });

  assert.equal(error.diagnostics?.[0]?.details?.anonymousFunction, "[Function anonymous]");
  assert.equal(error.diagnostics?.[0]?.details?.noDescriptionSymbol, "Symbol()");
  assert.deepEqual(error.diagnostics?.[0]?.details?.deepArray, [[[1]]]);
});

test("createPipelineError omits the diagnostics field when every candidate is invalid", () => {
  const error = createPipelineError({
    code: "E_INVALID",
    stage: "validate.project",
    message: "invalid diagnostics",
    diagnostics: [
      {
        code: "   ",
        message: "ignored",
        suggestion: "ignored"
      },
      {
        code: "W_NO_MESSAGE",
        message: "   ",
        suggestion: "ignored"
      }
    ]
  });

  assert.equal("diagnostics" in error, false);
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
