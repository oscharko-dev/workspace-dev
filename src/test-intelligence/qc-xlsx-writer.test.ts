import assert from "node:assert/strict";
import test from "node:test";
import type { QcMappingPreviewEntry } from "../contracts/index.js";
import { renderQcXlsx } from "./qc-xlsx-writer.js";
import { QC_CSV_COLUMNS } from "./qc-csv-writer.js";

const baseEntry = (
  overrides: Partial<QcMappingPreviewEntry>,
): QcMappingPreviewEntry => ({
  testCaseId: "tc-1",
  externalIdCandidate: "abc1234567890123",
  testName: "T",
  objective: "O",
  priority: "p1",
  riskCategory: "low",
  targetFolderPath: "/Subject/X/low",
  preconditions: [],
  testData: [],
  designSteps: [],
  expectedResults: [],
  sourceTraceRefs: [],
  exportable: true,
  blockingReasons: [],
  ...overrides,
});

const ZIP_LOCAL_HEADER_SIG = 0x04034b50;
const ZIP_CENTRAL_DIR_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

interface ParsedEntry {
  filename: string;
  size: number;
  crc32: number;
  bytes: Uint8Array;
}

const readUInt16LE = (buf: Uint8Array, offset: number): number =>
  (buf[offset] as number) | ((buf[offset + 1] as number) << 8);

const readUInt32LE = (buf: Uint8Array, offset: number): number =>
  ((buf[offset] as number) |
    ((buf[offset + 1] as number) << 8) |
    ((buf[offset + 2] as number) << 16) |
    ((buf[offset + 3] as number) << 24)) >>>
  0;

const parseZip = (bytes: Uint8Array): ParsedEntry[] => {
  let offset = 0;
  const entries: ParsedEntry[] = [];
  while (offset + 4 <= bytes.length) {
    const sig = readUInt32LE(bytes, offset);
    if (sig !== ZIP_LOCAL_HEADER_SIG) break;
    const compressionMethod = readUInt16LE(bytes, offset + 8);
    assert.equal(compressionMethod, 0, "expected stored compression");
    const crc = readUInt32LE(bytes, offset + 14);
    const compressedSize = readUInt32LE(bytes, offset + 18);
    const uncompressedSize = readUInt32LE(bytes, offset + 22);
    assert.equal(compressedSize, uncompressedSize);
    const nameLen = readUInt16LE(bytes, offset + 26);
    const extraLen = readUInt16LE(bytes, offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const filename = new TextDecoder().decode(
      bytes.slice(nameStart, nameStart + nameLen),
    );
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.push({
      filename,
      size: uncompressedSize,
      crc32: crc,
      bytes: data,
    });
    offset = dataStart + compressedSize;
  }
  // Validate central directory + EOCD presence.
  const centralStart = offset;
  let centralEntries = 0;
  while (offset + 4 <= bytes.length) {
    const sig = readUInt32LE(bytes, offset);
    if (sig !== ZIP_CENTRAL_DIR_SIG) break;
    centralEntries += 1;
    const nameLen = readUInt16LE(bytes, offset + 28);
    const extraLen = readUInt16LE(bytes, offset + 30);
    const commentLen = readUInt16LE(bytes, offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  assert.equal(centralEntries, entries.length);
  assert.ok(centralStart >= 0);

  // EOCD signature in tail.
  const eocdSig = readUInt32LE(bytes, offset);
  assert.equal(eocdSig, ZIP_EOCD_SIG);

  return entries;
};

test("xlsx: produces a valid zip with the expected entries", () => {
  const buffer = renderQcXlsx([baseEntry({})]);
  const entries = parseZip(new Uint8Array(buffer));
  const filenames = entries.map((e) => e.filename).sort();
  assert.deepEqual(filenames, [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
  ]);
});

test("xlsx: deterministic byte output across two runs with same input", () => {
  const a = renderQcXlsx([
    baseEntry({ testCaseId: "z" }),
    baseEntry({ testCaseId: "a" }),
  ]);
  const b = renderQcXlsx([
    baseEntry({ testCaseId: "a" }),
    baseEntry({ testCaseId: "z" }),
  ]);
  assert.equal(a.equals(b), true);
});

test("xlsx: header row contains every CSV column in declared order", () => {
  const buffer = renderQcXlsx([baseEntry({})]);
  const entries = parseZip(new Uint8Array(buffer));
  const sheet = entries.find((e) => e.filename === "xl/worksheets/sheet1.xml");
  assert.ok(sheet);
  if (!sheet) return;
  const sheetXml = new TextDecoder().decode(sheet.bytes);
  for (const column of QC_CSV_COLUMNS) {
    assert.ok(
      sheetXml.includes(`<t xml:space="preserve">${column}</t>`),
      `header missing column ${column}`,
    );
  }
});

test("xlsx: workbook contains a single sheet named TestCases", () => {
  const buffer = renderQcXlsx([baseEntry({})]);
  const entries = parseZip(new Uint8Array(buffer));
  const wb = entries.find((e) => e.filename === "xl/workbook.xml");
  assert.ok(wb);
  if (!wb) return;
  const wbXml = new TextDecoder().decode(wb.bytes);
  assert.match(wbXml, /<sheet name="TestCases"/);
});

test("xlsx: per-entry CRC-32 is non-zero (byte content guard)", () => {
  const buffer = renderQcXlsx([baseEntry({})]);
  const entries = parseZip(new Uint8Array(buffer));
  for (const entry of entries) {
    assert.notEqual(entry.crc32, 0);
  }
});
