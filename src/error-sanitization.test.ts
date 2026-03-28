import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeErrorMessage } from "./error-sanitization.js";

test("error sanitization redacts PAN-like values that pass the Luhn checksum", async (t) => {
  const redactedPanSamples = ["4242424242424242", "378282246310005", "4222222222222"] as const;

  for (const pan of redactedPanSamples) {
    await t.test(`redacts ${pan}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Failure for card ${pan}`),
        fallback: "fallback"
      });

      assert.equal(message, "Failure for card [redacted-pan]");
      assert.equal(message.includes(pan), false);
    });
  }
});

test("error sanitization preserves long numeric values that fail the Luhn checksum", async (t) => {
  const preservedSamples = ["1712345678901", "20260328123457", "1234567890123456789"] as const;

  for (const candidate of preservedSamples) {
    await t.test(`preserves ${candidate}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Failure for identifier ${candidate}`),
        fallback: "fallback"
      });

      assert.equal(message, `Failure for identifier ${candidate}`);
      assert.equal(message.includes("[redacted-pan]"), false);
    });
  }
});

test("error sanitization redacts mixed sensitive content without over-redacting non-pan long numbers", () => {
  const message = sanitizeErrorMessage({
    error: new Error(
      "Failure for alice@example.com with card 4242424242424242, timestamp 1712345678901, and Bearer=super-secret-token"
    ),
    fallback: "fallback"
  });

  assert.equal(message.includes("alice@example.com"), false);
  assert.equal(message.includes("4242424242424242"), false);
  assert.equal(message.includes("1712345678901"), true);
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
