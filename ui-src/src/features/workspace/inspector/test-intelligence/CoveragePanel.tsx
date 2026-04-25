// ---------------------------------------------------------------------------
// Coverage and duplicate-finding panel (Issue #1367)
//
// Aggregate coverage metrics + duplicate findings rendered as dense, scannable
// rows. Renders an empty hint when no coverage report is available so the
// page still mounts cleanly during partial-result states.
// ---------------------------------------------------------------------------

import type { JSX } from "react";
import { formatPercent } from "./formatters";
import type { CoverageBucket, CoverageReport } from "./types";

export interface CoveragePanelProps {
  coverage: CoverageReport | undefined;
}

interface BucketRow {
  label: string;
  bucket: CoverageBucket;
}

export function CoveragePanel({ coverage }: CoveragePanelProps): JSX.Element {
  if (!coverage) {
    return (
      <section
        data-testid="ti-coverage-panel"
        aria-label="Coverage metrics"
        className="rounded border border-dashed border-white/10 bg-[#0a0a0a] px-4 py-6 text-center text-[12px] text-white/45"
      >
        No coverage report has been emitted yet.
      </section>
    );
  }

  const rows: BucketRow[] = [
    { label: "Field coverage", bucket: coverage.fieldCoverage },
    { label: "Action coverage", bucket: coverage.actionCoverage },
    { label: "Validation coverage", bucket: coverage.validationCoverage },
    { label: "Navigation coverage", bucket: coverage.navigationCoverage },
  ];

  return (
    <section
      data-testid="ti-coverage-panel"
      aria-label="Coverage metrics"
      className="flex flex-col gap-3 rounded border border-white/10 bg-[#171717] p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-sm font-semibold text-white">
          Coverage &amp; quality signals
        </h2>
        <span className="text-[10px] text-white/45">
          profile {coverage.policyProfileId}
        </span>
      </header>

      <div className="grid gap-2 md:grid-cols-3">
        <CoverageStat
          label="Test cases"
          value={String(coverage.totalTestCases)}
          testId="ti-coverage-total-cases"
        />
        <CoverageStat
          label="Trace coverage"
          value={formatPercent(coverage.traceCoverage.ratio)}
          testId="ti-coverage-trace"
        />
        <CoverageStat
          label="Open questions"
          value={String(coverage.openQuestionsCount)}
          testId="ti-coverage-open-questions"
        />
      </div>

      <table
        data-testid="ti-coverage-buckets"
        className="min-w-full border-collapse text-left text-xs"
      >
        <thead>
          <tr className="border-b border-white/10 text-white/45">
            <th className="px-2 py-1 font-medium">Element kind</th>
            <th className="px-2 py-1 font-medium">Total</th>
            <th className="px-2 py-1 font-medium">Covered</th>
            <th className="px-2 py-1 font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.label}
              data-testid={`ti-coverage-row-${row.label
                .toLowerCase()
                .replace(/\s+/g, "-")}`}
              className="border-b border-white/5"
            >
              <th scope="row" className="px-2 py-1 font-medium text-white/80">
                {row.label}
              </th>
              <td className="px-2 py-1 font-mono text-white/65">
                {row.bucket.total}
              </td>
              <td className="px-2 py-1 font-mono text-white/65">
                {row.bucket.covered}
              </td>
              <td className="px-2 py-1 font-mono text-white/85">
                {formatPercent(row.bucket.ratio)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <DuplicateFindings duplicates={coverage.duplicatePairs} />
    </section>
  );
}

interface CoverageStatProps {
  label: string;
  value: string;
  testId: string;
}

function CoverageStat({
  label,
  value,
  testId,
}: CoverageStatProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className="rounded border border-white/10 bg-[#0f0f0f] px-3 py-2"
    >
      <div className="text-[10px] uppercase tracking-wide text-white/45">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-white">{value}</div>
    </div>
  );
}

interface DuplicateFindingsProps {
  duplicates: readonly {
    leftTestCaseId: string;
    rightTestCaseId: string;
    similarity: number;
  }[];
}

function DuplicateFindings({
  duplicates,
}: DuplicateFindingsProps): JSX.Element {
  if (duplicates.length === 0) {
    return (
      <div
        data-testid="ti-coverage-duplicates-empty"
        className="rounded border border-white/5 bg-[#0f0f0f] px-3 py-2 text-[11px] text-white/55"
      >
        No duplicate findings above the policy similarity threshold.
      </div>
    );
  }

  return (
    <section
      data-testid="ti-coverage-duplicates"
      aria-label="Duplicate findings"
      className="flex flex-col gap-1 rounded border border-amber-500/20 bg-amber-950/10 px-3 py-2"
    >
      <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
        Duplicate findings
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {duplicates.map((pair, index) => (
          <li
            key={`${pair.leftTestCaseId}-${pair.rightTestCaseId}-${String(index)}`}
            data-testid={`ti-coverage-duplicate-${index}`}
            className="break-words text-[11px] text-white/85"
          >
            <span className="font-mono text-white">{pair.leftTestCaseId}</span>
            <span className="text-white/35"> ↔ </span>
            <span className="font-mono text-white">{pair.rightTestCaseId}</span>
            <span className="text-white/45"> · similarity </span>
            <span className="font-mono text-amber-200">
              {pair.similarity.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
