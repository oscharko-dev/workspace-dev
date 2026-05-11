import assert from "node:assert/strict";
import test from "node:test";
import { redactErrorChain } from "../error-sanitization.js";

test("generate-artifact error handler: redactErrorChain sanitizes error chains for stderr", () => {
  const cause = new Error("Bearer secret_token_xyz");
  const error = new Error("Generate artifact failed", { cause });

  const sanitized = redactErrorChain(error);

  assert.ok(sanitized.length > 0, "Output should not be empty");
  assert.equal(
    sanitized.includes("secret_token_xyz"),
    false,
    "Secret token should be redacted",
  );
  assert.match(sanitized, /\[redacted-secret\]/);
  assert.match(sanitized, /Generate artifact failed/);
  assert.match(sanitized, /\[cause\]:/);
});

test("generate-artifact error handler: handles non-error inputs", () => {
  const result1 = redactErrorChain(null);
  assert.equal(result1, "");

  const result2 = redactErrorChain(undefined);
  assert.equal(result2, "");

  const result3 = redactErrorChain("string error with Bearer secret123");
  assert.ok(result3.includes("[redacted-secret]"));
  assert.ok(!result3.includes("secret123"));
});

test("generate-artifact error handler: redacts cause chain for stderr output", () => {
  const innerCause = new Error("token=inner_secret");
  const middleCause = new Error("Authorization: Bearer middle_secret", {
    cause: innerCause,
  });
  const error = new Error("Storybook build failed", { cause: middleCause });

  const stderrOutput = redactErrorChain(error);

  assert.equal(
    stderrOutput.includes("inner_secret"),
    false,
    "Inner cause secret should be redacted",
  );
  assert.equal(
    stderrOutput.includes("middle_secret"),
    false,
    "Middle cause secret should be redacted",
  );
  assert.match(
    stderrOutput,
    /Storybook build failed/,
    "Main error message should be present",
  );
});
