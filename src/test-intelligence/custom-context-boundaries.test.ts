import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT,
  MAX_CUSTOM_CONTEXT_ATTRIBUTE_VALUE_CHARS,
  validateCustomContextAttributes,
} from "./custom-context-input.js";
import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";

test("custom-context-boundaries: markdown raw-byte cap fails closed for oversized payloads", () => {
  const result = canonicalizeCustomContextMarkdown("A".repeat(33 * 1024));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues.some((issue) => issue.code === "markdown_raw_too_large"), true);
  }
});

test("custom-context-boundaries: attribute count and duplicate keys reject oversize input", () => {
  const tooMany = validateCustomContextAttributes(
    Array.from({ length: MAX_CUSTOM_CONTEXT_ATTRIBUTE_COUNT + 1 }, (_, index) => ({
      key: `field_${index}`,
      value: "ok",
    })),
  );
  assert.equal(tooMany.ok, false);
  if (!tooMany.ok) {
    assert.equal(
      tooMany.issues.some((issue) => issue.code === "custom_context_attribute_count_invalid"),
      true,
    );
  }

  const duplicate = validateCustomContextAttributes([
    {
      key: "test_environment",
      value: "prod",
    },
    {
      key: "test_environment",
      value: "prod",
    },
  ]);
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(
      duplicate.issues.some((issue) => issue.code === "custom_context_attribute_duplicate"),
      true,
    );
  }
});
