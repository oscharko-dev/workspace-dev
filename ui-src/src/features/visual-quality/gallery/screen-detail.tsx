import { useState, type JSX } from "react";
import { type MergedScreen } from "../data/types";
import { OverlaySideBySide } from "./overlay-side-by-side";
import { OverlayOnionSkin } from "./overlay-onion-skin";
import { OverlayHeatmap } from "./overlay-heatmap";
import { OverlayConfidenceView } from "./overlay-confidence-view";
import { ZoomModal } from "./zoom-modal";
import { OVERLAY_MODES, type OverlayMode } from "./overlay-mode";

interface ScreenDetailProps {
  screen: MergedScreen;
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
 * Right-hand detail pane. Shows the selected screen's metadata, its overlay
 * modes (side-by-side / onion-skin / heatmap), a dimensions table, and a
 * hotspots list.
 */
export function ScreenDetail({ screen }: ScreenDetailProps): JSX.Element {
  const [mode, setMode] = useState<OverlayMode>("side-by-side");
  const [zoomOpen, setZoomOpen] = useState(false);

  const dimensions = screen.report?.dimensions ?? [];
  const hotspots = screen.report?.hotspots ?? [];

  return (
    <div data-testid="screen-detail" className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-white/45">
            {screen.fixtureId}
          </div>
          <h2 className="m-0 truncate text-sm font-semibold text-white">
            {screen.screenName}
          </h2>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/45">
            <span>{screen.viewportLabel}</span>
            {screen.report?.interpretation ? (
              <>
                <span>·</span>
                <span className="truncate">{screen.report.interpretation}</span>
              </>
            ) : null}
          </div>
        </div>
        <div
          className={`font-mono text-2xl font-semibold ${scoreColor(screen.score)}`}
        >
          {screen.score.toFixed(2)}
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Overlay mode"
        className="flex items-center gap-1 rounded-md border border-white/10 bg-[#171717] p-0.5"
      >
        {OVERLAY_MODES.map((option) => (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={mode === option.value}
            data-testid={`overlay-mode-${option.value}`}
            onClick={() => {
              setMode(option.value);
            }}
            className={`flex-1 cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition ${
              mode === option.value
                ? "bg-[#4eba87]/12 text-[#4eba87]"
                : "text-white/55 hover:bg-black/40 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div>
        {mode === "side-by-side" ? (
          <OverlaySideBySide
            screen={screen}
            onZoom={() => {
              setZoomOpen(true);
            }}
          />
        ) : null}
        {mode === "onion-skin" ? (
          <OverlayOnionSkin
            screen={screen}
            onZoom={() => {
              setZoomOpen(true);
            }}
          />
        ) : null}
        {mode === "heatmap" ? (
          <OverlayHeatmap
            screen={screen}
            onZoom={() => {
              setZoomOpen(true);
            }}
          />
        ) : null}
        {mode === "confidence" ? (
          <OverlayConfidenceView
            screen={screen}
            onZoom={() => {
              setZoomOpen(true);
            }}
          />
        ) : null}
      </div>

      {dimensions.length > 0 ? (
        <section className="rounded-md border border-white/10 bg-[#171717] p-3">
          <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
            Dimensions
          </h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {dimensions.map((dim) => (
              <li
                key={dim.name}
                className="flex items-baseline justify-between gap-3 text-[11px]"
              >
                <span className="truncate text-white/80">{dim.name}</span>
                <span className={`font-mono ${scoreColor(dim.score)}`}>
                  {dim.score.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {hotspots.length > 0 ? (
        <section className="rounded-md border border-white/10 bg-[#171717] p-3">
          <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
            Hotspots
          </h3>
          <ul className="m-0 list-none space-y-1 p-0">
            {hotspots.map((hotspot, index) => (
              <li
                key={`${hotspot.region}-${String(index)}`}
                className="flex items-baseline justify-between gap-3 text-[11px] text-white/80"
              >
                <span className="truncate">
                  {hotspot.region} · {hotspot.category}
                </span>
                <span className="font-mono text-white/55">
                  {hotspot.severity} · {hotspot.deviationPercent.toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {zoomOpen ? (
        <ZoomModal
          screen={screen}
          mode={mode}
          onClose={() => {
            setZoomOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
