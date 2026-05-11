/**
 * Spreadsheet formula-injection guard (Issue #1664, audit-2026-05).
 *
 * Single-source-of-truth neutralizer used by every QC export writer
 * (`qc-csv-writer.ts`, `qc-xlsx-writer.ts`, `qc-alm-xml-writer.ts`).
 *
 * A cell value whose first character is `=`, `+`, `-`, `@`, `\t`, or
 * `\r` is interpreted as a formula by Excel, LibreOffice Calc, Google
 * Sheets, and several CSV-round-trip importers (CWE-1236). The OWASP
 * mitigation is to prefix the value with a single quote (`'`), which
 * forces the cell to be treated as a literal string. Mirroring the
 * leader rule across all three writers means a customer round-tripping
 * XLSX → CSV → ALM-XML cannot reintroduce the attack surface in any
 * leg of the journey.
 *
 * The guard is intentionally NOT exposed via the public contract index;
 * it is an implementation detail of the test-intelligence export
 * pipeline.
 */

const FORMULA_LEADER_RE = /^[=+\-@\t\r]/;

/**
 * Prefix `value` with a single quote when its first character is one of
 * the formula leaders. Empty strings pass through unchanged so callers
 * can use the function unconditionally during cell encoding.
 */
export const neutralizeFormulaLeading = (value: string): string => {
  if (value.length === 0) return value;
  if (FORMULA_LEADER_RE.test(value)) {
    return `'${value}`;
  }
  return value;
};
