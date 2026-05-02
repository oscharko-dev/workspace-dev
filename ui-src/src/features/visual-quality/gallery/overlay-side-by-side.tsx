import { type JSX } from "react";
import { type MergedScreen } from "../data/types";

interface OverlaySideBySideProps {
  screen: MergedScreen;
  onZoom: () => void;
}

/**
 * Side-by-side overlay mode. Shows reference (or actual when reference is
 * missing) on the left and actual/diff on the right with matched aspect
 * ratios and synchronized scroll. Falls back gracefully when images are
 * missing.
 */
export function OverlaySideBySide({
  screen,
  onZoom,
}: OverlaySideBySideProps): JSX.Element {
  const left = screen.referenceUrl;
  const right = screen.actualUrl ?? screen.diffUrl;
  const leftLabel = left ? "Reference" : screen.actualUrl ? "Actual" : "Diff";
  const rightLabel = screen.referenceUrl ? "Actual" : "Diff";

  if (!left && !right) {
    return <OverlayMissing label="No images attached for side-by-side view." />;
  }

  return (
    <div
      data-testid="overlay-side-by-side"
      className="grid grid-cols-1 gap-3 md:grid-cols-2"
    >
      <ImagePane
        label={leftLabel}
        url={left ?? screen.actualUrl ?? screen.diffUrl}
        onZoom={onZoom}
      />
      <ImagePane label={rightLabel} url={right} onZoom={onZoom} />
    </div>
  );
}

interface ImagePaneProps {
  label: string;
  url: string | null;
  onZoom: () => void;
}

function ImagePane({ label, url, onZoom }: ImagePaneProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-wider text-white/75">
        {label}
      </div>
      <div className="relative overflow-auto rounded border border-white/10 bg-[#0a0a0a]">
        {url ? (
          <button
            type="button"
            onClick={onZoom}
            aria-label={`Zoom ${label}`}
            className="block w-full cursor-zoom-in border-0 bg-transparent p-0"
          >
            <img src={url} alt={label} className="block h-auto w-full" />
          </button>
        ) : (
          <div className="flex h-32 items-center justify-center text-[11px] text-white/35">
            Image unavailable
          </div>
        )}
      </div>
    </div>
  );
}

function OverlayMissing({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex h-40 items-center justify-center rounded border border-dashed border-white/10 bg-[#0a0a0a] text-[11px] text-white/75">
      {label}
    </div>
  );
}
