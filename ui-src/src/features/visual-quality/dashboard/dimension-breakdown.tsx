import { useMemo, type JSX } from "react";
import { type MergedReport } from "../data/types";

interface DimensionBreakdownProps {
  report: MergedReport;
}

interface AggregatedDimension {
  name: string;
  score: number;
  weight: number;
  screenCount: number;
}

function aggregateDimensions(report: MergedReport): AggregatedDimension[] {
  const byName = new Map<
    string,
    { total: number; weight: number; count: number }
  >();
  for (const fixture of report.fixtures) {
    for (const screen of fixture.screens) {
      const dims = screen.report?.dimensions ?? [];
      for (const dim of dims) {
        const entry = byName.get(dim.name);
        if (entry) {
          entry.total += dim.score;
          entry.count += 1;
          entry.weight = dim.weight;
        } else {
          byName.set(dim.name, {
            total: dim.score,
            weight: dim.weight,
            count: 1,
          });
        }
      }
    }
  }
  return Array.from(byName.entries())
    .map(([name, entry]) => ({
      name,
      score: entry.count > 0 ? entry.total / entry.count : 0,
      weight: entry.weight,
      screenCount: entry.count,
    }))
    .sort((a, b) => b.weight - a.weight);
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

function barColor(score: number): string {
  if (score >= 98) {
    return "bg-[#4eba87]";
  }
  if (score >= 95) {
    return "bg-amber-300";
  }
  return "bg-rose-300";
}

/**
 * Per-dimension breakdown — each row shows the averaged score for one
 * dimension (Layout Accuracy, Color Fidelity, etc.) as a horizontal bar.
 */
export function DimensionBreakdown({
  report,
}: DimensionBreakdownProps): JSX.Element {
  const dimensions = useMemo(() => aggregateDimensions(report), [report]);

  if (dimensions.length === 0) {
    return (
      <section
        data-testid="dashboard-dimensions"
        className="rounded-md border border-white/10 bg-[#171717] p-3"
      >
        <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
          Per-dimension breakdown
        </h3>
        <p className="m-0 text-[11px] text-white/45">
          No dimension data available (per-screen reports were not attached).
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="dashboard-dimensions"
      className="rounded-md border border-white/10 bg-[#171717] p-3"
    >
      <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
        Per-dimension breakdown
      </h3>
      <ul className="m-0 list-none space-y-2 p-0">
        {dimensions.map((dim) => (
          <li key={dim.name}>
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="truncate text-white/80">{dim.name}</span>
              <span className={`font-mono ${scoreColor(dim.score)}`}>
                {dim.score.toFixed(2)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full ${barColor(dim.score)}`}
                style={{
                  width: `${String(Math.max(0, Math.min(100, dim.score)))}%`,
                }}
              />
            </div>
            <div className="mt-0.5 text-[9px] text-white/35">
              weight {(dim.weight * 100).toFixed(0)}% · {dim.screenCount}{" "}
              screen(s)
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
