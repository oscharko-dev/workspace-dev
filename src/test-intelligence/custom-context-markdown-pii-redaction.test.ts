import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";

test("custom-context-markdown-pii-redaction: headings, lists, tables, links, and code fences redact synthetic PII", () => {
  const rawValues = [
    "Max Mustermann",
    "max.mustermann@example.com",
    "DE89370400440532013000",
    "4111111111111111",
  ];
  const result = canonicalizeCustomContextMarkdown(
    [
      `# Customer ${rawValues[0]}`,
      `- Email ${rawValues[1]}`,
      `1. IBAN ${rawValues[2]}`,
      `| pan | ${rawValues[3]} |`,
      `[mail ${rawValues[1]}](mailto:${rawValues[1]})`,
      "```",
      rawValues.join(" "),
      "```",
    ].join("\n"),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.value);
  for (const raw of rawValues) {
    assert.equal(serialized.includes(raw), false, raw);
  }
  assert.equal(result.value.piiIndicators.length >= 4, true);
});
