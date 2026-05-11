/**
 * Customer-Markdown PDF bundle.
 *
 * Sibling to `customer-markdown-zip.ts` — produces a deterministic,
 * byte-stable PDF rendering of the same customer artefacts under
 * `<artifactDir>/customer-markdown/testfaelle.pdf`.
 *
 * The PDF encoder is hand-rolled (zero runtime deps — workspace-dev
 * forbids them). It emits a minimal PDF 1.4 file with:
 *
 *   - one Catalog object
 *   - one Pages tree
 *   - one Page object per laid-out page (A4, 595×842 pt)
 *   - one Font resource (standard Type-1 Helvetica, no embedding)
 *   - one content stream per page (BT/ET, Helvetica 11 pt)
 *
 * Byte-stability invariants (identical inputs → byte-identical bytes):
 *
 *   - no `/CreationDate`, no `/ModDate`, no `/ID` array
 *   - no random object numbers — assigned in a fixed order
 *   - xref offsets are computed from the actual serialized chunk
 *     lengths, so any non-determinism in upstream input would show up
 *     as a stable diff, never as random byte drift
 *
 * Production wiring:
 *
 *   The renderer takes a generic `sections` list of {heading, body}
 *   pairs. The production-runner passes three sections today:
 *   combined `testfaelle.md`, `JIRA_STORY.md` content extracted from a
 *   `customContextMarkdown` `## JIRA_STORY` heading (placeholder text
 *   otherwise), and `Screen Shots der Maske` SHA-256 references for
 *   captured screens (placeholder otherwise).
 *
 *   Raw screenshot bytes are NEVER embedded. The PDF only carries
 *   text references, preserving the hard invariant asserted by
 *   `eingabemasken-fixtures.test.ts` / `baseline-fixtures.test.ts`.
 */

/** Single content block. Rendered as a heading line followed by the body. */
export interface CustomerMarkdownPdfSection {
  readonly heading: string;
  readonly body: string;
}

/** Inputs needed to build the PDF buffer. */
export interface CustomerMarkdownPdfInput {
  readonly title: string;
  readonly sections: ReadonlyArray<CustomerMarkdownPdfSection>;
}

/* -------------------------------------------------------------------------- */
/*  Layout constants                                                          */
/* -------------------------------------------------------------------------- */

/** A4 page width in points. */
const PAGE_WIDTH = 595;
/** A4 page height in points. */
const PAGE_HEIGHT = 842;
/** Left/right/top/bottom margin in points. */
const MARGIN = 50;
/** Body font size in points. */
const BODY_FONT_SIZE = 11;
/** Heading font size in points (slightly larger; rendered same font). */
const HEADING_FONT_SIZE = 14;
/** Title font size at the top of the first page. */
const TITLE_FONT_SIZE = 18;
/** Line height (leading) in points. */
const LINE_HEIGHT = 14;
/**
 * Hard line-length cap in characters. Helvetica 11 pt averages ~5 pt
 * per character so 90 chars × ~5 pt = 450 pt, well under the 495 pt
 * usable width. Wrapping is greedy on word boundaries; long unbroken
 * tokens are sliced.
 */
const MAX_LINE_CHARS = 90;
/** Lines per page after the title/heading lines on the first page. */
const LINES_PER_PAGE = 50;

/* -------------------------------------------------------------------------- */
/*  Public entry point                                                        */
/* -------------------------------------------------------------------------- */

export const buildCustomerMarkdownPdf = (
  input: CustomerMarkdownPdfInput,
): Buffer => {
  if (input.sections.length === 0) {
    throw new Error("buildCustomerMarkdownPdf: sections must not be empty");
  }

  const pages = layoutPages(input);
  return encodePdf(pages);
};

/* -------------------------------------------------------------------------- */
/*  Section body helpers                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Extract the `## JIRA_STORY` (or `## JIRA Story`) section body from a
 * `customContextMarkdown` blob.
 *
 * Returns the trimmed body text of the matched section, or `undefined`
 * when:
 *   - the input is `undefined`
 *   - no matching heading exists
 *   - the section body is empty
 *
 * Heading match is case-insensitive on the keyword `JIRA_STORY` /
 * `JIRA STORY` / `JIRA Story` (underscore or single space), one to six
 * leading `#` characters. The body runs to the next heading at any
 * level, or to EOF.
 */
export const extractJiraStoryFromCustomContext = (
  customContextMarkdown: string | undefined,
): string | undefined => {
  if (customContextMarkdown === undefined) return undefined;
  const lines = customContextMarkdown.split("\n");
  const headingPattern = /^#{1,6}\s+(JIRA[_ ]STORY)\b/iu;
  const nextHeadingPattern = /^#{1,6}\s/u;

  let headingIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (headingPattern.test(lines[i]!)) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex < 0) return undefined;

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

/**
 * Build the body text of the `JIRA_STORY.md` section. When the
 * extracted story is `undefined`, returns a structured placeholder
 * that documents how to populate the section — never invents content.
 */
export const buildJiraStorySectionBody = (
  jiraStory: string | undefined,
): string => {
  if (jiraStory === undefined) {
    return [
      "(Keine JIRA-Story konfiguriert.)",
      "",
      "Inhalt einbinden: in `customContextMarkdown` eine Sektion mit",
      "Heading `## JIRA_STORY` oder `## JIRA Story` anlegen — der",
      "darunter stehende Markdown-Block wird in dieses PDF übernommen.",
    ].join("\n");
  }
  return jiraStory;
};

/** One screenshot reference. Only metadata — never the raw bytes. */
export interface ScreenshotReference {
  readonly screenId: string;
  readonly filename: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/**
 * Build the body text of the `Screen Shots der Maske` section. Lists
 * stable hash references (filename + byteLength + sha256), not raw
 * image bytes — this preserves the workspace-dev hard invariant
 * "customer artefacts never embed raw screenshots" enforced by
 * `eingabemasken-fixtures.test.ts:294` and
 * `baseline-fixtures.test.ts:189`.
 *
 * Output is byte-stable: references are sorted by `screenId` before
 * formatting, and identical inputs produce identical output bytes.
 */
export const buildScreenshotReferenceSectionBody = (
  references: ReadonlyArray<ScreenshotReference>,
): string => {
  if (references.length === 0) {
    return [
      "(Keine Maske-Screenshots erfasst.)",
      "",
      "Der figma-rest-Adapter erfasst Maske-Screenshots automatisch beim",
      "Lauf, sofern eine valide Figma-Quelle vorliegt. Ist die Erfassung",
      "übersprungen oder fehlgeschlagen, bleibt diese Liste leer.",
    ].join("\n");
  }
  const sorted = [...references].sort((a, b) =>
    a.screenId < b.screenId ? -1 : a.screenId > b.screenId ? 1 : 0,
  );
  const lines: string[] = [
    "Hinweis: Aus Audit-Gründen führt diese Sektion nur Hash-Referenzen,",
    "keine Roh-Bilddaten. Die referenzierten PNG-Dateien liegen im",
    "versiegelten Visual-Capture-Manifest des Laufs.",
    "",
  ];
  for (const ref of sorted) {
    lines.push(`Screen: ${ref.screenId}`);
    lines.push(`  Datei:   ${ref.filename}`);
    lines.push(`  Bytes:   ${ref.byteLength}`);
    lines.push(`  SHA-256: ${ref.sha256}`);
    lines.push("");
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.join("\n");
};

/* -------------------------------------------------------------------------- */
/*  Layout                                                                    */
/* -------------------------------------------------------------------------- */

interface LaidOutLine {
  readonly text: string;
  readonly fontSize: number;
}

const layoutPages = (input: CustomerMarkdownPdfInput): LaidOutLine[][] => {
  const allLines: LaidOutLine[] = [];

  allLines.push({ text: input.title, fontSize: TITLE_FONT_SIZE });
  allLines.push({ text: "", fontSize: BODY_FONT_SIZE });

  for (const section of input.sections) {
    allLines.push({ text: section.heading, fontSize: HEADING_FONT_SIZE });
    allLines.push({ text: "", fontSize: BODY_FONT_SIZE });
    for (const rawLine of section.body.split("\n")) {
      const wrapped = wrapLine(rawLine);
      for (const piece of wrapped) {
        allLines.push({ text: piece, fontSize: BODY_FONT_SIZE });
      }
    }
    allLines.push({ text: "", fontSize: BODY_FONT_SIZE });
  }

  const pages: LaidOutLine[][] = [];
  for (let i = 0; i < allLines.length; i += LINES_PER_PAGE) {
    pages.push(allLines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) {
    pages.push([]);
  }
  return pages;
};

const wrapLine = (line: string): string[] => {
  if (line.length <= MAX_LINE_CHARS) return [line];
  const out: string[] = [];
  const words = line.split(" ");
  let current = "";
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= MAX_LINE_CHARS) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      out.push(current);
      current = "";
    }
    if (word.length <= MAX_LINE_CHARS) {
      current = word;
    } else {
      for (let i = 0; i < word.length; i += MAX_LINE_CHARS) {
        const slice = word.slice(i, i + MAX_LINE_CHARS);
        if (slice.length === MAX_LINE_CHARS) {
          out.push(slice);
        } else {
          current = slice;
        }
      }
    }
  }
  if (current.length > 0) out.push(current);
  return out;
};

/* -------------------------------------------------------------------------- */
/*  PDF encoding                                                              */
/* -------------------------------------------------------------------------- */

const encodePdf = (pages: LaidOutLine[][]): Buffer => {
  /*
   * Object layout (fixed order, fixed numbers):
   *   1  Catalog
   *   2  Pages
   *   3  Font (Helvetica)
   *   4..(4 + 2*N - 1)  per page: Page object, then its Content stream
   */
  const fontObjNum = 3;
  const firstPageObjStart = 4;
  const pageObjNumbers: number[] = [];
  const contentObjNumbers: number[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    pageObjNumbers.push(firstPageObjStart + i * 2);
    contentObjNumbers.push(firstPageObjStart + i * 2 + 1);
  }
  const totalObjects = 3 + pages.length * 2;

  const kids = pageObjNumbers.map((n) => `${n} 0 R`).join(" ");

  const objectBodies: string[] = [];

  // 1: Catalog
  objectBodies.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  // 2: Pages tree
  objectBodies.push(
    `<< /Type /Pages /Kids [ ${kids} ] /Count ${pages.length} >>`,
  );
  // 3: Font
  objectBodies.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  );

  // Page + Content per page.
  for (let i = 0; i < pages.length; i += 1) {
    const pageObjNum = pageObjNumbers[i]!;
    const contentObjNum = contentObjNumbers[i]!;
    objectBodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT} ] ` +
        `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> ` +
        `/Contents ${contentObjNum} 0 R >>`,
    );
    objectBodies.push(buildContentStreamObject(pages[i]!));
    void pageObjNum;
  }

  return assembleFile(objectBodies, totalObjects);
};

const buildContentStreamObject = (lines: LaidOutLine[]): string => {
  // Build the content stream as raw bytes so WinAnsi-encoded text
  // round-trips byte-for-byte. The stream is the concatenation of:
  //
  //   BT
  //   /F1 <size> Tf
  //   <leading> TL
  //   <x> <y> Td
  //   ( <line1> ) Tj
  //   T*
  //   ( <line2> ) Tj
  //   ...
  //   ET
  //
  // We start each line on its own using Tj + T* so the line height
  // remains consistent regardless of empty lines.
  const x = MARGIN;
  const yStart = PAGE_HEIGHT - MARGIN;

  const chunks: Buffer[] = [];
  chunks.push(Buffer.from("BT\n", "binary"));
  chunks.push(Buffer.from(`${LINE_HEIGHT} TL\n`, "binary"));
  chunks.push(Buffer.from(`1 0 0 1 ${x} ${yStart} Tm\n`, "binary"));

  let currentFontSize = -1;
  for (const line of lines) {
    if (line.fontSize !== currentFontSize) {
      chunks.push(Buffer.from(`/F1 ${line.fontSize} Tf\n`, "binary"));
      currentFontSize = line.fontSize;
    }
    if (line.text.length === 0) {
      chunks.push(Buffer.from("T*\n", "binary"));
    } else {
      chunks.push(Buffer.from("(", "binary"));
      chunks.push(encodePdfString(line.text));
      chunks.push(Buffer.from(") Tj T*\n", "binary"));
    }
  }
  chunks.push(Buffer.from("ET\n", "binary"));

  const stream = Buffer.concat(chunks);
  // Wrap as a stream object. The PDF requires `/Length` to match the
  // byte length of the stream body (between `stream\n` and `\nendstream`).
  return (
    `<< /Length ${stream.length} >>\nstream\n` +
    stream.toString("binary") +
    `\nendstream`
  );
};

/**
 * Encode a text line as a PDF string literal body. Maps to
 * WinAnsiEncoding (Latin-1 superset) so standard Helvetica renders
 * the bytes correctly. Code points outside WinAnsi are substituted
 * with `?` rather than being emitted as multi-byte UTF-8 which would
 * render as garbage glyphs.
 *
 * Escapes the three special characters that must not appear raw in
 * a `( ... )` string literal: `\`, `(`, `)`.
 */
const encodePdfString = (text: string): Buffer => {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let mapped: number;
    if (code === 0x5c) {
      // backslash → escaped backslash
      out.push(0x5c, 0x5c);
      continue;
    }
    if (code === 0x28) {
      out.push(0x5c, 0x28);
      continue;
    }
    if (code === 0x29) {
      out.push(0x5c, 0x29);
      continue;
    }
    if (code <= 0xff) {
      // Latin-1 range maps directly to WinAnsiEncoding for the
      // overlapping subset (which covers ASCII, Latin-1 punctuation,
      // and the German Umlaute ä ö ü Ä Ö Ü ß). The few WinAnsi-only
      // glyphs in 0x80..0x9F (€, ‚, ƒ, …) are not produced by JS for
      // these code points, so direct mapping is safe.
      mapped = code;
    } else {
      mapped = mapWinAnsiSpecial(code);
    }
    out.push(mapped);
  }
  return Buffer.from(out);
};

/**
 * Handle the small set of code points that WinAnsiEncoding places in
 * the 0x80..0x9F slots (which are unused in Latin-1). For anything
 * else outside Latin-1 we substitute `?` to keep the bytes single-
 * width and renderable by built-in Helvetica.
 */
const mapWinAnsiSpecial = (code: number): number => {
  switch (code) {
    case 0x20ac:
      return 0x80; // €
    case 0x201a:
      return 0x82; // ‚
    case 0x0192:
      return 0x83; // ƒ
    case 0x201e:
      return 0x84; // „
    case 0x2026:
      return 0x85; // …
    case 0x2020:
      return 0x86; // †
    case 0x2021:
      return 0x87; // ‡
    case 0x02c6:
      return 0x88; // ˆ
    case 0x2030:
      return 0x89; // ‰
    case 0x0160:
      return 0x8a; // Š
    case 0x2039:
      return 0x8b; // ‹
    case 0x0152:
      return 0x8c; // Œ
    case 0x017d:
      return 0x8e; // Ž
    case 0x2018:
      return 0x91; // ‘
    case 0x2019:
      return 0x92; // ’
    case 0x201c:
      return 0x93; // “
    case 0x201d:
      return 0x94; // ”
    case 0x2022:
      return 0x95; // •
    case 0x2013:
      return 0x96; // –
    case 0x2014:
      return 0x97; // —
    case 0x02dc:
      return 0x98; // ˜
    case 0x2122:
      return 0x99; // ™
    case 0x0161:
      return 0x9a; // š
    case 0x203a:
      return 0x9b; // ›
    case 0x0153:
      return 0x9c; // œ
    case 0x017e:
      return 0x9e; // ž
    case 0x0178:
      return 0x9f; // Ÿ
    default:
      return 0x3f; // '?'
  }
};

const assembleFile = (objectBodies: string[], totalObjects: number): Buffer => {
  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let cursor = header.length;

  for (let i = 0; i < objectBodies.length; i += 1) {
    const objNum = i + 1;
    const block = Buffer.from(
      `${objNum} 0 obj\n${objectBodies[i]!}\nendobj\n`,
      "binary",
    );
    offsets.push(cursor);
    parts.push(block);
    cursor += block.length;
  }

  const xrefOffset = cursor;
  const xrefLines: string[] = [];
  xrefLines.push(`xref`);
  xrefLines.push(`0 ${totalObjects + 1}`);
  xrefLines.push(`0000000000 65535 f `);
  for (const off of offsets) {
    xrefLines.push(`${off.toString().padStart(10, "0")} 00000 n `);
  }
  const xref = Buffer.from(`${xrefLines.join("\n")}\n`, "binary");
  parts.push(xref);

  const trailer = Buffer.from(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    "binary",
  );
  parts.push(trailer);

  return Buffer.concat(parts);
};
