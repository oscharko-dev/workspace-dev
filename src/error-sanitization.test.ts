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

test("error sanitization preserves Luhn-valid numbers that lack a known card issuer prefix", async (t) => {
  // These pass the Luhn checksum but start with non-card-network prefixes
  const luhnValidNonCards = ["1000000000009", "9000000000001", "8000000000002"] as const;

  for (const candidate of luhnValidNonCards) {
    await t.test(`preserves Luhn-valid non-card ${candidate}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Identifier ${candidate}`),
        fallback: "fallback"
      });

      assert.equal(message, `Identifier ${candidate}`);
      assert.equal(message.includes("[redacted-pan]"), false);
    });
  }
});

test("error sanitization redacts multiple PANs in a single message", () => {
  const message = sanitizeErrorMessage({
    error: new Error("Cards 4242424242424242 and 378282246310005 found"),
    fallback: "fallback"
  });

  assert.equal(message.includes("4242424242424242"), false);
  assert.equal(message.includes("378282246310005"), false);
  assert.equal(message, "Cards [redacted-pan] and [redacted-pan] found");
});

test("error sanitization redacts PAN at message boundaries", async (t) => {
  await t.test("PAN at start", () => {
    const message = sanitizeErrorMessage({
      error: new Error("4242424242424242 was leaked"),
      fallback: "fallback"
    });

    assert.equal(message, "[redacted-pan] was leaked");
  });

  await t.test("PAN at end", () => {
    const message = sanitizeErrorMessage({
      error: new Error("leaked card 4242424242424242"),
      fallback: "fallback"
    });

    assert.equal(message, "leaked card [redacted-pan]");
  });
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
