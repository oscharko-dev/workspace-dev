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
/*  Cover                                                                     */
/* -------------------------------------------------------------------------- */

const layoutCover = (doc: PdfDocument, input: BuildMappeInput): void => {
  doc.beginPage(false);
  // Full-bleed deep-green background.
  doc.emit(fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, COLOR_GREEN_DEEP));

  // Top eyebrow.
  const eyebrow = "PRÄSENTATIONSMAPPE · TESTFÄLLE";
  doc.emit(
    text(eyebrow, MARGIN_X, PAGE_HEIGHT - 200, {
      size: 11,
      color: [0.78, 0.92, 0.86],
    }),
  );

  // Title block — wrapped to two lines max.
  const titleLines = wrapToWidth(input.title, COVER_TITLE_SIZE, BODY_WIDTH);
  let titleY = PAGE_HEIGHT - 240;
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
  let subY = titleY - 16;
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

  let y = PAGE_HEIGHT - MARGIN_TOP - 44;
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
  y = renderMarkdown(
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
}

/**
 * Strip a small subset of inline Markdown so the PDF renderer can
 * lay out plain text without `**` clutter:
 *
 *   - `**foo**` → `foo`  (bold marker; rendered as regular weight today
 *     — true inline bold would require splitting the run, which the
 *     hand-rolled encoder does not do yet)
 *   - `*foo*`   → `foo`  (italic marker; same reason)
 *   - backtick-fenced inline code stays as `foo` literal
 *
 * The function only touches Markdown delimiters; the underlying
 * characters and spaces stay verbatim.
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
        out.push({ kind: "tablehead", text: joined });
      } else {
        out.push({ kind: "tablerow", text: joined });
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

  for (const block of blocks) {
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
    const length = pngBytes.readUInt32BE(cursor);
    const type = pngBytes.subarray(cursor + 4, cursor + 8).toString("ascii");
    const data = pngBytes.subarray(cursor + 8, cursor + 8 + length);
    cursor += 12 + length; // skip CRC
    if (type === "IHDR") {
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
