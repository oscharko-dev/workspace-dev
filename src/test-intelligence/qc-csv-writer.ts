/**
 * RFC 4180 CSV writer for QC export (Issue #1365).
 *
 * Hand-rolled, deterministic, zero-runtime-dependency.
 *
 *   - line ending: CRLF (`\r\n`) per RFC 4180
 *   - field separator: `,`
 *   - quoting: only when the value contains `,`, `"`, `\r`, or `\n`
 *   - embedded `"` escaped as `""`
 *   - stable column order across all rows
 *   - one row per (test case, step). Test cases without steps emit a
 *     single row with empty step columns so that the case still carries
 *     a CSV row.
 *
 * The writer never parses CSV; it only emits. Callers are responsible
 * for input redaction (PII guard) before passing values in.
 */

import type {
  GeneratedTestCaseStep,
  QcMappingPreviewEntry,
} from "../contracts/index.js";
import { neutralizeFormulaLeading } from "./spreadsheet-formula-guard.js";

const CSV_LINE_TERMINATOR = "\r\n";

export const QC_CSV_COLUMNS = [
  "TestCaseId",
  "ExternalId",
  "Title",
  "Objective",
  "Priority",
  "RiskCategory",
  "TargetFolder",
  "Preconditions",
  "TestData",
  "ExpectedResults",
  "StepIndex",
  "StepAction",
  "StepData",
  "StepExpected",
  "VisualDeployment",
  "VisualFallbackReason",
  "VisualConfidenceMean",
  "VisualAmbiguityCount",
  "VisualEvidenceHash",
] as const;

export type QcCsvColumn = (typeof QC_CSV_COLUMNS)[number];

const NEEDS_QUOTING_REGEX = /[,"\r\n]/;

// Issue #1664 (audit-2026-05): CSV Formula Injection (CWE-1236) defence.
// Shared neutralizer in `./spreadsheet-formula-guard.ts`. Mirrors the
// rule in `qc-xlsx-writer.ts` and `qc-alm-xml-writer.ts` so a customer
// round-tripping XLSX → CSV → ALM-XML cannot reintroduce the attack
// surface in any leg of the journey.

const escapeCell = (value: string): string => {
  const neutralized = neutralizeFormulaLeading(value);
  if (NEEDS_QUOTING_REGEX.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
};

const joinList = (values: readonly string[]): string => values.join(" | ");

const formatNumber = (value: number): string => {
  if (Number.isFinite(value)) return value.toFixed(6);
  return "0.000000";
};

const buildRow = (cells: readonly string[]): string => {
  return cells.map(escapeCell).join(",");
};

const buildRowsForEntry = (entry: QcMappingPreviewEntry): string[] => {
  const visualDeployment = entry.visualProvenance?.deployment ?? "none";
  const visualFallback = entry.visualProvenance?.fallbackReason ?? "none";
  const visualConfidenceMean = formatNumber(
    entry.visualProvenance?.confidenceMean ?? 0,
  );
  const visualAmbiguityCount = String(
    entry.visualProvenance?.ambiguityCount ?? 0,
  );
  const visualEvidenceHash = entry.visualProvenance?.evidenceHash ?? "";

  const baseCells = (step?: GeneratedTestCaseStep): string[] => [
    entry.testCaseId,
    entry.externalIdCandidate,
    entry.testName,
    entry.objective,
    entry.priority,
    entry.riskCategory,
    entry.targetFolderPath,
    joinList(entry.preconditions),
    joinList(entry.testData),
    joinList(entry.expectedResults),
    step ? String(step.index) : "",
    step ? step.action : "",
    step?.data ?? "",
    step?.expected ?? "",
    visualDeployment,
    visualFallback,
    visualConfidenceMean,
    visualAmbiguityCount,
    visualEvidenceHash,
  ];

  if (entry.designSteps.length === 0) {
    return [buildRow(baseCells())];
  }
  return entry.designSteps
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((step) => buildRow(baseCells(step)));
};

/** Render the QC mapping preview entries as a deterministic CSV string. */
export const renderQcCsv = (
  entries: readonly QcMappingPreviewEntry[],
): string => {
  const lines: string[] = [];
  lines.push(QC_CSV_COLUMNS.slice().join(","));
  const sorted = entries
    .slice()
    .sort((a, b) => a.testCaseId.localeCompare(b.testCaseId));
  for (const entry of sorted) {
    for (const row of buildRowsForEntry(entry)) {
      lines.push(row);
    }
  }
  return lines.join(CSV_LINE_TERMINATOR) + CSV_LINE_TERMINATOR;
};
