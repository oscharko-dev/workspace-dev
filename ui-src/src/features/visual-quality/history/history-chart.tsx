import { useMemo, useState, type JSX } from "react";
import {
  buildGridlines,
  buildOverallSeries,
  DEFAULT_GEOMETRY,
  pickAxisLabels,
  pointsToPath,
} from "./history-math";
import { type HistoryRuns } from "../data/types";

interface HistoryChartProps {
  history: HistoryRuns | null;
}

function formatRunAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 10);
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Inline SVG line chart rendering the overall-score trend for the last runs.
 * No chart library — everything is computed in `history-math` and drawn as
 * plain SVG so the chart is deterministic and testable.
 */
export function HistoryChart({ history }: HistoryChartProps): JSX.Element {
  const geometry = DEFAULT_GEOMETRY;
  const series = useMemo(() => {
    if (!history) {
      return null;
    }
    return buildOverallSeries(history, 20, geometry);
  }, [history, geometry]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!history || !series || series.points.length === 0) {
    return (
      <div
        data-testid="history-chart-empty"
        className="flex h-[120px] items-center justify-center rounded-md border border-white/10 bg-[#171717] text-[11px] text-white/75"
      >
        No historical runs available.
      </div>
    );
  }

  const gridlines = buildGridlines(geometry);
  const labels = pickAxisLabels(series.points);
  const hoverPoint = hoverIndex !== null ? series.points[hoverIndex] : null;

  return (
    <div
      data-testid="history-chart"
      className="rounded-md border border-white/10 bg-[#171717] p-3"
    >
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-white/60">
        <span>Score trend</span>
        <span className="font-mono text-white/75">
          last {series.points.length} runs
        </span>
      </div>
      <svg
        role="img"
        aria-label="Visual quality score history"
        viewBox={`0 0 ${String(geometry.width)} ${String(geometry.height)}`}
        className="block h-[120px] w-full"
      >
        {gridlines.map((line) => (
          <g key={line.score}>
            <line
              x1={geometry.paddingLeft}
              x2={geometry.width - geometry.paddingRight}
              y1={line.y}
              y2={line.y}
              stroke="#ffffff"
              strokeOpacity={line.score === 100 ? 0.18 : 0.08}
              strokeDasharray={line.score === 100 ? undefined : "2,3"}
              strokeWidth={1}
            />
            <text
              x={geometry.paddingLeft - 4}
              y={line.y + 3}
              fontSize={9}
              textAnchor="end"
              fill="#ffffff"
              fillOpacity={0.35}
            >
              {String(line.score)}
            </text>
          </g>
        ))}

        {series.points.length > 1 ? (
          <path
            d={pointsToPath(series.points)}
            stroke="#4eba87"
            strokeWidth={1.5}
            fill="none"
          />
        ) : null}

        {series.points.map((point, index) => (
          <circle
            key={`${point.runAt}-${String(index)}`}
            cx={point.x}
            cy={point.y}
            r={hoverIndex === index ? 3.5 : 2.2}
            fill="#4eba87"
            onMouseEnter={() => {
              setHoverIndex(index);
            }}
            onMouseLeave={() => {
              setHoverIndex(null);
            }}
          />
        ))}

        {labels.map(({ index, item }) => (
          <text
            key={`label-${String(index)}`}
            x={item.x}
            y={geometry.height - 6}
            fontSize={9}
            textAnchor="middle"
            fill="#ffffff"
            fillOpacity={0.45}
          >
            {formatRunAt(item.runAt)}
          </text>
        ))}
      </svg>
      {hoverPoint ? (
        <div className="mt-1 flex items-center justify-between text-[11px] text-white/60">
          <span>{formatRunAt(hoverPoint.runAt)}</span>
          <span className="font-mono text-[#4eba87]">
            {hoverPoint.score.toFixed(2)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
