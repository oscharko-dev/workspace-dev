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
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.001;

export function ScreenshotPreview({
  screenshotUrl,
  badgeText = "Figma preview",
  stageName,
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

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full cursor-grab select-none overflow-hidden bg-[#0d0d0d] active:cursor-grabbing"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ pointerEvents: "none" }}
      >
        <img
          src={screenshotUrl}
          alt="Figma design preview"
          draggable={false}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "center center",
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            userSelect: "none",
          }}
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
    </div>
  );
}
