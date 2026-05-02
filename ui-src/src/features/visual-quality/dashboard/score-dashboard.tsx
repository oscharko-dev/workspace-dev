import { type JSX } from "react";
import { type MergedReport } from "../data/types";
import { ConfidenceSummary } from "./confidence-summary";
import { DimensionBreakdown } from "./dimension-breakdown";

interface ScoreDashboardProps {
  report: MergedReport;
}

type ScoreBand = "pass" | "warn" | "fail";

function formatScore(score: number): string {
  return score.toFixed(2);
}

function scoreBand(score: number): ScoreBand {
  if (score >= 98) {
    return "pass";
  }
  if (score >= 95) {
    return "warn";
  }
  return "fail";
}

function scoreColor(score: number): string {
  switch (scoreBand(score)) {
    case "pass":
      return "text-[#4eba87]";
    case "warn":
      return "text-amber-300";
    case "fail":
      return "text-rose-300";
  }
}

function scoreBandSymbol(band: ScoreBand): string {
  switch (band) {
    case "pass":
      return "✓";
    case "warn":
      return "⚠";
    case "fail":
      return "✗";
  }
}

function scoreBandLabel(band: ScoreBand): string {
  switch (band) {
    case "pass":
      return "PASS";
    case "warn":
      return "WARN";
    case "fail":
      return "FAIL";
  }
}

/**
 * Top-level dashboard summarizing overall score, per-fixture scores, and a
 * weighted per-dimension breakdown aggregated across every merged screen.
 */
export function ScoreDashboard({ report }: ScoreDashboardProps): JSX.Element {
  const { aggregate, fixtures } = report;
  const overallBand = scoreBand(aggregate.overallScore);
  const deltaIsPositive =
    aggregate.overallDelta !== undefined && aggregate.overallDelta >= 0;

  return (
    <div data-testid="score-dashboard" className="grid gap-3">
      <ConfidenceSummary confidence={report.confidence} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <DashboardStat
          label="Overall score"
          value={formatScore(aggregate.overallScore)}
          suffix="%"
          valueClassName={scoreColor(aggregate.overallScore)}
          bandSymbol={scoreBandSymbol(overallBand)}
          bandLabel={scoreBandLabel(overallBand)}
          screenReaderText={`Overall score ${scoreBandLabel(overallBand)}: ${formatScore(aggregate.overallScore)} percent`}
        />
        {aggregate.overallDelta !== undefined ? (
          <DashboardStat
            label="Δ vs baseline"
            value={`${deltaIsPositive ? "+" : ""}${formatScore(aggregate.overallDelta)}`}
            suffix="%"
            valueClassName={
              deltaIsPositive ? "text-[#4eba87]" : "text-rose-300"
            }
            bandSymbol={deltaIsPositive ? "▲" : "▼"}
            bandLabel={deltaIsPositive ? "UP" : "DOWN"}
            screenReaderText={`Delta versus baseline ${deltaIsPositive ? "up" : "down"}: ${deltaIsPositive ? "+" : ""}${formatScore(aggregate.overallDelta)} percent`}
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
            {fixtures.map((fixture) => {
              const band = scoreBand(fixture.averageScore);
              const symbol = scoreBandSymbol(band);
              const label = scoreBandLabel(band);
              const formatted = formatScore(fixture.averageScore);
              return (
                <li
                  key={fixture.fixtureId}
                  className="flex items-baseline justify-between gap-3 text-xs"
                  data-band={band}
                >
                  <span className="truncate text-white/80">
                    {fixture.fixtureId}
                  </span>
                  <span
                    className={`font-mono ${scoreColor(fixture.averageScore)}`}
                  >
                    <span aria-hidden="true">
                      {symbol} {formatted}%
                    </span>
                    <span className="sr-only">
                      {label}: {formatted} percent
                    </span>
                  </span>
                </li>
              );
            })}
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
  bandSymbol?: string;
  bandLabel?: string;
  screenReaderText?: string;
}

function DashboardStat({
  label,
  value,
  suffix,
  valueClassName,
  bandSymbol,
  bandLabel,
  screenReaderText,
}: DashboardStatProps): JSX.Element {
  const sighted = (
    <>
      {bandSymbol !== undefined ? (
        <span
          aria-hidden="true"
          className={`text-base font-semibold ${valueClassName ?? "text-white"}`}
        >
          {bandSymbol}
        </span>
      ) : null}
      {bandLabel !== undefined ? (
        <span
          aria-hidden="true"
          className={`text-[10px] font-semibold uppercase tracking-wider ${valueClassName ?? "text-white"}`}
        >
          {bandLabel}
        </span>
      ) : null}
      <span
        aria-hidden={screenReaderText !== undefined ? "true" : undefined}
        className={`text-xl font-semibold ${valueClassName ?? "text-white"}`}
      >
        {value}
      </span>
      {suffix.length > 0 ? (
        <span
          aria-hidden={screenReaderText !== undefined ? "true" : undefined}
          className="text-sm text-white/75"
        >
          {suffix}
        </span>
      ) : null}
    </>
  );

  return (
    <div className="rounded-md border border-white/10 bg-[#171717] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-white/75">
        {label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        {sighted}
        {screenReaderText !== undefined ? (
          <span className="sr-only">{screenReaderText}</span>
        ) : null}
      </div>
    </div>
  );
}
