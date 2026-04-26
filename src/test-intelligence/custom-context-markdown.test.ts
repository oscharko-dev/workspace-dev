import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";

test("custom context markdown: redacts PII across headings, tables, lists, blockquotes, and code fences", () => {
  const result = canonicalizeCustomContextMarkdown(
    [
      "# Customer Max Mustermann",
      "",
      "- Email max.mustermann@sparkasse.de",
      "> IBAN DE89370400440532013000",
      "| field | value |",
      "| --- | --- |",
      "| pan | 4111111111111111 |",
      "```",
      "support: max.mustermann@sparkasse.de",
      "```",
    ].join("\n"),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const serialized = JSON.stringify(result.value);
  assert.equal(serialized.includes("Max Mustermann"), false);
  assert.equal(serialized.includes("max.mustermann@sparkasse.de"), false);
  assert.equal(serialized.includes("DE89370400440532013000"), false);
  assert.equal(serialized.includes("4111111111111111"), false);
  assert.match(serialized, /\[REDACTED:FULL_NAME\]/);
  assert.match(serialized, /\[REDACTED:EMAIL\]/);
  assert.match(serialized, /\[REDACTED:IBAN\]/);
  assert.match(serialized, /\[REDACTED:PAN\]/);
  assert.equal(result.value.piiIndicators.length >= 4, true);
});

test("custom context markdown: rejects executable and embedded content fail-closed", () => {
  for (const markdown of [
    "<script>alert(1)</script>",
    "![alt](https://example.com/x.png)",
    "[x](javascript:alert(1))",
    "[x](http://10.0.0.1/admin)",
    "bare http://127.0.0.1/admin",
    "bare http://169.254.169.254/latest/meta-data",
    "[x](http://192.168.1.10/admin)",
    "[x](http://169.254.169.254/latest/meta-data)",
    "[x](http://[fe80::1]/admin)",
    "[x](http://[::ffff:10.0.0.1]/admin)",
    "[x](http://[::ffff:172.16.0.1]/admin)",
    "```mermaid\ngraph TD\n```",
    "---\ntitle: x\n---\nbody",
    "import X from './x'",
  ]) {
    const result = canonicalizeCustomContextMarkdown(markdown);
    assert.equal(result.ok, false, markdown);
  }
});

test("custom context markdown: canonical hashes are stable for semantic whitespace variants", () => {
  const a = canonicalizeCustomContextMarkdown("## Scope  \r\n\r\n- PSD2\n");
  const b = canonicalizeCustomContextMarkdown("## Scope\n\n\n- PSD2\n\n");
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(a.value.bodyMarkdown, b.value.bodyMarkdown);
  assert.equal(a.value.markdownContentHash, b.value.markdownContentHash);
  assert.equal(a.value.plainContentHash, b.value.plainContentHash);
});
