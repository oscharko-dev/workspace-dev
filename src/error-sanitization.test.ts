import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorMessage } from "./error-sanitization.js";

test("error sanitization redacts email, card number, and token-like content", () => {
  const message = sanitizeErrorMessage({
    error: new Error(
      "Failure for alice@example.com with card 4242424242424242 and Bearer=super-secret-token"
    ),
    fallback: "fallback"
  });

  assert.equal(message.includes("alice@example.com"), false);
  assert.equal(message.includes("4242424242424242"), false);
  assert.equal(message.includes("super-secret-token"), false);
  assert.match(message, /\[redacted-email]/);
  assert.match(message, /\[redacted-pan]/);
  assert.match(message, /\[redacted-secret]/);
});

test("error sanitization returns fallback for non-error input", () => {
  const message = sanitizeErrorMessage({
    error: "plain string error",
    fallback: "fallback"
  });

  assert.equal(message, "fallback");
});

test("error sanitization truncates long error messages", () => {
  const longText = "x".repeat(300);
  const message = sanitizeErrorMessage({
    error: new Error(longText),
    fallback: "fallback"
  });

  assert.equal(message.endsWith("..."), true);
  assert.equal(message.length <= 243, true);
});

test("error sanitization falls back when sanitized message is empty", () => {
  const message = sanitizeErrorMessage({
    error: new Error("   "),
    fallback: "fallback"
  });

  assert.equal(message, "fallback");
});
