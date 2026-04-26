import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAttributeKey,
  validateCustomContextInput,
} from "./custom-context-input.js";

test("custom context input: validates and canonicalizes structured attributes", () => {
  const result = validateCustomContextInput({
    markdown: "# Note",
    attributes: [
      { key: "dataClass", value: "PCI-DSS-3" },
      { key: "feature_flag", value: "NEW_CHECKOUT=on" },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.attributes, [
    { key: "data_class", value: "PCI-DSS-3" },
    { key: "feature_flag", value: "NEW_CHECKOUT=on" },
  ]);
});

test("custom context input: redacts PII from structured attribute values before persistence", () => {
  const result = validateCustomContextInput({
    attributes: [
      {
        key: "dataClass",
        value: "PCI-DSS-3 Max Mustermann 4111111111111111",
      },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.attributes, [
    {
      key: "data_class",
      value: "PCI-DSS-3 [REDACTED:FULL_NAME] [REDACTED:PAN]",
    },
  ]);
});

test("custom context input: rejects unsupported fields and malformed attributes", () => {
  const result = validateCustomContextInput({
    authorHandle: "mallory",
    attributes: [
      { key: "DataClass", value: "PCI-DSS-3" },
      { key: "valid_key", value: "line\nbreak" },
    ],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "custom_context_field_unsupported",
      ),
      true,
    );
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "custom_context_attribute_key_invalid",
      ),
      true,
    );
    assert.equal(
      result.issues.some(
        (issue) => issue.code === "custom_context_attribute_value_invalid",
      ),
      true,
    );
  }
});

test("normalizeAttributeKey maps public camelCase labels to canonical wire keys", () => {
  assert.equal(normalizeAttributeKey("regulatoryScope"), "regulatory_scope");
  assert.equal(normalizeAttributeKey("dataClass"), "data_class");
  assert.equal(normalizeAttributeKey("data_class"), "data_class");
});
