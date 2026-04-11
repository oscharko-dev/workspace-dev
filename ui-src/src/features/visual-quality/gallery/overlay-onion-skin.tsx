import { useCallback, useState, type JSX, type KeyboardEvent } from "react";
import { type MergedScreen } from "../data/types";

interface OverlayOnionSkinProps {
  screen: MergedScreen;
  onZoom: () => void;
}

const STEP = 5;

/**
 * Onion-skin overlay: stacks the reference image beneath the actual image
 * and lets the user dial the actual's opacity. Left/Right arrow keys adjust
 * by 5% for keyboard accessibility.
 */
export function OverlayOnionSkin({
  screen,
  onZoom,
}: OverlayOnionSkinProps): JSX.Element {
  const [opacity, setOpacity] = useState(50);
  const reference = screen.referenceUrl ?? screen.diffUrl;
  const actual = screen.actualUrl ?? screen.diffUrl;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setOpacity((prev) => Math.max(0, prev - STEP));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setOpacity((prev) => Math.min(100, prev + STEP));
      }
    },
    [],
  );

  if (!reference && !actual) {
    return (
      <div
        data-testid="overlay-onion-skin-missing"
        className="flex h-40 items-center justify-center rounded border border-dashed border-white/10 bg-[#0a0a0a] text-[11px] text-white/45"
      >
        No images attached for onion-skin view.
      </div>
    );
  }

  return (
    <div data-testid="overlay-onion-skin" className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-[11px] text-white/60">
        <label
          htmlFor="onion-opacity"
          className="text-[10px] uppercase tracking-wider text-white/45"
        >
          Actual opacity
        </label>
        <input
          id="onion-opacity"
          data-testid="onion-opacity-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacity}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setOpacity(Number.parseInt(event.target.value, 10));
          }}
          className="flex-1 accent-[#4eba87]"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={opacity}
        />
        <span className="w-10 text-right font-mono text-[#4eba87]">
          {String(opacity)}%
        </span>
      </div>
      <button
        type="button"
        onClick={onZoom}
        aria-label="Zoom onion skin"
        className="relative block cursor-zoom-in overflow-hidden rounded border border-white/10 bg-[#0a0a0a] p-0 text-left"
      >
        {reference ? (
          <img
            src={reference}
            alt="Reference"
            className="block h-auto w-full"
          />
        ) : null}
        {actual ? (
          <img
            src={actual}
            alt="Actual"
            className="pointer-events-none absolute inset-0 block h-full w-full object-cover"
            style={{ opacity: opacity / 100 }}
          />
        ) : null}
      </button>
    </div>
  );
}
