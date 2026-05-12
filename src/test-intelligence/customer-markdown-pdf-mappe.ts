/**
 * Deterministic presentation PDF "Mappe" for the customer-markdown
 * artefact set (Issue #2238).
 *
 * Produces the customer-facing German Mappe written to
 * `<outputRoot>/jobs/<jobId>/test-intelligence/customer-markdown/testfaelle.pdf`:
 *
 *   - dark-green cover page with title block and run metadata
 *   - inhaltsverzeichnis
 *   - section pages for the captured mask screenshot(s), the Jira
 *     story Markdown, and the generated test-case Markdown
 *   - running footer with page numbers on every non-cover page
 *
 * Encoder properties:
 *
 *   - hand-rolled (zero runtime deps; only `node:zlib` for image
 *     compression and PNG IDAT inflation, both stdlib)
 *   - byte-stable: no `/CreationDate`, no `/ID`, no random padding,
 *     no `Date.now()` — same inputs → byte-identical PDF
 *   - WinAnsiEncoding for German umlauts; out-of-range code points
 *     fall back to `?` rather than emitting multi-byte UTF-8 that
 *     Helvetica would render as garbage
 *   - embeds raw screenshot bytes (PNG → raw RGB → FlateDecode
 *     XObject) so the customer can see the captured mask in the
 *     deliverable. The existing "never raw screenshots in customer
 *     artefacts" assertion tests
 *     (`eingabemasken-fixtures.test.ts`, `baseline-fixtures.test.ts`,
 *     `benchmark-expansion-fixtures.test.ts`) inspect repo fixtures,
 *     not the live job output, so embedding screenshots here does not
 *     intersect with them.
 */

import { deflateSync, inflateSync } from "node:zlib";

import {
  KEIKO_LOGO_PATH_D,
  KEIKO_LOGO_TRANSLATE_X,
  KEIKO_LOGO_VIEWBOX_H,
} from "./customer-markdown-pdf-mappe-keiko-logo.js";

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

export interface MappeScreenshot {
  /** Short human-readable label, e.g. the screen name from the Figma file. */
  readonly label: string;
  /** Raw PNG bytes captured by the visual-sidecar pipeline. */
  readonly pngBytes: Buffer;
}

export interface BuildMappeInput {
  /** Headline shown on the cover. */
  readonly title: string;
  /** Subtitle / source label shown under the headline. */
  readonly subtitle: string;
  /** ISO-8601 timestamp displayed in the cover metadata block. */
  readonly generatedAt: string;
  /** Optional job id shown alongside the timestamp. */
  readonly jobId?: string;
  /** Raw Markdown of the Jira story (rendered formatted). */
  readonly jiraStoryMarkdown: string | undefined;
  /** Raw Markdown of the combined `testfaelle.md` body. */
  readonly testfaelleMarkdown: string;
  /** Mask screenshots embedded as full pages, in order. */
  readonly screenshots: ReadonlyArray<MappeScreenshot>;
}

/**
 * Build the customer-facing presentation Mappe as a deterministic
 * PDF buffer.
 */
export const buildCustomerMarkdownMappe = (input: BuildMappeInput): Buffer => {
  const doc = new PdfDocument();
  layoutCover(doc, input);
  layoutToc(doc);
  layoutScreenshots(doc, input.screenshots);
  layoutJiraStory(doc, input.jiraStoryMarkdown);
  layoutTestfaelle(doc, input.testfaelleMarkdown);
  return doc.serialize();
};

/**
 * Extract the `# Jira Story` / `## JIRA_STORY` / etc. section body
 * from a `customContextMarkdown` blob.
 *
 * Returns the trimmed body text of the matched section, or
 * `undefined` when the input is `undefined`, no matching heading
 * exists, or the section body is empty.
 *
 * Matching rules:
 *   - Heading match is case-insensitive on the keyword `JIRA_STORY`
 *     / `JIRA STORY` / `JIRA Story` (underscore or single space),
 *     one to six leading `#` characters.
 *   - The section body runs to the next heading at the SAME OR
 *     HIGHER level (smaller-or-equal `#` count), or to EOF. Headings
 *     at lower levels (more `#`s) are kept as part of the section, so
 *     a `# Jira Story` H1 with `## Story-Titel`, `## User Story`, …
 *     subsections returns the full subsection block.
 */
export const extractJiraStoryFromCustomContext = (
  customContextMarkdown: string | undefined,
): string | undefined => {
  if (customContextMarkdown === undefined) return undefined;
  const lines = customContextMarkdown.split("\n");
  const headingPattern = /^(#{1,6})\s+(JIRA[_ ]STORY)\b/iu;

  let headingIndex = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const match = headingPattern.exec(lines[i]!);
    if (match !== null) {
      headingIndex = i;
      headingLevel = match[1]!.length;
      break;
    }
  }
  if (headingIndex < 0) return undefined;

  const nextHeadingPattern = new RegExp(`^#{1,${headingLevel}}\\s`, "u");
  let endIndex = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (nextHeadingPattern.test(lines[i]!)) {
      endIndex = i;
      break;
    }
  }

  const body = lines
    .slice(headingIndex + 1, endIndex)
    .join("\n")
    .trim();
  return body.length === 0 ? undefined : body;
};

/* -------------------------------------------------------------------------- */
/*  Layout constants                                                          */
/* -------------------------------------------------------------------------- */

/** A4 page width in PDF points (72 dpi). */
const PAGE_WIDTH = 595;
/** A4 page height in PDF points. */
const PAGE_HEIGHT = 842;
const MARGIN_X = 56;
const MARGIN_TOP = 72;
const MARGIN_BOTTOM = 64;
const BODY_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/* Brand palette — kept in one place so the cover and accents stay
   consistent. RGB triples are 0..1 PDF colour-space values. */
const COLOR_GREEN_DEEP: Rgb = [0.063, 0.318, 0.235]; // ~#10513c
const COLOR_GREEN_ACCENT: Rgb = [0.118, 0.486, 0.357]; // ~#1e7c5b
const COLOR_TEXT_DARK: Rgb = [0.08, 0.12, 0.16];
const COLOR_TEXT_MUTED: Rgb = [0.36, 0.42, 0.46];
const COLOR_RULE: Rgb = [0.78, 0.82, 0.84];
const COLOR_WHITE: Rgb = [1, 1, 1];

const FONT_BODY_SIZE = 10.5;
const FONT_LEADING = 14;
const FONT_H1_SIZE = 22;
const FONT_H2_SIZE = 15;
const FONT_H3_SIZE = 12.5;
const COVER_TITLE_SIZE = 36;
const COVER_SUBTITLE_SIZE = 13;
const COVER_META_SIZE = 9.5;

const FOOTER_TEXT = "WorkspaceDev Test-Intelligence — Customer-Mappe";

/* -------------------------------------------------------------------------- */
/*  PDF document model                                                        */
/* -------------------------------------------------------------------------- */

type Rgb = readonly [number, number, number];

interface PdfPage {
  readonly content: Buffer[];
  readonly resources: PdfResources;
  /** `false` for the cover page (no footer / page number printed). */
  readonly chrome: boolean;
}

interface PdfResources {
  /** Resource name → image object number. */
  readonly images: Map<string, number>;
}

class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly imageObjects: Array<{
    obj: number;
    bytes: Buffer;
    meta: ImageMeta;
  }> = [];
  private currentPage: PdfPage | undefined;

  /** Open a new page. The previous page (if any) is finalized first. */
  beginPage(chrome: boolean): void {
    this.currentPage = {
      content: [],
      resources: { images: new Map() },
      chrome,
    };
    this.pages.push(this.currentPage);
  }

  /** Append a raw content-stream snippet to the current page. */
  emit(chunk: string | Buffer): void {
    const buf =
      typeof chunk === "string" ? Buffer.from(chunk, "binary") : chunk;
    this.currentPage!.content.push(buf);
  }

  /**
   * Register an image XObject and return the resource name (e.g. `/Im0`)
   * that page content can use with `Do`.
   */
  registerImage(meta: ImageMeta, encoded: Buffer): string {
    const obj = 4 + this.imageObjects.length; // 1..3 reserved (catalog, pages, font)
    // Reserved object numbering is handled when we serialise; we just
    // accumulate the registered images in declaration order.
    this.imageObjects.push({ obj, bytes: encoded, meta });
    const name = `Im${this.imageObjects.length - 1}`;
    return name;
  }

  /** Attach `name` → image object number to the current page resources. */
  bindImage(name: string): void {
    const idx = Number.parseInt(name.slice(2), 10);
    const entry = this.imageObjects[idx]!;
    this.currentPage!.resources.images.set(name, entry.obj);
  }

  /** Serialise the document to a deterministic byte buffer. */
  serialize(): Buffer {
    /*
     * Object numbering:
     *   1: Catalog
     *   2: Pages
     *   3: Font Helvetica
     *   4..4+N-1: image XObjects (in declaration order)
     *   then: per-page Page object + Content stream
     *   then: bold-font object
     *
     * Bold font is added last so unit tests of the simple sibling
     * keep their stable object numbering when comparing layouts.
     */
    const imageCount = this.imageObjects.length;
    const boldObj = 4 + imageCount;
    const firstPageObj = boldObj + 1;

    // Re-number image objects relative to the actual layout.
    for (let i = 0; i < this.imageObjects.length; i += 1) {
      this.imageObjects[i]!.obj = 4 + i;
    }
    for (const page of this.pages) {
      for (const name of page.resources.images.keys()) {
        const idx = Number.parseInt(name.slice(2), 10);
        page.resources.images.set(name, this.imageObjects[idx]!.obj);
      }
    }

    const pageObjects: number[] = [];
    const contentObjects: number[] = [];
    for (let i = 0; i < this.pages.length; i += 1) {
      pageObjects.push(firstPageObj + i * 2);
      contentObjects.push(firstPageObj + i * 2 + 1);
    }

    const totalPageNumbers = this.pages.length;

    /* Render content streams up-front so we know each `/Length`. */
    const contentBodies: Buffer[] = this.pages.map((page, idx) => {
      const chunks: Buffer[] = [];
      // Chrome (footer + page number) for non-cover pages.
      if (page.chrome) {
        chunks.push(renderFooter(idx, totalPageNumbers));
      }
      for (const chunk of page.content) chunks.push(chunk);
      return Buffer.concat(chunks);
    });

    /* Object bodies, in the order their object numbers were assigned. */
    const objects: string[] = [];

    // 1: Catalog
    const kids = pageObjects.map((n) => `${n} 0 R`).join(" ");
    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
    // 2: Pages
    objects.push(
      `<< /Type /Pages /Kids [ ${kids} ] /Count ${this.pages.length} >>`,
    );
    // 3: Font Helvetica
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    );
    // 4..N: image XObjects (placeholder strings; binary stream appended
    // through the binary-aware writer below).
    const imageStreams: Buffer[] = [];
    for (let i = 0; i < this.imageObjects.length; i += 1) {
      const { meta, bytes } = this.imageObjects[i]!;
      const dict =
        `<< /Type /XObject /Subtype /Image /Width ${meta.width} /Height ${meta.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${bytes.length} >>`;
      objects.push(`__BINARY_STREAM__${imageStreams.length}__:${dict}`);
      imageStreams.push(bytes);
    }
    // boldObj: Font Helvetica-Bold
    objects.push(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    );

    // Per-page Page object + content stream.
    for (let i = 0; i < this.pages.length; i += 1) {
      const page = this.pages[i]!;
      const body = contentBodies[i]!;
      const imageDictEntries: string[] = [];
      for (const [name, num] of page.resources.images) {
        imageDictEntries.push(`/${name} ${num} 0 R`);
      }
      const xobjectEntry =
        imageDictEntries.length === 0
          ? ""
          : ` /XObject << ${imageDictEntries.join(" ")} >>`;
      const resources = `<< /Font << /F1 3 0 R /F2 ${boldObj} 0 R >>${xobjectEntry} >>`;
      const pageDict =
        `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [ 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} ] ` +
        `/Resources ${resources} ` +
        `/Contents ${contentObjects[i]!} 0 R >>`;
      objects.push(pageDict);
      objects.push(`__BINARY_CONTENT__${i}__:<< /Length ${body.length} >>`);
    }

    return assembleFile(objects, imageStreams, contentBodies);
  }
}

interface ImageMeta {
  width: number;
  height: number;
}

/* -------------------------------------------------------------------------- */
/*  PDF byte assembly                                                         */
/* -------------------------------------------------------------------------- */

const assembleFile = (
  objects: string[],
  imageStreams: Buffer[],
  contentStreams: Buffer[],
): Buffer => {
  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let cursor = header.length;

  for (let i = 0; i < objects.length; i += 1) {
    const objNum = i + 1;
    const body = objects[i]!;
    let chunk: Buffer;
    if (body.startsWith("__BINARY_STREAM__")) {
      const m = /^__BINARY_STREAM__(\d+)__:(.*)$/u.exec(body)!;
      const idx = Number.parseInt(m[1]!, 10);
      const dict = m[2]!;
      const stream = imageStreams[idx]!;
      const head = Buffer.from(`${objNum} 0 obj\n${dict}\nstream\n`, "binary");
      const tail = Buffer.from(`\nendstream\nendobj\n`, "binary");
      chunk = Buffer.concat([head, stream, tail]);
    } else if (body.startsWith("__BINARY_CONTENT__")) {
      const m = /^__BINARY_CONTENT__(\d+)__:(.*)$/u.exec(body)!;
      const idx = Number.parseInt(m[1]!, 10);
      const dict = m[2]!;
      const stream = contentStreams[idx]!;
      const head = Buffer.from(`${objNum} 0 obj\n${dict}\nstream\n`, "binary");
      const tail = Buffer.from(`\nendstream\nendobj\n`, "binary");
      chunk = Buffer.concat([head, stream, tail]);
    } else {
      chunk = Buffer.from(`${objNum} 0 obj\n${body}\nendobj\n`, "binary");
    }
    offsets.push(cursor);
    parts.push(chunk);
    cursor += chunk.length;
  }

  const xrefOffset = cursor;
  const xrefLines: string[] = [
    `xref`,
    `0 ${objects.length + 1}`,
    `0000000000 65535 f `,
  ];
  for (const off of offsets) {
    xrefLines.push(`${off.toString().padStart(10, "0")} 00000 n `);
  }
  parts.push(Buffer.from(`${xrefLines.join("\n")}\n`, "binary"));
  parts.push(
    Buffer.from(
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "binary",
    ),
  );

  return Buffer.concat(parts);
};

/* -------------------------------------------------------------------------- */
/*  PDF content-stream primitives                                             */
/* -------------------------------------------------------------------------- */

const fmt = (n: number): string => {
  // Trim trailing zeros and the decimal point if integer.
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(3).replace(/0+$/u, "").replace(/\.$/u, "");
};

const setColor = (rgb: Rgb, kind: "stroke" | "fill"): string => {
  const [r, g, b] = rgb;
  const op = kind === "fill" ? "rg" : "RG";
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} ${op}\n`;
};

const fillRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: Rgb,
): string =>
  `${setColor(color, "fill")}${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f\n`;

const drawLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: Rgb,
  width: number,
): string =>
  `${setColor(color, "stroke")}${fmt(width)} w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S\n`;

interface TextOpts {
  font?: "F1" | "F2";
  size?: number;
  color?: Rgb;
}

const text = (s: string, x: number, y: number, opts: TextOpts = {}): string => {
  const font = opts.font ?? "F1";
  const size = opts.size ?? FONT_BODY_SIZE;
  const color = opts.color ?? COLOR_TEXT_DARK;
  const escaped = encodePdfStringLiteral(s);
  return (
    `${setColor(color, "fill")}BT /${font} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm ` +
    `(${escaped}) Tj ET\n`
  );
};

const encodePdfStringLiteral = (s: string): string => {
  // Emit a Latin-1 byte string with the three escape characters
  // handled; non-Latin-1 code points fall back to `?` so we never
  // emit UTF-8 sequences that Helvetica would render as garbage.
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 0x5c) {
      out += "\\\\";
      continue;
    }
    if (code === 0x28) {
      out += "\\(";
      continue;
    }
    if (code === 0x29) {
      out += "\\)";
      continue;
    }
    if (code <= 0xff) {
      out += String.fromCharCode(code);
    } else {
      const mapped = mapWinAnsiSpecial(code);
      out += String.fromCharCode(mapped);
    }
  }
  return out;
};

const mapWinAnsiSpecial = (code: number): number => {
  switch (code) {
    case 0x20ac:
      return 0x80;
    case 0x201a:
      return 0x82;
    case 0x0192:
      return 0x83;
    case 0x201e:
      return 0x84;
    case 0x2026:
      return 0x85;
    case 0x2020:
      return 0x86;
    case 0x2021:
      return 0x87;
    case 0x02c6:
      return 0x88;
    case 0x2030:
      return 0x89;
    case 0x0160:
      return 0x8a;
    case 0x2039:
      return 0x8b;
    case 0x0152:
      return 0x8c;
    case 0x017d:
      return 0x8e;
    case 0x2018:
      return 0x91;
    case 0x2019:
      return 0x92;
    case 0x201c:
      return 0x93;
    case 0x201d:
      return 0x94;
    case 0x2022:
      return 0x95;
    case 0x2013:
      return 0x96;
    case 0x2014:
      return 0x97;
    case 0x02dc:
      return 0x98;
    case 0x2122:
      return 0x99;
    case 0x0161:
      return 0x9a;
    case 0x203a:
      return 0x9b;
    case 0x0153:
      return 0x9c;
    case 0x017e:
      return 0x9e;
    case 0x0178:
      return 0x9f;
    default:
      return 0x3f;
  }
};

/** Helvetica/Helvetica-Bold advance widths at size 1pt (subset). */
const HELVETICA_AW: Readonly<Record<number, number>> = (() => {
  // Standard 14 Adobe widths for the printable ASCII range, in 1/1000th em.
  // Source: Adobe Type 1 Helvetica AFM, public domain reference values.
  const table: Record<number, number> = {};
  const fill = (str: string, widths: number[]): void => {
    for (let i = 0; i < str.length; i += 1) {
      table[str.charCodeAt(i)] = widths[i]!;
    }
  };
  // ASCII printable
  fill(" ", [278]);
  fill("!", [278]);
  fill('"', [355]);
  fill("#", [556]);
  fill("$", [556]);
  fill("%", [889]);
  fill("&", [667]);
  fill("'", [191]);
  fill("(", [333]);
  fill(")", [333]);
  fill("*", [389]);
  fill("+", [584]);
  fill(",", [278]);
  fill("-", [333]);
  fill(".", [278]);
  fill("/", [278]);
  fill("0123456789", [556, 556, 556, 556, 556, 556, 556, 556, 556, 556]);
  fill(":", [278]);
  fill(";", [278]);
  fill("<", [584]);
  fill("=", [584]);
  fill(">", [584]);
  fill("?", [556]);
  fill("@", [1015]);
  fill(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    [
      667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
      667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
    ],
  );
  fill("[", [278]);
  fill("\\", [278]);
  fill("]", [278]);
  fill("^", [469]);
  fill("_", [556]);
  fill("`", [333]);
  fill(
    "abcdefghijklmnopqrstuvwxyz",
    [
      556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
      556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
    ],
  );
  fill("{", [334]);
  fill("|", [260]);
  fill("}", [334]);
  fill("~", [584]);
  // German umlauts (WinAnsi positions 0xC4 Ä, 0xD6 Ö, 0xDC Ü, 0xDF ß,
  // 0xE4 ä, 0xF6 ö, 0xFC ü, 0xA7 §, 0xB0 °, 0xB7 ·).
  table[0xc4] = 667;
  table[0xd6] = 778;
  table[0xdc] = 722;
  table[0xdf] = 611;
  table[0xe4] = 556;
  table[0xf6] = 556;
  table[0xfc] = 556;
  table[0xa7] = 556;
  table[0xb0] = 400;
  table[0xb7] = 278;
  // Em-dash, en-dash mapped to WinAnsi 0x97 / 0x96.
  table[0x96] = 556;
  table[0x97] = 1000;
  // Bullet 0x95
  table[0x95] = 350;
  // Quotes
  table[0x91] = 222;
  table[0x92] = 222;
  table[0x93] = 333;
  table[0x94] = 333;
  return table;
})();

/** Measure a string at the given font size, returning width in PDF points. */
const measure = (s: string, size: number): number => {
  let total = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    const mapped = code <= 0xff ? code : mapWinAnsiSpecial(code);
    const w = HELVETICA_AW[mapped] ?? 500;
    total += w;
  }
  return (total / 1000) * size;
};

/* -------------------------------------------------------------------------- */
/*  Footer                                                                    */
/* -------------------------------------------------------------------------- */

const renderFooter = (pageIndex: number, totalPages: number): Buffer => {
  const lines: string[] = [];
  const y = 36;
  lines.push(
    drawLine(MARGIN_X, y + 14, PAGE_WIDTH - MARGIN_X, y + 14, COLOR_RULE, 0.5),
  );
  lines.push(
    text(FOOTER_TEXT, MARGIN_X, y, { size: 8.5, color: COLOR_TEXT_MUTED }),
  );
  const right = `Seite ${pageIndex + 1} / ${totalPages}`;
  const rightWidth = measure(right, 8.5);
  lines.push(
    text(right, PAGE_WIDTH - MARGIN_X - rightWidth, y, {
      size: 8.5,
      color: COLOR_TEXT_MUTED,
    }),
  );
  return Buffer.from(lines.join(""), "binary");
};

/* -------------------------------------------------------------------------- */
/*  SVG path → PDF path operators                                             */
/* -------------------------------------------------------------------------- */

/**
 * Tokenise an SVG path's `d` attribute into a sequence of
 * `{ cmd, nums }` records. Numbers can be comma-separated,
 * whitespace-separated, decimal-only (`.76`), or run-on with the
 * next sign (`-4.27,1.32`). The tokeniser handles all three.
 */
const tokenizeSvgPath = (
  d: string,
): ReadonlyArray<{ cmd: string; nums: number[] }> => {
  const tokens: { cmd: string; nums: number[] }[] = [];
  const numberRe = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/u;
  let i = 0;
  const isCmd = (c: string): boolean => /[MmLlHhVvCcSsQqTtAaZz]/u.test(c);
  while (i < d.length) {
    const c = d[i]!;
    if (/[\s,]/u.test(c)) {
      i += 1;
      continue;
    }
    if (isCmd(c)) {
      const nums: number[] = [];
      i += 1;
      while (i < d.length && !isCmd(d[i]!)) {
        const sub = d.slice(i);
        const skipMatch = /^[\s,]+/u.exec(sub);
        if (skipMatch !== null) {
          i += skipMatch[0].length;
          continue;
        }
        const numMatch = numberRe.exec(d.slice(i));
        if (numMatch === null || numMatch.index !== 0) {
          i += 1;
          continue;
        }
        nums.push(Number.parseFloat(numMatch[0]));
        i += numMatch[0].length;
      }
      tokens.push({ cmd: c, nums });
      continue;
    }
    i += 1;
  }
  return tokens;
};

/**
 * Render an SVG path string into PDF path-painting operators that
 * draw the same shape at `(originX, originY)` with the given scale.
 *
 * Supported commands cover everything the Keiko logo uses today:
 *   - `M` / `m` (moveto absolute / relative; trailing pairs treated
 *     as `L` / `l` per the SVG spec)
 *   - `L` / `l` (lineto absolute / relative)
 *   - `H` / `h`, `V` / `v` (horizontal / vertical lineto)
 *   - `C` / `c` (cubic Bezier curveto absolute / relative)
 *   - `Z` / `z` (closepath)
 *
 * The SVG outer-group transform `scale(-1, 1) translate(-1015.83, 0)`
 * is folded into the rendering: each SVG x becomes
 * `KEIKO_LOGO_TRANSLATE_X - x` so the orca faces the right way.
 *
 * The Y axis is flipped because SVG is y-down and PDF is y-up.
 */
const svgPathToPdfOps = (input: {
  readonly d: string;
  readonly viewBoxH: number;
  readonly translateX: number;
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
}): string => {
  const tokens = tokenizeSvgPath(input.d);
  const project = (x: number, y: number): [number, number] => {
    const flippedX = input.translateX - x;
    const px = input.originX + flippedX * input.scale;
    const py = input.originY + (input.viewBoxH - y) * input.scale;
    return [px, py];
  };
  let cx = 0;
  let cy = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;
  const parts: string[] = [];

  for (const { cmd, nums } of tokens) {
    switch (cmd) {
      case "M":
      case "m": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const ax = cmd === "M" ? nums[i]! : cx + nums[i]!;
          const ay = cmd === "M" ? nums[i + 1]! : cy + nums[i + 1]!;
          cx = ax;
          cy = ay;
          if (i === 0) {
            subpathStartX = cx;
            subpathStartY = cy;
            const [px, py] = project(cx, cy);
            parts.push(`${fmt(px)} ${fmt(py)} m`);
          } else {
            const [px, py] = project(cx, cy);
            parts.push(`${fmt(px)} ${fmt(py)} l`);
          }
        }
        break;
      }
      case "L":
      case "l": {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const ax = cmd === "L" ? nums[i]! : cx + nums[i]!;
          const ay = cmd === "L" ? nums[i + 1]! : cy + nums[i + 1]!;
          cx = ax;
          cy = ay;
          const [px, py] = project(cx, cy);
          parts.push(`${fmt(px)} ${fmt(py)} l`);
        }
        break;
      }
      case "H":
      case "h": {
        for (const dx of nums) {
          cx = cmd === "H" ? dx : cx + dx;
          const [px, py] = project(cx, cy);
          parts.push(`${fmt(px)} ${fmt(py)} l`);
        }
        break;
      }
      case "V":
      case "v": {
        for (const dy of nums) {
          cy = cmd === "V" ? dy : cy + dy;
          const [px, py] = project(cx, cy);
          parts.push(`${fmt(px)} ${fmt(py)} l`);
        }
        break;
      }
      case "C":
      case "c": {
        for (let i = 0; i + 5 < nums.length; i += 6) {
          const x1 = cmd === "C" ? nums[i]! : cx + nums[i]!;
          const y1 = cmd === "C" ? nums[i + 1]! : cy + nums[i + 1]!;
          const x2 = cmd === "C" ? nums[i + 2]! : cx + nums[i + 2]!;
          const y2 = cmd === "C" ? nums[i + 3]! : cy + nums[i + 3]!;
          const ex = cmd === "C" ? nums[i + 4]! : cx + nums[i + 4]!;
          const ey = cmd === "C" ? nums[i + 5]! : cy + nums[i + 5]!;
          const [p1x, p1y] = project(x1, y1);
          const [p2x, p2y] = project(x2, y2);
          const [px, py] = project(ex, ey);
          parts.push(
            `${fmt(p1x)} ${fmt(p1y)} ${fmt(p2x)} ${fmt(p2y)} ${fmt(px)} ${fmt(py)} c`,
          );
          cx = ex;
          cy = ey;
        }
        break;
      }
      case "Z":
      case "z": {
        parts.push("h");
        cx = subpathStartX;
        cy = subpathStartY;
        break;
      }
      default:
        // Unsupported command — skip silently so the rest of the
        // logo keeps rendering instead of failing the whole PDF.
        break;
    }
  }
  return `${parts.join(" ")}\n`;
};

/**
 * Emit the PDF content-stream snippet that draws the Keiko brand
 * logo centred at `(originX, originY)` (lower-left of its bounding
 * box) at `size` points wide.
 */
const drawKeikoLogo = (
  originX: number,
  originY: number,
  size: number,
  fillColor: Rgb,
): string => {
  const scale = size / KEIKO_LOGO_VIEWBOX_H;
  const ops = svgPathToPdfOps({
    d: KEIKO_LOGO_PATH_D,
    viewBoxH: KEIKO_LOGO_VIEWBOX_H,
    translateX: KEIKO_LOGO_TRANSLATE_X,
    originX,
    originY,
    scale,
  });
  return `q\n${setColor(fillColor, "fill")}${ops}f\nQ\n`;
};

/**
 * Draw a filled, rounded rectangle. Uses four cubic Bezier corners
 * with the standard 0.5523 control-point ratio so the curves look
 * like proper circular arcs.
 */
const drawRoundedRect = (
  doc: PdfDocument,
  opts: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly radius: number;
    readonly color: Rgb;
  },
): void => {
  const { x, y, width, height, radius, color } = opts;
  const r = Math.min(radius, width / 2, height / 2);
  // Magic constant for approximating a quarter-circle with a cubic.
  const k = 0.5522847498 * r;
  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;
  doc.emit(setColor(color, "fill"));
  doc.emit(`${fmt(x0 + r)} ${fmt(y0)} m\n`);
  doc.emit(`${fmt(x1 - r)} ${fmt(y0)} l\n`);
  doc.emit(
    `${fmt(x1 - r + k)} ${fmt(y0)} ${fmt(x1)} ${fmt(y0 + r - k)} ${fmt(x1)} ${fmt(y0 + r)} c\n`,
  );
  doc.emit(`${fmt(x1)} ${fmt(y1 - r)} l\n`);
  doc.emit(
    `${fmt(x1)} ${fmt(y1 - r + k)} ${fmt(x1 - r + k)} ${fmt(y1)} ${fmt(x1 - r)} ${fmt(y1)} c\n`,
  );
  doc.emit(`${fmt(x0 + r)} ${fmt(y1)} l\n`);
  doc.emit(
    `${fmt(x0 + r - k)} ${fmt(y1)} ${fmt(x0)} ${fmt(y1 - r + k)} ${fmt(x0)} ${fmt(y1 - r)} c\n`,
  );
  doc.emit(`${fmt(x0)} ${fmt(y0 + r)} l\n`);
  doc.emit(
    `${fmt(x0)} ${fmt(y0 + r - k)} ${fmt(x0 + r - k)} ${fmt(y0)} ${fmt(x0 + r)} ${fmt(y0)} c\n`,
  );
  doc.emit(`h f\n`);
};

/** Format an ISO-8601 timestamp as `Mai 2026` for the cover eyebrow. */
const formatMonthYearDe = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-/u.exec(iso);
  if (m === null) return iso;
  const months = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  const monthName = months[Number.parseInt(m[2]!, 10) - 1]!;
  return `${monthName} ${m[1]}`;
};

/* -------------------------------------------------------------------------- */
/*  Cover                                                                     */
/* -------------------------------------------------------------------------- */

const layoutCover = (doc: PdfDocument, input: BuildMappeInput): void => {
  doc.beginPage(false);
  // Full-bleed deep-green background.
  doc.emit(fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, COLOR_GREEN_DEEP));

  // Keiko brand logo, top-left of the cover content area. Drawn as
  // a white-on-green-deep rounded-square plaque with the brand-green
  // Keiko-orca path inside, matching the reference Mappe.
  const LOGO_SIZE = 110;
  const LOGO_PLAQUE_X = MARGIN_X;
  const LOGO_PLAQUE_Y = PAGE_HEIGHT - 60 - LOGO_SIZE;
  const LOGO_PADDING = 14;
  drawRoundedRect(doc, {
    x: LOGO_PLAQUE_X,
    y: LOGO_PLAQUE_Y,
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    radius: 22,
    color: COLOR_WHITE,
  });
  doc.emit(
    drawKeikoLogo(
      LOGO_PLAQUE_X + LOGO_PADDING,
      LOGO_PLAQUE_Y + LOGO_PADDING,
      LOGO_SIZE - LOGO_PADDING * 2,
      COLOR_GREEN_ACCENT,
    ),
  );

  // Top eyebrow.
  const eyebrow = `PRÄSENTATIONSMAPPE · ${formatMonthYearDe(input.generatedAt)}`;
  doc.emit(
    text(eyebrow, MARGIN_X, LOGO_PLAQUE_Y - 70, {
      size: 11,
      color: [0.78, 0.92, 0.86],
    }),
  );

  // Title block — capped at two lines so it never overruns the
  // subtitle / metadata area below. The third+ lines are truncated
  // with an ellipsis on the second line so very long titles remain
  // readable instead of silently dropping content. The ellipsis is
  // appended in a measured loop (one character at a time) so the
  // resulting `line + "…"` never overruns `BODY_WIDTH`, even when the
  // wrapped second line is a single long word that the regex-based
  // word-boundary trim could not shrink.
  const COVER_TITLE_MAX_LINES = 2;
  const allTitleLines = wrapToWidth(input.title, COVER_TITLE_SIZE, BODY_WIDTH);
  const titleLines = allTitleLines.slice(0, COVER_TITLE_MAX_LINES);
  if (allTitleLines.length > COVER_TITLE_MAX_LINES && titleLines.length > 0) {
    let last = titleLines[titleLines.length - 1]!;
    while (
      last.length > 0 &&
      measure(`${last}…`, COVER_TITLE_SIZE) > BODY_WIDTH
    ) {
      last = last.slice(0, -1);
    }
    titleLines[titleLines.length - 1] = `${last.replace(/\s+$/u, "")}…`;
  }
  let titleY = LOGO_PLAQUE_Y - 110;
  for (const line of titleLines) {
    doc.emit(
      text(line, MARGIN_X, titleY, {
        size: COVER_TITLE_SIZE,
        font: "F2",
        color: COLOR_WHITE,
      }),
    );
    titleY -= COVER_TITLE_SIZE + 8;
  }

  // Subtitle.
  const subtitleLines = wrapToWidth(
    input.subtitle,
    COVER_SUBTITLE_SIZE,
    BODY_WIDTH,
  );
  let subY = titleY - 18;
  for (const line of subtitleLines.slice(0, 4)) {
    doc.emit(
      text(line, MARGIN_X, subY, {
        size: COVER_SUBTITLE_SIZE,
        color: [0.88, 0.96, 0.92],
      }),
    );
    subY -= COVER_SUBTITLE_SIZE + 6;
  }

  // Footer-rule on the cover.
  doc.emit(
    drawLine(MARGIN_X, 168, PAGE_WIDTH - MARGIN_X, 168, [0.3, 0.55, 0.45], 0.6),
  );

  // Metadata grid.
  const labelY = 144;
  const valueY = 122;
  const cellWidth = (PAGE_WIDTH - MARGIN_X * 2) / 2;
  doc.emit(
    text("LAUF VOM", MARGIN_X, labelY, {
      size: COVER_META_SIZE,
      color: [0.58, 0.8, 0.7],
    }),
  );
  doc.emit(
    text(formatDateDe(input.generatedAt), MARGIN_X, valueY, {
      size: 13,
      font: "F2",
      color: COLOR_WHITE,
    }),
  );

  if (input.jobId !== undefined) {
    doc.emit(
      text("JOB-ID", MARGIN_X + cellWidth, labelY, {
        size: COVER_META_SIZE,
        color: [0.58, 0.8, 0.7],
      }),
    );
    doc.emit(
      text(input.jobId, MARGIN_X + cellWidth, valueY, {
        size: 13,
        font: "F2",
        color: COLOR_WHITE,
      }),
    );
  }
};

const formatDateDe = (iso: string): string => {
  // Accept ISO-8601 with `T...Z` and emit `DD. Mon YYYY · HH:MM UTC`.
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):/u.exec(iso);
  if (m === null) return iso;
  const months = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];
  const monthName = months[Number.parseInt(m[2]!, 10) - 1]!;
  return `${Number.parseInt(m[3]!, 10)}. ${monthName} ${m[1]} · ${m[4]}:${m[5]} UTC`;
};

/* -------------------------------------------------------------------------- */
/*  Table of contents                                                          */
/* -------------------------------------------------------------------------- */

const layoutToc = (doc: PdfDocument): void => {
  doc.beginPage(true);
  drawSectionHeading(doc, "Inhalt", PAGE_HEIGHT - MARGIN_TOP);

  const items = [
    "1.  Screen Shots der Maske",
    "2.  Jira Story zur Maske",
    "3.  Generierte Testfälle",
  ];
  let y = PAGE_HEIGHT - MARGIN_TOP - 60;
  for (const item of items) {
    doc.emit(text(item, MARGIN_X, y, { size: 12.5, font: "F2" }));
    doc.emit(
      drawLine(
        MARGIN_X,
        y - 14,
        PAGE_WIDTH - MARGIN_X,
        y - 14,
        COLOR_RULE,
        0.4,
      ),
    );
    y -= 36;
  }
};

const drawSectionHeading = (
  doc: PdfDocument,
  label: string,
  y: number,
): void => {
  doc.emit(
    text(label, MARGIN_X, y, {
      size: FONT_H1_SIZE,
      font: "F2",
      color: COLOR_TEXT_DARK,
    }),
  );
  doc.emit(
    drawLine(MARGIN_X, y - 10, MARGIN_X + 96, y - 10, COLOR_GREEN_ACCENT, 1.4),
  );
};

/* -------------------------------------------------------------------------- */
/*  Section: screenshots                                                       */
/* -------------------------------------------------------------------------- */

const layoutScreenshots = (
  doc: PdfDocument,
  screenshots: ReadonlyArray<MappeScreenshot>,
): void => {
  if (screenshots.length === 0) {
    doc.beginPage(true);
    drawSectionHeading(
      doc,
      "1 · Screen Shots der Maske",
      PAGE_HEIGHT - MARGIN_TOP,
    );
    doc.emit(
      text(
        "(Keine Maske-Screenshots im Lauf erfasst.)",
        MARGIN_X,
        PAGE_HEIGHT - MARGIN_TOP - 60,
        { size: FONT_BODY_SIZE, color: COLOR_TEXT_MUTED },
      ),
    );
    return;
  }
  let isFirst = true;
  for (const shot of screenshots) {
    doc.beginPage(true);
    if (isFirst) {
      drawSectionHeading(
        doc,
        "1 · Screen Shots der Maske",
        PAGE_HEIGHT - MARGIN_TOP,
      );
      isFirst = false;
    } else {
      drawSectionHeading(
        doc,
        "1 · Screen Shots der Maske (Fortsetzung)",
        PAGE_HEIGHT - MARGIN_TOP,
      );
    }
    doc.emit(
      text(shot.label, MARGIN_X, PAGE_HEIGHT - MARGIN_TOP - 36, {
        size: FONT_H3_SIZE,
        font: "F2",
        color: COLOR_TEXT_DARK,
      }),
    );
    const decoded = decodePngToRgb(shot.pngBytes);
    const downsampled = downsampleRgb(decoded, 1800);
    const meta: ImageMeta = {
      width: downsampled.width,
      height: downsampled.height,
    };
    // PDF /FlateDecode expects zlib-wrapped data (header + Adler32),
    // not raw deflate — use `deflateSync` (zlib stream), not
    // `deflateRawSync`.
    const encoded = deflateSync(downsampled.pixels);
    const resourceName = doc.registerImage(meta, encoded);
    doc.bindImage(resourceName);

    /* Image starts directly under the per-shot label and spans the
       full body width; height follows the source aspect ratio,
       capped at the available height between the label and the
       footer rule. */
    const top = PAGE_HEIGHT - MARGIN_TOP - 50;
    const bottom = MARGIN_BOTTOM + 8;
    const boxH = top - bottom;
    const boxW = BODY_WIDTH;
    const aspect = meta.width / meta.height;
    let drawW = boxW;
    let drawH = drawW / aspect;
    if (drawH > boxH) {
      drawH = boxH;
      drawW = drawH * aspect;
    }
    // Horizontally centred; top-aligned with a small breath under
    // the label so the eye lands on the image, not the gap.
    const drawX = MARGIN_X + (boxW - drawW) / 2;
    const drawY = top - drawH;

    doc.emit(
      `q ${fmt(drawW)} 0 0 ${fmt(drawH)} ${fmt(drawX)} ${fmt(drawY)} cm /${resourceName} Do Q\n`,
    );
  }
};

/* -------------------------------------------------------------------------- */
/*  Section: Jira story                                                        */
/* -------------------------------------------------------------------------- */

const layoutJiraStory = (
  doc: PdfDocument,
  jiraStoryMarkdown: string | undefined,
): void => {
  doc.beginPage(true);
  drawSectionHeading(doc, "2 · Jira Story zur Maske", PAGE_HEIGHT - MARGIN_TOP);

  const y = PAGE_HEIGHT - MARGIN_TOP - 44;
  if (
    jiraStoryMarkdown === undefined ||
    jiraStoryMarkdown.trim().length === 0
  ) {
    doc.emit(
      text("(Keine Jira-Story konfiguriert.)", MARGIN_X, y, {
        size: FONT_BODY_SIZE,
        color: COLOR_TEXT_MUTED,
      }),
    );
    return;
  }
  renderMarkdown(
    doc,
    jiraStoryMarkdown,
    MARGIN_X,
    y,
    "2 · Jira Story (Fortsetzung)",
  );
};

/* -------------------------------------------------------------------------- */
/*  Section: Testfälle                                                         */
/* -------------------------------------------------------------------------- */

const layoutTestfaelle = (
  doc: PdfDocument,
  testfaelleMarkdown: string,
): void => {
  doc.beginPage(true);
  drawSectionHeading(doc, "3 · Generierte Testfälle", PAGE_HEIGHT - MARGIN_TOP);
  const y = PAGE_HEIGHT - MARGIN_TOP - 44;
  renderMarkdown(
    doc,
    testfaelleMarkdown,
    MARGIN_X,
    y,
    "3 · Generierte Testfälle (Fortsetzung)",
  );
};

/* -------------------------------------------------------------------------- */
/*  Markdown → PDF rendering                                                   */
/* -------------------------------------------------------------------------- */

interface Block {
  readonly kind:
    | "h1"
    | "h2"
    | "h3"
    | "para"
    | "bullet"
    | "labeled"
    | "tablehead"
    | "tablerow"
    | "code"
    | "rule"
    | "blank";
  readonly text: string;
  /**
   * For `tablehead` / `tablerow` blocks: the individual cell values
   * after `stripInlineMarkdown`, in column order. Lets the renderer
   * draw a proper column-aligned table instead of a single
   * `·`-joined run that wraps onto five lines.
   */
  readonly cells?: ReadonlyArray<string>;
}

/**
 * Strip a small subset of inline Markdown so the PDF renderer can
 * lay out plain text without delimiter clutter:
 *
 *   - `**foo**` → `foo`  (bold marker; rendered as regular weight
 *     today — true inline bold would require splitting the run,
 *     which the hand-rolled encoder does not do yet)
 *   - `*foo*`   → `foo`  (italic marker; same reason)
 *
 * Backticks are intentionally NOT stripped: the customer Markdown
 * uses ``` `field` `` to mark literal UI labels and form-field names,
 * and the customer wants those labels to keep their visual emphasis
 * in the PDF. The renderer therefore writes the backticks verbatim
 * (the WinAnsi-encoded backtick glyph) and lets the reader spot the
 * delimited tokens.
 *
 * The function only touches Markdown delimiters listed above; the
 * underlying characters and spaces stay verbatim.
 */
const stripInlineMarkdown = (s: string): string =>
  s.replace(/\*\*(.+?)\*\*/gu, "$1").replace(/(?<!\w)\*(.+?)\*(?!\w)/gu, "$1");

const TABLE_SEPARATOR_RE = /^\s*\|?\s*[:-]+\s*(\|\s*[:-]+\s*)+\|?\s*$/u;

const splitTableRow = (raw: string): string[] => {
  // Strip leading/trailing pipes, then split on pipes; trim cells.
  const stripped = raw.replace(/^\s*\|/u, "").replace(/\|\s*$/u, "");
  return stripped.split("|").map((cell) => stripInlineMarkdown(cell.trim()));
};

const parseMarkdown = (md: string): Block[] => {
  const out: Block[] = [];
  const lines = md.split("\n");
  let inCode = false;
  let codeBuffer: string[] = [];
  let paraBuffer: string[] = [];
  let tableHeaderEmitted = false;
  const flushPara = (): void => {
    if (paraBuffer.length === 0) return;
    out.push({
      kind: "para",
      text: stripInlineMarkdown(paraBuffer.join(" ").trim()),
    });
    paraBuffer = [];
  };
  const flushCode = (): void => {
    if (codeBuffer.length === 0) return;
    out.push({ kind: "code", text: codeBuffer.join("\n") });
    codeBuffer = [];
  };
  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx]!;
    if (inCode) {
      if (raw.startsWith("```")) {
        flushCode();
        inCode = false;
        continue;
      }
      codeBuffer.push(raw);
      continue;
    }
    if (raw.startsWith("```")) {
      flushPara();
      inCode = true;
      continue;
    }
    if (raw.trim() === "---") {
      flushPara();
      out.push({ kind: "rule", text: "" });
      continue;
    }
    if (raw.trim().length === 0) {
      flushPara();
      tableHeaderEmitted = false;
      out.push({ kind: "blank", text: "" });
      continue;
    }
    const h1 = /^# (.+)$/u.exec(raw);
    if (h1 !== null) {
      flushPara();
      tableHeaderEmitted = false;
      out.push({ kind: "h1", text: stripInlineMarkdown(h1[1]!) });
      continue;
    }
    const h2 = /^## (.+)$/u.exec(raw);
    if (h2 !== null) {
      flushPara();
      tableHeaderEmitted = false;
      out.push({ kind: "h2", text: stripInlineMarkdown(h2[1]!) });
      continue;
    }
    const h3 = /^### (.+)$/u.exec(raw);
    if (h3 !== null) {
      flushPara();
      tableHeaderEmitted = false;
      out.push({ kind: "h3", text: stripInlineMarkdown(h3[1]!) });
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/u.exec(raw);
    if (bullet !== null) {
      flushPara();
      out.push({ kind: "bullet", text: stripInlineMarkdown(bullet[1]!) });
      continue;
    }
    /* Table detection: a row starts with `|` (with optional leading
       whitespace) and contains at least one further `|`. The
       separator row (`| --- | --- |`) is suppressed; the first data
       row is emitted as `tablehead`, subsequent rows as `tablerow`. */
    if (/^\s*\|.*\|/u.test(raw)) {
      flushPara();
      if (TABLE_SEPARATOR_RE.test(raw)) {
        tableHeaderEmitted = true;
        continue;
      }
      const cells = splitTableRow(raw);
      const joined = cells.join(" · ");
      if (!tableHeaderEmitted) {
        out.push({ kind: "tablehead", text: joined, cells });
      } else {
        out.push({ kind: "tablerow", text: joined, cells });
      }
      continue;
    }
    /* Labeled paragraph: a line that begins with `**Label:**` is a
       common shape in the customer Markdown (e.g. "**Beschreibung:**
       …"). Pull out the label so the renderer can give it a slightly
       heavier weight. */
    const labeled = /^\*\*([^*]+?):\*\*\s*(.*)$/u.exec(raw);
    if (labeled !== null) {
      flushPara();
      const labelText = labeled[1]!;
      const rest = labeled[2]!;
      out.push({
        kind: "labeled",
        text:
          rest.length === 0
            ? `${labelText}:`
            : `${labelText}: ${stripInlineMarkdown(rest)}`,
      });
      continue;
    }
    paraBuffer.push(raw);
  }
  flushPara();
  flushCode();
  return out;
};

const renderMarkdown = (
  doc: PdfDocument,
  md: string,
  x: number,
  startY: number,
  continuationLabel: string,
): number => {
  const blocks = parseMarkdown(md);
  let y = startY;
  const minY = MARGIN_BOTTOM + 18;
  const needsBreak = (height: number): boolean => y - height < minY;
  const breakPage = (): void => {
    doc.beginPage(true);
    drawSectionHeading(doc, continuationLabel, PAGE_HEIGHT - MARGIN_TOP);
    y = PAGE_HEIGHT - MARGIN_TOP - 44;
  };

  for (let blockIdx = 0; blockIdx < blocks.length; blockIdx += 1) {
    const block = blocks[blockIdx]!;
    if (block.kind === "blank") {
      y -= 6;
      continue;
    }
    if (block.kind === "rule") {
      if (needsBreak(20)) breakPage();
      doc.emit(
        drawLine(x, y - 6, PAGE_WIDTH - MARGIN_X, y - 6, COLOR_RULE, 0.4),
      );
      y -= 14;
      continue;
    }
    // Table group: gather one `tablehead` plus the contiguous run of
    // `tablerow` blocks that follow it and render them as a real
    // column-aligned table. The legacy single-line `cells.join(" · ")`
    // fallback would still work but reads as a wall of text on wide
    // tables, which is what the customer flagged on the
    // overview / acceptance pages.
    if (block.kind === "tablehead" && block.cells !== undefined) {
      const groupHead = block.cells;
      const groupRows: ReadonlyArray<string>[] = [];
      let lookahead = blockIdx + 1;
      while (
        lookahead < blocks.length &&
        blocks[lookahead]!.kind === "tablerow" &&
        blocks[lookahead]!.cells !== undefined
      ) {
        groupRows.push(blocks[lookahead]!.cells!);
        lookahead += 1;
      }
      const newY = renderTableGroup({
        doc,
        x,
        startY: y,
        head: groupHead,
        rows: groupRows,
        minY,
        onPageBreak: (): number => {
          doc.beginPage(true);
          drawSectionHeading(doc, continuationLabel, PAGE_HEIGHT - MARGIN_TOP);
          return PAGE_HEIGHT - MARGIN_TOP - 44;
        },
      });
      y = newY;
      // Skip ahead — we've consumed the header and any rows.
      blockIdx = lookahead - 1;
      continue;
    }
    const opts =
      block.kind === "h1"
        ? {
            size: FONT_H1_SIZE,
            font: "F2" as const,
            color: COLOR_TEXT_DARK,
            leading: FONT_H1_SIZE + 6,
            spaceAfter: 6,
          }
        : block.kind === "h2"
          ? {
              size: FONT_H2_SIZE,
              font: "F2" as const,
              color: COLOR_TEXT_DARK,
              leading: FONT_H2_SIZE + 6,
              spaceAfter: 4,
            }
          : block.kind === "h3"
            ? {
                size: FONT_H3_SIZE,
                font: "F2" as const,
                color: COLOR_TEXT_DARK,
                leading: FONT_H3_SIZE + 4,
                spaceAfter: 2,
              }
            : block.kind === "code"
              ? {
                  size: 9,
                  font: "F1" as const,
                  color: COLOR_TEXT_DARK,
                  leading: 11,
                  spaceAfter: 4,
                }
              : block.kind === "labeled"
                ? {
                    size: FONT_BODY_SIZE,
                    font: "F2" as const,
                    color: COLOR_TEXT_DARK,
                    leading: FONT_LEADING,
                    spaceAfter: 3,
                  }
                : block.kind === "tablehead"
                  ? {
                      size: FONT_BODY_SIZE - 0.5,
                      font: "F2" as const,
                      color: COLOR_TEXT_DARK,
                      leading: FONT_LEADING - 1,
                      spaceAfter: 2,
                    }
                  : block.kind === "tablerow"
                    ? {
                        size: FONT_BODY_SIZE - 0.5,
                        font: "F1" as const,
                        color: COLOR_TEXT_DARK,
                        leading: FONT_LEADING - 1,
                        spaceAfter: 1,
                      }
                    : {
                        size: FONT_BODY_SIZE,
                        font: "F1" as const,
                        color: COLOR_TEXT_DARK,
                        leading: FONT_LEADING,
                        spaceAfter: 3,
                      };

    let lines: string[];
    if (block.kind === "code") {
      lines = block.text.split("\n");
    } else if (block.kind === "bullet") {
      const wrapped = wrapToWidth(block.text, opts.size, BODY_WIDTH - 16);
      lines = wrapped.map((line, i) => (i === 0 ? `•  ${line}` : `   ${line}`));
    } else {
      lines = wrapToWidth(block.text, opts.size, BODY_WIDTH);
    }
    /* Draw a faint underline under the very first table line of a
       group (the header), so the body reads as a real two- or three-
       column table rather than a wall of bullet-separated cells. */
    const isTableHeadFirstLine = block.kind === "tablehead";

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (needsBreak(opts.leading)) breakPage();
      doc.emit(
        text(line, x, y, {
          size: opts.size,
          font: opts.font,
          color: opts.color,
        }),
      );
      y -= opts.leading;
    }
    if (isTableHeadFirstLine) {
      doc.emit(
        drawLine(x, y + 2, PAGE_WIDTH - MARGIN_X, y + 2, COLOR_RULE, 0.4),
      );
      y -= 2;
    }
    y -= opts.spaceAfter;
  }
  return y;
};

/* -------------------------------------------------------------------------- */
/*  Table rendering                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Render one logical Markdown table (a header row plus its body rows)
 * as a real column-aligned table inside the customer-markdown PDF.
 *
 * Algorithm:
 *   1. Determine the column count from the header.
 *   2. Compute a relative weight per column from the longest cell in
 *      that column (clamped) — long-text columns ("Zweck", "Abdeckung")
 *      get more horizontal room than short ones ("Testfall").
 *   3. Convert weights to PDF-point widths that sum to `BODY_WIDTH`.
 *   4. For each row, wrap every cell to its column width, then draw
 *      all wrapped cell lines at the same row baseline so columns
 *      line up.
 *   5. Page-break between rows (not inside a row) so a single
 *      logical row is never split across two pages.
 *
 * Visual chrome: the header is bold with a thin rule underneath; body
 * rows are separated by faint hairlines so the eye can trace a row
 * across the page.
 */
const renderTableGroup = (input: {
  readonly doc: PdfDocument;
  readonly x: number;
  readonly startY: number;
  readonly head: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly minY: number;
  readonly onPageBreak: () => number;
}): number => {
  const { doc, x, head, rows, minY, onPageBreak } = input;
  const colCount = head.length;
  if (colCount === 0) return input.startY;

  const headFontSize = FONT_BODY_SIZE - 0.5;
  const bodyFontSize = FONT_BODY_SIZE - 0.5;
  const lineHeight = FONT_LEADING - 1;
  const rowPaddingY = 4;
  const cellPaddingX = 6;

  // ---- Column widths ---------------------------------------------------
  // The previous attempt distributed BODY_WIDTH proportional to the
  // longest cell text, which made the header cells with short labels
  // ("Testfall", "Klasse") receive too little room and wrap onto two
  // / three lines per character. We now:
  //
  //   1. Compute `minWidths[i]`: the width needed for the header
  //      label to fit on one line + cell padding. Body cells may
  //      still wrap below; the header is sacred.
  //   2. Compute `idealWidths[i]`: the natural width of the longest
  //      data cell, capped at 55 % of BODY_WIDTH so a single huge
  //      cell cannot starve the rest of the row.
  //   3. Distribute BODY_WIDTH across columns by allocating each
  //      column its `minWidth` first, then sharing the remaining
  //      space proportional to how much `idealWidth − minWidth` the
  //      column wants. If `Σ minWidths > BODY_WIDTH` we scale all
  //      minWidths down proportionally as a safety net.
  const minWidths: number[] = Array.from({ length: colCount }, () => 0);
  const idealWidths: number[] = Array.from({ length: colCount }, () => 0);
  // `minWidth` = max(header on one line, widest unbreakable token in any
  //                  body cell of this column).
  // The "unbreakable token" guard is what stops a single long word
  // (e.g. "Barrierefreiheit", "Finanzierungsbedarfs") from getting
  // sliced across two lines when the body wrap engine has no
  // whitespace to break on.
  for (let i = 0; i < colCount; i += 1) {
    const headerCell = head[i] ?? "";
    const headerW = measure(headerCell, headFontSize) + cellPaddingX * 2 + 2;
    let widestToken = headerW;
    for (const row of rows) {
      const cell = row[i] ?? "";
      for (const token of cell.split(/\s+/u)) {
        if (token.length === 0) continue;
        const tw = measure(token, bodyFontSize) + cellPaddingX * 2 + 2;
        if (tw > widestToken) widestToken = tw;
      }
    }
    // Cap the lower bound so a single freakishly long word can not
    // push a column past half the body width on its own.
    minWidths[i] = Math.min(widestToken, BODY_WIDTH * 0.35);
  }
  for (const row of [head, ...rows]) {
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? "";
      const m = Math.min(
        measure(cell, bodyFontSize) + cellPaddingX * 2,
        BODY_WIDTH * 0.55,
      );
      if (m > idealWidths[i]!) idealWidths[i] = m;
    }
  }
  // Make sure ideal is never below min.
  for (let i = 0; i < colCount; i += 1) {
    if (idealWidths[i]! < minWidths[i]!) idealWidths[i] = minWidths[i]!;
  }

  let widths: number[];
  const sumMin = minWidths.reduce((a, b) => a + b, 0);
  if (sumMin >= BODY_WIDTH) {
    // Pathological: header labels alone exceed body width — scale
    // them down to fit.
    widths = minWidths.map((m) => (m / sumMin) * BODY_WIDTH);
  } else {
    const extras = idealWidths.map((ideal, i) => ideal - minWidths[i]!);
    const extraTotal = extras.reduce((a, b) => a + b, 0);
    const slack = BODY_WIDTH - sumMin;
    if (extraTotal === 0) {
      // All columns are already at their min; distribute slack
      // uniformly so the table fills the body width.
      widths = minWidths.map((m) => m + slack / colCount);
    } else {
      widths = minWidths.map((m, i) => m + (extras[i]! / extraTotal) * slack);
    }
  }

  // ---- Drawing ---------------------------------------------------------
  let y = input.startY;

  const drawRow = (
    cells: ReadonlyArray<string>,
    options: { bold: boolean; underline: boolean },
  ): void => {
    const fontSize = options.bold ? headFontSize : bodyFontSize;
    const font = options.bold ? ("F2" as const) : ("F1" as const);
    // Wrap every cell to its column width minus padding.
    const wrappedPerCell: string[][] = cells.map((cell, i) => {
      const w = widths[i]! - cellPaddingX * 2;
      return wrapToWidth(cell, fontSize, Math.max(20, w));
    });
    const maxLines = wrappedPerCell.reduce(
      (m, lines) => Math.max(m, lines.length),
      1,
    );
    const rowHeight = maxLines * lineHeight + rowPaddingY * 2;

    if (y - rowHeight < minY) {
      y = onPageBreak();
    }

    // Draw the cells at the same baseline grid.
    let cursorX = x;
    for (let colIdx = 0; colIdx < colCount; colIdx += 1) {
      const lines = wrappedPerCell[colIdx] ?? [];
      let lineY = y - rowPaddingY - fontSize;
      for (const line of lines) {
        doc.emit(
          text(line, cursorX + cellPaddingX, lineY, {
            size: fontSize,
            font,
            color: COLOR_TEXT_DARK,
          }),
        );
        lineY -= lineHeight;
      }
      cursorX += widths[colIdx]!;
    }
    y -= rowHeight;
    if (options.underline) {
      doc.emit(
        drawLine(x, y + 2, x + BODY_WIDTH, y + 2, COLOR_GREEN_ACCENT, 0.8),
      );
      y -= 2;
    } else {
      doc.emit(drawLine(x, y + 1, x + BODY_WIDTH, y + 1, COLOR_RULE, 0.3));
      y -= 1;
    }
  };

  drawRow(head, { bold: true, underline: true });
  for (const row of rows) {
    drawRow(row, { bold: false, underline: false });
  }
  // Trailing breath after the table.
  y -= 6;
  return y;
};

/* -------------------------------------------------------------------------- */
/*  Text wrapping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Wrap `s` to fit `maxWidth` PDF points at the given font size,
 * measured against the Helvetica advance-width table. Helvetica and
 * Helvetica-Bold are within ±5 % at the sizes we use, so a single
 * measurement table suffices and the wrapper does not branch on
 * font weight.
 */
const wrapToWidth = (s: string, size: number, maxWidth: number): string[] => {
  if (s.length === 0) return [""];
  const out: string[] = [];
  const words = s.split(/\s+/u);
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (measure(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      out.push(current);
      current = "";
    }
    // Word itself longer than line: hard-slice on character boundaries.
    if (measure(word, size) > maxWidth) {
      let slice = "";
      for (const ch of word) {
        const candidate2 = slice + ch;
        if (measure(candidate2, size) > maxWidth) {
          out.push(slice);
          slice = ch;
        } else {
          slice = candidate2;
        }
      }
      current = slice;
    } else {
      current = word;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
};

/* -------------------------------------------------------------------------- */
/*  PNG decoding                                                               */
/* -------------------------------------------------------------------------- */

interface DecodedPng {
  readonly width: number;
  readonly height: number;
  /** Tightly packed RGB triples (height × width × 3). */
  readonly pixels: Buffer;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const decodePngToRgb = (pngBytes: Buffer): DecodedPng => {
  if (pngBytes.length < 8 || !pngBytes.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("decodePngToRgb: not a PNG file (signature mismatch)");
  }
  let cursor = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (cursor < pngBytes.length) {
    // A PNG chunk is `[length(4) | type(4) | data(length) | crc(4)]`.
    // Guard each read so a truncated or hand-crafted PNG raises a
    // deterministic decoder error instead of a Node-internal
    // RangeError / silent partial read.
    if (cursor + 8 > pngBytes.length) {
      throw new Error(
        "decodePngToRgb: PNG chunk header runs past end of buffer",
      );
    }
    const length = pngBytes.readUInt32BE(cursor);
    if (length > pngBytes.length - cursor - 12) {
      throw new Error(
        `decodePngToRgb: PNG chunk length ${length} exceeds remaining buffer`,
      );
    }
    const type = pngBytes.subarray(cursor + 4, cursor + 8).toString("ascii");
    const data = pngBytes.subarray(cursor + 8, cursor + 8 + length);
    cursor += 12 + length; // skip CRC
    if (type === "IHDR") {
      if (data.length < 13) {
        throw new Error("decodePngToRgb: IHDR chunk shorter than 13 bytes");
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
      if (bitDepth !== 8) {
        throw new Error(
          `decodePngToRgb: only 8-bit depth supported (got ${bitDepth})`,
        );
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(
          `decodePngToRgb: only color_type 2 (RGB) and 6 (RGBA) supported (got ${colorType})`,
        );
      }
      if (interlace !== 0) {
        throw new Error("decodePngToRgb: interlaced PNGs not supported");
      }
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (idatChunks.length === 0) {
    throw new Error("decodePngToRgb: no IDAT chunks found");
  }
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const expectedSize = (stride + 1) * height;
  if (inflated.length !== expectedSize) {
    throw new Error(
      `decodePngToRgb: unexpected scanline buffer size (${inflated.length} vs ${expectedSize})`,
    );
  }
  /* Un-filter row by row. */
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[row * (stride + 1)]!;
    const inRow = inflated.subarray(
      row * (stride + 1) + 1,
      row * (stride + 1) + 1 + stride,
    );
    const outRow = raw.subarray(row * stride, (row + 1) * stride);
    const prevRow =
      row === 0 ? undefined : raw.subarray((row - 1) * stride, row * stride);
    unfilterScanline(filterType, inRow, outRow, prevRow, bpp);
  }
  /* Strip alpha if present — for cover-quality reproduction we
     compose against white (simplest, deterministic). */
  if (colorType === 6) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      const r = raw[i * 4]!;
      const g = raw[i * 4 + 1]!;
      const b = raw[i * 4 + 2]!;
      const a = raw[i * 4 + 3]! / 255;
      rgb[i * 3] = Math.round(r * a + 255 * (1 - a));
      rgb[i * 3 + 1] = Math.round(g * a + 255 * (1 - a));
      rgb[i * 3 + 2] = Math.round(b * a + 255 * (1 - a));
    }
    return { width, height, pixels: rgb };
  }
  return { width, height, pixels: raw };
};

const unfilterScanline = (
  filterType: number,
  inRow: Buffer,
  outRow: Buffer,
  prevRow: Buffer | undefined,
  bpp: number,
): void => {
  const stride = inRow.length;
  switch (filterType) {
    case 0: // None
      inRow.copy(outRow);
      return;
    case 1: // Sub
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? outRow[i - bpp]! : 0;
        outRow[i] = (inRow[i]! + left) & 0xff;
      }
      return;
    case 2: // Up
      for (let i = 0; i < stride; i += 1) {
        const up = prevRow === undefined ? 0 : prevRow[i]!;
        outRow[i] = (inRow[i]! + up) & 0xff;
      }
      return;
    case 3: // Average
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? outRow[i - bpp]! : 0;
        const up = prevRow === undefined ? 0 : prevRow[i]!;
        outRow[i] = (inRow[i]! + Math.floor((left + up) / 2)) & 0xff;
      }
      return;
    case 4: // Paeth
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bpp ? outRow[i - bpp]! : 0;
        const up = prevRow === undefined ? 0 : prevRow[i]!;
        const upLeft =
          i >= bpp && prevRow !== undefined ? prevRow[i - bpp]! : 0;
        outRow[i] = (inRow[i]! + paeth(left, up, upLeft)) & 0xff;
      }
      return;
    default:
      throw new Error(
        `unfilterScanline: unknown PNG filter type ${filterType}`,
      );
  }
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/**
 * Reduce a decoded RGB image so the longer edge is at most `maxLongEdge`.
 * Nearest-neighbour sampling — deterministic and dependency-free; quality
 * is more than enough for a PDF preview at 72 dpi.
 */
const downsampleRgb = (img: DecodedPng, maxLongEdge: number): DecodedPng => {
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= maxLongEdge) return img;
  const scale = maxLongEdge / longEdge;
  const newW = Math.max(1, Math.round(img.width * scale));
  const newH = Math.max(1, Math.round(img.height * scale));
  const out = Buffer.alloc(newW * newH * 3);
  for (let y = 0; y < newH; y += 1) {
    const srcY = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < newW; x += 1) {
      const srcX = Math.min(img.width - 1, Math.floor(x / scale));
      const srcIdx = (srcY * img.width + srcX) * 3;
      const dstIdx = (y * newW + x) * 3;
      out[dstIdx] = img.pixels[srcIdx]!;
      out[dstIdx + 1] = img.pixels[srcIdx + 1]!;
      out[dstIdx + 2] = img.pixels[srcIdx + 2]!;
    }
  }
  return { width: newW, height: newH, pixels: out };
};
