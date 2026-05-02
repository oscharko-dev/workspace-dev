/**
 * Minimal OOXML xlsx writer for QC export (Issue #1365).
 *
 * Hand-rolled, zero-runtime-dependency. Emits a deterministic .xlsx
 * Buffer composed of an OOXML zip with:
 *
 *   - `[Content_Types].xml`
 *   - `_rels/.rels`
 *   - `xl/workbook.xml`
 *   - `xl/_rels/workbook.xml.rels`
 *   - `xl/worksheets/sheet1.xml`
 *
 * The zip uses the **stored** (uncompressed) method to keep output
 * byte-identical across Node releases that bundle different zlib
 * versions. CRC-32 is hand-computed per entry. DOS time/date are fixed
 * to 1980-01-01 00:00:00 to keep output byte-identical across runs.
 *
 * The workbook contains a single worksheet named `TestCases` with the
 * same column order as the CSV writer. All cells use inline strings
 * (`<is><t>...</t></is>`); no shared-strings table is emitted, which
 * trades a small file-size hit for byte-determinism and
 * implementation simplicity.
 *
 * The writer is best-effort: it succeeds for any well-formed input
 * Excel will accept. Operators that need richer formatting should
 * post-process the artifact via their own tooling.
 */

import type {
  GeneratedTestCaseStep,
  QcMappingPreviewEntry,
} from "../contracts/index.js";
import { QC_CSV_COLUMNS } from "./qc-csv-writer.js";

// CRC-32 (IEEE 802.3) implementation. Hand-rolled to avoid relying on
// any platform-specific zlib helper.
const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const idx = (crc ^ (bytes[i] as number)) & 0xff;
    crc = (CRC32_TABLE[idx] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

interface ZipEntry {
  filename: string;
  content: Uint8Array;
  crc32: number;
  size: number;
  /** Absolute byte offset of this entry's local file header. */
  localHeaderOffset: number;
}

const utf8Encoder = new TextEncoder();
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x21; // 1980-01-01: ((1980-1980)<<9) | (1<<5) | 1 = 0x21

const writeUInt16LE = (
  buf: Uint8Array,
  offset: number,
  value: number,
): void => {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
};

const writeUInt32LE = (
  buf: Uint8Array,
  offset: number,
  value: number,
): void => {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
};

const buildLocalFileHeader = (
  entry: ZipEntry,
  nameBytes: Uint8Array,
): Uint8Array => {
  const header = new Uint8Array(30);
  writeUInt32LE(header, 0, 0x04034b50); // local file header signature
  writeUInt16LE(header, 4, 20); // version needed to extract
  writeUInt16LE(header, 6, 0); // general purpose bit flag
  writeUInt16LE(header, 8, 0); // compression method = stored
  writeUInt16LE(header, 10, FIXED_DOS_TIME);
  writeUInt16LE(header, 12, FIXED_DOS_DATE);
  writeUInt32LE(header, 14, entry.crc32);
  writeUInt32LE(header, 18, entry.size);
  writeUInt32LE(header, 22, entry.size);
  writeUInt16LE(header, 26, nameBytes.length);
  writeUInt16LE(header, 28, 0); // extra field length
  return header;
};

const buildCentralDirHeader = (
  entry: ZipEntry,
  nameBytes: Uint8Array,
): Uint8Array => {
  const header = new Uint8Array(46);
  writeUInt32LE(header, 0, 0x02014b50); // central dir signature
  writeUInt16LE(header, 4, 20); // version made by
  writeUInt16LE(header, 6, 20); // version needed to extract
  writeUInt16LE(header, 8, 0); // general purpose bit flag
  writeUInt16LE(header, 10, 0); // compression method
  writeUInt16LE(header, 12, FIXED_DOS_TIME);
  writeUInt16LE(header, 14, FIXED_DOS_DATE);
  writeUInt32LE(header, 16, entry.crc32);
  writeUInt32LE(header, 20, entry.size);
  writeUInt32LE(header, 24, entry.size);
  writeUInt16LE(header, 28, nameBytes.length);
  writeUInt16LE(header, 30, 0); // extra field length
  writeUInt16LE(header, 32, 0); // file comment length
  writeUInt16LE(header, 34, 0); // disk number start
  writeUInt16LE(header, 36, 0); // internal file attributes
  writeUInt32LE(header, 38, 0); // external file attributes
  writeUInt32LE(header, 42, entry.localHeaderOffset);
  return header;
};

const buildEocd = (input: {
  centralDirSize: number;
  centralDirOffset: number;
  entryCount: number;
}): Uint8Array => {
  const eocd = new Uint8Array(22);
  writeUInt32LE(eocd, 0, 0x06054b50);
  writeUInt16LE(eocd, 4, 0); // disk number
  writeUInt16LE(eocd, 6, 0); // disk with central dir
  writeUInt16LE(eocd, 8, input.entryCount);
  writeUInt16LE(eocd, 10, input.entryCount);
  writeUInt32LE(eocd, 12, input.centralDirSize);
  writeUInt32LE(eocd, 16, input.centralDirOffset);
  writeUInt16LE(eocd, 20, 0); // zip file comment length
  return eocd;
};

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
};

const buildZip = (
  entries: readonly { filename: string; content: Uint8Array }[],
): Uint8Array => {
  const localChunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const finalEntries: ZipEntry[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = utf8Encoder.encode(entry.filename);
    const populated: ZipEntry = {
      filename: entry.filename,
      content: entry.content,
      crc32: crc32(entry.content),
      size: entry.content.length,
      localHeaderOffset: offset,
    };
    finalEntries.push(populated);
    const header = buildLocalFileHeader(populated, nameBytes);
    localChunks.push(header, nameBytes, entry.content);
    offset += header.length + nameBytes.length + entry.content.length;
  }
  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const populated of finalEntries) {
    const nameBytes = utf8Encoder.encode(populated.filename);
    const header = buildCentralDirHeader(populated, nameBytes);
    central.push(header, nameBytes);
    centralDirSize += header.length + nameBytes.length;
  }
  const eocd = buildEocd({
    centralDirSize,
    centralDirOffset,
    entryCount: finalEntries.length,
  });

  return concat([...localChunks, ...central, eocd]);
};

/**
 * Issue #1664 (audit-2026-05): CSV/Spreadsheet Formula Injection (CWE-1236)
 * defence. A cell value whose first non-whitespace character is `=`, `+`,
 * `-`, `@`, `\t` or `\r` is interpreted as a formula by Excel,
 * LibreOffice Calc, Google Sheets, and several CSV-round-trip importers.
 * The OOXML escape is to prefix the value with a single quote (`'`),
 * which forces the cell to be treated as a literal string.
 *
 * We apply this BEFORE XML escaping so the leading `'` is preserved
 * literally in the inline string. The single quote itself does not
 * require XML escaping.
 */
const FORMULA_LEADER_RE = /^[=+\-@\t\r]/;
export const neutralizeFormulaLeading = (value: string): string => {
  // Trim leading whitespace for the leader check but keep the original
  // value otherwise — operators may legitimately start a description with
  // " - bullet" (space before dash). Only flag actual leading control or
  // formula prefixes.
  if (value.length === 0) return value;
  if (FORMULA_LEADER_RE.test(value)) {
    return `'${value}`;
  }
  return value;
};

const escapeXml = (value: string): string =>
  neutralizeFormulaLeading(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const columnLetter = (oneBased: number): string => {
  let n = oneBased;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
};

const buildContentTypesXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `</Types>`;

const buildRootRelsXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const buildWorkbookXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets>` +
  `<sheet name="TestCases" sheetId="1" r:id="rId1"/>` +
  `</sheets>` +
  `</workbook>`;

const buildWorkbookRelsXml = (): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `</Relationships>`;

const buildSheetXml = (rows: readonly string[][]): string => {
  let body = "";
  for (let r = 0; r < rows.length; r += 1) {
    const rowNum = r + 1;
    const cells = rows[r] ?? [];
    let rowBody = "";
    for (let c = 0; c < cells.length; c += 1) {
      const ref = `${columnLetter(c + 1)}${rowNum}`;
      const value = cells[c] ?? "";
      rowBody += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }
    body += `<row r="${rowNum}">${rowBody}</row>`;
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData>` +
    `</worksheet>`
  );
};

const formatStepCell = (
  step: GeneratedTestCaseStep,
  field: "index" | "action" | "data" | "expected",
): string => {
  if (field === "index") return String(step.index);
  if (field === "action") return step.action;
  if (field === "data") return step.data ?? "";
  return step.expected ?? "";
};

const buildRowsForEntry = (entry: QcMappingPreviewEntry): string[][] => {
  const visualDeployment = entry.visualProvenance?.deployment ?? "none";
  const visualFallback = entry.visualProvenance?.fallbackReason ?? "none";
  const visualConfidenceMean =
    entry.visualProvenance?.confidenceMean !== undefined
      ? entry.visualProvenance.confidenceMean.toFixed(6)
      : "0.000000";
  const visualAmbiguityCount =
    entry.visualProvenance?.ambiguityCount !== undefined
      ? String(entry.visualProvenance.ambiguityCount)
      : "0";
  const visualEvidenceHash = entry.visualProvenance?.evidenceHash ?? "";

  const baseCells = (step?: GeneratedTestCaseStep): string[] => [
    entry.testCaseId,
    entry.externalIdCandidate,
    entry.testName,
    entry.objective,
    entry.priority,
    entry.riskCategory,
    entry.targetFolderPath,
    entry.preconditions.join(" | "),
    entry.testData.join(" | "),
    entry.expectedResults.join(" | "),
    step ? formatStepCell(step, "index") : "",
    step ? formatStepCell(step, "action") : "",
    step ? formatStepCell(step, "data") : "",
    step ? formatStepCell(step, "expected") : "",
    visualDeployment,
    visualFallback,
    visualConfidenceMean,
    visualAmbiguityCount,
    visualEvidenceHash,
  ];

  if (entry.designSteps.length === 0) return [baseCells()];
  return entry.designSteps
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((step) => baseCells(step));
};

/** Render the QC mapping preview entries as a deterministic .xlsx Buffer. */
export const renderQcXlsx = (
  entries: readonly QcMappingPreviewEntry[],
): Buffer => {
  const rows: string[][] = [];
  rows.push([...QC_CSV_COLUMNS]);
  const sorted = entries
    .slice()
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  for (const entry of sorted) {
    for (const row of buildRowsForEntry(entry)) {
      rows.push(row);
    }
  }
  const sheetXml = buildSheetXml(rows);
  const zip = buildZip([
    {
      filename: "[Content_Types].xml",
      content: utf8Encoder.encode(buildContentTypesXml()),
    },
    {
      filename: "_rels/.rels",
      content: utf8Encoder.encode(buildRootRelsXml()),
    },
    {
      filename: "xl/workbook.xml",
      content: utf8Encoder.encode(buildWorkbookXml()),
    },
    {
      filename: "xl/_rels/workbook.xml.rels",
      content: utf8Encoder.encode(buildWorkbookRelsXml()),
    },
    {
      filename: "xl/worksheets/sheet1.xml",
      content: utf8Encoder.encode(sheetXml),
    },
  ]);
  return Buffer.from(zip);
};
