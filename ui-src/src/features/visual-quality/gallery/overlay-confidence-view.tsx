import { type JSX } from "react";
import { type MergedScreen } from "../data/types";
import {
  CONFIDENCE_OVERLAY_BORDERS,
  CONFIDENCE_OVERLAY_COLORS,
} from "./overlay-confidence";
import "../visual-quality.css";

interface OverlayConfidenceViewProps {
  screen: MergedScreen;
  onZoom: () => void;
}

export function OverlayConfidenceView({
  screen,
  onZoom,
}: OverlayConfidenceViewProps): JSX.Element {
  const confidence = screen.confidence;
  const previewUrl = screen.actualUrl ?? screen.referenceUrl ?? screen.diffUrl;

  if (!confidence && !previewUrl) {
    return (
      <div
        data-testid="overlay-confidence-missing"
        className="flex h-40 items-center justify-center rounded border border-dashed border-white/10 bg-[#0a0a0a] text-[11px] text-white/75"
      >
        No confidence data or preview image attached for confidence view.
      </div>
    );
  }

  return (
    <div
      data-testid="overlay-confidence"
      className="grid gap-3 lg:grid-cols-[minmax(0,_1.2fr)_minmax(16rem,_0.8fr)]"
    >
      <div className="min-w-0">
        {previewUrl ? (
          <button
            type="button"
            onClick={onZoom}
            aria-label="Zoom confidence overlay"
            className="relative block w-full cursor-zoom-in overflow-hidden rounded border border-white/10 bg-[#0a0a0a] p-0 text-left"
          >
            <img
              src={previewUrl}
              alt="Confidence preview"
              className="block h-auto w-full"
            />
            {confidence ? (
              <div
                className="vq-conf-overlay pointer-events-none absolute inset-0"
                style={
                  {
                    "--vq-conf-overlay-bg":
                      CONFIDENCE_OVERLAY_COLORS[confidence.level],
                    "--vq-conf-overlay-shadow": `inset 0 0 0 2px ${CONFIDENCE_OVERLAY_BORDERS[confidence.level]}`,
                  } as React.CSSProperties
                }
              />
            ) : null}
          </button>
        ) : (
          <div className="flex h-40 items-center justify-center rounded border border-dashed border-white/10 bg-[#0a0a0a] text-[11px] text-white/75">
            No preview image attached for confidence view.
          </div>
        )}
      </div>

      <section className="rounded-md border border-white/10 bg-[#171717] p-3">
        <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/85">
          Screen confidence
        </h3>
        {confidence ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <span
                className="vq-conf-dot inline-block h-2.5 w-2.5 rounded-full"
                style={
                  {
                    "--vq-conf-dot-bg":
                      CONFIDENCE_OVERLAY_BORDERS[confidence.level],
                  } as React.CSSProperties
                }
              />
              <span className="text-xs font-medium capitalize text-white/85">
                {confidence.level.replace("_", " ")}
              </span>
              <span className="ml-auto font-mono text-xs text-white/85">
                {confidence.score.toFixed(1)}%
              </span>
            </div>

            {confidence.components.length > 0 ? (
              <div className="mb-3">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-white/75">
                  Components
                </div>
                <ul className="m-0 list-none space-y-1 p-0">
                  {confidence.components.map((component) => (
                    <li
                      key={component.componentId}
                      className="flex items-baseline justify-between gap-3 text-[11px]"
                    >
                      <span className="truncate text-white/80">
                        {component.componentName}
                      </span>
                      <span className="font-mono text-white/85">
                        {component.score.toFixed(1)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="m-0 mb-3 text-[11px] text-white/75">
                No screen-scoped components were matched for this screen.
              </p>
            )}

            {confidence.contributors.length > 0 ? (
              <details>
                <summary className="cursor-pointer text-[11px] text-white/75">
                  Screen signal breakdown ({confidence.contributors.length})
                </summary>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-4 text-[11px] text-white/60">
                  {confidence.contributors.map((contributor) => (
                    <li key={`${contributor.signal}-${contributor.detail}`}>
                      {contributor.signal}: {contributor.detail}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : (
          <p className="m-0 text-[11px] text-white/75">
            No per-screen confidence payload is attached to this report.
          </p>
        )}
      </section>
    </div>
  );
}
