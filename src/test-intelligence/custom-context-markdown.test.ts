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

test("custom context markdown: refuses unsafe URL host variants and accepts safe public links", () => {
  const unsafe = [
    "[x](file:///etc/passwd)",
    "[x](vbscript:msgbox(1))",
    "[x](http://0.0.0.0/admin)",
    "[x](http://100.64.1.1/admin)",
    "[x](http://172.31.255.255/admin)",
    "[x](http://192.0.2.1/admin)",
    "[x](http://198.18.0.1/admin)",
    "[x](http://224.0.0.1/admin)",
    "[x](http://service.internal/admin)",
    "[x](http://service.corp/admin)",
    "[x](http://service.intranet/admin)",
    "[x](http://service.lan/admin)",
    "[x](http://[::]/admin)",
    "[x](http://[::1]/admin)",
    "[x](http://[fd00::1]/admin)",
    "[x](http://[fc00::1]/admin)",
    "[x](http://[::ffff:c0a8:0001]/admin)",
    "bare http://10.0.0.1/admin.",
  ];
  for (const markdown of unsafe) {
    const result = canonicalizeCustomContextMarkdown(markdown);
    assert.equal(result.ok, false, markdown);
    if (!result.ok) {
      assert.equal(
        result.issues.some(
          (issue) => issue.code === "markdown_unsafe_url_refused",
        ),
        true,
        markdown,
      );
    }
  }

  const safe = canonicalizeCustomContextMarkdown(
    [
      "[public https](https://docs.example.com/path)",
      "<mailto:reviewer@example.com>",
      "bare https://docs.example.com/path.",
    ].join("\n"),
  );
  assert.equal(safe.ok, true);
  if (!safe.ok) return;
  assert.equal(safe.value.bodyMarkdown.includes("docs.example.com"), false);
  assert.equal(safe.value.bodyMarkdown.includes("about:blank#redacted-link"), true);
  assert.equal(safe.value.bodyMarkdown.includes("reviewer@example.com"), false);
  assert.equal(safe.value.bodyMarkdown.includes("[REDACTED:EMAIL]"), true);
});

test("custom context markdown: validates input type and canonical byte budgets", () => {
  const notString = canonicalizeCustomContextMarkdown({ markdown: "# x" });
  assert.equal(notString.ok, false);
  if (!notString.ok) {
    assert.equal(notString.issues[0]?.code, "markdown_input_not_string");
  }

  const empty = canonicalizeCustomContextMarkdown(" \n\t ");
  assert.equal(empty.ok, false);
  if (!empty.ok) {
    assert.equal(
      empty.issues.some((issue) => issue.code === "markdown_input_empty"),
      true,
    );
  }

  const malformed = canonicalizeCustomContextMarkdown(
    "Key: PAY-1\nBad replacement \uFFFD",
  );
  assert.equal(malformed.ok, false);
  if (!malformed.ok) {
    assert.equal(
      malformed.issues.some(
        (issue) => issue.code === "markdown_malformed_utf8",
      ),
      true,
    );
  }

  const canonicalTooLarge = canonicalizeCustomContextMarkdown(
    "word\n".repeat(5_000),
  );
  assert.equal(canonicalTooLarge.ok, false);
  if (!canonicalTooLarge.ok) {
    assert.equal(
      canonicalTooLarge.issues.some(
        (issue) => issue.code === "markdown_canonical_too_large",
      ),
      true,
    );
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
