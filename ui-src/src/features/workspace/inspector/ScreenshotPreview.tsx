import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from "react";

export interface ScreenshotPreviewProps {
  /** URL or data URL of the Figma screenshot */
  screenshotUrl: string;
  /** Badge text. Shown as overlay top-right. Defaults to "Figma preview" */
  badgeText?: string;
  /** Optional sub-message below badge */
  stageName?: string;
  /** Additional vertical pan offset (px) applied on top of user-controlled pan. Use for scroll sync from an external source. */
  externalOffsetY?: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.001;
const ZOOM_STEP = 1.25;

export function ScreenshotPreview({
  screenshotUrl,
  badgeText = "Figma preview",
  stageName,
  externalOffsetY,
}: ScreenshotPreviewProps): JSX.Element {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [trackedUrl, setTrackedUrl] = useState(screenshotUrl);
  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom/pan when the source image changes. Using a render-phase
  // comparison instead of `useEffect` avoids the cascading-render pattern.
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders
  if (trackedUrl !== screenshotUrl) {
    setTrackedUrl(screenshotUrl);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }

  // React synthetic `onWheel` handlers are passive by default and cannot
  // prevent the browser's scroll — attach a non-passive native listener so
  // wheel-zoom does not also scroll any ancestor container.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const handler = (event: WheelEvent): void => {
      event.preventDefault();
      setScale((prev) => {
        const delta = -event.deltaY * ZOOM_SENSITIVITY;
        const next = prev + delta * prev;
        return Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      });
    };
    container.addEventListener("wheel", handler, { passive: false });
    return () => {
      container.removeEventListener("wheel", handler);
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.currentTarget.setPointerCapture(event.pointerId);
      isPanning.current = true;
      lastPointer.current = { x: event.clientX, y: event.clientY };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (!isPanning.current) {
        return;
      }
      const dx = event.clientX - lastPointer.current.x;
      const dy = event.clientY - lastPointer.current.y;
      lastPointer.current = { x: event.clientX, y: event.clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    },
    [],
  );

  const handlePointerUp = useCallback((): void => {
    isPanning.current = false;
  }, []);

  const handleZoomIn = useCallback((): void => {
    setScale((prev) => Math.min(MAX_SCALE, prev * ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback((): void => {
    setScale((prev) => Math.max(MIN_SCALE, prev / ZOOM_STEP));
  }, []);

  const handleReset = useCallback((): void => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full cursor-grab select-none overflow-hidden bg-[#0d0d0d] active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="screenshot-preview-container absolute inset-0 flex items-center justify-center">
        <img
          src={screenshotUrl}
          alt="Figma design preview"
          draggable={false}
          className="screenshot-preview-image"
          style={
            {
              "--transform-translate-scale": `translate(${translate.x}px, ${translate.y + (externalOffsetY ?? 0)}px) scale(${scale})`,
            } as React.CSSProperties
          }
        />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="rounded-full border border-[#4eba87]/40 bg-[#000000]/80 px-3 py-1 text-xs font-medium text-[#4eba87] backdrop-blur-sm">
          {badgeText}
        </div>
        {stageName !== undefined ? (
          <div className="rounded bg-[#000000]/70 px-2 py-0.5 text-[10px] text-white/60">
            {stageName}
          </div>
        ) : null}
      </div>

      {/* pointer-events-auto re-enables clicks on the button group; the parent
          container is pointer-events-none so pan events don't conflict. */}
      <div className="pointer-events-auto absolute bottom-3 right-3 flex items-center gap-1 rounded border border-[#333333] bg-[#000000]/80 px-1.5 py-1 backdrop-blur-sm">
        <span
          className="min-w-[3ch] text-center text-[10px] text-white/60"
          aria-live="polite"
          data-testid="screenshot-preview-zoom-percent"
        >
          {zoomPercent}%
        </span>
        <button
          type="button"
          aria-label="Zoom out"
          data-testid="screenshot-preview-zoom-out"
          disabled={scale <= MIN_SCALE}
          onClick={handleZoomOut}
          className="flex h-5 w-5 items-center justify-center rounded border border-[#333333] text-xs text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87] active:text-[#4eba87] disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          data-testid="screenshot-preview-zoom-in"
          disabled={scale >= MAX_SCALE}
          onClick={handleZoomIn}
          className="flex h-5 w-5 items-center justify-center rounded border border-[#333333] text-xs text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87] active:text-[#4eba87] disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          data-testid="screenshot-preview-zoom-reset"
          onClick={handleReset}
          className="flex h-5 items-center justify-center rounded border border-[#333333] px-1.5 text-[10px] text-white/70 hover:border-[#4eba87]/40 hover:text-[#4eba87] active:text-[#4eba87]"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
