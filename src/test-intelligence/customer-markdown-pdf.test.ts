/**
 * Tests for the customer-markdown PDF bundle.
 *
 * Mirrors the byte-stability / structural guarantees the ZIP encoder
 * carries: identical inputs must produce a byte-identical PDF buffer
 * (no timestamps, no random ids), the buffer must start with the PDF
 * magic header, and the embedded text must be present so a reviewer
 * can `pdftotext` the file and recover the source.
 *
 * These unit tests use compact single-section fixtures to verify the
 * encoder. Production wiring passes additional structural sections for
 * `JIRA_STORY.md` and screenshot SHA-256 references, with placeholders
 * when the source artefacts are absent.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerMarkdownPdf,
  buildJiraStorySectionBody,
  buildScreenshotReferenceSectionBody,
  extractJiraStoryFromCustomContext,
  type CustomerMarkdownPdfInput,
} from "./customer-markdown-pdf.js";

const fixedInput = (
  overrides: Partial<CustomerMarkdownPdfInput> = {},
): CustomerMarkdownPdfInput => ({
  title: "Test-Case Ergebnisse",
  sections: [
    {
      heading: "testfaelle.md",
      body: "# Testfälle\n\nKurzer Body mit Umlauten: ä ö ü ß.\n",
    },
  ],
  ...overrides,
});

test("buildCustomerMarkdownPdf returns a Buffer starting with the PDF magic header", () => {
  const pdf = buildCustomerMarkdownPdf(fixedInput());
  assert.ok(Buffer.isBuffer(pdf), "expected Buffer output");
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("buildCustomerMarkdownPdf ends with the PDF EOF marker", () => {
  const pdf = buildCustomerMarkdownPdf(fixedInput());
  const tail = pdf.subarray(pdf.length - 6).toString("ascii");
  assert.match(tail, /%%EOF\s*$/u);
});

test("buildCustomerMarkdownPdf is byte-stable for identical inputs", () => {
  const a = buildCustomerMarkdownPdf(fixedInput());
  const b = buildCustomerMarkdownPdf(fixedInput());
  assert.equal(a.equals(b), true);
});

test("buildCustomerMarkdownPdf embeds the section heading and body text verbatim", () => {
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [
        {
          heading: "testfaelle.md",
          body: "Erste Zeile mit Marker XYZ_UNIQUE_42.",
        },
      ],
    }),
  );
  const ascii = pdf.toString("binary");
  assert.ok(
    ascii.includes("testfaelle.md"),
    "heading text must appear in the content stream",
  );
  assert.ok(
    ascii.includes("XYZ_UNIQUE_42"),
    "body text must appear in the content stream",
  );
});

test("buildCustomerMarkdownPdf escapes literal parens and backslashes in the content stream", () => {
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [
        {
          heading: "edge",
          body: "Edge case: (parentheses) and a backslash \\ together.",
        },
      ],
    }),
  );
  const bin = pdf.toString("binary");
  // PDF string literals escape these three characters. Unescaped `(` /
  // `)` inside `( ... )` would corrupt the stream; an unescaped `\` is
  // interpreted as an escape introducer. The escaped forms must be
  // present.
  assert.ok(bin.includes("\\("), "unescaped ( would corrupt the PDF string");
  assert.ok(bin.includes("\\)"), "unescaped ) would corrupt the PDF string");
  assert.ok(
    bin.includes("\\\\"),
    "unescaped \\ would be interpreted as an escape",
  );
});

test("buildCustomerMarkdownPdf paginates long bodies across multiple pages", () => {
  const longBody = Array.from({ length: 200 }, (_, i) => `Zeile ${i + 1}`).join(
    "\n",
  );
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [{ heading: "lang", body: longBody }],
    }),
  );
  // `/Type /Page ` occurs once per page object. With 200 lines and a
  // single-page-limit of ~50 lines we expect at least 3 page objects.
  const occurrences = pdf.toString("binary").split("/Type /Page ").length - 1;
  assert.ok(
    occurrences >= 3,
    `expected at least 3 pages for 200-line body, got ${occurrences}`,
  );
});

test("buildCustomerMarkdownPdf produces different output for different inputs", () => {
  const a = buildCustomerMarkdownPdf(fixedInput());
  const b = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [{ heading: "other", body: "different content here" }],
    }),
  );
  assert.equal(a.equals(b), false);
});

test("buildCustomerMarkdownPdf renders multiple sections in order", () => {
  const pdf = buildCustomerMarkdownPdf({
    title: "Title",
    sections: [
      { heading: "FIRST_SECTION", body: "alpha" },
      { heading: "SECOND_SECTION", body: "beta" },
    ],
  });
  const bin = pdf.toString("binary");
  const firstIdx = bin.indexOf("FIRST_SECTION");
  const secondIdx = bin.indexOf("SECOND_SECTION");
  assert.ok(firstIdx >= 0 && secondIdx >= 0, "both sections must be present");
  assert.ok(
    firstIdx < secondIdx,
    "sections must appear in input order in the PDF stream",
  );
});

test("buildCustomerMarkdownPdf maps Latin-1 (WinAnsi) characters to single bytes", () => {
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [{ heading: "umlaute", body: "äöüß" }],
    }),
  );
  // WinAnsiEncoding: ä=0xE4 ö=0xF6 ü=0xFC ß=0xDF. The bytes appear in
  // the content stream verbatim (no UTF-8 multi-byte expansion) so
  // standard Helvetica renders them correctly.
  assert.ok(pdf.includes(Buffer.from([0xe4, 0xf6, 0xfc, 0xdf])));
});

test("buildCustomerMarkdownPdf substitutes characters outside WinAnsi with a placeholder", () => {
  // Chinese ideograph is not in WinAnsi; it must not produce a
  // multi-byte UTF-8 sequence in the content stream because Helvetica
  // would render that as garbage. A `?` placeholder is the
  // conservative substitution.
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [{ heading: "non-latin", body: "before 漢 after" }],
    }),
  );
  const bin = pdf.toString("binary");
  // Must not contain the UTF-8 bytes for 漢 (E6 BC A2)
  assert.ok(!pdf.includes(Buffer.from([0xe6, 0xbc, 0xa2])));
  // Must contain "before " and " after" with a placeholder in between
  assert.ok(bin.includes("before"));
  assert.ok(bin.includes("after"));
});

test("buildCustomerMarkdownPdf accepts an empty section body without crashing", () => {
  const pdf = buildCustomerMarkdownPdf(
    fixedInput({
      sections: [{ heading: "empty", body: "" }],
    }),
  );
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
});

test("buildCustomerMarkdownPdf rejects an empty sections list", () => {
  assert.throws(() =>
    buildCustomerMarkdownPdf({
      title: "Test",
      sections: [],
    }),
  );
});

/* ---------- extractJiraStoryFromCustomContext ---------- */

test("extractJiraStoryFromCustomContext returns undefined when input is undefined", () => {
  assert.equal(extractJiraStoryFromCustomContext(undefined), undefined);
});

test("extractJiraStoryFromCustomContext returns undefined when heading is absent", () => {
  assert.equal(
    extractJiraStoryFromCustomContext("# Akzeptanzkriterien\n\nA1: foo"),
    undefined,
  );
});

test("extractJiraStoryFromCustomContext extracts body up to the next heading", () => {
  const md = [
    "# Acceptance",
    "A1: alpha",
    "",
    "## JIRA_STORY",
    "As a user I want X so that Y.",
    "AC1: the X happens.",
    "",
    "## Notes",
    "irrelevant",
  ].join("\n");
  assert.equal(
    extractJiraStoryFromCustomContext(md),
    "As a user I want X so that Y.\nAC1: the X happens.",
  );
});

test("extractJiraStoryFromCustomContext matches the 'JIRA Story' (space) variant case-insensitively", () => {
  const md = "### jira story\nstory body line";
  assert.equal(extractJiraStoryFromCustomContext(md), "story body line");
});

test("extractJiraStoryFromCustomContext returns undefined for an empty body", () => {
  const md = "## JIRA_STORY\n\n## Notes\nirrelevant";
  assert.equal(extractJiraStoryFromCustomContext(md), undefined);
});

test("extractJiraStoryFromCustomContext picks the first matching heading", () => {
  const md = "## JIRA_STORY\nfirst body\n## Other\n## JIRA_STORY\nsecond body";
  assert.equal(extractJiraStoryFromCustomContext(md), "first body");
});

/* ---------- buildJiraStorySectionBody ---------- */

test("buildJiraStorySectionBody returns the story body verbatim when present", () => {
  assert.equal(buildJiraStorySectionBody("body content"), "body content");
});

test("buildJiraStorySectionBody returns a placeholder when story is undefined", () => {
  const body = buildJiraStorySectionBody(undefined);
  assert.match(body, /Keine JIRA-Story konfiguriert/u);
  assert.match(body, /customContextMarkdown/u);
});

/* ---------- buildScreenshotReferenceSectionBody ---------- */

test("buildScreenshotReferenceSectionBody returns a placeholder for an empty list", () => {
  const body = buildScreenshotReferenceSectionBody([]);
  assert.match(body, /Keine Maske-Screenshots erfasst/u);
});

test("buildScreenshotReferenceSectionBody renders refs and never includes raw bytes terminology", () => {
  const body = buildScreenshotReferenceSectionBody([
    {
      screenId: "1:1",
      filename: "screen-1-1.png",
      sha256: "abc123",
      byteLength: 4567,
    },
  ]);
  assert.match(body, /Screen: 1:1/u);
  assert.match(body, /screen-1-1\.png/u);
  assert.match(body, /SHA-256: abc123/u);
  assert.match(body, /Bytes:\s+4567/u);
  // Audit guard: must not advertise raw bytes.
  assert.ok(!/raw png|base64/iu.test(body));
});

test("buildScreenshotReferenceSectionBody sorts refs by screenId for byte stability", () => {
  const body = buildScreenshotReferenceSectionBody([
    { screenId: "2:0", filename: "b.png", sha256: "bb", byteLength: 2 },
    { screenId: "1:0", filename: "a.png", sha256: "aa", byteLength: 1 },
  ]);
  const idxA = body.indexOf("Screen: 1:0");
  const idxB = body.indexOf("Screen: 2:0");
  assert.ok(idxA >= 0 && idxB >= 0);
  assert.ok(idxA < idxB, "screenId 1:0 must appear before 2:0");
});

test("buildScreenshotReferenceSectionBody produces identical output for identical input (byte-stable)", () => {
  const refs = [
    { screenId: "1:1", filename: "a.png", sha256: "h1", byteLength: 100 },
    { screenId: "2:2", filename: "b.png", sha256: "h2", byteLength: 200 },
  ];
  const a = buildScreenshotReferenceSectionBody(refs);
  const b = buildScreenshotReferenceSectionBody(refs);
  assert.equal(a, b);
});
