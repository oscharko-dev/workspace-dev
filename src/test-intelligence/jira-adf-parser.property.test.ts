import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";

import { parseJiraAdfDocument } from "./jira-adf-parser.js";

const adf = (content: unknown[]): string =>
  JSON.stringify({ type: "doc", version: 1, content });

const arbSafeText = fc.stringMatching(/^[A-Za-z0-9 .,!?-]{1,40}$/);

const arbParagraph = arbSafeText.map((text) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
}));

const arbHeading = fc
  .tuple(fc.integer({ min: 1, max: 6 }), arbSafeText)
  .map(([level, text]) => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  }));

const arbCodeBlock = arbSafeText.map((text) => ({
  type: "codeBlock",
  attrs: { language: "ts" },
  content: [{ type: "text", text }],
}));

const arbBlockNode = fc.oneof(arbParagraph, arbHeading, arbCodeBlock);

const arbDoc = fc
  .array(arbBlockNode, { minLength: 1, maxLength: 8 })
  .map((nodes) => adf(nodes));

test("ADF parser property: parse(doc) is byte-stable across re-runs", () => {
  fc.assert(
    fc.property(arbDoc, (doc) => {
      const a = parseJiraAdfDocument(doc);
      const b = parseJiraAdfDocument(doc);
      if (!a.ok || !b.ok) return false;
      return (
        a.document.plainText === b.document.plainText &&
        a.document.nodeCount === b.document.nodeCount &&
        a.document.maxDepth === b.document.maxDepth
      );
    }),
    { numRuns: 50 },
  );
});

test("ADF parser property: every successful parse strips disallowed mention/inlineCard/media URIs", () => {
  // Build documents with mention/inlineCard/media nodes containing
  // adversarial URI-shaped attrs and assert the output never carries
  // raw URIs / account ids / media ids.
  const arbAccountId = fc.stringMatching(/^[a-f0-9]{24,32}$/);
  const arbHostname = fc
    .stringMatching(/^[a-z0-9-]{3,12}$/)
    .map((s) => `${s}.intranet.example.com`);
  const arbMediaId = fc.stringMatching(/^[a-f0-9]{16,24}$/);

  fc.assert(
    fc.property(
      arbAccountId,
      arbHostname,
      arbMediaId,
      (accountId, hostname, mediaId) => {
        const doc = adf([
          {
            type: "paragraph",
            content: [
              { type: "text", text: "before " },
              {
                type: "mention",
                attrs: { id: accountId, text: `@${accountId}` },
              },
              { type: "text", text: " mid " },
              {
                type: "inlineCard",
                attrs: { url: `https://${hostname}/secret` },
              },
              { type: "text", text: " end" },
            ],
          },
          {
            type: "media",
            attrs: { id: mediaId, type: "file", alt: "spec.pdf" },
          },
        ]);
        const result = parseJiraAdfDocument(doc);
        if (!result.ok) return false;
        const text = result.document.plainText;
        // No raw account id, no raw URL, no raw media id should leak.
        // Use indexOf so CodeQL's URL-substring-sanitization rule does
        // not interpret these as hostname-validation checks.
        if (text.indexOf(accountId) !== -1) return false;
        if (text.indexOf(hostname) !== -1) return false;
        if (text.indexOf(mediaId) !== -1) return false;
        if (/https?:\/\//u.test(text)) return false;
        return text.indexOf("@user") !== -1 && text.indexOf("[link]") !== -1;
      },
    ),
    { numRuns: 50 },
  );
});

test("ADF parser property: unknown node types always reject", () => {
  fc.assert(
    fc.property(
      fc
        .stringMatching(/^[a-zA-Z]{3,16}$/)
        .filter(
          (t) =>
            ![
              "doc",
              "paragraph",
              "heading",
              "blockquote",
              "bulletList",
              "orderedList",
              "listItem",
              "codeBlock",
              "rule",
              "panel",
              "table",
              "tableRow",
              "tableHeader",
              "tableCell",
              "mediaSingle",
              "mediaGroup",
              "media",
              "text",
              "hardBreak",
              "mention",
              "emoji",
              "inlineCard",
              "status",
              "date",
            ].includes(t),
        ),
      (unknownType) => {
        const doc = adf([{ type: unknownType, content: [] }]);
        const result = parseJiraAdfDocument(doc);
        if (result.ok) return false;
        return result.rejection.code === "jira_adf_unknown_node_type";
      },
    ),
    { numRuns: 30 },
  );
});
