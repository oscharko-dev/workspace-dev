import assert from "node:assert/strict";
import test from "node:test";

import { MAX_JIRA_ADF_INPUT_BYTES } from "../contracts/index.js";
import { parseJiraAdfDocument } from "./jira-adf-parser.js";

const adf = (content: unknown[]): string =>
  JSON.stringify({ type: "doc", version: 1, content });

const para = (text: string, marks?: { type: string }[]) => ({
  type: "paragraph",
  content: [
    {
      type: "text",
      text,
      ...(marks ? { marks } : {}),
    },
  ],
});

test("ADF parser: rejects non-string input", () => {
  const result = parseJiraAdfDocument(42);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_input_not_string");
});

test("ADF parser: rejects oversize input pre-parse", () => {
  // Payload over 1 MiB (constant cap).
  const large = "{" + "x".repeat(MAX_JIRA_ADF_INPUT_BYTES + 1);
  const result = parseJiraAdfDocument(large);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_payload_too_large");
});

test("ADF parser: rejects malformed JSON", () => {
  const result = parseJiraAdfDocument("not-json");
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_input_not_json");
});

test("ADF parser: rejects non-doc root", () => {
  const result = parseJiraAdfDocument(JSON.stringify({ type: "paragraph" }));
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_root_type_invalid");
});

test("ADF parser: rejects unknown node type", () => {
  const result = parseJiraAdfDocument(
    adf([{ type: "weirdNode", content: [] }]),
  );
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_unknown_node_type");
});

test("ADF parser: rejects unknown mark type", () => {
  const result = parseJiraAdfDocument(
    adf([para("hello", [{ type: "evilMark" }])]),
  );
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_unknown_mark_type");
});

test("ADF parser: paragraph + heading + list emit deterministic plain text", () => {
  const doc = adf([
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Onboarding" }],
    },
    para("First paragraph."),
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [para("Item one.")],
        },
        {
          type: "listItem",
          content: [para("Item two.")],
        },
      ],
    },
  ]);
  const result = parseJiraAdfDocument(doc);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.document.plainText,
    "## Onboarding\nFirst paragraph.\n- Item one.\n- Item two.",
  );
  assert.ok(result.document.blocks.some((b) => b.kind === "heading"));
  assert.ok(
    result.document.blocks.some(
      (b) => b.kind === "list_item" && b.text === "Item one.",
    ),
  );
});

test("ADF parser: code block carries language and text", () => {
  const doc = adf([
    {
      type: "codeBlock",
      attrs: { language: "TypeScript" },
      content: [{ type: "text", text: "const x = 1;" }],
    },
  ]);
  const result = parseJiraAdfDocument(doc);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.plainText, "```typescript\nconst x = 1;\n```");
  const codeBlock = result.document.blocks.find((b) => b.kind === "code_block");
  assert.ok(codeBlock);
  assert.equal(codeBlock?.language, "typescript");
  assert.equal(codeBlock?.text, "const x = 1;");
});

test("ADF parser: code block text children count toward traversal cap", () => {
  const doc = adf([
    {
      type: "codeBlock",
      content: Array.from({ length: 5_000 }, (_, i) => ({
        type: "text",
        text: String(i % 10),
      })),
    },
  ]);
  const result = parseJiraAdfDocument(doc);
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_max_node_count_exceeded");
});

test("ADF parser: panel summary preserves nested structural blocks", () => {
  const doc = adf([
    {
      type: "panel",
      content: [
        para("Panel intro."),
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [para("Nested criterion.")],
            },
          ],
        },
      ],
    },
  ]);
  const result = parseJiraAdfDocument(doc);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(
    result.document.blocks.some(
      (block) => block.kind === "panel" && block.text.includes("Panel intro."),
    ),
  );
  assert.ok(
    result.document.blocks.some(
      (block) =>
        block.kind === "list_item" && block.text === "Nested criterion.",
    ),
  );
});

test("ADF parser: mention/inlineCard/media render as opaque stubs", () => {
  const doc = adf([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Reviewed by " },
        {
          type: "mention",
          attrs: {
            id: "557058:e7f0a8c1-1234",
            text: "@AccountManager",
          },
        },
        { type: "text", text: " — see " },
        {
          type: "inlineCard",
          attrs: {
            url: "https://corp.intranet.example.com/secret",
          },
        },
      ],
    },
    {
      type: "mediaSingle",
      content: [
        {
          type: "media",
          attrs: {
            id: "55ab83bc-2222",
            type: "file",
            collection: "MediaServicesSample",
            alt: "spec.pdf",
          },
        },
      ],
    },
  ]);
  const result = parseJiraAdfDocument(doc);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const text = result.document.plainText;
  assert.ok(text.includes("@user"));
  assert.ok(text.includes("[link]"));
  assert.ok(text.includes("[attachment:spec.pdf]"));
  // Hard invariant — no raw URLs, no raw account IDs, no raw media IDs.
  // Use anchored regexes so CodeQL's incomplete-substring-sanitization
  // rule does not flag hostname-shaped substring assertions.
  assert.doesNotMatch(text, /intranet\.example\.com/u);
  assert.doesNotMatch(text, /\b557058\b/u);
  assert.doesNotMatch(text, /\b55ab83bc\b/u);
});

test("ADF parser: nested-depth bound rejects pathological input", () => {
  // 33-deep blockquote chain (limit is 32).
  let inner: unknown = {
    type: "paragraph",
    content: [{ type: "text", text: "x" }],
  };
  for (let i = 0; i < 33; i++) {
    inner = { type: "blockquote", content: [inner] };
  }
  const result = parseJiraAdfDocument(adf([inner]));
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_max_depth_exceeded");
});

test("ADF parser: byte-stable across canonicalised re-runs", () => {
  const doc1 = adf([
    para("hello world"),
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "title" }],
    },
  ]);
  const a = parseJiraAdfDocument(doc1);
  const b = parseJiraAdfDocument(doc1);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  if (a.ok && b.ok) {
    assert.equal(a.document.plainText, b.document.plainText);
    assert.deepEqual(a.document.blocks, b.document.blocks);
  }
});

test("ADF parser: rejects inline node at block level", () => {
  const result = parseJiraAdfDocument(
    adf([{ type: "text", text: "loose text" }]),
  );
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.rejection.code, "jira_adf_node_shape_invalid");
});
