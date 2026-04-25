import assert from "node:assert/strict";
import test from "node:test";
import type { QcMappingPreviewEntry } from "../contracts/index.js";
import { QC_CSV_COLUMNS, renderQcCsv } from "./qc-csv-writer.js";

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

test("csv: header row matches QC_CSV_COLUMNS", () => {
  const out = renderQcCsv([]);
  const firstLine = out.split("\r\n")[0];
  assert.equal(firstLine, QC_CSV_COLUMNS.join(","));
});

test("csv: empty body has only header followed by CRLF", () => {
  const out = renderQcCsv([]);
  assert.equal(out, QC_CSV_COLUMNS.join(",") + "\r\n");
});

test("csv: cells with comma are quoted", () => {
  const out = renderQcCsv([baseEntry({ testName: "Hello, world" })]);
  assert.match(out, /"Hello, world"/);
});

test("csv: cells with embedded double quotes get them doubled", () => {
  const out = renderQcCsv([baseEntry({ testName: 'A "quoted" value' })]);
  assert.match(out, /"A ""quoted"" value"/);
});

test("csv: cells with embedded newline are quoted", () => {
  const out = renderQcCsv([baseEntry({ objective: "first\nsecond" })]);
  assert.match(out, /"first\nsecond"/);
});

test("csv: deterministic output across two renders with sorted entries", () => {
  const a = renderQcCsv([
    baseEntry({ testCaseId: "z" }),
    baseEntry({ testCaseId: "a" }),
  ]);
  const b = renderQcCsv([
    baseEntry({ testCaseId: "a" }),
    baseEntry({ testCaseId: "z" }),
  ]);
  assert.equal(a, b);
  // Lower id appears before higher id.
  const lines = a.trim().split("\r\n");
  const aIdx = lines.findIndex((l) => l.startsWith("a,"));
  const zIdx = lines.findIndex((l) => l.startsWith("z,"));
  assert.ok(aIdx < zIdx);
});

test("csv: one row per step; case without steps still has one row", () => {
  const out = renderQcCsv([
    baseEntry({
      testCaseId: "stepless",
      designSteps: [],
    }),
    baseEntry({
      testCaseId: "withsteps",
      designSteps: [
        { index: 1, action: "go" },
        { index: 2, action: "stop" },
      ],
    }),
  ]);
  const dataLines = out.trim().split("\r\n").slice(1);
  assert.equal(dataLines.length, 3);
});

test("csv: visual provenance columns default to none / 0.000000 / 0", () => {
  const out = renderQcCsv([baseEntry({})]);
  const dataLine = out.trim().split("\r\n")[1] ?? "";
  // Last 5 columns: VisualDeployment, FallbackReason, ConfidenceMean, AmbiguityCount, EvidenceHash.
  const cells = dataLine.split(",");
  assert.equal(cells[cells.length - 5], "none");
  assert.equal(cells[cells.length - 4], "none");
  assert.equal(cells[cells.length - 3], "0.000000");
  assert.equal(cells[cells.length - 2], "0");
  assert.equal(cells[cells.length - 1], "");
});

test("csv: visual provenance round-trip when present", () => {
  const out = renderQcCsv([
    baseEntry({
      visualProvenance: {
        deployment: "llama-4-maverick-vision",
        fallbackReason: "none",
        confidenceMean: 0.823456,
        ambiguityCount: 2,
        evidenceHash: "deadbeef",
      },
    }),
  ]);
  assert.match(out, /llama-4-maverick-vision,none,0\.823456,2,deadbeef/);
});
