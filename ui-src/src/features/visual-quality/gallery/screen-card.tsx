import { type JSX } from "react";
import { type HotspotSeverity, type MergedScreen } from "../data/types";

interface ScreenCardProps {
  screen: MergedScreen;
  selected: boolean;
  deltaLabel?: string;
  onSelect: () => void;
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

const SEVERITY_PILL: Record<HotspotSeverity, string> = {
  low: "border-[#4eba87]/40 text-[#4eba87]",
  medium: "border-amber-400/40 text-amber-300",
  high: "border-rose-400/40 text-rose-300",
  critical: "border-rose-500/60 text-rose-400",
};

/**
 * One card in the gallery grid. Renders a thumbnail (diff if available, else
 * a generated swatch), the score, the viewport, and the worst hotspot pill.
 */
export function ScreenCard({
  screen,
  selected,
  deltaLabel,
  onSelect,
}: ScreenCardProps): JSX.Element {
  const thumb = screen.diffUrl ?? screen.actualUrl ?? screen.referenceUrl;
  return (
    <button
      type="button"
      data-testid={`screen-card-${screen.key}`}
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex cursor-pointer flex-col items-stretch gap-2 rounded-md border p-2 text-left transition ${
        selected
          ? "border-[#4eba87] bg-[#4eba87]/12"
          : "border-white/10 bg-[#171717] hover:border-white/25 hover:bg-[#1f1f1f]"
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded border border-black/40 bg-[#0a0a0a]">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-white/35">
            No preview
          </div>
        )}
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[11px] font-medium text-white/85">
            {screen.fixtureId}
          </span>
          <span className="truncate text-[10px] text-white/45">
            {screen.screenName}
          </span>
        </div>
        <div
          className={`font-mono text-[13px] font-semibold ${scoreColor(screen.score)}`}
        >
          {screen.score.toFixed(1)}
        </div>
      </div>
      <div className="flex items-center justify-between text-[9px]">
        <span className="rounded border border-white/10 bg-[#0a0a0a] px-1.5 py-0.5 text-white/45">
          {screen.viewportLabel}
        </span>
        {screen.worstSeverity ? (
          <span
            className={`rounded border px-1.5 py-0.5 uppercase ${SEVERITY_PILL[screen.worstSeverity]}`}
          >
            {screen.worstSeverity}
          </span>
        ) : null}
        {deltaLabel ? (
          <span className="font-mono text-white/45">{deltaLabel}</span>
        ) : null}
      </div>
    </button>
  );
}
