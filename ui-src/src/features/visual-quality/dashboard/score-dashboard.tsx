import { type JSX } from "react";
import { type MergedReport } from "../data/types";
import { ConfidenceSummary } from "./confidence-summary";
import { DimensionBreakdown } from "./dimension-breakdown";

interface ScoreDashboardProps {
  report: MergedReport;
}

function formatScore(score: number): string {
  return score.toFixed(2);
}

function scoreColor(score: number): string {
  if (score >= 98) {
    return "text-[#4eba87]";
  }
  if (score >= 95) {
    return "text-amber-300";
  }
  return "text-rose-300";
}

/**
 * Top-level dashboard summarizing overall score, per-fixture scores, and a
 * weighted per-dimension breakdown aggregated across every merged screen.
 */
export function ScoreDashboard({ report }: ScoreDashboardProps): JSX.Element {
  const { aggregate, fixtures } = report;

  return (
    <div data-testid="score-dashboard" className="grid gap-3">
      <ConfidenceSummary confidence={report.confidence} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <DashboardStat
          label="Overall score"
          value={formatScore(aggregate.overallScore)}
          suffix="%"
          valueClassName={scoreColor(aggregate.overallScore)}
        />
        {aggregate.overallDelta !== undefined ? (
          <DashboardStat
            label="Δ vs baseline"
            value={`${aggregate.overallDelta >= 0 ? "+" : ""}${formatScore(aggregate.overallDelta)}`}
            suffix="%"
            valueClassName={
              aggregate.overallDelta >= 0 ? "text-[#4eba87]" : "text-rose-300"
            }
          />
        ) : null}
        <DashboardStat
          label="Fixtures"
          value={String(fixtures.length)}
          suffix=""
        />
        <DashboardStat
          label="Screens scored"
          value={String(aggregate.scores.length)}
          suffix=""
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section
          data-testid="dashboard-fixtures"
          className="rounded-md border border-white/10 bg-[#171717] p-3"
        >
          <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/85">
            Per-fixture score
          </h3>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {fixtures.map((fixture) => (
              <li
                key={fixture.fixtureId}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="truncate text-white/80">
                  {fixture.fixtureId}
                </span>
                <span
                  className={`font-mono ${scoreColor(fixture.averageScore)}`}
                >
                  {formatScore(fixture.averageScore)}%
                </span>
              </li>
            ))}
          </ul>
        </section>

        <DimensionBreakdown report={report} />
      </div>
      {aggregate.warnings && aggregate.warnings.length > 0 ? (
        <section
          data-testid="dashboard-warnings"
          className="rounded-md border border-amber-400/30 bg-amber-950/20 p-3 text-[11px] text-amber-200"
        >
          <h3 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wider">
            Warnings
          </h3>
          <ul className="m-0 list-disc space-y-0.5 pl-4">
            {aggregate.warnings.map((warning, index) => (
              <li key={`${String(index)}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface DashboardStatProps {
  label: string;
  value: string;
  suffix: string;
  valueClassName?: string;
}

function DashboardStat({
  label,
  value,
  suffix,
  valueClassName,
}: DashboardStatProps): JSX.Element {
  return (
    <div className="rounded-md border border-white/10 bg-[#171717] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/75">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-0.5">
        <span
          className={`text-xl font-semibold ${valueClassName ?? "text-white"}`}
        >
          {value}
        </span>
        {suffix.length > 0 ? (
          <span className="text-sm text-white/75">{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}
