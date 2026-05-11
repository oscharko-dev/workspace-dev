/**
 * Tests for the customer-markdown PDF Mappe (Issue #2238).
 *
 * Covers determinism, magic-header / EOF markers, PNG decoding,
 * embedded image dimensions, and the Markdown-section layout.
 */

import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";

import {
  buildCustomerMarkdownMappe,
  decodePngToRgb,
  extractJiraStoryFromCustomContext,
  type BuildMappeInput,
} from "./customer-markdown-pdf-mappe.js";

/**
 * Tiny synthetic 2×2 RGBA PNG with four solid pixels: red, green,
 * blue, white. Filter type 0 (None) on every scanline so the decoder's
 * Sub/Up/Average/Paeth branches are exercised separately in other
 * tests if needed.
 */
const buildTinyPng = (): Buffer => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(2, 0);
  ihdrData.writeUInt32BE(2, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const ihdr = buildChunk("IHDR", ihdrData);
  // 2×2 RGBA, filter=0, each row = 1 filter byte + 2 pixels × 4 bytes.
  const rows = Buffer.from([
    0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const idat = buildChunk("IDAT", deflateSync(rows));
  const iend = buildChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
};

const buildChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([length, typeBuf, data, crc]);
};

const crc32 = (data: Buffer): Buffer => {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c ^= data[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return out;
};

const fixedInput = (
  overrides: Partial<BuildMappeInput> = {},
): BuildMappeInput => ({
  title: "TestForSimpleComponent",
  subtitle: "https://www.figma.com/design/T7l7m8T8501lxLZZFQrwJC",
  generatedAt: "2026-05-11T20:21:23.403Z",
  jobId: "job-T7l7m8T8501-2026-05-11",
  jiraStoryMarkdown: "# Jira Story: Maske\n\n## Beschreibung\nKurzer Body.",
  testfaelleMarkdown: "# Testfälle\n\n## TC01\nBeschreibung.\n",
  screenshots: [{ label: "01 SimpleComponent", pngBytes: buildTinyPng() }],
  ...overrides,
});

test("buildCustomerMarkdownMappe returns a PDF with the magic header and EOF marker", () => {
  const pdf = buildCustomerMarkdownMappe(fixedInput());
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(pdf.subarray(pdf.length - 8).toString("ascii"), /%%EOF\s*$/u);
});

test("buildCustomerMarkdownMappe is byte-stable for identical inputs", () => {
  const a = buildCustomerMarkdownMappe(fixedInput());
  const b = buildCustomerMarkdownMappe(fixedInput());
  assert.equal(a.equals(b), true);
});

test("buildCustomerMarkdownMappe embeds the screenshot as a DeviceRGB image XObject", () => {
  const pdf = buildCustomerMarkdownMappe(fixedInput());
  const bin = pdf.toString("binary");
  assert.match(bin, /\/Subtype \/Image/u);
  assert.match(bin, /\/ColorSpace \/DeviceRGB/u);
  assert.match(bin, /\/Filter \/FlateDecode/u);
});

test("buildCustomerMarkdownMappe places the cover background and section headings", () => {
  const pdf = buildCustomerMarkdownMappe(fixedInput());
  const bin = pdf.toString("binary");
  // Full-bleed deep-green fill rectangle for the cover.
  assert.match(bin, /\d+(?:\.\d+)? \d+(?:\.\d+)? 595 842 re f/u);
  // German section headings present.
  assert.ok(bin.includes("Screen Shots der Maske"));
  assert.ok(bin.includes("Jira Story zur Maske"));
  assert.ok(bin.includes("Generierte Testf"));
});

test("buildCustomerMarkdownMappe falls back to a placeholder when jira story is empty", () => {
  const pdf = buildCustomerMarkdownMappe(
    fixedInput({ jiraStoryMarkdown: undefined }),
  );
  const bin = pdf.toString("binary");
  assert.ok(bin.includes("Keine Jira-Story konfiguriert"));
});

test("buildCustomerMarkdownMappe handles zero screenshots without crashing", () => {
  const pdf = buildCustomerMarkdownMappe(fixedInput({ screenshots: [] }));
  const bin = pdf.toString("binary");
  assert.ok(bin.includes("Keine Maske-Screenshots im Lauf erfasst"));
});

test("decodePngToRgb decodes a minimal RGBA PNG to a packed RGB buffer", () => {
  const png = buildTinyPng();
  const decoded = decodePngToRgb(png);
  assert.equal(decoded.width, 2);
  assert.equal(decoded.height, 2);
  // 2×2 × 3 channels = 12 bytes
  assert.equal(decoded.pixels.length, 12);
  // First pixel was red (255, 0, 0, 255) → composited over white stays red.
  assert.equal(decoded.pixels[0], 255);
  assert.equal(decoded.pixels[1], 0);
  assert.equal(decoded.pixels[2], 0);
});

test("decodePngToRgb rejects a non-PNG buffer", () => {
  assert.throws(() => decodePngToRgb(Buffer.from("not a png")));
});

test("decodePngToRgb rejects a PNG truncated mid-chunk with a deterministic error", () => {
  const full = buildTinyPng();
  // Drop the last 20 bytes so the IDAT chunk's declared length runs
  // past the remaining buffer. The decoder must raise a controlled
  // error rather than a Node-internal RangeError.
  const truncated = full.subarray(0, full.length - 20);
  assert.throws(() => decodePngToRgb(truncated), /decodePngToRgb: PNG chunk/u);
});

test("decodePngToRgb rejects a PNG with a truncated chunk header", () => {
  // Signature plus only 4 bytes of the next chunk header — the
  // decoder must not read past EOF.
  const broken = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]),
  ]);
  assert.throws(() => decodePngToRgb(broken), /decodePngToRgb: PNG chunk/u);
});

test("extractJiraStoryFromCustomContext returns undefined for a body that has no Jira-story heading", () => {
  // Regression test for the Copilot review point on
  // production-runner.ts:6095. The runner used to fall back to the
  // entire `customContextMarkdown` body when no Jira-story section
  // was found, which leaked unrelated operator context (rubrics,
  // acceptance criteria, …) into the "Jira Story zur Maske" page.
  // The fix is at the call site (the runner now forwards `undefined`
  // instead of the whole body); this test pins the helper contract:
  // bodies without a Jira heading must NOT be returned as a
  // pseudo-story.
  const wideContext = [
    "# Acceptance Criteria",
    "1. The field accepts EUR amounts.",
    "",
    "## Rubric — non-Jira context",
    "Some operator notes the renderer must never call a 'Jira story'.",
  ].join("\n");
  assert.equal(extractJiraStoryFromCustomContext(wideContext), undefined);
});

test("buildCustomerMarkdownMappe truncates a multi-line cover title to two lines (ellipsis lands in the content stream)", () => {
  const longTitle =
    "Ein sehr langer Titel der definitiv über mehrere Zeilen läuft und nicht in zwei Zeilen passt — Teil zwei der Überlänge — Teil drei";
  const pdf = buildCustomerMarkdownMappe(fixedInput({ title: longTitle }));
  const bin = pdf.toString("binary");
  // The PDF contains compressed image streams in which any byte
  // (including 0x85) can occur, so a plain `pdf.includes(0x85)`
  // would be a false positive. We scope the assertion to PDF text
  // runs — the `BT … (literal) Tj … ET` blocks the encoder emits
  // around drawn text — and require the ellipsis byte to appear in
  // one of those literals.
  //
  // The cover title is the only place a `Tj` text operator runs the
  // ellipsis through `encodePdfStringLiteral`, so finding 0x85
  // inside a BT/ET text-run is conclusive evidence the title cap
  // fired (and not a coincidental byte from a Flate image stream).
  const btEtPattern = /BT [^\n]*?\(([^()]*)\) Tj ET/gu;
  const ellipsisInTextRun = Array.from(bin.matchAll(btEtPattern)).some(
    (match) => match[1]!.includes(String.fromCharCode(0x85)),
  );
  assert.ok(
    ellipsisInTextRun,
    "expected the ellipsis (WinAnsi 0x85) inside a PDF text run, not just in an image stream",
  );
});
