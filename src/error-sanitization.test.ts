import assert from "node:assert/strict";
import test from "node:test";
import {
  redactErrorChain,
  sanitizeErrorMessage,
} from "./error-sanitization.js";

test("error sanitization redacts PAN-like values that pass the Luhn checksum", async (t) => {
  const redactedPanSamples = [
    "4242424242424242",
    "378282246310005",
    "4222222222222",
  ] as const;

  for (const pan of redactedPanSamples) {
    await t.test(`redacts ${pan}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Failure for card ${pan}`),
        fallback: "fallback",
      });

      assert.equal(message, "Failure for card [redacted-pan]");
      assert.equal(message.includes(pan), false);
    });
  }
});

test("error sanitization preserves long numeric values that fail the Luhn checksum", async (t) => {
  const preservedSamples = [
    "1712345678901",
    "20260328123457",
    "1234567890123456789",
  ] as const;

  for (const candidate of preservedSamples) {
    await t.test(`preserves ${candidate}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Failure for identifier ${candidate}`),
        fallback: "fallback",
      });

      assert.equal(message, `Failure for identifier ${candidate}`);
      assert.equal(message.includes("[redacted-pan]"), false);
    });
  }
});

test("error sanitization preserves Luhn-valid numbers that lack a known card issuer prefix", async (t) => {
  // These pass the Luhn checksum but start with non-card-network prefixes
  const luhnValidNonCards = [
    "1000000000009",
    "9000000000001",
    "8000000000002",
  ] as const;

  for (const candidate of luhnValidNonCards) {
    await t.test(`preserves Luhn-valid non-card ${candidate}`, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`Identifier ${candidate}`),
        fallback: "fallback",
      });

      assert.equal(message, `Identifier ${candidate}`);
      assert.equal(message.includes("[redacted-pan]"), false);
    });
  }
});

test("error sanitization redacts multiple PANs in a single message", () => {
  const message = sanitizeErrorMessage({
    error: new Error("Cards 4242424242424242 and 378282246310005 found"),
    fallback: "fallback",
  });

  assert.equal(message.includes("4242424242424242"), false);
  assert.equal(message.includes("378282246310005"), false);
  assert.equal(message, "Cards [redacted-pan] and [redacted-pan] found");
});

test("error sanitization redacts PAN at message boundaries", async (t) => {
  await t.test("PAN at start", () => {
    const message = sanitizeErrorMessage({
      error: new Error("4242424242424242 was leaked"),
      fallback: "fallback",
    });

    assert.equal(message, "[redacted-pan] was leaked");
  });

  await t.test("PAN at end", () => {
    const message = sanitizeErrorMessage({
      error: new Error("leaked card 4242424242424242"),
      fallback: "fallback",
    });

    assert.equal(message, "leaked card [redacted-pan]");
  });
});

test("error sanitization redacts mixed sensitive content without over-redacting non-pan long numbers", () => {
  const message = sanitizeErrorMessage({
    error: new Error(
      "Failure for alice@example.com with card 4242424242424242, timestamp 1712345678901, and Bearer=super-secret-token",
    ),
    fallback: "fallback",
  });

  assert.equal(message.includes("alice@example.com"), false);
  assert.equal(message.includes("4242424242424242"), false);
  assert.equal(message.includes("1712345678901"), true);
  assert.equal(message.includes("super-secret-token"), false);
  assert.match(message, /\[redacted-email]/);
  assert.match(message, /\[redacted-pan]/);
  assert.match(message, /\[redacted-secret]/);
});

test("error sanitization redacts shared high-risk secret shapes", async (t) => {
  const cases = [
    {
      name: "repo token assignments",
      input: "repoToken=ghp_secret",
      expected: "repoToken=[redacted-secret]",
    },
    {
      name: "figma access token assignments",
      input: "figmaAccessToken=figd_secret",
      expected: "figmaAccessToken=[redacted-secret]",
    },
    {
      name: "bare token assignments",
      input: "token=my-secret-token",
      expected: "token=[redacted-secret]",
    },
    {
      name: "authorization bearer headers",
      input: "authorization: bearer super-secret-token",
      expected: "authorization: bearer [redacted-secret]",
    },
    {
      name: "Authorization Bearer headers",
      input: "Authorization: Bearer super-secret-token",
      expected: "Authorization: Bearer [redacted-secret]",
    },
    {
      name: "x-access-token headers",
      input: "x-access-token:abcdef",
      expected: "x-access-token:[redacted-secret]",
    },
    {
      name: "x-access-token headers with at signs",
      input: "x-access-token:foo@bar",
      expected: "x-access-token:[redacted-secret]",
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`leak ${testCase.input}`),
        fallback: "fallback",
      });

      assert.equal(message, `leak ${testCase.expected}`);
      assert.equal(message.includes(testCase.input), false);
    });
  }
});

test("error sanitization redacts JSON-serialized secrets", async (t) => {
  const cases = [
    {
      name: "JSON token field",
      input: '{"token":"ghp_abc123xyz"}',
      expected: '{"token":"[redacted-secret]"}',
    },
    {
      name: "JSON repoToken field",
      input: '{"repoToken":"ghp_1234567890abcdef"}',
      expected: '{"repoToken":"[redacted-secret]"}',
    },
    {
      name: "JSON figmaAccessToken field",
      input: '{"figmaAccessToken":"figd_abc_def_123"}',
      expected: '{"figmaAccessToken":"[redacted-secret]"}',
    },
    {
      name: "JSON Authorization field",
      input: '{"Authorization":"Bearer super_secret_token_123"}',
      expected: '{"Authorization":"[redacted-secret]"}',
    },
    {
      name: "JSON secret field",
      input: '{"secret":"my_secret_key"}',
      expected: '{"secret":"[redacted-secret]"}',
    },
    {
      name: "JSON api-key field",
      input: '{"api-key":"key_1234567890"}',
      expected: '{"api-key":"[redacted-secret]"}',
    },
    {
      name: "JSON password field",
      input: '{"password":"my_password_123"}',
      expected: '{"password":"[redacted-secret]"}',
    },
    {
      name: "JSON with spaces around colon",
      input: '{"token" : "secret_value_abc"}',
      expected: '{"token" : "[redacted-secret]"}',
    },
    {
      name: "Multiple JSON secrets in one message",
      input: '{"token":"abc123","secret":"xyz789"}',
      expected: '{"token":"[redacted-secret]","secret":"[redacted-secret]"}',
    },
    {
      name: "JSON error object with nested secret",
      input: '{"error":"MCP returned","data":{"token":"ghp_xyz"}}',
      expected: '{"error":"MCP returned","data":{"token":"[redacted-secret]"}}',
    },
    {
      name: "JSON x-figma-token field",
      input: '{"x-figma-token":"figma_secret_abc123"}',
      expected: '{"x-figma-token":"[redacted-secret]"}',
    },
    {
      name: "Empty token value is NOT redacted (false positive protection)",
      input: '{"token":""}',
      expected: '{"token":""}',
    },
    {
      name: "Escaped quotes in JSON value are fully redacted",
      input: '{"token":"abc\\"def"}',
      expected: '{"token":"[redacted-secret]"}',
    },
  ] as const;

  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const message = sanitizeErrorMessage({
        error: new Error(`leak ${testCase.input}`),
        fallback: "fallback",
      });

      assert.equal(message, `leak ${testCase.expected}`);
      // Verify redaction for non-empty cases; empty values should not be redacted
      const hasEmptyValue = testCase.input.includes('""');
      if (!hasEmptyValue) {
        assert.equal(message.includes("[redacted-secret]"), true);
      }
    });
  }
});

test("error sanitization preserves benign prose around secret-like words", async (t) => {
  const cases = [
    "Password rotation completed",
    "ApiKey rotation started",
    "PasswordResetFailed",
  ] as const;

  for (const input of cases) {
    await t.test(input, () => {
      const message = sanitizeErrorMessage({
        error: new Error(input),
        fallback: "fallback",
      });

      assert.equal(message, input);
      assert.equal(message.includes("[redacted-secret]"), false);
    });
  }
});

test("error sanitization returns fallback for non-error input", () => {
  const message = sanitizeErrorMessage({
    error: "plain string error",
    fallback: "fallback",
  });

  assert.equal(message, "fallback");
});

test("error sanitization truncates long error messages", () => {
  const longText = "x".repeat(300);
  const message = sanitizeErrorMessage({
    error: new Error(longText),
    fallback: "fallback",
  });

  assert.equal(message.endsWith("..."), true);
  assert.equal(message.length <= 243, true);
});

test("error sanitization falls back when sanitized message is empty", () => {
  const message = sanitizeErrorMessage({
    error: new Error("   "),
    fallback: "fallback",
  });

  assert.equal(message, "fallback");
});

test("redactErrorChain returns empty string for null or undefined input", () => {
  assert.equal(redactErrorChain(null), "");
  assert.equal(redactErrorChain(undefined), "");
});

test("redactErrorChain renders a single error with no cause", () => {
  const out = redactErrorChain(new Error("boom"));
  const lines = out.split("\n");
  assert.equal(lines[0], "Error: boom");
  assert.equal(out.includes("[cause]:"), false);
});

test("redactErrorChain redacts bearer tokens in the root message", () => {
  const out = redactErrorChain(
    new Error("Authorization: Bearer super-secret-token"),
  );
  assert.equal(out.includes("super-secret-token"), false);
  assert.match(out, /\[redacted-secret]/);
});

test("redactErrorChain walks a 3-level cause chain and redacts each level", () => {
  const leaf = new Error("token=leaf_secret_abc");
  const mid = new Error("authorization: bearer mid_secret_xyz", {
    cause: leaf,
  });
  const root = new Error('{"repoToken":"ghp_root_secret"}', { cause: mid });

  const out = redactErrorChain(root);

  assert.equal(out.includes("leaf_secret_abc"), false);
  assert.equal(out.includes("mid_secret_xyz"), false);
  assert.equal(out.includes("ghp_root_secret"), false);

  const causeCount = (out.match(/\[cause]:/g) ?? []).length;
  assert.equal(causeCount >= 2, true);
});

test("redactErrorChain detects direct self-referential circular causes", () => {
  const err = new Error("self-loop") as Error & { cause?: unknown };
  err.cause = err;

  const out = redactErrorChain(err);
  assert.match(out, /\[circular]/);
});

test("redactErrorChain detects two-node circular causes", () => {
  const a = new Error("a") as Error & { cause?: unknown };
  const b = new Error("b") as Error & { cause?: unknown };
  a.cause = b;
  b.cause = a;

  const out = redactErrorChain(a);
  assert.match(out, /\[circular]/);
  assert.equal(out.includes("Error: a"), true);
  assert.equal(out.includes("Error: b"), true);
});

test("redactErrorChain enforces the default depth limit of 8", () => {
  let current: Error & { cause?: unknown } = new Error("level-9");
  for (let index = 8; index >= 0; index -= 1) {
    const parent = new Error(`level-${index}`) as Error & { cause?: unknown };
    parent.cause = current;
    current = parent;
  }

  const out = redactErrorChain(current);
  assert.match(out, /\[truncated: max depth reached]/);
  assert.equal(out.includes("level-0"), true);
  assert.equal(out.includes("level-9"), false);
});

test("redactErrorChain respects a custom depthMax", () => {
  const leaf = new Error("deepest");
  const mid = new Error("middle", { cause: leaf });
  const root = new Error("outer", { cause: mid });

  const out = redactErrorChain(root, new WeakSet(), 1);
  assert.match(out, /\[truncated: max depth reached]/);
  assert.equal(out.includes("outer"), true);
  assert.equal(out.includes("middle"), false);
  assert.equal(out.includes("deepest"), false);
});

test("redactErrorChain renders a string cause", () => {
  const err = new Error("outer", { cause: "token=stringcause_secret" });
  const out = redactErrorChain(err);

  assert.equal(out.includes("stringcause_secret"), false);
  assert.match(out, /\[cause]:/);
});

test("redactErrorChain renders a plain object cause", () => {
  const err = new Error("outer", { cause: { hint: "no error" } });
  const out = redactErrorChain(err);

  assert.match(out, /\[cause]:/);
  assert.equal(out.includes("[object Object]"), true);
});

test("redactErrorChain handles an error with missing message", () => {
  const err = new Error("");
  const out = redactErrorChain(err);
  const firstLine = out.split("\n")[0];
  assert.equal(firstLine, "Error");
});

test("redactErrorChain includes and redacts the stack when present", () => {
  const err = new Error("outer");
  err.stack =
    "Error: outer\n    at /tmp/fake.js:1:1 authorization: bearer stack_secret_token";

  const out = redactErrorChain(err);
  assert.equal(out.includes("stack_secret_token"), false);
  assert.match(out, /\[redacted-secret]/);
});

test("redactErrorChain tolerates an error with no stack property", () => {
  const err = new Error("no stack here");
  err.stack = undefined;

  const out = redactErrorChain(err);
  assert.equal(out.includes("Error: no stack here"), true);
});

test("redactErrorChain redacts JSON-serialized secrets in nested causes", () => {
  const leaf = new Error('{"api-key":"key_leaf_1234567890"}');
  const root = new Error('{"secret":"root_secret_value"}', { cause: leaf });

  const out = redactErrorChain(root);
  assert.equal(out.includes("key_leaf_1234567890"), false);
  assert.equal(out.includes("root_secret_value"), false);
  const secretCount = (out.match(/\[redacted-secret]/g) ?? []).length;
  assert.equal(secretCount >= 2, true);
});

test("sanitizeErrorMessage uses the cause chain when cause is present", () => {
  const leaf = new Error("inner token=leaf_secret_abc");
  leaf.stack = "Error: inner token=leaf_secret_abc";
  const root = new Error("outer failure", { cause: leaf });
  root.stack = "Error: outer failure";

  const message = sanitizeErrorMessage({ error: root, fallback: "fallback" });
  assert.equal(message.includes("leaf_secret_abc"), false);
  assert.equal(message.includes("outer failure"), true);
  assert.equal(message.includes("[cause]:"), true);
});
