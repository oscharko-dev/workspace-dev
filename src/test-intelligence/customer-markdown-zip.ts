/**
 * Customer-Markdown ZIP bundle (Issue #1747).
 *
 * Builds a deterministic ZIP containing the combined `testfaelle.md`,
 * each per-case file, the derived business-intent IR, the evidence
 * manifest (when present), and a `regulatoryRelevance-summary.json`
 * machine-readable rollup.
 *
 * The ZIP encoder is hand-rolled (zero runtime deps — workspace-dev
 * forbids them). It writes:
 *
 *   - one Local File Header per entry
 *   - one Central Directory Header per entry
 *   - one End-of-Central-Directory record
 *
 * Compression is `stored` (method 0). The customer artifacts are tiny
 * (≤ ~50 KiB total for a typical banking-form run) and stored avoids
 * pulling in a deflate dependency or hand-rolling DEFLATE. Byte stability
 * is guaranteed: same inputs → byte-identical ZIP (no timestamps from
 * `Date.now()`, no random padding) so a reviewer can diff two bundles
 * with `cmp`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./content-hash.js";
import type { GeneratedTestCaseList } from "../contracts/index.js";

/**
 * Fixed DOS date/time embedded in every ZIP entry. Using a constant
 * (rather than the file's mtime) is what makes the bundle byte-stable
 * for identical inputs.
 *
 * 2026-01-01 00:00:00 local — encoded per the ZIP spec as:
 *   date = ((year - 1980) << 9) | (month << 5) | day
 *   time = (hour << 11) | (minute << 5) | (seconds / 2)
 */
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const FIXED_DOS_TIME = 0;

/** ZIP local file header signature. */
const SIG_LOCAL_FILE_HEADER = 0x04034b50;
/** ZIP central directory header signature. */
const SIG_CENTRAL_DIRECTORY = 0x02014b50;
/** ZIP end-of-central-directory record signature. */
const SIG_END_OF_CENTRAL_DIR = 0x06054b50;

/** Inputs needed to assemble a customer-markdown ZIP bundle. */
export interface CustomerMarkdownZipBundle {
  /** Job id used in archive filenames. */
  jobId: string;
  /** Combined Markdown body. */
  combinedMarkdown: string;
  /** Per-case Markdown entries (filename → body). */
  perCase: ReadonlyArray<{ filename: string; body: string }>;
  /** Derived business-intent IR JSON body (already canonicalised). */
  businessIntentIrJson: string;
  /** Optional evidence manifest JSON body (canonicalised). */
  evidenceManifestJson?: string;
  /** Machine-readable regulatoryRelevance summary JSON body. */
  regulatoryRelevanceSummaryJson: string;
}

/**
 * Single entry to embed in the ZIP archive. Not exported — the caller
 * constructs `CustomerMarkdownZipBundle`, the encoder builds entries
 * from it.
 */
interface ZipEntry {
  filename: string;
  body: Buffer;
  crc32: number;
}

/**
 * CRC32 lookup table, computed lazily.
 */
let crc32Table: Uint32Array | undefined;

const buildCrc32Table = (): Uint32Array => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
};

/** Compute CRC32 over a Buffer. */
const crc32 = (data: Buffer): number => {
  if (crc32Table === undefined) {
    crc32Table = buildCrc32Table();
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = (crc32Table[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * Build a deterministic ZIP archive from the bundle inputs. Returns a
 * `Buffer` ready to write to a response stream. Byte-stable: same
 * inputs always produce the same output.
 */
export const buildCustomerMarkdownZipBundle = (
  bundle: CustomerMarkdownZipBundle,
): Buffer => {
  const entries = collectEntries(bundle);
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const localHeader = encodeLocalFileHeader(entry);
    const centralHeader = encodeCentralDirectoryHeader(entry, offset);
    localChunks.push(localHeader, entry.body);
    centralChunks.push(centralHeader);
    offset += localHeader.length + entry.body.length;
  }
  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = encodeEndOfCentralDirectory({
    totalEntries: entries.length,
    centralDirectorySize: centralDirectory.length,
    centralDirectoryOffset: offset,
  });
  return Buffer.concat([...localChunks, centralDirectory, eocd]);
};

/**
 * Convert the bundle's logical inputs into the ordered list of ZIP
 * entries. Order is deterministic (sorted by filename) so the encoder
 * always produces the same bytes.
 */
const collectEntries = (bundle: CustomerMarkdownZipBundle): ZipEntry[] => {
  const raw: { filename: string; body: Buffer }[] = [];
  raw.push({
    filename: "testfaelle.md",
    body: Buffer.from(bundle.combinedMarkdown, "utf8"),
  });
  for (const file of bundle.perCase) {
    raw.push({
      filename: `cases/${file.filename}`,
      body: Buffer.from(file.body, "utf8"),
    });
  }
  raw.push({
    filename: "business-intent-ir.json",
    body: Buffer.from(bundle.businessIntentIrJson, "utf8"),
  });
  if (bundle.evidenceManifestJson !== undefined) {
    raw.push({
      filename: "evidence-manifest.json",
      body: Buffer.from(bundle.evidenceManifestJson, "utf8"),
    });
  }
  raw.push({
    filename: "regulatoryRelevance-summary.json",
    body: Buffer.from(bundle.regulatoryRelevanceSummaryJson, "utf8"),
  });
  raw.sort((a, b) => (a.filename < b.filename ? -1 : 1));
  return raw.map((entry) => ({
    filename: entry.filename,
    body: entry.body,
    crc32: crc32(entry.body),
  }));
};

const encodeLocalFileHeader = (entry: ZipEntry): Buffer => {
  const filenameBuf = Buffer.from(entry.filename, "utf8");
  const buf = Buffer.alloc(30 + filenameBuf.length);
  buf.writeUInt32LE(SIG_LOCAL_FILE_HEADER, 0);
  buf.writeUInt16LE(20, 4); // version needed
  buf.writeUInt16LE(0x0800, 6); // bit 11 = UTF-8 filenames
  buf.writeUInt16LE(0, 8); // method = stored
  buf.writeUInt16LE(FIXED_DOS_TIME, 10);
  buf.writeUInt16LE(FIXED_DOS_DATE, 12);
  buf.writeUInt32LE(entry.crc32, 14);
  buf.writeUInt32LE(entry.body.length, 18); // compressed size
  buf.writeUInt32LE(entry.body.length, 22); // uncompressed size
  buf.writeUInt16LE(filenameBuf.length, 26);
  buf.writeUInt16LE(0, 28); // extra field length
  filenameBuf.copy(buf, 30);
  return buf;
};

const encodeCentralDirectoryHeader = (
  entry: ZipEntry,
  localHeaderOffset: number,
): Buffer => {
  const filenameBuf = Buffer.from(entry.filename, "utf8");
  const buf = Buffer.alloc(46 + filenameBuf.length);
  buf.writeUInt32LE(SIG_CENTRAL_DIRECTORY, 0);
  buf.writeUInt16LE(20, 4); // version made by
  buf.writeUInt16LE(20, 6); // version needed
  buf.writeUInt16LE(0x0800, 8); // bit 11 = UTF-8 filenames
  buf.writeUInt16LE(0, 10); // method = stored
  buf.writeUInt16LE(FIXED_DOS_TIME, 12);
  buf.writeUInt16LE(FIXED_DOS_DATE, 14);
  buf.writeUInt32LE(entry.crc32, 16);
  buf.writeUInt32LE(entry.body.length, 20);
  buf.writeUInt32LE(entry.body.length, 24);
  buf.writeUInt16LE(filenameBuf.length, 28);
  buf.writeUInt16LE(0, 30); // extra field length
  buf.writeUInt16LE(0, 32); // file comment length
  buf.writeUInt16LE(0, 34); // disk number start
  buf.writeUInt16LE(0, 36); // internal attrs
  buf.writeUInt32LE(0, 38); // external attrs
  buf.writeUInt32LE(localHeaderOffset, 42);
  filenameBuf.copy(buf, 46);
  return buf;
};

interface EocdInput {
  totalEntries: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
}

const encodeEndOfCentralDirectory = (input: EocdInput): Buffer => {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(SIG_END_OF_CENTRAL_DIR, 0);
  buf.writeUInt16LE(0, 4); // disk number
  buf.writeUInt16LE(0, 6); // disk where CD starts
  buf.writeUInt16LE(input.totalEntries, 8);
  buf.writeUInt16LE(input.totalEntries, 10);
  buf.writeUInt32LE(input.centralDirectorySize, 12);
  buf.writeUInt32LE(input.centralDirectoryOffset, 16);
  buf.writeUInt16LE(0, 20); // comment length
  return buf;
};

// ---------------------------------------------------------------------------
// Reader: assemble inputs from the artifact root.
// ---------------------------------------------------------------------------

/** Filesystem layout the reader walks. Mirrors `production-runner.ts`. */
const JOBS_SEGMENT = "jobs";
const TI_SEGMENT = "test-intelligence";
const CUSTOMER_MARKDOWN_DIR = "customer-markdown";
const COMBINED_FILENAME = "testfaelle.md";
const IR_FILENAME = "business-intent-ir.json";
const GENERATED_TC_FILENAME = "generated-test-cases.json";
const EVIDENCE_MANIFEST_FILENAME = "evidence-manifest.json";

export type ReadCustomerMarkdownZipResult =
  | { ok: true; bundle: CustomerMarkdownZipBundle }
  | { ok: false; reason: "not_found" | "path_outside_root" | "io_error" };

export interface ReadCustomerMarkdownZipInput {
  /** Absolute artifact root (same as the production runner's `outputRoot`). */
  artifactRoot: string;
  /** Job id (already pattern-validated by the route layer). */
  jobId: string;
}

/**
 * Walk the artifact root for the supplied jobId and assemble a
 * `CustomerMarkdownZipBundle`. Path traversal is rejected at every
 * resolution boundary (the route layer's `isSafeJobId` guard is
 * defence-in-depth; this layer asserts containment again).
 */
export const readCustomerMarkdownZipInputs = async (
  input: ReadCustomerMarkdownZipInput,
): Promise<ReadCustomerMarkdownZipResult> => {
  const resolvedRoot = path.resolve(input.artifactRoot);
  const tiDir = path.resolve(
    resolvedRoot,
    JOBS_SEGMENT,
    input.jobId,
    TI_SEGMENT,
  );
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!tiDir.startsWith(rootWithSep)) {
    return { ok: false, reason: "path_outside_root" };
  }
  const tiProbe = await stat(tiDir).catch(() => null);
  if (tiProbe === null || !tiProbe.isDirectory()) {
    return { ok: false, reason: "not_found" };
  }
  const markdownDir = path.join(tiDir, CUSTOMER_MARKDOWN_DIR);
  const combinedPath = path.join(markdownDir, COMBINED_FILENAME);
  try {
    const [
      combinedMarkdown,
      perCase,
      businessIntentIrJson,
      evidenceManifestJson,
      regulatoryRelevanceSummaryJson,
    ] = await Promise.all([
      readFile(combinedPath, "utf8"),
      readPerCase(markdownDir),
      readFile(path.join(tiDir, IR_FILENAME), "utf8"),
      readOptional(path.join(tiDir, EVIDENCE_MANIFEST_FILENAME)),
      buildRegulatorySummary(tiDir),
    ]);
    return {
      ok: true,
      bundle: {
        jobId: input.jobId,
        combinedMarkdown,
        perCase,
        businessIntentIrJson,
        ...(evidenceManifestJson !== undefined ? { evidenceManifestJson } : {}),
        regulatoryRelevanceSummaryJson,
      },
    };
  } catch {
    return { ok: false, reason: "io_error" };
  }
};

const readPerCase = async (
  markdownDir: string,
): Promise<ReadonlyArray<{ filename: string; body: string }>> => {
  const probe = await stat(markdownDir).catch(() => null);
  if (probe === null || !probe.isDirectory()) return [];
  const entries = await readdir(markdownDir);
  const tcFiles = entries
    .filter((name) => name.startsWith("tc-") && name.endsWith(".md"))
    .sort();
  const out: { filename: string; body: string }[] = [];
  for (const filename of tcFiles) {
    const body = await readFile(path.join(markdownDir, filename), "utf8");
    out.push({ filename, body });
  }
  return out;
};

const readOptional = async (filePath: string): Promise<string | undefined> => {
  const probe = await stat(filePath).catch(() => null);
  if (probe === null || !probe.isFile()) return undefined;
  return readFile(filePath, "utf8");
};

/**
 * Build a small JSON summary of the `regulatoryRelevance` distribution
 * across the job's generated test cases. Reads the persisted
 * `generated-test-cases.json` and rolls up case counts per domain so a
 * downstream analyst can see at a glance how many banking / insurance /
 * general cases the run produced.
 */
const buildRegulatorySummary = async (tiDir: string): Promise<string> => {
  const tcPath = path.join(tiDir, GENERATED_TC_FILENAME);
  const probe = await stat(tcPath).catch(() => null);
  if (probe === null || !probe.isFile()) {
    return canonicalJson({
      totalCases: 0,
      domains: {},
      cases: [],
    });
  }
  const raw = await readFile(tcPath, "utf8");
  const parsed = safeParseJson(raw);
  if (parsed === undefined) {
    return canonicalJson({
      totalCases: 0,
      domains: {},
      cases: [],
    });
  }
  const list = parsed as Partial<GeneratedTestCaseList>;
  const cases = Array.isArray(list.testCases) ? list.testCases : [];
  const domainCounts: Record<string, number> = {};
  const summaryCases: Array<{
    id: string;
    title: string;
    domain: string;
    rationale?: string;
  }> = [];
  for (const tc of cases) {
    const domain = tc.regulatoryRelevance?.domain ?? "unknown";
    domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
    summaryCases.push({
      id: tc.id ?? "",
      title: tc.title ?? "",
      domain,
      ...(tc.regulatoryRelevance?.rationale !== undefined
        ? { rationale: tc.regulatoryRelevance.rationale }
        : {}),
    });
  }
  return canonicalJson({
    totalCases: cases.length,
    domains: domainCounts,
    cases: summaryCases,
  });
};

const safeParseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};
