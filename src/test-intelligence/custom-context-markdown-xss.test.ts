import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeCustomContextMarkdown } from "./custom-context-markdown.js";

test("custom-context-markdown-xss: executable Markdown and HTML never canonicalize for preview or persistence", () => {
  for (const markdown of [
    "<script>alert(1)</script>",
    "<iframe src='https://example.com'></iframe>",
    "<svg onload='alert(1)'></svg>",
    "[x](javascript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "![x](https://example.com/tracker.png)",
    "```mermaid\ngraph TD\n```",
    "import X from './unsafe'",
    "<UnsafeComponent />",
  ]) {
    const result = canonicalizeCustomContextMarkdown(markdown);
    assert.equal(result.ok, false, markdown);
  }
});
