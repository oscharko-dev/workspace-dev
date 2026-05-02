import { type JSX } from "react";
import { type HotspotSeverity, type MergedScreen } from "../data/types";
import "../visual-quality.css";

interface OverlayHeatmapProps {
  screen: MergedScreen;
  onZoom: () => void;
}

const SEVERITY_COLOR: Record<HotspotSeverity, string> = {
  low: "rgba(78, 186, 135, 0.35)",
  medium: "rgba(251, 191, 36, 0.35)",
  high: "rgba(251, 113, 133, 0.35)",
  critical: "rgba(244, 63, 94, 0.55)",
};

const SEVERITY_BORDER: Record<HotspotSeverity, string> = {
  low: "#4eba87",
  medium: "#fbbf24",
  high: "#fb7185",
  critical: "#f43f5e",
};

/**
 * Difference heatmap overlay: renders the diff.png full size and overlays
 * hotspot bounding boxes (from the per-screen report) colored by severity.
 */
export function OverlayHeatmap({
  screen,
  onZoom,
}: OverlayHeatmapProps): JSX.Element {
  const diffUrl = screen.diffUrl;
  const hotspots = screen.report?.hotspots ?? [];
  const imageWidth = screen.report?.metadata?.imageWidth ?? 0;
  const imageHeight = screen.report?.metadata?.imageHeight ?? 0;

  if (!diffUrl) {
    return (
      <div
        data-testid="overlay-heatmap-missing"
        className="flex h-40 items-center justify-center rounded border border-dashed border-white/10 bg-[#0a0a0a] text-[11px] text-white/75"
      >
        No diff image attached for heatmap view.
      </div>
    );
  }

  const canOverlay = imageWidth > 0 && imageHeight > 0 && hotspots.length > 0;

  return (
    <div data-testid="overlay-heatmap" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onZoom}
        aria-label="Zoom difference heatmap"
        className="relative block cursor-zoom-in overflow-hidden rounded border border-white/10 bg-[#0a0a0a] p-0 text-left"
      >
        <img
          src={diffUrl}
          alt="Difference heatmap"
          className="block h-auto w-full"
        />
        {canOverlay ? (
          <div className="pointer-events-none absolute inset-0">
            {hotspots.map((hotspot, index) => {
              const left = (hotspot.x / imageWidth) * 100;
              const top = (hotspot.y / imageHeight) * 100;
              const width = (hotspot.width / imageWidth) * 100;
              const height = (hotspot.height / imageHeight) * 100;
              return (
                <div
                  key={`${hotspot.region}-${String(index)}`}
                  className="vq-hotspot-box absolute rounded-sm border"
                  style={
                    {
                      "--vq-hs-left": `${String(left)}%`,
                      "--vq-hs-top": `${String(top)}%`,
                      "--vq-hs-width": `${String(width)}%`,
                      "--vq-hs-height": `${String(height)}%`,
                      "--vq-hs-bg": SEVERITY_COLOR[hotspot.severity],
                      "--vq-hs-border": SEVERITY_BORDER[hotspot.severity],
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </div>
        ) : null}
      </button>
      {hotspots.length > 0 ? (
        <ul className="m-0 flex flex-wrap gap-1.5 p-0 text-[10px]">
          {hotspots.map((hotspot, index) => (
            <li
              key={`legend-${hotspot.region}-${String(index)}`}
              className="flex items-center gap-1 rounded border border-white/10 bg-[#171717] px-1.5 py-0.5 text-white/85"
            >
              <span
                className="vq-hotspot-legend-dot size-2 rounded-sm"
                style={
                  {
                    "--vq-hs-legend-bg": SEVERITY_BORDER[hotspot.severity],
                  } as React.CSSProperties
                }
              />
              <span>
                {hotspot.severity} · {hotspot.region} ·{" "}
                {hotspot.deviationPercent.toFixed(1)}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
